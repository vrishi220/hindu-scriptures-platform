CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS node_embeddings (
    id              SERIAL PRIMARY KEY,
    node_id         INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE,
    language_code   VARCHAR(20) NOT NULL,
    content_type    VARCHAR(50) NOT NULL,
    embedding       VECTOR(1536),
    model           VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(node_id, language_code, content_type)
);

CREATE INDEX IF NOT EXISTS idx_node_embeddings_vector
ON node_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_node_embeddings_node_lang
ON node_embeddings(node_id, language_code);
