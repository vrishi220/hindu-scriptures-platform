#!/usr/bin/env python3
"""
List books from Hindu Scriptures Platform - Database Direct Access Version
This script can query books directly from the database without needing the API running
"""

import os
import sys
import json
from typing import Optional
from datetime import datetime
from collections import defaultdict
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

def get_books_from_api(api_url: str = "http://localhost:8000/api"):
    """Try to fetch books from API first."""
    try:
        import requests
        print(f"📡 Connecting to API at {api_url}/books...")
        response = requests.get(
            f"{api_url}/books",
            params={"limit": 500},
            timeout=10
        )
        if response.status_code == 200:
            return response.json(), "api"
    except Exception as e:
        print(f"⚠️  API not available: {str(e)}")
    return None, None

def get_books_from_database():
    """Fetch books directly from the database."""
    try:
        print("📚 Attempting direct database connection...")
        from models.database import SessionLocal
        from models.book import Book
        
        session = SessionLocal()
        try:
            books = session.query(Book).all()
            result = []
            for book in books:
                book_dict = {
                    "id": book.id,
                    "book_name": book.book_name,
                    "book_code": book.book_code,
                    "language_primary": book.language_primary,
                    "schema_id": book.schema_id,
                    "metadata_json": book.metadata_json or {},
                    "level_name_overrides": book.level_name_overrides or {},
                    "created_at": book.created_at.isoformat() if book.created_at else None,
                    "updated_at": (book.created_at.isoformat() if book.created_at else None),
                }
                if book.schema:
                    book_dict["schema"] = {
                        "id": book.schema.id,
                        "name": book.schema.name,
                        "levels": book.schema.levels or [],
                    }
                result.append(book_dict)
            return result, "database"
        finally:
            session.close()
    except Exception as e:
        print(f"⚠️  Database not available: {str(e)}")
    return None, None

def format_metadata_value(value: any, max_length: int = 50) -> str:
    """Format a metadata value for display."""
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "✓" if value else "✗"
    if isinstance(value, (list, dict)):
        s = json.dumps(value)
        return s[:max_length-3] + "..." if len(s) > max_length else s
    s = str(value).strip()
    return s[:max_length-3] + "..." if len(s) > max_length else s

def format_date(date_string: Optional[str]) -> str:
    """Format ISO date string."""
    if not date_string:
        return "—"
    try:
        dt = datetime.fromisoformat(date_string.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return date_string

def print_banner(text: str, width: int = 80):
    """Print a formatted banner."""
    print(f"\n{'=' * width}")
    print(f"  {text}")
    print(f"{'=' * width}")

def print_book_row(book: dict, index: int) -> None:
    """Print a single book in table format."""
    metadata = book.get("metadata_json", {})
    schema = book.get("schema", {})
    
    book_id = str(book.get("id", "?"))
    name = str(book.get("book_name", "?"))
    code = str(book.get("book_code") or "—")
    lang = book.get("language_primary", "sa")[:2]
    schema_name = schema.get("name", "—")[:15]
    status = format_metadata_value(metadata.get("status", "?"), 10)
    visibility = format_metadata_value(metadata.get("visibility", "?"), 10)
    
    print(f"{index:3} │ {book_id:5} │ {name:30} │ {code:10} │ {lang:3} │ {schema_name:15} │ {status:8} │ {visibility:8}")

def main():
    """Main entry point."""
    print("\n🏛️  Hindu Scriptures Platform - Book Listing Tool")
    print("   (Database Direct Access Version)")
    
    # Try API first, then database
    books, source = get_books_from_api()
    
    if books is None:
        books, source = get_books_from_database()
    
    if books is None:
        print("\n❌ ERROR: Could not connect to API or database")
        print("\n📋 Troubleshooting:")
        print("   1. Is the API server running? (python main.py)")
        print("   2. Is the database configured? (check .env)")
        print("   3. Run: source .env && python main.py")
        sys.exit(1)
    
    if not books:
        print("\n❌ No books found in the system")
        sys.exit(0)
    
    print(f"\n✅ Found {len(books)} book(s) (from {source})")
    
    # Print summary statistics
    print_banner("SUMMARY STATISTICS")
    
    by_status = defaultdict(int)
    by_visibility = defaultdict(int)
    by_language = defaultdict(int)
    by_schema = defaultdict(int)
    
    for book in books:
        metadata = book.get("metadata_json", {})
        status = metadata.get("status", "unknown")
        visibility = metadata.get("visibility", "unknown")
        lang = book.get("language_primary", "unknown")
        schema = book.get("schema", {})
        schema_name = schema.get("name", "none")
        
        by_status[status] += 1
        by_visibility[visibility] += 1
        by_language[lang] += 1
        by_schema[schema_name] += 1
    
    print("\n📊 By Status:")
    for status, count in sorted(by_status.items()):
        print(f"   {status:12} {count:3} books")
    
    print("\n🔐 By Visibility:")
    for visibility, count in sorted(by_visibility.items()):
        print(f"   {visibility:12} {count:3} books")
    
    print("\n🌍 By Language:")
    for lang, count in sorted(by_language.items()):
        label = {
            "sanskrit": "Sanskrit",
            "english": "English",
            "sa": "Sanskrit",
            "en": "English"
        }.get(lang, lang)
        print(f"   {label:12} {count:3} books")
    
    print("\n🏗️  By Schema:")
    for schema, count in sorted(by_schema.items()):
        print(f"   {schema:20} {count:3} books")
    
    # Print table
    print_banner("BOOKS TABLE")
    print("\n    │ ID    │ Name                           │ Code       │ Lg  │ Schema          │ Status   │ Visibility")
    print("────┼───────┼────────────────────────────────┼────────────┼─────┼─────────────────┼──────────┼──────────")
    
    for i, book in enumerate(books, 1):
        print_book_row(book, i)
    
    # Print detailed view of first few books
    max_detail = min(3, len(books))
    if max_detail > 0:
        print_banner(f"DETAILED VIEW - First {max_detail} Books")
        
        for i, book in enumerate(books[:max_detail], 1):
            metadata = book.get("metadata_json", {})
            schema = book.get("schema", {})
            
            print(f"\n📕 Book #{i}")
            print(f"   ID:        {book.get('id')}")
            print(f"   Name:      {book.get('book_name')}")
            print(f"   Code:      {book.get('book_code') or '—'}")
            print(f"   Language:  {book.get('language_primary')}")
            
            if schema:
                print(f"   Schema:    {schema.get('name')} (ID: {schema.get('id')})")
                if schema.get('levels'):
                    print(f"   Levels:    {', '.join(schema.get('levels', []))}")
            
            print(f"   Status:    {format_metadata_value(metadata.get('status'))}")
            print(f"   Visibility:{format_metadata_value(metadata.get('visibility'))}")
            
            if metadata.get('title_english'):
                print(f"   EN Title:  {format_metadata_value(metadata.get('title_english'))}")
            if metadata.get('title_sanskrit'):
                print(f"   SA Title:  {format_metadata_value(metadata.get('title_sanskrit'))}")
            if metadata.get('author'):
                print(f"   Author:    {format_metadata_value(metadata.get('author'))}")
            
            print(f"   Created:   {format_date(book.get('created_at'))}")
            if book.get('updated_at') and book.get('updated_at') != book.get('created_at'):
                print(f"   Updated:   {format_date(book.get('updated_at'))}")
            
            if book.get('level_name_overrides'):
                print(f"   Level Overrides:")
                for level, override in book.get('level_name_overrides', {}).items():
                    print(f"      {level:15} → {override}")
    
    # Export to JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_file = f"books_{timestamp}.json"
    
    with open(json_file, 'w') as f:
        json.dump(books, f, indent=2)
    
    print_banner("RESULTS")
    print(f"\n✅ Listed {len(books)} book(s)")
    print(f"📁 Results saved to: {json_file}")
    print(f"📚 Source: {source}")
    print()


if __name__ == "__main__":
    main()
