from datetime import datetime
import re
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, field_validator
from services.transliteration import latin_to_devanagari, latin_to_iast


WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES = {"sa", "pi", "hi", "ta"}
WORD_MEANINGS_REQUIRED_LANGUAGES = {"en"}
WORD_MEANINGS_MAX_ROWS = 400
WORD_MEANINGS_MAX_SOURCE_CHARS = 120
WORD_MEANINGS_MAX_MEANING_CHARS = 400
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
DEVANAGARI_PATTERN = re.compile(r"[\u0900-\u097F]")


class HealthResponse(BaseModel):
    status: str


def _validate_password_strength(value: str) -> str:
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be 72 bytes or fewer")
    if not re.search(r"[A-Z]", value):
        raise ValueError("Password must include at least one uppercase letter")
    if not re.search(r"[a-z]", value):
        raise ValueError("Password must include at least one lowercase letter")
    if not re.search(r"[0-9]", value):
        raise ValueError("Password must include at least one number")
    if not re.search(r"[^A-Za-z0-9]", value):
        raise ValueError("Password must include at least one special character")
    return value


def _trimmed_string(value: object, path: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{path} must be a string")
    return value.strip()


def _validate_plain_text(value: object, path: str, max_chars: int) -> str:
    text = _trimmed_string(value, path)
    if len(text) > max_chars:
        raise ValueError(f"{path} exceeds max length of {max_chars}")
    if HTML_TAG_PATTERN.search(text):
        raise ValueError(f"{path} must not contain HTML")
    return text


def _normalize_word_meanings_language_key(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if normalized == "english":
        return "en"
    return normalized


def _split_legacy_word_meanings_entries(text: object) -> list[str]:
    if not isinstance(text, str):
        return []
    entries: list[str] = []
    for raw_part in text.split(";"):
        cleaned = raw_part.strip()
        if not cleaned:
            continue
        cleaned = re.sub(r"^\d+\.\s*", "", cleaned)
        if cleaned:
            entries.append(cleaned)
    return entries


def _word_meanings_is_effectively_empty(word_meanings: dict) -> bool:
    if not isinstance(word_meanings, dict):
        return True

    rows = word_meanings.get("rows")
    if isinstance(rows, list):
        return len(rows) == 0

    for raw_value in word_meanings.values():
        if isinstance(raw_value, str) and raw_value.strip():
            return False
        if isinstance(raw_value, list) and raw_value:
            return False
        if isinstance(raw_value, dict) and raw_value:
            return False
    return True


def _legacy_word_meanings_source_payload(source_text: str) -> dict:
    if DEVANAGARI_PATTERN.search(source_text):
        return {
            "language": "sa",
            "script_text": source_text,
        }

    script_text = latin_to_devanagari(source_text)
    normalized_iast = latin_to_iast(source_text) or source_text
    payload = {
        "language": "sa",
        "transliteration": {
            "iast": normalized_iast,
        },
    }
    if script_text:
        payload["script_text"] = script_text
    return payload


def _normalize_legacy_word_meanings_payload(word_meanings: dict) -> dict:
    legacy_entries_by_language: dict[str, list[str]] = {}
    for raw_language, raw_text in word_meanings.items():
        language = _normalize_word_meanings_language_key(raw_language)
        if not language:
            continue
        entries = _split_legacy_word_meanings_entries(raw_text)
        if entries:
            legacy_entries_by_language[language] = entries

    if not legacy_entries_by_language:
        return word_meanings

    primary_language = "en" if "en" in legacy_entries_by_language else next(iter(legacy_entries_by_language.keys()))
    primary_entries = legacy_entries_by_language.get(primary_language, [])
    rows: list[dict] = []

    for index, entry in enumerate(primary_entries):
        source_text = ""
        primary_meaning_text = entry
        if "=" in entry:
            source_text, primary_meaning_text = entry.split("=", 1)
            source_text = source_text.strip()
            primary_meaning_text = primary_meaning_text.strip()
        else:
            primary_meaning_text = entry.strip()

        meanings: dict[str, dict[str, str]] = {}
        for language, entries in legacy_entries_by_language.items():
            if index >= len(entries):
                continue
            language_entry = entries[index]
            _, _, meaning_text = language_entry.partition("=")
            normalized_meaning = (meaning_text if meaning_text else language_entry).strip()
            if normalized_meaning:
                meanings[language] = {"text": normalized_meaning}

        if "en" not in meanings and primary_meaning_text:
            meanings["en"] = {"text": primary_meaning_text}

        if not source_text and primary_meaning_text:
            source_text = f"term_{index + 1}"

        rows.append(
            {
                "id": f"legacy_wm_{index + 1}",
                "order": index + 1,
                "source": _legacy_word_meanings_source_payload(source_text),
                "meanings": meanings,
            }
        )

    return {
        "version": "1.0",
        "rows": rows,
    }


def _normalize_word_meanings_payload(word_meanings: dict) -> dict:
    rows = word_meanings.get("rows")
    if rows is not None:
        # Has a 'rows' key — treat as structured format.
        # If rows is a valid list, backfill 'version' if missing.
        # If rows is wrong type, return as-is so validation can reject it.
        if isinstance(rows, list):
            if isinstance(word_meanings.get("version"), str):
                return word_meanings
            return {"version": "1.0", **word_meanings}
        return word_meanings
    return _normalize_legacy_word_meanings_payload(word_meanings)


def _validate_word_meanings_content_data(content_data: dict | None) -> dict | None:
    if content_data is None:
        return None
    if not isinstance(content_data, dict):
        raise ValueError("content_data must be an object")

    word_meanings = content_data.get("word_meanings")
    if word_meanings is None:
        return content_data
    if not isinstance(word_meanings, dict):
        raise ValueError("content_data.word_meanings must be an object")

    if _word_meanings_is_effectively_empty(word_meanings):
        content_data = dict(content_data)
        content_data.pop("word_meanings", None)
        return content_data

    content_data = dict(content_data)
    word_meanings = _normalize_word_meanings_payload(word_meanings)
    content_data["word_meanings"] = word_meanings

    if _word_meanings_is_effectively_empty(word_meanings):
        content_data.pop("word_meanings", None)
        return content_data

    version = word_meanings.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ValueError("content_data.word_meanings.version is required")

    rows = word_meanings.get("rows")
    if not isinstance(rows, list):
        raise ValueError("content_data.word_meanings.rows must be an array")
    if len(rows) > WORD_MEANINGS_MAX_ROWS:
        raise ValueError(
            f"content_data.word_meanings.rows exceeds max size of {WORD_MEANINGS_MAX_ROWS}"
        )

    seen_ids: set[str] = set()
    for index, row in enumerate(rows):
        row_path = f"content_data.word_meanings.rows[{index}]"
        if not isinstance(row, dict):
            raise ValueError(f"{row_path} must be an object")

        row_id = row.get("id")
        if not isinstance(row_id, str) or not row_id.strip():
            raise ValueError(f"{row_path}.id is required")
        normalized_row_id = row_id.strip()
        if normalized_row_id in seen_ids:
            raise ValueError(f"{row_path}.id must be unique")
        seen_ids.add(normalized_row_id)

        order = row.get("order")
        if not isinstance(order, int) or order < 1:
            raise ValueError(f"{row_path}.order must be an integer >= 1")

        source = row.get("source")
        if not isinstance(source, dict):
            raise ValueError(f"{row_path}.source must be an object")

        source_language = source.get("language")
        if not isinstance(source_language, str) or source_language.strip() not in WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES:
            raise ValueError(
                f"{row_path}.source.language must be one of {sorted(WORD_MEANINGS_ALLOWED_SOURCE_LANGUAGES)}"
            )

        has_source_form = False
        script_text = source.get("script_text")
        if script_text is not None:
            normalized_script_text = _validate_plain_text(
                script_text,
                f"{row_path}.source.script_text",
                WORD_MEANINGS_MAX_SOURCE_CHARS,
            )
            if normalized_script_text:
                has_source_form = True

        transliteration = source.get("transliteration")
        if transliteration is not None:
            if not isinstance(transliteration, dict):
                raise ValueError(f"{row_path}.source.transliteration must be an object")
            for scheme, scheme_value in transliteration.items():
                if not isinstance(scheme, str) or not scheme.strip():
                    raise ValueError(f"{row_path}.source.transliteration keys must be non-empty strings")
                normalized_value = _validate_plain_text(
                    scheme_value,
                    f"{row_path}.source.transliteration.{scheme}",
                    WORD_MEANINGS_MAX_SOURCE_CHARS,
                )
                if normalized_value:
                    has_source_form = True

        if not has_source_form:
            raise ValueError(
                f"{row_path}.source requires at least one non-empty form in script_text or transliteration"
            )

        meanings = row.get("meanings")
        if not isinstance(meanings, dict) or not meanings:
            raise ValueError(f"{row_path}.meanings must be a non-empty object")

        non_empty_meanings = 0
        for language_code, meaning_payload in meanings.items():
            if not isinstance(language_code, str) or not language_code.strip():
                raise ValueError(f"{row_path}.meanings contains an invalid language key")
            if not isinstance(meaning_payload, dict):
                raise ValueError(f"{row_path}.meanings.{language_code} must be an object")

            meaning_text = meaning_payload.get("text")
            normalized_meaning_text = _validate_plain_text(
                meaning_text,
                f"{row_path}.meanings.{language_code}.text",
                WORD_MEANINGS_MAX_MEANING_CHARS,
            )
            if normalized_meaning_text:
                non_empty_meanings += 1

        if non_empty_meanings == 0:
            raise ValueError(f"{row_path}.meanings requires at least one non-empty text value")

        for required_language in WORD_MEANINGS_REQUIRED_LANGUAGES:
            required_payload = meanings.get(required_language)
            if not isinstance(required_payload, dict):
                raise ValueError(f"{row_path}.meanings.{required_language}.text is required")
            required_text = _validate_plain_text(
                required_payload.get("text"),
                f"{row_path}.meanings.{required_language}.text",
                WORD_MEANINGS_MAX_MEANING_CHARS,
            )
            if not required_text:
                raise ValueError(f"{row_path}.meanings.{required_language}.text is required")

    return content_data

    return content_data


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    username: str | None = Field(default=None, min_length=3, max_length=100)
    full_name: str | None = Field(default=None, max_length=255)

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        return _validate_password_strength(value)


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
        return _validate_password_strength(value)


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


class UserSelfUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=100)
    full_name: str | None = Field(default=None, max_length=255)


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
        return _validate_password_strength(value)


class UserPermissionsUpdate(BaseModel):
    can_view: bool | None = None
    can_contribute: bool | None = None
    can_import: bool | None = None
    can_edit: bool | None = None
    can_moderate: bool | None = None
    can_admin: bool | None = None
    role: str | None = None


class ScriptureSchemaBase(BaseModel):
    name: str
    description: str | None = None
    levels: list[str]
    level_template_defaults: dict[str, int] = Field(default_factory=dict)


class ScriptureSchemaCreate(ScriptureSchemaBase):
    pass


class ScriptureSchemaUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    levels: list[str] | None = None
    level_template_defaults: dict[str, int] | None = None


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
    level_name_overrides: dict[str, str] = Field(default_factory=dict)
    variant_authors: dict[str, str] = Field(default_factory=dict)
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
    level_name_overrides: dict[str, str] | None = None
    variant_authors: dict[str, str] | None = None
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
    metadata_json: dict | None = None
    source_attribution: str | None = None
    license_type: str = "CC-BY-SA-4.0"
    original_source_url: str | None = None
    tags: list | None = None

    @field_validator("content_data")
    @classmethod
    def validate_content_data(cls, value: dict | None) -> dict | None:
        return _validate_word_meanings_content_data(value)


class ContentNodeCreate(ContentNodeBase):
    insert_after_node_id: int | None = None


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

    @field_validator("content_data")
    @classmethod
    def validate_content_data(cls, value: dict | None) -> dict | None:
        return _validate_word_meanings_content_data(value)


class ContentNodePublic(ContentNodeBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_by: int | None = None
    last_modified_by: int | None = None


class ContentNodeTree(ContentNodePublic):
    children: list["ContentNodeTree"] = Field(default_factory=list)


class TreeNodeImportItem(BaseModel):
    """Single node in an import tree (from SchemaAwareJSONImporter)."""
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
    metadata_json: dict | None = None
    source_attribution: str | None = None
    original_source_url: str | None = None
    tags: list | None = None
    children: list["TreeNodeImportItem"] = Field(default_factory=list)


class BulkTreeImportRequest(BaseModel):
    """Bulk import tree nodes (e.g., from scripture scraper/importer)."""
    book_id: int
    nodes: list[TreeNodeImportItem]  # Top-level nodes (chapters)
    clear_existing: bool = False  # Clear all existing nodes in book before import
    language_code: str = "en"
    license_type: str = "CC-BY-SA-4.0"


class BulkTreeImportResponse(BaseModel):
    """Summary of tree import operation."""
    success: bool
    book_id: int
    chapters_created: int = 0
    verses_created: int = 0
    total_nodes_created: int = 0
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class BookExchangeSchemaV1(BaseModel):
    id: int | None = None
    name: str | None = None
    description: str | None = None
    levels: list[str] = Field(default_factory=list)
    level_name_overrides: dict[str, str] = Field(default_factory=dict)


class BookExchangeMediaItemV1(BaseModel):
    media_type: str
    url: str
    metadata: dict | None = None


class BookExchangeNodeV1(BaseModel):
    node_id: int
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
    metadata_json: dict | None = None
    source_attribution: str | None = None
    license_type: str = "CC-BY-SA-4.0"
    original_source_url: str | None = None
    tags: list | None = None
    media_items: list[BookExchangeMediaItemV1] = Field(default_factory=list)


class BookExchangeBookV1(BaseModel):
    book_name: str
    book_code: str | None = None
    language_primary: PrimaryLanguage = "sanskrit"
    metadata: dict | None = None
    variant_authors: dict[str, str] = Field(default_factory=dict)


class BookExchangePayloadV1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: Literal["hsp-book-json-v1"] = "hsp-book-json-v1"
    exported_at: datetime | None = None
    source: dict | None = None
    schema_: BookExchangeSchemaV1 = Field(
        validation_alias=AliasChoices("schema", "schema_"),
        serialization_alias="schema",
    )
    book: BookExchangeBookV1
    nodes: list[BookExchangeNodeV1]


class SearchRequest(BaseModel):
    text: str
    book_id: int | None = None
    level_name: str | None = None
    has_content: bool | None = None
    language: str = "en"
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


class MediaAssetPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    media_type: str
    url: str
    metadata: dict | None = Field(default=None, alias="metadata_json")
    created_by: int | None = None
    created_at: datetime | None = None


class CommentaryAuthorBase(BaseModel):
    name: str
    bio: str | None = None
    metadata: dict | None = Field(default=None, alias="metadata_json")


class CommentaryAuthorCreate(CommentaryAuthorBase):
    pass


class CommentaryAuthorUpdate(BaseModel):
    name: str | None = None
    bio: str | None = None
    metadata: dict | None = None


class CommentaryAuthorPublic(CommentaryAuthorBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    created_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CommentaryWorkBase(BaseModel):
    title: str
    author_id: int | None = None
    description: str | None = None
    metadata: dict | None = Field(default=None, alias="metadata_json")


class CommentaryWorkCreate(CommentaryWorkBase):
    pass


class CommentaryWorkUpdate(BaseModel):
    title: str | None = None
    author_id: int | None = None
    description: str | None = None
    metadata: dict | None = None


class CommentaryWorkPublic(CommentaryWorkBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    created_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CommentaryEntryBase(BaseModel):
    node_id: int
    author_id: int | None = None
    work_id: int | None = None
    content_text: str
    language_code: str = "en"
    display_order: int = 0
    metadata: dict | None = Field(default=None, alias="metadata_json")


class CommentaryEntryCreate(CommentaryEntryBase):
    pass


class CommentaryEntryUpdate(BaseModel):
    author_id: int | None = None
    work_id: int | None = None
    content_text: str | None = None
    language_code: str | None = None
    display_order: int | None = None
    metadata: dict | None = None


class CommentaryEntryPublic(CommentaryEntryBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    created_by: int | None = None
    last_modified_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


RenditionType = Literal["translation", "commentary"]


class ContentRenditionBase(BaseModel):
    node_id: int
    rendition_type: RenditionType
    author_id: int | None = None
    work_id: int | None = None
    content_text: str
    language_code: str = "en"
    script_code: str | None = None
    display_order: int = 0
    metadata: dict | None = Field(default=None, alias="metadata_json")


class ContentRenditionCreate(ContentRenditionBase):
    pass


class ContentRenditionUpdate(BaseModel):
    rendition_type: RenditionType | None = None
    author_id: int | None = None
    work_id: int | None = None
    content_text: str | None = None
    language_code: str | None = None
    script_code: str | None = None
    display_order: int | None = None
    metadata: dict | None = None


class ContentRenditionPublic(ContentRenditionBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    created_by: int | None = None
    last_modified_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class NodeCommentBase(BaseModel):
    node_id: int
    parent_comment_id: int | None = None
    content_text: str
    language_code: str = "en"
    metadata: dict | None = Field(default=None, alias="metadata_json")


class NodeCommentCreate(NodeCommentBase):
    pass


class NodeCommentUpdate(BaseModel):
    parent_comment_id: int | None = None
    content_text: str | None = None
    language_code: str | None = None
    metadata: dict | None = None


class NodeCommentPublic(NodeCommentBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    created_by: int | None = None
    last_modified_by: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# === Phase 1: User Preferences ===
class UserPreferenceBase(BaseModel):
    source_language: str = "en"
    transliteration_enabled: bool = True
    transliteration_script: str = "devanagari"
    show_roman_transliteration: bool = True
    show_only_preferred_script: bool = False
    show_media: bool = True
    show_commentary: bool = True
    preview_show_titles: bool = False
    preview_show_labels: bool = False
    preview_show_level_numbers: bool = False
    preview_show_details: bool = False
    preview_show_media: bool = True
    preview_show_sanskrit: bool = True
    preview_show_transliteration: bool = True
    preview_show_english: bool = True
    preview_show_commentary: bool = True
    preview_transliteration_script: str = "iast"
    preview_word_meanings_display_mode: Literal["inline", "table", "hide"] = "inline"
    preview_translation_languages: str = "english"
    preview_hidden_levels: str = ""
    scriptures_book_browser_view: Literal["list", "icon"] = "list"
    scriptures_media_manager_view: Literal["list", "icon"] = "list"
    admin_media_bank_browser_view: Literal["list", "icon"] = "list"


class UserPreferenceUpdate(BaseModel):
    source_language: str | None = None
    transliteration_enabled: bool | None = None
    transliteration_script: str | None = None
    show_roman_transliteration: bool | None = None
    show_only_preferred_script: bool | None = None
    show_media: bool | None = None
    show_commentary: bool | None = None
    preview_show_titles: bool | None = None
    preview_show_labels: bool | None = None
    preview_show_level_numbers: bool | None = None
    preview_show_details: bool | None = None
    preview_show_media: bool | None = None
    preview_show_sanskrit: bool | None = None
    preview_show_transliteration: bool | None = None
    preview_show_english: bool | None = None
    preview_show_commentary: bool | None = None
    preview_transliteration_script: str | None = None
    preview_word_meanings_display_mode: Literal["inline", "table", "hide"] | None = None
    preview_translation_languages: str | None = None
    preview_hidden_levels: str | None = None
    scriptures_book_browser_view: Literal["list", "icon"] | None = None
    scriptures_media_manager_view: Literal["list", "icon"] | None = None
    admin_media_bank_browser_view: Literal["list", "icon"] | None = None


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
    compilation_metadata: dict = Field(default_factory=dict)


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
    show_media: bool = True
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
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=500, ge=1, le=5000)


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
    reader_hierarchy_path: str | None = None
    section_order: list[Literal["body"]] = Field(default_factory=lambda: ["body"])
    sections: BookPreviewRenderSections
    book_media_items: list[dict] = Field(default_factory=list)
    book_template: BookPreviewTemplatePublic | None = None
    render_settings: SnapshotRenderSettings = Field(default_factory=SnapshotRenderSettings)
    template_metadata: SnapshotTemplateMetadata = Field(default_factory=SnapshotTemplateMetadata)
    preview_mode: Literal["book"] = "book"
    warnings: list[str] = Field(default_factory=list)
    offset: int = 0
    limit: int = 500
    total_blocks: int = 0
    has_more: bool = False


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
