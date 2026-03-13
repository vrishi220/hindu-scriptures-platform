import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import Integer, cast
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import func

from api.import_parser import ExtractionRules, GenericHTMLImporter, ImportConfig
from api.pdf_importer import PDFImporter, PDFImportConfig
from api.json_importer import JSONImporter, JSONImportConfig
from api.users import get_current_user, get_current_user_optional, require_permission
from models.book import Book
from models.book_share import BookShare
from models.content_node import ContentNode
from models.commentary_author import CommentaryAuthor
from models.commentary_work import CommentaryWork
from models.commentary_entry import CommentaryEntry
from models.node_comment import NodeComment
from models.media_file import MediaFile
from models.media_asset import MediaAsset
from models.provenance_record import ProvenanceRecord
from models.schemas import (
    BookExchangePayloadV1,
    BookCreate,
    BookPublic,
    BookShareCreate,
    BookSharePublic,
    BookShareUpdate,
    BookUpdate,
    ContentNodeCreate,
    ContentNodePublic,
    ContentNodeTree,
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

PUBLIC_READS_ENABLED = os.getenv("PUBLIC_READS_ENABLED", "false").lower() == "true"
MEDIA_STORAGE = get_media_storage_from_env()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_MEDIA_TYPES = {"audio", "video", "image", "link"}


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


# Import request/response schemas
class ImportResponse(BaseModel):
    """Response from import operation."""
    success: bool
    book_id: int | None = None
    nodes_created: int = 0
    warnings: list[str] = []
    error: str | None = None


class InsertReferencesPayload(BaseModel):
    parent_node_id: int | None = None
    node_ids: list[int]
    section_assignments: dict[str, str] | None = None


class LicensePolicyCheckPayload(BaseModel):
    node_ids: list[int]


class NodeMediaReorderPayload(BaseModel):
    media_type: str
    media_ids: list[int]


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
        "status": metadata_out["status"],
        "visibility": metadata_out["visibility"],
        "schema": book.schema,
    }
    return BookPublic.model_validate(payload)


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
        }
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
    return next_content_data


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
    books = db.query(Book).all()
    visible_books = [book for book in books if _book_is_visible_to_user(db, book, current_user)]

    query_text = (q or "").strip()
    if query_text:
        ranked_books = []
        for book in visible_books:
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

    visible_books.sort(
        key=lambda book: (
            -(book.created_at.timestamp() if book.created_at else 0),
            -book.id,
        )
    )
    page = visible_books[offset : offset + limit]
    return [_book_public_model(item) for item in page]


@router.post("/books", response_model=BookPublic, status_code=status.HTTP_201_CREATED)
def create_book(
    payload: BookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BookPublic:
    _ensure_can_contribute(current_user)

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

    metadata_json = payload.metadata or {}
    if not isinstance(metadata_json, dict):
        metadata_json = {}
    metadata_json["owner_id"] = current_user.id
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
    metadata = book.metadata_json or {}
    if not isinstance(metadata, dict):
        metadata = {}

    for key, value in updates.items():
        if key == "metadata":
            metadata = dict(value) if isinstance(value, dict) else {}
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

    shared_user = db.query(User).filter(User.email == payload.email).first()
    if not shared_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

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

    db.commit()
    db.refresh(share)
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
    """
    try:
        from datetime import date
        
        # Get all verses with content from books visible to the current user.
        # Anonymous users only see public books.
        visible_book_ids = [
            book.id
            for book in db.query(Book).all()
            if (
                _book_visibility(book) == BOOK_VISIBILITY_PUBLIC
                if current_user is None
                else _book_is_visible_to_user(db, book, current_user)
            )
        ]
        if not visible_book_ids:
            return None

        verses_query = db.query(ContentNode).filter(
            ContentNode.has_content == True,
            ContentNode.book_id.in_(visible_book_ids),
        )
        
        if mode == "daily":
            # Use current date as seed for consistent daily verse
            today = date.today()
            seed = today.year * 10000 + today.month * 100 + today.day
            
            # Get total count
            total_verses = verses_query.count()
            if total_verses == 0:
                return None
            
            # Use seed to select a consistent verse for the day
            offset = seed % total_verses
            verse = verses_query.offset(offset).first()
        else:
            # Truly random verse
            verse = verses_query.order_by(func.random()).first()
        
        if not verse:
            return None
        
        book = db.query(Book).filter(Book.id == verse.book_id).first()
        
        # Extract content from content_data JSONB - handle nested structure
        content_text = ""
        sanskrit_text = ""
        transliteration_text = ""
        
        if verse.content_data and isinstance(verse.content_data, dict):
            # Try nested structure first (basic.sanskrit, translations.english, etc.)
            if "translations" in verse.content_data and isinstance(verse.content_data["translations"], dict):
                content_text = verse.content_data["translations"].get("english", "")
            
            if "basic" in verse.content_data and isinstance(verse.content_data["basic"], dict):
                basic = verse.content_data["basic"]
                if not content_text:
                    content_text = basic.get("translation", "")
                sanskrit_text = basic.get("sanskrit", "")
                transliteration_text = basic.get("transliteration", "")
            
            # Fallback to top-level fields
            if not content_text:
                content_text = (
                    verse.content_data.get("text_english") or
                    verse.content_data.get("text") or
                    verse.content_data.get("content") or
                    verse.content_data.get("english") or
                    verse.content_data.get("translation") or
                    ""
                )
        
        # Skip verses with placeholder content
        if content_text and ("placeholder" in content_text.lower() or "chapter" in content_text.lower() and "verse" in content_text.lower() and len(content_text) < 100):
            # Try to find another verse in random mode
            if mode == "random":
                # Recursively try to get another verse, with a limit
                attempts = 0
                while attempts < 10:
                    verse = verses_query.order_by(func.random()).first()
                    if verse:
                        content_text = ""
                        if verse.content_data and isinstance(verse.content_data, dict):
                            if "translations" in verse.content_data and isinstance(verse.content_data["translations"], dict):
                                content_text = verse.content_data["translations"].get("english", "")
                            if not content_text and "basic" in verse.content_data and isinstance(verse.content_data["basic"], dict):
                                basic = verse.content_data["basic"]
                                content_text = basic.get("translation", "")
                                sanskrit_text = basic.get("sanskrit", "")
                                transliteration_text = basic.get("transliteration", "")
                        
                        # Check if this verse has valid content
                        if content_text and not ("placeholder" in content_text.lower() and len(content_text) < 100):
                            book = db.query(Book).filter(Book.id == verse.book_id).first()
                            break
                    attempts += 1
        
        # If still no valid content, use sanskrit or transliteration as fallback
        if not content_text or len(content_text.strip()) < 5:
            content_text = sanskrit_text or transliteration_text or "Content not available"
        
        return {
            "id": verse.id,
            "title": verse.title_english or verse.title_transliteration or verse.title_sanskrit or f"{verse.level_name} {verse.sequence_number or verse.id}",
            "content": content_text,
            "book_name": book.book_name if book else "Scripture",
            "book_id": book.id if book else None,
            "node_id": verse.id,
        }
    except Exception as e:
        print(f"Error in get_daily_verse: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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
        import_type = payload.get("import_type", "html")
        
        if import_type == "html":
            return _import_html(payload, db, current_user)
        elif import_type == "pdf":
            return _import_pdf(payload, db, current_user)
        elif import_type == "json":
            return _import_json(payload, db, current_user)
        else:
            return ImportResponse(
                success=False,
                error=f"Unknown import_type: {import_type}"
            )
        
    except Exception as e:
        db.rollback()
        return ImportResponse(
            success=False,
            error=f"Import failed: {str(e)}"
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
) -> ImportResponse:
    """Import from JSON/API source."""
    schema_version = payload.get("schema_version")
    if isinstance(schema_version, str) and schema_version.strip() == "hsp-book-json-v1":
        return _import_canonical_json_v1(payload, db, current_user)

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
        return ImportResponse(
            success=False,
            book_id=book.id if book.id else None,
            warnings=warnings,
            error="Failed to import JSON content"
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


def _import_canonical_json_v1(
    payload: dict,
    db: Session,
    current_user: User,
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

    book_code = canonical.book.book_code or _default_book_code_from_name(canonical.book.book_name)
    warnings: list[str] = []
    book = db.query(Book).filter(Book.book_code == book_code).first()
    if book:
        warnings.append(f"Book already exists: {book.book_name}")
    else:
        metadata = canonical.book.metadata if isinstance(canonical.book.metadata, dict) else {}
        metadata_out = dict(metadata)
        metadata_out.setdefault("status", BOOK_STATUS_DRAFT)
        metadata_out.setdefault("visibility", BOOK_VISIBILITY_PRIVATE)

        book = Book(
            schema_id=schema.id,
            book_name=canonical.book.book_name,
            book_code=book_code,
            language_primary=canonical.book.language_primary,
            metadata_json=metadata_out,
        )
        db.add(book)
        db.flush()

    level_lookup = {level: idx for idx, level in enumerate(schema.levels or [])}
    old_to_new_node_ids: dict[int, int] = {}
    pending_nodes = list(canonical.nodes)
    nodes_created = 0

    while pending_nodes:
        progress_made = False
        still_pending: list = []

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
            source_attribution = None
            original_source_url = None
            if isinstance(node.metadata_json, dict):
                source_attribution = node.metadata_json.get("source_attribution")
                original_source_url = node.metadata_json.get("original_source_url")

            content_node = ContentNode(
                book_id=book.id,
                parent_node_id=old_to_new_node_ids.get(parent_id) if isinstance(parent_id, int) else None,
                referenced_node_id=resolved_reference_id,
                level_name=node.level_name,
                level_order=resolved_level_order,
                sequence_number=node.sequence_number,
                title_sanskrit=node.title_sanskrit,
                title_transliteration=node.title_transliteration,
                title_english=node.title_english,
                title_hindi=node.title_hindi,
                title_tamil=node.title_tamil,
                has_content=bool(node.has_content),
                content_data=node.content_data if isinstance(node.content_data, dict) else {},
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
    level_lookup = {level: idx for idx, level in enumerate(schema.levels)}
    
    def insert_nodes(nodes: list, parent_id: int | None = None):
        nonlocal nodes_created
        for node_data in nodes:
            try:
                level_name = node_data.get("level_name", "")
                level_order = level_lookup.get(level_name, 0)
                
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
    query = db.query(ContentNode)
    
    # Search filter
    if q:
        search_term = f"%{q}%"
        query = query.filter(
            (ContentNode.title_english.ilike(search_term)) |
            (ContentNode.title_sanskrit.ilike(search_term)) |
            (ContentNode.title_transliteration.ilike(search_term)) |
            (ContentNode.content_data.cast(str).ilike(search_term))
        )
    
    # Book filter
    if book_id:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        _ensure_book_view_access(db, book, current_user)
        query = query.filter(ContentNode.book_id == book_id)
    else:
        visible_book_ids = [
            book.id
            for book in db.query(Book).all()
            if _book_is_visible_to_user(db, book, current_user)
        ]
        if not visible_book_ids:
            return []
        query = query.filter(ContentNode.book_id.in_(visible_book_ids))
    
    nodes = query.order_by(ContentNode.id).limit(limit).all()
    return [ContentNodePublic.model_validate(item) for item in nodes]


@router.get("/books/{book_id}/tree", response_model=list[ContentNodePublic])
def list_book_tree(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> list[ContentNodePublic]:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, book, current_user)

    nodes = (
        db.query(ContentNode)
        .filter(ContentNode.book_id == book_id)
        .order_by(ContentNode.level_order)
        .all()
    )
    
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
    
    return [ContentNodePublic.model_validate(item) for item in nodes]


def _node_sequence_sort_key(node: ContentNode):
    sequence = node.sequence_number
    if not sequence:
        return (float("inf"),)
    try:
        return tuple(int(part) for part in sequence.split("."))
    except (ValueError, AttributeError):
        return (float("inf"), str(sequence))


@router.get("/books/{book_id}/export/json", response_model=BookExchangePayloadV1)
def export_book_json(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(require_view_permission),
) -> BookExchangePayloadV1:
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _ensure_book_view_access(db, book, current_user)

    nodes = (
        db.query(ContentNode)
        .filter(ContentNode.book_id == book_id)
        .order_by(ContentNode.level_order)
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

    book_metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    metadata_out = dict(book_metadata)
    metadata_out["status"] = _book_status(book)
    metadata_out["visibility"] = _book_visibility(book)

    exported_nodes: list[dict] = []
    for node in nodes:
        exported_nodes.append(
            {
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
                "content_data": node.content_data,
                "summary_data": node.summary_data,
                "metadata_json": node.metadata_json,
                "source_attribution": node.source_attribution,
                "license_type": node.license_type,
                "original_source_url": node.original_source_url,
                "tags": node.tags,
                "media_items": media_by_node_id.get(node.id, []),
            }
        )

    return BookExchangePayloadV1(
        schema_={
            "id": book.schema.id if book.schema else None,
            "name": book.schema.name if book.schema else None,
            "description": book.schema.description if book.schema else None,
            "levels": book.schema.levels if book.schema and isinstance(book.schema.levels, list) else [],
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
        .filter(ContentNode.book_id == book_id)
        .order_by(ContentNode.level_order)
        .all()
    )
    
    # Natural sort function for sequence numbers like "1", "10", "1.34", "2.5"
    def natural_sort_key(node):
        seq = node.sequence_number
        if not seq:
            return (float('inf'),)  # Put nulls at the end
        
        # Split by dots and convert each part to integer for proper sorting
        try:
            parts = seq.split('.')
            return tuple(int(p) for p in parts)
        except (ValueError, AttributeError):
            # Fallback to string sorting if conversion fails
            return (float('inf'), str(seq))
    
    # Sort nodes by natural order within each level
    nodes = sorted(nodes, key=lambda n: (n.level_order, natural_sort_key(n)))
    
    node_map: dict[int, ContentNodeTree] = {}
    roots: list[ContentNodeTree] = []
    node_lookup = {n.id: n for n in nodes}

    for node in nodes:
        tree_node = ContentNodeTree.model_validate(node)
        tree_node.children = []
        node_map[node.id] = tree_node

    for node in nodes:
        tree_node = node_map[node.id]
        if node.parent_node_id and node.parent_node_id in node_map:
            # Check for cycles by tracing up max 100 levels
            current = node.parent_node_id
            path_set = {node.id}  # Track visited ids in this path
            cycle_detected = False
            for _ in range(100):
                if current is None:
                    break
                if current in path_set:
                    cycle_detected = True
                    break
                path_set.add(current)
                parent = node_lookup.get(current)
                current = parent.parent_node_id if parent else None
            
            # Only add child if no cycle detected
            if not cycle_detected:
                node_map[node.parent_node_id].children.append(tree_node)
            else:
                roots.append(tree_node)
        else:
            roots.append(tree_node)

    return roots


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

        if insert_after_node.level_name != payload.level_name:
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
        schema_levels = book.schema.levels if isinstance(book.schema.levels, list) else []
        
        if schema_levels:
            # Check if level_name is valid in the schema
            if payload.level_name not in schema_levels:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid level '{payload.level_name}'. Valid levels: {', '.join(schema_levels)}"
                )

            # Get the index of this level in the schema
            level_index = schema_levels.index(payload.level_name)
            leaf_level = schema_levels[-1]

            # Content nodes (with content) can only be at leaf level
            if payload.has_content and payload.level_name != leaf_level:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Content items can only be placed at the '{leaf_level}' level"
                )

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
                        if payload.level_name != expected_child_level:
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
    _ensure_word_meanings_level_is_enabled(book, payload.level_name, content_data)

    node = ContentNode(
        book_id=payload.book_id,
        parent_node_id=resolved_parent_node_id,
        referenced_node_id=payload.referenced_node_id,
        level_name=payload.level_name,
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
    return ContentNodePublic.model_validate(node)


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
            payload = ContentNodePublic.model_validate(node).model_dump()
            payload.update(
                {
                    "content_data": source_node.content_data,
                    "summary_data": source_node.summary_data,
                    "has_content": source_node.has_content,
                    "source_attribution": source_node.source_attribution,
                    "license_type": source_node.license_type,
                    "original_source_url": source_node.original_source_url,
                }
            )
            return ContentNodePublic.model_validate(payload)
    return ContentNodePublic.model_validate(node)


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

    if "title_sanskrit" in updates or "title_transliteration" in updates:
        next_title_sanskrit, next_title_transliteration = _autofill_sanskrit_transliteration_pair(
            updates.get("title_sanskrit", node.title_sanskrit),
            updates.get("title_transliteration", node.title_transliteration),
        )
        updates["title_sanskrit"] = next_title_sanskrit
        updates["title_transliteration"] = next_title_transliteration

    if "content_data" in updates:
        updates["content_data"] = _autofill_content_data_pair(updates.get("content_data"))

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
        return ContentNodePublic.model_validate(response_payload)

    return ContentNodePublic.model_validate(node)


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

    filename = f"{uuid4().hex}{suffix}"
    relative_path = Path("bank") / filename
    total_bytes = _save_upload_to_media_storage(file, relative_path)

    original_filename = file.filename or filename
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

    metadata = _asset_metadata(asset)
    if file.filename:
        metadata["original_filename"] = file.filename
    metadata["content_type"] = content_type
    metadata["size_bytes"] = total_bytes
    _set_asset_metadata(asset, metadata)

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
        _set_media_metadata(media, media_metadata)

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

