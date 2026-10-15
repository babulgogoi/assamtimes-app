const { PuppeteerError } = require('puppeteer-core');
const articlesModel = require('../models/articles');
const { getBrowser, closeWithTimeout, PAGE_CLOSE_TIMEOUT_MS } = require('../utils/pdfBrowser');
const { renderOnce, QueueFullError, QueueTimeoutError } = require('../utils/pdfRenderQueue');

// Same fallback as server.js's own app.listen(PORT, ...) — this runs in
// the same process, so process.env.PORT here is guaranteed to match
// whatever the app actually bound to, regardless of what .env currently
// says on disk (the running process loaded it once at startup).
const PORT = process.env.PORT || 3000;

// A hard backstop above page.goto()'s own 30s timeout option — page.pdf()
// itself has NO timeout option in Puppeteer at all, so without this, a
// hung PDF generation (as opposed to a hung navigation, which goto's own
// timeout already catches) would wait forever.
const JOB_TIMEOUT_MS = 35000;

class JobTimeoutError extends Error {}
// Puppeteer does NOT consistently wrap every disconnect-related failure in
// its own PuppeteerError hierarchy — confirmed directly during Phase B
// testing (a deliberate kill -9 mid-render): the actual errors surfaced
// were plain `Error: Navigating frame was detached` (cause: `Error:
// LifecycleWatcher disposed`), neither of which extend PuppeteerError.
// Enumerating every such message Puppeteer might ever throw would be
// fragile, so this instead checks the one thing that's actually reliable:
// whether the browser is still connected by the time the error is caught.
// If it isn't, the browser died during this render — that's true
// regardless of which specific error object surfaced — and the request
// gets 503 so the client is told to retry, not a generic opaque 500.
class BrowserDisconnectedError extends Error {}

function withTimeout(promise, ms, ErrorClass) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ErrorClass('PDF render job timed out')), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

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
    try {
      return await withTimeout((async () => {
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
      })(), JOB_TIMEOUT_MS, JobTimeoutError);
    } catch (err) {
      if (!browser.isConnected()) {
        throw new BrowserDisconnectedError(err.message);
      }
      throw err;
    }
  } finally {
    // Bounded separately from the job timeout above — a page that won't
    // close cleanly is itself a sign the browser is in a bad state, so a
    // hang here kills the whole browser process (see pdfBrowser.js's
    // closeWithTimeout) rather than leaving this request hanging on
    // cleanup after it already has (or doesn't have) its result.
    await closeWithTimeout(() => page.close(), PAGE_CLOSE_TIMEOUT_MS, browser.process());
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
      // PuppeteerError covers TimeoutError/TargetCloseError/
      // ConnectionClosedError/ProtocolError — i.e. the browser or page
      // itself failing or disconnecting mid-render (including the browser
      // process dying under it, confirmed directly via a deliberate
      // kill -9 mid-request during Phase B testing). That's a transient
      // infrastructure problem, not a client error or an application bug,
      // so it gets the same 503+Retry-After treatment as the queue being
      // full — the request can legitimately succeed on retry once
      // getBrowser() relaunches.
      if (
        err instanceof QueueFullError ||
        err instanceof QueueTimeoutError ||
        err instanceof JobTimeoutError ||
        err instanceof PuppeteerError ||
        err instanceof BrowserDisconnectedError
      ) {
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
