-- Junction table for co-authors (photographers, translators, editors).
-- The primary author stays in articles.author_id, unchanged.
CREATE TABLE IF NOT EXISTS article_authors (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'contributor',
  sort_order INTEGER DEFAULT 0,
  UNIQUE(article_id, author_id)
);

CREATE INDEX IF NOT EXISTS article_authors_article_id_idx ON article_authors(article_id);
CREATE INDEX IF NOT EXISTS article_authors_author_id_idx ON article_authors(author_id);

-- Role options: 'contributor', 'photographer', 'translator', 'editor'
