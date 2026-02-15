"""
Test scraping just chapter 1
"""
from scrape_gita import *

# Override to just do chapter 1
def test_scrape_chapter_1():
    verse_counts = [47]
    chapter_names = ["Arjuna Vishada Yoga"]
    
    all_data = {
        "scripture": "Bhagavad Gita - Test",
        "language": "Sanskrit",
        "chapters": []
    }
    
    chapter_num = 1
    print(f"\nScraping Chapter {chapter_num}...")
    verses = []
    
    for verse_num in range(1, verse_counts[chapter_num - 1] + 1):
        try:
            url = f"https://www.holy-bhagavad-gita.org/chapter/{chapter_num}/verse/{verse_num}/"
            response = requests.get(url, timeout=15)
            
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Extract Sanskrit text
                sanskrit = ""
                verse_text_elements = soup.find_all('p')
                for elem in verse_text_elements:
                    text = elem.get_text(strip=True)
                    if any('\u0900' <= c <= '\u097F' for c in text) and len(text) > 20:
                        sanskrit = text
                        break
                
                # Extract transliteration
                transliteration = ""
                for elem in verse_text_elements:
                    text = elem.get_text(strip=True)
                    if any(c in text for c in ['ā', 'ṛ', 'ñ', 'ṣ', 'ḥ', 'ṁ', 'ī', 'ū']) and 'http' not in text:
                        transliteration = text
                        break
                
                # Extract translation
                translation = ""
                h2_tags = soup.find_all('h2')
                for h2 in h2_tags:
                    if 'Translation' in h2.get_text():
                        next_p = h2.find_next('p')
                        if next_p:
                            translation = next_p.get_text(strip=True)
                            break
                
                verses.append({
                    "verse": verse_num,
                    "verse_number": verse_num,
                    "slok": sanskrit if sanskrit else f"[Sanskrit for {chapter_num}.{verse_num}]",
                    "transliteration": transliteration,
                    "translation": translation if translation else f"[Translation {chapter_num}.{verse_num}]",
                    "word_meanings": ""
                })
                
                s_check = '✓' if sanskrit else '✗'
                t_check = '✓' if transliteration else '✗'
                m_check = '✓' if translation else '✗'
                print(f"  {verse_num:2d}. Sanskrit:{s_check} Trans:{t_check} Meaning:{m_check}")
                time.sleep(1)
            else:
                print(f"  ✗ {verse_num} - HTTP {response.status_code}")
                
        except Exception as e:
            print(f"  ✗ {verse_num} - Error: {str(e)[:50]}")
    
    all_data['chapters'].append({
        "chapter": chapter_num,
        "chapter_number": chapter_num,
        "name": chapter_names[0],
        "transliterated_name": chapter_names[0],
        "name_sanskrit": "",
        "summary": "",
        "meaning": "",
        "verses": verses
    })
    
    return all_data

if __name__ == "__main__":
    print("=" * 60)
    print("TEST SCRAPE - CHAPTER 1 ONLY")
    print("=" * 60)
    
    data = test_scrape_chapter_1()
    
    output_file = "gita_chapter1_test.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ Saved to: {output_file}")
    print(f"✓ Verses scraped: {len(data['chapters'][0]['verses'])}")
