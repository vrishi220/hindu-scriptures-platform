-- Core users + auth
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE,
  password_hash VARCHAR(255),
  full_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'viewer',
  permissions JSONB DEFAULT '{
    "can_view": true,
    "can_contribute": false,
    "can_edit": false,
    "can_moderate": false,
    "can_admin": false
  }'::jsonb,
  oauth_provider VARCHAR(50),
  oauth_id VARCHAR(255),
  contribution_count INTEGER DEFAULT 0,
  approved_count INTEGER DEFAULT 0,
  reputation_score INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id
  ON email_verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at
  ON email_verification_tokens(expires_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_language VARCHAR(10) NOT NULL DEFAULT 'en',
  transliteration_enabled BOOLEAN NOT NULL DEFAULT true,
  transliteration_script VARCHAR(50) NOT NULL DEFAULT 'devanagari',
  show_roman_transliteration BOOLEAN NOT NULL DEFAULT true,
  show_only_preferred_script BOOLEAN NOT NULL DEFAULT false,
  preview_show_titles BOOLEAN NOT NULL DEFAULT false,
  preview_show_labels BOOLEAN NOT NULL DEFAULT false,
  preview_show_details BOOLEAN NOT NULL DEFAULT false,
  preview_show_media BOOLEAN NOT NULL DEFAULT true,
  preview_show_sanskrit BOOLEAN NOT NULL DEFAULT true,
  preview_show_transliteration BOOLEAN NOT NULL DEFAULT true,
  preview_show_english BOOLEAN NOT NULL DEFAULT true,
  preview_show_commentary BOOLEAN NOT NULL DEFAULT true,
  preview_transliteration_script VARCHAR(50) NOT NULL DEFAULT 'iast',
  preview_word_meanings_display_mode VARCHAR(10) NOT NULL DEFAULT 'inline',
  scriptures_book_browser_view VARCHAR(10) NOT NULL DEFAULT 'list',
  scriptures_book_browser_density INTEGER NOT NULL DEFAULT 0,
  scriptures_media_manager_view VARCHAR(10) NOT NULL DEFAULT 'list',
  scriptures_media_manager_density INTEGER NOT NULL DEFAULT 0,
  admin_media_bank_browser_view VARCHAR(10) NOT NULL DEFAULT 'list',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_user_preferences_user_id UNIQUE (user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compilation_status') THEN
    CREATE TYPE compilation_status AS ENUM ('draft', 'published');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draft_book_status') THEN
    CREATE TYPE draft_book_status AS ENUM ('draft', 'published');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_data_type') THEN
    CREATE TYPE property_data_type AS ENUM ('text', 'boolean', 'number', 'dropdown', 'date', 'datetime');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metadata_scope_type') THEN
    CREATE TYPE metadata_scope_type AS ENUM ('global', 'book', 'level', 'node');
  END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS idx_compilations_creator ON compilations(creator_id);
CREATE INDEX IF NOT EXISTS idx_compilations_status ON compilations(status);
CREATE INDEX IF NOT EXISTS idx_compilations_public_published_created_at
  ON compilations(created_at DESC)
  WHERE is_public = true AND status = 'published';

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

CREATE TABLE IF NOT EXISTS edition_snapshots (
  id SERIAL PRIMARY KEY,
  draft_book_id INTEGER NOT NULL REFERENCES draft_books(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  immutable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_draft_books_owner_id ON draft_books(owner_id);
CREATE INDEX IF NOT EXISTS idx_draft_books_status ON draft_books(status);
CREATE INDEX IF NOT EXISTS idx_edition_snapshots_draft_book_id ON edition_snapshots(draft_book_id);
CREATE INDEX IF NOT EXISTS idx_edition_snapshots_owner_id ON edition_snapshots(owner_id);

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

CREATE TABLE IF NOT EXISTS category_parents (
  id SERIAL PRIMARY KEY,
  child_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  parent_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  precedence_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uc_category_parent_edge UNIQUE (child_category_id, parent_category_id)
);

CREATE INDEX IF NOT EXISTS idx_property_definitions_internal_name ON property_definitions(internal_name);
CREATE INDEX IF NOT EXISTS idx_property_definitions_is_system ON property_definitions(is_system);
CREATE INDEX IF NOT EXISTS idx_property_definitions_is_deprecated ON property_definitions(is_deprecated);
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_categories_is_system ON categories(is_system);
CREATE INDEX IF NOT EXISTS idx_categories_is_published ON categories(is_published);
CREATE INDEX IF NOT EXISTS idx_categories_is_deprecated ON categories(is_deprecated);
CREATE INDEX IF NOT EXISTS idx_category_properties_category_id ON category_properties(category_id);
CREATE INDEX IF NOT EXISTS idx_category_properties_property_definition_id ON category_properties(property_definition_id);
CREATE INDEX IF NOT EXISTS idx_metadata_bindings_entity_type ON metadata_bindings(entity_type);
CREATE INDEX IF NOT EXISTS idx_metadata_bindings_entity_id ON metadata_bindings(entity_id);
CREATE INDEX IF NOT EXISTS idx_metadata_bindings_root_entity_id ON metadata_bindings(root_entity_id);
CREATE INDEX IF NOT EXISTS idx_metadata_bindings_scope_key ON metadata_bindings(scope_key);
CREATE INDEX IF NOT EXISTS idx_metadata_bindings_category_id ON metadata_bindings(category_id);
CREATE INDEX IF NOT EXISTS idx_metadata_bindings_scope_type ON metadata_bindings(scope_type);
CREATE INDEX IF NOT EXISTS idx_category_parents_child_category_id ON category_parents(child_category_id);
CREATE INDEX IF NOT EXISTS idx_category_parents_parent_category_id ON category_parents(parent_category_id);

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

CREATE INDEX IF NOT EXISTS idx_provenance_target_book_id ON provenance_records(target_book_id);
CREATE INDEX IF NOT EXISTS idx_provenance_target_node_id ON provenance_records(target_node_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source_book_id ON provenance_records(source_book_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source_node_id ON provenance_records(source_node_id);

-- Scripture schema templates
CREATE TABLE IF NOT EXISTS scripture_schemas (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  levels JSONB NOT NULL, -- e.g., ["Parva","Upa Parva","Adhyaya","Shloka"]
  created_at TIMESTAMP DEFAULT NOW()
);

-- Books (instances of scriptures)
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  schema_id INTEGER REFERENCES scripture_schemas(id),
  book_name VARCHAR(255) NOT NULL,
  book_code VARCHAR(100) UNIQUE,
  language_primary VARCHAR(50) DEFAULT 'sanskrit',
  metadata JSONB DEFAULT '{}'::jsonb,
  level_name_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  variant_authors JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_book_shares_book_id ON book_shares(book_id);
CREATE INDEX IF NOT EXISTS idx_book_shares_shared_with_user_id ON book_shares(shared_with_user_id);

-- Hierarchical content nodes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_status') THEN
    CREATE TYPE content_status AS ENUM ('draft', 'published', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_visibility') THEN
    CREATE TYPE content_visibility AS ENUM ('private', 'draft', 'published', 'archived');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS content_nodes (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  parent_node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  referenced_node_id INTEGER REFERENCES content_nodes(id) ON DELETE SET NULL,
  level_name VARCHAR(100) NOT NULL, -- e.g., "Adhyaya"
  level_order INTEGER NOT NULL, -- depth
  sequence_number VARCHAR(50), -- within parent (e.g., "1", "1.34", "2-5")
  title_sanskrit TEXT,
  title_transliteration TEXT,
  title_english TEXT,
  title_hindi TEXT,
  title_tamil TEXT,
  has_content BOOLEAN DEFAULT false,
  content_data JSONB DEFAULT '{}'::jsonb,
  summary_data JSONB DEFAULT '{}'::jsonb,
  metadata_json JSONB DEFAULT '{}'::jsonb,
  source_attribution TEXT,
  license_type VARCHAR(100) DEFAULT 'CC-BY-SA-4.0',
  original_source_url TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  status content_status NOT NULL DEFAULT 'published',
  visibility content_visibility NOT NULL DEFAULT 'published',
  language_code VARCHAR(10) NOT NULL DEFAULT 'en',
  collaborators JSONB NOT NULL DEFAULT '[]'::jsonb,
  version_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_vector TSVECTOR,
  created_by INTEGER REFERENCES users(id),
  last_modified_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_nodes_book ON content_nodes(book_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_parent ON content_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_referenced_node_id ON content_nodes(referenced_node_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_status ON content_nodes(status);
CREATE INDEX IF NOT EXISTS idx_content_nodes_visibility ON content_nodes(visibility);
CREATE INDEX IF NOT EXISTS idx_content_nodes_language ON content_nodes(language_code);
CREATE INDEX IF NOT EXISTS idx_content_nodes_book_status ON content_nodes(book_id, status);
CREATE INDEX IF NOT EXISTS idx_content_nodes_book_parent ON content_nodes(book_id, parent_node_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_book_level_order_id ON content_nodes(book_id, level_order, id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_created_by ON content_nodes(created_by);
CREATE INDEX IF NOT EXISTS idx_content_nodes_metadata_gin ON content_nodes USING GIN (metadata_json);
CREATE INDEX IF NOT EXISTS idx_content_nodes_tags_gin ON content_nodes USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_content_nodes_search_gin ON content_nodes USING GIN (search_vector);

-- Media attachments
CREATE TABLE IF NOT EXISTS media_files (
  id SERIAL PRIMARY KEY,
  node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
  media_type VARCHAR(50) NOT NULL, -- audio/video/image
  url TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_files_node_id ON media_files(node_id);

CREATE TABLE IF NOT EXISTS media_assets (
  id SERIAL PRIMARY KEY,
  media_type VARCHAR(50) NOT NULL,
  url TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_media_type ON media_assets(media_type);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at DESC);

-- Contributions
CREATE TABLE IF NOT EXISTS contributions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  node_id INTEGER REFERENCES content_nodes(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending/approved/rejected
  payload JSONB NOT NULL,
  reviewer_id INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contributions_node_id ON contributions(node_id);

-- User collections
CREATE TABLE IF NOT EXISTS user_collections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_items (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER REFERENCES user_collections(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_items_node_id ON collection_items(node_id);

-- Search analytics
CREATE TABLE IF NOT EXISTS search_queries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  query_text TEXT NOT NULL,
  filters JSONB,
  results_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Full-text search indexes (Sanskrit + transliteration + English translation)
CREATE INDEX IF NOT EXISTS idx_sanskrit_search ON content_nodes
USING GIN (to_tsvector('simple', content_data->'basic'->>'sanskrit'));

CREATE INDEX IF NOT EXISTS idx_transliteration_search ON content_nodes
USING GIN (to_tsvector('english', content_data->'basic'->>'transliteration'));

CREATE INDEX IF NOT EXISTS idx_translation_search ON content_nodes
USING GIN (to_tsvector('english', content_data->'translations'->>'english'));

-- Collection Cart (v0.3: Editor's shopping basket for items before assembly)
CREATE TABLE IF NOT EXISTS collection_carts (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) DEFAULT 'My Collection',
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_carts_owner ON collection_carts(owner_id);

-- Collection Cart Items
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

CREATE INDEX IF NOT EXISTS idx_collection_cart_items_cart ON collection_cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_collection_cart_items_item ON collection_cart_items(item_id, item_type);