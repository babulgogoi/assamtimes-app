const pool = require('../config/db');

async function getCategoryByTid(tid) {
  const { rows } = await pool.query(
    `SELECT category FROM legacy_taxonomy_terms WHERE tid = $1`,
    [tid]
  );
  return rows[0] ? rows[0].category : null;
}

module.exports = {
  getCategoryByTid,
};
