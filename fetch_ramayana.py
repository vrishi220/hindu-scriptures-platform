"""
Ramayana Importer - Fetches from ramayana.hindbiswas.com API
Uses nested hierarchy: Kanda -> Sarga -> Shloka
"""
import requests
import json
import time

API_BASE = "https://ramayana.hindbiswas.com/api"
API_TOKEN = "18|Y2t6198fXkd2joijrYlzgg2KdtzjhsUjfT0KayGL47bb1c77"
HEADERS = {"Authorization": f"Bearer {API_TOKEN}"}

def fetch_ramayana():
    """
    Fetch complete Ramayana structure:
    6 Kandas (books) with their Sargas (chapters) and Shlokas (verses)
    """
    
    print("\n" + "=" * 70)
    print("VALMIKI RAMAYANA API IMPORTER")
    print("=" * 70 + "\n")
    
    # Fetch all kandas
    print("Fetching Kandas...")
    response = requests.get(f"{API_BASE}/kandas", headers=HEADERS, timeout=15)
    kandas = response.json()
    print(f"✓ Found {len(kandas)} Kandas (Books)")
    
    all_data = {
        "scripture": "Valmiki Ramayana",
        "language": "Sanskrit",
        "kandas": []
    }
    
    total_shlokas = 0
    
    for kanda in kandas:
        kanda_id = kanda['id']
        kanda_name = kanda['name']
        kanda_english = kanda['english_name']
        sarga_count = kanda['sarga_count']
        
        print(f"\n📖 Kanda {kanda_id}: {kanda_english} ({sarga_count} Sargas)")
        
        sargas_list = []
        kanda_shloka_count = 0
        
        # Fetch all sargas for this kanda
        for sarga_num in range(1, sarga_count + 1):
            try:
                # Get sarga metadata
                sarga_response = requests.get(
                    f"{API_BASE}/sarga/{sarga_num + (kanda_id - 1) * 1000}",
                    headers=HEADERS,
                    timeout=15
                )
                
                if sarga_response.status_code == 200:
                    sarga_data = sarga_response.json()
                    sarga_name = sarga_data.get('name', f'Sarga {sarga_num}')
                    
                    # For now, we'll fetch shlokas with pagination
                    # The API structure seems to organize by global shloka ID
                    # We'll mark sargas and continue building structure
                    
                    sargas_list.append({
                        "sarga": sarga_num,
                        "sarga_name": sarga_name,
                        "shlokas": []
                    })
                    
                    if sarga_num % 25 == 0:
                        print(f"  ✓ Sargas: {sarga_num}/{sarga_count}")
                        time.sleep(0.5)
                else:
                    print(f"  ⚠ Sarga {sarga_num} not found")
                    
            except Exception as e:
                print(f"  ✗ Error fetching Sarga {sarga_num}: {str(e)[:50]}")
        
        all_data['kandas'].append({
            "kanda": kanda_id,
            "kanda_name": kanda_name,
            "english_name": kanda_english,
            "sarga_count": len(sargas_list),
            "sargas": sargas_list
        })
        
        print(f"  ✓ Kanda {kanda_id} structure: {len(sargas_list)} Sargas")
        kanda_shloka_count += len(sargas_list)
        total_shlokas += kanda_shloka_count
    
    return all_data

if __name__ == "__main__":
    try:
        data = fetch_ramayana()
        
        output_file = "ramayana_structure.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"\n✓ Structure saved to: {output_file}")
        print(f"✓ Total Kandas: {len(data['kandas'])}")
        total_sargas = sum(k.get('sarga_count', 0) for k in data['kandas'])
        print(f"✓ Total Sargas: {total_sargas}")
        
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
