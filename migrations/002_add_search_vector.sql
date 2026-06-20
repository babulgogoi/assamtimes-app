-- Replaces the ILIKE-based search (full seq scan, ~1s) with indexed full-text search.
-- Title is weighted higher than body so title matches rank first.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_articles_search_vector ON articles USING GIN (search_vector);
