# How to List Books in the Hindu Scriptures Platform

## Overview

We've created three complementary tools to list books in the platform:

| Tool | Best For | Requires |
|------|----------|----------|
| **list_books_direct.py** | Getting started quickly | Python, models in path |
| **list_all_books.py** | Comprehensive inventory | Python + running API |
| **list_books.sh** | Quick shell queries | cURL + jq (optional) |

---

## Quick Start (3 Steps)

### Step 1: Navigate to Project Root
```bash
cd /Users/rishivangapalli/repos/hindu-scriptures-platform
```

### Step 2: Choose Your Tool

**Option A: Direct Database Access (Fastest)**
```bash
python list_books_direct.py
```
- Works immediately without API
- Shows first 3 books in detail
- Saves results to JSON

**Option B: Via API (Most Features)**
```bash
# Make sure API is running first:
python main.py  # in another terminal

# Then run:
python list_all_books.py
```
- Comprehensive metadata
- Exports to CSV and JSON
- Better error handling

**Option C: Shell Command (Simplest)**
```bash
# Try different formats:
./list_books.sh json           # Raw JSON
./list_books.sh table          # Pretty table
./list_books.sh csv            # CSV format
./list_books.sh count          # Just count
```

### Step 3: View Results
- JSON file: `books_*.json` (created automatically)
- CSV file: `books_*.csv` (created automatically)
- Terminal: Output printed to screen

---

## Detailed Usage

### Method 1: Direct Database Access

**Best when:** You want results immediately without starting the server

**Usage:**
```bash
python list_books_direct.py
```

**Output:**
- Console display with statistics
- JSON export: `books_YYYYMMDD_HHMMSS.json`
- Shows: Summary stats, book table, detailed view of first 3 books

**Example Output:**
```
🏛️  Hindu Scriptures Platform - Book Listing Tool

✅ Found 5 book(s) (from database)

================================================================================
  SUMMARY STATISTICS
================================================================================

📊 By Status:
   draft          2 books
   published      3 books

🔐 By Visibility:
   private        2 books
   public         3 books

... (table and details follow)
```

### Method 2: Complete API Access

**Best when:** You need maximum features and flexibility

**Prerequisites:**
```bash
# Ensure API is running in another terminal
python main.py
# Or: uvicorn main:app --reload
```

**Usage:**
```bash
python list_all_books.py
```

**Output:**
- Console displays: Summary table → Detailed info → Export summary
- JSON export: `books_export_YYYYMMDD_HHMMSS.json`
- CSV export: `books_export_YYYYMMDD_HHMMSS.csv`
- Color-coded sections for readability

**Features:**
- ✅ Groups books by status/visibility
- ✅ Shows schema info and level overrides
- ✅ Exports to both CSV and JSON
- ✅ Better error messages
- ✅ Paginated results support

### Method 3: Shell Script

**Best when:** You want quick ad-hoc queries

**Basic Usage:**
```bash
# Format 1: JSON (default)
./list_books.sh
./list_books.sh json

# Format 2: Table (pretty)
./list_books.sh table

# Format 3: CSV
./list_books.sh csv

# Format 4: Count
./list_books.sh count
```

**With Custom Parameters:**
```bash
# Custom limit
./list_books.sh json 50

# Custom API URL
./list_books.sh json 100 http://api.example.com:8000/api

# Combine both
./list_books.sh table 25 http://localhost:9000/api
```

**Filtering Examples:**
```bash
# Get just book names
curl -s http://localhost:8000/api/books | jq '.[].book_name'

# Get published books
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata_json.status == "published")'

# Get public books
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata_json.visibility == "public") | .book_name'

# Get books by specific schema
curl -s http://localhost:8000/api/books | jq '.[] | select(.schema.id == 1)'
```

---

## Common Tasks

### Find Books by Status

```bash
# Published books
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata_json.status == "published")'

# Draft books
python -c "import json; b=json.load(open('books_*.json')); [print(x['book_name']) for x in b if 'metadata_json' in x and x['metadata_json'].get('status') == 'draft']"
```

### Find Books by Visibility

```bash
# Public books
python list_books_direct.py | grep "Visibility.*public"

# Private books (from API)
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata_json.visibility == "private") | .book_name'
```

### Export to Spreadsheet

```bash
# Via Python (creates CSV automatically)
python list_all_books.py

# Via cURL and jq
curl -s http://localhost:8000/api/books | jq -r '
  ["ID", "Name", "Code", "Language", "Status"] as $h |
  ($h | @csv),
  (.[] | 
    [.id, .book_name, .book_code, .language_primary, 
     .metadata_json.status
    ] | @csv
  )
' > books.csv
```

### Count Books by Schema

```bash
# From direct database (shows in output)
python list_books_direct.py | grep "By Schema" -A 10

# From API with jq
curl -s http://localhost:8000/api/books | jq 'group_by(.schema.name) | map({schema: .[0].schema.name, count: length})'
```

### Get Book Details

```bash
# Get specific book
curl http://localhost:8000/api/books/1 | jq '.'

# Get book tree/structure
curl http://localhost:8000/api/books/1/tree | jq '.' | head -50
```

---

## Understanding the Output

### Fields Explained

| Field | Example | Meaning |
|-------|---------|---------|
| `id` | 1 | Unique book identifier |
| `book_name` | "Bhagavad Gita" | Display name |
| `book_code` | "BG" | Short code (often initials) |
| `language_primary` | "sanskrit" | Main language |
| `schema_id` | 1 | Reference to hierarchy template |
| `status` | "published" | draft or published |
| `visibility` | "public" | private or public |
| `owner_id` | 2 | User ID of the book owner |

### Status vs Visibility

| Status | Meaning |
|--------|---------|
| **draft** | Work in progress, not ready |
| **published** | Complete and finalized |

| Visibility | Meaning |
|------------|---------|
| **private** | Only owner/shared users can see |
| **public** | Anyone can view |

---

## Troubleshooting

### "No books found"

**Causes:**
1. Database is empty
2. All books are private (need auth)
3. Wrong API URL

**Solutions:**
```bash
# Check if database has any books
python list_books_direct.py

# Create a test book via web UI first

# Or verify API connection
curl http://localhost:8000/api/books | head
```

### "Cannot connect to API"

**For list_all_books.py:**
```bash
# Make sure server is running
python main.py

# In another terminal
python list_all_books.py
```

**For list_books.sh:**
```bash
# Verify API accessible
curl http://localhost:8000/api/books

# Or check specific URL
./list_books.sh count http://api.example.com:8000/api
```

### "jq: command not found"

For shell script table format:

**macOS:**
```bash
brew install jq
```

**Linux:**
```bash
apt-get install jq  # Debian/Ubuntu
yum install jq      # CentOS/RHEL
```

Or just use JSON format without jq:
```bash
./list_books.sh json
```

### Import Errors with list_books_direct.py

**Error:** `ModuleNotFoundError: No module named 'models'`

**Solution:**
```bash
# Run from project root
cd /Users/rishivangapalli/repos/hindu-scriptures-platform

# Or set PYTHONPATH
PYTHONPATH=. python list_books_direct.py
```

---

## Output Examples

### Example 1: Summary Statistics
```
📊 By Status:
   draft          2 books
   published      3 books

🔐 By Visibility:
   private        2 books
   public         3 books
```

### Example 2: Book Table
```
    │ ID    │ Name                           │ Code       │ Lg  │ Schema          │ Status   │ Visibility
────┼───────┼────────────────────────────────┼────────────┼─────┼─────────────────┼──────────┼──────────
  1 │ 1     │ Bhagavad Gita                  │ BG         │ sa  │ Verse Structure │ published│ public
  2 │ 2     │ Rigveda                        │ RV         │ sa  │ Hymn Structure  │ draft    │ private
```

### Example 3: Detailed Book Info
```
📕 Book #1
   ID:        1
   Name:      Bhagavad Gita
   Code:      BG
   Language:  sanskrit
   Schema:    Verse Structure (ID: 1)
   Levels:    chapter, verse
   Status:    published
   Visibility:public
```

---

## Advanced Usage

### Custom API Parameters

```bash
# Get only 10 books
curl "http://localhost:8000/api/books?limit=10"

# Skip first 20 books (pagination)
curl "http://localhost:8000/api/books?limit=50&offset=20"

# Search for books matching query
curl "http://localhost:8000/api/books?q=Gita"
```

### Parse JSON Output

```bash
# Extract just names and IDs
curl -s http://localhost:8000/api/books | jq '.[] | {id, name: .book_name}'

# Create a lookup table
curl -s http://localhost:8000/api/books | jq 'map({id, name: .book_name}) | from_entries'

# Count public vs private
curl -s http://localhost:8000/api/books | jq 'group_by(.metadata_json.visibility) | map({visibility: .[0].metadata_json.visibility, count: length})'
```

---

## Tips & Tricks

1. **Save for Later**
   ```bash
   python list_books_direct.py  # Saves to JSON automatically
   # Later: jq '.' books_*.json
   ```

2. **Compare Results**
   ```bash
   python list_all_books.py
   # Automatically creates timestamped exports
   # Compare: diff books_export_*.csv
   ```

3. **Quick Summary**
   ```bash
   ./list_books.sh count  # Just get count
   ```

4. **Monitor Changes**
   ```bash
   # Run periodically and compare
   watch -n 5 './list_books.sh count'
   ```

5. **Format as Table**
   ```bash
   ./list_books.sh table | less  # Scrollable table
   ```

---

## Next Steps

After listing books:

1. **Create new book:** Web UI → Books → Create
2. **Edit book:** Click on book → Edit
3. **Add content:** Click book → Add chapter/verse
4. **Share book:** Book settings → Share
5. **Publish book:** Book settings → Publish

---

## Support

If you have issues:

1. Check the **Troubleshooting** section above
2. Review [BOOK_LISTING_GUIDE.md](BOOK_LISTING_GUIDE.md) for API details
3. Check [QUICK_START.md](QUICK_START.md) for general setup
4. Look at [README.md](README.md) for architecture overview

---

**Last Updated:** 2024-03-29
**Scripts Location:** `/Users/rishivangapalli/repos/hindu-scriptures-platform/`
