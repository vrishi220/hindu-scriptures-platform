from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class WordMeaningWork(Base):
    __tablename__ = "word_meaning_works"

    id = Column(Integer, primary_key=True)
    author_id = Column(Integer, ForeignKey("word_meaning_authors.id", ondelete="SET NULL"))
    title = Column(Text)
    description = Column(Text)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
