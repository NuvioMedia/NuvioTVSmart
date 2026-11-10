import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";
import {
  getArtworkCacheLimit,
  getDeviceMemoryGb,
  isLowMemoryDevice,
  isModernTvProfile
} from "../../platform/tvPerformancePolicy.js";

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

// The native client bounds a compressed artwork body to 8 MiB; a huge addon
// original would otherwise decode into tens of megabytes of pixels inside a
// worker. The check runs before and after the download.
export function isArtworkTooLarge(bytes) {
  return Boolean(bytes) && Number(bytes.byteLength || 0) > 8388608;
}

/**
 * JPEG SOF dimensions straight from the header, before any decode. A 4000px
 * addon original would decode to tens of MiB even when the card paints at
 * 300px, so the worker uses these numbers to ask createImageBitmap for a
 * bounded source.
 */
export function jpegDimensions(bytes) {
  if (!bytes || bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * The one dimension to clamp for createImageBitmap, or null when the source is
 * already small enough. Supplying only one side keeps the source aspect ratio,
 * which the crop below depends on.
 */
export function artworkResizeTarget(width, height, maxDimension = 1280) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const max = Number(maxDimension) || 0;
  if (!(w > 0) || !(h > 0) || !(max > 0)) return null;
  if (w >= h && w > max) return { width: max };
  if (h > w && h > max) return { height: max };
  return null;
}

const WORKER_SOURCE = `
const sourceRect = ${computeSourceRect.toString()};
const isJpeg = ${isJpegHeader.toString()};
const isTooLarge = ${isArtworkTooLarge.toString()};
const jpegSize = ${jpegDimensions.toString()};
const resizeTarget = ${artworkResizeTarget.toString()};

self.onmessage = async (event) => {
  const { id, url, width, height, fit } = event.data || {};
  let full = null;
  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) {
      throw new Error("http " + response.status);
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 8388608) {
      throw new Error("too large");
    }
    // Read the bytes off the response rather than the blob: Blob.arrayBuffer
    // is newer than OffscreenCanvas, so some webOS builds have the canvas but
    // not the blob method.
    const bytes = await response.arrayBuffer();
    if (isTooLarge(bytes)) {
      throw new Error("too large");
    }
    const view = new Uint8Array(bytes);
    if (!isJpeg(view)) {
      // Could carry transparency or animation. Leave it to the <img> tag.
      throw new Error("not jpeg");
    }
    const dimensions = jpegSize(view);
    const resize = dimensions ? resizeTarget(dimensions.width, dimensions.height, 1280) : null;
    full = await createImageBitmap(
      new Blob([bytes]),
      resize ? { ...resize, resizeQuality: "low" } : undefined
    );
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
export function artworkWorkerCount(cores, deviceMemory) {
  // A full-size decode is held per job while the source is re-encoded, so the
  // native client gives a 1 GB set two network threads instead of four. One
  // worker keeps two jobs in flight, which is that ceiling.
  if (isLowMemoryDevice(deviceMemory)) {
    return 1;
  }
  const value = Number(cores) || 4;
  return Math.min(Math.max(value - 1, 1), 3);
}

function workerCount() {
  return artworkWorkerCount(globalThis.navigator?.hardwareConcurrency, getDeviceMemoryGb());
}

// Each entry holds a re-encoded JPEG of roughly 10-25KB, so even the larger
// cache stays far below the cost of a single oversized decode. Android scales
// its Coil memory cache by device RAM for the same reason. Modern TVs get a
// larger window; constrained generations keep the smaller one.
function cacheLimit() {
  return getArtworkCacheLimit(getTvRuntimePerformanceProfile(), getDeviceMemoryGb());
}

let pool = null;
let genericPool = null;
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
  // Constrained generations already bound Home artwork with the smaller cache
  // and the aggressive release window. On them the worker round-trip (fetch,
  // decode, re-encode, second decode in the renderer) costs more than the RAM
  // it saves, and the poster only appears once the worker answers: a 2021 Tizen
  // set loaded artwork instantly before this path existed.
  return isSupported() && isModernTvProfile(getTvRuntimePerformanceProfile());
}

// A worker that hangs would hold its slot forever and every later poster
// would stay blank, which is worse than the oversized decode this replaces.
const JOB_TIMEOUT_MS = 15000;
const WORKER_JOB_SLOTS = 2;

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
    failed: new Map(),
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
  // Each job spends most of its time waiting on the network, and the worker
  // handler is async, so two slots per worker overlap a download with the
  // other job's decode (about OkHttp's five requests per host on Android).
  for (let slot = 0; slot < WORKER_JOB_SLOTS; slot += 1) {
    state.idle.push(worker);
  }
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
    // Highest priority first, newest first within a priority: after a long
    // scroll the latest requests are the cards on screen, while the rows passed
    // on the way are still queued (they are not stale until evicted).
    let pick = 0;
    for (let index = 1; index < state.queue.length; index += 1) {
      if (state.queue[index].priority <= state.queue[pick].priority) {
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

// Artwork 404s are deliberately left out: the native client excludes art from
// its negative cache because a CDN 404 can be transient. Only answers that
// depend on the bytes themselves are permanent for the session.
const DETERMINISTIC_ARTWORK_FAILURE = /^(not jpeg|already small|too large)$/;
const ARTWORK_FAILURE_LIMIT = 512;

function rememberArtworkFailure(state, key, reason) {
  if (!DETERMINISTIC_ARTWORK_FAILURE.test(String(reason || ""))) {
    return;
  }
  if (state.failed.size >= ARTWORK_FAILURE_LIMIT) {
    const oldest = state.failed.keys().next().value;
    if (oldest !== undefined) state.failed.delete(oldest);
  }
  state.failed.set(key, true);
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

function getPoolFor(kind) {
  const current = kind === "generic" ? genericPool : pool;
  if (current === undefined) {
    return null;
  }
  if (current === null) {
    const created = createPool();
    if (!created) {
      if (kind === "generic") genericPool = undefined;
      else pool = undefined;
      return null;
    }
    if (kind === "generic") genericPool = created;
    else pool = created;
    return created;
  }
  return current;
}

function getPool() {
  return getPoolFor("home");
}

function getGenericPool() {
  return getPoolFor("generic");
}

function rescaleWithPool(state, url, { width, height, fit, priority = 2, isStale = null } = {}) {
  // Check the request before touching the pool, so artwork that can never be
  // rescaled does not spin up workers on its way to the fallback.
  if (!state || !url || !(width > 0) || !(height > 0) || !isRescalableArtworkFit(fit)) {
    return Promise.resolve(null);
  }
  // The fit belongs in the key: the same artwork in the same box is cropped
  // for one card type and stretched for another.
  const key = `${url}|${width}x${height}|${fit}`;
  // These answers cannot change for the same url and target: a non-JPEG source
  // stays non-JPEG and a source already smaller than the box stays smaller.
  // Retrying them on every scroll only spends a worker fetch to learn it again.
  if (state.failed.has(key)) {
    return Promise.resolve(null);
  }
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
    job.settle = (blob, reason) => {
      // A timeout and a late reply can both land, and settling twice would
      // leak a second object url for the same job.
      if (job.done) {
        return;
      }
      job.done = true;
      state.inflight.delete(key);
      if (!blob || state.disposed) {
        if (!blob && !state.disposed) {
          rememberArtworkFailure(state, key, reason);
        }
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

/**
 * Resolve a card-sized object url for `url`, or null when the original should
 * be used as-is. Never rejects: every failure path falls back to the original.
 */
function shouldQueueRescale(url, { width, height, fit } = {}) {
  return Boolean(url && width > 0 && height > 0 && isRescalableArtworkFit(fit));
}

export function rescaleHomeArtwork(url, options) {
  // Refuse before creating a pool: an unsupported fit must not spin up a
  // worker just to discover it cannot be drawn.
  if (!shouldQueueRescale(url, options)) return Promise.resolve(null);
  return rescaleWithPool(getPool(), url, options);
}

/** Same contract as rescaleHomeArtwork, with its own pool for non-Home screens. */
export function rescaleArtwork(url, options) {
  if (!shouldQueueRescale(url, options)) return Promise.resolve(null);
  return rescaleWithPool(getGenericPool(), url, options);
}

function releaseFromPool(state, objectUrl) {
  if (!state || !objectUrl || !String(objectUrl).startsWith("blob:")) {
    return;
  }
  for (const entry of state.cache.values()) {
    if (entry.objectUrl === objectUrl) {
      entry.uses = Math.max(0, entry.uses - 1);
      // Release is the point where the LRU can actually reclaim the slot; the
      // next artwork request would otherwise be the first call to trim again.
      trimCache(state);
      return;
    }
  }
}

/** Mark a rescaled url as no longer painted so its slot can be reclaimed. */
export function releaseHomeArtwork(objectUrl) {
  releaseFromPool(pool, objectUrl);
}

/** Mark a non-Home rescaled url as no longer painted. */
export function releaseArtwork(objectUrl) {
  releaseFromPool(genericPool, objectUrl);
}

function resetPool(state) {
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
  state.failed?.clear?.();
}

/**
 * Drop every Home worker and cached url. Used when the home screen unmounts.
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
  resetPool(state);
}

/** Drop the non-Home pool and its cached urls. */
export function resetArtworkRescaler() {
  const state = genericPool;
  genericPool = null;
  resetPool(state);
}
