CREATE TABLE IF NOT EXISTS word_meaning_authors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bio TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS word_meaning_works (
    id SERIAL PRIMARY KEY,
    author_id INTEGER REFERENCES word_meaning_authors(id),
    title VARCHAR(255),
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS word_meaning_entries (
    id SERIAL PRIMARY KEY,
    node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES word_meaning_authors(id),
    work_id INTEGER REFERENCES word_meaning_works(id),
    source_word TEXT NOT NULL,
    transliteration TEXT,
    word_order INTEGER NOT NULL,
    language_code VARCHAR(20) NOT NULL,
    meaning_text TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(node_id, word_order, language_code, author_id)
);

CREATE INDEX IF NOT EXISTS idx_word_meaning_entries_node_id
    ON word_meaning_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_word_meaning_entries_language
    ON word_meaning_entries(node_id, language_code);
CREATE INDEX IF NOT EXISTS idx_word_meaning_entries_node_work
    ON word_meaning_entries(node_id, work_id);
