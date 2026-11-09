// Negative cache for TMDB metadata, ported from the native legacy client
// (negcache.c). A 404/400/410 on api.themoviedb.org is remembered for 24h so
// reopening a title does not ask again for an endpoint that is known empty.
// Connection failures back the host off (30s doubling to 10 minutes); the
// first real response clears it. Only the TMDB API host is eligible, and only
// a hash of the URL with api_key removed is stored, never the key or the URL.

const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const HOST_BACKOFF_BASE_MS = 30 * 1000;
const HOST_BACKOFF_MAX_MS = 10 * 60 * 1000;
const STORAGE_KEY = "nuvio_tmdb_negative_v1";
const MAX_ENTRIES = 200;
const SAVE_DEBOUNCE_MS = 1000;
const ELIGIBLE_HOST = "api.themoviedb.org";
const NEGATIVE_STATUSES = new Set([400, 404, 410]);

let loaded = false;
let entries = new Map();
let hostFailures = new Map();
let saveTimer = null;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

function stableHash(value) {
  const text = String(value || "");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Path + sorted params of an eligible request, with the API key removed. */
function requestKey(url) {
  try {
    const parsed = new URL(String(url || ""), "https://api.themoviedb.org");
    if (parsed.hostname !== ELIGIBLE_HOST) return "";
    const params = [];
    parsed.searchParams.forEach((value, name) => {
      if (name !== "api_key" && name !== "apikey") params.push([name, value]);
    });
    params.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    const query = params.map(([name, value]) => `${name}=${value}`).join("&");
    return `${parsed.pathname}?${query}`;
  } catch (_) {
    return "";
  }
}

function ensureLoaded(now) {
  if (loaded) return;
  loaded = true;
  const store = storage();
  if (!store) return;
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || "{}");
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([key, expiresAt]) => {
        if (Number(expiresAt) > now) entries.set(key, Number(expiresAt));
      });
    }
  } catch (_) {}
}

function prune(now) {
  entries.forEach((expiresAt, key) => {
    if (expiresAt <= now) entries.delete(key);
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function flush() {
  const store = storage();
  if (!store) return;
  try {
    const now = Date.now();
    prune(now);
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {}
}

function scheduleSave() {
  if (saveTimer || typeof setTimeout !== "function") return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, SAVE_DEBOUNCE_MS);
}

/** True when this exact request is known to answer 400/404/410. */
export function isTmdbRequestBlocked(url, now = Date.now()) {
  const request = requestKey(url);
  if (!request) return false;
  ensureLoaded(now);
  const key = stableHash(request);
  const expiresAt = entries.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    entries.delete(key);
    return false;
  }
  return true;
}

/** True while the TMDB host is backing off after connection failures. */
export function isTmdbHostBackedOff(url, now = Date.now()) {
  if (!requestKey(url)) return false;
  const state = hostFailures.get(ELIGIBLE_HOST);
  return Boolean(state && state.until > now);
}

/** Record what the request did: block an empty endpoint, back off a dead host. */
export function noteTmdbRequestResult(
  url,
  { status = 0, networkError = false, aborted = false } = {},
  now = Date.now()
) {
  if (aborted) return;
  const request = requestKey(url);
  if (!request) return;
  ensureLoaded(now);
  const key = stableHash(request);
  const numericStatus = Number(status) || 0;

  if (NEGATIVE_STATUSES.has(numericStatus)) {
    // A real response proves the host is reachable, even when it is empty.
    hostFailures.delete(ELIGIBLE_HOST);
    if (!entries.has(key)) {
      entries.set(key, now + NEGATIVE_TTL_MS);
      prune(now);
      scheduleSave();
    }
  } else if (numericStatus > 0) {
    // Any real response proves the host is reachable, including a 5xx.
    hostFailures.delete(ELIGIBLE_HOST);
    if (entries.delete(key)) {
      scheduleSave();
    }
  } else if (networkError) {
    const state = hostFailures.get(ELIGIBLE_HOST) || { count: 0, until: 0 };
    state.count += 1;
    const backoff = Math.min(HOST_BACKOFF_MAX_MS, HOST_BACKOFF_BASE_MS * 2 ** (state.count - 1));
    state.until = now + backoff;
    hostFailures.set(ELIGIBLE_HOST, state);
  }
}

/** Test hook: write the pending negative entries to storage now. */
export function flushTmdbNegativeCacheForTests() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flush();
}

/** Test hook: forget everything held in memory (storage is left untouched). */
export function resetTmdbNegativeCacheForTests() {
  entries = new Map();
  hostFailures = new Map();
  loaded = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
