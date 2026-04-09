# Refactor Roadmap

**Goal:** Incrementally improve code organization to reduce friction and regression risk before future feature work.

**Regression Safety:** All three PDF export regression tests (`test_book_pdf_export_honors_visibility_and_returns_pdf_headers`, `test_book_pdf_export_with_payload_is_deterministic_for_same_scope`, `book PDF export dialog sends advanced settings through the scriptures proxy`) are in place and passing. Safe to refactor.

---

## Phase 1: Split Scriptures Page into Logical Components

**Current State:** `web/src/app/scriptures/page.tsx` is 17.5K lines; handles browse, edit, preview, PDF export, multimedia, templates, metadata in a single file.

**Target:** Extract into purpose-driven subcomponents while keeping shared state management intact.

### Component Structure (Proposed)

```
web/src/app/scriptures/
├── page.tsx                          (root, ~2K lines; state & layout only)
├── hooks/
│   ├── useScripturesBrowse.ts       (browse state & handlers)
│   ├── useScripturesEdit.ts         (edit state & handlers)
│   ├── useScripturesPreview.ts      (preview rendering & pagination)
│   ├── useScripturesPdfExport.ts    (PDF dialog state & download handlers)
│   ├── useScripturesMultimedia.ts   (media manager state & handlers)
│   └── useScripturesMetadata.ts     (metadata editing & bindings)
└── components/
    ├── BrowseSection.tsx            (browse UI & book tree)
    ├── EditSection.tsx              (edit form & node content)
    ├── PreviewSection.tsx           (preview rendering & scrolling)
    ├── PdfExportDialog.tsx          (PDF export modal, settings, submit)
    ├── MultimediaPanel.tsx          (media manager UI)
    └── MetadataEditor.tsx           (metadata form & validation)
```

### Steps

1. **Extract browse state/handlers** → `useScripturesBrowse.ts` hook
   - Book selection, tree navigation, section switching
   - Minimal surface area; low risk

2. **Extract edit state/handlers** → `useScripturesEdit.ts` hook
   - Node creation, content editing, form state
   - Medium scope; test with existing node edit tests

3. **Extract preview state/handlers** → `useScripturesPreview.ts` hook
   - Preview rendering, pagination, scope toggles
   - ~1K lines; high value for readability

4. **Extract PDF export state/handlers** → `useScripturesPdfExport.ts` hook
   - Dialog visibility, settings, download handler
   - Protected by new regression tests; safe refactor

5. **Extract multimedia state/handlers** → `useScripturesMultimedia.ts` hook
   - Media manager state, attachment logic

6. **Extract metadata state/handlers** → `useScripturesMetadata.ts` hook
   - Metadata editing, template binding display

7. **Create component layer** wrapping each hook
   - `BrowseSection.tsx`, `EditSection.tsx`, `PreviewSection.tsx`, `PdfExportDialog.tsx`, etc.
   - Reduce page.tsx to state orchestration only

8. **Update tests** to target new hooks/components where relevant
   - Focus on Playwright scriptures tests

### Risk & Validation

- **Risk:** High JSX complexity; easy to break rendering
- **Mitigation:** Playwright tests (especially new PDF export test) will catch rendering regressions immediately
- **Validation:** Run full scriptures Playwright suite after each component extraction

---

## Phase 2: Extract PDF Export Logic from `api/draft_books.py`

**Current State:** `api/draft_books.py` (4.7K lines) mixes drafts, snapshots, publishing, and PDF export.

**Target:** Create dedicated `api/pdf_export.py` with clean separation of concerns.

### New Module: `api/pdf_export.py`

```python
# api/pdf_export.py (new file, ~600 lines)

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from models.book import Book
from models.content_node import ContentNode
from models.user import User
from models.schemas import BookPreviewRenderRequest
from api.draft_books import (
    _book_is_visible_to_user,
    _ordered_nodes_for_preview_scope,
    _book_title_for_preview,
    _apply_assignment_template_bindings,
    _apply_session_template_bindings,
    _apply_template_metadata,
    _materialize_snapshot_render_sections,
    _extract_render_settings,
    _generate_rendered_pdf,
)

router = APIRouter()

@router.get("/books/{book_id}/export/pdf")
def export_book_pdf(
    book_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Export entire book to PDF."""
    return _export_book_pdf_with_options(
        book_id=book_id,
        payload=BookPreviewRenderRequest(),
        current_user=current_user,
        db=db,
    )

@router.post("/books/{book_id}/export/pdf")
def export_book_pdf_with_payload(
    book_id: int,
    payload: BookPreviewRenderRequest,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Export book (or node scope) to PDF with custom render settings."""
    return _export_book_pdf_with_options(
        book_id=book_id,
        payload=payload,
        current_user=current_user,
        db=db,
    )

@router.get("/edition-snapshots/{snapshot_id}/export/pdf")
def export_snapshot_pdf(
    snapshot_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Export published snapshot to PDF."""
    # [existing snapshot export logic moved here]
    pass

# Internal helpers (moved from draft_books.py)
def _export_book_pdf_with_options(
    book_id: int,
    payload: BookPreviewRenderRequest,
    current_user: User | None,
    db: Session,
) -> Response:
    # [existing implementation, ~250 lines]
    pass

def _export_snapshot_pdf_with_options(
    snapshot_id: int,
    payload: BookPreviewRenderRequest,
    current_user: User | None,
    db: Session,
) -> Response:
    # [existing implementation, ~200 lines]
    pass
```

### Steps

1. **Create `api/pdf_export.py`** with module docstring and imports

2. **Move book export routes** to new module
   - `GET /books/{book_id}/export/pdf`
   - `POST /books/{book_id}/export/pdf`
   - Move `_export_book_pdf_with_options` helper

3. **Move snapshot export routes** to new module
   - `GET /edition-snapshots/{snapshot_id}/export/pdf`
   - Move `_export_snapshot_pdf_with_options` helper
   - Move deterministic PDF generation logic

4. **Extract shared render helpers** as needed
   - Keep in `api/draft_books.py` if used by both modules
   - Or move to a shared `api/pdf_rendering.py` if large enough
   - Consider: `_materialize_snapshot_render_sections`, `_extract_render_settings`, `_generate_rendered_pdf`

5. **Register router in `main.py`**
   ```python
   from api import pdf_export
   app.include_router(pdf_export.router, tags=["pdf"])
   ```

6. **Remove routes from `api/draft_books.py`**
   - Keep helper functions if shared
   - Reduce file from 4.7K to ~3.K lines

7. **Update tests** to import from new module if needed
   - Existing tests should work without change (routes unchanged)
   - New tests already in place and passing

### Risk & Validation

- **Risk:** Routes re-registration errors; shared helper imports
- **Mitigation:** Tests pass immediately; FastAPI startup will fail if router not registered
- **Validation:** 
  - `pytest tests/test_phase1_backend_integration.py -k 'pdf_export'` passes
  - `npm run test:e2e -- --grep 'PDF export'` passes
  - Manual spot check: POST `/api/books/{id}/export/pdf` returns valid PDF

---

## Phase 3: Break Up Backend Integration Test File by Feature Area

**Current State:** `tests/test_phase1_backend_integration.py` is 6.7K lines; every feature area mixed together.

**Target:** Split into focused test modules aligned with backend modules.

### New Test Structure

```
tests/
├── test_phase1_backend_integration.py (REFACTORED, ~500 lines; helpers + orchestration only)
├── test_content_books_api.py         (NEW, ~1300 lines)
│   ├── Book lifecycle (create, read, update, publish)
│   ├── Visibility/ownership (private/public, sharing)
│   ├── Validation (required fields, constraints)
├── test_content_nodes_api.py         (NEW, ~1500 lines)
│   ├── Node CRUD operations
│   ├── Hierarchy operations (parent/child, insert_after)
│   ├── Content data validation
├── test_content_schemas_api.py       (NEW, ~800 lines)
│   ├── Schema lifecycle
│   ├── Schema validation
├── test_draft_books_api.py           (NEW, ~1800 lines)
│   ├── Draft creation/update/deletion
│   ├── License policy
│   ├── Draft snapshots
├── test_pdf_export_api.py            (NEW, ~600 lines)
│   ├── Book PDF export (routes separated in Phase 2)
│   ├── Snapshot PDF export
│   ├── Visibility/access control
│   ├── Determinism
│   ├── Settings payloads
├── test_search_api.py                (NEW, ~600 lines)
│   ├── Search query handling
│   ├── Result filtering
├── test_metadata_api.py              (NEW, ~600 lines)
│   ├── Metadata property system
│   ├── Bindings and templates
├── helpers/
│   ├── __init__.py
│   ├── auth.py                       (_register_and_login, _register_and_login_as_admin)
│   ├── builders.py                   (_create_minimal_book_with_exportable_content, similar factories)
│   └── fixtures.py                   (shared test data, schemas)
```

### Steps

1. **Create `tests/helpers/` package**
   - Move `_register_and_login`, `_register_and_login_as_admin` → `helpers/auth.py`
   - Move `_create_minimal_book_with_exportable_content` → `helpers/builders.py`
   - Create `helpers/fixtures.py` for reusable test schemas/data

2. **Create `tests/test_content_books_api.py`** (~1300 lines)
   - Extract all book-related tests from integration file
   - Use shared helpers
   - Include visibility tests (already partially done)

3. **Create `tests/test_content_nodes_api.py`** (~1500 lines)
   - Extract all node CRUD tests
   - Extract hierarchy tests (parent/child, insert_after)
   - Content data validation tests

4. **Create `tests/test_content_schemas_api.py`** (~800 lines)
   - Schema lifecycle and validation tests

5. **Create `tests/test_draft_books_api.py`** (~1800 lines)
   - Draft CRUD tests
   - License policy tests
   - Snapshot lifecycle tests

6. **Create `tests/test_pdf_export_api.py`** (~600 lines)
   - Move existing PDF export tests here (already separated by feature)
   - Book PDF tests (visibility, determinism, payloads)
   - Snapshot PDF tests

7. **Create `tests/test_search_api.py`** (~600 lines)
   - Search functionality tests

8. **Create `tests/test_metadata_api.py`** (~600 lines)
   - Metadata system tests

9. **Trim original file** to bare essentials
   - Keep only helpers, shared fixtures, orchestration
   - ~500 lines max

10. **Update imports** across new test files
    - Import from `tests.helpers`
    - Relative imports for pytest fixtures

### Risk & Validation

- **Risk:** Pytest fixture discovery; circular imports in helpers
- **Mitigation:** Keep helpers as simple functions; use conftest.py for fixtures
- **Validation:**
  - `pytest tests/test_content_books_api.py -v` passes individually
  - `pytest tests/ -v` passes as suite
  - No test changes in behavior; only location changes

---

## Phase 4: Separate Content Routing by Domain

**Current State:** `api/content.py` is 5.7K lines; handles books, nodes, schemas, imports, all mixed.

**Target:** Split into focused routers aligned with domain model.

### New Module Structure

```
api/
├── content.py (REFACTORED, ~1500 lines)
│   ├── Shared helpers (visibility, ownership, validation)
│   ├── Import router (PDF importer, JSON importer registration)
├── content_books.py (NEW, ~1200 lines)
│   ├── Book routes: POST, GET, PATCH, DELETE
│   ├── Book visibility/sharing
│   ├── Book tree retrieval
├── content_nodes.py (NEW, ~1500 lines)
│   ├── Node routes: POST, GET, PATCH, DELETE
│   ├── Node hierarchy operations (parent/child, insert_after)
│   ├── Node content management
├── content_schemas.py (NEW, ~800 lines)
│   ├── Schema routes: POST, GET, PATCH, DELETE
│   ├── Schema validation
├── import_handlers.py (REFACTORED, ~900 lines)
│   ├── Unified JSON import coordinator
│   ├── PDF import handler
│   ├── Append logic
```

### Steps

1. **Create `api/content_books.py`**
   - Move book creation, read, update, delete routes
   - Move book visibility/sharing logic
   - Move `_book_is_visible_to_user`, `_book_owner_id`, `_book_visibility` helpers
   - ~1200 lines

2. **Create `api/content_nodes.py`**
   - Move node CRUD routes
   - Move hierarchy operations (parent/child, insert_after)
   - Move `create_node` function
   - Keep node validation helpers
   - ~1500 lines

3. **Create `api/content_schemas.py`**
   - Move schema routes
   - Move schema validation
   - ~800 lines

4. **Refactor `api/content.py`**
   - Keep only shared helpers (generic validation, error handling)
   - Keep import coordinator logic
   - Import and delegate to sub-routers
   - ~1500 lines

5. **Create `api/import_handlers.py`** (or rename existing import logic)
   - Unified coordinator for JSON and PDF imports
   - Append logic
   - License policy checking
   - ~900 lines

6. **Register all routers in `main.py`**
   ```python
   from api import content, content_books, content_nodes, content_schemas
   app.include_router(content.router, tags=["content-import"])
   app.include_router(content_books.router, tags=["books"])
   app.include_router(content_nodes.router, tags=["nodes"])
   app.include_router(content_schemas.router, tags=["schemas"])
   ```

7. **Update all tests** to work with new module structure
   - Tests don't change; routes unchanged
   - Import paths may update if tests import internal helpers

8. **Remove old routes** from `api/content.py`

### Risk & Validation

- **Risk:** Circular imports between sub-modules; breaking helper dependencies
- **Mitigation:** Keep shared helpers in root `content.py`; sub-modules import from there
- **Validation:**
  - FastAPI startup must succeed
  - `pytest tests/test_content_books_api.py` passes
  - `pytest tests/test_content_nodes_api.py` passes
  - Full test suite passes
  - Manual: POST `/api/content/books`, GET `/api/content/books/{id}`, etc. work

---

## Execution Plan & Timeline

### Week 1: Phase 1 (Scriptures Page Split)
- Commit 1: Extract browse hooks & components
- Commit 2: Extract edit hooks & components
- Commit 3: Extract preview & PDF export hooks
- Commit 4: Complete file reduction; all tests passing

### Week 2: Phase 2 (PDF Export Extraction)
- Commit 1: Create `api/pdf_export.py`; move book export routes
- Commit 2: Move snapshot export routes; register in main.py
- Commit 3: Update tests; validate all PDF tests pass

### Week 3: Phase 3 (Test File Split)
- Commit 1: Create `tests/helpers/` package; move auth utilities
- Commit 2: Create `test_content_books_api.py`, `test_content_nodes_api.py`
- Commit 3: Create remaining test modules
- Commit 4: Trim original integration file; validate suite passes

### Week 4: Phase 4 (Content Routing Separation)
- Commit 1: Create `api/content_books.py`, `api/content_nodes.py`
- Commit 2: Create `api/content_schemas.py`; refactor root content.py
- Commit 3: Register routers; update main.py
- Commit 4: Validate all tests pass; end-to-end verification

### Success Criteria

After all four phases:
- Single-responsibility files (no ~5K+ monster files)
- Test suite is organized by feature area
- All existing tests pass without modification
- PDF export regression tests still passing
- Code readability improved measurably
- Ready for feature work without navigation friction

---

## Rollback Plan

Each phase can be rolled back independently:
- **Phase 1 rollback:** Revert component extractions; keep original page.tsx
- **Phase 2 rollback:** Move routes back to draft_books.py; remove pdf_export.py
- **Phase 3 rollback:** Consolidate test files; remove helpers/ package
- **Phase 4 rollback:** Move routes back to content.py; remove sub-modules

---

## Notes

- All changes preserve public API surface; no endpoint changes
- Regression tests provide confidence during refactors
- Each phase can be reviewed/merged independently
- No new features land during refactoring; focus on structure only
