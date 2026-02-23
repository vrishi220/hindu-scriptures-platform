import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.users import get_current_user, require_permission
from models.draft_book import DraftBook
from models.property_system import (
    Category,
    CategoryParent,
    CategoryProperty,
    MetadataBinding,
    PropertyDefinition,
)
from models.property_system_schemas import (
    CategoryCreate,
    CategoryEffectivePropertiesPublic,
    CategoryPublic,
    CategoryUpdate,
    EffectivePropertyBindingPublic,
    MetadataBindingCreate,
    MetadataBindingPublic,
    MetadataBindingUpdate,
    PropertyDefinitionCreate,
    PropertyDefinitionPublic,
    PropertyDefinitionUpdate,
    ResolvedMetadataPublic,
    ResolvedPropertyValue,
)
from models.user import User
from services import get_db

router = APIRouter(prefix="/metadata", tags=["metadata"])
logger = logging.getLogger(__name__)


def _audit_event(event_name: str, actor_user_id: int | None, **fields: object) -> None:
    payload = {
        "event": event_name,
        "actor_user_id": actor_user_id,
        "timestamp": datetime.utcnow().isoformat(),
    }
    payload.update(fields)
    logger.info("audit_event %s", payload)


def _user_can_edit_draft(current_user: User, draft: DraftBook) -> bool:
    if draft.owner_id == current_user.id:
        return True
    perms = current_user.permissions or {}
    return bool(perms.get("can_edit") or perms.get("can_admin"))


def _parse_iso_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _parse_iso_datetime(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _validate_property_definition_values(
    *,
    data_type: str,
    is_required: bool,
    default_value: object,
    dropdown_options: list[str] | None,
) -> None:
    if is_required and default_value is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Required properties must define a non-null default_value",
        )

    if data_type == "dropdown":
        if not dropdown_options:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Dropdown properties must define dropdown_options",
            )
        if default_value is not None and default_value not in dropdown_options:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Dropdown default_value must be one of dropdown_options",
            )


def _coerce_property_public(item: PropertyDefinition) -> PropertyDefinitionPublic:
    return PropertyDefinitionPublic(
        id=item.id,
        internal_name=item.internal_name,
        display_name=item.display_name,
        data_type=item.data_type,
        description=item.description,
        default_value=item.default_value,
        is_required=item.is_required,
        dropdown_options=item.dropdown_options,
        is_system=item.is_system,
        created_at=item.created_at.isoformat() if item.created_at else "",
        updated_at=item.updated_at.isoformat() if item.updated_at else "",
    )


def _coerce_category_public(item: Category) -> CategoryPublic:
    parent_ids = (
        [edge.parent_category_id for edge in item.parent_edges]
        if isinstance(item.parent_edges, list)
        else []
    )
    return CategoryPublic(
        id=item.id,
        name=item.name,
        description=item.description,
        parent_category_ids=parent_ids,
        applicable_scopes=item.applicable_scopes or ["book"],
        version=item.version,
        is_system=item.is_system,
        is_published=item.is_published,
        created_at=item.created_at.isoformat() if item.created_at else "",
        updated_at=item.updated_at.isoformat() if item.updated_at else "",
    )


def _collect_effective_properties(db: Session, category_id: int) -> tuple[list[dict], dict[str, EffectivePropertyBindingPublic]]:
    visited: set[int] = set()
    visiting: set[int] = set()
    inheritance_chain: list[dict] = []
    effective: dict[str, EffectivePropertyBindingPublic] = {}

    def _visit(cat_id: int) -> None:
        if cat_id in visited:
            return
        if cat_id in visiting:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category hierarchy cycle detected")

        category = db.query(Category).filter(Category.id == cat_id).first()
        if not category:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Category {cat_id} not found")

        visiting.add(cat_id)
        parent_edges = (
            db.query(CategoryParent)
            .filter(CategoryParent.child_category_id == cat_id)
            .order_by(CategoryParent.precedence_order.asc(), CategoryParent.id.asc())
            .all()
        )
        for edge in parent_edges:
            _visit(edge.parent_category_id)

        rows = (
            db.query(CategoryProperty, PropertyDefinition)
            .join(PropertyDefinition, PropertyDefinition.id == CategoryProperty.property_definition_id)
            .filter(CategoryProperty.category_id == cat_id)
            .order_by(CategoryProperty.order.asc(), CategoryProperty.id.asc())
            .all()
        )
        for binding, prop in rows:
            effective[prop.internal_name] = EffectivePropertyBindingPublic(
                property_internal_name=prop.internal_name,
                property_display_name=prop.display_name,
                property_data_type=prop.data_type,
                description=binding.description_override or prop.description,
                order=binding.order,
                default_value=binding.default_override if binding.default_override is not None else prop.default_value,
                is_required=(
                    binding.is_required_override
                    if binding.is_required_override is not None
                    else prop.is_required
                ),
                dropdown_options=prop.dropdown_options,
                provided_by_category_id=category.id,
                provided_by_category_name=category.name,
            )

        inheritance_chain.append({"id": category.id, "name": category.name})
        visiting.remove(cat_id)
        visited.add(cat_id)

    _visit(category_id)
    return inheritance_chain, effective


def _validate_binding_payload(
    *,
    db: Session,
    category_id: int,
    property_overrides: dict,
    unset_overrides: list[str],
) -> tuple[Category, dict[str, EffectivePropertyBindingPublic]]:
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    _, effective_map = _collect_effective_properties(db, category_id)

    unknown = [key for key in property_overrides.keys() if key not in effective_map]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown property override keys: {', '.join(sorted(unknown))}",
        )

    for key in unset_overrides:
        if key not in effective_map:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown unset override key: {key}",
            )

    for key, value in property_overrides.items():
        prop = effective_map[key]
        if value is None:
            continue

        if prop.property_data_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be boolean")
        if prop.property_data_type == "number" and not isinstance(value, (int, float)):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be number")
        if prop.property_data_type in {"text", "dropdown", "date", "datetime"} and not isinstance(value, str):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be string")

        if prop.property_data_type == "dropdown" and prop.dropdown_options and value not in prop.dropdown_options:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{key} must be one of: {', '.join(prop.dropdown_options)}",
            )
        if prop.property_data_type == "date" and isinstance(value, str) and not _parse_iso_date(value):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be YYYY-MM-DD")
        if prop.property_data_type == "datetime" and isinstance(value, str) and not _parse_iso_datetime(value):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} must be ISO datetime")

    for key, prop in effective_map.items():
        if not prop.is_required:
            continue

        if key in unset_overrides:
            candidate = prop.default_value
        elif key in property_overrides:
            candidate = property_overrides.get(key)
        else:
            candidate = prop.default_value

        if candidate is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Required property '{key}' has no resolved value",
            )

    return category, effective_map


def _serialize_binding(binding: MetadataBinding) -> MetadataBindingPublic:
    return MetadataBindingPublic(
        id=binding.id,
        entity_type=binding.entity_type,
        entity_id=binding.entity_id,
        root_entity_id=binding.root_entity_id,
        scope_type=binding.scope_type,
        category_id=binding.category_id,
        scope_key=binding.scope_key,
        property_overrides=binding.property_overrides or {},
        unset_overrides=binding.unset_overrides or [],
        created_at=binding.created_at.isoformat() if binding.created_at else "",
        updated_at=binding.updated_at.isoformat() if binding.updated_at else "",
    )


def _resolve_binding_metadata(binding: MetadataBinding, db: Session) -> ResolvedMetadataPublic:
    effective_values: list[ResolvedPropertyValue] = []
    category_name = None

    if binding.category_id is not None:
        category = db.query(Category).filter(Category.id == binding.category_id).first()
        category_name = category.name if category else None
        _, effective_map = _collect_effective_properties(db, binding.category_id)

        for key, prop in effective_map.items():
            if key in (binding.unset_overrides or []):
                value = prop.default_value
                resolved_from = "category_default"
            elif key in (binding.property_overrides or {}):
                value = (binding.property_overrides or {}).get(key)
                resolved_from = binding.scope_type
            else:
                value = prop.default_value
                resolved_from = "category_default"

            effective_values.append(
                ResolvedPropertyValue(
                    property_internal_name=key,
                    property_display_name=prop.property_display_name,
                    property_data_type=prop.property_data_type,
                    value=value,
                    resolved_from_scope=resolved_from,
                    resolved_from_category=prop.provided_by_category_name,
                )
            )

    return ResolvedMetadataPublic(
        entity_type=binding.entity_type,
        entity_id=binding.entity_id,
        scope_type=binding.scope_type,
        category_id=binding.category_id,
        category_name=category_name,
        properties=sorted(effective_values, key=lambda item: item.property_internal_name),
        property_overrides=binding.property_overrides or {},
        unset_overrides=binding.unset_overrides or [],
        resolved_at=datetime.utcnow().isoformat(),
    )


def validate_draft_metadata_bindings_on_publish(draft_id: int, db: Session) -> None:
    bindings = (
        db.query(MetadataBinding)
        .filter(MetadataBinding.root_entity_id == draft_id)
        .order_by(MetadataBinding.id.asc())
        .all()
    )

    for binding in bindings:
        if binding.category_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Publish blocked by metadata validation: "
                    f"binding {binding.id} has no category_id"
                ),
            )

        category, _ = _validate_binding_payload(
            db=db,
            category_id=binding.category_id,
            property_overrides=binding.property_overrides or {},
            unset_overrides=binding.unset_overrides or [],
        )

        applicable_scopes = category.applicable_scopes or []
        required_scope = binding.scope_type
        if required_scope not in applicable_scopes and "all" not in applicable_scopes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Publish blocked by metadata validation: "
                    f"category '{category.name}' is not applicable to scope '{required_scope}'"
                ),
            )


@router.post(
    "/property-definitions",
    response_model=PropertyDefinitionPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_property_definition(
    payload: PropertyDefinitionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    existing = db.query(PropertyDefinition).filter(PropertyDefinition.internal_name == payload.internal_name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property internal_name already exists")

    _validate_property_definition_values(
        data_type=payload.data_type,
        is_required=payload.is_required,
        default_value=payload.default_value,
        dropdown_options=payload.dropdown_options,
    )

    item = PropertyDefinition(
        internal_name=payload.internal_name.strip(),
        display_name=payload.display_name.strip(),
        data_type=payload.data_type,
        description=payload.description,
        default_value=payload.default_value,
        is_required=payload.is_required,
        is_system=False,
        dropdown_options=payload.dropdown_options,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    _audit_event(
        "metadata.property_definition.created",
        current_user.id,
        property_definition_id=item.id,
        internal_name=item.internal_name,
    )
    return _coerce_property_public(item)


@router.get("/property-definitions", response_model=list[PropertyDefinitionPublic])
def list_property_definitions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    rows = db.query(PropertyDefinition).order_by(PropertyDefinition.id.asc()).all()
    return [_coerce_property_public(row) for row in rows]


@router.patch("/property-definitions/{prop_id}", response_model=PropertyDefinitionPublic)
def update_property_definition(
    prop_id: int,
    payload: PropertyDefinitionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    item = db.query(PropertyDefinition).filter(PropertyDefinition.id == prop_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property definition not found")

    updates = payload.model_dump(exclude_unset=True)

    if "internal_name" in updates and updates["internal_name"]:
        existing = (
            db.query(PropertyDefinition)
            .filter(PropertyDefinition.internal_name == updates["internal_name"], PropertyDefinition.id != prop_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property internal_name already exists")

    for key, value in updates.items():
        setattr(item, key, value)

    _validate_property_definition_values(
        data_type=item.data_type,
        is_required=item.is_required,
        default_value=item.default_value,
        dropdown_options=item.dropdown_options,
    )

    db.commit()
    db.refresh(item)
    _audit_event(
        "metadata.property_definition.updated",
        current_user.id,
        property_definition_id=item.id,
        internal_name=item.internal_name,
    )
    return _coerce_property_public(item)


@router.delete("/property-definitions/{prop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property_definition(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    item = db.query(PropertyDefinition).filter(PropertyDefinition.id == prop_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property definition not found")
    if item.is_system:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="System property cannot be deleted")

    in_use = db.query(CategoryProperty.id).filter(CategoryProperty.property_definition_id == prop_id).first()
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property is in use by categories")

    db.delete(item)
    db.commit()
    _audit_event(
        "metadata.property_definition.deleted",
        current_user.id,
        property_definition_id=prop_id,
        internal_name=item.internal_name,
    )


@router.post("/categories", response_model=CategoryPublic, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    existing = db.query(Category).filter(Category.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category name already exists")

    parent_ids = sorted(set(payload.parent_category_ids or []))
    if parent_ids:
        count = db.query(Category).filter(Category.id.in_(parent_ids)).count()
        if count != len(parent_ids):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more parent categories not found")

    property_ids = [item.property_definition_id for item in payload.properties]
    if property_ids:
        count = db.query(PropertyDefinition).filter(PropertyDefinition.id.in_(property_ids)).count()
        if count != len(set(property_ids)):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more properties not found")

    category = Category(
        name=payload.name.strip(),
        description=payload.description,
        applicable_scopes=payload.applicable_scopes or ["book"],
        version=1,
        is_system=False,
        is_published=False,
    )
    db.add(category)
    db.flush()

    for idx, parent_id in enumerate(parent_ids):
        db.add(
            CategoryParent(
                child_category_id=category.id,
                parent_category_id=parent_id,
                precedence_order=idx,
            )
        )

    for binding in payload.properties:
        db.add(
            CategoryProperty(
                category_id=category.id,
                property_definition_id=binding.property_definition_id,
                order=binding.order,
                description_override=binding.description_override,
                default_override=binding.default_override,
                is_required_override=binding.is_required_override,
            )
        )

    db.commit()
    db.refresh(category)
    _audit_event(
        "metadata.category.created",
        current_user.id,
        category_id=category.id,
        name=category.name,
    )
    return _coerce_category_public(category)


@router.get("/categories", response_model=list[CategoryPublic])
def list_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    rows = db.query(Category).order_by(Category.id.asc()).all()
    return [_coerce_category_public(row) for row in rows]


@router.patch("/categories/{cat_id}", response_model=CategoryPublic)
def update_category(
    cat_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    category = db.query(Category).filter(Category.id == cat_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    if category.is_published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Published categories are immutable")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        existing = db.query(Category).filter(Category.name == updates["name"], Category.id != cat_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category name already exists")

    if "parent_category_ids" in updates and updates["parent_category_ids"] is not None:
        parent_ids = sorted(set(updates["parent_category_ids"]))
        if cat_id in parent_ids:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Category cannot be its own parent")
        if parent_ids:
            count = db.query(Category).filter(Category.id.in_(parent_ids)).count()
            if count != len(parent_ids):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more parent categories not found")

        db.query(CategoryParent).filter(CategoryParent.child_category_id == cat_id).delete(synchronize_session=False)
        for idx, parent_id in enumerate(parent_ids):
            db.add(
                CategoryParent(
                    child_category_id=cat_id,
                    parent_category_id=parent_id,
                    precedence_order=idx,
                )
            )

    if "name" in updates and updates["name"]:
        category.name = updates["name"].strip()
    if "description" in updates:
        category.description = updates["description"]
    if "applicable_scopes" in updates and updates["applicable_scopes"] is not None:
        category.applicable_scopes = updates["applicable_scopes"]

    category.version = (category.version or 1) + 1
    db.commit()
    db.refresh(category)
    _audit_event(
        "metadata.category.updated",
        current_user.id,
        category_id=category.id,
        name=category.name,
        version=category.version,
    )
    return _coerce_category_public(category)


@router.post("/categories/{cat_id}/publish", response_model=CategoryPublic)
def publish_category(
    cat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    category = db.query(Category).filter(Category.id == cat_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    category.is_published = True
    category.version = (category.version or 1) + 1
    db.commit()
    db.refresh(category)
    _audit_event(
        "metadata.category.published",
        current_user.id,
        category_id=category.id,
        name=category.name,
        version=category.version,
    )
    return _coerce_category_public(category)


@router.delete("/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    cat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_admin")),
):
    _ = current_user
    category = db.query(Category).filter(Category.id == cat_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    if category.is_system:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="System category cannot be deleted")
    if category.is_published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Published categories cannot be deleted")

    in_use = db.query(MetadataBinding.id).filter(MetadataBinding.category_id == cat_id).first()
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category is in use by metadata bindings")

    db.delete(category)
    db.commit()
    _audit_event(
        "metadata.category.deleted",
        current_user.id,
        category_id=cat_id,
        name=category.name,
    )


@router.get("/categories/{cat_id}/effective-properties", response_model=CategoryEffectivePropertiesPublic)
def get_category_effective_properties(
    cat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    category = db.query(Category).filter(Category.id == cat_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    inheritance_chain, effective_map = _collect_effective_properties(db, cat_id)
    properties = sorted(effective_map.values(), key=lambda item: (item.order, item.property_internal_name))
    return CategoryEffectivePropertiesPublic(
        category_id=category.id,
        category_name=category.name,
        properties=properties,
        inheritance_chain=inheritance_chain,
    )


def _upsert_binding(
    *,
    db: Session,
    entity_type: str,
    entity_id: int,
    root_entity_id: int | None,
    scope_type: str,
    payload: MetadataBindingCreate,
) -> MetadataBinding:
    binding = (
        db.query(MetadataBinding)
        .filter(
            MetadataBinding.entity_type == entity_type,
            MetadataBinding.entity_id == entity_id,
            MetadataBinding.scope_type == scope_type,
            MetadataBinding.root_entity_id == root_entity_id,
        )
        .first()
    )

    if binding is None:
        binding = (
            db.query(MetadataBinding)
            .filter(
                MetadataBinding.entity_type == entity_type,
                MetadataBinding.entity_id == entity_id,
                MetadataBinding.scope_type == scope_type,
                MetadataBinding.root_entity_id.is_(None),
            )
            .first()
        )

    if binding is None:
        binding = MetadataBinding(
            entity_type=entity_type,
            entity_id=entity_id,
            root_entity_id=root_entity_id,
            scope_type=scope_type,
            scope_key=payload.scope_key,
            category_id=payload.category_id,
            property_overrides=payload.property_overrides or {},
            unset_overrides=payload.unset_overrides or [],
        )
        db.add(binding)
    else:
        if payload.scope_key is not None:
            binding.scope_key = payload.scope_key
        if binding.root_entity_id is None:
            binding.root_entity_id = root_entity_id
        if payload.category_id is not None:
            binding.category_id = payload.category_id
        binding.property_overrides = payload.property_overrides or {}
        binding.unset_overrides = payload.unset_overrides or []

    db.flush()
    return binding


@router.post("/draft-books/{draft_id}/metadata-binding", response_model=MetadataBindingPublic)
def upsert_draft_book_metadata_binding(
    draft_id: int,
    payload: MetadataBindingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if not _user_can_edit_draft(current_user, draft):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    if payload.category_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="category_id is required")

    _validate_binding_payload(
        db=db,
        category_id=payload.category_id,
        property_overrides=payload.property_overrides or {},
        unset_overrides=payload.unset_overrides or [],
    )

    binding = _upsert_binding(
        db=db,
        entity_type="draft_book",
        entity_id=draft_id,
        root_entity_id=draft_id,
        scope_type="book",
        payload=payload,
    )
    db.commit()
    db.refresh(binding)
    _audit_event(
        "metadata.binding.upserted",
        current_user.id,
        binding_id=binding.id,
        entity_type=binding.entity_type,
        entity_id=binding.entity_id,
        scope_type=binding.scope_type,
        draft_id=draft_id,
    )
    return _serialize_binding(binding)


@router.get("/draft-books/{draft_id}/metadata-binding", response_model=ResolvedMetadataPublic)
def get_draft_book_metadata_binding(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if not _user_can_edit_draft(current_user, draft):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    binding = (
        db.query(MetadataBinding)
        .filter(
            MetadataBinding.entity_type == "draft_book",
            MetadataBinding.entity_id == draft_id,
            MetadataBinding.scope_type == "book",
        )
        .first()
    )
    if not binding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Metadata binding not found")

    return _resolve_binding_metadata(binding, db)


@router.patch("/draft-books/{draft_id}/metadata-binding", response_model=MetadataBindingPublic)
def patch_draft_book_metadata_binding(
    draft_id: int,
    payload: MetadataBindingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if not _user_can_edit_draft(current_user, draft):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    binding = (
        db.query(MetadataBinding)
        .filter(
            MetadataBinding.entity_type == "draft_book",
            MetadataBinding.entity_id == draft_id,
            MetadataBinding.scope_type == "book",
        )
        .first()
    )
    if not binding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Metadata binding not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "category_id" in update_data:
        binding.category_id = update_data["category_id"]
    if "property_overrides" in update_data:
        binding.property_overrides = update_data["property_overrides"] or {}
    if "unset_overrides" in update_data:
        binding.unset_overrides = update_data["unset_overrides"] or []

    if binding.category_id is not None:
        _validate_binding_payload(
            db=db,
            category_id=binding.category_id,
            property_overrides=binding.property_overrides or {},
            unset_overrides=binding.unset_overrides or [],
        )

    db.commit()
    db.refresh(binding)
    _audit_event(
        "metadata.binding.patched",
        current_user.id,
        binding_id=binding.id,
        entity_type=binding.entity_type,
        entity_id=binding.entity_id,
        scope_type=binding.scope_type,
        draft_id=draft_id,
    )
    return _serialize_binding(binding)


@router.post("/draft-books/{draft_id}/levels/{level_id}/metadata-binding", response_model=MetadataBindingPublic)
def upsert_level_metadata_binding(
    draft_id: int,
    level_id: int,
    payload: MetadataBindingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if not _user_can_edit_draft(current_user, draft):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    if payload.category_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="category_id is required")

    category, _ = _validate_binding_payload(
        db=db,
        category_id=payload.category_id,
        property_overrides=payload.property_overrides or {},
        unset_overrides=payload.unset_overrides or [],
    )
    if "level" not in (category.applicable_scopes or []) and payload.scope_key is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Level binding requires category with 'level' scope or scope_key",
        )

    binding = _upsert_binding(
        db=db,
        entity_type="level",
        entity_id=level_id,
        root_entity_id=draft_id,
        scope_type="level",
        payload=payload,
    )
    db.commit()
    db.refresh(binding)
    _audit_event(
        "metadata.binding.upserted",
        current_user.id,
        binding_id=binding.id,
        entity_type=binding.entity_type,
        entity_id=binding.entity_id,
        scope_type=binding.scope_type,
        draft_id=draft_id,
    )
    return _serialize_binding(binding)


@router.post(
    "/draft-books/{draft_id}/sections/{section_id}/nodes/{node_id}/metadata-binding",
    response_model=MetadataBindingPublic,
)
def upsert_node_metadata_binding(
    draft_id: int,
    section_id: int,
    node_id: int,
    payload: MetadataBindingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = section_id
    draft = db.query(DraftBook).filter(DraftBook.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    if not _user_can_edit_draft(current_user, draft):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    if payload.category_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="category_id is required")

    _validate_binding_payload(
        db=db,
        category_id=payload.category_id,
        property_overrides=payload.property_overrides or {},
        unset_overrides=payload.unset_overrides or [],
    )

    binding = _upsert_binding(
        db=db,
        entity_type="node",
        entity_id=node_id,
        root_entity_id=draft_id,
        scope_type="node",
        payload=payload,
    )
    db.commit()
    db.refresh(binding)
    _audit_event(
        "metadata.binding.upserted",
        current_user.id,
        binding_id=binding.id,
        entity_type=binding.entity_type,
        entity_id=binding.entity_id,
        scope_type=binding.scope_type,
        draft_id=draft_id,
    )
    return _serialize_binding(binding)
