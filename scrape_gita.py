"""
Scrape Bhagavad Gita from Holy-Bhagavad-Gita.org
"""
import requests
from bs4 import BeautifulSoup
import json
import time

def scrape_gita():
    verse_counts = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78]
    
    chapter_names = [
        "Arjuna Vishada Yoga",
        "Sankhya Yoga",
        "Karma Yoga",
        "Jnana Karma Sanyasa Yoga",
        "Karma Sanyasa Yoga",
        "Dhyana Yoga",
        "Jnana Vijnana Yoga",
        "Aksara Brahma Yoga",
        "Raja Vidya Raja Guhya Yoga",
        "Vibhuti Yoga",
        "Vishvarupa Darshana Yoga",
        "Bhakti Yoga",
        "Kshetra Kshetrajna Vibhaga Yoga",
        "Gunatraya Vibhaga Yoga",
        "Purushottama Yoga",
        "Daivasura Sampad Vibhaga Yoga",
        "Shraddhatraya Vibhaga Yoga",
        "Moksha Sannyasa Yoga"
    ]
    
    all_data = {
        "scripture": "Bhagavad Gita",
        "language": "Sanskrit",
        "chapters": []
    }
    
    for chapter_num in range(1, 19):
        print(f"\nScraping Chapter {chapter_num}...")
        verses = []
        
        for verse_num in range(1, verse_counts[chapter_num - 1] + 1):
            try:
                url = f"https://www.holy-bhagavad-gita.org/chapter/{chapter_num}/verse/{verse_num}/"
                response = requests.get(url, timeout=15)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.content, 'html.parser')
                    
                    # Extract Sanskrit text - it's in a specific structure
                    sanskrit = ""
                    # Look for the verse text in the page - it appears as plain text after h1
                    verse_text_elements = soup.find_all('p')
                    for elem in verse_text_elements:
                        text = elem.get_text(strip=True)
                        # Sanskrit verses contain Devanagari characters
                        if any('\u0900' <= c <= '\u097F' for c in text) and len(text) > 20:
                            sanskrit = text
                            break
                    
                    # Extract transliteration - look for Latin text with special chars
                    transliteration = ""
                    for elem in verse_text_elements:
                        text = elem.get_text(strip=True)
                        # Transliteration has chars like ā, ṛ, ñ, ṣ
                        if any(c in text for c in ['ā', 'ṛ', 'ñ', 'ṣ', 'ḥ', 'ṁ', 'ī', 'ū']) and 'http' not in text:
                            transliteration = text
                            break
                    
                    # Extract translation - look for "BG {chapter}.{verse}:"
                    translation = ""
                    h2_tags = soup.find_all('h2')
                    for h2 in h2_tags:
                        if 'Translation' in h2.get_text():
                            # Next element should be the translation
                            next_p = h2.find_next('p')
                            if next_p:
                                translation = next_p.get_text(strip=True)
                                break
                    
                    verses.append({
                        "verse": verse_num,
                        "verse_number": verse_num,
                        "slok": sanskrit if sanskrit else f"[Sanskrit text for {chapter_num}.{verse_num}]",
                        "transliteration": transliteration,
                        "translation": translation if translation else f"[Translation for {chapter_num}.{verse_num}]",
                        "word_meanings": ""
                    })
                    print(f"  ✓ {chapter_num}.{verse_num} - {'✓' if sanskrit else '✗'} Sanskrit, {'✓' if transliteration else '✗'} Trans, {'✓' if translation else '✗'} Meaning")
                    time.sleep(1)  # Be polite to the server
                else:
                    print(f"  ✗ {chapter_num}.{verse_num} - HTTP {response.status_code}")
                    verses.append({
                        "verse": verse_num,
                        "verse_number": verse_num,
                        "slok": f"[Sanskrit text for Chapter {chapter_num}, Verse {verse_num}]",
                        "transliteration": "",
                        "translation": f"[Translation for Chapter {chapter_num}, Verse {verse_num}]",
                        "word_meanings": ""
                    })
                    
            except Exception as e:
                print(f"  ✗ {chapter_num}.{verse_num} - Error: {str(e)[:50]}")
                verses.append({
                    "verse": verse_num,
                    "verse_number": verse_num,
                    "slok": f"[Sanskrit text for Chapter {chapter_num}, Verse {verse_num}]",
                    "transliteration": "",
                    "translation": f"[Translation for Chapter {chapter_num}, Verse {verse_num}]",
                    "word_meanings": ""
                })
        
        all_data['chapters'].append({
            "chapter": chapter_num,
            "chapter_number": chapter_num,
            "name": chapter_names[chapter_num - 1],
            "transliterated_name": chapter_names[chapter_num - 1],
            "name_sanskrit": "",
            "summary": "",
            "meaning": "",
            "verses": verses
        })
        print(f"✓ Chapter {chapter_num} complete: {len(verses)} verses")
    
    return all_data

if __name__ == "__main__":
    print("=" * 60)
    print("BHAGAVAD GITA WEB SCRAPER")
    print("=" * 60)
    print()
    
    data = scrape_gita()
    
    # Save to file
    output_file = "bhagavad_gita_scraped.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ Data saved to: {output_file}")
    print(f"✓ Total chapters: {len(data['chapters'])}")
    total_verses = sum(len(ch['verses']) for ch in data['chapters'])
    print(f"✓ Total verses: {total_verses}")
