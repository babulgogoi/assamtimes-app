const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthorsController = require('../controllers/adminAuthorsController');
const adminPagesController = require('../controllers/adminPagesController');
const adminMenuController = require('../controllers/adminMenuController');
const adminSettingsController = require('../controllers/adminSettingsController');
const { requireAuth } = require('../middleware/auth');
const { uploadArticleFiles, uploadAuthorPhoto } = require('../middleware/upload');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

router.get('/login', adminController.loginForm);
router.post('/login', loginLimiter, adminController.login);
router.post('/logout', adminController.logout);

router.use(requireAuth);

router.get('/', (req, res) => res.redirect('/admin/articles'));

router.get('/articles', adminController.listArticles);
router.get('/articles/new', adminController.newArticleForm);
router.post('/articles', uploadArticleFiles, adminController.createArticle);
router.get('/articles/:id/edit', adminController.editArticleForm);
router.post('/articles/:id', uploadArticleFiles, adminController.updateArticle);
router.post('/articles/:id/delete', adminController.deleteArticle);

router.get('/authors', adminAuthorsController.listAuthors);
router.get('/authors/new', adminAuthorsController.newAuthorForm);
router.post('/authors', uploadAuthorPhoto, adminAuthorsController.createAuthor);
router.get('/authors/:id/edit', adminAuthorsController.editAuthorForm);
router.post('/authors/:id', uploadAuthorPhoto, adminAuthorsController.updateAuthor);

router.get('/pages', adminPagesController.listPages);
router.get('/pages/new', adminPagesController.newPageForm);
router.post('/pages', adminPagesController.createPage);
router.get('/pages/:id/edit', adminPagesController.editPageForm);
router.post('/pages/:id', adminPagesController.updatePage);
router.post('/pages/:id/delete', adminPagesController.deletePage);

router.get('/menu', adminMenuController.listMenuItems);
router.get('/menu/new', adminMenuController.newMenuItemForm);
router.post('/menu', adminMenuController.createMenuItem);
router.get('/menu/:id/edit', adminMenuController.editMenuItemForm);
router.post('/menu/:id', adminMenuController.updateMenuItem);
router.post('/menu/:id/delete', adminMenuController.deleteMenuItem);

router.get('/settings', adminSettingsController.editSettingsForm);
router.post('/settings', adminSettingsController.updateSettings);

module.exports = router;
