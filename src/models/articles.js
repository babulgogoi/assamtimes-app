const pool = require('../config/db');

function escapeLike(str) {
  return str.replace(/[\\%_]/g, '\\$&');
}

const ARTICLE_CARD_FIELDS = `
  a.id, a.slug, a.title, a.excerpt, a.subheadline, a.featured_image, a.featured_image_alt, a.category, a.dateline,
  a.published_at, a.views_count, a.is_liveblog, a.liveblog_status,
  au.id AS author_id, au.display_name AS author_name, au.username AS author_username
`;

async function getLatestPublished({ limit, offset = 0, excludeCategory = null }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.is_advertisement = false AND a.deleted_at IS NULL
       AND ($3::text IS NULL OR a.category IS DISTINCT FROM $3)
     ORDER BY a.published_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset, excludeCategory]
  );
  return rows;
}

async function countPublished() {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL`
  );
  return Number(rows[0].total);
}

async function getMostViewed({ limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.is_advertisement = false AND a.deleted_at IS NULL
     ORDER BY a.views_count DESC, a.published_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function getEditorsPicks({ limit }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.is_editors_pick = true AND a.is_advertisement = false AND a.deleted_at IS NULL
     ORDER BY a.published_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// Deliberately excludes soft-deleted articles even for an admin-preview
// session — unlike the draft/scheduled preview bypass in publicController,
// a deleted article is not "not yet public", it's withdrawn, and stays
// reachable only via the admin edit page / revision history + restore.
async function getBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.slug, a.title, a.subheadline, a.body, a.excerpt, a.featured_image, a.featured_image_caption, a.featured_image_alt, a.gallery_images,
       a.video_url, a.audio_file, a.pdf_file, a.author_id, a.category, a.status, a.tags, a.dateline,
       a.is_liveblog, a.liveblog_status,
       a.published_at, a.updated_at, a.views_count, a.likes_count,
       au.username AS author_username, au.display_name AS author_name,
       au.bio AS author_bio, au.photo AS author_photo
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.slug = $1 AND a.deleted_at IS NULL`,
    [slug]
  );
  return rows[0] || null;
}

// excludeIds is an array, not a single id — the infinite-scroll chain
// (publicController.articleInline) needs to exclude every article already
// shown earlier in the same session's chain, not just the current one.
async function getRelatedByCategory({ category, excludeIds, limit }) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, excerpt, featured_image, published_at, views_count
     FROM articles
     WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND category = $1 AND id <> ALL($2::int[])
     ORDER BY published_at DESC
     LIMIT $3`,
    [category, excludeIds, limit]
  );
  return rows;
}

async function getOtherByAuthor({ authorId, excludeId, limit }) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, excerpt, featured_image, published_at, views_count
     FROM articles
     WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND author_id = $1 AND id <> $2
     ORDER BY published_at DESC
     LIMIT $3`,
    [authorId, excludeId, limit]
  );
  return rows;
}

async function incrementViewCount(id) {
  await pool.query('UPDATE articles SET views_count = views_count + 1 WHERE id = $1', [id]);
}

async function incrementLikeCount(id) {
  const { rows } = await pool.query(
    'UPDATE articles SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count',
    [id]
  );
  return rows[0] ? Number(rows[0].likes_count) : null;
}

async function getByCategory({ category, limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.is_advertisement = false AND a.deleted_at IS NULL AND a.category = $1
     ORDER BY a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [category, limit, offset]
  );
  return rows;
}

async function countByCategory(category) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND category = $1`,
    [category]
  );
  return Number(rows[0].total);
}

async function getByTag({ tag, limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.is_advertisement = false AND a.deleted_at IS NULL AND $1 = ANY(a.tags)
     ORDER BY a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [tag, limit, offset]
  );
  return rows;
}

async function countByTag(tag) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND $1 = ANY(tags)`,
    [tag]
  );
  return Number(rows[0].total);
}

let popularTagsCache = null;
let popularTagsCacheExpiresAt = 0;
const POPULAR_TAGS_CACHE_MS = 10 * 60 * 1000;

// unnest()+GROUP BY can't use the tags GIN index (that's for containment
// lookups like = ANY(tags), not full aggregation) — it's a sequential scan
// over every published article. Fine occasionally, not fine on every
// single article-page request (the highest-traffic page type on this
// site), so this is memoized for 10 minutes rather than queried fresh
// every time — tag popularity doesn't need to be second-by-second fresh.
async function getPopularTags(limit = 20) {
  if (popularTagsCache && Date.now() < popularTagsCacheExpiresAt) {
    return popularTagsCache;
  }
  const { rows } = await pool.query(
    `SELECT unnest(tags) AS tag, COUNT(*) AS count
     FROM articles
     WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND tags <> '{}'
     GROUP BY tag
     ORDER BY count DESC
     LIMIT $1`,
    [limit]
  );
  popularTagsCache = rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  popularTagsCacheExpiresAt = Date.now() + POPULAR_TAGS_CACHE_MS;
  return popularTagsCache;
}

// Sitemap only — every distinct tag across published articles, no count.
async function getDistinctTags() {
  const { rows } = await pool.query(
    `SELECT DISTINCT unnest(tags) AS tag FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL ORDER BY tag`
  );
  return rows.map((r) => r.tag);
}

let onThisDayCache = null;
let onThisDayCacheKey = null; // 'MM-DD' for whichever day was last cached

function todayKey(now) {
  return String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// EXTRACT(MONTH/DAY FROM published_at) can't use the published_at btree
// index — it's a sequential scan over every published article. The
// result is identical for every request on a given calendar day (it only
// depends on today's month+day, not on who's asking), so this is cached
// per-day rather than per-request or on a fixed TTL — naturally
// "expires" right at midnight when todayKey() next returns a new value,
// no timer needed. Both the sidebar (top 5) and the dedicated /on-this-day
// page (grouped by year) read from this same cached full list instead of
// running two separate queries.
async function getOnThisDay() {
  const now = new Date();
  const key = todayKey(now);
  if (onThisDayCache && onThisDayCacheKey === key) {
    return onThisDayCache;
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.title, a.excerpt, a.featured_image, a.category, a.published_at, a.views_count,
            au.display_name AS author_name, au.username AS author_username,
            EXTRACT(YEAR FROM a.published_at)::int AS pub_year
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE EXTRACT(MONTH FROM a.published_at) = $1
       AND EXTRACT(DAY FROM a.published_at) = $2
       AND EXTRACT(YEAR FROM a.published_at) < $3
       AND a.status = 'published'
       AND a.is_advertisement = false
       AND a.deleted_at IS NULL
     ORDER BY pub_year DESC, a.published_at DESC`,
    [now.getMonth() + 1, now.getDate(), now.getFullYear()]
  );

  onThisDayCache = rows;
  onThisDayCacheKey = key;
  return onThisDayCache;
}

async function getDistinctPublishedCategories() {
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND category IS NOT NULL ORDER BY category`
  );
  return rows.map((r) => r.category);
}

async function getByAuthorId({ authorId, limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.is_advertisement = false AND a.deleted_at IS NULL AND a.author_id = $1
     ORDER BY a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [authorId, limit, offset]
  );
  return rows;
}

async function countByAuthorId(authorId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND author_id = $1`,
    [authorId]
  );
  return Number(rows[0].total);
}

async function search({ query, limit, offset = 0 }) {
  // websearch_to_tsquery computed once via the cross-join (not repeated per
  // reference) — search_vector itself is a weighted (title > body) generated
  // column with its own GIN index already, this just adds <mark> highlights
  // on top of that.
  // excerpt is populated on only ~38 of 23k+ articles (D7's body_summary was
  // almost never filled in) — fall back to a stripped-tags snippet of body
  // so the highlighted snippet actually shows up for real search results.
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS},
       ts_rank(a.search_vector, tsq) AS rank,
       ts_headline('english', a.title, tsq, 'StartSel=<mark>,StopSel=</mark>,MaxWords=15,MinWords=5') AS title_highlighted,
       ts_headline('english',
         CASE WHEN length(coalesce(a.excerpt, '')) > 0
              THEN a.excerpt
              ELSE regexp_replace(coalesce(a.body, ''), '<[^>]+>', ' ', 'g')
         END,
         tsq, 'StartSel=<mark>,StopSel=</mark>,MaxWords=40,MinWords=20,MaxFragments=2'
       ) AS excerpt_highlighted
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id,
          websearch_to_tsquery('english', $1) tsq
     WHERE a.status = 'published' AND a.is_advertisement = false AND a.deleted_at IS NULL AND a.search_vector @@ tsq
     ORDER BY rank DESC, a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [query, limit, offset]
  );
  return rows;
}

async function countSearch(query) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles
     WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL AND search_vector @@ websearch_to_tsquery('english', $1)`,
    [query]
  );
  return Number(rows[0].total);
}

async function getById(id) {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.slug, a.title, a.subheadline, a.body, a.excerpt, a.featured_image, a.featured_image_caption, a.featured_image_alt, a.gallery_images,
       a.video_url, a.audio_file, a.pdf_file, a.author_id, a.category, a.status, a.is_editors_pick,
       a.is_breaking, a.breaking_expires_at, a.tags, a.dateline, a.is_liveblog, a.liveblog_status,
       a.is_advertisement, a.published_at, a.views_count, a.fb_posted_at, a.twitter_posted_at, a.deleted_at,
       au.username AS author_username, au.display_name AS author_name
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function markFacebookPosted(id) {
  await pool.query('UPDATE articles SET fb_posted_at = now() WHERE id = $1', [id]);
}

async function markTwitterPosted(id) {
  await pool.query('UPDATE articles SET twitter_posted_at = now() WHERE id = $1', [id]);
}

// Soft-deleted articles are excluded unconditionally (not just when no
// status filter is picked) — they're reachable via /admin/articles/:id/edit
// directly (getById doesn't filter deleted_at) or the global revision log,
// not via this list, matching "deleted" reading as actually gone from an
// editor's working list rather than merely another status value to filter by.
async function listForAdmin({ limit, offset = 0, q = '', status = '' }) {
  const conditions = ['a.deleted_at IS NULL'];
  const params = [];

  if (q) {
    params.push(`%${escapeLike(q)}%`);
    conditions.push(`a.title ILIKE $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.title, a.category, a.dateline, a.status, a.published_at, a.updated_at, a.views_count,
            a.is_advertisement, au.display_name AS author_name
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     ${where}
     ORDER BY a.updated_at DESC NULLS LAST, a.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

async function countForAdmin({ q = '', status = '' }) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];

  if (q) {
    params.push(`%${escapeLike(q)}%`);
    conditions.push(`title ILIKE $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM articles ${where}`, params);
  return Number(rows[0].total);
}

async function slugExists(slug, excludeId = null) {
  const params = excludeId ? [slug, excludeId] : [slug];
  const { rows } = await pool.query(
    `SELECT 1 FROM articles WHERE slug = $1 ${excludeId ? 'AND id <> $2' : ''} LIMIT 1`,
    params
  );
  return rows.length > 0;
}

// excerpt is intentionally not written here — the admin editor no longer exposes it,
// and existing articles' excerpt values should survive unrelated edits untouched.
async function create(data) {
  const { rows } = await pool.query(
    `INSERT INTO articles
       (slug, title, subheadline, body, featured_image, featured_image_caption, featured_image_alt, gallery_images, video_url, audio_file, pdf_file,
        author_id, category, status, is_editors_pick, is_breaking, breaking_expires_at, published_at, tags, is_liveblog, liveblog_status, dateline, is_advertisement, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, now(), now())
     RETURNING id`,
    [
      data.slug, data.title, data.subheadline, data.body, data.featured_image, data.featured_image_caption, data.featured_image_alt || null,
      JSON.stringify(data.gallery_images || []),
      data.video_url, data.audio_file, data.pdf_file, data.author_id, data.category, data.status,
      !!data.is_editors_pick, !!data.is_breaking, data.breaking_expires_at || null, data.published_at, data.tags || [],
      !!data.is_liveblog, data.liveblog_status || 'ended', data.dateline || null, !!data.is_advertisement,
    ]
  );
  return rows[0].id;
}

async function update(id, data) {
  await pool.query(
    `UPDATE articles SET
       slug = $1, title = $2, subheadline = $3, body = $4, featured_image = $5, featured_image_caption = $6, featured_image_alt = $7, gallery_images = $8,
       video_url = $9, audio_file = $10, pdf_file = $11, author_id = $12, category = $13, status = $14,
       is_editors_pick = $15, is_breaking = $16, breaking_expires_at = $17, published_at = $18, tags = $19,
       is_liveblog = $20, liveblog_status = $21, dateline = $22, is_advertisement = $23, updated_at = now()
     WHERE id = $24`,
    [
      data.slug, data.title, data.subheadline, data.body, data.featured_image, data.featured_image_caption, data.featured_image_alt || null,
      JSON.stringify(data.gallery_images || []),
      data.video_url, data.audio_file, data.pdf_file, data.author_id, data.category, data.status,
      !!data.is_editors_pick, !!data.is_breaking, data.breaking_expires_at || null, data.published_at, data.tags || [],
      !!data.is_liveblog, data.liveblog_status || 'ended', data.dateline || null, !!data.is_advertisement, id,
    ]
  );
}

// Hides the article from every public query above and from the default
// admin list, but keeps the row + its article_revisions history intact —
// restorable via articleRevisionsModel.reconstructState, same as any other
// version. Replaces the old hard DELETE now that revision history exists
// to preserve.
async function softDelete(id) {
  await pool.query('UPDATE articles SET deleted_at = now() WHERE id = $1', [id]);
}

async function undelete(id) {
  await pool.query('UPDATE articles SET deleted_at = NULL WHERE id = $1', [id]);
}

async function getAllPublishedForSitemap() {
  const { rows } = await pool.query(
    `SELECT slug, published_at, updated_at FROM articles WHERE status = 'published' AND is_advertisement = false AND deleted_at IS NULL ORDER BY published_at DESC`
  );
  return rows;
}

// Backs the RSS feeds (main/category/author) — needs full body (for
// content:encoded), unlike ARTICLE_CARD_FIELDS which deliberately omits it
// for listing-page performance. category is matched case-insensitively
// since feed URLs are commonly typed/linked lowercase (e.g. /feed/category/politics)
// while articles.category is stored capitalized.
async function getForFeed({ category = null, authorId = null, limit }) {
  const conditions = [`a.status = 'published'`, `a.is_advertisement = false`, `a.deleted_at IS NULL`];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`LOWER(a.category) = LOWER($${params.length})`);
  }
  if (authorId) {
    params.push(authorId);
    conditions.push(`a.author_id = $${params.length}`);
  }

  params.push(limit);

  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.slug, a.body, a.excerpt, a.featured_image, a.category, a.published_at,
            au.display_name AS author_name
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.published_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

// Flips any 'scheduled' article whose time has arrived to 'published' in
// one atomic statement (no read-then-write race against a concurrent cron
// run or an admin edit). Returns the full updated rows — the caller (the
// publish-scheduled cron script) needs title/slug/body/etc. to auto-post
// to social, not just the id.
async function publishDueScheduled() {
  const { rows } = await pool.query(
    `UPDATE articles SET status = 'published', updated_at = now()
     WHERE status = 'scheduled' AND published_at <= now() AND deleted_at IS NULL
     RETURNING *`
  );
  return rows;
}

// Minimal status-only update for the admin list page's quick action
// buttons (Publish Now / Move to Draft / Cancel Schedule) — unlike the
// full edit form's save path, these never touch published_at.
async function updateStatus(id, status) {
  const { rows } = await pool.query(
    `UPDATE articles SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] || null;
}

// Fetched on every public page (see src/routes/public.js's shared
// middleware) for the breaking-news ticker — empty array when nothing is
// currently flagged, or whatever was flagged has expired.
async function getBreakingNews({ limit = 5 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, title, slug FROM articles
     WHERE is_breaking = true AND status = 'published' AND is_advertisement = false AND deleted_at IS NULL
       AND published_at >= NOW() - INTERVAL '24 hours'
       AND (breaking_expires_at IS NULL OR breaking_expires_at > NOW())
     ORDER BY published_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getDistinctDatelines() {
  const { rows } = await pool.query(
    `SELECT DISTINCT dateline FROM articles WHERE dateline IS NOT NULL AND dateline <> '' ORDER BY dateline ASC`
  );
  return rows.map((r) => r.dateline);
}

module.exports = {
  getLatestPublished,
  countPublished,
  getMostViewed,
  getEditorsPicks,
  getBySlug,
  getRelatedByCategory,
  getOtherByAuthor,
  incrementViewCount,
  incrementLikeCount,
  getByCategory,
  countByCategory,
  getDistinctPublishedCategories,
  getByTag,
  countByTag,
  getPopularTags,
  getDistinctTags,
  getOnThisDay,
  getByAuthorId,
  countByAuthorId,
  search,
  countSearch,
  getById,
  listForAdmin,
  countForAdmin,
  slugExists,
  create,
  update,
  softDelete,
  undelete,
  markFacebookPosted,
  markTwitterPosted,
  getAllPublishedForSitemap,
  getForFeed,
  getBreakingNews,
  publishDueScheduled,
  updateStatus,
  getDistinctDatelines,
};
