const pool = require('../config/db');

async function create({ name, email, message }) {
  const { rows } = await pool.query(
    `INSERT INTO accessibility_suggestions (name, email, message) VALUES ($1, $2, $3) RETURNING *`,
    [name || null, email || null, message]
  );
  return rows[0];
}

async function listForAdmin({ limit, offset }) {
  const { rows } = await pool.query(
    `SELECT * FROM accessibility_suggestions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function countForAdmin() {
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM accessibility_suggestions`);
  return Number(rows[0].total);
}

async function remove(id) {
  await pool.query(`DELETE FROM accessibility_suggestions WHERE id = $1`, [id]);
}

module.exports = { create, listForAdmin, countForAdmin, remove };
