const suggestionsModel = require('../models/accessibilitySuggestions');

const ADMIN_PAGE_SIZE = 50;

async function listSuggestions(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * ADMIN_PAGE_SIZE;

    const [suggestions, total] = await Promise.all([
      suggestionsModel.listForAdmin({ limit: ADMIN_PAGE_SIZE, offset }),
      suggestionsModel.countForAdmin(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

    res.locals.layout = 'admin/layout';
    res.render('admin/accessibility/list', {
      title: 'Accessibility Suggestions — Admin',
      authorName: req.session.authorName,
      suggestions,
      page,
      totalPages,
      total,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteSuggestion(req, res, next) {
  try {
    await suggestionsModel.remove(req.params.id);
    res.redirect('/admin/accessibility-suggestions');
  } catch (err) {
    next(err);
  }
}

module.exports = { listSuggestions, deleteSuggestion };
