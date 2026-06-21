const pool = require('../config/db');

async function getFooterHtml() {
  const { rows } = await pool.query('SELECT footer_html FROM site_settings WHERE id = 1');
  return rows[0] ? rows[0].footer_html : null;
}

async function updateFooterHtml(html) {
  await pool.query('UPDATE site_settings SET footer_html = $1 WHERE id = 1', [html]);
}

module.exports = {
  getFooterHtml,
  updateFooterHtml,
};
