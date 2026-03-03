from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RenderTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    owner_id: int | None = None
    description: str | None = None
    target_schema_id: int = Field(gt=0)
    target_level: str = Field(min_length=1, max_length=120)
    visibility: Literal["private", "published"] = "private"
    liquid_template: str = Field(min_length=1)
    change_note: str | None = None


class RenderTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    owner_id: int | None = None
    description: str | None = None
    target_schema_id: int | None = Field(default=None, gt=0)
    target_level: str | None = Field(default=None, min_length=1, max_length=120)
    visibility: Literal["private", "published"] | None = None
    liquid_template: str | None = Field(default=None, min_length=1)
    change_note: str | None = None
    is_active: bool | None = None


class RenderTemplateVersionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_id: int
    version: int
    liquid_template: str
    change_note: str | None = None
    created_by: int | None = None
    created_at: datetime


class RenderTemplatePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: str
    description: str | None = None
    target_schema_id: int | None = None
    target_level: str | None = None
    visibility: Literal["private", "published"] = "private"
    is_system: bool = False
    system_key: str | None = None
    liquid_template: str
    current_version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class RenderTemplateAssignmentCreate(BaseModel):
    entity_type: str = Field(min_length=1, max_length=50)
    entity_id: int
    level_key: str | None = Field(default=None, max_length=120)
    template_id: int
    template_version_id: int | None = None
    priority: int = 100
    is_active: bool = True


class RenderTemplateAssignmentUpdate(BaseModel):
    template_id: int | None = None
    template_version_id: int | None = None
    priority: int | None = None
    is_active: bool | None = None


class RenderTemplateAssignmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    entity_type: str
    entity_id: int
    level_key: str
    template_id: int
    template_version_id: int | None = None
    priority: int
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class RenderTemplateResolvePublic(BaseModel):
    assignment: RenderTemplateAssignmentPublic
    template: RenderTemplatePublic
    resolved_version: RenderTemplateVersionPublic | None = None
