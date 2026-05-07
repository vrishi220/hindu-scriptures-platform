import logging
import os
from urllib.parse import parse_qsl, urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.sql import func

from api.users import get_current_user, get_current_user_optional, require_permission
from api.content import (
    require_view_permission,
    _ensure_book_view_access,
    _ensure_can_contribute,
    _book_public_model,
    _validate_level_name_overrides,
    _book_node_payload_from_metadata,
    _write_book_node_payload_into_metadata,
)
from models.book import Book
from models.book_share import BookShare
from models.content_node import ContentNode
from models.provenance_record import ProvenanceRecord
from models.schemas import (
    BookCreate,
    BookOwnershipTransferRequest,
    BookOwnershipTransferResponse,
    BookPublic,
    BookShareCreate,
    BookSharePublic,
    BookShareUpdate,
    BookUpdate,
    ProvenanceRecordPublic,
    ScriptureSchemaCreate,
    ScriptureSchemaPublic,
    ScriptureSchemaUpdate,
    UserOwnedBookSummary,
)
from models.scripture_schema import ScriptureSchema
from models.user import User
from services import get_db
from services.book_permissions import (
    BOOK_STATUS_DRAFT,
    BOOK_STATUS_PUBLISHED,
    BOOK_VISIBILITY_PRIVATE,
    BOOK_VISIBILITY_PUBLIC,
    book_owner_id,
    book_status,
    book_visibility,
    ensure_book_edit_access,
    ensure_book_owner_or_edit_any,
)
from services.email import send_share_invitation

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger(__name__)


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


def _book_verse_counts(db: Session, book_ids: list[int]) -> dict[int, int]:
    if not book_ids:
        return {}

    rows = (
        db.query(
            ContentNode.book_id,
            func.count(ContentNode.id),
        )
        .filter(
            ContentNode.book_id.in_(book_ids),
            or_(
                ContentNode.has_content == True,
                ContentNode.referenced_node_id.isnot(None),
            ),
        )
        .group_by(ContentNode.book_id)
        .all()
    )
    return {int(book_id): int(count or 0) for book_id, count in rows if book_id is not None}


def _owned_books_for_user(db: Session, user: User) -> list[Book]:
    user_id = user.id
    user_email = (user.email or "").strip().lower()
    candidate_books = db.query(Book).all()

    owned: list[Book] = []
    for book in candidate_books:
        owner_id = book_owner_id(book)
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


def _ensure_book_delete_access(current_user: User, book: Book) -> None:
    ensure_book_owner_or_edit_any(
        current_user,
        book,
        detail="Only the book owner can delete this book",
    )


def _delete_book_rows(db: Session, book_id: int) -> str:
    db.execute(
        text(
            "DELETE FROM word_meaning_entries "
            "WHERE node_id IN (SELECT id FROM content_nodes WHERE book_id = :bid)"
        ),
        {"bid": book_id},
    )
    db.execute(
        text(
            "DELETE FROM commentary_entries "
            "WHERE node_id IN (SELECT id FROM content_nodes WHERE book_id = :bid)"
        ),
        {"bid": book_id},
    )
    db.execute(
        text(
            "DELETE FROM translation_entries "
            "WHERE node_id IN (SELECT id FROM content_nodes WHERE book_id = :bid)"
        ),
        {"bid": book_id},
    )
    db.execute(
        text(
            "DELETE FROM media_files "
            "WHERE node_id IN (SELECT id FROM content_nodes WHERE book_id = :bid)"
        ),
        {"bid": book_id},
    )
    db.execute(
        text(
            "DELETE FROM provenance_records "
            "WHERE target_node_id IN (SELECT id FROM content_nodes WHERE book_id = :bid)"
        ),
        {"bid": book_id},
    )
    db.execute(
        text("DELETE FROM content_nodes WHERE book_id = :bid"),
        {"bid": book_id},
    )
    result = db.execute(
        text("DELETE FROM books WHERE id = :bid"),
        {"bid": book_id},
    )
    db.commit()
    deleted_count = int(result.rowcount or 0)
    return "Already deleted" if deleted_count == 0 else "Deleted"


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
    book_code: str | None = Query(default=None),
    book_name: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[BookPublic]:
    def serialize_books(items: list[Book]) -> list[BookPublic]:
        verse_counts = _book_verse_counts(db, [book.id for book in items])
        return [_book_public_model(book, verse_counts.get(book.id, 0)) for book in items]

    # Exact-match lookups (used for existence checks before import)
    if book_code is not None:
        books = db.query(Book).filter(Book.book_code == book_code.strip()).all()
        return serialize_books(books)
    if book_name is not None:
        books = db.query(Book).filter(Book.book_name == book_name.strip()).all()
        return serialize_books(books)
    query_text = (q or "").strip()
    if query_text:
        # Pre-filter at DB level: only load books containing at least one search term,
        # then let Python scoring rank them precisely.
        terms = [t for t in query_text.lower().split() if t]
        if terms:
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
        return serialize_books(page)

    books = (
        db.query(Book)
        .order_by(Book.created_at.desc(), Book.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return serialize_books(books)


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
    book_node_payload = {
        "title_sanskrit": payload.title_sanskrit,
        "title_transliteration": payload.title_transliteration,
        "title_english": payload.title_english,
        "title_hindi": payload.title_hindi,
        "title_tamil": payload.title_tamil,
        "has_content": payload.has_content,
        "content_data": payload.content_data or {},
        "summary_data": payload.summary_data or {},
        "source_attribution": payload.source_attribution,
        "license_type": payload.license_type,
        "original_source_url": payload.original_source_url,
        "tags": payload.tags or [],
    }
    metadata_json["owner_id"] = current_user.id
    metadata_json["owner_email"] = current_user.email
    metadata_json["status"] = BOOK_STATUS_DRAFT
    metadata_json["visibility"] = BOOK_VISIBILITY_PRIVATE
    _write_book_node_payload_into_metadata(metadata_json, book_node_payload)

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

    ensure_book_edit_access(db, current_user, book, detail="You do not have edit access to this book")

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
    book_node_payload = _book_node_payload_from_metadata(metadata)

    for key, value in updates.items():
        if key == "metadata":
            metadata = dict(value) if isinstance(value, dict) else {}
            book_node_payload = _book_node_payload_from_metadata(metadata)
        elif key == "level_name_overrides":
            continue
        elif key == "variant_authors":
            if isinstance(value, dict):
                book.variant_authors = {str(k): str(v) for k, v in value.items() if k and v}
            continue
        elif key in {
            "title_sanskrit",
            "title_transliteration",
            "title_english",
            "title_hindi",
            "title_tamil",
            "has_content",
            "content_data",
            "summary_data",
            "source_attribution",
            "license_type",
            "original_source_url",
            "tags",
        }:
            if key == "content_data":
                book_node_payload[key] = value if isinstance(value, dict) else {}
            elif key == "summary_data":
                book_node_payload[key] = value if isinstance(value, dict) else {}
            elif key == "tags":
                book_node_payload[key] = value if isinstance(value, list) else []
            else:
                book_node_payload[key] = value
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

    if book_owner_id(book) is None:
        metadata["owner_id"] = current_user.id
    if "owner_email" not in metadata and isinstance(current_user.email, str):
        metadata["owner_email"] = current_user.email
    if "status" not in metadata:
        metadata["status"] = BOOK_STATUS_DRAFT
    if "visibility" not in metadata:
        metadata["visibility"] = BOOK_VISIBILITY_PRIVATE

    _write_book_node_payload_into_metadata(metadata, book_node_payload)

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

    _ensure_book_delete_access(current_user, book)

    try:
        message = _delete_book_rows(db, book_id)
        return {"message": message}
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Book delete failed: {str(exc)}",
        ) from exc


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
        visibility = book_visibility(book)
        status_value = book_status(book)
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

    owner_id = book_owner_id(book)
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
