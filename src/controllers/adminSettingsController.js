const siteSettingsModel = require('../models/siteSettings');
const { homepageCache, categoryPageCache } = require('../routes/public');
const { purgeEverything } = require('../utils/cloudflarePurge');

async function editSettingsForm(req, res, next) {
  try {
    const [footerHtml, featuredCategory, sectionDesigns] = await Promise.all([
      siteSettingsModel.getFooterHtml(),
      siteSettingsModel.getFeaturedCategory(),
      siteSettingsModel.getSectionDesigns(),
    ]);
    res.locals.layout = 'admin/layout';
    res.render('admin/settings/form', {
      title: 'Settings — Admin',
      authorName: req.session.authorName,
      footerHtml,
      featuredCategory,
      sectionDesigns,
      cachePurged: req.query.cachePurged === '1',
      cfPurged: req.query.cfPurged === '1',
      cfPurgeError: req.query.cfPurgeError === '1',
    });
  } catch (err) {
    next(err);
  }
}

// Clears only the app's own in-memory page cache (homepage/category HTML,
// src/middleware/pageCache.js) — separate from, and doesn't touch, the
// Cloudflare edge cache in front of the site (see CLAUDE.md). That still
// needs a manual purge from the Cloudflare dashboard.
async function purgeCache(req, res, next) {
  try {
    homepageCache.flush();
    categoryPageCache.flush();
    res.redirect('/admin/settings?cachePurged=1');
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    await Promise.all([
      siteSettingsModel.updateFooterHtml(req.body.footer_html || ''),
      siteSettingsModel.updateFeaturedCategory((req.body.featured_category || '').trim() || 'Features'),
    ]);
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
}

// Latest News/Features/Editor's Picks/Hero/Article design ('A'/'B',
// anything else falls back to 'A') plus the Latest News Design-B tab list.
// Editor's Picks has no Design B implementation — the value just
// round-trips (see home.ejs, which never branches on it), kept only
// because Part 1 of the brief asked for the column to exist. Hero Design B
// replaces the top-of-homepage section entirely (see home.ejs) — it's
// independent of, not layered on top of, design_latest_news. Article
// Design B similarly replaces the whole article-page layout (see
// article.ejs), independent of the homepage toggles.
async function updateSectionDesigns(req, res, next) {
  try {
    const latestNews = req.body.design_latest_news === 'B' ? 'B' : 'A';
    const features = req.body.design_features === 'B' ? 'B' : 'A';
    const editorsPicks = req.body.design_editors_picks === 'B' ? 'B' : 'A';
    const hero = req.body.design_hero === 'B' ? 'B' : 'A';
    const article = req.body.design_article === 'B' ? 'B' : 'A';

    const rawTabs = (req.body.latestnews_tabs || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // 'All' (no category filter) must always be selectable, even if the
    // admin's typed list omits it.
    const tabs = rawTabs.includes('All') ? rawTabs : ['All', ...rawTabs];
    const latestnewsTabs = (tabs.length ? tabs : ['All']).join(',');

    // Homepage embed widget — same form, saved together with the rest of
    // these settings rather than a separate POST route/handler.
    const homepageEmbedHtml = req.body.homepage_embed_html || '';
    const homepageEmbedEnabled = req.body.homepage_embed_enabled === 'on';

    await siteSettingsModel.updateSectionDesigns({
      latestNews, features, editorsPicks, hero, article, latestnewsTabs,
      homepageEmbedHtml, homepageEmbedEnabled,
    });
    // The homepage is cached up to 2 minutes (src/middleware/pageCache.js) —
    // a design change should be visible on the very next load, not after a
    // stale-cache wait, so flush it here same as article publish/edit does.
    homepageCache.flush();
    // The app-level flush above only fixes the origin's own copy — Cloudflare's
    // edge cache (up to 24h per-node, see CLAUDE.md) is a separate layer with
    // no automatic purge on settings saves, unlike article create/update/delete
    // which already call purgeArticle(). Without this, different CF edge nodes
    // can serve inconsistent Design A/B versions of the homepage for hours.
    // Fire-and-forget, same pattern as the article purge calls — a slow/failed
    // CF request must never delay this redirect.
    purgeEverything().catch((e) => console.error('[CF Purge] section-designs error:', e));
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
}

async function purgeCloudflareCacheManual(req, res, next) {
  try {
    const success = await purgeEverything();
    if (success) {
      res.redirect('/admin/settings?cfPurged=1');
    } else {
      res.redirect('/admin/settings?cfPurgeError=1');
    }
  } catch (err) {
    next(err);
  }
}

module.exports = {
  editSettingsForm,
  updateSettings,
  updateSectionDesigns,
  purgeCache,
  purgeCloudflareCacheManual,
};
