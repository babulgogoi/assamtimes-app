// Reads the bounce mailbox (bounce@newsletter.assamtimes.org) over IMAP, and
// for every unread bounce/NDR: extracts the failed recipient, marks that email
// bounced in d7_newsletter_staging AND flips its newsletter_subscribers row to
// status='bounced' (so 030 stops re-mailing it and it's excluded from the live
// active list). Then marks the IMAP message seen so it isn't re-processed.
//
// Credentials come from .env: BOUNCE_MAIL_USER / BOUNCE_MAIL_PASSWORD, plus
// optional IMAP_HOST (default localhost) / IMAP_PORT (default 993, SSL).
//
// Uses imapflow, not imap-simple — imap-simple (even at its latest 5.1.0,
// already installed) depends on imap@0.8.x -> utf7@1.0.2 -> semver@~5.3.0,
// a permanently vulnerable chain (GHSA-c2qf-rxjj-qqgw, ReDoS). There is no
// newer imap-simple/imap release that fixes this — imap-simple@6.0.0 is
// deprecated and has the identical dependency. imapflow is a from-scratch
// client with no imap/utf7/semver in its tree.
//
// Usage: node scripts/031_process_bounces.js
// Crontab: 0 */2 * * * cd /path/to/app && node scripts/031_process_bounces.js >> logs/newsletter-bounces.log 2>&1
require('dotenv').config();

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const pool = require('../src/config/db');

const IMAP_HOST = process.env.IMAP_HOST || 'localhost';
const IMAP_PORT = Number(process.env.IMAP_PORT) || 993;
const IMAP_USER = process.env.BOUNCE_MAIL_USER || 'bounce@newsletter.assamtimes.org';
const IMAP_PASSWORD = process.env.BOUNCE_MAIL_PASSWORD;

// Subject lines that signal a bounce/NDR.
const BOUNCE_SUBJECT_RE = /(mail delivery failed|undeliverable|delivery status notification|returned mail|mail delivery|bounced|failure notice|delivery has failed|failed)/i;
// Body phrases that signal a hard bounce.
const BOUNCE_BODY_RE = /(\b55[0-4]\b|user unknown|no such user|does not exist|mailbox not found|mailbox unavailable|address rejected|recipient rejected|unrouteable address)/i;

function extractFailedRecipient(source, parsedText) {
  // Prefer the structured DSN fields — most reliable.
  const dsn = source.match(/(?:Final-Recipient|Original-Recipient)\s*:\s*(?:rfc822|x-unix)?\s*;?\s*([^\s<>]+@[^\s<>]+)/i);
  if (dsn) return dsn[1].toLowerCase();

  // Fall back to a "To:" line inside the embedded original message.
  const toLine = source.match(/\n\s*To:\s*[^\n<]*<?([^\s<>]+@[^\s<>]+)>?/i);
  if (toLine) return toLine[1].toLowerCase();

  // Last resort: first email-looking token in the readable body.
  const inBody = (parsedText || '').match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/);
  if (inBody) return inBody[0].toLowerCase().replace(/[.,;:>)\]]+$/, '');

  return null;
}

async function markBounced(email) {
  await pool.query(
    `UPDATE d7_newsletter_staging SET bounced = true, bounced_at = now() WHERE email = $1`,
    [email]
  );
  await pool.query(
    `UPDATE newsletter_subscribers SET status = 'bounced' WHERE email = $1`,
    [email]
  );
}

async function main() {
  if (!IMAP_PASSWORD) {
    console.error('BOUNCE_MAIL_PASSWORD is not set in .env — cannot connect to the bounce mailbox. Skipping.');
    process.exitCode = 1;
    return;
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_PORT === 993,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    tls: { rejectUnauthorized: false }, // self-signed local mail cert
    connectionTimeout: 15000,
    logger: false,
  });

  await client.connect();
  await client.mailboxOpen('INBOX');

  // uid: true so the returned numbers are UIDs (stable across the session),
  // matching what fetch/messageFlagsAdd below are told to expect.
  const uids = (await client.search({ seen: false }, { uid: true })) || [];

  let bounced = 0;
  let notBounce = 0;
  let unresolved = 0;

  if (uids.length) {
    for await (const message of client.fetch(uids, { source: true }, { uid: true })) {
      const uid = message.uid;
      const source = message.source ? message.source.toString('utf8') : '';

      let parsed;
      try {
        parsed = await simpleParser(source);
      } catch (err) {
        console.error(`Failed to parse message uid=${uid}: ${err.message}`);
        continue;
      }

      const subject = parsed.subject || '';
      const bodyText = parsed.text || parsed.html || '';
      const looksBounce = BOUNCE_SUBJECT_RE.test(subject) || BOUNCE_BODY_RE.test(bodyText) || BOUNCE_BODY_RE.test(source);

      if (!looksBounce) {
        notBounce++;
        // Still mark it seen so it doesn't pile up unread forever.
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});
        continue;
      }

      const email = extractFailedRecipient(source, bodyText);
      if (!email) {
        unresolved++;
        console.error(`Bounce detected but no recipient extracted (uid=${uid}, subject="${subject}")`);
        // Leave unread for manual review — don't mark seen.
        continue;
      }

      await markBounced(email);
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});
      bounced++;
      console.log(`Bounced: ${email}`);
    }
  }

  await client.logout();

  console.log(`[${new Date().toISOString()}] Bounce run complete: ${bounced} bounced, ${notBounce} non-bounce, ${unresolved} unresolved (of ${uids.length} unread).`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('031_process_bounces failed:', err);
    pool.end();
    process.exitCode = 1;
  });
