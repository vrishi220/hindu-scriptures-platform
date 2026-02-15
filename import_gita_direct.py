"""
Direct database import of scraped Bhagavad Gita JSON
Bypasses API authentication by using ORM directly
"""
import json
import sys
sys.path.insert(0, '/Users/rishivangapalli/repos/hindu-scriptures-platform')

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.book import Book
from models.content_node import ContentNode
from models.database import Base
from datetime import datetime

# Database setup
DATABASE_URL = "postgresql://postgres:postgres@localhost/scriptures_db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def insert_gita_nodes():
    db = SessionLocal()
    
    try:
        print("\n" + "=" * 70)
        print("DIRECT DATABASE IMPORT - COMPLETE BHAGAVAD GITA")
        print("=" * 70 + "\n")
        
        # Load JSON
        with open('bhagavad_gita_scraped.json', 'r', encoding='utf-8') as f:
            gita_data = json.load(f)
        
        total_verses = sum(len(ch['verses']) for ch in gita_data['chapters'])
        print(f"Loaded: {len(gita_data['chapters'])} chapters, {total_verses} verses\n")
        
        # Create book
        book = Book(
            book_name="Bhagavad Gita - Complete English Translations",
            book_code="BG_COMPLETE_WITH_TRANSLATIONS",
            schema_id=1,  # Bhagavad Gita schema
            language_primary="sanskrit",
            metadata_json={"import_date": datetime.utcnow().isoformat()}
        )
        db.add(book)
        db.flush()  # Get the book ID
        book_id = book.id
        
        print(f"✓ Created book: '{book.book_name}' (ID: {book_id})\n")
        
        # Insert nodes
        node_count = 0
        
        for chapter_idx, chapter in enumerate(gita_data['chapters'], 1):
            chapter_name = chapter.get('name', f'Chapter {chapter_idx}')
            chapter_number = chapter.get('chapter', chapter_idx)
            
            # Create chapter node
            chapter_node = ContentNode(
                book_id=book_id,
                parent_node_id=None,
                level_name="Adhyaya",
                level_order=0,
                sequence_number=str(chapter_number),
                title_english=chapter_name,
                title_sanskrit=chapter.get('name_sanskrit', ''),
                transliteration_title=chapter_name,
                content_data={
                    "english": chapter_name,
                    "sanskrit": chapter.get('name_sanskrit', '')
                },
                created_by=1,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(chapter_node)
            db.flush()  # Get chapter node ID
            chapter_node_id = chapter_node.id
            node_count += 1
            
            # Insert verses
            verses = chapter.get('verses', [])
            for verse in verses:
                verse_num = verse.get('verse_number', verse.get('verse'))
                
                verse_node = ContentNode(
                    book_id=book_id,
                    parent_node_id=chapter_node_id,
                    level_name="Shloka",
                    level_order=1,
                    sequence_number=str(verse_num),
                    title_english=f"Verse {verse_num}",
                    title_sanskrit="",
                    transliteration_title=verse.get('transliteration', '')[:100] if verse.get('transliteration') else '',
                    content_data={
                        "sanskrit": verse.get('slok', ''),
                        "transliteration": verse.get('transliteration', ''),
                        "english_translation": verse.get('translation', '')
                    },
                    created_by=1,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(verse_node)
                node_count += 1
            
            if chapter_idx % 5 == 0:
                db.flush()  # Periodic flush for memory efficiency
                print(f"  ✓ Chapter {chapter_idx}: {len(verses)} verses")
        
        # Update book with node count
        book.nodes_created = node_count
        book.updated_at = datetime.utcnow()
        
        db.commit()
        
        print(f"\n✅ IMPORT SUCCESSFUL!")
        print(f"   Book ID: {book_id}")
        print(f"   Total nodes created: {node_count}")
        print(f"   (1 chapter + {total_verses} verses)")
        
        return book_id, node_count
        
    except Exception as e:
        db.rollback()
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None, 0
    finally:
        db.close()

if __name__ == "__main__":
    book_id, node_count = insert_gita_nodes()
    
    if book_id:
        print("\n" + "=" * 70)
        print("You can now view the book in admin UI:")
        print(f"http://localhost:3000/admin/explorer?book={book_id}")
        print("=" * 70)
