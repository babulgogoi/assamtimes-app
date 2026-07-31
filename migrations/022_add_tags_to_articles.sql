-- Tags stored as a native Postgres array — simpler than a join table for
-- this app's scale, and the pg driver round-trips JS arrays <-> text[]
-- natively (confirmed working before this migration was relied on).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS articles_tags_idx ON articles USING GIN(tags);
