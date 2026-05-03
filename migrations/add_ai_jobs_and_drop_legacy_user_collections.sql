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