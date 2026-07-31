const pool = require('../config/db');

async function getFooterHtml() {
  const { rows } = await pool.query('SELECT footer_html FROM site_settings WHERE id = 1');
  return rows[0] ? rows[0].footer_html : null;
}

async function updateFooterHtml(html) {
  await pool.query('UPDATE site_settings SET footer_html = $1 WHERE id = 1', [html]);
}

async function getFeaturedCategory() {
  const { rows } = await pool.query('SELECT featured_category FROM site_settings WHERE id = 1');
  return rows[0] ? rows[0].featured_category : 'Features';
}

async function updateFeaturedCategory(category) {
  await pool.query('UPDATE site_settings SET featured_category = $1 WHERE id = 1', [category]);
}

const DEFAULT_LATESTNEWS_TABS = 'All,Latest News,Politics,Society,Development,Sports,Business';

// Homepage section design switcher (Latest News / Features / Editor's Picks
// each independently 'A' or 'B') plus the Latest News Design-B tab list.
// design_editors_picks has no Design B implementation yet — it's read/written
// here for completeness but nothing branches on it (see home.ejs).
async function getSectionDesigns() {
  const { rows } = await pool.query(
    `SELECT design_latest_news, design_features, design_editors_picks, design_hero, design_article,
            latestnews_tabs, homepage_embed_html, homepage_embed_enabled
     FROM site_settings WHERE id = 1`
  );
  const row = rows[0] || {};
  const tabsRaw = row.latestnews_tabs || DEFAULT_LATESTNEWS_TABS;
  return {
    latestNews: row.design_latest_news === 'B' ? 'B' : 'A',
    features: row.design_features === 'B' ? 'B' : 'A',
    editorsPicks: row.design_editors_picks === 'B' ? 'B' : 'A',
    hero: row.design_hero === 'B' ? 'B' : 'A',
    article: row.design_article === 'B' ? 'B' : 'A',
    latestnewsTabsRaw: tabsRaw,
    latestnewsTabs: tabsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    // homepage_embed_enabled is a real Postgres boolean column (not text
    // like the design_* switches above), so the pg driver already hands
    // back a native JS boolean — no 'true'-string comparison needed.
    homepageEmbedHtml: row.homepage_embed_html || '',
    homepageEmbedEnabled: !!row.homepage_embed_enabled,
  };
}

async function updateSectionDesigns({
  latestNews, features, editorsPicks, hero, article, latestnewsTabs,
  homepageEmbedHtml, homepageEmbedEnabled,
}) {
  await pool.query(
    `UPDATE site_settings
     SET design_latest_news = $1, design_features = $2, design_editors_picks = $3, design_hero = $4, design_article = $5,
         latestnews_tabs = $6, homepage_embed_html = $7, homepage_embed_enabled = $8
     WHERE id = 1`,
    [latestNews, features, editorsPicks, hero, article, latestnewsTabs, homepageEmbedHtml, !!homepageEmbedEnabled]
  );
}

module.exports = {
  getFooterHtml,
  updateFooterHtml,
  getFeaturedCategory,
  updateFeaturedCategory,
  getSectionDesigns,
  updateSectionDesigns,
  DEFAULT_LATESTNEWS_TABS,
};
