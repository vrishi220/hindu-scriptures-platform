from sqlalchemy import create_engine, text


def ensure_phase1_schema(database_url: str) -> None:
    """Idempotently ensure Phase 1 schema elements exist.

    This is intended for local/dev/test environments where legacy tables may
    exist without newer Phase 1 columns.
    """
    engine = create_engine(database_url, pool_pre_ping=True)

    statements = [
        """
        DO $$ BEGIN
            CREATE TYPE content_status AS ENUM ('draft', 'published', 'archived');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """,
        """
        DO $$ BEGIN
            CREATE TYPE content_visibility AS ENUM ('private', 'draft', 'published', 'archived');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """,
        """
        DO $$ BEGIN
            CREATE TYPE compilation_status AS ENUM ('draft', 'published');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """,
        """
        ALTER TABLE IF EXISTS content_nodes
            ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS status content_status DEFAULT 'published',
            ADD COLUMN IF NOT EXISTS visibility content_visibility DEFAULT 'published',
            ADD COLUMN IF NOT EXISTS language_code VARCHAR(10) DEFAULT 'en',
            ADD COLUMN IF NOT EXISTS collaborators JSONB DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS version_history JSONB DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS search_vector tsvector;
        """,
        """
        CREATE TABLE IF NOT EXISTS user_preferences (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_language VARCHAR(10) NOT NULL DEFAULT 'en',
            transliteration_enabled BOOLEAN NOT NULL DEFAULT true,
            transliteration_script VARCHAR(20) NOT NULL DEFAULT 'devanagari',
            show_roman_transliteration BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS compilations (
            id SERIAL PRIMARY KEY,
            creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            schema_type VARCHAR(50),
            items JSONB NOT NULL,
            compilation_metadata JSONB,
            status compilation_status NOT NULL DEFAULT 'draft',
            is_public BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_content_nodes_status ON content_nodes(status);",
        "CREATE INDEX IF NOT EXISTS idx_content_nodes_visibility ON content_nodes(visibility);",
        "CREATE INDEX IF NOT EXISTS idx_content_nodes_language ON content_nodes(language_code);",
        "CREATE INDEX IF NOT EXISTS idx_compilations_creator_id ON compilations(creator_id);",
        "CREATE INDEX IF NOT EXISTS idx_compilations_status ON compilations(status);",
        "CREATE INDEX IF NOT EXISTS idx_compilations_is_public ON compilations(is_public);",
    ]

    try:
        with engine.begin() as conn:
            for sql in statements:
                conn.execute(text(sql))
    finally:
        engine.dispose()
