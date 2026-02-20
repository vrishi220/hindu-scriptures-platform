"""Compilations (basket/book assembly) API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.users import get_current_user, get_current_user_optional
from models.user import User
from models.compilation import Compilation
from models.book import Book
from models.content_node import ContentNode
from models.scripture_schema import ScriptureSchema
from models.schemas import CompilationPublic, CompilationCreate, CompilationUpdate, BookPublic
from services import get_db

router = APIRouter(prefix="/compilations", tags=["compilations"])


class PublishAsBookPayload(BaseModel):
    """Payload for publishing compilation as a book"""
    schema_id: int
    book_name: str
    book_code: str | None = None
    language_primary: str = "sanskrit"
    description: str | None = None


@router.get("/my", response_model=list[CompilationPublic])
def list_user_compilations(
    is_public: bool | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List compilations created by current user"""
    query = db.query(Compilation).filter(Compilation.creator_id == current_user.id)
    
    if is_public is not None:
        query = query.filter(Compilation.is_public == is_public)
    
    compilations = query.order_by(Compilation.created_at.desc()).all()
    return [CompilationPublic.model_validate(c) for c in compilations]


@router.get("/public", response_model=list[CompilationPublic])
def list_public_compilations(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """List public compilations (browse community compilations)"""
    _ = current_user  # Any user can browse public compilations
    
    compilations = db.query(Compilation).filter(
        Compilation.is_public == True,
        Compilation.status == "published"
    ).order_by(Compilation.created_at.desc()).offset(offset).limit(limit).all()
    
    return [CompilationPublic.model_validate(c) for c in compilations]


@router.post("", response_model=CompilationPublic, status_code=status.HTTP_201_CREATED)
def create_compilation(
    payload: CompilationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create new compilation from basket items"""
    try:
        compilation = Compilation(
            creator_id=current_user.id,
            title=payload.title,
            description=payload.description,
            schema_type=payload.schema_type,
            items=payload.items,  # [{node_id, order}, ...]
            compilation_metadata=payload.metadata,
            status=payload.status or "draft",
            is_public=payload.is_public or False,
        )
        db.add(compilation)
        db.commit()
        db.refresh(compilation)
        return CompilationPublic.model_validate(compilation)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create compilation: {str(e)}"
        )


@router.get("/{compilation_id}", response_model=CompilationPublic)
def get_compilation(
    compilation_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Get compilation by ID (public or owned by current user)"""
    compilation = db.query(Compilation).filter(
        Compilation.id == compilation_id
    ).first()
    
    if not compilation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compilation not found"
        )
    
    # Check access: public, owned by user, or user is editor/admin
    is_owner = current_user and compilation.creator_id == current_user.id
    is_public = compilation.is_public and compilation.status == "published"
    
    if not is_owner and not is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this compilation"
        )
    
    return CompilationPublic.model_validate(compilation)


@router.patch("/{compilation_id}", response_model=CompilationPublic)
def update_compilation(
    compilation_id: int,
    payload: CompilationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update compilation (only by creator or admin)"""
    compilation = db.query(Compilation).filter(
        Compilation.id == compilation_id
    ).first()
    
    if not compilation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compilation not found"
        )
    
    # Check authorization
    if compilation.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creator can update compilation"
        )
    
    # Update fields
    if payload.title is not None:
        compilation.title = payload.title
    if payload.description is not None:
        compilation.description = payload.description
    if payload.items is not None:
        compilation.items = payload.items
    if payload.metadata is not None:
        compilation.compilation_metadata = payload.metadata
    if payload.status is not None:
        compilation.status = payload.status
    if payload.is_public is not None:
        compilation.is_public = payload.is_public
    
    db.commit()
    db.refresh(compilation)
    return CompilationPublic.model_validate(compilation)


@router.delete("/{compilation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_compilation(
    compilation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete compilation (only by creator)"""
    compilation = db.query(Compilation).filter(
        Compilation.id == compilation_id
    ).first()
    
    if not compilation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compilation not found"
        )
    
    if compilation.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creator can delete compilation"
        )
    
    db.delete(compilation)
    db.commit()


@router.post("/{compilation_id}/publish-as-book", response_model=BookPublic)
def publish_compilation_as_book(
    compilation_id: int,
    payload: PublishAsBookPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Publish a compilation as a new book.
    
    This creates a new book with the specified schema and copies all nodes
    from the compilation into the new book, maintaining their content and order.
    """
    # Fetch compilation
    compilation = db.query(Compilation).filter(
        Compilation.id == compilation_id
    ).first()
    
    if not compilation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compilation not found"
        )
    
    # Check authorization - only creator can publish
    if compilation.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creator can publish compilation as book"
        )
    
    # Validate schema exists
    schema = db.query(ScriptureSchema).filter(
        ScriptureSchema.id == payload.schema_id
    ).first()
    
    if not schema:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid schema_id"
        )
    
    # Create the new book
    book = Book(
        schema_id=payload.schema_id,
        book_name=payload.book_name,
        book_code=payload.book_code,
        language_primary=payload.language_primary,
        metadata_json={
            "source": "compilation",
            "compilation_id": compilation_id,
            "compilation_title": compilation.title,
            "description": payload.description or compilation.description,
        }
    )
    db.add(book)
    db.flush()  # Get book.id without committing
    
    # Extract node IDs from compilation items
    if not compilation.items or len(compilation.items) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Compilation has no items to publish"
        )
    
    # Fetch all original nodes
    node_ids = [item.get("node_id") for item in compilation.items if item.get("node_id")]
    original_nodes = db.query(ContentNode).filter(
        ContentNode.id.in_(node_ids)
    ).all()
    
    if len(original_nodes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid nodes found in compilation"
        )
    
    # Create a mapping for quick lookup
    node_map = {node.id: node for node in original_nodes}
    
    # Determine the target level (use the last level from schema as leaf level)
    if not schema.levels or len(schema.levels) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Schema has no levels defined"
        )
    
    # Use the last level as the target level for all nodes (e.g., "Shloka", "Verse")
    target_level = schema.levels[-1]
    target_level_order = len(schema.levels)  # Level order is 1-indexed
    
    # Copy nodes to the new book in the order specified by compilation
    new_nodes = []
    for idx, item in enumerate(compilation.items):
        node_id = item.get("node_id")
        if not node_id or node_id not in node_map:
            continue
        
        original = node_map[node_id]
        
        # Create new node with content from original
        new_node = ContentNode(
            book_id=book.id,
            parent_node_id=None,  # All nodes at root level for simplicity
            level_name=target_level,
            level_order=target_level_order,
            sequence_number=idx + 1,  # Sequential numbering
            title_sanskrit=original.title_sanskrit,
            title_transliteration=original.title_transliteration,
            title_english=original.title_english,
            title_hindi=original.title_hindi,
            title_tamil=original.title_tamil,
            has_content=original.has_content,
            content_data=original.content_data or {},
            summary_data=original.summary_data or {},
            metadata_json={
                "source_node_id": original.id,
                "source_book_id": original.book_id,
                "original_level": original.level_name,
                **(original.metadata_json or {})
            },
            source_attribution=original.source_attribution,
            license_type=original.license_type or "CC-BY-SA-4.0",
            original_source_url=original.original_source_url,
            tags=original.tags or [],
            created_by=current_user.id,
            last_modified_by=current_user.id,
        )
        new_nodes.append(new_node)
    
    if len(new_nodes) == 0:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid nodes could be copied from compilation"
        )
    
    # Add all new nodes to the database
    db.add_all(new_nodes)
    
    # Commit the transaction
    db.commit()
    db.refresh(book)
    
    return BookPublic.model_validate(book)
