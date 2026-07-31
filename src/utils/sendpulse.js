const SENDPULSE_API_BASE = 'https://api.sendpulse.com';

let cachedToken = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${SENDPULSE_API_BASE}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.SENDPULSE_API_USER_ID,
      client_secret: process.env.SENDPULSE_API_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`SendPulse auth failed: ${res.status}`);

  const data = await res.json();
  // Refresh a minute early so a near-expiry token is never handed out.
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// Syncs a newsletter signup to a SendPulse mailing list. Failures are
// logged and never propagate — the local DB row is the source of truth,
// SendPulse is a best-effort mirror of it. Callers should check the
// returned bool and call newsletterModel.markSendPulseSynced() on success
// so the retry cron (scripts/retry-sendpulse-sync.js) can find failures.
async function syncSubscriberToSendPulse(subscriber) {
  const { SENDPULSE_API_USER_ID, SENDPULSE_API_SECRET, SENDPULSE_ADDRESSBOOK_ID } = process.env;
  if (!SENDPULSE_API_USER_ID || !SENDPULSE_API_SECRET || !SENDPULSE_ADDRESSBOOK_ID) {
    console.log('SendPulse sync skipped: SENDPULSE_* env vars not configured.');
    return false;
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(`${SENDPULSE_API_BASE}/addressbooks/${SENDPULSE_ADDRESSBOOK_ID}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        emails: [{ email: subscriber.email, variables: { name: subscriber.name || '' } }],
      }),
    });
    if (!res.ok) throw new Error(`SendPulse add-email failed: ${res.status}`);
    return true;
  } catch (err) {
    console.error('SendPulse sync failed for', subscriber.email, ':', err);
    return false;
  }
}

// Removes an email from the SendPulse addressbook (admin delete + real
// unsubscribe). SendPulse's API uses DELETE with a JSON body here, not
// POST .../emails/delete (that variant 405s) — confirmed directly against
// the live API before relying on it.
async function removeSubscriberFromSendPulse(email) {
  const { SENDPULSE_API_USER_ID, SENDPULSE_API_SECRET, SENDPULSE_ADDRESSBOOK_ID } = process.env;
  if (!SENDPULSE_API_USER_ID || !SENDPULSE_API_SECRET || !SENDPULSE_ADDRESSBOOK_ID) {
    return false;
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(`${SENDPULSE_API_BASE}/addressbooks/${SENDPULSE_ADDRESSBOOK_ID}/emails`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ emails: [email] }),
    });
    if (!res.ok) throw new Error(`SendPulse remove-email failed: ${res.status}`);
    return true;
  } catch (err) {
    console.error('SendPulse removal failed for', email, ':', err);
    return false;
  }
}

module.exports = { syncSubscriberToSendPulse, removeSubscriberFromSendPulse };
