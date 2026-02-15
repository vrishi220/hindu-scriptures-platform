"""
Generic importer for scripture documents from HTML/web sources.
Supports user-defined extraction rules for flexible document processing.
"""
import re
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup
import requests
from pydantic import BaseModel, Field


class FieldMapping(BaseModel):
    """Maps a target field to CSS selector and optional transformation."""
    selector: str
    attribute: Optional[str] = None  # For href, src, etc.
    selector_multiple: bool = False  # If true, combine multiple matches
    join_with: str = " "  # Join multiple matches with this


class LevelRule(BaseModel):
    """Extraction rule for a hierarchy level."""
    level_name: str
    selector: str  # CSS selector to find elements at this level
    sequence_number: Optional[str] = None  # Selector for sequence number
    fields: Dict[str, str] = {}  # Simple field -> selector mappings
    field_mappings: Optional[Dict[str, FieldMapping]] = None  # Advanced mappings
    has_content: bool = False
    content_mapping: Optional[Dict[str, str]] = None  # JSON path -> selector for content_data
    children: Optional[List["LevelRule"]] = None  # Nested levels


class ExtractionRules(BaseModel):
    """Collection of extraction rules for a document."""
    url: str
    format: str = "html"  # html, xml, json
    hierarchy: List[LevelRule]


class ImportConfig(BaseModel):
    """Full import configuration."""
    book_name: str
    book_code: Optional[str] = None
    schema_id: int
    language_primary: str = "sanskrit"
    license_type: str = "CC-BY-SA-4.0"
    source_attribution: Optional[str] = None
    original_source_url: Optional[str] = None
    extraction_rules: ExtractionRules


class GenericHTMLImporter:
    """
    Generic HTML scraper that uses extraction rules to build document trees.
    """

    def __init__(self, config: ImportConfig):
        self.config = config
        self.soup: Optional[BeautifulSoup] = None

    def fetch_and_parse(self) -> bool:
        """Fetch URL and parse HTML."""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (compatible; ScriptureImporter/1.0)"
            }
            response = requests.get(
                self.config.extraction_rules.url, headers=headers, timeout=10
            )
            response.raise_for_status()
            self.soup = BeautifulSoup(response.content, "html.parser")
            return True
        except Exception as e:
            print(f"Error fetching URL: {e}")
            return False

    def extract_value(self, element, mapping: Any) -> Optional[str]:
        """Extract a single value using mapping rules."""
        if isinstance(mapping, str):
            # Simple selector
            sub_elem = element.select_one(mapping)
            return sub_elem.get_text(strip=True) if sub_elem else None
        elif isinstance(mapping, FieldMapping):
            # Advanced mapping
            elements = element.select(mapping.selector)
            if not elements:
                return None
            if mapping.selector_multiple:
                values = [
                    e.get(mapping.attribute) if mapping.attribute else e.get_text(strip=True)
                    for e in elements
                ]
                return mapping.join_with.join(filter(None, values))
            else:
                elem = elements[0]
                if mapping.attribute:
                    return elem.get(mapping.attribute)
                else:
                    return elem.get_text(strip=True)
        return None

    def build_content_data(
        self, element, content_mapping: Dict[str, str]
    ) -> Dict[str, Any]:
        """Build content_data JSONB from selectors."""
        content = {}
        for json_path, selector in content_mapping.items():
            value = self.extract_value(element, selector)
            if value:
                # Parse json_path like "basic.sanskrit" -> nested dict
                keys = json_path.split(".")
                current = content
                for key in keys[:-1]:
                    if key not in current:
                        current[key] = {}
                    current = current[key]
                current[keys[-1]] = value
        return content

    def extract_nodes_at_level(
        self, parent_element: Optional[Any], rules: LevelRule
    ) -> List[Dict[str, Any]]:
        """Recursively extract nodes at a given level."""
        nodes = []
        
        # Find all elements matching this level's selector
        search_element = parent_element or self.soup
        if not search_element:
            return nodes

        elements = search_element.select(rules.selector)
        
        for idx, element in enumerate(elements):
            node = {
                "level_name": rules.level_name,
                "level_order": 0,  # Will be set by backend
                "title_english": None,
                "title_sanskrit": None,
                "title_hindi": None,
                "title_transliteration": None,
                "title_tamil": None,
                "has_content": rules.has_content,
                "content_data": {},
                "children": [],
            }

            # Extract sequence number
            if rules.sequence_number:
                seq_elem = element.select_one(rules.sequence_number)
                if seq_elem:
                    seq_text = seq_elem.get_text(strip=True)
                    # Try to extract number
                    match = re.search(r"\d+", seq_text)
                    node["sequence_number"] = int(match.group()) if match else idx + 1
            else:
                node["sequence_number"] = idx + 1

            # Extract simple fields
            for field_name, selector in (rules.fields or {}).items():
                value = self.extract_value(element, selector)
                if value and field_name.startswith("title_"):
                    node[field_name] = value

            # Extract advanced field mappings
            if rules.field_mappings:
                for field_name, mapping in rules.field_mappings.items():
                    value = self.extract_value(element, mapping)
                    if value and field_name.startswith("title_"):
                        node[field_name] = value

            # Extract content data
            if rules.has_content and rules.content_mapping:
                node["content_data"] = self.build_content_data(
                    element, rules.content_mapping
                )

            # Recursively extract children
            if rules.children:
                for child_rule in rules.children:
                    child_nodes = self.extract_nodes_at_level(element, child_rule)
                    node["children"].extend(child_nodes)

            nodes.append(node)

        return nodes

    def build_tree(self) -> List[Dict[str, Any]]:
        """Build complete node tree from extraction rules."""
        if not self.soup:
            return []

        root_level = self.config.extraction_rules.hierarchy[0]
        return self.extract_nodes_at_level(None, root_level)

    def flatten_tree(self, nodes: List[Dict], parent_id: Optional[int] = None) -> List[Dict]:
        """Flatten tree into flat list of nodes with parent_node_id."""
        flat = []
        for node in nodes:
            children = node.pop("children", [])
            node["parent_node_id"] = parent_id
            node["source_attribution"] = self.config.source_attribution
            node["license_type"] = self.config.license_type
            node["original_source_url"] = self.config.original_source_url
            flat.append(node)
            
            # Add children
            if children:
                flat.extend(self.flatten_tree(children, node.get("id")))
        
        return flat
