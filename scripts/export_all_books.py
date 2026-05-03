#!/usr/bin/env python3
"""Export all books to canonical HSP JSON files directly from PostgreSQL.

This script intentionally bypasses HTTP APIs to avoid timeout issues on large books.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from models.book import Book
from models.commentary_author import CommentaryAuthor
from models.commentary_entry import CommentaryEntry
from models.commentary_work import CommentaryWork
from models.content_node import ContentNode
from models.scripture_schema import ScriptureSchema
from models.translation_author import TranslationAuthor
from models.translation_entry import TranslationEntry
from models.translation_work import TranslationWork

BATCH_SIZE_DEFAULT = 500
SCHEMA_VERSION = "hsp-book-json-v1"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export all books from production DB to canonical HSP JSON files."
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Explicit DB URL (overrides env vars).",
    )
    parser.add_argument(
        "--output-dir",
        default="exports",
        help="Output directory for JSON exports (default: exports).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE_DEFAULT,
        help="Node fetch batch size (default: 500).",
    )
    return parser.parse_args()


def _resolve_database_url(explicit_url: str | None) -> str:
    if explicit_url and explicit_url.strip():
        return explicit_url.strip()

    # Prefer explicit production-oriented variables first.
    candidates = [
        os.getenv("PRODUCTION_DATABASE_URL"),
        os.getenv("RAILWAY_DATABASE_URL"),
        os.getenv("DATABASE_URL"),
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    raise RuntimeError(
        "No database URL found. Set PRODUCTION_DATABASE_URL or RAILWAY_DATABASE_URL "
        "(or pass --database-url)."
    )


def _safe_filename(value: str, fallback: str) -> str:
    candidate = (value or "").strip().lower()
    if not candidate:
        candidate = fallback
    candidate = re.sub(r"[^a-z0-9._-]+", "-", candidate)
    candidate = re.sub(r"-+", "-", candidate).strip("-._")
    return candidate or fallback


def _bytes_to_human(size_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    if unit_index == 0:
        return f"{int(size)} {units[unit_index]}"
    return f"{size:.2f} {units[unit_index]}"


def _normalize_author_slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized


def _build_commentary_variants_by_node(
    db: Session,
    node_ids: list[int],
    variant_authors: dict[str, str],
) -> dict[int, list[dict[str, str]]]:
    if not node_ids:
        return {}

    author_name_to_slug = {
        str(name).strip().lower(): str(slug).strip()
        for slug, name in (variant_authors or {}).items()
        if str(slug).strip() and str(name).strip()
    }

    rows = (
        db.query(CommentaryEntry, CommentaryWork, CommentaryAuthor)
        .outerjoin(CommentaryWork, CommentaryEntry.work_id == CommentaryWork.id)
        .outerjoin(CommentaryAuthor, CommentaryEntry.author_id == CommentaryAuthor.id)
        .filter(CommentaryEntry.node_id.in_(node_ids))
        .order_by(CommentaryEntry.node_id.asc(), CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
        .all()
    )

    by_node: dict[int, list[dict[str, str]]] = defaultdict(list)
    for entry, work, author in rows:
        text_value = (entry.content_text or "").strip()
        if not text_value:
            continue

        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        metadata_author_slug = metadata.get("author_slug") if isinstance(metadata.get("author_slug"), str) else ""
        author_name = ""
        if author and isinstance(author.name, str) and author.name.strip():
            author_name = author.name.strip()
        elif isinstance(metadata.get("author"), str) and str(metadata.get("author")).strip():
            author_name = str(metadata.get("author")).strip()
        elif work and isinstance(work.title, str) and work.title.strip():
            author_name = work.title.strip()

        author_slug = metadata_author_slug.strip()
        if not author_slug and author_name:
            author_slug = author_name_to_slug.get(author_name.lower(), "")
        if not author_slug and author_name:
            author_slug = _normalize_author_slug(author_name)

        language = (entry.language_code or "en").strip().lower() or "en"
        field_value = metadata.get("field") if isinstance(metadata.get("field"), str) else "commentary"

        by_node[entry.node_id].append(
            {
                "author_slug": author_slug,
                "author": author_name,
                "language": language,
                "field": field_value,
                "text": text_value,
            }
        )

    return dict(by_node)


def _build_translation_variants_by_node(
    db: Session,
    node_ids: list[int],
    variant_authors: dict[str, str],
) -> dict[int, list[dict[str, str]]]:
    if not node_ids:
        return {}

    author_name_to_slug = {
        str(name).strip().lower(): str(slug).strip()
        for slug, name in (variant_authors or {}).items()
        if str(slug).strip() and str(name).strip()
    }

    rows = (
        db.query(TranslationEntry, TranslationWork, TranslationAuthor)
        .outerjoin(TranslationWork, TranslationEntry.work_id == TranslationWork.id)
        .outerjoin(TranslationAuthor, TranslationEntry.author_id == TranslationAuthor.id)
        .filter(TranslationEntry.node_id.in_(node_ids))
        .order_by(TranslationEntry.node_id.asc(), TranslationEntry.display_order.asc(), TranslationEntry.id.asc())
        .all()
    )

    by_node: dict[int, list[dict[str, str]]] = defaultdict(list)
    for entry, work, author in rows:
        text_value = (entry.content_text or "").strip()
        if not text_value:
            continue

        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        metadata_author_slug = metadata.get("author_slug") if isinstance(metadata.get("author_slug"), str) else ""
        author_name = ""
        if author and isinstance(author.name, str) and author.name.strip():
            author_name = author.name.strip()
        elif isinstance(metadata.get("author_name"), str) and str(metadata.get("author_name")).strip():
            author_name = str(metadata.get("author_name")).strip()
        elif isinstance(metadata.get("author"), str) and str(metadata.get("author")).strip():
            author_name = str(metadata.get("author")).strip()
        elif work and isinstance(work.title, str) and work.title.strip():
            author_name = work.title.strip()

        author_slug = metadata_author_slug.strip()
        if not author_slug and author_name:
            author_slug = author_name_to_slug.get(author_name.lower(), "")
        if not author_slug and author_name:
            author_slug = _normalize_author_slug(author_name)

        language = (entry.language_code or "en").strip().lower() or "en"
        field_value = metadata.get("field") if isinstance(metadata.get("field"), str) else "translation"

        by_node[entry.node_id].append(
            {
                "author_slug": author_slug,
                "author_name": author_name,
                "author": author_name,
                "language": language,
                "field": field_value,
                "text": text_value,
            }
        )

    return dict(by_node)


def _node_to_hsp_dict(
    node: ContentNode,
    commentary_variants: list[dict[str, str]] | None = None,
    translation_variants: list[dict[str, str]] | None = None,
) -> dict:
    content_data = dict(node.content_data) if isinstance(node.content_data, dict) else {}
    if commentary_variants:
        content_data["commentary_variants"] = commentary_variants
    if translation_variants:
        content_data["translation_variants"] = translation_variants

    return {
        "node_id": node.id,
        "parent_node_id": node.parent_node_id,
        "referenced_node_id": node.referenced_node_id,
        "level_name": node.level_name,
        "level_order": node.level_order,
        "sequence_number": node.sequence_number,
        "title_sanskrit": node.title_sanskrit,
        "title_transliteration": node.title_transliteration,
        "title_english": node.title_english,
        "title_hindi": node.title_hindi,
        "title_tamil": node.title_tamil,
        "has_content": bool(node.has_content),
        "content_data": content_data,
        "summary_data": node.summary_data if isinstance(node.summary_data, dict) else {},
        "metadata_json": node.metadata_json if isinstance(node.metadata_json, dict) else {},
        "source_attribution": node.source_attribution,
        "license_type": node.license_type,
        "original_source_url": node.original_source_url,
        "tags": node.tags if isinstance(node.tags, list) else [],
        "media_items": [],
    }


def _export_single_book(
    db: Session,
    book: Book,
    output_dir: Path,
    batch_size: int,
) -> tuple[Path, int, int]:
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == book.schema_id).first()

    payload: dict = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "app": "scripts/export_all_books.py",
            "format": "canonical-book-json",
            "database": "direct-sqlalchemy",
        },
        "schema": {
            "id": schema.id if schema else None,
            "name": schema.name if schema else None,
            "description": schema.description if schema else None,
            "levels": schema.levels if schema and isinstance(schema.levels, list) else [],
        },
        "book": {
            "book_name": book.book_name,
            "book_code": book.book_code,
            "language_primary": book.language_primary,
            "variant_authors": book.variant_authors if isinstance(book.variant_authors, dict) else {},
            "metadata": book.metadata_json if isinstance(book.metadata_json, dict) else {},
        },
        "nodes": [],
    }

    total_nodes = (
        db.query(ContentNode)
        .filter(ContentNode.book_id == book.id)
        .count()
    )

    print(
        f"  exporting nodes in batches of {batch_size} "
        f"(book_id={book.id}, total_nodes={total_nodes})"
    )

    offset = 0
    processed = 0
    while True:
        batch = (
            db.query(ContentNode)
            .filter(ContentNode.book_id == book.id)
            .order_by(ContentNode.id.asc())
            .offset(offset)
            .limit(batch_size)
            .all()
        )
        if not batch:
            break

        batch_node_ids = [node.id for node in batch]
        commentary_variants_by_node = _build_commentary_variants_by_node(
            db=db,
            node_ids=batch_node_ids,
            variant_authors=book.variant_authors if isinstance(book.variant_authors, dict) else {},
        )
        translation_variants_by_node = _build_translation_variants_by_node(
            db=db,
            node_ids=batch_node_ids,
            variant_authors=book.variant_authors if isinstance(book.variant_authors, dict) else {},
        )

        payload["nodes"].extend(
            _node_to_hsp_dict(
                node,
                commentary_variants_by_node.get(node.id),
                translation_variants_by_node.get(node.id),
            )
            for node in batch
        )

        processed += len(batch)
        offset += len(batch)
        print(f"    batch complete: {processed}/{total_nodes} nodes")

    file_stem = _safe_filename(book.book_code or "", f"book-{book.id}")
    output_path = output_dir / f"{file_stem}.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    size_bytes = output_path.stat().st_size
    return output_path, total_nodes, size_bytes


def main() -> None:
    load_dotenv()
    args = _parse_args()

    try:
        db_url = _resolve_database_url(args.database_url)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.batch_size <= 0:
        print("ERROR: --batch-size must be > 0", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Starting export of all books")
    print(f"Output directory: {output_dir.resolve()}")

    engine = create_engine(db_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    exported_count = 0
    total_bytes = 0

    db = SessionLocal()
    try:
        books = db.query(Book).order_by(Book.id.asc()).all()
        if not books:
            print("No books found in database.")
            return

        print(f"Found {len(books)} books")

        for index, book in enumerate(books, 1):
            code_or_id = book.book_code or f"book-{book.id}"
            print(f"[{index}/{len(books)}] Exporting {code_or_id} ...")

            try:
                output_path, node_count, size_bytes = _export_single_book(
                    db=db,
                    book=book,
                    output_dir=output_dir,
                    batch_size=args.batch_size,
                )
                exported_count += 1
                total_bytes += size_bytes
                print(
                    f"  done: {output_path.name} "
                    f"({node_count} nodes, {_bytes_to_human(size_bytes)})"
                )
            except Exception as exc:
                print(f"  failed: {code_or_id} ({exc})", file=sys.stderr)

    finally:
        db.close()
        engine.dispose()

    print("\nExport summary")
    print(f"Books exported: {exported_count}")
    print(f"Total size: {_bytes_to_human(total_bytes)} ({total_bytes} bytes)")


if __name__ == "__main__":
    main()
