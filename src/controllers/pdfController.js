const articlesModel = require('../models/articles');
const { getBrowser } = require('../utils/pdfBrowser');
const { renderOnce, QueueFullError, QueueTimeoutError } = require('../utils/pdfRenderQueue');

// Same fallback as server.js's own app.listen(PORT, ...) — this runs in
// the same process, so process.env.PORT here is guaranteed to match
// whatever the app actually bound to, regardless of what .env currently
// says on disk (the running process loaded it once at startup).
const PORT = process.env.PORT || 3000;

function sanitizeFilename(title) {
  return (
    (title || 'article')
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'article'
  );
}

function pdfErrorPage(slug) {
  return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto">
  <h2>PDF generation temporarily unavailable</h2>
  <p>Please use your browser's print function instead:</p>
  <ol>
    <li>Go back to the article</li>
    <li>Click the Print button in the utility bar</li>
    <li>In your browser's print dialog, select "Save as PDF"</li>
  </ol>
  <p><a href="/article/${slug}">&larr; Back to article</a></p>
</body></html>`;
}

// The actual Chrome-driven render, factored out so pdfRenderQueue's
// single-flight map can hold onto this specific call's promise (keyed by
// slug) rather than the whole request/response cycle.
async function renderPdf(slug) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Hits this same app directly over loopback, not the public
    // SITE_URL — that goes back out through Cloudflare, which caches
    // full HTML pages for up to 24h (see CLAUDE.md), and could hand
    // puppeteer a stale page instead of the current one.
    await page.goto(`http://127.0.0.1:${PORT}/article/${encodeURIComponent(slug)}`, {
      waitUntil: 'load',
      timeout: 30000,
    });

    return await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: false,
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center;color:#666;padding:0 20mm">Assam Times — assamtimes.org</div>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center;color:#666;padding:0 20mm">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    await page.close();
  }
}

async function downloadPdf(req, res) {
  const { slug } = req.params;
  try {
    const article = await articlesModel.getBySlug(slug);
    if (!article || article.status !== 'published') {
      return res.status(404).send('Article not found');
    }

    let pdf;
    try {
      pdf = await renderOnce(slug, () => renderPdf(slug));
    } catch (err) {
      if (err instanceof QueueFullError || err instanceof QueueTimeoutError) {
        res.set('Retry-After', '30');
        return res.status(503).send(pdfErrorPage(slug));
      }
      throw err;
    }

    const filename = sanitizeFilename(article.title);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('PDF generation failed for', slug, ':', err);
    res.status(500).send(pdfErrorPage(slug));
  }
}

module.exports = { downloadPdf };
