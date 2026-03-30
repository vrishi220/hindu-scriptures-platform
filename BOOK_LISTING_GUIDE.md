# Book Listing Tools

This directory contains tools for discovering and managing books in the Hindu Scriptures Platform.

## Quick Start

### 1. Using Python Script (Recommended)

The Python script provides the most comprehensive book listing with detailed metadata and multiple export formats.

#### Installation
```bash
# Make sure dependencies are installed
pip install requests python-dotenv
```

#### Usage
```bash
# List all books with detailed information
python list_all_books.py

# Or run directly with shebang
./list_all_books.py
```

**Features:**
- ✅ Displays all books with complete metadata
- ✅ Shows book status (draft/published) and visibility (private/public)
- ✅ Displays schema information and level overrides
- ✅ Exports to CSV and JSON formats automatically
- ✅ Groups books by status/visibility category
- ✅ Color-coded output for better readability
- ✅ Handles connection errors gracefully

#### Output Locations
By default, exports are saved to:
- `books_export_YYYYMMDD_HHMMSS.csv` - Spreadsheet format
- `books_export_YYYYMMDD_HHMMSS.json` - JSON format

### 2. Using Quick Shell Script

Fast book listing via command line without Python dependencies.

#### Usage
```bash
# Make executable
chmod +x list_books.sh

# List in JSON format (default)
./list_books.sh

# List as formatted table
./list_books.sh table

# Get just the count
./list_books.sh count 

# Specify custom API URL
./list_books.sh json 500 http://example.com:8000/api
```

#### Available Formats
- `json` - Raw JSON output
- `table` - Pretty ASCII table
- `csv` - Comma-separated values
- `count` - Just the total count

### 3. Using cURL Directly

For manual API queries without any scripts:

```bash
# List all books (default limit 200)
curl http://localhost:8000/api/books

# With custom limit
curl "http://localhost:8000/api/books?limit=100&offset=0"

# Pretty print with jq
curl -s http://localhost:8000/api/books | jq '.'

# Get just book names
curl -s http://localhost:8000/api/books | jq '.[].book_name'

# Get book by ID
curl http://localhost:8000/api/books/1

# Export to file
curl http://localhost:8000/api/books > books.json
```

## Book Structure

Each book object contains:

```json
{
  "id": 1,
  "book_name": "Bhagavad Gita",
  "book_code": "BG",
  "language_primary": "sanskrit",
  "schema": {
    "id": 1,
    "name": "Verse Structure",
    "levels": ["chapter", "verse"]
  },
  "metadata": {
    "title_english": "Bhagavad Gita",
    "title_sanskrit": "भगवद्गीता",
    "author": "Vyasa",
    "status": "published",
    "visibility": "public",
    "owner_id": 1
  },
  "level_name_overrides": {
    "chapter": "Chapter",
    "verse": "Verse"
  },
  "created_at": "2024-01-01T12:00:00Z",
  "updated_at": "2024-01-15T12:00:00Z"
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `id` | Unique book identifier |
| `book_name` | Display name for the book |
| `book_code` | Short code (unique within schema) |
| `language_primary` | Primary language (sanskrit/english) |
| `schema_id` | Reference to content structure schema |
| `metadata` | Custom metadata (author, titles, descriptions, etc.) |
| `level_name_overrides` | Custom names for hierarchy levels |
| `status` | draft or published |
| `visibility` | private or public |
| `owner_id` | User ID of book owner |

## API Endpoint Reference

### List Books
```
GET /api/books
```

**Query Parameters:**
- `q` (string) - Search query for book name/code
- `limit` (int) - Results per page (1-500, default 200)
- `offset` (int) - Pagination offset (default 0)

**Response:**
Array of book objects

**Examples:**
```bash
# Get first 50 books
curl "localhost:8000/api/books?limit=50"

# Search for books containing "Gita"
curl "localhost:8000/api/books?q=Gita"

# Paginate through results
curl "localhost:8000/api/books?limit=100&offset=0"
curl "localhost:8000/api/books?limit=100&offset=100"
```

### Get Single Book
```
GET /api/books/{book_id}
```

**Response:**
Single book object with schema details

**Example:**
```bash
curl localhost:8000/api/books/1 | jq '.'
```

### Get Book Tree (Hierarchy)
```
GET /api/books/{book_id}/tree
```

**Response:**
Array of content nodes representing the book's structure

**Example:**
```bash
# Get tree structure of book 1
curl localhost:8000/api/books/1/tree | jq '.'
```

## Configuration

### Environment Variables

Set these in `.env` file:

```bash
# API Base URL
API_URL=http://localhost:8000/api

# Database URL (if needed)
DATABASE_URL=postgresql://user:password@localhost/scriptures_db
```

## Examples

### Example 1: List all published books

```bash
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata.status == "published")'
```

### Example 2: Export all books to CSV

```bash
python list_all_books.py  # Automatically generates CSV
```

Or manually:
```bash
curl -s http://localhost:8000/api/books | jq -r '
  ["ID", "Name", "Code", "Language"] as $headers |
  ($headers | @csv),
  (.[] | [.id, .book_name, .book_code, .language_primary] | @csv)
' > books.csv
```

### Example 3: Find private books

```bash
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata.visibility == "private") | .book_name'
```

### Example 4: Get all books by a specific owner

```bash
curl -s http://localhost:8000/api/books | jq '.[] | select(.metadata.owner_id == 5)'
```

### Example 5: List all available schemas

```bash
curl http://localhost:8000/api/schemas
```

## Server Setup

Make sure the API server is running:

```bash
# Development
python main.py

# Or with uvicorn
uvicorn main:app --reload

# Production (with gunicorn)
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

The server should be accessible at `http://localhost:8000` by default.

## Troubleshooting

### Connection Error

**Error:** `Cannot connect to API server`

**Solution:**
1. Check if the server is running: `curl http://localhost:8000/health`
2. Update `API_URL` in environment or script
3. Check network connectivity

### No Books Found

**Error:** `No books found in the system`

**Possible causes:**
- Database is empty (no books created yet)
- User doesn't have permission to view any books
- Authentication required (books are private)

**Solution:**
1. Create a test book via the web UI
2. Check authentication: `curl -i http://localhost:8000/api/books`
3. Verify user permissions

### JSON Parsing Error

**Error:** `jq: parse error`

**Solution:**
- Ensure jq is installed: `brew install jq` (macOS) or `apt-get install jq` (Linux)
- Verify API returns valid JSON: `curl -i http://localhost:8000/api/books`

## Performance Notes

- Default limit is 200 books per request (max 500)
- For large datasets (>1000 books), use pagination
- CSV export is better than JSON for spreadsheet analysis
- Use `?limit=1` with `jq length` for quick count

## Related Documentation

- API Documentation: See `/README.md`
- Book Management Guide: See `QUICK_START.md`
- Schema Reference: See `models/schemas.py`
- Database Schema: See `schema.sql`

## Contributing

To add new book listing features:

1. Edit `list_all_books.py` for Python enhancements
2. Edit `list_books.sh` for shell script improvements
3. Ensure backward compatibility with existing API
4. Test with various book configurations
5. Update this documentation

## License

Same as main project
