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

-- Hierarchical content nodes
CREATE TABLE IF NOT EXISTS content_nodes (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  parent_node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
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
  source_attribution TEXT,
  license_type VARCHAR(100) DEFAULT 'CC-BY-SA-4.0',
  original_source_url TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  created_by INTEGER REFERENCES users(id),
  last_modified_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_nodes_book ON content_nodes(book_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_parent ON content_nodes(parent_node_id);

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