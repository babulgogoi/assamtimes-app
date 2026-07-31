// One-off: generates logo.webp from the branding logo.jpg, served via
// <picture> in views/partials/header.ejs with the jpg as fallback for
// browsers without WebP support. Re-run this any time logo.jpg changes.
// Usage: node scripts/convert-logo-webp.js
require('dotenv').config();
const path = require('path');
const sharp = require('sharp');

const srcPath = path.join(process.env.UPLOADS_BRANDING_DIR, 'logo.jpg');
const destPath = path.join(process.env.UPLOADS_BRANDING_DIR, 'logo.webp');

sharp(srcPath)
  .webp({ quality: 80 })
  .toFile(destPath)
  .then((info) => {
    console.log(`logo.webp written: ${info.width}x${info.height}, ${info.size}B`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
