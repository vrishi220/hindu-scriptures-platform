from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class WordMeaningEntry(Base):
    __tablename__ = "word_meaning_entries"

    id = Column(Integer, primary_key=True)
    node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(Integer, ForeignKey("word_meaning_authors.id", ondelete="SET NULL"))
    work_id = Column(Integer, ForeignKey("word_meaning_works.id", ondelete="SET NULL"))
    source_word = Column(Text, nullable=False)
    transliteration = Column(Text)
    word_order = Column(Integer, nullable=False)
    language_code = Column(Text, nullable=False)
    meaning_text = Column(Text, nullable=False)
    display_order = Column(Integer, default=0)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "node_id",
            "word_order",
            "language_code",
            "author_id",
            name="uq_word_meaning_entries_node_word_lang_author",
        ),
    )
