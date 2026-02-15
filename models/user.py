from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from models.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True)
    password_hash = Column(String(255))
    full_name = Column(String(255))
    role = Column(String(50), default="viewer")
    permissions = Column(
        JSONB,
        default=lambda: {
            "can_view": True,
            "can_contribute": False,
            "can_edit": False,
            "can_moderate": False,
            "can_admin": False,
        },
    )
    oauth_provider = Column(String(50))
    oauth_id = Column(String(255))
    contribution_count = Column(Integer, default=0)
    approved_count = Column(Integer, default=0)
    reputation_score = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True))
