from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.users import get_current_user_optional
from models.content_node import ContentNode
from models.search_query import SearchQuery
from models.schemas import ContentNodePublic, SearchRequest, SearchResponse, SearchResult
from models.user import User
from services import get_db

router = APIRouter(prefix="/search", tags=["search"])


def apply_stable_search_order(query, rank):
    return query.order_by(
        rank.desc(),
        ContentNode.book_id.asc(),
        func.coalesce(ContentNode.level_order, 0).asc(),
        ContentNode.id.asc(),
    )


def build_search_query(
    db: Session,
    text: str,
    book_id: int | None,
    level_name: str | None,
    has_content: bool | None,
) -> tuple:
    if not text or not text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query required")

    # Content fields (normalized for display and search)
    sanskrit_raw = func.coalesce(ContentNode.content_data["basic"]["sanskrit"].astext, "")
    translit_raw = func.coalesce(
        ContentNode.content_data["basic"]["transliteration"].astext, ""
    )
    english_raw = func.coalesce(
        ContentNode.content_data["translations"]["english"].astext, ""
    )

    sanskrit = func.nullif(func.trim(sanskrit_raw), "")
    translit = func.nullif(func.trim(translit_raw), "")
    english = func.nullif(func.trim(english_raw), "")
    # Title fields
    title_english = func.coalesce(ContentNode.title_english, "")
    title_sanskrit = func.coalesce(ContentNode.title_sanskrit, "")
    title_translit = func.coalesce(ContentNode.title_transliteration, "")
    # Level name field
    level_name_text = func.coalesce(ContentNode.level_name, "")
    
    searchable_combined = func.concat_ws(
        " ",
        sanskrit_raw,
        translit_raw,
        english_raw,
        title_english,
        title_sanskrit,
        title_translit,
        level_name_text,
    )

    display_combined = func.concat_ws("\n", sanskrit, translit, english)
    snippet_source = func.coalesce(func.nullif(display_combined, ""), searchable_combined)
    
    # Check if search term is in quotes for exact matching
    search_text = text.strip()
    if (search_text.startswith('"') and search_text.endswith('"')) or \
       (search_text.startswith("'") and search_text.endswith("'")):
        # Exact phrase matching - use ILIKE for case-insensitive substring match
        search_text = search_text[1:-1]
        # Escape special regex characters in search_text
        import re
        escaped_text = re.escape(search_text)
        
        query = db.query(ContentNode).filter(
            func.lower(searchable_combined).like(f"%{search_text.lower()}%")
        )
        # Shorter texts rank higher (invert length)
        rank = (10000 - func.length(searchable_combined)).label("rank")
        # Highlight the matched text with <mark> tags using case-insensitive regex
        # Use a capturing group and backreference (\1 refers to first captured group)
        headline = func.regexp_replace(
            snippet_source,
            f"({escaped_text})",
            r"<mark>\1</mark>",
            "gi"
        ).label("snippet")
    else:
        # Partial/prefix matching - use ILIKE for broader matching
        query = db.query(ContentNode).filter(
            func.lower(searchable_combined).like(f"%{search_text.lower()}%")
        )
        rank = (10000 - func.length(searchable_combined)).label("rank")
        
        # Try to highlight with regex
        import re
        escaped = re.sub(r'([\\.\[\]\(\)\{\}\^\$\*\+\?\|])', r'\\\1', search_text)
        headline = func.regexp_replace(
            snippet_source,
            f"({escaped})",
            r"<mark>\1</mark>",
            "gi"
        ).label("snippet")

    # Apply filters for both modes
    if book_id is not None:
        query = query.filter(ContentNode.book_id == book_id)
    if level_name:
        query = query.filter(ContentNode.level_name == level_name)
    if has_content is not None:
        query = query.filter(ContentNode.has_content == has_content)

    return query, rank, headline


def log_search(
    db: Session,
    user: User | None,
    text: str,
    filters: dict,
    results_count: int,
) -> None:
    entry = SearchQuery(
        user_id=user.id if user else None,
        query_text=text,
        filters=filters,
        results_count=results_count,
    )
    db.add(entry)
    db.commit()


@router.get("", response_model=SearchResponse)
def basic_search(
    q: str = Query(..., min_length=1),
    book_id: int | None = None,
    level_name: str | None = None,
    has_content: bool | None = None,
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SearchResponse:
    query, rank, headline = build_search_query(db, q, book_id, level_name, has_content)
    total = query.count()
    rows = (
        apply_stable_search_order(query.add_columns(rank, headline), rank)
        .limit(limit)
        .offset(offset)
        .all()
    )
    results = [
        SearchResult(node=ContentNodePublic.model_validate(row[0]), snippet=row[2])
        for row in rows
    ]
    log_search(
        db,
        current_user,
        q,
        {
            "book_id": book_id,
            "level_name": level_name,
            "has_content": has_content,
            "limit": limit,
            "offset": offset,
        },
        total,
    )
    return SearchResponse(query=q, total=total, results=results)


@router.post("/advanced", response_model=SearchResponse)
def advanced_search(
    payload: SearchRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SearchResponse:
    query, rank, headline = build_search_query(
        db,
        payload.text,
        payload.book_id,
        payload.level_name,
        payload.has_content,
    )
    total = query.count()
    rows = (
        apply_stable_search_order(query.add_columns(rank, headline), rank)
        .limit(payload.limit)
        .offset(payload.offset)
        .all()
    )
    results = [
        SearchResult(node=ContentNodePublic.model_validate(row[0]), snippet=row[2])
        for row in rows
    ]
    log_search(
        db,
        current_user,
        payload.text,
        {
            "book_id": payload.book_id,
            "level_name": payload.level_name,
            "has_content": payload.has_content,
            "limit": payload.limit,
            "offset": payload.offset,
        },
        total,
    )
    return SearchResponse(query=payload.text, total=total, results=results)


# === Phase 1: Full-Text Search (using TSVECTOR) ===
@router.get("/fulltext", response_model=SearchResponse)
def fulltext_search(
    q: str = Query(..., min_length=1),
    book_id: int | None = None,
    tags: str | None = None,  # Comma-separated tags to filter
    language: str = "en",
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SearchResponse:
    """
    Full-text search using PostgreSQL TSVECTOR.
    Faster and more accurate than basic string matching.
    """
    if not q or not q.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Query required"
        )
    
    # Build query with status = published visible to all
    query = db.query(ContentNode).filter(
        ContentNode.status == "published",
        ContentNode.has_content == True,
    )
    
    # Full-text search using TSVECTOR match
    # to_tsquery converts search text to tsquery format
    tsquery = func.plainto_tsquery('english', q)
    query = query.filter(ContentNode.search_vector.op('@@')(tsquery))
    
    # Apply filters
    if book_id is not None:
        query = query.filter(ContentNode.book_id == book_id)
    
    if tags:
        tag_list = [t.strip() for t in tags.split(',') if t.strip()]
        for tag in tag_list:
            query = query.filter(ContentNode.tags.contains([tag]))
    
    # Count total before pagination
    total = query.count()
    
    # Rank by relevance (ts_rank)
    rank = func.ts_rank(ContentNode.search_vector, tsquery).label("rank")
    
    # Get results with ranking
    rows = apply_stable_search_order(query.add_columns(rank), rank).offset(offset).limit(limit).all()
    
    results = [
        SearchResult(
            node=ContentNodePublic.model_validate(row[0]),
            snippet=extract_snippet(row[0], q)
        )
        for row in rows
    ]
    
    # Log search
    log_search(
        db,
        current_user,
        q,
        {
            "book_id": book_id,
            "tags": tags,
            "language": language,
            "limit": limit,
            "offset": offset,
        },
        total,
    )
    
    return SearchResponse(query=q, total=total, results=results)


def extract_snippet(node: ContentNode, query: str, max_length: int = 150) -> str | None:
    """Extract a snippet from content_data with query highlighted"""
    # Try to extract from English translation first
    if node.content_data and isinstance(node.content_data, dict):
        text = node.content_data.get('text') or node.content_data.get('english', '')
    else:
        text = ""
    
    if not text:
        return None
    
    # Find first occurrence of query in text
    lower_text = text.lower()
    query_lower = query.lower()
    idx = lower_text.find(query_lower)
    
    if idx == -1:
        # Not found, return first max_length chars
        return text[:max_length] + ("..." if len(text) > max_length else "")
    
    # Extract snippet around match
    start = max(0, idx - 50)
    end = min(len(text), idx + len(query) + 100)
    snippet = text[start:end]
    
    # Add ellipsis if not at boundaries
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    
    return snippet
