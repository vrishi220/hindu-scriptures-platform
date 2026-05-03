-- DBeaver-friendly seed script: no explicit BEGIN/COMMIT so it runs cleanly
-- whether auto-commit is enabled or not.

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