from decimal import Decimal

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class AIJob(Base):
    __tablename__ = "ai_jobs"

    id = Column(Integer, primary_key=True)
    job_type = Column(String(50), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="SET NULL"), index=True)
    language_code = Column(String(20))
    model = Column(String(100))
    status = Column(String(20), nullable=False, default="pending", index=True)
    total_nodes = Column(Integer, nullable=False, default=0)
    processed_nodes = Column(Integer, nullable=False, default=0)
    failed_nodes = Column(Integer, nullable=False, default=0)
    estimated_cost_usd = Column(Numeric(10, 4))
    actual_cost_usd = Column(Numeric(10, 4))
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    error_log = Column(JSONB)
    metadata_json = Column("metadata", JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
