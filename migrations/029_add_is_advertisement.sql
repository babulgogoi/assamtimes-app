-- Paid/advertorial article flag, same boolean-column pattern as
-- is_breaking/is_editors_pick. Flagged articles are excluded from
-- homepage/category/tag/search/sitemap/RSS listings but stay live at
-- their own /article/:slug URL (see src/models/articles.js).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_advertisement BOOLEAN NOT NULL DEFAULT false;
