"""
Import scraped Bhagavad Gita JSON into the database
Replaces the placeholder book with real content
"""
import requests
import json
import time

API_URL = "http://localhost:8000/api/content/import"
TEST_USER_ID = 1  # System user

def import_gita_json():
    print("\n" + "=" * 70)
    print("IMPORTING COMPLETE BHAGAVAD GITA")
    print("=" * 70 + "\n")
    
    # Load the scraped Gita JSON
    with open('bhagavad_gita_scraped.json', 'r', encoding='utf-8') as f:
        gita_data = json.load(f)
    
    print(f"Loaded: {len(gita_data['chapters'])} chapters, " +
          f"{sum(len(ch['verses']) for ch in gita_data['chapters'])} verses")
    
    # Prepare import config
    import_config = {
        "import_type": "json",
        "book_name": "Bhagavad Gita - Complete with Translations",
        "schema_id": 1,  # Bhagavad Gita schema
        "json_source_type": "local_data",  # We're providing data directly
        "json_data": gita_data,  # Embed the data directly
        "text_fields": {
            "chapter_name": "name",
            "verse_text": "slok",
            "transliteration": "transliteration",
            "translation": "translation"
        }
    }
    
    print("\nImport Configuration:")
    print(f"  Book: {import_config['book_name']}")
    print(f"  Schema ID: {import_config['schema_id']}")
    print(f"  Type: JSON (embedded data)")
    
    # Send import request
    print("\n📤 Sending import request...")
    
    try:
        # Add auth header with test token
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer test-token"
        }
        
        response = requests.post(
            API_URL,
            json=import_config,
            headers=headers,
            timeout=60
        )
        
        result = response.json()
        
        if response.status_code == 200 or response.status_code == 201:
            print(f"\n✅ IMPORT SUCCESSFUL!")
            print(f"   Book ID: {result.get('book_id', 'N/A')}")
            print(f"   Nodes created: {result.get('nodes_created', result.get('message', 'N/A'))}")
            return result
        else:
            print(f"\n❌ Import failed (HTTP {response.status_code})")
            print(f"   Response: {result}")
            return None
            
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    result = import_gita_json()
    
    if result:
        print("\n" + "=" * 70)
        print("Import completed! You can now view the book in the admin UI.")
        print("=" * 70)
