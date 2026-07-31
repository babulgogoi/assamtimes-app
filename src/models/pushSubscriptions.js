const pool = require('../config/db');

async function upsert({ endpoint, p256dh, auth, userAgent }) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [endpoint, p256dh, auth, userAgent || null]
  );
}

async function remove(endpoint) {
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

async function count() {
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM push_subscriptions`);
  return Number(rows[0].total);
}

// Used by pushSender.js to fan a notification out to every subscriber.
async function getAll() {
  const { rows } = await pool.query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`);
  return rows;
}

module.exports = {
  upsert,
  remove,
  count,
  getAll,
};
