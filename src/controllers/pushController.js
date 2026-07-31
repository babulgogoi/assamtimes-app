const pushSubscriptionsModel = require('../models/pushSubscriptions');

async function subscribe(req, res, next) {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    await pushSubscriptionsModel.upsert({
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('User-Agent'),
    });

    res.status(201).json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint' });
    }

    await pushSubscriptionsModel.remove(endpoint);
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  subscribe,
  unsubscribe,
};
