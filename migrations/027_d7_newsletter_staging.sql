-- Staging table for the one-time D7 user → newsletter import + re-engagement
-- campaign. Kept separate from newsletter_subscribers so the import/send/bounce
-- lifecycle can be tracked and re-run idempotently without touching the live
-- subscriber list. Populated by scripts/028_extract_d7_users.js from the D7
-- MySQL dump; drained into newsletter_subscribers by 029; emailed by 030;
-- bounces reconciled by 031.

CREATE TABLE IF NOT EXISTS d7_newsletter_staging (
  id SERIAL PRIMARY KEY,
  uid INTEGER,
  username TEXT,
  email TEXT,
  status INTEGER,
  imported BOOLEAN DEFAULT false,
  import_skipped BOOLEAN DEFAULT false,
  skip_reason TEXT,
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMPTZ,
  bounced BOOLEAN DEFAULT false,
  bounced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS d7_staging_email_idx
  ON d7_newsletter_staging(email);
