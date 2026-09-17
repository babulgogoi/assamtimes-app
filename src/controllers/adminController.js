const bcrypt = require('bcryptjs');
const authorsModel = require('../models/authors');
const articlesModel = require('../models/articles');
const articleAuthorsModel = require('../models/articleAuthors');
const articleRevisionsModel = require('../models/articleRevisions');
const slugify = require('../utils/slugify');
const { urlFor, deleteUploadedFile, uploadErrorMessages, compressImageFile, generateFeaturedImageVariants } = require('../middleware/upload');
const { thumbUrl } = require('../utils/imageVariants');
const { autoPostToFacebook, autoPostToTwitter } = require('../utils/autoPostSocial');
const { purgeArticle } = require('../utils/cloudflarePurge');
const { sendPushToAll } = require('../utils/pushSender');
const { homepageCache, categoryPageCache } = require('../routes/public');
const CATEGORIES = require('../constants/categories');

const ADMIN_PAGE_SIZE = 20;

function cleanupReplacedFiles(oldArticle, newData) {
  if (oldArticle.featured_image && oldArticle.featured_image !== newData.featured_image) {
    deleteUploadedFile(oldArticle.featured_image);
  }
  if (oldArticle.audio_file && oldArticle.audio_file !== newData.audio_file) {
    deleteUploadedFile(oldArticle.audio_file);
  }
  if (oldArticle.pdf_file && oldArticle.pdf_file !== newData.pdf_file) {
    deleteUploadedFile(oldArticle.pdf_file);
  }
  const newGalleryUrls = (newData.gallery_images || []).map((img) => img.url);
  (oldArticle.gallery_images || [])
    .filter((img) => !newGalleryUrls.includes(img.url))
    .forEach((img) => deleteUploadedFile(img.url));
}

function loginForm(req, res) {
  if (req.session && req.session.authorId) {
    return res.redirect('/admin');
  }
  res.render('admin/login', { title: 'Admin Login', error: null, layout: false });
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const author = await authorsModel.getByUsernameForAuth(username || '');

    const invalid = !author || !author.password_hash || !(await bcrypt.compare(password || '', author.password_hash));
    if (invalid) {
      return res.status(401).render('admin/login', { title: 'Admin Login', error: 'Invalid username or password.', layout: false });
    }

    req.session.authorId = author.id;
    req.session.authorName = author.display_name || author.username;
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect('/admin/login');
  });
}

async function listArticles(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = (req.query.q || '').trim();
    const status = req.query.status || '';
    const offset = (page - 1) * ADMIN_PAGE_SIZE;

    const [articles, total] = await Promise.all([
      articlesModel.listForAdmin({ limit: ADMIN_PAGE_SIZE, offset, q, status }),
      articlesModel.countForAdmin({ q, status }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

    res.locals.layout = 'admin/layout';
    res.render('admin/articles/list', {
      title: 'Articles — Admin',
      authorName: req.session.authorName,
      articles,
      q,
      status,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function newArticleForm(req, res, next) {
  try {
    const [authors, datelines] = await Promise.all([
      authorsModel.getAll(),
      articlesModel.getDistinctDatelines(),
    ]);
    res.locals.layout = 'admin/layout';
    res.render('admin/articles/form', {
      title: 'New Article — Admin',
      authorName: req.session.authorName,
      authors,
      categories: CATEGORIES,
      thumbUrl,
      datelines,
      article: null,
      errors: uploadErrorMessages(req.query.uploadError),
      coauthors: [],
    });
  } catch (err) {
    next(err);
  }
}

async function editArticleForm(req, res, next) {
  try {
    const article = await articlesModel.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }
    const [authors, coauthors, datelines] = await Promise.all([
      authorsModel.getAll(),
      articleAuthorsModel.getByArticleId(article.id),
      articlesModel.getDistinctDatelines(),
    ]);
    res.locals.layout = 'admin/layout';
    res.render('admin/articles/form', {
      title: `Edit: ${article.title} — Admin`,
      authorName: req.session.authorName,
      authors,
      categories: CATEGORIES,
      thumbUrl,
      datelines,
      article,
      errors: uploadErrorMessages(req.query.uploadError),
      coauthors,
      fbStatus: req.query.fb === 'posted' || req.query.fb === 'failed' ? req.query.fb : null,
      twitterStatus: req.query.twitter === 'posted' || req.query.twitter === 'failed' ? req.query.twitter : null,
    });
  } catch (err) {
    next(err);
  }
}

function buildSocialStatusQuery(fbStatus, twitterStatus) {
  const params = [];
  if (fbStatus) params.push('fb=' + fbStatus);
  if (twitterStatus) params.push('twitter=' + twitterStatus);
  return params.length ? '?' + params.join('&') : '';
}

// Builds the push payload for a just-published article. icon-192.png/
// badge-72.png (the filenames a generic push brief usually assumes) don't
// exist in uploads/branding/ — using the real assets there instead:
// android-chrome-192x192.png (an exact 192x192 match) for the icon, and
// favicon-32x32.png for the badge (no dedicated small monochrome badge
// asset exists in this app).
function sendArticlePush(data) {
  const siteUrl = process.env.SITE_URL;
  return sendPushToAll({
    title: data.title,
    body: data.excerpt || data.title.slice(0, 100),
    url: `${siteUrl}/article/${data.slug}`,
    icon: `${siteUrl}/uploads/branding/android-chrome-192x192.png`,
    badge: `${siteUrl}/uploads/branding/favicon-32x32.png`,
  });
}

async function resolveAuthorId(body) {
  const newUsername = (body.new_author_username || '').trim();
  if (newUsername) {
    const author = await authorsModel.findOrCreate({
      username: newUsername,
      displayName: (body.new_author_display_name || '').trim() || newUsername,
    });
    return author.id;
  }
  const id = Number(body.author_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Normalises one gallery entry from the hidden `gallery_data` JSON into the
// stored {url, alt, caption} shape. Tolerates the legacy shapes: a bare
// filename/url string, and the older {url, caption} object (no alt). Returns
// null for anything without a usable url so it's filtered out.
function normaliseGalleryItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    return { url: item, alt: '', caption: '' };
  }
  const url = item.url || (item.filename ? `/uploads/articles/${item.filename}` : null);
  if (!url) return null;
  return {
    url,
    alt: (item.alt || '').toString().trim().slice(0, 200),
    caption: (item.caption || '').toString().trim(),
  };
}

// Co-author rows are indexed fields (coauthor_id_0, coauthor_id_1, ...) —
// scanning all present keys rather than while(body[`coauthor_id_${i}`] !==
// undefined) i++ matters once rows can be removed client-side: removing a
// middle row leaves a gap in the indices, which a sequential scan would stop
// at and silently drop everything after.
function parseCoauthorsFromBody(body) {
  const indexes = new Set();
  Object.keys(body).forEach((key) => {
    const m = key.match(/^coauthor_id_(\d+)$/);
    if (m) indexes.add(Number(m[1]));
  });
  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((i) => ({
      author_id: parseInt(body[`coauthor_id_${i}`], 10),
      display_name: (body[`coauthor_name_${i}`] || '').trim(),
      role: body[`coauthor_role_${i}`] || 'contributor',
    }))
    .filter((ca) => Number.isInteger(ca.author_id) && ca.author_id > 0);
}

async function buildArticleData(req, existingArticle = null) {
  const body = req.body;
  const files = req.files || {};

  let baseSlug = slugify(body.slug || body.title || '');
  if (!baseSlug) baseSlug = `article-${Date.now()}`;

  const excludeId = req.params.id ? Number(req.params.id) : null;
  let slug = baseSlug;
  let suffix = 2;
  while (await articlesModel.slugExists(slug, excludeId)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const authorId = await resolveAuthorId(body);

  // Form sends publish_date + publish_time separately (views/admin/articles/
  // form.ejs) instead of one datetime-local field. Same fallback semantics
  // as before: only default to now() when there's genuinely no prior value
  // (a brand-new article) and no date was submitted — falling back to now()
  // unconditionally would silently bump an existing article's published_at
  // on every save where the fields came back empty.
  let publishedAt;
  if (body.publish_date) {
    publishedAt = new Date(`${body.publish_date}T${body.publish_time || '00:00'}`);
  } else {
    publishedAt = existingArticle ? existingArticle.published_at : new Date();
  }

  // 'scheduled' is a real status (no DB migration needed, the column is a
  // plain text with no CHECK constraint) but it only means anything as long
  // as the chosen date is actually in the future — auto-correct it either
  // way so the status the editor sees always matches reality: a
  // "Scheduled" article with a past/now date publishes immediately instead
  // of silently staying hidden forever, and a "Published" article with a
  // future date (e.g. someone backdates-then-un-backdates) is scheduled
  // instead of going live early. 'draft' is untouched by date either way.
  let status = ['draft', 'scheduled', 'published'].includes(body.status) ? body.status : 'published';
  const now = new Date();
  if (status === 'scheduled' && publishedAt <= now) {
    status = 'published';
  } else if (status === 'published' && publishedAt > now) {
    status = 'scheduled';
  }

  // Manual tags: normalized lowercase, deduped, capped at 50 chars each.
  const manualTagsList = [...new Set(
    (body.tags_raw || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 50)
  )];

  // Dateline: trimmed, stored as entered (mixed case), null if empty.
  const dateline = (body.dateline || '').trim() || null;
  const datelineSlug = dateline ? slugify(dateline) : null;

  // Auto-add the dateline slug as a tag so /tag/<slug> works. Add it at the
  // end only if it isn't already among the manual tags.
  let tags = [...manualTagsList];
  if (datelineSlug && !tags.includes(datelineSlug)) {
    tags.push(datelineSlug);
  }

  // On UPDATE: if the old dateline has changed or been removed, remove the
  // old dateline slug from the tags array — but only if the editor didn't
  // also type it explicitly in the tags field (in which case it should stay).
  if (existingArticle && existingArticle.dateline) {
    const oldSlug = slugify(existingArticle.dateline);
    const newSlug = datelineSlug || '';
    if (oldSlug && oldSlug !== newSlug && !manualTagsList.includes(oldSlug)) {
      tags = tags.filter((t) => t !== oldSlug);
    }
  }

  tags = tags.slice(0, 20); // final cap at 20

  const data = {
    slug,
    title: body.title,
    subheadline: body.subheadline ? body.subheadline.trim() || null : null,
    body: body.body,
    video_url: body.video_url || null,
    author_id: authorId,
    category: body.category || null,
    status,
    is_editors_pick: body.is_editors_pick === 'on' || body.is_editors_pick === '1',
    is_breaking: body.is_breaking === 'on' || body.is_breaking === '1',
    is_advertisement: body.is_advertisement === 'on',
    breaking_expires_at: body.breaking_expires_at ? new Date(body.breaking_expires_at) : null,
    published_at: publishedAt,
    tags,
    dateline,
    is_liveblog: body.is_liveblog === 'on' || body.is_liveblog === '1',
    liveblog_status: body.liveblog_status === 'live' ? 'live' : 'ended',
  };

  if (files.featured_image && files.featured_image[0]) {
    data.featured_image = urlFor('featured_image', files.featured_image[0].filename);
  } else if (body.remove_featured_image) {
    data.featured_image = null;
  } else {
    data.featured_image = body.existing_featured_image || null;
  }
  data.featured_image_caption = (body.featured_image_caption || '').trim() || null;
  data.featured_image_alt = (body.featured_image_alt || '').trim().slice(0, 200) || null;

  if (files.audio_file && files.audio_file[0]) {
    data.audio_file = urlFor('audio_file', files.audio_file[0].filename);
  } else if (body.remove_audio_file) {
    data.audio_file = null;
  } else {
    data.audio_file = body.existing_audio_file || null;
  }

  if (files.pdf_file && files.pdf_file[0]) {
    data.pdf_file = urlFor('pdf_file', files.pdf_file[0].filename);
  } else if (body.remove_pdf_file) {
    data.pdf_file = null;
  } else {
    data.pdf_file = body.existing_pdf_file || null;
  }

  // Gallery images: the AJAX-driven UI keeps the full list (existing + newly
  // uploaded, with per-image alt/caption) in a single hidden `gallery_data`
  // JSON field. normaliseGalleryItem tolerates the legacy string-only and
  // {url,caption} shapes as well as the new {url,alt,caption}. Any raw
  // multipart files.gallery_images are also accepted and appended — that's the
  // JS-disabled fallback (the file input still submits normally).
  let gallery = [];
  if (typeof body.gallery_data === 'string' && body.gallery_data.trim()) {
    try {
      const parsed = JSON.parse(body.gallery_data);
      if (Array.isArray(parsed)) {
        gallery = parsed.map(normaliseGalleryItem).filter(Boolean);
      }
    } catch (err) {
      console.error('Invalid gallery_data JSON on article save:', err.message);
    }
  }
  if (files.gallery_images) {
    gallery = gallery.concat(
      files.gallery_images.map((f) => ({ url: urlFor('gallery_images', f.filename), alt: '', caption: '' }))
    );
  }
  data.gallery_images = gallery.slice(0, 10);

  return data;
}

async function createArticle(req, res, next) {
  try {
    if (!req.body.title || !req.body.body) {
      const [authors, datelines] = await Promise.all([
        authorsModel.getAll(),
        articlesModel.getDistinctDatelines(),
      ]);
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/articles/form', {
        title: 'New Article — Admin',
        authorName: req.session.authorName,
        authors,
        categories: CATEGORIES,
        datelines,
        article: req.body,
        errors: ['Title and body are required.'],
        coauthors: parseCoauthorsFromBody(req.body),
      });
    }

    const data = await buildArticleData(req);
    const id = await articlesModel.create(data);

    await articleRevisionsModel.recordRevision({
      articleId: id,
      action: 'create',
      changedBy: req.session.authorId,
      changes: articleRevisionsModel.diffStates({}, articleRevisionsModel.pickTrackedFields(data)),
      reason: null,
    });

    const coauthors = parseCoauthorsFromBody(req.body);
    await articleAuthorsModel.replaceForArticle(
      id,
      coauthors.map((ca, i) => ({ authorId: ca.author_id, role: ca.role, sortOrder: i }))
    );

    // New article published immediately on creation — always eligible,
    // since there's no prior state for it to have already posted under.
    let fbStatus = null;
    let twitterStatus = null;
    if (data.status === 'published') {
      homepageCache.flush();
      categoryPageCache.flush();
      purgeArticle({ ...data, id }).catch(e => console.error('[CF Purge] create error:', e));
      sendArticlePush({ ...data, id }).catch((e) => console.error('[Push] auto-send error:', e));
      fbStatus = await autoPostToFacebook({ ...data, id });
      twitterStatus = await autoPostToTwitter({ ...data, id });
    }

    // "Preview Article" submits the exact same form/save as "Save Changes" —
    // only the redirect target differs. Goes to the real /article/:slug
    // URL, not a separate preview route — articleDetail already lets a
    // logged-in admin view any status there (see publicController.js).
    if (req.body.action === 'save_preview') {
      return res.redirect(`/article/${data.slug}`);
    }

    res.redirect(`/admin/articles/${id}/edit${buildSocialStatusQuery(fbStatus, twitterStatus)}`);
  } catch (err) {
    next(err);
  }
}

async function updateArticle(req, res, next) {
  try {
    const article = await articlesModel.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }

    if (!req.body.title || !req.body.body) {
      const [authors, datelines] = await Promise.all([
        authorsModel.getAll(),
        articlesModel.getDistinctDatelines(),
      ]);
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/articles/form', {
        title: `Edit: ${article.title} — Admin`,
        authorName: req.session.authorName,
        authors,
        categories: CATEGORIES,
        datelines,
        article: { ...article, ...req.body },
        errors: ['Title and body are required.'],
        coauthors: parseCoauthorsFromBody(req.body),
      });
    }

    const oldTracked = articleRevisionsModel.pickTrackedFields(article);
    const data = await buildArticleData(req, article);
    await articlesModel.update(article.id, data);
    cleanupReplacedFiles(article, data);

    const revisionChanges = articleRevisionsModel.diffStates(oldTracked, articleRevisionsModel.pickTrackedFields(data));
    if (Object.keys(revisionChanges).length > 0) {
      await articleRevisionsModel.recordRevision({
        articleId: article.id,
        action: 'update',
        changedBy: req.session.authorId,
        changes: revisionChanges,
        reason: (req.body.revision_reason || '').trim() || null,
      });
    }

    const coauthors = parseCoauthorsFromBody(req.body);
    await articleAuthorsModel.replaceForArticle(
      article.id,
      coauthors.map((ca, i) => ({ authorId: ca.author_id, role: ca.role, sortOrder: i }))
    );

    // Broader than just the publish-transition below: an edit to an
    // already-published article (title, image, category, etc.) should
    // also stop showing stale homepage/category content for up to
    // 2-5 minutes, not just the first-publish moment.
    if (data.status === 'published' || article.status === 'published') {
      homepageCache.flush();
      categoryPageCache.flush();
      purgeArticle({ ...data, id: article.id }).catch(e => console.error('[CF Purge] update error:', e));
    }

    // Only the draft/non-published -> published transition counts as a
    // "first publish" — an already-published article being edited (status
    // staying 'published') must never re-trigger a post. Each platform has
    // its own *_posted_at guard so a republish-after-unpublish can't
    // double-post either, independently per platform.
    const justPublished = data.status === 'published' && article.status !== 'published';

    let fbStatus = null;
    if (justPublished && !article.fb_posted_at) {
      fbStatus = await autoPostToFacebook({ ...data, id: article.id });
    }

    let twitterStatus = null;
    if (justPublished && !article.twitter_posted_at) {
      twitterStatus = await autoPostToTwitter({ ...data, id: article.id });
    }

    // Same justPublished gate as FB/Twitter above — an edit to an already-
    // published article (title tweak, typo fix, etc.) must never re-notify
    // subscribers, only a genuine draft/scheduled -> published transition.
    // Unlike FB/Twitter there's no *_posted_at guard column for push, so a
    // republish-after-unpublish will notify again — treated as intentional
    // (a push is ephemeral, not a permanent public post), not a bug.
    if (justPublished) {
      sendArticlePush({ ...data, id: article.id }).catch((e) => console.error('[Push] auto-send error:', e));
    }

    if (req.body.action === 'save_preview') {
      return res.redirect(`/article/${data.slug}`);
    }

    res.redirect(`/admin/articles/${article.id}/edit${buildSocialStatusQuery(fbStatus, twitterStatus)}`);
  } catch (err) {
    next(err);
  }
}

async function deleteArticle(req, res, next) {
  try {
    const reason = (req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).send('A reason is required to delete an article.');
    }

    const article = await articlesModel.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }

    // Soft-delete: hides the article from every public query and the
    // default admin list, but keeps the row + uploaded files + its full
    // article_revisions history intact — restorable the same way as any
    // other revision (see articleRevisionsModel.reconstructState). Files
    // are deliberately NOT cleaned up here anymore (unlike the old hard
    // DELETE this replaced) since a restore needs them to still exist.
    await articlesModel.softDelete(article.id);
    await articleRevisionsModel.recordRevision({
      articleId: article.id,
      action: 'delete',
      changedBy: req.session.authorId,
      changes: articleRevisionsModel.diffStates({ deleted_at: null }, { deleted_at: new Date() }),
      reason,
    });

    if (article.status === 'published') {
      homepageCache.flush();
      categoryPageCache.flush();
      purgeArticle(article).catch(e => console.error('[CF Purge] delete error:', e));
    }
    res.redirect('/admin/articles');
  } catch (err) {
    next(err);
  }
}

// Quick status-change actions on the article list page (Publish Now / Move
// to Draft / Cancel Schedule) — unlike createArticle/updateArticle's full
// save path, this never touches published_at or any other field, and
// never auto-corrects status against a date (there's no date involved
// here at all — the editor explicitly picked this status, so it's honored
// as-is, not second-guessed).
async function updateArticleStatus(req, res, next) {
  try {
    if (!['draft', 'published'].includes(req.body.status)) {
      return res.status(400).send('Invalid status');
    }

    const article = await articlesModel.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }

    const updated = await articlesModel.updateStatus(article.id, req.body.status);

    const statusChanges = articleRevisionsModel.diffStates(
      articleRevisionsModel.pickTrackedFields(article),
      articleRevisionsModel.pickTrackedFields(updated)
    );
    if (Object.keys(statusChanges).length > 0) {
      await articleRevisionsModel.recordRevision({
        articleId: article.id,
        action: 'update',
        changedBy: req.session.authorId,
        changes: statusChanges,
        reason: 'Quick status change',
      });
    }

    // Same condition as updateArticle's own cache-flush check — covers
    // both directions, an article that just went live and one that just
    // stopped being live both need stale homepage/category content gone.
    if (updated.status === 'published' || article.status === 'published') {
      homepageCache.flush();
      categoryPageCache.flush();
      purgeArticle(updated).catch(e => console.error('[CF Purge] status error:', e));
    }

    const justPublished = updated.status === 'published' && article.status !== 'published';
    if (justPublished && !article.fb_posted_at) {
      await autoPostToFacebook(updated);
    }
    if (justPublished && !article.twitter_posted_at) {
      await autoPostToTwitter(updated);
    }

    res.redirect(req.get('Referer') || '/admin/articles');
  } catch (err) {
    next(err);
  }
}

// AJAX image upload used by the article form (featured + gallery). The file
// has already passed multer + the fileFilter (via uploadImageJson) by the
// time we get here; we just re-encode it to WebP and, for featured images,
// generate the sized variants, then hand back the URLs the form's JS needs.
async function uploadImageAjax(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image was uploaded' });
    }

    await compressImageFile(req.file); // JPEG/PNG -> WebP (GIF/WebP left as-is)

    const url = urlFor('image', req.file.filename);
    const type = req.body.type === 'gallery' ? 'gallery' : 'featured';

    // Featured images get the fixed-size variants (homepage cards + article
    // page render those); gallery images never do, so their preview thumbnail
    // is just the full image (CSS-constrained) — this also keeps
    // deleteUploadedFile's gallery cleanup correct (no orphan variants).
    let thumbUrl = url;
    if (type === 'featured') {
      await generateFeaturedImageVariants(req.file);
      thumbUrl = url.replace(/\.[a-zA-Z0-9]+$/, '-thumb.webp');
    }

    return res.json({ success: true, filename: req.file.filename, url, thumbUrl });
  } catch (err) {
    console.error('AJAX image upload failed:', err);
    return res.status(500).json({ success: false, error: 'Image processing failed. Please try again.' });
  }
}

module.exports = {
  loginForm,
  login,
  logout,
  listArticles,
  newArticleForm,
  editArticleForm,
  createArticle,
  updateArticle,
  deleteArticle,
  updateArticleStatus,
  uploadImageAjax,
};
