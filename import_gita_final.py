"""
Import complete scraped Bhagavad Gita JSON using backend infrastructure
"""
import sys
sys.path.insert(0, '/Users/rishivangapalli/repos/hindu-scriptures-platform')

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

# Setup database - use the same config as the backend
db_url = os.environ.get('DATABASE_URL', 'postgresql://localhost/scriptures_db')
engine = create_engine(db_url)
Session = sessionmaker(bind=engine)
db = Session()

from api.content import _import_json
from models.user import User

try:
    print("\n" + "=" * 70)
    print("IMPORTING COMPLETE BHAGAVAD GITA (WITH SCRAPED CONTENT)")
    print("=" * 70 + "\n")
    
    # Get or create test user
    test_user = db.query(User).filter(User.username == 'admin').first()
    if not test_user:
        print("❌ Admin user not found. Creating test user...")
        from models.user import User as UserModel
        test_user = UserModel(
            username="admin",
            email="admin@localhost",
            password_hash="test",
            role="admin"
        )
        db.add(test_user)
        db.commit()
        db.refresh(test_user)
        print(f"✓ Created admin user (ID: {test_user.id})")
    else:
        print(f"✓ Using existing admin user: {test_user.username} (ID: {test_user.id})")
    
    # Import configuration
    payload = {
        "import_type": "json",
        "book_name": "Bhagavad Gita - Complete with English Translations",
        "book_code": "bg-complete-with-translations",
        "schema_id": 1,  # Bhagavad Gita schema
        "language_primary": "sanskrit",
        "source_attribution": "scraped from holy-bhagavad-gita.org",
        "original_source_url": "https://www.holy-bhagavad-gita.org",
        "json_source_url": "/Users/rishivangapalli/repos/hindu-scriptures-platform/bhagavad_gita_scraped.json",
        "json_source_type": "file"
    }
    
    print("\nImport Configuration:")
    print(f"  Book Name: {payload['book_name']}")
    print(f"  Schema ID: {payload['schema_id']}")
    print(f"  Source: {payload['source_attribution']}")
    print(f"  File: bhagavad_gita_scraped.json")
    
    print("\n📤 Starting import...")
    print("-" * 70)
    
    result = _import_json(payload, db, test_user)
    
    print("-" * 70)
    print("\n✅ IMPORT RESULTS")
    print(f"  Success: {result.success}")
    print(f"  Book ID: {result.book_id}")
    print(f"  Nodes Created: {result.nodes_created}")
    if result.warnings:
        print(f"  Warnings: {result.warnings}")
    if result.error:
        print(f"  Errors: {result.error}")
    
    if result.success and result.book_id:
        print("\n" + "=" * 70)
        print(f"✨ SUCCESS! Book ID: {result.book_id}")
        print("\nView in Admin UI:")
        print(f"  http://localhost:3000/admin/explorer?book={result.book_id}")
        print("=" * 70)
        
except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
    
finally:
    db.close()
