# Word Meanings Authoring Guide (v1)

This guide describes the current v1 behavior for `word_meanings` across authoring, rendering, search, and export.

## 1) Enablement Rollout by Level

Word meanings are enabled per book using book metadata.

Use `metadata_json.word_meanings.enabled_levels` on the book:

```json
{
  "word_meanings": {
    "enabled_levels": ["Verse"]
  }
}
```

Behavior:
- Inline editor UI is shown only for levels listed in `enabled_levels`.
- Backend create/update rejects `content_data.word_meanings` on levels not listed.
- If `enabled_levels` is not configured, rollout enforcement is not applied (backward-compatible mode).

### Rollback Toggle

To disable authoring on all levels for a book, set:

```json
{
  "word_meanings": {
    "enabled_levels": []
  }
}
```

To return to backward-compatible mode, remove the `enabled_levels` key.

## 2) Payload Shape (Authoring)

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
            "iast": "dharmakṣetre",
            "hk": "dharmakSetre"
          }
        },
        "meanings": {
          "en": { "text": "in the field of dharma" },
          "hi": { "text": "धर्म के क्षेत्र में" }
        }
      }
    ]
  }
}
```

## 3) Validation Rules (v1)

- `version` is required.
- `rows` must be an array.
- `id` required and unique per payload.
- `order` must be integer >= 1.
- `source.language` must be one of: `sa`, `pi`, `hi`, `ta`.
- At least one source form is required: `script_text` or one transliteration value.
- At least one meaning text is required.
- `meanings.en.text` is required in v1.
- HTML is rejected in source/meaning text fields.
- Max row/field lengths are enforced by validators.

## 4) Runtime Rendering Contract

### Source token resolution
Resolution order:
1. Preferred display mode value (`script` or `transliteration`) if available.
2. Preferred transliteration scheme if available.
3. Runtime generation fallback (if enabled).
4. First available source representation.

### Meaning resolution
Resolution order:
1. User preferred language.
2. `en`.
3. First available non-empty meaning.

Fallback badge is shown only when fallback was used and metadata allows it.

## 5) Browse / Preview / Search / Export

- Browse/preview reads resolved `word_meanings_rows` contract from backend.
- Search indexes source and meaning content from `content_data.word_meanings`.
- PDF export includes deterministic row ordering and fallback-consistent meaning selection.

## 6) Known Limitations (v1)

- Rollout gate is configured per-book, not globally per schema.
- Inline editor currently captures a primary transliteration input; payload supports additional schemes.
- Generated transliteration/script fallback is runtime-only and is not persisted automatically.
- Required meaning language is fixed to `en` in current validators.
