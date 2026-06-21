const pool = require('../config/db');

async function getAllForAdmin() {
  const { rows } = await pool.query(
    `SELECT m.id, m.label, m.page_id, m.custom_url, m.sort_order, m.parent_id, m.is_active,
            p.title AS page_title
     FROM menu_items m
     LEFT JOIN pages p ON p.id = m.page_id
     ORDER BY m.sort_order ASC, m.id ASC`
  );
  return rows;
}

// Resolves each item's final href server-side so the template just needs item.url.
async function getActiveOrdered() {
  const { rows } = await pool.query(
    `SELECT m.id, m.label, m.sort_order, m.parent_id,
            CASE WHEN m.page_id IS NOT NULL THEN '/page/' || p.slug ELSE m.custom_url END AS url
     FROM menu_items m
     LEFT JOIN pages p ON p.id = m.page_id
     WHERE m.is_active = true
     ORDER BY m.sort_order ASC, m.id ASC`
  );
  return rows;
}

async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM menu_items WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function create({ label, pageId, customUrl, sortOrder, parentId, isActive }) {
  const { rows } = await pool.query(
    `INSERT INTO menu_items (label, page_id, custom_url, sort_order, parent_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [label, pageId, customUrl, sortOrder, parentId, isActive]
  );
  return rows[0].id;
}

async function update(id, { label, pageId, customUrl, sortOrder, parentId, isActive }) {
  await pool.query(
    `UPDATE menu_items SET label = $1, page_id = $2, custom_url = $3, sort_order = $4,
       parent_id = $5, is_active = $6
     WHERE id = $7`,
    [label, pageId, customUrl, sortOrder, parentId, isActive, id]
  );
}

async function remove(id) {
  await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
}

module.exports = {
  getAllForAdmin,
  getActiveOrdered,
  getById,
  create,
  update,
  remove,
};
