# DESIGN RFC v0.3 — Composable Knowledge Publishing Platform

## Status
- Draft for iteration
- Date: 2026-02-20
- Owners: Product + Platform + Content UX

## 1) Vision
Build a platform where users can discover trusted content, collect it, combine it with their own writing, and publish structured books that render consistently across web and PDF.

## 2) Problem Statement
Current prototype is content-first and page-concatenation heavy. Long-term needs require:
- deterministic rendering based on templates (not field concatenation),
- schema-bound metadata (not ad hoc flags),
- reusable assembly from system + user content,
- publication-grade outputs (front matter, TOC, index, PDF).

## 3) Product Positioning
Category: **Composable Knowledge Publishing Platform**.

Core loop:
1. Discover
2. Collect
3. Compose
4. Render
5. Publish

Differentiator:
- users build curated books from existing library content plus their own contributions,
- every included item keeps provenance and licensing context,
- output quality is template-driven and export-ready.

## 4) Terminology (v1)
- **Library Item**: reusable source content unit.
- **Collection Cart**: temporary gathered items before assembly.
- **Edition**: immutable compiled snapshot of a book.
- **Schema Property**: typed metadata key with validation and inheritance.
- **Category Template**: reusable set of schema properties.
- **Render Template**: layout and rendering rules.
- **Render Profile**: output target (web, print-a4, pdf-book, etc.).
- **Publication Sections**: front matter, body, back matter.
- **Provenance Record**: source, author, license, version metadata for reused content.

## 5) Domain Model (Target)
### 5.1 Content Graph
Book → Sections → Levels/Nodes → Fields.

### 5.2 Metadata Layer
- Property definitions are schema-controlled.
- Category templates bind properties to book/level/node/field scopes.
- Effective metadata is resolved via inheritance + explicit override.

### 5.3 Template Layer
- Templates can attach at book, level type, node type, and explicit node.
- For custom rendering, level template selection can be represented as metadata properties (for example `verse_template_key`), then resolved by precedence.
- Templates define block structure, conditional visibility, order, page behavior, and style tokens.

### 5.4 Edition Layer
- Assembled books become immutable editions.
- Editions store resolved references so source edits do not silently change published output.

## 6) Deterministic Resolution Rules
### 6.1 Metadata precedence
field override > node binding > level binding > book binding > global default.

### 6.2 Template precedence
explicit node template binding > metadata template key properties (`<section>_<level>_template_key`, `<level>_template_key`, `<section>_template_key`, `render_template_key`) > level template binding > book template binding > global fallback.

### 6.3 Conflict rule
If same scope collides, latest published version wins.

## 7) Rendering Principles
- Rendering is separate from content storage.
- Only fields marked transliterable are script-converted.
- Translations/commentary/UI text are never transliterated by default.
- Direction-aware layout is supported (LTR/RTL).
- Rendering must support front matter/body/back matter and generated sections (TOC, index).

## 8) Publishing Pipeline
1. Resolve metadata
2. Resolve effective templates
3. Materialize blocks
4. Apply language/script rules
5. Generate output HTML
6. Export PDF and artifacts

Cache key example:
`(edition_id, template_version, render_profile, render_script)`

## 9) MVP Scope
- Search + collect + compose flow for mixed-source assembly.
- Provenance ledger on included items.
- Template-based render for chapter/verse/commentary + front matter.
- PDF export with TOC and page numbers.
- Transliteration eligibility and render script preference.

## 10) Out of Scope (Initial)
- Full visual WYSIWYG template builder.
- Marketplace-style external licensing contracts.
- AI auto-generation of full chapters.

## 11) Risks and Mitigations
- **Terminology drift** → lock glossary and review in every design PR.
- **Template complexity** → start with minimal block types and strict validation.
- **Rights/compliance errors** → mandatory provenance and permission checks before publish.
- **Rendering variance across languages** → profile-based QA matrix (Indic + RTL + Latin).

## 12) Open Questions
1. Is `Edition` always immutable, or do we allow mutable draft-editions?
2. Do we enforce license compatibility checks at add-to-cart or at publish?
3. Should index generation be automatic-only or allow manual overrides?
4. Which PDF engine is canonical for production quality?

## 13) Milestones
- **M1**: Vocabulary + domain entities finalized.
- **M2**: Metadata schema + category templates + resolution engine.
- **M3**: Render templates + section-aware renderer.
- **M4**: Search/collect/compose UX with provenance.
- **M5**: Edition snapshots + publication/export pipeline.

## 14) Acceptance Criteria for Architecture Draft
- Team can explain system end-to-end using shared terminology.
- Any rendered page can be traced to resolved metadata + template decisions.
- Same edition renders deterministically across environments.
- Mixed-source compilation preserves ownership/provenance in UI and export.

## 15) Personas and Roles (RBAC v1)

### 15.1 Persona: Platform Admin
**Goal**: Govern platform-wide quality, permissions, templates, and compliance.

**Capabilities**:
- Manage users, roles, and workspace policies.
- Define global property definitions and category templates.
- Publish/deprecate global render templates and render profiles.
- Configure license policies and publication guardrails.
- Access audit logs and provenance reports.

**Restrictions**:
- Should not silently modify published editions without versioned trace.

### 15.2 Persona: Organization Editor
**Goal**: Curate content into high-quality editions for publication.

**Capabilities**:
- Search and collect reusable library content.
- Create own content and combine with reusable content.
- Structure books (front matter/body/back matter).
- Attach templates at book/level/node scope.
- Generate previews and publish draft editions.

**Restrictions**:
- Cannot change global schema/template definitions unless delegated.

### 15.3 Persona: Contributor/Author
**Goal**: Add and improve source material.

**Capabilities**:
- Create and edit own library items.
- Propose metadata and section structure changes.
- Submit content for editorial review.

**Restrictions**:
- Cannot publish organizational editions directly unless granted publisher rights.

### 15.4 Persona: Viewer/Reader
**Goal**: Discover, read, and personalize consumption.

**Capabilities**:
- Browse published editions.
- Set rendering preferences (script, transliteration options, direction-aware settings when relevant).
- Export allowed formats where policy permits.

**Restrictions**:
- No access to unpublished drafts or restricted source items.

### 15.5 Role Matrix (Simplified)
- **Admin**: full platform governance + publish override.
- **Editor**: assemble, template-bind, preview, publish editions within scope.
- **Contributor**: author content, propose edits, submit for review.
- **Viewer**: consume published editions and personalize rendering.

## 16) Screenplay-Style Use Cases

### UC-1: Admin defines publishing standards
**Cast**: Admin

**Scene 1 — Governance Setup**
1. Admin opens Policy Console.
2. Admin defines schema properties: `is_transliterable`, `source_language`, `direction`, `section_type`.
3. Admin creates category templates: `sanskrit_verse`, `translation_block`, `preface_block`, `rtl_reference_block`.

**Scene 2 — Template Standards**
4. Admin publishes global render templates for `chapter`, `verse`, `preface`, `index`.
5. Admin configures render profiles: `web`, `print-a4`, `pdf-book`.

**Scene 3 — Compliance Guardrails**
6. Admin enables mandatory provenance and license checks at publish.
7. Admin saves policy version `policy_v1`.

**Outcome**:
- Organization now has shared vocabulary, schema constraints, and render standards.

### UC-2: Editor composes a curated edition from mixed sources
**Cast**: Editor

**Scene 1 — Discover and Collect**
1. Editor searches for topic "Bhagavad Gita karma yoga".
2. Editor adds selected Library Items to Collection Cart.
3. Editor adds two original commentary notes.

**Scene 2 — Compose Book Structure**
4. Editor creates a new Book Draft.
5. Editor adds front matter: title page, preface, acknowledgments.
6. Editor inserts collected items into body chapters.
7. Editor adds back matter placeholders: glossary and index.

**Scene 3 — Bind Metadata + Templates**
8. Editor applies category templates to sections and nodes.
9. Editor overrides one field as non-transliterable (English explanation).
10. Editor binds a custom chapter template for chapter intro pages.

**Scene 4 — Preview and Validate**
11. Editor generates `web` preview.
12. Editor switches render script preference and confirms only eligible fields change.
13. Editor runs validation: all required provenance and licenses pass.

**Scene 5 — Publish Edition**
14. Editor freezes draft as `edition_v1`.
15. System compiles deterministic artifact bundle and stores cache keys.
16. Edition is published with citation and provenance appendix.

**Outcome**:
- A mixed-source, policy-compliant, render-consistent edition is published.

### UC-3: Contributor proposes improvements to source content
**Cast**: Contributor, Editor

**Scene 1 — Authoring**
1. Contributor updates a verse annotation and adds references.
2. Contributor submits change request linked to affected Library Item.

**Scene 2 — Review**
3. Editor reviews diff and provenance context.
4. Editor accepts change and tags it as eligible for future editions.

**Scene 3 — Edition Impact**
5. Existing published editions remain unchanged (snapshot immutability).
6. Editor creates `edition_v2` to include approved updates.

**Outcome**:
- Source quality improves without mutating existing published artifacts.

### UC-4: Viewer consumes and exports with personalization
**Cast**: Viewer

**Scene 1 — Reading**
1. Viewer opens published edition.
2. Viewer changes render script in UI.
3. System re-renders transliterable fields only.

**Scene 2 — Navigation + Access**
4. Viewer uses TOC and index to navigate.
5. Viewer opens provenance panel for cited sections.

**Scene 3 — Export**
6. Viewer requests PDF export where policy allows.
7. System serves compiled artifact matching selected render profile.

**Outcome**:
- Reader gets personalized but faithful rendering with transparent sourcing.

### UC-5: RTL/LTR multilingual publishing validation
**Cast**: Editor, QA Reviewer

**Scene 1 — Mixed Script Draft**
1. Editor includes Hebrew quote blocks and English commentary.
2. Editor sets metadata: Hebrew fields `direction=rtl`, English `direction=ltr`.

**Scene 2 — Render Validation**
3. Preview checks heading alignment, punctuation order, and mixed-number rendering.
4. QA verifies page headers/footers mirror correctly in RTL templates.

**Scene 3 — Publish Readiness**
5. QA signs off on typography and bidi behavior.
6. Editor publishes multilingual edition.

**Outcome**:
- Platform demonstrates language-agnostic architecture with direction-aware rendering.

## 17) Next Design Iteration Targets
- Add glossary matrix table with canonical term, allowed synonyms, and banned synonyms.
- Add state diagrams for draft → review → published edition lifecycle.
- Add API contracts for search/collect/compose/publish actions.
- Add permission test matrix for Admin/Editor/Contributor/Viewer.

## 18) Decision Log

| ID | Date | Decision | Rationale | Status | Owner |
|---|---|---|---|---|---|
| D-001 | 2026-02-20 | Product category is **Composable Knowledge Publishing Platform** | Reflects search + assembly + rendering + publishing, not just reading | Accepted | Product |
| D-002 | 2026-02-20 | Core workflow is **Discover → Collect → Compose → Render → Publish** | Establishes common mental model across teams | Accepted | Product + UX |
| D-003 | 2026-02-20 | `Edition` is the publish unit and is immutable after publish | Ensures deterministic outputs and auditability | Accepted | Platform |
| D-004 | 2026-02-20 | Metadata is schema-bound using property definitions + category templates | Prevents ad hoc flags and supports scalable governance | Accepted | Platform |
| D-005 | 2026-02-20 | Template resolution precedence is deterministic by scope | Avoids ambiguity and hard-to-debug render behavior | Accepted | Platform |
| D-006 | 2026-02-20 | Only transliterable fields are script-converted; translation is separate | Preserves semantic correctness and user expectations | Accepted | Product + UX |
| D-007 | 2026-02-20 | Front matter/body/back matter are first-class publication sections | Supports real book composition and export quality | Accepted | Product |
| D-008 | 2026-02-20 | Platform is language-agnostic with direction-aware rendering (LTR/RTL) | Enables non-Indic and RTL content without re-architecture | Accepted | Platform |
| D-009 | 2026-02-20 | Mixed-source assembly must carry provenance and license context | Required for trust, compliance, and citation integrity | Accepted | Product + Compliance |
| D-010 | 2026-02-20 | RBAC baseline roles are Admin, Editor, Contributor, Viewer | Clarifies capability boundaries for MVP | Accepted | Product + Security |
| D-011 | 2026-02-21 | Drafts remain mutable; published editions are immutable | Enables editing velocity while preserving publish integrity and reproducibility | Accepted | Product + Platform |
| D-012 | 2026-02-21 | License checks are warning at collect, blocking at publish | Gives early author guidance while enforcing final compliance gate | Accepted | Product + Compliance |
| D-013 | 2026-02-21 | Canonical MVP PDF engine is ReportLab with deterministic (`invariant=1`) generation | Keeps one export path with stable binary hashing behavior and lower QA variance | Accepted | Platform |
| D-014 | 2026-02-21 | Publish, policy-failure, snapshot, and export actions emit structured audit events with actor and timestamp | Improves observability, compliance traceability, and incident diagnosis | Accepted | Platform |

### 18.1 Decision Process
- New major architecture/terminology choices should add a new `D-xxx` entry.
- If a decision changes, keep the old row and add a new superseding row with cross-reference.
- Status values: `Accepted`, `Superseded`, `Proposed`, `Rejected`.

## 19) v0.3 Execution Plan — First Vertical Slice

Execution backlog: `BACKLOG_V0_3_VERTICAL_SLICE.md`

### 19.1 Goal
Deliver one complete, testable flow:
**Editor assembles a mixed-source book draft and publishes `edition_v1` with provenance-backed PDF export.**

### 19.2 Decision Lock for This Slice
Resolve these before coding starts:
1. `Edition` is immutable after publish (drafts remain mutable).
2. License compatibility checks run at both add-to-cart (warning) and publish (blocking).
3. Canonical PDF engine for MVP: single engine selection with deterministic output baseline.

### 19.3 In-Scope Features
- Search and add existing Library Items to Collection Cart.
- Add user-authored content into the same draft.
- Compose front matter + body + back matter.
- Resolve metadata and templates deterministically.
- Generate web preview and PDF export.
- Attach provenance/citation appendix in published edition.

### 19.4 Out-of-Scope for This Slice
- Visual template builder.
- Full collaborative review workflow.
- Auto-generated index editorial overrides.

### 19.5 Feature Flags
- `ff_collection_cart`
- `ff_template_resolution_v1`
- `ff_edition_snapshot_v1`
- `ff_pdf_export_v1`
- `ff_provenance_appendix_v1`

### 19.6 Delivery Phases

#### Phase A — Data/Domain Backbone
- Add entities for Collection Cart, Draft Book, Edition Snapshot, Provenance Record.
- Add metadata resolution engine (scope precedence).
- Add template resolution engine (scope precedence).

#### Phase B — Composer Workflow
- Enable search → collect → compose flow for Editor role.
- Support mixed-source insertion (library + own content).
- Persist section structure (front/body/back).

#### Phase C — Rendering + Export
- Resolve effective render template per node.
- Generate deterministic web preview artifacts.
- Generate deterministic PDF artifacts with TOC and page numbering.

#### Phase D — Publish + Guardrails
- Enforce blocking publish checks (license, provenance, required metadata).
- Freeze `edition_v1` snapshot.
- Expose provenance/citation appendix in output.

### 19.7 Acceptance Criteria (Vertical Slice)
1. Editor can build one mixed-source draft end-to-end.
2. Published edition is immutable and reproducible.
3. Same input + same versions produce byte-stable (or hash-stable) artifact outputs.
4. Provenance exists for every reused item and appears in export.
5. Permission checks prevent unauthorized publish.
6. Transliteration applies only to eligible fields in preview/export.

### 19.8 Test Matrix (Minimum)
- **Functional**: search, collect, compose, publish.
- **Policy**: license warnings at collect; blocking errors at publish.
- **Rendering**: template precedence + metadata precedence.
- **Regression**: unchanged output for unchanged edition/template/profile.
- **Security**: role-based restrictions (Admin/Editor/Contributor/Viewer).
- **Observability**: audit events for publish/snapshot/policy-failure/export include actor + timestamp.

### 19.9 Suggested Timeline (MVP Slice)
- Week 1: Phase A
- Week 2: Phase B
- Week 3: Phase C
- Week 4: Phase D + stabilization

### 19.10 Exit Criteria for v0.3
- Vertical slice demo completed in staging.
- RFC decisions D-011 to D-013 moved from Proposed to Accepted/Superseded.
- Implementation backlog for next slice prioritized with effort estimates.

## 20) Decision Updates (Resolved 2026-02-21)

| ID | Date | Decision | Rationale | Status | Owner |
|---|---|---|---|---|---|
| D-011 | 2026-02-21 | Drafts are mutable; published editions are immutable | Enables editing velocity + release integrity | Accepted | Product + Platform |
| D-012 | 2026-02-21 | License checks are warning at collect, blocking at publish | Early guidance with final compliance gate | Accepted | Product + Compliance |
| D-013 | 2026-02-21 | Canonical PDF engine for MVP is ReportLab with deterministic export mode | Reduces rendering variance and QA complexity while preserving stable hashes | Accepted | Platform |

## 21) Implementation Snapshot (As of 2026-02-21)

### 21.1 Draft + Publish APIs (Implemented)
- `POST /api/draft-books`
- `GET /api/draft-books/my`
- `GET /api/draft-books/{draft_id}`
- `PATCH /api/draft-books/{draft_id}`
- `GET /api/draft-books/{draft_id}/license-policy`
- `POST /api/draft-books/{draft_id}/snapshots`
- `POST /api/draft-books/{draft_id}/publish`
- `GET /api/draft-books/{draft_id}/snapshots`

### 21.2 Published Output + Export (Implemented)
- `GET /api/edition-snapshots/{snapshot_id}`
- `GET /api/edition-snapshots/{snapshot_id}/render-artifact`
- `GET /api/edition-snapshots/{snapshot_id}/export/pdf`
- Snapshot payload includes `provenance_appendix` for published outputs.
- Web viewer page `/editions/{snapshot_id}` shows section navigation, rendered blocks, provenance appendix, and PDF export action.

### 21.3 Collect-Time Policy API (Implemented)
- `POST /api/content/license-policy-check`
- Behavior: warning at collect, blocking at publish/snapshot when disallowed licenses are present.

### 21.4 Audit Event Names (Implemented)
- `snapshot.created`
- `snapshot.policy_blocked`
- `publish.succeeded`
- `publish.policy_blocked`
- `snapshot.pdf_exported`

### 21.5 Verification Coverage (Implemented)
- Integration tests cover:
	- publish block/success policy behavior,
	- provenance appendix presence,
	- RBAC critical-path boundaries for draft/publish flows,
	- deterministic PDF export hashing,
	- audit event emission for publish success/failure paths.
- Web E2E tests cover:
	- publish + snapshot PDF export happy path,
	- publish policy-block failure path,
	- unauthorized/non-owner publish/export access boundaries,
	- deterministic PDF export smoke hash check,
	- full in-browser draft editor journey (`/drafts`) including create/edit/publish and reader transition (`/editions/{id}`).

### 21.6 Remaining Gaps (Next Slice)
- No blocking v0.3 gaps remain for publish/export/editor/viewer RFC coverage.
- Next-slice E2E expansion is focused on broader multi-role and mobile parity journeys.

### 21.7 Canonical PDF Engine Constraints (D-013)
- Canonical engine for v0.3 exports is ReportLab via `GET /api/edition-snapshots/{snapshot_id}/export/pdf`.
- Determinism baseline is byte/hash stability for repeated exports of the same snapshot under the same code and dependency versions.
- Deterministic mode requirement: PDF generation must use invariant serialization (`invariant=1`).
- Current export is MVP-grade: simple page flow and text blocks, not full typography parity with a future template-materialization renderer.
- Constraints and baseline expectations are documented in `PDF_EXPORT_BASELINE.md`.

### 21.8 Draft Preview Payload Example (Metadata Template Key)
- Endpoint: `POST /api/draft-books/{draft_id}/preview/render`
- Purpose: assign a level template through metadata (`verse_template_key`) for custom rendering.

```json
{
	"snapshot_data": {
		"front": [],
		"body": [
			{
				"node_id": 101,
				"source_book_id": 12,
				"title": "Verse 2.47",
				"level_name": "verse"
			}
		],
		"back": [],
		"metadata_bindings": {
			"levels": {
				"verse": {
					"verse_template_key": "default.body.verse.content_item.v1"
				}
			}
		}
	}
}
```

- Effective template resolution for this flow is: explicit node template binding > metadata template key properties (`<section>_<level>_template_key`, `<level>_template_key`, `<section>_template_key`, `render_template_key`) > level template binding > book template binding > global fallback.
