CREATE TABLE IF NOT EXISTS commentary_authors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    bio TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commentary_works (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    author_id INTEGER REFERENCES commentary_authors(id) ON DELETE SET NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commentary_works_author_id ON commentary_works(author_id);

CREATE TABLE IF NOT EXISTS commentary_entries (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES commentary_authors(id) ON DELETE SET NULL,
    work_id INTEGER REFERENCES commentary_works(id) ON DELETE SET NULL,
    content_text TEXT NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'en',
    display_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commentary_entries_node_id ON commentary_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_commentary_entries_author_id ON commentary_entries(author_id);
CREATE INDEX IF NOT EXISTS idx_commentary_entries_work_id ON commentary_entries(work_id);
