-- Audit trail / version history for articles. Stores a JSON delta of only
-- the fields that changed per event, not a full row snapshot each time
-- (except the 'create' action, which is the base version every later
-- revision's forward-replay reconstructs from) — see src/models/
-- articleRevisions.js for the diffing/reconstruction logic and
-- ARTICLE_REVISIONS.md-equivalent notes there on why a JSON delta was
-- chosen over a text-diff library (low re-edit frequency + modest average
-- body size measured directly against this DB before building this).
CREATE TABLE IF NOT EXISTS article_revisions (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  changed_by INTEGER REFERENCES authors(id),
  changes JSONB NOT NULL DEFAULT '{}',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_revisions_article_id ON article_revisions(article_id, created_at);
CREATE INDEX IF NOT EXISTS idx_article_revisions_changed_by ON article_revisions(changed_by);
CREATE INDEX IF NOT EXISTS idx_article_revisions_action ON article_revisions(action);
CREATE INDEX IF NOT EXISTS idx_article_revisions_created_at ON article_revisions(created_at DESC);
