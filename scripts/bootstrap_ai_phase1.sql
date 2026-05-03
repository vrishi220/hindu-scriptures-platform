-- Single-run SQL for local and production app databases.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT / NOT EXISTS guards.
-- No explicit BEGIN/COMMIT so it works cleanly in DBeaver and psql.

DO $$
BEGIN
    IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Missing required table: users. Run schema.sql against this database first.';
    END IF;

    IF to_regclass('public.books') IS NULL THEN
        RAISE EXCEPTION 'Missing required table: books. Run schema.sql against this database first.';
    END IF;

    IF to_regclass('public.content_nodes') IS NULL THEN
        RAISE EXCEPTION 'Missing required table: content_nodes. Run schema.sql against this database first.';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ai_jobs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    language_code VARCHAR(20),
    model VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_nodes INTEGER NOT NULL DEFAULT 0,
    processed_nodes INTEGER NOT NULL DEFAULT 0,
    failed_nodes INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(10,4),
    actual_cost_usd DECIMAL(10,4),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_log JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_book_id ON ai_jobs(book_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created_by ON ai_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_job_type ON ai_jobs(job_type);

DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS user_collections;

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

CREATE INDEX IF NOT EXISTS idx_commentary_works_author_id ON commentary_works(author_id);
CREATE INDEX IF NOT EXISTS idx_commentary_entries_node_id ON commentary_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_commentary_entries_author_id ON commentary_entries(author_id);
CREATE INDEX IF NOT EXISTS idx_commentary_entries_work_id ON commentary_entries(work_id);

INSERT INTO commentary_authors (name, bio, metadata)
VALUES (
    'HSP AI',
    'AI-generated commentary on behalf of the Hindu Scriptures Platform. Outputs are intended for editorial review before publication.',
    '{"type":"ai","provider":"anthropic","model":"claude-sonnet-4","languages":["english","telugu","hindi","tamil"]}'::jsonb
)
ON CONFLICT (name)
DO UPDATE SET
    bio = EXCLUDED.bio,
    metadata = COALESCE(commentary_authors.metadata, '{}'::jsonb) || EXCLUDED.metadata;

INSERT INTO commentary_works (title, author_id, description, metadata)
SELECT
    work_seed.title,
    author_row.id,
    work_seed.description,
    work_seed.metadata
FROM commentary_authors author_row
CROSS JOIN (
    VALUES
        (
            'HSP AI Commentary - English',
            'AI-generated English commentary for supported scripture nodes.',
            '{"type":"ai_commentary","language_code":"en","language_name":"english","model":"claude-sonnet-4"}'::jsonb
        ),
        (
            'HSP AI Commentary - Telugu',
            'AI-generated Telugu commentary for supported scripture nodes.',
            '{"type":"ai_commentary","language_code":"te","language_name":"telugu","model":"claude-sonnet-4"}'::jsonb
        ),
        (
            'HSP AI Commentary - Hindi',
            'AI-generated Hindi commentary for supported scripture nodes.',
            '{"type":"ai_commentary","language_code":"hi","language_name":"hindi","model":"claude-sonnet-4"}'::jsonb
        ),
        (
            'HSP AI Commentary - Tamil',
            'AI-generated Tamil commentary for supported scripture nodes.',
            '{"type":"ai_commentary","language_code":"ta","language_name":"tamil","model":"claude-sonnet-4"}'::jsonb
        )
) AS work_seed(title, description, metadata)
WHERE author_row.name = 'HSP AI'
  AND NOT EXISTS (
      SELECT 1
      FROM commentary_works existing
      WHERE existing.author_id = author_row.id
        AND existing.title = work_seed.title
  );

-- Verification queries
SELECT id, name, metadata
FROM commentary_authors
WHERE name = 'HSP AI';

SELECT id, title, metadata
FROM commentary_works
WHERE author_id = (
    SELECT id
    FROM commentary_authors
    WHERE name = 'HSP AI'
)
ORDER BY title;
