-- Mirror-style standfirst/deck, displayed between the title and byline on
-- the article page. Nullable — not every article needs one.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS subheadline TEXT;
