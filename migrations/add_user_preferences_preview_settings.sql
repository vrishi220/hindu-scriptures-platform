DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE NOTICE 'Skipping add_user_preferences_preview_settings.sql because table users does not exist yet.';
  ELSE
    CREATE TABLE IF NOT EXISTS user_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_language VARCHAR(10) NOT NULL DEFAULT 'en',
      transliteration_enabled BOOLEAN NOT NULL DEFAULT true,
      transliteration_script VARCHAR(50) NOT NULL DEFAULT 'devanagari',
      show_roman_transliteration BOOLEAN NOT NULL DEFAULT true,
      show_only_preferred_script BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_user_preferences_user_id UNIQUE (user_id)
    );

    ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS preview_show_titles BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS preview_show_labels BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS preview_show_details BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS preview_show_sanskrit BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS preview_show_transliteration BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS preview_show_english BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS preview_transliteration_script VARCHAR(50) NOT NULL DEFAULT 'iast';
  END IF;
END
$$;
