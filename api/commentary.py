import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from api.users import get_current_user
from api.content import (
    require_view_permission,
    _ensure_book_view_access,
    _ensure_can_contribute,
    _ensure_node_edit_access,
    _resolve_effective_source_node,
)
from models.book import Book
from models.commentary_author import CommentaryAuthor
from models.commentary_entry import CommentaryEntry
from models.commentary_work import CommentaryWork
from models.content_node import ContentNode
from models.content_rendition import ContentRendition
from models.node_comment import NodeComment
from models.schemas import (
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
    NodeCommentCreate,
    NodeCommentPublic,
    NodeCommentUpdate,
)
from models.user import User
from services import get_db

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger(__name__)


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

    effective_source_node = _resolve_effective_source_node(db, node)
    effective_node_id = effective_source_node.id if effective_source_node else node_id
    requested_language = language_code.strip().lower() if language_code and language_code.strip() else None

    query = (
        db.query(CommentaryEntry, CommentaryWork, CommentaryAuthor)
        .outerjoin(CommentaryWork, CommentaryEntry.work_id == CommentaryWork.id)
        .outerjoin(CommentaryAuthor, CommentaryEntry.author_id == CommentaryAuthor.id)
        .filter(CommentaryEntry.node_id == effective_node_id)
    )
    if requested_language:
        query = query.filter(CommentaryEntry.language_code == requested_language)
    rows = (
        query
        .order_by(CommentaryEntry.display_order.asc(), CommentaryEntry.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result: list[CommentaryEntryPublic] = []
    for entry, work, author in rows:
        metadata = dict(entry.metadata_json) if isinstance(entry.metadata_json, dict) else {}
        if author and isinstance(author.name, str) and author.name.strip():
            metadata.setdefault("author", author.name.strip())
        if work and isinstance(work.title, str) and work.title.strip():
            metadata.setdefault("work_title", work.title.strip())

        result.append(
            CommentaryEntryPublic.model_validate(
                {
                    "id": entry.id,
                    "node_id": node_id,
                    "author_id": entry.author_id,
                    "work_id": entry.work_id,
                    "content_text": entry.content_text,
                    "language_code": entry.language_code,
                    "display_order": entry.display_order,
                    "metadata": metadata,
                    "created_by": entry.created_by,
                    "last_modified_by": entry.last_modified_by,
                    "created_at": entry.created_at,
                    "updated_at": entry.updated_at,
                }
            )
        )

    return result


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
