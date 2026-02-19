from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.sql import func

from models.database import Base


class ContentNode(Base):
    __tablename__ = "content_nodes"

    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"))
    parent_node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"))
    referenced_node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"))
    level_name = Column(String(100), nullable=False)
    level_order = Column(Integer, nullable=False)
    sequence_number = Column(Integer)
    title_sanskrit = Column(Text)
    title_transliteration = Column(Text)
    title_english = Column(Text)
    title_hindi = Column(Text)
    title_tamil = Column(Text)
    has_content = Column(Boolean, default=False)
    content_data = Column(JSONB, default=dict)
    summary_data = Column(JSONB, default=dict)
    metadata_json = Column(JSONB, default=dict)  # Extended metadata support
    source_attribution = Column(Text)
    license_type = Column(String(100), default="CC-BY-SA-4.0")
    original_source_url = Column(Text)
    tags = Column(JSONB, default=list)
    created_by = Column(Integer, ForeignKey("users.id"))
    last_modified_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Phase 1: Status & versioning
    status = Column(Enum("draft", "published", "archived", name="content_status"), default="published", nullable=False)
    visibility = Column(Enum("private", "draft", "published", "archived", name="content_visibility"), default="published", nullable=False)
    language_code = Column(String(10), default="en", nullable=False)
    collaborators = Column(JSONB, default=list)  # [{user_id, role}, ...]
    version_history = Column(JSONB, default=list)  # [{version, edited_by, edited_at, reason}, ...]
    
    # Full-text search
    search_vector = Column(TSVECTOR, nullable=True)
