-- Tracks whether an article has already been auto-posted to the Facebook
-- Page, so the publish-triggered post only ever fires once per article
-- (even across an unpublish/republish cycle) rather than on every save.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS fb_posted_at TIMESTAMPTZ;
