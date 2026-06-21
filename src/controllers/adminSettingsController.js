const siteSettingsModel = require('../models/siteSettings');

async function editSettingsForm(req, res, next) {
  try {
    const [footerHtml, featuredCategory] = await Promise.all([
      siteSettingsModel.getFooterHtml(),
      siteSettingsModel.getFeaturedCategory(),
    ]);
    res.locals.layout = 'admin/layout';
    res.render('admin/settings/form', {
      title: 'Settings — Admin',
      authorName: req.session.authorName,
      footerHtml,
      featuredCategory,
    });
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    await Promise.all([
      siteSettingsModel.updateFooterHtml(req.body.footer_html || ''),
      siteSettingsModel.updateFeaturedCategory((req.body.featured_category || '').trim() || 'Features'),
    ]);
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  editSettingsForm,
  updateSettings,
};
