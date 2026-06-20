const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.use((req, res, next) => {
  res.locals.adsenseClientId = process.env.ADSENSE_CLIENT_ID;
  res.locals.adsenseSlotHeader = process.env.ADSENSE_SLOT_HEADER;
  res.locals.adsenseSlotSidebar = process.env.ADSENSE_SLOT_SIDEBAR;
  res.locals.adsenseSlotInArticle = process.env.ADSENSE_SLOT_IN_ARTICLE;
  next();
});

router.get('/', publicController.home);
router.get('/article/:slug', publicController.articleDetail);
router.get('/category/:category', publicController.categoryPage);
router.get('/author/:username', publicController.authorPage);
router.get('/search', publicController.searchPage);
router.get('/page/:slug', publicController.pageDetail);

module.exports = router;
