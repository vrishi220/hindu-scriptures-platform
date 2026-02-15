"""
Test script for the generic HTML importer.
Tests parsing and extraction from a simple test HTML structure.
"""
import sys
import json
from api.import_parser import (
    GenericHTMLImporter, 
    ImportConfig, 
    ExtractionRules, 
    LevelRule
)
from bs4 import BeautifulSoup

# Create a simple test HTML structure
TEST_HTML = """
<html>
<body>
<h2>Chapter 1: Arjuna's Dilemma</h2>
<p>This is the introduction to chapter 1.</p>
<p>1-1॥ Verse text for 1-1</p>
<p>1-2॥ Verse text for 1-2</p>

<h2>Chapter 2: The Yoga of Knowledge</h2>
<p>This is the introduction to chapter 2.</p>
<p>2-1॥ Verse text for 2-1</p>
<p>2-2॥ Verse text for 2-2</p>
</body>
</html>
"""

# Test configuration with actual HTML
TEST_CONFIG = ImportConfig(
    book_name="Test Gita",
    book_code="test-gita",
    schema_id=1,
    language_primary="sanskrit",
    source_attribution="Test Source",
    original_source_url="https://example.com/test",
    extraction_rules=ExtractionRules(
        url="https://example.com/test",  # Won't be used in this test
        format="html",
        hierarchy=[
            LevelRule(
                level_name="Chapter",
                selector="h2",
                sequence_number="",
                fields={
                    "title_english": "h2",
                },
                has_content=False,
                children=[
                    LevelRule(
                        level_name="Verse",
                        selector="p",
                        sequence_number="",
                        fields={
                            "title_transliteration": "p",
                        },
                        has_content=True,
                        content_mapping={
                            "basic.text": "p",
                        },
                    )
                ],
            )
        ],
    ),
)

def test_import_with_html():
    """Test the import process with test HTML."""
    print("Starting import test with test HTML...\n")
    
    importer = GenericHTMLImporter(TEST_CONFIG)
    
    # Parse test HTML directly
    importer.soup = BeautifulSoup(TEST_HTML, "html.parser")
    
    if not importer.soup:
        print("ERROR: Failed to parse HTML")
        return False
    
    print("✓ HTML parsed successfully")
    
    # Extract tree
    print("Extracting tree...")
    tree = importer.build_tree()
    
    if not tree:
        print("ERROR: No nodes extracted")
        return False
    
    print(f"✓ Extracted {len(tree)} chapters\n")
    
    # Print structure
    for i, chapter in enumerate(tree, 1):
        print(f"Chapter {i}: {chapter.get('title_english', 'N/A')}")
        for verse in chapter.get('children', []):
            print(f"  - Verse: {verse.get('title_transliteration', 'N/A')[:40]}")
    
    # Test flattening
    flat = importer.flatten_tree(tree)
    print(f"\n✓ Flattened to {len(flat)} total nodes")
    
    return True

if __name__ == "__main__":
    success = test_import_with_html()
    print(f"\nTest result: {'PASSED ✓' if success else 'FAILED ✗'}")
    sys.exit(0 if success else 1)

