// Optional, flag-gated frame timing for TV performance work. It is inert in
// normal runs: the app only starts it when __NUVIO_PERF_SAMPLE__ is true.
const DEFAULT_SAMPLE_LIMIT = 600;

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

export function createFrameBudgetSampler({
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  sampleLimit = DEFAULT_SAMPLE_LIMIT
} = {}) {
  const limit = Math.max(1, Math.trunc(Number(sampleLimit) || DEFAULT_SAMPLE_LIMIT));
  const samples = [];
  let frameId = null;
  let lastAt = null;
  let startedAt = 0;

  const tick = (timestamp) => {
    const at = Number.isFinite(Number(timestamp)) ? Number(timestamp) : now();
    if (lastAt !== null) {
      samples.push(Math.max(0, at - lastAt));
      if (samples.length > limit) samples.shift();
    } else {
      startedAt = at;
    }
    lastAt = at;
    frameId = requestFrame(tick);
  };

  return {
    start() {
      if (frameId !== null) return false;
      samples.length = 0;
      lastAt = null;
      startedAt = now();
      frameId = requestFrame(tick);
      return true;
    },
    stop() {
      if (frameId === null) return false;
      cancelFrame(frameId);
      frameId = null;
      lastAt = null;
      return true;
    },
    reset() {
      samples.length = 0;
      lastAt = null;
      startedAt = now();
    },
    snapshot() {
      const sorted = [...samples].sort((left, right) => left - right);
      const total = sorted.reduce((sum, value) => sum + value, 0);
      return {
        frames: samples.length,
        windowMs: Math.round(total),
        p50: Number(percentile(sorted, 0.5).toFixed(1)),
        p95: Number(percentile(sorted, 0.95).toFixed(1)),
        max: Number((sorted[sorted.length - 1] || 0).toFixed(1)),
        over33ms: samples.filter((value) => value > 33).length,
        over50ms: samples.filter((value) => value > 50).length,
        startedAt: startedAt ? Math.round(startedAt) : 0
      };
    }
  };
}

let installed = null;

/**
 * Count elements that paint over almost the whole viewport. This mirrors the
 * fork's "screens per frame" measurement and is meant to be called on demand
 * from the console, never from the render loop.
 */
export function countFullscreenLayers({
  documentRef = globalThis.document,
  innerWidth = Number(globalThis.innerWidth || 0),
  innerHeight = Number(globalThis.innerHeight || 0),
  getStyle = (element) => globalThis.getComputedStyle?.(element)
} = {}) {
  const viewportArea = Number(innerWidth) * Number(innerHeight);
  if (!documentRef || !viewportArea) return 0;
  let count = 0;
  documentRef.querySelectorAll?.("body *").forEach((element) => {
    const style = getStyle(element);
    if (
      !style ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return;
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect || Number(rect.width) * Number(rect.height) < viewportArea * 0.9) return;
    count += 1;
  });
  return count;
}

/** Expose the sampler on window only when the performance flag is on. */
export function installFrameBudgetSampler() {
  const queryEnabled = /[?&]perf=1(?:&|$)/i.test(String(globalThis.location?.search || ""));
  if (installed || (globalThis.__NUVIO_PERF_SAMPLE__ !== true && !queryEnabled)) {
    return installed;
  }
  const sampler = createFrameBudgetSampler();
  installed = sampler;
  globalThis.__NUVIO_PERF__ = {
    start: () => sampler.start(),
    stop: () => sampler.stop(),
    reset: () => sampler.reset(),
    snapshot: () => sampler.snapshot(),
    screens: () => countFullscreenLayers()
  };
  sampler.start();
  return installed;
}

export function resetFrameBudgetSamplerForTests() {
  installed?.stop?.();
  installed = null;
  delete globalThis.__NUVIO_PERF__;
}
