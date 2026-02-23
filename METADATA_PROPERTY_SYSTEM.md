# Metadata Property System Design (v0.4)

## Overview
Upgrade metadata from free-form JSONB to schema-governed properties with:
- Typed property definitions (text, boolean, number, dropdown, date, datetime)
- Named categories grouping properties by purpose
- Hierarchical categories (inheritance + override, including multiple parents)
- Dynamic UI form generation
- Liquid template integration

## Database Schema

### `property_definitions`
```
id (PK)
internal_name: str (unique) # stable key, e.g., "is_transliterable", "custom_color_scheme"
display_name: str           # UI label, e.g., "Is Transliterable"
data_type: enum             # "text", "boolean", "number", "dropdown", "date", "datetime"
description: str
default_value: any | None   # JSON-serializable default; may be null if property is not required
is_required: bool           # Whether field is mandatory in category bindings
is_system: bool             # System-managed (cannot delete)
dropdown_options: list[str] | None  # For data_type=dropdown
created_at: datetime
updated_at: datetime
```

### `categories`
```
id (PK)
name: str (unique)          # e.g., "default_chapter", "sanskrit_verse_extended"
description: str
applicable_scopes: list[str]  # ["book", "chapter", "verse", ...] (Book + every concrete level scope)
version: int                # For published snapshot traceability
is_system: bool             # System-managed (cannot delete)
is_published: bool          # Published categories are immutable
created_at: datetime
updated_at: datetime
```

### `category_parents` (new table)
```
id (PK)
child_category_id: int (FK categories.id)
parent_category_id: int (FK categories.id)
precedence_order: int       # Merge order among multiple parents
created_at: datetime

Unique constraint: (child_category_id, parent_category_id)
```

### `category_properties`
```
id (PK)
category_id: int (FK)
property_definition_id: int (FK)
order: int                  # Display order in UI form
description_override: str | None  # Category-specific label/help text
default_override: any | None  # Can override property's default per category
is_required_override: bool | None  # Can override required status per category
created_at: datetime

Unique constraint: (category_id, property_definition_id)

Rule: A category cannot contain duplicate internal property names.
```

### `metadata_bindings` (new table)
```
id (PK)
entity_type: str            # "book", "level", "node", "draft_book_section"
entity_id: int              # FK context (book_id, level_id, node_id, etc.)
category_id: int | None (FK)  # Which category is bound
scope_type: str             # "global", "book", "level", "node"
property_overrides: JSONB   # {property_internal_name: override_value}
unset_overrides: list[str]  # internal names that explicitly fallback to inherited/default value
created_at: datetime
updated_at: datetime
```

## Resolution Algorithm

**Category Hierarchy Merge:**
1. Start at `category_id` (if bound)
2. Walk all parents from `category_parents` (DAG) using `precedence_order`
3. Collect all property definitions from parent categories, then child category
4. Child properties always win if same key conflicts

**Property Value Precedence:**
1. Node-level override (metadata_bindings where scope_type="node")
2. Node's category defaults (from category_properties)
3. Level override (metadata_bindings where scope_type="level")
4. Level's category defaults
5. Book override (metadata_bindings where scope_type="book")
6. Book's category defaults
7. Global override (metadata_bindings where scope_type="global")
8. Global category defaults
9. Property definition default

`unset_overrides` removes same-scope explicit value and forces fallback to next precedence layer.

**Liquid Template Context:**
- All resolved properties available as `metadata.{property_internal_name}`
- Example: `{% if metadata.is_transliterable %}...{% endif %}`
- Can use property metadata for conditional rendering
- Template selection can be metadata-driven using template key properties such as
  `render_template_key`, `<level>_template_key`, `<section>_template_key`, and
  `<section>_<level>_template_key`.

## Governance + Validation Rules

- Validation must run at create, update, and publish.
- Only Admin can create/update/delete property definitions and categories.
- Any actor with create/edit permission at a scope can assign a category and set overrides for that scope.
- Fundamental built-ins are only `name`, `description`, and `category`; all additional attributes are metadata properties.

## API Endpoints

### Admin/Governance APIs
- `POST /api/metadata/property-definitions` — Create property
- `GET /api/metadata/property-definitions` — List all properties
- `PATCH /api/metadata/property-definitions/{prop_id}` — Update property
- `DELETE /api/metadata/property-definitions/{prop_id}` — Delete (only if not used)

- `POST /api/metadata/categories` — Create category
- `GET /api/metadata/categories` — List with hierarchy
- `GET /api/metadata/categories/{cat_id}/effective-properties` — Resolved properties including inherited
- `PATCH /api/metadata/categories/{cat_id}` — Update category (only if unpublished)
- `POST /api/metadata/categories/{cat_id}/publish` — Lock + publish
- `DELETE /api/metadata/categories/{cat_id}` — Delete (only if unpublished)

### Editor APIs (Metadata Binding)
- `POST /api/draft-books/{draft_id}/metadata-binding` — Bind category + set overrides
- `GET /api/draft-books/{draft_id}/metadata-binding` — Get current binding + effective properties
- `PATCH /api/draft-books/{draft_id}/metadata-binding` — Update binding + overrides
- `POST /api/draft-books/{draft_id}/levels/{level_id}/metadata-binding` — Level scope
- `POST /api/draft-books/{draft_id}/sections/{section_id}/nodes/{node_id}/metadata-binding` — Node scope

## Implementation Phases

### Phase 1: Data Layer
- Migration: New tables (property_definitions, categories, category_properties, metadata_bindings)
- SQLAlchemy models
- Pydantic schemas (PropertyDefinitionCreate, CategoryCreate, etc.)

### Phase 2: Resolution Engine
- Category hierarchy traversal
- Property merging with precedence
- Validation against schema

### Phase 3: API Layer
- CRUD endpoints for properties and categories
- Metadata binding endpoints
- Effective property resolution endpoints

### Phase 4: Liquid Integration
- Extend `_build_template_context()` to include resolved properties
- Map all metadata properties into template context

### Phase 5: Frontend
- Dynamic property form generation (create form fields by property type)
- Category dropdown in compose UI
- Property overrides UI at book/level/node scopes

### Phase 6: Validation + Publishing
- Enforce required properties before publish
- Validation error reporting
- Snapshot captures binding version for reproducibility

## Examples

### Example: Hierarchical Categories
```
Category: "base_verse"
  Properties:
    - is_transliterable (boolean, default=true)
    - source_language (dropdown: sanskrit/tamil/telugu, default=sanskrit)

Category: "sanskrit_verse" (extends base_verse)
  Properties:
    - (inherits is_transliterable, source_language)
    - diacritical_system (dropdown: iast/slp1/velthuis, default=iast)
    - meter_type (text, default=)

Category: "bhagavad_gita_verse" (extends sanskrit_verse)
  Properties:
    - (inherits all from base_verse + sanskrit_verse)
    - chapter_number (number, required=true)
    - verse_number (number, required=true)
```

### Example: Multi-parent Category
```
Category: "base_directional"
  - direction (dropdown: ltr/rtl, default=ltr)

Category: "base_source"
  - source_language (dropdown, required=true, default=sanskrit)

Category: "hebrew_reference" (extends base_directional + base_source)
  - direction default_override=rtl
  - reference_type (text)
```

### Example: Binding at Book Level
```
Draft Book "Gita Compilation"
  category: "bhagavad_gita_verse"
  property_overrides: {
    "source_language": "sanskrit",
    "diacritical_system": "iast"
  }

Level "Chapter 2"
  property_overrides: {
    "chapter_number": 2
  }

Node "Verse 2.47"
  property_overrides: {
    "verse_number": 47,
    "is_transliterable": false  # Override: this verse should not be transliterated
  }
  unset_overrides: ["diacritical_system"]  # fall back to inherited/category default
```

### Example: Book Basics Category
```
Category: "book_basics"
  Properties:
    - title (text, required=true, default="Untitled")
    - author (text, required=false, default=null)
    - publication_year (number, required=false, default=null)
    - publication_date (date, required=false, default=null)
```

## Finalized Decisions

- Number type is floating-point (`number`), while integer-like values are represented as whole numbers.
- Default may be null/empty only when `is_required=false`.
- If `is_required=true`, a non-null default is mandatory.
- Computed properties are deferred to a later phase.
- Categories support multiple parents; child wins on conflicts.
- Scope starts at Book and includes every concrete level (`chapter`, `verse`, etc.).
- Unset behavior is explicit via `unset_overrides` to ensure deterministic fallback.
- Property definitions have both `internal_name` and `display_name`.
- Category property internal names must be unique within the category.

### Example: Liquid Template Usage
```liquid
<h3>{{ metadata.chapter_number }}.{{ metadata.verse_number }}</h3>

{% if metadata.is_transliterable %}
  <p class="transliteration">{{ transliteration }}</p>
{% endif %}

<p class="text" lang="sa" dir="auto">{{ sanskrit }}</p>
```

### Example: Level Template from Metadata
```json
{
  "metadata": {
    "verse_template_key": "default.body.verse.content_item.v1"
  }
}
```

## Success Criteria

- [x] Property definitions can be created with types + defaults
- [x] Categories can be created and organized hierarchically
- [x] Properties can be bound + overridden at multiple scopes
- [x] Metadata resolution merges hierarchy correctly
- [x] Liquid templates receive resolved properties
- [x] UI dynamically generates forms from categories
- [x] Publishing validates required properties
- [x] Snapshots capture category version for reproducibility
