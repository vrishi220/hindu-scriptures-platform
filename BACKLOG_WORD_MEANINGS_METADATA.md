# Backlog — Word Meanings Metadata Implementation

Status: Implemented (MVP complete)
Scope: Implement metadata-driven `word_meanings` authoring, validation, rendering, indexing, and export behavior.
Source of truth: RFC_WORD_MEANINGS_METADATA.md (2026-03-02).
GitHub Tracker: #58 ([EPIC] Word Meanings Metadata Implementation Tracker).

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
- area:search
- area:docs
- priority:p0 / p1 / p2
- phase:A / phase:B / phase:C / phase:D / phase:E

## Epic WM1 — Metadata-Driven Word Meanings (MVP)

### Phase A — Contracts and Data Backbone

#### WM-01: Finalize field metadata JSON contract
- Priority: p0
- Estimate: 0.5 day
- Depends on: none
- Labels: area:data, area:docs, phase:A
- Deliverables:
  - Finalized metadata schema for `word_meanings` (`source`, `meanings`, `validation`, `rendering`).
  - Documented defaults and fallback behavior.
- Definition of Done:
  - Contract fields and defaults are locked for v1.
  - Open questions in RFC are converted to explicit decisions.

#### WM-02: Add server-side payload validators
- Priority: p0
- Estimate: 1.5 days
- Depends on: WM-01
- Labels: area:backend, area:data, phase:A
- Deliverables:
  - Validation for payload version, row shape, language constraints, and limits.
  - Validation errors returned with field-path granularity.
- Definition of Done:
  - Invalid payloads are rejected consistently.
  - Unit tests cover row-level and payload-level rules.

#### WM-03: Add persistence compatibility checks
- Priority: p0
- Estimate: 1 day
- Depends on: WM-02
- Labels: area:backend, area:data, phase:A
- Deliverables:
  - Ensure `content_data`/property storage accepts and preserves `word_meanings` shape.
  - Version-awareness for forward-compatible payload keys.
- Definition of Done:
  - Save + read roundtrip preserves all valid keys and ordering.

### Phase B — Authoring UX (Admin/Editor)

#### WM-04: Build row-based editor component for `word_meanings`
- Priority: p0
- Estimate: 2 days
- Depends on: WM-01
- Labels: area:web, phase:B
- Deliverables:
  - Two-column row editor with add/delete/reorder actions.
  - Source input supports script/transliteration per metadata mode.
- Definition of Done:
  - Editor can create/edit/delete/reorder rows without page refresh.

#### WM-05: Add multilingual meaning inputs with fallback hints
- Priority: p0
- Estimate: 1.5 days
- Depends on: WM-04
- Labels: area:web, phase:B
- Deliverables:
  - Language chips/tabs for per-row meaning entry.
  - UX indicator for required languages (default `en`).
- Definition of Done:
  - At least one meaning is enforced and required languages are visibly enforced.

#### WM-06: Enforce client-side validation parity with server
- Priority: p0
- Estimate: 1 day
- Depends on: WM-02, WM-05
- Labels: area:web, area:backend, phase:B
- Deliverables:
  - Client validation mirrors server constraints and messages.
  - Save blocked until all validation errors are resolved.
- Definition of Done:
  - Same invalid payload shows equivalent errors in client and API response.

### Phase C — Runtime Rendering and Preferences

#### WM-07: Implement source token resolution strategy
- Priority: p0
- Estimate: 1.5 days
- Depends on: WM-03
- Labels: area:rendering, area:backend, phase:C
- Deliverables:
  - Runtime resolution for left column: preferred mode, scheme, runtime generation fallback.
  - Metadata-aware behavior for transliteration generation enablement.
- Definition of Done:
  - Resolution order is deterministic and covered by tests.

#### WM-08: Implement meaning-language fallback strategy
- Priority: p0
- Estimate: 1 day
- Depends on: WM-03
- Labels: area:rendering, area:backend, phase:C
- Deliverables:
  - Right-column selection order: user preference -> `en` -> first available.
  - Fallback-language indicator flag in render payload.
- Definition of Done:
  - Renderer returns selected meaning and fallback metadata for UI badge.

#### WM-09: Wire browse/details UI to rendered contract
- Priority: p0
- Estimate: 1 day
- Depends on: WM-07, WM-08
- Labels: area:web, area:rendering, phase:C
- Deliverables:
  - Read-mode table/list renderer for `word_meanings` rows.
  - Badge display only when fallback occurred and metadata allows it.
- Definition of Done:
  - UI output matches rendering contract for all tested preference combinations.

### Phase D — Search and Export

#### WM-10: Extend search indexing for word meanings
- Priority: p1
- Estimate: 1 day
- Depends on: WM-03
- Labels: area:search, area:backend, phase:D
- Deliverables:
  - Index script text, transliteration values, and all meaning-language texts.
  - Keep indexing metadata-driven and scripture-agnostic.
- Definition of Done:
  - Search can match tokens and meanings across configured languages.

#### WM-11: Add export/PDF rendering support
- Priority: p1
- Estimate: 1 day
- Depends on: WM-07, WM-08
- Labels: area:rendering, area:backend, phase:D
- Deliverables:
  - Deterministic row ordering in export.
  - Same language fallback logic used by web renderer.
- Definition of Done:
  - Exported output for the same input is stable and contract-compliant.

### Phase E — QA, Rollout, and Documentation

#### WM-12: End-to-end test coverage and fixture set
- Priority: p0
- Estimate: 1.5 days
- Depends on: WM-06, WM-09
- Labels: area:web, area:backend, phase:E
- Deliverables:
  - Fixtures for valid/invalid payloads.
  - E2E flow test: author -> save -> browse -> search -> export.
- Definition of Done:
  - Critical path tests pass in CI for at least one enabled level.

#### WM-13: Feature-flagged rollout on selected levels
- Priority: p1
- Estimate: 0.5 day
- Depends on: WM-12
- Labels: area:backend, area:web, phase:E
- Deliverables:
  - Enablement config for selected scripture levels only.
  - Rollback toggle documented.
- Definition of Done:
  - Field is only visible where explicitly enabled.

#### WM-14: Update docs + authoring guide
- Priority: p1
- Estimate: 0.5 day
- Depends on: WM-13
- Labels: area:docs, phase:E
- Deliverables:
  - Metadata cookbook entry.
  - Author guidance for multilingual entry and fallback behavior.
- Definition of Done:
  - Docs reflect final v1 behavior and known limitations.

## Recommended Execution Order
1. WM-01, WM-02, WM-03
2. WM-04, WM-05, WM-06
3. WM-07, WM-08, WM-09
4. WM-10, WM-11
5. WM-12, WM-13, WM-14

## MVP Exit Checklist
- [x] Metadata contract finalized and versioned.
- [x] Client/server validation parity verified.
- [x] Browse renderer follows source + meaning fallback contract.
- [x] Search indexing includes source + multilingual meanings.
- [x] Export output deterministic and fallback-consistent.
- [x] Feature-flag rollout completed for selected levels.