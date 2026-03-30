#!/bin/bash

# Quick book listing script using curl
# Usage: ./list_books.sh [format] [limit] [API_URL]
# Examples:
#   ./list_books.sh json
#   ./list_books.sh table 50
#   ./list_books.sh csv 200 http://localhost:8000

set -e

API_URL="${3:-http://localhost:8000/api}"
FORMAT="${1:-json}"
LIMIT="${2:-500}"

echo "🏛️  Hindu Scriptures Platform - Quick Book Listing"
echo "=================================================="
echo ""
echo "📍 API URL: $API_URL"
echo "📏 Limit: $LIMIT"
echo "📋 Format: $FORMAT"
echo ""

case "$FORMAT" in
  json)
    echo "📥 Fetching books as JSON..."
    curl -s "$API_URL/books?limit=$LIMIT" | jq '.'
    ;;
  table|csv)
    echo "📥 Fetching books as table..."
    curl -s "$API_URL/books?limit=$LIMIT" | jq -r '
      ["ID", "Book Name", "Code", "Language", "Status", "Visibility"] as $headers |
      ($headers | @csv),
      (.[] | 
        [.id, .book_name, .book_code // "-", .language_primary, 
         (.metadata.status // .metadata_json.status // "?"),
         (.metadata.visibility // .metadata_json.visibility // "?")
        ] | @csv
      )
    ' | column -t -s, || true
    ;;
  count)
    echo "📥 Counting books..."
    RESULT=$(curl -s "$API_URL/books?limit=1" | jq 'length')
    echo "✅ Total books: $RESULT"
    ;;
  *)
    echo "❌ Unknown format: $FORMAT"
    echo ""
    echo "Available formats:"
    echo "  json    - JSON format (default)"
    echo "  table   - Pretty table format  "
    echo "  csv     - CSV format           "
    echo "  count   - Just count total     "
    echo ""
    echo "Usage: $0 [format] [limit] [API_URL]"
    exit 1
    ;;
esac

echo ""
echo "✅ Done!"
