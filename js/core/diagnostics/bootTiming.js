// Startup timing marks. Each boot stage, the first routed screen and the
// first Home paint record one `performance.mark` plus an in-memory entry so
// the Console debug screen (and the Web Inspector on a TV) can show how long
// a cold start spends in script evaluation, language loading and routing.
// Pure diagnostics: nothing here changes application behaviour.

const MARK_PREFIX = "nuvio:boot:";
const marks = [];
let firstHomePaintMarked = false;
const firstHomePaintListeners = new Set();

function nowMs() {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === "function") {
    return perf.now();
  }
  return Date.now();
}

export function markBootTiming(name) {
  const label = String(name || "").trim();
  if (!label) {
    return;
  }
  const at = nowMs();
  marks.push({ name: label, at });
  try {
    globalThis.performance?.mark?.(`${MARK_PREFIX}${label}`);
  } catch (_) {
    // Older TV engines may reject mark names; the in-memory list is enough.
  }
}

export function markFirstHomePaint() {
  if (firstHomePaintMarked) {
    return;
  }
  firstHomePaintMarked = true;
  markBootTiming("home-first-paint");
  const listeners = Array.from(firstHomePaintListeners);
  firstHomePaintListeners.clear();
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn("First Home paint listener failed", error);
    }
  }
}

export function hasMarkedFirstHomePaint() {
  return firstHomePaintMarked;
}

// Startup work that is not needed for the first Home paint subscribes here
// (see js/runtime/startupScheduler.js). A listener added after the paint
// runs immediately.
export function onFirstHomePaint(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  if (firstHomePaintMarked) {
    listener();
    return () => {};
  }
  firstHomePaintListeners.add(listener);
  return () => {
    firstHomePaintListeners.delete(listener);
  };
}

// boot-guard.js records when it started, before core-js and the app bundle
// were fetched and evaluated. The gap to the first app mark is the script
// parse/compile cost of the bundle on this TV.
export function getBootGuardStartedAt() {
  const value = Number(globalThis.NuvioBootGuard?.startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function getBootTimings() {
  const guardStartedAt = getBootGuardStartedAt();
  const entries = marks.map((mark) => ({ name: mark.name, at: Math.round(mark.at) }));
  if (guardStartedAt !== null) {
    entries.unshift({ name: "boot-guard", at: Math.round(guardStartedAt) });
  }
  return entries;
}

export function formatBootTimingSummary() {
  const entries = getBootTimings();
  if (!entries.length) {
    return "";
  }
  return entries.map((entry) => `${entry.name} ${entry.at}ms`).join(" · ");
}

export function resetBootTimingsForTests() {
  marks.length = 0;
  firstHomePaintMarked = false;
  firstHomePaintListeners.clear();
}
