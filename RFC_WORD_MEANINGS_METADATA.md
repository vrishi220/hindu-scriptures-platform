# RFC — Metadata-Driven Word Meanings Field (Multilingual + Transliteration-Aware)

## Status
- Draft for iteration
- Date: 2026-03-02
- Owners: Product + Platform + Content UX

## 1) Summary
Introduce a metadata-driven field called `word_meanings` for per-token meaning authoring and display.

- Left side (source token) renders according to user script/transliteration preference.
- Right side (meaning) supports multiple languages with configurable fallback.
- Behavior is controlled by metadata, not hardcoded per scripture or level.

## 2) Problem Statement
Current content model supports full-text fields but lacks a structured, reusable way to represent word-by-word meanings across levels.

Requirements:
- Per-row source token + meaning pairs.
- Dynamic transliteration/script rendering for source token.
- Multi-language meanings with predictable fallback.
- Consistent behavior in authoring, browse, preview, search, and export.

## 3) Goals
1. Fully metadata-driven field behavior.
2. Stable JSON value contract with versioning.
3. Multi-language meanings per token row.
4. Deterministic rendering rules for user preferences.
5. Validation and safety guardrails.

## 4) Non-Goals (v1)
- Morphological parser or automatic tokenization.
- Rich-text formatting inside token/meaning cells.
- Cross-node lexical dictionary normalization.

## 5) Proposed Field Metadata Contract
Field-level metadata governs behavior.

```json
{
  "internal_name": "word_meanings",
  "display_name": "Word Meanings",
  "data_type": "json",
  "is_required": false,
  "metadata": {
    "word_meanings": {
      "version": "1.0",
      "enabled": true,
      "source": {
        "allowed_input_modes": ["script", "transliteration", "both"],
        "canonical_storage": "auto",
        "default_source_language": "sa",
        "allowed_source_languages": ["sa", "pi", "hi", "ta"],
        "transliteration_schemes": ["iast", "iso15919", "hk", "itrans"],
        "default_transliteration_scheme": "iast",
        "allow_runtime_transliteration_generation": true
      },
      "meanings": {
        "allowed_languages": ["en", "hi", "ta", "te", "kn", "ml"],
        "required_languages": ["en"],
        "allow_multiple_languages_per_row": true,
        "fallback_order": ["user_preference", "en", "first_available"]
      },
      "validation": {
        "min_rows": 0,
        "max_rows": 400,
        "max_source_chars": 120,
        "max_meaning_chars": 400,
        "require_at_least_one_source_form": true,
        "require_at_least_one_meaning": true,
        "trim_whitespace": true,
        "reject_html": true
      },
      "rendering": {
        "layout": "two_column",
        "left_column": "source_preference",
        "right_column": "meaning_language_preference",
        "show_language_badge_when_fallback_used": true
      }
    }
  }
}
```

## 6) Stored Field Value Contract
Node-level value stored in `content_data` or metadata-bound property value.

```json
{
  "word_meanings": {
    "version": "1.0",
    "rows": [
      {
        "id": "wm_001",
        "order": 1,
        "source": {
          "language": "sa",
          "script_text": "धर्मक्षेत्रे",
          "transliteration": {
            "iast": "dharmakṣetre"
          }
        },
        "meanings": {
          "en": { "text": "in the field of dharma" },
          "hi": { "text": "धर्म के क्षेत्र में" }
        },
        "notes": null
      }
    ]
  }
}
```

## 7) Validation Contract
Validation is metadata-driven and enforced client + server.

### 7.1 Row-level rules
- `id` required, unique within field payload.
- `order` required, integer >= 1.
- `source.language` required and in `allowed_source_languages`.
- At least one source form required:
  - `source.script_text` OR
  - one transliteration entry.
- At least one meaning required.
- If `required_languages` contains `en`, then `meanings.en.text` is required.

### 7.2 Content safety rules
- Plain text only; HTML tags rejected when `reject_html=true`.
- Trim whitespace when `trim_whitespace=true`.
- Max lengths enforced by metadata limits.

### 7.3 Payload-level rules
- `version` required.
- `rows.length` must be within `[min_rows, max_rows]`.

## 8) Rendering Contract
Renderer resolves display at runtime using user preferences + metadata.

### 8.1 Left column (source token)
Given user preferences:
- `source_display_mode`: `script` or `transliteration`
- `preferred_transliteration_scheme`

Resolution order:
1. Preferred mode value if present.
2. Preferred transliteration scheme value.
3. Runtime transliteration generation (if enabled).
4. First available source representation.

### 8.2 Right column (meaning language)
Given user preference `meaning_language`:
1. `meanings[user_preference]`
2. `meanings.en`
3. first non-empty meaning in row

If fallback occurred and metadata enables it, show fallback language badge.

## 9) Authoring UX Contract (MVP)
- Repeater-style two-column row editor.
- Row actions: add, delete, reorder.
- Meaning editor supports multiple language tabs or chips.
- Save blocked on validation errors.
- English (`en`) required by default for v1.

## 10) Search / Preview / Export Contract
- Search indexing includes:
  - source token canonical/script/transliteration
  - all meaning texts across languages.
- Browse/preview renders according to rendering contract.
- Export/PDF uses row order deterministically and selected language fallback logic.

## 11) Backward and Forward Compatibility
- Include `version` in payload and metadata.
- Unknown language keys can be ignored or preserved based on metadata policy.
- New transliteration schemes/languages can be added via metadata without schema rewrite.

## 12) Rollout Plan
### Phase 1 (MVP)
- Enable `word_meanings` on selected levels.
- Require `en` meaning.
- Support optional additional languages.

### v1 Rollout Configuration (Implemented)
- Book-level rollout is controlled via `metadata_json.word_meanings.enabled_levels`.
- UI and backend enforcement allow `word_meanings` only on levels listed in `enabled_levels`.
- If `enabled_levels` is omitted, rollout enforcement is not applied (backward-compatible mode).

### Phase 2
- Admin-managed required language sets by schema/book/level.
- Optional side-by-side multi-language meaning display mode.

### Phase 3
- Optional lexical tooling (lemma linkage, glossary sync) without breaking v1 shape.

## 13) Decisions (Resolved)
1. Required languages are level-specific by default.
  - Default baseline remains `required_languages: ["en"]`.
  - Level metadata may add additional required languages without changing payload shape.

2. Runtime-generated transliteration is ephemeral by default.
  - Generated values are used only for rendering fallback.
  - Persisting generated transliteration is explicitly out of scope for v1.

3. Fallback badges display in normal user view when fallback is used and metadata enables it.
  - Controlled by `show_language_badge_when_fallback_used`.
  - No debug-only gating in v1.

## 14) Acceptance Criteria
- Field can be enabled by metadata on any target level.
- Renderer correctly applies source/meaning preference fallback.
- Validation blocks invalid rows consistently on client and server.
- Search and export consume the field without custom per-book code.

## 15) Implementation Backlog
- Execution tasks are tracked in `BACKLOG_WORD_MEANINGS_METADATA.md`.
- The backlog is organized into phases A-E and aligned to this RFC's contracts.
- GitHub execution tracker: #58 ([EPIC] Word Meanings Metadata Implementation Tracker).

## 16) v1 Notes and Limitations
- Rollout control is currently per-book, not global per schema.
- Runtime-generated transliteration/script fallback is render-time only and is not auto-persisted.
- Required meaning language is fixed to `en` in current validators.
