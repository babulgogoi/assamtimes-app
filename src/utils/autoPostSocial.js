const articlesModel = require('../models/articles');
const { postArticleToFacebook } = require('./facebook');
const { postArticleToTwitter } = require('./twitter');

// Shared by adminController.js's create/update flow (publish at save time)
// and scripts/publish-scheduled.js (publish at the scheduled time, via
// cron) — same auto-post behavior either way an article goes live.
async function autoPostToFacebook(articleData) {
  try {
    const ok = await postArticleToFacebook(articleData);
    if (ok) {
      await articlesModel.markFacebookPosted(articleData.id);
      return 'posted';
    }
    return 'failed';
  } catch (err) {
    console.error('Facebook auto-post threw for article', articleData.id, ':', err);
    return 'failed';
  }
}

// Same pattern as autoPostToFacebook, for X/Twitter. Returns null (no
// admin indicator shown at all) while TWITTER_ENABLED isn't 'true', since
// the account currently has no API credits — see src/utils/twitter.js.
async function autoPostToTwitter(articleData) {
  if (process.env.TWITTER_ENABLED !== 'true') {
    return null;
  }
  try {
    const ok = await postArticleToTwitter(articleData);
    if (ok) {
      await articlesModel.markTwitterPosted(articleData.id);
      return 'posted';
    }
    return 'failed';
  } catch (err) {
    console.error('Twitter auto-post threw for article', articleData.id, ':', err);
    return 'failed';
  }
}

module.exports = { autoPostToFacebook, autoPostToTwitter };
