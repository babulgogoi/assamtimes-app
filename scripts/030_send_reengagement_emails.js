// Sends re-engagement emails to imported D7 subscribers, capped at 50 per run
// (meant for a daily cron so the volume stays deliverable and doesn't trip the
// MTA's rate limits or the recipient providers' spam heuristics).
//
// Only emails staging rows that: have been imported (imported=true), haven't
// been emailed yet (email_sent=false), and haven't bounced (bounced=false) —
// AND whose live newsletter_subscribers row is still 'active' (so someone who
// unsubscribed between import and send is never mailed). The unsubscribe_token
// comes from newsletter_subscribers, which is where 029 minted it.
//
// Usage: node scripts/030_send_reengagement_emails.js
// Crontab: 0 9 * * * cd /path/to/app && node scripts/030_send_reengagement_emails.js >> logs/newsletter-send.log 2>&1
require('dotenv').config();

const nodemailer = require('nodemailer');
const pool = require('../src/config/db');

const BATCH_LIMIT = 50;
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 25;
const FROM = process.env.NEWSLETTER_FROM || 'Assam Times Newsletter <no-reply@newsletter.assamtimes.org>';
const REPLY_TO = process.env.NEWSLETTER_REPLY_TO || 'bounce@newsletter.assamtimes.org';
const SITE_URL = process.env.SITE_URL || 'https://assamtimes.org';
const SUBJECT = 'Stay connected with Assam Times';

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(name, unsubscribeUrl) {
  const safeName = escapeHtml(name || 'reader');
  return `<!doctype html>
<html>
<body style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
  <p>Dear ${safeName},</p>
  <p>You are receiving this email because you were a registered user of AssamTimes.org.</p>
  <p>We have launched a new website and would like to keep you updated with the latest news from Assam.</p>
  <p><a href="${SITE_URL}" style="display:inline-block;background:#FF6600;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;">Read Latest News</a></p>
  <p>If you do not wish to receive our newsletter, you can <a href="${unsubscribeUrl}">unsubscribe at any time</a>.</p>
  <p style="color:#888;font-size:13px;margin-top:24px;">--<br>Assam Times<br><a href="${SITE_URL}">${SITE_URL}</a></p>
</body>
</html>`;
}

function buildText(name, unsubscribeUrl) {
  return `Dear ${name || 'reader'},

You are receiving this email because you were a registered user of AssamTimes.org.

We have launched a new website and would like to keep you updated with the latest news from Assam.

Read Latest News: ${SITE_URL}

If you do not wish to receive our newsletter, you can unsubscribe at any time:
${unsubscribeUrl}

--
Assam Times
${SITE_URL}`;
}

function createTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    // Local relay to exim on the same host — its TLS cert is for the server's
    // real hostname (host.assam.org), not 'localhost', so opportunistic
    // STARTTLS would fail cert validation. Don't validate the local cert.
    tls: { rejectUnauthorized: false },
  });
}

async function main() {
  const { rows } = await pool.query(
    `SELECT s.id, s.username, s.email, ns.unsubscribe_token
     FROM d7_newsletter_staging s
     JOIN newsletter_subscribers ns ON ns.email = s.email
     WHERE s.email_sent = false
       AND s.imported = true
       AND s.bounced = false
       AND ns.status = 'active'
     ORDER BY s.id ASC
     LIMIT $1`,
    [BATCH_LIMIT]
  );

  if (!rows.length) {
    console.log(`[${new Date().toISOString()}] No subscribers pending re-engagement email.`);
    return;
  }

  const transport = createTransport();

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const unsubscribeUrl = `${SITE_URL}/newsletter/unsubscribe?token=${row.unsubscribe_token}`;
    try {
      await transport.sendMail({
        from: FROM,
        replyTo: REPLY_TO,
        to: row.email,
        subject: SUBJECT,
        text: buildText(row.username, unsubscribeUrl),
        html: buildHtml(row.username, unsubscribeUrl),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'X-Mailer': 'AssamTimes-Newsletter/1.0',
          'Precedence': 'bulk',
        },
      });

      await pool.query(
        `UPDATE d7_newsletter_staging SET email_sent = true, email_sent_at = now() WHERE id = $1`,
        [row.id]
      );
      sent++;
      console.log(`Sent: ${row.email}`);
    } catch (err) {
      failed++;
      console.error(`Send failed for ${row.email}: ${err.message}`);
    }
  }

  console.log(`[${new Date().toISOString()}] Re-engagement batch complete: ${sent} sent, ${failed} failed (of ${rows.length}).`);
}

// Only run the batch when invoked directly (node scripts/030_...). Requiring
// this module (e.g. from the one-off test sender) just imports the helpers.
if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch((err) => {
      console.error('030_send_reengagement_emails failed:', err);
      pool.end();
      process.exitCode = 1;
    });
}

module.exports = {
  createTransport,
  buildHtml,
  buildText,
  FROM,
  REPLY_TO,
  SUBJECT,
  SITE_URL,
};
