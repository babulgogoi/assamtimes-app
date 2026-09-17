-- Soft-delete for articles: deleting one now sets deleted_at instead of
-- removing the row, so its full row + article_revisions history survives
-- and it's restorable the same way as any other revision (see
-- src/models/articleRevisions.js). Public-facing queries in
-- src/models/articles.js filter WHERE deleted_at IS NULL alongside their
-- existing status='published' check; admin fetches (getById) intentionally
-- do NOT filter on it, so the edit page can still show a deleted article's
-- history and offer to restore it.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_articles_deleted_at ON articles(deleted_at) WHERE deleted_at IS NOT NULL;
