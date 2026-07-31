-- Matches existing column conventions: is_editors_pick is BOOLEAN NOT NULL
-- DEFAULT false, and published_at/updated_at are TIMESTAMP WITH TIME ZONE
-- (not plain TIMESTAMP) — same here for consistency.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_breaking BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS breaking_expires_at TIMESTAMP WITH TIME ZONE;
