ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS scriptures_book_browser_view VARCHAR(10) NOT NULL DEFAULT 'list',
ADD COLUMN IF NOT EXISTS scriptures_media_manager_view VARCHAR(10) NOT NULL DEFAULT 'list',
ADD COLUMN IF NOT EXISTS admin_media_bank_browser_view VARCHAR(10) NOT NULL DEFAULT 'list';
