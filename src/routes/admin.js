const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthorsController = require('../controllers/adminAuthorsController');
const adminPagesController = require('../controllers/adminPagesController');
const adminMenuController = require('../controllers/adminMenuController');
const adminSettingsController = require('../controllers/adminSettingsController');
const adminCommentsController = require('../controllers/adminCommentsController');
const adminNewsletterController = require('../controllers/adminNewsletterController');
const adminAccessibilityController = require('../controllers/adminAccessibilityController');
const adminLiveblogController = require('../controllers/adminLiveblogController');
const adminPushController = require('../controllers/adminPushController');
const commentsModel = require('../models/comments');
const { requireAuth } = require('../middleware/auth');
const { csrfMiddleware, csrfVerify } = require('../middleware/csrf');
const { uploadArticleFiles, uploadAuthorPhoto, compressArticleImages, uploadWithErrorRedirect, uploadImageJson } = require('../middleware/upload');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

// Scoped to /admin only (not mounted globally in server.js) — CSRF tokens are
// only needed for admin forms, and applying this to every public-site
// request would create a session DB row for every anonymous visitor for no
// benefit. Mounted before the login routes so the pre-auth login page also
// gets a token.
router.use(csrfMiddleware);

router.get('/login', adminController.loginForm);
router.post('/login', loginLimiter, csrfVerify, adminController.login);
router.post('/logout', csrfVerify, adminController.logout);

router.use(requireAuth);

router.use(async (req, res, next) => {
  try {
    res.locals.pendingCommentsCount = await commentsModel.countPending();
  } catch (err) {
    return next(err);
  }
  next();
});

router.get('/', (req, res) => res.redirect('/admin/articles'));

router.get('/articles', adminController.listArticles);
router.get('/articles/new', adminController.newArticleForm);
router.post('/articles/upload-image', uploadImageJson, csrfVerify, adminController.uploadImageAjax);
router.post('/articles', uploadWithErrorRedirect(uploadArticleFiles, () => '/admin/articles/new'), csrfVerify, compressArticleImages, adminController.createArticle);
router.get('/articles/:id/edit', adminController.editArticleForm);
router.post('/articles/:id', uploadWithErrorRedirect(uploadArticleFiles, (req) => `/admin/articles/${req.params.id}/edit`), csrfVerify, compressArticleImages, adminController.updateArticle);
router.post('/articles/:id/delete', csrfVerify, adminController.deleteArticle);
router.post('/articles/:id/status', csrfVerify, adminController.updateArticleStatus);

router.get('/authors', adminAuthorsController.listAuthors);
router.get('/authors/new', adminAuthorsController.newAuthorForm);
router.post('/authors', uploadWithErrorRedirect(uploadAuthorPhoto, () => '/admin/authors/new'), csrfVerify, adminAuthorsController.createAuthor);
router.get('/authors/:id/edit', adminAuthorsController.editAuthorForm);
router.post('/authors/:id', uploadWithErrorRedirect(uploadAuthorPhoto, (req) => `/admin/authors/${req.params.id}/edit`), csrfVerify, adminAuthorsController.updateAuthor);

router.get('/pages', adminPagesController.listPages);
router.get('/pages/new', adminPagesController.newPageForm);
router.post('/pages', csrfVerify, adminPagesController.createPage);
router.get('/pages/:id/edit', adminPagesController.editPageForm);
router.post('/pages/:id', csrfVerify, adminPagesController.updatePage);
router.post('/pages/:id/delete', csrfVerify, adminPagesController.deletePage);

router.get('/menu', adminMenuController.listMenuItems);
router.get('/menu/new', adminMenuController.newMenuItemForm);
router.post('/menu', csrfVerify, adminMenuController.createMenuItem);
router.get('/menu/:id/edit', adminMenuController.editMenuItemForm);
router.post('/menu/:id', csrfVerify, adminMenuController.updateMenuItem);
router.post('/menu/:id/delete', csrfVerify, adminMenuController.deleteMenuItem);

router.get('/settings', adminSettingsController.editSettingsForm);
router.post('/settings', csrfVerify, adminSettingsController.updateSettings);
router.post('/settings/section-designs', csrfVerify, adminSettingsController.updateSectionDesigns);
router.post('/settings/purge-cache', csrfVerify, adminSettingsController.purgeCache);
router.post('/settings/purge-cloudflare', csrfVerify, adminSettingsController.purgeCloudflareCacheManual);

router.get('/comments', adminCommentsController.listComments);
router.post('/comments/bulk-approve', csrfVerify, adminCommentsController.bulkApprovePending);
router.post('/comments/:id/approve', csrfVerify, adminCommentsController.approveComment);
router.post('/comments/:id/spam', csrfVerify, adminCommentsController.markSpam);
router.post('/comments/:id/delete', csrfVerify, adminCommentsController.deleteComment);

router.get('/newsletter', adminNewsletterController.listSubscribers);
router.get('/newsletter/export.csv', adminNewsletterController.exportCsv);
router.post('/newsletter/:id/delete', csrfVerify, adminNewsletterController.deleteSubscriber);

router.get('/push', adminPushController.pushForm);
router.post('/push/send', csrfVerify, adminPushController.sendPush);

router.get('/accessibility-suggestions', adminAccessibilityController.listSuggestions);
router.post('/accessibility-suggestions/:id/delete', csrfVerify, adminAccessibilityController.deleteSuggestion);

router.get('/liveblog/:articleId/entries', adminLiveblogController.listEntries);
router.post('/liveblog/:articleId/entries', csrfVerify, adminLiveblogController.createEntry);
router.delete('/liveblog/:articleId/entries/:entryId', csrfVerify, adminLiveblogController.deleteEntry);

module.exports = router;
