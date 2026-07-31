const newsletterModel = require('../models/newsletterSubscribers');
const { sendWelcomeEmail } = require('../utils/newsletterMail');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The newsletter form is embedded on more than one page (views/partials/
// newsletter-form.ejs) — return_to says which one to redirect back to,
// whitelisted since it's client-controlled POST data.
const ALLOWED_RETURN_PATHS = new Set(['/subscribe', '/accessibility']);

function resolveReturnTo(req) {
  return ALLOWED_RETURN_PATHS.has(req.body.return_to) ? req.body.return_to : '/subscribe';
}

async function subscribe(req, res, next) {
  try {
    const returnTo = resolveReturnTo(req);

    // Honeypot — hidden from real visitors via CSS; bots that fill it out
    // get a silent success with nothing actually saved.
    if (req.body.website) {
      return res.redirect(`${returnTo}?newsletter=success`);
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const isValid = name && email && EMAIL_RE.test(email);

    if (!isValid) {
      return res.redirect(`${returnTo}?newsletter=error`);
    }

    const subscriber = await newsletterModel.create({ name, email, source: 'website' });

    // Welcome email is best-effort — the subscription is already saved, so a
    // mail-server hiccup must not turn a successful signup into an error.
    try {
      await sendWelcomeEmail(subscriber);
    } catch (mailErr) {
      console.error('Welcome email failed for', subscriber.email, ':', mailErr.message);
    }

    res.redirect(`${returnTo}?newsletter=success`);
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const token = req.query.token;
    const subscriber = token ? await newsletterModel.unsubscribeByToken(token) : null;
    res.render('public/newsletter-unsubscribed', {
      title: 'Unsubscribed — Assam Times',
      found: !!subscriber,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { subscribe, unsubscribe };
