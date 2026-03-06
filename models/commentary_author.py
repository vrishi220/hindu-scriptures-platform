from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class CommentaryAuthor(Base):
    __tablename__ = "commentary_authors"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False, unique=True)
    bio = Column(Text)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
