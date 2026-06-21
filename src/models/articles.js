const pool = require('../config/db');

function escapeLike(str) {
  return str.replace(/[\\%_]/g, '\\$&');
}

const ARTICLE_CARD_FIELDS = `
  a.id, a.slug, a.title, a.excerpt, a.featured_image, a.category,
  a.published_at, a.views_count,
  au.id AS author_id, au.display_name AS author_name, au.username AS author_username
`;

async function getLatestPublished({ limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published'
     ORDER BY a.published_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function countPublished() {
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM articles WHERE status = 'published'`);
  return Number(rows[0].total);
}

async function getMostViewed({ limit }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published'
     ORDER BY a.views_count DESC, a.published_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.slug, a.title, a.body, a.excerpt, a.featured_image, a.featured_image_caption, a.gallery_images,
       a.video_url, a.audio_file, a.pdf_file, a.category, a.status,
       a.published_at, a.views_count, a.likes_count,
       au.username AS author_username, au.display_name AS author_name,
       au.bio AS author_bio, au.photo AS author_photo
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

async function getRelatedByCategory({ category, excludeId, limit }) {
  const { rows } = await pool.query(
    `SELECT id, slug, title, featured_image
     FROM articles
     WHERE status = 'published' AND category = $1 AND id <> $2
     ORDER BY published_at DESC
     LIMIT $3`,
    [category, excludeId, limit]
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
     WHERE a.status = 'published' AND a.category = $1
     ORDER BY a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [category, limit, offset]
  );
  return rows;
}

async function countByCategory(category) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND category = $1`,
    [category]
  );
  return Number(rows[0].total);
}

async function getByAuthorId({ authorId, limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.author_id = $1
     ORDER BY a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [authorId, limit, offset]
  );
  return rows;
}

async function countByAuthorId(authorId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND author_id = $1`,
    [authorId]
  );
  return Number(rows[0].total);
}

async function search({ query, limit, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT ${ARTICLE_CARD_FIELDS}, ts_rank(a.search_vector, websearch_to_tsquery('english', $1)) AS rank
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.status = 'published' AND a.search_vector @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC, a.published_at DESC
     LIMIT $2 OFFSET $3`,
    [query, limit, offset]
  );
  return rows;
}

async function countSearch(query) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM articles
     WHERE status = 'published' AND search_vector @@ websearch_to_tsquery('english', $1)`,
    [query]
  );
  return Number(rows[0].total);
}

async function getById(id) {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.slug, a.title, a.body, a.excerpt, a.featured_image, a.featured_image_caption, a.gallery_images,
       a.video_url, a.audio_file, a.pdf_file, a.author_id, a.category, a.status,
       a.published_at, a.views_count,
       au.username AS author_username, au.display_name AS author_name
     FROM articles a
     LEFT JOIN authors au ON au.id = a.author_id
     WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function listForAdmin({ limit, offset = 0, q = '', status = '' }) {
  const conditions = [];
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
    `SELECT a.id, a.slug, a.title, a.category, a.status, a.published_at, a.updated_at, a.views_count,
            au.display_name AS author_name
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
  const conditions = [];
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
       (slug, title, body, featured_image, featured_image_caption, gallery_images, video_url, audio_file, pdf_file,
        author_id, category, status, published_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
     RETURNING id`,
    [
      data.slug, data.title, data.body, data.featured_image, data.featured_image_caption,
      JSON.stringify(data.gallery_images || []),
      data.video_url, data.audio_file, data.pdf_file, data.author_id, data.category, data.status,
      data.published_at,
    ]
  );
  return rows[0].id;
}

async function update(id, data) {
  await pool.query(
    `UPDATE articles SET
       slug = $1, title = $2, body = $3, featured_image = $4, featured_image_caption = $5, gallery_images = $6,
       video_url = $7, audio_file = $8, pdf_file = $9, author_id = $10, category = $11, status = $12,
       published_at = $13, updated_at = now()
     WHERE id = $14`,
    [
      data.slug, data.title, data.body, data.featured_image, data.featured_image_caption,
      JSON.stringify(data.gallery_images || []),
      data.video_url, data.audio_file, data.pdf_file, data.author_id, data.category, data.status,
      data.published_at, id,
    ]
  );
}

async function remove(id) {
  await pool.query('DELETE FROM articles WHERE id = $1', [id]);
}

module.exports = {
  getLatestPublished,
  countPublished,
  getMostViewed,
  getBySlug,
  getRelatedByCategory,
  incrementViewCount,
  incrementLikeCount,
  getByCategory,
  countByCategory,
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
  remove,
};
