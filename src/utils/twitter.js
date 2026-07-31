const { TwitterApi } = require('twitter-api-v2');

const TWEET_MAX_LENGTH = 280;
// Twitter counts any URL in tweet text as exactly 23 characters (t.co
// shortening) for the 280-char limit, regardless of the URL's real length.
const URL_COUNTED_LENGTH = 23;
const SEPARATOR = '\n\n';

// Auto-posts a newly-published article to X/Twitter. Failures are logged
// and never propagate — an outage must never block saving an article.
async function postArticleToTwitter(article) {
  // Temporarily disabled until X's paid API tier is activated (the account
  // currently has no credits — see HTTP 402 CreditsDepleted). Flip
  // TWITTER_ENABLED=true in .env to re-enable; everything else (schema,
  // trigger logic, this function) stays in place untouched.
  if (process.env.TWITTER_ENABLED !== 'true') {
    console.log('Twitter auto-post skipped: TWITTER_ENABLED is not "true".');
    return false;
  }

  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET } = process.env;

  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_TOKEN_SECRET) {
    console.error('Twitter auto-post skipped: TWITTER_* env vars not fully configured.');
    return false;
  }

  const url = `${process.env.SITE_URL}/article/${article.slug}`;
  const maxTitleLength = TWEET_MAX_LENGTH - SEPARATOR.length - URL_COUNTED_LENGTH;
  const title =
    article.title.length > maxTitleLength
      ? article.title.slice(0, maxTitleLength - 1) + '…'
      : article.title;
  const text = `${title}${SEPARATOR}${url}`;

  try {
    const client = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
    });
    await client.v2.tweet(text);
    return true;
  } catch (err) {
    console.error('Twitter auto-post failed for article', article.id, ':', err);
    return false;
  }
}

module.exports = { postArticleToTwitter };
