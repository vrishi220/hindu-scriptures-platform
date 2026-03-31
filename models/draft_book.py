from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class DraftBook(Base):
    __tablename__ = "draft_books"

    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    section_structure = Column(JSONB, nullable=False, default=dict)
    compilation_metadata = Column(JSONB, nullable=False, default=dict, server_default="{}")
    status = Column(
        Enum("draft", "published", name="draft_book_status"),
        nullable=False,
        default="draft",
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class EditionSnapshot(Base):
    __tablename__ = "edition_snapshots"

    id = Column(Integer, primary_key=True)
    draft_book_id = Column(Integer, ForeignKey("draft_books.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    snapshot_data = Column(JSONB, nullable=False, default=dict)
    immutable = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
