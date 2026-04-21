import os
import random
import re
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import parse_qsl, urlencode, urlparse
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import requests
from sqlalchemy import Integer, cast, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import func

from api.import_parser import ExtractionRules, GenericHTMLImporter, ImportConfig
from api.pdf_importer import PDFImporter, PDFImportConfig
from api.json_importer import JSONImporter, JSONImportConfig
from api.users import get_current_user, get_current_user_optional, require_permission
from services.email import send_share_invitation
from models.book import Book
from models.book_share import BookShare
from models.content_node import ContentNode
from models.commentary_author import CommentaryAuthor
from models.commentary_work import CommentaryWork
from models.commentary_entry import CommentaryEntry
from models.content_rendition import ContentRendition
from models.node_comment import NodeComment
from models.media_file import MediaFile
from models.media_asset import MediaAsset
from models.import_job import ImportJob
from models.property_system import MetadataBinding
from models.database import SessionLocal
from models.provenance_record import ProvenanceRecord
from models.schemas import (
    BookOwnershipTransferRequest,
    BookOwnershipTransferResponse,
    BookExchangePayloadV1,
    BookCreate,
    BookPublic,
    BookShareCreate,
    BookSharePublic,
    BookShareUpdate,
    BookUpdate,
    BulkTreeImportRequest,
    BulkTreeImportResponse,
    ContentNodeCreate,
    ContentNodeFieldPatch,
    ContentNodePublic,
    ContentNodeTree,
    ContentNodeTreeItem,
    ContentNodeUpdate,
    CommentaryAuthorCreate,
    CommentaryAuthorPublic,
    CommentaryAuthorUpdate,
    CommentaryEntryCreate,
    CommentaryEntryPublic,
    CommentaryEntryUpdate,
    CommentaryWorkCreate,
    CommentaryWorkPublic,
    CommentaryWorkUpdate,
    ContentRenditionCreate,
    ContentRenditionPublic,
    ContentRenditionUpdate,
    DraftLicensePolicyIssue,
    DraftLicensePolicyReport,
    MediaAssetPublic,
    MediaFilePublic,
    NodeCommentCreate,
    NodeCommentPublic,
    NodeCommentUpdate,
    ProvenanceRecordPublic,
    ScriptureSchemaCreate,
    ScriptureSchemaPublic,
    ScriptureSchemaUpdate,
    TreeNodeImportItem,
    UserOwnedBookSummary,
    _validate_word_meanings_content_data,
)
from models.scripture_schema import ScriptureSchema
from models.user import User
from services import get_db
from services.book_permissions import (
    BOOK_SHARE_CONTRIBUTOR,
    BOOK_SHARE_EDITOR,
    BOOK_SHARE_VIEWER,
    BOOK_STATUS_DRAFT,
    BOOK_STATUS_PUBLISHED,
    BOOK_VISIBILITY_PRIVATE,
    BOOK_VISIBILITY_PUBLIC,
    book_access_rank,
    book_is_visible_to_user,
    book_owner_id,
    book_status,
    book_visibility,
    ensure_book_edit_access,
    ensure_book_owner_or_edit_any,
    ensure_book_view_access,
    user_can_contribute,
    user_can_edit_any,
)
from services.license_policy import classify_license_action, normalize_license
from services.media_storage import FileTooLargeError, get_media_storage_from_env
from services.transliteration import contains_devanagari, devanagari_to_iast, latin_to_devanagari

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger(__name__)

_NODES_LIST_HARD_LIMIT = int(os.getenv("NODES_LIST_HARD_LIMIT", "50"))
_DISABLE_CONTENT_DATA_LIST_SEARCH = os.getenv("DISABLE_CONTENT_DATA_LIST_SEARCH", "true").strip().lower() in {"1", "true", "yes", "on"}

PUBLIC_READS_ENABLED = os.getenv("PUBLIC_READS_ENABLED", "false").lower() == "true"
MEDIA_STORAGE = get_media_storage_from_env()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_MEDIA_TYPES = {"audio", "video", "image", "link"}
IMPORT_JOB_STALE_AFTER_SECONDS = int(os.getenv("IMPORT_JOB_STALE_AFTER_SECONDS", "300"))
IMPORT_CANONICAL_UPLOAD_MAX_MB = int(os.getenv("IMPORT_CANONICAL_UPLOAD_MAX_MB", "200"))
IMPORT_CANONICAL_UPLOAD_MAX_BYTES = IMPORT_CANONICAL_UPLOAD_MAX_MB * 1024 * 1024
IMPORT_CANONICAL_CHUNK_MAX_BYTES = int(os.getenv("IMPORT_CANONICAL_CHUNK_MAX_BYTES", str(1024 * 1024)))
MEDIA_FILENAME_COMPONENT_RE = re.compile(r"[^A-Za-z0-9._-]+")


def require_import_permission(current_user: User = Depends(get_current_user)) -> User:
    perms = current_user.permissions or {}
    if perms.get("can_import") or perms.get("can_admin") or current_user.role == "admin":
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _save_upload_to_media_storage(file: UploadFile, relative_path: Path) -> int:
    try:
        return MEDIA_STORAGE.save_upload(
            file=file,
            relative_path=relative_path,
            max_upload_bytes=MAX_UPLOAD_BYTES,
        )
    except FileTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large",
        ) from exc


def _relative_media_path_from_url(url: str | None) -> Path | None:
    if not isinstance(url, str):
        return None
    return MEDIA_STORAGE.resolve_relative_path_from_url(url)


def _is_bank_media_path(relative_path: Path | None) -> bool:
    if relative_path is None:
        return False
    return len(relative_path.parts) > 0 and relative_path.parts[0] == "bank"


def _sanitize_media_filename_component(value: str, fallback: str) -> str:
    normalized = re.sub(r"\s+", "-", (value or "").strip())
    normalized = MEDIA_FILENAME_COMPONENT_RE.sub("-", normalized)
    normalized = re.sub(r"-+", "-", normalized).strip("-._")
    return normalized or fallback


def _sanitize_media_suffix(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9.]", "", (value or "").strip())
    cleaned = cleaned.lstrip(".")
    return f".{cleaned}" if cleaned else ""


def _build_media_bank_relative_path(filename: str | None, fallback_suffix: str = "") -> Path:
    raw_name = Path(filename).name if filename else ""
    raw_suffix = Path(raw_name).suffix if raw_name else ""
    suffix = _sanitize_media_suffix(raw_suffix or fallback_suffix)
    stem = Path(raw_name).stem if raw_name else ""
    safe_stem = _sanitize_media_filename_component(stem, "asset")

    candidate = Path("bank") / f"{safe_stem}{suffix}"
    if not MEDIA_STORAGE.exists_relative_path(candidate):
        return candidate

    index = 2
    while True:
        candidate = Path("bank") / f"{safe_stem}-{index}{suffix}"
        if not MEDIA_STORAGE.exists_relative_path(candidate):
            return candidate
        index += 1


def _sanitize_content_data_for_response(content_data: object) -> dict:
    """Ensure content_data is safe for public response validation.

    Older imports may contain malformed `word_meanings` payloads.
    Those should not crash tree browsing for an entire book.
    """
    if not isinstance(content_data, dict):
        return {}

    sanitized = dict(content_data)
    try:
        normalized = _validate_word_meanings_content_data(sanitized)
        return normalized if isinstance(normalized, dict) else sanitized
    except Exception:
        sanitized.pop("word_meanings", None)
        try:
            normalized = _validate_word_meanings_content_data(sanitized)
            return normalized if isinstance(normalized, dict) else sanitized
        except Exception:
            return {}


def _node_response_payload(node: ContentNode) -> dict:
    payload = {key: value for key, value in vars(node).items() if not key.startswith("_")}
    payload["content_data"] = _sanitize_content_data_for_response(payload.get("content_data"))
    return payload


def _media_metadata(media: MediaFile) -> dict:
    metadata = media.metadata_json if isinstance(media.metadata_json, dict) else {}
    return dict(metadata)


def _media_display_order(media: MediaFile) -> int:
    metadata = _media_metadata(media)
    value = metadata.get("display_order")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _media_is_default(media: MediaFile) -> bool:
    return bool(_media_metadata(media).get("is_default"))


def _set_media_metadata(media: MediaFile, metadata: dict) -> None:
    media.metadata_json = metadata
    flag_modified(media, "metadata_json")


def _asset_metadata(asset: MediaAsset) -> dict:
    metadata = asset.metadata_json if isinstance(asset.metadata_json, dict) else {}
    return dict(metadata)


def _set_asset_metadata(asset: MediaAsset, metadata: dict) -> None:
    asset.metadata_json = metadata
    flag_modified(asset, "metadata_json")


def _media_sort_key(media: MediaFile) -> tuple:
    created_ts = media.created_at.timestamp() if media.created_at else 0.0
    return (
        media.media_type or "",
        0 if _media_is_default(media) else 1,
        _media_display_order(media),
        created_ts,
        media.id,
    )


def _ensure_default_for_media_type(db: Session, node_id: int, media_type: str) -> None:
    items = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id, MediaFile.media_type == media_type)
        .all()
    )
    if not items:
        return
    if any(_media_is_default(item) for item in items):
        return

    first_item = min(
        items,
        key=lambda item: (
            _media_display_order(item),
            item.created_at.timestamp() if item.created_at else 0.0,
            item.id,
        ),
    )
    metadata = _media_metadata(first_item)
    metadata["is_default"] = True
    _set_media_metadata(first_item, metadata)


def _parse_numeric_order_value(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized or not normalized.isdigit():
        return None
    return int(normalized)


# Import request/response schemas
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


class InsertReferencesPayload(BaseModel):
    parent_node_id: int | None = None
    node_ids: list[int]
    section_assignments: dict[str, str] | None = None


class LicensePolicyCheckPayload(BaseModel):
    node_ids: list[int]


class NodeMediaReorderPayload(BaseModel):
    media_type: str
    media_ids: list[int]


class NodeReorderPayload(BaseModel):
    direction: Literal["up", "down"]


class NodeMediaSetDefaultPayload(BaseModel):
    is_default: bool = True


class MediaAssetUpdatePayload(BaseModel):
    display_name: str


class MediaAssetCreateLinkPayload(BaseModel):
    url: str
    media_type: str | None = None
    display_name: str | None = None


class MediaBankAttachNodePayload(BaseModel):
    is_default: bool = False
class NodeLevelRepairPayload(BaseModel):
    level_name: str


def _build_license_policy_report_for_node_ids(
    node_ids: list[int],
    db: Session,
) -> DraftLicensePolicyReport:
    normalized_values: set[int] = set()
    for node_id in node_ids:
        try:
            parsed = int(node_id)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            normalized_values.add(parsed)

    normalized_ids = sorted(normalized_values)
    if not normalized_ids:
        return DraftLicensePolicyReport(status="pass")

    rows = (
        db.query(ContentNode.id, ContentNode.license_type)
        .filter(ContentNode.id.in_(normalized_ids))
        .all()
    )
    licenses_by_node_id = {row.id: row.license_type for row in rows}

    warning_issues: list[DraftLicensePolicyIssue] = []
    blocked_issues: list[DraftLicensePolicyIssue] = []

    for source_node_id in normalized_ids:
        license_type = normalize_license(licenses_by_node_id.get(source_node_id))
        action = classify_license_action(license_type)
        if action == "allow":
            continue

        issue = DraftLicensePolicyIssue(
            source_node_id=source_node_id,
            license_type=license_type,
            policy_action=action,
        )
        if action == "block":
            blocked_issues.append(issue)
        else:
            warning_issues.append(issue)

    if blocked_issues:
        status_value = "block"
    elif warning_issues:
        status_value = "warn"
    else:
        status_value = "pass"

    return DraftLicensePolicyReport(
        status=status_value,
        warning_issues=warning_issues,
        blocked_issues=blocked_issues,
    )


def require_view_permission(
    current_user: User | None = Depends(get_current_user_optional),
) -> User | None:
    # Schemas are public metadata - always allow viewing
    return current_user


def _user_can_contribute(current_user: User) -> bool:
    return user_can_contribute(current_user)


def _user_can_edit_any(current_user: User) -> bool:
    return user_can_edit_any(current_user)


def _book_owner_id(book: Book) -> int | None:
    return book_owner_id(book)


def _book_status(book: Book) -> str:
    return book_status(book)


def _book_visibility(book: Book) -> str:
    return book_visibility(book)


def _book_word_meanings_level_rollout(book: Book) -> tuple[bool, set[str]]:
    metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    word_meanings_config = metadata.get("word_meanings") if isinstance(metadata.get("word_meanings"), dict) else {}

    has_explicit_level_config = "enabled_levels" in word_meanings_config
    raw_levels = word_meanings_config.get("enabled_levels")

    enabled_levels: set[str] = set()
    if isinstance(raw_levels, list):
        for level in raw_levels:
            if isinstance(level, str) and level.strip():
                enabled_levels.add(level.strip().lower())

    return has_explicit_level_config, enabled_levels


def _content_has_word_meanings(content_data: object) -> bool:
    if not isinstance(content_data, dict):
        return False
    return isinstance(content_data.get("word_meanings"), dict)


def _ensure_word_meanings_level_is_enabled(book: Book, level_name: str, content_data: object) -> None:
    if not _content_has_word_meanings(content_data):
        return

    has_explicit_level_config, enabled_levels = _book_word_meanings_level_rollout(book)
    if not has_explicit_level_config:
        return

    normalized_level = (level_name or "").strip().lower()
    if normalized_level in enabled_levels:
        return

    configured_levels = sorted(enabled_levels)
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=(
            "content_data.word_meanings is not enabled for this level"
            f" ({level_name}). Enabled levels: {configured_levels}"
        ),
    )


def _book_access_rank(db: Session, book: Book, current_user: User | None) -> int:
    computed_rank = book_access_rank(
        db,
        book,
        current_user,
        allow_anonymous_private_reads=True,
        tolerate_missing_share_table=True,
    )
    if current_user is None:
        return computed_rank
    return max(1, computed_rank)


def _book_is_visible_to_user(db: Session, book: Book, current_user: User | None) -> bool:
    return _book_access_rank(db, book, current_user) >= 1


def _ensure_book_view_access(db: Session, book: Book, current_user: User | None) -> None:
    if _book_is_visible_to_user(db, book, current_user):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _book_level_name_overrides(book: Book | None) -> dict[str, str]:
    if book is None:
        return {}
    raw = getattr(book, "level_name_overrides", None)
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        canonical_level = key.strip()
        display_level = value.strip()
        if canonical_level and display_level:
            normalized[canonical_level] = display_level
    return normalized


def _validate_level_name_overrides(
    level_name_overrides: object,
    schema_levels: list[str],
) -> dict[str, str]:
    if level_name_overrides is None:
        return {}
    if not isinstance(level_name_overrides, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="level_name_overrides must be an object",
        )

    canonical_levels = [level for level in schema_levels if isinstance(level, str) and level.strip()]
    canonical_lookup = {level.lower(): level for level in canonical_levels}

    normalized: dict[str, str] = {}
    for key, value in level_name_overrides.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="level_name_overrides keys and values must be strings",
            )

        requested_key = key.strip()
        requested_value = value.strip()
        if not requested_key or not requested_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="level_name_overrides keys and values must be non-empty",
            )

        canonical_key = canonical_lookup.get(requested_key.lower())
        if canonical_key is None:
            valid_levels = ", ".join(canonical_levels)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid override level '{requested_key}'. Valid levels: {valid_levels}",
            )

        normalized[canonical_key] = requested_value

    return normalized


def _display_level_name_for_book(book: Book | None, level_name: str | None) -> str | None:
    if not isinstance(level_name, str):
        return level_name

    overrides = _book_level_name_overrides(book)
    if not overrides:
        return level_name

    exact = overrides.get(level_name)
    if isinstance(exact, str) and exact.strip():
        return exact.strip()

    lowered_level = level_name.strip().lower()
    if not lowered_level:
        return level_name

    case_insensitive_key = next(
        (
            canonical
            for canonical in overrides.keys()
            if isinstance(canonical, str) and canonical.lower() == lowered_level
        ),
        None,
    )
    if not case_insensitive_key:
        return level_name

    mapped = overrides.get(case_insensitive_key)
    if isinstance(mapped, str) and mapped.strip():
        return mapped.strip()
    return level_name


def _book_public_model(book: Book) -> BookPublic:
    existing_metadata = book.metadata_json or {}
    if not isinstance(existing_metadata, dict):
        existing_metadata = {}
    metadata = dict(existing_metadata)

    metadata_out = dict(metadata)
    metadata_out["status"] = _book_status(book)
    metadata_out["visibility"] = _book_visibility(book)

    payload = {
        "id": book.id,
        "schema_id": book.schema_id,
        "book_name": book.book_name,
        "book_code": book.book_code,
        "language_primary": book.language_primary,
        "metadata_json": metadata_out,
        "level_name_overrides": _book_level_name_overrides(book),
        "variant_authors": book.variant_authors if isinstance(book.variant_authors, dict) else {},
        "status": metadata_out["status"],
        "visibility": metadata_out["visibility"],
        "schema": book.schema,
    }
    return BookPublic.model_validate(payload)


def _owned_books_for_user(db: Session, user: User) -> list[Book]:
    user_id = user.id
    user_email = (user.email or "").strip().lower()
    candidate_books = db.query(Book).all()

    owned: list[Book] = []
    for book in candidate_books:
        owner_id = _book_owner_id(book)
        if owner_id == user_id:
            owned.append(book)
            continue

        # Backward-compatible ownership resolution for older records that
        # persisted owner_email but not owner_id.
        metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
        owner_email = str(metadata.get("owner_email") or "").strip().lower()
        if owner_id is None and user_email and owner_email == user_email:
            owned.append(book)

    return owned


def _normalize_variant_author_slug(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized


def _normalize_content_variant_authors(
    content_data: dict | None,
    existing_registry: dict[str, str] | None = None,
) -> tuple[dict, dict[str, str]]:
    resolved_content = dict(content_data) if isinstance(content_data, dict) else {}
    registry = existing_registry if isinstance(existing_registry, dict) else {}
    discovered_authors: dict[str, str] = {}

    def _allocate_slug(preferred_slug: str, author_name: str) -> str:
        base_slug = preferred_slug or _normalize_variant_author_slug(author_name)
        if not base_slug:
            return ""

        existing_name = registry.get(base_slug) or discovered_authors.get(base_slug)
        if not existing_name or existing_name == author_name:
            return base_slug

        suffix = 2
        candidate = f"{base_slug}_{suffix}"
        while True:
            candidate_name = registry.get(candidate) or discovered_authors.get(candidate)
            if not candidate_name or candidate_name == author_name:
                return candidate
            suffix += 1
            candidate = f"{base_slug}_{suffix}"

    for field_name in ("translation_variants", "commentary_variants"):
        raw_entries = resolved_content.get(field_name)
        if not isinstance(raw_entries, list):
            continue

        normalized_entries: list = []
        for raw_entry in raw_entries:
            if not isinstance(raw_entry, dict):
                normalized_entries.append(raw_entry)
                continue

            entry = dict(raw_entry)
            author_name = entry.get("author") if isinstance(entry.get("author"), str) else ""
            author_name = author_name.strip()
            preferred_slug = entry.get("author_slug") if isinstance(entry.get("author_slug"), str) else ""
            preferred_slug = preferred_slug.strip()

            resolved_slug = _allocate_slug(preferred_slug, author_name)
            if resolved_slug:
                entry["author_slug"] = resolved_slug

            if not author_name and resolved_slug:
                author_name = (registry.get(resolved_slug) or discovered_authors.get(resolved_slug) or "").strip()
                if author_name:
                    entry["author"] = author_name

            if resolved_slug and author_name:
                discovered_authors[resolved_slug] = author_name

            normalized_entries.append(entry)

        resolved_content[field_name] = normalized_entries

    return resolved_content, discovered_authors


def _merge_variant_authors(book: Book, incoming_authors: dict[str, str] | None) -> None:
    if not isinstance(incoming_authors, dict) or not incoming_authors:
        return

    merged = dict(book.variant_authors) if isinstance(book.variant_authors, dict) else {}
    changed = False
    for slug, name in incoming_authors.items():
        slug_text = str(slug).strip()
        name_text = str(name).strip()
        if not slug_text or not name_text:
            continue
        if merged.get(slug_text) == name_text:
            continue
        if slug_text in merged:
            continue
        merged[slug_text] = name_text
        changed = True

    if changed or not isinstance(book.variant_authors, dict):
        book.variant_authors = merged


def _metadata_string_values(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        values: list[str] = []
        for item in value:
            if isinstance(item, str):
                values.append(item)
        return values
    return []


def _book_search_haystacks(book: Book) -> dict[str, list[str]]:
    metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}

    title_values = [book.book_name]
    title_values.extend(_metadata_string_values(metadata.get("title")))

    alt_titles = []
    alt_titles.extend(_metadata_string_values(metadata.get("alternate_titles")))
    alt_titles.extend(_metadata_string_values(metadata.get("alternative_titles")))
    alt_titles.extend(_metadata_string_values(metadata.get("alt_titles")))

    short_descriptions = []
    short_descriptions.extend(_metadata_string_values(metadata.get("short_description")))
    short_descriptions.extend(_metadata_string_values(metadata.get("description")))
    short_descriptions.extend(_metadata_string_values(metadata.get("summary")))

    tags = _metadata_string_values(metadata.get("tags"))

    return {
        "title": title_values,
        "alt_titles": alt_titles,
        "short_description": short_descriptions,
        "tags": tags,
    }


def _book_relevance_score(book: Book, query: str) -> int:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return 0

    terms = [term for term in normalized_query.split() if term]
    if not terms:
        return 0

    fields = _book_search_haystacks(book)
    score = 0

    weights = {
        "title": 8,
        "alt_titles": 5,
        "short_description": 3,
        "tags": 4,
    }

    for field_name, values in fields.items():
        weight = weights.get(field_name, 1)
        for raw_value in values:
            normalized_value = raw_value.strip().lower()
            if not normalized_value:
                continue

            if normalized_query in normalized_value:
                score += weight * 4

            for term in terms:
                if term in normalized_value:
                    score += weight

    return score


def _ensure_can_contribute(current_user: User) -> None:
    if not _user_can_contribute(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _ensure_book_edit_access(db: Session, current_user: User, book: Book) -> None:
    ensure_book_edit_access(
        db,
        current_user,
        book,
        detail="You do not have edit access to this book",
    )


def _ensure_node_edit_access(db: Session, current_user: User, node: ContentNode) -> None:
    if _user_can_edit_any(current_user):
        return
    if node.created_by == current_user.id:
        return
    book = db.query(Book).filter(Book.id == node.book_id).first()
    if book and _book_access_rank(db, book, current_user) >= 2:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You can only edit your own content",
    )


def _book_share_public_model(share: BookShare, shared_user: User) -> BookSharePublic:
    return BookSharePublic.model_validate(
        {
            "id": share.id,
            "book_id": share.book_id,
            "shared_with_user_id": share.shared_with_user_id,
            "permission": share.permission,
            "shared_by_user_id": share.shared_by_user_id,
            "shared_with_email": shared_user.email,
            "shared_with_username": shared_user.username,
            "shared_with_is_active": bool(shared_user.is_active),
        }
    )


def _shared_book_access_path(book_id: int, email: str | None = None) -> str:
    params: dict[str, str] = {
        "book": str(book_id),
        "preview": "book",
    }
    if email:
        params["email"] = email
    return f"/scriptures?{urlencode(params)}"


def _normalize_shared_access_path(access_path: str | None, book_id: int) -> str:
    fallback_path = _shared_book_access_path(book_id)
    if not access_path:
        return fallback_path

    candidate = access_path.strip()
    if not candidate:
        return fallback_path

    parsed = urlparse(candidate)
    if parsed.scheme or parsed.netloc:
        return fallback_path

    if parsed.path != "/scriptures":
        return fallback_path

    query_pairs = parse_qsl(parsed.query, keep_blank_values=False)
    params: dict[str, str] = {}
    for key, value in query_pairs:
        if key not in params and value.strip():
            params[key] = value.strip()

    params["book"] = str(book_id)
    node_value = params.get("node", "").strip()
    if node_value:
        params["preview"] = "node"
    else:
        params.pop("node", None)
        params["preview"] = "book"

    return f"/scriptures?{urlencode(params)}"


def _registration_invite_link(app_base_url: str, email: str, next_path: str) -> str:
    query = urlencode({"email": email, "next": next_path})
    return f"{app_base_url}/signup?{query}"


def _append_email_to_share_path(access_path: str, email: str) -> str:
    parsed = urlparse(access_path)
    query_pairs = parse_qsl(parsed.query, keep_blank_values=False)
    params: dict[str, str] = {}
    for key, value in query_pairs:
        if key not in params and value.strip():
            params[key] = value.strip()
    params["email"] = email
    return f"{parsed.path}?{urlencode(params)}"


def _clean_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _autofill_sanskrit_transliteration_pair(
    sanskrit_value: object,
    transliteration_value: object,
) -> tuple[str | None, str | None]:
    sanskrit = _clean_optional_text(sanskrit_value)
    transliteration = _clean_optional_text(transliteration_value)

    if not sanskrit and not transliteration:
        return None, None

    if sanskrit and transliteration:
        return sanskrit, transliteration

    if not sanskrit and transliteration:
        if contains_devanagari(transliteration):
            return transliteration, devanagari_to_iast(transliteration) or transliteration
        return latin_to_devanagari(transliteration), transliteration

    if sanskrit and not transliteration:
        if contains_devanagari(sanskrit):
            return sanskrit, devanagari_to_iast(sanskrit)
        generated_sanskrit = latin_to_devanagari(sanskrit)
        return generated_sanskrit or sanskrit, sanskrit

    return sanskrit, transliteration


def _autofill_content_data_pair(content_data: dict | None) -> dict | None:
    if not isinstance(content_data, dict):
        return content_data

    basic_raw = content_data.get("basic")
    if not isinstance(basic_raw, dict):
        return content_data

    basic = dict(basic_raw)
    sanskrit, transliteration = _autofill_sanskrit_transliteration_pair(
        basic.get("sanskrit"),
        basic.get("transliteration"),
    )
    basic["sanskrit"] = sanskrit
    basic["transliteration"] = transliteration

    next_content_data = dict(content_data)
    next_content_data["basic"] = basic
    try:
        normalized = _validate_word_meanings_content_data(next_content_data)
        return normalized if isinstance(normalized, dict) else next_content_data
    except Exception:
        # Canonical/legacy imports may contain malformed word_meanings payloads.
        # Preserve the rest of the content instead of failing the entire import.
        next_content_data.pop("word_meanings", None)
        normalized = _validate_word_meanings_content_data(next_content_data)
        return normalized if isinstance(normalized, dict) else next_content_data


@router.get("/schemas", response_model=list[ScriptureSchemaPublic])
def list_schemas(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ScriptureSchemaPublic]:
    _ = current_user
    schemas = db.query(ScriptureSchema).order_by(ScriptureSchema.id).all()
    return [ScriptureSchemaPublic.model_validate(item) for item in schemas]


@router.post(
    "/schemas",
    response_model=ScriptureSchemaPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_schema(
    payload: ScriptureSchemaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_contribute")),
) -> ScriptureSchemaPublic:
    _ = current_user
    schema = ScriptureSchema(
        name=payload.name,
        description=payload.description,
        levels=payload.levels,
        level_template_defaults=payload.level_template_defaults or {},
    )
    db.add(schema)
    db.commit()
    db.refresh(schema)
    return ScriptureSchemaPublic.model_validate(schema)


@router.get("/schemas/{schema_id}", response_model=ScriptureSchemaPublic)
def get_schema(
    schema_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> ScriptureSchemaPublic:
    _ = current_user
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ScriptureSchemaPublic.model_validate(schema)


@router.patch("/schemas/{schema_id}", response_model=ScriptureSchemaPublic)
def update_schema(
    schema_id: int,
    payload: ScriptureSchemaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> ScriptureSchemaPublic:
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(schema, key, value)

    db.commit()
    db.refresh(schema)
    return ScriptureSchemaPublic.model_validate(schema)


@router.delete("/schemas/{schema_id}", response_model=dict)
def delete_schema(
    schema_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_edit")),
) -> dict:
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    db.delete(schema)
    db.commit()
    return {"message": "Deleted"}


@router.get("/books", response_model=list[BookPublic])
def list_books(
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[BookPublic]:
    query_text = (q or "").strip()
    if query_text:
        # Pre-filter at DB level: only load books containing at least one search term,
        # then let Python scoring rank them precisely.
        terms = [t for t in query_text.lower().split() if t]
        if terms:
            from sqlalchemy import String
            candidate_filters = []
            for term in terms:
                like_term = f"%{term}%"
                candidate_filters.append(Book.book_name.ilike(like_term))
                candidate_filters.append(cast(Book.metadata_json, String).ilike(like_term))
            books = db.query(Book).filter(or_(*candidate_filters)).all()
        else:
            books = db.query(Book).all()
        ranked_books = []
        for book in books:
            score = _book_relevance_score(book, query_text)
            if score > 0:
                ranked_books.append((book, score))

        ranked_books.sort(
            key=lambda pair: (
                -pair[1],
                -(pair[0].created_at.timestamp() if pair[0].created_at else 0),
                -pair[0].id,
            )
        )
        page = [pair[0] for pair in ranked_books[offset : offset + limit]]
        return [_book_public_model(item) for item in page]

    books = (
        db.query(Book)
        .order_by(Book.created_at.desc(), Book.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_book_public_model(item) for item in books]


@router.post("/books", response_model=BookPublic, status_code=status.HTTP_201_CREATED)
def create_book(
    payload: BookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookPublic:
    _ensure_can_contribute(current_user)

    schema_levels: list[str] = []
    if payload.schema_id is not None:
        schema = (
            db.query(ScriptureSchema)
            .filter(ScriptureSchema.id == payload.schema_id)
            .first()
        )
        if not schema:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid schema_id",
            )
        schema_levels = schema.levels if isinstance(schema.levels, list) else []

    level_name_overrides = _validate_level_name_overrides(
        payload.level_name_overrides,
        schema_levels,
    )

    metadata_json = payload.metadata or {}
    if not isinstance(metadata_json, dict):
        metadata_json = {}
    metadata_json["owner_id"] = current_user.id
    metadata_json["owner_email"] = current_user.email
    metadata_json["status"] = BOOK_STATUS_DRAFT
    metadata_json["visibility"] = BOOK_VISIBILITY_PRIVATE

    book_code = payload.book_code
    if isinstance(book_code, str) and not book_code.strip():
        book_code = None

    book = Book(
        schema_id=payload.schema_id,
        book_name=payload.book_name,
        book_code=book_code,
        language_primary=payload.language_primary,
        metadata_json=metadata_json,
        level_name_overrides=level_name_overrides,
    )
    db.add(book)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Book could not be created. Check schema and book code uniqueness.",
        )
    db.refresh(book)
    return _book_public_model(book)


@router.get("/books/{book_id}", response_model=BookPublic)
def get_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> BookPublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, book, current_user)
    return _book_public_model(book)


@router.get("/books/{book_id}/provenance", response_model=list[ProvenanceRecordPublic])
def list_book_provenance(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ProvenanceRecordPublic]:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_book_view_access(db, book, current_user)

    records = (
        db.query(ProvenanceRecord)
        .filter(ProvenanceRecord.target_book_id == book_id)
        .order_by(ProvenanceRecord.id.desc())
        .all()
    )
    return [ProvenanceRecordPublic.model_validate(item) for item in records]


@router.get("/nodes/{node_id}/provenance", response_model=list[ProvenanceRecordPublic])
def list_node_provenance(
    node_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ProvenanceRecordPublic]:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    book = db.query(Book).filter(Book.id == node.book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_book_view_access(db, book, current_user)

    records = (
        db.query(ProvenanceRecord)
        .filter(ProvenanceRecord.target_node_id == node_id)
        .order_by(ProvenanceRecord.id.desc())
        .all()
    )
    return [ProvenanceRecordPublic.model_validate(item) for item in records]


@router.patch("/books/{book_id}", response_model=BookPublic)
def update_book(
    book_id: int,
    payload: BookUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookPublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_book_edit_access(db, current_user, book)

    if payload.status is not None or payload.visibility is not None:
        ensure_book_owner_or_edit_any(
            current_user,
            book,
            detail="Only the book owner can publish or change visibility",
        )

    updates = payload.model_dump(exclude_unset=True)
    schema_update_requested = "schema_id" in updates
    level_overrides_update_requested = "level_name_overrides" in updates

    next_schema_id = updates.get("schema_id", book.schema_id)
    next_schema_levels: list[str] = []
    if next_schema_id is not None:
        schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == next_schema_id).first()
        if not schema:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid schema_id",
            )
        next_schema_levels = schema.levels if isinstance(schema.levels, list) else []

    if schema_update_requested or level_overrides_update_requested:
        requested_overrides = (
            updates.get("level_name_overrides")
            if level_overrides_update_requested
            else book.level_name_overrides
        )
        validated_level_overrides = _validate_level_name_overrides(
            requested_overrides,
            next_schema_levels,
        )
        book.level_name_overrides = validated_level_overrides

    metadata = book.metadata_json or {}
    if not isinstance(metadata, dict):
        metadata = {}

    for key, value in updates.items():
        if key == "metadata":
            metadata = dict(value) if isinstance(value, dict) else {}
        elif key == "level_name_overrides":
            continue
        elif key == "variant_authors":
            if isinstance(value, dict):
                book.variant_authors = {str(k): str(v) for k, v in value.items() if k and v}
            continue
        elif key == "status":
            normalized_status = str(value).strip().lower() if value else ""
            if normalized_status not in {BOOK_STATUS_DRAFT, BOOK_STATUS_PUBLISHED}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status. Use 'draft' or 'published'",
                )
            metadata["status"] = normalized_status
            if normalized_status == BOOK_STATUS_PUBLISHED:
                metadata["visibility"] = BOOK_VISIBILITY_PUBLIC
        elif key == "visibility":
            normalized_visibility = str(value).strip().lower() if value else ""
            if normalized_visibility not in {BOOK_VISIBILITY_PRIVATE, BOOK_VISIBILITY_PUBLIC}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid visibility. Use 'private' or 'public'",
                )
            metadata["visibility"] = normalized_visibility
            if normalized_visibility == BOOK_VISIBILITY_PRIVATE:
                metadata["status"] = BOOK_STATUS_DRAFT
        else:
            setattr(book, key, value)

    if _book_owner_id(book) is None:
        metadata["owner_id"] = current_user.id
    if "owner_email" not in metadata and isinstance(current_user.email, str):
        metadata["owner_email"] = current_user.email
    if "status" not in metadata:
        metadata["status"] = BOOK_STATUS_DRAFT
    if "visibility" not in metadata:
        metadata["visibility"] = BOOK_VISIBILITY_PRIVATE

    setattr(book, "metadata_json", metadata)
    flag_modified(book, "metadata_json")

    db.commit()
    db.refresh(book)
    return _book_public_model(book)


@router.delete("/books/{book_id}", response_model=dict)
def delete_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ensure_book_owner_or_edit_any(
        current_user,
        book,
        detail="Only the book owner can delete this book",
    )

    if _book_visibility(book) == BOOK_VISIBILITY_PUBLIC and not _user_can_edit_any(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public books cannot be deleted. Unpublish the book first.",
        )

    db.delete(book)
    db.commit()
    return {"message": "Deleted"}


@router.get("/books/{book_id}/shares", response_model=list[BookSharePublic])
def list_book_shares(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookSharePublic]:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ensure_book_owner_or_edit_any(current_user, book)

    shares = db.query(BookShare).filter(BookShare.book_id == book_id).order_by(BookShare.id).all()
    users_by_id = {
        user.id: user
        for user in db.query(User)
        .filter(User.id.in_([share.shared_with_user_id for share in shares]))
        .all()
    }
    return [
        _book_share_public_model(share, users_by_id[share.shared_with_user_id])
        for share in shares
        if share.shared_with_user_id in users_by_id
    ]


@router.get("/books/ownership/me", response_model=list[UserOwnedBookSummary])
def list_owned_books_for_current_user(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserOwnedBookSummary]:
    owned_books = _owned_books_for_user(db, current_user)
    result: list[UserOwnedBookSummary] = []
    for book in owned_books:
        visibility = _book_visibility(book)
        status_value = _book_status(book)
        result.append(
            UserOwnedBookSummary(
                id=book.id,
                book_name=book.book_name,
                book_code=book.book_code,
                visibility="public" if visibility == BOOK_VISIBILITY_PUBLIC else "private",
                status="published" if status_value == BOOK_STATUS_PUBLISHED else "draft",
            )
        )
    return result


@router.post("/books/ownership/transfer", response_model=BookOwnershipTransferResponse)
def transfer_owned_books_to_user(
    payload: BookOwnershipTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookOwnershipTransferResponse:
    source_user_id = current_user.id
    owned_books = _owned_books_for_user(db, current_user)
    if not owned_books:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You do not own any books")

    target_email = payload.target_email.strip().lower()
    target_user = db.query(User).filter(func.lower(User.email) == target_email).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    if not target_user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user must be active")
    if target_user.id == source_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and target users must be different",
        )

    owned_by_id = {book.id: book for book in owned_books}
    if payload.transfer_all_owned:
        selected_books = list(owned_by_id.values())
    else:
        requested_ids = [int(book_id) for book_id in payload.book_ids if int(book_id) > 0]
        if not requested_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one book")
        unique_ids = list(dict.fromkeys(requested_ids))
        missing_ids = [book_id for book_id in unique_ids if book_id not in owned_by_id]
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only transfer books that you own",
            )
        selected_books = [owned_by_id[book_id] for book_id in unique_ids]

    transferred_book_ids: list[int] = []
    for book in selected_books:
        metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
        metadata_out = dict(metadata)
        metadata_out["owner_id"] = target_user.id
        metadata_out["owner_email"] = target_user.email
        book.metadata_json = metadata_out
        flag_modified(book, "metadata_json")
        transferred_book_ids.append(book.id)

    db.commit()

    return BookOwnershipTransferResponse(
        source_user_id=source_user_id,
        target_user_id=target_user.id,
        target_email=target_user.email,
        transferred_book_ids=transferred_book_ids,
        transferred_count=len(transferred_book_ids),
    )


@router.post("/books/{book_id}/shares", response_model=BookSharePublic, status_code=status.HTTP_201_CREATED)
def create_or_update_book_share(
    book_id: int,
    payload: BookShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookSharePublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ensure_book_owner_or_edit_any(current_user, book)

    normalized_email = payload.email.strip().lower()
    shared_user = db.query(User).filter(func.lower(User.email) == normalized_email).first()
    if not shared_user:
        shared_user = User(
            email=normalized_email,
            is_active=False,
            is_verified=False,
        )
        db.add(shared_user)
        try:
            db.flush()
        except IntegrityError:
            # Another request may have created the same email concurrently.
            db.rollback()
            shared_user = db.query(User).filter(func.lower(User.email) == normalized_email).first()
            if not shared_user:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Could not resolve shared user for this email",
                )

    owner_id = _book_owner_id(book)
    if owner_id is not None and shared_user.id == owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner cannot be shared")

    share = (
        db.query(BookShare)
        .filter(BookShare.book_id == book_id, BookShare.shared_with_user_id == shared_user.id)
        .first()
    )
    if share:
        share.permission = payload.permission
        share.shared_by_user_id = current_user.id
    else:
        share = BookShare(
            book_id=book_id,
            shared_with_user_id=shared_user.id,
            permission=payload.permission,
            shared_by_user_id=current_user.id,
        )
        db.add(share)

    try:
        db.commit()
    except IntegrityError:
        # Handle races on (book_id, shared_with_user_id) unique constraint.
        db.rollback()
        existing_share = (
            db.query(BookShare)
            .filter(BookShare.book_id == book_id, BookShare.shared_with_user_id == shared_user.id)
            .first()
        )
        if not existing_share:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Share already exists")
        existing_share.permission = payload.permission
        existing_share.shared_by_user_id = current_user.id
        db.commit()
        share = existing_share
    db.refresh(share)

    # Send invitation email if requested
    if payload.send_email:
        app_base_url = os.getenv("APP_BASE_URL", "https://scriptle.org")
        share_access_path = _normalize_shared_access_path(payload.access_path, book_id)
        invite_link = (
            f"{app_base_url}{_append_email_to_share_path(share_access_path, shared_user.email)}"
            if shared_user.is_active
            else _registration_invite_link(app_base_url, shared_user.email, share_access_path)
        )

        try:
            send_share_invitation(
                recipient_email=shared_user.email,
                book_title=book.book_name or f"Book {book_id}",
                inviter_name=current_user.username or current_user.email,
                inviter_email=current_user.email,
                invite_link=invite_link,
                permission=payload.permission,
                recipient_has_account=bool(shared_user.is_active),
            )
        except Exception:
            # Share is already committed; email failure should not fail the API response.
            logger.exception(
                "Book share invitation email failed for book_id=%s recipient=%s",
                book_id,
                shared_user.email,
            )

    return _book_share_public_model(share, shared_user)


@router.patch("/books/{book_id}/shares/{shared_user_id}", response_model=BookSharePublic)
def update_book_share(
    book_id: int,
    shared_user_id: int,
    payload: BookShareUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookSharePublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ensure_book_owner_or_edit_any(current_user, book)

    share = (
        db.query(BookShare)
        .filter(BookShare.book_id == book_id, BookShare.shared_with_user_id == shared_user_id)
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")

    share.permission = payload.permission
    share.shared_by_user_id = current_user.id
    db.commit()
    db.refresh(share)

    shared_user = db.query(User).filter(User.id == shared_user_id).first()
    if not shared_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return _book_share_public_model(share, shared_user)


@router.delete("/books/{book_id}/shares/{shared_user_id}", response_model=dict)
def delete_book_share(
    book_id: int,
    shared_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ensure_book_owner_or_edit_any(current_user, book)

    share = (
        db.query(BookShare)
        .filter(BookShare.book_id == book_id, BookShare.shared_with_user_id == shared_user_id)
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found")

    db.delete(share)
    db.commit()
    return {"message": "Deleted"}


@router.get("/stats", response_model=dict)
def get_stats(
    db: Session = Depends(get_db),
) -> dict:
    """Public endpoint - no authentication required"""
    books_count = db.query(Book).count()
    # Count only leaf nodes (verses) - nodes that have content
    nodes_count = db.query(ContentNode).filter(ContentNode.has_content == True).count()
    users_count = db.query(User).count()
    return {
        "books_count": books_count,
        "nodes_count": nodes_count,
        "users_count": users_count,
    }


@router.get("/daily-verse", response_model=dict | None)
def get_daily_verse(
    mode: str = "daily",
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> dict | None:
    """
    Public endpoint - authentication optional
    mode: 'daily' for consistent daily verse (seeded by date), 'random' for truly random
    
    Note: This endpoint is optimized for disk-constrained environments.
    Candidate scan limit is kept low to reduce temp spill during materialization.
    """
    try:
        from datetime import date
        
        # Get books visible to the current user, then select a book first so
        # large books do not dominate daily/random verse selection.
        visible_books = [
            book
            for book in db.query(Book).all()
            if (
                _book_visibility(book) == BOOK_VISIBILITY_PUBLIC
                if current_user is None
                else _book_is_visible_to_user(db, book, current_user)
            )
        ]
        visible_book_ids = [book.id for book in visible_books]
        if not visible_book_ids:
            return None

        eligible_book_ids = [
            row[0]
            for row in db.query(ContentNode.book_id)
            .filter(
                ContentNode.has_content == True,
                ContentNode.book_id.in_(visible_book_ids),
            )
            .distinct()
            .order_by(ContentNode.book_id.asc())
            .all()
        ]
        if not eligible_book_ids:
            return None

        book_by_id = {book.id: book for book in visible_books}

        if mode == "daily":
            # Use current date as seed for consistent daily book + verse selection.
            today = date.today()
            seed = today.year * 10000 + today.month * 100 + today.day
            selected_book_id = eligible_book_ids[seed % len(eligible_book_ids)]
        else:
            selected_book_id = random.choice(eligible_book_ids)

        book = book_by_id.get(selected_book_id) or db.query(Book).filter(Book.id == selected_book_id).first()
        base_verse_query = (
            db.query(ContentNode)
            .options(
                load_only(
                    ContentNode.id,
                    ContentNode.parent_node_id,
                    ContentNode.sequence_number,
                    ContentNode.content_data,
                )
            )
            .filter(
                ContentNode.has_content == True,
                ContentNode.book_id == selected_book_id,
            )
        )
        verse_count = base_verse_query.count()
        if verse_count <= 0:
            return None

        # Keep scan bounded for disk-constrained environments while preserving
        # enough breadth to skip non-previewable candidates reliably.
        candidate_scan_limit = min(300, verse_count)
        verse_candidates: list[ContentNode] = []
        if mode == "daily":
            start_offset = (seed // max(len(eligible_book_ids), 1)) % verse_count
            verse_candidates = (
                base_verse_query
                .order_by(ContentNode.id.asc())
                .offset(start_offset)
                .limit(candidate_scan_limit)
                .all()
            )
            if len(verse_candidates) < candidate_scan_limit and start_offset > 0:
                verse_candidates.extend(
                    base_verse_query
                    .order_by(ContentNode.id.asc())
                    .limit(candidate_scan_limit - len(verse_candidates))
                    .all()
                )
        else:
            start_offset = random.randrange(verse_count)
            verse_candidates = (
                base_verse_query
                .order_by(ContentNode.id.asc())
                .offset(start_offset)
                .limit(candidate_scan_limit)
                .all()
            )
            if len(verse_candidates) < candidate_scan_limit and start_offset > 0:
                verse_candidates.extend(
                    base_verse_query
                    .order_by(ContentNode.id.asc())
                    .limit(candidate_scan_limit - len(verse_candidates))
                    .all()
                )
            random.shuffle(verse_candidates)

        if not verse_candidates:
            return None

        verse = verse_candidates[0]
        content_text = ""
        sanskrit_text = ""
        transliteration_text = ""

        for candidate in verse_candidates:
            extracted_content_text, extracted_sanskrit_text, extracted_transliteration_text = _extract_daily_verse_texts(candidate)
            candidate_has_previewable_text = any(
                _is_meaningful_daily_verse_text(text_value)
                for text_value in (
                    extracted_content_text,
                    extracted_sanskrit_text,
                    extracted_transliteration_text,
                )
            )

            verse = candidate
            content_text = extracted_content_text
            sanskrit_text = extracted_sanskrit_text
            transliteration_text = extracted_transliteration_text

            if candidate_has_previewable_text:
                break

        if not content_text or len(content_text.strip()) < 5:
            content_text = sanskrit_text or transliteration_text or "Content not available"
        
        numeric_title = _node_numeric_path(db, verse)

        return {
            "id": verse.id,
            "title": numeric_title or _sequence_number_segment(verse.sequence_number) or str(verse.id),
            "content": content_text,
            "sanskrit": sanskrit_text or "",
            "transliteration": transliteration_text or "",
            "book_name": book.book_name if book else "Scripture",
            "book_id": book.id if book else None,
            "node_id": verse.id,
        }
    except Exception as e:
        print(f"Error in get_daily_verse: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def _sequence_number_segment(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    match = re.search(r"(\d+)(?!.*\d)", str(value))
    return match.group(1) if match else ""


def _node_numeric_path(db: Session, node: ContentNode | None) -> str:
    if node is None:
        return ""

    segments: list[str] = []
    current = node
    seen_ids: set[int] = set()

    while current is not None and current.id not in seen_ids:
        seen_ids.add(current.id)
        segment = _sequence_number_segment(current.sequence_number)
        if segment:
            segments.append(segment)
        if not current.parent_node_id:
            break
        current = db.query(ContentNode).filter(ContentNode.id == current.parent_node_id).first()

    return ".".join(reversed(segments))


def _extract_daily_verse_texts(node: ContentNode | None) -> tuple[str, str, str]:
    if node is None or not node.content_data or not isinstance(node.content_data, dict):
        return "", "", ""

    content_text = ""
    sanskrit_text = ""
    transliteration_text = ""

    if "translations" in node.content_data and isinstance(node.content_data["translations"], dict):
        content_text = node.content_data["translations"].get("english", "")

    if "basic" in node.content_data and isinstance(node.content_data["basic"], dict):
        basic = node.content_data["basic"]
        if not content_text:
            content_text = basic.get("translation", "")
        sanskrit_text = basic.get("sanskrit", "")
        transliteration_text = basic.get("transliteration", "")

    if not content_text:
        content_text = (
            node.content_data.get("text_english")
            or node.content_data.get("text")
            or node.content_data.get("content")
            or node.content_data.get("english")
            or node.content_data.get("translation")
            or ""
        )

    return content_text, sanskrit_text, transliteration_text


def _is_meaningful_daily_verse_text(value: str) -> bool:
    normalized = (value or "").strip()
    if len(normalized) < 5:
        return False

    lowered = normalized.lower()
    if "placeholder" in lowered:
        return False

    # Guard against structural labels being treated as verse text.
    if "chapter" in lowered and "verse" in lowered and len(normalized) < 100:
        return False

    return True


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical_upload_relative_paths(upload_id: str) -> tuple[Path, Path]:
    meta_relative = Path("imports") / "canonical-tmp" / f"{upload_id}.meta.json"
    part_relative = Path("imports") / "canonical-tmp" / f"{upload_id}.part"
    return meta_relative, part_relative


def _canonical_upload_absolute_path(relative_path: Path) -> Path:
    return (MEDIA_STORAGE.root_dir / relative_path).resolve()


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
) -> Callable[[str, int | None, int | None], None]:
    def _callback(message: str, current: int | None = None, total: int | None = None) -> None:
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
    background_tasks: BackgroundTasks,
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
        payload_json=payload,
        progress_message="Queued",
        progress_current=0,
        progress_total=None,
        error=None,
        result_json=None,
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(_run_import_job, job_id, payload, current_user.id)
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

    upload_id = uuid4().hex
    _, part_relative = _canonical_upload_relative_paths(upload_id)
    part_path = _canonical_upload_absolute_path(part_relative)
    part_path.parent.mkdir(parents=True, exist_ok=True)
    with open(part_path, "wb") as part_file:
        part_file.write(b"")

    state = {
        "upload_id": upload_id,
        "requested_by": current_user.id,
        "created_at": _utc_now_iso(),
        "next_index": 0,
        "received_bytes": 0,
    }
    _write_canonical_upload_state(upload_id, state)

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


def _import_html(
    payload: dict,
    db: Session,
    current_user: User,
) -> ImportResponse:
    """Import from HTML using extraction rules."""
    config = ImportConfig(**payload)
    
    # Get schema
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema {config.schema_id} not found"
        )

    # Create or get book
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

    # Run importer
    importer = GenericHTMLImporter(config)
    if not importer.fetch_and_parse():
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            error="Failed to fetch and parse URL"
        )

    # Extract nodes
    nodes_tree = importer.build_tree()
    flat_nodes = importer.flatten_tree(nodes_tree)

    # Insert nodes
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
    
    # Get schema
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema {config.schema_id} not found"
        )

    # Create or get book
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

    # Run importer to extract text and metadata
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

    # Extract nodes tree for database insertion
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
    
    # Insert nodes into database
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
            
            # Preserve override flags from the original payload
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
    
    # Get schema
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == config.schema_id
    ).first()
    
    if not schema:
        return ImportResponse(
            success=False,
            error=f"Schema not found: {config.schema_id}"
        )
    
    # Create or get book
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
    
    # Import using JSON importer
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
    
    # Extract nodes tree for database insertion
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
    
    # Insert nodes into database
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

    level_lookup = {level: idx + 1 for idx, level in enumerate(schema.levels or [])}
    old_to_new_node_ids: dict[int, int] = {}
    pending_nodes = list(canonical.nodes)
    nodes_created = 0
    total_nodes = len(pending_nodes)

    if progress_callback:
        progress_callback("Validated canonical payload", 0, total_nodes)

    try:
        if progress_callback:
            progress_callback("Synchronizing database sequence", 0, total_nodes)
        _sync_content_nodes_id_sequence(db)
    except Exception as exc:
        db.rollback()
        return ImportResponse(
            success=False,
            book_id=book.id if book and book.id else None,
            nodes_created=0,
            warnings=warnings,
            error=f"Failed to synchronize content node sequence: {str(exc)}",
        )

    while pending_nodes:
        progress_made = False
        still_pending: list = []

        if progress_callback:
            progress_callback("Importing nodes", nodes_created, total_nodes)

        for node in pending_nodes:
            parent_id = node.parent_node_id
            if isinstance(parent_id, int) and parent_id not in old_to_new_node_ids:
                still_pending.append(node)
                continue

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
            node_content_data = _autofill_content_data_pair(
                node.content_data if isinstance(node.content_data, dict) else {}
            )

            content_node = ContentNode(
                book_id=book.id,
                parent_node_id=old_to_new_node_ids.get(parent_id) if isinstance(parent_id, int) else None,
                referenced_node_id=resolved_reference_id,
                level_name=node.level_name,
                level_order=resolved_level_order,
                sequence_number=node.sequence_number,
                title_sanskrit=node_title_sanskrit,
                title_transliteration=node_title_transliteration,
                title_english=node.title_english,
                title_hindi=node.title_hindi,
                title_tamil=node.title_tamil,
                has_content=bool(node.has_content),
                content_data=node_content_data if isinstance(node_content_data, dict) else {},
                summary_data=node.summary_data if isinstance(node.summary_data, dict) else {},
                metadata_json=node.metadata_json if isinstance(node.metadata_json, dict) else {},
                source_attribution=node.source_attribution or source_attribution,
                license_type=node.license_type,
                original_source_url=node.original_source_url or original_source_url,
                tags=node.tags if isinstance(node.tags, list) else [],
                created_by=current_user.id,
                last_modified_by=current_user.id,
            )
            db.add(content_node)
            db.flush()

            old_to_new_node_ids[node.node_id] = content_node.id
            nodes_created += 1
            progress_made = True

            if progress_callback and (nodes_created % 100 == 0 or nodes_created == total_nodes):
                progress_callback("Importing nodes", nodes_created, total_nodes)

            media_items = node.media_items if isinstance(node.media_items, list) else []
            for media in media_items:
                media_type = (media.media_type or "").strip().lower()
                media_url = (media.url or "").strip()
                if not media_type or not media_url:
                    continue
                if media_type not in ALLOWED_MEDIA_TYPES:
                    continue
                media_file = MediaFile(
                    node_id=content_node.id,
                    media_type=media_type,
                    url=media_url,
                    metadata_json=media.metadata if isinstance(media.metadata, dict) else {},
                )
                db.add(media_file)

        if not progress_made:
            unresolved_ids = [str(node.node_id) for node in still_pending]
            db.rollback()
            return ImportResponse(
                success=False,
                book_id=book.id if book and book.id else None,
                nodes_created=0,
                warnings=warnings,
                error=(
                    "Invalid node hierarchy in canonical JSON. "
                    f"Could not resolve parent linkage for node_ids: {', '.join(unresolved_ids)}"
                ),
            )

        pending_nodes = still_pending

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
                db.flush()
                nodes_created += 1
                
                # Recursively insert children
                if node_data.get("children"):
                    insert_nodes(node_data["children"], content_node.id)
            except Exception as e:
                raise Exception(f"Error inserting {level_name}: {str(e)}")

    insert_nodes(nodes_tree)
    return nodes_created


@router.get("/nodes", response_model=list[ContentNodePublic])
def list_nodes(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
    q: str | None = None,  # Search query
    book_id: int | None = None,  # Filter by book
    limit: int = 100,
) -> list[ContentNodePublic]:
    """
    List content nodes with optional search and filtering.
    
    - q: Search query (searches in titles and content)
    - book_id: Filter by specific book
    - limit: Max results to return
    """
    safe_limit = max(1, min(limit, _NODES_LIST_HARD_LIMIT))
    query = db.query(ContentNode).options(
        load_only(
            ContentNode.id,
            ContentNode.book_id,
            ContentNode.parent_node_id,
            ContentNode.referenced_node_id,
            ContentNode.level_name,
            ContentNode.level_order,
            ContentNode.sequence_number,
            ContentNode.title_sanskrit,
            ContentNode.title_transliteration,
            ContentNode.title_english,
            ContentNode.title_hindi,
            ContentNode.title_tamil,
            ContentNode.has_content,
            ContentNode.status,
            ContentNode.created_by,
            ContentNode.last_modified_by,
        )
    )
    
    # Search filter
    if q:
        search_term = f"%{q}%"
        search_filters = [
            ContentNode.title_english.ilike(search_term),
            ContentNode.title_sanskrit.ilike(search_term),
            ContentNode.title_transliteration.ilike(search_term),
        ]
        if not _DISABLE_CONTENT_DATA_LIST_SEARCH:
            search_filters.append(ContentNode.content_data.cast(str).ilike(search_term))
        query = query.filter(or_(*search_filters))
    
    # Book filter
    target_book: Book | None = None
    if book_id:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        _ensure_book_view_access(db, book, current_user)
        target_book = book
        query = query.filter(ContentNode.book_id == book_id)
    
    nodes = query.order_by(ContentNode.id).limit(safe_limit).all()
    if target_book is not None:
        payloads: list[ContentNodePublic] = []
        for item in nodes:
            payload = ContentNodePublic.model_validate(item).model_dump()
            payload["level_name"] = _display_level_name_for_book(target_book, payload.get("level_name"))
            payloads.append(ContentNodePublic.model_validate(payload))
        return payloads

    books_by_id = {
        item.id: item
        for item in db.query(Book).filter(Book.id.in_({node.book_id for node in nodes if node.book_id is not None})).all()
    }
    payloads: list[ContentNodePublic] = []
    for item in nodes:
        payload = ContentNodePublic.model_validate(item).model_dump()
        payload["level_name"] = _display_level_name_for_book(books_by_id.get(item.book_id), payload.get("level_name"))
        payloads.append(ContentNodePublic.model_validate(payload))
    return payloads


@router.get("/books/{book_id}/tree", response_model=list[ContentNodeTreeItem])
def list_book_tree(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ContentNodeTreeItem]:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, book, current_user)

    nodes = (
        db.query(ContentNode)
        .options(
            load_only(
                ContentNode.id,
                ContentNode.book_id,
                ContentNode.parent_node_id,
                ContentNode.referenced_node_id,
                ContentNode.level_name,
                ContentNode.level_order,
                ContentNode.sequence_number,
                ContentNode.title_sanskrit,
                ContentNode.title_transliteration,
                ContentNode.title_english,
                ContentNode.title_hindi,
                ContentNode.title_tamil,
                ContentNode.has_content,
                ContentNode.created_by,
                ContentNode.last_modified_by,
            )
        )
        .filter(ContentNode.book_id == book_id)
        .all()
    )

    nodes_by_id: dict[int, ContentNode] = {node.id: node for node in nodes}
    children_by_parent: dict[int | None, list[ContentNode]] = {}
    for node in nodes:
        parent_id = node.parent_node_id if isinstance(node.parent_node_id, int) else None
        children_by_parent.setdefault(parent_id, []).append(node)

    depth_by_id: dict[int, int] = {}

    def _assign_depth(node: ContentNode, depth: int) -> None:
        if node.id in depth_by_id:
            return
        depth_by_id[node.id] = depth
        for child in children_by_parent.get(node.id, []):
            _assign_depth(child, depth + 1)

    for root in children_by_parent.get(None, []):
        _assign_depth(root, 1)

    # If there are cycles/orphans, ensure all nodes still receive a depth.
    for node in nodes:
        if node.id not in depth_by_id:
            _assign_depth(node, 1)
    
    # Natural sort function for sequence numbers
    def natural_sort_key(node):
        seq = node.sequence_number
        if not seq:
            return (float('inf'),)
        try:
            parts = seq.split('.')
            return tuple(int(p) for p in parts)
        except (ValueError, AttributeError):
            return (float('inf'), str(seq))
    
    nodes = sorted(nodes, key=lambda n: (n.level_order, natural_sort_key(n)))
    
    payloads: list[ContentNodeTreeItem] = []
    for item in nodes:
        payload = _node_response_payload(item)
        payload["level_order"] = depth_by_id.get(item.id, 1)
        payload["level_name"] = _display_level_name_for_book(book, payload.get("level_name"))
        payloads.append(ContentNodeTreeItem.model_validate(payload))
    return payloads


def _node_sequence_sort_key(node: ContentNode):
    sequence = node.sequence_number
    if not sequence:
        return (float("inf"),)
    try:
        return tuple(int(part) for part in sequence.split("."))
    except (ValueError, AttributeError):
        return (float("inf"), str(sequence))


def _book_summary_binding_metadata_for_export(db: Session, book_id: int) -> dict[str, str]:
    """Return portable book-summary fields resolved from book metadata binding overrides."""
    binding = (
        db.query(MetadataBinding)
        .filter(
            MetadataBinding.entity_type == "book",
            MetadataBinding.entity_id == book_id,
            MetadataBinding.scope_type == "book",
        )
        .order_by(MetadataBinding.id.asc())
        .first()
    )
    if not binding:
        return {}

    overrides = binding.property_overrides if isinstance(binding.property_overrides, dict) else {}
    summary_fields: dict[str, str] = {}

    def _read_text(key: str) -> str | None:
        value = overrides.get(key)
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
        return None

    sanskrit = _read_text("sanskrit")
    transliteration = _read_text("transliteration")
    english = _read_text("english")
    text_value = _read_text("text")

    if sanskrit:
        summary_fields["sanskrit"] = sanskrit
        summary_fields["summary_sanskrit"] = sanskrit
    if transliteration:
        summary_fields["transliteration"] = transliteration
        summary_fields["summary_transliteration"] = transliteration
    if english:
        summary_fields["english"] = english
        summary_fields["summary_english"] = english
    if text_value:
        summary_fields["text"] = text_value
        summary_fields["summary_text"] = text_value

    return summary_fields


@router.get("/books/{book_id}/export/json", response_model=BookExchangePayloadV1)
def export_book_json(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_import_permission),
) -> BookExchangePayloadV1:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, book, current_user)

    nodes = (
        db.query(ContentNode)
        .options(
            load_only(
                ContentNode.id,
                ContentNode.book_id,
                ContentNode.parent_node_id,
                ContentNode.referenced_node_id,
                ContentNode.level_name,
                ContentNode.level_order,
                ContentNode.sequence_number,
                ContentNode.title_sanskrit,
                ContentNode.title_transliteration,
                ContentNode.title_english,
                ContentNode.title_hindi,
                ContentNode.title_tamil,
                ContentNode.has_content,
                ContentNode.created_by,
                ContentNode.last_modified_by,
            )
        )
        .filter(ContentNode.book_id == book_id)
        .all()
    )
    nodes = sorted(nodes, key=lambda node: (node.level_order, _node_sequence_sort_key(node)))

    node_ids = [node.id for node in nodes]
    media_rows = (
        db.query(MediaFile)
        .filter(MediaFile.node_id.in_(node_ids))
        .order_by(MediaFile.id)
        .all()
        if node_ids
        else []
    )

    media_by_node_id: dict[int, list[dict]] = {}
    for media in media_rows:
        if not isinstance(media.node_id, int):
            continue
        media_by_node_id.setdefault(media.node_id, []).append(
            {
                "media_type": media.media_type,
                "url": media.url,
                "metadata": media.metadata_json if isinstance(media.metadata_json, dict) else {},
            }
        )

    # Resolve referenced nodes so exported content is self-contained.
    # Reference chains can span books, so we fetch all transitively referenced nodes.
    ref_ids_to_resolve: set[int] = {
        node.referenced_node_id
        for node in nodes
        if node.referenced_node_id is not None
    }
    resolved_source_nodes: dict[int, ContentNode] = {}
    while ref_ids_to_resolve:
        batch = (
            db.query(ContentNode)
            .filter(ContentNode.id.in_(ref_ids_to_resolve))
            .all()
        )
        for src in batch:
            resolved_source_nodes[src.id] = src
        # Follow any further references within the fetched batch
        next_refs: set[int] = {
            src.referenced_node_id
            for src in batch
            if src.referenced_node_id is not None
            and src.referenced_node_id not in resolved_source_nodes
        }
        ref_ids_to_resolve = next_refs

    def _resolve_source(node: ContentNode) -> ContentNode:
        """Walk the reference chain and return the ultimate source node."""
        visited: set[int] = {node.id}
        current = node
        while current.referenced_node_id is not None:
            next_id = current.referenced_node_id
            if next_id in visited or next_id not in resolved_source_nodes:
                break
            visited.add(next_id)
            current = resolved_source_nodes[next_id]
        return current

    book_metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    metadata_out = dict(book_metadata)
    # owner_id is DB-local — strip it so the export is portable across systems.
    metadata_out.pop("owner_id", None)
    metadata_out["status"] = _book_status(book)
    metadata_out["visibility"] = _book_visibility(book)

    # Preserve book-level preview summary fields (often stored via metadata bindings)
    # so export/import round-trips keep English/Sanskrit/transliteration summaries.
    summary_binding_fields = _book_summary_binding_metadata_for_export(db, book.id)
    for field_name, field_value in summary_binding_fields.items():
        existing = metadata_out.get(field_name)
        if not isinstance(existing, str) or not existing.strip():
            metadata_out[field_name] = field_value

    exported_nodes: list[dict] = []
    for node in nodes:
        # Inline content from the ultimate source node so the export is portable.
        source = _resolve_source(node) if node.referenced_node_id is not None else node
        exported_nodes.append(
            {
                "node_id": node.id,
                "parent_node_id": node.parent_node_id,
                # Export without referenced_node_id — the content is inlined above
                # and the original DB ID would be meaningless in another system.
                "referenced_node_id": None,
                "level_name": node.level_name,
                "level_order": node.level_order if isinstance(node.level_order, int) else 0,
                "sequence_number": node.sequence_number,
                "title_sanskrit": node.title_sanskrit,
                "title_transliteration": node.title_transliteration,
                "title_english": node.title_english,
                "title_hindi": node.title_hindi,
                "title_tamil": node.title_tamil,
                "has_content": bool(source.has_content),
                "content_data": source.content_data if isinstance(source.content_data, dict) else {},
                "summary_data": source.summary_data if isinstance(source.summary_data, dict) else {},
                "metadata_json": node.metadata_json if isinstance(node.metadata_json, dict) else {},
                "source_attribution": source.source_attribution,
                "license_type": source.license_type or node.license_type or "CC-BY-SA-4.0",
                "original_source_url": source.original_source_url,
                "tags": node.tags if isinstance(node.tags, list) else [],
                "media_items": media_by_node_id.get(node.id, []),
            }
        )

    return BookExchangePayloadV1(
        schema_={
            "id": book.schema.id if book.schema else book.schema_id,
            "name": book.schema.name if book.schema else None,
            "description": book.schema.description if book.schema else None,
            "levels": book.schema.levels if book.schema and isinstance(book.schema.levels, list) else [],
            "level_name_overrides": _book_level_name_overrides(book),
        },
        book={
            "book_name": book.book_name,
            "book_code": book.book_code,
            "language_primary": book.language_primary,
            "metadata": metadata_out,
        },
        nodes=exported_nodes,
        exported_at=datetime.now(timezone.utc),
        source={
            "app": "hindu-scriptures-platform",
            "format": "canonical-book-json",
        },
    )


@router.get("/books/{book_id}/tree/nested", response_model=list[ContentNodeTree])
def list_book_tree_nested(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ContentNodeTree]:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, book, current_user)

    nodes = (
        db.query(ContentNode)
        .options(
            load_only(
                ContentNode.id,
                ContentNode.book_id,
                ContentNode.parent_node_id,
                ContentNode.referenced_node_id,
                ContentNode.level_name,
                ContentNode.level_order,
                ContentNode.sequence_number,
                ContentNode.title_sanskrit,
                ContentNode.title_transliteration,
                ContentNode.title_english,
                ContentNode.title_hindi,
                ContentNode.title_tamil,
                ContentNode.has_content,
                ContentNode.created_by,
                ContentNode.last_modified_by,
            )
        )
        .filter(ContentNode.book_id == book_id)
        .all()
    )
    
    # Natural sort function for sequence numbers like "1", "10", "1.34", "2.5"
    def natural_sort_key(node):
        seq = node.sequence_number
        if not seq:
            return (1, (10**9,), "")

        if isinstance(seq, int):
            return (0, (seq,), "")

        try:
            seq_text = str(seq).strip()
            if not seq_text:
                return (1, (10**9,), "")
            parts = seq_text.split('.')
            return (0, tuple(int(p) for p in parts), "")
        except (ValueError, AttributeError):
            return (1, (10**9,), str(seq))
    
    # Sort nodes by natural order within each level
    nodes = sorted(nodes, key=lambda n: (n.level_order, natural_sort_key(n)))
    
    node_map: dict[int, ContentNodeTree] = {}
    roots: list[ContentNodeTree] = []
    node_lookup = {n.id: n for n in nodes}
    children_by_parent: dict[int | None, list[int]] = {}

    for node in nodes:
        payload = _node_response_payload(node)
        payload["level_name"] = _display_level_name_for_book(book, payload.get("level_name"))
        tree_node = ContentNodeTree.model_validate(payload)
        tree_node.children = []
        node_map[node.id] = tree_node

        parent_id = node.parent_node_id if isinstance(node.parent_node_id, int) else None
        children_by_parent.setdefault(parent_id, []).append(node.id)

    def node_sort_key(node_id: int):
        node = node_lookup[node_id]
        return (
            node.level_order if isinstance(node.level_order, int) else 10**9,
            natural_sort_key(node),
            node.id,
        )

    for child_ids in children_by_parent.values():
        child_ids.sort(key=node_sort_key)

    visited_ids: set[int] = set()

    def _attach(node_id: int, depth: int, path_ids: set[int]) -> None:
        if node_id in path_ids:
            return
        if node_id not in node_map:
            return

        tree_node = node_map[node_id]
        if node_id not in visited_ids:
            visited_ids.add(node_id)
            tree_node.level_order = depth

        next_path = set(path_ids)
        next_path.add(node_id)
        for child_id in children_by_parent.get(node_id, []):
            if child_id in next_path:
                continue
            child_node = node_map.get(child_id)
            if child_node is None:
                continue
            if child_node not in tree_node.children:
                tree_node.children.append(child_node)
            _attach(child_id, depth + 1, next_path)

    root_ids: list[int] = []
    for node in nodes:
        parent_id = node.parent_node_id if isinstance(node.parent_node_id, int) else None
        if parent_id is None or parent_id not in node_map:
            root_ids.append(node.id)

    root_ids.sort(key=node_sort_key)

    for root_id in root_ids:
        if root_id not in node_map:
            continue
        roots.append(node_map[root_id])
        _attach(root_id, 1, set())

    # Ensure orphaned/cycle-only components are still returned.
    for node in nodes:
        if node.id in visited_ids:
            continue
        tree_node = node_map[node.id]
        tree_node.level_order = 1
        roots.append(tree_node)
        _attach(node.id, 1, set())

    return roots


def _resolve_level_name_for_schema(
    level_name: str,
    schema_levels: list[str],
    level_name_overrides: dict[str, str] | None = None,
) -> str:
    if not schema_levels:
        return level_name

    requested = (level_name or "").strip()
    if not requested:
        return requested

    if requested in schema_levels:
        return requested

    if isinstance(level_name_overrides, dict) and level_name_overrides:
        exact_override_match = next(
            (
                canonical
                for canonical, display in level_name_overrides.items()
                if isinstance(canonical, str)
                and isinstance(display, str)
                and display.strip() == requested
                and canonical in schema_levels
            ),
            None,
        )
        if exact_override_match:
            return exact_override_match

    requested_lower = requested.lower()
    case_insensitive_match = next(
        (level for level in schema_levels if isinstance(level, str) and level.lower() == requested_lower),
        None,
    )
    if case_insensitive_match:
        return case_insensitive_match

    if isinstance(level_name_overrides, dict) and level_name_overrides:
        case_insensitive_override_match = next(
            (
                canonical
                for canonical, display in level_name_overrides.items()
                if isinstance(canonical, str)
                and isinstance(display, str)
                and display.strip().lower() == requested_lower
                and canonical in schema_levels
            ),
            None,
        )
        if case_insensitive_override_match:
            return case_insensitive_override_match

    alias_map = {
        "shloka": "verse",
        "sloka": "verse",
        "verse": "shloka",
    }
    mapped_lower = alias_map.get(requested_lower)
    if mapped_lower:
        alias_match = next(
            (level for level in schema_levels if isinstance(level, str) and level.lower() == mapped_lower),
            None,
        )
        if alias_match:
            return alias_match

    return requested


@router.post(
    "/nodes",
    response_model=ContentNodePublic,
    status_code=status.HTTP_201_CREATED,
)
def create_node(
    payload: ContentNodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    _ensure_can_contribute(current_user)

    book = db.query(Book).filter(Book.id == payload.book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid book")

    _ensure_book_edit_access(db, current_user, book)

    schema_levels = (
        book.schema.levels
        if book.schema and isinstance(book.schema.levels, list)
        else []
    )
    level_name_overrides = _book_level_name_overrides(book)
    resolved_level_name = _resolve_level_name_for_schema(
        payload.level_name,
        schema_levels,
        level_name_overrides,
    )

    if (
        not _user_can_edit_any(current_user)
        and payload.referenced_node_id is None
        and (payload.source_attribution or payload.original_source_url)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only add existing content as references",
        )

    insert_after_node: ContentNode | None = None
    resolved_parent_node_id = payload.parent_node_id

    if payload.insert_after_node_id is not None:
        if payload.insert_after_node_id <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid insert-after context",
            )

        insert_after_node = (
            db.query(ContentNode)
            .filter(
                ContentNode.id == payload.insert_after_node_id,
                ContentNode.book_id == payload.book_id,
            )
            .first()
        )
        if not insert_after_node:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insert-after node not found",
            )

        resolved_parent_node_id = insert_after_node.parent_node_id

        insert_after_level_name = _resolve_level_name_for_schema(
            insert_after_node.level_name,
            schema_levels,
            level_name_overrides,
        )
        if insert_after_level_name != resolved_level_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insert-after node must share the same level",
            )

        if (
            payload.level_order is not None
            and insert_after_node.level_order is not None
            and insert_after_node.level_order != payload.level_order
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insert-after node must share the same level order",
            )

    # Validate hierarchy against schema if book has one
    if book.schema and book.schema.levels:
        if schema_levels:
            # Check if level_name is valid in the schema
            if resolved_level_name not in schema_levels:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid level '{payload.level_name}'. Valid levels: {', '.join(schema_levels)}"
                )

            # Get the index of this level in the schema
            level_index = schema_levels.index(resolved_level_name)

            # Check parent-child relationship in schema
            if resolved_parent_node_id:
                parent = (
                    db.query(ContentNode)
                    .filter(ContentNode.id == resolved_parent_node_id)
                    .first()
                )
                if not parent:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent"
                    )

                # Parent's child level must be next level in schema
                parent_level_index = schema_levels.index(parent.level_name) if parent.level_name in schema_levels else -1
                
                if parent_level_index >= 0:
                    expected_child_level_index = parent_level_index + 1
                    
                    # Parent cannot have children if it's at leaf level
                    if parent_level_index == len(schema_levels) - 1:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Cannot add children to '{parent.level_name}' level - it's the leaf level"
                        )
                    
                    # Child must be at the next level
                    if expected_child_level_index < len(schema_levels):
                        expected_child_level = schema_levels[expected_child_level_index]
                        if resolved_level_name != expected_child_level:
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"'{payload.level_name}' cannot be a child of '{parent.level_name}'. Expected child level: '{expected_child_level}'"
                            )
            else:
                # Root level nodes must be at the first level in schema
                if level_index != 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Root level items must be at '{schema_levels[0]}' level, not '{payload.level_name}'"
                    )
    else:
        # No schema - basic parent validation only
        if resolved_parent_node_id:
            parent = (
                db.query(ContentNode)
                .filter(ContentNode.id == resolved_parent_node_id)
                .first()
            )
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent"
                )

    # Normalize sequence number and auto-calculate when omitted/blank
    sequence_number: int | None = None
    if payload.sequence_number is not None:
        normalized_sequence = str(payload.sequence_number).strip()
        if normalized_sequence:
            if not normalized_sequence.isdigit():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sequence number must be a positive integer",
                )
            sequence_number = int(normalized_sequence)
            if sequence_number <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sequence number must be a positive integer",
                )

    if insert_after_node is not None:
        if insert_after_node.sequence_number is None:
            max_seq = db.query(func.max(cast(ContentNode.sequence_number, Integer))).filter(
                ContentNode.book_id == payload.book_id,
                ContentNode.parent_node_id == resolved_parent_node_id,
                ContentNode.sequence_number.isnot(None),
            ).scalar()
            sequence_number = (int(max_seq) if max_seq is not None else 0) + 1
        else:
            insert_after_sequence = str(insert_after_node.sequence_number).strip()
            if not insert_after_sequence.isdigit():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Insert-after node has invalid sequence number",
                )
            sequence_number = int(insert_after_sequence) + 1

    if sequence_number is not None:
        numeric_sequence = cast(ContentNode.sequence_number, Integer)
        nodes_to_shift = (
            db.query(ContentNode)
            .filter(
                ContentNode.book_id == payload.book_id,
                ContentNode.parent_node_id == resolved_parent_node_id,
                ContentNode.sequence_number.isnot(None),
                numeric_sequence >= sequence_number,
            )
            .order_by(numeric_sequence.desc(), ContentNode.id.desc())
            .all()
        )
        for sibling_node in nodes_to_shift:
            sibling_node.sequence_number = int(sibling_node.sequence_number) + 1

    if sequence_number is None:
        max_seq = db.query(func.max(cast(ContentNode.sequence_number, Integer))).filter(
            ContentNode.book_id == payload.book_id,
            ContentNode.parent_node_id == resolved_parent_node_id,
            ContentNode.sequence_number.isnot(None),
        ).scalar()
        sequence_number = (int(max_seq) if max_seq is not None else 0) + 1

    title_sanskrit, title_transliteration = _autofill_sanskrit_transliteration_pair(
        payload.title_sanskrit,
        payload.title_transliteration,
    )
    content_data = _autofill_content_data_pair(payload.content_data or {})

    source_variant_authors: dict[str, str] = {}
    if payload.referenced_node_id is not None:
        source_node = db.query(ContentNode).filter(ContentNode.id == payload.referenced_node_id).first()
        if not source_node:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid referenced node",
            )
        source_book = db.query(Book).filter(Book.id == source_node.book_id).first()
        if source_book and isinstance(source_book.variant_authors, dict):
            source_variant_authors = {
                str(slug).strip(): str(name).strip()
                for slug, name in source_book.variant_authors.items()
                if str(slug).strip() and str(name).strip()
            }

        # Some source books may have empty variant_authors even when node-level
        # translation/commentary variants carry author_slug+author data.
        _, source_node_discovered_authors = _normalize_content_variant_authors(
            source_node.content_data if isinstance(source_node.content_data, dict) else {},
            source_variant_authors,
        )
        source_variant_authors = {
            **source_variant_authors,
            **source_node_discovered_authors,
        }

    existing_variant_authors = book.variant_authors if isinstance(book.variant_authors, dict) else {}
    content_data, discovered_variant_authors = _normalize_content_variant_authors(
        content_data,
        {**source_variant_authors, **existing_variant_authors},
    )

    _ensure_word_meanings_level_is_enabled(book, resolved_level_name, content_data)

    _merge_variant_authors(book, source_variant_authors)
    _merge_variant_authors(book, discovered_variant_authors)

    node = ContentNode(
        book_id=payload.book_id,
        parent_node_id=resolved_parent_node_id,
        referenced_node_id=payload.referenced_node_id,
        level_name=resolved_level_name,
        level_order=payload.level_order,
        sequence_number=sequence_number,
        title_sanskrit=title_sanskrit,
        title_transliteration=title_transliteration,
        title_english=payload.title_english,
        title_hindi=payload.title_hindi,
        title_tamil=payload.title_tamil,
        has_content=payload.has_content,
        content_data=content_data,
        summary_data=payload.summary_data or {},
        source_attribution=payload.source_attribution,
        license_type=payload.license_type,
        original_source_url=payload.original_source_url,
        tags=payload.tags or [],
        created_by=current_user.id,
        last_modified_by=current_user.id,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    payload_out = ContentNodePublic.model_validate(node).model_dump()
    payload_out["level_name"] = _display_level_name_for_book(book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


@router.get("/nodes/{node_id}", response_model=ContentNodePublic)
def get_node(
    node_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> ContentNodePublic:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, node_book, current_user)

    if node.referenced_node_id:
        source_node = node
        visited_ids: set[int] = set()

        while source_node.referenced_node_id:
            if source_node.id in visited_ids:
                break
            visited_ids.add(source_node.id)

            next_source = (
                db.query(ContentNode)
                .filter(ContentNode.id == source_node.referenced_node_id)
                .first()
            )
            if not next_source:
                break
            source_node = next_source

        if source_node and source_node.id != node.id:
            payload = _node_response_payload(node)
            payload.update(
                {
                    "content_data": _sanitize_content_data_for_response(source_node.content_data),
                    "summary_data": source_node.summary_data,
                    "has_content": source_node.has_content,
                    "source_attribution": source_node.source_attribution,
                    "license_type": source_node.license_type,
                    "original_source_url": source_node.original_source_url,
                }
            )
            payload["level_name"] = _display_level_name_for_book(node_book, payload.get("level_name"))
            return ContentNodePublic.model_validate(payload)
    payload_out = _node_response_payload(node)
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


def _build_word_meanings_rows_from_raw(rows: list) -> list[dict]:
    """Build a denormalized word_meanings_rows list from raw word_meanings.rows entries."""
    result = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        source = row.get("source") if isinstance(row.get("source"), dict) else {}
        meanings = row.get("meanings") if isinstance(row.get("meanings"), dict) else {}

        script_text = str(source.get("script_text") or "").strip()
        transliteration = (
            source.get("transliteration")
            if isinstance(source.get("transliteration"), dict)
            else {}
        )
        iast = str(transliteration.get("iast") or "").strip()
        resolved_source_text = script_text or iast

        resolved_meaning_text = ""
        resolved_meaning_language = "en"
        en_meaning = meanings.get("en") if isinstance(meanings.get("en"), dict) else None
        if en_meaning:
            resolved_meaning_text = str(en_meaning.get("text") or "").strip()
            resolved_meaning_language = "en"
        else:
            for lang, payload in meanings.items():
                if isinstance(payload, dict):
                    text = str(payload.get("text") or "").strip()
                    if text:
                        resolved_meaning_text = text
                        resolved_meaning_language = str(lang).strip().lower()
                        break

        result.append(
            {
                "id": str(row.get("id") or f"wm_row_{index + 1}"),
                "order": index + 1,
                "source": source,
                "meanings": meanings,
                "resolved_source": {
                    "text": resolved_source_text,
                    "mode": "script",
                    "scheme": "",
                },
                "resolved_meaning": {
                    "text": resolved_meaning_text,
                    "language": resolved_meaning_language,
                    "fallback_badge_visible": False,
                },
            }
        )
    return result


@router.patch("/nodes/{node_id}", response_model=ContentNodePublic)
def update_node(
    node_id: int,
    payload: ContentNodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    from datetime import datetime
    
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    source_node = None
    if node.referenced_node_id:
        source_node = (
            db.query(ContentNode)
            .filter(ContentNode.id == node.referenced_node_id)
            .first()
        )
        if not source_node:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid referenced node",
            )

    updates = payload.model_dump(exclude_unset=True)
    edit_reason = updates.pop("edit_reason", None)  # Remove from updates dict

    immutable_hierarchy_fields = {"level_name", "level_order", "parent_node_id"}
    attempted_hierarchy_updates = sorted(immutable_hierarchy_fields.intersection(updates.keys()))
    if attempted_hierarchy_updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Hierarchy fields cannot be edited via this endpoint: "
                + ", ".join(attempted_hierarchy_updates)
            ),
        )

    schema_levels = (
        node_book.schema.levels
        if node_book.schema and isinstance(node_book.schema.levels, list)
        else []
    )
    level_name_overrides = _book_level_name_overrides(node_book)
    if "title_sanskrit" in updates or "title_transliteration" in updates:
        next_title_sanskrit, next_title_transliteration = _autofill_sanskrit_transliteration_pair(
            updates.get("title_sanskrit", node.title_sanskrit),
            updates.get("title_transliteration", node.title_transliteration),
        )
        updates["title_sanskrit"] = next_title_sanskrit
        updates["title_transliteration"] = next_title_transliteration

    if "content_data" in updates:
        updates["content_data"] = _autofill_content_data_pair(updates.get("content_data"))
        # Keep word_meanings_rows in sync with word_meanings.rows so both storage
        # formats always reflect the same data (preview render reads word_meanings.rows
        # while the client preview uses word_meanings_rows from the API response).
        cd = updates.get("content_data")
        if isinstance(cd, dict):
            wm = cd.get("word_meanings") if isinstance(cd.get("word_meanings"), dict) else None
            if wm:
                raw_rows = wm.get("rows") if isinstance(wm.get("rows"), list) else []
                updates["content_data"] = {
                    **cd,
                    "word_meanings_rows": _build_word_meanings_rows_from_raw(raw_rows),
                }
            elif "word_meanings_rows" in cd:
                updates["content_data"] = {k: v for k, v in cd.items() if k != "word_meanings_rows"}

    effective_level_name = updates.get("level_name") or node.level_name
    effective_content_data = updates.get("content_data")
    if "content_data" not in updates:
        effective_content_data = source_node.content_data if source_node is not None else node.content_data
    _ensure_word_meanings_level_is_enabled(node_book, effective_level_name, effective_content_data)
    
    if "parent_node_id" in updates and updates["parent_node_id"] is not None:
        parent = (
            db.query(ContentNode)
            .filter(ContentNode.id == updates["parent_node_id"])
            .first()
        )
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent"
            )

    content_keys = {
        "has_content",
        "content_data",
        "summary_data",
        "source_attribution",
        "license_type",
        "original_source_url",
        "metadata_json",
        "tags",
    }

    # Track version history for content changes
    content_changed = any(k in updates for k in content_keys)
    if content_changed:
        version_target = source_node if source_node is not None else node
        version_entry = {
            "edited_by": current_user.id,
            "edited_at": datetime.utcnow().isoformat(),
            "reason": edit_reason,
            "changes": {k: v for k, v in updates.items() if k in content_keys}
        }
        version_history = version_target.version_history or []
        version_history.append(version_entry)
        version_target.version_history = version_history

    for key, value in updates.items():
        if source_node is not None and key in content_keys:
            setattr(source_node, key, value)
        else:
            setattr(node, key, value)

    node.last_modified_by = current_user.id
    if source_node is not None:
        source_node.last_modified_by = current_user.id
    db.commit()
    db.refresh(node)
    if source_node is not None:
        db.refresh(source_node)
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": source_node.content_data,
                "summary_data": source_node.summary_data,
                "has_content": source_node.has_content,
                "source_attribution": source_node.source_attribution,
                "license_type": source_node.license_type,
                "original_source_url": source_node.original_source_url,
            }
        )
        response_payload["level_name"] = _display_level_name_for_book(node_book, response_payload.get("level_name"))
        return ContentNodePublic.model_validate(response_payload)

    payload_out = ContentNodePublic.model_validate(node).model_dump()
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


@router.patch("/nodes/{node_id}/field", response_model=ContentNodePublic)
def update_node_single_field(
    node_id: int,
    payload: ContentNodeFieldPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    source_node = None
    if node.referenced_node_id:
        source_node = (
            db.query(ContentNode)
            .filter(ContentNode.id == node.referenced_node_id)
            .first()
        )
        if not source_node:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid referenced node",
            )

    field_path = payload.field_path.strip()
    if isinstance(payload.value, str):
        next_value = payload.value.strip()
        if next_value == "":
            next_value = None
    else:
        next_value = payload.value

    patch_updates: dict[str, object] = {}

    if field_path in {"title_english", "title_sanskrit", "title_transliteration", "sequence_number"}:
        patch_updates[field_path] = next_value
    elif field_path.startswith("content_data."):
        content_target = source_node if source_node is not None else node
        content_data = json.loads(json.dumps(content_target.content_data or {}))

        if field_path in {
            "content_data.basic.sanskrit",
            "content_data.basic.transliteration",
            "content_data.basic.translation",
        }:
            basic = content_data.get("basic")
            if not isinstance(basic, dict):
                basic = {}
            basic_key = field_path.rsplit(".", 1)[1]
            if next_value is None:
                basic.pop(basic_key, None)
            else:
                basic[basic_key] = next_value
            if basic:
                content_data["basic"] = basic
            else:
                content_data.pop("basic", None)
        elif field_path.startswith("content_data.translations."):
            translation_key = field_path[len("content_data.translations.") :].strip()
            translations = content_data.get("translations")
            if not isinstance(translations, dict):
                translations = {}
            if next_value is None:
                translations.pop(translation_key, None)
            else:
                translations[translation_key] = next_value
                if translation_key == "en":
                    translations["english"] = next_value
                elif translation_key == "english":
                    translations["en"] = next_value
            if translations:
                content_data["translations"] = translations
            else:
                content_data.pop("translations", None)
        elif field_path.startswith("content_data.word_meanings_rows."):
            word_meanings = (
                content_data.get("word_meanings")
                if isinstance(content_data.get("word_meanings"), dict)
                else {}
            )
            rows = word_meanings.get("rows") if isinstance(word_meanings.get("rows"), list) else []
            word_meanings = dict(word_meanings)
            word_meanings["version"] = str(word_meanings.get("version") or "1.0")
            word_meanings["rows"] = rows
            content_data["word_meanings"] = word_meanings
            preview_rows = (
                content_data.get("word_meanings_rows")
                if isinstance(content_data.get("word_meanings_rows"), list)
                else []
            )

            op_match = re.fullmatch(
                r"content_data\.word_meanings_rows\.(\d+)\.(delete|move_up|move_down)",
                field_path,
            )
            add_match = re.fullmatch(r"content_data\.word_meanings_rows\.add", field_path)
            replace_all_match = re.fullmatch(r"content_data\.word_meanings_rows\.replace_all", field_path)
            field_match = re.fullmatch(
                r"content_data\.word_meanings_rows\.(\d+)\.resolved_(meaning|source)\.text",
                field_path,
            )

            if replace_all_match:
                if not isinstance(next_value, list):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="value must be a list for word_meanings_rows.replace_all",
                    )
                rows = list(next_value)
                word_meanings["rows"] = rows
            elif op_match:
                row_index = int(op_match.group(1))
                operation = op_match.group(2)
                if operation == "delete":
                    if 0 <= row_index < len(rows):
                        rows.pop(row_index)
                elif operation == "move_up":
                    if 0 < row_index < len(rows):
                        rows[row_index - 1], rows[row_index] = rows[row_index], rows[row_index - 1]
                elif operation == "move_down":
                    if 0 <= row_index < len(rows) - 1:
                        rows[row_index], rows[row_index + 1] = rows[row_index + 1], rows[row_index]
            elif add_match:
                import time as _time
                new_row: dict = {
                    "id": f"wm_quick_{int(_time.time() * 1000) % 10000000}_{len(rows) + 1}",
                    "order": len(rows) + 1,
                    "source": {"language": "sa", "script_text": "", "transliteration": {}},
                    "meanings": {"en": {"text": ""}},
                }
                rows.append(new_row)
            elif field_match:
                row_index = int(field_match.group(1))
                resolved_kind = field_match.group(2)
                if row_index >= len(rows):
                    rows.extend({} for _ in range(row_index - len(rows) + 1))

                row = rows[row_index]
                if not isinstance(row, dict):
                    row = {}
                    rows[row_index] = row

                if resolved_kind == "source":
                    source_entry = row.get("source")
                    if not isinstance(source_entry, dict):
                        source_entry = {"language": "sa", "transliteration": {}}
                        row["source"] = source_entry
                    source_entry["script_text"] = next_value or ""
                else:
                    meanings_entry = row.get("meanings")
                    if not isinstance(meanings_entry, dict):
                        meanings_entry = {}
                        row["meanings"] = meanings_entry

                    preview_row = preview_rows[row_index] if 0 <= row_index < len(preview_rows) and isinstance(preview_rows[row_index], dict) else {}
                    resolved_meaning = (
                        preview_row.get("resolved_meaning")
                        if isinstance(preview_row.get("resolved_meaning"), dict)
                        else {}
                    )
                    target_language = (
                        str(resolved_meaning.get("language") or "").strip().lower()
                        or ("en" if "en" in meanings_entry else "")
                        or next((str(key).strip().lower() for key in meanings_entry.keys() if str(key).strip()), "en")
                    )

                    existing_meaning = meanings_entry.get(target_language)
                    if not isinstance(existing_meaning, dict):
                        existing_meaning = {}
                        meanings_entry[target_language] = existing_meaning
                    existing_meaning["text"] = next_value or ""
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unsupported field_path for single-field patch",
                )

            for index, row in enumerate(rows):
                if isinstance(row, dict):
                    row["order"] = index + 1

            content_data["word_meanings_rows"] = [
                {
                    "id": str(row.get("id") or f"wm_row_{index + 1}"),
                    "order": index + 1,
                    "source": row.get("source") if isinstance(row.get("source"), dict) else {"language": "sa", "script_text": "", "transliteration": {}},
                    "meanings": row.get("meanings") if isinstance(row.get("meanings"), dict) else {},
                    "resolved_source": {
                        "text": (
                            str(
                                (
                                    row.get("source") if isinstance(row.get("source"), dict) else {}
                                ).get("script_text")
                                or (
                                    (
                                        (row.get("source") if isinstance(row.get("source"), dict) else {}).get("transliteration")
                                        if isinstance((row.get("source") if isinstance(row.get("source"), dict) else {}).get("transliteration"), dict)
                                        else {}
                                    ).get("iast")
                                )
                                or ""
                            )
                        ),
                        "mode": "script",
                        "scheme": "",
                    },
                    "resolved_meaning": {
                        "text": (
                            str(
                                (
                                    (
                                        row.get("meanings") if isinstance(row.get("meanings"), dict) else {}
                                    ).get("en")
                                    if isinstance((row.get("meanings") if isinstance(row.get("meanings"), dict) else {}).get("en"), dict)
                                    else next(
                                        (
                                            value
                                            for value in (row.get("meanings") if isinstance(row.get("meanings"), dict) else {}).values()
                                            if isinstance(value, dict)
                                        ),
                                        {},
                                    )
                                ).get("text")
                                or ""
                            )
                        ),
                        "language": (
                            "en"
                            if isinstance((row.get("meanings") if isinstance(row.get("meanings"), dict) else {}).get("en"), dict)
                            else next(
                                (
                                    str(key).strip().lower()
                                    for key, value in (row.get("meanings") if isinstance(row.get("meanings"), dict) else {}).items()
                                    if str(key).strip() and isinstance(value, dict)
                                ),
                                "en",
                            )
                        ),
                        "fallback_badge_visible": False,
                    },
                }
                for index, row in enumerate(rows)
                if isinstance(row, dict)
            ]
        elif field_path.startswith("content_data.translation_variants.") or field_path.startswith("content_data.commentary_variants."):
            match = re.fullmatch(
                r"content_data\.(translation_variants|commentary_variants)\.(\d+)\.(text|author|language)",
                field_path,
            )
            if not match:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unsupported field_path for single-field patch",
                )

            variants_key = match.group(1)
            variant_index = int(match.group(2))
            variant_field = match.group(3)
            variants = content_data.get(variants_key)
            if not isinstance(variants, list):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{variants_key} not available on this node",
                )
            if variant_index < 0 or variant_index >= len(variants):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{variants_key} index out of bounds",
                )

            variant = variants[variant_index]
            if not isinstance(variant, dict):
                variant = {}
                variants[variant_index] = variant
            if variant_field == "language":
                variant[variant_field] = (next_value or "").strip().lower()
            elif variant_field == "author":
                variant[variant_field] = (next_value or "").strip()
            else:
                variant[variant_field] = next_value or ""
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported field_path for single-field patch",
            )

        normalized_content_data = _validate_word_meanings_content_data(content_data)
        patch_updates["content_data"] = normalized_content_data
        patch_updates["has_content"] = bool(normalized_content_data)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported field_path for single-field patch",
        )

    if payload.edit_reason:
        patch_updates["edit_reason"] = payload.edit_reason

    update_payload = ContentNodeUpdate(**patch_updates)
    return update_node(
        node_id=node_id,
        payload=update_payload,
        db=db,
        current_user=current_user,
    )


@router.post("/nodes/{node_id}/repair-level", response_model=ContentNodePublic)
def repair_node_level(
    node_id: int,
    payload: NodeLevelRepairPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    if not _user_can_edit_any(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can repair node hierarchy fields",
        )

    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    schema_levels = (
        node_book.schema.levels
        if node_book.schema and isinstance(node_book.schema.levels, list)
        else []
    )
    level_name_overrides = _book_level_name_overrides(node_book)
    requested_level_name = (payload.level_name or "").strip()
    resolved_level_name = _resolve_level_name_for_schema(
        requested_level_name,
        schema_levels,
        level_name_overrides,
    )

    if requested_level_name and isinstance(level_name_overrides, dict) and level_name_overrides:
        requested_lower = requested_level_name.lower()
        display_match = next(
            (
                canonical
                for canonical, display in level_name_overrides.items()
                if isinstance(canonical, str)
                and isinstance(display, str)
                and display.strip().lower() == requested_lower
                and canonical in schema_levels
            ),
            None,
        )
        if display_match:
            resolved_level_name = display_match

    node.level_name = resolved_level_name
    node.last_modified_by = current_user.id

    db.commit()
    db.refresh(node)

    payload_out = ContentNodePublic.model_validate(node).model_dump()
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)
    return ContentNodePublic.model_validate(payload_out)


@router.patch("/nodes/{node_id}/reorder")
def reorder_node(
    node_id: int,
    payload: NodeReorderPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    siblings = (
        db.query(ContentNode)
        .filter(
            ContentNode.book_id == node.book_id,
            ContentNode.parent_node_id == node.parent_node_id,
        )
        .all()
    )
    if len(siblings) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Node has no siblings to reorder",
        )

    ordered_siblings = sorted(
        siblings,
        key=lambda sibling: (
            _parse_numeric_order_value(sibling.sequence_number)
            if _parse_numeric_order_value(sibling.sequence_number) is not None
            else 10**9,
            sibling.id,
        ),
    )

    current_index = next(
        (index for index, sibling in enumerate(ordered_siblings) if sibling.id == node_id),
        None,
    )
    if current_index is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    target_index = current_index - 1 if payload.direction == "up" else current_index + 1
    if target_index < 0 or target_index >= len(ordered_siblings):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Node cannot be moved {payload.direction}",
        )

    reordered_siblings = list(ordered_siblings)
    moved_node = reordered_siblings.pop(current_index)
    reordered_siblings.insert(target_index, moved_node)

    for index, sibling in enumerate(reordered_siblings, start=1):
        sibling.sequence_number = index

    node.last_modified_by = current_user.id
    db.commit()

    return {
        "node_id": node_id,
        "sequence_number": target_index + 1,
        "sibling_ids": [sibling.id for sibling in reordered_siblings],
    }


@router.delete("/nodes/{node_id}", response_model=dict)
def delete_node(
    node_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    deleted_sequence: int | None = None
    if node.sequence_number is not None:
        normalized_sequence = str(node.sequence_number).strip()
        if normalized_sequence.isdigit():
            deleted_sequence = int(normalized_sequence)

    if deleted_sequence is not None:
        numeric_sequence = cast(ContentNode.sequence_number, Integer)
        siblings_to_shift = (
            db.query(ContentNode)
            .filter(
                ContentNode.book_id == node.book_id,
                ContentNode.parent_node_id == node.parent_node_id,
                ContentNode.id != node.id,
                ContentNode.sequence_number.isnot(None),
                numeric_sequence > deleted_sequence,
            )
            .order_by(numeric_sequence.asc(), ContentNode.id.asc())
            .all()
        )

        for sibling_node in siblings_to_shift:
            sibling_sequence = str(sibling_node.sequence_number).strip()
            if not sibling_sequence.isdigit():
                continue
            sibling_node.sequence_number = int(sibling_sequence) - 1

    db.delete(node)
    db.commit()
    return {"message": "Deleted"}


@router.get("/nodes/{node_id}/media", response_model=list[MediaFilePublic])
def list_node_media(
    node_id: int,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[MediaFilePublic]:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, node_book, current_user)

    media = db.query(MediaFile).filter(MediaFile.node_id == node_id).all()
    ordered_media = sorted(media, key=_media_sort_key)
    paginated_media = ordered_media[offset : offset + limit]
    return [MediaFilePublic.model_validate(item) for item in paginated_media]


@router.get("/media-bank/assets", response_model=list[MediaAssetPublic])
def list_media_bank_assets(
    q: str | None = Query(default=None),
    media_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MediaAssetPublic]:
    _ = current_user
    query = db.query(MediaAsset)

    if media_type and media_type.strip():
        normalized_type = media_type.strip().lower()
        query = query.filter(MediaAsset.media_type == normalized_type)

    rows = (
        query
        .order_by(MediaAsset.created_at.desc(), MediaAsset.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    if q and q.strip():
        normalized_q = q.strip().lower()
        filtered: list[MediaAsset] = []
        for item in rows:
            metadata = _asset_metadata(item)
            original_filename = metadata.get("original_filename")
            display_name = metadata.get("display_name")
            haystack = " ".join(
                [
                    str(item.media_type or ""),
                    str(item.url or ""),
                    str(original_filename or ""),
                    str(display_name or ""),
                ]
            ).lower()
            if normalized_q in haystack:
                filtered.append(item)
        rows = filtered

    return [MediaAssetPublic.model_validate(item) for item in rows]


@router.post(
    "/media-bank/assets",
    response_model=MediaAssetPublic,
    status_code=status.HTTP_201_CREATED,
)
def upload_media_bank_asset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaAssetPublic:
    _ensure_can_contribute(current_user)

    content_type = file.content_type or ""
    media_category = content_type.split("/")[0] if "/" in content_type else ""
    if media_category not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported media type",
        )

    suffix = Path(file.filename).suffix if file.filename else ""
    if not suffix and content_type:
        suffix = f".{content_type.split('/')[-1]}"

    relative_path = _build_media_bank_relative_path(file.filename, suffix)
    total_bytes = _save_upload_to_media_storage(file, relative_path)

    original_filename = file.filename or relative_path.name
    metadata = {
        "original_filename": original_filename,
        "display_name": original_filename,
        "content_type": content_type,
        "size_bytes": total_bytes,
    }
    asset = MediaAsset(
        media_type=media_category,
        url=MEDIA_STORAGE.public_url(relative_path),
        metadata_json=metadata,
        created_by=current_user.id,
    )

    db.add(asset)
    db.commit()
    db.refresh(asset)
    return MediaAssetPublic.model_validate(asset)


@router.post(
    "/media-bank/assets/link",
    response_model=MediaAssetPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_media_bank_link_asset(
    payload: MediaAssetCreateLinkPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaAssetPublic:
    _ensure_can_contribute(current_user)

    raw_url = payload.url.strip()
    if not raw_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="url is required",
        )

    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="url must be a valid http(s) URL",
        )

    normalized_type = (payload.media_type or "").strip().lower()
    if not normalized_type:
        inferred = ""
        host_lower = (parsed.netloc or "").lower()
        if host_lower.startswith("www."):
            host_lower = host_lower[4:]
        path_lower = (parsed.path or "").lower()
        if any(path_lower.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif")):
            inferred = "image"
        elif any(path_lower.endswith(ext) for ext in (".mp3", ".wav", ".ogg", ".aac", ".m4a", ".flac")):
            inferred = "audio"
        elif any(path_lower.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi")):
            inferred = "video"
        elif host_lower in {
            "youtube.com",
            "youtu.be",
            "m.youtube.com",
            "music.youtube.com",
            "vimeo.com",
            "dailymotion.com",
        }:
            inferred = "video"
        else:
            inferred = "link"
        normalized_type = inferred

    if normalized_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="media_type is required and must be image, audio, video, or link",
        )

    original_filename = Path(parsed.path).name or raw_url
    display_name = (payload.display_name or "").strip() or original_filename
    metadata = {
        "original_filename": original_filename,
        "display_name": display_name,
        "source": "external",
        "external_host": parsed.netloc,
    }

    asset = MediaAsset(
        media_type=normalized_type,
        url=raw_url,
        metadata_json=metadata,
        created_by=current_user.id,
    )

    db.add(asset)
    db.commit()
    db.refresh(asset)
    return MediaAssetPublic.model_validate(asset)


@router.patch("/media-bank/assets/{asset_id}", response_model=MediaAssetPublic)
def update_media_bank_asset(
    asset_id: int,
    payload: MediaAssetUpdatePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaAssetPublic:
    _ensure_can_contribute(current_user)

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="display_name is required",
        )

    metadata = _asset_metadata(asset)
    metadata["display_name"] = display_name
    _set_asset_metadata(asset, metadata)

    db.commit()
    db.refresh(asset)
    return MediaAssetPublic.model_validate(asset)


@router.post("/media-bank/assets/{asset_id}/file", response_model=MediaAssetPublic)
def replace_media_bank_asset_file(
    asset_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaAssetPublic:
    _ensure_can_contribute(current_user)

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    relative_path = _relative_media_path_from_url(asset.url)
    if not _is_bank_media_path(relative_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only uploaded media-bank assets can be replaced in place",
        )

    content_type = file.content_type or ""
    media_category = content_type.split("/")[0] if "/" in content_type else ""
    if media_category not in {"image", "audio", "video"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Replacement file must be image, audio, or video",
        )

    if media_category != asset.media_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Replacement file type '{media_category}' does not match existing asset type "
                f"'{asset.media_type}'"
            ),
        )

    if relative_path is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Asset URL cannot be mapped to a replaceable storage path",
        )

    total_bytes = _save_upload_to_media_storage(file, relative_path)

    asset_metadata = _asset_metadata(asset)
    if file.filename:
        asset_metadata["original_filename"] = file.filename
    asset_metadata["content_type"] = content_type
    asset_metadata["size_bytes"] = total_bytes
    asset_metadata["replaced_at"] = datetime.now(timezone.utc).isoformat()
    _set_asset_metadata(asset, asset_metadata)

    # Keep linked media metadata in sync while preserving URLs/links.
    linked_media = (
        db.query(MediaFile)
        .filter(MediaFile.url == asset.url, MediaFile.media_type == asset.media_type)
        .all()
    )
    for media in linked_media:
        media_metadata = _media_metadata(media)
        media_metadata["content_type"] = content_type
        media_metadata["size_bytes"] = total_bytes
        media_metadata["replaced_at"] = asset_metadata.get("replaced_at")
        _set_media_metadata(media, media_metadata)

    # Keep book-level metadata in sync for thumbnail and media_items references.
    linked_books = db.query(Book).all()
    for book in linked_books:
        book_metadata = book.metadata_json if isinstance(book.metadata_json, dict) else None
        if not book_metadata:
            continue

        metadata_changed = False
        thumbnail_url_candidates = [
            book_metadata.get("thumbnail_url"),
            book_metadata.get("thumbnailUrl"),
            book_metadata.get("cover_image_url"),
            book_metadata.get("coverImageUrl"),
        ]

        has_thumbnail_match = any(
            isinstance(candidate, str) and candidate.strip() == asset.url
            for candidate in thumbnail_url_candidates
        )
        if has_thumbnail_match:
            book_metadata["thumbnail_content_type"] = content_type
            book_metadata["thumbnail_size_bytes"] = total_bytes
            book_metadata["thumbnail_replaced_at"] = asset_metadata.get("replaced_at")
            metadata_changed = True

        media_items_raw = book_metadata.get("media_items")
        if isinstance(media_items_raw, list):
            media_items_updated = False
            for item in media_items_raw:
                if not isinstance(item, dict):
                    continue

                item_url = item.get("url")
                item_asset_id = item.get("asset_id")
                parsed_item_asset_id = None
                if isinstance(item_asset_id, int):
                    parsed_item_asset_id = item_asset_id
                elif isinstance(item_asset_id, str):
                    try:
                        parsed_item_asset_id = int(item_asset_id.strip())
                    except ValueError:
                        parsed_item_asset_id = None

                url_match = isinstance(item_url, str) and item_url.strip() == asset.url
                asset_id_match = parsed_item_asset_id == asset.id
                if not url_match and not asset_id_match:
                    continue

                item["content_type"] = content_type
                item["size_bytes"] = total_bytes
                item["replaced_at"] = asset_metadata.get("replaced_at")
                media_items_updated = True

                item_media_type = item.get("media_type")
                item_is_default = bool(item.get("is_default"))
                if item_media_type == "image" and item_is_default:
                    book_metadata["thumbnail_size_bytes"] = total_bytes
                    book_metadata["thumbnail_replaced_at"] = asset_metadata.get("replaced_at")
                    metadata_changed = True

            if media_items_updated:
                book_metadata["media_items"] = media_items_raw
                metadata_changed = True

        if metadata_changed:
            setattr(book, "metadata_json", book_metadata)
            flag_modified(book, "metadata_json")

    db.commit()
    db.refresh(asset)
    return MediaAssetPublic.model_validate(asset)


@router.delete("/media-bank/assets/{asset_id}", response_model=dict)
def delete_media_bank_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _ensure_can_contribute(current_user)

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    media_rows = db.query(MediaFile).filter(MediaFile.url == asset.url).all()
    attached_rows = []
    for row in media_rows:
        metadata = _media_metadata(row)
        metadata_asset_id = metadata.get("asset_id")
        parsed_asset_id: int | None = None
        if isinstance(metadata_asset_id, int):
            parsed_asset_id = metadata_asset_id
        elif isinstance(metadata_asset_id, str):
            try:
                parsed_asset_id = int(metadata_asset_id)
            except ValueError:
                parsed_asset_id = None

        has_explicit_asset_match = parsed_asset_id == asset.id
        has_legacy_url_match = row.url == asset.url and row.media_type == asset.media_type

        if has_explicit_asset_match or has_legacy_url_match:
            attached_rows.append(row)

    if attached_rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Asset is still attached to one or more nodes. "
                "Detach it from all nodes before deleting from the media bank."
            ),
        )

    asset_relative_path = _relative_media_path_from_url(asset.url)
    if _is_bank_media_path(asset_relative_path):
        MEDIA_STORAGE.delete_relative_path(asset_relative_path)

    db.delete(asset)
    db.commit()
    return {"message": "Deleted"}


@router.post(
    "/media-bank/assets/{asset_id}/attach/nodes/{node_id}",
    response_model=MediaFilePublic,
    status_code=status.HTTP_201_CREATED,
)
def attach_media_bank_asset_to_node(
    asset_id: int,
    node_id: int,
    payload: MediaBankAttachNodePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaFilePublic:
    _ensure_can_contribute(current_user)

    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    existing_same_type = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id, MediaFile.media_type == asset.media_type)
        .all()
    )
    next_order = max((_media_display_order(item) for item in existing_same_type), default=-1) + 1
    has_default = any(_media_is_default(item) for item in existing_same_type)

    asset_metadata = _asset_metadata(asset)
    is_default = payload.is_default or not has_default
    metadata = {
        "original_filename": asset_metadata.get("original_filename") or Path(asset.url).name,
        "content_type": asset_metadata.get("content_type"),
        "size_bytes": asset_metadata.get("size_bytes"),
        "display_order": next_order,
        "is_default": is_default,
        "asset_id": asset.id,
        "asset_display_name": asset_metadata.get("display_name"),
    }

    media = MediaFile(
        node_id=node_id,
        media_type=asset.media_type,
        url=asset.url,
        metadata_json=metadata,
    )
    db.add(media)

    if is_default:
        for item in existing_same_type:
            existing_metadata = _media_metadata(item)
            existing_metadata["is_default"] = False
            _set_media_metadata(item, existing_metadata)

    db.commit()
    db.refresh(media)
    return MediaFilePublic.model_validate(media)


@router.post("/books/{book_id}/thumbnail", response_model=BookPublic)
def upload_book_thumbnail(
    book_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookPublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_book_edit_access(db, current_user, book)

    content_type = file.content_type or ""
    media_category = content_type.split("/")[0] if "/" in content_type else ""
    if media_category != "image":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Book thumbnail must be an image",
        )

    suffix = Path(file.filename).suffix if file.filename else ""
    if not suffix and content_type:
        suffix = f".{content_type.split('/')[-1]}"

    filename = f"thumbnail_{uuid4().hex}{suffix}"
    relative_path = Path("books") / str(book_id) / filename
    total_bytes = _save_upload_to_media_storage(file, relative_path)

    metadata = book.metadata_json or {}
    if not isinstance(metadata, dict):
        metadata = {}

    existing_thumbnail_url = metadata.get("thumbnail_url")
    previous_relative_path = _relative_media_path_from_url(existing_thumbnail_url)
    expected_prefix = ("books", str(book_id))
    if previous_relative_path and previous_relative_path.parts[:2] == expected_prefix:
        MEDIA_STORAGE.delete_relative_path(previous_relative_path)

    metadata["thumbnail_url"] = MEDIA_STORAGE.public_url(relative_path)
    metadata["thumbnail_content_type"] = content_type
    metadata["thumbnail_original_filename"] = file.filename
    metadata["thumbnail_size_bytes"] = total_bytes

    setattr(book, "metadata_json", metadata)
    flag_modified(book, "metadata_json")

    db.commit()
    db.refresh(book)
    return _book_public_model(book)


@router.delete("/books/{book_id}/thumbnail", response_model=BookPublic)
def delete_book_thumbnail(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookPublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_book_edit_access(db, current_user, book)

    metadata = book.metadata_json or {}
    if not isinstance(metadata, dict):
        metadata = {}

    thumbnail_relative_path = _relative_media_path_from_url(metadata.get("thumbnail_url"))
    expected_prefix = ("books", str(book_id))
    if thumbnail_relative_path and thumbnail_relative_path.parts[:2] == expected_prefix:
        MEDIA_STORAGE.delete_relative_path(thumbnail_relative_path)

    metadata.pop("thumbnail_url", None)
    metadata.pop("thumbnailUrl", None)
    metadata.pop("cover_image_url", None)
    metadata.pop("coverImageUrl", None)
    metadata.pop("thumbnail_content_type", None)
    metadata.pop("thumbnail_original_filename", None)
    metadata.pop("thumbnail_size_bytes", None)

    setattr(book, "metadata_json", metadata)
    flag_modified(book, "metadata_json")

    db.commit()
    db.refresh(book)
    return _book_public_model(book)


@router.post(
    "/nodes/{node_id}/media",
    response_model=MediaFilePublic,
    status_code=status.HTTP_201_CREATED,
)
def upload_node_media(
    node_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaFilePublic:
    _ensure_can_contribute(current_user)
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    content_type = file.content_type or ""
    media_category = content_type.split("/")[0] if "/" in content_type else ""
    if media_category not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported media type"
        )

    suffix = Path(file.filename).suffix if file.filename else ""
    if not suffix and content_type:
        suffix = f".{content_type.split('/')[-1]}"

    filename = f"{uuid4().hex}{suffix}"
    relative_path = Path(str(node_id)) / filename
    total_bytes = _save_upload_to_media_storage(file, relative_path)

    existing_same_type = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id, MediaFile.media_type == media_category)
        .all()
    )
    next_order = (
        max((_media_display_order(item) for item in existing_same_type), default=-1) + 1
    )
    has_default = any(_media_is_default(item) for item in existing_same_type)

    url = MEDIA_STORAGE.public_url(relative_path)
    metadata = {
        "original_filename": file.filename,
        "content_type": content_type,
        "size_bytes": total_bytes,
        "display_order": next_order,
        "is_default": not has_default,
    }

    media = MediaFile(
        node_id=node_id,
        media_type=media_category,
        url=url,
        metadata_json=metadata,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return MediaFilePublic.model_validate(media)


@router.patch("/nodes/{node_id}/media/reorder", response_model=list[MediaFilePublic])
def reorder_node_media(
    node_id: int,
    payload: NodeMediaReorderPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MediaFilePublic]:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    media_type = payload.media_type.strip().lower()
    if not media_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="media_type is required")

    rows = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id, MediaFile.media_type == media_type)
        .all()
    )
    row_by_id = {item.id: item for item in rows}
    existing_ids = set(row_by_id.keys())
    requested_ids = set(payload.media_ids)

    if existing_ids != requested_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="media_ids must include exactly all media ids for the selected type",
        )

    for order, media_id in enumerate(payload.media_ids):
        item = row_by_id[media_id]
        metadata = _media_metadata(item)
        metadata["display_order"] = order
        metadata["is_default"] = order == 0
        _set_media_metadata(item, metadata)

    db.commit()
    updated_rows = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id, MediaFile.media_type == media_type)
        .all()
    )
    return [MediaFilePublic.model_validate(item) for item in sorted(updated_rows, key=_media_sort_key)]


@router.patch("/nodes/{node_id}/media/{media_id}", response_model=MediaFilePublic)
def set_default_node_media(
    node_id: int,
    media_id: int,
    payload: NodeMediaSetDefaultPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaFilePublic:
    if not payload.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only setting is_default=true is supported",
        )

    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    media = (
        db.query(MediaFile)
        .filter(MediaFile.id == media_id, MediaFile.node_id == node_id)
        .first()
    )
    if not media:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    same_type_media = (
        db.query(MediaFile)
        .filter(MediaFile.node_id == node_id, MediaFile.media_type == media.media_type)
        .all()
    )
    for item in same_type_media:
        metadata = _media_metadata(item)
        metadata["is_default"] = item.id == media.id
        _set_media_metadata(item, metadata)

    db.commit()
    db.refresh(media)
    return MediaFilePublic.model_validate(media)


@router.delete("/nodes/{node_id}/media/{media_id}", response_model=dict)
def delete_node_media(
    node_id: int,
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    _ensure_node_edit_access(db, current_user, node)

    media = (
        db.query(MediaFile)
        .filter(MediaFile.id == media_id, MediaFile.node_id == node_id)
        .first()
    )
    if not media:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    media_relative_path = _relative_media_path_from_url(media.url)
    if media_relative_path is not None and not _is_bank_media_path(media_relative_path):
        MEDIA_STORAGE.delete_relative_path(media_relative_path)

    deleted_media_type = media.media_type
    db.delete(media)
    db.commit()

    _ensure_default_for_media_type(db, node_id, deleted_media_type)
    db.commit()

    return {"message": "Deleted"}


@router.get("/commentary/authors", response_model=list[CommentaryAuthorPublic])
def list_commentary_authors(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[CommentaryAuthorPublic]:
    _ = current_user
    query = db.query(CommentaryAuthor)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(CommentaryAuthor.name.ilike(like))

    rows = (
        query
        .order_by(CommentaryAuthor.name.asc(), CommentaryAuthor.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [CommentaryAuthorPublic.model_validate(item) for item in rows]


@router.post(
    "/commentary/authors",
    response_model=CommentaryAuthorPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_commentary_author(
    payload: CommentaryAuthorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentaryAuthorPublic:
    _ensure_can_contribute(current_user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Author name is required")

    existing = (
        db.query(CommentaryAuthor)
        .filter(func.lower(CommentaryAuthor.name) == name.lower())
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Commentary author already exists")

    author = CommentaryAuthor(
        name=name,
        bio=payload.bio,
        metadata_json=payload.metadata or {},
        created_by=current_user.id,
    )
    db.add(author)
    db.commit()
    db.refresh(author)
    return CommentaryAuthorPublic.model_validate(author)


@router.patch("/commentary/authors/{author_id}", response_model=CommentaryAuthorPublic)
def update_commentary_author(
    author_id: int,
    payload: CommentaryAuthorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentaryAuthorPublic:
    _ensure_can_contribute(current_user)
    author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == author_id).first()
    if not author:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        name = (updates.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Author name is required")
        existing = (
            db.query(CommentaryAuthor)
            .filter(func.lower(CommentaryAuthor.name) == name.lower(), CommentaryAuthor.id != author_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Commentary author already exists")
        author.name = name

    if "bio" in updates:
        author.bio = updates["bio"]
    if "metadata" in updates:
        author.metadata_json = updates["metadata"] or {}

    db.commit()
    db.refresh(author)
    return CommentaryAuthorPublic.model_validate(author)


@router.get("/commentary/works", response_model=list[CommentaryWorkPublic])
def list_commentary_works(
    q: str | None = Query(default=None),
    author_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[CommentaryWorkPublic]:
    _ = current_user
    query = db.query(CommentaryWork)
    if author_id is not None:
        query = query.filter(CommentaryWork.author_id == author_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(CommentaryWork.title.ilike(like))

    rows = (
        query
        .order_by(CommentaryWork.title.asc(), CommentaryWork.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [CommentaryWorkPublic.model_validate(item) for item in rows]


@router.post(
    "/commentary/works",
    response_model=CommentaryWorkPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_commentary_work(
    payload: CommentaryWorkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentaryWorkPublic:
    _ensure_can_contribute(current_user)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work title is required")

    if payload.author_id is not None:
        author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == payload.author_id).first()
        if not author:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid author_id")

    work = CommentaryWork(
        title=title,
        author_id=payload.author_id,
        description=payload.description,
        metadata_json=payload.metadata or {},
        created_by=current_user.id,
    )
    db.add(work)
    db.commit()
    db.refresh(work)
    return CommentaryWorkPublic.model_validate(work)


@router.patch("/commentary/works/{work_id}", response_model=CommentaryWorkPublic)
def update_commentary_work(
    work_id: int,
    payload: CommentaryWorkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentaryWorkPublic:
    _ensure_can_contribute(current_user)
    work = db.query(CommentaryWork).filter(CommentaryWork.id == work_id).first()
    if not work:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    if "title" in updates:
        title = (updates.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work title is required")
        work.title = title

    if "author_id" in updates:
        next_author_id = updates.get("author_id")
        if next_author_id is not None:
            author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == next_author_id).first()
            if not author:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid author_id")
        work.author_id = next_author_id

    if "description" in updates:
        work.description = updates["description"]
    if "metadata" in updates:
        work.metadata_json = updates["metadata"] or {}

    db.commit()
    db.refresh(work)
    return CommentaryWorkPublic.model_validate(work)


@router.get("/nodes/{node_id}/commentary", response_model=list[CommentaryEntryPublic])
def list_node_commentary(
    node_id: int,
    language_code: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[CommentaryEntryPublic]:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, node_book, current_user)

    query = db.query(CommentaryEntry).filter(CommentaryEntry.node_id == node_id)
    if language_code and language_code.strip():
        query = query.filter(CommentaryEntry.language_code == language_code.strip().lower())

    rows = (
        query
        .order_by(CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [CommentaryEntryPublic.model_validate(item) for item in rows]


@router.post(
    "/nodes/{node_id}/commentary",
    response_model=CommentaryEntryPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_node_commentary(
    node_id: int,
    payload: CommentaryEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentaryEntryPublic:
    _ensure_can_contribute(current_user)
    if payload.node_id != node_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="node_id mismatch")

    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    text_value = payload.content_text.strip()
    if not text_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_text is required")

    if payload.author_id is not None:
        author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == payload.author_id).first()
        if not author:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid author_id")

    if payload.work_id is not None:
        work = db.query(CommentaryWork).filter(CommentaryWork.id == payload.work_id).first()
        if not work:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid work_id")

    language = payload.language_code.strip().lower() if payload.language_code else "en"
    if not language:
        language = "en"

    entry = CommentaryEntry(
        node_id=node_id,
        author_id=payload.author_id,
        work_id=payload.work_id,
        content_text=text_value,
        language_code=language,
        display_order=payload.display_order,
        metadata_json=payload.metadata or {},
        created_by=current_user.id,
        last_modified_by=current_user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return CommentaryEntryPublic.model_validate(entry)


@router.patch("/nodes/{node_id}/commentary/{entry_id}", response_model=CommentaryEntryPublic)
def update_node_commentary(
    node_id: int,
    entry_id: int,
    payload: CommentaryEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentaryEntryPublic:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    entry = (
        db.query(CommentaryEntry)
        .filter(CommentaryEntry.id == entry_id, CommentaryEntry.node_id == node_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    if "author_id" in updates:
        next_author_id = updates.get("author_id")
        if next_author_id is not None:
            author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == next_author_id).first()
            if not author:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid author_id")
        entry.author_id = next_author_id

    if "work_id" in updates:
        next_work_id = updates.get("work_id")
        if next_work_id is not None:
            work = db.query(CommentaryWork).filter(CommentaryWork.id == next_work_id).first()
            if not work:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid work_id")
        entry.work_id = next_work_id

    if "content_text" in updates:
        text_value = (updates.get("content_text") or "").strip()
        if not text_value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_text is required")
        entry.content_text = text_value

    if "language_code" in updates:
        language = (updates.get("language_code") or "").strip().lower()
        if not language:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="language_code is required")
        entry.language_code = language

    if "display_order" in updates:
        entry.display_order = int(updates["display_order"])

    if "metadata" in updates:
        entry.metadata_json = updates["metadata"] or {}

    entry.last_modified_by = current_user.id
    db.commit()
    db.refresh(entry)
    return CommentaryEntryPublic.model_validate(entry)


@router.delete("/nodes/{node_id}/commentary/{entry_id}", response_model=dict)
def delete_node_commentary(
    node_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    entry = (
        db.query(CommentaryEntry)
        .filter(CommentaryEntry.id == entry_id, CommentaryEntry.node_id == node_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    db.delete(entry)
    db.commit()
    return {"message": "Deleted"}


@router.get("/renditions/authors", response_model=list[CommentaryAuthorPublic])
def list_rendition_authors(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[CommentaryAuthorPublic]:
    return list_commentary_authors(q=q, limit=limit, offset=offset, db=db, current_user=current_user)


@router.get("/renditions/works", response_model=list[CommentaryWorkPublic])
def list_rendition_works(
    q: str | None = Query(default=None),
    author_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[CommentaryWorkPublic]:
    return list_commentary_works(
        q=q,
        author_id=author_id,
        limit=limit,
        offset=offset,
        db=db,
        current_user=current_user,
    )


@router.get("/nodes/{node_id}/renditions", response_model=list[ContentRenditionPublic])
def list_node_renditions(
    node_id: int,
    rendition_type: Literal["translation", "commentary"] | None = Query(default=None),
    language_code: str | None = Query(default=None),
    script_code: str | None = Query(default=None),
    author_id: int | None = Query(default=None),
    work_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ContentRenditionPublic]:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, node_book, current_user)

    query = db.query(ContentRendition).filter(ContentRendition.node_id == node_id)
    if rendition_type is not None:
        query = query.filter(ContentRendition.rendition_type == rendition_type)
    if language_code and language_code.strip():
        query = query.filter(ContentRendition.language_code == language_code.strip().lower())
    if script_code and script_code.strip():
        query = query.filter(ContentRendition.script_code == script_code.strip().lower())
    if author_id is not None:
        query = query.filter(ContentRendition.author_id == author_id)
    if work_id is not None:
        query = query.filter(ContentRendition.work_id == work_id)

    rows = (
        query
        .order_by(ContentRendition.display_order.asc(), ContentRendition.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [ContentRenditionPublic.model_validate(item) for item in rows]


@router.post(
    "/nodes/{node_id}/renditions",
    response_model=ContentRenditionPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_node_rendition(
    node_id: int,
    payload: ContentRenditionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentRenditionPublic:
    _ensure_can_contribute(current_user)
    if payload.node_id != node_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="node_id mismatch")

    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    text_value = payload.content_text.strip()
    if not text_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_text is required")

    if payload.author_id is not None:
        author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == payload.author_id).first()
        if not author:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid author_id")

    if payload.work_id is not None:
        work = db.query(CommentaryWork).filter(CommentaryWork.id == payload.work_id).first()
        if not work:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid work_id")

    language = payload.language_code.strip().lower() if payload.language_code else "en"
    if not language:
        language = "en"
    script = payload.script_code.strip().lower() if payload.script_code else None

    entry = ContentRendition(
        node_id=node_id,
        rendition_type=payload.rendition_type,
        author_id=payload.author_id,
        work_id=payload.work_id,
        content_text=text_value,
        language_code=language,
        script_code=script,
        display_order=payload.display_order,
        metadata_json=payload.metadata or {},
        created_by=current_user.id,
        last_modified_by=current_user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return ContentRenditionPublic.model_validate(entry)


@router.patch("/nodes/{node_id}/renditions/{rendition_id}", response_model=ContentRenditionPublic)
def update_node_rendition(
    node_id: int,
    rendition_id: int,
    payload: ContentRenditionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentRenditionPublic:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    rendition = (
        db.query(ContentRendition)
        .filter(ContentRendition.id == rendition_id, ContentRendition.node_id == node_id)
        .first()
    )
    if not rendition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    updates = payload.model_dump(exclude_unset=True)
    if "rendition_type" in updates:
        rendition.rendition_type = updates["rendition_type"]

    if "author_id" in updates:
        next_author_id = updates.get("author_id")
        if next_author_id is not None:
            author = db.query(CommentaryAuthor).filter(CommentaryAuthor.id == next_author_id).first()
            if not author:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid author_id")
        rendition.author_id = next_author_id

    if "work_id" in updates:
        next_work_id = updates.get("work_id")
        if next_work_id is not None:
            work = db.query(CommentaryWork).filter(CommentaryWork.id == next_work_id).first()
            if not work:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid work_id")
        rendition.work_id = next_work_id

    if "content_text" in updates:
        text_value = (updates.get("content_text") or "").strip()
        if not text_value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_text is required")
        rendition.content_text = text_value

    if "language_code" in updates:
        language = (updates.get("language_code") or "").strip().lower()
        if not language:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="language_code is required")
        rendition.language_code = language

    if "script_code" in updates:
        script = updates.get("script_code")
        script_value = script.strip().lower() if isinstance(script, str) else None
        rendition.script_code = script_value

    if "display_order" in updates:
        rendition.display_order = int(updates["display_order"])

    if "metadata" in updates:
        rendition.metadata_json = updates["metadata"] or {}

    rendition.last_modified_by = current_user.id
    db.commit()
    db.refresh(rendition)
    return ContentRenditionPublic.model_validate(rendition)


@router.delete("/nodes/{node_id}/renditions/{rendition_id}", response_model=dict)
def delete_node_rendition(
    node_id: int,
    rendition_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_node_edit_access(db, current_user, node)

    rendition = (
        db.query(ContentRendition)
        .filter(ContentRendition.id == rendition_id, ContentRendition.node_id == node_id)
        .first()
    )
    if not rendition:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    db.delete(rendition)
    db.commit()
    return {"message": "Deleted"}


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
    
    # Verify book exists and user has edit access
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        return BulkTreeImportResponse(
            success=False,
            book_id=book_id,
            errors=["Book not found"]
        )
    
    try:
        _ensure_book_edit_access(db, current_user, book)
    except HTTPException as e:
        return BulkTreeImportResponse(
            success=False,
            book_id=book_id,
            errors=[e.detail]
        )
    
    # Optional: Clear existing nodes
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
    
    # Get schema info for validation
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
        # Process each chapter (top-level node)
        for chapter_idx, chapter_item in enumerate(payload.nodes, start=1):
            try:
                # Convert sequence_number to integer (auto-generate if needed)
                chapter_seq = chapter_idx
                if chapter_item.sequence_number:
                    seq_str = str(chapter_item.sequence_number).strip()
                    if seq_str.isdigit():
                        chapter_seq = int(seq_str)
                
                # Create chapter node
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
                db.flush()  # Get chapter_node.id for child references
                chapters_created += 1
                
                # Process child nodes (verses)
                for verse_idx, verse_item in enumerate(chapter_item.children, start=1):
                    try:
                        # Convert sequence_number to integer (auto-generate if needed)
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
        
        # Commit all changes
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


@router.get("/nodes/{node_id}/comments", response_model=list[NodeCommentPublic])
def list_node_comments(
    node_id: int,
    parent_comment_id: int | None = Query(default=None),
    language_code: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[NodeCommentPublic]:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, node_book, current_user)

    query = db.query(NodeComment).filter(NodeComment.node_id == node_id)
    if parent_comment_id is not None:
        query = query.filter(NodeComment.parent_comment_id == parent_comment_id)
    if language_code and language_code.strip():
        query = query.filter(NodeComment.language_code == language_code.strip().lower())

    rows = (
        query
        .order_by(NodeComment.created_at.asc(), NodeComment.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [NodeCommentPublic.model_validate(item) for item in rows]


@router.post(
    "/nodes/{node_id}/comments",
    response_model=NodeCommentPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_node_comment(
    node_id: int,
    payload: NodeCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NodeCommentPublic:
    _ensure_can_contribute(current_user)
    if payload.node_id != node_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="node_id mismatch")

    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if not node_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, node_book, current_user)

    text_value = payload.content_text.strip()
    if not text_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_text is required")

    parent_comment_id = payload.parent_comment_id
    if parent_comment_id is not None:
        parent_comment = (
            db.query(NodeComment)
            .filter(NodeComment.id == parent_comment_id, NodeComment.node_id == node_id)
            .first()
        )
        if not parent_comment:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent_comment_id")

    language = payload.language_code.strip().lower() if payload.language_code else "en"
    if not language:
        language = "en"

    comment = NodeComment(
        node_id=node_id,
        parent_comment_id=parent_comment_id,
        content_text=text_value,
        language_code=language,
        metadata_json=payload.metadata or {},
        created_by=current_user.id,
        last_modified_by=current_user.id,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return NodeCommentPublic.model_validate(comment)


@router.patch("/nodes/{node_id}/comments/{comment_id}", response_model=NodeCommentPublic)
def update_node_comment(
    node_id: int,
    comment_id: int,
    payload: NodeCommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NodeCommentPublic:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    comment = (
        db.query(NodeComment)
        .filter(NodeComment.id == comment_id, NodeComment.node_id == node_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    is_author = current_user.id is not None and comment.created_by == current_user.id
    if not is_author:
        _ensure_node_edit_access(db, current_user, node)

    updates = payload.model_dump(exclude_unset=True)
    if "parent_comment_id" in updates:
        next_parent_comment_id = updates.get("parent_comment_id")
        if next_parent_comment_id is not None:
            if int(next_parent_comment_id) == comment_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment cannot parent itself")
            parent_comment = (
                db.query(NodeComment)
                .filter(NodeComment.id == next_parent_comment_id, NodeComment.node_id == node_id)
                .first()
            )
            if not parent_comment:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent_comment_id")
        comment.parent_comment_id = next_parent_comment_id

    if "content_text" in updates:
        text_value = (updates.get("content_text") or "").strip()
        if not text_value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content_text is required")
        comment.content_text = text_value

    if "language_code" in updates:
        language = (updates.get("language_code") or "").strip().lower()
        if not language:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="language_code is required")
        comment.language_code = language

    if "metadata" in updates:
        comment.metadata_json = updates["metadata"] or {}

    comment.last_modified_by = current_user.id
    db.commit()
    db.refresh(comment)
    return NodeCommentPublic.model_validate(comment)


@router.delete("/nodes/{node_id}/comments/{comment_id}", response_model=dict)
def delete_node_comment(
    node_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    comment = (
        db.query(NodeComment)
        .filter(NodeComment.id == comment_id, NodeComment.node_id == node_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    is_author = current_user.id is not None and comment.created_by == current_user.id
    if not is_author:
        _ensure_node_edit_access(db, current_user, node)

    db.delete(comment)
    db.commit()
    return {"message": "Deleted"}


@router.post("/license-policy-check", response_model=DraftLicensePolicyReport)
def check_license_policy_for_nodes(
    payload: LicensePolicyCheckPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DraftLicensePolicyReport:
    _ensure_can_contribute(current_user)
    return _build_license_policy_report_for_node_ids(payload.node_ids, db)


@router.post("/books/{book_id}/insert-references", response_model=dict)
def insert_references(
    book_id: int,
    payload: InsertReferencesPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Insert nodes from other books as references into the target book.
    References point to original content, so changes propagate automatically.
    """
    parent_node_id = payload.parent_node_id
    node_ids = payload.node_ids
    section_assignments = payload.section_assignments or {}

    # Verify target book exists
    target_book = db.query(Book).filter(Book.id == book_id).first()
    if not target_book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target book not found")

    _ensure_can_contribute(current_user)
    _ensure_book_edit_access(db, current_user, target_book)

    # Verify parent node if specified
    if parent_node_id is not None:
        parent = db.query(ContentNode).filter(
            ContentNode.id == parent_node_id,
            ContentNode.book_id == book_id,
        ).first()
        if not parent:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent node not found")
        parent_level_order = parent.level_order
    else:
        parent_level_order = 0

    # Get schema to determine level structure
    schema = target_book.schema
    if not schema:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Book has no schema")

    created_refs = []

    for node_id in node_ids:
        # Get the source node
        source_node = db.query(ContentNode).filter(ContentNode.id == node_id).first()
        if not source_node:
            continue

        assigned_section = section_assignments.get(str(node_id), "body").strip().lower()
        if assigned_section not in {"front", "body", "back"}:
            assigned_section = "body"

        # Calculate sequence number (max + 1)
        max_seq = (
            db.query(func.max(ContentNode.sequence_number))
            .filter(
                ContentNode.book_id == book_id,
                ContentNode.parent_node_id == parent_node_id,
            )
            .scalar()
        )
        sequence = (int(max_seq) if max_seq else 0) + 1

        # Create reference node
        ref_node = ContentNode(
            book_id=book_id,
            parent_node_id=parent_node_id,
            referenced_node_id=source_node.id,
            level_name=source_node.level_name,
            level_order=parent_level_order + 1,
            sequence_number=sequence,
            # Copy titles for display/search purposes
            title_sanskrit=source_node.title_sanskrit,
            title_transliteration=source_node.title_transliteration,
            title_english=source_node.title_english,
            title_hindi=source_node.title_hindi,
            title_tamil=source_node.title_tamil,
            has_content=False,  # References don't store content directly
            metadata_json={
                "source_type": "library_reference",
                "draft_section": assigned_section,
                "source_node_id": source_node.id,
                "source_book_id": source_node.book_id,
            },
            created_by=current_user.id,
            last_modified_by=current_user.id,
        )
        db.add(ref_node)
        db.flush()

        provenance = ProvenanceRecord(
            target_book_id=book_id,
            target_node_id=ref_node.id,
            source_book_id=source_node.book_id,
            source_node_id=source_node.id,
            source_type="library_reference",
            source_author=source_node.source_attribution,
            license_type=source_node.license_type or "CC-BY-SA-4.0",
            source_version=(
                source_node.updated_at.isoformat() if getattr(source_node, "updated_at", None) else "unknown"
            ),
            inserted_by=current_user.id,
            draft_section=assigned_section,
        )
        db.add(provenance)
        created_refs.append(ref_node.id)

    db.commit()

    return {
        "message": f"Created {len(created_refs)} reference(s)",
        "created_ids": created_refs,
    }

