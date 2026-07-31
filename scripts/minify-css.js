// Minifies the public-facing stylesheets for production. Source files
// (style.css, article.css) stay human-readable and are what you edit —
// re-run this after every CSS change to refresh the .min.css files that
// layout.ejs/article.ejs actually link to.
// Usage: node scripts/minify-css.js
const CleanCSS = require('clean-css');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../public/css');
const FILES = ['style.css', 'article.css', 'admin.css'];

FILES.forEach((file) => {
  const inputPath = path.join(DIR, file);
  const outputPath = path.join(DIR, file.replace(/\.css$/, '.min.css'));
  const input = fs.readFileSync(inputPath, 'utf8');
  const output = new CleanCSS({}).minify(input);

  if (output.errors.length) {
    console.error(`Errors minifying ${file}:`, output.errors);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(outputPath, output.styles);
  const pct = (100 - (output.styles.length / input.length) * 100).toFixed(1);
  console.log(`${file}: ${input.length}B -> ${file.replace(/\.css$/, '.min.css')}: ${output.styles.length}B (-${pct}%)`);
});
