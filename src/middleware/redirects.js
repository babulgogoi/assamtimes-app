const pool = require('../config/db');

// Mounted as a fallback after all real routes, so normal traffic never pays for this lookup.
async function redirectMiddleware(req, res, next) {
  try {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path);
    } catch {
      decodedPath = req.path;
    }
    const oldPath = decodedPath.replace(/^\/+/, '');
    if (!oldPath) return next();

    const { rows } = await pool.query(
      `SELECT a.slug
       FROM redirects r
       JOIN articles a ON a.id = r.article_id
       WHERE r.old_path = $1`,
      [oldPath]
    );

    if (rows.length) {
      return res.redirect(301, `/article/${rows[0].slug}`);
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = redirectMiddleware;
