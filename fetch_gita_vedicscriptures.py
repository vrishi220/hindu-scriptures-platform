#!/usr/bin/env python3
"""
Fetch Bhagavad Gita from vedicscriptures.github.io and export to normalized local JSON.
Supports iterative import: run once to cache, then import repeatedly from local file.
"""

import json
import sys
from pathlib import Path
from typing import Any, Optional

import requests


CHAPTERS_URL = "https://vedicscriptures.github.io/chapters/"
CHAPTER_URL_TEMPLATE = "https://vedicscriptures.github.io/chapter/{chapter}/"
VERSE_URL_TEMPLATE = "https://vedicscriptures.github.io/slok/{chapter}/{verse}/"
OUTPUT_FILE = Path(__file__).parent / "external" / "bhagavad_gita_vedicscriptures_raw.json"


def fetch_chapters_metadata() -> Optional[list[dict[str, Any]]]:
    """Fetch list of chapters with verse counts."""
    try:
        response = requests.get(CHAPTERS_URL, timeout=10)
        response.raise_for_status()
        data = response.json()
        # Expected structure: list of {chapter_number, chapter_summary, verses_count, ...}
        return data if isinstance(data, list) else None
    except Exception as e:
        print(f"Error fetching chapters: {e}", file=sys.stderr)
        return None


def fetch_verse(chapter: int, verse: int) -> Optional[dict[str, Any]]:
    """Fetch a single verse."""
    try:
        url = VERSE_URL_TEMPLATE.format(chapter=chapter, verse=verse)
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching verse {chapter}:{verse}: {e}", file=sys.stderr)
        return None


def fetch_chapter_details(chapter: int) -> Optional[dict[str, Any]]:
    """Fetch detailed chapter metadata including multilingual meaning/summary."""
    try:
        url = CHAPTER_URL_TEMPLATE.format(chapter=chapter)
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except Exception as e:
        print(f"Error fetching chapter details {chapter}: {e}", file=sys.stderr)
        return None


def build_gita_json(chapters_meta: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Build a normalized JSON structure.
    Schema-agnostic: just organize chapters with verses hierarchically.
    """
    chapters_list = []

    for chapter_meta in chapters_meta:
        chapter_num = chapter_meta.get("chapter_number") or chapter_meta.get("Chapter", 1)
        verse_count = chapter_meta.get("verses_count") or chapter_meta.get("Verses", 0)

        if verse_count == 0:
            print(f"Skipping chapter {chapter_num} with 0 verses")
            continue

        print(f"Fetching chapter {chapter_num} ({verse_count} verses)...", file=sys.stderr)

        chapter_details = fetch_chapter_details(chapter_num) or {}

        chapter_summary_map = chapter_details.get("summary") or chapter_meta.get("summary", {})
        chapter_summary_en = ""
        if isinstance(chapter_summary_map, dict):
            chapter_summary_en = str(chapter_summary_map.get("en") or "").strip()
        elif isinstance(chapter_summary_map, str):
            chapter_summary_en = chapter_summary_map.strip()
            chapter_summary_map = {"en": chapter_summary_en} if chapter_summary_en else {}

        chapter_data = {
            "chapter_number": chapter_num,
            "verses_count": verse_count,
            # Backward-compatible single-language field; prefer the English summary.
            "chapter_summary": chapter_summary_en,
            # Canonical multilingual summary map.
            "summary": chapter_summary_map,
            "meaning": chapter_details.get("meaning") or chapter_meta.get("meaning", ""),
            "name": chapter_details.get("name") or chapter_meta.get("name", f"Chapter {chapter_num}"),
            "translation": chapter_details.get("translation") or chapter_meta.get("translation", ""),
            "transliteration": chapter_details.get("transliteration") or chapter_meta.get("transliterated_name", ""),
            "transliterated_name": chapter_meta.get("transliterated_name")
            or chapter_details.get("transliteration")
            or f"Adhyaya {chapter_num}",
            "name_sanskrit": chapter_meta.get("name_sanskrit") or chapter_details.get("name", ""),
            "verses": [],
        }

        for verse_num in range(1, verse_count + 1):
            verse_data = fetch_verse(chapter_num, verse_num)
            if verse_data:
                chapter_data["verses"].append(verse_data)
            else:
                print(f"Failed to fetch verse {chapter_num}:{verse_num}, skipping", file=sys.stderr)

        chapters_list.append(chapter_data)

    return {
        "title": "Bhagavad Gita",
        "source": "vedicscriptures.github.io",
        "total_chapters": len(chapters_list),
        "chapters": chapters_list,
    }


def main():
    print("Fetching chapters metadata...", file=sys.stderr)
    chapters_meta = fetch_chapters_metadata()

    if not chapters_meta:
        print("Failed to fetch chapters metadata", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(chapters_meta)} chapters", file=sys.stderr)

    gita_data = build_gita_json(chapters_meta)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(gita_data, f, ensure_ascii=False, indent=2)

    print(f"✓ Exported to {OUTPUT_FILE}", file=sys.stderr)
    total_verses = sum(len(ch["verses"]) for ch in gita_data["chapters"])
    print(f"  Total: {total_verses} verses across {len(chapters_meta)} chapters", file=sys.stderr)


if __name__ == "__main__":
    main()
