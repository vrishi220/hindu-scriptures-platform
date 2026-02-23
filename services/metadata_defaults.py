from dataclasses import dataclass

from sqlalchemy.orm import Session

from models.draft_book import DraftBook
from models.property_system import Category, MetadataBinding

DEFAULT_DRAFT_METADATA_CATEGORY = "system_default_metadata"


@dataclass
class MetadataBackfillResult:
    scanned_drafts: int
    created_bindings: int
    default_category_found: bool


def _default_category_id(db: Session) -> int | None:
    category = (
        db.query(Category)
        .filter(
            Category.name == DEFAULT_DRAFT_METADATA_CATEGORY,
            Category.is_deprecated.is_(False),
        )
        .first()
    )
    return category.id if category else None


def ensure_default_metadata_binding_for_draft(db: Session, draft_id: int) -> bool:
    existing = (
        db.query(MetadataBinding)
        .filter(
            MetadataBinding.entity_type == "draft_book",
            MetadataBinding.entity_id == draft_id,
            MetadataBinding.scope_type == "book",
        )
        .first()
    )
    if existing:
        return False

    category_id = _default_category_id(db)
    if not category_id:
        return False

    db.add(
        MetadataBinding(
            entity_type="draft_book",
            entity_id=draft_id,
            root_entity_id=draft_id,
            scope_type="book",
            scope_key=None,
            category_id=category_id,
            property_overrides={},
            unset_overrides=[],
        )
    )
    return True


def backfill_default_metadata_bindings(db: Session) -> MetadataBackfillResult:
    draft_ids = [row[0] for row in db.query(DraftBook.id).all()]
    scanned = len(draft_ids)

    category_id = _default_category_id(db)
    if not category_id:
        return MetadataBackfillResult(
            scanned_drafts=scanned,
            created_bindings=0,
            default_category_found=False,
        )

    created = 0
    for draft_id in draft_ids:
        if ensure_default_metadata_binding_for_draft(db, draft_id):
            created += 1

    return MetadataBackfillResult(
        scanned_drafts=scanned,
        created_bindings=created,
        default_category_found=True,
    )
