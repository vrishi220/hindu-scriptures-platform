# Custom Template Library Plan

## Goal
Enable authors/editors to:
1. create named templates,
2. assign a template by name to a level type (or book/node scope),
3. preview output,
4. edit templates safely with version history.

This extends the current metadata-driven template key behavior and avoids hard-coded preview-only layout changes.

## Scope
### In Scope (MVP)
- Named template library per owner (with optional shared/system templates).
- Versioned template bodies (Liquid text + metadata).
- Assignment by scope: `book`, `level_type`, optional `node` override.
- Template resolution API (single effective template for a node/level).
- Preview endpoint that renders selected content with selected template version.
- UI for list/create/edit/template assignment.

### Out of Scope (Later)
- Full visual drag/drop template builder.
- Rich collaborative editor with comments.
- Multi-template A/B publication workflows.

## Data Model (Proposed)

### 1) `render_templates`
- `id` (pk)
- `owner_user_id` (nullable for system templates)
- `name` (display name, unique per owner)
- `key` (stable internal key)
- `description`
- `scope_kind` (`global`, `book`, `level_type`, `node`)
- `is_active`
- `created_at`, `updated_at`

### 2) `render_template_versions`
- `id` (pk)
- `template_id` (fk -> render_templates)
- `version_number` (int)
- `liquid_body` (text)
- `schema_json` (jsonb, optional future validation schema)
- `changelog`
- `created_by`
- `created_at`
- unique (`template_id`, `version_number`)

### 3) `template_assignments`
- `id` (pk)
- `book_id` (nullable)
- `level_name` (nullable)
- `node_id` (nullable)
- `template_id` (fk)
- `template_version_id` (nullable; null => latest active)
- `priority` (int)
- `created_by`
- `created_at`, `updated_at`

### 4) Optional audit table
- `template_assignment_events` to track assignment edits/history.

## Resolution Rules (MVP)
1. explicit node assignment
2. level type assignment within book
3. book-level assignment
4. metadata template key fallback (`<section>_<level>_template_key`, etc.)
5. system default template

## API Surface (Proposed)

### Templates
- `GET /api/templates` (filter: owner/system/scope)
- `POST /api/templates`
- `GET /api/templates/{id}`
- `PATCH /api/templates/{id}`
- `POST /api/templates/{id}/versions`
- `GET /api/templates/{id}/versions`
- `GET /api/templates/{id}/versions/{version_id}`

### Assignments
- `GET /api/books/{book_id}/template-assignments`
- `POST /api/books/{book_id}/template-assignments`
- `PATCH /api/template-assignments/{id}`
- `DELETE /api/template-assignments/{id}`

### Resolution + Preview
- `GET /api/books/{book_id}/templates/resolve?node_id=...`
- `POST /api/books/{book_id}/templates/preview`
  - Body: `{ template_id, version_id?, node_id?, level_name?, render_settings? }`

## UI Plan

### A) Template Library (new page/modal)
- Table: Name, Scope, Owner, Latest Version, Updated At.
- Actions: Create, Duplicate, Edit, View Versions, Archive.

### B) Template Editor
- Left: metadata (name, scope, description).
- Right: Liquid editor.
- Bottom: sample input selector + live preview panel.
- Save creates new version, not destructive overwrite.

### C) Assignment UI in Scriptures
- In Book/Level properties: “Assigned Template”.
- Choose by template name; optionally pin specific version.
- “Preview with template” quick action before save.

## Permission Model
- Owner and editors can create/edit templates for books they can edit.
- Viewers/contributors cannot edit template definitions.
- System templates are read-only except admin.

## Migration Strategy
1. Keep existing behavior unchanged.
2. Seed one default system template matching current output.
3. Add assignment APIs/UI behind feature flag.
4. Enable per-book assignment first, then level-type assignment.
5. Finally expose node-level override.

## Rollout Phases

### Phase 1 (Backend foundation)
- Tables + SQLAlchemy models + CRUD APIs + resolution service.

### Phase 2 (Preview integration)
- Preview endpoint uses resolved template/version.
- Frontend preview consumes resolved output only.

### Phase 3 (Authoring UI)
- Template library + editor + assignment controls in scriptures properties.

### Phase 4 (Safety + DX)
- Diff viewer across versions.
- Validation checks for required context variables.
- Audit log views.

## Acceptance Criteria
- Author can create template `Shloka Compact v1`.
- Author can assign it to `Shloka` level for a book.
- Preview uses assigned template without code changes.
- Author edits template -> `v2`; can switch between versions.
- Existing books without assignments still render with default template.

## First Implementation Tasks
1. Add migration for `render_templates`, `render_template_versions`, `template_assignments`.
2. Add models and pydantic schemas.
3. Add `services/template_resolution.py`.
4. Add API router for templates and assignments.
5. Wire scriptures preview endpoint to resolution service.
6. Add minimal UI selector in properties modal (book + level type).
7. Add tests for precedence and version pinning.
