from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class HealthResponse(BaseModel):
    status: str


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    username: str | None = Field(default=None, min_length=3, max_length=100)
    full_name: str | None = Field(default=None, max_length=255)

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 bytes or fewer")
        return value


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 bytes or fewer")
        return value


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class MessageResponse(BaseModel):
    message: str


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    username: str | None = None
    full_name: str | None = None
    role: str
    permissions: dict | None = None
    is_active: bool = True


class UserAdminCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    username: str | None = Field(default=None, min_length=3, max_length=100)
    full_name: str | None = Field(default=None, max_length=255)
    role: str | None = None
    permissions: dict | None = None

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 bytes or fewer")
        return value


class UserPermissionsUpdate(BaseModel):
    can_view: bool | None = None
    can_contribute: bool | None = None
    can_edit: bool | None = None
    can_moderate: bool | None = None
    can_admin: bool | None = None
    role: str | None = None


class ScriptureSchemaBase(BaseModel):
    name: str
    description: str | None = None
    levels: list[str]


class ScriptureSchemaCreate(ScriptureSchemaBase):
    pass


class ScriptureSchemaUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    levels: list[str] | None = None


class ScriptureSchemaPublic(ScriptureSchemaBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class BookBase(BaseModel):
    schema_id: int | None = None
    book_name: str
    book_code: str | None = None
    language_primary: str = "sanskrit"
    metadata: dict | None = Field(default=None, alias="metadata_json")
    status: Literal["draft", "published"] = "draft"
    visibility: Literal["private", "public"] = "private"


class BookCreate(BookBase):
    pass


class BookUpdate(BaseModel):
    schema_id: int | None = None
    book_name: str | None = None
    book_code: str | None = None
    language_primary: str | None = None
    metadata: dict | None = None
    status: Literal["draft", "published"] | None = None
    visibility: Literal["private", "public"] | None = None


class BookPublic(BookBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    schema: ScriptureSchemaPublic | None = None


class BookShareCreate(BaseModel):
    email: EmailStr
    permission: Literal["viewer", "contributor", "editor"] = "viewer"


class BookShareUpdate(BaseModel):
    permission: Literal["viewer", "contributor", "editor"]


class BookSharePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    shared_with_user_id: int
    permission: Literal["viewer", "contributor", "editor"]
    shared_by_user_id: int | None = None
    shared_with_email: EmailStr
    shared_with_username: str | None = None


class ContentNodeBase(BaseModel):
    book_id: int
    parent_node_id: int | None = None
    referenced_node_id: int | None = None
    level_name: str
    level_order: int
    sequence_number: str | None = None
    title_sanskrit: str | None = None
    title_transliteration: str | None = None
    title_english: str | None = None
    title_hindi: str | None = None
    title_tamil: str | None = None
    has_content: bool = False
    content_data: dict | None = None
    summary_data: dict | None = None
    source_attribution: str | None = None
    license_type: str = "CC-BY-SA-4.0"
    original_source_url: str | None = None
    tags: list | None = None


class ContentNodeCreate(ContentNodeBase):
    pass


class ContentNodeUpdate(BaseModel):
    parent_node_id: int | None = None
    referenced_node_id: int | None = None
    level_name: str | None = None
    level_order: int | None = None
    sequence_number: str | None = None
    title_sanskrit: str | None = None
    title_transliteration: str | None = None
    title_english: str | None = None
    title_hindi: str | None = None
    title_tamil: str | None = None
    has_content: bool | None = None
    content_data: dict | None = None
    summary_data: dict | None = None
    metadata_json: dict | None = None
    source_attribution: str | None = None
    license_type: str | None = None
    original_source_url: str | None = None
    tags: list | None = None
    # Phase 1: Draft workflow
    status: str | None = None  # draft, published, archived
    visibility: str | None = None  # private, draft, published, archived
    language_code: str | None = None
    edit_reason: str | None = None  # Reason for edit (included in version history)


class ContentNodePublic(ContentNodeBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_by: int | None = None
    last_modified_by: int | None = None


class ContentNodeTree(ContentNodePublic):
    children: list["ContentNodeTree"] = Field(default_factory=list)


class SearchRequest(BaseModel):
    text: str
    book_id: int | None = None
    level_name: str | None = None
    has_content: bool | None = None
    limit: int = Field(default=20, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class SearchResult(BaseModel):
    node: ContentNodePublic
    snippet: str | None = None


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchResult]


class MediaFilePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_id: int
    media_type: str
    url: str
    metadata: dict | None = Field(default=None, alias="metadata_json")
    created_at: datetime | None = None


# === Phase 1: User Preferences ===
class UserPreferenceBase(BaseModel):
    source_language: str = "en"
    transliteration_enabled: bool = True
    transliteration_script: str = "devanagari"
    show_roman_transliteration: bool = True


class UserPreferenceUpdate(BaseModel):
    source_language: str | None = None
    transliteration_enabled: bool | None = None
    transliteration_script: str | None = None
    show_roman_transliteration: bool | None = None


class UserPreferencePublic(UserPreferenceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


# === Phase 1: Compilations (Book Assembly) ===
class CompilationBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str
    description: str | None = None
    schema_type: str | None = None  # e.g., 'bhagavad_gita', 'ramayana', 'custom'
    items: list[dict] = Field(default_factory=list)  # [{node_id, order}, ...]
    metadata: dict | None = Field(default=None, alias="compilation_metadata")


class CompilationCreate(CompilationBase):
    status: str | None = "draft"  # draft or published
    is_public: bool = False


class CompilationUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    schema_type: str | None = None
    items: list[dict] | None = None
    metadata: dict | None = None
    status: str | None = None
    is_public: bool | None = None


class CompilationPublic(CompilationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    creator_id: int
    status: str
    is_public: bool
    created_at: datetime
    updated_at: datetime
