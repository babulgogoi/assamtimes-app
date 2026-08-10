const articlesModel = require('../models/articles');
const articleAuthorsModel = require('../models/articleAuthors');
const authorsModel = require('../models/authors');
const pagesModel = require('../models/pages');
const commentsModel = require('../models/comments');
const legacyRedirectsModel = require('../models/legacyRedirects');
const liveblogEntriesModel = require('../models/liveblogEntries');
const siteSettingsModel = require('../models/siteSettings');
const { renderEntryContent } = require('../utils/liveblogMarkdown');
const { thumbUrl } = require('../utils/imageVariants');
const CATEGORIES = require('../constants/categories');
const { verifyHcaptcha } = require('../utils/hcaptcha');
const slugify = require('../utils/slugify');

function buildBodyWithDateline(article) {
  if (!article.dateline || !article.body) return article.body;
  const datelineSlug = slugify(article.dateline);
  const pubDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const datelineHtml =
    `<span class="article-dateline"><a href="/tag/${encodeURIComponent(datelineSlug)}">${article.dateline.toUpperCase()}</a>${pubDate ? `, ${pubDate}` : ''} — </span>`;
  return article.body.replace(/(<p[^>]*>)/, '$1' + datelineHtml);
}

const CATEGORY_PAGE_SIZE = 12;
const AUTHOR_PAGE_SIZE = 12;
const SEARCH_PAGE_SIZE = 20;
const SEARCH_MIN_LENGTH = 2;
const NEWS_PAGE_SIZE = 18;
const TAG_PAGE_SIZE = 20;
const READING_WPM = 200;

// Tags are replaced with a space, not stripped to nothing, so adjacent block
// tags with no whitespace between them (e.g. "</p><p>") don't merge the
// last word of one paragraph into the first word of the next.
function calculateReadingTime(body) {
  const wordCount = (body || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / READING_WPM));
}

// Homepage redesign: hardcoded section order, each with its own size. Every
// section still queries its own latest articles live on every request —
// only the list of categories/order/sizing is fixed, not the content.
// `category: null` means "latest published overall, no category filter,
// except Features" (used for Latest News — Features is opinion/analysis,
// not news, and gets its own section below, so it's explicitly excluded
// via getLatestPublished's excludeCategory rather than left to overlap).
// `showHeader: false` suppresses the section's title bar/link — used for
// Latest News since it's the first section and the label is redundant.
const HOME_SECTIONS = [
  { category: null, label: 'Latest News', limit: 9, showHeader: false },
  { category: 'Features', label: 'Features', limit: 9, showHeader: true },
];
const EDITORS_PICKS_SIZE = 6;
const MOST_READ_PAGE_SIZE = 24;

const HERO_POOL_SIZE = 10; // 5 for the lead+grid, 5 for the sidebar — one query, no duplicates.
// Hero is the site's News section (Design B replaces Latest News' own
// hero+grid slot, see the `home()` render branch note in home.ejs), so it
// excludes Features the same way HOME_SECTIONS' Latest News entry does —
// fixed 2026-08-04, previously pulled from every category unfiltered and
// could show Features (opinion/analysis) pieces mixed into the news hero.
const FEATURES_SIDEBAR_SIZE = 5;

async function home(req, res, next) {
  try {
    const [sections, editorsPicks, sectionDesigns, heroPool, featuresSidebar] = await Promise.all([
      Promise.all(
        HOME_SECTIONS.map(({ category, label, limit, showHeader }) => {
          const fetch = category
            ? articlesModel.getByCategory({ category, limit })
            : articlesModel.getLatestPublished({ limit, excludeCategory: 'Features' });
          return fetch.then((articles) => ({ label, articles, showHeader }));
        })
      ),
      articlesModel.getEditorsPicks({ limit: EDITORS_PICKS_SIZE }),
      siteSettingsModel.getSectionDesigns(),
      articlesModel.getLatestPublished({ limit: HERO_POOL_SIZE, excludeCategory: 'Features' }),
      // Features Design B's sidebar column — offset past the 9-article pool
      // HOME_SECTIONS already fetches for featuredArticles (Design B's own
      // main column only ever uses the first 5 of those), so this is
      // guaranteed non-overlapping without a NOT IN clause. getByCategory
      // already filters status='published' AND is_advertisement=false.
      articlesModel.getByCategory({ category: 'Features', limit: FEATURES_SIDEBAR_SIZE, offset: 9 }),
    ]);

    // Design B for either section reuses the exact same already-fetched
    // array as Design A (both need "latest N articles" for the same
    // category) — no extra query, just exposed under a plain name instead
    // of nested in `sections` so the Design-B template blocks read cleanly.
    // Looked up by label rather than a hardcoded array index so this keeps
    // working if HOME_SECTIONS is ever reordered.
    const latestNews = (sections.find((s) => s.label === 'Latest News') || {}).articles || [];
    const featuredArticles = (sections.find((s) => s.label === 'Features') || {}).articles || [];

    // Hero Design B's lead+grid (first 5) and sidebar (next 5) — split from
    // one already-ordered-by-published_at pool instead of two separate
    // queries with a NOT IN, so there's no possibility of overlap.
    const heroArticles = heroPool.slice(0, 5);
    const heroSidebar = heroPool.slice(5, 10);

    res.render('public/home', {
      title: 'Assam Times',
      metaDescription: "Assam Times — Assam's community-powered online newspaper. Latest news, politics, business, and more from Assam and Northeast India.",
      editorsPicks,
      sections,
      sectionDesigns,
      latestNews,
      featuredArticles,
      heroArticles,
      heroSidebar,
      featuresSidebar,
      hideHeaderAd: true,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/latest-news?category=Assam&limit=8 — powers the Latest News
// Design-B AJAX tabs. `category` absent or 'All' means no filter (latest
// across every category); anything else is matched exactly against
// articles.category (same exact-match semantics as getByCategory/the
// existing /category/:category page — no slugification).
// featured_image_thumb is a fully resolved URL (via thumbUrl(), which checks
// disk and handles both new WebP and pre-WebP JPEG variants) rather than a
// bare filename the client would have to guess a suffix/extension for.
async function latestNewsApi(req, res, next) {
  try {
    const category = (req.query.category || '').trim();
    const limit = 8;

    const articles = !category || category === 'All'
      ? await articlesModel.getLatestPublished({ limit, excludeCategory: 'Features' })
      : await articlesModel.getByCategory({ category, limit });

    res.set('Cache-Control', 'public, max-age=60');
    res.json(
      articles.map((a) => ({
        slug: a.slug,
        title: a.title,
        published_at: a.published_at,
        author_name: a.author_name,
        featured_image_thumb: thumbUrl(a.featured_image),
        category: a.category,
      }))
    );
  } catch (err) {
    next(err);
  }
}

async function newsPage(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * NEWS_PAGE_SIZE;

    const [articles, total, mostViewed, latestNews] = await Promise.all([
      articlesModel.getLatestPublished({ limit: NEWS_PAGE_SIZE, offset }),
      articlesModel.countPublished(),
      articlesModel.getMostViewed({ limit: 5 }),
      articlesModel.getLatestPublished({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));

    res.render('public/news', {
      title: 'All News — Assam Times',
      metaDescription: 'The latest news from Assam Times, updated continuously.',
      articles,
      mostViewed,
      latestNews,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function mostReadPage(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * MOST_READ_PAGE_SIZE;

    const [articles, total, mostViewed] = await Promise.all([
      articlesModel.getMostViewed({ limit: MOST_READ_PAGE_SIZE, offset }),
      articlesModel.countPublished(),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / MOST_READ_PAGE_SIZE));

    res.render('public/most-read', {
      title: 'Most Read — Assam Times',
      metaDescription: 'The most-read articles on Assam Times, ranked by views.',
      articles,
      mostViewed,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function articleDetail(req, res, next) {
  try {
    const article = await articlesModel.getBySlug(req.params.slug);
    const isAdmin = !!(req.session && req.session.authorId);

    // Logged-in admins can view a draft/scheduled article at its real URL
    // (no separate preview token/route — getBySlug already returns any
    // status, this just relaxes the gate for them specifically). Nobody
    // else ever has this session cookie, so unpublished content stays
    // fully 404 for the public/crawlers.
    if (!article || (article.status !== 'published' && !isAdmin)) {
      return res.status(404).render('public/404', { title: 'Article Not Found' });
    }

    const isPreview = article.status !== 'published';

    const [related, authorArticles, comments, commentsCount, popularTags, coauthors, liveblogEntriesRaw, onThisDayAll, sectionDesigns] = await Promise.all([
      articlesModel.getRelatedByCategory({
        category: article.category,
        excludeId: article.id,
        limit: 5,
      }),
      article.author_id
        ? articlesModel.getOtherByAuthor({ authorId: article.author_id, excludeId: article.id, limit: 5 })
        : [],
      commentsModel.getApprovedByArticleId(article.id),
      commentsModel.countApproved(article.id),
      articlesModel.getPopularTags(20),
      articleAuthorsModel.getByArticleId(article.id),
      article.is_liveblog ? liveblogEntriesModel.listByArticleId(article.id, 100) : [],
      articlesModel.getOnThisDay(),
      siteSettingsModel.getSectionDesigns(),
    ]);

    const liveblogEntries = liveblogEntriesRaw.map((e) => ({ ...e, content_html: renderEntryContent(e.content) }));
    const onThisDayArticles = onThisDayAll.slice(0, 5);

    // Only count real reader views — an admin previewing a draft/scheduled
    // article must never inflate views_count before it's actually live.
    if (!isPreview) {
      articlesModel.incrementViewCount(article.id).catch((err) => {
        console.error('Failed to increment view count for article', article.id, err);
      });
    }

    res.render('public/article', {
      title: article.title,
      article,
      bodyWithDateline: buildBodyWithDateline(article),
      related,
      authorArticles,
      popularTags,
      coauthors,
      liveblogEntries,
      onThisDayArticles,
      readingTime: calculateReadingTime(article.body),
      comments,
      commentsCount,
      commentSubmitted: req.query.commented === '1',
      commentErrors: [],
      commentForm: null,
      isAdmin,
      isPreview,
      sectionDesigns,
      canonicalUrl: `${process.env.SITE_URL}/article/${article.slug}`,
      hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY,
    });
  } catch (err) {
    next(err);
  }
}

async function submitComment(req, res, next) {
  try {
    const article = await articlesModel.getBySlug(req.params.slug);
    if (!article || article.status !== 'published') {
      return res.status(404).render('public/404', { title: 'Article Not Found' });
    }

    // Honeypot — hidden from real visitors via CSS; bots that fill it out
    // get a silent success with nothing actually saved.
    if (req.body.website) {
      return res.redirect(`/article/${article.slug}#comments`);
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const body = (req.body.body || '').trim();
    const errors = [];
    if (!name) errors.push('Name is required.');
    if (!email) errors.push('Email is required.');
    if (!body) errors.push('Comment is required.');

    const captchaOk = await verifyHcaptcha(req.body['h-captcha-response'], req.ip);
    if (!captchaOk) errors.push('Captcha verification failed — please try again.');

    if (errors.length) {
      const [related, authorArticles, comments, commentsCount, popularTags, coauthors, liveblogEntriesRaw, onThisDayAll, sectionDesigns] = await Promise.all([
        articlesModel.getRelatedByCategory({ category: article.category, excludeId: article.id, limit: 5 }),
        article.author_id
          ? articlesModel.getOtherByAuthor({ authorId: article.author_id, excludeId: article.id, limit: 5 })
          : [],
        commentsModel.getApprovedByArticleId(article.id),
        commentsModel.countApproved(article.id),
        articlesModel.getPopularTags(20),
        articleAuthorsModel.getByArticleId(article.id),
        article.is_liveblog ? liveblogEntriesModel.listByArticleId(article.id, 100) : [],
        articlesModel.getOnThisDay(),
        siteSettingsModel.getSectionDesigns(),
      ]);
      const liveblogEntries = liveblogEntriesRaw.map((e) => ({ ...e, content_html: renderEntryContent(e.content) }));
      return res.status(400).render('public/article', {
        title: article.title,
        article,
        bodyWithDateline: buildBodyWithDateline(article),
        related,
        authorArticles,
        popularTags,
        coauthors,
        liveblogEntries,
        onThisDayArticles: onThisDayAll.slice(0, 5),
        readingTime: calculateReadingTime(article.body),
        comments,
        commentsCount,
        commentSubmitted: false,
        commentErrors: errors,
        commentForm: { name, email, body },
        isAdmin: !!(req.session && req.session.authorId),
        sectionDesigns,
        canonicalUrl: `${process.env.SITE_URL}/article/${article.slug}`,
        hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY,
      });
    }

    await commentsModel.create({
      articleId: article.id,
      authorName: name,
      authorEmail: email,
      body,
      ipAddress: req.ip,
    });

    res.redirect(`/article/${article.slug}?commented=1#comments`);
  } catch (err) {
    next(err);
  }
}

async function likeArticle(req, res, next) {
  try {
    const article = await articlesModel.getBySlug(req.params.slug);
    if (!article || article.status !== 'published') {
      return res.status(404).json({ error: 'Article not found' });
    }

    const likes = await articlesModel.incrementLikeCount(article.id);
    res.json({ likes });
  } catch (err) {
    next(err);
  }
}

async function categoryPage(req, res, next) {
  try {
    const category = req.params.category;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * CATEGORY_PAGE_SIZE;

    const [articles, total, mostViewed, latestNews] = await Promise.all([
      articlesModel.getByCategory({ category, limit: CATEGORY_PAGE_SIZE, offset }),
      articlesModel.countByCategory(category),
      articlesModel.getMostViewed({ limit: 5 }),
      articlesModel.getLatestPublished({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE));

    res.render('public/category', {
      title: `${category} — Assam Times`,
      metaDescription: `Latest ${category} news from Assam Times.`,
      category,
      articles,
      mostViewed,
      latestNews,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

// Full-width, no sidebar — same layout choice as searchPage, not
// categoryPage's mostViewed/latestNews sidebar. Tags are stored lowercase
// (see adminController.js's buildArticleData), so normalize the param the
// same way rather than expecting callers/links to get casing right.
async function tagPage(req, res, next) {
  try {
    const tag = decodeURIComponent(req.params.tag).toLowerCase().trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * TAG_PAGE_SIZE;

    const [articles, total] = await Promise.all([
      articlesModel.getByTag({ tag, limit: TAG_PAGE_SIZE, offset }),
      articlesModel.countByTag(tag),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / TAG_PAGE_SIZE));

    res.render('public/tag', {
      title: `Articles tagged "${tag}" — Assam Times`,
      metaDescription: `${total} article${total === 1 ? '' : 's'} tagged "${tag}" on Assam Times.`,
      tag,
      articles,
      total,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function onThisDayPage(req, res, next) {
  try {
    const articles = await articlesModel.getOnThisDay();

    const byYear = {};
    articles.forEach((article) => {
      const year = article.pub_year;
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(article);
    });
    const years = Object.keys(byYear).sort((a, b) => b - a);

    const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

    res.render('public/on-this-day', {
      title: `On This Day: ${dateStr} — Assam Times`,
      metaDescription: `${articles.length} article${articles.length === 1 ? '' : 's'} published on ${dateStr} across ${years.length} year${years.length === 1 ? '' : 's'} on Assam Times.`,
      byYear,
      years,
      dateStr,
      total: articles.length,
    });
  } catch (err) {
    next(err);
  }
}

// Legacy Drupal 7 profile URLs (/user/62, /user/62/edit, /user/62/view) still get
// hits from Google and old inbound links — 301 them to the new author page.
async function legacyUserRedirect(req, res, next) {
  try {
    const oldUid = parseInt(req.params.uid, 10);
    if (!Number.isInteger(oldUid)) {
      return res.status(404).render('public/404', { title: 'Author Not Found' });
    }

    const author = await authorsModel.getByOldUid(oldUid);
    if (!author) {
      return res.status(404).render('public/404', { title: 'Author Not Found' });
    }

    res.redirect(301, `/author/${author.username}`);
  } catch (err) {
    next(err);
  }
}

// D7's url_alias table has ~11 pretty top-level aliases for top-level taxonomy
// categories (e.g. /region, /politics, /hot-news for "Latest News") — checked
// directly against the live category name since the route list itself
// (src/routes/public.js) is already scoped to just those known aliases.
async function legacyCategoryAliasRedirect(req, res, next) {
  try {
    const alias = req.path.slice(1); // strip leading '/'
    const category = alias === 'hot-news' ? 'Latest News' : CATEGORIES.find(
      (c) => c.toLowerCase() === alias.toLowerCase()
    );
    if (!category) {
      return res.redirect(302, '/');
    }
    res.redirect(301, `/category/${encodeURIComponent(category)}`);
  } catch (err) {
    next(err);
  }
}

// /taxonomy/term/:tid[/all][/feed] — only known top-level categories (the ones
// the live site actually uses, see src/constants/categories.js) get a real
// /category/:name redirect; everything else (D7 had ~2,700 terms — tags, sub-
// categories, etc. with no equivalent here) falls back to the homepage rather
// than a category page guaranteed to have zero matching articles.
async function legacyTaxonomyRedirect(req, res, next) {
  try {
    const tid = parseInt(req.params.tid, 10);
    if (!Number.isInteger(tid)) {
      return res.redirect(302, '/');
    }

    const category = await legacyRedirectsModel.getCategoryByTid(tid);
    if (!category) {
      return res.redirect(302, '/');
    }

    res.redirect(301, `/category/${encodeURIComponent(category)}`);
  } catch (err) {
    next(err);
  }
}

async function authorPage(req, res, next) {
  try {
    const author = await authorsModel.getByUsername(req.params.username);

    if (!author) {
      return res.status(404).render('public/404', { title: 'Author Not Found' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * AUTHOR_PAGE_SIZE;

    const [articles, total, mostViewed, contributedArticles] = await Promise.all([
      articlesModel.getByAuthorId({ authorId: author.id, limit: AUTHOR_PAGE_SIZE, offset }),
      articlesModel.countByAuthorId(author.id),
      articlesModel.getMostViewed({ limit: 5 }),
      articleAuthorsModel.getContributedByUsername(author.username),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / AUTHOR_PAGE_SIZE));

    res.render('public/author', {
      title: `${author.display_name || author.username} — Assam Times`,
      metaDescription: `Articles by ${author.display_name || author.username} on Assam Times.`,
      author,
      articles,
      mostViewed,
      contributedArticles,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function searchPage(req, res, next) {
  try {
    const q = (req.query.q || '').trim();

    if (q.length < SEARCH_MIN_LENGTH) {
      return res.render('public/search', {
        title: 'Search — Assam Times',
        q,
        articles: [],
        total: 0,
        page: 1,
        totalPages: 1,
        tooShort: q.length > 0,
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * SEARCH_PAGE_SIZE;

    const [articles, total] = await Promise.all([
      articlesModel.search({ query: q, limit: SEARCH_PAGE_SIZE, offset }),
      articlesModel.countSearch(q),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));

    res.render('public/search', {
      title: `Search: ${q} — Assam Times`,
      q,
      articles,
      total,
      page,
      totalPages,
      tooShort: false,
    });
  } catch (err) {
    next(err);
  }
}

async function pageDetail(req, res, next) {
  try {
    const page = await pagesModel.getBySlug(req.params.slug);

    if (!page || page.status !== 'published') {
      return res.status(404).render('public/404', { title: 'Page Not Found' });
    }

    res.render('public/page', {
      title: page.title,
      metaDescription: page.body ? page.body.replace(/<[^>]*>/g, '').substring(0, 160) : '',
      page,
    });
  } catch (err) {
    next(err);
  }
}

async function subscribePage(req, res, next) {
  try {
    res.render('public/subscribe', {
      title: 'Subscribe — Assam Times',
      metaDescription: 'Subscribe to Assam Times for free breaking news alerts by email and browser push notifications.',
      newsletterStatus: req.query.newsletter === 'success' || req.query.newsletter === 'error' ? req.query.newsletter : null,
    });
  } catch (err) {
    next(err);
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sitemapUrlTag({ loc, lastmod, changefreq, priority }) {
  const parts = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  parts.push('  </url>');
  return parts.join('\n');
}

async function sitemapXml(req, res, next) {
  try {
    const [articles, pages, tags] = await Promise.all([
      articlesModel.getAllPublishedForSitemap(),
      pagesModel.getAllPublished(),
      articlesModel.getDistinctTags(),
    ]);

    const siteUrl = process.env.SITE_URL;
    const urls = [
      sitemapUrlTag({ loc: `${siteUrl}/`, changefreq: 'daily', priority: '1.0' }),
      sitemapUrlTag({ loc: `${siteUrl}/news`, changefreq: 'hourly', priority: '0.9' }),
      ...articles.map((a) =>
        sitemapUrlTag({
          loc: `${siteUrl}/article/${a.slug}`,
          lastmod: new Date(a.updated_at || a.published_at).toISOString(),
          changefreq: 'weekly',
          priority: '0.8',
        })
      ),
      ...pages.map((p) =>
        sitemapUrlTag({
          loc: `${siteUrl}/page/${p.slug}`,
          lastmod: p.updated_at ? new Date(p.updated_at).toISOString() : undefined,
          changefreq: 'monthly',
          priority: '0.5',
        })
      ),
      ...tags.map((tag) =>
        sitemapUrlTag({
          loc: `${siteUrl}/tag/${encodeURIComponent(tag)}`,
          changefreq: 'weekly',
          priority: '0.4',
        })
      ),
    ];

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') +
      '\n</urlset>\n';

    res.type('application/xml').send(xml);
  } catch (err) {
    next(err);
  }
}

// Polling endpoint for the live blog's client-side auto-refresh — same
// public-visibility gate as articleDetail (must be published), plus must
// actually be a live blog at all, regardless of current live/ended status
// (a reader's tab open on an article that just got marked 'ended' should
// still get one last poll back confirming that, not a 404).
async function liveblogEntriesApi(req, res, next) {
  try {
    const article = await articlesModel.getById(req.params.articleId);
    if (!article || !article.is_liveblog || article.status !== 'published') {
      return res.status(404).json({ error: 'Not found' });
    }

    const since = req.query.since ? new Date(req.query.since) : null;
    const entries = await liveblogEntriesModel.listSince(article.id, since, 50);

    res.json({
      entries: entries.map((e) => ({ ...e, content_html: renderEntryContent(e.content) })),
      liveblog_status: article.liveblog_status,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  home,
  sitemapXml,
  liveblogEntriesApi,
  latestNewsApi,
  newsPage,
  mostReadPage,
  articleDetail,
  submitComment,
  likeArticle,
  categoryPage,
  tagPage,
  onThisDayPage,
  authorPage,
  legacyUserRedirect,
  legacyCategoryAliasRedirect,
  legacyTaxonomyRedirect,
  searchPage,
  pageDetail,
  subscribePage,
};
