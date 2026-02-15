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


def build_search_query(
    db: Session,
    text: str,
    book_id: int | None,
    level_name: str | None,
    has_content: bool | None,
) -> tuple:
    if not text or not text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query required")

    # Content fields
    sanskrit = func.coalesce(ContentNode.content_data["basic"]["sanskrit"].astext, "")
    translit = func.coalesce(
        ContentNode.content_data["basic"]["transliteration"].astext, ""
    )
    english = func.coalesce(
        ContentNode.content_data["translations"]["english"].astext, ""
    )
    # Title fields
    title_english = func.coalesce(ContentNode.title_english, "")
    title_sanskrit = func.coalesce(ContentNode.title_sanskrit, "")
    title_translit = func.coalesce(ContentNode.title_transliteration, "")
    # Level name field
    level_name_text = func.coalesce(ContentNode.level_name, "")
    
    combined = func.concat_ws(" ", sanskrit, translit, english, title_english, title_sanskrit, title_translit, level_name_text)
    
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
            func.lower(combined).like(f"%{search_text.lower()}%")
        )
        # Shorter texts rank higher (invert length)
        rank = (10000 - func.length(combined)).label("rank")
        # Highlight the matched text with <mark> tags using case-insensitive regex
        # Use a capturing group and backreference (\1 refers to first captured group)
        headline = func.regexp_replace(
            combined,
            f"({escaped_text})",
            r"<mark>\1</mark>",
            "gi"
        ).label("snippet")
    else:
        # Partial/prefix matching - use ILIKE for broader matching
        query = db.query(ContentNode).filter(
            func.lower(combined).like(f"%{search_text.lower()}%")
        )
        rank = (10000 - func.length(combined)).label("rank")
        
        # Try to highlight with regex
        import re
        escaped = re.sub(r'([\\.\[\]\(\)\{\}\^\$\*\+\?\|])', r'\\\1', search_text)
        headline = func.regexp_replace(
            combined,
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
        query.add_columns(rank, headline)
        .order_by(rank.desc())
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
        query.add_columns(rank, headline)
        .order_by(rank.desc())
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
