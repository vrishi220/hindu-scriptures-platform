"""Collection Cart API endpoints — modeless shopping basket for browse/search workflow.

v0.3 Workflow:
1. User browses/searches scripture library
2. Items can be dragged/added to CollectionCart (modeless — always accessible)
3. Items can be removed from cart at any time
4. When ready, user promotes cart items to Draft (Compilation) for formal assembly
   - Adds schema, structure, layout, metadata, provenance

This module handles steps 1-3. Step 4 is handled by compilations.py.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.users import get_current_user
from models.book import Book
from models.collection_cart import CollectionCart, CollectionCartItem
from models.draft_book import DraftBook
from models.user import User
from models.schemas import (
    CollectionCartPublic,
    CollectionCartCreate,
    CollectionCartUpdate,
    CollectionCartItemCreate,
    CollectionCartItemPublic,
    CartDraftBodyReference,
    CartDraftComposeBodyPublic,
    CartCreateDraftRequest,
    DraftBookPublic,
)
from services import get_db

router = APIRouter(prefix="/cart", tags=["collection_cart"])


class ReorderItemsPayload(BaseModel):
    item_order: list[int]


def _to_item_public(item: CollectionCartItem) -> CollectionCartItemPublic:
    return CollectionCartItemPublic(
        id=item.id,
        cart_id=item.cart_id,
        item_id=item.item_id,
        item_type=item.item_type,
        source_book_id=item.source_book_id,
        order=item.order,
        metadata=item.item_metadata,
        added_at=item.added_at,
        updated_at=item.updated_at,
    )


def _compose_cart_items_into_draft_body(items: list[CollectionCartItem], db: Session) -> tuple[list[dict], list[CartDraftBodyReference], int]:
    ordered_book_ids: list[int] = []
    seen_book_ids: set[int] = set()
    skipped_item_count = 0
    for item in items:
        if item.source_book_id is None or item.source_book_id <= 0:
            skipped_item_count += 1
            continue
        if item.source_book_id in seen_book_ids:
            continue
        seen_book_ids.add(item.source_book_id)
        ordered_book_ids.append(item.source_book_id)

    books = db.query(Book).filter(Book.id.in_(ordered_book_ids)).all() if ordered_book_ids else []
    books_by_id = {book.id: book for book in books}

    body_references: list[CartDraftBodyReference] = []
    body_items: list[dict] = []
    for index, source_book_id in enumerate(ordered_book_ids, start=1):
        source_book = books_by_id.get(source_book_id)
        title = source_book.book_name if source_book and source_book.book_name else f"Book {source_book_id}"
        reference = CartDraftBodyReference(
            source_book_id=source_book_id,
            source_scope="book",
            order=index,
            title=title,
        )
        body_references.append(reference)
        body_items.append(reference.model_dump())

    return body_items, body_references, skipped_item_count


# === Cart Management ===

@router.post("", response_model=CollectionCartPublic, status_code=status.HTTP_201_CREATED)
def create_cart(
    payload: CollectionCartCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new collection cart for current user."""
    cart = CollectionCart(
        owner_id=current_user.id,
        title=payload.title,
        description=payload.description,
    )
    db.add(cart)
    db.commit()
    db.refresh(cart)
    return CollectionCartPublic(
        id=cart.id,
        owner_id=cart.owner_id,
        title=cart.title,
        description=cart.description,
        created_at=cart.created_at,
        updated_at=cart.updated_at,
        items=[],
    )


@router.get("/me", response_model=CollectionCartPublic)
def get_my_cart(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user's active collection cart. Creates one if doesn't exist."""
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        # Auto-create cart for new users
        cart = CollectionCart(owner_id=current_user.id, title="My Collection")
        db.add(cart)
        db.commit()
        db.refresh(cart)

    items = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).order_by(CollectionCartItem.order).all()

    return CollectionCartPublic(
        id=cart.id,
        owner_id=cart.owner_id,
        title=cart.title,
        description=cart.description,
        created_at=cart.created_at,
        updated_at=cart.updated_at,
        items=[_to_item_public(item) for item in items],
    )


@router.patch("/me", response_model=CollectionCartPublic)
def update_my_cart(
    payload: CollectionCartUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update current user's cart metadata (title, description)."""
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart not found")

    if payload.title is not None:
        cart.title = payload.title
    if payload.description is not None:
        cart.description = payload.description

    db.commit()
    db.refresh(cart)

    items = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).order_by(CollectionCartItem.order).all()

    return CollectionCartPublic(
        id=cart.id,
        owner_id=cart.owner_id,
        title=cart.title,
        description=cart.description,
        created_at=cart.created_at,
        updated_at=cart.updated_at,
        items=[_to_item_public(item) for item in items],
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def clear_my_cart(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear all items from current user's cart."""
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart not found")

    db.query(CollectionCartItem).filter(CollectionCartItem.cart_id == cart.id).delete()
    db.commit()


@router.post("/me/compose-draft-body", response_model=CartDraftComposeBodyPublic)
def compose_my_cart_as_draft_body(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compose cart items into a draft-ready body structure using whole-book references."""
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart not found")

    items = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).order_by(CollectionCartItem.order.asc(), CollectionCartItem.id.asc()).all()
    body_items, body_references, skipped_item_count = _compose_cart_items_into_draft_body(items, db)

    section_structure = {
        "front": [],
        "body": body_items,
        "back": [],
    }

    return CartDraftComposeBodyPublic(
        cart_id=cart.id,
        section_structure=section_structure,
        body_references=body_references,
        skipped_item_count=skipped_item_count,
    )


@router.post("/me/create-draft", response_model=DraftBookPublic, status_code=status.HTTP_201_CREATED)
def create_draft_from_my_cart(
    payload: CartCreateDraftRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a draft directly from cart items using whole-book body references."""
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart not found")

    items = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).order_by(CollectionCartItem.order.asc(), CollectionCartItem.id.asc()).all()
    body_items, _, _ = _compose_cart_items_into_draft_body(items, db)

    draft = DraftBook(
        owner_id=current_user.id,
        title=payload.title,
        description=payload.description,
        section_structure={
            "front": [],
            "body": body_items,
            "back": [],
        },
        status="draft",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    if payload.clear_cart_after_create:
        db.query(CollectionCartItem).filter(CollectionCartItem.cart_id == cart.id).delete()
        db.commit()

    return DraftBookPublic.model_validate(draft)


# === Cart Items Management ===

@router.post("/items", response_model=CollectionCartItemPublic, status_code=status.HTTP_201_CREATED)
def add_item_to_cart(
    payload: CollectionCartItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add an item (library node or user content) to collection cart."""
    # Get or create user's cart
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        cart = CollectionCart(owner_id=current_user.id, title="My Collection")
        db.add(cart)
        db.commit()
        db.refresh(cart)

    # Check if item already exists in cart
    existing = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id,
        CollectionCartItem.item_id == payload.item_id,
        CollectionCartItem.item_type == payload.item_type,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Item already in cart",
        )

    # Determine order (append to end)
    max_order = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).order_by(CollectionCartItem.order.desc()).first()
    next_order = (max_order.order + 1) if max_order else 0

    source_book_id = payload.source_book_id
    if source_book_id is not None:
        book_exists = db.query(Book.id).filter(Book.id == source_book_id).first()
        if not book_exists:
            source_book_id = None

    item = CollectionCartItem(
        cart_id=cart.id,
        item_id=payload.item_id,
        item_type=payload.item_type,
        source_book_id=source_book_id,
        order=next_order,
        item_metadata=payload.metadata,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return _to_item_public(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item_from_cart(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove an item from current user's collection cart."""
    # Verify item belongs to current user's cart
    item = db.query(CollectionCartItem).join(CollectionCart).filter(
        CollectionCartItem.id == item_id,
        CollectionCart.owner_id == current_user.id,
    ).first()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found in your cart",
        )

    db.delete(item)
    db.commit()


@router.patch("/items/{item_id}", response_model=CollectionCartItemPublic)
def update_cart_item(
    item_id: int,
    payload: dict,  # Allow partial updates of metadata, order
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update item metadata or position in cart (e.g., reorder, add section assignment)."""
    item = db.query(CollectionCartItem).join(CollectionCart).filter(
        CollectionCartItem.id == item_id,
        CollectionCart.owner_id == current_user.id,
    ).first()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found in your cart",
        )

    if "order" in payload:
        item.order = payload["order"]
    if "metadata" in payload:
        item.item_metadata = payload["metadata"]

    db.commit()
    db.refresh(item)

    return _to_item_public(item)


@router.post("/items/reorder", response_model=CollectionCartPublic)
def reorder_cart_items(
    payload: ReorderItemsPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder all items in cart based on provided item ID list."""
    cart = db.query(CollectionCart).filter(
        CollectionCart.owner_id == current_user.id
    ).first()

    if not cart:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cart not found")

    items = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).all()

    # Verify all IDs belong to this cart
    item_ids = {item.id for item in items}
    if not set(payload.item_order).issubset(item_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid item IDs in reorder list",
        )

    # Update order
    item_map = {item.id: item for item in items}
    for new_order, item_id in enumerate(payload.item_order):
        item_map[item_id].order = new_order

    db.commit()

    # Refresh and return
    items = db.query(CollectionCartItem).filter(
        CollectionCartItem.cart_id == cart.id
    ).order_by(CollectionCartItem.order).all()

    return CollectionCartPublic(
        id=cart.id,
        owner_id=cart.owner_id,
        title=cart.title,
        description=cart.description,
        created_at=cart.created_at,
        updated_at=cart.updated_at,
        items=[_to_item_public(item) for item in items],
    )
