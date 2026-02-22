"""Collection Cart models for modeless shopping basket during browse/search workflow.

v0.3 Workflow States:
1. CollectionCart: Lightweight, ephemeral basket — items added/removed while browsing.
   User can drag items in/out at any time (modeless, always accessible).

2. Compilation (Draft): Formal assembly state. User intentionally promotes cart items
   into a draft, assigns schema/structure, adds layout/metadata, captures provenance.

3. Edition (Snapshot): Immutable published version (frozen after publish).

This model represents the COLLECTION CART state only.
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class CollectionCart(Base):
    """Shopping cart for collecting library items before assembly into draft."""

    __tablename__ = "collection_carts"

    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), default="My Collection")
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CollectionCartItem(Base):
    """Individual items (library nodes, own content) in a collection cart."""

    __tablename__ = "collection_cart_items"

    id = Column(Integer, primary_key=True)
    cart_id = Column(Integer, ForeignKey("collection_carts.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id = Column(Integer, nullable=False)  # Reference to library node_id or user content_id
    item_type = Column(String(50), nullable=False)  # 'library_node' or 'user_content'
    source_book_id = Column(Integer, ForeignKey("books.id", ondelete="SET NULL"), nullable=True)
    order = Column(Integer, default=0)  # Display order in cart
    item_metadata = Column(JSONB, nullable=True)  # {section_assignment, notes, transliteration_config}
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
