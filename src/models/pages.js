const pool = require('../config/db');

async function getBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, body, status FROM pages WHERE slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

async function getById(id) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, body, status FROM pages WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getAllForAdmin() {
  const { rows } = await pool.query(
    `SELECT id, slug, title, status, updated_at FROM pages ORDER BY title ASC`
  );
  return rows;
}

async function getAllPublished() {
  const { rows } = await pool.query(
    `SELECT id, slug, title FROM pages WHERE status = 'published' ORDER BY title ASC`
  );
  return rows;
}

async function slugExists(slug, excludeId = null) {
  const params = excludeId ? [slug, excludeId] : [slug];
  const { rows } = await pool.query(
    `SELECT 1 FROM pages WHERE slug = $1 ${excludeId ? 'AND id <> $2' : ''} LIMIT 1`,
    params
  );
  return rows.length > 0;
}

async function create({ slug, title, body, status }) {
  const { rows } = await pool.query(
    `INSERT INTO pages (slug, title, body, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     RETURNING id`,
    [slug, title, body, status]
  );
  return rows[0].id;
}

async function update(id, { slug, title, body, status }) {
  await pool.query(
    `UPDATE pages SET slug = $1, title = $2, body = $3, status = $4, updated_at = now() WHERE id = $5`,
    [slug, title, body, status, id]
  );
}

async function remove(id) {
  await pool.query('DELETE FROM pages WHERE id = $1', [id]);
}

module.exports = {
  getBySlug,
  getById,
  getAllForAdmin,
  getAllPublished,
  slugExists,
  create,
  update,
  remove,
};
