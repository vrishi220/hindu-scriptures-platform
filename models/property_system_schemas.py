"""Pydantic schemas for property definitions and categories."""

from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Literal


# ============================================================================
# Property Definition Schemas
# ============================================================================


class PropertyDefinitionBase(BaseModel):
    internal_name: str = Field(..., min_length=1, max_length=255, description="Stable internal property name (e.g., 'is_transliterable')")
    display_name: str = Field(..., min_length=1, max_length=255, description="UI display label (e.g., 'Is Transliterable')")
    data_type: Literal["text", "boolean", "number", "dropdown", "date", "datetime"] = Field(default="text")
    description: str | None = None
    default_value: dict | str | bool | float | None = None
    is_required: bool = False
    dropdown_options: list[str] | None = None

    @model_validator(mode="after")
    def validate_required_default_and_dropdown(self):
        if self.is_required and self.default_value is None:
            raise ValueError("Required properties must define a non-null default_value")
        if self.data_type == "dropdown":
            if not self.dropdown_options or not isinstance(self.dropdown_options, list):
                raise ValueError("Dropdown properties must define dropdown_options")
            if self.default_value is not None and self.default_value not in self.dropdown_options:
                raise ValueError("Dropdown default_value must be one of dropdown_options")
        return self


class PropertyDefinitionCreate(PropertyDefinitionBase):
    pass


class PropertyDefinitionUpdate(BaseModel):
    internal_name: str | None = None
    display_name: str | None = None
    data_type: Literal["text", "boolean", "number", "dropdown", "date", "datetime"] | None = None
    description: str | None = None
    default_value: dict | str | bool | float | None = None
    is_required: bool | None = None
    dropdown_options: list[str] | None = None


class PropertyDefinitionPublic(PropertyDefinitionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_system: bool
    created_at: str
    updated_at: str


# ============================================================================
# Category Schemas
# ============================================================================


class CategoryPropertyBindingBase(BaseModel):
    """Property binding within a category."""

    property_definition_id: int
    order: int = 0
    description_override: str | None = None
    default_override: dict | str | bool | int | float | None = None
    is_required_override: bool | None = None


class CategoryPropertyBindingPublic(CategoryPropertyBindingBase):
    """Public view of property binding (includes resolved property details)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    property_internal_name: str = Field(description="From property_definition.internal_name")
    property_display_name: str = Field(description="From property_definition.display_name")
    property_data_type: str = Field(description="From property_definition.data_type")
    property_description: str | None = None


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    parent_category_ids: list[int] = Field(default_factory=list)
    applicable_scopes: list[str] = Field(default_factory=lambda: ["book"])  # plus concrete level scopes like chapter/verse


class CategoryCreate(CategoryBase):
    properties: list[CategoryPropertyBindingBase] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_no_duplicate_property_definition_ids(self):
        identifiers = [item.property_definition_id for item in self.properties]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Category cannot include duplicate properties")
        return self


class CategoryUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    parent_category_ids: list[int] | None = None
    applicable_scopes: list[str] | None = None
    # Properties must be managed separately via category-properties endpoints


class CategoryPublic(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: int
    is_system: bool
    is_published: bool
    created_at: str
    updated_at: str


class CategoryWithPropertiesPublic(CategoryPublic):
    """Category with all properties and inheritance chain."""

    properties: list[CategoryPropertyBindingPublic] = Field(default_factory=list)
    parent_category: "CategoryPublic | None" = None
    child_categories: list["CategoryPublic"] = Field(default_factory=list)


# Update forward refs
CategoryWithPropertiesPublic.model_rebuild()


# ============================================================================
# Category Effective Properties (Resolved including inheritance)
# ============================================================================


class EffectivePropertyBindingPublic(BaseModel):
    """Resolved property binding including inheritance chain."""

    property_internal_name: str
    property_display_name: str
    property_data_type: str
    description: str | None = None
    order: int = 0
    default_value: dict | str | bool | float | None = None
    is_required: bool = False
    dropdown_options: list[str] | None = None
    # Trace of which category in hierarchy provided this value
    provided_by_category_id: int | None = None
    provided_by_category_name: str | None = None


class CategoryEffectivePropertiesPublic(BaseModel):
    """Effective (resolved) properties for a category including inherited."""

    category_id: int
    category_name: str
    properties: list[EffectivePropertyBindingPublic]
    inheritance_chain: list[dict] = Field(
        default_factory=list,
        description="[{id, name}, ...] from root to this category",
    )


# ============================================================================
# Metadata Binding Schemas
# ============================================================================


class MetadataBindingPropertyOverride(BaseModel):
    """Single property override in a binding."""

    property_internal_name: str
    value: dict | str | bool | float | None


class MetadataBindingBase(BaseModel):
    category_id: int | None = None
    scope_key: str | None = None
    property_overrides: dict | None = Field(default_factory=dict)  # {property_internal_name: value}
    unset_overrides: list[str] = Field(default_factory=list)  # Explicit fallback to inherited/default


class MetadataBindingCreate(MetadataBindingBase):
    pass


class MetadataBindingUpdate(BaseModel):
    category_id: int | None = None
    property_overrides: dict | None = None
    unset_overrides: list[str] | None = None


class MetadataBindingPublic(MetadataBindingBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_type: str
    entity_id: int
    root_entity_id: int | None = None
    scope_type: str
    created_at: str
    updated_at: str


class ResolvedPropertyValue(BaseModel):
    """Property value resolved from precedence hierarchy."""

    property_internal_name: str
    property_display_name: str
    property_data_type: str
    value: dict | str | bool | float | None
    # Trace showing which scope level provided this value
    resolved_from_scope: str | None = None  # "node", "level", "book", "global", "category_default", "property_default"
    resolved_from_category: str | None = None


class ResolvedMetadataPublic(BaseModel):
    """Fully resolved metadata for a scope, including effective properties."""

    entity_type: str
    entity_id: int
    scope_type: str
    category_id: int | None = None
    category_name: str | None = None
    # All resolved properties with traces
    properties: list[ResolvedPropertyValue] = Field(default_factory=list)
    # Raw overrides at this scope
    property_overrides: dict = Field(default_factory=dict)
    unset_overrides: list[str] = Field(default_factory=list)
    resolved_at: str
