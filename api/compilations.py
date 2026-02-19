"""Compilations (basket/book assembly) API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.users import get_current_user, get_current_user_optional
from models.user import User
from models.compilation import Compilation
from models.schemas import CompilationPublic, CompilationCreate, CompilationUpdate
from services import get_db

router = APIRouter(prefix="/compilations", tags=["compilations"])


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
