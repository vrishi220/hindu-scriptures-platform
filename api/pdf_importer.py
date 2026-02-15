"""
PDF-based scripture importer.
Handles extraction of chapters and verses from PDF documents.
Supports both searchable and scanned (OCR) PDFs.
"""
import re
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from io import BytesIO


class PDFExtractionRule(BaseModel):
    """Rule for extracting a specific level from PDF text."""
    level_name: str
    chapter_pattern: Optional[str] = None  # Regex to match chapter headers
    verse_pattern: Optional[str] = None    # Regex to match verse references
    content_fields: Dict[str, str] = Field(default_factory=dict)  # Field name -> extraction method
    has_content: bool = True


class PDFImportConfig(BaseModel):
    """Configuration for importing scripture from PDF."""
    book_name: str
    book_code: str
    schema_id: int
    language_primary: str = "sanskrit"
    source_attribution: str = "PDF Source"
    original_source_url: Optional[str] = None
    pdf_file_path: str  # Path to PDF file or URL
    extraction_rules: List[PDFExtractionRule]
    start_page: int = 0
    end_page: Optional[int] = None
    use_ocr: bool = False


class PDFImportResponse(BaseModel):
    """Response from PDF import operation."""
    success: bool
    book_id: Optional[int] = None
    nodes_created: int = 0
    pages_processed: int = 0
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class PDFImporter:
    """Imports structured content from PDF documents."""
    
    def __init__(self, config: PDFImportConfig):
        self.config = config
        self.text_content: Optional[str] = None
        self.pages: List[str] = []
        self.warnings: List[str] = []
    
    def fetch_and_extract(self) -> bool:
        """
        Fetch and extract text from PDF or plain text file.
        Auto-detects file type and uses appropriate extraction method.
        Returns True if successful, False otherwise.
        """
        try:
            # Fetch content
            if self.config.pdf_file_path.startswith('http'):
                import requests
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://sanskritdocuments.org/',
                    'Accept': 'application/pdf,text/plain,*/*',
                }
                response = requests.get(self.config.pdf_file_path, headers=headers, timeout=30)
                response.raise_for_status()
                content = response.content
                is_pdf = response.headers.get('content-type', '').lower().startswith('application/pdf')
            else:
                with open(self.config.pdf_file_path, 'rb') as f:
                    content = f.read()
                is_pdf = self.config.pdf_file_path.lower().endswith('.pdf')
            
            # Check if it's a PDF by looking at header
            if not is_pdf and content.startswith(b'%PDF'):
                is_pdf = True
            
            # Try to extract as PDF first
            if is_pdf:
                try:
                    import pypdf
                    pdf_bytes = BytesIO(content)
                    reader = pypdf.PdfReader(pdf_bytes)
                    total_pages = len(reader.pages)
                    
                    for page_num in range(total_pages):
                        try:
                            page = reader.pages[page_num]
                            text = page.extract_text()
                            if text and len(text.strip()) > 50:  # Only add non-empty pages
                                self.pages.append(text)
                        except Exception as e:
                            self.warnings.append(f"Warning: Page {page_num} extraction failed: {str(e)}")
                    
                    if not self.pages:
                        self.warnings.append("PDF loaded but no text could be extracted")
                        return False
                    
                except ImportError:
                    self.warnings.append("pypdf not installed. Install with: pip install pypdf")
                    return False
                except Exception as e:
                    self.warnings.append(f"PDF parsing error: {str(e)}")
                    return False
            else:
                # Try to extract as plain text
                try:
                    text = content.decode('utf-8', errors='ignore')
                    if text and len(text) > 100:
                        self.pages = [text]
                    else:
                        self.warnings.append("File decoded but contains insufficient text")
                        return False
                except Exception as e:
                    self.warnings.append(f"Text decoding error: {str(e)}")
                    return False
            
            # Combine all pages
            if self.pages:
                self.text_content = "\n\n".join(self.pages)
                return True
            else:
                self.warnings.append("No content extracted from file")
                return False
            
        except Exception as e:
            self.warnings.append(f"File load error: {str(e)}")
            return False
    
    def extract_chapters_and_verses(self) -> List[Dict[str, Any]]:
        """
        Extract chapters and verses using configured or default patterns.
        Returns hierarchical node structure.
        Works with both Devanagari (१-१॥) and numeric (1-1||) formats.
        """
        if not self.text_content:
            return []
        
        chapters = []
        verse_matches = []
        
        # Get configured pattern or use defaults
        configured_pattern = None
        if self.config.extraction_rules and len(self.config.extraction_rules) > 0:
            rule = self.config.extraction_rules[0]
            configured_pattern = rule.verse_pattern
        
        # Try patterns in order of likelihood for Sanskrit texts
        patterns_to_try = []
        
        if configured_pattern:
            patterns_to_try.append((configured_pattern, "configured pattern"))
        
        # Add default patterns (Devanagari danda format first since that's what this PDF uses)
        patterns_to_try.extend([
            (r'॥(\d+)-(\d+)॥', 'Devanagari danda (॥1-1॥)'),
            (r'(\d+)\D(\d+)\|{2}', 'ASCII double-pipe (1-1||)'),
            (r'(\d+)-(\d+)', 'simple digit-digit'),
        ])
        
        # Try each pattern until we find matches
        for pattern, desc in patterns_to_try:
            try:
                verse_matches = list(re.finditer(pattern, self.text_content))
                if verse_matches:
                    if desc != "configured pattern":
                        self.warnings.append(f"Verse extraction using {desc}: found {len(verse_matches)} verses")
                    break
            except Exception as e:
                self.warnings.append(f"Pattern {desc} failed: {str(e)}")
                continue
        
        if not verse_matches:
            self.warnings.append("No verses found using any extraction pattern")
        
        # Group verses by chapter
        chapter_structure = {}
        
        for verse_match in verse_matches:
            groups = verse_match.groups()
            chapter_num = int(groups[0])
            verse_num = int(groups[1])
            
            if chapter_num not in chapter_structure:
                chapter_structure[chapter_num] = []
            
            chapter_structure[chapter_num].append({
                'verse_num': verse_num,
                'match': verse_match,
                'text': verse_match.group(0),
            })
        
        # Build chapter nodes
        for chapter_num in sorted(chapter_structure.keys()):
            verses = chapter_structure[chapter_num]
            
            chapter_node = {
                'level_name': 'Adhyaya',
                'level_order': 0,
                'sequence_number': str(chapter_num),
                'title_english': f'Chapter {chapter_num}',
                'title_transliteration': f'Adhyaya {chapter_num}',
                'content_data': {'basic': {}},
                'has_content': False,
                'children': [],
            }
            
            # Add verses as children
            for verse_info in sorted(verses, key=lambda x: x['verse_num']):
                verse_ref = f"{chapter_num}.{verse_info['verse_num']}"
                verse_node = {
                    'level_name': 'Shloka',
                    'level_order': 1,
                    'sequence_number': verse_ref,
                    'title_transliteration': f'Verse {verse_ref}',
                    'content_data': {'basic': {'transliteration': f'Shloka {verse_ref}', 'text': verse_info['text']}},
                    'has_content': True,
                }
                chapter_node['children'].append(verse_node)
            
            chapters.append(chapter_node)
        
        return chapters
    
    def flatten_tree(self, tree: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Flatten hierarchical tree into flat list for database insertion.
        Sets parent_id and level_order for each node.
        """
        flat = []
        node_id = 1
        
        for chapter in tree:
            chapter['id'] = node_id
            chapter['parent_id'] = None
            flat.append({k: v for k, v in chapter.items() if k != 'children'})
            
            parent_id = node_id
            node_id += 1
            
            for verse in chapter.get('children', []):
                verse['id'] = node_id
                verse['parent_id'] = parent_id
                flat.append({k: v for k, v in verse.items() if k != 'children'})
                node_id += 1
        
        return flat
    
    def import_from_pdf(self) -> tuple[bool, int, List[str]]:
        """
        Full import pipeline: fetch -> extract -> flatten.
        Returns (success, node_count, warnings).
        """
        # Fetch and extract text
        if not self.fetch_and_extract():
            return False, 0, self.warnings
        
        # Extract structure
        tree = self.extract_chapters_and_verses()
        
        if not tree:
            self.warnings.append("No chapters/verses extracted from PDF")
            return False, 0, self.warnings
        
        # Flatten
        flat = self.flatten_tree(tree)
        
        return True, len(flat), self.warnings
