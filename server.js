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
const feedRoutes = require('./src/routes/feed');
const pushRoutes = require('./src/routes/push');
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

// Known bot/scanner bait — D7-era PHP entry points (we run Node, so these
// never existed here) and a CAPTCHA-probe pattern that alone was ~35% of
// recent 404 traffic. Mounted before morgan/helmet/compression so these
// short-circuit immediately: no access log line, no DB-backed menu/footer
// lookups, nothing.
const BOT_BAIT_PATTERNS = [
  /^\/update\.php$/,
  /^\/cron\.php$/,
  /^\/xmlrpc\.php$/,
  /^\/install\.php$/,
  /^\/draggable-captcha/,
];
app.use((req, res, next) => {
  if (BOT_BAIT_PATTERNS.some((re) => re.test(req.path))) {
    return res.status(404).end();
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Allowlist built from what's actually loaded/embedded across the codebase
// (grepped every external https:// reference in views/ + public/js/ rather
// than assuming), not a generic template. Notable corrections to the usual
// "known third-party sources" list:
// - X/Twitter embeds (views/public/article.ejs) load platform.x.com and the
//   widgets.js script builds an embedded-tweet IFRAME — both scriptSrc and
//   frameSrc need platform.x.com/platform.twitter.com, or the tweet embed
//   feature breaks outright. *.twitter.com/*.twimg.com alone do not cover
//   the actual script origin.
// - No fonts.googleapis.com anywhere (Google Fonts was fully removed in
//   favor of a system font stack) — styleSrc doesn't need *.googleapis.com.
// - No client-side fetch() anywhere targets newsletter.assamtimes.org (that
//   subdomain is only used server-side for outbound mail) — connectSrc
//   doesn't need it.
// 'unsafe-inline' on scriptSrc/styleSrc is genuinely required: GA4's inline
// config, the dark-mode/high-contrast anti-flash script, and the
// hand-maintained critical-CSS <style> block are all real inline blocks
// with no nonce/hash today.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "*.googletagmanager.com",
        "*.google-analytics.com",
        "pagead2.googlesyndication.com",
        "*.googlesyndication.com",
        "*.googleadservices.com",
        "hcaptcha.com", "*.hcaptcha.com",
        "platform.x.com", "platform.twitter.com",
        "static.cloudflareinsights.com",
        "challenges.cloudflare.com",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "hcaptcha.com", "*.hcaptcha.com",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "*.google-analytics.com",
        "*.googletagmanager.com",
        "*.googlesyndication.com",
        // CC license badge in the admin-edited footer_html (DB-stored, not in
        // views/) — i.creativecommons.org 301-redirects to licensebuttons.net,
        // and CSP checks the final redirect target too, so both are needed.
        "i.creativecommons.org", "licensebuttons.net",
      ],
      frameSrc: [
        "'self'",
        "*.youtube.com",
        "*.facebook.com",
        "platform.x.com", "platform.twitter.com",
        "hcaptcha.com", "*.hcaptcha.com",
        "googleads.g.doubleclick.net",
        "*.googlesyndication.com",
        // Homepage embed widget's first real use (chart embed) — see
        // site_settings.homepage_embed_html in home.ejs. Admin-pasted
        // arbitrary iframes still need their specific domain allowlisted
        // here one at a time; this isn't a blanket "any domain" opt-in.
        "ourworldindata.org", "*.ourworldindata.org",
      ],
      connectSrc: [
        "'self'",
        "*.google-analytics.com",
        "*.googletagmanager.com",
        "*.analytics.google.com",
        "hcaptcha.com", "*.hcaptcha.com",
      ],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // would block the YouTube/Facebook/X/hCaptcha iframes above
}));
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

// Long cache lifetimes for static assets — uploads are immutable once
// written (admin re-saves replace the filename, they don't overwrite it),
// so a full year + `immutable` is safe there (a CDN/browser holding a
// `-thumb.jpg` URL for a year is fine, since that exact URL never changes
// content). App-owned CSS/JS gets a shorter 7d instead — those have no
// cache-busting filename/hash, just an in-place overwrite on every
// `npm run minify`, so a long cache there risks visitors' own browsers
// (not just Cloudflare, which we can purge) serving stale CSS/JS for as
// long as that maxAge, with no way to force a refresh after the fact.
const STATIC_OPTS = { maxAge: '7d', etag: true };
const UPLOADS_OPTS = { maxAge: '1y', etag: true, immutable: true };

// Service worker must be revalidated quickly so a future fix/update
// actually reaches subscribed browsers — the blanket 7d cache below would
// otherwise apply to it too. Mounted first so it wins over that route.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public'), STATIC_OPTS));
// Self-hosted so the admin editor works with no API key/CDN dependency.
app.use('/vendor/tinymce', express.static(path.join(__dirname, 'node_modules/tinymce'), UPLOADS_OPTS));
app.use('/uploads/articles', express.static(process.env.UPLOADS_ARTICLES_DIR, UPLOADS_OPTS));
app.use('/uploads/audio', express.static(process.env.UPLOADS_AUDIO_DIR, UPLOADS_OPTS));
app.use('/uploads/documents', express.static(process.env.UPLOADS_DOCUMENTS_DIR, UPLOADS_OPTS));
app.use('/uploads/defaults', express.static(process.env.UPLOADS_DEFAULTS_DIR, UPLOADS_OPTS));
app.use('/uploads/branding', express.static(process.env.UPLOADS_BRANDING_DIR, UPLOADS_OPTS));
app.use('/uploads/authors', express.static(process.env.UPLOADS_AUTHORS_DIR, UPLOADS_OPTS));

// Fallback for files that just sit in the old Nginx docroot (ads.txt,
// robots.txt, favicon.ico, etc.) — served as-is with no per-file route
// needed. Registered last so it never shadows the more specific
// /uploads/* mounts above for paths both happen to contain.
app.use(express.static('/home/assam1/web/assamtimes.org/public_html', STATIC_OPTS));

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', dbTime: result.rows[0].now });
  } catch (err) {
    console.error('Health check DB query failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Old inbound links/cached pages sometimes carry a trailing slash D7 never
// actually used (e.g. /article/some-slug-123/) — normalize before routing
// so these don't 404 just for that.
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path !== '/' && req.path.endsWith('/')) {
    const query = req.url.slice(req.path.length);
    return res.redirect(301, req.path.slice(0, -1) + query);
  }
  next();
});

// Belt-and-suspenders: Cloudflare's own edge-cache rule is already scoped
// to just the homepage/category/article HTML (confirmed live — /admin/login
// already comes back cf-cache-status: DYNAMIC, never cached), but these
// paths are either session-specific (/admin), live polling data (/api/*),
// or one-shot actions (/newsletter/subscribe, /newsletter/unsubscribe) —
// none should ever be cached even if that CF rule is ever broadened.
app.use(['/admin', '/api', '/newsletter/subscribe', '/newsletter/unsubscribe'], (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

app.use('/admin', adminRoutes);
app.use('/feed', feedRoutes);
app.use('/push', pushRoutes);
app.get('/rss.xml', (req, res) => res.redirect(301, '/feed'));
app.get('/rss', (req, res) => res.redirect(301, '/feed'));
app.use('/', publicRoutes);

// Fallback for old Drupal URLs (node/N, content/slug) not matched by any route above.
app.use(redirectMiddleware);

// Global fallback for anything else (D7 file paths, search, random/typo'd
// paths, etc.) — rather than a dead-end 404 page, bounce GET requests home.
// 302, not 301: this is "we don't know what this was," not "this content
// permanently moved here." Admin and non-GET requests still get a real 404.
app.use((req, res) => {
  if (req.path.startsWith('/admin') || req.method !== 'GET') {
    return res.status(404).send('Not found');
  }
  res.redirect(302, '/');
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`assamtimes.org server running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    Promise.all([pool.end(), require('./src/utils/pdfBrowser').closeBrowser()]).then(() => {
      process.exit(0);
    });
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
