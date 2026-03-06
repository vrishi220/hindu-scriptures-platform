from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class CommentaryWork(Base):
    __tablename__ = "commentary_works"

    id = Column(Integer, primary_key=True)
    title = Column(Text, nullable=False)
    author_id = Column(Integer, ForeignKey("commentary_authors.id", ondelete="SET NULL"))
    description = Column(Text)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
