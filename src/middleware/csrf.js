const Tokens = require('csrf');
const tokens = new Tokens();

// Generates (once per session) a secret and, on every request, a fresh token
// derived from it — exposed to templates as `csrfToken` via res.locals (same
// mechanism this app already uses for authorName/pendingCommentsCount/etc.,
// no explicit per-render passing needed).
function csrfMiddleware(req, res, next) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  res.locals.csrfToken = tokens.create(req.session.csrfSecret);
  next();
}

// Checks a submitted token (form field `_csrf` or, for AJAX/fetch calls that
// can't embed a hidden input, the `x-csrf-token` header) against the
// session's secret. GET/HEAD/OPTIONS never mutate state, so they're exempt.
function csrfVerify(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  // req.body is undefined (not even {}) on multipart/form-data requests at
  // this point — multer hasn't parsed it yet, since it's mounted after this
  // middleware on the upload routes. Those routes send the token via the
  // x-csrf-token header instead (see admin-article-image.js), so this must
  // not assume req.body exists.
  const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (!req.session.csrfSecret || !tokens.verify(req.session.csrfSecret, token)) {
    // No views/error.ejs exists in this app — matching the existing admin
    // error convention (src/middleware/errorHandler.js sends plain text for
    // /admin paths rather than rendering a template).
    return res.status(403).send('Invalid or expired form token. Please go back and try again.');
  }
  next();
}

module.exports = { csrfMiddleware, csrfVerify };
