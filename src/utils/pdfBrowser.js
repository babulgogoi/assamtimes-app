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
// shared system /tmp. WORKER_DIR is this worker's own root (named by this
// Node process's own PID — see the per-worker-safety note in the original
// Oct 2026 history); each individual LAUNCH gets its own fresh, never-
// reused subdirectory under it (worker-<pid>/run-<launchId>), not
// WORKER_DIR itself. That change (Oct 2026, second pass) replaced an
// earlier version that reused one fixed directory per worker across every
// relaunch — directly confirmed to collide under concurrency: a
// synthetic two-concurrent-launches-into-the-same-directory test threw
// "Opening in existing browser session" every time, matching the real
// production error ("The browser is already running for .../worker-N")
// seen 46 times in 12 minutes. A fresh directory per launch makes that
// entire collision class structurally impossible — there is never a
// shared resource for two launches to contend over.
const PROFILE_ROOT = path.join(__dirname, '..', '..', 'tmp', 'chrome-profiles');
const WORKER_DIR = path.join(PROFILE_ROOT, 'worker-' + process.pid);

// Recycle thresholds.
//
// MAX_RENDERS_BEFORE_RECYCLE: unchanged, ~200 renders.
//
// PSS_RECYCLE_THRESHOLD_KB: this is a genuinely different metric from the
// RSS-sum this file used to track, not just a retuned number. Summing
// VmRSS across a process tree double/triple-counts memory pages shared
// between those processes (Chrome's own shared library and renderer code
// pages, mapped into every child) — confirmed directly to be wildly
// wrong on this box: a live production burst showed lastTreeRssKb
// readings of 17-24GB on a 12GB-RAM, zero-swap box, which is physically
// impossible as an actual memory figure. PSS (proportional set size, read
// from /proc/<pid>/smaps_rollup) attributes shared pages proportionally
// instead of to everyone who maps them, giving the actual physical
// footprint. Measured directly against this exact Chromium build before
// picking a number: idle baseline ~130MB, plateauing around ~350-450MB
// after a burst of both sequential and 2-concurrent real-article renders
// (15 and 10 renders respectively, same box, same build). 1GB sits with
// comfortable (~2x) headroom above that observed plateau — tight enough
// to actually matter as a backstop, not so tight it thrashes the way an
// earlier RSS-based 1.5GB figure did before being recalibrated once
// (see git history on this file).
const MAX_RENDERS_BEFORE_RECYCLE = 200;
const PSS_RECYCLE_THRESHOLD_KB = 1024 * 1024;

// Hard time ceiling: forces a recycle after ~15 minutes regardless of
// whether the queue ever reports idle. Unlike the render-count/PSS
// triggers (which wait for an idle moment via recordRenderCompleted()),
// this calls performRecycle() directly the moment it fires — any render
// genuinely in flight against the retiring browser at that instant will
// surface as BrowserDisconnectedError -> a clean 503 (already correct,
// confirmed end-to-end in the Oct 2026 kill test), not a crash, so forcing
// it is an acceptable trade against a browser that could otherwise never
// get recycled at all under sustained, never-idle load.
const MAX_BROWSER_AGE_MS = 15 * 60 * 1000;

const PAGE_CLOSE_TIMEOUT_MS = 5000;
// How long retireBrowser() waits for the OS to confirm a SIGKILLed
// process group is actually gone before its run directory is deleted —
// a safety net, not expected to ever actually elapse (SIGKILL cannot be
// caught or delayed), in case the 'exit' event is somehow missed.
const KILL_CONFIRM_TIMEOUT_MS = 5000;

let browserLaunchPromise = null; // single-flight guard — see getBrowser()
let launchCounter = 0;
let currentRunDir = null;
let renderCount = 0;
let lastKnownPssKb = 0;
let recycleScheduled = false;
let recycleReason = null;
let ageCeilingTimer = null;

function readOwnPssKb(pid) {
  try {
    const smaps = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const m = smaps.match(/^Pss:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function readTreePssKb(pid) {
  try {
    const children = fs
      .readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let total = readOwnPssKb(pid);
    for (const childPid of children) {
      total += readTreePssKb(childPid);
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

// Removes run-<id> directories left behind by a previous process that
// never got a chance to clean up after itself (a hard Node crash, not
// just a Chrome crash — the normal Chrome-crash path now deletes its own
// run directory directly via retireBrowser(), see below; this is purely a
// safety net for the case where nothing ever got to run that code at
// all). Deliberately NEVER deletes by age alone — only removes a
// directory whose own Chrome SingletonLock points at a PID that is not
// actually running. Age-only deletion risked killing a directory still
// legitimately in use (e.g. a slow-starting browser, or — if `instances`
// is ever raised above 1 — another worker's live profile); liveness-
// checking the lock is the only signal that's actually safe to act on.
// Runs once at module load (startup), not continuously — the explicit
// delete-on-retire path is the primary mechanism now.
function purgeStaleProfileDirs() {
  let workerEntries;
  try {
    workerEntries = fs.readdirSync(PROFILE_ROOT);
  } catch {
    return; // doesn't exist yet on a fresh deploy — nothing to purge
  }

  for (const workerEntry of workerEntries) {
    const workerPath = path.join(PROFILE_ROOT, workerEntry);
    let runEntries;
    try {
      runEntries = fs.readdirSync(workerPath);
    } catch {
      continue; // not a directory (or already gone) — nothing to walk
    }

    let anyKept = false;
    for (const runEntry of runEntries) {
      const runPath = path.join(workerPath, runEntry);

      const lockPath = path.join(runPath, 'SingletonLock');
      let targetPid = null;
      try {
        const target = fs.readlinkSync(lockPath);
        const m = target.match(/(\d+)$/);
        targetPid = m ? Number(m[1]) : null;
      } catch {
        // No readable SingletonLock at all (Chrome never finished
        // starting in this dir, or something already partially cleaned
        // it) — treat as dead, since there's no live-process claim.
      }

      if (!targetPid || !isPidRunning(targetPid)) {
        fs.rmSync(runPath, { recursive: true, force: true });
      } else {
        anyKept = true;
      }
    }

    // An emptied-out worker directory (every run-* subdir purged) is just
    // a husk — clean it up too, but never our OWN worker's directory,
    // even if we haven't launched into it yet this startup.
    if (!anyKept && workerPath !== WORKER_DIR) {
      fs.rmSync(workerPath, { recursive: true, force: true });
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

  const pssInterval = pid
    ? setInterval(() => {
        const pss = readTreePssKb(pid);
        if (pss > 0) lastKnownPssKb = pss;
      }, 2000)
    : null;

  browser.on('targetcreated', (target) => {
    if (target.type() === 'page') openPages++;
  });
  browser.on('targetdestroyed', (target) => {
    if (target.type() === 'page') openPages = Math.max(0, openPages - 1);
  });

  browser.once('disconnected', () => {
    if (pssInterval) clearInterval(pssInterval);
    const uptimeMs = Date.now() - launchedAt;
    setImmediate(() => {
      console.error(
        '[pdfBrowser] disconnected pid=' + pid +
        ' exitCode=' + exitInfo.code +
        ' signalCode=' + exitInfo.signal +
        ' lastTreePssKb=' + lastKnownPssKb +
        ' openPages=' + openPages +
        ' uptimeMs=' + uptimeMs
      );
    });
  });
}

// Races a close operation against a timeout. If it hangs, SIGKILLs the
// browser's whole process GROUP (not just the main process) — confirmed
// directly that a process-group signal reaps every zygote/GPU/utility/
// renderer descendant in one shot, which a plain single-pid kill would
// leave behind. Used by pdfController.js for page.close() specifically —
// a page that won't close is treated as a sign the whole browser is
// wedged, not just that one tab.
async function closeWithTimeout(closeFn, timeoutMs, proc) {
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });
  await Promise.race([closeFn().catch(() => {}), timeout]);
  if (timedOut && proc && proc.pid != null && !proc.killed) {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return timedOut;
}

// Unconditionally SIGKILLs the browser's entire process group and waits
// for the OS to confirm the main process is actually gone. Graceful
// browser.close() is deliberately never attempted here: there is no
// state worth preserving (the whole run directory is deleted immediately
// after this returns regardless), and a graceful close that might hang
// was exactly the complexity this replaces. Confirmed directly that a
// single process-group signal reaps every descendant (zygotes, GPU,
// utility, renderers) — an 11-process tree from a real render went from
// fully alive to fully gone within 500ms of one `process.kill(-pid, ...)`
// call, with nothing left behind.
async function killBrowserGroup(browser) {
  const proc = browser.process();
  if (!proc || proc.pid == null) return;
  const pid = proc.pid;

  const alreadyExited = proc.exitCode !== null || proc.signalCode !== null;
  const exited = alreadyExited
    ? Promise.resolve()
    : new Promise((resolve) => {
        proc.once('exit', resolve);
        setTimeout(resolve, KILL_CONFIRM_TIMEOUT_MS); // safety net only
      });

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }

  await exited;
}

function nextRunDir() {
  launchCounter++;
  return path.join(WORKER_DIR, 'run-' + launchCounter);
}

function scheduleAgeCeiling() {
  if (ageCeilingTimer) clearTimeout(ageCeilingTimer);
  ageCeilingTimer = setTimeout(() => {
    recycleScheduled = true;
    recycleReason = 'recycle-time';
    performRecycle().catch((err) => console.error('[pdfBrowser] age-ceiling recycle failed:', err));
  }, MAX_BROWSER_AGE_MS);
}

// Kills the process group, deletes its run directory, and clears the
// age-ceiling timer — the one common endpoint every path that ends a
// browser's life goes through, so "no leftover directory" and "no stale
// timer firing against a replacement browser later" both hold by
// construction rather than needing to be re-implemented at each call site.
//
// Guarded against being run twice on the same browser — confirmed live
// that it otherwise can be: two concurrent getBrowser() callers can both
// await the same already-disconnected browser, both see isConnected()
// false, and both reach this function for the identical browser object.
// Harmless in terms of actual cleanup (killBrowserGroup/fs.rmSync are
// idempotent — "exactly one relaunch" still held even before this guard,
// confirmed via the 20-relaunch test), but it duplicated the
// "reason=" log line, which is the one thing here that's actually
// supposed to carry diagnostic meaning.
const retiredBrowsers = new WeakSet();
async function retireBrowser(browser, reason) {
  if (retiredBrowsers.has(browser)) return;
  retiredBrowsers.add(browser);

  if (ageCeilingTimer) {
    clearTimeout(ageCeilingTimer);
    ageCeilingTimer = null;
  }
  const dir = currentRunDir;
  const proc = browser.process();
  console.error('[pdfBrowser] closing pid=' + (proc ? proc.pid : '?') + ' reason=' + reason);
  await killBrowserGroup(browser);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (currentRunDir === dir) currentRunDir = null;
}

async function launchBrowser() {
  const runDir = nextRunDir();
  fs.mkdirSync(runDir, { recursive: true });

  const launchedAt = Date.now();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      userDataDir: runDir,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        // Profile directory bloat was dominated by Chrome's own on-disk
        // cache (Default/Cache measured at 738MB of a 772MB profile on
        // the live box) — these two effectively disable it. Harmless for
        // this app's actual usage (each run directory is single-use and
        // deleted immediately after, see retireBrowser()), and keeps disk
        // I/O down while a run is still active.
        '--disk-cache-size=1', '--media-cache-size=1',
      ],
      headless: true,
    });
  } catch (err) {
    fs.rmSync(runDir, { recursive: true, force: true });
    throw err;
  }

  currentRunDir = runDir;
  attachDiagnostics(browser, launchedAt);
  renderCount = 0;
  lastKnownPssKb = 0;
  scheduleAgeCeiling();
  return browser;
}

// Starts a launch and attaches a side-effect-only cleanup to it, so a
// FAILED launch can never get stuck replaying the same rejected promise
// forever (see git history on this file for the original, directly-
// reproduced bug this fixes). The `browserLaunchPromise === promise`
// guard matters: if something else (another concurrent relaunch, a
// recycle) has already replaced the reference with a NEWER attempt by
// the time this one's rejection is observed, this must not clear that
// newer one out from under it.
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
    // Reaching here means nobody has deliberately retired this browser
    // yet (every deliberate path — recycle/age-ceiling/shutdown — clears
    // browserLaunchPromise itself before this branch could ever see the
    // old browser again) — so an organic crash is the only explanation.
    await retireBrowser(browser, 'crash');
  }

  if (!browserLaunchPromise) {
    browserLaunchPromise = startLaunch();
  }
  return browserLaunchPromise;
}

async function closeBrowser() {
  if (!browserLaunchPromise) return;
  const toClose = browserLaunchPromise;
  browserLaunchPromise = null;
  try {
    const browser = await toClose;
    await retireBrowser(browser, 'idle');
  } catch {
    // launch had already failed — nothing to close
  }
}

async function performRecycle() {
  const reason = recycleReason || 'recycle-count';
  recycleScheduled = false;
  recycleReason = null;
  renderCount = 0;
  if (!browserLaunchPromise) return;
  const toClose = browserLaunchPromise;
  browserLaunchPromise = null; // next getBrowser() call relaunches lazily
  try {
    const browser = await toClose;
    await retireBrowser(browser, reason);
  } catch {
    // already gone — nothing to close
  }
}

// Called by pdfRenderQueue.js after every successful render (never after a
// failed one — a timeout/error shouldn't count toward recycling
// throughput). queueIsIdle is passed in by the caller, which already
// knows its own active/waiters state at the exact moment the slot is
// released — the render-count/PSS triggers only ever proceed "only when
// no render is in flight," per the brief, so a busy queue just defers the
// check to whichever later completion actually drains it to zero. The
// hard age ceiling (scheduleAgeCeiling(), above) is the one trigger that
// deliberately does NOT wait for this — it forces a recycle on its own
// timer regardless of idleness.
function recordRenderCompleted(queueIsIdle) {
  renderCount++;
  if (!recycleScheduled) {
    if (renderCount >= MAX_RENDERS_BEFORE_RECYCLE) {
      recycleScheduled = true;
      recycleReason = 'recycle-count';
    } else if (lastKnownPssKb >= PSS_RECYCLE_THRESHOLD_KB) {
      recycleScheduled = true;
      recycleReason = 'recycle-rss';
    }
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
