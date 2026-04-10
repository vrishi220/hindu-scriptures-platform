import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from api.users import get_current_user_optional
from models.content_node import ContentNode
from models.search_query import SearchQuery
from models.schemas import ContentNodePublic, SearchRequest, SearchResponse, SearchResult
from models.user import User
from services import get_db
from services.transliteration import (
    contains_devanagari,
    get_latin_query_variants,
    latin_to_devanagari,
)

router = APIRouter(prefix="/search", tags=["search"])

_SEARCH_HARD_LIMIT = int(os.getenv("SEARCH_HARD_LIMIT", "50"))
_SEARCH_HARD_OFFSET = int(os.getenv("SEARCH_HARD_OFFSET", "500"))
_SEARCH_SKIP_COUNT = os.getenv("SEARCH_SKIP_COUNT", "true").strip().lower() in {"1", "true", "yes", "on"}

_TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL = {
    "en": "english",
    "eng": "english",
    "english": "english",
    "hi": "hindi",
    "hindi": "hindi",
    "te": "telugu",
    "telugu": "telugu",
    "kn": "kannada",
    "kannada": "kannada",
    "ta": "tamil",
    "tamil": "tamil",
    "ml": "malayalam",
    "malayalam": "malayalam",
    "sa": "sanskrit",
    "sanskrit": "sanskrit",
}

_TRANSLATION_CANONICAL_TO_CODE = {
    "english": "en",
    "hindi": "hi",
    "telugu": "te",
    "kannada": "kn",
    "tamil": "ta",
    "malayalam": "ml",
    "sanskrit": "sa",
}


def _normalize_translation_language(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return "en"
    canonical = _TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL.get(normalized, normalized)
    return _TRANSLATION_CANONICAL_TO_CODE.get(canonical, canonical)


def _translation_lookup_keys(language: str | None) -> list[str]:
    normalized_code = _normalize_translation_language(language)
    canonical = _TRANSLATION_LANGUAGE_ALIAS_TO_CANONICAL.get(normalized_code, "")
    keys = [normalized_code, canonical]
    if normalized_code == "en":
        keys.extend(["english", "en"])
    return [key for key in dict.fromkeys([item for item in keys if item])]


def _pick_translation_text_from_content_data(content_data: object, language: str | None) -> str:
    if not isinstance(content_data, dict):
        return ""

    translations = content_data.get("translations")
    basic = content_data.get("basic") if isinstance(content_data.get("basic"), dict) else {}
    fallback_values: list[str] = []
    if isinstance(basic, dict):
        for key in ("translation", "english"):
            value = basic.get(key)
            if isinstance(value, str) and value.strip():
                fallback_values.append(value.strip())

    if isinstance(translations, dict):
        for key in _translation_lookup_keys(language) + _translation_lookup_keys("en"):
            value = translations.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    for value in fallback_values:
        if value:
            return value

    return ""


def _clamp_search_window(limit: int, offset: int) -> tuple[int, int]:
    return min(limit, _SEARCH_HARD_LIMIT), min(offset, _SEARCH_HARD_OFFSET)


def _search_total(query, offset: int, rows_len: int) -> int:
    if _SEARCH_SKIP_COUNT:
        # In alpha/beta mode, avoid expensive full counts that can spill temp files.
        return offset + rows_len
    return query.count()


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
    language: str | None = None,
) -> tuple:
    if not text or not text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query required")

    # Content fields (normalized for display and search)
    sanskrit_raw = func.coalesce(ContentNode.content_data["basic"]["sanskrit"].astext, "")
    translit_raw = func.coalesce(
        ContentNode.content_data["basic"]["transliteration"].astext, ""
    )
    translation_keys = _translation_lookup_keys(language)
    english_keys = _translation_lookup_keys("en")
    translation_raw_candidates = [
        func.coalesce(ContentNode.content_data["translations"][key].astext, "")
        for key in [*translation_keys, *english_keys]
    ]
    translation_raw = func.coalesce(*translation_raw_candidates, "")
    all_translations_raw = func.coalesce(ContentNode.content_data["translations"].astext, "")
    word_meanings_raw = func.coalesce(
        ContentNode.content_data["word_meanings"].astext, ""
    )

    sanskrit = func.nullif(func.trim(sanskrit_raw), "")
    translit = func.nullif(func.trim(translit_raw), "")
    translation = func.nullif(func.trim(translation_raw), "")
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
        translation_raw,
        all_translations_raw,
        word_meanings_raw,
        title_english,
        title_sanskrit,
        title_translit,
        level_name_text,
    )

    display_combined = func.concat_ws("\n", sanskrit, translit, translation)
    snippet_source = func.coalesce(func.nullif(display_combined, ""), searchable_combined)
    
    # Check if search term is in quotes for exact matching
    search_text = text.strip()
    latin_query_variants = get_latin_query_variants(search_text)
    devanagari_query = (
        search_text if contains_devanagari(search_text) else latin_to_devanagari(search_text)
    )

    like_conditions = [
        func.lower(searchable_combined).like(f"%{variant.lower()}%")
        for variant in latin_query_variants
        if variant
    ]
    if devanagari_query:
        like_conditions.extend(
            [
                func.lower(sanskrit_raw).like(f"%{devanagari_query.lower()}%"),
                func.lower(title_sanskrit).like(f"%{devanagari_query.lower()}%"),
                func.lower(word_meanings_raw).like(f"%{devanagari_query.lower()}%"),
            ]
        )

    if not like_conditions:
        like_conditions.append(func.lower(searchable_combined).like("%"))

    if (search_text.startswith('"') and search_text.endswith('"')) or \
       (search_text.startswith("'") and search_text.endswith("'")):
        # Exact phrase matching - use ILIKE for case-insensitive substring match
        search_text = search_text[1:-1]
        # Escape special regex characters in search_text
        import re
        escaped_text = re.escape(search_text)
        
        query = db.query(ContentNode).filter(or_(*like_conditions))
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
        query = db.query(ContentNode).filter(or_(*like_conditions))
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
    language: str = "en",
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SearchResponse:
    query, rank, headline = build_search_query(db, q, book_id, level_name, has_content, language)
    limit, offset = _clamp_search_window(limit, offset)
    rows = (
        apply_stable_search_order(query.add_columns(rank, headline), rank)
        .limit(limit)
        .offset(offset)
        .all()
    )
    total = _search_total(query, offset, len(rows))
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
            "language": language,
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
        payload.language,
    )
    limit, offset = _clamp_search_window(payload.limit, payload.offset)
    rows = (
        apply_stable_search_order(query.add_columns(rank, headline), rank)
        .limit(limit)
        .offset(offset)
        .all()
    )
    total = _search_total(query, offset, len(rows))
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
            "language": payload.language,
            "limit": limit,
            "offset": offset,
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

    query_text = q.strip()
    normalized_language = _normalize_translation_language(language)
    latin_query_variants = get_latin_query_variants(query_text)
    devanagari_query = (
        query_text if contains_devanagari(query_text) else latin_to_devanagari(query_text)
    )
    
    # Build query with status = published visible to all
    query = db.query(ContentNode).filter(
        ContentNode.status == "published",
        ContentNode.has_content == True,
    )
    
    # Full-text search using TSVECTOR match
    # to_tsquery converts search text to tsquery format
    tsquery = func.plainto_tsquery('english', latin_query_variants[0] if latin_query_variants else query_text)
    fulltext_conditions = [ContentNode.search_vector.op('@@')(tsquery)]
    translations_raw = func.coalesce(ContentNode.content_data["translations"].astext, "")
    fulltext_conditions.extend(
        [
            func.lower(translations_raw).like(f"%{variant.lower()}%")
            for variant in latin_query_variants
            if variant
        ]
    )

    sanskrit_source = func.concat_ws(
        " ",
        func.coalesce(ContentNode.title_sanskrit, ""),
        func.coalesce(ContentNode.content_data["basic"]["sanskrit"].astext, ""),
    )
    sanskrit_tsvector = func.to_tsvector("simple", sanskrit_source)
    sanskrit_tsquery = None
    if devanagari_query:
        sanskrit_tsquery = func.plainto_tsquery("simple", devanagari_query)
        fulltext_conditions.append(sanskrit_tsvector.op("@@")(sanskrit_tsquery))

    query = query.filter(or_(*fulltext_conditions))
    
    # Apply filters
    if book_id is not None:
        query = query.filter(ContentNode.book_id == book_id)
    
    if tags:
        tag_list = [t.strip() for t in tags.split(',') if t.strip()]
        for tag in tag_list:
            query = query.filter(ContentNode.tags.contains([tag]))
    
    limit, offset = _clamp_search_window(limit, offset)
    
    # Rank by relevance (ts_rank)
    rank_expr = func.ts_rank(ContentNode.search_vector, tsquery)
    if sanskrit_tsquery is not None:
        rank_expr = func.greatest(rank_expr, func.ts_rank(sanskrit_tsvector, sanskrit_tsquery))
    rank = rank_expr.label("rank")
    
    # Get results with ranking
    rows = apply_stable_search_order(query.add_columns(rank), rank).offset(offset).limit(limit).all()
    total = _search_total(query, offset, len(rows))
    
    results = [
        SearchResult(
            node=ContentNodePublic.model_validate(row[0]),
            snippet=extract_snippet(row[0], q, language=normalized_language),
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


def extract_snippet(
    node: ContentNode,
    query: str,
    max_length: int = 150,
    language: str | None = None,
) -> str | None:
    """Extract a snippet from content_data with query highlighted"""
    text = ""
    if node.content_data and isinstance(node.content_data, dict):
        text = _pick_translation_text_from_content_data(node.content_data, language)
        if not text:
            text = (
                node.content_data.get("text")
                or node.content_data.get("english")
                or node.content_data.get("translation")
                or ""
            )
    
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
