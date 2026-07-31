-- Public comments on articles. Backfilled from D7's comment +
-- field_data_comment_body tables (3,888 approved rows), then grows via the
-- public comment form. author_email/ip_address are for moderation/spam
-- tracking only — author_email must never be rendered on public pages.
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  article_id INT REFERENCES articles(id) ON DELETE CASCADE,
  old_cid INT UNIQUE,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_article_status ON comments(article_id, status);
