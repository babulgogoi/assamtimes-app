require('dotenv').config();

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const validateEnv = require('./src/config/validateEnv');

try {
  validateEnv();
} catch (err) {
  console.error('Startup aborted:', err.message);
  process.exit(1);
}

const pool = require('./src/config/db');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const redirectMiddleware = require('./src/middleware/redirects');
const errorHandler = require('./src/middleware/errorHandler');

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

const app = express();

// Behind a reverse proxy (cPanel/Apache/Nginx) in production — needed for correct
// req.ip and secure-cookie detection.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// CSP stays off: AdSense's actual domain allowlist depends on which ad features are enabled in the
// dashboard (auto ads, matched content, etc.) and can't be pinned down accurately with placeholder IDs.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}));

app.use(express.static(path.join(__dirname, 'public')));
// Self-hosted so the admin editor works with no API key/CDN dependency.
app.use('/vendor/tinymce', express.static(path.join(__dirname, 'node_modules/tinymce')));
app.use('/uploads/articles', express.static(process.env.UPLOADS_ARTICLES_DIR));
app.use('/uploads/audio', express.static(process.env.UPLOADS_AUDIO_DIR));
app.use('/uploads/documents', express.static(process.env.UPLOADS_DOCUMENTS_DIR));
app.use('/uploads/defaults', express.static(process.env.UPLOADS_DEFAULTS_DIR));
app.use('/uploads/branding', express.static(process.env.UPLOADS_BRANDING_DIR));
app.use('/uploads/authors', express.static(process.env.UPLOADS_AUTHORS_DIR));

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', dbTime: result.rows[0].now });
  } catch (err) {
    console.error('Health check DB query failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

// Fallback for old Drupal URLs (node/N, content/slug) not matched by any route above.
app.use(redirectMiddleware);

app.use((req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.status(404).send('Not found');
  }
  res.status(404).render('public/404', { title: 'Not Found' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`assamtimes.org server running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    pool.end(() => {
      process.exit(0);
    });
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
