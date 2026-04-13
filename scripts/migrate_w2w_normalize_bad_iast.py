"""
One-time migration: normalize W2W (word_meanings) rows where transliteration.iast
contains non-Latin (Indic script) characters.

The bug: some imports stored the source script text (e.g. Telugu) verbatim in
transliteration.iast instead of converting it to proper IAST. This caused the
front-end to treat Telugu as IAST and render it unconverted regardless of the
user's chosen transliteration scheme.

Fix applied:
  - script_text:            any Indic script  → Devanagari (canonical storage)
  - transliteration.iast:   any Indic script  → IAST

Detection: if a string contains characters in known Indic Unicode blocks it is
NOT valid IAST/Latin transliteration.

Run:
    python scripts/migrate_w2w_normalize_bad_iast.py [--dry-run]
"""

import argparse
import json
import os
import re
import sys

import psycopg2
from dotenv import load_dotenv
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

load_dotenv()

# ---------------------------------------------------------------------------
# Unicode ranges for Indic scripts we want to detect
# ---------------------------------------------------------------------------
INDIC_PATTERN = re.compile(
    r"[\u0900-\u097F"   # Devanagari
    r"\u0980-\u09FF"    # Bengali
    r"\u0A00-\u0A7F"    # Gurmukhi
    r"\u0A80-\u0AFF"    # Gujarati
    r"\u0B00-\u0B7F"    # Oriya
    r"\u0B80-\u0BFF"    # Tamil
    r"\u0C00-\u0C7F"    # Telugu
    r"\u0C80-\u0CFF"    # Kannada
    r"\u0D00-\u0D7F"    # Malayalam
    r"]"
)

SCRIPT_TO_SANSCRIPT = {
    "\u0C00": sanscript.TELUGU,    # U+0C00..U+0C7F
    "\u0900": sanscript.DEVANAGARI,
    "\u0980": sanscript.BENGALI,
    "\u0B80": sanscript.TAMIL,
    "\u0C80": sanscript.KANNADA,
    "\u0D00": sanscript.MALAYALAM,
    "\u0A00": sanscript.GURMUKHI,
    "\u0A80": sanscript.GUJARATI,
}

UNICODE_BLOCKS = [
    (0x0900, 0x097F, sanscript.DEVANAGARI),
    (0x0980, 0x09FF, sanscript.BENGALI),
    (0x0A00, 0x0A7F, sanscript.GURMUKHI),
    (0x0A80, 0x0AFF, sanscript.GUJARATI),
    (0x0B00, 0x0B7F, sanscript.ORIYA),
    (0x0B80, 0x0BFF, sanscript.TAMIL),
    (0x0C00, 0x0C7F, sanscript.TELUGU),
    (0x0C80, 0x0CFF, sanscript.KANNADA),
    (0x0D00, 0x0D7F, sanscript.MALAYALAM),
]


def detect_indic_script(text: str):
    """Return the sanscript scheme constant if text contains Indic characters, else None."""
    counts: dict = {}
    for ch in text:
        cp = ord(ch)
        for lo, hi, scheme in UNICODE_BLOCKS:
            if lo <= cp <= hi:
                counts[scheme] = counts.get(scheme, 0) + 1
                break
    if not counts:
        return None
    return max(counts, key=lambda s: counts[s])


def to_devanagari(text: str, from_scheme) -> str:
    return transliterate(text, from_scheme, sanscript.DEVANAGARI)


def to_iast(text: str, from_scheme) -> str:
    deva = to_devanagari(text, from_scheme)
    return transliterate(deva, sanscript.DEVANAGARI, sanscript.IAST)


def normalize_source(source: dict) -> tuple[dict, bool]:
    """
    Return (normalized_source, changed).
    Converts bad iast + script_text values in-place.
    """
    changed = False
    script_text: str = (source.get("script_text") or "").strip()
    transliteration: dict = source.get("transliteration") or {}
    iast_val: str = (transliteration.get("iast") or "").strip()

    # Detect bad iast (contains Indic script characters)
    bad_iast_scheme = detect_indic_script(iast_val) if iast_val else None
    script_text_scheme = detect_indic_script(script_text) if script_text else None

    if bad_iast_scheme is None and script_text_scheme is None:
        # Nothing to fix
        return source, False

    # Use whichever source is available. Prefer script_text; fall back to bad iast.
    source_text = script_text or iast_val
    source_scheme = script_text_scheme or bad_iast_scheme

    if source_scheme == sanscript.DEVANAGARI:
        new_script_text = source_text
        new_iast = transliterate(source_text, sanscript.DEVANAGARI, sanscript.IAST)
    else:
        new_script_text = to_devanagari(source_text, source_scheme)
        new_iast = to_iast(source_text, source_scheme)

    if new_script_text != script_text or new_iast != iast_val:
        changed = True
        source = dict(source)
        source["script_text"] = new_script_text
        source["transliteration"] = dict(transliteration)
        source["transliteration"]["iast"] = new_iast

    return source, changed


def migrate(dry_run: bool = False):
    db_url = os.getenv("DATABASE_URL", "")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Find nodes that have word_meanings rows
    cur.execute("""
        SELECT id, content_data->'word_meanings'->'rows'
        FROM content_nodes
        WHERE content_data ? 'word_meanings'
          AND jsonb_typeof(content_data->'word_meanings'->'rows') = 'array'
          AND jsonb_array_length(content_data->'word_meanings'->'rows') > 0
    """)

    nodes = cur.fetchall()
    print(f"Checking {len(nodes)} nodes with word_meanings rows...")

    total_fixed = 0
    nodes_fixed = 0

    for node_id, rows in nodes:
        if not rows:
            continue

        new_rows = []
        node_changed = False
        for row in rows:
            source = row.get("source")
            if not isinstance(source, dict):
                new_rows.append(row)
                continue

            new_source, changed = normalize_source(source)
            if changed:
                row = dict(row)
                row["source"] = new_source
                node_changed = True
                total_fixed += 1
            new_rows.append(row)

        if node_changed:
            nodes_fixed += 1
            if dry_run:
                print(f"  [DRY RUN] Would fix node {node_id} ({total_fixed} rows so far)")
            else:
                # Update only the rows array inside word_meanings
                update_cur = conn.cursor()
                update_cur.execute("""
                    UPDATE content_nodes
                    SET content_data = jsonb_set(
                        content_data,
                        '{word_meanings,rows}',
                        %s::jsonb
                    ),
                    updated_at = now()
                    WHERE id = %s
                """, (json.dumps(new_rows, ensure_ascii=False), node_id))
                update_cur.close()
                print(f"  Fixed node {node_id}")

    if not dry_run:
        conn.commit()
        print(f"\nDone. Fixed {total_fixed} W2W rows across {nodes_fixed} nodes.")
    else:
        print(f"\n[DRY RUN] Would fix {total_fixed} W2W rows across {nodes_fixed} nodes.")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
