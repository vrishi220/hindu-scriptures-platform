from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class ScriptureSchema(Base):
    __tablename__ = "scripture_schemas"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    levels = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
