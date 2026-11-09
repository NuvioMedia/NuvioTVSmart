// Negative cache for TMDB metadata, ported from the native legacy client
// (negcache.c). A 404/400/410 on api.themoviedb.org is remembered so reopening
// a title does not ask again for an endpoint that is known empty. The first
// miss blocks for 1h only; if the same request fails again after that the
// window doubles up to 24h. A transient 404 therefore costs an hour, while a
// persistently missing endpoint still stops being requested. Connection
// failures back the host off (30s doubling to 10 minutes); the first real
// response clears it. Only the TMDB API host is eligible, and only a hash of
// the URL with api_key removed is stored, never the key or the URL.

const NEGATIVE_TTL_BASE_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MAX_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_MAX_STRIKES = 6;
const NEGATIVE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
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
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === "number") {
          // Older shape: a bare expiry. Keep it with a single strike.
          if (value > now) entries.set(key, { expiresAt: value, strikes: 1, lastAt: now });
          return;
        }
        if (!value || typeof value !== "object") return;
        const lastAt = Number(value.lastAt || value.expiresAt || 0);
        if (lastAt <= now - NEGATIVE_KEEP_MS) return;
        entries.set(key, {
          expiresAt: Number(value.expiresAt || 0),
          strikes: Math.max(1, Math.min(NEGATIVE_MAX_STRIKES, Number(value.strikes || 1))),
          lastAt
        });
      });
    }
  } catch (_) {}
}

function prune(now) {
  entries.forEach((entry, key) => {
    if (!(entry.lastAt > now - NEGATIVE_KEEP_MS)) entries.delete(key);
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
  const entry = entries.get(stableHash(request));
  // An expired entry is kept (without blocking) so a repeated miss can
  // escalate the next window instead of starting from one hour again.
  return Boolean(entry && entry.expiresAt > now);
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
    const previous = entries.get(key);
    const strikes = Math.min(NEGATIVE_MAX_STRIKES, Math.max(1, Number(previous?.strikes || 0) + 1));
    const ttl = Math.min(NEGATIVE_TTL_MAX_MS, NEGATIVE_TTL_BASE_MS * 2 ** (strikes - 1));
    // Reinsert so the Map order is "last updated", which prune uses.
    entries.delete(key);
    entries.set(key, { expiresAt: now + ttl, strikes, lastAt: now });
    prune(now);
    scheduleSave();
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
