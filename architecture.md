# Scriptle.org — Architecture Document

**Version:** 1.0  
**Date:** May 2, 2026  
**Audience:** Engineering Team  
**Status:** Living document — reflects current implementation and planned/aspirational state (clearly marked)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Model](#2-data-model)
3. [User System](#3-user-system)
4. [Core Features](#4-core-features)
5. [Advanced Features](#5-advanced-features)
6. [Technical Stack](#6-technical-stack)
7. [Database Schema](#7-database-schema)
8. [API Structure](#8-api-structure)
9. [Current Limitations & TODOs](#9-current-limitations--todos)

---

## 1. System Overview

### What is Scriptle.org?

Scriptle.org is a modern web platform for exploring, contributing to, and publishing curated editions of Hindu scriptures and other sacred texts. It provides an interactive, hierarchical scripture browser alongside tools for assembling multi-source content into polished, export-ready books.

The platform serves two primary audiences:

- **Readers / Scholars** — Browse and search any scripture in Sanskrit, transliteration, and multiple translations. Navigate by book, chapter, and verse from any device. Share direct links to specific verses.
- **Editors / Publishers** — Curate content from the library into custom compilations. Attach templates, commentary, and metadata. Export publication-ready PDFs. Track provenance and licensing for every included item.

### Core Purpose and Vision

The platform's vision (from DESIGN_RFC) is that every Hindu text should be:

- **Discoverable** — Full-text search across all scriptures, with Sanskrit + transliteration + translation indexing.
- **Citable** — Every node (verse, chapter, section) has a stable URL and provenance record.
- **Composable** — Editors can search, pick, and assemble content from multiple sources into a new structured book, without copying out-of-context.
- **Renderable** — Output quality is template-driven and export-ready (PDF, web, print profiles).
- **Auditable** — Every included item carries provenance and licensing context (license type, source version, inserted by).

### Current Status

- **Phase 1 complete**: Scripture browser, user auth, basket/cart, draft books, metadata system skeleton, PDF export, template system, commentary registry.
- **In-flight**: Metadata property system (CRUD API done; frontend form generation done; Liquid integration active), template assignment system (multi-level resolution).
- **Aspirational (Phase 2+)**: Full visual WYSIWYG template builder, marketplace-style licensing contracts, AI-assisted content generation, advanced rendering profiles (RTL, print-A4, PDF-book).

---

## 2. Data Model

### 2.1 Scripture Schema (Structure Template)

A `ScriptureSchema` defines the level hierarchy for a category of text. It is a reusable template; many books may share the same schema.

```
scripture_schemas
├── id
├── name          -- e.g., "Verse Structure", "5-Level"
├── description
├── levels        -- JSONB array  e.g., ["Kanda","Sarga","Shloka"]
└── level_template_defaults  -- JSONB: default rendering hints per level
```

**Built-in schemas seeded at bootstrap:**

| Name    | Levels                                              |
|---------|-----------------------------------------------------|
| Flat    | `["Entry"]`                                         |
| 2-Level | `["Book", "Entry"]`                                 |
| 3-Level | `["Book", "Section", "Entry"]`                      |
| 4-Level | `["Book", "Part", "Section", "Entry"]`              |
| 5-Level | `["Book", "Part", "Chapter", "Section", "Entry"]`   |

Custom schemas (e.g., `["Kanda","Adhyaya","Shloka"]`) can be created by editors.

### 2.2 Book

A `Book` is an instance of a scripture text, bound to a schema. Books are the primary organizational unit.

```
books
├── id
├── schema_id                -- FK → scripture_schemas
├── book_name                -- e.g., "Bhagavad Gita"
├── book_code                -- short unique code, e.g., "BG"
├── language_primary         -- e.g., "sanskrit"
├── metadata (JSONB)         -- free-form: title_english, title_sanskrit, author,
│                               status, visibility, owner_id, thumbnail_url, etc.
├── level_name_overrides (JSONB)  -- per-book overrides for level display names
│                                    e.g., {"chapter": "Adhyaya", "verse": "Shloka"}
├── variant_authors (JSONB)  -- slug → author name map for translation/commentary variants
│                               e.g., {"swami_prabhupada": "A.C. Bhaktivedanta Swami"}
└── created_at
```

**Ownership** is tracked inside `metadata.owner_id` (the user who created the book). Books may be private or public, draft or published, controlled via `metadata.status` and `metadata.visibility`.

### 2.3 ContentNode (The Universal Node)

`ContentNode` is the single table representing every level of content — chapters, verses, sections, etc. — in a unified self-referential hierarchy. The level name (e.g., "Adhyaya", "Shloka") determines what kind of node it is semantically.

```
content_nodes
├── id
├── book_id              -- FK → books (CASCADE delete)
├── parent_node_id       -- FK → content_nodes (CASCADE delete); NULL for root nodes
├── referenced_node_id   -- FK → content_nodes (SET NULL); non-null = reference node (see §4.3)
├── level_name           -- e.g., "Chapter", "Verse", "Shloka"
├── level_order          -- depth in hierarchy (root = 1)
├── sequence_number      -- ordering within parent (e.g., "1", "2", "1.34")
│
├── title_sanskrit       -- multilingual title fields (TEXT)
├── title_transliteration
├── title_english
├── title_hindi
├── title_tamil
│
├── has_content          -- BOOLEAN: whether content_data is populated
├── content_data (JSONB) -- actual content (see §2.4)
├── summary_data (JSONB) -- condensed version of content_data for previews
├── metadata_json (JSONB)-- node-level extended metadata
│
├── source_attribution   -- free-text attribution string
├── license_type         -- default "CC-BY-SA-4.0"
├── original_source_url
├── tags (JSONB)         -- array of tag strings
│
├── status               -- ENUM: draft | published | archived
├── visibility           -- ENUM: private | draft | published | archived
├── language_code        -- ISO 639-1 code, default "en"
├── collaborators (JSONB)-- [{user_id, role}, ...]
├── version_history (JSONB)-- [{version, edited_by, edited_at, reason}, ...]
├── search_vector (TSVECTOR)-- maintained for FTS
├── created_by, last_modified_by  -- FK → users
└── created_at, updated_at
```

### 2.4 Content Data Structure (JSONB)

The `content_data` JSONB column stores the actual text content of a node. The conventional shape is:

```json
{
  "basic": {
    "sanskrit":        "धर्मक्षेत्रे कुरुक्षेत्रे...",
    "transliteration": "dharma-kṣetre kuru-kṣetre...",
    "text":            "plain fallback text"
  },
  "translations": {
    "english": "On the battlefield of Kurukshetra...",
    "hindi":   "धर्म के क्षेत्र कुरुक्षेत्र में...",
    "telugu":  "...",
    "tamil":   "..."
  },
  "translation_variants": [
    {
      "slug":        "swami_prabhupada",
      "author_name": "A.C. Bhaktivedanta Swami",
      "text":        "On the battlefield of Kurukshetra..."
    }
  ],
  "commentary_variants": [
    {
      "slug":        "adi_shankaracharya",
      "author_name": "Adi Shankaracharya",
      "text":        "..."
    }
  ],
  "word_meanings": [
    { "word": "dharma-kṣetre", "meaning": "in the place of dharma" }
  ]
}
```

The `summary_data` field mirrors this shape but contains condensed or preview-level content. When both exist, `content_data` wins during rendering.

### 2.5 Entity Relationships

```
users
  │
  ├──< books (owner via metadata.owner_id)
  │      │
  │      ├── scripture_schemas (schema_id)
  │      ├──< book_shares  (shared_with_user_id, permission: viewer|contributor|editor)
  │      └──< content_nodes (book_id)
  │               │
  │               ├── content_nodes (parent_node_id — self-referential tree)
  │               ├── content_nodes (referenced_node_id — clone/reference link)
  │               ├──< media_files (node_id)
  │               └──< provenance_records (target_node_id)
  │
  ├──< collection_carts (owner_id)
  │      └──< collection_cart_items (cart_id → item_id = content_node.id)
  │
  ├──< draft_books (owner_id)
  │      └──< edition_snapshots (draft_book_id)
  │
  ├──< compilations (creator_id)
  │
  └── user_preferences (user_id)

commentary_authors
  └──< commentary_works (author_id)
         └──< commentary_entries (work_id → node_id = content_node.id)

property_definitions
  └── category_properties
        └── categories
              ├── category_parents (DAG hierarchy)
              └──< metadata_bindings (entity_type/entity_id at book|level|node scope)

render_templates
  └──< render_template_assignments (template_id → book_id/schema_id/level)
```

---

## 3. User System

### 3.1 User Roles

The system uses a hybrid model: a global `role` string plus a granular `permissions` JSONB object. Resource-level ownership overlays both.

| Role        | Description                                                                 |
|-------------|-----------------------------------------------------------------------------|
| Anonymous   | Unauthenticated. Read-only access to all public content.                    |
| Viewer      | Registered user. Intended as read-only; currently granted `can_contribute` in backend defaults (known inconsistency — see §9). |
| Contributor | Can create/edit own content nodes and books.                               |
| Editor      | Full edit access across books (subject to book-level permissions).         |
| Moderator   | Has `can_moderate: true`; distinct endpoint guards not yet implemented (see §9). |
| Admin       | Full platform access, user management, schema/template administration.     |

### 3.2 Permission Matrix

| Permission        | Anonymous | Viewer | Contributor | Editor | Moderator | Admin |
|-------------------|:---------:|:------:|:-----------:|:------:|:---------:|:-----:|
| `can_view`        | implicit  | ✓      | ✓           | ✓      | ✓         | ✓     |
| `can_contribute`  | —         | ✓*     | ✓           | ✓      | ✓         | ✓     |
| `can_import`      | —         | —      | ✓           | ✓      | ✓         | ✓     |
| `can_edit`        | —         | —      | —           | ✓      | ✓         | ✓     |
| `can_moderate`    | —         | —      | —           | —      | ✓         | ✓     |
| `can_admin`       | —         | —      | —           | —      | —         | ✓     |

> *Viewer has `can_contribute: true` in current backend defaults (`api/auth.py`) but `false` in the frontend admin role template. This is a known inconsistency pending resolution (§9).

### 3.3 Resource-Level Ownership

**Book owner** — tracked in `book.metadata.owner_id`. Owners can:
- Edit and delete their own private books (even without global `can_edit`)
- Publish/unpublish their own books
- Manage share invitations (`book_shares` table)
- Cannot delete a public book without first unpublishing it (unless admin)

**Draft book owner** — `draft_books.owner_id`. Draft CRUD is owner-scoped; no cross-user access without admin.

**Book access rank** (computed in `services/book_permissions.py`):
```
rank 0 = no access
rank 1 = viewer   (can read)
rank 2 = contributor/editor  (can write)
rank 3 = owner
```

Effective rank = `max(metadata_visibility_rank, share_permission_rank, ownership_rank)`.

### 3.4 Book Sharing

Books can be shared with other users at three permission levels via the `book_shares` table:
- `viewer` — read-only
- `contributor` — can add/edit content
- `editor` — full edit access

Shares are issued by owners (and admins) via email invitation (`POST /api/books/{id}/shares`).

### 3.5 Authentication System

The platform uses JWT-based stateless authentication delivered via HTTP-only cookies.

**Flow:**

```
1. POST /api/auth/register  →  creates user (role: "viewer"), optionally sends verification email
2. POST /api/auth/login     →  verifies credentials, sets access_token + refresh_token cookies
3. GET  /api/me             →  returns current user identity
4. POST /api/auth/refresh   →  exchanges refresh_token for new access_token
5. POST /api/auth/logout    →  clears cookies + invalidates session
```

**Tokens:**
- `access_token` — JWT, short-lived (~15 minutes), stored in HTTP-only cookie
- `refresh_token` — JWT, 30-day expiry, stored in HTTP-only cookie, hashed in `user_sessions` table

**Email verification:**
- Controlled by `EMAIL_VERIFICATION_REQUIRED` env var (defaults to `true` in production)
- Token stored as SHA-256 hash in `email_verification_tokens` table
- Resend and forgot-password flows supported

**Session storage:**
```
user_sessions
├── id
├── user_id
├── refresh_token  (hashed)
├── expires_at
└── created_at
```

---

## 4. Core Features

### 4.1 Basket / Cart System

The **Collection Cart** is a persistent, modeless shopping basket that users fill while browsing scripture content. It is the entry point into the book assembly workflow.

**How it works:**

```
Browse Scriptures → Add nodes to Basket → Basket Panel (floating widget)
                                               │
                               ┌───────────────┴──────────────┐
                               │                              │
                         Add to existing Book          Create Draft Book
                         (insert-references endpoint)  (POST /api/cart/me/create-draft)
```

**Key behaviors:**
- One cart per user (auto-created on first access)
- Items store: `item_id` (node ID), `item_type`, `source_book_id`, `order`, `item_metadata` (title, breadcrumb, book name for display)
- Items can be reordered (drag-and-drop in UI)
- Duplicate items are rejected (409 Conflict)
- Cart persists until manually cleared or converted to a draft
- License policy check runs automatically when basket is non-empty (`POST /api/content/license-policy-check`)

**BasketPanel UI** (`web/src/components/BasketPanel.tsx`):
- Draggable floating widget, bottom-right of viewport
- Expands to show item list with breadcrumbs
- Modes: "Add to existing book" (select or create) or "Create Draft from Basket"
- Insert mode toggle: `copy` (duplicates node content) or `reference` (links to original)
  - Copy mode requires `can_edit` or `can_admin`; all others default to reference mode

### 4.2 Book Generation from Basket

When a user creates a draft book from the cart, the system:

1. Groups cart items by source book
2. Builds `section_structure` JSONB:
   ```json
   {
     "front": [],
     "body": [
       { "source_book_id": 1, "source_scope": "book", "order": 1, "title": "Bhagavad Gita" },
       { "source_book_id": 2, "source_scope": "book", "order": 2, "title": "Ramayana Kanda 1" }
     ],
     "back": []
   }
   ```
3. Merges `variant_authors` from all source books (resolving slug collisions with per-book prefixes)
4. Stores `compilation_metadata` JSONB:
   ```json
   {
     "is_compilation": true,
     "source_books": [{"book_id": 1, "book_name": "...", "book_code": "BG"}],
     "merged_variant_authors": {"swami_prabhupada": "A.C. Bhaktivedanta Swami"},
     "slug_remapping": {"1": {"swami_prabhupada": "swami_prabhupada"}}
   }
   ```
5. Optionally clears cart after creation

### 4.3 Clone vs Reference System

When basket items are inserted into a book, the user chooses between two modes:

**Reference (default):**
- Creates a new `ContentNode` with `referenced_node_id` pointing to the original node
- `has_content = false` — no duplicate content stored
- Content is resolved at render time by following `referenced_node_id`
- Changes to the source node automatically propagate to all references
- A `ProvenanceRecord` is created capturing: source book, source node, license type, source version, inserted by

```sql
-- Reference node structure
INSERT INTO content_nodes (
  book_id, parent_node_id, referenced_node_id,
  level_name, level_order, sequence_number,
  title_sanskrit, title_english, ...  -- copied for display/search
  has_content = false,
  metadata_json = {"source_type": "library_reference", "draft_section": "body", ...}
)
```

**Copy (clone):**
- Creates a new `ContentNode` with `has_content = true` and full `content_data` copied
- Independent from source — edits to source do not affect the copy
- Requires `can_edit` or `can_admin` permission
- Also creates a `ProvenanceRecord` for audit trail

### 4.4 Multimedia Management

Media can be attached at the **node level** via two systems:

**`media_files`** — Direct node attachments (per-node):
```sql
media_files
├── id
├── node_id       -- FK → content_nodes
├── media_type    -- "audio" | "video" | "image"
├── url           -- file path or S3 URL
└── metadata JSONB  -- title, description, duration, dimensions, etc.
```

**`media_assets`** — Global media bank (platform-wide library):
```sql
media_assets
├── id
├── media_type
├── url
├── metadata JSONB
├── created_by    -- FK → users
└── created_at
```

Media assets can be attached to any node from the global bank. The media manager UI is accessible from the Scriptures browser. Files are served from `/media/` (local filesystem) or an S3-compatible bucket, depending on `MEDIA_STORAGE_BACKEND` env var.

**Supported media types:** image, audio, video

**Supported attachment points:** any `ContentNode` (any level — book, chapter, verse, etc.)

### 4.5 Multi-Language Support

The platform supports multilingual content at multiple layers:

**Node titles** — 5 dedicated columns: `title_sanskrit`, `title_transliteration`, `title_english`, `title_hindi`, `title_tamil`

**Node content** — `content_data.translations` JSONB map supports any ISO language code:
```json
{
  "english": "...",
  "hindi": "...",
  "telugu": "...",
  "kannada": "...",
  "tamil": "...",
  "malayalam": "..."
}
```

**User preferences** — Each user stores `source_language` and `transliteration_script` (devanagari, IAST, ITRANS, Harvard-Kyoto, etc.) in `user_preferences`. Anonymous preferences are session-only.

**Transliteration** — The backend service (`services/transliteration.py`) converts between scripts at query time:
- Devanagari detection (`contains_devanagari`)
- Latin → Devanagari conversion for search
- Query variant expansion (`get_latin_query_variants`) for fuzzy matching across scripts
- Client-side: `web/src/lib/indicScript.ts` handles IAST → display script rendering

**Rendering direction** — LTR/RTL is supported via metadata properties (planned; `direction` property in metadata system).

### 4.6 PDF Export

PDF export is template-driven and deterministic. It supports both live books and immutable edition snapshots.

**Export endpoints:**
- `GET  /api/books/{id}/export/pdf` — export entire book with defaults
- `POST /api/books/{id}/export/pdf` — export with custom render settings (payload)
- `GET  /api/edition-snapshots/{id}/export/pdf` — export a locked snapshot
- `POST /api/edition-snapshots/{id}/export/pdf` — export snapshot with custom settings

**Render pipeline:**
```
1. Resolve metadata (global → book → level → node precedence)
2. Resolve effective templates (template key resolution, see §5.1)
3. Materialize blocks (Liquid template render per node/section)
4. Apply language/script rules (transliteration, direction)
5. Generate PDF bytes (HTML → PDF via backend PDF engine)
6. Return as application/pdf with Content-Disposition header
```

**Render settings exposed to caller:**
- `selected_translation_languages` — which language columns to include
- `preview_show_titles`, `preview_show_labels`, `preview_show_details`
- `preview_transliteration_script` — output transliteration system
- `preview_word_meanings_display_mode` — inline | table | hide
- `pageBreakMode` — between_leaf | between_level
- `show_metadata` — show debug template key in output

**Determinism:** Each edition snapshot stores a SHA-256 `snapshot_fingerprint` computed from content, template, and render bases. Same snapshot + same render settings always produces byte-identical PDF.

---

## 5. Advanced Features

### 5.1 Template System

The template system controls how content is rendered into readable output (HTML/PDF). It uses **Liquid templating** (via the `liquid` Python library).

#### Template Resolution

For each content block, the renderer resolves a `template_key` using a precedence chain:

```
1. Explicit node template binding (RenderTemplateAssignment for this node)
2. Metadata template key properties (resolved from metadata bindings):
   - <section>_<level>_template_key   e.g., "body_verse_template_key"
   - <level>_template_key             e.g., "verse_template_key"
   - <section>_template_key           e.g., "body_template_key"
   - render_template_key              (global override)
3. Level template binding (RenderTemplateAssignment for this level type)
4. Book template binding (RenderTemplateAssignment for this book)
5. Built-in default template (by level name or section)
```

#### Template Context

Every Liquid template receives a context object:

```liquid
{{ metadata.sanskrit }}          -- sanskrit text
{{ metadata.transliteration }}   -- transliteration
{{ metadata.english }}           -- English translation
{{ metadata.title }}             -- node title
{{ metadata.level_name }}        -- e.g., "Verse"
{{ metadata.sequence_number }}   -- e.g., "47"
{{ metadata.is_transliterable }} -- from metadata property system
{{ metadata.<custom_property> }} -- any resolved metadata property
```

**Translation variants and commentary** are available as arrays and iterable in templates.

#### Example Template (Verse)

```liquid
{% if metadata.sanskrit %}Sanskrit: {{ metadata.sanskrit }}
{% endif %}{% if metadata.transliteration %}Transliteration: {{ metadata.transliteration }}
{% endif %}{% if metadata.english %}English: {{ metadata.english }}
{% endif %}
```

#### Template Library

Templates are stored in `render_templates` table with:
- `name`, `description`
- `target_schema_id`, `target_level` — what they apply to
- `liquid_template` — the Liquid source string
- `visibility` — `private` | `published`
- `is_system` — system templates cannot be deleted
- `is_active`
- `owner_id`

Template assignments (`render_template_assignments`) bind a template to a specific book, schema, or level, with an optional `scope_key` for finer targeting. Versioning is tracked in `render_template_versions`.

#### Custom Templates (Planned)

The `/templates` page (`web/src/app/templates/page.tsx`) provides a UI for creating and managing personal Liquid templates with a live preview editor. System templates are visible to all; private templates are user-scoped.

### 5.2 Metadata Property System

A schema-governed metadata system that replaces free-form JSONB with typed, validated, inheritable properties.

#### Property Definitions

```sql
property_definitions
├── internal_name   -- stable key (e.g., "is_transliterable", "source_language")
├── display_name    -- UI label
├── data_type       -- ENUM: text | boolean | number | dropdown | date | datetime
├── description
├── default_value   -- JSONB
├── is_required     -- BOOLEAN
├── is_system       -- cannot delete
├── dropdown_options -- VARCHAR[] (for data_type=dropdown)
└── is_deprecated
```

#### Categories (Property Groups)

```sql
categories
├── name              -- unique, e.g., "sanskrit_verse", "bhagavad_gita_verse"
├── applicable_scopes -- which entity types this category can bind to
├── version           -- for snapshot traceability
├── is_published      -- published categories are immutable
└── is_deprecated
```

Categories support **multiple inheritance** via `category_parents` (DAG). Child properties override parent properties on key conflict.

**Example hierarchy:**
```
base_verse
  └── sanskrit_verse  (inherits + adds diacritical_system, meter_type)
        └── bhagavad_gita_verse  (inherits + adds chapter_number, verse_number)
```

#### Metadata Bindings

Properties are bound to entities at four scopes, stored in `metadata_bindings`:

| scope_type | entity_type       | Meaning                             |
|------------|-------------------|-------------------------------------|
| `global`   | "global"          | Platform default for all content    |
| `book`     | "book"            | Applies to all nodes in a book      |
| `level`    | "level"           | Applies to all nodes at a given level |
| `node`     | "content_node"    | Applies to one specific node        |

#### Resolution Precedence

```
node-level override
  → node's category defaults
    → level override
      → level's category defaults
        → book override
          → book's category defaults
            → global override
              → global category defaults
                → property definition default
```

`unset_overrides` array explicitly removes an override at a scope, forcing fallback to next layer.

#### Liquid Integration

All resolved properties are injected into the template context as `metadata.<property_internal_name>`:

```liquid
{% if metadata.is_transliterable %}
  <p class="iast">{{ metadata.transliteration }}</p>
{% endif %}
<p lang="{{ metadata.source_language }}">{{ metadata.sanskrit }}</p>
```

### 5.3 Commentary Registry

A dedicated registry for managing scholarly commentaries separate from ad-hoc `commentary_variants` in `content_data`.

**Schema:**

```sql
commentary_authors  (id, name, bio, metadata, created_by)
commentary_works    (id, author_id, title, language, description, metadata)
commentary_entries  (id, work_id, node_id, content, language, metadata)
```

**Relationships:**
- `CommentaryAuthor` → many `CommentaryWork`s
- `CommentaryWork` → many `CommentaryEntry`s (each entry attached to a `ContentNode`)

**API endpoints** (under `/api/content`):
- `GET/POST/PATCH/DELETE /api/content/commentary/authors`
- `GET/POST/PATCH/DELETE /api/content/commentary/works`
- `GET/POST/PATCH/DELETE /api/content/commentary/entries`
- `GET /api/content/nodes/{id}/commentary` — all commentary entries for a node

This enables structured attribution of commentaries to specific authors and works, separate from the inline `commentary_variants` array in `content_data`.

### 5.4 Search and Explore

#### Search (`/api/search`)

Full-text search across all content nodes, with multi-script support.

**Query handling:**
1. Input is checked for Devanagari characters (`contains_devanagari`)
2. Latin queries are expanded to variant forms for cross-script matching (`get_latin_query_variants`)
3. Latin queries can be converted to Devanagari for Sanskrit matching (`latin_to_devanagari`)
4. PostgreSQL `TSVECTOR` GIN indexes are used for performance:
   - `idx_sanskrit_search` — `content_data->'basic'->>'sanskrit'`
   - `idx_transliteration_search` — `content_data->'basic'->>'transliteration'`
   - `idx_translation_search` — `content_data->'translations'->>'english'`

**Query parameters:**
- `q` — search string
- `book_id` — scope to a specific book
- `level_name` — filter by node level
- `has_content` — filter to nodes with actual text
- `use_full_text` — toggle between ILIKE substring vs FTS
- `limit`, `offset` — pagination (hard limit: 50 results, hard offset: 500)

**Response:**
```json
{
  "query": "dharma",
  "total": 42,
  "results": [
    {
      "node": { "id": 5, "book_id": 1, "level_name": "Verse", ... },
      "snippet": "...context around match..."
    }
  ]
}
```

Search queries are logged to `search_queries` for analytics (optional, user_id nullable for anonymous).

#### Explorer Page (`/explorer`)

The Explorer provides a pick-and-insert workflow for assembling drafts from multiple books.

**Scope options:**
- **All** — browse the full scripture library
- **Current Book** — restrict to one selected book
- **Selected Books** — multi-book filtered view
- **Custom** — (planned) saved search/filter presets

**Explorer → Draft sync:**
Picked nodes in the Explorer are synced to a linked `DraftBook` in real-time (`syncPickedNodesToDraft`). The draft is automatically created if none exists, or linked to an existing draft via URL parameter.

---

## 6. Technical Stack

### Frontend

| Component      | Technology                                                   |
|----------------|--------------------------------------------------------------|
| Framework      | Next.js 14+ (App Router)                                     |
| Build Tool     | Turbopack                                                    |
| Language       | TypeScript                                                   |
| Styling        | Tailwind CSS                                                 |
| State          | React hooks; URL-based state preservation (`?book=1&node=42`) |
| Icons          | Lucide React                                                 |
| Testing        | Playwright (E2E), Vitest (unit)                              |
| Port           | 3000                                                         |

**Key frontend pages:**

| Route             | Purpose                                       |
|-------------------|-----------------------------------------------|
| `/`               | Home: daily verse, search, featured books     |
| `/scriptures`     | Main scripture browser (17.5K line component) |
| `/explorer`       | Pick-and-insert composition UI                |
| `/drafts`         | Draft book management + metadata editor       |
| `/compilations`   | Compilation management                        |
| `/templates`      | Render template library + editor              |
| `/admin`          | User management (admin only)                  |
| `/contribute`     | Content contribution form                     |
| `/editions`       | Published edition snapshots                   |
| `/signin`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth flows |

**Frontend → Backend proxy:**  
The Next.js app proxies all `/api/*` requests to the FastAPI backend. This hides the backend origin from the browser and allows cookie-based auth to work cross-origin-free.

### Backend

| Component         | Technology                          |
|-------------------|-------------------------------------|
| Framework         | FastAPI (Python)                    |
| ORM               | SQLAlchemy                          |
| Validation        | Pydantic v2                         |
| Auth              | `python-jose` (JWT), bcrypt (hashing) |
| Templating        | `python-liquid` (Liquid templates)  |
| PDF Generation    | HTML → PDF engine (backend)         |
| Email             | SMTP via configurable email service |
| Compression       | GZipMiddleware (minimum 1000 bytes) |
| Media Storage     | Local filesystem or S3-compatible   |
| Port              | 8000                                |

### Database

| Component         | Technology                          |
|-------------------|-------------------------------------|
| Engine            | PostgreSQL 12+                      |
| Extensions        | `pg_trgm` (trigram search), `unaccent` |
| JSONB             | Used for flexible content storage   |
| Full-text search  | Native `TSVECTOR` + GIN indexes     |
| Custom ENUMs      | `content_status`, `content_visibility`, `compilation_status`, `draft_book_status`, `property_data_type`, `metadata_scope_type` |

### Environment Variables (Key)

| Variable                  | Purpose                                            |
|---------------------------|----------------------------------------------------|
| `DATABASE_URL`            | PostgreSQL connection string                       |
| `SECRET_KEY`              | JWT signing key                                    |
| `ACCESS_TOKEN_COOKIE`     | Cookie name for access token (default: `access_token`) |
| `REFRESH_TOKEN_COOKIE`    | Cookie name for refresh token                      |
| `COOKIE_SECURE`           | Set `true` in production (HTTPS only)              |
| `COOKIE_SAMESITE`         | SameSite policy (default: `lax`)                   |
| `EMAIL_VERIFICATION_REQUIRED` | Auto-`true` in production                     |
| `MEDIA_STORAGE_BACKEND`   | `local` or `s3`                                    |
| `MEDIA_DIR`               | Path to local media directory                      |
| `SEARCH_HARD_LIMIT`       | Max search results per query (default: 50)         |

---

## 7. Database Schema

### Complete Table Inventory

#### Identity & Auth

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `users`                    | User accounts: email, username, password hash, role, permissions (JSONB), OAuth fields |
| `user_sessions`            | Active refresh token sessions (hashed)                |
| `email_verification_tokens`| One-time tokens for email verification                |
| `user_preferences`         | Per-user display preferences (script, language, view density, preview toggles) |

#### Content

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `scripture_schemas`        | Reusable level hierarchy templates (e.g., `["Kanda","Adhyaya","Shloka"]`) |
| `books`                    | Scripture instances bound to a schema                 |
| `book_shares`              | Per-book access grants to other users (viewer/contributor/editor) |
| `content_nodes`            | Universal node table — chapters, verses, sections, entries — self-referential tree |

#### Media

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `media_files`              | Files directly attached to a specific content node    |
| `media_assets`             | Global media bank available platform-wide             |

#### Assembly & Publishing

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `collection_carts`         | User basket (one per user, auto-created)              |
| `collection_cart_items`    | Individual items in a basket (node_id, source_book_id, order, metadata) |
| `compilations`             | Legacy lightweight item collections (list of node refs) |
| `draft_books`              | Active book composition workspace (section_structure JSONB, compilation_metadata) |
| `edition_snapshots`        | Immutable published snapshots of a draft book (snapshot_data JSONB, fingerprint) |
| `provenance_records`       | Audit trail for every reference insert (source, license, version, inserted_by) |

#### Commentary

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `commentary_authors`       | Named commentary authors with bio/metadata            |
| `commentary_works`         | Commentary titles authored by commentary_authors      |
| `commentary_entries`       | Individual commentary entries attached to content nodes |

#### Metadata Property System

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `property_definitions`     | Typed property definitions (internal_name, data_type, default, required) |
| `categories`               | Named groupings of properties; supports DAG inheritance |
| `category_parents`         | Parent-child edges for category inheritance           |
| `category_properties`      | Properties included in a category (with override options) |
| `metadata_bindings`        | Binds a category + overrides to an entity at a given scope |

#### Template System

| Table                       | Description                                          |
|-----------------------------|------------------------------------------------------|
| `render_templates`          | Liquid template definitions (source, target level, visibility) |
| `render_template_versions`  | Version history of templates                         |
| `render_template_assignments`| Binds a template to book/schema/level/node          |

#### Analytics & Misc

| Table                      | Description                                           |
|----------------------------|-------------------------------------------------------|
| `contributions`            | User-submitted content awaiting review (payload JSONB, status: pending/approved/rejected) |
| `user_collections`         | Lightweight personal bookmarks (legacy; superseded by collection_carts) |
| `collection_items`         | Items in user_collections                             |
| `search_queries`           | Search analytics log                                  |
| `import_jobs`              | Background import job tracking (JSON/PDF/HTML importers) |

### Key Indexes

```sql
-- Content traversal
idx_content_nodes_book              ON content_nodes(book_id)
idx_content_nodes_parent            ON content_nodes(parent_node_id)
idx_content_nodes_book_parent       ON content_nodes(book_id, parent_node_id)
idx_content_nodes_book_level_order_id

-- Full-text search
idx_content_nodes_search_gin        ON content_nodes USING GIN(search_vector)
idx_sanskrit_search                 ON content_nodes USING GIN(to_tsvector('simple', content_data->'basic'->>'sanskrit'))
idx_transliteration_search          ON content_nodes USING GIN(to_tsvector('english', content_data->'basic'->>'transliteration'))
idx_translation_search              ON content_nodes USING GIN(to_tsvector('english', content_data->'translations'->>'english'))

-- JSONB
idx_content_nodes_metadata_gin      ON content_nodes USING GIN(metadata_json)
idx_content_nodes_tags_gin          ON content_nodes USING GIN(tags)

-- Provenance
idx_provenance_target_book_id       ON provenance_records(target_book_id)
idx_provenance_target_node_id       ON provenance_records(target_node_id)

-- Compilations (public published, most-recent first)
idx_compilations_public_published_created_at  (partial index WHERE is_public=true AND status='published')
```

---

## 8. API Structure

All routes are registered under the `/api` prefix in `main.py`. The Next.js frontend proxies `/api/*` to the FastAPI backend.

### 8.1 Auth (`/api/auth`)

| Method | Endpoint                        | Auth     | Description                              |
|--------|---------------------------------|----------|------------------------------------------|
| POST   | `/auth/register`                | None     | Create account; optionally sends verification email |
| POST   | `/auth/login`                   | None     | Authenticate; sets HTTP-only JWT cookies |
| POST   | `/auth/logout`                  | Optional | Clear cookies; invalidate session        |
| POST   | `/auth/refresh`                 | Cookie   | Exchange refresh_token for new access_token |
| POST   | `/auth/verify-email`            | None     | Verify email with one-time token         |
| POST   | `/auth/resend-verification`     | None     | Resend verification email                |
| POST   | `/auth/forgot-password`         | None     | Issue password reset token               |
| POST   | `/auth/reset-password`          | None     | Apply new password via reset token       |

### 8.2 Users (`/api/users`, `/api/me`)

| Method | Endpoint          | Auth           | Description                                |
|--------|-------------------|----------------|--------------------------------------------|
| GET    | `/me`             | Required       | Current user identity + permissions        |
| PATCH  | `/me`             | Required       | Update own username / full_name            |
| GET    | `/users`          | `can_admin`    | List all users                             |
| POST   | `/users`          | `can_admin`    | Admin-create user with explicit role       |
| PATCH  | `/users/{id}`     | `can_admin`    | Update user role, permissions, active status |
| DELETE | `/users/{id}`     | `can_admin`    | Delete user (subject to cascade rules)     |

### 8.3 Content & Books (`/api/content`, `/api/books`, `/api/schemas`)

**Scripture Schemas:**

| Method | Endpoint              | Auth            | Description                     |
|--------|-----------------------|-----------------|---------------------------------|
| GET    | `/schemas`            | Optional        | List all schemas                |
| POST   | `/schemas`            | `can_edit`      | Create custom schema            |
| GET    | `/schemas/{id}`       | Optional        | Get schema by ID                |
| PATCH  | `/schemas/{id}`       | `can_edit`      | Update schema                   |
| DELETE | `/schemas/{id}`       | `can_admin`     | Delete schema                   |

**Books:**

| Method | Endpoint                         | Auth             | Description                        |
|--------|----------------------------------|------------------|------------------------------------|
| GET    | `/books`                         | Optional         | List books (public + owned/shared) |
| POST   | `/books`                         | `can_contribute` | Create new book                    |
| GET    | `/books/{id}`                    | Optional         | Get book with schema               |
| PATCH  | `/books/{id}`                    | Owner/Edit       | Update book metadata               |
| DELETE | `/books/{id}`                    | Owner/Admin      | Delete book                        |
| GET    | `/books/{id}/tree`               | Optional         | Full node tree for a book          |
| POST   | `/books/{id}/import`             | `can_contribute` | Import book from JSON/PDF/HTML     |
| POST   | `/books/{id}/insert-references`  | Owner/Edit       | Insert basket items as references  |
| POST   | `/books/{id}/ownership-transfer` | Owner/Admin      | Transfer book ownership            |
| GET    | `/books/{id}/export/pdf`         | Optional         | Export book as PDF (GET, defaults) |
| POST   | `/books/{id}/export/pdf`         | Optional         | Export book as PDF (POST, options) |
| GET    | `/books/{id}/shares`             | Owner/Admin      | List shares for a book             |
| POST   | `/books/{id}/shares`             | Owner            | Create share invitation (by email) |
| PATCH  | `/books/{id}/shares/{share_id}`  | Owner            | Update share permission            |
| DELETE | `/books/{id}/shares/{share_id}`  | Owner            | Revoke share                       |

**Content Nodes:**

| Method | Endpoint                             | Auth             | Description                     |
|--------|--------------------------------------|------------------|---------------------------------|
| GET    | `/content/nodes/{id}`                | Optional         | Get node with content           |
| POST   | `/content/nodes`                     | `can_contribute` | Create content node             |
| PATCH  | `/content/nodes/{id}`                | Owner/Edit       | Update node                     |
| PATCH  | `/content/nodes/{id}/fields`         | Owner/Edit       | Patch specific content fields   |
| DELETE | `/content/nodes/{id}`                | Owner/Edit       | Delete node                     |
| GET    | `/content/nodes/{id}/commentary`     | Optional         | Commentary entries for a node   |
| POST   | `/content/license-policy-check`      | `can_contribute` | Check license policy for node set |

**Commentary:**

| Method | Endpoint                             | Auth             | Description                     |
|--------|--------------------------------------|------------------|---------------------------------|
| GET/POST/PATCH/DELETE | `/content/commentary/authors` | Various | CRUD for commentary authors |
| GET/POST/PATCH/DELETE | `/content/commentary/works`   | Various | CRUD for commentary works   |
| GET/POST/PATCH/DELETE | `/content/commentary/entries` | Various | CRUD for commentary entries |

**Other Content:**

| Method | Endpoint                             | Auth     | Description                      |
|--------|--------------------------------------|----------|----------------------------------|
| GET    | `/daily-verse`                       | None     | Date-seeded daily verse          |
| GET    | `/stats`                             | None     | Platform stats (books, nodes, users) |

#### Canonical HSP JSON (`hsp-book-json-v1`)

Scriptle uses HSP JSON as the canonical interchange format for import/export, pipelines, and batch migration tooling.

Top-level structure:

- `schema_version`: currently `hsp-book-json-v1`
- `exported_at`: UTC timestamp of export generation
- `source`: exporter/import metadata (app name, input source, format)
- `schema`: structural definition (`id`, `name`, `description`, `levels`)
- `book`: book-level metadata (`book_name`, `book_code`, `language_primary`, optional `variant_authors`, `metadata`)
- `nodes`: ordered node list where each node includes hierarchy and content payload

Canonical node shape includes:

- Hierarchy fields: `node_id`, `parent_node_id`, `referenced_node_id`, `level_name`, `level_order`, `sequence_number`
- Display titles: `title_sanskrit`, `title_transliteration`, `title_english`, `title_hindi`, `title_tamil`
- Content fields: `has_content`, `content_data`, `summary_data`
- Metadata and provenance fields: `metadata_json`, `source_attribution`, `license_type`, `original_source_url`, `tags`, `media_items`

This format is intentionally stable and machine-friendly so large books can be moved between environments without relying on HTTP endpoint timeouts.

### 8.4 Search (`/api/search`)

| Method | Endpoint   | Auth     | Description                                         |
|--------|------------|----------|-----------------------------------------------------|
| GET    | `/search`  | Optional | Full-text + ILIKE search with book/level/content filters |

**Query params:** `q`, `book_id`, `level_name`, `has_content`, `use_full_text`, `limit`, `offset`

### 8.5 Collection Cart (`/api/cart`)

| Method | Endpoint                    | Auth     | Description                               |
|--------|-----------------------------|----------|-------------------------------------------|
| GET    | `/cart/me`                  | Required | Get (or auto-create) current user's cart  |
| POST   | `/cart`                     | Required | Create a new named cart                   |
| PATCH  | `/cart/me`                  | Required | Update cart title/description             |
| DELETE | `/cart/me`                  | Required | Clear all items from cart                 |
| POST   | `/cart/me/compose-draft-body` | Required | Preview cart as draft section_structure |
| POST   | `/cart/me/create-draft`     | Required | Create draft book from cart               |
| POST   | `/cart/items`               | Required | Add item to cart                          |
| DELETE | `/cart/items/{id}`          | Required | Remove item from cart                     |
| POST   | `/cart/items/reorder`       | Required | Reorder cart items                        |

### 8.6 Draft Books (`/api/draft-books`)

| Method | Endpoint                                   | Auth     | Description                                     |
|--------|--------------------------------------------|----------|-------------------------------------------------|
| GET    | `/draft-books/my`                          | Required | List current user's drafts                      |
| POST   | `/draft-books`                             | Required | Create draft book                               |
| GET    | `/draft-books/{id}`                        | Required | Get draft with section_structure                |
| PATCH  | `/draft-books/{id}`                        | Owner    | Update title, description, section_structure    |
| DELETE | `/draft-books/{id}`                        | Owner    | Delete draft                                    |
| POST   | `/draft-books/{id}/snapshots`              | Owner    | Publish an immutable edition snapshot           |
| GET    | `/draft-books/{id}/snapshots`              | Owner    | List snapshots for a draft                      |
| POST   | `/draft-books/{id}/preview`                | Owner    | Render preview blocks (Liquid)                  |
| POST   | `/draft-books/{id}/metadata-binding`       | Owner    | Bind metadata category + property overrides     |
| GET    | `/draft-books/{id}/metadata-binding`       | Owner    | Get effective metadata for draft                |
| PATCH  | `/draft-books/{id}/metadata-binding`       | Owner    | Update metadata binding                         |
| GET    | `/edition-snapshots/{id}`                  | Optional | Get published snapshot                          |
| GET    | `/edition-snapshots/{id}/export/pdf`       | Optional | Export snapshot as PDF                          |
| POST   | `/edition-snapshots/{id}/export/pdf`       | Optional | Export snapshot as PDF with options             |

### 8.7 Compilations (`/api/compilations`)

| Method | Endpoint                    | Auth     | Description                          |
|--------|-----------------------------|----------|--------------------------------------|
| GET    | `/compilations`             | Required | List current user's compilations     |
| POST   | `/compilations`             | Required | Create compilation                   |
| GET    | `/compilations/public`      | None     | Browse published public compilations |
| GET    | `/compilations/{id}`        | Optional | Get single compilation               |
| PATCH  | `/compilations/{id}`        | Owner    | Update compilation                   |
| DELETE | `/compilations/{id}`        | Owner    | Delete compilation                   |

### 8.8 Templates (`/api/templates`)

| Method | Endpoint                              | Auth        | Description                             |
|--------|---------------------------------------|-------------|-----------------------------------------|
| GET    | `/templates`                          | Required    | List templates (owned + published system) |
| POST   | `/templates`                          | Required    | Create custom Liquid template           |
| GET    | `/templates/{id}`                     | Required    | Get template                            |
| PATCH  | `/templates/{id}`                     | Owner/Admin | Update template                         |
| DELETE | `/templates/{id}`                     | Owner/Admin | Delete template                         |
| GET    | `/templates/{id}/versions`            | Required    | Version history                         |
| POST   | `/templates/assignments`              | Owner/Admin | Assign template to book/schema/level    |
| GET    | `/templates/assignments`              | Required    | List assignments                        |
| DELETE | `/templates/assignments/{id}`         | Owner/Admin | Remove assignment                       |
| POST   | `/templates/resolve`                  | Required    | Resolve effective template for context  |

### 8.9 Metadata (`/api/metadata`)

| Method | Endpoint                                              | Auth        | Description                             |
|--------|-------------------------------------------------------|-------------|-----------------------------------------|
| GET    | `/metadata/property-definitions`                      | Required    | List all property definitions           |
| POST   | `/metadata/property-definitions`                      | `can_admin` | Create property definition              |
| PATCH  | `/metadata/property-definitions/{id}`                 | `can_admin` | Update property definition              |
| DELETE | `/metadata/property-definitions/{id}`                 | `can_admin` | Delete property (only if unused)        |
| GET    | `/metadata/categories`                                | Required    | List categories with hierarchy          |
| POST   | `/metadata/categories`                                | `can_admin` | Create category                         |
| GET    | `/metadata/categories/{id}/effective-properties`      | Required    | Resolved properties including inherited |
| PATCH  | `/metadata/categories/{id}`                           | `can_admin` | Update category (only if unpublished)   |
| POST   | `/metadata/categories/{id}/publish`                   | `can_admin` | Lock and publish category               |
| DELETE | `/metadata/categories/{id}`                           | `can_admin` | Delete (only if unpublished)            |

### 8.10 Preferences (`/api/preferences`)

| Method | Endpoint        | Auth     | Description                                    |
|--------|-----------------|----------|------------------------------------------------|
| GET    | `/preferences`  | Required | Get current user's display preferences         |
| PATCH  | `/preferences`  | Required | Update preferences (script, language, toggles) |

### 8.11 Email (`/api/email`)

| Method | Endpoint                   | Auth        | Description                          |
|--------|----------------------------|-------------|--------------------------------------|
| POST   | `/email/send-test`         | `can_admin` | Send test email for config validation |

### 8.12 Health

| Method | Endpoint   | Auth | Description                               |
|--------|------------|------|-------------------------------------------|
| GET    | `/health`  | None | Returns `{"status": "ok"}` + media config |

---

## 9. Current Limitations & TODOs

### 9.1 Known Inconsistencies (Require Decision)

**Viewer permission conflict:**
- `api/auth.py` `DEFAULT_PERMISSIONS` sets `can_contribute: true` for all newly registered users (role=viewer)
- `api/users.py` admin-create viewer role map also sets `can_contribute: true`
- Frontend admin panel role template (`web/src/app/admin/page.tsx`) sets `can_contribute: false` for viewer
- **Impact:** Viewers can currently access the `/contribute` flow and create books in backend
- **Resolution needed:** Decide canonical policy; align `DEFAULT_PERMISSIONS`, viewer role map, and frontend template

**Moderator role not distinct:**
- `can_moderate: true` is set in the moderator preset
- No backend routes are gated on `require_permission("can_moderate")` specifically
- Moderators currently behave identically to editors in most places
- **Resolution needed:** Define what moderation means (flag/review/hide/approve?) and wire specific endpoints

### 9.2 Incomplete Features

**Draft access gating:**
- Any authenticated user can create draft books currently
- If drafts should require `can_contribute`, this needs explicit enforcement at the draft create endpoint and UI

**Editor global delete policy:**
- Users with `can_edit` can currently delete books beyond their ownership
- Whether this is intentional (editors as global curators) or a gap (delete = owner/admin only) needs clarification

**`contributions` table:**
- The schema defines a `contributions` table (user submissions for review: pending/approved/rejected)
- No active API endpoints implement the review/approval workflow in Phase 1
- Contribution count (`users.contribution_count`, `users.approved_count`) and reputation scoring (`users.reputation_score`) are schema-ready but not actively maintained

**`user_collections` (legacy):**
- Superseded by `collection_carts` for the basket workflow
- Still in schema; no active UI; can be cleaned up

### 9.3 Out of Scope for Initial Launch (from DESIGN_RFC)

- **Full visual WYSIWYG template builder** — Current template editor is code-level Liquid source only
- **Marketplace-style external licensing contracts** — License is metadata only; no enforcement engine
- **AI auto-generation of full chapters** — No AI pipeline; manual content entry only
- **Automated index generation** — Index pages in PDF are manual placeholders

### 9.4 Technical Debt / Refactor Targets

**`web/src/app/scriptures/page.tsx` (17.5K lines):**
- Monolithic file handling browse, edit, preview, PDF export, multimedia, templates, metadata
- Planned decomposition (REFACTOR_ROADMAP Phase 1) into hooks + components:
  - `useScripturesBrowse`, `useScripturesEdit`, `useScripturesPreview`, `useScripturesPdfExport`, `useScripturesMultimedia`, `useScripturesMetadata`
  - `BrowseSection`, `EditSection`, `PreviewSection`, `PdfExportDialog`, `MultimediaPanel`, `MetadataEditor`

**`api/draft_books.py` (4.7K lines):**
- Mixes draft CRUD, snapshot publishing, preview rendering, and PDF export logic
- Planned decomposition (REFACTOR_ROADMAP Phase 2): Extract `api/pdf_export.py` for all PDF routes and rendering helpers

### 9.5 Planned / Aspirational (Phase 2+)

| Feature                        | Status        | Notes                                                     |
|--------------------------------|---------------|-----------------------------------------------------------|
| Visual template builder        | Planned       | WYSIWYG block editor for Liquid templates                 |
| Render profiles                | Planned       | `web`, `print-a4`, `pdf-book`, `rtl` profile targets      |
| RTL layout support             | Planned       | Direction-aware rendering in PDF export                   |
| License compatibility checker  | Planned       | Auto-block incompatible license combos at add-to-cart     |
| Metadata resolution cache      | Planned       | Cache key: `(edition_id, template_version, render_profile, script)` |
| Full provenance report         | Planned       | Admin view of all source/license data for a compiled book |
| Multi-parent category UI       | Partial       | Backend supports DAG inheritance; frontend only shows list |
| Node-level metadata binding UI | Partial       | Draft-level binding UI exists; node-scope UI planned      |
| Moderator workflow             | Not started   | Flag/review/hide/approve content pipeline                 |
| Search scope: Custom           | Planned       | Saved search/filter presets in Explorer                   |
| AI-assisted generation         | Out of scope  | Not planned for initial phases                            |
| Audit log                      | Partial       | `_audit_event` helper exists in draft_books.py; no query UI |

---

*Document generated from codebase analysis of:*
- [schema.sql](schema.sql) — database schema  
- [api/](api/) — FastAPI routes and business logic  
- [models/](models/) — SQLAlchemy model definitions  
- [web/src/](web/src/) — Next.js frontend  
- [DESIGN_RFC.md](DESIGN_RFC.md) — architectural vision  
- [ROLE_BASED_USER_EXPERIENCE.md](ROLE_BASED_USER_EXPERIENCE.md) — permissions detail  
- [METADATA_PROPERTY_SYSTEM.md](METADATA_PROPERTY_SYSTEM.md) — metadata system design  
- [REFACTOR_ROADMAP.md](REFACTOR_ROADMAP.md) — known technical debt  
