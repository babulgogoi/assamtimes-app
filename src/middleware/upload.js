const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const DESTINATIONS = {
  featured_image: process.env.UPLOADS_ARTICLES_DIR,
  gallery_images: process.env.UPLOADS_ARTICLES_DIR,
  audio_file: process.env.UPLOADS_AUDIO_DIR,
  pdf_file: process.env.UPLOADS_DOCUMENTS_DIR,
};

const URL_PREFIXES = {
  featured_image: '/uploads/articles',
  gallery_images: '/uploads/articles',
  audio_file: '/uploads/audio',
  pdf_file: '/uploads/documents',
};

const ALLOWED_MIME = {
  featured_image: /^image\//,
  gallery_images: /^image\//,
  audio_file: /^audio\//,
  pdf_file: /^application\/pdf$/,
};

// Mimetype alone is client-supplied and spoofable; the extension also gates what gets written
// to disk under public_html, so both must pass before a file is accepted.
const ALLOWED_EXTENSIONS = {
  featured_image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  gallery_images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  audio_file: ['.mp3', '.wav', '.ogg', '.m4a'],
  pdf_file: ['.pdf'],
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = DESTINATIONS[file.fieldname];
    if (!dir) return cb(new Error(`Unexpected upload field: ${file.fieldname}`));
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  const allowedMime = ALLOWED_MIME[file.fieldname];
  if (allowedMime && !allowedMime.test(file.mimetype)) {
    return cb(new Error(`Invalid file type for ${file.fieldname}: ${file.mimetype}`));
  }

  const allowedExt = ALLOWED_EXTENSIONS[file.fieldname];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExt && !allowedExt.includes(ext)) {
    return cb(new Error(`Invalid file extension for ${file.fieldname}: ${ext || '(none)'}`));
  }

  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

function urlFor(fieldname, filename) {
  return `${URL_PREFIXES[fieldname]}/${filename}`;
}

module.exports = {
  uploadArticleFiles: upload.fields([
    { name: 'featured_image', maxCount: 1 },
    { name: 'gallery_images', maxCount: 10 },
    { name: 'audio_file', maxCount: 1 },
    { name: 'pdf_file', maxCount: 1 },
  ]),
  urlFor,
};
