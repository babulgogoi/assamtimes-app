const webpush = require('web-push');
const pushSubscriptionsModel = require('../models/pushSubscriptions');

webpush.setVapidDetails(
  process.env.VAPID_CONTACT_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// push_subscriptions stores endpoint/p256dh/auth as separate columns (see
// src/models/pushSubscriptions.js), not a single serialized `subscription`
// blob — reassembled into the shape webpush.sendNotification() expects.
async function sendPushToAll(payload) {
  const rows = await pushSubscriptionsModel.getAll();
  const results = { sent: 0, failed: 0, removed: 0 };

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload)
        );
        results.sent++;
      } catch (err) {
        results.failed++;
        // 410 Gone (or 404) means the push service has permanently
        // invalidated this endpoint — the browser unsubscribed, was
        // reinstalled, etc. Safe and correct to prune it now rather than
        // retry it on every future send.
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pushSubscriptionsModel.remove(row.endpoint);
          results.removed++;
        }
      }
    })
  );

  console.log('[Push] sendPushToAll result:', results);
  return results;
}

module.exports = { sendPushToAll };
