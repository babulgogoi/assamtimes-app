// One-off cleanup aid: lists articles with mis-encoded text (double-encoded
// UTF-8 from the D7 migration, e.g. "Ã¢â‚¬â€œ" instead of "–") so they can be
// found and fixed by hand via the normal admin editor.
// Usage: node scripts/generate-encoding-report.js
// Re-run any time to regenerate the page as articles get fixed.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const MARKERS = ['%Ã%', '%â€%', '%Â%'];

async function main() {
  const where = MARKERS.map((_, i) => `title LIKE $${i + 1}`).join(' OR ');
  const bodyWhere = MARKERS.map((_, i) => `body LIKE $${i + 1}`).join(' OR ');

  const { rows } = await pool.query(
    `SELECT id, slug, title, category,
            (${where}) AS title_affected,
            (${bodyWhere}) AS body_affected
     FROM articles
     WHERE (${where}) OR (${bodyWhere})
     ORDER BY id`,
    MARKERS
  );

  const escapeHtml = (s) =>
    String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const rowsHtml = rows
    .map((a) => {
      const fields = [a.title_affected && 'title', a.body_affected && 'body'].filter(Boolean).join(', ');
      return `
      <tr>
        <td>${a.id}</td>
        <td>${escapeHtml(a.title)}</td>
        <td>${escapeHtml(a.category || '—')}</td>
        <td>${fields}</td>
        <td>
          <a href="/admin/articles/${a.id}/edit" target="_blank" rel="noopener">Edit</a>
          &middot;
          <a href="/article/${a.slug}" target="_blank" rel="noopener">View</a>
        </td>
      </tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Encoding Issues Report — Assam Times Admin</title>
  <link rel="stylesheet" href="/css/admin.css">
</head>
<body class="admin-body" style="padding: 2rem;">
  <h1>Articles with mis-encoded text (${rows.length})</h1>
  <p>Generated ${new Date().toISOString()}. Re-run <code>node scripts/generate-encoding-report.js</code> to refresh after fixing some. "Edit" requires being logged into /admin already.</p>
  <table class="admin-table">
    <thead>
      <tr>
        <th>ID</th>
        <th>Title (as stored)</th>
        <th>Category</th>
        <th>Affected field(s)</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>
`;

  const outPath = path.join(__dirname, '../public/encoding-issues.html');
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${rows.length} affected articles to ${outPath}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
