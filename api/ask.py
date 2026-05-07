"""Phase 3: "Ask the Scriptures" RAG endpoint.

POST /api/ask
  - Embeds the question with OpenAI text-embedding-3-small
  - Runs a single bulk vector-similarity search against node_embeddings
  - Fetches HSP AI commentary for all matched nodes in ONE extra bulk query (no N+1)
  - Builds a grounded context string and calls Claude to answer
  - Supports streaming (SSE) and non-streaming JSON responses
"""

from __future__ import annotations

import json
import os
from typing import Any

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

import services.schema_bootstrap as _schema_bootstrap
from api.semantic_search import _extract_texts, _get_openai_client, _vector_literal
from services import get_db

router = APIRouter(tags=["ask"])

_CLAUDE_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS = 2000
_HARD_LIMIT = 25
_DEFAULT_THRESHOLD = 0.25
_EMBED_MODEL = "text-embedding-3-small"

_VALID_SCOPE_TYPES = frozenset({"all", "book", "selected", "basket"})

_NO_VERSES_MSG = (
    "No relevant scripture verses were found for your question in the selected scope. "
    "Try broadening the scope or rephrasing your question."
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class AskScope(BaseModel):
    type: str = Field(default="all", description="'all' | 'book' | 'selected' | 'basket'")
    book_codes: list[str] | None = Field(
        default=None, description="Required for 'book' and 'selected' scope types"
    )
    basket_id: int | None = Field(default=None, description="Required for 'basket' scope type")


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    language_code: str = Field(default="en")
    scope: AskScope = Field(default_factory=AskScope)
    stream: bool = Field(default=True)
    limit: int = Field(default=15, ge=1, le=_HARD_LIMIT)


class CitedVerse(BaseModel):
    node_id: int
    book_id: int
    book_name: str
    book_code: str | None
    sequence_number: str | None
    similarity: float
    translation: str
    sanskrit: str


class AskResponse(BaseModel):
    question: str
    language_code: str
    answer: str
    cited_verses: list[CitedVerse]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _fetch_basket_node_ids(db: Session, basket_id: int) -> list[int]:
    """Return node IDs from a basket (collection_cart). One query."""
    rows = db.execute(
        text(
            """
            SELECT item_id
            FROM collection_cart_items
            WHERE cart_id = :basket_id
              AND item_type = 'library_node'
            ORDER BY "order" ASC
            """
        ),
        {"basket_id": basket_id},
    ).fetchall()
    return [int(row[0]) for row in rows]


def _run_vector_search(
    db: Session,
    query_embedding_literal: str,
    language_code: str,
    scope_type: str,
    book_codes: list[str] | None,
    basket_node_ids: list[int] | None,
    limit: int,
) -> list[Any]:
    """Single bulk vector-similarity search. No N+1 queries."""
    sql = """
        SELECT
            cn.id          AS node_id,
            cn.book_id,
            cn.sequence_number,
            cn.content_data,
            b.book_name,
            b.book_code,
            1 - (ne.embedding <=> CAST(:query_embedding AS vector)) AS similarity
        FROM node_embeddings ne
        JOIN content_nodes cn ON ne.node_id = cn.id
        JOIN books b          ON cn.book_id  = b.id
        WHERE ne.language_code = :language_code
          AND ne.content_type  = 'translation'
          AND 1 - (ne.embedding <=> CAST(:query_embedding AS vector)) > :threshold
    """
    params: dict[str, Any] = {
        "query_embedding": query_embedding_literal,
        "language_code": language_code,
        "threshold": _DEFAULT_THRESHOLD,
        "limit": limit,
    }

    if scope_type in ("book", "selected") and book_codes:
        sql += "\n  AND b.book_code = ANY(:book_codes)"
        params["book_codes"] = book_codes
    elif scope_type == "basket" and basket_node_ids:
        sql += "\n  AND cn.id = ANY(:node_ids)"
        params["node_ids"] = basket_node_ids

    sql += "\n  ORDER BY ne.embedding <=> CAST(:query_embedding AS vector)\n  LIMIT :limit"

    return list(db.execute(text(sql), params).mappings().all())


def _bulk_fetch_hsp_commentary(
    db: Session, node_ids: list[int], language_code: str
) -> dict[int, str]:
    """Fetch HSP AI commentary for all node_ids in ONE query. No N+1."""
    if not node_ids:
        return {}
    rows = db.execute(
        text(
            """
            SELECT ce.node_id, ce.content_text
            FROM commentary_entries ce
            JOIN commentary_authors ca ON ce.author_id = ca.id
            WHERE ce.node_id = ANY(:node_ids)
              AND ce.language_code = :language_code
              AND ca.name = 'HSP AI'
            ORDER BY ce.node_id, ce.display_order ASC
            """
        ),
        {"node_ids": node_ids, "language_code": language_code},
    ).fetchall()
    # Keep first commentary entry per node (lowest display_order)
    result: dict[int, str] = {}
    for row in rows:
        nid = int(row[0])
        if nid not in result:
            result[nid] = str(row[1] or "")
    return result


def _build_context_and_citations(
    rows: list[Any],
    commentary_map: dict[int, str],
    language_code: str,
) -> tuple[str, list[CitedVerse]]:
    """Build the RAG context string and cited-verses list from search rows."""
    cited: list[CitedVerse] = []
    blocks: list[str] = []

    for row in rows:
        node_id = int(row["node_id"])
        book_name = str(row.get("book_name") or "")
        book_code = row.get("book_code")
        seq = row.get("sequence_number")
        similarity = float(row.get("similarity") or 0.0)

        translation, sanskrit = _extract_texts(row.get("content_data"), language_code)
        commentary = commentary_map.get(node_id, "")

        cited.append(
            CitedVerse(
                node_id=node_id,
                book_id=int(row.get("book_id") or 0),
                book_name=book_name,
                book_code=book_code,
                sequence_number=seq,
                similarity=round(similarity, 4),
                translation=translation,
                sanskrit=sanskrit,
            )
        )

        ref = book_name + (f" {seq}" if seq else "")
        lines = [f"[VERSE: {ref}]"]
        if sanskrit:
            lines.append(f"Sanskrit: {sanskrit}")
        if translation:
            lines.append(f"Translation: {translation}")
        if commentary:
            lines.append(f"Commentary (HSP AI): {commentary}")
        blocks.append("\n".join(lines))

    context = "\n\n---\n\n".join(blocks)
    return context, cited


def _make_system_prompt(language_code: str, context: str) -> str:
    return (
        "You are a Hindu scripture scholar assistant for Scriptle.org.\n\n"
        "Answer the user's question using ONLY the scripture verses provided below.\n"
        "Do NOT use any knowledge outside these verses.\n"
        "For every claim you make, cite the specific verse using its [VERSE: ...] reference.\n"
        "If the answer is not found in the provided verses, say so clearly — do not speculate.\n"
        f"Respond in language: {language_code}.\n\n"
        f"SCRIPTURE CONTEXT:\n{context}"
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/ask")
def ask_scriptures(
    payload: AskRequest,
    db: Session = Depends(get_db),
):
    """
    POST /api/ask — "Ask the Scriptures" RAG endpoint.

    Retrieves the most semantically relevant verses for the question,
    then asks Claude to answer using only those verses as context.
    Supports streaming (SSE) via payload.stream=true.
    """
    if not _schema_bootstrap.PGVECTOR_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ask the Scriptures is not available on this instance (pgvector not enabled)",
        )

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not anthropic_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ANTHROPIC_API_KEY is not configured",
        )

    question = payload.question.strip()
    language_code = str(payload.language_code or "en").strip().lower() or "en"
    scope_type = str(payload.scope.type or "all").strip().lower()
    limit = min(int(payload.limit), _HARD_LIMIT)

    if scope_type not in _VALID_SCOPE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"scope.type must be one of: {', '.join(sorted(_VALID_SCOPE_TYPES))}",
        )

    # --- Resolve basket node IDs (one query) ---
    basket_node_ids: list[int] | None = None
    if scope_type == "basket":
        bid = payload.scope.basket_id
        if bid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="scope.basket_id is required for scope.type='basket'",
            )
        basket_node_ids = _fetch_basket_node_ids(db, bid)
        if not basket_node_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basket not found or is empty",
            )

    # --- Resolve book_codes for book/selected scopes ---
    scope_book_codes: list[str] | None = None
    if scope_type in ("book", "selected"):
        scope_book_codes = [
            c.strip()
            for c in (payload.scope.book_codes or [])
            if isinstance(c, str) and c.strip()
        ]
        if not scope_book_codes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"scope.book_codes is required for scope.type='{scope_type}'",
            )

    # --- Step 1: Embed the question ---
    openai_client = _get_openai_client()
    try:
        emb = openai_client.embeddings.create(input=question, model=_EMBED_MODEL)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Embedding failed: {exc}",
        ) from exc

    query_vec = _vector_literal(emb.data[0].embedding)

    # --- Step 2: Single bulk vector search ---
    rows = _run_vector_search(
        db=db,
        query_embedding_literal=query_vec,
        language_code=language_code,
        scope_type=scope_type,
        book_codes=scope_book_codes,
        basket_node_ids=basket_node_ids,
        limit=limit,
    )

    if not rows:
        if payload.stream:
            def _empty():
                yield f"data: {json.dumps({'type': 'text', 'text': _NO_VERSES_MSG})}\n\n"
                yield f"data: {json.dumps({'type': 'cited_verses', 'verses': []})}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(_empty(), media_type="text/event-stream")
        return AskResponse(
            question=question,
            language_code=language_code,
            answer=_NO_VERSES_MSG,
            cited_verses=[],
        )

    # --- Step 3: Bulk fetch HSP AI commentary (one query, no N+1) ---
    node_ids = [int(r["node_id"]) for r in rows]
    commentary_map = _bulk_fetch_hsp_commentary(db, node_ids, language_code)

    # --- Step 4: Build context and citations ---
    context, cited_verses = _build_context_and_citations(rows, commentary_map, language_code)
    system_prompt = _make_system_prompt(language_code, context)
    cited_dicts = [v.model_dump() for v in cited_verses]

    # --- Step 5: Call Claude (streaming or non-streaming) ---
    claude = anthropic.Anthropic(api_key=anthropic_key)

    if payload.stream:
        def _stream():
            try:
                with claude.messages.stream(
                    model=_CLAUDE_MODEL,
                    max_tokens=_MAX_TOKENS,
                    system=system_prompt,
                    messages=[{"role": "user", "content": question}],
                ) as stream:
                    for chunk in stream.text_stream:
                        yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"
            finally:
                yield f"data: {json.dumps({'type': 'cited_verses', 'verses': cited_dicts})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(_stream(), media_type="text/event-stream")

    # Non-streaming path
    try:
        msg = claude.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": question}],
        )
        answer = msg.content[0].text if msg.content else ""
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Claude API call failed: {exc}",
        ) from exc

    return AskResponse(
        question=question,
        language_code=language_code,
        answer=answer,
        cited_verses=cited_verses,
    )
