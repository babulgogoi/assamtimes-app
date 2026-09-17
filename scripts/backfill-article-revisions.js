// One-time backfill: seeds a single 'create' revision per existing article
// that doesn't have any article_revisions row yet, using the article's
// current field values as its baseline "version 1" — otherwise every
// article that predates this feature would show an empty Revision History
// panel forever, only gaining history from its next edit onward.
// changed_by is left NULL (shown as "System" in the admin UI) since there's
// no real record of who originally wrote each of these 23k+ articles at
// this level of granularity, and created_at is backdated to the article's
// own created_at so the timeline reflects reality rather than "today" for
// every single row. Idempotent — safe to re-run, only processes articles
// with zero existing revisions.
//
// Usage: node scripts/backfill-article-revisions.js
require('dotenv').config();

const pool = require('../src/config/db');
const articleRevisionsModel = require('../src/models/articleRevisions');

const BATCH_SIZE = 500;

async function main() {
  let processed = 0;

  for (;;) {
    const { rows: batch } = await pool.query(
      `SELECT a.id, a.created_at,
              a.slug, a.title, a.subheadline, a.body, a.video_url, a.author_id, a.category, a.status,
              a.is_editors_pick, a.is_breaking, a.is_advertisement, a.breaking_expires_at, a.published_at,
              a.tags, a.dateline, a.is_liveblog, a.liveblog_status, a.featured_image, a.featured_image_caption,
              a.featured_image_alt, a.audio_file, a.pdf_file, a.gallery_images
       FROM articles a
       LEFT JOIN article_revisions r ON r.article_id = a.id
       WHERE r.id IS NULL
       GROUP BY a.id
       ORDER BY a.id
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (!batch.length) break;

    for (const article of batch) {
      const changes = articleRevisionsModel.diffStates({}, articleRevisionsModel.pickTrackedFields(article));
      await pool.query(
        `INSERT INTO article_revisions (article_id, action, changed_by, changes, reason, created_at)
         VALUES ($1, 'create', NULL, $2, 'Initial version (backfilled)', $3)`,
        [article.id, JSON.stringify(changes), article.created_at || new Date()]
      );
    }

    processed += batch.length;
    console.log(`[${new Date().toISOString()}] Backfilled ${processed} articles so far...`);
  }

  console.log(`[${new Date().toISOString()}] Done. Backfilled ${processed} articles total.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('backfill-article-revisions failed:', err);
    pool.end();
    process.exitCode = 1;
  });
