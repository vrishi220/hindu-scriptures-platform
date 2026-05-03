CREATE TABLE IF NOT EXISTS translation_authors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bio TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS translation_works (
    id SERIAL PRIMARY KEY,
    author_id INTEGER REFERENCES translation_authors(id),
    title VARCHAR(255),
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS translation_entries (
    id SERIAL PRIMARY KEY,
    node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES translation_authors(id),
    work_id INTEGER REFERENCES translation_works(id),
    content_text TEXT NOT NULL,
    language_code VARCHAR(20) NOT NULL DEFAULT 'en',
    display_order INTEGER DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_translation_works_author_id ON translation_works(author_id);
CREATE INDEX IF NOT EXISTS idx_translation_entries_node_id ON translation_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_translation_entries_author_id ON translation_entries(author_id);
CREATE INDEX IF NOT EXISTS idx_translation_entries_work_id ON translation_entries(work_id);
