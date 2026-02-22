import logging
from io import BytesIO
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from reportlab.lib.pagesizes import letter
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
    SnapshotRenderSections,
)
from models.user import User
from services import get_db
from services.license_policy import classify_license_action, normalize_license

router = APIRouter(tags=["draft_books"])
logger = logging.getLogger(__name__)


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


def _safe_int(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def _materialize_snapshot_render_sections(snapshot_data: dict | None) -> SnapshotRenderSections:
    resolved_data = snapshot_data if isinstance(snapshot_data, dict) else {}
    section_names = ("front", "body", "back")
    section_blocks: dict[str, list[SnapshotRenderBlock]] = {"front": [], "body": [], "back": []}

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

        candidates.sort(key=lambda item: item[0])

        materialized_blocks: list[SnapshotRenderBlock] = []
        for block_index, (_, item) in enumerate(candidates, start=1):
            materialized_blocks.append(
                SnapshotRenderBlock(
                    section=section_name,
                    order=block_index,
                    block_type="content_item",
                    template_key=f"default.{section_name}.content_item.v1",
                    source_node_id=item["source_node_id"],
                    source_book_id=item["source_book_id"],
                    title=item["title"],
                    content={},
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


def _generate_snapshot_pdf(snapshot: EditionSnapshot, draft_title: str | None) -> bytes:
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
    y = page_height - top_margin

    def write_line(text: str, font_name: str = "Helvetica", font_size: int = 10):
        nonlocal y
        if y < 56:
            pdf.showPage()
            y = page_height - top_margin
        pdf.setFont(font_name, font_size)
        pdf.drawString(left_margin, y, text[:180])
        y -= line_height

    effective_title = draft_title or f"Draft {snapshot.draft_book_id}"
    write_line(f"Edition Snapshot Export — {effective_title}", "Helvetica-Bold", 14)
    write_line(f"Version: v{snapshot.version}", "Helvetica", 10)
    write_line(f"Snapshot ID: {snapshot.id}", "Helvetica", 10)
    write_line(f"Created At: {snapshot.created_at.isoformat()}", "Helvetica", 10)
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

    pdf.showPage()
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

    sections = _materialize_snapshot_render_sections(snapshot.snapshot_data)
    return SnapshotRenderArtifactPublic(
        snapshot_id=snapshot.id,
        draft_book_id=snapshot.draft_book_id,
        version=snapshot.version,
        sections=sections,
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
    pdf_bytes = _generate_snapshot_pdf(snapshot, draft.title if draft else None)
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
