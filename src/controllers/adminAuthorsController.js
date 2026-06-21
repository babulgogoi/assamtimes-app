const authorsModel = require('../models/authors');
const { urlFor, deleteUploadedFile } = require('../middleware/upload');

async function listAuthors(req, res, next) {
  try {
    const authors = await authorsModel.getAllWithCounts();
    res.locals.layout = 'admin/layout';
    res.render('admin/authors/list', {
      title: 'Authors — Admin',
      authorName: req.session.authorName,
      authors,
    });
  } catch (err) {
    next(err);
  }
}

function newAuthorForm(req, res) {
  res.locals.layout = 'admin/layout';
  res.render('admin/authors/form', {
    title: 'New Author — Admin',
    authorName: req.session.authorName,
    author: null,
    errors: [],
  });
}

async function editAuthorForm(req, res, next) {
  try {
    const author = await authorsModel.getById(req.params.id);
    if (!author) {
      return res.status(404).send('Author not found');
    }
    res.locals.layout = 'admin/layout';
    res.render('admin/authors/form', {
      title: `Edit: ${author.display_name || author.username} — Admin`,
      authorName: req.session.authorName,
      author,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

function resolvePhoto(req, existingPhoto) {
  const files = req.files || {};
  if (files.photo && files.photo[0]) {
    return urlFor('photo', files.photo[0].filename);
  }
  if (req.body.remove_photo) {
    return null;
  }
  return req.body.existing_photo || existingPhoto || null;
}

async function createAuthor(req, res, next) {
  try {
    const username = (req.body.username || '').trim();
    const errors = [];
    if (!username) {
      errors.push('Username is required.');
    } else if (await authorsModel.isUsernameTaken(username)) {
      errors.push(`Username "${username}" is already taken.`);
    }

    if (errors.length) {
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/authors/form', {
        title: 'New Author — Admin',
        authorName: req.session.authorName,
        author: req.body,
        errors,
      });
    }

    const id = await authorsModel.create({
      username,
      email: (req.body.email || '').trim(),
      displayName: (req.body.display_name || '').trim(),
      bio: req.body.bio,
      photo: resolvePhoto(req, null),
    });
    res.redirect(`/admin/authors/${id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function updateAuthor(req, res, next) {
  try {
    const author = await authorsModel.getById(req.params.id);
    if (!author) {
      return res.status(404).send('Author not found');
    }

    const username = (req.body.username || '').trim();
    const errors = [];
    if (!username) {
      errors.push('Username is required.');
    } else if (await authorsModel.isUsernameTaken(username, author.id)) {
      errors.push(`Username "${username}" is already taken.`);
    }

    if (errors.length) {
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/authors/form', {
        title: `Edit: ${author.display_name || author.username} — Admin`,
        authorName: req.session.authorName,
        author: { ...author, ...req.body },
        errors,
      });
    }

    const photo = resolvePhoto(req, author.photo);
    if (author.photo && author.photo !== photo) {
      deleteUploadedFile(author.photo);
    }

    await authorsModel.update(author.id, {
      username,
      email: (req.body.email || '').trim(),
      displayName: (req.body.display_name || '').trim(),
      bio: req.body.bio,
      photo,
    });
    res.redirect(`/admin/authors/${author.id}/edit`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAuthors,
  newAuthorForm,
  editAuthorForm,
  createAuthor,
  updateAuthor,
};
