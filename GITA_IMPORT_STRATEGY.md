# Generic Scripture Import Strategy

**Goal**: Import any scripture (Gita, Ramayana, etc.) using schema-driven logic that respects `level_name_overrides`.

## Architecture

### Three-Stage Process

```
Stage 1: Scrape & Cache
  vedicscriptures.github.io → normalized local JSON
  (one-time network call)

Stage 2: Validate Structure
  Local JSON → SchemaAwareJSONImporter → hierarchical node tree
  (iterative, no network)

Stage 3: Import to DB
  Node tree → content_nodes + content_renditions
  (can repeat after schema/mapping tweaks)
```

---

## Step 1: Scrape Source Data

### For Bhagavad Gita (vedicscriptures.github.io)

```bash
python fetch_gita_vedicscriptures.py
```

This creates: `external/bhagavad_gita_vedicscriptures_raw.json`

**Sample output structure:**
```json
{
  "title": "Bhagavad Gita",
  "source": "vedicscriptures.github.io",
  "total_chapters": 18,
  "chapters": [
    {
      "chapter_number": 1,
      "name": "Arjuna Visada Yoga",
      "transliterated_name": "Arjun Visad Yog",
      "verses": [
        {
          "verse_number": 1,
          "text": "धर्मक्षेत्रे कुरुक्षेत्रे...",
          "transliteration": "Dharmakshetre kurukshetra...",
          "translation": "...",
          "en": "..."
        },
        ...
      ]
    }
  ]
}
```

---

## Step 2: Validate & Iterate

```bash
python import_gita_vedicscriptures.py
```

This:
1. Loads the cached JSON
2. Maps chapters → Adhyaya nodes, verses → Shloka nodes
3. Respects any `level_name_overrides` you specify
4. Outputs sample diagnostics and a node tree to `external/bhagavad_gita_import_structure.json`

Customize the importer parameters:
- `chapter_level_name`: "Adhyaya" (or override from book's `level_name_overrides`)
- `verse_level_name`: "Shloka"
- `text_field_mapping`: Map content keys to JSON keys

---

## Step 3: Create Book & Import

### Via API (Post-Phase 1)

```python
# 1. Ensure schema exists (e.g., "Bhagavad Gita Standard")
schema = {
    "name": "Bhagavad Gita Standard",
    "levels": ["Adhyaya", "Shloka"]
}

# 2. Create book
book = {
    "book_name": "Bhagavad Gita",
    "book_code": "bg-vedicscriptures",
    "schema_id": <schema.id>,
    "language_primary": "sanskrit",
    "level_name_overrides": {
        "0": "Chapter",      # Override "Adhyaya" → "Chapter"
        "1": "Verse"         # Override "Shloka" → "Verse"
    }
}

# 3. Import via existing JSONImporter or new endpoint
#    (details in next phase)
```

---

## For Other Scriptures

### Example: Ramayana (same pattern)

1. **Create scraper** (`fetch_ramayana_vedicscriptures.py`):
   ```python
   # Fetch from https://vedicscriptures.github.io/kand/...
   # Produce: external/ramayana_vedicscriptures_raw.json
   # Structure: chapters/verses or kand/sarg/doha
   ```

2. **Configure importer**:
   ```python
   importer = SchemaAwareJSONImporter(
       book_name="Ramayana",
       chapters_key="kands",        # Different top-level key
       verses_key="sargas",         # Different verse key
       chapter_level_name="Kanda",  # Ramayana-specific level name
       verse_level_name="Sarga",
       chapter_num_key="kand_number",
       verse_num_key="sarga_number",
       text_field_mapping={...}
   )
   ```

3. **Import to DB** (same Stage 3 logic for all)

---

## Schema & Level Name Overrides

### Book-Level Customization

The `level_name_overrides` JSONB field on the `books` table allows per-book renaming without changing schema:

```json
{
  "0": "Chapter",      // Level 0 (was defined as "Adhyaya" in schema)
  "1": "Verse"         // Level 1 (was defined as "Shloka" in schema)
}
```

When the importer processes a node:
```python
level_name = level_name_overrides.get(str(level_order), default_level_name)
```

This enables:
- Same schema for multiple books (Gita, Ramayana)
- Different display names per book
- No schema duplication

---

## Key Files

| File | Purpose |
|------|---------|
| `fetch_gita_vedicscriptures.py` | Scrape chapters/verses → local JSON |
| `api/schema_aware_importer.py` | Generic importer with level_name_overrides support |
| `import_gita_vedicscriptures.py` | Example import pipeline (validation only) |
| `external/bhagavad_gita_vedicscriptures_raw.json` | Cached source data |
| `external/bhagavad_gita_import_structure.json` | Intermediate node tree (for validation) |

---

## Next: DB Integration

Once structure is validated, the next phase will:

1. Add endpoint to accept node tree + book/schema config
2. Iterate through node tree and create `content_nodes`
3. For multi-author imports, create `content_renditions` (translation/commentary)
4. Support partial re-imports (e.g., update just commentaries)

This completes the generic multi-scripture, multi-author pipeline.
