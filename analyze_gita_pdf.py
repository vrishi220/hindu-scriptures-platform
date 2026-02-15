from pypdf import PdfReader
import requests
from io import BytesIO
import re

url = 'https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf'
print("Downloading PDF...")
response = requests.get(url)
pdf = PdfReader(BytesIO(response.content))

print(f'\nTotal pages: {len(pdf.pages)}')
print('\n--- First 3 pages sample ---')
for i in range(min(3, len(pdf.pages))):
    text = pdf.pages[i].extract_text()
    print(f'\n=== PAGE {i+1} (first 800 chars) ===')
    print(text[:800])
    
print('\n--- Extracting all text ---')
all_text = ''
for page in pdf.pages:
    all_text += page.extract_text() + '\n'

print(f'\nTotal text length: {len(all_text)} characters')

# Look for different patterns
print('\n--- Searching for chapter/verse markers ---')
chapter_patterns = [
    (r'अध्याय', 'अध्याय (adhyaya - Sanskrit word for chapter)'),
    (r'Chapter', 'Chapter (English)'),
    (r'॥[^॥]+॥', 'Text between double dandas'),
    (r'॥\d+-\d+॥', 'Verse references ॥chapter-verse॥'),
    (r'^\d+\.\d+', 'Verse numbers at line start (1.1, 1.2, etc)'),
]

for pattern, desc in chapter_patterns:
    matches = re.findall(pattern, all_text, re.MULTILINE)
    print(f'\n{desc}: {len(matches)} matches total')
    if matches and len(matches) < 50:
        print(f'  All matches: {matches}')
    elif matches:
        print(f'  First 10: {matches[:10]}')
        print(f'  Last 10: {matches[-10:]}')

# Check for continuous Sanskrit text
print('\n--- Sanskrit text analysis ---')
devanagari_chars = len(re.findall(r'[\u0900-\u097F]', all_text))
print(f'Devanagari characters: {devanagari_chars}')
print(f'Percentage of Devanagari: {devanagari_chars/len(all_text)*100:.1f}%')

# Search for typical verse structure
print('\n--- Looking for verse structure patterns ---')
lines = all_text.split('\n')
sanskrit_lines = [line for line in lines if re.search(r'[\u0900-\u097F]{10,}', line)]
print(f'Lines with substantial Sanskrit text: {len(sanskrit_lines)}')
print(f'Sample lines:')
for line in sanskrit_lines[:10]:
    print(f'  {line[:100]}')
