-- Adds login credentials directly to the authors table (login model == byline model).
-- An author can log into /admin only once password_hash is set; NULL means byline-only.
ALTER TABLE authors ADD COLUMN IF NOT EXISTS password_hash text;
