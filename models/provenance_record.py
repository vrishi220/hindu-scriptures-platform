from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from models.database import Base


class ProvenanceRecord(Base):
    __tablename__ = "provenance_records"

    id = Column(Integer, primary_key=True)
    target_book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    target_node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    source_book_id = Column(Integer, ForeignKey("books.id", ondelete="SET NULL"), nullable=True, index=True)
    source_node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="SET NULL"), nullable=True)
    source_type = Column(String(50), nullable=False, default="library_reference")
    source_author = Column(Text, nullable=True)
    license_type = Column(String(100), nullable=False, default="CC-BY-SA-4.0")
    source_version = Column(String(120), nullable=False, default="unknown")
    inserted_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    draft_section = Column(String(20), nullable=False, default="body")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
