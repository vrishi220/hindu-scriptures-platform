import os
import random
import re
import json
import logging
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import Integer, cast, or_, text
from sqlalchemy.orm import Session, load_only
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import func

from api.users import get_current_user, get_current_user_optional, require_permission
from services.email import send_share_invitation
from models.book import Book
from models.book_share import BookShare
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
from models.content_rendition import ContentRendition
from models.node_comment import NodeComment
from models.media_file import MediaFile
from models.media_asset import MediaAsset
from models.property_system import MetadataBinding
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
    ContentNodeCreate,
    ContentNodeCommentaryPatch,
    ContentNodeFieldPatch,
    ContentNodePublic,
    ContentNodeTree,
    ContentNodeTreeItem,
    ContentNodeTranslationPatch,
    ContentNodeWordMeaningsTokenPatch,
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
BOOK_NODE_METADATA_KEY = "book_node"


def require_import_permission(current_user: User = Depends(get_current_user)) -> User:
    perms = current_user.permissions or {}
    if perms.get("can_import") or perms.get("can_admin") or current_user.role == "admin":
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")



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


def _resolved_variant_authors_for_book(book: Book) -> dict[str, str]:
    registry = dict(book.variant_authors) if isinstance(book.variant_authors, dict) else {}
    # Ensure HSP AI is resolvable in Avadhuta Gita scripture browser displays.
    if (book.book_code or "").strip().lower() == "avadhuta-gita":
        registry.setdefault("hsp_ai", "HSP AI")
    return registry


def _resolve_effective_source_node(db: Session, node: ContentNode) -> ContentNode:
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

    return source_node


def _merge_node_commentary_variants(
    db: Session,
    node: ContentNode,
    content_data: object,
) -> dict:
    sanitized = _sanitize_content_data_for_response(content_data)
    existing_variants = (
        list(sanitized.get("commentary_variants"))
        if isinstance(sanitized.get("commentary_variants"), list)
        else []
    )

    rows = (
        db.query(CommentaryEntry, CommentaryWork, CommentaryAuthor)
        .outerjoin(CommentaryWork, CommentaryEntry.work_id == CommentaryWork.id)
        .outerjoin(CommentaryAuthor, CommentaryEntry.author_id == CommentaryAuthor.id)
        .filter(CommentaryEntry.node_id == node.id)
        .order_by(CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
        .all()
    )

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    variant_author_registry = _resolved_variant_authors_for_book(node_book) if node_book else {}
    author_slug_by_name = {
        str(name).strip().lower(): str(slug).strip()
        for slug, name in variant_author_registry.items()
        if str(slug).strip() and str(name).strip()
    }

    merged_variants: list[dict] = []
    for entry, work, author in rows:
        text_value = (entry.content_text or "").strip()

        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        language = (entry.language_code or str(metadata.get("language") or "en")).strip().lower() or "en"

        author_name = ""
        if author and isinstance(author.name, str) and author.name.strip():
            author_name = author.name.strip()
        elif isinstance(metadata.get("author"), str) and str(metadata.get("author")).strip():
            author_name = str(metadata.get("author")).strip()
        elif work and isinstance(work.title, str) and work.title.strip():
            author_name = work.title.strip()

        author_slug = ""
        if isinstance(metadata.get("author_slug"), str):
            author_slug = str(metadata.get("author_slug")).strip().lower()
        if not author_slug and author_name:
            author_slug = author_slug_by_name.get(author_name.lower(), "")
        if not author_slug and author_name:
            author_slug = _normalize_variant_author_slug(author_name)

        field_value = str(metadata.get("field") or "ec").strip() or "ec"

        merged_variants.append(
            {
                "author_slug": author_slug,
                "author_name": author_name,
                "author": author_name,
                "language": language,
                "field": field_value,
                "text": text_value,
            }
        )

    # Prefer relational rows when available; otherwise preserve inline variants
    # so single-field PATCH responses remain stable for draft/preview flows.
    sanitized["commentary_variants"] = merged_variants if merged_variants else existing_variants
    return sanitized


def _merge_node_translation_variants(
    db: Session,
    node: ContentNode,
    content_data: object,
) -> dict:
    sanitized = _sanitize_content_data_for_response(content_data)
    existing_variants = (
        list(sanitized.get("translation_variants"))
        if isinstance(sanitized.get("translation_variants"), list)
        else []
    )

    rows = (
        db.query(TranslationEntry, TranslationWork, TranslationAuthor)
        .outerjoin(TranslationWork, TranslationEntry.work_id == TranslationWork.id)
        .outerjoin(TranslationAuthor, TranslationEntry.author_id == TranslationAuthor.id)
        .filter(TranslationEntry.node_id == node.id)
        .order_by(TranslationEntry.display_order.asc(), TranslationEntry.id.asc())
        .all()
    )

    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    variant_author_registry = _resolved_variant_authors_for_book(node_book) if node_book else {}
    author_slug_by_name = {
        str(name).strip().lower(): str(slug).strip()
        for slug, name in variant_author_registry.items()
        if str(slug).strip() and str(name).strip()
    }

    merged_variants: list[dict] = []
    for entry, work, author in rows:
        text_value = (entry.content_text or "").strip()

        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        language = (entry.language_code or str(metadata.get("language") or "en")).strip().lower() or "en"

        author_name = ""
        if author and isinstance(author.name, str) and author.name.strip():
            author_name = author.name.strip()
        elif isinstance(metadata.get("author_name"), str) and str(metadata.get("author_name")).strip():
            author_name = str(metadata.get("author_name")).strip()
        elif isinstance(metadata.get("author"), str) and str(metadata.get("author")).strip():
            author_name = str(metadata.get("author")).strip()
        elif work and isinstance(work.title, str) and work.title.strip():
            author_name = work.title.strip()

        author_slug = ""
        if isinstance(metadata.get("author_slug"), str):
            author_slug = str(metadata.get("author_slug")).strip().lower()
        if not author_slug and author_name:
            author_slug = author_slug_by_name.get(author_name.lower(), "")
        if not author_slug and author_name:
            author_slug = _normalize_variant_author_slug(author_name)

        field_value = str(metadata.get("field") or "translation").strip() or "translation"

        merged_variants.append(
            {
                "author_slug": author_slug,
                "author_name": author_name,
                "author": author_name,
                "language": language,
                "field": field_value,
                "text": text_value,
            }
        )

    # Prefer relational rows when available; otherwise preserve inline variants
    # so single-field PATCH responses remain stable for draft/preview flows.
    sanitized["translation_variants"] = merged_variants if merged_variants else existing_variants
    return sanitized


def _merge_node_relational_variants(
    db: Session,
    node: ContentNode,
    content_data: object,
) -> dict:
    with_translation = _merge_node_translation_variants(db, node, content_data)
    with_commentary = _merge_node_commentary_variants(db, node, with_translation)
    return _merge_node_word_meanings(db, node, with_commentary)


def _merge_node_word_meanings(
    db: Session,
    node: ContentNode,
    content_data: object,
) -> dict:
    sanitized = _sanitize_content_data_for_response(content_data)
    existing_word_meanings = (
        dict(sanitized.get("word_meanings"))
        if isinstance(sanitized.get("word_meanings"), dict)
        else {}
    )
    existing_rows = (
        list(existing_word_meanings.get("rows"))
        if isinstance(existing_word_meanings.get("rows"), list)
        else []
    )

    rows = (
        db.query(WordMeaningEntry)
        .filter(WordMeaningEntry.node_id == node.id)
        .order_by(
            WordMeaningEntry.word_order.asc(),
            WordMeaningEntry.display_order.asc(),
            WordMeaningEntry.id.asc(),
        )
        .all()
    )

    if not rows:
        if existing_word_meanings:
            sanitized["word_meanings"] = existing_word_meanings
        return sanitized

    grouped: dict[int, dict] = {}
    for entry in rows:
        source_word = str(entry.source_word or "").strip()
        language_code = str(entry.language_code or "").strip().lower()
        meaning_text = str(entry.meaning_text or "").strip()
        if not source_word or not language_code or not meaning_text:
            continue

        row_key = int(entry.word_order or 0)
        if row_key <= 0:
            row_key = int(entry.display_order or 0) + 1

        row = grouped.get(row_key)
        if row is None:
            row = {
                "id": f"wm_{node.id}_{row_key}",
                "order": row_key,
                "source": {
                    "language": "sa",
                    "script_text": source_word,
                    "transliteration": {
                        "iast": str(entry.transliteration or source_word).strip(),
                    },
                },
                "meanings": {},
            }
            grouped[row_key] = row

        meanings = row.get("meanings") if isinstance(row.get("meanings"), dict) else {}
        if language_code not in meanings:
            meanings[language_code] = {"text": meaning_text}
        row["meanings"] = meanings

    relational_rows = [grouped[key] for key in sorted(grouped.keys())]
    for idx, row in enumerate(relational_rows, start=1):
        row["order"] = idx

    if relational_rows:
        sanitized["word_meanings"] = {
            "rows": relational_rows,
            "version": existing_word_meanings.get("version") if existing_word_meanings else "1.0",
        }
        sanitized["word_meanings_rows"] = _build_word_meanings_rows_from_raw(relational_rows)
    elif existing_word_meanings:
        sanitized["word_meanings"] = existing_word_meanings

    return sanitized


def _node_response_payload(node: ContentNode) -> dict:
    payload = {key: value for key, value in vars(node).items() if not key.startswith("_")}
    payload["content_data"] = _sanitize_content_data_for_response(payload.get("content_data"))
    return payload


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


class InsertReferencesPayload(BaseModel):
    parent_node_id: int | None = None
    node_ids: list[int]
    section_assignments: dict[str, str] | None = None


class LicensePolicyCheckPayload(BaseModel):
    node_ids: list[int]


class NodeReorderPayload(BaseModel):
    direction: Literal["up", "down"] | None = None
    sibling_ids: list[int] | None = None


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



def _book_status(book: Book) -> str:
    return book_status(book)



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


def _book_node_payload_from_metadata(metadata: object) -> dict:
    metadata_obj = metadata if isinstance(metadata, dict) else {}
    raw_payload = metadata_obj.get(BOOK_NODE_METADATA_KEY)
    payload = raw_payload if isinstance(raw_payload, dict) else {}

    content_data = _sanitize_content_data_for_response(payload.get("content_data"))
    summary_data = payload.get("summary_data") if isinstance(payload.get("summary_data"), dict) else {}
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []

    return {
        "title_sanskrit": payload.get("title_sanskrit") if isinstance(payload.get("title_sanskrit"), str) else None,
        "title_transliteration": payload.get("title_transliteration") if isinstance(payload.get("title_transliteration"), str) else None,
        "title_english": payload.get("title_english") if isinstance(payload.get("title_english"), str) else None,
        "title_hindi": payload.get("title_hindi") if isinstance(payload.get("title_hindi"), str) else None,
        "title_tamil": payload.get("title_tamil") if isinstance(payload.get("title_tamil"), str) else None,
        "has_content": bool(payload.get("has_content")),
        "content_data": content_data,
        "summary_data": summary_data,
        "source_attribution": payload.get("source_attribution") if isinstance(payload.get("source_attribution"), str) else None,
        "license_type": payload.get("license_type") if isinstance(payload.get("license_type"), str) else "CC-BY-SA-4.0",
        "original_source_url": payload.get("original_source_url") if isinstance(payload.get("original_source_url"), str) else None,
        "tags": tags,
    }


def _write_book_node_payload_into_metadata(metadata: dict, node_payload: dict) -> None:
    metadata[BOOK_NODE_METADATA_KEY] = {
        "title_sanskrit": node_payload.get("title_sanskrit"),
        "title_transliteration": node_payload.get("title_transliteration"),
        "title_english": node_payload.get("title_english"),
        "title_hindi": node_payload.get("title_hindi"),
        "title_tamil": node_payload.get("title_tamil"),
        "has_content": bool(node_payload.get("has_content")),
        "content_data": node_payload.get("content_data") if isinstance(node_payload.get("content_data"), dict) else {},
        "summary_data": node_payload.get("summary_data") if isinstance(node_payload.get("summary_data"), dict) else {},
        "source_attribution": node_payload.get("source_attribution"),
        "license_type": node_payload.get("license_type") if isinstance(node_payload.get("license_type"), str) else "CC-BY-SA-4.0",
        "original_source_url": node_payload.get("original_source_url"),
        "tags": node_payload.get("tags") if isinstance(node_payload.get("tags"), list) else [],
    }


def _book_public_model(book: Book, verse_count: int | None = None) -> BookPublic:
    existing_metadata = book.metadata_json or {}
    if not isinstance(existing_metadata, dict):
        existing_metadata = {}
    metadata = dict(existing_metadata)

    metadata_out = dict(metadata)
    metadata_out["status"] = _book_status(book)
    metadata_out["visibility"] = book_visibility(book)
    node_payload = _book_node_payload_from_metadata(metadata)

    payload = {
        "id": book.id,
        "schema_id": book.schema_id,
        "book_name": book.book_name,
        "book_code": book.book_code,
        "language_primary": book.language_primary,
        "metadata_json": metadata_out,
        "level_name_overrides": _book_level_name_overrides(book),
        "variant_authors": _resolved_variant_authors_for_book(book),
        "status": metadata_out["status"],
        "visibility": metadata_out["visibility"],
        "verse_count": verse_count,
        "schema": book.schema,
        **node_payload,
    }
    return BookPublic.model_validate(payload)




def _normalize_variant_author_slug(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized


def _variant_author_name_for_slug(book: Book | None, author_slug: str) -> str:
    slug = _normalize_variant_author_slug(author_slug)
    if not slug:
        return ""

    if book is not None:
        registry = _resolved_variant_authors_for_book(book)
        resolved_name = str(registry.get(slug) or "").strip()
        if resolved_name:
            return resolved_name

    fallback = slug.replace("_", " ").replace("-", " ").strip()
    return fallback.title() if fallback else slug


def _variant_entry_matches_author_slug(
    author_slug: str,
    metadata: dict,
    author_name: str,
) -> bool:
    target_slug = _normalize_variant_author_slug(author_slug)
    if not target_slug:
        return False

    candidates: set[str] = set()
    metadata_slug = metadata.get("author_slug")
    if isinstance(metadata_slug, str):
        candidates.add(_normalize_variant_author_slug(metadata_slug))

    metadata_author = metadata.get("author")
    if isinstance(metadata_author, str):
        candidates.add(_normalize_variant_author_slug(metadata_author))

    metadata_author_name = metadata.get("author_name")
    if isinstance(metadata_author_name, str):
        candidates.add(_normalize_variant_author_slug(metadata_author_name))

    if author_name:
        candidates.add(_normalize_variant_author_slug(author_name))

    return target_slug in candidates


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


_NODE_SIMPLE_PATCH_FIELDS = {
    "title_english",
    "title_sanskrit",
    "title_transliteration",
    "sequence_number",
}

_BOOK_SIMPLE_PATCH_FIELDS = {
    "title_english",
    "title_sanskrit",
    "title_transliteration",
}


def _unsupported_single_field_patch() -> None:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Unsupported field_path for single-field patch",
    )


def _normalize_single_field_patch_value(value: object) -> object:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned if cleaned else None
    return value


def _normalize_content_field_patch_value(value: object) -> object:
    if isinstance(value, str):
        normalized = value.replace("\r\n", "\n")
        return normalized if normalized.strip() else None
    return value


def _clone_content_data(value: object) -> dict:
    if isinstance(value, dict):
        return json.loads(json.dumps(value))
    return {}


def _set_basic_content_field(content_data: dict, field_path: str, next_value: object) -> None:
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

    # Keep English translation aliases synchronized when basic.translation changes.
    if basic_key == "translation":
        translations = content_data.get("translations")
        if not isinstance(translations, dict):
            translations = {}
        if next_value is None:
            translations.pop("en", None)
            translations.pop("english", None)
        else:
            translations["en"] = next_value
            translations["english"] = next_value
        if translations:
            content_data["translations"] = translations
        else:
            content_data.pop("translations", None)


def _set_translation_content_field(content_data: dict, field_path: str, next_value: object) -> None:
    translation_key = field_path[len("content_data.translations.") :].strip()
    translations = content_data.get("translations")
    if not isinstance(translations, dict):
        translations = {}
    if next_value is None:
        translations.pop(translation_key, None)
        if translation_key == "en":
            translations.pop("english", None)
        elif translation_key == "english":
            translations.pop("en", None)
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

    # Keep basic.translation synchronized when English aliases are patched.
    if translation_key in {"en", "english"}:
        basic = content_data.get("basic")
        if not isinstance(basic, dict):
            basic = {}
        if next_value is None:
            basic.pop("translation", None)
        else:
            basic["translation"] = next_value
        if basic:
            content_data["basic"] = basic
        else:
            content_data.pop("basic", None)


def _normalize_variant_payload(value: object) -> dict:
    if isinstance(value, dict):
        return {
            "author_slug": str(value.get("author_slug") or "").strip(),
            "author": str(value.get("author") or "").strip(),
            "language": str(value.get("language") or "").strip().lower(),
            "field": str(value.get("field") or "").strip().lower(),
            "text": str(value.get("text") or ""),
        }
    return {
        "author_slug": "",
        "author": "",
        "language": "",
        "field": "",
        "text": "",
    }


def _apply_variant_field_patch(content_data: dict, field_path: str, next_value: object) -> None:
    field_match = re.fullmatch(
        r"content_data\.(translation_variants|commentary_variants)\.(\d+)\.(text|author|language)",
        field_path,
    )
    add_match = re.fullmatch(
        r"content_data\.(translation_variants|commentary_variants)\.add",
        field_path,
    )
    delete_match = re.fullmatch(
        r"content_data\.(translation_variants|commentary_variants)\.(\d+)\.delete",
        field_path,
    )
    replace_all_match = re.fullmatch(
        r"content_data\.(translation_variants|commentary_variants)\.replace_all",
        field_path,
    )

    if field_match:
        variants_key = field_match.group(1)
        variant_index = int(field_match.group(2))
        variant_field = field_match.group(3)
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
        return

    if add_match:
        variants_key = add_match.group(1)
        variants = content_data.get(variants_key)
        if not isinstance(variants, list):
            variants = []
        variants.append(_normalize_variant_payload(next_value))
        content_data[variants_key] = variants
        return

    if delete_match:
        variants_key = delete_match.group(1)
        variant_index = int(delete_match.group(2))
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
        variants.pop(variant_index)
        if variants:
            content_data[variants_key] = variants
        else:
            content_data.pop(variants_key, None)
        return

    if replace_all_match:
        variants_key = replace_all_match.group(1)
        if next_value is None:
            content_data.pop(variants_key, None)
            return
        if not isinstance(next_value, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"value must be a list for {variants_key}.replace_all",
            )
        content_data[variants_key] = [item for item in next_value if isinstance(item, dict)]
        return

    _unsupported_single_field_patch()


def _build_preview_word_meanings_rows(rows: list) -> list[dict]:
    result: list[dict] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        source = row.get("source") if isinstance(row.get("source"), dict) else {}
        transliteration = source.get("transliteration") if isinstance(source.get("transliteration"), dict) else {}
        meanings = row.get("meanings") if isinstance(row.get("meanings"), dict) else {}

        preferred_meaning = meanings.get("en") if isinstance(meanings.get("en"), dict) else next(
            (value for value in meanings.values() if isinstance(value, dict)),
            {},
        )
        preferred_language = (
            "en"
            if isinstance(meanings.get("en"), dict)
            else next(
                (
                    str(key).strip().lower()
                    for key, value in meanings.items()
                    if str(key).strip() and isinstance(value, dict)
                ),
                "en",
            )
        )

        result.append(
            {
                "id": str(row.get("id") or f"wm_row_{index + 1}"),
                "order": index + 1,
                "source": source if source else {"language": "sa", "script_text": "", "transliteration": {}},
                "meanings": meanings,
                "resolved_source": {
                    "text": str(source.get("script_text") or transliteration.get("iast") or ""),
                    "mode": "script",
                    "scheme": "",
                },
                "resolved_meaning": {
                    "text": str(preferred_meaning.get("text") or ""),
                    "language": preferred_language,
                    "fallback_badge_visible": False,
                },
            }
        )
    return result


def _apply_word_meanings_field_patch(content_data: dict, field_path: str, next_value: object) -> None:
    word_meanings = content_data.get("word_meanings") if isinstance(content_data.get("word_meanings"), dict) else {}
    rows = word_meanings.get("rows") if isinstance(word_meanings.get("rows"), list) else []
    word_meanings = dict(word_meanings)
    word_meanings["version"] = str(word_meanings.get("version") or "1.0")
    word_meanings["rows"] = rows
    content_data["word_meanings"] = word_meanings
    preview_rows = content_data.get("word_meanings_rows") if isinstance(content_data.get("word_meanings_rows"), list) else []

    op_match = re.fullmatch(r"content_data\.word_meanings_rows\.(\d+)\.(delete|move_up|move_down)", field_path)
    add_match = re.fullmatch(r"content_data\.word_meanings_rows\.add", field_path)
    replace_all_match = re.fullmatch(r"content_data\.word_meanings_rows\.replace_all", field_path)
    field_match = re.fullmatch(r"content_data\.word_meanings_rows\.(\d+)\.resolved_(meaning|source)\.text", field_path)

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
        if operation == "delete" and 0 <= row_index < len(rows):
            rows.pop(row_index)
        elif operation == "move_up" and 0 < row_index < len(rows):
            rows[row_index - 1], rows[row_index] = rows[row_index], rows[row_index - 1]
        elif operation == "move_down" and 0 <= row_index < len(rows) - 1:
            rows[row_index], rows[row_index + 1] = rows[row_index + 1], rows[row_index]
    elif add_match:
        import time as _time

        rows.append(
            {
                "id": f"wm_quick_{int(_time.time() * 1000) % 10000000}_{len(rows) + 1}",
                "order": len(rows) + 1,
                "source": {"language": "sa", "script_text": "", "transliteration": {}},
                "meanings": {"en": {"text": ""}},
            }
        )
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

            preview_row = (
                preview_rows[row_index]
                if 0 <= row_index < len(preview_rows) and isinstance(preview_rows[row_index], dict)
                else {}
            )
            resolved_meaning = preview_row.get("resolved_meaning") if isinstance(preview_row.get("resolved_meaning"), dict) else {}
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
        _unsupported_single_field_patch()

    for index, row in enumerate(rows):
        if isinstance(row, dict):
            row["order"] = index + 1

    content_data["word_meanings_rows"] = _build_preview_word_meanings_rows(rows)


def _apply_content_data_field_patch(content_data: dict, field_path: str, next_value: object) -> dict:
    if field_path in {
        "content_data.basic.sanskrit",
        "content_data.basic.transliteration",
        "content_data.basic.translation",
    }:
        _set_basic_content_field(content_data, field_path, next_value)
        return content_data

    if field_path.startswith("content_data.translations."):
        _set_translation_content_field(content_data, field_path, next_value)
        return content_data

    if field_path.startswith("content_data.word_meanings_rows."):
        _apply_word_meanings_field_patch(content_data, field_path, next_value)
        return content_data

    if field_path.startswith("content_data.translation_variants.") or field_path.startswith(
        "content_data.commentary_variants."
    ):
        _apply_variant_field_patch(content_data, field_path, next_value)
        return content_data

    _unsupported_single_field_patch()
    return content_data


_WORD_MEANING_TOKEN_SEPARATOR_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^(.*?)\s+:\s*(.+)$"),
    re.compile(r"^(.*?)\s*=\s*(.+)$"),
    re.compile(r"^(.*?)\s*\?\s*(.+)$"),
    re.compile(r"^(.*?)\s+-\s*(.+)$"),
)


def _parse_word_meaning_token_entry(entry: str) -> tuple[str, str] | None:
    trimmed = str(entry or "").strip()
    if not trimmed:
        return None

    for pattern in _WORD_MEANING_TOKEN_SEPARATOR_PATTERNS:
        match = pattern.match(trimmed)
        if not match:
            continue
        source = match.group(1).strip()
        meaning = match.group(2).strip()
        if not source:
            return None
        return source, meaning

    return trimmed, ""


def _parse_word_meaning_tokens(token_text: str) -> list[tuple[str, str]]:
    entries = [segment.strip() for segment in re.split(r"[\n;]+", str(token_text or "")) if segment.strip()]
    parsed_entries: list[tuple[str, str]] = []
    for entry in entries:
        parsed = _parse_word_meaning_token_entry(entry)
        if not parsed:
            continue
        source_word, meaning_text = parsed
        if not source_word or not meaning_text:
            continue
        parsed_entries.append((source_word, meaning_text))
    return parsed_entries




def _ensure_can_contribute(current_user: User) -> None:
    if not _user_can_contribute(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _ensure_node_edit_access(db: Session, current_user: User, node: ContentNode) -> None:
    if user_can_edit_any(current_user):
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
                book_visibility(book) == BOOK_VISIBILITY_PUBLIC
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

    # Single recursive CTE — one query regardless of tree depth.
    # depth=1 is the input node; higher depth = closer to root.
    # ORDER BY depth DESC returns root-first so the join produces the correct path.
    rows = db.execute(
        text(
            """
            WITH RECURSIVE path AS (
                SELECT id, parent_node_id, sequence_number, 1 AS depth
                FROM content_nodes WHERE id = :node_id
                UNION ALL
                SELECT cn.id, cn.parent_node_id, cn.sequence_number, p.depth + 1
                FROM content_nodes cn
                JOIN path p ON cn.id = p.parent_node_id
                WHERE p.depth < 50
            )
            SELECT sequence_number FROM path ORDER BY depth DESC
            """
        ),
        {"node_id": node.id},
    ).fetchall()

    return ".".join(s for s in (_sequence_number_segment(r[0]) for r in rows) if s)


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
    metadata_out["visibility"] = book_visibility(book)

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
        merged_content_data = _merge_node_relational_variants(
            db,
            source,
            source.content_data if isinstance(source.content_data, dict) else {},
        )
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
                "content_data": merged_content_data,
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

    ensure_book_edit_access(db, current_user, book, detail="You do not have edit access to this book")

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
        not user_can_edit_any(current_user)
        and payload.referenced_node_id is None
        and (payload.source_attribution or payload.original_source_url)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only add existing content as references",
        )

    insert_after_node: ContentNode | None = None
    resolved_parent_node_id = payload.parent_node_id
    resolved_level_order = payload.level_order

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
        # Only adopt the insert-after node's level if it resolves to a known schema
        # level. If the schema was changed after nodes were created, the stored
        # level_name may be stale; in that case keep the payload's resolved level.
        if not schema_levels or insert_after_level_name in schema_levels:
            resolved_level_name = insert_after_level_name
        if insert_after_node.level_order is not None:
            resolved_level_order = insert_after_node.level_order

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
                ContentNode.sequence_number.op("~")("^[0-9]+$"),
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
                ContentNode.sequence_number.op("~")("^[0-9]+$"),
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
            ContentNode.sequence_number.op("~")("^[0-9]+$"),
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
        level_order=resolved_level_order,
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

    source_node = _resolve_effective_source_node(db, node)
    if source_node and source_node.id != node.id:
        payload = _node_response_payload(node)
        payload.update(
            {
                "content_data": _merge_node_relational_variants(db, source_node, source_node.content_data),
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
    payload_out["content_data"] = _merge_node_relational_variants(db, node, payload_out.get("content_data"))
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

    # Preview render artifacts are cached for performance. Any node update can
    # change rendered block content, so invalidate book-scoped preview cache.
    try:
        from api.draft_books import invalidate_preview_render_cache

        invalidate_preview_render_cache(node.book_id)
    except Exception:
        # Cache invalidation is best-effort and must not block persistence.
        pass

    db.refresh(node)
    if source_node is not None:
        db.refresh(source_node)
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": _merge_node_relational_variants(db, source_node, source_node.content_data),
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
    payload_out["content_data"] = _merge_node_relational_variants(db, node, payload_out.get("content_data"))
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


def _build_node_public_response(db: Session, node: ContentNode) -> "ContentNodePublic":
    """Return a ContentNodePublic with relational variants merged into content_data."""
    source_node = None
    if node.referenced_node_id:
        source_node = (
            db.query(ContentNode)
            .filter(ContentNode.id == node.referenced_node_id)
            .first()
        )
    node_book = db.query(Book).filter(Book.id == node.book_id).first()
    if source_node is not None:
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": _merge_node_relational_variants(db, source_node, source_node.content_data),
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
    payload_out["content_data"] = _merge_node_relational_variants(db, node, payload_out.get("content_data"))
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


_VARIANT_ADD_RE = re.compile(r"content_data\.(translation_variants|commentary_variants)\.add")
_VARIANT_DELETE_RE = re.compile(r"content_data\.(translation_variants|commentary_variants)\.(\d+)\.delete")
_VARIANT_FIELD_RE = re.compile(
    r"content_data\.(translation_variants|commentary_variants)\.(\d+)\.(text|author|language)"
)


def _handle_relational_variant_operation(
    db: Session,
    node: ContentNode,
    field_path: str,
    value: object,
) -> bool:
    """Try to handle variant operations against relational tables.

    Returns True if the operation was handled (caller should skip content_data patch).
    Returns False if no relational rows exist (caller should fall through to content_data patch).
    """
    add_m = _VARIANT_ADD_RE.fullmatch(field_path)
    delete_m = _VARIANT_DELETE_RE.fullmatch(field_path)
    field_m = _VARIANT_FIELD_RE.fullmatch(field_path)
    if not add_m and not delete_m and not field_m:
        return False

    content_target = node
    if node.referenced_node_id:
        src = db.query(ContentNode).filter(ContentNode.id == node.referenced_node_id).first()
        if src:
            content_target = src

    if add_m:
        variants_key = add_m.group(1)
        is_translation = variants_key == "translation_variants"
        payload_dict = value if isinstance(value, dict) else {}
        language_value = str(payload_dict.get("language") or "en").strip().lower() or "en"
        text_value = str(payload_dict.get("text") or "").strip()
        metadata_value = {
            "author": str(payload_dict.get("author") or "").strip(),
            "author_slug": str(payload_dict.get("author_slug") or "").strip().lower(),
            "field": str(payload_dict.get("field") or "").strip(),
        }
        # Check whether relational rows exist for this node
        if is_translation:
            has_relational = db.query(TranslationEntry).filter(
                TranslationEntry.node_id == content_target.id
            ).first() is not None
        else:
            has_relational = db.query(CommentaryEntry).filter(
                CommentaryEntry.node_id == content_target.id
            ).first() is not None
        if not has_relational:
            return False  # fall through to content_data path

        # Determine next display_order
        if is_translation:
            max_order_row = (
                db.query(TranslationEntry)
                .filter(TranslationEntry.node_id == content_target.id)
                .order_by(TranslationEntry.display_order.desc())
                .first()
            )
            next_order = (max_order_row.display_order + 1) if max_order_row else 0
            new_entry = TranslationEntry(
                node_id=content_target.id,
                content_text=text_value,
                language_code=language_value,
                display_order=next_order,
                metadata_json=metadata_value,
            )
        else:
            max_order_row = (
                db.query(CommentaryEntry)
                .filter(CommentaryEntry.node_id == content_target.id)
                .order_by(CommentaryEntry.display_order.desc())
                .first()
            )
            next_order = (max_order_row.display_order + 1) if max_order_row else 0
            new_entry = CommentaryEntry(
                node_id=content_target.id,
                content_text=text_value,
                language_code=language_value,
                display_order=next_order,
                metadata_json=metadata_value,
            )
        db.add(new_entry)
        db.commit()
        return True

    if field_m:
        variants_key = field_m.group(1)
        variant_index = int(field_m.group(2))
        variant_field = field_m.group(3)
        is_translation = variants_key == "translation_variants"
        if is_translation:
            rows = (
                db.query(TranslationEntry)
                .filter(TranslationEntry.node_id == content_target.id)
                .order_by(TranslationEntry.display_order.asc(), TranslationEntry.id.asc())
                .all()
            )
        else:
            rows = (
                db.query(CommentaryEntry)
                .filter(CommentaryEntry.node_id == content_target.id)
                .order_by(CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
                .all()
            )
        if not rows:
            return False  # no relational rows — fall through to content_data patch
        if variant_index < 0 or variant_index >= len(rows):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{variants_key} index out of bounds",
            )

        entry = rows[variant_index]
        if variant_field == "text":
            entry.content_text = str(value or "")
        elif variant_field == "language":
            entry.language_code = str(value or "").strip().lower()
        else:  # author
            metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
            metadata["author"] = str(value or "").strip()
            entry.metadata_json = metadata
        db.commit()
        return True

    # delete_m branch
    variants_key = delete_m.group(1)
    variant_index = int(delete_m.group(2))
    is_translation = variants_key == "translation_variants"
    if is_translation:
        rows = (
            db.query(TranslationEntry)
            .filter(TranslationEntry.node_id == content_target.id)
            .order_by(TranslationEntry.display_order.asc(), TranslationEntry.id.asc())
            .all()
        )
    else:
        rows = (
            db.query(CommentaryEntry)
            .filter(CommentaryEntry.node_id == content_target.id)
            .order_by(CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
            .all()
        )
    if not rows:
        return False  # no relational rows — fall through to content_data patch
    if variant_index < 0 or variant_index >= len(rows):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{variants_key} index out of bounds",
        )
    db.delete(rows[variant_index])
    db.commit()
    return True


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

    field_path = payload.field_path.strip()

    # Handle variant operations against relational tables when applicable.
    if (
        _VARIANT_ADD_RE.fullmatch(field_path)
        or _VARIANT_DELETE_RE.fullmatch(field_path)
        or _VARIANT_FIELD_RE.fullmatch(field_path)
    ):
        handled = _handle_relational_variant_operation(
            db, node, field_path, _normalize_content_field_patch_value(payload.value)
        )
        if handled:
            try:
                from api.draft_books import invalidate_preview_render_cache
                invalidate_preview_render_cache(node.book_id)
            except Exception:
                pass
            db.refresh(node)
            return _build_node_public_response(db, node)
        # fall through to content_data patch below

    patch_updates: dict[str, object] = {}

    if field_path in _NODE_SIMPLE_PATCH_FIELDS:
        next_value = _normalize_single_field_patch_value(payload.value)
        patch_updates[field_path] = next_value
    elif field_path.startswith("content_data."):
        next_value = _normalize_content_field_patch_value(payload.value)
        content_target = source_node if source_node is not None else node
        content_data = _clone_content_data(content_target.content_data)
        normalized_content_data = _validate_word_meanings_content_data(
            _apply_content_data_field_patch(content_data, field_path, next_value)
        )
        patch_updates["content_data"] = normalized_content_data
        patch_updates["has_content"] = bool(normalized_content_data)
    else:
        _unsupported_single_field_patch()

    if payload.edit_reason:
        patch_updates["edit_reason"] = payload.edit_reason

    return update_node(
        node_id=node_id,
        payload=ContentNodeUpdate(**patch_updates),
        db=db,
        current_user=current_user,
    )


@router.patch("/books/{book_id}/field", response_model=BookPublic)
def update_book_single_field(
    book_id: int,
    payload: ContentNodeFieldPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookPublic:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ensure_book_edit_access(db, current_user, book, detail="You do not have edit access to this book")

    field_path = payload.field_path.strip()

    metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    next_metadata = dict(metadata)
    book_node_payload = _book_node_payload_from_metadata(next_metadata)

    if field_path in _BOOK_SIMPLE_PATCH_FIELDS:
        next_value = _normalize_single_field_patch_value(payload.value)
        book_node_payload[field_path] = next_value
    elif field_path.startswith("content_data."):
        next_value = _normalize_content_field_patch_value(payload.value)
        content_data = _clone_content_data(book_node_payload.get("content_data"))
        normalized_content_data = _validate_word_meanings_content_data(
            _apply_content_data_field_patch(content_data, field_path, next_value)
        )
        book_node_payload["content_data"] = normalized_content_data
        book_node_payload["has_content"] = bool(normalized_content_data)
    else:
        _unsupported_single_field_patch()

    _write_book_node_payload_into_metadata(next_metadata, book_node_payload)
    book.metadata_json = next_metadata
    flag_modified(book, "metadata_json")

    db.commit()
    db.refresh(book)
    return _book_public_model(book)


@router.post("/nodes/{node_id}/repair-level", response_model=ContentNodePublic)
def repair_node_level(
    node_id: int,
    payload: NodeLevelRepairPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    if not user_can_edit_any(current_user):
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


@router.patch("/nodes/{node_id}/word-meanings", response_model=ContentNodePublic)
def update_node_word_meanings_tokens(
    node_id: int,
    payload: ContentNodeWordMeaningsTokenPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    _ensure_can_contribute(current_user)

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

    target_node = source_node if source_node is not None else node
    language_code = payload.language_code.strip().lower()
    parsed_tokens = _parse_word_meaning_tokens(payload.tokens)

    submitted_rows: list[tuple[int, str, str]] = []
    if payload.entries:
        normalized_entries = sorted(payload.entries, key=lambda entry: entry.word_order)
        for entry in normalized_entries:
            entry_language = (entry.language_code or language_code).strip().lower()
            if entry_language != language_code:
                continue
            source_word = str(entry.source_word or "").strip()
            meaning_text = str(entry.meaning_text or "").strip()
            if not source_word or not meaning_text:
                continue
            submitted_rows.append((entry.word_order, source_word, meaning_text))
    else:
        submitted_rows = [
            (index, source_word, meaning_text)
            for index, (source_word, meaning_text) in enumerate(parsed_tokens, start=1)
        ]

    logger.info(
        "W2W save payload: %s",
        {
            "node_id": node_id,
            "target_node_id": target_node.id,
            "language_code": language_code,
            "token_count": len(parsed_tokens),
            "submitted_row_count": len(submitted_rows),
            "submitted_rows": [
                {
                    "word_order": word_order,
                    "source_word": source_word,
                    "meaning_text": meaning_text,
                }
                for word_order, source_word, meaning_text in submitted_rows
            ],
        },
    )

    existing_entries = (
        db.query(WordMeaningEntry)
        .filter(WordMeaningEntry.node_id == target_node.id)
        .order_by(
            WordMeaningEntry.word_order.asc(),
            WordMeaningEntry.display_order.asc(),
            WordMeaningEntry.id.asc(),
        )
        .all()
    )

    existing_language_entry = next(
        (entry for entry in existing_entries if str(entry.language_code or "").strip().lower() == language_code),
        None,
    )
    fallback_entry = existing_language_entry or (existing_entries[0] if existing_entries else None)
    author_id = fallback_entry.author_id if fallback_entry is not None else None
    work_id = fallback_entry.work_id if fallback_entry is not None else None

    version_target = target_node
    version_history = version_target.version_history or []
    version_history.append(
        {
            "edited_by": current_user.id,
            "edited_at": datetime.utcnow().isoformat(),
            "reason": payload.edit_reason or f"Word meanings token edit ({language_code})",
            "changes": {
                "word_meanings": {
                    "language_code": language_code,
                    "token_count": len(submitted_rows),
                }
            },
        }
    )
    version_target.version_history = version_history

    # Build lookup dict from already-fetched existing_entries — eliminates per-word queries in the loop.
    # Keyed by word_order; only entries matching (language_code, author_id) for this batch.
    existing_by_word_order: dict[int, WordMeaningEntry] = {}
    for _e in existing_entries:
        if str(_e.language_code or "").strip().lower() != language_code:
            continue
        _author_match = (
            (author_id is None and _e.author_id is None)
            or (author_id is not None and _e.author_id == author_id)
        )
        if _author_match and _e.word_order not in existing_by_word_order:
            existing_by_word_order[_e.word_order] = _e

    submitted_orders = {word_order for word_order, _, _ in submitted_rows}
    if submitted_orders:
        db.query(WordMeaningEntry).filter(
            WordMeaningEntry.node_id == target_node.id,
            func.lower(WordMeaningEntry.language_code) == language_code,
            ~WordMeaningEntry.word_order.in_(submitted_orders),
        ).delete(synchronize_session=False)
    else:
        db.query(WordMeaningEntry).filter(
            WordMeaningEntry.node_id == target_node.id,
            func.lower(WordMeaningEntry.language_code) == language_code,
        ).delete(synchronize_session=False)

    for word_order, source_word, meaning_text in submitted_rows:
        transliteration = source_word
        existing_target_row = existing_by_word_order.get(word_order)
        if existing_target_row is not None:
            existing_target_row.source_word = source_word
            existing_target_row.transliteration = transliteration
            existing_target_row.meaning_text = meaning_text
            existing_target_row.display_order = word_order - 1
            existing_target_row.work_id = work_id
            existing_target_row.metadata_json = {
                "edited_via": "token_patch",
                "edited_by": current_user.id,
            }
        else:
            db.add(
                WordMeaningEntry(
                    node_id=target_node.id,
                    author_id=author_id,
                    work_id=work_id,
                    source_word=source_word,
                    transliteration=transliteration,
                    word_order=word_order,
                    language_code=language_code,
                    meaning_text=meaning_text,
                    display_order=word_order - 1,
                    metadata_json={
                        "edited_via": "token_patch",
                        "edited_by": current_user.id,
                    },
                )
            )

    # Sync source_word/transliteration across ALL language entries for submitted word_orders.
    # Uses the already-loaded existing_entries — zero extra queries inside this block.
    if submitted_rows:
        sync_map = {wo: sw for wo, sw, _ in submitted_rows}
        for _e in existing_entries:
            if _e.word_order in sync_map:
                _e.source_word = sync_map[_e.word_order]
                _e.transliteration = sync_map[_e.word_order]

    node.last_modified_by = current_user.id
    if source_node is not None:
        source_node.last_modified_by = current_user.id

    db.commit()

    try:
        from api.draft_books import invalidate_preview_render_cache

        invalidate_preview_render_cache(node.book_id)
    except Exception:
        pass

    db.refresh(node)
    if source_node is not None:
        db.refresh(source_node)
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": _merge_node_relational_variants(db, source_node, source_node.content_data),
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
    payload_out["content_data"] = _merge_node_relational_variants(db, node, payload_out.get("content_data"))
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


@router.patch("/nodes/{node_id}/translation", response_model=ContentNodePublic)
def update_node_translation_variant(
    node_id: int,
    payload: ContentNodeTranslationPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    _ensure_can_contribute(current_user)

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

    target_node = source_node if source_node is not None else node
    language_code = payload.language_code.strip().lower()
    author_slug = _normalize_variant_author_slug(payload.author_slug)
    author_name = _variant_author_name_for_slug(node_book, author_slug)
    text_value = str(payload.text or "")

    rows = (
        db.query(TranslationEntry, TranslationAuthor)
        .outerjoin(TranslationAuthor, TranslationEntry.author_id == TranslationAuthor.id)
        .filter(
            TranslationEntry.node_id == target_node.id,
            func.lower(TranslationEntry.language_code) == language_code,
        )
        .order_by(TranslationEntry.display_order.asc(), TranslationEntry.id.asc())
        .all()
    )

    existing_entry: TranslationEntry | None = None
    for entry, author in rows:
        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        resolved_author_name = str(author.name or "").strip() if author is not None else ""
        if _variant_entry_matches_author_slug(author_slug, metadata, resolved_author_name):
            existing_entry = entry
            break

    author = (
        db.query(TranslationAuthor)
        .filter(func.lower(TranslationAuthor.name) == author_name.lower())
        .first()
        if author_name
        else None
    )
    if author is None:
        author = TranslationAuthor(
            name=author_name or author_slug,
            metadata_json={"author_slug": author_slug},
        )
        db.add(author)
        db.flush()

    work_title = f"{author.name} Translation"
    work = (
        db.query(TranslationWork)
        .filter(
            TranslationWork.author_id == author.id,
            func.lower(TranslationWork.title) == work_title.lower(),
        )
        .first()
    )
    if work is None:
        work = TranslationWork(
            author_id=author.id,
            title=work_title,
            metadata_json={
                "author_slug": author_slug,
                "language_code": language_code,
                "source": "preview_patch",
            },
        )
        db.add(work)
        db.flush()

    if existing_entry is not None:
        metadata = dict(existing_entry.metadata_json) if isinstance(existing_entry.metadata_json, dict) else {}
        metadata.update(
            {
                "author_slug": author_slug,
                "author": author.name,
                "author_name": author.name,
                "field": "translation",
                "language": language_code,
                "edited_via": "preview_patch",
                "edited_by": current_user.id,
            }
        )
        existing_entry.content_text = text_value
        existing_entry.language_code = language_code
        existing_entry.author_id = author.id
        existing_entry.work_id = work.id
        existing_entry.metadata_json = metadata
    else:
        max_order = (
            db.query(func.max(TranslationEntry.display_order))
            .filter(TranslationEntry.node_id == target_node.id)
            .scalar()
        )
        next_order = int(max_order or -1) + 1
        db.add(
            TranslationEntry(
                node_id=target_node.id,
                author_id=author.id,
                work_id=work.id,
                content_text=text_value,
                language_code=language_code,
                display_order=next_order,
                metadata_json={
                    "author_slug": author_slug,
                    "author": author.name,
                    "author_name": author.name,
                    "field": "translation",
                    "language": language_code,
                    "edited_via": "preview_patch",
                    "edited_by": current_user.id,
                },
            )
        )

    version_target = target_node
    version_history = version_target.version_history or []
    version_history.append(
        {
            "edited_by": current_user.id,
            "edited_at": datetime.utcnow().isoformat(),
            "reason": payload.edit_reason or f"Translation variant edit ({language_code}/{author_slug})",
            "changes": {
                "translation_variant": {
                    "language_code": language_code,
                    "author_slug": author_slug,
                }
            },
        }
    )
    version_target.version_history = version_history

    node.last_modified_by = current_user.id
    if source_node is not None:
        source_node.last_modified_by = current_user.id

    db.commit()

    try:
        from api.draft_books import invalidate_preview_render_cache

        invalidate_preview_render_cache(node.book_id)
    except Exception:
        pass

    db.refresh(node)
    if source_node is not None:
        db.refresh(source_node)
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": _merge_node_relational_variants(db, source_node, source_node.content_data),
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
    payload_out["content_data"] = _merge_node_relational_variants(db, node, payload_out.get("content_data"))
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
    return ContentNodePublic.model_validate(payload_out)


@router.patch("/nodes/{node_id}/commentary", response_model=ContentNodePublic)
def update_node_commentary_variant(
    node_id: int,
    payload: ContentNodeCommentaryPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ContentNodePublic:
    _ensure_can_contribute(current_user)

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

    target_node = source_node if source_node is not None else node
    language_code = payload.language_code.strip().lower()
    author_slug = _normalize_variant_author_slug(payload.author_slug)
    author_name = _variant_author_name_for_slug(node_book, author_slug)
    text_value = str(payload.text or "")

    rows = (
        db.query(CommentaryEntry, CommentaryAuthor)
        .outerjoin(CommentaryAuthor, CommentaryEntry.author_id == CommentaryAuthor.id)
        .filter(
            CommentaryEntry.node_id == target_node.id,
            func.lower(CommentaryEntry.language_code) == language_code,
        )
        .order_by(CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
        .all()
    )

    existing_entry: CommentaryEntry | None = None
    for entry, author in rows:
        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        resolved_author_name = str(author.name or "").strip() if author is not None else ""
        if _variant_entry_matches_author_slug(author_slug, metadata, resolved_author_name):
            existing_entry = entry
            break

    author = (
        db.query(CommentaryAuthor)
        .filter(func.lower(CommentaryAuthor.name) == author_name.lower())
        .first()
        if author_name
        else None
    )
    if author is None:
        author = CommentaryAuthor(
            name=author_name or author_slug,
            metadata_json={"author_slug": author_slug},
            created_by=current_user.id,
        )
        db.add(author)
        db.flush()

    work_title = f"{author.name} Commentary"
    work = (
        db.query(CommentaryWork)
        .filter(
            CommentaryWork.author_id == author.id,
            func.lower(CommentaryWork.title) == work_title.lower(),
        )
        .first()
    )
    if work is None:
        work = CommentaryWork(
            author_id=author.id,
            title=work_title,
            metadata_json={
                "author_slug": author_slug,
                "language_code": language_code,
                "source": "preview_patch",
            },
            created_by=current_user.id,
        )
        db.add(work)
        db.flush()

    if existing_entry is not None:
        metadata = dict(existing_entry.metadata_json) if isinstance(existing_entry.metadata_json, dict) else {}
        metadata.update(
            {
                "author_slug": author_slug,
                "author": author.name,
                "author_name": author.name,
                "field": "ec",
                "language": language_code,
                "edited_via": "preview_patch",
                "edited_by": current_user.id,
            }
        )
        existing_entry.content_text = text_value
        existing_entry.language_code = language_code
        existing_entry.author_id = author.id
        existing_entry.work_id = work.id
        existing_entry.metadata_json = metadata
        existing_entry.last_modified_by = current_user.id
    else:
        max_order = (
            db.query(func.max(CommentaryEntry.display_order))
            .filter(CommentaryEntry.node_id == target_node.id)
            .scalar()
        )
        next_order = int(max_order or -1) + 1
        db.add(
            CommentaryEntry(
                node_id=target_node.id,
                author_id=author.id,
                work_id=work.id,
                content_text=text_value,
                language_code=language_code,
                display_order=next_order,
                metadata_json={
                    "author_slug": author_slug,
                    "author": author.name,
                    "author_name": author.name,
                    "field": "ec",
                    "language": language_code,
                    "edited_via": "preview_patch",
                    "edited_by": current_user.id,
                },
                created_by=current_user.id,
                last_modified_by=current_user.id,
            )
        )

    version_target = target_node
    version_history = version_target.version_history or []
    version_history.append(
        {
            "edited_by": current_user.id,
            "edited_at": datetime.utcnow().isoformat(),
            "reason": payload.edit_reason or f"Commentary variant edit ({language_code}/{author_slug})",
            "changes": {
                "commentary_variant": {
                    "language_code": language_code,
                    "author_slug": author_slug,
                }
            },
        }
    )
    version_target.version_history = version_history

    node.last_modified_by = current_user.id
    if source_node is not None:
        source_node.last_modified_by = current_user.id

    db.commit()

    try:
        from api.draft_books import invalidate_preview_render_cache

        invalidate_preview_render_cache(node.book_id)
    except Exception:
        pass

    db.refresh(node)
    if source_node is not None:
        db.refresh(source_node)
        response_payload = ContentNodePublic.model_validate(node).model_dump()
        response_payload.update(
            {
                "content_data": _merge_node_relational_variants(db, source_node, source_node.content_data),
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
    payload_out["content_data"] = _merge_node_relational_variants(db, node, payload_out.get("content_data"))
    payload_out["level_name"] = _display_level_name_for_book(node_book, payload_out.get("level_name"))
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

    if payload.sibling_ids is not None:
        requested_ids = [int(sibling_id) for sibling_id in payload.sibling_ids]
        expected_ids = [sibling.id for sibling in ordered_siblings]
        if len(requested_ids) != len(expected_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="sibling_ids must include all siblings exactly once",
            )
        if len(set(requested_ids)) != len(requested_ids) or set(requested_ids) != set(expected_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="sibling_ids must match the current sibling set",
            )
        sibling_by_id = {sibling.id: sibling for sibling in ordered_siblings}
        reordered_siblings = [sibling_by_id[sibling_id] for sibling_id in requested_ids]
        target_index = requested_ids.index(node_id)
    else:
        if payload.direction not in {"up", "down"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide either direction or sibling_ids",
            )

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
                ContentNode.sequence_number.op("~")("^[0-9]+$"),
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
    ensure_book_edit_access(db, current_user, target_book, detail="You do not have edit access to this book")

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

    # Bulk fetch all source nodes in one query — eliminates N per-node lookups.
    source_nodes_by_id: dict[int, ContentNode] = {
        n.id: n
        for n in db.query(ContentNode).filter(ContentNode.id.in_(node_ids)).all()
    }

    # Fetch current max sequence once — eliminates N per-node max queries.
    base_seq = (
        db.query(func.max(ContentNode.sequence_number))
        .filter(
            ContentNode.book_id == book_id,
            ContentNode.parent_node_id == parent_node_id,
        )
        .scalar()
    )
    next_seq = (int(base_seq) if base_seq else 0) + 1

    # Build all ref_nodes first (no per-node flush needed yet).
    pending: list[tuple[ContentNode, ContentNode, str]] = []  # (ref_node, source_node, section)
    for node_id in node_ids:
        source_node = source_nodes_by_id.get(node_id)
        if not source_node:
            continue

        assigned_section = section_assignments.get(str(node_id), "body").strip().lower()
        if assigned_section not in {"front", "body", "back"}:
            assigned_section = "body"

        ref_node = ContentNode(
            book_id=book_id,
            parent_node_id=parent_node_id,
            referenced_node_id=source_node.id,
            level_name=source_node.level_name,
            level_order=parent_level_order + 1,
            sequence_number=next_seq,
            title_sanskrit=source_node.title_sanskrit,
            title_transliteration=source_node.title_transliteration,
            title_english=source_node.title_english,
            title_hindi=source_node.title_hindi,
            title_tamil=source_node.title_tamil,
            has_content=False,
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
        pending.append((ref_node, source_node, assigned_section))
        next_seq += 1

    # Single flush to assign IDs for all ref_nodes at once.
    db.flush()

    # Now add provenance records (ref_node.id is available after the flush).
    created_refs = []
    for ref_node, source_node, assigned_section in pending:
        db.add(
            ProvenanceRecord(
                target_book_id=book_id,
                target_node_id=ref_node.id,
                source_book_id=source_node.book_id,
                source_node_id=source_node.id,
                source_type="library_reference",
                source_author=source_node.source_attribution,
                license_type=source_node.license_type or "CC-BY-SA-4.0",
                source_version=(
                    source_node.updated_at.isoformat()
                    if getattr(source_node, "updated_at", None)
                    else "unknown"
                ),
                inserted_by=current_user.id,
                draft_section=assigned_section,
            )
        )
        created_refs.append(ref_node.id)

    db.commit()

    return {
        "message": f"Created {len(created_refs)} reference(s)",
        "created_ids": created_refs,
    }

