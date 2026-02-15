#!/usr/bin/env python3
"""
Import demo Ramayana Kanda 1 JSON into database
"""
import sys
import os
import json
from pathlib import Path

# Add repo to path
repo_path = Path(__file__).parent
sys.path.insert(0, str(repo_path))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.book import Book
from models.content_node import ContentNode
from models.user import User

# Database setup
db_url = os.environ.get('DATABASE_URL', 'postgresql+psycopg2://scripture_user:your_password@localhost:5432/scriptures_db')

print(f"\n📌 Using database URL: {db_url[:50]}...")

try:
    engine = create_engine(db_url, echo=False, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    db = Session()
    # Test connection
    db.execute("SELECT 1")
    print(f"✓ Connected to database")
except Exception as e:
    print(f"❌ Database connection failed: {e}")
    print(f"\n💡 Make sure PostgreSQL is running and database is created.")
    print(f"   Expected: USER=scripture_user, DB=scriptures_db, HOST=localhost")
    print(f"   Or set DATABASE_URL environment variable")
    sys.exit(1)

def get_or_create_admin():
    """Get or create admin user"""
    admin = db.query(User).filter(User.username == 'admin').first()
    if not admin:
        admin = User(
            username="admin",
            email="admin@localhost",
            password_hash="test",
            role="admin"
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        print(f"✓ Created admin user (ID: {admin.id})")
    return admin

def load_ramayana_json(filename):
    """Load and validate JSON file"""
    filepath = repo_path / filename
    if not filepath.exists():
        print(f"❌ File not found: {filename}")
        return None
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"✓ Loaded {filename}")
        return data
    except Exception as e:
        print(f"❌ Failed to load JSON: {e}")
        return None

def create_book(admin_user):
    """Create Ramayana book entry"""
    book = Book(
        book_name="Ramayana - Bala Kanda (Demo)",
        book_code="ramayana-bala-kanda-demo",
        language_primary="sanskrit",
        metadata={
            "source": "demo_data",
            "source_attribution": "Demo data for scripture platform testing",
            "language_translations": ["english", "transliteration"],
            "total_verses_in_kanda": 7
        },
        created_by=admin_user.id
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    print(f"✓ Created book: {book.book_name} (ID: {book.id})")
    return book

def import_ramayana_content(book, data, admin_user):
    """Import Ramayana content structure"""
    
    if not data.get('chapters'):
        print("❌ No chapters in JSON data")
        return False
    
    total_nodes = 0
    
    # Create chapters (Adhyaya level)
    for chapter_data in data['chapters']:
        chapter_num = chapter_data.get('adhyaya', 0)
        chapter_name = chapter_data.get('adhyaya_name', f'Canto {chapter_num}')
        chapter_english = chapter_data.get('adhyaya_english', '')
        
        # Create chapter node
        chapter_node = ContentNode(
            book_id=book.id,
            level_name="Adhyaya",
            level_order=0,
            sequence_number=chapter_num,
            title_english=chapter_english or chapter_name,
            title_transliteration=chapter_name,
            title_sanskrit=f"अध्याय {chapter_num}",
            has_content=False,
            content_data={
                "basic": {
                    "summary": f"Canto {chapter_num} of Bala Kanda"
                }
            },
            created_by=admin_user.id,
            last_modified_by=admin_user.id
        )
        db.add(chapter_node)
        db.commit()
        db.refresh(chapter_node)
        total_nodes += 1
        print(f"  ✓ Added chapter: {chapter_name} (ID: {chapter_node.id})")
        
        # Create verses (Shloka level)
        verses = chapter_data.get('verses', [])
        for verse_data in verses:
            verse_seq = verse_data.get('sequence', '0.0.0')
            verse_num = int(verse_seq.split('.')[-1])
            verse_title = verse_data.get('title', f'Shloka {verse_num}')
            
            # Extract content data
            basic = verse_data.get('basic', {})
            translations = verse_data.get('translations', {})
            
            verse_node = ContentNode(
                book_id=book.id,
                parent_node_id=chapter_node.id,
                level_name="Shloka",
                level_order=1,
                sequence_number=verse_num,
                title_english=f"Verse {verse_num}",
                title_transliteration=verse_title,
                has_content=True,
                content_data={
                    "basic": {
                        "sanskrit": basic.get('sanskrit', ''),
                        "transliteration": basic.get('transliteration', ''),
                    },
                    "translations": {
                        "english": translations.get('english', ''),
                    }
                },
                created_by=admin_user.id,
                last_modified_by=admin_user.id
            )
            db.add(verse_node)
            db.commit()
            db.refresh(verse_node)
            total_nodes += 1
        
        print(f"    ✓ Added {len(verses)} verses")
    
    return total_nodes

def main():
    print("\n" + "=" * 70)
    print("IMPORTING RAMAYANA KANDA 1 (DEMO DATA)")
    print("=" * 70 + "\n")
    
    # Get/create admin user
    print("📝 Setting up user...")
    admin_user = get_or_create_admin()
    
    # Load JSON
    print("\n📖 Loading JSON...")
    ramayana_data = load_ramayana_json("ramayana_kanda_1.json")
    if not ramayana_data:
        return False
    
    # Display summary
    print(f"\n📊 Data summary:")
    print(f"  Book: {ramayana_data.get('book')}")
    print(f"  Chapters: {ramayana_data.get('total_chapters')}")
    print(f"  Verses: {ramayana_data.get('total_verses')}")
    
    # Create book
    print("\n📚 Creating book entry...")
    book = create_book(admin_user)
    
    # Import content
    print(f"\n📥 Importing content...\n")
    total_nodes = import_ramayana_content(book, ramayana_data, admin_user)
    
    print(f"\n✅ Import complete!")
    print(f"   Total nodes created: {total_nodes + 1} (1 book + {total_nodes} content nodes)")
    print(f"\n💡 You can now browse the Ramayana in the scripture browser!")
    print(f"   The demo includes {ramayana_data.get('total_verses')} verses across {ramayana_data.get('total_chapters')} cantos.")
    
    return True

if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()
