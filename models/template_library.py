from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from models.database import Base


class RenderTemplate(Base):
    __tablename__ = "render_templates"

    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    target_schema_id = Column(Integer, ForeignKey("scripture_schemas.id", ondelete="SET NULL"), nullable=True, index=True)
    target_level = Column(String(120), nullable=True, index=True)
    visibility = Column(String(20), nullable=False, default="private", index=True)
    is_system = Column(Boolean, nullable=False, default=False, index=True)
    system_key = Column(String(160), nullable=True, index=True, unique=True)
    liquid_template = Column(Text, nullable=False)
    current_version = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_render_templates_owner_name"),
    )


class RenderTemplateVersion(Base):
    __tablename__ = "render_template_versions"

    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, ForeignKey("render_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    liquid_template = Column(Text, nullable=False)
    change_note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("template_id", "version", name="uq_render_template_versions_template_version"),
    )


class RenderTemplateAssignment(Base):
    __tablename__ = "render_template_assignments"

    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False, index=True)
    entity_id = Column(Integer, nullable=False, index=True)
    level_key = Column(String(120), nullable=False, default="", index=True)
    template_id = Column(Integer, ForeignKey("render_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    template_version_id = Column(
        Integer,
        ForeignKey("render_template_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    priority = Column(Integer, nullable=False, default=100)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "owner_id",
            "entity_type",
            "entity_id",
            "level_key",
            name="uq_render_template_assignments_scope",
        ),
    )
