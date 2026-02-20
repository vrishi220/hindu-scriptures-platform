from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from models.database import Base


class BookShare(Base):
    __tablename__ = "book_shares"

    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    shared_with_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    permission = Column(String(20), nullable=False, default="viewer")
    shared_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("book_id", "shared_with_user_id", name="uq_book_shares_book_user"),
        CheckConstraint(
            "permission IN ('viewer', 'contributor', 'editor')",
            name="ck_book_shares_permission",
        ),
    )
