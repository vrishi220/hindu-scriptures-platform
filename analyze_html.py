#!/usr/bin/env python3
import requests
from bs4 import BeautifulSoup

url = "https://sanskritdocuments.org/doc_giitaa/bhagvadnew.html"
response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
soup = BeautifulSoup(response.content, "html.parser")

print("=== ACTUAL HTML STRUCTURE ===\n")

# Check for common containers
print("1. Looking for chapter/adhyaya markers:")
h2s = soup.find_all("h2")
if h2s:
    print(f"   Found {len(h2s)} h2 headers")
    for h2 in h2s[:3]:
        print(f"     - {h2.get_text()[:60]}")

# Check all unique element types with content
print("\n2. All elements with text content (top 30):")
elements = []
for elem in soup.find_all(True):
    text = elem.get_text(strip=True)
    if text and len(text) > 5:
        class_str = ' '.join(elem.get('class', []))
        elements.append((elem.name, class_str, text[:40]))

for name, classes, text in sorted(set(elements))[:30]:
    if classes:
        print(f"   <{name} class=\"{classes}\">: {text}")
    else:
        print(f"   <{name}>: {text}")

# Check for verse references (shloka numbers)
print("\n3. Looking for verse/shloka patterns:")
import re
for elem in soup.find_all(True):
    text = elem.get_text()
    if re.search(r'[०-९]+-[०-९]+', text):  # Devanagari numbers with dash
        print(f"   <{elem.name} class=\"{' '.join(elem.get('class', []))}\">{text[:50]}")
        break

# Save sample HTML
print("\n4. First 2000 chars of HTML:")
print(response.text[:2000])
