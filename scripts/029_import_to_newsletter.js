// Drains d7_newsletter_staging into the live newsletter_subscribers table.
// Idempotent: only touches rows not yet imported/skipped/bounced, and uses
// ON CONFLICT (email) DO NOTHING so a subscriber who already signed up via the
// website is never overwritten (their row wins; the staging row is marked
// import_skipped='already_subscribed').
//
// Usage: node scripts/029_import_to_newsletter.js
require('dotenv').config();

const pool = require('../src/config/db');

async function main() {
  const { rows } = await pool.query(
    `SELECT id, username, email
     FROM d7_newsletter_staging
     WHERE imported = false AND import_skipped = false AND bounced = false
     ORDER BY id ASC`
  );

  if (!rows.length) {
    console.log(`[${new Date().toISOString()}] No staging rows to import.`);
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await pool.query(
      `INSERT INTO newsletter_subscribers
         (name, email, status, source, unsubscribe_token, subscribed_at)
       VALUES ($1, $2, 'active', 'd7_import', gen_random_uuid()::text, now())
       ON CONFLICT (email) DO NOTHING`,
      [row.username || null, row.email]
    );

    if (result.rowCount === 1) {
      await pool.query(
        `UPDATE d7_newsletter_staging SET imported = true WHERE id = $1`,
        [row.id]
      );
      imported++;
    } else {
      await pool.query(
        `UPDATE d7_newsletter_staging
         SET import_skipped = true, skip_reason = 'already_subscribed'
         WHERE id = $1`,
        [row.id]
      );
      skipped++;
    }
  }

  console.log(`[${new Date().toISOString()}] Import complete.`);
  console.log(`  Considered:              ${rows.length}`);
  console.log(`  Imported to subscribers: ${imported}`);
  console.log(`  Skipped (already sub'd): ${skipped}`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('029_import_to_newsletter failed:', err);
    pool.end();
    process.exitCode = 1;
  });
