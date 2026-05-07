import json
import logging
import os
import time
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Literal
from uuid import uuid4

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import insert as sa_insert, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.import_parser import GenericHTMLImporter, ImportConfig
from api.pdf_importer import PDFImporter, PDFImportConfig
from api.json_importer import JSONImporter, JSONImportConfig
from api.users import get_current_user
from models.book import Book
from models.content_node import ContentNode
from models.commentary_author import CommentaryAuthor
from models.commentary_work import CommentaryWork
from models.commentary_entry import CommentaryEntry
from models.translation_author import TranslationAuthor
from models.translation_work import TranslationWork
from models.translation_entry import TranslationEntry
from models.word_meaning_author import WordMeaningAuthor
from models.word_meaning_work import WordMeaningWork
from models.word_meaning_entry import WordMeaningEntry
from models.media_file import MediaFile
from models.import_job import ImportJob
from models.database import SessionLocal
from models.schemas import BookExchangePayloadV1, BulkTreeImportRequest, BulkTreeImportResponse
from models.scripture_schema import ScriptureSchema
from models.user import User
from services import get_db
from services.book_permissions import BOOK_STATUS_DRAFT, BOOK_VISIBILITY_PRIVATE, ensure_book_edit_access
from services.media_storage import get_media_storage_from_env

from api.content import (
    require_import_permission,
    _ensure_can_contribute,
    _validate_level_name_overrides,
    _book_level_name_overrides,
    _autofill_sanskrit_transliteration_pair,
    _autofill_content_data_pair,
)

router = APIRouter(prefix="/content", tags=["imports"])
logger = logging.getLogger(__name__)

MEDIA_STORAGE = get_media_storage_from_env()
ALLOWED_MEDIA_TYPES = {"audio", "video", "image", "link"}
IMPORT_JOB_STALE_AFTER_SECONDS = int(os.getenv("IMPORT_JOB_STALE_AFTER_SECONDS", "1800"))
IMPORT_CANONICAL_UPLOAD_MAX_MB = int(os.getenv("IMPORT_CANONICAL_UPLOAD_MAX_MB", "200"))
IMPORT_CANONICAL_UPLOAD_MAX_BYTES = IMPORT_CANONICAL_UPLOAD_MAX_MB * 1024 * 1024
IMPORT_CANONICAL_CHUNK_MAX_BYTES = int(os.getenv("IMPORT_CANONICAL_CHUNK_MAX_BYTES", str(4 * 1024 * 1024)))
IMPORT_CANONICAL_TMP_TTL_SECONDS = int(os.getenv("IMPORT_CANONICAL_TMP_TTL_SECONDS", str(24 * 60 * 60)))


class ImportResponse(BaseModel):
    """Response from import operation."""
    success: bool
    book_id: int | None = None
    nodes_created: int = 0
    warnings: list[str] = []
    error: str | None = None


class ImportJobAcceptedResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "failed"]


class ImportJobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    created_at: str
    updated_at: str
    progress_message: str | None = None
    progress_current: int | None = None
    progress_total: int | None = None
    error: str | None = None
    result: ImportResponse | None = None


class CanonicalUploadInitResponse(BaseModel):
    upload_id: str
    chunk_size_bytes: int
    max_size_bytes: int


class CanonicalUploadChunkResponse(BaseModel):
    upload_id: str
    received_bytes: int
    next_index: int


class CanonicalUploadCompleteResponse(BaseModel):
    upload_id: str
    canonical_json_url: str
    size_bytes: int


def _relative_media_path_from_url(url: str | None) -> Path | None:
    if not isinstance(url, str):
        return None
    return MEDIA_STORAGE.resolve_relative_path_from_url(url)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical_upload_relative_paths(upload_id: str) -> tuple[Path, Path]:
    meta_relative = Path("imports") / "canonical-tmp" / f"{upload_id}.meta.json"
    part_relative = Path("imports") / "canonical-tmp" / f"{upload_id}.part"
    return meta_relative, part_relative


def _canonical_upload_absolute_path(relative_path: Path) -> Path:
    return (MEDIA_STORAGE.root_dir / relative_path).resolve()


def _cleanup_stale_canonical_upload_tmp_files(now: datetime | None = None) -> tuple[int, int]:
    if IMPORT_CANONICAL_TMP_TTL_SECONDS <= 0:
        return 0, 0

    current_time = now or datetime.now(timezone.utc)
    canonical_tmp_dir = _canonical_upload_absolute_path(Path("imports") / "canonical-tmp")
    if not canonical_tmp_dir.exists() or not canonical_tmp_dir.is_dir():
        return 0, 0

    deleted_count = 0
    deleted_bytes = 0
    for candidate in canonical_tmp_dir.iterdir():
        if not candidate.is_file():
            continue
        if candidate.suffix not in {".part", ".json"}:
            continue
        try:
            stat_info = candidate.stat()
            modified_at = datetime.fromtimestamp(stat_info.st_mtime, tz=timezone.utc)
            if current_time - modified_at <= timedelta(seconds=IMPORT_CANONICAL_TMP_TTL_SECONDS):
                continue
            deleted_bytes += int(stat_info.st_size)
            candidate.unlink(missing_ok=True)
            deleted_count += 1
        except OSError as exc:
            logger.warning("Failed cleaning stale canonical temp file %s: %s", candidate, exc)

    if deleted_count:
        logger.info(
            "Cleaned %s stale canonical temp files (%s bytes)",
            deleted_count,
            deleted_bytes,
        )
    return deleted_count, deleted_bytes


def _read_canonical_upload_state(upload_id: str) -> dict | None:
    meta_relative, _ = _canonical_upload_relative_paths(upload_id)
    meta_path = _canonical_upload_absolute_path(meta_relative)
    if not meta_path.exists() or not meta_path.is_file():
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as meta_file:
            payload = json.load(meta_file)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _write_canonical_upload_state(upload_id: str, state: dict) -> None:
    meta_relative, _ = _canonical_upload_relative_paths(upload_id)
    meta_path = _canonical_upload_absolute_path(meta_relative)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as meta_file:
        json.dump(state, meta_file)


def _delete_canonical_upload_state(upload_id: str) -> None:
    meta_relative, part_relative = _canonical_upload_relative_paths(upload_id)
    for relative_path in (meta_relative, part_relative):
        absolute = _canonical_upload_absolute_path(relative_path)
        if absolute.exists() and absolute.is_file():
            absolute.unlink()


def _absolute_media_url(request: Request, relative_path: Path) -> str:
    raw_url = MEDIA_STORAGE.public_url(relative_path)
    if raw_url.startswith("http://") or raw_url.startswith("https://"):
        return raw_url
    base = str(request.base_url).rstrip("/")
    path = raw_url if raw_url.startswith("/") else f"/{raw_url}"
    return f"{base}{path}"


def _dispatch_import(
    payload: dict,
    db: Session,
    current_user: User,
    progress_callback: Callable[[str, int | None, int | None], None] | None = None,
) -> ImportResponse:
    import_type = payload.get("import_type", "html")

    if import_type == "html":
        return _import_html(payload, db, current_user)
    if import_type == "pdf":
        return _import_pdf(payload, db, current_user)
    if import_type == "json":
        return _import_json(payload, db, current_user, progress_callback=progress_callback)
    return ImportResponse(
        success=False,
        error=f"Unknown import_type: {import_type}",
    )


def _set_import_job(job_id: str, **updates) -> None:
    db = SessionLocal()
    try:
        job = db.query(ImportJob).filter(ImportJob.job_id == job_id).first()
        if not job:
            return

        if "status" in updates:
            job.status = updates["status"]
        if "error" in updates:
            job.error = updates["error"]
        if "progress_message" in updates:
            job.progress_message = updates["progress_message"]
        if "progress_current" in updates:
            job.progress_current = updates["progress_current"]
        if "progress_total" in updates:
            job.progress_total = updates["progress_total"]
        if "result" in updates:
            result_value = updates["result"]
            if isinstance(result_value, ImportResponse):
                job.result_json = result_value.model_dump()
            else:
                job.result_json = result_value

        job.updated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def _make_import_job_progress_callback(
    job_id: str,
    min_interval_seconds: float = 1.0,
) -> Callable[[str, int | None, int | None], None]:
    """Returns a progress callback that rate-limits DB writes to at most once per second.
    The final call always writes regardless of interval so the UI shows 100%."""
    last_write: list[float] = [0.0]  # mutable container for closure

    def _callback(message: str, current: int | None = None, total: int | None = None) -> None:
        now = time.monotonic()
        is_final = (current is not None and total is not None and current >= total)
        if not is_final and (now - last_write[0]) < min_interval_seconds:
            return
        last_write[0] = now
        _set_import_job(
            job_id,
            progress_message=message,
            progress_current=current,
            progress_total=total,
        )

    return _callback


def _canonical_import_identity(payload: dict) -> tuple[str | None, str | None]:
    if not isinstance(payload, dict):
        return None, None
    if payload.get("schema_version") != "hsp-book-json-v1":
        return None, None

    canonical_json_url = payload.get("canonical_json_url")
    normalized_url = canonical_json_url.strip() if isinstance(canonical_json_url, str) and canonical_json_url.strip() else None

    book_payload = payload.get("book")
    normalized_book_code: str | None = None
    if isinstance(book_payload, dict):
        raw_book_code = book_payload.get("book_code")
        if isinstance(raw_book_code, str) and raw_book_code.strip():
            normalized_book_code = raw_book_code.strip()
        else:
            raw_book_name = book_payload.get("book_name")
            if isinstance(raw_book_name, str) and raw_book_name.strip():
                normalized_book_code = _default_book_code_from_name(raw_book_name)

    return normalized_url, normalized_book_code


def _compact_import_job_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {}

    compact_payload: dict[str, object] = {}
    for key in ("import_type", "schema_version", "canonical_json_url"):
        value = payload.get(key)
        if value is not None:
            compact_payload[key] = value

    for key in ("force_reimport", "allow_existing_content"):
        if payload.get(key) is True:
            compact_payload[key] = True

    book_payload = payload.get("book")
    if isinstance(book_payload, dict):
        compact_book: dict[str, object] = {}
        for key in ("book_name", "book_code", "language_primary"):
            value = book_payload.get(key)
            if value is not None:
                compact_book[key] = value
        if compact_book:
            compact_payload["book"] = compact_book

    if not compact_payload:
        compact_payload["import_type"] = str(payload.get("import_type") or "json")

    return compact_payload


def _is_import_job_stale(job: ImportJob, now: datetime | None = None) -> bool:
    if job.status not in {"queued", "running"}:
        return False
    if IMPORT_JOB_STALE_AFTER_SECONDS <= 0:
        return False

    current_time = now or datetime.now(timezone.utc)
    last_updated = job.updated_at or job.created_at
    if last_updated is None:
        return False
    if last_updated.tzinfo is None:
        last_updated = last_updated.replace(tzinfo=timezone.utc)

    return current_time - last_updated > timedelta(seconds=IMPORT_JOB_STALE_AFTER_SECONDS)


def _mark_import_job_stale_if_needed(
    job: ImportJob,
    db: Session,
    now: datetime | None = None,
) -> bool:
    if not _is_import_job_stale(job, now=now):
        return False

    stale_message = (
        "Import job stalled before completion. "
        "The worker likely stopped or restarted. Please retry the import."
    )
    job.status = "failed"
    job.error = stale_message
    job.progress_message = stale_message
    job.updated_at = now or datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return True


def _find_inflight_duplicate_import_job(payload: dict, db: Session) -> ImportJob | None:
    candidate_url, candidate_book_code = _canonical_import_identity(payload)
    if not candidate_url and not candidate_book_code:
        return None

    query = db.query(ImportJob).filter(ImportJob.status.in_(["queued", "running"]))
    if candidate_url and candidate_book_code:
        query = query.filter(
            (ImportJob.canonical_json_url == candidate_url)
            | (ImportJob.canonical_book_code == candidate_book_code)
        )
    elif candidate_url:
        query = query.filter(ImportJob.canonical_json_url == candidate_url)
    else:
        query = query.filter(ImportJob.canonical_book_code == candidate_book_code)

    now = datetime.now(timezone.utc)
    candidate_jobs = query.order_by(ImportJob.created_at.asc()).all()
    for job in candidate_jobs:
        if _mark_import_job_stale_if_needed(job, db, now=now):
            continue
        return job

    return None


def _allow_existing_content(payload: dict) -> bool:
    return bool(
        isinstance(payload, dict)
        and (payload.get("force_reimport") is True or payload.get("allow_existing_content") is True)
    )


def _force_reimport(payload: dict) -> bool:
    return bool(isinstance(payload, dict) and payload.get("force_reimport") is True)


def _cleanup_import_source_canonical_json(payload: dict) -> None:
    canonical_json_url = payload.get("canonical_json_url") if isinstance(payload, dict) else None
    if not isinstance(canonical_json_url, str) or not canonical_json_url.strip():
        return

    relative_path = _relative_media_path_from_url(canonical_json_url)
    if relative_path is None:
        return

    parts = relative_path.parts
    if len(parts) < 2 or parts[0] != "imports" or parts[1] != "canonical":
        return

    try:
        MEDIA_STORAGE.delete_relative_path(relative_path)
    except OSError as exc:
        logger.warning(
            "Failed deleting canonical source file after import %s: %s",
            relative_path,
            exc,
        )


def _run_import_job(job_id: str, payload: dict, user_id: int) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            _set_import_job(job_id, status="failed", error="User not found", result=None)
            return

        progress_callback = _make_import_job_progress_callback(job_id)
        _set_import_job(
            job_id,
            status="running",
            error=None,
            progress_message="Starting import",
            progress_current=0,
            progress_total=None,
        )
        try:
            result = _dispatch_import(payload, db, user, progress_callback=progress_callback)
        except Exception as exc:
            db.rollback()
            result = ImportResponse(success=False, error=f"Import failed: {str(exc)}")

        if result.success:
            _set_import_job(
                job_id,
                status="succeeded",
                result=result,
                error=None,
                progress_message="Import completed",
            )
            _cleanup_import_source_canonical_json(payload)
        else:
            _set_import_job(
                job_id,
                status="failed",
                result=result,
                error=result.error or "Import failed",
                progress_message=result.error or "Import failed",
            )
    finally:
        db.close()


def _to_iso(value: datetime | None) -> str:
    if value is None:
        return _utc_now_iso()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _job_result_to_import_response(job: ImportJob) -> ImportResponse | None:
    if not isinstance(job.result_json, dict):
        return None
    try:
        return ImportResponse.model_validate(job.result_json)
    except Exception:
        return None


def _default_book_code_from_name(book_name: str) -> str:
    normalized = "-".join((book_name or "").strip().lower().split())
    return normalized or f"book-{uuid4().hex[:8]}"


def _sync_content_nodes_id_sequence(db: Session) -> None:
    db.execute(
        text(
            """
            SELECT setval(
                pg_get_serial_sequence('content_nodes', 'id'),
                COALESCE((SELECT MAX(id) FROM content_nodes), 1),
                true
            )
            """
        )
    )


def _is_content_nodes_pk_violation(exc: IntegrityError) -> bool:
    message = str(getattr(exc, "orig", exc) or "").lower()
    return (
        "content_nodes_pkey" in message
        or (
            "duplicate key value violates unique constraint" in message
            and "content_nodes" in message
            and "key (id)=" in message
        )
    )


def _import_html(
    payload: dict,
    db: Session,
    current_user: User,
) -> ImportResponse:
    """Import from HTML using extraction rules."""
    config = ImportConfig(**payload)

    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema {config.schema_id} not found"
        )

    book_code = config.book_code or config.book_name.lower().replace(" ", "-")
    existing_book = db.query(Book).filter(
        Book.book_code == book_code,
        Book.schema_id == config.schema_id
    ).first()

    if existing_book:
        book = existing_book
        warnings = [f"Book {book_code} already exists, adding to it"]
    else:
        book = Book(
            schema_id=config.schema_id,
            book_name=config.book_name,
            book_code=book_code,
            language_primary=config.language_primary,
            metadata_json={
                "source_attribution": config.source_attribution,
                "original_source_url": config.original_source_url,
                "license_type": config.license_type,
            }
        )
        db.add(book)
        db.flush()
        warnings = []

    importer = GenericHTMLImporter(config)
    if not importer.fetch_and_parse():
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            error="Failed to fetch and parse URL"
        )

    nodes_tree = importer.build_tree()
    flat_nodes = importer.flatten_tree(nodes_tree)

    nodes_created = _insert_content_nodes(
        nodes_tree, book, schema, config, current_user, db
    )
    db.commit()

    warnings.append(f"Created {nodes_created} nodes")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings
    )


def _import_pdf(
    payload: dict,
    db: Session,
    current_user: User,
) -> ImportResponse:
    """Import from PDF using extraction rules."""
    try:
        config = PDFImportConfig(**payload)
    except Exception as e:
        return ImportResponse(
            success=False,
            error=f"Invalid PDF config: {str(e)}"
        )

    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema {config.schema_id} not found"
        )

    book_code = config.book_code or config.book_name.lower().replace(" ", "-")
    existing_book = db.query(Book).filter(
        Book.book_code == book_code,
        Book.schema_id == config.schema_id
    ).first()

    if existing_book:
        book = existing_book
        warnings = [f"Book {book_code} already exists, adding to it"]
    else:
        book = Book(
            schema_id=config.schema_id,
            book_name=config.book_name,
            book_code=book_code,
            language_primary=config.language_primary,
            metadata_json={
                "source_attribution": config.source_attribution,
                "original_source_url": config.original_source_url,
            }
        )
        db.add(book)
        db.flush()
        warnings = []

    importer = PDFImporter(config)
    success, node_count_from_import, pdf_warnings = importer.import_from_pdf()
    warnings.extend(pdf_warnings)

    if not success:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            warnings=warnings,
            error="Failed to extract PDF content"
        )

    nodes_tree = importer.extract_chapters_and_verses()

    if not nodes_tree:
        db.rollback()
        warnings.append("No content extracted from PDF")
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error="Extraction produced no nodes"
        )

    try:
        nodes_created = _insert_content_nodes(
            nodes_tree, book, schema, config, current_user, db
        )
        db.commit()
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error=f"Failed to insert nodes: {str(e)}"
        )

    warnings.append(f"Created {nodes_created} nodes")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings
    )


def _import_json(
    payload: dict,
    db: Session,
    current_user: User,
    progress_callback: Callable[[str, int | None, int | None], None] | None = None,
) -> ImportResponse:
    """Import from JSON/API source."""
    schema_version = payload.get("schema_version")
    if isinstance(schema_version, str) and schema_version.strip() == "hsp-book-json-v1":
        canonical_json_url = payload.get("canonical_json_url")
        if isinstance(canonical_json_url, str) and canonical_json_url.strip():
            canonical_json_url = canonical_json_url.strip()
            try:
                if progress_callback:
                    progress_callback("Fetching canonical JSON", 0, None)
                response = requests.get(canonical_json_url, timeout=600)
                response.raise_for_status()
                fetched_payload = response.json()
            except Exception as exc:
                return ImportResponse(
                    success=False,
                    error=f"Failed to fetch canonical JSON from URL: {str(exc)}",
                )

            if not isinstance(fetched_payload, dict):
                return ImportResponse(
                    success=False,
                    error="Canonical JSON URL did not return a valid JSON object",
                )

            fetched_payload.setdefault("import_type", "json")
            fetched_payload.setdefault("schema_version", "hsp-book-json-v1")

            if payload.get("force_reimport") is True:
                fetched_payload["force_reimport"] = True
            if payload.get("allow_existing_content") is True:
                fetched_payload["allow_existing_content"] = True

            return _import_canonical_json_v1(
                fetched_payload,
                db,
                current_user,
                progress_callback=progress_callback,
            )

        return _import_canonical_json_v1(
            payload,
            db,
            current_user,
            progress_callback=progress_callback,
        )

    config = JSONImportConfig(**payload)

    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()

    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema not found: {config.schema_id}"
        )

    book = db.query(Book).filter(Book.book_code == config.book_code).first()
    warnings = []

    if book:
        warnings.append(f"Book already exists: {book.book_name}")
    else:
        book = Book(
            schema_id=config.schema_id,
            book_name=config.book_name,
            book_code=config.book_code,
            language_primary=config.language_primary,
        )
        db.add(book)
        db.flush()
        warnings = []

    importer = JSONImporter(config)
    success, node_count, import_warnings = importer.import_from_json()
    warnings.extend(import_warnings)

    if not success:
        db.rollback()
        detailed_error = "Failed to import JSON content"
        if import_warnings:
            detailed_error = f"Failed to import JSON content: {'; '.join(import_warnings)}"
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            warnings=warnings,
            error=detailed_error
        )

    nodes_tree = importer.extract_structure()

    if not nodes_tree:
        db.rollback()
        warnings.append("No content extracted from JSON")
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error="Extraction produced no nodes"
        )

    try:
        nodes_created = _insert_content_nodes(
            nodes_tree, book, schema, config, current_user, db
        )
        db.commit()
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id,
            nodes_created=0,
            warnings=warnings,
            error=f"Failed to insert nodes: {str(e)}"
        )

    warnings.append(f"Created {nodes_created} nodes")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings
    )


def _import_canonical_json_v1(
    payload: dict,
    db: Session,
    current_user: User,
    progress_callback: Callable[[str, int | None, int | None], None] | None = None,
) -> ImportResponse:
    try:
        canonical = BookExchangePayloadV1.model_validate(payload)
    except Exception as exc:
        return ImportResponse(
            success=False,
            error=f"Invalid canonical JSON payload: {str(exc)}",
        )

    schema_id = canonical.schema_.id
    if not isinstance(schema_id, int) or schema_id <= 0:
        return ImportResponse(
            success=False,
            error="Canonical payload must include schema.id",
        )

    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema not found: {schema_id}",
        )

    schema_levels = schema.levels if isinstance(schema.levels, list) else []
    canonical_level_name_overrides = _validate_level_name_overrides(
        canonical.schema_.level_name_overrides,
        schema_levels,
    )

    book_code = canonical.book.book_code or _default_book_code_from_name(canonical.book.book_name)
    warnings: list[str] = []
    book = db.query(Book).filter(Book.book_code == book_code).first()
    if book:
        warnings.append(f"Book already exists: {book.book_name}")
        book.level_name_overrides = canonical_level_name_overrides
        existing_content_query = db.query(ContentNode).filter(ContentNode.book_id == book.id)
        existing_node = existing_content_query.with_entities(ContentNode.id).first()
        if existing_node:
            if _force_reimport(payload):
                if progress_callback:
                    progress_callback("Removing existing content", 0, None)
                deleted_nodes = existing_content_query.delete(synchronize_session=False)
                db.flush()
                warnings.append(f"Replaced {deleted_nodes} existing nodes before reimport")
            elif not _allow_existing_content(payload):
                return ImportResponse(
                    success=False,
                    book_id=book.id,
                    nodes_created=0,
                    warnings=warnings,
                    error=(
                        "Book already contains imported nodes. "
                        "Set allow_existing_content=true to append again explicitly, "
                        "or force_reimport=true to replace existing content."
                    ),
                )
            else:
                warnings.append("Appending imported nodes to existing book content")
    else:
        metadata = canonical.book.metadata if isinstance(canonical.book.metadata, dict) else {}
        metadata_out = dict(metadata)
        metadata_out.setdefault("status", BOOK_STATUS_DRAFT)
        metadata_out.setdefault("visibility", BOOK_VISIBILITY_PRIVATE)
        # Always assign the importing user as owner — the exported owner_id is from
        # a different system and would produce a dangling/wrong ownership reference.
        metadata_out["owner_id"] = current_user.id

        book = Book(
            schema_id=schema.id,
            book_name=canonical.book.book_name,
            book_code=book_code,
            language_primary=canonical.book.language_primary,
            metadata_json=metadata_out,
            level_name_overrides=canonical_level_name_overrides,
        )
        db.add(book)
        db.flush()

    canonical_variant_authors = (
        canonical.book.variant_authors if isinstance(canonical.book.variant_authors, dict) else {}
    )
    if _force_reimport(payload):
        book.variant_authors = {
            str(slug): str(name)
            for slug, name in canonical_variant_authors.items()
            if str(slug).strip() and str(name).strip()
        }
    elif canonical_variant_authors:
        existing_variant_authors = book.variant_authors if isinstance(book.variant_authors, dict) else {}
        merged_variant_authors = dict(existing_variant_authors)
        for slug, name in canonical_variant_authors.items():
            slug_text = str(slug).strip()
            name_text = str(name).strip()
            if slug_text and name_text:
                merged_variant_authors[slug_text] = name_text
        book.variant_authors = merged_variant_authors

    _t_start = time.perf_counter()

    level_lookup = {level: idx + 1 for idx, level in enumerate(schema.levels or [])}
    old_to_new_node_ids: dict[int, int] = {}
    pending_nodes = list(canonical.nodes)
    nodes_created = 0
    total_nodes = len(pending_nodes)
    if progress_callback:
        progress_callback("Preparing import", 0, total_nodes)
    variant_authors_lookup = book.variant_authors if isinstance(book.variant_authors, dict) else {}
    commentary_author_cache: dict[str, CommentaryAuthor] = {}
    commentary_work_cache: dict[tuple[int, str], CommentaryWork] = {}
    translation_author_cache: dict[str, TranslationAuthor] = {}
    translation_work_cache: dict[tuple[int, str], TranslationWork] = {}
    word_meaning_author_cache: dict[str, WordMeaningAuthor] = {}
    word_meaning_work_cache: dict[tuple[int, str], WordMeaningWork] = {}
    language_name_by_code = {
        "en": "English",
        "te": "Telugu",
        "hi": "Hindi",
        "ta": "Tamil",
        "kn": "Kannada",
        "ml": "Malayalam",
        "sa": "Sanskrit",
    }

    def _resolve_commentary_author_name(raw_variant: dict) -> str:
        author_slug = str(raw_variant.get("author_slug") or "").strip()
        author_name = ""
        if author_slug:
            mapped_name = variant_authors_lookup.get(author_slug)
            if isinstance(mapped_name, str) and mapped_name.strip():
                author_name = mapped_name.strip()
            else:
                author_name = author_slug
        if not author_name:
            fallback_author = str(raw_variant.get("author") or "").strip()
            author_name = fallback_author or "unknown_author"
        return author_name

    def _resolve_translation_author_name(raw_variant: dict) -> str:
        author_slug = str(raw_variant.get("author_slug") or "").strip()
        author_name = ""
        if author_slug:
            mapped_name = variant_authors_lookup.get(author_slug)
            if isinstance(mapped_name, str) and mapped_name.strip():
                author_name = mapped_name.strip()
            else:
                author_name = author_slug
        if not author_name:
            fallback_author = str(raw_variant.get("author_name") or raw_variant.get("author") or "").strip()
            author_name = fallback_author or "unknown_author"
        return author_name

    def _resolve_word_meaning_author_name(raw_row: dict, meaning_payload: object) -> tuple[str, str]:
        author_slug = str(
            raw_row.get("author_slug")
            or (meaning_payload.get("author_slug") if isinstance(meaning_payload, dict) else "")
            or ""
        ).strip()
        author_name = ""
        if author_slug:
            mapped_name = variant_authors_lookup.get(author_slug)
            if isinstance(mapped_name, str) and mapped_name.strip():
                author_name = mapped_name.strip()
        if not author_name and author_slug.lower() in {"hsp_ai", "hsp-ai", "ai"}:
            author_name = "HSP AI"
        if not author_name:
            maybe_author = raw_row.get("author")
            if isinstance(maybe_author, str) and maybe_author.strip():
                author_name = maybe_author.strip()
        if not author_name:
            author_name = "HSP AI"
        return author_name, author_slug

    def _resolve_or_create_commentary_author(author_name: str) -> CommentaryAuthor:
        cached = commentary_author_cache.get(author_name)
        if cached is not None:
            return cached

        db.execute(
            pg_insert(CommentaryAuthor)
            .values(name=author_name, created_by=current_user.id)
            .on_conflict_do_nothing(index_elements=[CommentaryAuthor.name])
        )
        author = db.query(CommentaryAuthor).filter(CommentaryAuthor.name == author_name).first()
        if author is None:
            raise RuntimeError(f"Failed to resolve commentary author: {author_name}")
        commentary_author_cache[author_name] = author
        return author

    def _resolve_or_create_commentary_work(author: CommentaryAuthor, author_name: str) -> CommentaryWork:
        work_title = f"{author_name} Commentary"
        cache_key = (author.id, work_title)
        cached = commentary_work_cache.get(cache_key)
        if cached is not None:
            return cached

        existing = (
            db.query(CommentaryWork)
            .filter(CommentaryWork.author_id == author.id, CommentaryWork.title == work_title)
            .first()
        )
        if existing is not None:
            commentary_work_cache[cache_key] = existing
            return existing

        work = CommentaryWork(title=work_title, author_id=author.id, created_by=current_user.id)
        db.add(work)
        db.flush()
        commentary_work_cache[cache_key] = work
        return work

    def _resolve_or_create_translation_author(author_name: str) -> TranslationAuthor:
        cached = translation_author_cache.get(author_name)
        if cached is not None:
            return cached

        existing = db.query(TranslationAuthor).filter(TranslationAuthor.name == author_name).first()
        if existing is not None:
            translation_author_cache[author_name] = existing
            return existing

        author = TranslationAuthor(name=author_name)
        try:
            with db.begin_nested():
                db.add(author)
                db.flush()
        except IntegrityError:
            existing = db.query(TranslationAuthor).filter(TranslationAuthor.name == author_name).first()
            if existing is None:
                raise
            translation_author_cache[author_name] = existing
            return existing
        translation_author_cache[author_name] = author
        return author

    def _resolve_or_create_translation_work(author: TranslationAuthor, author_name: str) -> TranslationWork:
        work_title = f"{author_name} Translation"
        cache_key = (author.id, work_title)
        cached = translation_work_cache.get(cache_key)
        if cached is not None:
            return cached

        existing = (
            db.query(TranslationWork)
            .filter(TranslationWork.author_id == author.id, TranslationWork.title == work_title)
            .first()
        )
        if existing is not None:
            translation_work_cache[cache_key] = existing
            return existing

        work = TranslationWork(
            title=work_title,
            author_id=author.id,
        )
        try:
            with db.begin_nested():
                db.add(work)
                db.flush()
        except IntegrityError:
            existing = (
                db.query(TranslationWork)
                .filter(TranslationWork.author_id == author.id, TranslationWork.title == work_title)
                .first()
            )
            if existing is None:
                raise
            translation_work_cache[cache_key] = existing
            return existing
        translation_work_cache[cache_key] = work
        return work

    def _migrate_commentary_variants_to_entries(
        content_node_id: int,
        commentary_variants: list,
    ) -> list[dict]:
        entries: list[dict] = []
        for idx, raw_variant in enumerate(commentary_variants):
            if not isinstance(raw_variant, dict):
                continue

            text_value = str(raw_variant.get("text") or "").strip()
            if not text_value:
                continue

            author_slug = str(raw_variant.get("author_slug") or "").strip()
            author_name = _resolve_commentary_author_name(raw_variant)

            author = _resolve_or_create_commentary_author(author_name)
            work = _resolve_or_create_commentary_work(author, author_name)

            language_code = str(raw_variant.get("language") or "en").strip().lower() or "en"
            field_value = raw_variant.get("field")

            entries.append({
                "node_id": content_node_id,
                "author_id": author.id,
                "work_id": work.id,
                "content_text": text_value,
                "language_code": language_code,
                "display_order": idx,
                "metadata_json": {
                    "field": field_value,
                    "author_slug": author_slug,
                    "migrated_from": "commentary_variants",
                },
                "created_by": current_user.id,
                "last_modified_by": current_user.id,
            })
        return entries

    def _migrate_translation_variants_to_entries(
        content_node_id: int,
        translation_variants: list,
    ) -> list[dict]:
        entries: list[dict] = []
        for idx, raw_variant in enumerate(translation_variants):
            if not isinstance(raw_variant, dict):
                continue

            text_value = str(raw_variant.get("text") or "").strip()
            if not text_value:
                continue

            author_slug = str(raw_variant.get("author_slug") or "").strip()
            author_name = _resolve_translation_author_name(raw_variant)

            author = _resolve_or_create_translation_author(author_name)
            work = _resolve_or_create_translation_work(author, author_name)

            language_code = str(raw_variant.get("language") or "en").strip().lower() or "en"
            field_value = raw_variant.get("field")

            entries.append({
                "node_id": content_node_id,
                "author_id": author.id,
                "work_id": work.id,
                "content_text": text_value,
                "language_code": language_code,
                "display_order": idx,
                "metadata_json": {
                    "field": field_value,
                    "author_slug": author_slug,
                    "author_name": author_name,
                    "migrated_from": "translation_variants",
                },
            })
        return entries

    def _build_translations_from_variants(
        translation_variants: list,
        existing_translations: object,
    ) -> dict[str, str]:
        merged: dict[str, str] = {}
        if isinstance(existing_translations, dict):
            for key, value in existing_translations.items():
                if not isinstance(key, str):
                    continue
                cleaned_key = key.strip().lower()
                cleaned_value = value.strip() if isinstance(value, str) else ""
                if cleaned_key and cleaned_value:
                    merged[cleaned_key] = cleaned_value

        if not isinstance(translation_variants, list):
            return merged

        # Prefer HSP AI entries when available, then fall back to first non-empty variant text.
        preferred: dict[str, str] = {}
        fallback: dict[str, str] = {}
        for raw_variant in translation_variants:
            if not isinstance(raw_variant, dict):
                continue

            text_value = str(raw_variant.get("text") or "").strip()
            language_code = str(raw_variant.get("language") or "").strip().lower()
            if not text_value or not language_code:
                continue

            field_value = str(raw_variant.get("field") or "translation").strip().lower()
            if field_value not in {"translation", "text", "english"}:
                continue

            author_slug = str(raw_variant.get("author_slug") or "").strip().lower()
            author_name = str(raw_variant.get("author_name") or raw_variant.get("author") or "").strip().lower()
            is_hsp_ai = (
                author_slug in {"hsp_ai", "hsp-ai", "ai"}
                or author_name == "hsp ai"
            )

            if is_hsp_ai and language_code not in preferred:
                preferred[language_code] = text_value
            elif language_code not in fallback:
                fallback[language_code] = text_value

        for language_code, text_value in preferred.items():
            if language_code not in merged:
                merged[language_code] = text_value
        for language_code, text_value in fallback.items():
            if language_code not in merged:
                merged[language_code] = text_value

        return merged

    def _resolve_or_create_word_meaning_author(author_name: str) -> WordMeaningAuthor:
        cached = word_meaning_author_cache.get(author_name)
        if cached is not None:
            return cached

        existing = db.query(WordMeaningAuthor).filter(WordMeaningAuthor.name == author_name).first()
        if existing is not None:
            word_meaning_author_cache[author_name] = existing
            return existing

        author = WordMeaningAuthor(
            name=author_name,
            bio="AI-generated word meanings" if author_name == "HSP AI" else None,
        )
        try:
            with db.begin_nested():
                db.add(author)
                db.flush()
        except IntegrityError:
            existing = db.query(WordMeaningAuthor).filter(WordMeaningAuthor.name == author_name).first()
            if existing is None:
                raise
            word_meaning_author_cache[author_name] = existing
            return existing

        word_meaning_author_cache[author_name] = author
        return author

    def _resolve_or_create_word_meaning_work(author: WordMeaningAuthor, language_code: str) -> WordMeaningWork:
        language_key = str(language_code or "en").strip().lower() or "en"
        language_name = language_name_by_code.get(language_key, language_key.upper())
        if author.name == "HSP AI":
            work_title = f"HSP AI Word Meanings - {language_name}"
        else:
            work_title = f"{author.name} Word Meanings - {language_name}"

        cache_key = (author.id, work_title)
        cached = word_meaning_work_cache.get(cache_key)
        if cached is not None:
            return cached

        existing = (
            db.query(WordMeaningWork)
            .filter(WordMeaningWork.author_id == author.id, WordMeaningWork.title == work_title)
            .first()
        )
        if existing is not None:
            word_meaning_work_cache[cache_key] = existing
            return existing

        work = WordMeaningWork(
            author_id=author.id,
            title=work_title,
            description=f"Word meanings in {language_name}",
            metadata_json={
                "type": "word_meanings",
                "language_code": language_key,
                "language_name": language_name.lower(),
            },
        )
        try:
            with db.begin_nested():
                db.add(work)
                db.flush()
        except IntegrityError:
            existing = (
                db.query(WordMeaningWork)
                .filter(WordMeaningWork.author_id == author.id, WordMeaningWork.title == work_title)
                .first()
            )
            if existing is None:
                raise
            word_meaning_work_cache[cache_key] = existing
            return existing

        word_meaning_work_cache[cache_key] = work
        return work

    def _migrate_word_meanings_to_entries(
        content_node_id: int,
        raw_word_meanings_rows: list,
    ) -> list[dict]:
        entries: list[dict] = []
        for idx, raw_row in enumerate(raw_word_meanings_rows):
            if not isinstance(raw_row, dict):
                continue

            source = raw_row.get("source") if isinstance(raw_row.get("source"), dict) else {}
            source_word = str(source.get("script_text") or "").strip()
            if not source_word:
                continue

            transliteration = ""
            transliteration_obj = source.get("transliteration") if isinstance(source.get("transliteration"), dict) else {}
            if isinstance(transliteration_obj, dict):
                transliteration = str(transliteration_obj.get("iast") or "").strip()
            word_order = int(raw_row.get("order") or 0)
            if word_order <= 0:
                word_order = idx + 1

            meanings = raw_row.get("meanings") if isinstance(raw_row.get("meanings"), dict) else {}
            for language_key, meaning_payload in meanings.items():
                language_code = str(language_key or "").strip().lower()
                if not language_code:
                    continue

                meaning_text = ""
                if isinstance(meaning_payload, dict):
                    meaning_text = str(meaning_payload.get("text") or "").strip()
                elif isinstance(meaning_payload, str):
                    meaning_text = meaning_payload.strip()
                if not meaning_text:
                    continue

                author_name, author_slug = _resolve_word_meaning_author_name(raw_row, meaning_payload)

                author = _resolve_or_create_word_meaning_author(author_name)
                work = _resolve_or_create_word_meaning_work(author, language_code)

                entries.append({
                    "node_id": content_node_id,
                    "author_id": author.id,
                    "work_id": work.id,
                    "source_word": source_word,
                    "transliteration": transliteration or source_word,
                    "word_order": word_order,
                    "language_code": language_code,
                    "meaning_text": meaning_text,
                    "display_order": word_order - 1,
                    "metadata_json": {
                        "author_slug": author_slug,
                        "migrated_from": "word_meanings.rows",
                    },
                })
        return entries

    if progress_callback:
        progress_callback("Validated canonical payload", 0, total_nodes)

    node_insert_chunk_size = 1000
    pending_commentary: list[dict] = []
    pending_translation: list[dict] = []
    pending_word_meanings: list[dict] = []
    pending_media_files: list[dict] = []

    # Group nodes by level_order so parents are fully inserted (and mapped) before
    # any child level is processed.  This guarantees old_to_new_node_ids contains
    # every parent mapping before the next level resolves its parent_node_id.
    nodes_by_level: dict[int, list] = {}
    for node in pending_nodes:
        lo = level_lookup.get(node.level_name, node.level_order)
        if not isinstance(lo, int) or lo <= 0:
            lo = 1
        nodes_by_level.setdefault(lo, []).append(node)

    for _level_key in sorted(nodes_by_level.keys()):
        level_nodes = nodes_by_level[_level_key]

        if progress_callback:
            progress_callback("Importing nodes", nodes_created, total_nodes)

        level_insert_payloads: list[dict] = []
        level_old_node_ids: list[int] = []
        level_node_assets: list[tuple[int, list, list, list, list]] = []
        prepared_count = 0

        for node in level_nodes:
            parent_id = node.parent_node_id
            referenced_id = node.referenced_node_id
            resolved_reference_id = (
                old_to_new_node_ids.get(referenced_id)
                if isinstance(referenced_id, int)
                else None
            )

            resolved_level_order = level_lookup.get(node.level_name, node.level_order)
            if not isinstance(resolved_level_order, int) or resolved_level_order <= 0:
                resolved_level_order = 1
            source_attribution = None
            original_source_url = None
            if isinstance(node.metadata_json, dict):
                source_attribution = node.metadata_json.get("source_attribution")
                original_source_url = node.metadata_json.get("original_source_url")

            node_title_sanskrit, node_title_transliteration = _autofill_sanskrit_transliteration_pair(
                node.title_sanskrit,
                node.title_transliteration,
            )
            raw_node_content_data = node.content_data if isinstance(node.content_data, dict) else {}
            commentary_variants = (
                raw_node_content_data.get("commentary_variants")
                if isinstance(raw_node_content_data.get("commentary_variants"), list)
                else []
            )
            translation_variants = (
                raw_node_content_data.get("translation_variants")
                if isinstance(raw_node_content_data.get("translation_variants"), list)
                else []
            )
            word_meanings_obj = (
                raw_node_content_data.get("word_meanings")
                if isinstance(raw_node_content_data.get("word_meanings"), dict)
                else {}
            )
            word_meanings_rows = (
                word_meanings_obj.get("rows")
                if isinstance(word_meanings_obj.get("rows"), list)
                else (
                    raw_node_content_data.get("word_meanings_rows")
                    if isinstance(raw_node_content_data.get("word_meanings_rows"), list)
                    else []
                )
            )
            content_data_without_commentary_variants = dict(raw_node_content_data)
            content_data_without_commentary_variants.pop("commentary_variants", None)
            content_data_without_commentary_variants.pop("translation_variants", None)
            content_data_without_commentary_variants.pop("word_meanings", None)
            content_data_without_commentary_variants.pop("word_meanings_rows", None)
            node_content_data = _autofill_content_data_pair(
                content_data_without_commentary_variants
            )
            merged_translations = _build_translations_from_variants(
                translation_variants,
                node_content_data.get("translations") if isinstance(node_content_data, dict) else None,
            )
            if isinstance(node_content_data, dict) and merged_translations:
                node_content_data["translations"] = merged_translations

            node_insert_payload = {
                "book_id": book.id,
                "parent_node_id": old_to_new_node_ids.get(parent_id) if isinstance(parent_id, int) else None,
                "referenced_node_id": resolved_reference_id,
                "level_name": node.level_name,
                "level_order": resolved_level_order,
                "sequence_number": node.sequence_number,
                "title_sanskrit": node_title_sanskrit,
                "title_transliteration": node_title_transliteration,
                "title_english": node.title_english,
                "title_hindi": node.title_hindi,
                "title_tamil": node.title_tamil,
                "has_content": bool(node.has_content),
                "content_data": node_content_data if isinstance(node_content_data, dict) else {},
                "summary_data": node.summary_data if isinstance(node.summary_data, dict) else {},
                "metadata_json": node.metadata_json if isinstance(node.metadata_json, dict) else {},
                "source_attribution": node.source_attribution or source_attribution,
                "license_type": node.license_type,
                "original_source_url": node.original_source_url or original_source_url,
                "tags": node.tags if isinstance(node.tags, list) else [],
                "created_by": current_user.id,
                "last_modified_by": current_user.id,
            }

            level_insert_payloads.append(node_insert_payload)
            level_old_node_ids.append(node.node_id)
            media_items = node.media_items if isinstance(node.media_items, list) else []
            level_node_assets.append(
                (node.node_id, commentary_variants, translation_variants, word_meanings_rows, media_items)
            )
            prepared_count += 1

            if progress_callback and prepared_count % 250 == 0:
                progress_callback(
                    "Preparing node batch",
                    nodes_created + prepared_count,
                    total_nodes,
                )

        inserted_count = 0
        for chunk_start in range(0, len(level_insert_payloads), node_insert_chunk_size):
            chunk = level_insert_payloads[chunk_start:chunk_start + node_insert_chunk_size]
            chunk_old_ids = level_old_node_ids[chunk_start:chunk_start + node_insert_chunk_size]
            inserted_chunk_ids: list[int] = []
            for attempt in range(2):
                try:
                    stmt = sa_insert(ContentNode).values(chunk).returning(ContentNode.id)
                    result = db.execute(stmt)
                    inserted_chunk_ids = [row[0] for row in result.fetchall()]
                    if len(inserted_chunk_ids) != len(chunk):
                        raise RuntimeError(
                            "Bulk insert mismatch for content nodes "
                            f"(expected {len(chunk)}, got {len(inserted_chunk_ids)})"
                        )
                    break
                except IntegrityError as exc:
                    if attempt == 0 and _is_content_nodes_pk_violation(exc):
                        try:
                            _sync_content_nodes_id_sequence(db)
                        except Exception as sync_exc:
                            db.rollback()
                            return ImportResponse(
                                success=False,
                                book_id=book.id if book and book.id else None,
                                nodes_created=0,
                                warnings=warnings,
                                error=f"Failed to recover content node sequence: {str(sync_exc)}",
                            )
                        continue

                    db.rollback()
                    return ImportResponse(
                        success=False,
                        book_id=book.id if book and book.id else None,
                        nodes_created=0,
                        warnings=warnings,
                        error=f"Failed to import canonical JSON: {str(exc)}",
                    )

            # Update the mapping immediately after each chunk so that nodes in later
            # chunks of the same level can resolve referenced_node_id cross-chunk.
            for old_node_id, new_node_id in zip(chunk_old_ids, inserted_chunk_ids):
                old_to_new_node_ids[old_node_id] = new_node_id

            inserted_count += len(inserted_chunk_ids)

            if progress_callback:
                progress_callback(
                    "Inserting node batch",
                    nodes_created + inserted_count,
                    total_nodes,
                )

        for old_node_id, commentary_variants, translation_variants, word_meanings_rows, media_items in level_node_assets:
            new_node_id = old_to_new_node_ids[old_node_id]

            if commentary_variants:
                pending_commentary.extend(
                    _migrate_commentary_variants_to_entries(new_node_id, commentary_variants)
                )
            if translation_variants:
                pending_translation.extend(
                    _migrate_translation_variants_to_entries(new_node_id, translation_variants)
                )
            if isinstance(word_meanings_rows, list) and word_meanings_rows:
                pending_word_meanings.extend(
                    _migrate_word_meanings_to_entries(new_node_id, word_meanings_rows)
                )

            for media in media_items:
                media_type = (media.media_type or "").strip().lower()
                media_url = (media.url or "").strip()
                if not media_type or not media_url:
                    continue
                if media_type not in ALLOWED_MEDIA_TYPES:
                    continue
                pending_media_files.append(
                    {
                        "node_id": new_node_id,
                        "media_type": media_type,
                        "url": media_url,
                        "metadata_json": media.metadata if isinstance(media.metadata, dict) else {},
                    }
                )

        nodes_created += len(level_nodes)

        if progress_callback:
            progress_callback("Importing nodes", nodes_created, total_nodes)

    _t_nodes_done = time.perf_counter()
    logger.info("[import] content_nodes: %d nodes in %.2fs", nodes_created, _t_nodes_done - _t_start)

    if pending_commentary:
        _t0 = time.perf_counter()
        db.execute(sa_insert(CommentaryEntry), pending_commentary)
        logger.info("[import] commentary_entries: %d rows in %.2fs", len(pending_commentary), time.perf_counter() - _t0)

    if pending_translation:
        _t0 = time.perf_counter()
        db.execute(sa_insert(TranslationEntry), pending_translation)
        logger.info("[import] translation_entries: %d rows in %.2fs", len(pending_translation), time.perf_counter() - _t0)

    if pending_word_meanings:
        _t0 = time.perf_counter()
        db.execute(sa_insert(WordMeaningEntry), pending_word_meanings)
        logger.info("[import] word_meaning_entries: %d rows in %.2fs", len(pending_word_meanings), time.perf_counter() - _t0)

    if pending_media_files:
        _t0 = time.perf_counter()
        db.execute(sa_insert(MediaFile), pending_media_files)
        logger.info("[import] media_files: %d rows in %.2fs", len(pending_media_files), time.perf_counter() - _t0)

    try:
        if progress_callback:
            progress_callback("Finalizing import", nodes_created, total_nodes)
        db.commit()
    except Exception as exc:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id if book and book.id else None,
            nodes_created=0,
            warnings=warnings,
            error=f"Failed to import canonical JSON: {str(exc)}",
        )

    warnings.append(f"Created {nodes_created} nodes from canonical JSON")
    return ImportResponse(
        success=True,
        book_id=book.id,
        nodes_created=nodes_created,
        warnings=warnings,
    )


def _insert_content_nodes(
    nodes_tree: list,
    book: Book,
    schema: ScriptureSchema,
    config,
    current_user: User,
    db: Session,
) -> int:
    """Insert content nodes recursively into database."""
    nodes_created = 0
    level_lookup = {level: idx + 1 for idx, level in enumerate(schema.levels)}

    _sync_content_nodes_id_sequence(db)

    def insert_nodes(nodes: list, parent_id: int | None = None):
        nonlocal nodes_created
        for node_data in nodes:
            try:
                level_name = node_data.get("level_name", "")
                level_order = level_lookup.get(level_name, 1)
                children = node_data.get("children") or []

                content_node = ContentNode(
                    book_id=book.id,
                    parent_node_id=parent_id,
                    level_name=level_name,
                    level_order=level_order,
                    sequence_number=node_data.get("sequence_number", 1),
                    title_english=node_data.get("title_english"),
                    title_sanskrit=node_data.get("title_sanskrit"),
                    title_transliteration=node_data.get("title_transliteration"),
                    title_hindi=node_data.get("title_hindi"),
                    title_tamil=node_data.get("title_tamil"),
                    has_content=node_data.get("has_content", False),
                    content_data=node_data.get("content_data", {}),
                    source_attribution=node_data.get("source_attribution") or config.source_attribution,
                    original_source_url=node_data.get("original_source_url") or config.original_source_url,
                    tags=node_data.get("tags", []),
                    created_by=current_user.id,
                    last_modified_by=current_user.id,
                )
                db.add(content_node)
                nodes_created += 1

                # Only flush when we need the generated ID to set parent_node_id on children.
                # Leaf nodes are batched and flushed together at the end, saving one DB
                # round-trip per leaf node (the vast majority of nodes in large books).
                if children:
                    db.flush()
                    insert_nodes(children, content_node.id)
            except Exception as e:
                raise Exception(f"Error inserting {level_name}: {str(e)}")

    insert_nodes(nodes_tree)
    return nodes_created


@router.post("/import/admin-cleanup-volume", response_model=dict)
def admin_cleanup_volume(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> dict:
    """Admin endpoint — cleans up stale canonical upload temp files and completed import sources from volume."""
    tmp_dir = _canonical_upload_absolute_path(Path("imports") / "canonical-tmp")
    canonical_dir = _canonical_upload_absolute_path(Path("imports") / "canonical")

    deleted_files = []
    errors = []

    # Collect absolute paths locked by active jobs so we never delete them.
    active_jobs = (
        db.query(ImportJob)
        .filter(ImportJob.status.in_(["queued", "running"]))
        .with_entities(ImportJob.canonical_json_url)
        .all()
    )
    locked_absolute_paths: set[Path] = set()
    for (url,) in active_jobs:
        rel = _relative_media_path_from_url(url)
        if rel is not None:
            locked_absolute_paths.add(_canonical_upload_absolute_path(rel))

    preserved_count = 0

    for target_dir, suffixes in [(tmp_dir, {".part", ".meta.json", ".json"}), (canonical_dir, {".json"})]:
        if not target_dir.exists():
            continue
        for f in target_dir.iterdir():
            if f.is_file() and f.suffix in suffixes:
                if f.resolve() in {p.resolve() for p in locked_absolute_paths}:
                    preserved_count += 1
                    continue
                try:
                    size = f.stat().st_size
                    f.unlink(missing_ok=True)
                    deleted_files.append({"path": str(f), "bytes": size})
                except OSError as exc:
                    errors.append(str(exc))

    total_bytes = sum(d["bytes"] for d in deleted_files)
    return {
        "deleted_count": len(deleted_files),
        "deleted_bytes": total_bytes,
        "deleted_mb": round(total_bytes / 1024 / 1024, 2),
        "preserved_count": preserved_count,
        "errors": errors,
        "media_dir": str(MEDIA_STORAGE.root_dir),
    }


@router.post("/import", response_model=ImportResponse, status_code=status.HTTP_202_ACCEPTED)
def import_document(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> ImportResponse:
    """
    Import a scripture document from HTML or PDF.
    Accepts unified import config with 'import_type' field.
    """
    try:
        return _dispatch_import(payload, db, current_user)
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            error=f"Import failed: {str(e)}"
        )


@router.post(
    "/import/jobs",
    response_model=ImportJobAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_import_job(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> ImportJobAcceptedResponse:
    duplicate_job = _find_inflight_duplicate_import_job(payload, db)
    if duplicate_job:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A matching canonical import is already in progress "
                f"(job_id={duplicate_job.job_id})."
            ),
        )

    canonical_json_url, canonical_book_code = _canonical_import_identity(payload)
    job_id = str(uuid4())
    job = ImportJob(
        job_id=job_id,
        status="queued",
        requested_by=current_user.id,
        canonical_json_url=canonical_json_url,
        canonical_book_code=canonical_book_code,
        payload_json=_compact_import_job_payload(payload),
        progress_message="Queued",
        progress_current=0,
        progress_total=None,
        error=None,
        result_json=None,
    )
    db.add(job)
    db.commit()

    threading.Thread(
        target=_run_import_job,
        args=(job_id, payload, current_user.id),
        daemon=True,
        name=f"import-job-{job_id}",
    ).start()
    return ImportJobAcceptedResponse(job_id=job_id, status="queued")


@router.get("/import/jobs/{job_id}", response_model=ImportJobStatusResponse)
def get_import_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> ImportJobStatusResponse:
    job = db.query(ImportJob).filter(ImportJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.requested_by != current_user.id and not (
        current_user.role == "admin" or (current_user.permissions or {}).get("can_admin")
    ):
        raise HTTPException(status_code=403, detail="Forbidden")

    _mark_import_job_stale_if_needed(job, db)

    return ImportJobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        created_at=_to_iso(job.created_at),
        updated_at=_to_iso(job.updated_at),
        progress_message=job.progress_message,
        progress_current=job.progress_current,
        progress_total=job.progress_total,
        error=job.error,
        result=_job_result_to_import_response(job),
    )


@router.post(
    "/import/canonical-uploads/init",
    response_model=CanonicalUploadInitResponse,
    status_code=status.HTTP_201_CREATED,
)
def init_canonical_upload(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> CanonicalUploadInitResponse:
    _ = db
    _ = payload
    _cleanup_stale_canonical_upload_tmp_files()

    upload_id = uuid4().hex
    _, part_relative = _canonical_upload_relative_paths(upload_id)
    part_path = _canonical_upload_absolute_path(part_relative)
    try:
        part_path.parent.mkdir(parents=True, exist_ok=True)
        with open(part_path, "wb") as part_file:
            part_file.write(b"")
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                f"Cannot create upload staging area at {part_path.parent}: "
                f"{type(exc).__name__}: {exc}. "
                f"MEDIA_DIR={os.getenv('MEDIA_DIR', 'media')!r} "
                f"resolved root={MEDIA_STORAGE.root_dir}"
            ),
        ) from exc

    state = {
        "upload_id": upload_id,
        "requested_by": current_user.id,
        "created_at": _utc_now_iso(),
        "next_index": 0,
        "received_bytes": 0,
    }
    try:
        _write_canonical_upload_state(upload_id, state)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                f"Cannot write upload state file: "
                f"{type(exc).__name__}: {exc}"
            ),
        ) from exc

    return CanonicalUploadInitResponse(
        upload_id=upload_id,
        chunk_size_bytes=IMPORT_CANONICAL_CHUNK_MAX_BYTES,
        max_size_bytes=IMPORT_CANONICAL_UPLOAD_MAX_BYTES,
    )


@router.post(
    "/import/canonical-uploads/{upload_id}/chunk",
    response_model=CanonicalUploadChunkResponse,
)
def upload_canonical_chunk(
    upload_id: str,
    index: int = Form(...),
    chunk: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> CanonicalUploadChunkResponse:
    _ = db
    state = _read_canonical_upload_state(upload_id)
    if not state:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canonical upload session not found")

    if state.get("requested_by") != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    next_index = int(state.get("next_index", 0) or 0)
    if index != next_index:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Unexpected chunk index {index}; expected {next_index}",
        )

    try:
        chunk_bytes = chunk.file.read()
    finally:
        chunk.file.close()

    if not chunk_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chunk is empty")

    if len(chunk_bytes) > IMPORT_CANONICAL_CHUNK_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Chunk exceeds maximum allowed size",
        )

    received_bytes = int(state.get("received_bytes", 0) or 0) + len(chunk_bytes)
    if received_bytes > IMPORT_CANONICAL_UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Canonical JSON exceeds maximum allowed size",
        )

    _, part_relative = _canonical_upload_relative_paths(upload_id)
    part_path = _canonical_upload_absolute_path(part_relative)
    if not part_path.exists() or not part_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canonical upload session not found")

    with open(part_path, "ab") as part_file:
        part_file.write(chunk_bytes)

    state["next_index"] = next_index + 1
    state["received_bytes"] = received_bytes
    _write_canonical_upload_state(upload_id, state)

    return CanonicalUploadChunkResponse(
        upload_id=upload_id,
        received_bytes=received_bytes,
        next_index=next_index + 1,
    )


@router.post(
    "/import/canonical-uploads/{upload_id}/complete",
    response_model=CanonicalUploadCompleteResponse,
)
def complete_canonical_upload(
    upload_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> CanonicalUploadCompleteResponse:
    _ = db
    state = _read_canonical_upload_state(upload_id)
    if not state:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canonical upload session not found")

    if state.get("requested_by") != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    received_bytes = int(state.get("received_bytes", 0) or 0)
    if received_bytes <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No uploaded data to finalize")

    _, part_relative = _canonical_upload_relative_paths(upload_id)
    part_path = _canonical_upload_absolute_path(part_relative)
    if not part_path.exists() or not part_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canonical upload session not found")

    try:
        with open(part_path, "r", encoding="utf-8") as part_file:
            parsed_payload = json.load(part_file)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uploaded file is not valid JSON: {str(exc)}",
        ) from exc

    if not isinstance(parsed_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded canonical file must be a JSON object",
        )

    final_relative = Path("imports") / "canonical" / f"{uuid4().hex}.json"
    final_path = _canonical_upload_absolute_path(final_relative)
    final_path.parent.mkdir(parents=True, exist_ok=True)
    part_path.replace(final_path)

    _delete_canonical_upload_state(upload_id)

    return CanonicalUploadCompleteResponse(
        upload_id=upload_id,
        canonical_json_url=_absolute_media_url(request, final_relative),
        size_bytes=received_bytes,
    )


@router.post("/books/{book_id}/import-tree", response_model=BulkTreeImportResponse, status_code=status.HTTP_201_CREATED)
def import_tree_nodes(
    book_id: int,
    payload: BulkTreeImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BulkTreeImportResponse:
    """
    Import hierarchical node tree from scripture importer.
    Accepts chapters with verse children, creates content_nodes preserving hierarchy.

    Args:
        book_id: Target book ID
        payload: BulkTreeImportRequest with:
            - nodes: List of top-level nodes (chapters) with children (verses)
            - clear_existing: Clear all existing nodes before import
            - language_code: Language for created nodes
            - license_type: License for imported content

    Returns:
        BulkTreeImportResponse with creation counts and any errors/warnings
    """
    _ensure_can_contribute(current_user)

    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        return BulkTreeImportResponse(
            success=False,
            book_id=book_id,
            errors=["Book not found"]
        )

    try:
        ensure_book_edit_access(db, current_user, book, detail="You do not have edit access to this book")
    except HTTPException as e:
        return BulkTreeImportResponse(
            success=False,
            book_id=book_id,
            errors=[e.detail]
        )

    if payload.clear_existing:
        try:
            db.query(ContentNode).filter(ContentNode.book_id == book_id).delete(synchronize_session=False)
            db.commit()
        except Exception as e:
            return BulkTreeImportResponse(
                success=False,
                book_id=book_id,
                errors=[f"Failed to clear existing nodes: {str(e)}"]
            )

    schema_levels = (
        book.schema.levels
        if book.schema and isinstance(book.schema.levels, list)
        else []
    )
    level_name_overrides = _book_level_name_overrides(book)

    chapters_created = 0
    verses_created = 0
    errors = []
    warnings = []

    try:
        for chapter_idx, chapter_item in enumerate(payload.nodes, start=1):
            try:
                chapter_seq = chapter_idx
                if chapter_item.sequence_number:
                    seq_str = str(chapter_item.sequence_number).strip()
                    if seq_str.isdigit():
                        chapter_seq = int(seq_str)

                chapter_node = ContentNode(
                    book_id=book_id,
                    parent_node_id=None,
                    level_name=chapter_item.level_name,
                    level_order=chapter_item.level_order,
                    sequence_number=chapter_seq,
                    title_sanskrit=chapter_item.title_sanskrit,
                    title_transliteration=chapter_item.title_transliteration,
                    title_english=chapter_item.title_english,
                    title_hindi=chapter_item.title_hindi,
                    title_tamil=chapter_item.title_tamil,
                    has_content=chapter_item.has_content,
                    content_data=chapter_item.content_data or {},
                    summary_data=chapter_item.summary_data or {},
                    metadata_json=chapter_item.metadata_json or {},
                    source_attribution=chapter_item.source_attribution,
                    license_type=payload.license_type,
                    original_source_url=chapter_item.original_source_url,
                    tags=chapter_item.tags or [],
                    language_code=payload.language_code,
                    created_by=current_user.id,
                    last_modified_by=current_user.id,
                )
                db.add(chapter_node)
                db.flush()
                chapters_created += 1

                for verse_idx, verse_item in enumerate(chapter_item.children, start=1):
                    try:
                        verse_seq = verse_idx
                        if verse_item.sequence_number:
                            seq_str = str(verse_item.sequence_number).strip()
                            # Extract just the last numeric part (e.g., "1.1" → 1, "1" → 1)
                            if '.' in seq_str:
                                seq_str = seq_str.split('.')[-1]
                            if seq_str.isdigit():
                                verse_seq = int(seq_str)

                        verse_node = ContentNode(
                            book_id=book_id,
                            parent_node_id=chapter_node.id,
                            level_name=verse_item.level_name,
                            level_order=verse_item.level_order,
                            sequence_number=verse_seq,
                            title_sanskrit=verse_item.title_sanskrit,
                            title_transliteration=verse_item.title_transliteration,
                            title_english=verse_item.title_english,
                            title_hindi=verse_item.title_hindi,
                            title_tamil=verse_item.title_tamil,
                            has_content=verse_item.has_content,
                            content_data=verse_item.content_data or {},
                            summary_data=verse_item.summary_data or {},
                            metadata_json=verse_item.metadata_json or {},
                            source_attribution=verse_item.source_attribution,
                            license_type=payload.license_type,
                            original_source_url=verse_item.original_source_url,
                            tags=verse_item.tags or [],
                            language_code=payload.language_code,
                            created_by=current_user.id,
                            last_modified_by=current_user.id,
                        )
                        db.add(verse_node)
                        verses_created += 1
                    except Exception as e:
                        errors.append(f"Error creating verse {verse_idx} in chapter {chapter_item.sequence_number}: {str(e)}")

            except Exception as e:
                errors.append(f"Error creating chapter {chapter_item.sequence_number}: {str(e)}")

        db.commit()

        return BulkTreeImportResponse(
            success=len(errors) == 0,
            book_id=book_id,
            chapters_created=chapters_created,
            verses_created=verses_created,
            total_nodes_created=chapters_created + verses_created,
            warnings=warnings,
            errors=errors,
        )

    except Exception as e:
        db.rollback()
        return BulkTreeImportResponse(
            success=False,
            book_id=book_id,
            chapters_created=chapters_created,
            verses_created=verses_created,
            total_nodes_created=chapters_created + verses_created,
            errors=[f"Fatal error during import: {str(e)}"],
        )
