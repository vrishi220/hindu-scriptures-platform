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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class Compilation(Base):
    __tablename__ = "compilations"

    id = Column(Integer, primary_key=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    schema_type = Column(String(50), nullable=True)  # e.g., 'bhagavad_gita', 'ramayana', 'custom'
    items = Column(JSONB, nullable=False)  # [{node_id, order}, ...]
    compilation_metadata = Column(JSONB, nullable=True)  # {introduction, footer, custom_fields}
    status = Column(Enum("draft", "published", name="compilation_status"), default="draft", nullable=False)
    is_public = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
