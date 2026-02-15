"""
Import Ramayana Kanda by Kanda into database
Usage: python3 import_ramayana_kanda.py <kanda_number>
"""
import sys
import json
import os
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from api.models import Book, User
from api.content import _import_json

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/scriptures_db")

KANDAS = {
    1: "Bala Kanda",
    2: "Ayodhya Kanda",
    3: "Aranya Kanda",
    4: "Kishkindha Kanda",
    5: "Sundara Kanda",
    6: "Yuddha Kanda"
}

def import_kanda(kanda_num):
    """Import a single Kanda JSON file into database"""
    
    filename = f"ramayana_kanda_{kanda_num}.json"
    if not Path(filename).exists():
        print(f"❌ File not found: {filename}")
        print(f"   Run: python3 fetch_ramayana_kanda.py {kanda_num}")
        return False
    
    kanda_name = KANDAS.get(kanda_num, "Unknown")
    
    print(f"\n📚 Importing Kanda {kanda_num}: {kanda_name}")
    print(f"   From: {filename}")
    
    # Read JSON file
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Failed to read JSON: {e}")
        return False
    
    # Verify structure
    total_verses = data.get('total_verses', 0)
    total_chapters = data.get('total_chapters', 0)
    print(f"   Chapters: {total_chapters}, Verses: {total_verses}")
    
    # Set up database
    engine = create_engine(DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Get or create admin user (assuming ID 1)
        user = session.query(User).filter_by(id=1).first()
        if not user:
            print("❌ Admin user not found (ID 1)")
            return False
        
        # Prepare payload for _import_json
        payload = {
            "file_source": filename,
            "source_type": "file",
            "format": "json",
            "title": kanda_name,
            "description": f"The {kanda_name} from the Ramayana"
        }
        
        print(f"\n   Calling _import_json()...")
        
        # Import using backend's function
        result = _import_json(
            file_path=filename,
            payload=payload,
            user_id=user.id,
            session=session
        )
        
        if result and result.get('success'):
            book_id = result.get('book_id')
            nodes_created = result.get('nodes_created', 0)
            print(f"\n✅ SUCCESS!")
            print(f"   Book ID: {book_id}")
            print(f"   Nodes Created: {nodes_created}")
            print(f"   Status: {result.get('status', 'imported')}")
            return True
        else:
            print(f"\n❌ Import failed: {result}")
            return False
            
    except Exception as e:
        print(f"❌ Import error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        session.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 import_ramayana_kanda.py <kanda_number>")
        print(f"Kandas: {', '.join([f'{k}={v}' for k,v in KANDAS.items()])}")
        sys.exit(1)
    
    try:
        kanda_num = int(sys.argv[1])
        if kanda_num not in KANDAS:
            print(f"❌ Invalid Kanda: {kanda_num}")
            sys.exit(1)
    except ValueError:
        print(f"❌ Invalid number: {sys.argv[1]}")
        sys.exit(1)
    
    success = import_kanda(kanda_num)
    sys.exit(0 if success else 1)
