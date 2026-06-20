function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] Unhandled error on ${req.method} ${req.originalUrl}:`, err);

  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || 500;

  if (req.path.startsWith('/admin')) {
    return res.status(status).send('Something went wrong. Check the server logs for details.');
  }

  res.status(status).render('public/500', { title: 'Something Went Wrong' });
}

module.exports = errorHandler;
