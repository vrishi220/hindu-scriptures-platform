import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from openai import OpenAI
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from services import get_db

router = APIRouter(prefix="/search", tags=["search"])

SEMANTIC_SEARCH_HARD_LIMIT = int(os.getenv("SEMANTIC_SEARCH_HARD_LIMIT", "100"))
EMBEDDING_MODEL = "text-embedding-3-small"


class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    language_code: str = Field(default="en")
    book_codes: list[str] | None = None
    content_type: str = Field(default="translation")
    limit: int = Field(default=20, ge=1)
    similarity_threshold: float = Field(default=0.5, ge=0.0, le=1.0)


class SemanticSearchResult(BaseModel):
    node_id: int
    book_name: str
    book_code: str | None
    sequence_number: str | None
    similarity: float
    translation: str
    sanskrit: str


class SemanticSearchResponse(BaseModel):
    query: str
    language_code: str
    results: list[SemanticSearchResult]
    total: int


def _normalize_content_type(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in {"translation", "sanskrit", "commentary"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="content_type must be one of: translation, sanskrit, commentary",
        )
    return normalized


def _get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY is not configured",
        )
    return OpenAI(api_key=api_key)


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.10f}" for value in values) + "]"


def _extract_texts(content_data: Any, language_code: str) -> tuple[str, str]:
    if not isinstance(content_data, dict):
        return "", ""

    basic = content_data.get("basic") if isinstance(content_data.get("basic"), dict) else {}
    translations = content_data.get("translations") if isinstance(content_data.get("translations"), dict) else {}

    sanskrit = str(basic.get("sanskrit") or "").strip()
    translation = str(translations.get(language_code) or "").strip()
    if not translation:
        translation = str(translations.get("en") or translations.get("english") or basic.get("translation") or "").strip()

    return translation, sanskrit


@router.post("/semantic", response_model=SemanticSearchResponse)
def semantic_search(
    payload: SemanticSearchRequest,
    db: Session = Depends(get_db),
) -> SemanticSearchResponse:
    query_text = payload.query.strip()
    if not query_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="query is required")

    language_code = str(payload.language_code or "en").strip().lower() or "en"
    content_type = _normalize_content_type(payload.content_type)
    limit = min(int(payload.limit), SEMANTIC_SEARCH_HARD_LIMIT)
    threshold = float(payload.similarity_threshold)

    client = _get_openai_client()
    try:
        embedding_response = client.embeddings.create(
            input=query_text,
            model=EMBEDDING_MODEL,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Embedding failed: {exc}") from exc

    query_embedding = embedding_response.data[0].embedding
    query_embedding_literal = _vector_literal(query_embedding)

    sql_base = """
        SELECT
            cn.id AS node_id,
            cn.book_id,
            cn.sequence_number,
            cn.level_name,
            cn.content_data,
            b.book_name,
            b.book_code,
            1 - (ne.embedding <=> :query_embedding::vector) AS similarity
        FROM node_embeddings ne
        JOIN content_nodes cn ON ne.node_id = cn.id
        JOIN books b ON cn.book_id = b.id
        WHERE ne.language_code = :language_code
          AND ne.content_type = :content_type
          AND 1 - (ne.embedding <=> :query_embedding::vector) > :threshold
    """

    params: dict[str, Any] = {
        "query_embedding": query_embedding_literal,
        "language_code": language_code,
        "content_type": content_type,
        "threshold": threshold,
        "limit": limit,
    }

    book_codes = [code.strip() for code in (payload.book_codes or []) if isinstance(code, str) and code.strip()]
    if book_codes:
        sql_base += "\n AND b.book_code = ANY(:book_codes)"
        params["book_codes"] = book_codes

    sql_base += "\n ORDER BY ne.embedding <=> :query_embedding::vector\n LIMIT :limit"

    rows = db.execute(text(sql_base), params).mappings().all()

    results: list[SemanticSearchResult] = []
    for row in rows:
        translation, sanskrit = _extract_texts(row.get("content_data"), language_code)
        results.append(
            SemanticSearchResult(
                node_id=int(row["node_id"]),
                book_name=str(row.get("book_name") or ""),
                book_code=row.get("book_code"),
                sequence_number=row.get("sequence_number"),
                similarity=float(row.get("similarity") or 0.0),
                translation=translation,
                sanskrit=sanskrit,
            )
        )

    return SemanticSearchResponse(
        query=query_text,
        language_code=language_code,
        results=results,
        total=len(results),
    )
