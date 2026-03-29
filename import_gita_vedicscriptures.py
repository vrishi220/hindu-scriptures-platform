#!/usr/bin/env python3
"""
Import Bhagavad Gita into the system using the schema-aware importer.

Workflow:
  1. run fetch_gita_vedicscriptures.py to create external/bhagavad_gita_vedicscriptures_raw.json
  2. Create a book with a schema (e.g., 3-Level: Book, Chapter, Verse)
  3. Run this script to import and validate structure before actual DB write
  4. Iterate: modify mappings/schema and re-run until happy
"""

import json
import sys
from pathlib import Path

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.schema_aware_importer import SchemaAwareJSONImporter


def main():
    importer = SchemaAwareJSONImporter(
        book_name="Bhagavad Gita",
        book_code="bhagavad-gita-vedicscriptures",
        schema_id=5,  # Assumes a schema exists; adjust as needed
        json_source_url="file://external/bhagavad_gita_vedicscriptures_raw.json",
        chapters_key="chapters",
        verses_key="verses",
        chapter_level_name="Adhyaya",
        verse_level_name="Shloka",
        chapter_num_key="chapter_number",
        verse_num_key="verse_number",
        text_field_mapping={
            "sanskrit": "text",
            "transliteration": "transliteration",
            "translation": "en",
        },
    )

    print("Importing Bhagavad Gita structure...", file=sys.stderr)
    success, chapters, warnings = importer.import_structure()

    if warnings:
        print(f"⚠ Warnings ({len(warnings)}):", file=sys.stderr)
        for w in warnings[:10]:
            print(f"  - {w}", file=sys.stderr)
        if len(warnings) > 10:
            print(f"  ... and {len(warnings) - 10} more", file=sys.stderr)

    if not success or not chapters:
        print("✗ Import failed", file=sys.stderr)
        sys.exit(1)

    total_nodes = importer.count_nodes(chapters)
    total_chapters = len(chapters)
    total_verses = sum(len(ch.get("children", [])) for ch in chapters)

    print(f"✓ Import successful", file=sys.stderr)
    print(f"  Chapters: {total_chapters}", file=sys.stderr)
    print(f"  Verses: {total_verses}", file=sys.stderr)
    print(f"  Total nodes: {total_nodes}", file=sys.stderr)

    # Write intermediate structure to file for inspection
    output_file = Path(__file__).parent.parent / "external" / "bhagavad_gita_import_structure.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(chapters, f, ensure_ascii=False, indent=2)

    print(f"  Saved structure to {output_file}", file=sys.stderr)

    # Print first chapter/verse as sample
    if chapters and chapters[0].get("children"):
        first_verse = chapters[0]["children"][0]
        print(f"\nSample verse structure:", file=sys.stderr)
        print(f"  Chapter: {chapters[0]['sequence_number']}", file=sys.stderr)
        print(f"  Verse: {first_verse['sequence_number']}", file=sys.stderr)
        print(
            f"  Sanskrit: {first_verse.get('content_data', {}).get('basic', {}).get('sanskrit', 'N/A')[:50]}...",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
