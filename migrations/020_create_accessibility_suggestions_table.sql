-- Free-text suggestions submitted from the /accessibility page's
-- "suggest a feature" form. No status workflow (unlike comments) — admin
-- just reviews and deletes, nothing is shown publicly.
CREATE TABLE IF NOT EXISTS accessibility_suggestions (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
