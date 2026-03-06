from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class NodeComment(Base):
    __tablename__ = "node_comments"

    id = Column(Integer, primary_key=True)
    node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"), nullable=False)
    parent_comment_id = Column(Integer, ForeignKey("node_comments.id", ondelete="SET NULL"))
    content_text = Column(Text, nullable=False)
    language_code = Column(Text, nullable=False, default="en")
    metadata_json = Column("metadata", JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    last_modified_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
