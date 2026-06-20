const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuthorsController = require('../controllers/adminAuthorsController');
const { requireAuth } = require('../middleware/auth');
const { uploadArticleFiles } = require('../middleware/upload');

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
router.post('/authors', adminAuthorsController.createAuthor);
router.get('/authors/:id/edit', adminAuthorsController.editAuthorForm);
router.post('/authors/:id', adminAuthorsController.updateAuthor);

module.exports = router;
