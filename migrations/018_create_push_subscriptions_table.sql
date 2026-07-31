-- Browser push notification subscriptions (Web Push API). One row per
-- subscribed browser/device — endpoint is the unique identifier the
-- browser assigns to that subscription, p256dh/auth are the two keys
-- needed to encrypt a push payload when actually sending one later.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
