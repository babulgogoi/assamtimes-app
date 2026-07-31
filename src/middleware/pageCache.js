const NodeCache = require('node-cache');

// Simple in-memory full-page HTML cache. Correct as a single shared
// cache only because the app runs as a single pm2 instance (see
// ecosystem.config.js) — if this ever scales to multiple instances,
// an in-process cache would go stale/inconsistent across them and
// would need to move to something shared (Redis etc).
//
// Caches the rendered HTML string keyed by the full request URL (so
// /category/Sports and /category/Sports?page=2 are cached separately),
// only for successful (200) GET responses. Never applied to /admin/*
// routes — this middleware is only ever mounted on specific public
// routes in src/routes/public.js, not globally.
function createPageCache(ttlSeconds, name = 'page', contentType = 'text/html; charset=utf-8') {
  const store = new NodeCache({ stdTTL: ttlSeconds, checkperiod: Math.min(60, ttlSeconds) });

  function middleware(req, res, next) {
    if (req.method !== 'GET') return next();

    const key = req.originalUrl;
    const cached = store.get(key);
    if (cached !== undefined) {
      res.set('X-Cache', 'HIT');
      res.set('Content-Type', contentType);
      res.send(cached);
      return;
    }

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (res.statusCode === 200 && typeof body === 'string') {
        store.set(key, body);
      }
      res.set('X-Cache', 'MISS');
      return originalSend(body);
    };
    next();
  }

  middleware.flush = () => {
    const keys = store.keys();
    store.flushAll();
    console.log(`[pageCache:${name}] flushed (${keys.length} key(s): ${keys.join(', ') || 'none'})`);
  };
  middleware.del = (key) => store.del(key);
  return middleware;
}

module.exports = { createPageCache };
