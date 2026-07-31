-- Email newsletter subscribers, separate from push_subscriptions (Web Push).
-- unsubscribe_token is the unguessable id used in unsubscribe links sent by
-- email, since the row's own serial id is unsuitable (sequential/guessable).
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  unsubscribe_token TEXT UNIQUE NOT NULL,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ
);
