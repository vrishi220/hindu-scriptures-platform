CREATE TABLE IF NOT EXISTS import_jobs (
  job_id VARCHAR(64) PRIMARY KEY,
  status VARCHAR(20) NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_json_url TEXT,
  canonical_book_code VARCHAR(255),
  payload_json JSONB NOT NULL,
  progress_message TEXT,
  progress_current INTEGER,
  progress_total INTEGER,
  error TEXT,
  result_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_requested_by ON import_jobs(requested_by);
CREATE INDEX IF NOT EXISTS idx_import_jobs_canonical_book_code ON import_jobs(canonical_book_code);
