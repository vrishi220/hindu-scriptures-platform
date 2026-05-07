import os
import re
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from api.users import get_current_user, get_current_user_optional
from api.content import (
    require_view_permission,
    _ensure_book_view_access,
    _ensure_can_contribute,
    _ensure_node_edit_access,
    _book_public_model,
)
from models.book import Book
from models.content_node import ContentNode
from models.media_file import MediaFile
from models.media_asset import MediaAsset
from models.user import User
from models.schemas import BookPublic, MediaAssetPublic, MediaFilePublic
from services import get_db
from services.book_permissions import ensure_book_edit_access
from services.media_storage import FileTooLargeError, get_media_storage_from_env

logger = logging.getLogger(__name__)

MEDIA_STORAGE = get_media_storage_from_env()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_MEDIA_TYPES = {"audio", "video", "image", "link"}
_MEDIA_FILENAME_COMPONENT_RE = re.compile(r"[^A-Za-z0-9._-]+")

router = APIRouter(prefix="/content", tags=["content"])



# ── Request payload models ───────────────────────────────────────────────────

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


# ── Storage helpers ──────────────────────────────────────────────────────────

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
    normalized = _MEDIA_FILENAME_COMPONENT_RE.sub("-", normalized)
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


# ── MediaFile metadata helpers ───────────────────────────────────────────────

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



# ── Endpoints ────────────────────────────────────────────────────────────────

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

    ensure_book_edit_access(db, current_user, book, detail="You do not have edit access to this book")

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

    ensure_book_edit_access(db, current_user, book, detail="You do not have edit access to this book")

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
