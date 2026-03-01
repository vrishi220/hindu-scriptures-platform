# AI Assist Metadata and Prompt Templates (Draft)

This folder defines a metadata-driven AI Assist contract for authoring flows.

## Files

- `ai_assist_field_metadata.schema.json`
  - JSON Schema for field-level `ai_assist` configuration.
- `prompt_template_library.json`
  - Reusable prompt templates for common scripture authoring targets.

## Why metadata-driven

Instead of hardcoding AI behavior per UI field, this design allows each schema/property field to opt in via metadata:

- Enable/disable AI Assist per field
- Restrict by role/scope (authoring-only)
- Control prompt source/context
- Validate output shape/script before apply
- Keep manual apply policy (`manual_only`)

## Integration with current metadata/property system

Attach `ai_assist` to field/property configuration payloads where your dynamic form is generated.

Example (field/property metadata fragment):

```json
{
  "internal_name": "sanskrit_text",
  "display_name": "Sanskrit",
  "data_type": "text",
  "ai_assist": {
    "enabled": true,
    "target_kind": "generate",
    "apply_policy": "manual_only",
    "allow_user_prompt_edit": true,
    "permission": {
      "roles_allowed": ["admin", "editor", "contributor"],
      "scope": "node",
      "require_edit_permission": true
    },
    "context_sources": [
      "book_name",
      "node_path",
      "level_name",
      "sequence_number",
      "preferred_script"
    ],
    "prompt_template_id": "sanskrit.verse.fetch.devanagari.v1",
    "output": {
      "format": "devanagari",
      "max_chars": 3000,
      "trim_whitespace": true
    },
    "validation": {
      "script_check": "devanagari",
      "forbid_html": true,
      "forbid_markdown": true,
      "min_chars": 1,
      "max_chars": 3000
    },
    "provenance": {
      "store_prompt": true,
      "store_response": true,
      "store_model": true,
      "store_context_snapshot": true,
      "require_user_ack": false
    },
    "rate_limit": {
      "requests_per_minute": 20,
      "requests_per_day": 500
    },
    "ui": {
      "button_label": "AI Help",
      "dialog_title": "AI Assist: Sanskrit",
      "show_context_chips": true,
      "allow_regenerate": true,
      "allow_refine": true
    }
  }
}
```

## Permission model (required)

AI Assist must be authoring-only:

- UI must hide/disable AI button for users without effective edit permission
- API must enforce authorization independently (`403` when unauthorized)
- Field-level role checks come from `permission.roles_allowed`

Recommended checks on server:

1. Resolve effective permission for target scope (`book`/`node`/`draft_book`)
2. Confirm field is editable in current status (draft/published rules)
3. Confirm `ai_assist.enabled=true` for target field
4. Enforce rate limits

## Prompt template library contents

Current draft templates:

1. Sanskrit verse fetch (Devanagari)
2. Transliteration from Sanskrit (IAST)
3. English translation (literal)
4. Concise authoring summary

All templates return structured JSON payload with:

- `text`
- `citation_note`
- `confidence` (0..1)

## Context variables and defaults

Example context:

```json
{
  "book_name": "Bhagavata Purana",
  "node_path": "Canto 4 > Chapter 29 > Verse 11",
  "level_name": "Verse",
  "sequence_number": "11",
  "editor_note": "Prefer canonical reading; avoid commentary"
}
```

## Suggested API contract (for implementation)

Request:

```json
{
  "target": {
    "entity_type": "node",
    "entity_id": 12345,
    "field_internal_name": "sanskrit_text"
  },
  "prompt": {
    "template_id": "sanskrit.verse.fetch.devanagari.v1",
    "text": "...editable prompt...",
    "variables": {
      "book_name": "Bhagavata Purana",
      "node_path": "Canto 4 > Chapter 29 > Verse 11"
    }
  }
}
```

Response:

```json
{
  "result": {
    "text": "...",
    "citation_note": "...",
    "confidence": 0.93
  },
  "validation": {
    "passed": true,
    "issues": []
  },
  "provenance": {
    "request_id": "uuid",
    "model": "provider/model-name",
    "timestamp": "2026-03-01T00:00:00Z"
  }
}
```

## Non-goals in this draft

- No direct client-to-provider calls
- No auto-apply behavior
- No implementation code in this folder

