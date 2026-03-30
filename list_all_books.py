#!/usr/bin/env python3
"""
List all books in the Hindu Scriptures Platform
Shows complete book information including metadata, schema, and statistics
"""

import os
import sys
import json
import requests
from typing import Optional, Any
from urllib.parse import urljoin
from dotenv import load_dotenv
from datetime import datetime
from collections import defaultdict

# Load environment variables
load_dotenv()

# Configuration
API_BASE_URL = os.getenv("API_URL", "http://localhost:8000/api")
if not API_BASE_URL.endswith("/api"):
    API_BASE_URL = urljoin(API_BASE_URL, "/api")

# Remove trailing /api if present to avoid double /api
if API_BASE_URL.endswith("/api"):
    BASE_URL = API_BASE_URL.rsplit("/api", 1)[0]
else:
    BASE_URL = API_BASE_URL

API_ENDPOINT = urljoin(BASE_URL, "/api/")
print(f"Using API endpoint: {API_ENDPOINT}")


def get_books(limit: int = 500, offset: int = 0) -> list[dict]:
    """Fetch all books from the API."""
    try:
        url = f"{API_ENDPOINT}books"
        params = {"limit": limit, "offset": offset}
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        print("❌ ERROR: Cannot connect to API server")
        print(f"   Attempted URL: {API_ENDPOINT}books")
        print("   Make sure the server is running on the configured URL")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"❌ ERROR: HTTP {e.response.status_code} - {e.response.text}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {str(e)}")
        sys.exit(1)


def get_book_stats(book_id: int) -> Optional[dict]:
    """Fetch tree statistics for a book."""
    try:
        url = f"{API_ENDPOINT}books/{book_id}/tree"
        response = requests.get(url, params={"limit": 1}, timeout=10)
        if response.ok:
            nodes = response.json()
            return {"total_nodes": len(nodes)}
        return None
    except Exception:
        return None


def format_date(date_string: Optional[str]) -> str:
    """Format ISO date string to readable format."""
    if not date_string:
        return "Unknown"
    try:
        dt = datetime.fromisoformat(date_string.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return date_string


def get_metadata_value(metadata: Any, key: str, default: str = "—") -> str:
    """Safely get a value from metadata dictionary."""
    if not metadata or not isinstance(metadata, dict):
        return default
    value = metadata.get(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (list, dict)):
        return json.dumps(value)[:50] + "..." if len(str(value)) > 50 else json.dumps(value)
    return str(value).strip() or default


def print_book_details(book: dict, index: int, total: int) -> None:
    """Print detailed information for a single book."""
    metadata = book.get("metadata", {}) or book.get("metadata_json", {})
    schema = book.get("schema")
    
    print(f"\n{'='*80}")
    print(f"Book #{index}/{total}")
    print(f"{'='*80}")
    
    # Basic Info
    print(f"\n📕 BASIC INFORMATION")
    print(f"  ID:            {book.get('id')}")
    print(f"  Name:          {book.get('book_name', '—')}")
    print(f"  Code:          {book.get('book_code') or '—'}")
    print(f"  Language:      {book.get('language_primary', 'sanskrit')}")
    
    # Status & Visibility
    print(f"\n🔐 STATUS & VISIBILITY")
    print(f"  Status:        {get_metadata_value(metadata, 'status', book.get('status', '—'))}")
    print(f"  Visibility:    {get_metadata_value(metadata, 'visibility', book.get('visibility', '—'))}")
    print(f"  Owner ID:      {get_metadata_value(metadata, 'owner_id', '—')}")
    
    # Schema Info
    if schema:
        print(f"\n🏗️  SCHEMA INFORMATION")
        print(f"  Schema ID:     {schema.get('id')}")
        print(f"  Schema Name:   {schema.get('name')}")
        if schema.get('levels'):
            print(f"  Levels:        {', '.join(schema.get('levels', []))}")
    
    # Metadata
    print(f"\n📝 METADATA")
    print(f"  Title (EN):    {get_metadata_value(metadata, 'title_english', '—')}")
    print(f"  Title (SA):    {get_metadata_value(metadata, 'title_sanskrit', '—')}")
    print(f"  Title (Trans): {get_metadata_value(metadata, 'title_transliteration', '—')}")
    print(f"  Author:        {get_metadata_value(metadata, 'author', '—')}")
    print(f"  Description:   {get_metadata_value(metadata, 'description', '—')}")
    
    # Timestamps
    print(f"\n⏰ TIMESTAMPS")
    print(f"  Created:       {format_date(book.get('created_at'))}")
    print(f"  Updated:       {format_date(book.get('updated_at'))}")
    
    # Level Name Overrides
    if book.get('level_name_overrides'):
        print(f"\n🔤 LEVEL NAME OVERRIDES")
        for level, override in book.get('level_name_overrides', {}).items():
            print(f"  {level:20} → {override}")


def print_summary_table(books: list[dict]) -> None:
    """Print a summary table of all books."""
    if not books:
        print("\n❌ No books found in the system")
        return
    
    print(f"\n{'='*100}")
    print(f"BOOKS SUMMARY ({len(books)} total)")
    print(f"{'='*100}\n")
    
    # Group by status/visibility
    by_status = defaultdict(list)
    for book in books:
        metadata = book.get("metadata", {}) or book.get("metadata_json", {})
        status = get_metadata_value(metadata, 'status', 'unknown').lower()
        visibility = get_metadata_value(metadata, 'visibility', 'unknown').lower()
        by_status[f"{status}/{visibility}"].append(book)
    
    # Print summary
    for status_key in sorted(by_status.keys()):
        group = by_status[status_key]
        print(f"\n{status_key.upper()}: {len(group)} book(s)")
        print("-" * 100)
        print(f"{'ID':<6} {'Book Name':<35} {'Code':<12} {'Schema':<15} {'Owner':<8}")
        print("-" * 100)
        
        for book in group:
            book_id = str(book.get('id', '?'))
            book_name = str(book.get('book_name', '?'))[:34]
            book_code = str(book.get('book_code') or '—')[:11]
            schema = book.get('schema', {})
            schema_name = schema.get('name', '—')[:14] if schema else '—'
            metadata = book.get("metadata", {}) or book.get("metadata_json", {})
            owner_id = str(get_metadata_value(metadata, 'owner_id', '—'))[:7]
            
            print(f"{book_id:<6} {book_name:<35} {book_code:<12} {schema_name:<15} {owner_id:<8}")
    
    print("-" * 100)


def print_csv_export(books: list[dict], output_file: Optional[str] = None) -> None:
    """Export books to CSV format."""
    if not books:
        return
    
    import csv
    
    csv_data = []
    for book in books:
        metadata = book.get("metadata", {}) or book.get("metadata_json", {})
        schema = book.get("schema", {})
        
        csv_data.append({
            'id': book.get('id'),
            'book_name': book.get('book_name'),
            'book_code': book.get('book_code'),
            'language_primary': book.get('language_primary'),
            'schema_id': schema.get('id') if schema else None,
            'schema_name': schema.get('name') if schema else None,
            'status': get_metadata_value(metadata, 'status'),
            'visibility': get_metadata_value(metadata, 'visibility'),
            'owner_id': get_metadata_value(metadata, 'owner_id'),
            'title_english': get_metadata_value(metadata, 'title_english'),
            'title_sanskrit': get_metadata_value(metadata, 'title_sanskrit'),
            'title_transliteration': get_metadata_value(metadata, 'title_transliteration'),
            'author': get_metadata_value(metadata, 'author'),
            'description': get_metadata_value(metadata, 'description'),
            'created_at': book.get('created_at'),
            'updated_at': book.get('updated_at'),
        })
    
    if output_file:
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=csv_data[0].keys())
            writer.writeheader()
            writer.writerows(csv_data)
        print(f"\n✅ CSV exported to: {output_file}")
    else:
        print("\n📊 CSV Data:")
        writer = csv.DictWriter(sys.stdout, fieldnames=csv_data[0].keys())
        writer.writeheader()
        writer.writerows(csv_data)


def print_json_export(books: list[dict], output_file: Optional[str] = None) -> None:
    """Export books to JSON format."""
    if not books:
        return
    
    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(books, f, indent=2)
        print(f"\n✅ JSON exported to: {output_file}")
    else:
        print("\n📋 JSON Data:")
        print(json.dumps(books, indent=2))


def main():
    """Main entry point."""
    print("\n🏛️  Hindu Scriptures Platform - Book Listing Tool")
    print("=" * 80)
    
    # Fetch books
    print("\n📚 Fetching books from API...")
    books = get_books()
    
    if not books:
        print("❌ No books found in the system")
        return
    
    print(f"✅ Found {len(books)} book(s)\n")
    
    # Print summary table
    print_summary_table(books)
    
    # Print detailed information for each book
    print("\n\n" + "=" * 80)
    print("DETAILED BOOK INFORMATION")
    print("=" * 80)
    
    for i, book in enumerate(books, 1):
        print_book_details(book, i, len(books))
    
    # Export options
    print("\n\n" + "=" * 80)
    print("EXPORT OPTIONS")
    print("=" * 80)
    
    # Generate export filenames
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_file = f"books_export_{timestamp}.csv"
    json_file = f"books_export_{timestamp}.json"
    
    print("\n📊 Exporting to CSV and JSON formats...")
    print_csv_export(books, csv_file)
    print_json_export(books, json_file)
    
    print("\n✅ Book listing complete!")
    print(f"   Total books: {len(books)}")
    print(f"   CSV export: {csv_file}")
    print(f"   JSON export: {json_file}")


if __name__ == "__main__":
    main()
