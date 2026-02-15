"""
Script to fetch complete Bhagavad Gita data from available sources.
Creates a JSON file compatible with the JSON importer.
"""
import requests
import json

def fetch_from_bhagavadgita_api():
    """
    Fetch from BhagavadGita.io API.
    API: https://bhagavadgita.io/
    """
    print("Fetching Bhagavad Gita from bhagavadgita.io...")
    
    verse_counts = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78]
    
    all_data = {
        "scripture": "Bhagavad Gita",
        "language": "Sanskrit",
        "chapters": []
    }
    
    # Fetch all 18 chapters
    for chapter_num in range(1, 19):
        print(f"Fetching Chapter {chapter_num}...")
        try:
            # Fetch chapter info
            headers = {'Accept': 'application/json'}
            chapter_response = requests.get(
                f"https://bhagavadgita.io/api/v1/chapters/{chapter_num}",
                headers=headers,
                timeout=10
            )
            
            if chapter_response.status_code == 200:
                chapter_data = chapter_response.json()
                
                # Get verses for this chapter
                verses = []
                verse_count = verse_counts[chapter_num - 1]
                
                for verse_num in range(1, verse_count + 1):
                    try:
                        verse_response = requests.get(
                            f"https://bhagavadgita.io/api/v1/chapters/{chapter_num}/verses/{verse_num}",
                            headers=headers,
                            timeout=10
                        )
                        if verse_response.status_code == 200:
                            verse_data = verse_response.json()
                            
                            # Extract translations
                            translation_text = ""
                            if 'translations' in verse_data and len(verse_data['translations']) > 0:
                                translation_text = verse_data['translations'][0].get('description', '')
                            
                            verses.append({
                                "verse": verse_num,
                                "verse_number": verse_num,
                                "slok": verse_data.get('text', ''),
                                "transliteration": verse_data.get('transliteration', ''),
                                "translation": translation_text,
                                "word_meanings": verse_data.get('word_meanings', '')
                            })
                            print(f"  - Verse {verse_num} fetched")
                        else:
                            print(f"  - Verse {verse_num} failed: {verse_response.status_code}")
                    except Exception as e:
                        print(f"  - Error fetching verse {verse_num}: {e}")
                        continue
                
                all_data['chapters'].append({
                    "chapter": chapter_num,
                    "chapter_number": chapter_num,
                    "name": chapter_data.get('name_translated', ''),
                    "transliterated_name": chapter_data.get('name_transliterated', ''),
                    "name_sanskrit": chapter_data.get('name', ''),
                    "summary": chapter_data.get('chapter_summary', ''),
                    "meaning": chapter_data.get('name_meaning', ''),
                    "verses": verses
                })
                print(f"Chapter {chapter_num} complete: {len(verses)} verses")
            else:
                print(f"Failed to fetch chapter {chapter_num}: {chapter_response.status_code}")
        
        except Exception as e:
            print(f"Error fetching chapter {chapter_num}: {e}")
            continue
    
    return all_data


def create_manual_structure():
    """
    Create a manual structure template for all 18 chapters.
    This provides the correct verse counts for each chapter.
    """
    verse_counts = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78]
    
    structure = {
        "scripture": "Bhagavad Gita",
        "language": "Sanskrit",
        "chapters": []
    }
    
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
    
    for chapter_num, (name, verse_count) in enumerate(zip(chapter_names, verse_counts), 1):
        verses = []
        for verse_num in range(1, verse_count + 1):
            verses.append({
                "verse": verse_num,
                "verse_number": verse_num,
                "slok": f"[Placeholder for Chapter {chapter_num}, Verse {verse_num}]",
                "transliteration": "",
                "translation": "",
                "word_meanings": ""
            })
        
        structure['chapters'].append({
            "chapter": chapter_num,
            "chapter_number": chapter_num,
            "name": name,
            "transliterated_name": name,
            "name_sanskrit": "",
            "summary": "",
            "meaning": "",
            "verses": verses
        })
    
    return structure


if __name__ == "__main__":
    print("=" * 60)
    print("BHAGAVAD GITA DATA FETCHER")
    print("=" * 60)
    print()
    
    choice = input("Choose method:\n1. Fetch from API (slow, requires internet)\n2. Create structure template with placeholders\n\nChoice (1 or 2): ")
    
    if choice == "1":
        data = fetch_from_bhagavadgita_api()
    else:
        print("\nCreating structure with all 18 chapters and correct verse counts...")
        data = create_manual_structure()
    
    # Save to file
    output_file = "bhagavad_gita_complete.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ Data saved to: {output_file}")
    print(f"✓ Total chapters: {len(data['chapters'])}")
    total_verses = sum(len(ch['verses']) for ch in data['chapters'])
    print(f"✓ Total verses: {total_verses}")
    print("\nYou can now use this file for JSON import!")
    print(f"Upload to a web server or use as a local file.")
