import logging
import textwrap
import hashlib
import json
import re
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from liquid import Template
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from api.metadata import _resolve_binding_metadata, validate_draft_metadata_bindings_on_publish
from api.users import get_current_user, get_current_user_optional, require_permission
from models.book import Book
from models.book_share import BookShare
from models.content_node import ContentNode
from models.draft_book import DraftBook, EditionSnapshot
from models.property_system import Category, MetadataBinding
from models.provenance_record import ProvenanceRecord
from models.template_library import RenderTemplate, RenderTemplateAssignment, RenderTemplateVersion
from models.schemas import (
    AdminDraftBookCreate,
    BookPreviewRenderArtifactPublic,
    BookPreviewRenderRequest,
    BookPreviewTemplatePublic,
    DraftPreviewRenderArtifactPublic,
    DraftPreviewRenderRequest,
    DraftRevisionEventPublic,
    DraftRevisionFeedPublic,
    DraftLicensePolicyIssue,
    DraftLicensePolicyReport,
    DraftProvenanceAppendix,
    DraftProvenanceAppendixEntry,
    DraftPublishCreate,
    DraftPublishPublic,
    DraftBookCreate,
    DraftBookPublic,
    DraftBookUpdate,
    EditionSnapshotCreate,
    EditionSnapshotPublic,
    SnapshotRenderArtifactPublic,
    SnapshotRenderBlock,
    SnapshotRenderSettings,
    SnapshotTemplateMetadata,
    SnapshotRenderSections,
)
from models.user import User
from services import get_db
from services.license_policy import classify_license_action, normalize_license
from services.metadata_defaults import ensure_default_metadata_binding_for_draft
from services.transliteration import devanagari_to_iast, latin_to_devanagari

router = APIRouter(tags=["draft_books"])
logger = logging.getLogger(__name__)

_SNAPSHOT_TEMPLATE_FAMILY = "default.content_item"
_SNAPSHOT_TEMPLATE_VERSION = "v1"
_SNAPSHOT_TEMPLATE_PATTERN = "default.{section}.content_item.v1"
_SNAPSHOT_RENDERER = "edition_snapshot_renderer"
_SNAPSHOT_OUTPUT_PROFILE = "reader_pdf_parity_v1"
_TEMPLATE_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*\.content_item\.v1$")

_DEFAULT_TEMPLATE_FIELDS_BY_LEVEL = {
    "chapter": ["english", "text"],
    "section": ["english", "text"],
    "verse": ["sanskrit", "transliteration", "english", "text"],
    "shloka": ["sanskrit", "transliteration", "english", "text"],
}

_DEFAULT_TEMPLATE_FIELDS_BY_SECTION = {
    "front": ["english", "text"],
    "body": ["sanskrit", "transliteration", "english", "text"],
    "back": ["english", "text"],
}

_DEFAULT_TEMPLATE_FIELD_LABELS = {
    "title": "Title",
    "sanskrit": "Sanskrit",
    "transliteration": "Transliteration",
    "english": "English",
    "text": "Text",
}

_DEFAULT_TEMPLATE_LABEL_TO_FIELD = {
    label.lower(): field_name for field_name, label in _DEFAULT_TEMPLATE_FIELD_LABELS.items()
}

_METADATA_TEMPLATE_KEY_FALLBACK_FIELDS = (
    "render_template_key",
    "template_key",
    "level_template_key",
    "content_template_key",
)

_CUSTOM_TEMPLATE_KEY_PATTERN = "custom.template.{template_id}.v{version}.content_item.v1"



def _metadata_liquid_template(fields: list[str]) -> str:
    lines: list[str] = []
    for field_name in fields:
        label = _DEFAULT_TEMPLATE_FIELD_LABELS.get(field_name, field_name.title())
        lines.append(
            f"{{% if metadata.{field_name} %}}{label}: {{{{ metadata.{field_name} }}}}\n{{% endif %}}"
        )
    return "".join(lines)


_BOOK_VISIBILITY_PUBLIC = "public"

_DEFAULT_LIQUID_TEMPLATES = {
    "default.book.content_item.v1": (
        "{% if title %}Book: {{ title }}\n{% endif %}"
        "{% if child_count %}Child Count: {{ child_count }}\n{% endif %}"
        "{% if children %}Children: {{ children }}\n{% endif %}"
    ),
    "default.front.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.front.chapter.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.front.section.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.front.verse.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    "default.front.shloka.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    "default.body.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    "default.body.chapter.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.body.section.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.body.verse.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    "default.body.shloka.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    "default.back.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.back.chapter.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.back.section.content_item.v1": _metadata_liquid_template(["english", "text"]),
    "default.back.verse.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
    "default.back.shloka.content_item.v1": _metadata_liquid_template(["sanskrit", "transliteration", "english", "text"]),
}


def _register_pdf_font_from_candidates(candidates: list[str], prefix: str) -> str | None:
    for index, candidate in enumerate(candidates):
        font_path = Path(candidate)
        if not font_path.exists():
            continue

        font_name = f"{prefix}{index}"
        try:
            if font_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
            return font_name
        except Exception:
            continue

    return None


def _resolve_pdf_font_name() -> str:
    unicode_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]

    resolved = _register_pdf_font_from_candidates(unicode_candidates, "SnapshotUnicode")
    return resolved or "Helvetica"


def _resolve_pdf_devanagari_font_name() -> str:
    devanagari_candidates = [
        "/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
        "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
        "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    resolved = _register_pdf_font_from_candidates(devanagari_candidates, "SnapshotDevanagari")
    return resolved or _resolve_pdf_font_name()


def _audit_event(event_name: str, actor_user_id: int | None, **fields: object) -> None:
    payload = {
        "event": event_name,
        "actor_user_id": actor_user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    payload.update(fields)
    logger.info("audit_event %s", payload)


def _default_sections() -> dict:
    return {"front": [], "body": [], "back": []}


def _book_owner_id(book: Book) -> int | None:
    metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    owner_id = metadata.get("owner_id")
    try:
        return int(owner_id) if owner_id is not None else None
    except (TypeError, ValueError):
        return None


def _book_visibility(book: Book) -> str:
    metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    raw_visibility = metadata.get("visibility")
    visibility = str(raw_visibility).strip().lower() if raw_visibility is not None else ""
    return visibility if visibility else "private"


def _book_title_for_preview(node: ContentNode) -> str:
    return (
        _as_clean_string(node.title_english)
        or _as_clean_string(node.title_transliteration)
        or _as_clean_string(node.title_sanskrit)
        or f"Node {node.id}"
    )


def _is_book_body_reference_item(
    section_name: str,
    raw_item: dict,
    source_node_id: int | None,
    source_book_id: int | None,
) -> bool:
    if section_name != "body":
        return False
    if source_node_id is not None and source_node_id > 0:
        return False
    if source_book_id is None or source_book_id <= 0:
        return False

    source_scope = _as_clean_string(raw_item.get("source_scope")).lower()
    if source_scope in {"book", "entire_book", "book_body"}:
        return True

    include_whole_book = raw_item.get("include_whole_book")
    if isinstance(include_whole_book, bool):
        return include_whole_book

    expand_book_body = raw_item.get("expand_book_body")
    if isinstance(expand_book_body, bool):
        return expand_book_body

    return False


def _default_template_metadata() -> SnapshotTemplateMetadata:
    return SnapshotTemplateMetadata(
        template_family=_SNAPSHOT_TEMPLATE_FAMILY,
        template_version=_SNAPSHOT_TEMPLATE_VERSION,
        block_template_pattern=_SNAPSHOT_TEMPLATE_PATTERN,
        renderer=_SNAPSHOT_RENDERER,
        output_profile=_SNAPSHOT_OUTPUT_PROFILE,
    )


def _extract_template_metadata(snapshot_data: dict | None) -> SnapshotTemplateMetadata:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    raw_metadata = resolved_data.get("template_metadata")
    if not isinstance(raw_metadata, dict):
        return _default_template_metadata()

    defaults = _default_template_metadata()

    def _read_str(key: str, fallback: str) -> str:
        value = raw_metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        return fallback

    return SnapshotTemplateMetadata(
        template_family=_read_str("template_family", defaults.template_family),
        template_version=_read_str("template_version", defaults.template_version),
        block_template_pattern=_read_str("block_template_pattern", defaults.block_template_pattern),
        renderer=_read_str("renderer", defaults.renderer),
        output_profile=_read_str("output_profile", defaults.output_profile),
    )


def _apply_template_metadata(snapshot_payload: dict) -> None:
    snapshot_payload["template_metadata"] = _extract_template_metadata(snapshot_payload).model_dump()


def _canonical_hash(value: object) -> str:
    payload = value if value is not None else {}
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _compute_snapshot_fingerprint(snapshot_payload: dict) -> dict:
    resolved = snapshot_payload if isinstance(snapshot_payload, dict) else {}
    content_basis = {
        "front": resolved.get("front") if isinstance(resolved.get("front"), list) else [],
        "body": resolved.get("body") if isinstance(resolved.get("body"), list) else [],
        "back": resolved.get("back") if isinstance(resolved.get("back"), list) else [],
    }
    template_basis = {
        "template_metadata": _extract_template_metadata(resolved).model_dump(),
        "template_bindings": _extract_template_bindings(resolved),
    }
    render_basis = {
        "render_settings": _extract_render_settings(resolved).model_dump(),
        "output_profile": _extract_template_metadata(resolved).output_profile,
    }

    content_hash = _canonical_hash(content_basis)
    template_hash = _canonical_hash(template_basis)
    render_hash = _canonical_hash(render_basis)
    combined_hash = _canonical_hash(
        {
            "content_hash": content_hash,
            "template_hash": template_hash,
            "render_hash": render_hash,
        }
    )

    return {
        "version": "v1",
        "algorithm": "sha256",
        "content_hash": content_hash,
        "template_hash": template_hash,
        "render_hash": render_hash,
        "combined_hash": combined_hash,
    }


def _apply_snapshot_fingerprint(snapshot_payload: dict) -> None:
    snapshot_payload["snapshot_fingerprint"] = _compute_snapshot_fingerprint(snapshot_payload)


def _read_metadata_dict(value: object) -> dict:
    if not isinstance(value, dict):
        return {}

    resolved: dict = {}
    for key, raw_value in value.items():
        if not isinstance(key, str) or not key.strip():
            continue
        if raw_value is None:
            continue
        resolved[key.strip()] = raw_value
    return resolved


def _extract_metadata_bindings(snapshot_data: dict | None) -> dict:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    raw_bindings = resolved_data.get("metadata_bindings")
    bindings = raw_bindings if isinstance(raw_bindings, dict) else {}

    global_metadata = _read_metadata_dict(
        bindings.get("global")
        or bindings.get("global_metadata")
    )
    book_metadata = _read_metadata_dict(
        bindings.get("book")
        or bindings.get("book_metadata")
    )

    raw_level_bindings = (
        bindings.get("levels")
        if isinstance(bindings.get("levels"), dict)
        else bindings.get("level_metadata")
    )
    level_bindings: dict[str, dict] = {}
    if isinstance(raw_level_bindings, dict):
        for key, value in raw_level_bindings.items():
            if not isinstance(key, str) or not key.strip():
                continue
            normalized = _read_metadata_dict(value)
            if normalized:
                level_bindings[key.strip().lower()] = normalized

    raw_node_bindings = (
        bindings.get("nodes")
        if isinstance(bindings.get("nodes"), dict)
        else bindings.get("node_metadata")
    )
    node_bindings: dict[int, dict] = {}
    if isinstance(raw_node_bindings, dict):
        for key, value in raw_node_bindings.items():
            parsed_node_id = _safe_int(key)
            if parsed_node_id is None:
                continue
            normalized = _read_metadata_dict(value)
            if normalized:
                node_bindings[parsed_node_id] = normalized

    return {
        "global_metadata": global_metadata,
        "book_metadata": book_metadata,
        "level_metadata": level_bindings,
        "node_metadata": node_bindings,
    }


def _merge_metadata_layers(*layers: dict) -> dict:
    merged: dict = {}
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        for key, value in layer.items():
            if value is None:
                continue
            merged[key] = value
    return merged


def _flatten_binding_metadata_for_template(binding: MetadataBinding, db: Session) -> dict:
    resolved = _resolve_binding_metadata(binding, db)
    flattened: dict = {}

    if resolved.category_id is not None:
        flattened["category_id"] = resolved.category_id
    if isinstance(resolved.category_name, str) and resolved.category_name.strip():
        category_name = resolved.category_name.strip()
        flattened["category_name"] = category_name
        flattened["category"] = category_name

    for item in resolved.properties:
        key = item.property_internal_name.strip() if isinstance(item.property_internal_name, str) else ""
        if not key:
            continue
        flattened[key] = item.value

    return flattened


def _resolve_node_binding_metadata_for_template(
    db: Session,
    source_book_id: int | None,
    source_node_id: int | None,
    binding_cache: dict | None = None,
) -> dict:
    if not isinstance(source_node_id, int) or source_node_id <= 0:
        return {}

    if isinstance(binding_cache, dict):
        scoped_node_bindings = binding_cache.get("node_scoped") if isinstance(binding_cache.get("node_scoped"), dict) else {}
        global_node_bindings = binding_cache.get("node_global") if isinstance(binding_cache.get("node_global"), dict) else {}
        book_bindings = binding_cache.get("book_scoped") if isinstance(binding_cache.get("book_scoped"), dict) else {}

        if isinstance(source_book_id, int) and source_book_id > 0:
            scoped = scoped_node_bindings.get((source_book_id, source_node_id))
            if isinstance(scoped, dict):
                return scoped

        global_binding = global_node_bindings.get(source_node_id)
        if isinstance(global_binding, dict):
            return global_binding

        if isinstance(source_book_id, int) and source_book_id > 0:
            book_binding = book_bindings.get(source_book_id)
            if isinstance(book_binding, dict):
                return book_binding

        return {}

    node_binding = None
    if isinstance(source_book_id, int) and source_book_id > 0:
        node_binding = (
            db.query(MetadataBinding)
            .filter(
                MetadataBinding.entity_type == "node",
                MetadataBinding.entity_id == source_node_id,
                MetadataBinding.scope_type == "node",
                MetadataBinding.root_entity_id == source_book_id,
            )
            .first()
        )

    if node_binding is None:
        node_binding = (
            db.query(MetadataBinding)
            .filter(
                MetadataBinding.entity_type == "node",
                MetadataBinding.entity_id == source_node_id,
                MetadataBinding.scope_type == "node",
                MetadataBinding.root_entity_id.is_(None),
            )
            .first()
        )

    if node_binding is not None:
        return _flatten_binding_metadata_for_template(node_binding, db)

    if not isinstance(source_book_id, int) or source_book_id <= 0:
        return {}

    book_binding = (
        db.query(MetadataBinding)
        .filter(
            MetadataBinding.entity_type == "book",
            MetadataBinding.entity_id == source_book_id,
            MetadataBinding.scope_type == "book",
        )
        .first()
    )
    if book_binding is None:
        return {}
    return _flatten_binding_metadata_for_template(book_binding, db)


def _resolve_block_metadata(
    db: Session,
    item: dict,
    source_node: ContentNode | None,
    metadata_bindings: dict,
    binding_cache: dict | None = None,
) -> dict:
    node_scope: dict = {}
    node_binding_map = metadata_bindings.get("node_metadata")
    if isinstance(node_binding_map, dict):
        source_node_id = item.get("source_node_id")
        if isinstance(source_node_id, int) and source_node_id > 0:
            node_scope = _read_metadata_dict(node_binding_map.get(source_node_id))

    level_scope: dict = {}
    level_binding_map = metadata_bindings.get("level_metadata")
    if isinstance(level_binding_map, dict):
        level_name = source_node.level_name if source_node else item.get("level_name")
        if isinstance(level_name, str) and level_name.strip():
            level_scope = _read_metadata_dict(level_binding_map.get(level_name.strip().lower()))

    book_scope: dict = {}
    source_book_id = item.get("source_book_id")
    if isinstance(source_book_id, int) and source_book_id > 0:
        book_scope = _read_metadata_dict(metadata_bindings.get("book_metadata"))

    global_scope = _read_metadata_dict(metadata_bindings.get("global_metadata"))

    source_node_id = item.get("source_node_id")
    source_book_id = item.get("source_book_id")
    resolved_binding_scope = _resolve_node_binding_metadata_for_template(
        db,
        source_book_id if isinstance(source_book_id, int) else None,
        source_node_id if isinstance(source_node_id, int) else None,
        binding_cache=binding_cache,
    )

    field_scope = _read_metadata_dict(item.get("metadata_overrides"))
    if not field_scope:
        field_scope = _read_metadata_dict(item.get("metadata"))

    return _merge_metadata_layers(
        global_scope,
        book_scope,
        level_scope,
        resolved_binding_scope,
        node_scope,
        field_scope,
    )


def _build_template_binding_metadata_cache(db: Session, items: list[dict]) -> dict:
    node_ids: set[int] = set()
    book_ids: set[int] = set()

    for item in items:
        source_node_id = item.get("source_node_id")
        source_book_id = item.get("source_book_id")
        if isinstance(source_node_id, int) and source_node_id > 0:
            node_ids.add(source_node_id)
        if isinstance(source_book_id, int) and source_book_id > 0:
            book_ids.add(source_book_id)

    if not node_ids and not book_ids:
        return {
            "node_scoped": {},
            "node_global": {},
            "book_scoped": {},
        }

    flattened_by_binding_id: dict[int, dict] = {}

    def _flatten(binding: MetadataBinding) -> dict:
        cached = flattened_by_binding_id.get(binding.id)
        if cached is not None:
            return cached
        flattened = _flatten_binding_metadata_for_template(binding, db)
        flattened_by_binding_id[binding.id] = flattened
        return flattened

    node_scoped: dict[tuple[int, int], dict] = {}
    node_global: dict[int, dict] = {}
    book_scoped: dict[int, dict] = {}

    if node_ids and book_ids:
        scoped_rows = (
            db.query(MetadataBinding)
            .filter(
                MetadataBinding.entity_type == "node",
                MetadataBinding.scope_type == "node",
                MetadataBinding.entity_id.in_(sorted(node_ids)),
                MetadataBinding.root_entity_id.in_(sorted(book_ids)),
            )
            .order_by(MetadataBinding.id.asc())
            .all()
        )
        for row in scoped_rows:
            if row.root_entity_id is None:
                continue
            key = (int(row.root_entity_id), int(row.entity_id))
            node_scoped.setdefault(key, _flatten(row))

    if node_ids:
        global_rows = (
            db.query(MetadataBinding)
            .filter(
                MetadataBinding.entity_type == "node",
                MetadataBinding.scope_type == "node",
                MetadataBinding.entity_id.in_(sorted(node_ids)),
                MetadataBinding.root_entity_id.is_(None),
            )
            .order_by(MetadataBinding.id.asc())
            .all()
        )
        for row in global_rows:
            key = int(row.entity_id)
            node_global.setdefault(key, _flatten(row))

    if book_ids:
        book_rows = (
            db.query(MetadataBinding)
            .filter(
                MetadataBinding.entity_type == "book",
                MetadataBinding.scope_type == "book",
                MetadataBinding.entity_id.in_(sorted(book_ids)),
            )
            .order_by(MetadataBinding.id.asc())
            .all()
        )
        for row in book_rows:
            key = int(row.entity_id)
            book_scoped.setdefault(key, _flatten(row))

    return {
        "node_scoped": node_scoped,
        "node_global": node_global,
        "book_scoped": book_scoped,
    }


def _read_template_key(value: object) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


def _resolve_metadata_template_key(
    section_name: str,
    level_name: str | None,
    resolved_metadata: dict | None,
) -> str | None:
    if not isinstance(resolved_metadata, dict):
        return None

    normalized_level = level_name.strip().lower() if isinstance(level_name, str) and level_name.strip() else ""
    candidate_fields: list[str] = []
    if normalized_level:
        candidate_fields.append(f"{section_name}_{normalized_level}_template_key")
        candidate_fields.append(f"{normalized_level}_template_key")
    candidate_fields.append(f"{section_name}_template_key")
    candidate_fields.extend(_METADATA_TEMPLATE_KEY_FALLBACK_FIELDS)

    for field_name in candidate_fields:
        template_key = _read_template_key(resolved_metadata.get(field_name))
        if template_key and _is_valid_template_key(template_key):
            return template_key

    return None


def _book_is_visible_to_user(db: Session, book: Book, user_id: int | None) -> bool:
    if user_id is None:
        return _book_visibility(book) == _BOOK_VISIBILITY_PUBLIC

    if _book_owner_id(book) == user_id:
        return True

    metadata = book.metadata_json if isinstance(book.metadata_json, dict) else {}
    if "owner_id" not in metadata:
        return True

    if _book_visibility(book) == _BOOK_VISIBILITY_PUBLIC:
        return True

    share = (
        db.query(BookShare.id)
        .filter(
            BookShare.book_id == book.id,
            BookShare.shared_with_user_id == user_id,
        )
        .first()
    )
    return share is not None


def _is_valid_template_key(template_key: str) -> bool:
    return bool(_TEMPLATE_KEY_PATTERN.fullmatch(template_key))


def _validate_template_bindings(snapshot_data: dict | None) -> list[str]:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    raw_bindings = resolved_data.get("template_bindings")
    bindings = raw_bindings if isinstance(raw_bindings, dict) else {}
    if not bindings:
        return []

    errors: list[str] = []

    def _validate_template_value(path: str, raw_value: object) -> None:
        template_key = _read_template_key(raw_value)
        if template_key is None:
            return
        if not _is_valid_template_key(template_key):
            errors.append(
                f"{path}: invalid template key '{template_key}' (must end with '.content_item.v1')"
            )

    _validate_template_value(
        "global_template_key",
        bindings.get("global_template_key") or bindings.get("global"),
    )
    _validate_template_value(
        "book_template_key",
        bindings.get("book_template_key") or bindings.get("book"),
    )

    raw_level_bindings = (
        bindings.get("level_template_keys")
        if isinstance(bindings.get("level_template_keys"), dict)
        else bindings.get("levels")
    )
    if isinstance(raw_level_bindings, dict):
        for level_name, raw_value in raw_level_bindings.items():
            level_label = level_name.strip() if isinstance(level_name, str) and level_name.strip() else "<unknown>"
            _validate_template_value(f"level_template_keys.{level_label}", raw_value)

    raw_node_bindings = (
        bindings.get("node_template_keys")
        if isinstance(bindings.get("node_template_keys"), dict)
        else bindings.get("nodes")
    )
    if isinstance(raw_node_bindings, dict):
        for node_id, raw_value in raw_node_bindings.items():
            parsed_node_id = _safe_int(node_id)
            node_label = str(node_id)
            if parsed_node_id is None:
                errors.append(f"node_template_keys.{node_label}: invalid node id")
                continue
            _validate_template_value(f"node_template_keys.{parsed_node_id}", raw_value)

    return errors


def _extract_template_bindings(snapshot_data: dict | None) -> dict:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    raw_bindings = resolved_data.get("template_bindings")
    bindings = raw_bindings if isinstance(raw_bindings, dict) else {}

    global_template_key = _read_template_key(
        bindings.get("global")
        or bindings.get("global_template_key")
    )
    book_template_key = _read_template_key(
        bindings.get("book")
        or bindings.get("book_template_key")
    )

    raw_level_bindings = (
        bindings.get("levels")
        if isinstance(bindings.get("levels"), dict)
        else bindings.get("level_template_keys")
    )
    level_bindings: dict[str, str] = {}
    if isinstance(raw_level_bindings, dict):
        for key, value in raw_level_bindings.items():
            if not isinstance(key, str):
                continue
            template_key = _read_template_key(value)
            if template_key:
                level_bindings[key.strip().lower()] = template_key

    raw_node_bindings = (
        bindings.get("nodes")
        if isinstance(bindings.get("nodes"), dict)
        else bindings.get("node_template_keys")
    )
    node_bindings: dict[int, str] = {}
    if isinstance(raw_node_bindings, dict):
        for key, value in raw_node_bindings.items():
            template_key = _read_template_key(value)
            if not template_key:
                continue

            parsed_node_id = _safe_int(key)
            if parsed_node_id is None:
                continue
            node_bindings[parsed_node_id] = template_key

    return {
        "global_template_key": global_template_key,
        "book_template_key": book_template_key,
        "level_template_keys": level_bindings,
        "node_template_keys": node_bindings,
    }


def _extract_custom_template_sources(snapshot_data: dict | None) -> dict[str, str]:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    raw_sources = resolved_data.get("custom_template_sources")
    if not isinstance(raw_sources, dict):
        return {}

    sources: dict[str, str] = {}
    for raw_key, raw_value in raw_sources.items():
        if not isinstance(raw_key, str) or not isinstance(raw_value, str):
            continue
        key = raw_key.strip()
        source = raw_value.strip()
        if not key or not source:
            continue
        if not _is_valid_template_key(key):
            continue
        sources[key] = source
    return sources


def _custom_template_key(template_id: int, version: int) -> str:
    return _CUSTOM_TEMPLATE_KEY_PATTERN.format(template_id=template_id, version=version)


def _can_use_template_for_owner(template: RenderTemplate, owner_id: int) -> bool:
    if bool(template.is_system) and bool(template.is_active):
        return True
    if template.owner_id == owner_id:
        return True
    return bool(template.visibility == "published" and template.is_active)


def _load_system_template_sources(db: Session) -> dict[str, str]:
    rows = (
        db.query(RenderTemplate)
        .filter(
            RenderTemplate.is_system.is_(True),
            RenderTemplate.is_active.is_(True),
            RenderTemplate.system_key.isnot(None),
        )
        .all()
    )
    sources: dict[str, str] = {}
    for row in rows:
        system_key = _as_clean_string(row.system_key)
        liquid_template = row.liquid_template if isinstance(row.liquid_template, str) else ""
        if not system_key or not liquid_template.strip():
            continue
        sources[system_key] = liquid_template
    return sources


def _apply_assignment_template_bindings(
    preview_payload: dict,
    db: Session,
    owner_id: int,
    entity_type: str,
    entity_id: int,
) -> None:
    assignments = (
        db.query(RenderTemplateAssignment)
        .filter(
            RenderTemplateAssignment.owner_id == owner_id,
            RenderTemplateAssignment.entity_type == entity_type,
            RenderTemplateAssignment.entity_id == entity_id,
            RenderTemplateAssignment.is_active.is_(True),
        )
        .order_by(
            RenderTemplateAssignment.level_key.asc(),
            RenderTemplateAssignment.priority.asc(),
            RenderTemplateAssignment.id.desc(),
        )
        .all()
    )
    if not assignments:
        return

    selected_by_level: dict[str, RenderTemplateAssignment] = {}
    for assignment in assignments:
        level_key = assignment.level_key.strip().lower() if isinstance(assignment.level_key, str) and assignment.level_key.strip() else ""
        if level_key in selected_by_level:
            continue
        selected_by_level[level_key] = assignment

    template_ids = sorted({assignment.template_id for assignment in selected_by_level.values()})
    template_rows = db.query(RenderTemplate).filter(RenderTemplate.id.in_(template_ids)).all()
    templates_by_id = {template.id: template for template in template_rows}

    requested_version_ids = sorted(
        {
            assignment.template_version_id
            for assignment in selected_by_level.values()
            if assignment.template_version_id is not None
        }
    )
    versions_by_id: dict[int, RenderTemplateVersion] = {}
    if requested_version_ids:
        version_rows = db.query(RenderTemplateVersion).filter(RenderTemplateVersion.id.in_(requested_version_ids)).all()
        versions_by_id = {version.id: version for version in version_rows}

    level_bindings: dict[str, str] = {}
    custom_sources: dict[str, str] = {}
    book_template_key: str | None = None

    for level_key, assignment in selected_by_level.items():
        template = templates_by_id.get(assignment.template_id)
        if not template:
            continue
        if not _can_use_template_for_owner(template, owner_id):
            continue

        resolved_version_number = template.current_version or 1
        resolved_template_source = template.liquid_template
        if assignment.template_version_id is not None:
            pinned_version = versions_by_id.get(assignment.template_version_id)
            if pinned_version and pinned_version.template_id == template.id:
                resolved_version_number = pinned_version.version
                resolved_template_source = pinned_version.liquid_template

        template_key = _custom_template_key(template.id, resolved_version_number)
        custom_sources[template_key] = resolved_template_source

        if level_key:
            level_bindings[level_key] = template_key
        else:
            book_template_key = template_key

    if not custom_sources:
        return

    generated_bindings: dict = {}
    if book_template_key:
        generated_bindings["book_template_key"] = book_template_key
    if level_bindings:
        generated_bindings["level_template_keys"] = level_bindings

    _apply_session_template_bindings(preview_payload, generated_bindings)

    existing_sources = _extract_custom_template_sources(preview_payload)
    merged_sources = {**existing_sources, **custom_sources}
    preview_payload["custom_template_sources"] = merged_sources


def _apply_session_template_bindings(snapshot_payload: dict, session_template_bindings: dict | None) -> None:
    if not isinstance(snapshot_payload, dict) or not isinstance(session_template_bindings, dict):
        return

    base_bindings = _extract_template_bindings(snapshot_payload)
    session_bindings = _extract_template_bindings({"template_bindings": session_template_bindings})

    merged_global = session_bindings.get("global_template_key") or base_bindings.get("global_template_key")
    merged_book = session_bindings.get("book_template_key") or base_bindings.get("book_template_key")

    base_level = base_bindings.get("level_template_keys") if isinstance(base_bindings.get("level_template_keys"), dict) else {}
    session_level = session_bindings.get("level_template_keys") if isinstance(session_bindings.get("level_template_keys"), dict) else {}
    merged_level = {**base_level, **session_level}

    base_node = base_bindings.get("node_template_keys") if isinstance(base_bindings.get("node_template_keys"), dict) else {}
    session_node = session_bindings.get("node_template_keys") if isinstance(session_bindings.get("node_template_keys"), dict) else {}
    merged_node = {**base_node, **session_node}

    serialized_bindings: dict = {}
    if merged_global:
        serialized_bindings["global_template_key"] = merged_global
    if merged_book:
        serialized_bindings["book_template_key"] = merged_book
    if merged_level:
        serialized_bindings["level_template_keys"] = merged_level
    if merged_node:
        serialized_bindings["node_template_keys"] = {str(key): value for key, value in merged_node.items()}

    snapshot_payload["template_bindings"] = serialized_bindings


def _resolve_block_template_key(
    section_name: str,
    item: dict,
    source_node: ContentNode | None,
    template_bindings: dict,
    resolved_metadata: dict | None = None,
) -> str:
    default_template = f"default.{section_name}.content_item.v1"
    level_name = source_node.level_name if source_node else item.get("level_name")
    level_fallback_template = None
    if isinstance(level_name, str) and level_name.strip():
        normalized_level = level_name.strip().lower()
        level_fallback_template = f"default.{section_name}.{normalized_level}.content_item.v1"

    node_bindings = template_bindings.get("node_template_keys")
    if isinstance(node_bindings, dict):
        source_node_id = item.get("source_node_id")
        if isinstance(source_node_id, int) and source_node_id > 0:
            node_template = _read_template_key(node_bindings.get(source_node_id))
            if node_template:
                return node_template

    level_bindings = template_bindings.get("level_template_keys")
    if isinstance(level_bindings, dict):
        if isinstance(level_name, str) and level_name.strip():
            level_template = _read_template_key(level_bindings.get(level_name.strip().lower()))
            if level_template:
                return level_template

    metadata_template = _resolve_metadata_template_key(
        section_name=section_name,
        level_name=level_name,
        resolved_metadata=resolved_metadata,
    )
    if metadata_template:
        return metadata_template

    source_book_id = item.get("source_book_id")
    if isinstance(source_book_id, int) and source_book_id > 0:
        book_template = _read_template_key(template_bindings.get("book_template_key"))
        if book_template:
            return book_template

    global_template = _read_template_key(template_bindings.get("global_template_key"))
    if global_template:
        return global_template

    if level_fallback_template:
        return level_fallback_template

    return default_template


def _safe_int(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def _content_node_sort_key(node: ContentNode) -> tuple[int, int, int, int]:
    level_order = node.level_order if isinstance(node.level_order, int) else 10**9
    sequence_number = node.sequence_number if isinstance(node.sequence_number, int) else 10**9
    parent_node_id = node.parent_node_id if isinstance(node.parent_node_id, int) else 0
    return (level_order, sequence_number, parent_node_id, node.id)


def _ordered_nodes_by_hierarchy(nodes: list[ContentNode]) -> list[ContentNode]:
    if not nodes:
        return []

    children_by_parent: dict[int | None, list[ContentNode]] = {}
    node_by_id: dict[int, ContentNode] = {}
    for node in nodes:
        node_by_id[node.id] = node
        parent_id = node.parent_node_id if isinstance(node.parent_node_id, int) else None
        children_by_parent.setdefault(parent_id, []).append(node)

    for child_list in children_by_parent.values():
        child_list.sort(key=_content_node_sort_key)

    ordered: list[ContentNode] = []
    visited_ids: set[int] = set()

    def _walk(parent_id: int | None) -> None:
        for child in children_by_parent.get(parent_id, []):
            if child.id in visited_ids:
                continue
            visited_ids.add(child.id)
            ordered.append(child)
            _walk(child.id)

    _walk(None)

    for node in sorted(nodes, key=_content_node_sort_key):
        if node.id in visited_ids:
            continue
        ordered.append(node)
        _walk(node.id)

    return ordered


def _ordered_nodes_for_preview_scope(
    nodes: list[ContentNode],
    root_node_id: int | None,
) -> list[ContentNode]:
    if not nodes:
        return []
    if root_node_id is None:
        return _ordered_nodes_by_hierarchy(nodes)

    children_by_parent: dict[int | None, list[ContentNode]] = {}
    node_by_id: dict[int, ContentNode] = {}
    for node in nodes:
        node_by_id[node.id] = node
        parent_id = node.parent_node_id if isinstance(node.parent_node_id, int) else None
        children_by_parent.setdefault(parent_id, []).append(node)

    root = node_by_id.get(root_node_id)
    if not root:
        return []

    for child_list in children_by_parent.values():
        child_list.sort(key=_content_node_sort_key)

    ordered: list[ContentNode] = []
    visited_ids: set[int] = set()

    def _walk(node: ContentNode) -> None:
        if node.id in visited_ids:
            return
        visited_ids.add(node.id)
        ordered.append(node)
        for child in children_by_parent.get(node.id, []):
            _walk(child)

    _walk(root)
    return ordered


def _as_clean_string(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


_DEVANAGARI_CHAR_PATTERN = re.compile(r"[\u0900-\u097F]")
_DEVANAGARI_TOKEN_PATTERN = re.compile(r"^[\u0900-\u097F]+$")
_DANDA_ONLY_LINE_PATTERN = re.compile(r"^[।॥|]+$")


def _normalize_devanagari_text(value: str) -> str:
    if not value:
        return ""

    def _merge_fragmented_short_tokens(line: str) -> str:
        tokens = [token for token in line.split() if token]
        if not tokens:
            return ""

        merged_tokens: list[str] = []
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if not (_DEVANAGARI_TOKEN_PATTERN.fullmatch(token) and len(token) <= 2):
                merged_tokens.append(token)
                index += 1
                continue

            run_start = index
            while (
                index < len(tokens)
                and _DEVANAGARI_TOKEN_PATTERN.fullmatch(tokens[index])
                and len(tokens[index]) <= 2
            ):
                index += 1

            run = tokens[run_start:index]
            if len(run) >= 3:
                merged_tokens.append("".join(run))
            else:
                merged_tokens.extend(run)

        return " ".join(merged_tokens)

    def _canonical_for_dedupe(line: str) -> str:
        canonical = re.sub(r"\s+", "", line)
        canonical = canonical.replace("|", "।")
        return canonical

    normalized_lines: list[str] = []
    seen_canonical: set[str] = set()
    for raw_line in value.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if _DEVANAGARI_CHAR_PATTERN.search(line):
            line = _merge_fragmented_short_tokens(line)
            line = re.sub(r"\s*([।॥|]+)\s*", r"\1", line)

            canonical = _canonical_for_dedupe(line)
            if canonical in seen_canonical:
                continue
            seen_canonical.add(canonical)

        if _DANDA_ONLY_LINE_PATTERN.fullmatch(line) and normalized_lines:
            normalized_lines[-1] = f"{normalized_lines[-1]} {line}"
            continue

        normalized_lines.append(line)

    return "\n".join(normalized_lines).strip()


def _resolve_word_meanings_runtime_config(resolved_metadata: dict | None) -> tuple[str, str, bool]:
    preferred_mode = "script"
    preferred_scheme = "iast"
    allow_runtime_generation = True

    if not isinstance(resolved_metadata, dict):
        return preferred_mode, preferred_scheme, allow_runtime_generation

    word_meanings_metadata = resolved_metadata.get("word_meanings")
    source_metadata = (
        word_meanings_metadata.get("source")
        if isinstance(word_meanings_metadata, dict)
        and isinstance(word_meanings_metadata.get("source"), dict)
        else {}
    )

    mode_candidates = (
        resolved_metadata.get("source_display_mode"),
        source_metadata.get("source_display_mode"),
        source_metadata.get("preferred_mode"),
    )
    for candidate in mode_candidates:
        if isinstance(candidate, str) and candidate.strip().lower() in {"script", "transliteration"}:
            preferred_mode = candidate.strip().lower()
            break

    scheme_candidates = (
        resolved_metadata.get("preferred_transliteration_scheme"),
        source_metadata.get("preferred_transliteration_scheme"),
        source_metadata.get("default_transliteration_scheme"),
    )
    for candidate in scheme_candidates:
        if isinstance(candidate, str) and candidate.strip():
            preferred_scheme = candidate.strip().lower()
            break

    runtime_candidates = (
        resolved_metadata.get("allow_runtime_transliteration_generation"),
        source_metadata.get("allow_runtime_transliteration_generation"),
    )
    for candidate in runtime_candidates:
        if isinstance(candidate, bool):
            allow_runtime_generation = candidate
            break

    return preferred_mode, preferred_scheme, allow_runtime_generation


def _resolve_word_meanings_meaning_config(
    resolved_metadata: dict | None,
) -> tuple[str, list[str], bool]:
    preferred_language = "en"
    fallback_order = ["user_preference", "en", "first_available"]
    show_badge_when_fallback_used = True

    if not isinstance(resolved_metadata, dict):
        return preferred_language, fallback_order, show_badge_when_fallback_used

    word_meanings_metadata = resolved_metadata.get("word_meanings")
    meanings_metadata = (
        word_meanings_metadata.get("meanings")
        if isinstance(word_meanings_metadata, dict)
        and isinstance(word_meanings_metadata.get("meanings"), dict)
        else {}
    )
    rendering_metadata = (
        word_meanings_metadata.get("rendering")
        if isinstance(word_meanings_metadata, dict)
        and isinstance(word_meanings_metadata.get("rendering"), dict)
        else {}
    )

    language_candidates = (
        resolved_metadata.get("meaning_language"),
        meanings_metadata.get("meaning_language"),
        meanings_metadata.get("default_language"),
    )
    for candidate in language_candidates:
        if isinstance(candidate, str) and candidate.strip():
            preferred_language = candidate.strip().lower()
            break

    raw_fallback_order = meanings_metadata.get("fallback_order")
    if isinstance(raw_fallback_order, list):
        parsed_fallback_order = [
            item.strip().lower()
            for item in raw_fallback_order
            if isinstance(item, str) and item.strip()
        ]
        if parsed_fallback_order:
            fallback_order = parsed_fallback_order

    badge_candidate = rendering_metadata.get("show_language_badge_when_fallback_used")
    if isinstance(badge_candidate, bool):
        show_badge_when_fallback_used = badge_candidate

    return preferred_language, fallback_order, show_badge_when_fallback_used


def _resolve_word_meaning_meaning_text(
    meanings_payload: dict[str, dict[str, str]],
    preferred_language: str,
    fallback_order: list[str],
    show_badge_when_fallback_used: bool,
) -> dict[str, object]:
    if not meanings_payload:
        return {
            "language": None,
            "text": "",
            "fallback_used": False,
            "fallback_badge_visible": False,
        }

    normalized_preferred_language = preferred_language.strip().lower() if preferred_language else "en"
    selected_language: str | None = None
    selected_text = ""

    for strategy in fallback_order:
        normalized_strategy = strategy.strip().lower()
        if normalized_strategy == "user_preference":
            preferred_payload = meanings_payload.get(normalized_preferred_language)
            preferred_text = _as_clean_string(preferred_payload.get("text") if isinstance(preferred_payload, dict) else None)
            if preferred_text:
                selected_language = normalized_preferred_language
                selected_text = preferred_text
                break
            continue

        if normalized_strategy == "en":
            en_payload = meanings_payload.get("en")
            en_text = _as_clean_string(en_payload.get("text") if isinstance(en_payload, dict) else None)
            if en_text:
                selected_language = "en"
                selected_text = en_text
                break
            continue

        if normalized_strategy == "first_available":
            for language, payload in meanings_payload.items():
                text_value = _as_clean_string(payload.get("text") if isinstance(payload, dict) else None)
                if text_value:
                    selected_language = language
                    selected_text = text_value
                    break
            if selected_language:
                break

    if not selected_language:
        for language, payload in meanings_payload.items():
            text_value = _as_clean_string(payload.get("text") if isinstance(payload, dict) else None)
            if text_value:
                selected_language = language
                selected_text = text_value
                break

    fallback_used = bool(selected_language and selected_language != normalized_preferred_language)
    return {
        "language": selected_language,
        "text": selected_text,
        "fallback_used": fallback_used,
        "fallback_badge_visible": bool(fallback_used and show_badge_when_fallback_used),
    }


def _resolve_word_meaning_source_token(
    source_payload: dict,
    preferred_mode: str,
    preferred_scheme: str,
    allow_runtime_generation: bool,
) -> dict[str, object]:
    source = source_payload if isinstance(source_payload, dict) else {}
    script_text = _normalize_devanagari_text(_as_clean_string(source.get("script_text")))

    transliteration_payload = (
        source.get("transliteration") if isinstance(source.get("transliteration"), dict) else {}
    )
    transliteration_map: dict[str, str] = {}
    for raw_scheme, raw_value in transliteration_payload.items():
        if not isinstance(raw_scheme, str) or not raw_scheme.strip():
            continue
        cleaned_value = _as_clean_string(raw_value)
        if cleaned_value:
            transliteration_map[raw_scheme.strip().lower()] = cleaned_value

    sorted_transliteration_items = sorted(transliteration_map.items(), key=lambda item: item[0])
    first_transliteration = sorted_transliteration_items[0] if sorted_transliteration_items else None

    if preferred_mode == "script" and script_text:
        return {
            "text": script_text,
            "mode": "script",
            "scheme": None,
            "generated": False,
        }

    if preferred_mode == "transliteration":
        preferred_value = transliteration_map.get(preferred_scheme)
        if preferred_value:
            return {
                "text": preferred_value,
                "mode": "transliteration",
                "scheme": preferred_scheme,
                "generated": False,
            }
        if first_transliteration:
            return {
                "text": first_transliteration[1],
                "mode": "transliteration",
                "scheme": first_transliteration[0],
                "generated": False,
            }

    preferred_scheme_value = transliteration_map.get(preferred_scheme)
    if preferred_scheme_value:
        return {
            "text": preferred_scheme_value,
            "mode": "transliteration",
            "scheme": preferred_scheme,
            "generated": False,
        }

    if allow_runtime_generation:
        if preferred_mode == "script" and not script_text and first_transliteration:
            generated_script = latin_to_devanagari(first_transliteration[1])
            if generated_script:
                return {
                    "text": generated_script,
                    "mode": "script",
                    "scheme": None,
                    "generated": True,
                }

        if preferred_mode == "transliteration" and script_text:
            generated_iast = devanagari_to_iast(script_text)
            if generated_iast:
                return {
                    "text": generated_iast,
                    "mode": "transliteration",
                    "scheme": "iast",
                    "generated": True,
                }

    if script_text:
        return {
            "text": script_text,
            "mode": "script",
            "scheme": None,
            "generated": False,
        }

    if first_transliteration:
        return {
            "text": first_transliteration[1],
            "mode": "transliteration",
            "scheme": first_transliteration[0],
            "generated": False,
        }

    return {
        "text": "",
        "mode": preferred_mode if preferred_mode in {"script", "transliteration"} else "script",
        "scheme": preferred_scheme if preferred_scheme else "iast",
        "generated": False,
    }


def _resolve_word_meanings_rows(
    content_data: dict,
    resolved_metadata: dict | None = None,
) -> list[dict[str, object]]:
    if not isinstance(content_data, dict):
        return []

    word_meanings_payload = (
        content_data.get("word_meanings") if isinstance(content_data.get("word_meanings"), dict) else {}
    )
    rows = word_meanings_payload.get("rows") if isinstance(word_meanings_payload.get("rows"), list) else []
    if not rows:
        return []

    preferred_mode, preferred_scheme, allow_runtime_generation = _resolve_word_meanings_runtime_config(
        resolved_metadata
    )
    (
        preferred_meaning_language,
        meaning_fallback_order,
        show_badge_when_fallback_used,
    ) = _resolve_word_meanings_meaning_config(resolved_metadata)

    resolved_rows: list[dict[str, object]] = []
    for index, raw_row in enumerate(rows):
        if not isinstance(raw_row, dict):
            continue

        source_payload = raw_row.get("source") if isinstance(raw_row.get("source"), dict) else {}
        meanings_payload = raw_row.get("meanings") if isinstance(raw_row.get("meanings"), dict) else {}
        transliteration_payload = (
            source_payload.get("transliteration")
            if isinstance(source_payload.get("transliteration"), dict)
            else {}
        )

        normalized_meanings: dict[str, dict[str, str]] = {}
        for language, payload in meanings_payload.items():
            if not isinstance(language, str) or not language.strip() or not isinstance(payload, dict):
                continue
            text_value = _as_clean_string(payload.get("text"))
            if text_value:
                normalized_meanings[language.strip().lower()] = {"text": text_value}

        resolved_rows.append(
            {
                "id": _as_clean_string(raw_row.get("id")) or f"wm_row_{index + 1}",
                "order": _safe_int(raw_row.get("order")) or (index + 1),
                "source": {
                    "language": _as_clean_string(source_payload.get("language")),
                    "script_text": _normalize_devanagari_text(_as_clean_string(source_payload.get("script_text"))),
                    "transliteration": {
                        key.strip().lower(): _as_clean_string(value)
                        for key, value in transliteration_payload.items()
                        if isinstance(key, str)
                        and key.strip()
                        and _as_clean_string(value)
                    },
                },
                "meanings": normalized_meanings,
                "resolved_meaning": _resolve_word_meaning_meaning_text(
                    meanings_payload=normalized_meanings,
                    preferred_language=preferred_meaning_language,
                    fallback_order=meaning_fallback_order,
                    show_badge_when_fallback_used=show_badge_when_fallback_used,
                ),
                "resolved_source": _resolve_word_meaning_source_token(
                    source_payload=source_payload,
                    preferred_mode=preferred_mode,
                    preferred_scheme=preferred_scheme,
                    allow_runtime_generation=allow_runtime_generation,
                ),
            }
        )

    resolved_rows.sort(key=lambda row: (int(row.get("order") or 0), str(row.get("id") or "")))
    return resolved_rows


def _resolve_referenced_source_node(
    db: Session,
    node: ContentNode | None,
    resolved_cache: dict[int, ContentNode | None] | None = None,
) -> ContentNode | None:
    if node is None:
        return None

    if isinstance(resolved_cache, dict) and node.id in resolved_cache:
        return resolved_cache[node.id]

    resolved = node
    chain_ids: list[int] = []
    visited_ids: set[int] = set()
    while resolved.referenced_node_id:
        if resolved.id in visited_ids:
            break
        visited_ids.add(resolved.id)
        chain_ids.append(resolved.id)

        if isinstance(resolved_cache, dict) and resolved.referenced_node_id in resolved_cache:
            cached = resolved_cache[resolved.referenced_node_id]
            if cached is not None:
                resolved = cached
            break

        next_source = (
            db.query(ContentNode)
            .filter(ContentNode.id == resolved.referenced_node_id)
            .first()
        )
        if not next_source:
            break
        resolved = next_source

    if isinstance(resolved_cache, dict):
        resolved_cache[node.id] = resolved
        for chain_id in chain_ids:
            resolved_cache.setdefault(chain_id, resolved)

    return resolved


def _build_template_context(
    source_node: ContentNode | None,
    item: dict,
    resolved_metadata: dict | None = None,
) -> dict:
    if source_node is None:
        base_context = {
            "title": _as_clean_string(item.get("title")),
            "level_name": _as_clean_string(item.get("level_name")),
            "sequence_number": _as_clean_string(item.get("sequence_number")),
            "sanskrit": "",
            "transliteration": "",
            "english": "",
            "text": "",
            "word_meanings_rows": [],
        }
    else:
        content_data = source_node.content_data if isinstance(source_node.content_data, dict) else {}
        summary_data = source_node.summary_data if isinstance(source_node.summary_data, dict) else {}
        basic_data = content_data.get("basic") if isinstance(content_data.get("basic"), dict) else {}
        translations_data = (
            content_data.get("translations") if isinstance(content_data.get("translations"), dict) else {}
        )
        summary_basic = summary_data.get("basic") if isinstance(summary_data.get("basic"), dict) else {}
        summary_translations = (
            summary_data.get("translations") if isinstance(summary_data.get("translations"), dict) else {}
        )

        sanskrit_text = (
            basic_data.get("sanskrit")
            or basic_data.get("text_sanskrit")
            or content_data.get("sanskrit")
            or content_data.get("text_sanskrit")
            or summary_basic.get("sanskrit")
            or summary_data.get("sanskrit")
            or source_node.title_sanskrit
            or ""
        )
        transliteration_text = (
            basic_data.get("transliteration")
            or basic_data.get("iast")
            or content_data.get("transliteration")
            or content_data.get("iast")
            or content_data.get("text_transliteration")
            or summary_basic.get("transliteration")
            or summary_basic.get("iast")
            or summary_data.get("transliteration")
            or source_node.title_transliteration
            or ""
        )
        english_text = (
            translations_data.get("english")
            or translations_data.get("en")
            or summary_translations.get("english")
            or summary_translations.get("en")
            or basic_data.get("english")
            or basic_data.get("translation")
            or content_data.get("text_english")
            or content_data.get("english")
            or content_data.get("en")
            or content_data.get("translation")
            or summary_basic.get("english")
            or summary_basic.get("translation")
            or summary_data.get("text_english")
            or summary_data.get("english")
            or summary_data.get("en")
            or summary_data.get("translation")
            or source_node.title_english
            or ""
        )
        fallback_text = (
            basic_data.get("text")
            or content_data.get("text")
            or content_data.get("content")
            or summary_basic.get("text")
            or summary_data.get("text")
            or summary_data.get("content")
            or ""
        )

        title_value = _as_clean_string(source_node.title_english) or _as_clean_string(item.get("title"))

        base_context = {
            "title": title_value,
            "level_name": _as_clean_string(source_node.level_name),
            "sequence_number": _as_clean_string(source_node.sequence_number),
            "sanskrit": _normalize_devanagari_text(_as_clean_string(sanskrit_text)),
            "transliteration": _as_clean_string(transliteration_text),
            "english": _as_clean_string(english_text),
            "text": _as_clean_string(fallback_text),
            "word_meanings_rows": _resolve_word_meanings_rows(content_data, resolved_metadata),
        }

    metadata_context: dict = {}
    if isinstance(resolved_metadata, dict):
        for key, value in resolved_metadata.items():
            if not isinstance(key, str) or not key.strip():
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                metadata_context[key.strip()] = value
            elif isinstance(value, (list, dict)):
                metadata_context[key.strip()] = json.dumps(value, ensure_ascii=False)
            else:
                metadata_context[key.strip()] = _as_clean_string(value)

    for field_name in ("title", "level_name", "sequence_number", "sanskrit", "transliteration", "english", "text"):
        value = base_context.get(field_name)
        if value not in (None, ""):
            metadata_context.setdefault(field_name, value)

    base_context["metadata"] = metadata_context
    return base_context


def _normalize_template_field_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {"title", "sanskrit", "transliteration", "english", "text"}:
        return normalized
    return None


def _resolve_default_template_fields(
    section_name: str,
    level_name: str | None,
    resolved_metadata: dict | None = None,
) -> list[str]:
    if isinstance(resolved_metadata, dict):
        metadata_fields = resolved_metadata.get("template_fields")
        if not isinstance(metadata_fields, list):
            metadata_fields = resolved_metadata.get("render_fields")
        if isinstance(metadata_fields, list):
            normalized_fields = [
                field_name
                for field_name in (_normalize_template_field_name(item) for item in metadata_fields)
                if field_name
            ]
            if normalized_fields:
                return normalized_fields

    normalized_level = level_name.strip().lower() if isinstance(level_name, str) and level_name.strip() else ""
    if normalized_level and normalized_level in _DEFAULT_TEMPLATE_FIELDS_BY_LEVEL:
        return list(_DEFAULT_TEMPLATE_FIELDS_BY_LEVEL[normalized_level])
    return list(_DEFAULT_TEMPLATE_FIELDS_BY_SECTION.get(section_name, ["english", "text"]))


def _resolve_default_template_labels(resolved_metadata: dict | None) -> dict[str, str]:
    labels = dict(_DEFAULT_TEMPLATE_FIELD_LABELS)
    if not isinstance(resolved_metadata, dict):
        return labels

    metadata_labels = resolved_metadata.get("template_field_labels")
    if not isinstance(metadata_labels, dict):
        metadata_labels = resolved_metadata.get("render_field_labels")
    if not isinstance(metadata_labels, dict):
        return labels

    for key, value in metadata_labels.items():
        field_name = _normalize_template_field_name(key)
        label_text = _as_clean_string(value)
        if field_name and label_text:
            labels[field_name] = label_text

    return labels


def _build_default_liquid_template_from_fields(fields: list[str], labels: dict[str, str] | None = None) -> str:
    resolved_labels = labels or _DEFAULT_TEMPLATE_FIELD_LABELS
    lines: list[str] = []
    for field_name in fields:
        label = resolved_labels.get(field_name, field_name.title())
        lines.append(f"{{% if metadata.{field_name} %}}{label}: {{{{ metadata.{field_name} }}}}\n{{% endif %}}")
    return "".join(lines)


def _resolve_liquid_template_source(
    template_key: str,
    section_name: str,
    level_name: str | None,
    resolved_metadata: dict | None = None,
    custom_template_sources: dict[str, str] | None = None,
    system_template_sources: dict[str, str] | None = None,
) -> str:
    if isinstance(custom_template_sources, dict):
        custom_source = custom_template_sources.get(template_key)
        if isinstance(custom_source, str) and custom_source.strip():
            return custom_source

    if isinstance(system_template_sources, dict):
        system_source = system_template_sources.get(template_key)
        if isinstance(system_source, str) and system_source.strip():
            return system_source

    registered = _DEFAULT_LIQUID_TEMPLATES.get(template_key)
    if isinstance(registered, str) and registered:
        return registered

    fallback_fields = _resolve_default_template_fields(section_name, level_name, resolved_metadata)
    fallback_labels = _resolve_default_template_labels(resolved_metadata)
    return _build_default_liquid_template_from_fields(fallback_fields, fallback_labels)


def _render_liquid_lines(
    template_source: str,
    context: dict,
    label_to_field: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    rendered = Template(template_source).render(**context)
    lines: list[dict[str, str]] = []
    current_field: str | None = None
    current_label: str | None = None
    resolved_label_to_field = label_to_field or _DEFAULT_TEMPLATE_LABEL_TO_FIELD

    for raw_line in rendered.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        label_prefix = ""
        if ":" in line:
            label_prefix = _as_clean_string(line.split(":", 1)[0]).lower()

        should_parse_labeled_line = bool(label_prefix) and label_prefix in resolved_label_to_field

        if not should_parse_labeled_line:
            if current_field and current_label:
                lines.append(
                    {
                        "field": current_field,
                        "label": current_label,
                        "value": line,
                    }
                )
                continue

            lines.append(
                {
                    "field": "text",
                    "label": "",
                    "value": line,
                }
            )
            continue

        label, value = line.split(":", 1)
        resolved_label = _as_clean_string(label)
        resolved_value = _as_clean_string(value)
        if not resolved_label or not resolved_value:
            continue

        field_name = resolved_label_to_field.get(resolved_label.lower(), resolved_label.lower())
        current_field = field_name
        current_label = resolved_label
        lines.append(
            {
                "field": field_name,
                "label": resolved_label,
                "value": resolved_value,
            }
        )

    return lines


def _render_block_content_with_template(
    section_name: str,
    template_key: str,
    source_node: ContentNode | None,
    item: dict,
    resolved_metadata: dict | None = None,
    custom_template_sources: dict[str, str] | None = None,
    system_template_sources: dict[str, str] | None = None,
) -> tuple[dict, str]:
    context = _build_template_context(source_node, item, resolved_metadata)
    resolved_labels = _resolve_default_template_labels(resolved_metadata)
    label_to_field = {
        _as_clean_string(label).lower(): field_name
        for field_name, label in resolved_labels.items()
        if _as_clean_string(field_name) and _as_clean_string(label)
    }
    template_source = _resolve_liquid_template_source(
        template_key,
        section_name,
        context.get("level_name"),
        resolved_metadata,
        custom_template_sources,
        system_template_sources,
    )
    try:
        rendered_lines = _render_liquid_lines(template_source, context, label_to_field)
    except Exception:
        fallback_fields = _resolve_default_template_fields(
            section_name,
            context.get("level_name"),
            resolved_metadata,
        )
        fallback_labels = _resolve_default_template_labels(resolved_metadata)
        rendered_lines = []
        for field_name in fallback_fields:
            value = _as_clean_string(context.get(field_name))
            if not value and isinstance(context.get("metadata"), dict):
                value = _as_clean_string(context["metadata"].get(field_name))
            if not value:
                continue
            rendered_lines.append(
                {
                    "field": field_name,
                    "label": fallback_labels.get(field_name, field_name.title()),
                    "value": value,
                }
            )

    content: dict = {
        "level_name": context.get("level_name"),
        "sequence_number": context.get("sequence_number"),
        "title": context.get("title"),
        "template_key": template_key,
        "rendered_lines": rendered_lines,
    }

    for field_name in ("sanskrit", "transliteration", "english", "text"):
        value = _as_clean_string(context.get(field_name))
        if not value and isinstance(context.get("metadata"), dict):
            value = _as_clean_string(context["metadata"].get(field_name))
        content[field_name] = value

    content["metadata"] = context.get("metadata", {})
    content["word_meanings_rows"] = context.get("word_meanings_rows", [])

    return content, template_source


def _extract_render_settings(snapshot_data: dict | None) -> SnapshotRenderSettings:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    raw_settings = resolved_data.get("render_settings")
    if not isinstance(raw_settings, dict):
        return SnapshotRenderSettings()

    text_order = raw_settings.get("text_order")
    parsed_order: list[str] = []
    if isinstance(text_order, list):
        parsed_order = [
            item
            for item in text_order
            if isinstance(item, str) and item in {"sanskrit", "transliteration", "english", "text"}
        ]

    return SnapshotRenderSettings(
        show_sanskrit=bool(raw_settings.get("show_sanskrit", True)),
        show_transliteration=bool(raw_settings.get("show_transliteration", True)),
        show_english=bool(raw_settings.get("show_english", True)),
        show_metadata=bool(raw_settings.get("show_metadata", True)),
        text_order=parsed_order or ["sanskrit", "transliteration", "english", "text"],
    )


def _resolve_pdf_content_lines(content: dict, render_settings: SnapshotRenderSettings) -> list[tuple[str, str]]:
    resolved_content = content if isinstance(content, dict) else {}
    rendered_lines = resolved_content.get("rendered_lines") if isinstance(resolved_content.get("rendered_lines"), list) else []

    def _resolve_word_meaning_pdf_lines() -> list[tuple[str, str]]:
        raw_rows = (
            resolved_content.get("word_meanings_rows")
            if isinstance(resolved_content.get("word_meanings_rows"), list)
            else []
        )

        rows: list[dict[str, object]] = [row for row in raw_rows if isinstance(row, dict)]
        if not rows and isinstance(resolved_content.get("word_meanings"), dict):
            rows = _resolve_word_meanings_rows(
                resolved_content,
                resolved_content.get("metadata") if isinstance(resolved_content.get("metadata"), dict) else None,
            )

        if not rows:
            return []

        sorted_rows = sorted(
            rows,
            key=lambda row: (
                int(_safe_int(row.get("order")) or 0),
                str(row.get("id") or ""),
            ),
        )

        word_meaning_lines: list[tuple[str, str]] = []
        for row in sorted_rows:
            resolved_source = row.get("resolved_source") if isinstance(row.get("resolved_source"), dict) else {}
            resolved_meaning = row.get("resolved_meaning") if isinstance(row.get("resolved_meaning"), dict) else {}

            source_text = _as_clean_string(resolved_source.get("text"))
            meaning_text = _as_clean_string(resolved_meaning.get("text"))
            if not source_text and not meaning_text:
                continue

            combined_value = " — ".join(part for part in (source_text, meaning_text) if part)
            label = "Word Meanings" if not word_meaning_lines else ""
            word_meaning_lines.append((label, combined_value))

        return word_meaning_lines

    word_meaning_lines = _resolve_word_meaning_pdf_lines()

    if rendered_lines:
        visible_by_key: dict[str, bool] = {
            "sanskrit": render_settings.show_sanskrit,
            "transliteration": render_settings.show_transliteration,
            "english": render_settings.show_english,
            "text": True,
        }
        lines: list[tuple[str, str]] = []
        previous_field_name: str | None = None
        for line in rendered_lines:
            if not isinstance(line, dict):
                continue

            field_name = _as_clean_string(line.get("field")).lower()
            raw_label = _as_clean_string(line.get("label"))
            label = raw_label if raw_label else _DEFAULT_TEMPLATE_FIELD_LABELS.get(field_name, field_name.title())
            value = _as_clean_string(line.get("value"))
            if not value:
                continue

            if field_name in visible_by_key and not visible_by_key.get(field_name, False):
                continue

            if not raw_label and field_name == "text":
                lines.append(("", value))
            else:
                display_label = label
                if field_name and field_name == previous_field_name:
                    display_label = ""
                lines.append((display_label, value))

            previous_field_name = field_name or None

        if lines:
            return lines + word_meaning_lines

    visible_by_key: dict[str, bool] = {
        "sanskrit": render_settings.show_sanskrit,
        "transliteration": render_settings.show_transliteration,
        "english": render_settings.show_english,
        "text": True,
    }
    labels: dict[str, str] = {
        "sanskrit": "Sanskrit",
        "transliteration": "Transliteration",
        "english": "English",
        "text": "Text",
    }

    lines: list[tuple[str, str]] = []
    for key in render_settings.text_order:
        if not visible_by_key.get(key, False):
            continue

        value = resolved_content.get(key)
        if not isinstance(value, str):
            continue

        cleaned = value.strip()
        if not cleaned:
            continue

        lines.append((labels.get(key, key.title()), cleaned))

    if not lines:
        fallback = resolved_content.get("text")
        if isinstance(fallback, str) and fallback.strip():
            lines.append(("Text", fallback.strip()))

    return lines + word_meaning_lines


def _render_book_preview_template(
    preview_payload: dict,
    display_title: str,
    sections: SnapshotRenderSections,
    custom_template_sources: dict[str, str] | None = None,
    system_template_sources: dict[str, str] | None = None,
) -> BookPreviewTemplatePublic:
    template_bindings = _extract_template_bindings(preview_payload)
    configured_template = _read_template_key(template_bindings.get("book_template_key"))
    template_key = configured_template or "default.book.content_item.v1"
    template_source = _resolve_liquid_template_source(
        template_key=template_key,
        section_name="body",
        level_name="book",
        resolved_metadata=None,
        custom_template_sources=custom_template_sources,
        system_template_sources=system_template_sources,
    )

    child_titles: list[str] = []
    for block in sections.body:
        title = _as_clean_string(block.title)
        if not title:
            continue
        normalized = " ".join(title.split())
        if len(normalized) > 80:
            normalized = f"{normalized[:77].rstrip()}..."
        child_titles.append(normalized)

    max_children = 8
    visible_children = child_titles[:max_children]
    hidden_count = max(len(child_titles) - max_children, 0)
    children_summary = ", ".join(visible_children)
    if hidden_count > 0:
        children_summary = f"{children_summary} (+{hidden_count} more)" if children_summary else f"(+{hidden_count} more)"

    context = {
        "title": _as_clean_string(display_title),
        "child_count": str(len(sections.body)),
        "children": children_summary,
    }
    rendered_text = Template(template_source).render(**context).strip()

    return BookPreviewTemplatePublic(
        template_key=template_key,
        resolved_template_source=template_source,
        rendered_text=rendered_text,
        child_count=len(sections.body),
    )


def _materialize_snapshot_render_sections(snapshot_data: dict | None, db: Session) -> SnapshotRenderSections:
    total_start = perf_counter()
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    section_names = ("front", "body", "back")
    section_blocks: dict[str, list[SnapshotRenderBlock]] = {"front": [], "body": [], "back": []}
    source_node_ids: set[int] = set()

    extraction_start = perf_counter()
    template_bindings = _extract_template_bindings(resolved_data)
    metadata_bindings = _extract_metadata_bindings(resolved_data)
    custom_template_sources = _extract_custom_template_sources(resolved_data)
    system_template_sources = _load_system_template_sources(db)
    extraction_ms = (perf_counter() - extraction_start) * 1000

    timing_by_section: dict[str, dict[str, float | int]] = {}

    for section_name in section_names:
        section_start = perf_counter()
        raw_section = resolved_data.get(section_name)
        if not isinstance(raw_section, list):
            timing_by_section[section_name] = {
                "raw_items": 0,
                "candidates": 0,
                "blocks": 0,
                "duration_ms": round((perf_counter() - section_start) * 1000, 2),
            }
            continue

        candidates: list[tuple[tuple[int, int, int, str, int], dict]] = []
        source_nodes_by_book_id: dict[int, list[ContentNode]] = {}
        for index, raw_item in enumerate(raw_section):
            if not isinstance(raw_item, dict):
                continue

            explicit_order = _safe_int(raw_item.get("order"))
            sequence_number = _safe_int(raw_item.get("sequence_number"))
            source_node_id = _safe_int(raw_item.get("node_id"))
            source_book_id = _safe_int(raw_item.get("source_book_id"))

            if _is_book_body_reference_item(
                section_name=section_name,
                raw_item=raw_item,
                source_node_id=source_node_id,
                source_book_id=source_book_id,
            ):
                if source_book_id not in source_nodes_by_book_id:
                    source_nodes = (
                        db.query(ContentNode)
                        .filter(ContentNode.book_id == source_book_id)
                        .all()
                    )
                    source_nodes_by_book_id[source_book_id] = _ordered_nodes_by_hierarchy(source_nodes)

                expanded_nodes = source_nodes_by_book_id[source_book_id]
                for expanded_index, node in enumerate(expanded_nodes):
                    expanded_sequence = _safe_int(node.sequence_number)
                    expanded_title = _book_title_for_preview(node)
                    expanded_sort_key = (
                        explicit_order if explicit_order is not None else 10**9,
                        node.level_order if isinstance(node.level_order, int) else 10**9,
                        expanded_sequence if expanded_sequence is not None else 10**9,
                        expanded_title.lower(),
                        (index * 10**4) + expanded_index,
                    )

                    candidates.append(
                        (
                            expanded_sort_key,
                            {
                                "source_node_id": node.id,
                                "source_book_id": source_book_id,
                                "level_name": node.level_name,
                                "metadata": raw_item.get("metadata") if isinstance(raw_item.get("metadata"), dict) else None,
                                "metadata_overrides": raw_item.get("metadata_overrides") if isinstance(raw_item.get("metadata_overrides"), dict) else None,
                                "title": expanded_title,
                            },
                        )
                    )
                    source_node_ids.add(node.id)

                continue

            title_value = raw_item.get("title")
            title = title_value.strip() if isinstance(title_value, str) and title_value.strip() else "Untitled"

            sort_key = (
                explicit_order if explicit_order is not None else 10**9,
                sequence_number if sequence_number is not None else 10**9,
                source_node_id if source_node_id is not None else 10**9,
                title.lower(),
                index,
            )

            candidates.append(
                (
                    sort_key,
                    {
                        "source_node_id": source_node_id,
                        "source_book_id": source_book_id,
                        "level_name": raw_item.get("level_name") if isinstance(raw_item.get("level_name"), str) else None,
                        "metadata": raw_item.get("metadata") if isinstance(raw_item.get("metadata"), dict) else None,
                        "metadata_overrides": raw_item.get("metadata_overrides") if isinstance(raw_item.get("metadata_overrides"), dict) else None,
                        "title": title,
                    },
                )
            )

            if source_node_id is not None and source_node_id > 0:
                source_node_ids.add(source_node_id)

        source_nodes_by_id: dict[int, ContentNode] = {}
        if source_node_ids:
            source_nodes = db.query(ContentNode).filter(ContentNode.id.in_(sorted(source_node_ids))).all()
            source_nodes_by_id = {node.id: node for node in source_nodes}

        binding_cache = _build_template_binding_metadata_cache(
            db,
            [item for _, item in candidates],
        )
        referenced_node_cache: dict[int, ContentNode | None] = {}

        candidates.sort(key=lambda item: item[0])

        materialized_blocks: list[SnapshotRenderBlock] = []
        for block_index, (_, item) in enumerate(candidates, start=1):
            source_node = source_nodes_by_id.get(item["source_node_id"]) if item["source_node_id"] else None
            source_node = _resolve_referenced_source_node(db, source_node, resolved_cache=referenced_node_cache)
            resolved_metadata = _resolve_block_metadata(
                db=db,
                item=item,
                source_node=source_node,
                metadata_bindings=metadata_bindings,
                binding_cache=binding_cache,
            )
            template_key = _resolve_block_template_key(
                section_name=section_name,
                item=item,
                source_node=source_node,
                template_bindings=template_bindings,
                resolved_metadata=resolved_metadata,
            )
            block_content, resolved_template_source = _render_block_content_with_template(
                section_name=section_name,
                template_key=template_key,
                source_node=source_node,
                item=item,
                resolved_metadata=resolved_metadata,
                custom_template_sources=custom_template_sources,
                system_template_sources=system_template_sources,
            )
            materialized_blocks.append(
                SnapshotRenderBlock(
                    section=section_name,
                    order=block_index,
                    block_type="content_item",
                    template_key=template_key,
                    resolved_template_source=resolved_template_source,
                    source_node_id=item["source_node_id"],
                    source_book_id=item["source_book_id"],
                    title=item["title"],
                    resolved_metadata=resolved_metadata,
                    content=block_content,
                )
            )

        section_blocks[section_name] = materialized_blocks
        timing_by_section[section_name] = {
            "raw_items": len(raw_section),
            "candidates": len(candidates),
            "blocks": len(materialized_blocks),
            "duration_ms": round((perf_counter() - section_start) * 1000, 2),
        }

    total_ms = (perf_counter() - total_start) * 1000
    logger.info(
        "preview_render_timing %s",
        {
            "stage": "materialize_snapshot_render_sections",
            "extraction_ms": round(extraction_ms, 2),
            "total_ms": round(total_ms, 2),
            "section_timing": timing_by_section,
        },
    )

    return SnapshotRenderSections(
        front=section_blocks["front"],
        body=section_blocks["body"],
        back=section_blocks["back"],
    )


def _extract_source_node_ids(section_structure: dict | None) -> set[int]:
    if not isinstance(section_structure, dict):
        return set()

    node_ids: set[int] = set()
    for section_name in ("front", "body", "back"):
        section_items = section_structure.get(section_name)
        if not isinstance(section_items, list):
            continue

        for raw_item in section_items:
            if not isinstance(raw_item, dict):
                continue

            node_id_value = raw_item.get("node_id")
            try:
                node_id = int(node_id_value)
            except (TypeError, ValueError):
                continue

            if node_id > 0:
                node_ids.add(node_id)

    return node_ids


def _build_draft_license_policy_report(
    section_structure: dict | None,
    db: Session,
) -> DraftLicensePolicyReport:
    source_node_ids = _extract_source_node_ids(section_structure)
    if not source_node_ids:
        return DraftLicensePolicyReport(status="pass")

    rows = (
        db.query(ContentNode.id, ContentNode.license_type)
        .filter(ContentNode.id.in_(source_node_ids))
        .all()
    )
    licenses_by_node_id = {row.id: row.license_type for row in rows}

    # Only evaluate nodes that resolve to actual content records.
    # Draft structure may include placeholders/manual entries with non-existent node_id values.
    resolved_source_node_ids = sorted(licenses_by_node_id.keys())
    if not resolved_source_node_ids:
        return DraftLicensePolicyReport(status="pass")

    warning_issues: list[DraftLicensePolicyIssue] = []
    blocked_issues: list[DraftLicensePolicyIssue] = []

    for source_node_id in resolved_source_node_ids:
        license_type = normalize_license(licenses_by_node_id.get(source_node_id))
        action = classify_license_action(license_type)
        if action == "allow":
            continue

        issue = DraftLicensePolicyIssue(
            source_node_id=source_node_id,
            license_type=license_type,
            policy_action=action,
        )
        if action == "block":
            blocked_issues.append(issue)
        else:
            warning_issues.append(issue)

    if blocked_issues:
        status_value = "block"
    elif warning_issues:
        status_value = "warn"
    else:
        status_value = "pass"

    return DraftLicensePolicyReport(
        status=status_value,
        warning_issues=warning_issues,
        blocked_issues=blocked_issues,
    )


def _extract_source_items(section_structure: dict | None) -> list[dict]:
    if not isinstance(section_structure, dict):
        return []

    items: list[dict] = []
    for section_name in ("front", "body", "back"):
        section_items = section_structure.get(section_name)
        if not isinstance(section_items, list):
            continue

        for raw_item in section_items:
            if not isinstance(raw_item, dict):
                continue

            node_id_value = raw_item.get("node_id")
            try:
                source_node_id = int(node_id_value)
            except (TypeError, ValueError):
                continue
            if source_node_id <= 0:
                continue

            source_book_id_value = raw_item.get("source_book_id")
            source_book_id = None
            try:
                parsed_book_id = int(source_book_id_value)
                if parsed_book_id > 0:
                    source_book_id = parsed_book_id
            except (TypeError, ValueError):
                source_book_id = None

            title_value = raw_item.get("title")
            if isinstance(title_value, str) and title_value.strip():
                title = title_value.strip()
            else:
                title = f"Node {source_node_id}"

            items.append(
                {
                    "section": section_name,
                    "source_node_id": source_node_id,
                    "source_book_id": source_book_id,
                    "title": title,
                }
            )

    return items


def _build_draft_provenance_appendix(
    section_structure: dict | None,
    db: Session,
) -> DraftProvenanceAppendix:
    source_items = _extract_source_items(section_structure)
    if not source_items:
        return DraftProvenanceAppendix(entries=[])

    source_node_ids = sorted({int(item["source_node_id"]) for item in source_items})
    source_nodes = (
        db.query(ContentNode.id, ContentNode.book_id, ContentNode.title_english, ContentNode.license_type, ContentNode.source_attribution)
        .filter(ContentNode.id.in_(source_node_ids))
        .all()
    )
    source_node_by_id = {row.id: row for row in source_nodes}

    provenance_records = (
        db.query(ProvenanceRecord)
        .filter(ProvenanceRecord.source_node_id.in_(source_node_ids))
        .order_by(ProvenanceRecord.id.desc())
        .all()
    )

    provenance_by_source: dict[tuple[int, int | None], ProvenanceRecord] = {}
    for record in provenance_records:
        if record.source_node_id is None:
            continue
        key = (int(record.source_node_id), record.source_book_id)
        if key not in provenance_by_source:
            provenance_by_source[key] = record

    entries: list[DraftProvenanceAppendixEntry] = []
    for item in source_items:
        source_node_id = int(item["source_node_id"])
        source_book_id = item.get("source_book_id")
        key = (source_node_id, source_book_id)
        record = provenance_by_source.get(key) or provenance_by_source.get((source_node_id, None))
        source_node = source_node_by_id.get(source_node_id)

        node_license = normalize_license(source_node.license_type) if source_node else "UNKNOWN"
        license_type = normalize_license(record.license_type) if record and record.license_type else node_license
        source_author = None
        if record and record.source_author:
            source_author = record.source_author
        elif source_node and source_node.source_attribution:
            source_author = source_node.source_attribution

        source_version = "latest"
        if record and record.source_version:
            source_version = record.source_version

        title = str(item["title"])
        if source_node and source_node.title_english and source_node.title_english.strip():
            title = source_node.title_english.strip()

        entry_source_book_id = source_book_id
        if entry_source_book_id is None and source_node and source_node.book_id:
            entry_source_book_id = int(source_node.book_id)

        entries.append(
            DraftProvenanceAppendixEntry(
                section=item["section"],
                source_node_id=source_node_id,
                source_book_id=entry_source_book_id,
                title=title,
                source_author=source_author,
                license_type=license_type,
                source_version=source_version,
            )
        )

    return DraftProvenanceAppendix(entries=entries)


def _create_snapshot_for_draft(
    draft: DraftBook,
    owner_id: int,
    snapshot_data: dict | None,
    version: int | None,
    db: Session,
) -> EditionSnapshot:
    latest = (
        db.query(EditionSnapshot)
        .filter(EditionSnapshot.draft_book_id == draft.id)
        .order_by(EditionSnapshot.version.desc())
        .first()
    )
    next_version = version or ((latest.version + 1) if latest else 1)

    snapshot = EditionSnapshot(
        draft_book_id=draft.id,
        owner_id=owner_id,
        version=next_version,
        snapshot_data=snapshot_data or draft.section_structure or _default_sections(),
        immutable=True,
    )
    db.add(snapshot)
    draft.status = "published"
    db.commit()
    db.refresh(snapshot)
    return snapshot


def _build_draft_revision_events(draft: DraftBook, db: Session) -> list[DraftRevisionEventPublic]:
    snapshots = (
        db.query(EditionSnapshot)
        .filter(EditionSnapshot.draft_book_id == draft.id)
        .order_by(EditionSnapshot.created_at.asc(), EditionSnapshot.id.asc())
        .all()
    )

    events: list[DraftRevisionEventPublic] = [
        DraftRevisionEventPublic(
            sequence=1,
            event_type="draft.created",
            entity_type="draft_book",
            entity_id=draft.id,
            draft_book_id=draft.id,
            actor_user_id=draft.owner_id,
            occurred_at=draft.created_at,
            metadata={"status": draft.status},
        )
    ]

    for snapshot in snapshots:
        fingerprint = (
            snapshot.snapshot_data.get("snapshot_fingerprint")
            if isinstance(snapshot.snapshot_data, dict)
            else {}
        )
        metadata: dict = {}
        if isinstance(fingerprint, dict):
            combined_hash = fingerprint.get("combined_hash")
            if isinstance(combined_hash, str) and combined_hash:
                metadata["combined_hash"] = combined_hash

        events.append(
            DraftRevisionEventPublic(
                sequence=len(events) + 1,
                event_type="snapshot.created",
                entity_type="edition_snapshot",
                entity_id=snapshot.id,
                draft_book_id=draft.id,
                actor_user_id=snapshot.owner_id,
                occurred_at=snapshot.created_at,
                snapshot_id=snapshot.id,
                snapshot_version=snapshot.version,
                immutable=snapshot.immutable,
                metadata=metadata,
            )
        )

    return events


def _generate_snapshot_pdf(snapshot: EditionSnapshot, draft_title: str | None, db: Session) -> bytes:
    appendix_raw = snapshot.snapshot_data.get("provenance_appendix") if isinstance(snapshot.snapshot_data, dict) else None
    appendix_entries = []
    if isinstance(appendix_raw, dict):
        raw_entries = appendix_raw.get("entries")
        if isinstance(raw_entries, list):
            appendix_entries = [entry for entry in raw_entries if isinstance(entry, dict)]

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter, invariant=1)
    page_width, page_height = letter

    left_margin = 48
    top_margin = 56
    line_height = 14
    devanagari_line_height = 17
    y = page_height - top_margin
    pdf_font_name = _resolve_pdf_font_name()
    pdf_devanagari_font_name = _resolve_pdf_devanagari_font_name()

    def write_line(text: str, font_name: str | None = None, font_size: int = 10, use_devanagari: bool = False):
        nonlocal y
        if y < 56:
            pdf.showPage()
            y = page_height - top_margin

        resolved_font = font_name or (pdf_devanagari_font_name if use_devanagari else pdf_font_name)
        if pdf_font_name != "Helvetica" and resolved_font.startswith("Helvetica"):
            resolved_font = pdf_font_name

        pdf.setFont(resolved_font, font_size)
        pdf.drawString(left_margin, y, text)
        y -= devanagari_line_height if use_devanagari else line_height

    effective_title = draft_title or f"Draft {snapshot.draft_book_id}"
    write_line(f"Edition Snapshot Export — {effective_title}", "Helvetica-Bold", 14)
    write_line(f"Version: v{snapshot.version}", "Helvetica", 10)
    write_line(f"Snapshot ID: {snapshot.id}", "Helvetica", 10)
    write_line(f"Created At: {snapshot.created_at.isoformat()}", "Helvetica", 10)
    write_line("", "Helvetica", 10)

    sections = _materialize_snapshot_render_sections(snapshot.snapshot_data, db)
    render_settings = _extract_render_settings(snapshot.snapshot_data)

    write_line("Rendered Content", "Helvetica-Bold", 12)
    for section_name in ("front", "body", "back"):
        blocks = getattr(sections, section_name, [])
        section_label = section_name.title()
        write_line(f"{section_label} ({len(blocks)})", "Helvetica-Bold", 11)

        if not blocks:
            write_line("No items in this section.")
            write_line("", "Helvetica", 10)
            continue

        for block in blocks:
            write_line(f"{block.order}. {block.title}", "Helvetica-Bold", 10)

            block_content = block.content if isinstance(block.content, dict) else {}
            content_lines = _resolve_pdf_content_lines(block_content, render_settings)
            for label, value in content_lines:
                wrapped = textwrap.wrap(value, width=110) or [value]
                is_sanskrit = label.lower() == "sanskrit"
                if wrapped:
                    first_line_text = f"   {wrapped[0]}" if not label else f"   {label}: {wrapped[0]}"
                    write_line(first_line_text, font_size=11 if is_sanskrit else 10, use_devanagari=is_sanskrit)
                    for continuation in wrapped[1:]:
                        write_line(
                            f"   {continuation}",
                            font_size=11 if is_sanskrit else 10,
                            use_devanagari=is_sanskrit,
                        )

            if render_settings.show_metadata:
                metadata_parts = [f"template={block.template_key}"]
                if block.source_node_id is not None:
                    metadata_parts.append(f"source_node={block.source_node_id}")
                sequence_number = block_content.get("sequence_number")
                if sequence_number is not None:
                    metadata_parts.append(f"seq={sequence_number}")
                write_line("   " + " • ".join(metadata_parts))

            write_line("", "Helvetica", 10)

    write_line("", "Helvetica", 10)

    write_line("Provenance Appendix", "Helvetica-Bold", 12)
    if not appendix_entries:
        write_line("No provenance appendix entries available.")
    else:
        write_line(f"Total entries: {len(appendix_entries)}")
        write_line("", "Helvetica", 10)
        for index, entry in enumerate(appendix_entries, start=1):
            section = str(entry.get("section") or "body")
            title = str(entry.get("title") or f"Node {entry.get('source_node_id', 'unknown')}")
            source_node_id = entry.get("source_node_id", "unknown")
            source_book_id = entry.get("source_book_id", "unknown")
            license_type = str(entry.get("license_type") or "UNKNOWN")
            source_author = str(entry.get("source_author") or "Unknown")
            source_version = str(entry.get("source_version") or "latest")

            write_line(f"{index}. [{section}] {title}")
            write_line(f"   source_node_id={source_node_id} source_book_id={source_book_id}")
            write_line(f"   license={license_type} author={source_author} version={source_version}")
            write_line("", "Helvetica", 10)

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


@router.post("/draft-books", response_model=DraftBookPublic, status_code=status.HTTP_201_CREATED)
def create_draft_book(
    payload: DraftBookCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = DraftBook(
        owner_id=current_user.id,
        title=payload.title,
        description=payload.description,
        section_structure=payload.section_structure or _default_sections(),
        status="draft",
    )
    db.add(draft)
    db.flush()
    ensure_default_metadata_binding_for_draft(db, draft.id)
    db.commit()
    db.refresh(draft)
    return DraftBookPublic.model_validate(draft)


@router.post(
    "/draft-books/admin/create-clean",
    response_model=DraftBookPublic,
    status_code=status.HTTP_201_CREATED,
)
def admin_create_clean_draft_book(
    payload: AdminDraftBookCreate,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
):
    owner_id = payload.owner_id or current_user.id
    owner = db.query(User).filter(User.id == owner_id).first()
    if not owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Owner user not found")

    draft = DraftBook(
        owner_id=owner_id,
        title=(payload.title or "Admin Test Draft").strip() or "Admin Test Draft",
        description=payload.description,
        section_structure=payload.section_structure or _default_sections(),
        status="draft",
    )
    db.add(draft)
    db.flush()
    ensure_default_metadata_binding_for_draft(db, draft.id)
    db.commit()
    db.refresh(draft)
    return DraftBookPublic.model_validate(draft)


@router.get("/draft-books/my", response_model=list[DraftBookPublic])
def list_my_drafts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    drafts = (
        db.query(DraftBook)
        .filter(DraftBook.owner_id == current_user.id)
        .order_by(DraftBook.updated_at.desc())
        .all()
    )
    return [DraftBookPublic.model_validate(item) for item in drafts]


@router.get("/draft-books/{draft_id}", response_model=DraftBookPublic)
def get_draft_book(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    return DraftBookPublic.model_validate(draft)


@router.get("/draft-books/{draft_id}/history", response_model=DraftRevisionFeedPublic)
def get_draft_history(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    events = _build_draft_revision_events(draft, db)
    return DraftRevisionFeedPublic(
        draft_book_id=draft.id,
        events=events,
    )


@router.patch("/draft-books/{draft_id}", response_model=DraftBookPublic)
def update_draft_book(
    draft_id: int,
    payload: DraftBookUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    if payload.title is not None:
        draft.title = payload.title
    if payload.description is not None:
        draft.description = payload.description
    if payload.section_structure is not None:
        draft.section_structure = payload.section_structure

    db.commit()
    db.refresh(draft)
    return DraftBookPublic.model_validate(draft)


@router.delete("/draft-books/{draft_id}", response_model=dict)
def delete_draft_book(
    draft_id: int,
    force: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    snapshot_count = (
        db.query(EditionSnapshot)
        .filter(EditionSnapshot.draft_book_id == draft.id)
        .count()
    )
    is_published = draft.status == "published"
    has_snapshots = snapshot_count > 0
    if (is_published or has_snapshots) and not force:
        reasons: list[str] = []
        if is_published:
            reasons.append("draft is published")
        if has_snapshots:
            reasons.append(f"draft has {snapshot_count} immutable snapshot(s)")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Cannot delete draft because "
                + " and ".join(reasons)
                + ". Retry with ?force=true to permanently delete the draft and its snapshots."
            ),
        )

    deleted_snapshot_count = 0
    if has_snapshots:
        deleted_snapshot_count = (
            db.query(EditionSnapshot)
            .filter(EditionSnapshot.draft_book_id == draft.id)
            .delete(synchronize_session=False)
        )

    db.delete(draft)
    db.commit()
    _audit_event(
        "draft.deleted",
        current_user.id,
        draft_id=draft_id,
        forced=force,
        deleted_snapshot_count=deleted_snapshot_count,
    )
    return {
        "message": "Deleted",
        "forced": force,
        "deleted_snapshot_count": deleted_snapshot_count,
    }


@router.get("/draft-books/{draft_id}/license-policy", response_model=DraftLicensePolicyReport)
def check_draft_license_policy(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    return _build_draft_license_policy_report(draft.section_structure, db)


@router.post(
    "/draft-books/{draft_id}/snapshots",
    response_model=EditionSnapshotPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_edition_snapshot(
    draft_id: int,
    payload: EditionSnapshotCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    license_report = _build_draft_license_policy_report(
        payload.snapshot_data or draft.section_structure,
        db,
    )
    if license_report.status == "block":
        blocked_licenses = sorted({issue.license_type for issue in license_report.blocked_issues})
        _audit_event(
            "snapshot.policy_blocked",
            current_user.id,
            draft_id=draft_id,
            blocked_licenses=blocked_licenses,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Snapshot blocked by license policy. "
                f"Disallowed license(s): {', '.join(blocked_licenses)}"
            ),
        )

    validate_draft_metadata_bindings_on_publish(draft.id, db)

    resolved_snapshot_data = payload.snapshot_data or draft.section_structure or _default_sections()
    provenance_appendix = _build_draft_provenance_appendix(resolved_snapshot_data, db)
    snapshot_payload = dict(resolved_snapshot_data)
    snapshot_payload["provenance_appendix"] = provenance_appendix.model_dump()
    _apply_template_metadata(snapshot_payload)
    _apply_snapshot_fingerprint(snapshot_payload)

    snapshot = _create_snapshot_for_draft(
        draft=draft,
        owner_id=current_user.id,
        snapshot_data=snapshot_payload,
        version=payload.version,
        db=db,
    )
    _audit_event(
        "snapshot.created",
        current_user.id,
        draft_id=draft_id,
        snapshot_id=snapshot.id,
        snapshot_version=snapshot.version,
    )
    return EditionSnapshotPublic.model_validate(snapshot)


@router.post(
    "/draft-books/{draft_id}/publish",
    response_model=DraftPublishPublic,
    status_code=status.HTTP_201_CREATED,
)
def publish_draft_book(
    draft_id: int,
    payload: DraftPublishCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    resolved_snapshot_data = payload.snapshot_data or draft.section_structure or _default_sections()
    license_report = _build_draft_license_policy_report(
        resolved_snapshot_data,
        db,
    )
    if license_report.status == "block":
        blocked_licenses = sorted({issue.license_type for issue in license_report.blocked_issues})
        _audit_event(
            "publish.policy_blocked",
            current_user.id,
            draft_id=draft_id,
            blocked_licenses=blocked_licenses,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Publish blocked by license policy. "
                f"Disallowed license(s): {', '.join(blocked_licenses)}"
            ),
        )

    validate_draft_metadata_bindings_on_publish(draft.id, db)

    template_binding_errors = _validate_template_bindings(resolved_snapshot_data)
    if template_binding_errors:
        _audit_event(
            "publish.template_validation_failed",
            current_user.id,
            draft_id=draft_id,
            error_count=len(template_binding_errors),
            template_errors=template_binding_errors,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Publish blocked by template validation.",
                "errors": template_binding_errors,
            },
        )

    provenance_appendix = _build_draft_provenance_appendix(resolved_snapshot_data, db)
    snapshot_payload = dict(resolved_snapshot_data)
    snapshot_payload["provenance_appendix"] = provenance_appendix.model_dump()
    _apply_template_metadata(snapshot_payload)
    _apply_snapshot_fingerprint(snapshot_payload)

    snapshot = _create_snapshot_for_draft(
        draft=draft,
        owner_id=current_user.id,
        snapshot_data=snapshot_payload,
        version=payload.version,
        db=db,
    )
    _audit_event(
        "publish.succeeded",
        current_user.id,
        draft_id=draft_id,
        snapshot_id=snapshot.id,
        snapshot_version=snapshot.version,
    )
    return DraftPublishPublic(
        snapshot=EditionSnapshotPublic.model_validate(snapshot),
        license_policy=license_report,
        provenance_appendix=provenance_appendix,
    )


@router.get("/draft-books/{draft_id}/snapshots", response_model=list[EditionSnapshotPublic])
def list_draft_snapshots(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    snapshots = (
        db.query(EditionSnapshot)
        .filter(EditionSnapshot.draft_book_id == draft_id)
        .order_by(EditionSnapshot.version.desc())
        .all()
    )
    return [EditionSnapshotPublic.model_validate(item) for item in snapshots]


@router.get("/edition-snapshots/{snapshot_id}", response_model=EditionSnapshotPublic)
def get_snapshot(
    snapshot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    snapshot = db.query(EditionSnapshot).filter(EditionSnapshot.id == snapshot_id).first()
    if not snapshot or snapshot.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return EditionSnapshotPublic.model_validate(snapshot)


@router.get(
    "/edition-snapshots/{snapshot_id}/render-artifact",
    response_model=SnapshotRenderArtifactPublic,
)
def get_snapshot_render_artifact(
    snapshot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    snapshot = db.query(EditionSnapshot).filter(EditionSnapshot.id == snapshot_id).first()
    if not snapshot or snapshot.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")

    sections = _materialize_snapshot_render_sections(snapshot.snapshot_data, db)
    render_settings = _extract_render_settings(snapshot.snapshot_data)
    template_metadata = _extract_template_metadata(snapshot.snapshot_data)
    return SnapshotRenderArtifactPublic(
        snapshot_id=snapshot.id,
        draft_book_id=snapshot.draft_book_id,
        version=snapshot.version,
        sections=sections,
        render_settings=render_settings,
        template_metadata=template_metadata,
    )


@router.post(
    "/draft-books/{draft_id}/preview/render",
    response_model=DraftPreviewRenderArtifactPublic,
)
def preview_draft_render(
    draft_id: int,
    payload: DraftPreviewRenderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    resolved_snapshot_data = payload.snapshot_data or draft.section_structure or _default_sections()
    preview_payload = dict(resolved_snapshot_data)
    _apply_assignment_template_bindings(
        preview_payload=preview_payload,
        db=db,
        owner_id=current_user.id,
        entity_type="draft_book",
        entity_id=draft.id,
    )
    _apply_session_template_bindings(preview_payload, payload.session_template_bindings)
    template_warnings = _validate_template_bindings(preview_payload)
    _apply_template_metadata(preview_payload)

    sections = _materialize_snapshot_render_sections(preview_payload, db)
    render_settings = _extract_render_settings(preview_payload)
    template_metadata = _extract_template_metadata(preview_payload)

    return DraftPreviewRenderArtifactPublic(
        draft_book_id=draft.id,
        sections=sections,
        render_settings=render_settings,
        template_metadata=template_metadata,
        preview_mode="session" if payload.session_template_bindings else "draft",
        warnings=template_warnings,
    )


@router.post(
    "/books/{book_id}/preview/render",
    response_model=BookPreviewRenderArtifactPublic,
)
def preview_book_render(
    book_id: int,
    payload: BookPreviewRenderRequest,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    endpoint_start = perf_counter()
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    current_user_id = current_user.id if current_user else None
    if not _book_is_visible_to_user(db, book, current_user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    source_nodes = (
        db.query(ContentNode)
        .filter(ContentNode.book_id == book.id)
        .all()
    )

    root_node: ContentNode | None = None
    if payload.node_id is not None:
        root_node = (
            db.query(ContentNode)
            .filter(ContentNode.id == payload.node_id, ContentNode.book_id == book.id)
            .first()
        )
        if not root_node:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    source_nodes = _ordered_nodes_for_preview_scope(
        source_nodes,
        root_node.id if root_node else None,
    )

    body_items = [
        {
            "node_id": node.id,
            "source_book_id": book.id,
            "level_name": node.level_name,
            "title": _book_title_for_preview(node),
            "order": index,
        }
        for index, node in enumerate(source_nodes, start=1)
    ]

    preview_payload: dict = {
        "front": [],
        "body": body_items,
        "back": [],
    }
    if isinstance(payload.render_settings, dict):
        preview_payload["render_settings"] = payload.render_settings
    if isinstance(payload.metadata_bindings, dict):
        preview_payload["metadata_bindings"] = payload.metadata_bindings

    if current_user is not None:
        _apply_assignment_template_bindings(
            preview_payload=preview_payload,
            db=db,
            owner_id=current_user.id,
            entity_type="book",
            entity_id=book.id,
        )

    _apply_session_template_bindings(preview_payload, payload.session_template_bindings)
    template_warnings = _validate_template_bindings(preview_payload)
    _apply_template_metadata(preview_payload)

    section_render_start = perf_counter()
    sections = _materialize_snapshot_render_sections(preview_payload, db)
    section_render_ms = (perf_counter() - section_render_start) * 1000
    render_settings = _extract_render_settings(preview_payload)
    template_metadata = _extract_template_metadata(preview_payload)
    display_title = _book_title_for_preview(root_node) if root_node else book.book_name
    custom_template_sources = _extract_custom_template_sources(preview_payload)
    system_template_sources = _load_system_template_sources(db)

    book_template_start = perf_counter()
    book_template = _render_book_preview_template(
        preview_payload,
        display_title,
        sections,
        custom_template_sources=custom_template_sources,
        system_template_sources=system_template_sources,
    )
    book_template_ms = (perf_counter() - book_template_start) * 1000
    total_ms = (perf_counter() - endpoint_start) * 1000

    logger.info(
        "preview_book_render_timing %s",
        {
            "book_id": book.id,
            "scope": "node" if root_node else "book",
            "root_node_id": root_node.id if root_node else None,
            "section_render_ms": round(section_render_ms, 2),
            "book_template_ms": round(book_template_ms, 2),
            "total_ms": round(total_ms, 2),
            "body_blocks": len(sections.body),
        },
    )

    return BookPreviewRenderArtifactPublic(
        book_id=book.id,
        book_name=book.book_name,
        preview_scope="node" if root_node else "book",
        root_node_id=root_node.id if root_node else None,
        root_title=display_title if root_node else None,
        sections={"body": sections.body},
        book_template=book_template,
        render_settings=render_settings,
        template_metadata=template_metadata,
        preview_mode="book",
        warnings=template_warnings,
    )


@router.get("/edition-snapshots/{snapshot_id}/export/pdf")
def export_snapshot_pdf(
    snapshot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    snapshot = db.query(EditionSnapshot).filter(EditionSnapshot.id == snapshot_id).first()
    if not snapshot or snapshot.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")

    draft = db.query(DraftBook).filter(DraftBook.id == snapshot.draft_book_id).first()
    pdf_bytes = _generate_snapshot_pdf(snapshot, draft.title if draft else None, db)
    filename = f"draft-{snapshot.draft_book_id}-edition-v{snapshot.version}.pdf"
    _audit_event(
        "snapshot.pdf_exported",
        current_user.id,
        draft_id=snapshot.draft_book_id,
        snapshot_id=snapshot.id,
        snapshot_version=snapshot.version,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/edition-snapshots/{snapshot_id}", response_model=EditionSnapshotPublic)
def update_snapshot_forbidden(
    snapshot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    snapshot = db.query(EditionSnapshot).filter(EditionSnapshot.id == snapshot_id).first()
    if not snapshot or snapshot.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Edition snapshots are immutable")
