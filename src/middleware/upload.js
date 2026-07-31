const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');
const { generateSizedVariants } = require('../utils/imageVariants');

const MAX_IMAGE_WIDTH = 1200;
const WEBP_QUALITY = 85;

const DESTINATIONS = {
  featured_image: process.env.UPLOADS_ARTICLES_DIR,
  gallery_images: process.env.UPLOADS_ARTICLES_DIR,
  audio_file: process.env.UPLOADS_AUDIO_DIR,
  pdf_file: process.env.UPLOADS_DOCUMENTS_DIR,
  photo: process.env.UPLOADS_AUTHORS_DIR,
  // Single-file field used by the AJAX upload endpoint (POST
  // /admin/articles/upload-image) for both featured + gallery images.
  image: process.env.UPLOADS_ARTICLES_DIR,
};

const URL_PREFIXES = {
  featured_image: '/uploads/articles',
  gallery_images: '/uploads/articles',
  audio_file: '/uploads/audio',
  pdf_file: '/uploads/documents',
  photo: '/uploads/authors',
  image: '/uploads/articles',
};

// Image fields are restricted to an explicit allowlist (not a broad /^image\//)
// so avif/svg/bmp/tiff and anything else are rejected even if the mimetype is
// honest — svg in particular is an XSS vector when served from our own origin.
const ALLOWED_IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/;
const ALLOWED_MIME = {
  featured_image: ALLOWED_IMAGE_MIME,
  gallery_images: ALLOWED_IMAGE_MIME,
  audio_file: /^audio\//,
  pdf_file: /^application\/pdf$/,
  photo: ALLOWED_IMAGE_MIME,
  image: ALLOWED_IMAGE_MIME,
};

// Mimetype alone is client-supplied and spoofable; the extension also gates what gets written
// to disk under public_html, so both must pass before a file is accepted.
const ALLOWED_EXTENSIONS = {
  featured_image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  gallery_images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  audio_file: ['.mp3', '.wav', '.ogg', '.m4a'],
  pdf_file: ['.pdf'],
  photo: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
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

// Both the (client-supplied, spoofable) mimetype AND the extension must be in
// the field's allowlist. Rejections are tagged with err.code so the route
// wrapper (uploadWithErrorRedirect) can turn them into a friendly form error
// instead of a generic 500.
function rejectUpload(cb, fieldname) {
  const isImage = ALLOWED_MIME[fieldname] === ALLOWED_IMAGE_MIME;
  const message = isImage
    ? 'Only JPG, PNG, GIF and WebP images are allowed'
    : `Invalid file type for ${fieldname}`;
  const err = new Error(message);
  err.code = 'INVALID_FILE_TYPE';
  cb(err, false);
}

function fileFilter(req, file, cb) {
  const allowedMime = ALLOWED_MIME[file.fieldname];
  if (allowedMime && !allowedMime.test(file.mimetype)) {
    return rejectUpload(cb, file.fieldname);
  }

  const allowedExt = ALLOWED_EXTENSIONS[file.fieldname];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExt && !allowedExt.includes(ext)) {
    return rejectUpload(cb, file.fieldname);
  }

  cb(null, true);
}

// Resizes to a max width (no upscaling) and re-encodes the full-size original
// to WebP at quality 85 (smaller than JPEG/PNG for photos). Overwrites the
// file multer just wrote, writing a new .webp file and deleting the original,
// so nothing downstream needs to know — buildArticleData reads file.filename
// as usual.
//
// Only JPEG/PNG originals are converted. GIFs are left untouched (they may be
// animated — sharp would flatten to the first frame), and WebP is already in
// the target format. Their -thumb/-large/etc. variants are still WebP (see
// generateSizedVariants), which is fine even for an animated-GIF source.
async function compressImageFile(file) {
  if (!file || !/^image\/(jpeg|png)$/.test(file.mimetype)) return;

  const inputPath = file.path;
  const buffer = await sharp(inputPath)
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  const oldExt = path.extname(file.filename);
  const outputPath = path.join(path.dirname(inputPath), path.basename(file.filename, oldExt) + '.webp');

  await fs.promises.writeFile(outputPath, buffer);
  if (outputPath !== inputPath) {
    await fs.promises.unlink(inputPath);
    file.filename = path.basename(outputPath);
    file.path = outputPath;
    file.mimetype = 'image/webp';
  }
}

// Only featured_image gets fixed-size -thumb/-large/-article variants —
// those are exclusively for homepage cards and the article page, which
// only ever render featured_image, never gallery images.
async function generateFeaturedImageVariants(file) {
  if (!file || !/^image\//.test(file.mimetype)) return;
  const ext = path.extname(file.filename);
  const baseNoExt = path.basename(file.filename, ext);
  await generateSizedVariants(file.path, path.dirname(file.path), baseNoExt);
}

async function compressArticleImages(req, res, next) {
  try {
    const files = req.files || {};
    await Promise.all((files.gallery_images || []).map(compressImageFile));

    const featuredFiles = files.featured_image || [];
    for (const file of featuredFiles) {
      await compressImageFile(file);
      await generateFeaturedImageVariants(file);
    }

    next();
  } catch (err) {
    next(err);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Single-file upload for the AJAX endpoint (field name 'image').
const uploadSingleImage = upload.single('image');

// The site sends Referrer-Policy: no-referrer (helmet), so we can't bounce the
// user back to the form via req.get('Referer') — the back URL is computed from
// the route instead (backUrlFor). Known upload errors (bad type / too large)
// become a `?uploadError=<code>` redirect the GET form controller turns into an
// inline message; anything unexpected still falls through to the 500 handler.
function uploadWithErrorRedirect(mw, backUrlFor) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();

      let code = null;
      if (err.code === 'INVALID_FILE_TYPE') code = 'type';
      else if (err.code === 'LIMIT_FILE_SIZE') code = 'size';
      if (!code) return next(err);

      const back = backUrlFor(req);
      const sep = back.includes('?') ? '&' : '?';
      return res.redirect(`${back}${sep}uploadError=${code}`);
    });
  };
}

// Runs the single-file 'image' multer upload for the AJAX endpoint and turns
// upload errors into a JSON 400 (instead of the redirect / 500 the form flow
// uses). Anything unexpected still falls through to the global error handler.
function uploadImageJson(req, res, next) {
  uploadSingleImage(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ success: false, error: 'Only JPG, PNG, GIF and WebP images are allowed' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. The maximum upload size is 50 MB.' });
    }
    return next(err);
  });
}

// Maps a ?uploadError=<code> value to a user-facing message array for the form
// templates (which render `errors` escaped). Empty array when there's no error.
const UPLOAD_ERROR_MESSAGES = {
  type: 'Invalid file type. Please upload a JPG, PNG, GIF or WebP image.',
  size: 'File too large. The maximum upload size is 50 MB.',
};
function uploadErrorMessages(code) {
  const msg = UPLOAD_ERROR_MESSAGES[code];
  return msg ? [msg] : [];
}

function urlFor(fieldname, filename) {
  return `${URL_PREFIXES[fieldname]}/${filename}`;
}

// Reverses urlFor() to clean up files on disk once nothing in the DB references them
// anymore (article deleted, file replaced, or explicitly removed via the form).
function deleteUploadedFile(urlPath) {
  if (!urlPath) return;

  for (const [fieldname, prefix] of Object.entries(URL_PREFIXES)) {
    if (urlPath.startsWith(`${prefix}/`)) {
      const filename = urlPath.slice(prefix.length + 1);
      if (filename !== path.basename(filename)) {
        console.error(`Refusing to delete suspicious upload path: ${urlPath}`);
        return;
      }
      const fullPath = path.join(DESTINATIONS[fieldname], filename);
      fs.unlink(fullPath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error(`Failed to delete uploaded file ${fullPath}:`, err);
        }
      });

      // featured_image is the only field with derived -thumb/-large/
      // -article variants (homepage cards and the article page never
      // render gallery images) — clean those up too so replacing/
      // removing a featured image doesn't leave orphans behind.
      if (fieldname === 'featured_image') {
        const ext = path.extname(filename);
        const baseNoExt = path.basename(filename, ext);
        // Variants are .webp for new uploads and .jpg for pre-WebP articles —
        // try both extensions so replacing/removing either era cleans up.
        const variantSuffixes = ['-thumb', '-large', '-article', '-mobile-hero', '-mobile-thumb'];
        const variantExts = ['.webp', '.jpg'];
        variantSuffixes.forEach((suffix) => {
          variantExts.forEach((vext) => {
            const variantPath = path.join(DESTINATIONS[fieldname], baseNoExt + suffix + vext);
            fs.unlink(variantPath, (err) => {
              if (err && err.code !== 'ENOENT') {
                console.error(`Failed to delete image variant ${variantPath}:`, err);
              }
            });
          });
        });
      }
      return;
    }
  }
}

module.exports = {
  uploadArticleFiles: upload.fields([
    { name: 'featured_image', maxCount: 1 },
    { name: 'gallery_images', maxCount: 10 },
    { name: 'audio_file', maxCount: 1 },
    { name: 'pdf_file', maxCount: 1 },
  ]),
  uploadAuthorPhoto: upload.fields([{ name: 'photo', maxCount: 1 }]),
  uploadWithErrorRedirect,
  uploadErrorMessages,
  uploadImageJson,
  compressArticleImages,
  compressImageFile,
  generateFeaturedImageVariants,
  urlFor,
  deleteUploadedFile,
};
