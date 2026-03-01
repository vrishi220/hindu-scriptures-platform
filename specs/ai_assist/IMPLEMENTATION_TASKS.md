# AI Assist Implementation Tasks

This document converts the design package into execution tasks with acceptance criteria.

## Phase 1 — MVP (Authoring-only, manual apply)

### 1) Backend endpoint: AI Assist generation proxy
- **Task**: Add authenticated endpoint to accept target field + prompt + context and return structured output.
- **API**: `POST /api/ai-assist/generate`
- **Acceptance criteria**:
  - Reject unauthenticated requests (`401`).
  - Reject unauthorized role/scope (`403`).
  - Validate target field has `ai_assist.enabled=true` in metadata (`400` otherwise).
  - Return payload with `result.text`, `result.citation_note`, `result.confidence`, and provenance metadata.

### 2) Permission enforcement and scope checks
- **Task**: Enforce authoring-only role checks (admin/editor/contributor by metadata policy) and effective edit permission at book/node scope.
- **Acceptance criteria**:
  - Viewer/anonymous users cannot access endpoint.
  - Contributor behavior follows configured `roles_allowed`.
  - Endpoint checks editable status (e.g., disallow writes on immutable/published-only contexts).

### 3) Metadata wiring for field-level AI Assist
- **Task**: Parse and expose `ai_assist` object from field/property metadata in backend responses used by forms.
- **Acceptance criteria**:
  - Fields without `ai_assist` do not expose helper config.
  - Fields with `ai_assist.enabled=true` include complete config object in form payload.
  - Invalid config fails validation with actionable errors.

### 4) Frontend field-level AI Help trigger
- **Task**: Show AI Help button only for fields that are both editable and AI-enabled by metadata.
- **Acceptance criteria**:
  - Button hidden for unauthorized users.
  - Button hidden for non-enabled fields.
  - Button visible and enabled only when field is editable.

### 5) Frontend AI Assist modal (prompt + apply)
- **Task**: Implement modal with editable prompt, context chips, generate, regenerate, and manual apply actions.
- **Acceptance criteria**:
  - Prompt prefilled from default template + current context.
  - User can edit prompt before generate.
  - Applying output requires explicit user action; no auto-write.
  - Apply only updates targeted field(s).

### 6) Prompt context builder
- **Task**: Build context variables from current authoring location and field metadata.
- **Acceptance criteria**:
  - Context includes book/path/field/script where available.
  - Missing context fields degrade gracefully.
  - User-visible context chips match payload sent to backend.

### 7) Provenance logging (accepted applies)
- **Task**: Persist provenance for accepted output applications.
- **Acceptance criteria**:
  - Store request id, user id, target field, prompt hash/text policy, model id, timestamp, confidence.
  - Associate record to entity scope (book/node/draft_book).
  - Retrieval available for audit debugging.

---

## Phase 2 — Validation + safety hardening

### 8) Output validation engine
- **Task**: Enforce field-level validation rules (`script_check`, length, html/markdown restrictions, regex rules).
- **Acceptance criteria**:
  - Invalid output blocked from Apply with clear error message.
  - Validation errors include which rule failed.

### 9) Citation and confidence policy
- **Task**: Enforce `requires_citation` and confidence presentation/threshold policy.
- **Acceptance criteria**:
  - Scripture-fetch templates require citation notes.
  - Confidence badge displayed in modal.
  - Threshold warning appears below configured value.

### 10) Rate limiting
- **Task**: Add per-user/per-node/per-book limits.
- **Acceptance criteria**:
  - Default limits enforced (initial proposal from PR #43 Suggested Defaults).
  - Rate-limit errors return retry guidance.

---

## Phase 3 — Admin and scale-out

### 11) Metadata admin UI support
- **Task**: Add authoring/admin controls to configure `ai_assist` in schema/property definitions.
- **Acceptance criteria**:
  - Admin can enable/disable and edit templates/permissions/rules per field.
  - Saved config validates against `ai_assist_field_metadata.schema.json`.

### 12) Template catalog management
- **Task**: Support reusable template ids and controlled updates/versioning.
- **Acceptance criteria**:
  - Template lookup by id works for all configured fields.
  - Breaking template changes are versioned.

---

## Testing checklist

### Backend tests
- Auth and permission matrix (401/403 paths).
- Metadata-enabled vs non-enabled fields.
- Validation failures and structured error responses.
- Rate-limit behavior.

### Frontend tests
- AI Help button visibility by role and field config.
- Prompt prefill from context.
- Manual apply flow and no auto-write behavior.
- Error states (validation/rate-limit/backend failure).

### E2E tests
- Author can generate and apply to Sanskrit field.
- Contributor behavior limited to allowed modes.
- Viewer cannot see/use AI Assist.

---

## Delivery gates

- **Gate A (MVP complete)**: Tasks 1–7 done + backend/frontend/e2e happy paths passing.
- **Gate B (Safety complete)**: Tasks 8–10 done + negative-path tests passing.
- **Gate C (Scale complete)**: Tasks 11–12 done + admin workflow documented.
