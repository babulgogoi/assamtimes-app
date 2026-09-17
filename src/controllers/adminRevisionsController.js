const { diffWords } = require('diff');
const articlesModel = require('../models/articles');
const articleRevisionsModel = require('../models/articleRevisions');
const authorsModel = require('../models/authors');
const { homepageCache, categoryPageCache } = require('../routes/public');
const { purgeArticle } = require('../utils/cloudflarePurge');

const FIELD_LABELS = {
  slug: 'Slug', title: 'Title', subheadline: 'Subheadline', body: 'Body', video_url: 'Video URL',
  author_id: 'Author', category: 'Category', status: 'Status', is_editors_pick: "Editor's Pick",
  is_breaking: 'Breaking News', is_advertisement: 'Advertisement', breaking_expires_at: 'Breaking Expires',
  published_at: 'Published At', tags: 'Tags', dateline: 'Dateline', is_liveblog: 'Live Blog',
  liveblog_status: 'Live Blog Status', featured_image: 'Featured Image', featured_image_caption: 'Image Caption',
  featured_image_alt: 'Image Alt Text', audio_file: 'Audio File', pdf_file: 'PDF File',
  gallery_images: 'Gallery Images', deleted_at: 'Deleted',
};
const BOOLEAN_FIELDS = ['is_editors_pick', 'is_breaking', 'is_advertisement', 'is_liveblog'];
const DATE_FIELDS = ['breaking_expires_at', 'published_at', 'deleted_at'];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(value) {
  if (!value) return '(none)';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatValue(field, value) {
  if (BOOLEAN_FIELDS.includes(field)) return value ? 'Yes' : 'No';
  if (DATE_FIELDS.includes(field)) return formatDate(value);
  if (field === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : '(none)';
  if (field === 'gallery_images') return Array.isArray(value) ? `${value.length} image(s)` : '(none)';
  if (value === null || value === undefined || value === '') return '(none)';
  return String(value);
}

// body is diffed separately (word-level, HTML tags stripped first) rather
// than shown as a plain old/new pair — bodies are the one field where a raw
// "old value / new value" list would be unreadable at any real length. This
// computes the diff server-side (the `diff` package is a plain Node
// dependency here, not bundled for the browser) and ships pre-rendered
// <ins>/<del> HTML for the admin panel to inject directly.
function bodyDiffHtml(oldBody, newBody) {
  const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ');
  const parts = diffWords(strip(oldBody), strip(newBody));
  return parts.map((part) => {
    const escaped = escapeHtml(part.value);
    if (part.added) return `<ins>${escaped}</ins>`;
    if (part.removed) return `<del>${escaped}</del>`;
    return escaped;
  }).join('');
}

// Turns a revision's raw {field: {old, new}} changes into a display-ready
// summary the admin panel can render with no further formatting logic —
// body gets its own diff HTML instead of appearing in the plain list.
function summariseChanges(changes) {
  const summary = [];
  let bodyDiff = null;
  for (const field of Object.keys(changes || {})) {
    const { old: oldVal, new: newVal } = changes[field];
    if (field === 'body') {
      bodyDiff = bodyDiffHtml(oldVal, newVal);
      continue;
    }
    summary.push({
      field,
      label: FIELD_LABELS[field] || field,
      oldDisplay: formatValue(field, oldVal),
      newDisplay: formatValue(field, newVal),
    });
  }
  return { summary, bodyDiff };
}

// AJAX list for the per-article Revision History panel (views/admin/articles/
// form.ejs) — same shape of endpoint as adminLiveblogController.listEntries.
async function listForArticle(req, res, next) {
  try {
    const revisions = await articleRevisionsModel.getForArticle(req.params.id);
    // Drop the raw `changes` blob once summarised — it can include a full
    // old+new body pair (hundreds of KB on the one known outlier article),
    // and the client only ever renders `summary`/`bodyDiff`, never the raw
    // JSON, so shipping both would double that cost for nothing.
    const withSummary = revisions.map(({ changes, ...r }) => ({ ...r, ...summariseChanges(changes) }));
    res.json({ success: true, revisions: withSummary });
  } catch (err) {
    next(err);
  }
}

// Any logged-in author/editor can restore — same requireAuth gate as every
// other admin route, no extra permission check (per the feature's own
// requirement: restore access matches normal edit access).
async function restore(req, res, next) {
  try {
    const articleId = Number(req.params.id);
    const revisionId = Number(req.params.revisionId);

    const revision = await articleRevisionsModel.getById(revisionId);
    if (!revision || revision.article_id !== articleId) {
      return res.status(404).json({ success: false, error: 'Revision not found' });
    }

    const article = await articlesModel.getById(articleId);
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }

    const reconstructed = await articleRevisionsModel.reconstructState(articleId, revisionId);

    // Restore always brings the article back to a live, visible state,
    // regardless of which revision is targeted or whether deleted_at was
    // even part of that revision's own change set — there's no real use
    // case for "restore this old content but leave the article deleted".
    // A naive fold of a target revision from before a later delete would
    // otherwise leave deleted_at untouched (still deleted), which is
    // exactly the silent no-op this was written to avoid after finding it
    // in testing: restoring an old content revision on a currently-deleted
    // article did nothing to deleted_at at all.
    reconstructed.deleted_at = null;

    const oldTracked = articleRevisionsModel.pickTrackedFields(article);
    const contentFields = { ...reconstructed };
    delete contentFields.deleted_at;

    // update() is a full blanket UPDATE of every tracked content column, so
    // it needs the complete field set — oldTracked fills in anything this
    // particular revision chain never touched.
    if (Object.keys(contentFields).length > 0) {
      await articlesModel.update(articleId, { ...oldTracked, ...contentFields });
    }

    if (article.deleted_at) {
      await articlesModel.undelete(articleId);
    }

    const newTracked = { ...oldTracked, ...reconstructed };
    const changes = articleRevisionsModel.diffStates(oldTracked, newTracked);
    const revisionDate = new Date(revision.created_at).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    await articleRevisionsModel.recordRevision({
      articleId,
      action: 'restore',
      changedBy: req.session.authorId,
      changes,
      reason: `Restored to revision from ${revisionDate}`,
    });

    // Deliberately never calls autoPostToFacebook/autoPostToTwitter, unlike
    // create/update — a restore must never re-trigger a real social post,
    // even one that happens to bring status back to 'published'.
    if (newTracked.status === 'published' || article.status === 'published') {
      homepageCache.flush();
      categoryPageCache.flush();
      purgeArticle({ ...newTracked, id: articleId }).catch((e) => console.error('[CF Purge] restore error:', e));
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

const REVISIONS_PAGE_SIZE = 25;

// Global, filterable audit log across every article — /admin/revisions.
async function listAll(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filters = {
      articleId: req.query.article_id || '',
      changedBy: req.query.changed_by || '',
      action: req.query.action || '',
      dateFrom: req.query.date_from || '',
      dateTo: req.query.date_to || '',
    };

    const [rawRevisions, total, authors] = await Promise.all([
      articleRevisionsModel.getAllForAdmin({ ...filters, limit: REVISIONS_PAGE_SIZE, offset: (page - 1) * REVISIONS_PAGE_SIZE }),
      articleRevisionsModel.countAllForAdmin(filters),
      authorsModel.getAll(),
    ]);
    const revisions = rawRevisions.map((r) => ({ ...r, ...summariseChanges(r.changes) }));

    res.locals.layout = 'admin/layout';
    res.render('admin/revisions/list', {
      title: 'Revision History — Admin',
      authorName: req.session.authorName,
      revisions,
      authors,
      filters,
      page,
      totalPages: Math.max(1, Math.ceil(total / REVISIONS_PAGE_SIZE)),
      total,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listForArticle, restore, listAll };
