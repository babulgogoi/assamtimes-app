const articlesModel = require('../models/articles');
const authorsModel = require('../models/authors');
const { largeUrl } = require('../utils/imageVariants');

const FEED_SIZE = 20;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// CDATA can't contain a literal "]]>" — split any occurrence across two
// adjacent CDATA sections so it can't prematurely close the block. Belt and
// braces for free-form article bodies; harmless no-op for normal content.
function cdata(value) {
  return `<![CDATA[${String(value || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function rfc822(date) {
  return new Date(date).toUTCString();
}

// excerpt is populated on very few articles in this dataset (see search
// upgrade notes) — fall back to a tag-stripped snippet of body so the
// <description> isn't empty for almost every item.
function descriptionFor(article) {
  if (article.excerpt && article.excerpt.trim()) return article.excerpt.trim();
  const stripped = (article.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.slice(0, 200);
}

function buildItem(article, siteUrl) {
  const url = `${siteUrl}/article/${article.slug}`;
  const parts = [
    '    <item>',
    `      <title>${cdata(article.title)}</title>`,
    `      <link>${escapeXml(url)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
    `      <pubDate>${rfc822(article.published_at)}</pubDate>`,
  ];
  if (article.author_name) {
    parts.push(`      <dc:creator>${cdata(article.author_name)}</dc:creator>`);
  }
  if (article.category) {
    parts.push(`      <category>${cdata(article.category)}</category>`);
  }
  parts.push(`      <description>${cdata(descriptionFor(article))}</description>`);
  parts.push(`      <content:encoded>${cdata(article.body || '')}</content:encoded>`);
  if (article.featured_image) {
    parts.push(
      `      <media:content url="${escapeXml(siteUrl + largeUrl(article.featured_image))}" medium="image" width="460" height="335"/>`
    );
  }
  parts.push('    </item>');
  return parts.join('\n');
}

function buildFeed({ articles, siteUrl, selfPath, title, description }) {
  const buildDate = articles.length ? rfc822(articles[0].published_at) : rfc822(new Date());

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0"\n' +
    '  xmlns:content="http://purl.org/rss/1.0/modules/content/"\n' +
    '  xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
    '  xmlns:atom="http://www.w3.org/2005/Atom"\n' +
    '  xmlns:media="http://search.yahoo.com/mrss/"\n' +
    '  xmlns:snf="http://www.smartnews.be/snf">\n' +
    '  <channel>\n' +
    `    <title>${cdata(title)}</title>\n` +
    `    <link>${escapeXml(siteUrl)}</link>\n` +
    `    <description>${cdata(description)}</description>\n` +
    '    <language>en-us</language>\n' +
    '    <managingEditor>editor@assamtimes.org</managingEditor>\n' +
    '    <webMaster>bg@guwahati.com</webMaster>\n' +
    `    <lastBuildDate>${buildDate}</lastBuildDate>\n` +
    `    <pubDate>${buildDate}</pubDate>\n` +
    `    <atom:link href="${escapeXml(siteUrl + selfPath)}" rel="self" type="application/rss+xml"/>\n` +
    '    <image>\n' +
    `      <url>${escapeXml(siteUrl)}/uploads/branding/at-logo.jpg</url>\n` +
    `      <title>${cdata(title)}</title>\n` +
    `      <link>${escapeXml(siteUrl)}</link>\n` +
    '      <width>144</width>\n' +
    '      <height>144</height>\n' +
    '      <description>Assam Times - Community Newspaper</description>\n' +
    '    </image>\n' +
    '    <snf:logo>\n' +
    `      <url>${escapeXml(siteUrl)}/uploads/branding/at-logo.jpg</url>\n` +
    '    </snf:logo>\n' +
    articles.map((a) => buildItem(a, siteUrl)).join('\n') +
    '\n  </channel>\n' +
    '</rss>\n';

  return xml;
}

async function mainFeed(req, res, next) {
  try {
    const siteUrl = process.env.SITE_URL;
    const articles = await articlesModel.getForFeed({ limit: FEED_SIZE });
    const xml = buildFeed({
      articles,
      siteUrl,
      selfPath: '/feed',
      title: 'Assam Times',
      description: 'Community newspaper from Assam, India',
    });
    res.set('Content-Type', 'application/rss+xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
}

async function categoryFeed(req, res, next) {
  try {
    const siteUrl = process.env.SITE_URL;
    const category = req.params.slug;
    const articles = await articlesModel.getForFeed({ category, limit: FEED_SIZE });
    const xml = buildFeed({
      articles,
      siteUrl,
      selfPath: `/feed/category/${encodeURIComponent(category)}`,
      title: `Assam Times — ${category}`,
      description: `Latest ${category} news from Assam Times`,
    });
    res.set('Content-Type', 'application/rss+xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
}

async function authorFeed(req, res, next) {
  try {
    const siteUrl = process.env.SITE_URL;
    const username = req.params.username;
    const author = await authorsModel.getByUsername(username);
    const articles = author
      ? await articlesModel.getForFeed({ authorId: author.id, limit: FEED_SIZE })
      : [];
    const displayName = author ? author.display_name || author.username : username;
    const xml = buildFeed({
      articles,
      siteUrl,
      selfPath: `/feed/author/${encodeURIComponent(username)}`,
      title: `Assam Times — ${displayName}`,
      description: `Latest articles by ${displayName} on Assam Times`,
    });
    res.set('Content-Type', 'application/rss+xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  mainFeed,
  categoryFeed,
  authorFeed,
};
