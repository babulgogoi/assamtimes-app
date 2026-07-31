const pool = require('../config/db');

// Roll-up of the one-time D7 import/re-engagement pipeline (scripts 028-031),
// shown on the admin Newsletter page. Returns zeros for an empty/unpopulated
// staging table rather than erroring.
async function getImportStats() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN imported THEN 1 ELSE 0 END), 0) AS imported,
      COALESCE(SUM(CASE WHEN email_sent THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN bounced THEN 1 ELSE 0 END), 0) AS bounced,
      COALESCE(SUM(CASE WHEN imported AND NOT email_sent AND NOT bounced THEN 1 ELSE 0 END), 0) AS pending
    FROM d7_newsletter_staging
  `);
  const r = rows[0];
  return {
    total: Number(r.total),
    imported: Number(r.imported),
    sent: Number(r.sent),
    bounced: Number(r.bounced),
    pending: Number(r.pending),
  };
}

module.exports = { getImportStats };
