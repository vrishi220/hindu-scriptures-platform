# 📚 Book Listing Tools - Quick Reference Card

## One-Command Book Listing

```bash
# Get all books NOW (no setup needed)
python list_books_direct.py

# Get detailed stats and export
python list_all_books.py

# Quick shell command
curl http://localhost:8000/api/books | jq '.'
```

---

## What You'll See

```
✅ Found 42 book(s)

📊 By Status:
   draft         39 books
   published      1 books

🔐 By Visibility:
   private       39 books
   public         1 books

Result: JSON file + Console output
```

---

## Three Tools for Three Scenarios

| I want to... | Use this | Time |
|---|---|---|
| **See books NOW** (default) | `list_books_direct.py` | 2s |
| **Export data** (to CSV) | `list_all_books.py` | 3s |
| **Quick shell check** | `./list_books.sh count` | 1s |

---

## Common Commands

```bash
# 1. List all books
python list_books_direct.py

# 2. Pretty table
./list_books.sh table

# 3. Count only
./list_books.sh count

# 4. Export to files (auto-generated)
python list_all_books.py
# Creates: books_export_*.csv and books_export_*.json

# 5. View JSON export
jq '.' books_*.json | less

# 6. Find specific book
jq '.[] | select(.book_name | contains("Gita"))' books_*.json

# 7. Count books by schema
jq 'group_by(.schema.name) | length' books_*.json
```

---

## Output Locations

| Format | File | Created By |
|--------|------|-----------|
| JSON | `books_*.json` | list_books_direct.py |
| CSV | `books_export_*.csv` | list_all_books.py |
| Screen | (console output) | All |

---

## Current Database

- **Total:** 42 books
- **Published:** 1
- **Draft:** 39
- **Status:** ✅ Ready to query

Last checked: March 29, 2024

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `ModuleNotFoundError` | Run from project root |
| `Cannot connect` | Check .env file |
| `No books found` | Database might be empty |
| `jq not found` | Install: `brew install jq` |

---

## Setup (if needed)

```bash
# 1. Navigate to project
cd /Users/rishivangapalli/repos/hindu-scriptures-platform

# 2. Configure environment
source .env

# 3. Run listing tool
python list_books_direct.py
```

---

## Next Steps

1. ✅ **List books** → `python list_books_direct.py`
2. **Check export** → `cat books_*.json`
3. **Browse web UI** → http://localhost:3000
4. **Create new book** → Web UI → Books → Create
5. **Edit book** → Click book → Edit

---

## Full Guides

- 📖 **Quick Start:** `HOW_TO_LIST_BOOKS.md`
- 📘 **API Reference:** `BOOK_LISTING_GUIDE.md`
- 📄 **Full Summary:** `BOOK_LISTING_TOOLS_SUMMARY.md`

---

## Commands Reference

### Python Scripts
```bash
# Direct database (fastest, no API)
python list_books_direct.py

# Via API (most features)
python list_all_books.py
```

### Shell Script
```bash
# Available formats
./list_books.sh json          # Raw JSON
./list_books.sh table         # ASCII table
./list_books.sh csv           # Comma-separated
./list_books.sh count         # Just count
```

### Manual cURL
```bash
# Basic query
curl http://localhost:8000/api/books

# With limit
curl "http://localhost:8000/api/books?limit=10"

# Search
curl "http://localhost:8000/api/books?q=Gita"

# Pretty-print
curl -s http://localhost:8000/api/books | jq '.'
```

---

## Export Data

```bash
# JSON (automatic, both scripts)
jq '.' books_*.json > backup.json

# CSV from JSON
jq -r '["ID","Name","Status"] | @csv, (.[] | [.id, .book_name, .metadata_json.status] | @csv)' books_*.json > books.csv

# Filter export (published only)
jq '.[] | select(.metadata_json.status == "published")' books_*.json > published_only.json
```

---

## Performance

| Operation | Time | Size |
|-----------|------|------|
| List 42 books | ~2s | 42KB JSON |
| Export CSV | ~1s | 15KB |
| Query single book | <1s | 1KB |

---

**Ready to use!** → `python list_books_direct.py`
