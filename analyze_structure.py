#!/usr/bin/env python3
import requests
from bs4 import BeautifulSoup
import re

url = "https://sanskritdocuments.org/doc_giitaa/bhagvadnew.html"
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://sanskritdocuments.org/"
}

print("Fetching page...")
response = requests.get(url, headers=headers, timeout=10)
soup = BeautifulSoup(response.content, "html.parser")

print("\n=== CHAPTER STRUCTURE ===")
h2_count = 0
for h2 in soup.find_all("h2"):
    text = h2.get_text()
    if "अध्यायः" in text:
        h2_count += 1
        print(f"Ch {h2_count}: {text[:70]}")
    if h2_count >= 3:
        break

print(f"\nTotal h2 headers: {len(soup.find_all('h2'))}")
print(f"Total p tags: {len(soup.find_all('p'))}")
print(f"Total span tags: {len(soup.find_all('span'))}")

print("\n=== SAMPLE VERSES (shloka patterns) ===")
found = 0
for tag in ["p", "span", "div"]:
    for elem in soup.find_all(tag):
        text = elem.get_text()
        if re.search(r'[०-९]+-[०-९]+॥', text):
            print(f"<{tag} class=\"{' '.join(elem.get('class', []))}\">{text[:80]}")
            found += 1
            if found >= 3:
                break
    if found >= 3:
        break

print("\n=== FINDING PARENT CONTAINERS ===")
# Find a verse and trace its parent
for p in soup.find_all("p"):
    if re.search(r'[०-९]+-[०-९]+॥', p.get_text()):
        print(f"Verse found in <p>: {p.get_text()[:60]}")
        print(f"  Parent: <{p.parent.name}>")
        print(f"  Parent classes: {p.parent.get('class', [])}")
        print(f"  Grandparent: <{p.parent.parent.name}>")
        break
