"""
Test script to import complete Bhagavad Gita from JSON.
Run this to populate your database with all 18 chapters and 700 verses.
"""
import sys
sys.path.insert(0, '/Users/rishivangapalli/repos/hindu-scriptures-platform')

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

# Setup database
db_url = os.environ.get('DATABASE_URL', 'postgresql://localhost/scriptures_db')
engine = create_engine(db_url)
Session = sessionmaker(bind=engine)
db = Session()

from api.content import _import_json
from models.user import User

# Get or create test user
test_user = db.query(User).filter(User.username == 'admin').first()
if not test_user:
    print("Admin user not found. Please create an admin user first.")
    sys.exit(1)

# Import configuration
payload = {
    "import_type": "json",
    "book_name": "Bhagavad Gita - Complete",
    "book_code": "bhagavad-gita-complete",
    "schema_id": 1,  # Bhagavad Gita schema
    "language_primary": "sanskrit",
    "source_attribution": "Generated Structure (700 verses)",
    "original_source_url": "https://bhagavadgita.io",
    "json_source_url": "/Users/rishivangapalli/repos/hindu-scriptures-platform/bhagavad_gita_complete.json",
    "json_source_type": "file"
}

print("Starting Bhagavad Gita import...")
print("=" * 60)

result = _import_json(payload, db, test_user)

print("\n" + "=" * 60)
print("IMPORT RESULTS")
print("=" * 60)
print(f"Success: {result.success}")
print(f"Book ID: {result.book_id}")
print(f"Nodes Created: {result.nodes_created}")
print(f"Warnings: {result.warnings}")
if result.error:
    print(f"Error: {result.error}")

db.close()
