#!/usr/bin/env python3
"""
Import Bhagavad Gita into the system using the API endpoint.

Workflow:
  1. Run fetch_gita_vedicscriptures.py to create external/bhagavad_gita_vedicscriptures_raw.json
  2. Create a book with a schema (e.g., 2-Level: Adhyaya, Shloka)
  3. Run this script to import via the DB endpoint
  4. Optionally pass book_id and server URL to update an existing book
"""

import json
import sys
from pathlib import Path

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from api.schema_aware_importer import SchemaAwareJSONImporter


def import_gita_to_db(
    book_id: int,
    json_source: str = "file://external/bhagavad_gita_vedicscriptures_raw.json",
    clear_existing: bool = False,
):
    """
    Import Gita to a specific book via tree import endpoint.
    
    Args:
        book_id: Database book ID to import into
        json_source: Path to JSON file (file:// or http://)
        clear_existing: Clear existing nodes before import
    """
    print(f"Importing Bhagavad Gita into book {book_id}...", file=sys.stderr)
    
    # 1. Validate the JSON structure locally
    importer = SchemaAwareJSONImporter(
        book_name="Bhagavad Gita",
        book_code="bhagavad-gita-vedicscriptures",
        schema_id=5,
        json_source_url=json_source,
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

    success, chapters, warnings = importer.import_structure()

    if warnings:
        print(f"⚠ Warnings during validation ({len(warnings)}):", file=sys.stderr)
        for w in warnings[:5]:
            print(f"  - {w}", file=sys.stderr)
        if len(warnings) > 5:
            print(f"  ... and {len(warnings) - 5} more", file=sys.stderr)

    if not success or not chapters:
        print("✗ Import validation failed", file=sys.stderr)
        sys.exit(1)

    total_nodes = importer.count_nodes(chapters)
    total_chapters = len(chapters)
    total_verses = sum(len(ch.get("children", [])) for ch in chapters)

    print(f"✓ Validation successful", file=sys.stderr)
    print(f"  Chapters: {total_chapters}", file=sys.stderr)
    print(f"  Verses: {total_verses}", file=sys.stderr)
    print(f"  Total nodes: {total_nodes}", file=sys.stderr)

    # 2. Prepare payload for tree import endpoint
    payload = {
        "book_id": book_id,
        "nodes": chapters,
        "clear_existing": clear_existing,
        "language_code": "en",
        "license_type": "CC-BY-SA-4.0"
    }

    # 3. Output payload to JSON for inspection or API call
    output_file = Path(__file__).parent / "external" / "bhagavad_gita_import_payload.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"✓ Import payload prepared", file=sys.stderr)
    print(f"  Saved to {output_file}", file=sys.stderr)
    print(f"\nTo import via API, POST this payload to:", file=sys.stderr)
    print(f"  POST /api/content/books/{book_id}/import-tree", file=sys.stderr)
    print(f"  With Authorization header and Content-Type: application/json", file=sys.stderr)
    
    # 4. Optionally output just the chapter count for scripting
    result = {
        "success": True,
        "chapters_to_import": total_chapters,
        "verses_to_import": total_verses,
        "total_nodes_to_import": total_nodes,
        "import_payload_file": str(output_file)
    }
    print(json.dumps(result, indent=2))


def main():
    """Main CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: import_gita_vedicscriptures.py <book_id> [json_source] [--clear]", file=sys.stderr)
        print("\nExample:", file=sys.stderr)
        print("  python import_gita_vedicscriptures.py 123", file=sys.stderr)
        print("  python import_gita_vedicscriptures.py 123 file://external/bhagavad_gita_vedicscriptures_raw.json --clear", file=sys.stderr)
        sys.exit(1)
    
    book_id = int(sys.argv[1])
    json_source = sys.argv[2] if len(sys.argv) > 2 else "file://external/bhagavad_gita_vedicscriptures_raw.json"
    clear_existing = "--clear" in sys.argv
    
    import_gita_to_db(book_id, json_source, clear_existing)


if __name__ == "__main__":
    main()
