ALTER TABLE books
  ADD COLUMN IF NOT EXISTS level_name_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
