function requireAuth(req, res, next) {
  if (req.session && req.session.authorId) {
    return next();
  }
  return res.redirect('/admin/login');
}

module.exports = { requireAuth };
