from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, field_validator


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


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)

    @field_validator("new_password")
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


PrimaryLanguage = Literal["sanskrit", "english"]


class BookBase(BaseModel):
    schema_id: int | None = None
    book_name: str
    book_code: str | None = None
    language_primary: PrimaryLanguage = "sanskrit"
    metadata: dict | None = Field(default=None, alias="metadata_json")
    status: Literal["draft", "published"] = "draft"
    visibility: Literal["private", "public"] = "private"


class BookCreate(BookBase):
    pass


class BookUpdate(BaseModel):
    schema_id: int | None = None
    book_name: str | None = None
    book_code: str | None = None
    language_primary: PrimaryLanguage | None = None
    metadata: dict | None = None
    status: Literal["draft", "published"] | None = None
    visibility: Literal["private", "public"] | None = None


class BookPublic(BookBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    schema_: ScriptureSchemaPublic | None = Field(
        default=None,
        validation_alias=AliasChoices("schema", "schema_"),
        serialization_alias="schema",
    )


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
    show_only_preferred_script: bool = False


class UserPreferenceUpdate(BaseModel):
    source_language: str | None = None
    transliteration_enabled: bool | None = None
    transliteration_script: str | None = None
    show_roman_transliteration: bool | None = None
    show_only_preferred_script: bool | None = None


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


class DraftBookBase(BaseModel):
    title: str
    description: str | None = None
    section_structure: dict = Field(
        default_factory=lambda: {"front": [], "body": [], "back": []}
    )


class DraftBookCreate(DraftBookBase):
    pass


class AdminDraftBookCreate(BaseModel):
    owner_id: int | None = None
    title: str = "Admin Test Draft"
    description: str | None = "Created by admin for testing"
    section_structure: dict = Field(
        default_factory=lambda: {"front": [], "body": [], "back": []}
    )


class DraftBookUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    section_structure: dict | None = None


class DraftBookPublic(DraftBookBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    status: Literal["draft", "published"]
    created_at: datetime
    updated_at: datetime


class EditionSnapshotCreate(BaseModel):
    version: int | None = None
    snapshot_data: dict | None = None


class DraftPublishCreate(BaseModel):
    version: int | None = None
    snapshot_data: dict | None = None


class EditionSnapshotPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    draft_book_id: int
    owner_id: int
    version: int
    snapshot_data: dict
    immutable: bool
    created_at: datetime


class DraftLicensePolicyIssue(BaseModel):
    source_node_id: int
    license_type: str
    policy_action: Literal["warn", "block"]


class DraftLicensePolicyReport(BaseModel):
    status: Literal["pass", "warn", "block"]
    warning_issues: list[DraftLicensePolicyIssue] = Field(default_factory=list)
    blocked_issues: list[DraftLicensePolicyIssue] = Field(default_factory=list)


class DraftProvenanceAppendixEntry(BaseModel):
    section: Literal["front", "body", "back"]
    source_node_id: int
    source_book_id: int | None = None
    title: str
    source_author: str | None = None
    license_type: str
    source_version: str


class DraftProvenanceAppendix(BaseModel):
    entries: list[DraftProvenanceAppendixEntry] = Field(default_factory=list)


class DraftPublishPublic(BaseModel):
    snapshot: EditionSnapshotPublic
    license_policy: DraftLicensePolicyReport
    provenance_appendix: DraftProvenanceAppendix


class DraftRevisionEventPublic(BaseModel):
    sequence: int
    event_type: Literal["draft.created", "snapshot.created"]
    entity_type: Literal["draft_book", "edition_snapshot"]
    entity_id: int
    draft_book_id: int
    actor_user_id: int | None = None
    occurred_at: datetime
    snapshot_id: int | None = None
    snapshot_version: int | None = None
    immutable: bool | None = None
    metadata: dict = Field(default_factory=dict)


class DraftRevisionFeedPublic(BaseModel):
    draft_book_id: int
    events: list[DraftRevisionEventPublic] = Field(default_factory=list)


class SnapshotRenderBlock(BaseModel):
    section: Literal["front", "body", "back"]
    order: int
    block_type: str
    template_key: str
    resolved_template_source: str | None = None
    source_node_id: int | None = None
    source_book_id: int | None = None
    title: str
    resolved_metadata: dict = Field(default_factory=dict)
    content: dict = Field(default_factory=dict)


class SnapshotRenderSections(BaseModel):
    front: list[SnapshotRenderBlock] = Field(default_factory=list)
    body: list[SnapshotRenderBlock] = Field(default_factory=list)
    back: list[SnapshotRenderBlock] = Field(default_factory=list)


class SnapshotRenderSettings(BaseModel):
    show_sanskrit: bool = True
    show_transliteration: bool = True
    show_english: bool = True
    show_metadata: bool = True
    text_order: list[Literal["sanskrit", "transliteration", "english", "text"]] = Field(
        default_factory=lambda: ["sanskrit", "transliteration", "english", "text"]
    )


class SnapshotTemplateMetadata(BaseModel):
    template_family: str = "default.content_item"
    template_version: str = "v1"
    block_template_pattern: str = "default.{section}.content_item.v1"
    renderer: str = "edition_snapshot_renderer"
    output_profile: str = "reader_pdf_parity_v1"


class SnapshotRenderArtifactPublic(BaseModel):
    snapshot_id: int
    draft_book_id: int
    version: int
    section_order: list[Literal["front", "body", "back"]] = Field(
        default_factory=lambda: ["front", "body", "back"]
    )
    sections: SnapshotRenderSections
    render_settings: SnapshotRenderSettings = Field(default_factory=SnapshotRenderSettings)
    template_metadata: SnapshotTemplateMetadata = Field(default_factory=SnapshotTemplateMetadata)


class DraftPreviewRenderRequest(BaseModel):
    snapshot_data: dict | None = None
    session_template_bindings: dict | None = None


class DraftPreviewRenderArtifactPublic(BaseModel):
    draft_book_id: int
    section_order: list[Literal["front", "body", "back"]] = Field(
        default_factory=lambda: ["front", "body", "back"]
    )
    sections: SnapshotRenderSections
    render_settings: SnapshotRenderSettings = Field(default_factory=SnapshotRenderSettings)
    template_metadata: SnapshotTemplateMetadata = Field(default_factory=SnapshotTemplateMetadata)
    preview_mode: Literal["session", "draft"] = "session"
    warnings: list[str] = Field(default_factory=list)


class BookPreviewRenderRequest(BaseModel):
    node_id: int | None = Field(default=None, ge=1)
    session_template_bindings: dict | None = None
    render_settings: dict | None = None
    metadata_bindings: dict | None = None


class BookPreviewRenderSections(BaseModel):
    body: list[SnapshotRenderBlock] = Field(default_factory=list)


class BookPreviewTemplatePublic(BaseModel):
    template_key: str
    resolved_template_source: str
    rendered_text: str
    child_count: int


class BookPreviewRenderArtifactPublic(BaseModel):
    book_id: int
    book_name: str
    preview_scope: Literal["book", "node"] = "book"
    root_node_id: int | None = None
    root_title: str | None = None
    section_order: list[Literal["body"]] = Field(default_factory=lambda: ["body"])
    sections: BookPreviewRenderSections
    book_template: BookPreviewTemplatePublic | None = None
    render_settings: SnapshotRenderSettings = Field(default_factory=SnapshotRenderSettings)
    template_metadata: SnapshotTemplateMetadata = Field(default_factory=SnapshotTemplateMetadata)
    preview_mode: Literal["book"] = "book"
    warnings: list[str] = Field(default_factory=list)


class ProvenanceRecordPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_book_id: int
    target_node_id: int
    source_book_id: int | None = None
    source_node_id: int | None = None
    source_type: str
    source_author: str | None = None
    license_type: str
    source_version: str
    inserted_by: int | None = None
    draft_section: str
    created_at: datetime


# === Phase 0.3: Collection Cart (Editor's Shopping Basket) ===
class CollectionCartItemBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_id: int
    item_type: Literal["library_node", "user_content"]
    source_book_id: int | None = None
    order: int = 0
    metadata: dict | None = Field(
        default=None,
        validation_alias=AliasChoices("metadata", "item_metadata"),
    )


class CollectionCartItemCreate(CollectionCartItemBase):
    pass


class CollectionCartItemPublic(CollectionCartItemBase):
    id: int
    cart_id: int
    added_at: datetime
    updated_at: datetime


class CollectionCartBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    title: str = "My Collection"
    description: str | None = None


class CollectionCartCreate(CollectionCartBase):
    pass


class CollectionCartUpdate(BaseModel):
    title: str | None = None
    description: str | None = None


class CollectionCartPublic(CollectionCartBase):
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    items: list[CollectionCartItemPublic] = Field(default_factory=list)


class CartDraftBodyReference(BaseModel):
    source_book_id: int
    source_scope: Literal["book"] = "book"
    order: int
    title: str


class CartDraftComposeBodyPublic(BaseModel):
    cart_id: int
    section_structure: dict = Field(
        default_factory=lambda: {"front": [], "body": [], "back": []}
    )
    body_references: list[CartDraftBodyReference] = Field(default_factory=list)
    skipped_item_count: int = 0


class CartCreateDraftRequest(BaseModel):
    title: str
    description: str | None = None
    clear_cart_after_create: bool = False
