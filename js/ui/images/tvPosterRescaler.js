import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";

// Android decodes artwork at the size Compose is going to draw it: Coil is
// configured with precision(INEXACT) and hands BitmapFactory the target bounds,
// so a 800x450 addon thumbnail in a 220x338 card costs 220x338 of bitmap. The
// browser has no equivalent hook - <img> always decodes at natural size - so
// the same home screen holds several times more pixels than it paints. On a
// 1.5GB LG webOS panel that difference is the gap between scrolling the home
// screen and the renderer being killed.
//
// createImageBitmap plus OffscreenCanvas gives us the missing hook. Both exist
// in a worker on webOS and Tizen, so the fetch, the decode and the re-encode
// all stay off the main thread and only a small blob comes back.
//
// Rescaling must never change what the card looks like, so it is confined to
// the cases where that can be guaranteed: the two object-fit values the home
// cards actually use, and JPEG sources, which cannot carry transparency or
// animation. Everything else loads exactly as it does today.

/** The object-fit values this module can reproduce exactly. */
export function isRescalableArtworkFit(fit) {
  return fit === "cover" || fit === "fill";
}

/**
 * Reproduce object-fit as a source rectangle.
 *
 * cover crops the overflowing axis and draws the rest edge to edge, which is
 * what makes the decode exactly the painted size; scaling to fit instead would
 * leave the overflowing axis in memory. fill stretches the whole source into
 * the box, so the source rectangle is the whole image.
 *
 * Exported so the geometry can be tested directly; the worker is built from
 * this same function so the two can never drift apart.
 */
export function computeSourceRect(nw, nh, bw, bh, fit) {
  if (fit !== "cover") {
    return { sx: 0, sy: 0, sw: nw, sh: nh };
  }
  const sourceAspect = nw / nh;
  const boxAspect = bw / bh;
  if (sourceAspect > boxAspect) {
    const sw = Math.max(1, Math.round(nh * boxAspect));
    return { sx: Math.round((nw - sw) / 2), sy: 0, sw, sh: nh };
  }
  const sh = Math.max(1, Math.round(nw / boxAspect));
  return { sx: 0, sy: Math.round((nh - sh) / 2), sw: nw, sh };
}

/**
 * JPEG is the only format that is safe to re-encode blind: it has no alpha
 * channel to flatten and no frames to drop. GIF, APNG and animated WebP would
 * lose their animation to createImageBitmap, which keeps only the first frame,
 * and PNG or WebP may carry transparency that a JPEG would paint black.
 * Android keeps animated decoding, so those sources load untouched here too.
 *
 * Sniffing the bytes rather than trusting Content-Type keeps the check honest
 * when an addon CDN mislabels or omits the header.
 */
export function isJpegHeader(bytes) {
  return (
    Boolean(bytes) &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

const WORKER_SOURCE = `
const sourceRect = ${computeSourceRect.toString()};
const isJpeg = ${isJpegHeader.toString()};

self.onmessage = async (event) => {
  const { id, url, width, height, fit } = event.data || {};
  let full = null;
  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) {
      throw new Error("http " + response.status);
    }
    // Read the bytes off the response rather than the blob: Blob.arrayBuffer
    // is newer than OffscreenCanvas, so some webOS builds have the canvas but
    // not the blob method.
    const bytes = await response.arrayBuffer();
    if (!isJpeg(new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength)))) {
      // Could carry transparency or animation. Leave it to the <img> tag.
      throw new Error("not jpeg");
    }
    full = await createImageBitmap(new Blob([bytes]));
    if (full.width <= width && full.height <= height) {
      // Already no larger than the card. Re-encoding would only lose quality.
      throw new Error("already small");
    }
    const crop = sourceRect(full.width, full.height, width, height, fit);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d", { alpha: false }).drawImage(full, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    full.close();
    full = null;
    self.postMessage({ id, ok: true, blob: out });
  } catch (error) {
    if (full) {
      full.close();
    }
    self.postMessage({ id, ok: false, reason: String((error && error.message) || error) });
  }
};
`;

// Android caps parallel bitmap decoding at four (bitmapFactoryMaxParallelism),
// but it is decoding natively while this has to re-encode in JavaScript. An LG
// k8lp reports four cores, and filling all four starved the renderer that has
// to paint the rows badly enough to stall it for seconds, so leave one free.
function workerCount() {
  const cores = Number(globalThis.navigator?.hardwareConcurrency) || 4;
  return Math.min(Math.max(cores - 1, 1), 3);
}

// Each entry holds a re-encoded JPEG of roughly 10-25KB, so even the larger
// cache stays far below the cost of a single oversized decode. Android scales
// its Coil memory cache by device RAM for the same reason.
function cacheLimit() {
  const memory = Number(globalThis.navigator?.deviceMemory) || 0;
  return memory > 0 && memory <= 1 ? 200 : 320;
}

let pool = null;
let supported = null;

function isSupported() {
  if (supported === null) {
    supported = Boolean(
      globalThis.Worker &&
      globalThis.OffscreenCanvas &&
      globalThis.createImageBitmap &&
      globalThis.URL?.createObjectURL &&
      typeof Blob !== "undefined"
    );
  }
  return supported;
}

/**
 * Device pixels per CSS pixel for the panel actually being painted.
 *
 * webOS reports devicePixelRatio 2 on 1080p sets whose CSS viewport is already
 * 1920 wide, so the reported value would quadruple every decode for no visible
 * gain. Comparing the screen to the viewport gives 1 there and still gives 2 on
 * a 4K panel that lays the app out at 1920.
 */
export function getHomeArtworkPixelRatio() {
  const viewportWidth = Number(globalThis.innerWidth) || 0;
  const screenWidth = Number(globalThis.screen?.width) || 0;
  const measured = viewportWidth > 0 && screenWidth > 0 ? screenWidth / viewportWidth : 1;
  const reported = Number(globalThis.devicePixelRatio) || 1;
  return Math.min(Math.max(Math.min(measured, reported), 1), 2);
}

/**
 * The object-fit the stylesheet actually resolved for this element. Home poster
 * rules differ by card type - collection cards stretch, catalog cards crop - so
 * reading the computed value is the only way to redraw what the browser would
 * have drawn. An unreadable value rescales nothing.
 */
export function getHomeArtworkObjectFit(image) {
  try {
    return String(globalThis.getComputedStyle(image)?.objectFit || "").trim();
  } catch (_) {
    return "";
  }
}

export function shouldRescaleHomeArtwork() {
  return isSupported() && Boolean(getTvRuntimePerformanceProfile().isTvRuntime);
}

// A worker that hangs would hold its slot forever and every later poster
// would stay blank, which is worse than the oversized decode this replaces.
const JOB_TIMEOUT_MS = 15000;

function createPool() {
  const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const state = {
    workerUrl,
    workers: [],
    idle: [],
    queue: [],
    jobs: new Map(),
    nextId: 1,
    cache: new Map(),
    inflight: new Map(),
    disposed: false
  };
  const count = workerCount();
  for (let index = 0; index < count; index += 1) {
    if (!spawnWorker(state)) {
      break;
    }
  }
  if (!state.workers.length) {
    URL.revokeObjectURL(workerUrl);
    return null;
  }
  return state;
}

function spawnWorker(state) {
  let worker = null;
  try {
    worker = new Worker(state.workerUrl);
  } catch (_) {
    return false;
  }
  worker.onmessage = (event) => {
    const { id, ok, blob, reason } = event.data || {};
    const job = state.jobs.get(id);
    if (job) {
      state.jobs.delete(id);
      clearTimeout(job.timer);
      job.settle(ok ? blob : null, reason);
    }
    state.idle.push(worker);
    pump(state);
  };
  worker.onerror = () => retireWorker(state, worker, "worker error");
  state.workers.push(worker);
  state.idle.push(worker);
  return true;
}

/**
 * Drop a worker that errored or stopped answering, hand back whatever it was
 * holding, and put a fresh one in its place.
 */
function retireWorker(state, worker, reason) {
  if (state.disposed) {
    return;
  }
  state.jobs.forEach((job, id) => {
    if (job.worker === worker) {
      state.jobs.delete(id);
      clearTimeout(job.timer);
      job.settle(null, reason);
    }
  });
  state.workers = state.workers.filter((candidate) => candidate !== worker);
  state.idle = state.idle.filter((candidate) => candidate !== worker);
  try {
    worker.terminate();
  } catch (_) {}
  if (state.workers.length < workerCount()) {
    spawnWorker(state);
  }
  if (!state.workers.length) {
    // Nothing can run any more, so release the queue and let every caller
    // fall back to loading the original url.
    state.queue.splice(0).forEach((job) => job.settle(null, "no workers"));
  }
  pump(state);
}

function pump(state) {
  while (!state.disposed && state.idle.length && state.queue.length) {
    // Highest priority first, oldest first within a priority, so the focused
    // row resolves before the rows the user has not reached yet.
    let pick = 0;
    for (let index = 1; index < state.queue.length; index += 1) {
      if (state.queue[index].priority < state.queue[pick].priority) {
        pick = index;
      }
    }
    const job = state.queue.splice(pick, 1)[0];
    if (job.isStale?.()) {
      // The row scrolled out of reach before a worker came free. Running it
      // now would only hold up the artwork the viewer is actually looking at.
      job.settle(null, "stale");
      continue;
    }
    const worker = state.idle.pop();
    job.worker = worker;
    job.timer = setTimeout(() => retireWorker(state, worker, "timeout"), JOB_TIMEOUT_MS);
    state.jobs.set(job.id, job);
    worker.postMessage({
      id: job.id,
      url: job.url,
      width: job.width,
      height: job.height,
      fit: job.fit
    });
  }
}

function trimCache(state) {
  const limit = cacheLimit();
  if (state.cache.size <= limit) {
    return;
  }
  for (const [key, entry] of state.cache) {
    if (state.cache.size <= limit) {
      return;
    }
    // Never revoke a url an element is still painting from; the browser would
    // drop the picture on the next layout.
    if (entry.uses > 0) {
      continue;
    }
    URL.revokeObjectURL(entry.objectUrl);
    state.cache.delete(key);
  }
}

function getPool() {
  if (pool === undefined) {
    return null;
  }
  if (pool === null) {
    pool = createPool();
    if (!pool) {
      pool = undefined;
      return null;
    }
  }
  return pool;
}

/**
 * Resolve a card-sized object url for `url`, or null when the original should
 * be used as-is. Never rejects: every failure path falls back to the original.
 */
export function rescaleHomeArtwork(url, { width, height, fit, priority = 2, isStale = null } = {}) {
  // Check the request before touching the pool, so artwork that can never be
  // rescaled does not spin up workers on its way to the fallback.
  if (!url || !(width > 0) || !(height > 0) || !isRescalableArtworkFit(fit)) {
    return Promise.resolve(null);
  }
  const state = getPool();
  if (!state) {
    return Promise.resolve(null);
  }
  // The fit belongs in the key: the same artwork in the same box is cropped
  // for one card type and stretched for another.
  const key = `${url}|${width}x${height}|${fit}`;
  const cached = state.cache.get(key);
  if (cached) {
    cached.uses += 1;
    // Refresh LRU position.
    state.cache.delete(key);
    state.cache.set(key, cached);
    return Promise.resolve(cached.objectUrl);
  }
  const pendingJob = state.inflight.get(key);
  if (pendingJob) {
    pendingJob.priority = Math.min(pendingJob.priority, priority);
    // A second card wanting the same artwork means the queued job is no longer
    // stale just because the first card went away.
    pendingJob.isStale = null;
    // Every consumer sharing this promise owns a reference to the url it will
    // resolve. Counting only the first would let one release drop the count to
    // zero while another card is still painting it, and trimCache would then
    // revoke a url that is on screen.
    pendingJob.waiters += 1;
    return pendingJob.promise;
  }
  const job = {
    id: state.nextId++,
    url,
    width,
    height,
    fit,
    priority,
    isStale,
    worker: null,
    waiters: 1
  };
  job.promise = new Promise((resolve) => {
    job.settle = (blob) => {
      // A timeout and a late reply can both land, and settling twice would
      // leak a second object url for the same job.
      if (job.done) {
        return;
      }
      job.done = true;
      state.inflight.delete(key);
      if (!blob || state.disposed) {
        resolve(null);
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const entry = { objectUrl, uses: job.waiters };
      state.cache.set(key, entry);
      trimCache(state);
      resolve(objectUrl);
    };
  });
  state.inflight.set(key, job);
  state.queue.push(job);
  pump(state);
  return job.promise;
}

/** Mark a rescaled url as no longer painted so its slot can be reclaimed. */
export function releaseHomeArtwork(objectUrl) {
  const state = pool;
  if (!state || !objectUrl || !String(objectUrl).startsWith("blob:")) {
    return;
  }
  for (const entry of state.cache.values()) {
    if (entry.objectUrl === objectUrl) {
      entry.uses = Math.max(0, entry.uses - 1);
      return;
    }
  }
}

/**
 * Drop every worker and cached url. Used when the home screen unmounts.
 *
 * Callers are waiting on promises that only a worker reply can settle, so
 * tearing the workers down has to settle them too, or the home screen leaves
 * behind a promise per queued poster that can never resolve. They settle to
 * null, which is the same answer a failed rescale gives, so each caller falls
 * back to the original url instead of acting on artwork from a dead pool.
 *
 * The caller is responsible for taking rescaled urls off any element that is
 * still in the document before calling this; the urls are revoked here.
 */
export function resetHomeArtworkRescaler() {
  const state = pool;
  pool = null;
  if (!state) {
    return;
  }
  state.disposed = true;
  state.jobs.forEach((job) => {
    clearTimeout(job.timer);
    job.settle(null, "reset");
  });
  state.queue.splice(0).forEach((job) => job.settle(null, "reset"));
  state.inflight.forEach((job) => job.settle(null, "reset"));
  state.workers.forEach((worker) => {
    try {
      worker.terminate();
    } catch (_) {}
  });
  state.cache.forEach((entry) => URL.revokeObjectURL(entry.objectUrl));
  URL.revokeObjectURL(state.workerUrl);
  state.cache.clear();
  state.jobs.clear();
  state.inflight.clear();
  state.workers.length = 0;
  state.idle.length = 0;
  state.queue.length = 0;
}
