const suggestionsModel = require('../models/accessibilitySuggestions');
const siteRatingsModel = require('../models/siteRatings');

async function accessibilityPage(req, res, next) {
  try {
    const rating = await siteRatingsModel.getAggregate();
    res.render('public/accessibility', {
      title: 'Accessibility — Assam Times',
      metaDescription: 'Accessibility features on Assam Times, how to use them, and how to suggest improvements.',
      newsletterStatus: req.query.newsletter === 'success' || req.query.newsletter === 'error' ? req.query.newsletter : null,
      suggestionStatus: req.query.suggestion === 'success' || req.query.suggestion === 'error' ? req.query.suggestion : null,
      rating,
    });
  } catch (err) {
    next(err);
  }
}

async function submitSuggestion(req, res, next) {
  try {
    // Honeypot — same pattern as the comment/newsletter forms.
    if (req.body.website) {
      return res.redirect('/accessibility?suggestion=success#suggest');
    }

    const message = (req.body.message || '').trim();
    if (!message) {
      return res.redirect('/accessibility?suggestion=error#suggest');
    }

    await suggestionsModel.create({
      name: (req.body.name || '').trim(),
      email: (req.body.email || '').trim(),
      message,
    });

    res.redirect('/accessibility?suggestion=success#suggest');
  } catch (err) {
    next(err);
  }
}

async function submitRating(req, res, next) {
  try {
    const rating = parseInt(req.body.rating, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
    }

    const aggregate = await siteRatingsModel.create(rating);
    res.status(201).json(aggregate);
  } catch (err) {
    next(err);
  }
}

module.exports = { accessibilityPage, submitSuggestion, submitRating };
