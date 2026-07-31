const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pushController = require('../controllers/pushController');

const pushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
});

router.post('/subscribe', pushLimiter, pushController.subscribe);
router.post('/unsubscribe', pushLimiter, pushController.unsubscribe);

module.exports = router;
