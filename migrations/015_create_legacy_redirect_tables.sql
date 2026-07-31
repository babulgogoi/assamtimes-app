-- Backs the legacy D7 URL redirect for /taxonomy/term/:tid — populated by
-- private/migration/migrate-legacy-redirects.js from the still-live D7
-- MySQL import, not by the app itself.
CREATE TABLE IF NOT EXISTS legacy_taxonomy_terms (
  tid INT PRIMARY KEY,
  category TEXT NOT NULL
);
