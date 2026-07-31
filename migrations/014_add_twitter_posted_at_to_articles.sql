-- Same pattern as fb_posted_at: tracks whether an article has already
-- been auto-posted to X/Twitter, so the publish-triggered post only ever
-- fires once per article.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS twitter_posted_at TIMESTAMPTZ;
