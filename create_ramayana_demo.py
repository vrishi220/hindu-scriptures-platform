"""
Create demo Ramayana Kanda 1 data with realistic structure.
This generates sample data without relying on external APIs.
"""
import json
from pathlib import Path

# Sample Ramayana Kanda 1 verses (Bala Kanda - Birth of Rama)
SAMPLE_VERSES = [
    {
        "canto": 1,
        "name": "The Enquiry",
        "verse": 1,
        "sanskrit": "नारदो भगवान् व्रジते नारदकम् चरणं प्राप्य ।",
        "transliteration": "Narado bhagavan vrajate naradakam charanam prapya.",
        "translation": "The blessed Narada, having attained the sacred place of Narada, wanders forth.",
    },
    {
        "canto": 1,
        "name": "The Enquiry",
        "verse": 2,
        "sanskrit": "ब्रह्मर्षये समागत्य तस्य पुत्रकः आविर्भूत: ।",
        "transliteration": "Brahmarshaye samagatya tasya putrakah avirbhutah.",
        "translation": "Having come to the Brahmarshi, his son appeared.",
    },
    {
        "canto": 1,
        "name": "The Enquiry",
        "verse": 3,
        "sanskrit": "तमुवाच भगवान् ब्रह्मा वीरवर प्रणतः प्रकाश्य ।",
        "transliteration": "Tamuvacha bhagavan brahma viravara pranath prakashy.",
        "translation": "The Lord Brahma spoke to him, the honored hero, revealing all.",
    },
    {
        "canto": 2,
        "name": "The Preparation",
        "verse": 1,
        "sanskrit": "धर्मज्ञः सर्वशास्त्रज्ञः सत्यसंधः विशेषणः ।",
        "transliteration": "Dharmajnah sarvaashastrajnah satyasandhah visheshanah.",
        "translation": "He was a knower of dharma, versed in all scriptures, true to his word.",
    },
    {
        "canto": 2,
        "name": "The Preparation",
        "verse": 2,
        "sanskrit": "दशरथः नृपः श्रीमान् वसुमान् धर्मवत्सलः ।",
        "transliteration": "Dasharathah nripah shriman vasuman dharmavatsalah.",
        "translation": "King Dasharatha, illustrious and wealthy, devoted to dharma.",
    },
    {
        "canto": 3,
        "name": "The Quest",
        "verse": 1,
        "sanskrit": "तदा कौशल्या देवी तं सुतं गर्भे धारयति ।",
        "transliteration": "Tada kaushallya devi tam sutam garbhe dharayati.",
        "translation": "Then the goddess Kausalya bore that son in her womb.",
    },
    {
        "canto": 3,
        "name": "The Quest",
        "verse": 2,
        "sanskrit": "नवमे मासे संपूर्णे रामः चन्द्रो इव प्रभुः ।",
        "transliteration": "Navame mase sampurne Ramah chandro iva prabhuh.",
        "translation": "In the ninth month completed, Rama was born, radiant as the moon.",
    },
]

def create_ramayana_json():
    """Generate Ramayana Kanda 1 JSON structure"""
    
    # Group verses by canto
    cantos_dict = {}
    for verse_data in SAMPLE_VERSES:
        canto_num = verse_data["canto"]
        if canto_num not in cantos_dict:
            cantos_dict[canto_num] = {
                "canto_num": canto_num,
                "canto_name": verse_data["name"],
                "verses": []
            }
        cantos_dict[canto_num]["verses"].append(verse_data)
    
    # Build chapters structure
    chapters = []
    for canto_num in sorted(cantos_dict.keys()):
        canto_info = cantos_dict[canto_num]
        verses = []
        for verse_data in canto_info["verses"]:
            verse = {
                "sequence": f"1.{canto_num}.{verse_data['verse']}",
                "title": f"Shloka {verse_data['verse']}",
                "basic": {
                    "sanskrit": verse_data["sanskrit"],
                    "transliteration": verse_data["transliteration"],
                },
                "translations": {
                    "english": verse_data["translation"],
                }
            }
            verses.append(verse)
        
        chapter = {
            "adhyaya": canto_num,
            "adhyaya_name": f"Canto {canto_num}",
            "adhyaya_english": f"Bala Kanda, Canto {canto_num}: {canto_info['canto_name']}",
            "total_verses": len(verses),
            "verses": verses
        }
        chapters.append(chapter)
    
    kanda_json = {
        "book": "Bala Kanda",
        "book_number": 1,
        "book_english": "Bala Kanda (Book of Youth)",
        "description": "The first book of the Ramayana, narrating the birth of Rama and events of his childhood",
        "total_chapters": len(chapters),
        "total_verses": len(SAMPLE_VERSES),
        "chapters": chapters
    }
    
    return kanda_json

def save_json(data, filename):
    """Save JSON with proper formatting"""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    file_size = Path(filename).stat().st_size / 1024
    print(f"✅ Saved: {filename} ({file_size:.1f} KB)")
    return filename

if __name__ == "__main__":
    print("\n📖 Creating demo Ramayana Kanda 1 data...\n")
    
    kanda_json = create_ramayana_json()
    
    # Display summary
    print(f"📊 Structure:")
    print(f"   Book: {kanda_json['book']}")
    print(f"   Chapters (Cantos): {kanda_json['total_chapters']}")
    print(f"   Total Verses: {kanda_json['total_verses']}")
    print(f"   Verses per canto:")
    for chapter in kanda_json['chapters']:
        print(f"      Canto {chapter['adhyaya']}: {chapter['total_verses']} verses")
    
    filename = save_json(kanda_json, "ramayana_kanda_1.json")
    print(f"\n💾 Demo data ready for import!")
    print(f"   File: {filename}")
    print(f"   Use: python3 backend/scripts/import_ramayana.py {filename}")
