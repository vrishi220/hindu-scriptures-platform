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
