from sqlalchemy import Column, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class TranslationAuthor(Base):
    __tablename__ = "translation_authors"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    bio = Column(Text)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
