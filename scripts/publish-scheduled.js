// Flips any 'scheduled' article whose published_at has arrived to
// 'published', then auto-posts each one to Facebook/X same as a same-
// session admin publish (src/utils/autoPostSocial.js, shared with
// adminController.js). Meant to run on a minute-ly cron, not in-process —
// this app has no other background scheduler.
//
// Does NOT flush the app's in-memory homepage/category page cache
// (src/middleware/pageCache.js) — that cache lives in the PM2 process's
// own memory, a separate OS process from this script, so there's nothing
// here to flush even if it tried. A newly-published article shows up on
// the homepage/category pages within their normal 2-5min TTL regardless,
// same as any other publish would if the cache happened to be warm.
//
// Usage: node scripts/publish-scheduled.js
// Crontab: * * * * * cd /path/to/app && node scripts/publish-scheduled.js >> logs/publish-scheduled.log 2>&1
require('dotenv').config();

const pool = require('../src/config/db');
const articlesModel = require('../src/models/articles');
const { autoPostToFacebook, autoPostToTwitter } = require('../src/utils/autoPostSocial');

async function main() {
  const published = await articlesModel.publishDueScheduled();

  if (!published.length) {
    console.log(`[${new Date().toISOString()}] No scheduled articles due.`);
    return;
  }

  for (const article of published) {
    console.log(`[${new Date().toISOString()}] Published scheduled article ${article.id}: ${article.title}`);

    if (!article.fb_posted_at) {
      await autoPostToFacebook(article);
    }
    if (!article.twitter_posted_at) {
      await autoPostToTwitter(article);
    }
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('publish-scheduled failed:', err);
    pool.end();
    process.exitCode = 1;
  });
