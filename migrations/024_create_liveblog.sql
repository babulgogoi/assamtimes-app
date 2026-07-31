-- Live blog flag on articles — a live blog is just an article with a
-- timeline of timestamped updates attached, not a parallel content type.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_liveblog BOOLEAN DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS liveblog_status VARCHAR(20) DEFAULT 'ended';
-- liveblog_status: 'live', 'ended'

CREATE TABLE IF NOT EXISTS liveblog_entries (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author_id INTEGER REFERENCES authors(id),
  is_pinned BOOLEAN DEFAULT false,
  is_key_event BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS liveblog_entries_article_id_idx ON liveblog_entries(article_id);
CREATE INDEX IF NOT EXISTS liveblog_entries_created_at_idx ON liveblog_entries(created_at DESC);
