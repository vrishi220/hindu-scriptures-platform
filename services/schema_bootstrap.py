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
        DO $$ BEGIN
            CREATE TYPE property_data_type AS ENUM ('text', 'boolean', 'number', 'dropdown', 'date', 'datetime');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        """,
        """
        DO $$ BEGIN
            CREATE TYPE metadata_scope_type AS ENUM ('global', 'book', 'level', 'node');
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
        ALTER TABLE IF EXISTS user_preferences
            ADD COLUMN IF NOT EXISTS show_only_preferred_script BOOLEAN NOT NULL DEFAULT false;
        """,
        """
        ALTER TABLE IF EXISTS scripture_schemas
            ADD COLUMN IF NOT EXISTS level_template_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;
        """,
        """
        ALTER TABLE IF EXISTS user_preferences
            ADD COLUMN IF NOT EXISTS preview_show_titles BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS preview_show_labels BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS preview_show_details BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS preview_show_sanskrit BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS preview_show_transliteration BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS preview_show_english BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS preview_transliteration_script VARCHAR(20) NOT NULL DEFAULT 'iast';
        """,
        """
        CREATE TABLE IF NOT EXISTS user_preferences (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_language VARCHAR(10) NOT NULL DEFAULT 'en',
            transliteration_enabled BOOLEAN NOT NULL DEFAULT true,
            transliteration_script VARCHAR(20) NOT NULL DEFAULT 'devanagari',
            show_roman_transliteration BOOLEAN NOT NULL DEFAULT true,
            show_only_preferred_script BOOLEAN NOT NULL DEFAULT false,
            preview_show_titles BOOLEAN NOT NULL DEFAULT false,
            preview_show_labels BOOLEAN NOT NULL DEFAULT false,
            preview_show_details BOOLEAN NOT NULL DEFAULT false,
            preview_show_sanskrit BOOLEAN NOT NULL DEFAULT true,
            preview_show_transliteration BOOLEAN NOT NULL DEFAULT true,
            preview_show_english BOOLEAN NOT NULL DEFAULT true,
            preview_transliteration_script VARCHAR(20) NOT NULL DEFAULT 'iast',
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
        """
        CREATE TABLE IF NOT EXISTS property_definitions (
            id SERIAL PRIMARY KEY,
            internal_name VARCHAR(255) NOT NULL UNIQUE,
            display_name VARCHAR(255) NOT NULL,
            data_type property_data_type NOT NULL DEFAULT 'text',
            description TEXT,
            default_value JSONB,
            is_required BOOLEAN NOT NULL DEFAULT false,
            is_system BOOLEAN NOT NULL DEFAULT false,
            is_deprecated BOOLEAN NOT NULL DEFAULT false,
            deprecated_at TIMESTAMP,
            dropdown_options VARCHAR(255)[],
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            applicable_scopes VARCHAR(120)[] NOT NULL DEFAULT ARRAY['book'],
            version INTEGER NOT NULL DEFAULT 1,
            is_system BOOLEAN NOT NULL DEFAULT false,
            is_published BOOLEAN NOT NULL DEFAULT false,
            is_deprecated BOOLEAN NOT NULL DEFAULT false,
            deprecated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        ALTER TABLE IF EXISTS property_definitions
            ADD COLUMN IF NOT EXISTS is_deprecated BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMP;
        """,
        """
        ALTER TABLE IF EXISTS categories
            ADD COLUMN IF NOT EXISTS is_deprecated BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMP;
        """,
        """
        CREATE TABLE IF NOT EXISTS category_properties (
            id SERIAL PRIMARY KEY,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            property_definition_id INTEGER NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
            "order" INTEGER NOT NULL DEFAULT 0,
            description_override TEXT,
            default_override JSONB,
            is_required_override BOOLEAN,
            created_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uc_category_property UNIQUE (category_id, property_definition_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS metadata_bindings (
            id SERIAL PRIMARY KEY,
            entity_type VARCHAR(50) NOT NULL,
            entity_id INTEGER NOT NULL,
            root_entity_id INTEGER,
            scope_key VARCHAR(120),
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            scope_type metadata_scope_type NOT NULL DEFAULT 'book',
            property_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
            unset_overrides VARCHAR(255)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(255)[],
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS category_parents (
            id SERIAL PRIMARY KEY,
            child_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            parent_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            precedence_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uc_category_parent_edge UNIQUE (child_category_id, parent_category_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS render_templates (
            id SERIAL PRIMARY KEY,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            description TEXT,
            target_level VARCHAR(120),
            visibility VARCHAR(20) NOT NULL DEFAULT 'private',
            is_system BOOLEAN NOT NULL DEFAULT false,
            system_key VARCHAR(160),
            liquid_template TEXT NOT NULL,
            current_version INTEGER NOT NULL DEFAULT 1,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_render_templates_owner_name UNIQUE (owner_id, name)
        );
        """,
        """
        ALTER TABLE IF EXISTS render_templates
            ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';
        """,
        """
        ALTER TABLE IF EXISTS render_templates
            ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS system_key VARCHAR(160);
        """,
        """
        ALTER TABLE IF EXISTS render_templates
            ADD COLUMN IF NOT EXISTS target_schema_id INTEGER;
        """,
        """
        CREATE TABLE IF NOT EXISTS render_template_versions (
            id SERIAL PRIMARY KEY,
            template_id INTEGER NOT NULL REFERENCES render_templates(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            liquid_template TEXT NOT NULL,
            change_note TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_render_template_versions_template_version UNIQUE (template_id, version)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS render_template_assignments (
            id SERIAL PRIMARY KEY,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            entity_type VARCHAR(50) NOT NULL,
            entity_id INTEGER NOT NULL,
            level_key VARCHAR(120) NOT NULL DEFAULT '',
            template_id INTEGER NOT NULL REFERENCES render_templates(id) ON DELETE CASCADE,
            template_version_id INTEGER REFERENCES render_template_versions(id) ON DELETE SET NULL,
            priority INTEGER NOT NULL DEFAULT 100,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT uq_render_template_assignments_scope UNIQUE (owner_id, entity_type, entity_id, level_key)
        );
        """,
        """
        DO $$
        DECLARE
            default_category_id INTEGER;
        BEGIN
            INSERT INTO property_definitions (
                internal_name,
                display_name,
                data_type,
                description,
                default_value,
                is_required,
                is_system,
                dropdown_options
            ) VALUES
                ('render_template_key', 'Render Template Key', 'text', 'Primary metadata template key override', NULL, false, true, NULL),
                ('template_key', 'Template Key', 'text', 'Generic metadata template key override', NULL, false, true, NULL),
                ('level_template_key', 'Level Template Key', 'text', 'Template key for current level', NULL, false, true, NULL),
                ('content_template_key', 'Content Template Key', 'text', 'Template key for content rendering', NULL, false, true, NULL),
                ('source_language', 'Source Language', 'dropdown', 'Primary source language for this scope', '"sanskrit"'::jsonb, false, true, ARRAY['sanskrit','tamil','telugu','hindi','english']),
                ('is_transliterable', 'Is Transliterable', 'boolean', 'Whether transliteration should be shown', 'true'::jsonb, false, true, NULL),
                ('chapter_number', 'Chapter Number', 'number', 'Chapter number when applicable', NULL, false, true, NULL),
                ('verse_number', 'Verse Number', 'number', 'Verse number when applicable', NULL, false, true, NULL),
                ('sanskrit', 'Sanskrit', 'text', 'Sanskrit content value', NULL, false, true, NULL),
                ('transliteration', 'Transliteration', 'text', 'Transliteration content value', NULL, false, true, NULL),
                ('english', 'English', 'text', 'English content value', NULL, false, true, NULL),
                ('text', 'Text', 'text', 'Generic text content value', NULL, false, true, NULL)
            ON CONFLICT (internal_name)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                data_type = EXCLUDED.data_type,
                description = EXCLUDED.description,
                dropdown_options = EXCLUDED.dropdown_options,
                is_system = true;

            INSERT INTO categories (
                name,
                description,
                applicable_scopes,
                version,
                is_system,
                is_published
            ) VALUES (
                'system_default_metadata',
                'Baseline metadata category for current rendering and draft flows',
                ARRAY['book','level','node'],
                1,
                true,
                true
            )
            ON CONFLICT (name)
            DO UPDATE SET
                description = EXCLUDED.description,
                applicable_scopes = EXCLUDED.applicable_scopes,
                is_system = true;

            SELECT id INTO default_category_id
            FROM categories
            WHERE name = 'system_default_metadata';

            INSERT INTO category_properties (
                category_id,
                property_definition_id,
                "order",
                description_override,
                default_override,
                is_required_override
            )
            SELECT
                default_category_id,
                pd.id,
                mapping.property_order,
                NULL,
                NULL,
                NULL
            FROM (
                VALUES
                    ('render_template_key', 1),
                    ('template_key', 2),
                    ('level_template_key', 3),
                    ('content_template_key', 4),
                    ('source_language', 5),
                    ('is_transliterable', 6),
                    ('chapter_number', 7),
                    ('verse_number', 8),
                    ('sanskrit', 9),
                    ('transliteration', 10),
                    ('english', 11),
                    ('text', 12)
            ) AS mapping(internal_name, property_order)
            JOIN property_definitions pd ON pd.internal_name = mapping.internal_name
            WHERE default_category_id IS NOT NULL
            ON CONFLICT (category_id, property_definition_id)
            DO NOTHING;
        END
        $$;
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
        "CREATE INDEX IF NOT EXISTS idx_property_definitions_internal_name ON property_definitions(internal_name);",
        "CREATE INDEX IF NOT EXISTS idx_property_definitions_is_system ON property_definitions(is_system);",
        "CREATE INDEX IF NOT EXISTS idx_property_definitions_is_deprecated ON property_definitions(is_deprecated);",
        "CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);",
        "CREATE INDEX IF NOT EXISTS idx_categories_is_system ON categories(is_system);",
        "CREATE INDEX IF NOT EXISTS idx_categories_is_published ON categories(is_published);",
        "CREATE INDEX IF NOT EXISTS idx_categories_is_deprecated ON categories(is_deprecated);",
        "CREATE INDEX IF NOT EXISTS idx_category_properties_category_id ON category_properties(category_id);",
        "CREATE INDEX IF NOT EXISTS idx_category_properties_property_definition_id ON category_properties(property_definition_id);",
        "CREATE INDEX IF NOT EXISTS idx_metadata_bindings_entity_type ON metadata_bindings(entity_type);",
        "CREATE INDEX IF NOT EXISTS idx_metadata_bindings_entity_id ON metadata_bindings(entity_id);",
        "CREATE INDEX IF NOT EXISTS idx_metadata_bindings_root_entity_id ON metadata_bindings(root_entity_id);",
        "CREATE INDEX IF NOT EXISTS idx_metadata_bindings_scope_key ON metadata_bindings(scope_key);",
        "CREATE INDEX IF NOT EXISTS idx_metadata_bindings_category_id ON metadata_bindings(category_id);",
        "CREATE INDEX IF NOT EXISTS idx_metadata_bindings_scope_type ON metadata_bindings(scope_type);",
        "CREATE INDEX IF NOT EXISTS idx_category_parents_child_category_id ON category_parents(child_category_id);",
        "CREATE INDEX IF NOT EXISTS idx_category_parents_parent_category_id ON category_parents(parent_category_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_templates_owner_id ON render_templates(owner_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_templates_target_schema_id ON render_templates(target_schema_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_templates_target_level ON render_templates(target_level);",
        "CREATE INDEX IF NOT EXISTS idx_render_templates_visibility ON render_templates(visibility);",
        "CREATE INDEX IF NOT EXISTS idx_render_templates_is_system ON render_templates(is_system);",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_render_templates_system_key ON render_templates(system_key) WHERE system_key IS NOT NULL;",
        "CREATE INDEX IF NOT EXISTS idx_render_templates_is_active ON render_templates(is_active);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_versions_template_id ON render_template_versions(template_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_versions_created_by ON render_template_versions(created_by);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_assignments_owner_id ON render_template_assignments(owner_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_assignments_scope ON render_template_assignments(entity_type, entity_id, level_key);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_assignments_template_id ON render_template_assignments(template_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_assignments_template_version_id ON render_template_assignments(template_version_id);",
        "CREATE INDEX IF NOT EXISTS idx_render_template_assignments_is_active ON render_template_assignments(is_active);",
    ]

    try:
        with engine.begin() as conn:
            for sql in statements:
                conn.execute(text(sql))
    finally:
        engine.dispose()
