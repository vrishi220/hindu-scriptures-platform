from fastapi import HTTPException, status
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from models.book import Book
from models.book_share import BookShare
from models.user import User


BOOK_STATUS_DRAFT = "draft"
BOOK_STATUS_PUBLISHED = "published"
BOOK_VISIBILITY_PRIVATE = "private"
BOOK_VISIBILITY_PUBLIC = "public"
BOOK_SHARE_VIEWER = "viewer"
BOOK_SHARE_CONTRIBUTOR = "contributor"
BOOK_SHARE_EDITOR = "editor"


def user_can_contribute(current_user: User) -> bool:
    perms = getattr(current_user, "permissions", None)
    if perms is None:
        return True
    return bool(
        perms.get("can_contribute")
        or perms.get("can_edit")
        or perms.get("can_admin")
    )


def user_can_edit_any(current_user: User) -> bool:
    perms = getattr(current_user, "permissions", None)
    if perms is None:
        return True
    return bool(perms.get("can_edit") or perms.get("can_admin"))


def book_owner_id(book: Book) -> int | None:
    metadata = book.metadata_json or {}
    if not isinstance(metadata, dict):
        return None
    owner_id = metadata.get("owner_id")
    try:
        return int(owner_id) if owner_id is not None else None
    except (TypeError, ValueError):
        return None


def book_status(book: Book) -> str:
    metadata = book.metadata_json or {}
    if isinstance(metadata, dict):
        status_value = str(metadata.get("status") or "").strip().lower()
        if status_value in {BOOK_STATUS_DRAFT, BOOK_STATUS_PUBLISHED}:
            return status_value
    return BOOK_STATUS_DRAFT


def book_visibility(book: Book) -> str:
    metadata = book.metadata_json or {}
    if isinstance(metadata, dict):
        visibility = str(metadata.get("visibility") or "").strip().lower()
        if visibility in {BOOK_VISIBILITY_PRIVATE, BOOK_VISIBILITY_PUBLIC}:
            return visibility
    return BOOK_VISIBILITY_PRIVATE


def share_permission_rank(permission: str | None) -> int:
    rank_map = {
        BOOK_SHARE_VIEWER: 1,
        BOOK_SHARE_CONTRIBUTOR: 2,
        BOOK_SHARE_EDITOR: 3,
    }
    return rank_map.get((permission or "").strip().lower(), 0)


def book_share_permission(
    db: Session,
    book_id: int,
    user_id: int,
    *,
    tolerate_missing_table: bool = False,
) -> str | None:
    try:
        share = (
            db.query(BookShare)
            .filter(
                BookShare.book_id == book_id,
                BookShare.shared_with_user_id == user_id,
            )
            .first()
        )
    except ProgrammingError as exc:
        if not tolerate_missing_table:
            raise
        original = getattr(exc, "orig", None)
        pgcode = getattr(original, "pgcode", None)
        if pgcode == "42P01":
            db.rollback()
            return None
        raise

    if not share:
        return None
    return str(share.permission).strip().lower()


def book_access_rank(
    db: Session,
    book: Book,
    current_user: User | None,
    *,
    allow_anonymous_private_reads: bool = False,
    tolerate_missing_share_table: bool = False,
) -> int:
    if current_user is None:
        if allow_anonymous_private_reads:
            return 1
        return 1 if book_visibility(book) == BOOK_VISIBILITY_PUBLIC else 0

    read_rank = 1 if book_visibility(book) == BOOK_VISIBILITY_PUBLIC else 0

    if user_can_edit_any(current_user):
        return 3

    if book_owner_id(book) == current_user.id:
        return 3

    return max(
        read_rank,
        share_permission_rank(
            book_share_permission(
                db,
                book.id,
                current_user.id,
                tolerate_missing_table=tolerate_missing_share_table,
            )
        ),
    )


def book_is_visible_to_user(
    db: Session,
    book: Book,
    current_user: User | None,
    *,
    allow_anonymous_private_reads: bool = False,
    tolerate_missing_share_table: bool = False,
) -> bool:
    return book_access_rank(
        db,
        book,
        current_user,
        allow_anonymous_private_reads=allow_anonymous_private_reads,
        tolerate_missing_share_table=tolerate_missing_share_table,
    ) >= 1


def ensure_book_view_access(
    db: Session,
    book: Book,
    current_user: User | None,
    *,
    allow_anonymous_private_reads: bool = False,
    tolerate_missing_share_table: bool = False,
) -> None:
    if book_is_visible_to_user(
        db,
        book,
        current_user,
        allow_anonymous_private_reads=allow_anonymous_private_reads,
        tolerate_missing_share_table=tolerate_missing_share_table,
    ):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def ensure_book_edit_access(db: Session, current_user: User, book: Book, *, detail: str = "Forbidden") -> None:
    if book_access_rank(db, book, current_user) >= 2:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def ensure_book_owner_or_edit_any(current_user: User, book: Book, *, detail: str = "Forbidden") -> None:
    if user_can_edit_any(current_user) or book_owner_id(book) == current_user.id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
