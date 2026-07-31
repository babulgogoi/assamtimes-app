const pool = require('../config/db');

// Used both for public display (article.ejs byline — needs photo) and the
// admin edit form pre-fill (doesn't need photo, harmless to include
// anyway) — one query shape covers both rather than two near-duplicates.
async function getByArticleId(articleId) {
  const { rows } = await pool.query(
    `SELECT aa.author_id, aa.role, aa.sort_order,
            au.username, au.display_name, au.photo
     FROM article_authors aa
     JOIN authors au ON au.id = aa.author_id
     WHERE aa.article_id = $1
     ORDER BY aa.sort_order ASC`,
    [articleId]
  );
  return rows;
}

// Delete-then-insert, same as this app's other "replace the whole set"
// writes (e.g. menu items) — no explicit transaction, matching the rest of
// this codebase's convention; low-risk here since this is an admin-only,
// one-article-at-a-time write path, not a concurrent/high-traffic one.
async function replaceForArticle(articleId, coauthors) {
  await pool.query(`DELETE FROM article_authors WHERE article_id = $1`, [articleId]);

  for (const ca of coauthors) {
    await pool.query(
      `INSERT INTO article_authors (article_id, author_id, role, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [articleId, ca.authorId, ca.role, ca.sortOrder]
    );
  }
}

// Author page's "Also contributed to" section.
async function getContributedByUsername(username, limit = 10) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.slug, a.published_at, a.views_count, aa.role
     FROM articles a
     JOIN article_authors aa ON aa.article_id = a.id
     JOIN authors au ON au.id = aa.author_id
     WHERE au.username = $1 AND a.status = 'published' AND a.is_advertisement = false
     ORDER BY a.published_at DESC
     LIMIT $2`,
    [username, limit]
  );
  return rows;
}

module.exports = {
  getByArticleId,
  replaceForArticle,
  getContributedByUsername,
};
