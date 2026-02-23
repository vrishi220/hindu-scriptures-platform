-- Migration: Persist user preference to show only preferred script
-- Safe for existing environments where schema bootstrap is not executed.

BEGIN;

ALTER TABLE IF EXISTS user_preferences
  ADD COLUMN IF NOT EXISTS show_only_preferred_script BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_preferences.show_only_preferred_script IS
  'When true, UI should render only primary content in the preferred script and hide alternate renderings.';

COMMIT;
