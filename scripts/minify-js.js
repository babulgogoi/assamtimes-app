// Minifies the public-facing scripts for production. Source files
// (header.js, article.js) stay human-readable and are what you edit —
// re-run this after every JS change to refresh the .min.js files that
// layout.ejs/article.ejs link to when NODE_ENV=production.
// Usage: node scripts/minify-js.js
const { minify } = require('terser');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../public/js');
const FILES = ['header.js', 'article.js', 'push.js', 'accessibility.js', 'mega-menu.js', 'liveblog.js', 'latest-news-tabs.js'];

async function main() {
  for (const file of FILES) {
    const inputPath = path.join(DIR, file);
    const outputPath = path.join(DIR, file.replace(/\.js$/, '.min.js'));
    const input = fs.readFileSync(inputPath, 'utf8');
    const result = await minify(input);

    if (!result.code) {
      console.error(`Failed to minify ${file}`);
      process.exitCode = 1;
      continue;
    }

    fs.writeFileSync(outputPath, result.code);
    const pct = (100 - (result.code.length / input.length) * 100).toFixed(1);
    console.log(`${file}: ${input.length}B -> ${file.replace(/\.js$/, '.min.js')}: ${result.code.length}B (-${pct}%)`);
  }
}

main();
