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

async function getById(id) {
  const { rows } = await pool.query(
    `SELECT id, username, email, display_name, bio, photo FROM authors WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getAllWithCounts() {
  const { rows } = await pool.query(
    `SELECT au.id, au.username, au.display_name, au.photo,
            (au.password_hash IS NOT NULL) AS can_login,
            COUNT(a.id) AS article_count
     FROM authors au
     LEFT JOIN articles a ON a.author_id = au.id
     GROUP BY au.id, au.username, au.display_name, au.photo, au.password_hash
     ORDER BY au.display_name NULLS LAST, au.username`
  );
  return rows;
}

async function isUsernameTaken(username, excludeId = null) {
  const params = excludeId ? [username, excludeId] : [username];
  const { rows } = await pool.query(
    `SELECT 1 FROM authors WHERE username = $1 ${excludeId ? 'AND id <> $2' : ''} LIMIT 1`,
    params
  );
  return rows.length > 0;
}

async function create({ username, email, displayName, bio, photo }) {
  const { rows } = await pool.query(
    `INSERT INTO authors (username, email, display_name, bio, photo) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [username, email || null, displayName || username, bio || null, photo || null]
  );
  return rows[0].id;
}

async function update(id, { username, email, displayName, bio, photo }) {
  await pool.query(
    `UPDATE authors SET username = $1, email = $2, display_name = $3, bio = $4, photo = $5 WHERE id = $6`,
    [username, email || null, displayName || username, bio || null, photo || null, id]
  );
}

module.exports = {
  getByUsername,
  getByUsernameForAuth,
  setPassword,
  getAll,
  findOrCreate,
  getById,
  getAllWithCounts,
  isUsernameTaken,
  create,
  update,
};
