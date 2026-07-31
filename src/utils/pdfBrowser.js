const puppeteer = require('puppeteer-core');

// `/usr/bin/chromium-browser` is a broken snap-wrapper script on this box
// (Ubuntu 24.04 dropped the real deb package) — it fails under PM2's
// non-interactive session with "xdg-settings: not found" / snap cgroup
// errors (found 2026-07-31: 172k+ failed PDF requests logged before this
// was diagnosed). Fixed by installing a portable, non-snap Chrome via
// `npx @puppeteer/browsers install chrome@stable` (no root needed, unlike
// apt — `apt install chromium`/`chromium-browser` just reinstalls the same
// broken snap wrapper on this Ubuntu version) and pointing CHROMIUM_PATH at
// it in .env. The old @sparticuz/chromium reasoning below still holds —
// that package is for serverless/Lambda specifically — this just isn't the
// system Chromium it assumed.
const EXECUTABLE_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

let browserPromise = null;

// One shared headless instance, not one per request — launching fresh
// measured ~7.5s on this server, while reusing an existing instance and
// just opening a new page/tab measured ~150ms. Worth the lifecycle
// complexity below for a >40x latency difference on every PDF download.
async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.isConnected()) return browser;
    browserPromise = null;
  }

  browserPromise = puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close().catch(() => {});
}

module.exports = { getBrowser, closeBrowser };
