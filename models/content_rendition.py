from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class ContentRendition(Base):
    __tablename__ = "content_renditions"

    id = Column(Integer, primary_key=True)
    node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"), nullable=False)
    rendition_type = Column(Text, nullable=False)  # translation | commentary
    author_id = Column(Integer, ForeignKey("commentary_authors.id", ondelete="SET NULL"))
    work_id = Column(Integer, ForeignKey("commentary_works.id", ondelete="SET NULL"))
    content_text = Column(Text, nullable=False)
    language_code = Column(Text, nullable=False, default="en")
    script_code = Column(Text)
    display_order = Column(Integer, nullable=False, default=0)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    last_modified_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
