// Finds active subscribers with sendpulse_synced = false (either a failed
// sync attempt, or a row that predates the sendpulse_synced column and was
// never actually attempted) and retries pushing each one to the SendPulse
// addressbook. Meant to run on a daily cron, not in-process — this app has
// no other background scheduler (see scripts/publish-scheduled.js).
//
// Usage: node scripts/retry-sendpulse-sync.js
// Crontab: 0 2 * * * cd /path/to/app && node scripts/retry-sendpulse-sync.js >> logs/retry-sendpulse-sync.log 2>&1
require('dotenv').config();

const pool = require('../src/config/db');
const newsletterModel = require('../src/models/newsletterSubscribers');
const { syncSubscriberToSendPulse } = require('../src/utils/sendpulse');

const BATCH_LIMIT = 50;

async function main() {
  const unsynced = await newsletterModel.getUnsynced({ limit: BATCH_LIMIT });

  if (!unsynced.length) {
    console.log(`[${new Date().toISOString()}] No unsynced subscribers.`);
    return;
  }

  let synced = 0;
  for (const subscriber of unsynced) {
    const ok = await syncSubscriberToSendPulse(subscriber);
    if (ok) {
      await newsletterModel.markSendPulseSynced(subscriber.id);
      synced++;
    }
    // Small delay between API calls, same courtesy as the brief's own version.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`[${new Date().toISOString()}] Synced ${synced}/${unsynced.length} subscribers to SendPulse.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('retry-sendpulse-sync failed:', err);
    pool.end();
    process.exitCode = 1;
  });
