const bcrypt = require('bcryptjs');
const authorsModel = require('../models/authors');
const articlesModel = require('../models/articles');
const slugify = require('../utils/slugify');
const { urlFor, deleteUploadedFile } = require('../middleware/upload');
const CATEGORIES = require('../constants/categories');

const ADMIN_PAGE_SIZE = 20;

function cleanupReplacedFiles(oldArticle, newData) {
  if (oldArticle.featured_image && oldArticle.featured_image !== newData.featured_image) {
    deleteUploadedFile(oldArticle.featured_image);
  }
  if (oldArticle.audio_file && oldArticle.audio_file !== newData.audio_file) {
    deleteUploadedFile(oldArticle.audio_file);
  }
  if (oldArticle.pdf_file && oldArticle.pdf_file !== newData.pdf_file) {
    deleteUploadedFile(oldArticle.pdf_file);
  }
  const newGalleryUrls = (newData.gallery_images || []).map((img) => img.url);
  (oldArticle.gallery_images || [])
    .filter((img) => !newGalleryUrls.includes(img.url))
    .forEach((img) => deleteUploadedFile(img.url));
}

function cleanupAllFiles(article) {
  if (article.featured_image) deleteUploadedFile(article.featured_image);
  if (article.audio_file) deleteUploadedFile(article.audio_file);
  if (article.pdf_file) deleteUploadedFile(article.pdf_file);
  (article.gallery_images || []).forEach((img) => deleteUploadedFile(img.url));
}

function loginForm(req, res) {
  if (req.session && req.session.authorId) {
    return res.redirect('/admin');
  }
  res.render('admin/login', { title: 'Admin Login', error: null, layout: false });
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const author = await authorsModel.getByUsernameForAuth(username || '');

    const invalid = !author || !author.password_hash || !(await bcrypt.compare(password || '', author.password_hash));
    if (invalid) {
      return res.status(401).render('admin/login', { title: 'Admin Login', error: 'Invalid username or password.', layout: false });
    }

    req.session.authorId = author.id;
    req.session.authorName = author.display_name || author.username;
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect('/admin/login');
  });
}

async function listArticles(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = (req.query.q || '').trim();
    const status = req.query.status || '';
    const offset = (page - 1) * ADMIN_PAGE_SIZE;

    const [articles, total] = await Promise.all([
      articlesModel.listForAdmin({ limit: ADMIN_PAGE_SIZE, offset, q, status }),
      articlesModel.countForAdmin({ q, status }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

    res.locals.layout = 'admin/layout';
    res.render('admin/articles/list', {
      title: 'Articles — Admin',
      authorName: req.session.authorName,
      articles,
      q,
      status,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function newArticleForm(req, res, next) {
  try {
    const authors = await authorsModel.getAll();
    res.locals.layout = 'admin/layout';
    res.render('admin/articles/form', {
      title: 'New Article — Admin',
      authorName: req.session.authorName,
      authors,
      categories: CATEGORIES,
      article: null,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

async function editArticleForm(req, res, next) {
  try {
    const article = await articlesModel.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }
    const authors = await authorsModel.getAll();
    res.locals.layout = 'admin/layout';
    res.render('admin/articles/form', {
      title: `Edit: ${article.title} — Admin`,
      authorName: req.session.authorName,
      authors,
      categories: CATEGORIES,
      article,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

async function resolveAuthorId(body) {
  const newUsername = (body.new_author_username || '').trim();
  if (newUsername) {
    const author = await authorsModel.findOrCreate({
      username: newUsername,
      displayName: (body.new_author_display_name || '').trim() || newUsername,
    });
    return author.id;
  }
  const id = Number(body.author_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function buildArticleData(req, existingArticle = null) {
  const body = req.body;
  const files = req.files || {};

  let baseSlug = slugify(body.slug || body.title || '');
  if (!baseSlug) baseSlug = `article-${Date.now()}`;

  const excludeId = req.params.id ? Number(req.params.id) : null;
  let slug = baseSlug;
  let suffix = 2;
  while (await articlesModel.slugExists(slug, excludeId)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const authorId = await resolveAuthorId(body);

  const data = {
    slug,
    title: body.title,
    body: body.body,
    video_url: body.video_url || null,
    author_id: authorId,
    category: body.category || null,
    status: body.status === 'draft' ? 'draft' : 'published',
    // Falling back to now() unconditionally here used to silently bump an existing
    // article's published_at on any save where the field came back empty — fall back
    // to the article's own existing value on updates instead, and only default to
    // now() when there's genuinely no prior value (a brand-new article).
    published_at: body.published_at
      ? new Date(body.published_at)
      : (existingArticle ? existingArticle.published_at : new Date()),
  };

  if (files.featured_image && files.featured_image[0]) {
    data.featured_image = urlFor('featured_image', files.featured_image[0].filename);
  } else if (body.remove_featured_image) {
    data.featured_image = null;
  } else {
    data.featured_image = body.existing_featured_image || null;
  }
  data.featured_image_caption = (body.featured_image_caption || '').trim() || null;

  if (files.audio_file && files.audio_file[0]) {
    data.audio_file = urlFor('audio_file', files.audio_file[0].filename);
  } else if (body.remove_audio_file) {
    data.audio_file = null;
  } else {
    data.audio_file = body.existing_audio_file || null;
  }

  if (files.pdf_file && files.pdf_file[0]) {
    data.pdf_file = urlFor('pdf_file', files.pdf_file[0].filename);
  } else if (body.remove_pdf_file) {
    data.pdf_file = null;
  } else {
    data.pdf_file = body.existing_pdf_file || null;
  }

  // Existing gallery images are submitted as indexed fields (gallery_url_0,
  // gallery_keep_0, gallery_caption_0, ...) rather than a same-named array,
  // so unchecking "Keep" on one doesn't disturb the caption/url pairing of
  // the others.
  let gallery = [];
  const galleryIndexes = new Set();
  Object.keys(body).forEach((key) => {
    const m = key.match(/^gallery_url_(\d+)$/);
    if (m) galleryIndexes.add(Number(m[1]));
  });
  Array.from(galleryIndexes).sort((a, b) => a - b).forEach((idx) => {
    if (body[`gallery_keep_${idx}`]) {
      gallery.push({
        url: body[`gallery_url_${idx}`],
        caption: (body[`gallery_caption_${idx}`] || '').trim(),
      });
    }
  });
  if (files.gallery_images) {
    gallery = gallery.concat(
      files.gallery_images.map((f) => ({ url: urlFor('gallery_images', f.filename), caption: '' }))
    );
  }
  data.gallery_images = gallery;

  return data;
}

async function createArticle(req, res, next) {
  try {
    if (!req.body.title || !req.body.body) {
      const authors = await authorsModel.getAll();
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/articles/form', {
        title: 'New Article — Admin',
        authorName: req.session.authorName,
        authors,
        categories: CATEGORIES,
        article: req.body,
        errors: ['Title and body are required.'],
      });
    }

    const data = await buildArticleData(req);
    const id = await articlesModel.create(data);
    res.redirect(`/admin/articles/${id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function updateArticle(req, res, next) {
  try {
    const article = await articlesModel.getById(req.params.id);
    if (!article) {
      return res.status(404).send('Article not found');
    }

    if (!req.body.title || !req.body.body) {
      const authors = await authorsModel.getAll();
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/articles/form', {
        title: `Edit: ${article.title} — Admin`,
        authorName: req.session.authorName,
        authors,
        categories: CATEGORIES,
        article: { ...article, ...req.body },
        errors: ['Title and body are required.'],
      });
    }

    const data = await buildArticleData(req, article);
    await articlesModel.update(article.id, data);
    cleanupReplacedFiles(article, data);
    res.redirect(`/admin/articles/${article.id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function deleteArticle(req, res, next) {
  try {
    const article = await articlesModel.getById(req.params.id);
    await articlesModel.remove(req.params.id);
    if (article) cleanupAllFiles(article);
    res.redirect('/admin/articles');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  loginForm,
  login,
  logout,
  listArticles,
  newArticleForm,
  editArticleForm,
  createArticle,
  updateArticle,
  deleteArticle,
};
