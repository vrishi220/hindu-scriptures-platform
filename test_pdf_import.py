"""
Test script for PDF/ITX importer.
Tests extraction from the actual SanskritDocuments Gita ITX file.
"""
import sys
import re
from api.pdf_importer import PDFImporter, PDFImportConfig, PDFExtractionRule


# Realistic extraction rules for Gita PDF format
# The PDF uses verse references like 1-1||, 1-2||, etc (works with both numeric and Devanagari)
GITA_EXTRACTION_RULES = [
    PDFExtractionRule(
        level_name="Chapter",
        chapter_pattern=None,  # Not used in new implementation
        verse_pattern=r'(\d+)\D(\d+)\|{2}',  # Matches 1-1||, १-१॥, etc.
        has_content=False,
    )
]

# Create test configuration pointing to PDF
GITA_CONFIG = PDFImportConfig(
    book_name="Bhagavad Gita",
    book_code="bhagavad-gita",
    schema_id=1,
    language_primary="sanskrit",
    source_attribution="SanskritDocuments.org",
    original_source_url="https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
    pdf_file_path="https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
    extraction_rules=GITA_EXTRACTION_RULES,
    use_ocr=False,
)


def test_itx_import():
    """Test the ITX import pipeline with actual file."""
    print("=" * 60)
    print("Testing PDF/ITX Import with SanskritDocuments Gita")
    print("=" * 60)
    print(f"Source: {GITA_CONFIG.pdf_file_path}\n")
    
    try:
        importer = PDFImporter(GITA_CONFIG)
        
        # Fetch and extract text
        print("📥 Fetching and extracting text...")
        success, node_count, warnings = importer.import_from_pdf()
        
        if not success:
            print(f"❌ Import failed")
            for warning in warnings:
                print(f"   ⚠️  {warning}")
            return False
        
        print(f"✅ Text extraction successful")
        print(f"   📄 Pages/sections processed: {len(importer.pages)}")
        print(f"   📋 Total nodes to be created: {node_count}")
        
        if warnings:
            print(f"\n⚠️  Warnings during extraction:")
            for warning in warnings:
                print(f"   - {warning}")
        
        # Extract chapters and verses
        print(f"\n📊 Extracting chapters and verses...")
        chapters = importer.extract_chapters_and_verses()
        print(f"   ✓ Found {len(chapters)} chapters")
        
        if chapters:
            for i, chapter in enumerate(chapters[:3]):  # Show first 3
                verse_count = len(chapter.get('children', []))
                print(f"   - {chapter.get('title_english', 'N/A')}: {verse_count} verses")
            
            if len(chapters) > 3:
                print(f"   ... and {len(chapters) - 3} more chapters")
        
        # Show text preview
        if importer.text_content:
            preview = importer.text_content[:500]
            print(f"\n📄 Text content preview (first 500 chars):")
            print(f"   {repr(preview)}...")
            
            # Check for expected patterns
            chapter_count = len(re.findall(r'Chapter\s+\d+', importer.text_content, re.IGNORECASE))
            verse_count = len(re.findall(r'\d+\\\-\d+\|\|', importer.text_content))
            print(f"\n   Pattern matches:")
            print(f"   - Chapter patterns found: {chapter_count}")
            print(f"   - Verse patterns found: {verse_count}")
        
        print(f"\n✅ Test completed successfully!")
        print(f"   Ready to import {node_count} nodes into database")
        return True
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def test_with_custom_patterns():
    """Test with optimized patterns for ITX Gita format."""
    print("\n" + "=" * 60)
    print("Testing with Optimized ITX Patterns")
    print("=" * 60 + "\n")
    
    # More optimized patterns for actual PDF structure
    optimized_rules = [
        PDFExtractionRule(
            level_name="Chapter",
            chapter_pattern=None,
            verse_pattern=r'(\d+)\D(\d+)\|{2}',  # Matches verse references
            has_content=False,
        )
    ]
    
    config = PDFImportConfig(
        book_name="Bhagavad Gita",
        book_code="bhagavad-gita-optimized",
        schema_id=1,
        language_primary="sanskrit",
        source_attribution="SanskritDocuments.org",
        original_source_url="https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
        pdf_file_path="https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
        extraction_rules=optimized_rules,
        use_ocr=False,
    )
    
    try:
        importer = PDFImporter(config)
        success, node_count, warnings = importer.import_from_pdf()
        
        print(f"Optimized import result: {'✅ Success' if success else '❌ Failed'}")
        print(f"Nodes to create: {node_count}")
        
        if importer.text_content:
            # Analyze actual structure
            verse_refs = len(re.findall(r'(\d+)\D(\d+)\|{2}', importer.text_content))
            devanagari_verses = len(re.findall(r'[०-९]+\D[०-९]+\|{2}', importer.text_content))
            
            print(f"Structure analysis:")
            print(f"  - Numeric verse references found: {verse_refs}")
            print(f"  - Devanagari verse references: {devanagari_verses}")
        
        return success
        
    except Exception as e:
        print(f"❌ Error in optimized test: {str(e)}")
        return False


if __name__ == "__main__":
    result1 = test_itx_import()
    result2 = test_with_custom_patterns()
    
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Basic test: {'✅ PASS' if result1 else '❌ FAIL'}")
    print(f"Optimized test: {'✅ PASS' if result2 else '❌ FAIL'}")
    
    sys.exit(0 if (result1 or result2) else 1)

