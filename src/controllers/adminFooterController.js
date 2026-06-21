const siteSettingsModel = require('../models/siteSettings');

async function editFooterForm(req, res, next) {
  try {
    const footerHtml = await siteSettingsModel.getFooterHtml();
    res.locals.layout = 'admin/layout';
    res.render('admin/footer/form', {
      title: 'Footer — Admin',
      authorName: req.session.authorName,
      footerHtml,
    });
  } catch (err) {
    next(err);
  }
}

async function updateFooter(req, res, next) {
  try {
    await siteSettingsModel.updateFooterHtml(req.body.footer_html || '');
    res.redirect('/admin/footer');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  editFooterForm,
  updateFooter,
};
