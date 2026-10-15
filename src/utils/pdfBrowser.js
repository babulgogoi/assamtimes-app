const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

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

// App-owned, non-public, gitignored directory for Chrome's userDataDir —
// replaces Puppeteer's own default of an auto-generated dir under the
// shared system /tmp. That default was the root of a real leak (28-day
// investigation, Oct 2026): a disconnected browser's dir was never cleaned
// up because nothing closed it before relaunching, and a separate,
// directly-reproduced bug (two concurrent requests both observing a dead
// browser and BOTH independently calling puppeteer.launch()) could leak
// more than one dir per single crash. One subdirectory per worker, named
// with this OS process's own PID — this app runs as exactly one PM2
// cluster instance today (confirmed via `pm2 describe assamtimes`:
// exec_mode cluster_mode, instances: 1), but naming by PID rather than a
// fixed/shared path means a future bump to `instances` in
// ecosystem.config.js can never have two workers collide on the same
// profile directory.
const PROFILE_ROOT = path.join(__dirname, '..', '..', 'tmp', 'chrome-profiles');
const PROFILE_DIR = path.join(PROFILE_ROOT, 'worker-' + process.pid);

// Recycle thresholds. 200 renders matches the brief's own ballpark figure.
// RSS_RECYCLE_THRESHOLD_KB went through a real miscalibration during Phase
// B testing, caught live: an initial 1.5GB was picked before measuring this
// specific Chromium build's own baseline, which turned out to already sit
// at ~750-800MB completely idle (confirmed directly via /proc inspection
// of a freshly-launched, zero-page browser) — combined with ~100-200MB per
// un-reaped renderer process (see this file's renderer-leak history, not
// otherwise fixed here), a fresh browser could cross 1.5GB within just a
// handful of renders, causing recycle-almost-every-render thrashing
// instead of the intended "every ~200 renders or on genuine excess."
// Direct measurement during this same investigation showed SUSTAINED,
// non-crashing operation up to ~2.0-2.3GB under real concurrent load — 3GB
// sits comfortably above that observed-healthy range while still catching
// genuine runaway growth well before it threatens this 11GB box (shared
// with other tenants) under zero swap.
const MAX_RENDERS_BEFORE_RECYCLE = 200;
const RSS_RECYCLE_THRESHOLD_KB = 3 * 1024 * 1024;
const PAGE_CLOSE_TIMEOUT_MS = 5000;
const BROWSER_CLOSE_TIMEOUT_MS = 5000;

let browserLaunchPromise = null; // single-flight guard — see getBrowser()
let renderCount = 0;
let lastKnownRssKb = 0;
let recycleScheduled = false;

function readOwnRssKb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function readTreeRssKb(pid) {
  try {
    const children = fs
      .readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let total = readOwnRssKb(pid);
    for (const childPid of children) {
      total += readTreeRssKb(childPid);
    }
    return total;
  } catch {
    return 0;
  }
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0); // signal 0: existence/permission check only
    return true;
  } catch {
    return false;
  }
}

// Removes profile directories left behind by a previous run of this same
// worker PID slot (a prior crash, a kill -9, or an unclean PM2 restart
// that didn't get a chance to run closeBrowser()'s SIGTERM handler).
// Deliberately NEVER deletes by age alone — only removes a directory
// whose own Chrome SingletonLock points at a PID that is not actually
// running. Age-only deletion risked killing a directory still legitimately
// in use (e.g. a slow-starting browser, or — if `instances` is ever raised
// above 1 — another worker's live profile); liveness-checking the lock is
// the only signal that's actually safe to act on.
function purgeStaleProfileDirs() {
  let entries;
  try {
    entries = fs.readdirSync(PROFILE_ROOT);
  } catch {
    return; // doesn't exist yet on a fresh deploy — nothing to purge
  }

  for (const entry of entries) {
    if (entry === 'worker-' + process.pid) continue; // never touch our own slot

    const dir = path.join(PROFILE_ROOT, entry);
    const lockPath = path.join(dir, 'SingletonLock');
    let targetPid = null;
    try {
      const target = fs.readlinkSync(lockPath);
      const m = target.match(/(\d+)$/);
      targetPid = m ? Number(m[1]) : null;
    } catch {
      // No readable SingletonLock at all (Chrome never finished starting
      // in this dir, or something already partially cleaned it) — treat
      // as dead, since there's no live-process claim being made on it.
    }

    if (!targetPid || !isPidRunning(targetPid)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

purgeStaleProfileDirs();

function attachDiagnostics(browser, launchedAt) {
  let openPages = 0;
  const proc = browser.process();
  const pid = proc ? proc.pid : null;

  // Node's own ChildProcess 'exit' event is the authoritative source for
  // exit code/signal — reading proc.exitCode/proc.signalCode synchronously
  // inside the browser's 'disconnected' handler is unreliable, since the
  // CDP pipe/websocket disconnect can be observed before Node has finished
  // processing the underlying process's actual exit (confirmed directly
  // during investigation: an earlier version of this logging read both as
  // null even for a deliberate, confirmed SIGKILL).
  let exitInfo = { code: null, signal: null };
  if (proc) {
    proc.once('exit', (code, signal) => {
      exitInfo = { code, signal };
    });
  }

  const rssInterval = pid
    ? setInterval(() => {
        const rss = readTreeRssKb(pid);
        if (rss > 0) lastKnownRssKb = rss;
      }, 2000)
    : null;

  browser.on('targetcreated', (target) => {
    if (target.type() === 'page') openPages++;
  });
  browser.on('targetdestroyed', (target) => {
    if (target.type() === 'page') openPages = Math.max(0, openPages - 1);
  });

  browser.once('disconnected', () => {
    if (rssInterval) clearInterval(rssInterval);
    const uptimeMs = Date.now() - launchedAt;
    setImmediate(() => {
      console.error(
        '[pdfBrowser] disconnected pid=' + pid +
        ' exitCode=' + exitInfo.code +
        ' signalCode=' + exitInfo.signal +
        ' lastTreeRssKb=' + lastKnownRssKb +
        ' openPages=' + openPages +
        ' uptimeMs=' + uptimeMs
      );
    });
  });
}

// Races a close operation against a timeout. If it hangs, SIGKILLs the
// given process rather than leaving a half-dead browser that still looks
// "connected" (per isConnected()) but can't actually service a new page —
// worse than a clean crash, since nothing would ever trigger a relaunch.
async function closeWithTimeout(closeFn, timeoutMs, proc) {
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });
  await Promise.race([closeFn().catch(() => {}), timeout]);
  if (timedOut && proc && !proc.killed) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  return timedOut;
}

async function launchBrowser() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const launchedAt = Date.now();
  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    userDataDir: PROFILE_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });
  attachDiagnostics(browser, launchedAt);
  renderCount = 0;
  // Without this, a brand-new browser inherits the PREVIOUS instance's
  // last-sampled RSS until its own periodic sampler fires for the first
  // time (every 2s) — confirmed live during testing to cause exactly the
  // kind of immediate-recycle thrashing this reset prevents: a fresh
  // browser being judged against a stale, already-high number from the
  // instance it just replaced.
  lastKnownRssKb = 0;
  return browser;
}

// Starts a launch and attaches a side-effect-only cleanup to it, so a
// FAILED launch can never get stuck replaying the same rejected promise
// forever — confirmed directly during Phase B testing (via an isolated,
// non-live-server reproduction with a mocked failing launch): an earlier
// version only cleared browserLaunchPromise on the "existing promise
// turned out disconnected" branch of getBrowser() below, not on the
// very-first-launch-ever branch, so a launch failure on that path left
// every PDF request permanently broken afterward with no self-healing
// retry. Attaching the clear-on-failure behavior here, at the single
// point where every launch attempt is created, covers both call sites by
// construction instead of needing to be re-implemented at each one. The
// `browserLaunchPromise === promise` guard matters: if something else
// (another concurrent relaunch, a recycle) has already replaced the
// reference with a NEWER attempt by the time this one's rejection is
// observed, this must not clear that newer one out from under it.
function startLaunch() {
  const promise = launchBrowser();
  promise.catch(() => {
    if (browserLaunchPromise === promise) {
      browserLaunchPromise = null;
    }
  });
  return promise;
}

// One shared headless instance, not one per request — launching fresh
// measured ~7.5s on this server, while reusing an existing instance and
// just opening a new page/tab measured ~150ms. Worth the lifecycle
// complexity below for a >40x latency difference on every PDF download.
//
// Single-flight on the LAUNCH itself, not just on individual renders
// (that's pdfRenderQueue.js's job) — directly reproduced during
// investigation: under concurrent requests, two callers could each
// observe the same disconnected browser, both null out the shared
// reference, and both independently call puppeteer.launch(), leaking an
// entire extra browser process + profile dir per crash instead of one.
// The fix is the same shape as pdfRenderQueue's single-flight: the
// check-then-assign of browserLaunchPromise below has no `await` between
// the check and the assignment, so it can't be interleaved by another
// concurrent call — whichever caller's synchronous check happens first
// starts the one launch, and every other caller (resuming later, after
// its own await) sees that promise already assigned and just awaits it.
async function getBrowser() {
  if (browserLaunchPromise) {
    const browser = await browserLaunchPromise; // rejection propagates to this call's caller; startLaunch()'s .catch() already handles clearing the shared reference
    if (browser.isConnected()) return browser;
    browserLaunchPromise = null;
    await closeWithTimeout(() => browser.close(), BROWSER_CLOSE_TIMEOUT_MS, browser.process());
  }

  if (!browserLaunchPromise) {
    browserLaunchPromise = startLaunch();
  }
  return browserLaunchPromise;
}

async function closeBrowser() {
  if (!browserLaunchPromise) return;
  const browser = await browserLaunchPromise;
  browserLaunchPromise = null;
  await closeWithTimeout(() => browser.close(), BROWSER_CLOSE_TIMEOUT_MS, browser.process());
}

async function performRecycle() {
  recycleScheduled = false;
  renderCount = 0;
  if (!browserLaunchPromise) return;
  const toClose = browserLaunchPromise;
  browserLaunchPromise = null; // next getBrowser() call relaunches lazily
  try {
    const browser = await toClose;
    await closeWithTimeout(() => browser.close(), BROWSER_CLOSE_TIMEOUT_MS, browser.process());
  } catch {
    // already gone — nothing to close
  }
}

// Called by pdfRenderQueue.js after every successful render (never after a
// failed one — a timeout/error shouldn't count toward recycling
// throughput). queueIsIdle is passed in by the caller, which already
// knows its own active/waiters state at the exact moment the slot is
// released — recycling only ever proceeds "only when no render is in
// flight," per the brief, so a busy queue just defers the check to
// whichever later completion actually drains it to zero.
function recordRenderCompleted(queueIsIdle) {
  renderCount++;
  if (lastKnownRssKb >= RSS_RECYCLE_THRESHOLD_KB || renderCount >= MAX_RENDERS_BEFORE_RECYCLE) {
    recycleScheduled = true;
  }
  if (recycleScheduled && queueIsIdle) {
    performRecycle().catch((err) => console.error('[pdfBrowser] recycle failed:', err));
  }
}

module.exports = {
  getBrowser,
  closeBrowser,
  closeWithTimeout,
  recordRenderCompleted,
  PAGE_CLOSE_TIMEOUT_MS,
};
