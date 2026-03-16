#!/usr/bin/env python3
import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import requests
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

GITHUB_API_CONTENTS = "https://api.github.com/repos/{owner}/{repo}/contents/{path}"
RAW_BASE = "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


@dataclass
class SourceFile:
    prakarana_num: int
    sarga_num: int
    path: str


def to_int_safe(value: str) -> int:
    try:
        return int(value.translate(DEVANAGARI_DIGITS))
    except Exception:
        return 0


def parse_filename(name: str) -> Optional[Tuple[int, int]]:
    # expected: <prakarana>_<chapter>.txt e.g. 1_001.txt
    m = re.match(r"^(\d+)_([0-9]+)\.txt$", name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def list_source_files(owner: str, repo: str, branch: str, path: str) -> List[SourceFile]:
    url = GITHUB_API_CONTENTS.format(owner=owner, repo=repo, path=path)
    resp = requests.get(url, params={"ref": branch}, timeout=30)
    resp.raise_for_status()
    rows = resp.json()

    files: List[SourceFile] = []
    for row in rows:
        if row.get("type") != "file":
            continue
        name = row.get("name", "")
        parsed = parse_filename(name)
        if not parsed:
            continue
        prakarana_num, sarga_num = parsed
        files.append(
            SourceFile(
                prakarana_num=prakarana_num,
                sarga_num=sarga_num,
                path=row["path"],
            )
        )
    files.sort(key=lambda x: (x.prakarana_num, x.sarga_num))
    return files


def fetch_text(owner: str, repo: str, branch: str, path: str) -> str:
    raw_url = RAW_BASE.format(owner=owner, repo=repo, branch=branch, path=path)
    r = requests.get(raw_url, timeout=30)
    r.raise_for_status()
    return r.text


def extract_sarga_title(lines: List[str], sarga_num: int) -> str:
    for ln in lines[:40]:
        if "सर्गः" in ln:
            return ln.strip()
    return f"सर्गः {sarga_num}"


def split_shlokas(text: str) -> List[Tuple[str, str]]:
    """
    Split by shloka-ending markers like:
    ... ।। १
    ... ॥ १॥
    """
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

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

    verse_end_re = re.compile(r"(?:।।|॥)\s*([०-९0-9]+)\s*(?:।।|॥)?\s*$")

    for ln in lines:
        buf.append(ln)
        m = verse_end_re.search(ln)
        if m:
            num_raw = m.group(1)
            num_norm = str(to_int_safe(num_raw)) if to_int_safe(num_raw) > 0 else str(verse_no)
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
    owner: str,
    repo: str,
    branch: str,
    files: List[SourceFile],
) -> dict:
    payload = {
        "schema_version": "hsp-book-json-v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "app": "yv-text-converter",
            "format": "canonical-book-json",
            "repo": f"https://github.com/{owner}/{repo}",
            "branch": branch,
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
                "original_source_url": f"https://github.com/{owner}/{repo}/blob/{branch}/{sf.path}",
                "tags": ["yoga-vasishtha"],
                "media_items": [],
            })

        text = fetch_text(owner, repo, branch, sf.path)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        sarga_title = extract_sarga_title(lines, sf.sarga_num)

        sid = next_id
        next_id += 1
        nodes.append({
            "node_id": sid,
            "parent_node_id": prakarana_node_id[sf.prakarana_num],
            "referenced_node_id": None,
            "level_name": "Sarga",
            "level_order": 1,
            "sequence_number": str(sf.sarga_num),
            "title_sanskrit": sarga_title,
            "title_transliteration": devanagari_to_iast(sarga_title) or f"Sarga {sf.sarga_num}",
            "title_english": f"Sarga {sf.sarga_num}",
            "title_hindi": None,
            "title_tamil": None,
            "has_content": False,
            "content_data": {},
            "summary_data": {},
            "metadata_json": {
                "prakarana_number": sf.prakarana_num,
                "sarga_number": sf.sarga_num,
                "source_file": sf.path,
            },
            "source_attribution": None,
            "license_type": "CC-BY-SA-4.0",
            "original_source_url": f"https://github.com/{owner}/{repo}/blob/{branch}/{sf.path}",
            "tags": ["yoga-vasishtha"],
            "media_items": [],
        })

        for verse_no, shloka_text in split_shlokas(text):
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
                    "sarga_number": sf.sarga_num,
                    "shloka_number": to_int_safe(verse_no) or verse_no,
                    "source_file": sf.path,
                },
                "source_attribution": None,
                "license_type": "CC-BY-SA-4.0",
                "original_source_url": f"https://github.com/{owner}/{repo}/blob/{branch}/{sf.path}",
                "tags": ["yoga-vasishtha"],
                "media_items": [],
            })

    return payload


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema-id", type=int, required=True, help="Scriptle schema id for 3-level hierarchy")
    ap.add_argument("--owner", default="lokeshh")
    ap.add_argument("--repo", default="yv_text")
    ap.add_argument("--branch", default="master")
    ap.add_argument("--path", default="wiki_yv")
    ap.add_argument("--book-name", default="Yoga Vasiṣṭha")
    ap.add_argument("--book-code", default="yoga-vasishtha")
    ap.add_argument("--out", default="specs/yoga_vasishtha.book-json-v1.json")
    args = ap.parse_args()

    files = list_source_files(args.owner, args.repo, args.branch, args.path)
    if not files:
        raise SystemExit("No matching <prakarana>_<chapter>.txt files found.")

    payload = build_payload(
        schema_id=args.schema_id,
        book_name=args.book_name,
        book_code=args.book_code,
        owner=args.owner,
        repo=args.repo,
        branch=args.branch,
        files=files,
    )

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote: {args.out}")
    print(f"Nodes: {len(payload['nodes'])}")


if __name__ == "__main__":
    main()