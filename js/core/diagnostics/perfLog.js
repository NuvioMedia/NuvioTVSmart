import { recordDebugEvent } from "./consoleDebugBuffer.js";

// Perf logging is opt-in via globals set before boot (or poked in from an
// attached inspector — the flags are read on every call, not cached, so you can
// flip them on a running app without a reload):
//
//   globalThis.__NUVIO_DEBUG_PERF__        = true;  // every area
//   globalThis.__NUVIO_DEBUG_HOME_PERF__   = true;  // one area
//   globalThis.__NUVIO_DEBUG_STREAM_PERF__ = true;
//
// Area flags follow the pre-existing `__NUVIO_DEBUG_<AREA>_PERF__` convention.

const ROUTER_AREA = "router";
const HOME_AREA = "home";

function readFlag(name) {
  try {
    return Boolean(globalThis[name]);
  } catch (_) {
    return false;
  }
}

export function isPerfEnabled(area) {
  if (readFlag("__NUVIO_DEBUG_PERF__")) {
    return true;
  }
  const normalized = String(area || "").toUpperCase();
  if (!normalized) {
    return false;
  }
  if (readFlag(`__NUVIO_DEBUG_${normalized}_PERF__`)) {
    return true;
  }
  // Router timings were historically enabled by the home flag too; keep that.
  return area === ROUTER_AREA && readFlag(`__NUVIO_DEBUG_${HOME_AREA.toUpperCase()}_PERF__`);
}

export function perfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function logPerf(area, stage, data = {}) {
  if (!isPerfEnabled(area)) {
    return;
  }
  const label = `[${area}-perf] ${stage}`;
  try {
    console.info(label, data);
  } catch (_) {}
  // console.info is not intercepted by the debug buffer (that would flood it),
  // so perf lines are pushed in explicitly. They are flattened to one line each
  // because the on-device console has very little vertical room.
  recordDebugEvent("perf", [`${label} ${formatPerfData(data)}`]);
  reportRedundantWork(area, stage, data);
}

// Repeating the same stage with an identical payload in quick succession means
// the same output was produced twice - the triple home render and the double
// stream render both looked exactly like this. Surfacing it automatically means
// the next regression of this shape reports itself instead of waiting to be
// measured by hand. Detection only; it never suppresses the work.
const REDUNDANT_WINDOW_MS = 2500;
const recentWork = new Map();

function reportRedundantWork(area, stage, data) {
  const key = `${area}:${stage}`;
  // `ms` is the measurement itself and always differs, so it cannot be part of
  // the identity of the work.
  const { ms: _ms, ...identity } = data || {};
  const signature = formatPerfData(identity);
  const now = perfNow();
  const previous = recentWork.get(key);
  if (previous && previous.signature === signature && now - previous.at <= REDUNDANT_WINDOW_MS) {
    const repeats = previous.repeats + 1;
    recentWork.set(key, { signature, at: now, repeats, firstAt: previous.firstAt });
    try {
      console.warn(
        `[perf-redundant] ${area} ${stage} ran ${repeats + 1}x with identical state ` +
          `within ${Math.round(now - previous.firstAt)}ms` +
          (signature ? ` (${signature})` : "")
      );
    } catch (_) {}
    return;
  }
  recentWork.set(key, { signature, at: now, repeats: 0, firstAt: now });
}

function formatPerfData(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  return Object.keys(data)
    .map((key) => `${key}=${formatPerfValue(data[key])}`)
    .join(" ");
}

function formatPerfValue(value) {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return "[object]";
    }
  }
  return String(value);
}

/**
 * Starts a timing span. Always returns a callable, so call sites stay
 * branch-free; when the area is disabled the returned function does nothing.
 * The end function reports elapsed milliseconds under `ms`.
 */
export function startPerfSpan(area, stage) {
  if (!isPerfEnabled(area)) {
    return () => 0;
  }
  const startedAt = perfNow();
  let ended = false;
  return (data = {}) => {
    const ms = Number((perfNow() - startedAt).toFixed(2));
    if (ended) {
      return ms;
    }
    ended = true;
    logPerf(area, stage, { ms, ...data });
    return ms;
  };
}

/** Convenience wrapper binding every helper to a single area. */
export function createPerfLogger(area) {
  return {
    enabled: () => isPerfEnabled(area),
    now: perfNow,
    log: (stage, data) => logPerf(area, stage, data),
    span: (stage) => startPerfSpan(area, stage)
  };
}
