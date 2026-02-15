"""
Fetch Ramayana Kanda by Kanda using curl (avoiding HTTP/2 issues)
"""
import subprocess
import json
import time
import sys
from pathlib import Path

API_URL = "https://ramayana.hindbiswas.com/api"
API_TOKEN = "18|Y2t6198fXkd2joijrYlzgg2KdtzjhsUjfT0KayGL47bb1c77"

KANDAS = {
    1: "Bala",
    2: "Ayodhya", 
    3: "Aranya",
    4: "Kishkindha",
    5: "Sundara",
    6: "Yuddha"
}

def curl_get(url, retries=3):
    """Fetch URL using curl"""
    for attempt in range(retries):
        try:
            # Use curl with http/1.1, longer timeout
            result = subprocess.run([
                'curl', '-s', '--http1.1', '--max-time', '60',
                '-H', f'Authorization: Bearer {API_TOKEN}',
                url
            ], capture_output=True, text=True, timeout=65)
            
            if result.returncode == 0 and result.stdout:
                return json.loads(result.stdout)
            else:
                print(f"   Attempt {attempt+1}/{retries}: Failed", file=sys.stderr)
                time.sleep(2 ** attempt)  # exponential backoff
        except Exception as e:
            print(f"   Attempt {attempt+1}/{retries}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    
    return None

def fetch_kanda(kanda_num):
    """Fetch a single Kanda and structure it like Gita JSON"""
    
    kanda_name = KANDAS.get(kanda_num)
    if not kanda_name:
        print(f"❌ Invalid Kanda number: {kanda_num}")
        return None
    
    print(f"\n📖 Starting Kanda {kanda_num}: {kanda_name}")
    
    # Fetch all Kandas to get metadata
    print("   Fetching Kandas metadata...", end="", flush=True)
    kandas_data = curl_get(f"{API_URL}/kandas")
    if not kandas_data:
        print(" ❌")
        return None
    print(" ✓")
    
    kanda_meta = next((k for k in kandas_data if k['id'] == kanda_num), None)
    if not kanda_meta:
        print(f"❌ Kanda {kanda_num} not found")
        return None
    
    print(f"   Total shlokas: {kanda_meta.get('total_shlokas', '?')}")
    print(f"   Sargas: {kanda_meta.get('sarga_count', '?')}")
    
    # Fetch all Sargas for this Kanda
    print("   Fetching Sargas...", end="", flush=True)
    sargas_data = curl_get(f"{API_URL}/kandas/{kanda_num}/sargas")
    if not sargas_data:
        print(" ❌")
        return None
    print(f" ✓ ({len(sargas_data)} sargas)")
    
    # Structure: chapters = sargas, verses = shlokas
    chapters = []
    total_shlokas = 0
    
    for sarga_idx, sarga in enumerate(sargas_data, 1):
        sarga_id = sarga['id']
        shloka_count = sarga.get('shloka_count', 0)
        
        print(f"\n   📕 Sarga {sarga_idx:2d} (ID: {sarga_id:3d}): {shloka_count:3d} shlokas", end="", flush=True)
        
        # Fetch all Shlokas for this Sarga
        shlokas_data = curl_get(f"{API_URL}/sargas/{sarga_id}/shlokas")
        if not shlokas_data:
            print(" ❌")
            continue
        
        print(" ✓", flush=True)
        
        verses = []
        for shloka in shlokas_data:
            verse = {
                "sequence": f"{kanda_num}.{sarga_idx}.{shloka['shloka_number']}",
                "title": f"Shloka {shloka['shloka_number']}",
                "sanskrit": shloka.get('sanskrit', ''),
                "transliteration": shloka.get('pratipada', ''),
                "translation": shloka.get('comment', ''),
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
        time.sleep(0.3)
    
    # Package as Gita-like structure
    kanda_json = {
        "book": kanda_name,
        "book_number": kanda_num,
        "total_chapters": len(chapters),
        "total_verses": total_shlokas,
        "chapters": chapters
    }
    
    print(f"\n✅ Kanda {kanda_num} ({kanda_name}): {total_shlokas} shlokas across {len(chapters)} sargas")
    
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
            print("Usage: python3 fetch_ramayana_kanda_curl.py <kanda_number>")
            print(f"Valid: 1-6 ({', '.join([f'{k}:{v}' for k,v in KANDAS.items()])})")
            sys.exit(1)
    else:
        print("Usage: python3 fetch_ramayana_kanda_curl.py <kanda_number>")
        print(f"Valid: 1-6 ({', '.join([f'{k}:{v}' for k,v in KANDAS.items()])})")
        sys.exit(1)
    
    kanda_json = fetch_kanda(kanda_num)
    if kanda_json:
        filename = save_kanda(kanda_json, kanda_num)
        print(f"\n✨ Ready for import: {filename}")
    else:
        print(f"\n❌ Failed to fetch Kanda {kanda_num}")
        sys.exit(1)
