// Targeted backfill: generates -thumb.jpg (230x120), -large.jpg
// (460x335), and -article.jpg (630x420) variants only for the articles
// that actually appear on the homepage right now, not the full
// back-catalog (~10,000+ articles that will never be rendered there).
// New uploads get all three variants automatically via
// compressArticleImages; this just covers the handful of pre-existing
// articles the homepage already shows.
//
// Mirrors publicController.js's home() query exactly (same limits) so
// "what gets a thumbnail" matches "what's actually on the homepage" —
// re-run this any time those limits change.
// Usage: node scripts/backfill-homepage-thumbs.js
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const pool = require('../src/config/db');
const articlesModel = require('../src/models/articles');
const { generateSizedVariants, DEFAULT_IMAGE } = require('../src/utils/imageVariants');

const ARTICLES_DIR = process.env.UPLOADS_ARTICLES_DIR;
const DEFAULTS_DIR = process.env.UPLOADS_DEFAULTS_DIR;

// Same limits as HOME_SECTIONS / EDITORS_PICKS_SIZE in publicController.js.
const LATEST_NEWS_LIMIT = 9;
const FEATURES_LIMIT = 9;
const EDITORS_PICKS_LIMIT = 6;

async function processOne(urlPath, dir) {
  const filename = path.basename(urlPath);
  const ext = path.extname(filename);
  const baseNoExt = path.basename(filename, ext);
  const sourcePath = path.join(dir, filename);
  const thumbPath = path.join(dir, `${baseNoExt}-thumb.jpg`);
  const largePath = path.join(dir, `${baseNoExt}-large.jpg`);
  const articlePath = path.join(dir, `${baseNoExt}-article.jpg`);

  if (fs.existsSync(thumbPath) && fs.existsSync(largePath) && fs.existsSync(articlePath)) return 'skipped';
  if (!fs.existsSync(sourcePath)) return 'missing';

  await generateSizedVariants(sourcePath, dir, baseNoExt);
  return 'generated';
}

async function main() {
  const [latestNews, features, editorsPicks] = await Promise.all([
    articlesModel.getLatestPublished({ limit: LATEST_NEWS_LIMIT }),
    articlesModel.getByCategory({ category: 'Features', limit: FEATURES_LIMIT }),
    articlesModel.getEditorsPicks({ limit: EDITORS_PICKS_LIMIT }),
  ]);

  const homepageArticles = [...latestNews, ...features, ...editorsPicks];
  const uniqueByImage = new Map();
  homepageArticles.forEach((a) => {
    if (a.featured_image) uniqueByImage.set(a.featured_image, a.id);
  });

  console.log(`Homepage articles: ${homepageArticles.length} (latestNews=${latestNews.length}, features=${features.length}, editorsPicks=${editorsPicks.length})`);
  console.log(`Unique featured images to process: ${uniqueByImage.size}`);

  console.log('Default image:', await processOne(DEFAULT_IMAGE, DEFAULTS_DIR));

  const counts = { generated: 0, skipped: 0, missing: 0 };
  for (const [featuredImage, articleId] of uniqueByImage) {
    try {
      const result = await processOne(featuredImage, ARTICLES_DIR);
      counts[result]++;
      console.log(`  article ${articleId}: ${featuredImage} -> ${result}`);
    } catch (err) {
      counts.missing++;
      console.error(`  article ${articleId}: ${featuredImage} -> failed (${err.message})`);
    }
  }

  console.log('Done.', counts);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
