"""Property Definition and Category system for schema-governed metadata.

Supports:
- Typed property definitions (text, boolean, number, dropdown)
- Named categories as reusable property sets
- Hierarchical categories with inheritance (including multiple parents)
- Dynamic metadata binding at book/level/node scopes
- Validation against schema constraints
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Boolean,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from models.database import Base


class PropertyDefinition(Base):
    """Schema property definition with type and validation rules."""

    __tablename__ = "property_definitions"

    id = Column(Integer, primary_key=True)
    internal_name = Column(String(255), nullable=False, unique=True, index=True)
    display_name = Column(String(255), nullable=False)
    data_type = Column(
        Enum("text", "boolean", "number", "dropdown", "date", "datetime", name="property_data_type"),
        nullable=False,
        default="text",
    )
    description = Column(Text, nullable=True)
    default_value = Column(JSONB, nullable=True)  # JSON-serializable default; required when is_required=True
    is_required = Column(Boolean, default=False, nullable=False)
    is_system = Column(Boolean, default=False, nullable=False, index=True)
    is_deprecated = Column(Boolean, default=False, nullable=False, index=True)
    deprecated_at = Column(DateTime(timezone=True), nullable=True)
    dropdown_options = Column(ARRAY(String), nullable=True)  # For data_type=dropdown
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    category_properties = relationship("CategoryProperty", back_populates="property_definition", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<PropertyDefinition internal_name={self.internal_name} type={self.data_type}>"


class Category(Base):
    """Named set of properties with optional hierarchical inheritance."""

    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    applicable_scopes = Column(ARRAY(String), nullable=False, default=["book"])  # Book + every concrete level scope (chapter, verse, etc.)
    version = Column(Integer, default=1, nullable=False)
    is_system = Column(Boolean, default=False, nullable=False, index=True)
    is_published = Column(Boolean, default=False, nullable=False, index=True)
    is_deprecated = Column(Boolean, default=False, nullable=False, index=True)
    deprecated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    category_properties = relationship("CategoryProperty", back_populates="category", cascade="all, delete-orphan")
    metadata_bindings = relationship("MetadataBinding", back_populates="category", cascade="all, delete-orphan")
    parent_edges = relationship(
        "CategoryParent",
        foreign_keys="CategoryParent.child_category_id",
        cascade="all, delete-orphan",
    )
    child_edges = relationship(
        "CategoryParent",
        foreign_keys="CategoryParent.parent_category_id",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Category name={self.name} version={self.version} published={self.is_published}>"


class CategoryProperty(Base):
    """Association of property definition to category with customization."""

    __tablename__ = "category_properties"

    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    property_definition_id = Column(Integer, ForeignKey("property_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    order = Column(Integer, default=0, nullable=False)
    description_override = Column(Text, nullable=True)  # Category-specific label/help text
    default_override = Column(JSONB, nullable=True)  # Override property's default per category
    is_required_override = Column(Boolean, nullable=True)  # Override required status per category
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("category_id", "property_definition_id", name="uc_category_property"),
    )

    # Relationships
    category = relationship("Category", back_populates="category_properties")
    property_definition = relationship("PropertyDefinition", back_populates="category_properties")

    def __repr__(self) -> str:
        return f"<CategoryProperty category_id={self.category_id} property_id={self.property_definition_id}>"


class MetadataBinding(Base):
    """Binding of category and property overrides at specific scope (book/level/node)."""

    __tablename__ = "metadata_bindings"

    id = Column(Integer, primary_key=True)
    entity_type = Column(String(50), nullable=False, index=True)  # "book", "level", "node", "draft_book_section"
    entity_id = Column(Integer, nullable=False, index=True)  # FK context (book_id, level_id, node_id, draft_id, etc.)
    root_entity_id = Column(Integer, nullable=True, index=True)  # Draft/book root id for cross-scope validation on publish
    scope_key = Column(String(120), nullable=True, index=True)  # Optional key for scoped bindings (e.g., level_name="chapter")
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True)
    scope_type = Column(
        Enum("global", "book", "level", "node", name="metadata_scope_type"),
        nullable=False,
        default="book",
        index=True,
    )
    property_overrides = Column(JSONB, nullable=False, default=dict)  # {internal_name: value}
    unset_overrides = Column(ARRAY(String), nullable=False, default=list)  # Explicit fallback to inherited/default for listed internal names
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    category = relationship("Category", back_populates="metadata_bindings")

    def __repr__(self) -> str:
        return f"<MetadataBinding {self.entity_type}:{self.entity_id} scope={self.scope_type}>"


class CategoryParent(Base):
    """Multiple-parent inheritance edges for categories. Child wins on conflicts."""

    __tablename__ = "category_parents"

    id = Column(Integer, primary_key=True)
    child_category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    precedence_order = Column(Integer, default=0, nullable=False)  # lower value merged first
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("child_category_id", "parent_category_id", name="uc_category_parent_edge"),
    )

    def __repr__(self) -> str:
        return (
            f"<CategoryParent child={self.child_category_id} "
            f"parent={self.parent_category_id} order={self.precedence_order}>"
        )
