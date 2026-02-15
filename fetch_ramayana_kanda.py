import requests
import json
import time
import sys
from pathlib import Path
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

API_URL = "https://ramayana.hindbiswas.com/api"
API_TOKEN = "18|Y2t6198fXkd2joijrYlzgg2KdtzjhsUjfT0KayGL47bb1c77"
HEADERS = {"Authorization": f"Bearer {API_TOKEN}"}

def get_session():
    """Create session with retries"""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504, 520],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session

# Kanda mapping
KANDAS = {
    1: "Bala",
    2: "Ayodhya", 
    3: "Aranya",
    4: "Kishkindha",
    5: "Sundara",
    6: "Yuddha"
}

def fetch_kanda(kanda_num):
    """Fetch a single Kanda and structure it like Gita JSON"""
    
    kanda_name = KANDAS.get(kanda_num)
    if not kanda_name:
        print(f"❌ Invalid Kanda number: {kanda_num}")
        return None
    
    print(f"\n📖 Starting Kanda {kanda_num}: {kanda_name}")
    
    session = get_session()
    
    # Fetch all Kandas to get metadata
    try:
        resp = session.get(f"{API_URL}/kandas", headers=HEADERS, timeout=30)
        resp.raise_for_status()
        kandas_data = resp.json()
    except Exception as e:
        print(f"❌ Failed to fetch Kandas: {e}")
        return None
    
    kanda_meta = next((k for k in kandas_data if k['id'] == kanda_num), None)
    if not kanda_meta:
        print(f"❌ Kanda {kanda_num} not found")
        return None
    
    print(f"   Shloka count: {kanda_meta.get('total_shlokas', '?')}")
    print(f"   Sarga count: {kanda_meta.get('sarga_count', '?')}")
    
    # Fetch all Sargas for this Kanda
    try:
        resp = session.get(f"{API_URL}/kandas/{kanda_num}/sargas", headers=HEADERS, timeout=30)
        resp.raise_for_status()
        sargas_data = resp.json()
    except Exception as e:
        print(f"❌ Failed to fetch Sargas: {e}")
        return None
    
    print(f"   Found {len(sargas_data)} Sargas")
    
    # Structure: chapters = sargas, verses = shlokas
    chapters = []
    total_shlokas = 0
    
    for sarga_idx, sarga in enumerate(sargas_data, 1):
        sarga_id = sarga['id']
        shloka_count = sarga.get('shloka_count', 0)
        
        print(f"\n   📕 Sarga {sarga_idx} (ID: {sarga_id}): {shloka_count} shlokas", end="", flush=True)
        
        # Fetch all Shlokas for this Sarga
        try:
            resp = session.get(f"{API_URL}/sargas/{sarga_id}/shlokas", headers=HEADERS, timeout=30)
            resp.raise_for_status()
            shlokas_data = resp.json()
        except Exception as e:
            print(f" ❌ Failed: {e}")
            continue
        
        print(f" ✓", flush=True)
        
        verses = []
        for shloka in shlokas_data:
            verse = {
                "sequence": f"{kanda_num}.{sarga_idx}.{shloka['shloka_number']}",
                "title": f"Shloka {shloka['shloka_number']}",
                "sanskrit": shloka.get('sanskrit', ''),
                "transliteration": shloka.get('pratipada', ''),  # Using pratipada as transliteration
                "translation": shloka.get('comment', ''),  # Using comment as English translation
                "raw_data": shloka  # Store full API response for reference
            }
            verses.append(verse)
            total_shlokas += 1
        
        chapter = {
            "adhyaya": sarga_idx,
            "adhyaya_name": f"Sarga {sarga_idx}",
            "adhyaya_english": f"Book {kanda_num}, Canto {sarga_idx}",
            "total_verses": len(verses),
            "verses": verses
        }
        chapters.append(chapter)
        
        # Respectful rate limiting
        time.sleep(0.5)
    
    # Package as Gita-like structure
    kanda_json = {
        "book": kanda_name,
        "book_number": kanda_num,
        "total_chapters": len(chapters),
        "total_verses": total_shlokas,
        "chapters": chapters
    }
    
    print(f"\n✅ Kanda {kanda_num} ({kanda_name}): {total_shlokas} shlokas across {len(chapters)} sargas")
    session.close()
    
    return kanda_json

def save_kanda(kanda_json, kanda_num):
    """Save Kanda JSON to file"""
    filename = f"ramayana_kanda_{kanda_num}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(kanda_json, f, ensure_ascii=False, indent=2)
    
    file_size = Path(filename).stat().st_size / (1024 * 1024)
    print(f"💾 Saved: {filename} ({file_size:.1f} MB)")
    return filename

if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            kanda_num = int(sys.argv[1])
        except ValueError:
            print("Usage: python3 fetch_ramayana_kanda.py <kanda_number>")
            print(f"Valid: 1-6 ({', '.join([f'{k}:{v}' for k,v in KANDAS.items()])})")
            sys.exit(1)
    else:
        print("Usage: python3 fetch_ramayana_kanda.py <kanda_number>")
        print(f"Valid: 1-6 ({', '.join([f'{k}:{v}' for k,v in KANDAS.items()])})")
        sys.exit(1)
    
    kanda_json = fetch_kanda(kanda_num)
    if kanda_json:
        filename = save_kanda(kanda_json, kanda_num)
        print(f"\n✨ Ready for import: {filename}")
    else:
        print(f"\n❌ Failed to fetch Kanda {kanda_num}")
        sys.exit(1)
