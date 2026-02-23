"""
JSON-based scripture importer.
Handles importing scripture content from JSON/API sources.
"""
import requests
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field


class JSONImportConfig(BaseModel):
    """Configuration for importing scripture from JSON source."""
    book_name: str
    book_code: str
    schema_id: int
    language_primary: Literal["sanskrit", "english"] = "sanskrit"
    source_attribution: str
    original_source_url: Optional[str] = None
    json_source_url: str  # URL to fetch JSON data from
    json_source_type: str = "api"  # 'api' or 'file'
    
    # Mapping configuration for flexible JSON structures
    chapter_key: str = "chapter"  # Key for chapter number
    verse_key: str = "verse"  # Key for verse number  
    text_fields: Dict[str, str] = Field(default_factory=lambda: {
        "sanskrit": "slok",
        "transliteration": "transliteration",
        "wordMeanings": "word_meanings",
        "translation": "translation"
    })


class JSONImporter:
    """Imports structured content from JSON sources."""
    
    def __init__(self, config: JSONImportConfig):
        self.config = config
        self.data = None
        self.warnings: List[str] = []
    
    def fetch_data(self) -> bool:
        """Fetch JSON data from configured source."""
        try:
            if self.config.json_source_type == "api":
                response = requests.get(self.config.json_source_url, timeout=30)
                response.raise_for_status()
                self.data = response.json()
            else:
                # For file-based sources
                with open(self.config.json_source_url, 'r', encoding='utf-8') as f:
                    import json
                    self.data = json.load(f)
            
            return True
        except Exception as e:
            self.warnings.append(f"Failed to fetch data: {str(e)}")
            return False
    
    def extract_structure(self) -> List[Dict[str, Any]]:
        """
        Extract hierarchical structure from JSON data.
        Expected structure: List of chapters, each with verses.
        """
        if not self.data:
            return []
        
        chapters = []
        
        # Handle different JSON structures
        if isinstance(self.data, list):
            # Structure: [{chapter: 1, verses: [...]}, ...]
            for chapter_data in self.data:
                chapter = self._process_chapter(chapter_data)
                if chapter:
                    chapters.append(chapter)
        elif isinstance(self.data, dict):
            # Structure: {chapters: [...]} or {1: {...}, 2: {...}}
            if "chapters" in self.data:
                for chapter_data in self.data["chapters"]:
                    chapter = self._process_chapter(chapter_data)
                    if chapter:
                        chapters.append(chapter)
            else:
                # Assume keys are chapter numbers
                for chapter_num in sorted([int(k) for k in self.data.keys() if k.isdigit()]):
                    chapter_data = self.data[str(chapter_num)]
                    chapter = self._process_chapter(chapter_data, chapter_num)
                    if chapter:
                        chapters.append(chapter)
        
        return chapters
    
    def _process_chapter(self, chapter_data: Dict, chapter_num: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Process a single chapter from JSON data."""
        # Get chapter number
        if chapter_num is None:
            chapter_num = chapter_data.get(self.config.chapter_key, chapter_data.get("chapter_number", 0))
        
        if not chapter_num:
            return None
        
        # Build chapter node
        chapter_node = {
            'level_name': 'Adhyaya',
            'level_order': 0,
            'sequence_number': str(chapter_num),
            'title_english': chapter_data.get('name', f'Chapter {chapter_num}'),
            'title_transliteration': chapter_data.get('transliterated_name', f'Adhyaya {chapter_num}'),
            'title_sanskrit': chapter_data.get('name_sanskrit', None),
            'content_data': {
                'basic': {
                    'summary': chapter_data.get('summary', ''),
                    'chapter_meaning': chapter_data.get('meaning', '')
                }
            },
            'has_content': False,
            'children': [],
        }
        
        # Process verses
        verses = chapter_data.get('verses', chapter_data.get('slokas', []))
        for verse_data in verses:
            verse = self._process_verse(verse_data, chapter_num)
            if verse:
                chapter_node['children'].append(verse)
        
        return chapter_node
    
    def _process_verse(self, verse_data: Dict, chapter_num: int) -> Optional[Dict[str, Any]]:
        """Process a single verse from JSON data."""
        verse_num = verse_data.get(self.config.verse_key, verse_data.get("verse_number", 0))
        
        if not verse_num:
            return None
        
        # Extract text fields based on configuration
        content_data = {'basic': {}}
        
        for content_key, json_key in self.config.text_fields.items():
            if json_key in verse_data:
                content_data['basic'][content_key] = verse_data[json_key]
        
        # Build verse node
        verse_node = {
            'level_name': 'Shloka',
            'level_order': 1,
            'sequence_number': f'{chapter_num}.{verse_num}',
            'title_transliteration': f'Verse {chapter_num}.{verse_num}',
            'title_sanskrit': verse_data.get('slok', verse_data.get('text', '')),
            'content_data': content_data,
            'has_content': True,
        }
        
        return verse_node
    
    def import_from_json(self) -> tuple[bool, int, List[str]]:
        """
        Full import pipeline: fetch -> extract.
        Returns (success, node_count, warnings).
        """
        if not self.fetch_data():
            return False, 0, self.warnings
        
        structure = self.extract_structure()
        
        if not structure:
            self.warnings.append("No content extracted from JSON")
            return False, 0, self.warnings
        
        # Count total nodes
        node_count = len(structure)
        for chapter in structure:
            node_count += len(chapter.get('children', []))
        
        return True, node_count, self.warnings
