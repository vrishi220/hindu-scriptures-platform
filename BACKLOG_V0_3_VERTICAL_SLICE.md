# Backlog v0.3 — First Vertical Slice

Status: Draft (execution-ready)
Scope: Editor assembles mixed-source draft and publishes immutable edition with provenance-backed PDF export.
Source of truth: DESIGN_RFC.md (v0.3), Section 19.

## Decision Update (2026-02-22)
- Basket is treated as an intake/selection surface to compose candidate book structure.
- Draft is the canonical printable/publishable assembly surface.
- Rendering is template-driven from draft snapshot payloads (not basket state).
- Draft body may reference an entire source book explicitly (`source_scope: "book"`) and expand to renderable body blocks.
- Book preview/render contracts are body-only; front/back finishing layers remain draft concerns.

## Board Model
- Backlog
- Ready
- In Progress
- Review
- Done

## Labels
- area:backend
- area:web
- area:data
- area:rendering
- area:security
- area:docs
- role:admin
- role:editor
- role:contributor
- role:viewer
- priority:p0 / p1 / p2
- phase:A / phase:B / phase:C / phase:D

## Epic E1 — Vertical Slice v0.3

### Phase A — Data/Domain Backbone

#### A-01: Create Collection Cart entities and APIs
- Priority: p0
- Estimate: 2 days
- Depends on: none
- Deliverables:
  - DB model/table for collection cart and cart items
  - CRUD API for cart operations (add/remove/list)
  - Ownership and permission checks
- Definition of Done:
  - Editor can add/remove/list library items in cart
  - Non-owner access is denied

#### A-02: Add Draft Book and Edition Snapshot models
- Priority: p0
- Estimate: 2 days
- Depends on: A-01
- Deliverables:
  - Draft book model with section structure support (front/body/back)
  - Edition snapshot model (immutable once published)
  - Snapshot creation API
- Definition of Done:
  - Published editions cannot be modified
  - Draft remains editable

#### A-03: Implement metadata resolution engine (v1)
- Priority: p0
- Estimate: 2 days
- Depends on: A-02
- Deliverables:
  - Resolve precedence: field > node > level > book > global
  - Unit tests for precedence and overrides
- Definition of Done:
  - Same input produces same resolved metadata
  - Tests cover conflict and null behavior

#### A-04: Implement template resolution engine (v1)
- Priority: p0
- Estimate: 2 days
- Depends on: A-02
- Deliverables:
  - Resolve precedence: explicit node > level > book > global
  - Unit tests for collisions and fallback
- Definition of Done:
  - Deterministic template binding for all nodes in draft

### Phase B — Composer Workflow

#### B-01: Search-to-cart UX wiring (Editor)
- Priority: p0
- Estimate: 2 days
- Depends on: A-01
- Deliverables:
  - Search results include add-to-cart action
  - Cart count and review panel
- Definition of Done:
  - Editor can gather items without leaving workflow

#### B-02: Mixed-source compose flow (library + own content)
- Priority: p0
- Estimate: 3 days
- Depends on: A-02, B-01
- Deliverables:
  - Insert library items into draft structure
  - Add user-authored nodes/fields
  - Reorder and section assignment
- Definition of Done:
  - Draft can combine both source types in one edition path

#### B-03: Provenance capture at insertion time
- Priority: p0
- Estimate: 1.5 days
- Depends on: B-02
- Deliverables:
  - Provenance record for each reused item
  - Source, author, license, version fields persisted
- Definition of Done:
  - Every reused item has non-empty provenance record

### Phase C — Rendering + Export

#### C-01: Render compilation pipeline (web preview)
- Priority: p0
- Estimate: 3 days
- Depends on: A-03, A-04, B-02
- Deliverables:
  - Compile nodes with resolved metadata/templates
  - Render preview artifact for web profile
- Definition of Done:
  - Preview is deterministic for same inputs

#### C-02: Transliteration eligibility enforcement in renderer
- Priority: p0
- Estimate: 1.5 days
- Depends on: C-01
- Deliverables:
  - Apply script conversion only when `is_transliterable=true`
  - Preserve translation/commentary fields unchanged
- Definition of Done:
  - Switching render script changes only eligible fields

#### C-03: PDF export pipeline (MVP canonical engine)
- Priority: p0
- Estimate: 3 days
- Depends on: C-01
- Deliverables:
  - Profile-based PDF export (`pdf-book`)
  - TOC + page numbers + front/body/back support
- Definition of Done:
  - Export artifact generated and downloadable from edition

### Phase D — Publish + Guardrails

#### D-01: License policy checks (warning at collect, blocking at publish)
- Priority: p0
- Estimate: 2 days
- Depends on: B-03, C-03
- Status: Done (2026-02-21)
- Deliverables:
  - Warning in collect flow
  - Blocking errors in publish flow
- Definition of Done:
  - Non-compliant draft cannot publish

#### D-02: Publish gate and immutable edition freeze
- Priority: p0
- Estimate: 1.5 days
- Depends on: A-02, D-01
- Status: Done (2026-02-21)
- Deliverables:
  - Publish endpoint validates all blockers
  - Freezes draft into immutable edition snapshot
- Definition of Done:
  - Post-publish edit attempts fail with clear errors

#### D-03: Provenance appendix in published outputs
- Priority: p1
- Estimate: 1 day
- Depends on: B-03, C-03
- Status: Done (2026-02-21)
- Deliverables:
  - Human-readable provenance appendix section in web/PDF
- Definition of Done:
  - Reader can inspect source attribution and licenses per reused item

## Cross-Cutting Tasks

### X-01: RBAC test matrix for Admin/Editor/Contributor/Viewer
- Priority: p0
- Estimate: 1.5 days
- Depends on: A-01, B-02, D-02
- Status: Done (2026-02-21)
- Definition of Done:
  - Positive and negative authorization tests pass for all critical actions

### X-02: Determinism checks for render artifacts
- Priority: p0
- Estimate: 1 day
- Depends on: C-01, C-03
- Status: Done (2026-02-21)
- Definition of Done:
  - Repeated generation with same inputs yields stable hashes or approved tolerance

### X-03: Observability and audit events
- Priority: p1
- Estimate: 1 day
- Depends on: D-02
- Status: Done (2026-02-21)
- Definition of Done:
  - Publish, policy failure, and snapshot events are logged with actor and timestamp

## Recommended Execution Order
1. A-01, A-02
2. A-03, A-04
3. B-01, B-02, B-03
4. C-01, C-02, C-03
5. D-01, D-02, D-03
6. X-01, X-02, X-03

## Daily Operating Cadence
- 15-min standup with blockers and ticket status.
- End-of-day update: moved tickets + risks + decision log updates.
- Any architecture change must update DESIGN_RFC.md decision log.

## Release Exit Checklist (Vertical Slice)
- [x] Mixed-source draft creation works end-to-end
- [x] Publish freezes immutable edition
- [x] Provenance visible in output
- [x] License checks enforced at publish
- [x] Deterministic render behavior verified
- [x] RBAC critical path tests pass

## Next Slice Candidate Tickets (From RFC 21.6)

### N-01: Renderer parity for Phase C output assembly
- Priority: p0
- Estimate: 3 days
- Labels: area:rendering, area:backend
- Depends on: C-01, C-02
- Status: Done (2026-02-21)
- Deliverables:
  - Materialize section-aware output pipeline (`front/body/back`) from snapshot payload.
  - Apply deterministic ordering and template/materialization pass for rendered output blocks.
  - Expose a backend render artifact endpoint for published snapshots.
- Definition of Done:
  - Same snapshot input produces stable render artifact payload.
  - Integration tests verify section ordering and deterministic block output.

### N-02: Canonical PDF engine decision and hardening (D-013 resolution)
- Priority: p0
- Estimate: 1.5 days
- Labels: area:rendering, area:docs, area:backend
- Depends on: C-03
- Status: Done (2026-02-21)
- Deliverables:
  - Finalize canonical PDF engine decision and move `D-013` to Accepted/Superseded in RFC.
  - Add export constraints/limitations doc for the chosen engine (`PDF_EXPORT_BASELINE.md`).
  - Add regression tests for deterministic PDF hashing baseline.
- Definition of Done:
  - RFC decision status updated with rationale.
  - Export path uses one canonical engine with stable hash behavior in CI tests.

### N-03: Viewer-facing published edition reading UX
- Priority: p1
- Estimate: 3 days
- Labels: area:web, role:viewer
- Depends on: N-01
- Status: Done (2026-02-21)
- Deliverables:
  - Add published edition page for snapshot reading.
  - Show TOC-like section navigation and provenance appendix visibility in viewer flow.
  - Add PDF download action in viewer context (policy permitting).
- Definition of Done:
  - Viewer can open published edition, navigate sections, inspect provenance, and export PDF.
  - Access control prevents unpublished draft visibility.

### N-04: Web E2E coverage for publish/export critical path
- Priority: p1
- Estimate: 2 days
- Labels: area:web, area:testing, area:security
- Depends on: D-02, N-03
- Status: Done (2026-02-21)
- Deliverables:
  - Add E2E scenarios for draft publish success/failure and snapshot PDF download.
  - Add ownership/unauthorized access E2E checks for publish/export routes.
  - Add deterministic export smoke check in E2E or integration layer.
- Definition of Done:
  - E2E suite catches regressions in publish/export UX and auth boundaries.
  - CI includes at least one publish + export happy-path and one policy-block path.

## Recommended Next Slice Execution Order
Rationale: lock PDF engine decision first, then implement renderer core, then ship viewer UX on stable artifacts, and finally harden with end-to-end regression coverage.
1. N-02 (canonical PDF engine decision + baseline constraints)
2. N-01 (renderer parity and published snapshot render artifact endpoint)
3. N-03 (viewer-facing published edition reading experience)
4. N-04 (E2E coverage for publish/export and authorization boundaries)

## Coverage Sprint (Backend API Hardening)

Baseline (2026-02-22): API package line coverage is 61%.

### COV-01: Content API high-risk path coverage
- Priority: p0
- Estimate: 3 days
- Labels: area:backend, area:testing, area:security
- Scope: `api/content.py`
- Target:
  - Increase `api/content.py` coverage from 48% to >=65%.
  - Add regression tests for ownership boundaries, invalid hierarchy transitions, node update edge-cases, and reference insertion conflicts.
- Definition of Done:
  - New tests cover both success and failure branches for create/update/delete/reference operations.
  - Coverage report shows `api/content.py` >=65%.

### COV-02: Users/Admin permissions coverage
- Priority: p0
- Estimate: 1.5 days
- Labels: area:backend, area:security, role:admin
- Scope: `api/users.py`
- Target:
  - Increase `api/users.py` coverage from 50% to >=75%.
  - Add tests for admin create/update/deactivate/list user flows, plus forbidden checks for non-admin callers.
- Definition of Done:
  - Permission matrix assertions are explicit for `can_admin` protected routes.
  - Coverage report shows `api/users.py` >=75%.

### COV-03: Auth + search branch completion
- Priority: p1
- Estimate: 1.5 days
- Labels: area:backend, area:testing
- Scope: `api/auth.py`, `api/search.py`
- Target:
  - Raise `api/auth.py` from 64% to >=75%.
  - Raise `api/search.py` from 63% to >=75%.
  - Add tests for refresh/logout invalid-token paths, inactive-user behavior, and search parameter edge handling.
- Definition of Done:
  - Token refresh/logout failure branches are exercised.
  - Coverage report shows both files >=75%.

### COV-04: Import pipeline contract tests
- Priority: p1
- Estimate: 2 days
- Labels: area:backend, area:data, area:testing
- Scope: `api/import_parser.py`, `api/json_importer.py`, `api/pdf_importer.py`
- Target:
  - Add contract-level tests for parse failures, malformed payloads, and minimal successful imports.
  - Raise each file to >=50% line coverage.
- Definition of Done:
  - Import endpoints fail with deterministic, user-facing error messages on malformed input.
  - Coverage report shows each import module >=50%.

## Coverage Sprint Exit Criteria
- API package line coverage >=70%.
- No regression in `api/draft_books.py` (remain >=80%) and `api/collection_cart.py` (remain >=85%).
- CI includes coverage report artifact and per-file gates for `api/content.py` and `api/users.py`.
