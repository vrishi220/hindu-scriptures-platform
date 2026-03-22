from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from models.database import Base


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True)
    schema_id = Column(Integer, ForeignKey("scripture_schemas.id"))
    book_name = Column(String(255), nullable=False)
    book_code = Column(String(100), unique=True)
    language_primary = Column(String(50), default="sanskrit")
    metadata_json = Column("metadata", JSONB, default=dict)
    level_name_overrides = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationship
    schema = relationship("ScriptureSchema", lazy="joined")
