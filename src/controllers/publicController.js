const articlesModel = require('../models/articles');
const authorsModel = require('../models/authors');
const pagesModel = require('../models/pages');

const CATEGORY_PAGE_SIZE = 12;
const AUTHOR_PAGE_SIZE = 12;
const SEARCH_PAGE_SIZE = 12;
const SEARCH_MIN_LENGTH = 2;

async function home(req, res, next) {
  try {
    const [latest, mostViewed, categories] = await Promise.all([
      articlesModel.getLatestPublished({ limit: 9 }),
      articlesModel.getMostViewed({ limit: 5 }),
      articlesModel.getTopCategories({ limit: 8 }),
    ]);

    const [lead, ...grid] = latest;

    res.render('public/home', {
      title: 'Assam Times',
      lead,
      grid,
      mostViewed,
      categories,
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

    const [related, categories] = await Promise.all([
      articlesModel.getRelatedByCategory({ category: article.category, excludeId: article.id, limit: 5 }),
      articlesModel.getTopCategories({ limit: 8 }),
    ]);

    articlesModel.incrementViewCount(article.id).catch((err) => {
      console.error('Failed to increment view count for article', article.id, err);
    });

    res.render('public/article', {
      title: article.title,
      article,
      related,
      categories,
      isAdmin: !!(req.session && req.session.authorId),
    });
  } catch (err) {
    next(err);
  }
}

async function categoryPage(req, res, next) {
  try {
    const category = req.params.category;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * CATEGORY_PAGE_SIZE;

    const [articles, total, categories, mostViewed] = await Promise.all([
      articlesModel.getByCategory({ category, limit: CATEGORY_PAGE_SIZE, offset }),
      articlesModel.countByCategory(category),
      articlesModel.getTopCategories({ limit: 8 }),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE));

    res.render('public/category', {
      title: `${category} — Assam Times`,
      category,
      articles,
      categories,
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

    const [articles, total, categories, mostViewed] = await Promise.all([
      articlesModel.getByAuthorId({ authorId: author.id, limit: AUTHOR_PAGE_SIZE, offset }),
      articlesModel.countByAuthorId(author.id),
      articlesModel.getTopCategories({ limit: 8 }),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / AUTHOR_PAGE_SIZE));

    res.render('public/author', {
      title: `${author.display_name || author.username} — Assam Times`,
      author,
      articles,
      categories,
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
    const [categories, mostViewed] = await Promise.all([
      articlesModel.getTopCategories({ limit: 8 }),
      articlesModel.getMostViewed({ limit: 5 }),
    ]);

    if (q.length < SEARCH_MIN_LENGTH) {
      return res.render('public/search', {
        title: 'Search — Assam Times',
        q,
        articles: [],
        categories,
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
      categories,
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
  articleDetail,
  categoryPage,
  authorPage,
  searchPage,
  pageDetail,
};
