-- One row per 5-star rating cast on the /accessibility page. A browser is
-- only allowed to see/cast one rating client-side (localStorage flag,
-- public/js/accessibility.js) — not abuse-proof, but consistent with the
-- comment form's honeypot-level defenses elsewhere in this app.
CREATE TABLE IF NOT EXISTS site_ratings (
  id SERIAL PRIMARY KEY,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT now()
);
