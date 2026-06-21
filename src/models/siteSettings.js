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

module.exports = {
  getFooterHtml,
  updateFooterHtml,
  getFeaturedCategory,
  updateFeaturedCategory,
};
