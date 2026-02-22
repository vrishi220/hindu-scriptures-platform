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
        DO $$ BEGIN
            CREATE TYPE draft_book_status AS ENUM ('draft', 'published');
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
        """
        CREATE TABLE IF NOT EXISTS draft_books (
            id SERIAL PRIMARY KEY,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            section_structure JSONB NOT NULL DEFAULT '{"front": [], "body": [], "back": []}'::jsonb,
            status draft_book_status NOT NULL DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS edition_snapshots (
            id SERIAL PRIMARY KEY,
            draft_book_id INTEGER NOT NULL REFERENCES draft_books(id) ON DELETE CASCADE,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            version INTEGER NOT NULL DEFAULT 1,
            snapshot_data JSONB NOT NULL DEFAULT '{}'::jsonb,
            immutable BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS book_shares (
            id SERIAL PRIMARY KEY,
            book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission VARCHAR(20) NOT NULL DEFAULT 'viewer',
            shared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_book_shares_book_user UNIQUE (book_id, shared_with_user_id),
            CONSTRAINT ck_book_shares_permission CHECK (permission IN ('viewer', 'contributor', 'editor'))
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS collection_carts (
            id SERIAL PRIMARY KEY,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) DEFAULT 'My Collection',
            description TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS collection_cart_items (
            id SERIAL PRIMARY KEY,
            cart_id INTEGER NOT NULL REFERENCES collection_carts(id) ON DELETE CASCADE,
            item_id INTEGER NOT NULL,
            item_type VARCHAR(50) NOT NULL,
            source_book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
            "order" INTEGER DEFAULT 0,
            item_metadata JSONB,
            added_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS provenance_records (
            id SERIAL PRIMARY KEY,
            target_book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            target_node_id INTEGER NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
            source_book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
            source_node_id INTEGER REFERENCES content_nodes(id) ON DELETE SET NULL,
            source_type VARCHAR(50) NOT NULL DEFAULT 'library_reference',
            source_author TEXT,
            license_type VARCHAR(100) NOT NULL DEFAULT 'CC-BY-SA-4.0',
            source_version VARCHAR(120) NOT NULL DEFAULT 'unknown',
            inserted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            draft_section VARCHAR(20) NOT NULL DEFAULT 'body',
            created_at TIMESTAMP DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_content_nodes_status ON content_nodes(status);",
        "CREATE INDEX IF NOT EXISTS idx_content_nodes_visibility ON content_nodes(visibility);",
        "CREATE INDEX IF NOT EXISTS idx_content_nodes_language ON content_nodes(language_code);",
        "CREATE INDEX IF NOT EXISTS idx_compilations_creator_id ON compilations(creator_id);",
        "CREATE INDEX IF NOT EXISTS idx_compilations_status ON compilations(status);",
        "CREATE INDEX IF NOT EXISTS idx_compilations_is_public ON compilations(is_public);",
        "CREATE INDEX IF NOT EXISTS idx_draft_books_owner_id ON draft_books(owner_id);",
        "CREATE INDEX IF NOT EXISTS idx_draft_books_status ON draft_books(status);",
        "CREATE INDEX IF NOT EXISTS idx_edition_snapshots_draft_book_id ON edition_snapshots(draft_book_id);",
        "CREATE INDEX IF NOT EXISTS idx_edition_snapshots_owner_id ON edition_snapshots(owner_id);",
        "CREATE INDEX IF NOT EXISTS idx_book_shares_book_id ON book_shares(book_id);",
        "CREATE INDEX IF NOT EXISTS idx_book_shares_shared_with_user_id ON book_shares(shared_with_user_id);",
        "CREATE INDEX IF NOT EXISTS idx_collection_carts_owner_id ON collection_carts(owner_id);",
        "CREATE INDEX IF NOT EXISTS idx_collection_cart_items_cart_id ON collection_cart_items(cart_id);",
        "CREATE INDEX IF NOT EXISTS idx_collection_cart_items_item ON collection_cart_items(item_id, item_type);",
        "CREATE INDEX IF NOT EXISTS idx_provenance_target_book_id ON provenance_records(target_book_id);",
        "CREATE INDEX IF NOT EXISTS idx_provenance_target_node_id ON provenance_records(target_node_id);",
        "CREATE INDEX IF NOT EXISTS idx_provenance_source_book_id ON provenance_records(source_book_id);",
    ]

    try:
        with engine.begin() as conn:
            for sql in statements:
                conn.execute(text(sql))
    finally:
        engine.dispose()
