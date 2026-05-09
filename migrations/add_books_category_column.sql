-- Add a `category` column to books, populated from the well-known book_codes
-- so the redesign Library can group covers by category server-side instead of
-- relying on a client-side hardcoded map.

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS category VARCHAR(50);

UPDATE books SET category = CASE
  WHEN book_code IN (
    'bhagavad-gita-vedicscriptures', 'ashtavakra-gita',
    'avadhuta-gita', 'ribhu-gita'
  ) THEN 'gita'
  WHEN book_code IN (
    'rigveda', 'purusha-sukta', 'nasadiya-sukta'
  ) THEN 'veda'
  WHEN book_code IN (
    'valmiki-ramayana', 'bhagavata-purana',
    'yoga-vasishtha', 'mahabharata'
  ) THEN 'purana'
  WHEN book_code IN (
    'vishnu_sahasranama', 'lalita-sahasranama',
    'nirvana-shatkam', 'bhaja-govindam',
    'dasa-sloki', 'krishnashtakam'
  ) THEN 'stotra'
  ELSE 'upanishad'
END
WHERE category IS NULL;

CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
