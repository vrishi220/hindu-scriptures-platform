#!/usr/bin/env python3
"""Build canonical HSP import JSON for Bhagavad Gita from vedicscriptures raw data.

Input (default): external/bhagavad_gita_vedicscriptures_raw.json
Output (default): external/bhagavad_gita_canonical_multi_author.json

The output is compatible with schema_version: hsp-book-json-v1 and preserves
multiple author translations/commentaries per verse.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.transliteration import devanagari_to_iast


DEFAULT_INPUT = Path("external/bhagavad_gita_vedicscriptures_raw.json")
DEFAULT_OUTPUT = Path("external/bhagavad_gita_canonical_multi_author.json")
SOURCE_URL = "https://vedicscriptures.github.io/"

META_KEYS = {"_id", "chapter", "verse", "slok", "transliteration"}
ENGLISH_PREF_ORDER = ["prabhu", "siva", "adi", "gambir", "purohit", "san", "tej", "raman"]
HINDI_PREF_ORDER = ["rams", "tej", "sankar"]
CANONICAL_CHAPTER_TRANSLITERATIONS = {
    1: "arjuna viṣāda yoga",
    2: "sāṅkhya yoga",
    3: "karma yoga",
    4: "jñāna karma sannyāsa yoga",
    5: "karma sannyāsa yoga",
    6: "dhyāna yoga",
    7: "jñāna vijñāna yoga",
    8: "akṣara brahma yoga",
    9: "rāja vidyā rāja guhya yoga",
    10: "vibhūti yoga",
    11: "viśvarūpa darśana yoga",
    12: "bhakti yoga",
    13: "kṣetra kṣetrajña vibhāga yoga",
    14: "guṇatraya vibhāga yoga",
    15: "puruṣottama yoga",
    16: "daivāsura sampad vibhāga yoga",
    17: "śraddhātraya vibhāga yoga",
    18: "mokṣa sannyāsa yoga",
}


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip()
    return text


def _normalize_language_map(value: Any) -> dict[str, str]:
    """Normalize string/dict values into a clean language->text map."""
    if isinstance(value, str):
        text = _clean_text(value)
        return {"en": text} if text else {}
    if not isinstance(value, dict):
        return {}

    cleaned: dict[str, str] = {}
    for key, raw in value.items():
        if not isinstance(key, str):
            continue
        lang = key.strip().lower()
        if not lang:
            continue
        text = _clean_text(raw)
        if text:
            cleaned[lang] = text
    return cleaned


def _derive_chapter_transliteration(chapter_name: str, raw_transliteration: str, chapter_number: int) -> str:
    canonical = CANONICAL_CHAPTER_TRANSLITERATIONS.get(chapter_number)
    if canonical:
        return canonical

    if chapter_name:
        derived = devanagari_to_iast(chapter_name)
        if derived:
            return derived.lower()

    raw_value = _clean_text(raw_transliteration)
    if raw_value:
        return raw_value.lower()

    return f"Adhyaya {chapter_number}"


def _pick_preferred_text(author_blocks: dict[str, dict[str, Any]], field: str, preferred: list[str]) -> str:
    for key in preferred:
        block = author_blocks.get(key)
        if isinstance(block, dict):
            text = _clean_text(block.get(field))
            if text:
                return text

    for block in author_blocks.values():
        if isinstance(block, dict):
            text = _clean_text(block.get(field))
            if text:
                return text
    return ""


def _extract_author_blocks(verse: dict[str, Any]) -> dict[str, dict[str, Any]]:
    blocks: dict[str, dict[str, Any]] = {}
    for key, value in verse.items():
        if key in META_KEYS:
            continue
        if isinstance(value, dict) and _clean_text(value.get("author")):
            blocks[key] = value
    return blocks


def _build_variants(author_blocks: dict[str, dict[str, Any]]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    translation_variants: list[dict[str, str]] = []
    commentary_variants: list[dict[str, str]] = []

    for slug, block in author_blocks.items():
        for field, lang in (("et", "en"), ("ht", "hi")):
            text = _clean_text(block.get(field))
            if text:
                translation_variants.append(
                    {
                        "author_slug": slug,
                        "language": lang,
                        "field": field,
                        "text": text,
                    }
                )
        for field, lang in (("ec", "en"), ("hc", "hi"), ("sc", "sa")):
            text = _clean_text(block.get(field))
            if text:
                commentary_variants.append(
                    {
                        "author_slug": slug,
                        "language": lang,
                        "field": field,
                        "text": text,
                    }
                )

    return translation_variants, commentary_variants


def _build_variant_authors_registry(chapters: list[dict[str, Any]]) -> dict[str, str]:
    registry: dict[str, str] = {}

    for chapter in chapters:
        verses = chapter.get("verses") if isinstance(chapter.get("verses"), list) else []
        for verse in verses:
            author_blocks = _extract_author_blocks(verse)
            for slug, block in author_blocks.items():
                author_name = _clean_text(block.get("author"))
                if slug and author_name and slug not in registry:
                    registry[slug] = author_name

    return registry


def build_canonical_payload(
    raw: dict[str, Any],
    schema_id: int,
    schema_name: str,
    levels: list[str],
    book_name: str,
    book_code: str,
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    next_node_id = 1

    chapters = raw.get("chapters") if isinstance(raw.get("chapters"), list) else []
    variant_authors = _build_variant_authors_registry(chapters)

    for chapter in chapters:
        chapter_number = chapter.get("chapter_number")
        try:
            chapter_number = int(chapter_number)
        except Exception:
            continue

        chapter_node_id = next_node_id
        next_node_id += 1

        chapter_name = _clean_text(chapter.get("name"))
        chapter_translit = _derive_chapter_transliteration(
            chapter_name,
            chapter.get("transliterated_name"),
            chapter_number,
        )
        chapter_summary_map = _normalize_language_map(chapter.get("chapter_summary") or chapter.get("summary"))
        chapter_meaning_map = _normalize_language_map(chapter.get("meaning"))

        chapter_summary = chapter_summary_map.get("en") or next(iter(chapter_summary_map.values()), "")
        chapter_meaning = chapter_meaning_map.get("en") or next(iter(chapter_meaning_map.values()), "")

        chapter_node = {
            "node_id": chapter_node_id,
            "parent_node_id": None,
            "level_name": "Adhyaya",
            "level_order": 1,
            "sequence_number": str(chapter_number),
            "title_sanskrit": chapter_name,
            "title_transliteration": chapter_translit,
            "title_english": f"Chapter {chapter_number}",
            "has_content": bool(chapter_summary),
            "content_data": {
                "basic": {
                    "summary": chapter_summary,
                    "chapter_meaning": chapter_meaning,
                },
                # Keep chapter summary translations in the generic translations map
                # so existing rendering/search code can consume them without changes.
                "translations": chapter_summary_map,
                "chapter_meaning_translations": chapter_meaning_map,
            },
            "summary_data": {
                "chapter_summary": chapter_summary,
                "chapter_meaning": chapter_meaning,
                "chapter_summary_translations": chapter_summary_map,
                "chapter_meaning_translations": chapter_meaning_map,
                "translations": chapter_summary_map,
            },
            "metadata_json": {
                "source_attribution": "Vedic Scriptures",
                "original_source_url": SOURCE_URL,
            },
            "source_attribution": "Vedic Scriptures",
            "license_type": "CC-BY-SA-4.0",
            "original_source_url": SOURCE_URL,
            "tags": ["bhagavad-gita", "chapter"],
        }
        nodes.append(chapter_node)

        verses = chapter.get("verses") if isinstance(chapter.get("verses"), list) else []
        for verse in verses:
            verse_number = verse.get("verse")
            try:
                verse_number = int(verse_number)
            except Exception:
                continue

            verse_node_id = next_node_id
            next_node_id += 1

            author_blocks = _extract_author_blocks(verse)
            translation_variants, commentary_variants = _build_variants(author_blocks)

            primary_en = _pick_preferred_text(author_blocks, "et", ENGLISH_PREF_ORDER)
            primary_hi = _pick_preferred_text(author_blocks, "ht", HINDI_PREF_ORDER)

            translations_obj: dict[str, str] = {}
            if primary_en:
                translations_obj["english"] = primary_en
                translations_obj["en"] = primary_en
            if primary_hi:
                translations_obj["hindi"] = primary_hi
                translations_obj["hi"] = primary_hi

            verse_sanskrit = _clean_text(verse.get("slok"))
            verse_transliteration = _clean_text(verse.get("transliteration"))

            verse_node = {
                "node_id": verse_node_id,
                "parent_node_id": chapter_node_id,
                "level_name": "Shloka",
                "level_order": 2,
                "sequence_number": str(verse_number),
                "title_sanskrit": "",
                "title_transliteration": f"Shloka {chapter_number}.{verse_number}",
                "title_english": f"Verse {chapter_number}.{verse_number}",
                "has_content": True,
                "content_data": {
                    "basic": {
                        "sanskrit": verse_sanskrit,
                        "transliteration": verse_transliteration,
                        "translation": primary_en,
                    },
                    "translations": translations_obj,
                    "translation_variants": translation_variants,
                    "commentary_variants": commentary_variants,
                },
                "summary_data": {},
                "metadata_json": {
                    "source_verse_id": _clean_text(verse.get("_id")),
                    "source_chapter": chapter_number,
                    "source_verse": verse_number,
                    "source_attribution": "Vedic Scriptures",
                    "original_source_url": SOURCE_URL,
                },
                "source_attribution": "Vedic Scriptures",
                "license_type": "CC-BY-SA-4.0",
                "original_source_url": SOURCE_URL,
                "tags": ["bhagavad-gita", "shloka"],
            }
            nodes.append(verse_node)

    return {
        "schema_version": "hsp-book-json-v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "app": "build_gita_canonical_json.py",
            "input": "vedicscriptures.github.io",
            "input_file": str(DEFAULT_INPUT),
            "supports_multiple_authors": True,
        },
        "schema": {
            "id": schema_id,
            "name": schema_name,
            "levels": levels,
        },
        "book": {
            "book_name": book_name,
            "book_code": book_code,
            "language_primary": "sanskrit",
            "variant_authors": variant_authors,
            "metadata": {
                "status": "draft",
                "visibility": "private",
                "source": "vedicscriptures.github.io",
                "source_attribution": "Vedic Scriptures",
                "supports_multiple_authors": True,
            },
        },
        "nodes": nodes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build canonical Bhagavad Gita import JSON with multiple authors.")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to raw JSON from fetch_gita_vedicscriptures.py")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output canonical JSON file path")
    parser.add_argument("--schema-id", type=int, default=1, help="Target schema id in HSP")
    parser.add_argument("--schema-name", default="Bhagavad Gita Standard", help="Schema display name")
    parser.add_argument("--book-name", default="Bhagavad Gita", help="Book name")
    parser.add_argument("--book-code", default="bhagavad-gita-vedicscriptures", help="Book code")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    raw = json.loads(input_path.read_text(encoding="utf-8"))
    payload = build_canonical_payload(
        raw=raw,
        schema_id=args.schema_id,
        schema_name=args.schema_name,
        levels=["Adhyaya", "Shloka"],
        book_name=args.book_name,
        book_code=args.book_code,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    chapter_count = sum(1 for n in payload["nodes"] if n["level_name"] == "Adhyaya")
    verse_count = sum(1 for n in payload["nodes"] if n["level_name"] == "Shloka")
    print(f"Wrote canonical import JSON: {output_path}")
    print(f"Chapters: {chapter_count}")
    print(f"Verses: {verse_count}")
    print(f"Total nodes: {len(payload['nodes'])}")


if __name__ == "__main__":
    main()
