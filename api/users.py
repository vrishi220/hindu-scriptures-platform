import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from models.book import Book
from models.schemas import (
    UserOwnedBookSummary,
    UserAdminCreate,
    UserPermissionsUpdate,
    UserPublic,
    UserSelfUpdate,
)
from models.user import User
from services.book_permissions import book_owner_id
from services import decode_token, get_db, hash_password

router = APIRouter(prefix="/users", tags=["users"])

ACCESS_TOKEN_COOKIE = os.getenv("ACCESS_TOKEN_COOKIE", "access_token")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _serialize_user_public(user: User) -> UserPublic:
    is_invited_user = (not user.is_active) and (not user.password_hash)
    status = "invited" if is_invited_user else "registered"
    lifecycle_age_days = None
    if user.created_at is not None:
        created_at = user.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        lifecycle_age_days = max((datetime.now(timezone.utc) - created_at).days, 0)

    return UserPublic.model_validate(
        {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role,
            "permissions": user.permissions,
            "is_active": user.is_active,
            "created_at": user.created_at,
            "account_lifecycle_status": status,
            "lifecycle_age_days": lifecycle_age_days,
        }
    )


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")

    return user


def get_current_user_optional(
    request: Request,
    token: str | None = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
) -> User | None:
    if not token:
        token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    if not token:
        return None
    try:
        payload = decode_token(token)
    except JWTError:
        return None

    if payload.get("type") != "access":
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        return None

    return user


def require_permission(permission: str):
    def checker(current_user: User = Depends(get_current_user)) -> User:
        perms = current_user.permissions or {}
        if not perms.get(permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return current_user

    return checker


@router.get("/me", response_model=UserPublic)
def read_current_user(current_user: User = Depends(get_current_user)) -> UserPublic:
    return _serialize_user_public(current_user)


@router.patch("/me", response_model=UserPublic)
def update_current_user(
    payload: UserSelfUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserPublic:
    updates = payload.model_dump(exclude_unset=True)

    if "username" in updates:
        username = updates["username"]
        if username:
            existing_username = (
                db.query(User)
                .filter(User.username == username, User.id != current_user.id)
                .first()
            )
            if existing_username:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Username in use",
                )
        current_user.username = username

    if "full_name" in updates:
        current_user.full_name = updates["full_name"]

    db.commit()
    db.refresh(current_user)
    return _serialize_user_public(current_user)


@router.get("", response_model=list[UserPublic])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
) -> list[UserPublic]:
    _ = current_user
    users = db.query(User).order_by(User.id).all()
    return [_serialize_user_public(user) for user in users]


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user_admin(
    payload: UserAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
) -> UserPublic:
    _ = current_user
    existing_email = db.query(User).filter(User.email == payload.email).first()
    if existing_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email in use")

    if payload.username:
        existing_username = (
            db.query(User).filter(User.username == payload.username).first()
        )
        if existing_username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Username in use"
            )

    # Map roles to default permissions
    role_permissions_map = {
        "viewer": {
            "can_view": True,
            "can_contribute": True,
            "can_import": False,
            "can_edit": False,
            "can_moderate": False,
            "can_admin": False,
        },
        "contributor": {
            "can_view": True,
            "can_contribute": True,
            "can_import": True,
            "can_edit": False,
            "can_moderate": False,
            "can_admin": False,
        },
        "editor": {
            "can_view": True,
            "can_contribute": True,
            "can_import": True,
            "can_edit": True,
            "can_moderate": False,
            "can_admin": False,
        },
        "moderator": {
            "can_view": True,
            "can_contribute": True,
            "can_import": True,
            "can_edit": True,
            "can_moderate": True,
            "can_admin": False,
        },
        "admin": {
            "can_view": True,
            "can_contribute": True,
            "can_import": True,
            "can_edit": True,
            "can_moderate": True,
            "can_admin": True,
        },
    }

    role = payload.role or "viewer"
    base_permissions = role_permissions_map.get(role, role_permissions_map["viewer"])
    
    # Override with explicit permissions if provided
    if payload.permissions:
        base_permissions.update(payload.permissions)

    user = User(
        email=payload.email,
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=role,
        permissions=base_permissions,
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user_public(user)


@router.patch("/{user_id}/permissions", response_model=UserPublic)
def update_user_permissions(
    user_id: int,
    payload: UserPermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
) -> UserPublic:
    _ = current_user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    permissions = dict(user.permissions or {})
    updates = payload.model_dump(exclude_unset=True)
    role = updates.pop("role", None)
    permissions.update(updates)
    user.permissions = permissions
    flag_modified(user, "permissions")
    if role:
        user.role = role
    db.commit()
    db.refresh(user)
    return _serialize_user_public(user)


@router.patch("/{user_id}/status", response_model=UserPublic)
def update_user_status(
    user_id: int,
    is_active: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
) -> UserPublic:
    _ = current_user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    user.is_active = is_active
    db.commit()
    db.refresh(user)
    return _serialize_user_public(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
) -> None:
    _ = current_user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    # Check if user has contributions
    from models.content_node import ContentNode
    has_contributions = (
        db.query(ContentNode)
        .filter(
            (ContentNode.created_by == user_id) | (ContentNode.last_modified_by == user_id)
        )
        .first()
    )
    if has_contributions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete user with existing contributions. Deactivate instead.",
        )

    db.delete(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot delete user because related records still exist. "
                "Deactivate instead."
            ),
        )


@router.get("/{user_id}/books", response_model=list[UserOwnedBookSummary])
def list_user_owned_books(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
) -> list[UserOwnedBookSummary]:
    _ = current_user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    owned_books: list[UserOwnedBookSummary] = []
    books = db.query(Book).order_by(Book.created_at.desc(), Book.id.desc()).all()
    for book in books:
        if book_owner_id(book) != user_id:
            continue
        metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
        raw_visibility = str(metadata.get("visibility") or "private").strip().lower()
        visibility = "public" if raw_visibility == "public" else "private"
        raw_status = str(metadata.get("status") or "draft").strip().lower()
        status_value = "published" if raw_status == "published" else "draft"
        owned_books.append(
            UserOwnedBookSummary(
                id=book.id,
                book_name=book.book_name,
                book_code=book.book_code,
                visibility=visibility,
                status=status_value,
            )
        )

    return owned_books
