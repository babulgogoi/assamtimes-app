// Bounds how many PDF renders (each a real headless-Chrome page.goto —
// the single most CPU/memory-expensive thing this app does) run at once,
// and collapses concurrent requests for the same slug into one shared
// render. Built after a 28-day log investigation found ~1,090 Puppeteer
// navigation timeouts and ~150 leaked /tmp Chrome profile dirs, traced to
// unbounded concurrency: bot/crawler traffic was observed opening ~28
// renderer processes in 26 seconds with no cap at all, which is what
// eventually crashes the single shared browser instance (see
// pdfBrowser.js's getBrowser()).
//
// Never lets a request wait unbounded: once MAX_CONCURRENT renders are
// running, up to MAX_QUEUE more may wait; beyond that, or past
// WAIT_TIMEOUT_MS while waiting, the caller gets a rejected promise
// (QueueFullError/QueueTimeoutError) instead of hanging.
const MAX_CONCURRENT = 2;
const MAX_QUEUE = 10;
const WAIT_TIMEOUT_MS = 20000;

class QueueFullError extends Error {}
class QueueTimeoutError extends Error {}

let active = 0;
const waiters = [];

function acquire() {
  return new Promise((resolve, reject) => {
    if (active < MAX_CONCURRENT) {
      active++;
      resolve(release);
      return;
    }
    if (waiters.length >= MAX_QUEUE) {
      reject(new QueueFullError('PDF render queue is full'));
      return;
    }
    const entry = { resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const idx = waiters.indexOf(entry);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(new QueueTimeoutError('Timed out waiting for a PDF render slot'));
    }, WAIT_TIMEOUT_MS);
    waiters.push(entry);
  });
}

function release() {
  active--;
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    active++;
    next.resolve(release);
  }
}

// slug -> in-flight Promise<Buffer>. A burst of concurrent requests for the
// same slug (the common bot-traffic case: many simultaneous hits on one
// article's /pdf link) awaits this one shared promise and consumes only a
// single concurrency/queue slot, rather than one each.
const inFlight = new Map();

async function renderOnce(slug, renderFn) {
  if (inFlight.has(slug)) {
    return inFlight.get(slug);
  }

  const promise = (async () => {
    const releaseSlot = await acquire(); // may throw QueueFullError/QueueTimeoutError
    try {
      return await renderFn();
    } finally {
      releaseSlot();
    }
  })();

  inFlight.set(slug, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(slug);
  }
}

module.exports = { renderOnce, QueueFullError, QueueTimeoutError };
