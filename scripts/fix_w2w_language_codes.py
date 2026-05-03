"""
Scan word_meaning_entries where language_code = 'en' and correct entries whose
meaning_text is actually written in a non-Latin script.

Detection rules (first matching range wins):
  Telugu     U+0C00–U+0C7F  → 'te'
  Devanagari U+0900–U+097F  → 'hi'
  Tamil      U+0B80–U+0BFF  → 'ta'
  Kannada    U+0C80–U+0CFF  → 'kn'

Duplicate handling:
  If a row already exists with (node_id, word_order, target_lang, author_id) the
  mislabelled 'en' entry is a duplicate → DELETE it (the correct entry is kept).
  Otherwise → UPDATE language_code in-place.

Usage:
  python scripts/fix_w2w_language_codes.py          # dry run
  python scripts/fix_w2w_language_codes.py --apply  # commit changes
"""

import argparse
import os
import sys
from collections import defaultdict

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL not set in environment or .env file.")

# ---------------------------------------------------------------------------
# Script detection ranges
# ---------------------------------------------------------------------------

SCRIPT_RANGES: list[tuple[int, int, str]] = [
    (0x0C00, 0x0C7F, "te"),   # Telugu
    (0x0900, 0x097F, "hi"),   # Devanagari / Hindi
    (0x0B80, 0x0BFF, "ta"),   # Tamil
    (0x0C80, 0x0CFF, "kn"),   # Kannada
]

LANG_LABELS: dict[str, str] = {
    "te": "Telugu",
    "hi": "Devanagari/Hindi",
    "ta": "Tamil",
    "kn": "Kannada",
}


def detect_language(text_value: str) -> str | None:
    """Return the detected language code if a non-Latin script is found, else None."""
    counts: dict[str, int] = defaultdict(int)
    for ch in text_value:
        cp = ord(ch)
        for lo, hi, lang in SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[lang] += 1
                break

    if not counts:
        return None

    # Pick the script with the most characters.
    return max(counts, key=lambda k: counts[k])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix language_code on word_meaning_entries that are mislabelled 'en'."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Actually write changes to the database. Without this flag the script runs as a dry run.",
    )
    args = parser.parse_args()

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()

    # ------------------------------------------------------------------
    # 1. Fetch all 'en' rows that appear to be in another script.
    # ------------------------------------------------------------------
    try:
        rows = db.execute(
            text(
                "SELECT id, node_id, word_order, author_id, meaning_text "
                "FROM word_meaning_entries WHERE language_code = 'en'"
            )
        ).fetchall()
    except Exception as exc:
        db.close()
        sys.exit(f"ERROR: Could not query database: {exc}")

    # Candidate: (id, node_id, word_order, author_id, new_lang)
    candidates: list[tuple[int, int, int | None, int | None, str]] = []

    for row in rows:
        entry_id: int = row[0]
        node_id: int = row[1]
        word_order: int | None = row[2]
        author_id: int | None = row[3]
        meaning_text: str = row[4] or ""
        new_lang = detect_language(meaning_text)
        if new_lang:
            candidates.append((entry_id, node_id, word_order, author_id, new_lang))

    if not candidates:
        print("No mislabelled entries found.")
        db.close()
        return

    # ------------------------------------------------------------------
    # 2. For each candidate check whether a row with the target language
    #    already exists (duplicate) → DELETE; otherwise → UPDATE.
    # ------------------------------------------------------------------

    # Build a set of existing (node_id, word_order, language_code, author_id)
    # keys so we can check without extra per-row queries.
    try:
        existing_rows = db.execute(
            text(
                "SELECT node_id, word_order, language_code, author_id "
                "FROM word_meaning_entries WHERE language_code != 'en'"
            )
        ).fetchall()
    except Exception as exc:
        db.close()
        sys.exit(f"ERROR: Could not query existing entries: {exc}")

    existing_keys: set[tuple[int, int | None, str, int | None]] = {
        (r[0], r[1], r[2], r[3]) for r in existing_rows
    }

    delete_ids: list[int] = []
    update_map: dict[str, list[int]] = defaultdict(list)  # new_lang → [id, ...]

    delete_by_lang: dict[str, int] = defaultdict(int)
    update_by_lang: dict[str, int] = defaultdict(int)

    for entry_id, node_id, word_order, author_id, new_lang in candidates:
        key = (node_id, word_order, new_lang, author_id)
        if key in existing_keys:
            delete_ids.append(entry_id)
            delete_by_lang[new_lang] += 1
        else:
            update_map[new_lang].append(entry_id)
            update_by_lang[new_lang] += 1

    # ------------------------------------------------------------------
    # 3. Report
    # ------------------------------------------------------------------
    prefix = "DRY RUN — " if not args.apply else ""
    total = len(delete_ids) + sum(len(v) for v in update_map.values())
    print(f"{prefix}Found {total} entries to correct:\n")

    all_langs = sorted(set(list(delete_by_lang) + list(update_by_lang)))
    for lang in all_langs:
        label = LANG_LABELS.get(lang, lang)
        d = delete_by_lang.get(lang, 0)
        u = update_by_lang.get(lang, 0)
        parts = []
        if d:
            parts.append(f"{d} delete")
        if u:
            parts.append(f"{u} update")
        print(f"  {label:20s} ({lang})  →  {', '.join(parts)}")

    if not args.apply:
        print("\nRun with --apply to commit these changes.")
        db.close()
        return

    # ------------------------------------------------------------------
    # 4. Apply — DELETEs first, then UPDATEs
    # ------------------------------------------------------------------
    try:
        deleted = 0
        updated = 0

        if delete_ids:
            db.execute(
                text("DELETE FROM word_meaning_entries WHERE id = ANY(:ids)"),
                {"ids": delete_ids},
            )
            deleted = len(delete_ids)

        for new_lang, ids in update_map.items():
            db.execute(
                text(
                    "UPDATE word_meaning_entries SET language_code = :lang WHERE id = ANY(:ids)"
                ),
                {"lang": new_lang, "ids": ids},
            )
            updated += len(ids)

        db.commit()
        print(f"\nApplied: {deleted} deleted (duplicates), {updated} updated (corrected).")
    except Exception as exc:
        db.rollback()
        sys.exit(f"ERROR: Changes failed, rolled back: {exc}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
