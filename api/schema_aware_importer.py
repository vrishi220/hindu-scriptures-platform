"""
Schema-aware JSON importer for generic scripture structures.
Maps chapters/verses to dynamically configured schema levels with support for level_name_overrides.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


class SchemaAwareJSONImporter:
    """
    Imports scripture JSON with schema-based level mapping.
    
    Usage:
        config = SchemaAwarJSONImportConfig(
            book_name="Bhagavad Gita",
            book_code="bg",
            schema_id=1,
            json_source_url="file://external/bhagavad_gita_vedicscriptures_raw.json",
            chapters_key="chapters",
            verses_key="verses",
            chapter_level_name="Adhyaya",       # Can be overridden per-book
            verse_level_name="Shloka",
            text_field_mapping={...}
        )
        importer = SchemaAwareJSONImporter(config)
        ok, node_tree, warnings = importer.import_structure()
    """

    def __init__(
        self,
        book_name: str,
        book_code: str,
        schema_id: int,
        json_source_url: str,
        chapters_key: str = "chapters",
        verses_key: str = "verses",
        chapter_level_name: str = "Adhyaya",
        verse_level_name: str = "Shloka",
        chapter_num_key: str = "chapter_number",
        verse_num_key: str = "verse_number",
        text_field_mapping: Optional[Dict[str, str]] = None,
        level_name_overrides: Optional[Dict[str, str]] = None,
    ):
        """
        Args:
            book_name: Display name
            book_code: Unique code
            schema_id: FK to scripture_schemas
            json_source_url: file:// or http:// URL to JSON
            chapters_key: Key for chapters array in JSON
            verses_key: Key for verses array in chapter
            chapter_level_name: Level name for chapters (e.g., "Adhyaya", "Chapter")
            verse_level_name: Level name for verses (e.g., "Shloka", "Verse")
            chapter_num_key: JSON key for chapter number
            verse_num_key: JSON key for verse number
            text_field_mapping: Maps content_data.basic keys to JSON keys
                e.g. {"sanskrit": "slok", "translation": "translation"}
            level_name_overrides: Per-book overrides (same structure as DB level_name_overrides)
                e.g. {"0": "Adhyaya_Override", "1": "Shloka_Override"}
        """
        self.book_name = book_name
        self.book_code = book_code
        self.schema_id = schema_id
        self.json_source_url = json_source_url
        self.chapters_key = chapters_key
        self.verses_key = verses_key
        self.chapter_level_name = chapter_level_name
        self.verse_level_name = verse_level_name
        self.chapter_num_key = chapter_num_key
        self.verse_num_key = verse_num_key
        self.text_field_mapping = text_field_mapping or {
            "sanskrit": "slok",
            "transliteration": "transliteration",
            "translation": "translation",
        }
        self.level_name_overrides = level_name_overrides or {}
        self.data = None
        self.warnings: List[str] = []

    def _fetch_json(self) -> bool:
        """Load JSON from file or URL."""
        try:
            if self.json_source_url.startswith("file://"):
                path = self.json_source_url.replace("file://", "")
                with open(path, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            else:
                response = requests.get(self.json_source_url, timeout=30)
                response.raise_for_status()
                self.data = response.json()
            return True
        except Exception as e:
            self.warnings.append(f"Failed to fetch JSON: {e}")
            return False

    def _get_level_name(self, level_order: int, default: str) -> str:
        """Resolve level name, checking level_name_overrides first."""
        override_key = str(level_order)
        if override_key in self.level_name_overrides:
            return self.level_name_overrides[override_key]
        return default

    def _process_verse(
        self, verse_data: Dict[str, Any], chapter_num: int, verse_num: int
    ) -> Optional[Dict[str, Any]]:
        """Convert a verse JSON object to node structure."""
        if not verse_data:
            return None

        content_data = {"basic": {}}
        for content_key, json_key in self.text_field_mapping.items():
            if json_key in verse_data:
                content_data["basic"][content_key] = verse_data[json_key]

        return {
            "level_name": self._get_level_name(1, self.verse_level_name),
            "level_order": 1,
            "sequence_number": f"{chapter_num}.{verse_num}",
            "title_english": f"Verse {chapter_num}.{verse_num}",
            "title_transliteration": f"Verse {chapter_num}.{verse_num}",
            "title_sanskrit": verse_data.get("text", ""),
            "has_content": True,
            "content_data": content_data,
            "children": [],
        }

    def _process_chapter(
        self, chapter_data: Dict[str, Any], chapter_num: int
    ) -> Optional[Dict[str, Any]]:
        """Convert a chapter JSON object to node structure."""
        if not chapter_data:
            return None

        chapter_node = {
            "level_name": self._get_level_name(0, self.chapter_level_name),
            "level_order": 0,
            "sequence_number": str(chapter_num),
            "title_english": chapter_data.get("name", f"Chapter {chapter_num}"),
            "title_transliteration": chapter_data.get(
                "transliterated_name", f"Chapter {chapter_num}"
            ),
            "title_sanskrit": chapter_data.get("name_sanskrit", ""),
            "has_content": False,
            "content_data": {
                "basic": {
                    "summary": chapter_data.get("summary", ""),
                    "chapter_summary": chapter_data.get("chapter_summary", ""),
                }
            },
            "children": [],
        }

        # Process verses
        verses_list = chapter_data.get(self.verses_key, [])
        for idx, verse_data in enumerate(verses_list, start=1):
            verse_num = verse_data.get(self.verse_num_key, idx)
            verse_node = self._process_verse(verse_data, chapter_num, verse_num)
            if verse_node:
                chapter_node["children"].append(verse_node)

        return chapter_node

    def _extract_structure(self) -> Tuple[Optional[List[Dict[str, Any]]], List[str]]:
        """
        Extract hierarchical chapters->verses from JSON.
        Returns (chapters_list, warnings).
        """
        if not self.data:
            return None, ["No data loaded"]

        chapters_list = []
        warnings = list(self.warnings)

        # Handle different JSON structures
        if isinstance(self.data, dict):
            if self.chapters_key in self.data:
                chapters_data = self.data[self.chapters_key]
            else:
                chapters_data = self.data.values()
        elif isinstance(self.data, list):
            chapters_data = self.data
        else:
            return None, warnings + ["Unexpected JSON structure"]

        for chapter_data in chapters_data:
            chapter_num = chapter_data.get(self.chapter_num_key, 0)
            if not chapter_num:
                warnings.append(f"Skipping chapter without {self.chapter_num_key}")
                continue

            chapter_node = self._process_chapter(chapter_data, chapter_num)
            if chapter_node:
                chapters_list.append(chapter_node)

        return chapters_list, warnings

    def import_structure(self) -> Tuple[bool, Optional[List[Dict[str, Any]]], List[str]]:
        """
        Full import pipeline.
        Returns (success, node_tree, warnings).
        """
        if not self._fetch_json():
            return False, None, self.warnings

        chapters, warnings = self._extract_structure()
        if not chapters:
            return False, None, warnings

        return True, chapters, warnings

    def count_nodes(self, chapters: List[Dict[str, Any]]) -> int:
        """Count total nodes in tree."""
        count = 0
        for chapter in chapters:
            count += 1  # chapter itself
            count += len(chapter.get("children", []))  # verses
        return count
