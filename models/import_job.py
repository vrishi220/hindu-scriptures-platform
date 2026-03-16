from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class ImportJob(Base):
    __tablename__ = "import_jobs"

    job_id = Column(String(64), primary_key=True)
    status = Column(String(20), nullable=False, index=True)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    canonical_json_url = Column(Text)
    canonical_book_code = Column(String(255), index=True)
    payload_json = Column(JSONB, nullable=False)
    progress_message = Column(Text)
    progress_current = Column(Integer)
    progress_total = Column(Integer)
    error = Column(Text)
    result_json = Column(JSONB)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
