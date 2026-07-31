const express = require('express');
const router = express.Router();
const feedController = require('../controllers/feedController');
const { createPageCache } = require('../middleware/pageCache');

const feedCache = createPageCache(5 * 60, 'feed', 'application/rss+xml; charset=utf-8');

router.get('/', feedCache, feedController.mainFeed);
router.get('/category/:slug', feedCache, feedController.categoryFeed);
router.get('/author/:username', feedCache, feedController.authorFeed);

module.exports = router;
