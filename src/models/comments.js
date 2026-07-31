const pool = require('../config/db');

async function getApprovedByArticleId(articleId) {
  const { rows } = await pool.query(
    `SELECT id, author_name, body, created_at
     FROM comments
     WHERE article_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [articleId]
  );
  return rows;
}

async function countApproved(articleId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM comments WHERE article_id = $1 AND status = 'approved'`,
    [articleId]
  );
  return Number(rows[0].count);
}

async function create({ articleId, authorName, authorEmail, body, ipAddress }) {
  const { rows } = await pool.query(
    `INSERT INTO comments (article_id, author_name, author_email, body, status, ip_address)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id`,
    [articleId, authorName, authorEmail, body, ipAddress]
  );
  return rows[0].id;
}

async function countPending() {
  const { rows } = await pool.query(`SELECT COUNT(*) FROM comments WHERE status = 'pending'`);
  return Number(rows[0].count);
}

async function listForAdmin({ status, limit, offset }) {
  const order = status === 'pending' ? 'c.created_at ASC' : 'c.created_at DESC';
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    params.push(status);
    where = `WHERE c.status = $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT c.id, c.author_name, c.author_email, c.body, c.status, c.created_at,
            a.id AS article_id, a.title AS article_title, a.slug AS article_slug
     FROM comments c
     LEFT JOIN articles a ON a.id = c.article_id
     ${where}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function countForAdmin({ status }) {
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  const { rows } = await pool.query(`SELECT COUNT(*) FROM comments ${where}`, params);
  return Number(rows[0].count);
}

async function updateStatus(id, status) {
  await pool.query(`UPDATE comments SET status = $1 WHERE id = $2`, [status, id]);
}

async function bulkUpdateStatus(ids, status) {
  if (!ids.length) return;
  await pool.query(`UPDATE comments SET status = $1 WHERE id = ANY($2::int[])`, [status, ids]);
}

async function approveAllPending() {
  const { rowCount } = await pool.query(`UPDATE comments SET status = 'approved' WHERE status = 'pending'`);
  return rowCount;
}

async function remove(id) {
  await pool.query('DELETE FROM comments WHERE id = $1', [id]);
}

module.exports = {
  getApprovedByArticleId,
  countApproved,
  create,
  countPending,
  listForAdmin,
  countForAdmin,
  updateStatus,
  bulkUpdateStatus,
  approveAllPending,
  remove,
};
