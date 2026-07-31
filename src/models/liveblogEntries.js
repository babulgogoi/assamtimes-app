const pool = require('../config/db');

async function listByArticleId(articleId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT le.*, au.display_name AS author_name
     FROM liveblog_entries le
     LEFT JOIN authors au ON au.id = le.author_id
     WHERE le.article_id = $1
     ORDER BY le.is_pinned DESC, le.created_at DESC
     LIMIT $2`,
    [articleId, limit]
  );
  return rows;
}

// Polling endpoint — only entries newer than the client's last-seen
// timestamp. Pinned entries are deliberately NOT specially ordered here
// (unlike listByArticleId) since the client only appends/skips-if-known,
// it doesn't re-sort the whole list.
async function listSince(articleId, since, limit = 50) {
  const params = [articleId];
  let where = 'le.article_id = $1';
  if (since) {
    params.push(since);
    where += ` AND le.created_at > $${params.length}`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT le.*, au.display_name AS author_name
     FROM liveblog_entries le
     LEFT JOIN authors au ON au.id = le.author_id
     WHERE ${where}
     ORDER BY le.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function create({ articleId, content, authorId, isKeyEvent, isPinned }) {
  const { rows } = await pool.query(
    `INSERT INTO liveblog_entries (article_id, content, author_id, is_key_event, is_pinned)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [articleId, content, authorId || null, !!isKeyEvent, !!isPinned]
  );
  return rows[0];
}

async function remove(entryId, articleId) {
  await pool.query(`DELETE FROM liveblog_entries WHERE id = $1 AND article_id = $2`, [entryId, articleId]);
}

module.exports = { listByArticleId, listSince, create, remove };
