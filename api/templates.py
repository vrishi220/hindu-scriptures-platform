from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from api.users import get_current_user
from models.template_library import RenderTemplate, RenderTemplateAssignment, RenderTemplateVersion
from models.template_library_schemas import (
    RenderTemplateAssignmentCreate,
    RenderTemplateAssignmentPublic,
    RenderTemplateAssignmentUpdate,
    RenderTemplateCreate,
    RenderTemplatePublic,
    RenderTemplateResolvePublic,
    RenderTemplateUpdate,
    RenderTemplateVersionPublic,
)
from models.scripture_schema import ScriptureSchema
from models.user import User
from services import get_db

router = APIRouter(prefix="/templates", tags=["templates"])


def _has_cross_owner_template_permission(current_user: User) -> bool:
    perms = current_user.permissions or {}
    return bool(perms.get("can_admin") or perms.get("can_edit"))


def _is_admin_user(current_user: User) -> bool:
    perms = current_user.permissions or {}
    return bool(perms.get("can_admin") or current_user.role == "admin")


def _ensure_template_owner_or_admin(current_user: User, template: RenderTemplate) -> None:
    perms = current_user.permissions or {}
    if template.owner_id == current_user.id or perms.get("can_admin") or perms.get("can_edit"):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _ensure_template_owner_access(current_user: User, owner_id: int) -> None:
    if owner_id == current_user.id:
        return
    if _has_cross_owner_template_permission(current_user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _can_view_template(current_user: User, template: RenderTemplate) -> bool:
    if bool(template.is_system) and bool(template.is_active):
        return True
    if template.owner_id == current_user.id:
        return True
    perms = current_user.permissions or {}
    if perms.get("can_admin") or perms.get("can_edit"):
        return True
    return template.visibility == "published" and bool(template.is_active)


def _ensure_template_visible_to_user(current_user: User, template: RenderTemplate) -> None:
    if _can_view_template(current_user, template):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _normalize_level_key(value: str | None) -> str:
    return (value or "").strip()


def _get_schema_or_422(db: Session, schema_id: int | None) -> ScriptureSchema:
    if not schema_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_schema_id is required")
    schema = db.query(ScriptureSchema).filter(ScriptureSchema.id == schema_id).first()
    if not schema:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid target_schema_id")
    return schema


def _validate_level_in_schema(level: str, schema: ScriptureSchema) -> None:
    allowed_levels = schema.levels if isinstance(schema.levels, list) else []
    normalized_allowed_levels = {str(item).strip() for item in allowed_levels if isinstance(item, str) and item.strip()}
    if level not in normalized_allowed_levels:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="target_level must belong to target_schema_id",
        )


@router.post("", response_model=RenderTemplatePublic, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: RenderTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RenderTemplatePublic:
    target_owner_id = payload.owner_id or current_user.id
    _ensure_template_owner_access(current_user, target_owner_id)

    normalized_target_level = (payload.target_level or "").strip()
    if not normalized_target_level:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_level is required")
    target_schema = _get_schema_or_422(db, payload.target_schema_id)
    _validate_level_in_schema(normalized_target_level, target_schema)

    existing = (
        db.query(RenderTemplate)
        .filter(RenderTemplate.owner_id == target_owner_id, RenderTemplate.name == payload.name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Template name already exists")

    template = RenderTemplate(
        owner_id=target_owner_id,
        name=payload.name.strip(),
        description=payload.description,
        target_schema_id=target_schema.id,
        target_level=normalized_target_level,
        visibility=payload.visibility,
        liquid_template=payload.liquid_template,
        current_version=1,
        is_active=True,
    )
    db.add(template)
    db.flush()

    first_version = RenderTemplateVersion(
        template_id=template.id,
        version=1,
        liquid_template=payload.liquid_template,
        change_note=payload.change_note,
        created_by=current_user.id,
    )
    db.add(first_version)
    db.commit()
    db.refresh(template)
    return RenderTemplatePublic.model_validate(template)


@router.get("/my", response_model=list[RenderTemplatePublic])
def list_my_templates(
    include_inactive: bool = Query(default=False),
    include_published: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RenderTemplatePublic]:
    return _list_templates_for_current_user(
        include_inactive=include_inactive,
        include_published=include_published,
        db=db,
        current_user=current_user,
    )


@router.get("", response_model=list[RenderTemplatePublic])
def list_templates(
    include_inactive: bool = Query(default=False),
    include_published: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RenderTemplatePublic]:
    return _list_templates_for_current_user(
        include_inactive=include_inactive,
        include_published=include_published,
        db=db,
        current_user=current_user,
    )


def _list_templates_for_current_user(
    include_inactive: bool,
    include_published: bool,
    db: Session,
    current_user: User,
) -> list[RenderTemplatePublic]:
    query = db.query(RenderTemplate)
    if include_published:
        query = query.filter(
            (RenderTemplate.owner_id == current_user.id)
            | (RenderTemplate.visibility == "published")
        )
    else:
        query = query.filter(RenderTemplate.owner_id == current_user.id)

    if not include_inactive:
        query = query.filter(RenderTemplate.is_active.is_(True))
    templates = query.order_by(RenderTemplate.updated_at.desc(), RenderTemplate.id.desc()).all()
    return [RenderTemplatePublic.model_validate(item) for item in templates]


@router.get("/{template_id}", response_model=RenderTemplatePublic)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RenderTemplatePublic:
    template = db.query(RenderTemplate).filter(RenderTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    _ensure_template_visible_to_user(current_user, template)
    return RenderTemplatePublic.model_validate(template)


@router.patch("/{template_id}", response_model=RenderTemplatePublic)
def update_template(
    template_id: int,
    payload: RenderTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RenderTemplatePublic:
    template = db.query(RenderTemplate).filter(RenderTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    _ensure_template_owner_or_admin(current_user, template)
    if bool(template.is_system) and not _is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can edit system templates")

    updates = payload.model_dump(exclude_unset=True)

    if "name" in updates and updates["name"] is not None:
        normalized_name = updates["name"].strip()
        if not normalized_name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name cannot be empty")
        duplicate = (
            db.query(RenderTemplate)
            .filter(
                RenderTemplate.owner_id == template.owner_id,
                RenderTemplate.name == normalized_name,
                RenderTemplate.id != template.id,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Template name already exists")
        template.name = normalized_name

    if "description" in updates:
        template.description = updates["description"]

    schema_updated = "target_schema_id" in updates
    level_updated = "target_level" in updates
    if schema_updated or level_updated:
        resolved_schema_id = updates.get("target_schema_id") if schema_updated else template.target_schema_id
        if not resolved_schema_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_schema_id is required")

        if level_updated:
            normalized_target_level = (updates.get("target_level") or "").strip()
        else:
            normalized_target_level = (template.target_level or "").strip()

        if not normalized_target_level:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_level is required")

        target_schema = _get_schema_or_422(db, int(resolved_schema_id))
        _validate_level_in_schema(normalized_target_level, target_schema)
        template.target_schema_id = target_schema.id
        template.target_level = normalized_target_level
    if "visibility" in updates and updates["visibility"] is not None:
        template.visibility = updates["visibility"]
    if "is_active" in updates and updates["is_active"] is not None:
        template.is_active = updates["is_active"]

    if "liquid_template" in updates and updates["liquid_template"]:
        next_version = (template.current_version or 0) + 1
        template.current_version = next_version
        template.liquid_template = updates["liquid_template"]
        db.add(
            RenderTemplateVersion(
                template_id=template.id,
                version=next_version,
                liquid_template=updates["liquid_template"],
                change_note=updates.get("change_note"),
                created_by=current_user.id,
            )
        )

    db.commit()
    db.refresh(template)
    return RenderTemplatePublic.model_validate(template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    template = db.query(RenderTemplate).filter(RenderTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    if bool(template.is_system):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System templates cannot be deleted",
        )

    _ensure_template_owner_or_admin(current_user, template)

    in_use_assignment = (
        db.query(RenderTemplateAssignment.id)
        .filter(RenderTemplateAssignment.template_id == template.id)
        .first()
    )
    if in_use_assignment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Template is in use and cannot be deleted",
        )

    db.delete(template)
    db.commit()


@router.get("/{template_id}/versions", response_model=list[RenderTemplateVersionPublic])
def list_template_versions(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RenderTemplateVersionPublic]:
    template = db.query(RenderTemplate).filter(RenderTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    _ensure_template_visible_to_user(current_user, template)

    versions = (
        db.query(RenderTemplateVersion)
        .filter(RenderTemplateVersion.template_id == template.id)
        .order_by(RenderTemplateVersion.version.desc(), RenderTemplateVersion.id.desc())
        .all()
    )
    return [RenderTemplateVersionPublic.model_validate(item) for item in versions]


@router.post("/assignments", response_model=RenderTemplateAssignmentPublic, status_code=status.HTTP_201_CREATED)
def upsert_assignment(
    payload: RenderTemplateAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RenderTemplateAssignmentPublic:
    template = db.query(RenderTemplate).filter(RenderTemplate.id == payload.template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    _ensure_template_visible_to_user(current_user, template)

    version_id = payload.template_version_id
    if version_id is not None:
        version = db.query(RenderTemplateVersion).filter(RenderTemplateVersion.id == version_id).first()
        if not version or version.template_id != template.id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid template_version_id")

    normalized_level_key = _normalize_level_key(payload.level_key)
    assignment = (
        db.query(RenderTemplateAssignment)
        .filter(
            RenderTemplateAssignment.owner_id == current_user.id,
            RenderTemplateAssignment.entity_type == payload.entity_type,
            RenderTemplateAssignment.entity_id == payload.entity_id,
            RenderTemplateAssignment.level_key == normalized_level_key,
        )
        .first()
    )

    if assignment is None:
        assignment = RenderTemplateAssignment(
            owner_id=current_user.id,
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            level_key=normalized_level_key,
            template_id=template.id,
            template_version_id=version_id,
            priority=payload.priority,
            is_active=payload.is_active,
        )
        db.add(assignment)
    else:
        assignment.template_id = template.id
        assignment.template_version_id = version_id
        assignment.priority = payload.priority
        assignment.is_active = payload.is_active

    db.commit()
    db.refresh(assignment)
    return RenderTemplateAssignmentPublic.model_validate(assignment)


@router.patch("/assignments/{assignment_id}", response_model=RenderTemplateAssignmentPublic)
def update_assignment(
    assignment_id: int,
    payload: RenderTemplateAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RenderTemplateAssignmentPublic:
    assignment = db.query(RenderTemplateAssignment).filter(RenderTemplateAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    perms = current_user.permissions or {}
    if assignment.owner_id != current_user.id and not perms.get("can_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    updates = payload.model_dump(exclude_unset=True)

    if "template_id" in updates and updates["template_id"] is not None:
        template = db.query(RenderTemplate).filter(RenderTemplate.id == updates["template_id"]).first()
        if not template:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        _ensure_template_visible_to_user(current_user, template)
        assignment.template_id = template.id

    if "template_version_id" in updates:
        version_id = updates["template_version_id"]
        if version_id is None:
            assignment.template_version_id = None
        else:
            version = db.query(RenderTemplateVersion).filter(RenderTemplateVersion.id == version_id).first()
            if not version or version.template_id != assignment.template_id:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid template_version_id")
            assignment.template_version_id = version.id

    if "priority" in updates and updates["priority"] is not None:
        assignment.priority = updates["priority"]
    if "is_active" in updates and updates["is_active"] is not None:
        assignment.is_active = updates["is_active"]

    db.commit()
    db.refresh(assignment)
    return RenderTemplateAssignmentPublic.model_validate(assignment)


@router.get("/assignments/my", response_model=list[RenderTemplateAssignmentPublic])
def list_my_assignments(
    entity_type: str | None = Query(default=None),
    entity_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RenderTemplateAssignmentPublic]:
    query = db.query(RenderTemplateAssignment).filter(RenderTemplateAssignment.owner_id == current_user.id)
    if entity_type is not None:
        query = query.filter(RenderTemplateAssignment.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(RenderTemplateAssignment.entity_id == entity_id)

    assignments = (
        query.order_by(
            RenderTemplateAssignment.entity_type.asc(),
            RenderTemplateAssignment.entity_id.asc(),
            RenderTemplateAssignment.level_key.asc(),
            RenderTemplateAssignment.priority.asc(),
        )
        .all()
    )
    return [RenderTemplateAssignmentPublic.model_validate(item) for item in assignments]


@router.get("/resolve", response_model=RenderTemplateResolvePublic)
def resolve_assignment(
    entity_type: str,
    entity_id: int,
    level_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RenderTemplateResolvePublic:
    normalized_level_key = _normalize_level_key(level_key)

    assignment = (
        db.query(RenderTemplateAssignment)
        .filter(
            RenderTemplateAssignment.owner_id == current_user.id,
            RenderTemplateAssignment.entity_type == entity_type,
            RenderTemplateAssignment.entity_id == entity_id,
            RenderTemplateAssignment.level_key == normalized_level_key,
            RenderTemplateAssignment.is_active.is_(True),
        )
        .order_by(RenderTemplateAssignment.priority.asc(), RenderTemplateAssignment.id.desc())
        .first()
    )
    if not assignment and normalized_level_key:
        assignment = (
            db.query(RenderTemplateAssignment)
            .filter(
                RenderTemplateAssignment.owner_id == current_user.id,
                RenderTemplateAssignment.entity_type == entity_type,
                RenderTemplateAssignment.entity_id == entity_id,
                RenderTemplateAssignment.level_key == "",
                RenderTemplateAssignment.is_active.is_(True),
            )
            .order_by(RenderTemplateAssignment.priority.asc(), RenderTemplateAssignment.id.desc())
            .first()
        )

    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No template assignment found")

    template = db.query(RenderTemplate).filter(RenderTemplate.id == assignment.template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned template not found")
    _ensure_template_visible_to_user(current_user, template)

    resolved_version = None
    if assignment.template_version_id is not None:
        resolved_version = (
            db.query(RenderTemplateVersion)
            .filter(RenderTemplateVersion.id == assignment.template_version_id)
            .first()
        )
    if resolved_version is None:
        resolved_version = (
            db.query(RenderTemplateVersion)
            .filter(
                RenderTemplateVersion.template_id == template.id,
                RenderTemplateVersion.version == template.current_version,
            )
            .first()
        )

    return RenderTemplateResolvePublic(
        assignment=RenderTemplateAssignmentPublic.model_validate(assignment),
        template=RenderTemplatePublic.model_validate(template),
        resolved_version=(
            RenderTemplateVersionPublic.model_validate(resolved_version)
            if resolved_version
            else None
        ),
    )
