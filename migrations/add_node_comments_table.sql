CREATE TABLE IF NOT EXISTS node_comments (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES node_comments(id) ON DELETE SET NULL,
    content_text TEXT NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'en',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_comments_node_id ON node_comments(node_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_parent_comment_id ON node_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_node_comments_created_by ON node_comments(created_by);
