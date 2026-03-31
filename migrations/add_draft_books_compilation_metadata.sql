ALTER TABLE draft_books
  ADD COLUMN IF NOT EXISTS compilation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
