const pushSubscriptionsModel = require('../models/pushSubscriptions');
const { sendPushToAll } = require('../utils/pushSender');

async function pushForm(req, res, next) {
  try {
    const subscriberCount = await pushSubscriptionsModel.count();
    res.locals.layout = 'admin/layout';
    res.render('admin/push', {
      title: 'Push Notifications — Admin',
      authorName: req.session.authorName,
      subscriberCount,
      sent: req.query.sent,
      failed: req.query.failed,
    });
  } catch (err) {
    next(err);
  }
}

async function sendPush(req, res, next) {
  try {
    const title = (req.body.title || '').trim();
    const body = (req.body.body || '').trim();
    const url = (req.body.url || process.env.SITE_URL || '').trim();

    if (!title || !body) {
      const subscriberCount = await pushSubscriptionsModel.count();
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/push', {
        title: 'Push Notifications — Admin',
        authorName: req.session.authorName,
        subscriberCount,
        errors: ['Title and body are required.'],
        form: { title, body, url },
      });
    }

    const results = await sendPushToAll({
      title,
      body,
      url,
      icon: `${process.env.SITE_URL}/uploads/branding/android-chrome-192x192.png`,
      badge: `${process.env.SITE_URL}/uploads/branding/favicon-32x32.png`,
    });

    res.redirect(`/admin/push?sent=${results.sent}&failed=${results.failed}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { pushForm, sendPush };
