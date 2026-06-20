const pool = require('../config/db');

async function getByUsername(username) {
  const { rows } = await pool.query(
    `SELECT id, username, display_name, bio, photo
     FROM authors
     WHERE username = $1`,
    [username]
  );
  return rows[0] || null;
}

// Includes password_hash — only for the login flow, never expose this to public views.
async function getByUsernameForAuth(username) {
  const { rows } = await pool.query(
    `SELECT id, username, display_name, password_hash
     FROM authors
     WHERE username = $1`,
    [username]
  );
  return rows[0] || null;
}

async function setPassword(username, passwordHash) {
  const { rows } = await pool.query(
    `UPDATE authors SET password_hash = $1 WHERE username = $2 RETURNING id, username`,
    [passwordHash, username]
  );
  return rows[0] || null;
}

async function getAll() {
  const { rows } = await pool.query(
    `SELECT id, username, display_name FROM authors ORDER BY display_name NULLS LAST, username`
  );
  return rows;
}

// No unique constraint on username at the DB level (only old_uid is unique), so the inline
// "add new author" flow re-links to an existing username instead of creating a duplicate row.
async function findOrCreate({ username, displayName }) {
  const existing = await getByUsername(username);
  if (existing) return existing;

  const { rows } = await pool.query(
    `INSERT INTO authors (username, display_name) VALUES ($1, $2) RETURNING id, username, display_name`,
    [username, displayName || username]
  );
  return rows[0];
}

module.exports = {
  getByUsername,
  getByUsernameForAuth,
  setPassword,
  getAll,
  findOrCreate,
};
