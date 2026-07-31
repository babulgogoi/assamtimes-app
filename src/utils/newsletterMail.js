const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 25;
const FROM = process.env.NEWSLETTER_FROM || 'Assam Times Newsletter <no-reply@newsletter.assamtimes.org>';
const SITE_URL = process.env.SITE_URL || 'https://assamtimes.org';

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Local relay to exim on the same host — its TLS cert is for the server's real
// hostname (host.assam.org), not 'localhost', so opportunistic STARTTLS would
// fail cert validation. Don't validate the local cert. (Same as script 030.)
function createTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    tls: { rejectUnauthorized: false },
  });
}

// Sends the confirmation/welcome email to a brand-new subscriber. Best-effort:
// the caller must not let a mail failure roll back the (already-saved)
// subscription — see newsletterController.subscribe.
async function sendWelcomeEmail(subscriber) {
  const name = subscriber.name || 'reader';
  const unsubscribeUrl = `${SITE_URL}/newsletter/unsubscribe?token=${subscriber.unsubscribe_token}`;

  const html = `<!doctype html>
<html>
<body style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
  <p>Dear ${escapeHtml(name)},</p>
  <p>Thank you for subscribing to the <strong>Assam Times</strong> newsletter. Your subscription is confirmed, and you'll now receive the latest news from Assam straight to your inbox.</p>
  <p><a href="${SITE_URL}" style="display:inline-block;background:#FF6600;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;">Read Latest News</a></p>
  <p>If you did not sign up, or no longer wish to receive our newsletter, you can <a href="${unsubscribeUrl}">unsubscribe at any time</a>.</p>
  <p style="color:#888;font-size:13px;margin-top:24px;">--<br>Assam Times<br><a href="${SITE_URL}">${SITE_URL}</a></p>
</body>
</html>`;

  const text = `Dear ${name},

Thank you for subscribing to the Assam Times newsletter. Your subscription is confirmed, and you'll now receive the latest news from Assam straight to your inbox.

Read Latest News: ${SITE_URL}

If you did not sign up, or no longer wish to receive our newsletter, you can unsubscribe at any time:
${unsubscribeUrl}

--
Assam Times
${SITE_URL}`;

  const transport = createTransport();
  await transport.sendMail({
    from: FROM,
    to: subscriber.email,
    subject: 'Welcome to Assam Times Newsletter',
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Mailer': 'AssamTimes-Newsletter/1.0',
    },
  });
}

module.exports = { sendWelcomeEmail };
