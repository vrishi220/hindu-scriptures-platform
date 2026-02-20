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

CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_language VARCHAR(10) NOT NULL DEFAULT 'en',
  transliteration_enabled BOOLEAN NOT NULL DEFAULT true,
  transliteration_script VARCHAR(50) NOT NULL DEFAULT 'devanagari',
  show_roman_transliteration BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_user_preferences_user_id UNIQUE (user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compilation_status') THEN
    CREATE TYPE compilation_status AS ENUM ('draft', 'published');
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
  parent_node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_content_nodes_status ON content_nodes(status);
CREATE INDEX IF NOT EXISTS idx_content_nodes_visibility ON content_nodes(visibility);
CREATE INDEX IF NOT EXISTS idx_content_nodes_language ON content_nodes(language_code);
CREATE INDEX IF NOT EXISTS idx_content_nodes_book_status ON content_nodes(book_id, status);
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