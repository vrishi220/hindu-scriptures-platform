#!/usr/bin/env python3
import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
ASCII_TO_DEVANAGARI_DIGITS = str.maketrans("0123456789", "०१२३४५६७८९")

VERSE_END_STANDARD_RE = re.compile(r"(?:।।|॥)\s*([०-९0-9]+)\s*(?:।।|॥|\|\|)?\s*$")
VERSE_END_DOTTED_RE = re.compile(r"(?:।।|॥)\s*([०-९0-9]+(?:\.[०-९0-9]+)+)\s*(?:।।|॥|\|\|)?\s*$")
VERSE_END_BARE_RE = re.compile(r"([०-९0-9]+)\s*(?:\|\|)?\s*$")
VERSE_END_UNUSUAL_ORDER_RE = re.compile(r"॥\s*[०-९0-9]+\s*।।\s*$")


@dataclass
class SourceFile:
    prakarana_num: int
    sarga_num: int
    path: str


@dataclass
class SargaClosure:
    line: str
    sarga_name_sanskrit: Optional[str]
    sarga_ordinal_sanskrit: Optional[str]
    sarga_number: int


LEADING_MATRA_TO_INDEPENDENT_VOWEL = {
    "ा": "अ",
    "ि": "इ",
    "ी": "ई",
    "ु": "उ",
    "ू": "ऊ",
    "े": "ए",
    "ै": "ए",
    "ो": "ओ",
    "ौ": "औ",
    "ृ": "ऋ",
}


def build_sarga_label_sanskrit(ordinal: Optional[str], number: int) -> str:
    if ordinal:
        return f"{ordinal} सर्गः"
    return f"सर्गः {number}"


def normalize_combined_ordinal_token(token: str) -> str:
    if token.startswith("नाम"):
        token = token[len("नाम"):]
    if token and token[0] in LEADING_MATRA_TO_INDEPENDENT_VOWEL:
        token = LEADING_MATRA_TO_INDEPENDENT_VOWEL[token[0]] + token[1:]
    return token


def to_int_safe(value: str) -> int:
    try:
        return int(value.translate(DEVANAGARI_DIGITS))
    except Exception:
        return 0


def int_to_devanagari(value: int) -> str:
    if value <= 0:
        return ""
    return str(value).translate(ASCII_TO_DEVANAGARI_DIGITS)


def extract_trailing_verse_number(line: str) -> Optional[int]:
    """
    Extract a verse number from common line-ending patterns.
    Handles:
      - "... ॥ ५४", "... ॥ ५४ ।।", "... ॥ ५४||"
      - "... ।। 1.18.१०" (uses last numeric segment as verse)
      - "... भविष्यति ६१" (bare trailing number in some source files)
    """
    text = (line or "").strip()
    if not text or "सर्गः" in text:
        return None

    m_std = VERSE_END_STANDARD_RE.search(text)
    if m_std:
        val = to_int_safe(m_std.group(1))
        return val if val > 0 else None

    m_dot = VERSE_END_DOTTED_RE.search(text)
    if m_dot:
        parts = [p for p in m_dot.group(1).split(".") if p]
        if parts:
            val = to_int_safe(parts[-1])
            return val if val > 0 else None

    # Bare trailing number fallback for malformed verse closings.
    m_bare = VERSE_END_BARE_RE.search(text)
    if m_bare and re.search(r"[\u0900-\u097F]", text):
        val = to_int_safe(m_bare.group(1))
        return val if val > 0 else None

    return None


def normalize_verse_ending_line(line: str) -> str:
    """Normalize suspicious verse endings to canonical: ' ॥ <number>' (line-local only)."""
    text = (line or "").rstrip()
    if not text:
        return text

    extracted = extract_trailing_verse_number(text)
    if not extracted:
        return text

    has_std = bool(VERSE_END_STANDARD_RE.search(text))
    has_dotted = bool(VERSE_END_DOTTED_RE.search(text))
    has_bare = bool(VERSE_END_BARE_RE.search(text)) and not has_std and not has_dotted
    has_ascii_pipe = "||" in text
    has_unusual_order = bool(VERSE_END_UNUSUAL_ORDER_RE.search(text))

    # Keep already-normal lines unchanged; only normalize known anomalies.
    if not (has_dotted or has_bare or has_ascii_pipe or has_unusual_order):
        return text

    cleaned = text
    cleaned = VERSE_END_DOTTED_RE.sub("", cleaned).rstrip()
    cleaned = VERSE_END_STANDARD_RE.sub("", cleaned).rstrip()
    cleaned = re.sub(r"[0-9०-९]+\s*(?:\|\|)?\s*$", "", cleaned).rstrip()
    cleaned = re.sub(r"[।॥]+\s*$", "", cleaned).rstrip()
    return f"{cleaned} ॥ {int_to_devanagari(extracted)}".strip()


def normalize_verse_endings_text(text: str) -> str:
    """Normalize verse-ending punctuation per line while preserving line layout."""
    out: List[str] = []
    for ln in text.splitlines():
        out.append(normalize_verse_ending_line(ln))
    return "\n".join(out)


def parse_filename(name: str) -> Optional[Tuple[int, int]]:
    # expected: <prakarana>_<chapter>.txt e.g. 1_001.txt
    m = re.match(r"^(\d+)_([0-9]+)\.txt$", name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def list_source_files(input_dir: str) -> List[SourceFile]:
    base_dir = Path(input_dir)
    if not base_dir.exists() or not base_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")

    files: List[SourceFile] = []
    for p in sorted(base_dir.glob("*.txt")):
        if not p.is_file():
            continue
        name = p.name
        parsed = parse_filename(name)
        if not parsed:
            continue
        prakarana_num, sarga_num = parsed
        files.append(
            SourceFile(
                prakarana_num=prakarana_num,
                sarga_num=sarga_num,
                path=p.as_posix(),
            )
        )
    files.sort(key=lambda x: (x.prakarana_num, x.sarga_num))
    return files


def fetch_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def extract_sarga_title(lines: List[str], sarga_num: int) -> str:
    for ln in lines[:40]:
        if "सर्गः" in ln:
            return ln.strip()
    return f"सर्गः {sarga_num}"


def parse_sarga_closure(lines: List[str], fallback_sarga_num: int) -> Optional[SargaClosure]:
    if not lines:
        return None

    closure_line = ""
    for ln in reversed(lines):
        text = ln.strip()
        if not text:
            continue
        if "सर्गः" in text:
            closure_line = text
            break

    if not closure_line:
        return None

    extracted = extract_trailing_verse_number(closure_line)
    sarga_number = extracted if extracted else fallback_sarga_num
    if sarga_number <= 0:
        sarga_number = fallback_sarga_num

    # e.g.
    #   "... सूत्रपातनको नाम प्रथमः सर्गः ॥ १ ॥"
    #   "... राघवसमाश्वासनं नामैकादशः सर्गः ।। ११ ।।"
    sarga_name = None
    sarga_ordinal = None

    spaced_match = re.search(r"([^\s।॥]+)\s+नाम\s+([^\s।॥]+)\s+सर्गः", closure_line)
    combined_match = re.search(r"([^\s।॥]+)\s+(नाम[^\s।॥]+)\s+सर्गः", closure_line)

    if spaced_match:
        sarga_name = spaced_match.group(1)
        sarga_ordinal = spaced_match.group(2)
    elif combined_match:
        sarga_name = combined_match.group(1)
        sarga_ordinal = normalize_combined_ordinal_token(combined_match.group(2))

    if sarga_name and sarga_name.endswith("ो"):
        sarga_name = sarga_name[:-1] + "ः"

    return SargaClosure(
        line=closure_line,
        sarga_name_sanskrit=sarga_name,
        sarga_ordinal_sanskrit=sarga_ordinal,
        sarga_number=sarga_number,
    )


def is_leading_sarga_header_line(line: str) -> bool:
    """
    Detect heading-only sarga lines that appear before verse content, e.g.:
      "एकादशः सर्गः ११"
      "प्रथमः सर्गः ।। १ ।।"
    These should not be treated as shloka text.
    """
    text = (line or "").strip()
    if not text or "सर्गः" not in text:
        return False

    # Header-style line: Devanagari heading tokens + optional punctuation/digits.
    # Excludes longer prose lines with mixed punctuation.
    if re.search(r"^[\u0900-\u097F\s]+सर्गः[\s।॥|०-९0-9.]*$", text):
        return True

    return False


def split_shlokas(text: str, closure_line: Optional[str] = None) -> List[Tuple[str, str]]:
    """
    Split by shloka-ending markers like:
    ... ।। १
    ... ॥ १॥
    """
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

    if closure_line:
        normalized = closure_line.strip()
        for idx in range(len(lines) - 1, -1, -1):
            if lines[idx] == normalized:
                del lines[idx]
                break

    # Remove obvious file headers / separators noise
    cleaned = []
    for ln in lines:
        if re.match(r"^[=\-_*]{3,}$", ln):
            continue
        cleaned.append(ln)
    lines = cleaned

    shlokas: List[Tuple[str, str]] = []
    buf: List[str] = []
    verse_no = 1

    for ln in lines:
        # Ignore heading-only sarga lines in the pre-verse lead-in.
        if not shlokas and not buf and is_leading_sarga_header_line(ln):
            continue

        buf.append(ln)
        extracted = extract_trailing_verse_number(ln)
        if extracted:
            num_norm = str(extracted)
            shlokas.append((num_norm, "\n".join(buf).strip()))
            buf = []
            verse_no += 1

    if buf:
        # trailing chunk without explicit marker; still preserve
        shlokas.append((str(verse_no), "\n".join(buf).strip()))

    return shlokas


def devanagari_to_iast(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    try:
        return transliterate(text, sanscript.DEVANAGARI, sanscript.IAST)
    except Exception:
        return ""


def build_payload(
    schema_id: int,
    book_name: str,
    book_code: str,
    input_dir: str,
    files: List[SourceFile],
    normalize_verse_endings: bool = False,
) -> dict:
    payload = {
        "schema_version": "hsp-book-json-v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "app": "yv-text-converter",
            "format": "canonical-book-json",
            "input_dir": input_dir,
        },
        "schema": {
            "id": schema_id,
            "name": "Book -> Prakarana -> Sarga -> Shloka",
            "description": "Yoga Vasistha from wiki_yv txt",
            "levels": ["Prakarana", "Sarga", "Shloka"],
        },
        "book": {
            "book_name": book_name,
            "book_code": book_code,
            "language_primary": "sanskrit",
            "metadata": {
                "status": "draft",
                "visibility": "private",
            },
        },
        "nodes": [],
    }

    nodes = payload["nodes"]
    next_id = 1

    prakarana_node_id: Dict[int, int] = {}

    for sf in files:
        if sf.prakarana_num not in prakarana_node_id:
            pid = next_id
            next_id += 1
            prakarana_node_id[sf.prakarana_num] = pid
            prakarana_title = f"प्रकरण {sf.prakarana_num}"
            nodes.append({
                "node_id": pid,
                "parent_node_id": None,
                "referenced_node_id": None,
                "level_name": "Prakarana",
                "level_order": 0,
                "sequence_number": str(sf.prakarana_num),
                "title_sanskrit": prakarana_title,
                "title_transliteration": devanagari_to_iast(prakarana_title) or f"Prakarana {sf.prakarana_num}",
                "title_english": f"Prakarana {sf.prakarana_num}",
                "title_hindi": None,
                "title_tamil": None,
                "has_content": False,
                "content_data": {},
                "summary_data": {},
                "metadata_json": {"prakarana_number": sf.prakarana_num},
                "source_attribution": None,
                "license_type": "CC-BY-SA-4.0",
                "original_source_url": sf.path,
                "tags": ["yoga-vasishtha"],
                "media_items": [],
            })

        text = fetch_text(sf.path)
        if normalize_verse_endings:
            text = normalize_verse_endings_text(text)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        closure = parse_sarga_closure(lines, sf.sarga_num)
        sarga_title = closure.sarga_name_sanskrit if closure and closure.sarga_name_sanskrit else extract_sarga_title(lines, sf.sarga_num)
        sarga_num_from_closure = closure.sarga_number if closure else sf.sarga_num
        sarga_label_sanskrit = build_sarga_label_sanskrit(
            closure.sarga_ordinal_sanskrit if closure else None,
            sarga_num_from_closure,
        )

        sid = next_id
        next_id += 1
        nodes.append({
            "node_id": sid,
            "parent_node_id": prakarana_node_id[sf.prakarana_num],
            "referenced_node_id": None,
            "level_name": "Sarga",
            "level_order": 1,
            "sequence_number": str(sarga_num_from_closure),
            "title_sanskrit": sarga_title,
            "title_transliteration": devanagari_to_iast(sarga_title) or f"Sarga {sarga_num_from_closure}",
            "title_english": f"Sarga {sarga_num_from_closure}",
            "title_hindi": None,
            "title_tamil": None,
            "has_content": False,
            "content_data": {},
            "summary_data": {},
            "metadata_json": {
                "prakarana_number": sf.prakarana_num,
                "sarga_number": sarga_num_from_closure,
                "sarga_number_from_filename": sf.sarga_num,
                "sarga_ordinal_sanskrit": closure.sarga_ordinal_sanskrit if closure else None,
                "sarga_label_sanskrit": sarga_label_sanskrit,
                "sarga_closure_line": closure.line if closure else None,
                "source_file": sf.path,
            },
            "source_attribution": None,
            "license_type": "CC-BY-SA-4.0",
            "original_source_url": sf.path,
            "tags": ["yoga-vasishtha"],
            "media_items": [],
        })

        for verse_no, shloka_text in split_shlokas(text, closure_line=closure.line if closure else None):
            vid = next_id
            next_id += 1
            shloka_title = f"श्लोक {verse_no}"
            shloka_transliteration = devanagari_to_iast(shloka_text)
            nodes.append({
                "node_id": vid,
                "parent_node_id": sid,
                "referenced_node_id": None,
                "level_name": "Shloka",
                "level_order": 2,
                "sequence_number": verse_no,
                "title_sanskrit": shloka_title,
                "title_transliteration": devanagari_to_iast(shloka_title) or f"Shloka {verse_no}",
                "title_english": f"Shloka {verse_no}",
                "title_hindi": None,
                "title_tamil": None,
                "has_content": True,
                "content_data": {
                    "basic": {
                        "sanskrit": shloka_text,
                        "transliteration": shloka_transliteration,
                        "english": "",
                    }
                },
                "summary_data": {},
                "metadata_json": {
                    "prakarana_number": sf.prakarana_num,
                    "sarga_number": sarga_num_from_closure,
                    "shloka_number": to_int_safe(verse_no) or verse_no,
                    "source_file": sf.path,
                },
                "source_attribution": None,
                "license_type": "CC-BY-SA-4.0",
                "original_source_url": sf.path,
                "tags": ["yoga-vasishtha"],
                "media_items": [],
            })

    return payload


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema-id", type=int, default=2, help="Scripture schema id for 3-level hierarchy (default: 2)")
    ap.add_argument("--input-dir", default="external/wiki_yv_txt", help="Local directory containing <prakarana>_<chapter>.txt files")
    ap.add_argument("--book-name", default="Yoga Vasiṣṭha")
    ap.add_argument("--book-code", default="yoga-vasishtha")
    ap.add_argument("--out", default="specs/yoga_vasishtha.book-json-v1.json")
    ap.add_argument(
        "--normalize-verse-endings",
        action="store_true",
        help="Normalize verse-ending punctuation in-memory before splitting/export",
    )
    args = ap.parse_args()

    files = list_source_files(args.input_dir)
    if not files:
        raise SystemExit("No matching <prakarana>_<chapter>.txt files found.")

    payload = build_payload(
        schema_id=args.schema_id,
        book_name=args.book_name,
        book_code=args.book_code,
        input_dir=args.input_dir,
        files=files,
        normalize_verse_endings=args.normalize_verse_endings,
    )

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote: {args.out}")
    print(f"Nodes: {len(payload['nodes'])}")


if __name__ == "__main__":
    main()