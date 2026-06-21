const articlesModel = require('../models/articles');
const authorsModel = require('../models/authors');
const pagesModel = require('../models/pages');
const siteSettingsModel = require('../models/siteSettings');

const CATEGORY_PAGE_SIZE = 12;
const AUTHOR_PAGE_SIZE = 12;
const SEARCH_PAGE_SIZE = 12;
const SEARCH_MIN_LENGTH = 2;
const NEWS_PAGE_SIZE = 18;
const HOME_GRID_SIZE = 18;
const FEATURED_ARTICLES_SIZE = 5;

async function home(req, res, next) {
  try {
    const featuredCategory = await siteSettingsModel.getFeaturedCategory();

    const [latest, mostViewed, featuredArticles] = await Promise.all([
      articlesModel.getLatestPublished({ limit: HOME_GRID_SIZE + 1 }),
      articlesModel.getMostViewed({ limit: 5 }),
      articlesModel.getByCategory({ category: featuredCategory, limit: FEATURED_ARTICLES_SIZE }),
    ]);

    const [lead, ...grid] = latest;

    res.render('public/home', {
      title: 'Assam Times',
      lead,
      grid,
      mostViewed,
      featuredArticles,
    });
  } catch (err) {
    next(err);
  }
}

async function newsPage(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * NEWS_PAGE_SIZE;

    const [articles, total, mostViewed] = await Promise.all([
      articlesModel.getLatestPublished({ limit: NEWS_PAGE_SIZE, offset }),
      articlesModel.countPublished(),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));

    res.render('public/news', {
      title: 'Latest News — Assam Times',
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

    if (!article || article.status !== 'published') {
      return res.status(404).render('public/404', { title: 'Article Not Found' });
    }

    const related = await articlesModel.getRelatedByCategory({
      category: article.category,
      excludeId: article.id,
      limit: 5,
    });

    articlesModel.incrementViewCount(article.id).catch((err) => {
      console.error('Failed to increment view count for article', article.id, err);
    });

    res.render('public/article', {
      title: article.title,
      article,
      related,
      isAdmin: !!(req.session && req.session.authorId),
      canonicalUrl: `${process.env.SITE_URL}/article/${article.slug}`,
    });
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

    const [articles, total, mostViewed] = await Promise.all([
      articlesModel.getByCategory({ category, limit: CATEGORY_PAGE_SIZE, offset }),
      articlesModel.countByCategory(category),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE));

    res.render('public/category', {
      title: `${category} — Assam Times`,
      category,
      articles,
      mostViewed,
      page,
      totalPages,
    });
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

    const [articles, total, mostViewed] = await Promise.all([
      articlesModel.getByAuthorId({ authorId: author.id, limit: AUTHOR_PAGE_SIZE, offset }),
      articlesModel.countByAuthorId(author.id),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / AUTHOR_PAGE_SIZE));

    res.render('public/author', {
      title: `${author.display_name || author.username} — Assam Times`,
      author,
      articles,
      mostViewed,
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
    const mostViewed = await articlesModel.getMostViewed({ limit: 5 });

    if (q.length < SEARCH_MIN_LENGTH) {
      return res.render('public/search', {
        title: 'Search — Assam Times',
        q,
        articles: [],
        mostViewed,
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
      mostViewed,
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
      page,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  home,
  newsPage,
  articleDetail,
  likeArticle,
  categoryPage,
  authorPage,
  searchPage,
  pageDetail,
};
