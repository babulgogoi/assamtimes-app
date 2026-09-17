const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const publicController = require('../controllers/publicController');
const newsletterController = require('../controllers/newsletterController');
const accessibilityController = require('../controllers/accessibilityController');
const pdfController = require('../controllers/pdfController');
const menuItemsModel = require('../models/menuItems');
const siteSettingsModel = require('../models/siteSettings');
const articlesModel = require('../models/articles');
const { thumbUrl, largeUrl, articleImageUrl, mobileHeroUrl, mobileThumbUrl } = require('../utils/imageVariants');
const { createPageCache } = require('../middleware/pageCache');

const homepageCache = createPageCache(2 * 60, 'homepage');
const categoryPageCache = createPageCache(5 * 60, 'category');

const likeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many comments submitted. Please try again later.',
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many search requests. Please try again later.',
});

const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

const accessibilitySuggestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

const ratingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

// CPU-intensive (spawns a headless Chromium page render per request) —
// limited harder than the read-only routes above.
const pdfLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many PDF requests. Please try again later.',
});

// Infinite-scroll endpoints (public/js/infinite-scroll.js). /inline re-runs
// articleDetail's full query fan-out per request, so it's capped closer to
// pdfLimiter than the plain read-only routes above — fast scrolling or a
// bot walking the chain shouldn't be able to hammer this any harder than a
// real reader's session (capped client-side at a few auto-loads anyway, see
// infinite-scroll.js). /view is cheap (one UPDATE) but shares the same
// limiter for simplicity — both are only ever called from the same feature.
const inlineArticleLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

// No layout/menu/footer needed for an XML response — keep this above the
// shared middleware below so it skips that work entirely.
router.get('/sitemap.xml', publicController.sitemapXml);
// Same reasoning — this sends a raw PDF/error-HTML response directly, never
// res.render()s a template, so the shared middleware's menuItems/footerHtml/
// categories queries below would be pure waste for this route.
router.get('/article/:slug/pdf', pdfLimiter, pdfController.downloadPdf);
// Polling endpoint for the live blog auto-refresh — JSON only, same
// "skip the template-only shared middleware" reasoning as above.
router.get('/api/liveblog/:articleId/entries', publicController.liveblogEntriesApi);
// Latest News Design-B AJAX tabs — JSON only, same reasoning.
router.get('/api/latest-news', publicController.latestNewsApi);

router.use(async (req, res, next) => {
  // Every ad-rendering spot (the adsbygoogle.js loader + page-level-ads push
  // in layout.ejs, and all 3 ads-*.ejs partials) already gates on
  // adsenseClientId being truthy — so flipping ADSENSE_ENABLED off here is
  // enough to disable every ad slot sitewide with one change, same
  // TWITTER_ENABLED-style toggle as src/utils/twitter.js.
  res.locals.adsenseClientId = process.env.ADSENSE_ENABLED === 'true' ? process.env.ADSENSE_CLIENT_ID : '';
  res.locals.adsenseSlotHeader = process.env.ADSENSE_SLOT_HEADER;
  res.locals.adsenseSlotSidebar = process.env.ADSENSE_SLOT_SIDEBAR;
  res.locals.adsenseSlotInArticle = process.env.ADSENSE_SLOT_IN_ARTICLE;
  // Safe to expose — this is the public half of the VAPID key pair, used
  // client-side by push.js to subscribe. Undefined/empty if not
  // configured, which push.js treats as "feature not available".
  res.locals.vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  // Site-wide (not just article pages, where articleDetail already sets
  // this on its own render call too — same value, harmless overlap) so
  // layout.ejs can skip loading Google Analytics for any logged-in
  // admin/author session browsing the public site, not just the /admin/*
  // backend (which never shares this layout at all).
  res.locals.isAdmin = !!(req.session && req.session.authorId);
  // Default canonical for any page that doesn't set a more specific one
  // itself (e.g. articleDetail builds its own without query params).
  res.locals.canonicalUrl = process.env.SITE_URL + req.path;
  res.locals.thumbUrl = thumbUrl;
  res.locals.largeUrl = largeUrl;
  res.locals.articleImageUrl = articleImageUrl;
  res.locals.mobileHeroUrl = mobileHeroUrl;
  res.locals.mobileThumbUrl = mobileThumbUrl;
  // Not a full site.* white-label refactor (that's a separate, deferred
  // task) — just one configurable link for the mega menu's Follow Us column.
  res.locals.siteFacebookUrl = process.env.SITE_FACEBOOK_URL || '';
  try {
    res.locals.menuItems = await menuItemsModel.getActiveOrdered();
    res.locals.footerHtml = await siteSettingsModel.getFooterHtml();
    res.locals.breakingArticles = await articlesModel.getBreakingNews();
    // Used by the mega menu's Categories column — fetched fresh on every
    // request (not cached) since it's cheap and new categories should
    // appear immediately, same reasoning as menuItems above.
    res.locals.categories = await articlesModel.getDistinctPublishedCategories();
  } catch (err) {
    return next(err);
  }
  next();
});

router.get('/', homepageCache, publicController.home);
router.get('/news', publicController.newsPage);
router.get('/most-read', publicController.mostReadPage);
router.get('/article/:slug', publicController.articleDetail);
router.get('/article/:slug/inline', inlineArticleLimiter, publicController.articleInline);
router.post('/article/:slug/view', inlineArticleLimiter, publicController.articleMarkViewed);
router.post('/article/:slug/like', likeLimiter, publicController.likeArticle);
router.post('/article/:slug/comments', commentLimiter, publicController.submitComment);
router.get('/category/:category', categoryPageCache, publicController.categoryPage);
router.get('/tag/:tag', publicController.tagPage);
router.get('/on-this-day', publicController.onThisDayPage);
router.get('/author/:username', publicController.authorPage);
// Legacy Drupal 7 profile URLs — redirect to the new author page.
router.get('/user/:uid', publicController.legacyUserRedirect);
router.get('/user/:uid/edit', publicController.legacyUserRedirect);
router.get('/user/:uid/view', publicController.legacyUserRedirect);
// Legacy Drupal 7 URLs — node/:id and content/:slug are already handled by
// src/middleware/redirects.js (the `redirects` table, populated at migration
// time). Everything else that's not a base D7 taxonomy path (file paths,
// /node/:id/edit etc., search) falls through to the global 404->home
// redirect in server.js rather than getting its own handler.
//
// Pretty top-level category aliases from D7's url_alias table (e.g.
// taxonomy/term/23 -> "region") — checked directly against
// src/constants/categories.js, see legacyCategoryAliasRedirect.
router.get(
  ['/hot-news', '/region', '/politics', '/business', '/editorial', '/society',
   '/development', '/blog', '/features', '/sports', '/lifestyle'],
  publicController.legacyCategoryAliasRedirect
);
router.get('/taxonomy/term/:tid', publicController.legacyTaxonomyRedirect);
router.get('/taxonomy/term/:tid/all', publicController.legacyTaxonomyRedirect);
router.get('/taxonomy/term/:tid/all/feed', publicController.legacyTaxonomyRedirect);
router.get('/search', searchLimiter, publicController.searchPage);
router.get('/subscribe', publicController.subscribePage);
router.post('/newsletter/subscribe', newsletterLimiter, newsletterController.subscribe);
router.get('/newsletter/unsubscribe', newsletterController.unsubscribe);
router.get('/accessibility', accessibilityController.accessibilityPage);
router.post('/accessibility/suggest', accessibilitySuggestLimiter, accessibilityController.submitSuggestion);
router.post('/accessibility/rate', ratingLimiter, accessibilityController.submitRating);
router.get('/page/:slug', publicController.pageDetail);

module.exports = router;
// Exposed so adminController can invalidate the homepage cache when an
// article is published — see comment there for exactly when that fires.
module.exports.homepageCache = homepageCache;
// Exposed so the admin "Purge Cache" button (adminSettingsController)
// can clear both in-memory page caches on demand.
module.exports.categoryPageCache = categoryPageCache;
