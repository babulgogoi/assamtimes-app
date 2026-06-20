-- Static pages (replaces Drupal 7's "page" content type — About Us, Contact, etc).
-- Deliberately lighter than articles: no author/category/images/views.
CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  old_nid INT UNIQUE,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
