"""
Debug script to analyze PDF structure and patterns.
"""
import requests
from io import BytesIO

# Fetch PDF
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://sanskritdocuments.org/',
}

print("Downloading PDF from SanskritDocuments...\n")
response = requests.get(
    "https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
    headers=headers,
    timeout=30
)

# Try pypdf extraction
try:
    import pypdf
    pdf_bytes = BytesIO(response.content)
    reader = pypdf.PdfReader(pdf_bytes)
    
    print(f"✅ PDF loaded successfully")
    print(f"Total pages: {len(reader.pages)}\n")
    
    # Extract and analyze first few pages
    for page_num in range(min(5, len(reader.pages))):
        page = reader.pages[page_num]
        text = page.extract_text()
        
        if text:
            print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            print(f"PAGE {page_num + 1}")
            print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            # Show first 800 chars
            preview = text[:800]
            print(preview)
            print(f"... (total {len(text)} chars)\n")
        else:
            print(f"PAGE {page_num + 1}: [No extractable text]\n")
    
    # Analyze patterns
    print("\n" + "="*60)
    print("PATTERN ANALYSIS")
    print("="*60)
    
    all_text = ""
    for page_num in range(len(reader.pages)):
        page = reader.pages[page_num]
        text = page.extract_text()
        if text:
            all_text += text + "\n"
    
    import re
    
    # Look for common patterns
    chapter_patterns = [
        (r'Chapter\s+(\d+)', 'Chapter N'),
        (r'CHAPTER\s+(\d+)', 'CHAPTER N'),
        (r'Ch[ap]*\s+(\d+)', 'Ch N'),
        (r'([0-9]+)\.\s+', 'N. (verse-like)'),
        (r'(\d+):(\d+)', 'N:N (format)'),
        (r'Verse\s+(\d+)', 'Verse N'),
    ]
    
    for pattern, desc in chapter_patterns:
        matches = re.findall(pattern, all_text, re.IGNORECASE)
        if matches:
            print(f"\n✓ Pattern '{desc}' found: {len(matches)} matches")
            print(f"  Examples: {matches[:5]}")
    
    # Look for section breaks
    print(f"\n📊 Common line starters:")
    lines = all_text.split('\n')[:200]
    for line in lines[:20]:
        if line.strip() and len(line.strip()) > 10:
            print(f"  '{line.strip()[:70]}'")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
