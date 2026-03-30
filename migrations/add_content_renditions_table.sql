CREATE TABLE IF NOT EXISTS content_renditions (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    rendition_type TEXT NOT NULL,
    author_id INTEGER REFERENCES commentary_authors(id) ON DELETE SET NULL,
    work_id INTEGER REFERENCES commentary_works(id) ON DELETE SET NULL,
    content_text TEXT NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'en',
    script_code TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT content_renditions_type_check
        CHECK (rendition_type IN ('translation', 'commentary'))
);

CREATE INDEX IF NOT EXISTS idx_content_renditions_node_id
    ON content_renditions(node_id);
CREATE INDEX IF NOT EXISTS idx_content_renditions_type
    ON content_renditions(rendition_type);
CREATE INDEX IF NOT EXISTS idx_content_renditions_author_id
    ON content_renditions(author_id);
CREATE INDEX IF NOT EXISTS idx_content_renditions_work_id
    ON content_renditions(work_id);
CREATE INDEX IF NOT EXISTS idx_content_renditions_lang_script
    ON content_renditions(language_code, script_code);

-- Backfill existing commentaries into the unified table without removing legacy rows.
INSERT INTO content_renditions (
    node_id,
    rendition_type,
    author_id,
    work_id,
    content_text,
    language_code,
    script_code,
    display_order,
    metadata,
    created_by,
    last_modified_by,
    created_at,
    updated_at
)
SELECT
    ce.node_id,
    'commentary',
    ce.author_id,
    ce.work_id,
    ce.content_text,
    ce.language_code,
    NULL,
    ce.display_order,
    ce.metadata,
    ce.created_by,
    ce.last_modified_by,
    ce.created_at,
    ce.updated_at
FROM commentary_entries ce
WHERE NOT EXISTS (
    SELECT 1
    FROM content_renditions cr
    WHERE cr.node_id = ce.node_id
      AND cr.rendition_type = 'commentary'
      AND COALESCE(cr.author_id, -1) = COALESCE(ce.author_id, -1)
      AND COALESCE(cr.work_id, -1) = COALESCE(ce.work_id, -1)
      AND cr.language_code = ce.language_code
      AND cr.content_text = ce.content_text
);
