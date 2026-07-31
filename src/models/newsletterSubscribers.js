const crypto = require('crypto');
const pool = require('../config/db');

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Re-subscribing with the same email reactivates the row (rather than
// erroring on the unique constraint) and refreshes the name.
async function create({ name, email, source }) {
  const { rows } = await pool.query(
    `INSERT INTO newsletter_subscribers (name, email, source, unsubscribe_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       status = 'active',
       unsubscribed_at = NULL
     RETURNING *`,
    [name || null, email, source || null, generateToken()]
  );
  return rows[0];
}

async function remove(id) {
  const { rows } = await pool.query(
    `DELETE FROM newsletter_subscribers WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active') AS active,
      COUNT(*) FILTER (WHERE status = 'unsubscribed') AS unsubscribed
    FROM newsletter_subscribers
  `);
  return {
    active: Number(rows[0].active),
    unsubscribed: Number(rows[0].unsubscribed),
  };
}

async function unsubscribeByToken(token) {
  const { rows } = await pool.query(
    `UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now()
     WHERE unsubscribe_token = $1
     RETURNING *`,
    [token]
  );
  return rows[0] || null;
}

async function listForAdmin({ search, limit, offset }) {
  const { rows } = await pool.query(
    `SELECT * FROM newsletter_subscribers
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
     ORDER BY subscribed_at DESC
     LIMIT $2 OFFSET $3`,
    [search || '', limit, offset]
  );
  return rows;
}

async function countForAdmin({ search }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM newsletter_subscribers
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')`,
    [search || '']
  );
  return Number(rows[0].total);
}

async function listAllForExport({ search }) {
  const { rows } = await pool.query(
    `SELECT * FROM newsletter_subscribers
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
     ORDER BY subscribed_at DESC`,
    [search || '']
  );
  return rows;
}

module.exports = {
  create,
  unsubscribeByToken,
  listForAdmin,
  countForAdmin,
  listAllForExport,
  remove,
  getStats,
};
