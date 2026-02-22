import logging
import textwrap
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from api.users import get_current_user
from models.content_node import ContentNode
from models.draft_book import DraftBook, EditionSnapshot
from models.provenance_record import ProvenanceRecord
from models.schemas import (
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

router = APIRouter(tags=["draft_books"])
logger = logging.getLogger(__name__)

_SNAPSHOT_TEMPLATE_FAMILY = "default.content_item"
_SNAPSHOT_TEMPLATE_VERSION = "v1"
_SNAPSHOT_TEMPLATE_PATTERN = "default.{section}.content_item.v1"
_SNAPSHOT_RENDERER = "edition_snapshot_renderer"
_SNAPSHOT_OUTPUT_PROFILE = "reader_pdf_parity_v1"


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


def _safe_int(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def _extract_render_content(source_node: ContentNode | None) -> dict:
    if source_node is None:
        return {}

    content_data = source_node.content_data if isinstance(source_node.content_data, dict) else {}
    basic_data = content_data.get("basic") if isinstance(content_data.get("basic"), dict) else {}
    translations_data = (
        content_data.get("translations") if isinstance(content_data.get("translations"), dict) else {}
    )

    sanskrit_text = (
        basic_data.get("sanskrit")
        or content_data.get("sanskrit")
        or source_node.title_sanskrit
        or ""
    )
    transliteration_text = (
        basic_data.get("transliteration")
        or content_data.get("transliteration")
        or content_data.get("text_transliteration")
        or source_node.title_transliteration
        or ""
    )
    english_text = (
        translations_data.get("english")
        or basic_data.get("translation")
        or content_data.get("text_english")
        or content_data.get("english")
        or content_data.get("translation")
        or ""
    )
    fallback_text = (
        basic_data.get("text")
        or content_data.get("text")
        or content_data.get("content")
        or ""
    )

    def _as_clean_string(value: object) -> str:
        if isinstance(value, str):
            return value.strip()
        return ""

    return {
        "level_name": source_node.level_name,
        "sequence_number": source_node.sequence_number,
        "sanskrit": _as_clean_string(sanskrit_text),
        "transliteration": _as_clean_string(transliteration_text),
        "english": _as_clean_string(english_text),
        "text": _as_clean_string(fallback_text),
    }


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

    return lines


def _materialize_snapshot_render_sections(snapshot_data: dict | None, db: Session) -> SnapshotRenderSections:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    section_names = ("front", "body", "back")
    section_blocks: dict[str, list[SnapshotRenderBlock]] = {"front": [], "body": [], "back": []}
    source_node_ids: set[int] = set()

    for section_name in section_names:
        raw_section = resolved_data.get(section_name)
        if not isinstance(raw_section, list):
            continue

        candidates: list[tuple[tuple[int, int, int, str, int], dict]] = []
        for index, raw_item in enumerate(raw_section):
            if not isinstance(raw_item, dict):
                continue

            explicit_order = _safe_int(raw_item.get("order"))
            sequence_number = _safe_int(raw_item.get("sequence_number"))
            source_node_id = _safe_int(raw_item.get("node_id"))
            source_book_id = _safe_int(raw_item.get("source_book_id"))

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

        candidates.sort(key=lambda item: item[0])

        materialized_blocks: list[SnapshotRenderBlock] = []
        for block_index, (_, item) in enumerate(candidates, start=1):
            source_node = source_nodes_by_id.get(item["source_node_id"]) if item["source_node_id"] else None
            materialized_blocks.append(
                SnapshotRenderBlock(
                    section=section_name,
                    order=block_index,
                    block_type="content_item",
                    template_key=f"default.{section_name}.content_item.v1",
                    source_node_id=item["source_node_id"],
                    source_book_id=item["source_book_id"],
                    title=item["title"],
                    content=_extract_render_content(source_node),
                )
            )

        section_blocks[section_name] = materialized_blocks

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
                    write_line(
                        f"   {label}: {wrapped[0]}",
                        font_size=11 if is_sanskrit else 10,
                        use_devanagari=is_sanskrit,
                    )
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft or draft.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    db.delete(draft)
    db.commit()
    _audit_event("draft.deleted", current_user.id, draft_id=draft_id)
    return {"message": "Deleted"}


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

    resolved_snapshot_data = payload.snapshot_data or draft.section_structure or _default_sections()
    provenance_appendix = _build_draft_provenance_appendix(resolved_snapshot_data, db)
    snapshot_payload = dict(resolved_snapshot_data)
    snapshot_payload["provenance_appendix"] = provenance_appendix.model_dump()
    _apply_template_metadata(snapshot_payload)

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

    provenance_appendix = _build_draft_provenance_appendix(resolved_snapshot_data, db)
    snapshot_payload = dict(resolved_snapshot_data)
    snapshot_payload["provenance_appendix"] = provenance_appendix.model_dump()
    _apply_template_metadata(snapshot_payload)

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
