-- Tracks whether each subscriber has actually been pushed to the SendPulse
-- addressbook, so a retry job can find and resync the ones that failed
-- (or, for existing rows, were never attempted at all — defaulting to
-- false here is correct, not just a placeholder, since every row already
-- in this table predates a working SENDPULSE_ADDRESSBOOK_ID env var).
ALTER TABLE newsletter_subscribers
  ADD COLUMN sendpulse_synced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN sendpulse_synced_at TIMESTAMPTZ;

CREATE INDEX ON newsletter_subscribers (sendpulse_synced) WHERE status = 'active';
