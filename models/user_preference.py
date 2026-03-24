from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from models.database import Base


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source_language = Column(String(10), default="en", nullable=False)
    transliteration_enabled = Column(Boolean, default=True, nullable=False)
    transliteration_script = Column(String(20), default="devanagari", nullable=False)
    show_roman_transliteration = Column(Boolean, default=True, nullable=False)
    show_only_preferred_script = Column(Boolean, default=False, nullable=False)
    show_media = Column(Boolean, default=True, nullable=False)
    show_commentary = Column(Boolean, default=True, nullable=False)
    preview_show_titles = Column(Boolean, default=False, nullable=False)
    preview_show_labels = Column(Boolean, default=False, nullable=False)
    preview_show_level_numbers = Column(Boolean, default=False, nullable=False)
    preview_show_details = Column(Boolean, default=False, nullable=False)
    preview_show_media = Column(Boolean, default=True, nullable=False)
    preview_show_sanskrit = Column(Boolean, default=True, nullable=False)
    preview_show_transliteration = Column(Boolean, default=True, nullable=False)
    preview_show_english = Column(Boolean, default=True, nullable=False)
    preview_transliteration_script = Column(String(20), default="iast", nullable=False)
    preview_word_meanings_display_mode = Column(String(10), default="inline", nullable=False)
    preview_translation_languages = Column(String(255), default="english", nullable=False)
    preview_hidden_levels = Column(String(2000), default="", nullable=False)
    scriptures_book_browser_view = Column(String(10), default="list", nullable=False)
    scriptures_media_manager_view = Column(String(10), default="list", nullable=False)
    admin_media_bank_browser_view = Column(String(10), default="list", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        UniqueConstraint('user_id', name='uq_user_preferences_user_id'),
    )
