import requests
from bs4 import BeautifulSoup

url = 'https://www.valmiki.iitk.ac.in/content?language=dv&field_kanda_tid=1&field_sarga_value=1&field_sloka_value=1'
print(f"Fetching: {url}")
response = requests.get(url, timeout=15)
soup = BeautifulSoup(response.content, 'html.parser')

# Find the main content area
content = soup.find('div', id='content')
if not content:
    content = soup.find('div', class_='content')
if not content:
    content = soup.find('main')

if content:
    print(f"\nFound content container")
    
    # Look for field divs
    fields = content.find_all('div', class_=lambda x: x and 'field' in ' '.join(x))
    print(f"Found {len(fields)} field divs")
    
    for i, field in enumerate(fields[:10]):
        class_name = ' '.join(field.get('class', []))
        text = field.get_text(strip=True)[:150]
        print(f"\n{i}: {class_name}")
        print(f"   Text: {text}")
else:
    print("No content container found")
    
# Also check for any Devanagari text
all_divs = soup.find_all('div')
devanagari_divs = []
for div in all_divs:
    text = div.get_text(strip=True)
    if any('\u0900' <= c <= '\u097F' for c in text):
        devanagari_divs.append((div, text))

print(f"\n\nFound {len(devanagari_divs)} divs with Devanagari")
for i, (div, text) in enumerate(devanagari_divs[:3]):
    print(f"\n{i}: {text[:200]}")
