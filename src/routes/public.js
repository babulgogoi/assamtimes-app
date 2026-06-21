const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const publicController = require('../controllers/publicController');
const menuItemsModel = require('../models/menuItems');
const siteSettingsModel = require('../models/siteSettings');

const likeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

router.use(async (req, res, next) => {
  res.locals.adsenseClientId = process.env.ADSENSE_CLIENT_ID;
  res.locals.adsenseSlotHeader = process.env.ADSENSE_SLOT_HEADER;
  res.locals.adsenseSlotSidebar = process.env.ADSENSE_SLOT_SIDEBAR;
  res.locals.adsenseSlotInArticle = process.env.ADSENSE_SLOT_IN_ARTICLE;
  try {
    res.locals.menuItems = await menuItemsModel.getActiveOrdered();
    res.locals.footerHtml = await siteSettingsModel.getFooterHtml();
  } catch (err) {
    return next(err);
  }
  next();
});

router.get('/', publicController.home);
router.get('/news', publicController.newsPage);
router.get('/article/:slug', publicController.articleDetail);
router.post('/article/:slug/like', likeLimiter, publicController.likeArticle);
router.get('/category/:category', publicController.categoryPage);
router.get('/author/:username', publicController.authorPage);
router.get('/search', publicController.searchPage);
router.get('/page/:slug', publicController.pageDetail);

module.exports = router;
