const pagesModel = require('../models/pages');
const slugify = require('../utils/slugify');

async function listPages(req, res, next) {
  try {
    const pages = await pagesModel.getAllForAdmin();
    res.locals.layout = 'admin/layout';
    res.render('admin/pages/list', {
      title: 'Pages — Admin',
      authorName: req.session.authorName,
      pages,
    });
  } catch (err) {
    next(err);
  }
}

function newPageForm(req, res) {
  res.locals.layout = 'admin/layout';
  res.render('admin/pages/form', {
    title: 'New Page — Admin',
    authorName: req.session.authorName,
    page: null,
    errors: [],
  });
}

async function editPageForm(req, res, next) {
  try {
    const page = await pagesModel.getById(req.params.id);
    if (!page) {
      return res.status(404).send('Page not found');
    }
    res.locals.layout = 'admin/layout';
    res.render('admin/pages/form', {
      title: `Edit: ${page.title} — Admin`,
      authorName: req.session.authorName,
      page,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

async function buildPageData(req) {
  const body = req.body;
  let baseSlug = slugify(body.slug || body.title || '');
  if (!baseSlug) baseSlug = `page-${Date.now()}`;

  const excludeId = req.params.id ? Number(req.params.id) : null;
  let slug = baseSlug;
  let suffix = 2;
  while (await pagesModel.slugExists(slug, excludeId)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return {
    slug,
    title: body.title,
    body: body.body,
    status: body.status === 'draft' ? 'draft' : 'published',
  };
}

async function createPage(req, res, next) {
  try {
    if (!req.body.title || !req.body.body) {
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/pages/form', {
        title: 'New Page — Admin',
        authorName: req.session.authorName,
        page: req.body,
        errors: ['Title and body are required.'],
      });
    }

    const data = await buildPageData(req);
    const id = await pagesModel.create(data);
    res.redirect(`/admin/pages/${id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function updatePage(req, res, next) {
  try {
    const page = await pagesModel.getById(req.params.id);
    if (!page) {
      return res.status(404).send('Page not found');
    }

    if (!req.body.title || !req.body.body) {
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/pages/form', {
        title: `Edit: ${page.title} — Admin`,
        authorName: req.session.authorName,
        page: { ...page, ...req.body },
        errors: ['Title and body are required.'],
      });
    }

    const data = await buildPageData(req);
    await pagesModel.update(page.id, data);
    res.redirect(`/admin/pages/${page.id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function deletePage(req, res, next) {
  try {
    await pagesModel.remove(req.params.id);
    res.redirect('/admin/pages');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPages,
  newPageForm,
  editPageForm,
  createPage,
  updatePage,
  deletePage,
};
