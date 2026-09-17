const pool = require('../config/db');

// The full set of article fields this feature tracks — matches exactly what
// adminController.js's buildArticleData() produces (see that function for
// the authoritative list), plus deleted_at (soft-delete state), which is
// the one trackable field buildArticleData never sets itself. Anything not
// in this list (views_count, likes_count, fb_posted_at, twitter_posted_at,
// created_at, updated_at, search_vector) is DB/engagement-managed, not
// editorial content, and deliberately excluded from the audit trail.
const TRACKED_FIELDS = [
  'slug', 'title', 'subheadline', 'body', 'video_url', 'author_id', 'category', 'status',
  'is_editors_pick', 'is_breaking', 'is_advertisement', 'breaking_expires_at', 'published_at',
  'tags', 'dateline', 'is_liveblog', 'liveblog_status', 'featured_image', 'featured_image_caption',
  'featured_image_alt', 'audio_file', 'pdf_file', 'gallery_images', 'deleted_at',
];

// Normalises a field's value so equivalent-but-differently-shaped
// representations (a JS Date vs. an ISO string from pg, an array vs. its
// JSON.stringify'd form) don't register as a false-positive change.
function normalise(field, value) {
  if (value === undefined || value === null) return null;
  if (field === 'tags' || field === 'gallery_images') return JSON.stringify(value);
  if (field === 'breaking_expires_at' || field === 'published_at' || field === 'deleted_at') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (field === 'is_editors_pick' || field === 'is_breaking' || field === 'is_advertisement' || field === 'is_liveblog') {
    return !!value;
  }
  return value;
}

// Returns only the tracked fields actually present as keys on `obj` — a
// raw create/update `data` object never has a deleted_at key at all (it's
// not part of buildArticleData's output), and that absence must mean "not
// touched by this action", not "changed to null".
function pickTrackedFields(obj) {
  const picked = {};
  for (const field of TRACKED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      picked[field] = obj[field];
    }
  }
  return picked;
}

// Diffs two field-keyed objects (each already narrowed to TRACKED_FIELDS,
// e.g. via pickTrackedFields) and returns {field: {old, new}} for every
// field present in newState whose normalised value differs from oldState's
// (oldState's own value is read as-is, defaulting to null if absent — this
// is what makes a 'create' diff, where oldState is {}, record every field
// in newState as a old:null -> new:value change).
function diffStates(oldState, newState) {
  const changes = {};
  for (const field of Object.keys(newState)) {
    const oldVal = normalise(field, oldState[field]);
    const newVal = normalise(field, newState[field]);
    if (oldVal !== newVal) {
      changes[field] = { old: oldState[field] === undefined ? null : oldState[field], new: newState[field] === undefined ? null : newState[field] };
    }
  }
  return changes;
}

async function recordRevision({ articleId, action, changedBy, changes, reason }) {
  const { rows } = await pool.query(
    `INSERT INTO article_revisions (article_id, action, changed_by, changes, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [articleId, action, changedBy || null, JSON.stringify(changes || {}), reason || null]
  );
  return rows[0].id;
}

async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM article_revisions WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Newest-first, for the per-article history panel.
async function getForArticle(articleId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.article_id, r.action, r.changes, r.reason, r.created_at,
            r.changed_by, au.display_name AS changed_by_name, au.username AS changed_by_username
     FROM article_revisions r
     LEFT JOIN authors au ON au.id = r.changed_by
     WHERE r.article_id = $1
     ORDER BY r.created_at DESC, r.id DESC`,
    [articleId]
  );
  return rows;
}

// Oldest-first, id-tiebroken — the actual replay order for reconstruction.
async function getForArticleAsc(articleId, uptoRevisionId = null) {
  const params = [articleId];
  let upto = '';
  if (uptoRevisionId) {
    params.push(uptoRevisionId);
    upto = `AND r.id <= $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT r.id, r.action, r.changes, r.created_at
     FROM article_revisions r
     WHERE r.article_id = $1 ${upto}
     ORDER BY r.created_at ASC, r.id ASC`,
    params
  );
  return rows;
}

// Forward-replays every revision's changes up to and including
// uptoRevisionId, folding each field's `new` value into an accumulator.
// Depends only on the immutable revision log, never on the live articles
// row — so it stays correct even if the live row were ever touched
// out-of-band. Returns a plain object with whatever TRACKED_FIELDS keys
// have been set by some revision by that point (a 'create' revision, which
// every article's history starts with, sets all of buildArticleData's
// fields at once; deleted_at only appears once a delete/restore revision
// has touched it).
async function reconstructState(articleId, uptoRevisionId) {
  const revisions = await getForArticleAsc(articleId, uptoRevisionId);
  const state = {};
  for (const rev of revisions) {
    const changes = rev.changes || {};
    for (const field of Object.keys(changes)) {
      state[field] = changes[field].new;
    }
  }
  return state;
}

async function getAllForAdmin({ limit, offset = 0, articleId = '', changedBy = '', action = '', dateFrom = '', dateTo = '' }) {
  const conditions = [];
  const params = [];

  if (articleId) {
    params.push(articleId);
    conditions.push(`r.article_id = $${params.length}`);
  }
  if (changedBy === 'system') {
    conditions.push(`r.changed_by IS NULL`);
  } else if (changedBy) {
    params.push(changedBy);
    conditions.push(`r.changed_by = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`r.action = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`r.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`r.created_at < ($${params.length}::date + interval '1 day')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `SELECT r.id, r.article_id, r.action, r.changes, r.reason, r.created_at,
            r.changed_by, au.display_name AS changed_by_name, au.username AS changed_by_username,
            a.title AS article_title, a.slug AS article_slug
     FROM article_revisions r
     LEFT JOIN authors au ON au.id = r.changed_by
     LEFT JOIN articles a ON a.id = r.article_id
     ${where}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

async function countAllForAdmin({ articleId = '', changedBy = '', action = '', dateFrom = '', dateTo = '' }) {
  const conditions = [];
  const params = [];

  if (articleId) {
    params.push(articleId);
    conditions.push(`article_id = $${params.length}`);
  }
  if (changedBy === 'system') {
    conditions.push(`changed_by IS NULL`);
  } else if (changedBy) {
    params.push(changedBy);
    conditions.push(`changed_by = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`created_at < ($${params.length}::date + interval '1 day')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM article_revisions ${where}`, params);
  return Number(rows[0].total);
}

module.exports = {
  TRACKED_FIELDS,
  pickTrackedFields,
  diffStates,
  recordRevision,
  getById,
  getForArticle,
  reconstructState,
  getAllForAdmin,
  countAllForAdmin,
};
