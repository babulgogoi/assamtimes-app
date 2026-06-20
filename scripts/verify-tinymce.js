// Browser smoke test for the TinyMCE editor in the admin article form.
// Requires the dev server running (npm run dev) and a working admin login.
// Usage: node scripts/verify-tinymce.js <username> <password> [baseUrl]
require('dotenv').config();
const { chromium } = require('playwright');

const username = process.argv[2];
const password = process.argv[3];
const baseUrl = process.argv[4] || `http://127.0.0.1:${process.env.PORT || 3000}`;

if (!username || !password) {
  console.error('Usage: node scripts/verify-tinymce.js <username> <password> [baseUrl]');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} -- ${req.failure()?.errorText}`);
  });

  await page.goto(`${baseUrl}/admin/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/articles');

  await page.goto(`${baseUrl}/admin/articles/new`);
  await page.waitForSelector('.tox-tinymce', { timeout: 15000 });

  await page.screenshot({ path: '/tmp/tinymce-verify-toolbar.png' });

  const editorFrame = page.frameLocator('.tox-edit-area iframe');
  await editorFrame.locator('body').click();
  await editorFrame.locator('body').type('Hello from the TinyMCE test.');
  await page.click('button[aria-label="Bold"]');
  await editorFrame.locator('body').type(' This part is bold.');

  await page.screenshot({ path: '/tmp/tinymce-verify.png', fullPage: true });

  const editorHtml = await editorFrame.locator('body').innerHTML();

  console.log('EDITOR_HTML:', editorHtml);
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  console.log('FAILED_REQUESTS:', JSON.stringify(failedRequests));
  console.log('Screenshot saved to /tmp/tinymce-verify.png');

  await browser.close();
})().catch(async (err) => {
  console.error('SCRIPT_ERROR:', err);
  process.exit(1);
});
