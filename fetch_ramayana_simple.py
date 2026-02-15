"""
Fetch Ramayana Kanda by iterating through shloka IDs
"""
import subprocess
import json
import time
import sys
import re
from pathlib import Path

API_URL = "https://ramayana.hindbiswas.com/api"
API_TOKEN = "18|Y2t6198fXkd2joijrYlzgg2KdtzjhsUjfT0KayGL47bb1c77"

# Estimated shloka ranges for each Kanda (start_id, end_id)
KANDA_RANGES = {
    1: (1, 2500),        # Bala Kanda
    2: (2501, 6200),     # Ayodhya Kanda  
    3: (6201, 9100),     # Aranya Kanda
    4: (9101, 11500),    # Kishkindha Kanda
    5: (11501, 14500),   # Sundara Kanda
    6: (14501, 24000)    # Yuddha Kanda
}

KANDA_NAMES = {
    1: "Bala",
    2: "Ayodhya",
    3: "Aranya",
    4: "Kishkindha",
    5: "Sundara",
    6: "Yuddha"
}

DEVANAGARI_DIGITS = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
}

def parse_number(text):
    digits = []
    for ch in text:
        if ch.isdigit():
            digits.append(ch)
        elif ch in DEVANAGARI_DIGITS:
            digits.append(DEVANAGARI_DIGITS[ch])
    if not digits:
        return None
    return int("".join(digits))

def extract_kanda_canto_verse(text):
    match = re.search(r"([0-9\u0966-\u096F]+)-([0-9\u0966-\u096F]+)-([0-9\u0966-\u096F]+)", text)
    if not match:
        return None
    k = parse_number(match.group(1))
    c = parse_number(match.group(2))
    v = parse_number(match.group(3))
    if k is None or c is None or v is None:
        return None
    return k, c, v

def curl_get_json(url):
    """Fetch JSON using curl, return (data, status_code, error_snippet)"""
    try:
        result = subprocess.run(
            [
                "curl",
                "-s",
                "--http1.1",
                "--max-time",
                "15",
                "-H",
                f"Authorization: Bearer {API_TOKEN}",
                "-H",
                "User-Agent: hindu-scriptures-platform/1.0",
                "-w",
                "\n%{http_code}",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )

        if result.returncode != 0 or not result.stdout:
            return None, "curl_error", (result.stderr or "").strip()[:200]

        body, status = result.stdout.rsplit("\n", 1)
        status_code = int(status) if status.isdigit() else None
        if status_code != 200:
            return None, status_code, body.strip()[:200]

        try:
            return json.loads(body), status_code, ""
        except json.JSONDecodeError:
            return None, "json_error", body.strip()[:200]
    except Exception as exc:
        return None, "exception", str(exc)[:200]

def fetch_kanda(kanda_num):
    """Fetch Kanda by iterating through shloka IDs"""
    
    if kanda_num not in KANDA_NAMES:
        print(f"❌ Invalid Kanda: {kanda_num}")
        return None
    
    kanda_name = KANDA_NAMES[kanda_num]
    start_id, end_id = KANDA_RANGES[kanda_num]
    
    print(f"\n📖 Fetching Kanda {kanda_num}: {kanda_name}")
    print(f"   Shloka ID range: {start_id}-{end_id}")
    print(f"   Expected: ~{end_id - start_id + 1} shlokas")
    
    shlokas = []
    fetched = 0
    failed = 0
    error_samples = 0
    backoff_sleep = 1.5
    consecutive_429 = 0
    
    for shloka_id in range(start_id, end_id + 1):
        if shloka_id % 100 == 0:
            print(f"\r   Progress: {fetched} fetched, {failed} failed, ID: {shloka_id}", end="", flush=True)
        
        shloka, status, error_snippet = curl_get_json(f"{API_URL}/shloka/{shloka_id}")

        if shloka and shloka.get("id"):
            sanskrit_line = shloka.get("sanskrit", "")
            kcv = extract_kanda_canto_verse(sanskrit_line)
            if kcv and kcv[0] == kanda_num:
                shlokas.append(shloka)
                fetched += 1
                consecutive_429 = 0
            else:
                if fetched > 0 and kcv and kcv[0] > kanda_num:
                    break
                failed += 1
        else:
            failed += 1
            if error_samples < 5:
                print(
                    f"\n   Error at ID {shloka_id}: status={status} body={error_snippet}",
                    flush=True,
                )
                error_samples += 1
            if status == 401:
                print("\n❌ Auth failed. Check token.")
                break
            if status == 429:
                consecutive_429 += 1
                backoff_sleep = min(backoff_sleep + 1.0, 15.0)
                if consecutive_429 >= 5:
                    print("\n⏳ Hit rate limit repeatedly. Pausing for 60s...", flush=True)
                    time.sleep(60)
                    consecutive_429 = 0
            if status in (520, 502, 503):
                backoff_sleep = min(backoff_sleep + 0.5, 3.0)

        time.sleep(backoff_sleep)
    
    print(f"\r   Progress: {fetched} fetched, {failed} failed         ")
    
    if not shlokas:
        print(f"❌ No shlokas found for Kanda {kanda_num}")
        return None
    
    # Group by canto
    cantos = {}
    for shloka in shlokas:
        sanskrit_line = shloka.get('sanskrit', '')
        kcv = extract_kanda_canto_verse(sanskrit_line)
        if kcv and kcv[0] == kanda_num:
            canto_num = kcv[1]
            if canto_num not in cantos:
                cantos[canto_num] = []
            cantos[canto_num].append(shloka)
    
    # Build chapters structure
    chapters = []
    for canto_num in sorted(cantos.keys()):
        verses = []
        for shloka in cantos[canto_num]:
            verse = {
                "sequence": f"{kanda_num}.{canto_num}.{shloka['id']}",
                "title": f"Shloka {shloka['id']}",
                "sanskrit": shloka.get('sanskrit', ''),
                "transliteration": shloka.get('pratipada', ''),
                "translation": shloka.get('comment', ''),
            }
            verses.append(verse)
        
        chapter = {
            "adhyaya": canto_num,
            "adhyaya_name": f"Canto {canto_num}",
            "adhyaya_english": f"Book {kanda_num}, Canto {canto_num}",
            "total_verses": len(verses),
            "verses": verses
        }
        chapters.append(chapter)
    
    kanda_json = {
        "book": kanda_name,
        "book_number": kanda_num,
        "total_chapters": len(chapters),
        "total_verses": len(shlokas),
        "chapters": chapters
    }
    
    print(f"✅ Kanda {kanda_num}: {len(shlokas)} shlokas in {len(chapters)} cantos")
    
    return kanda_json

def save_kanda(kanda_json, kanda_num):
    """Save Kanda JSON to file"""
    filename = f"ramayana_kanda_{kanda_num}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(kanda_json, f, ensure_ascii=False, indent=2)
    
    file_size = Path(filename).stat().st_size / (1024 * 1024)
    print(f"💾 Saved: {filename} ({file_size:.2f} MB)")
    return filename

if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            kanda_num = int(sys.argv[1])
        except ValueError:
            print("Usage: python3 fetch_ramayana_simple.py <kanda_number>")
            print(f"Valid: 1-6")
            sys.exit(1)
    else:
        print("Usage: python3 fetch_ramayana_simple.py <kanda_number>")
        print("Valid: 1-6")
        sys.exit(1)
    
    print("\n⚠️  This will take 10-15 minutes per Kanda due to API rate limits")
    
    kanda_json = fetch_kanda(kanda_num)
    if kanda_json:
        filename = save_kanda(kanda_json, kanda_num)
        print(f"\n✨ Ready for import: {filename}")
    else:
        print(f"\n❌ Failed to fetch Kanda {kanda_num}")
        sys.exit(1)
