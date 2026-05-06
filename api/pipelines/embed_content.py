#!/usr/bin/env python3
"""Embed scripture content into node_embeddings using OpenAI embeddings.

Usage examples:
  python api/pipelines/embed_content.py --book-code avadhuta-gita --language-code en
  python api/pipelines/embed_content.py --book-code avadhuta-gita --language-code en --limit 50
  python api/pipelines/embed_content.py --book-code avadhuta-gita --language-code en --content-type sanskrit
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from sqlalchemy import and_, create_engine
from sqlalchemy.orm import Session, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")

from models.ai_job import AIJob
from models.book import Book
from models.commentary_entry import CommentaryEntry
from models.content_node import ContentNode
from models.node_embedding import NodeEmbedding

EMBEDDING_MODEL = "text-embedding-3-small"
SUPPORTED_CONTENT_TYPES = {"translation", "sanskrit", "commentary"}
COST_PER_MILLION_TOKENS_USD = 0.02
APPROX_TOKENS_PER_NODE = 500
JOB_TYPE = "embed_content"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Embed book content into node_embeddings")
    parser.add_argument("--book-code", required=True, help="Book code, e.g. avadhuta-gita")
    parser.add_argument("--language-code", required=True, help="Language code, e.g. en")
    parser.add_argument("--limit", type=int, default=None, help="Max nodes to process (default: all)")
    parser.add_argument(
        "--content-type",
        default="translation",
        choices=sorted(SUPPORTED_CONTENT_TYPES),
        help="Content type to embed: translation|sanskrit|commentary",
    )
    return parser.parse_args()


def _normalized_language(code: str) -> str:
    return str(code or "").strip().lower()


def _extract_translation_text(node: ContentNode, language_code: str) -> str:
    content_data = node.content_data if isinstance(node.content_data, dict) else {}
    translations = content_data.get("translations") if isinstance(content_data.get("translations"), dict) else {}
    value = translations.get(language_code)
    return str(value or "").strip()


def _extract_sanskrit_text(node: ContentNode) -> str:
    content_data = node.content_data if isinstance(node.content_data, dict) else {}
    basic = content_data.get("basic") if isinstance(content_data.get("basic"), dict) else {}
    return str(basic.get("sanskrit") or "").strip()


def _extract_commentary_text(db: Session, node_id: int, language_code: str) -> str:
    entry = (
        db.query(CommentaryEntry)
        .filter(
            CommentaryEntry.node_id == node_id,
            CommentaryEntry.language_code == language_code,
        )
        .order_by(CommentaryEntry.created_at.desc(), CommentaryEntry.id.desc())
        .first()
    )
    return str(entry.content_text or "").strip() if entry else ""


def _extract_text_for_node(
    db: Session,
    node: ContentNode,
    content_type: str,
    language_code: str,
) -> str:
    if content_type == "translation":
        return _extract_translation_text(node, language_code)
    if content_type == "sanskrit":
        return _extract_sanskrit_text(node)
    if content_type == "commentary":
        return _extract_commentary_text(db, node.id, language_code)
    return ""


def _cost_estimate_usd(processed_nodes: int) -> float:
    total_tokens = processed_nodes * APPROX_TOKENS_PER_NODE
    return (total_tokens / 1_000_000.0) * COST_PER_MILLION_TOKENS_USD


def _create_job(
    content_db: Session,
    book_id: int,
    language_code: str,
    content_type: str,
    total_nodes: int,
) -> AIJob:
    job = AIJob(
        job_type=JOB_TYPE,
        book_id=book_id,
        language_code=language_code,
        model=EMBEDDING_MODEL,
        status="running",
        total_nodes=total_nodes,
        processed_nodes=0,
        failed_nodes=0,
        estimated_cost_usd=_cost_estimate_usd(total_nodes),
        actual_cost_usd=0,
        metadata_json={
            "book_code": None,
            "content_type": content_type,
            "approx_tokens_per_node": APPROX_TOKENS_PER_NODE,
            "pricing_usd_per_million_tokens": COST_PER_MILLION_TOKENS_USD,
        },
        started_at=datetime.now(tz=timezone.utc),
    )
    content_db.add(job)
    content_db.commit()
    content_db.refresh(job)
    return job


def _update_job_progress(content_db: Session, job: AIJob, processed: int, failed: int) -> None:
    job.processed_nodes = processed
    job.failed_nodes = failed
    job.actual_cost_usd = _cost_estimate_usd(processed)
    content_db.commit()


def _finalize_job_success(content_db: Session, job: AIJob) -> None:
    job.status = "completed"
    job.completed_at = datetime.now(tz=timezone.utc)
    content_db.commit()


def _finalize_job_failure(content_db: Session, job: AIJob, message: str) -> None:
    errors = list(job.error_log or [])
    errors.append(
        {
            "message": message,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }
    )
    job.error_log = errors
    job.status = "failed"
    job.completed_at = datetime.now(tz=timezone.utc)
    content_db.commit()


def run() -> int:
    load_dotenv()
    args = parse_args()

    language_code = _normalized_language(args.language_code)
    content_type = str(args.content_type).strip().lower()

    if not language_code:
        print("ERROR: --language-code is required")
        return 1
    if content_type not in SUPPORTED_CONTENT_TYPES:
        print(f"ERROR: --content-type must be one of {sorted(SUPPORTED_CONTENT_TYPES)}")
        return 1
    if args.limit is not None and args.limit <= 0:
        print("ERROR: --limit must be > 0")
        return 1

    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        print("ERROR: DATABASE_URL is not set")
        return 1

    engine = create_engine(database_url, pool_pre_ping=True)
    DbSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    client = OpenAI()

    db = DbSession()
    job: AIJob | None = None

    try:
        book = db.query(Book).filter(Book.book_code == args.book_code).first()
        if not book:
            print(f"ERROR: Book not found for code '{args.book_code}'")
            return 1

        query = (
            db.query(ContentNode)
            .outerjoin(
                NodeEmbedding,
                and_(
                    NodeEmbedding.node_id == ContentNode.id,
                    NodeEmbedding.language_code == language_code,
                    NodeEmbedding.content_type == content_type,
                ),
            )
            .filter(ContentNode.book_id == book.id, NodeEmbedding.id.is_(None))
            .order_by(ContentNode.id.asc())
        )
        if args.limit:
            query = query.limit(args.limit)
        nodes = query.all()

        total = len(nodes)
        if total == 0:
            print("No nodes found to process.")
            return 0

        job = _create_job(
            content_db=db,
            book_id=book.id,
            language_code=language_code,
            content_type=content_type,
            total_nodes=total,
        )
        metadata = dict(job.metadata_json or {})
        metadata["book_code"] = book.book_code
        job.metadata_json = metadata
        db.commit()

        embedded = 0
        failed = 0

        for index, node in enumerate(nodes, start=1):
            text = _extract_text_for_node(
                db=db,
                node=node,
                content_type=content_type,
                language_code=language_code,
            )
            if not text:
                print(f"[{index}/{total}] skip node={node.id}: empty {content_type} text")
                continue

            try:
                response = client.embeddings.create(
                    input=text,
                    model=EMBEDDING_MODEL,
                )
                embedding = response.data[0].embedding

                db.add(
                    NodeEmbedding(
                        node_id=node.id,
                        language_code=language_code,
                        content_type=content_type,
                        embedding=embedding,
                        model=EMBEDDING_MODEL,
                    )
                )
                db.commit()

                embedded += 1
                _update_job_progress(db, job, processed=embedded, failed=failed)

                cost = _cost_estimate_usd(embedded)
                print(f"Embedded {embedded}/{total} nodes, ~${cost:.6f} cost")
            except Exception as exc:
                db.rollback()
                failed += 1
                _update_job_progress(db, job, processed=embedded, failed=failed)
                print(f"[{index}/{total}] failed node={node.id}: {exc}")

        _finalize_job_success(db, job)
        final_cost = _cost_estimate_usd(embedded)
        print(f"Done. Embedded {embedded}/{total} nodes, failed={failed}, ~${final_cost:.6f} cost")
        return 0
    except Exception as exc:
        if job is not None:
            _finalize_job_failure(db, job, str(exc))
        print(f"ERROR: {exc}")
        return 1
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(run())
