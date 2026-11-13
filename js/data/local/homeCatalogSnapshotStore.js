import { ProfileManager } from "../../core/profile/profileManager.js";
import { SessionStore } from "../../core/storage/sessionStore.js";

// One profile's Home rows are written here so a cold start can paint the
// catalog before the addons answer. This is a cache, not a source of truth:
// the normal Home load still refreshes every row and replaces what it gets.
const DATABASE_NAME = "nuvio_home_catalog_cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
// Bump this whenever the compact row shape changes; old records are ignored
// and deleted on read instead of being interpreted as the new shape.
const SNAPSHOT_VERSION = 2;
const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ROWS = 40;
const MAX_ITEMS_PER_ROW = 60;
const MAX_RECORDS = 8;

let databasePromise = null;

function canUseIndexedDb() {
  return typeof globalThis.indexedDB !== "undefined";
}

function openDatabase() {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    let request;
    try {
      request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (_) {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function transaction(mode, operation) {
  return openDatabase().then((database) => {
    if (!database) return { ok: false, value: null };
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(STORE_NAME, mode);
        const value = operation(tx.objectStore(STORE_NAME));
        const complete = () =>
          Promise.resolve(value)
            .then((resolved) => resolve({ ok: true, value: resolved }))
            .catch(() => resolve({ ok: false, value: null }));
        tx.oncomplete = complete;
        tx.onerror = () => resolve({ ok: false, value: null });
        tx.onabort = () => resolve({ ok: false, value: null });
      } catch (_) {
        resolve({ ok: false, value: null });
      }
    });
  });
}

function currentProfileId(profileId = null) {
  const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
  return raw || "1";
}

function currentAccountKey() {
  try {
    const token = SessionStore.accessToken;
    const payload = String(token || "").split(".")[1];
    if (!payload) return "authenticated";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return String(JSON.parse(atob(padded))?.sub || "authenticated");
  } catch (_) {
    return "authenticated";
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

/**
 * The snapshot key must change whenever the source changes: profile, account
 * or addons. Row order and row visibility are presentation, applied by
 * sortAndFilterRows on every paint, so changing them keeps the cached rows
 * (the same source/structure split the native legacy client uses). Custom
 * titles are baked into the stored row name, so they stay in the key.
 */
export function buildHomeCatalogSnapshotKey({
  profileId = null,
  addonDescriptors = [],
  homeCatalogPrefs = {}
} = {}) {
  const addons = (Array.isArray(addonDescriptors) ? addonDescriptors : [])
    .map((descriptor) => [
      String(descriptor?.addonBaseUrl || ""),
      String(descriptor?.addonId || ""),
      String(descriptor?.type || ""),
      String(descriptor?.catalogId || "")
    ])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const prefs = {
    customTitles:
      homeCatalogPrefs?.customTitles && typeof homeCatalogPrefs.customTitles === "object"
        ? Object.keys(homeCatalogPrefs.customTitles)
            .sort()
            .reduce((result, key) => {
              result[key] = homeCatalogPrefs.customTitles[key];
              return result;
            }, {})
        : {}
  };
  return `${currentProfileId(profileId)}:${stableHash(JSON.stringify([currentAccountKey(), addons, prefs]))}`;
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function compactRow(row = {}) {
  const result = row?.result;
  if (!result || result.status !== "success" || !Array.isArray(result?.data?.items)) {
    return null;
  }
  const items = cloneJson(result.data.items.slice(0, MAX_ITEMS_PER_ROW));
  if (!Array.isArray(items) || !items.length) return null;
  // Keep the whole catalog descriptor (type, skip settings...): a row painted
  // from disk must render exactly like the network row that replaces it.
  const { result: _result, loadingItems: _loadingItems, ...descriptor } = row;
  return {
    ...cloneJson(descriptor),
    result: {
      status: "success",
      data: {
        ...cloneJson(result.data),
        items
      }
    },
    loadingItems: null
  };
}

/** Bound what is written to disk; Home still owns the full in-memory rows. */
export function compactHomeCatalogRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.rowKind !== "collection")
    .slice(0, MAX_ROWS)
    .map(compactRow)
    .filter(Boolean);
}

export function isHomeCatalogSnapshotFresh(record, now = Date.now()) {
  return Boolean(
    record &&
    Number(record.version || 0) === SNAPSHOT_VERSION &&
    Array.isArray(record.rows) &&
    Number(record.savedAt || 0) > 0 &&
    now - Number(record.savedAt) <= SNAPSHOT_TTL_MS
  );
}

async function readRecord(key) {
  const result = await transaction("readonly", (store) => {
    const request = store.get(key);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  });
  return result.ok ? result.value : null;
}

async function trimRecords() {
  const result = await transaction("readonly", (store) => {
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => resolve([]);
    });
  });
  const records = result.ok && Array.isArray(result.value) ? result.value : [];
  if (records.length <= MAX_RECORDS) return;
  const oldest = records
    .map((record) => ({ key: record?.key, savedAt: Number(record?.savedAt || 0) }))
    .filter((record) => record.key)
    .sort((left, right) => left.savedAt - right.savedAt)
    .slice(0, records.length - MAX_RECORDS);
  for (const record of oldest) {
    await transaction("readwrite", (store) => store.delete(record.key));
  }
}

export const HomeCatalogSnapshotStore = {
  async read({ profileId = null, key = null } = {}) {
    const normalizedKey = key || buildHomeCatalogSnapshotKey({ profileId });
    const record = await readRecord(normalizedKey);
    if (!isHomeCatalogSnapshotFresh(record)) {
      if (record) await transaction("readwrite", (store) => store.delete(normalizedKey));
      return null;
    }
    return cloneJson(record.rows) || [];
  },

  async write({ profileId = null, key = null, rows = [] } = {}) {
    const normalizedKey = key || buildHomeCatalogSnapshotKey({ profileId });
    const compactRows = compactHomeCatalogRows(rows);
    if (!compactRows.length) return false;
    const record = {
      key: normalizedKey,
      version: SNAPSHOT_VERSION,
      savedAt: Date.now(),
      rows: compactRows
    };
    const written = await transaction("readwrite", (store) => store.put(record));
    if (written.ok) await trimRecords();
    return written.ok;
  },

  async clearProfile(profileId = null) {
    if (!canUseIndexedDb()) return true;
    const prefix = `${currentProfileId(profileId)}:`;
    const result = await transaction("readonly", (store) => {
      const request = store.getAllKeys();
      return new Promise((resolve) => {
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
      });
    });
    const keys = result.ok && Array.isArray(result.value) ? result.value : [];
    let cleared = result.ok;
    for (const key of keys) {
      if (!String(key).startsWith(prefix)) continue;
      const deletion = await transaction("readwrite", (store) => store.delete(key));
      if (!deletion.ok) cleared = false;
    }
    return cleared;
  },

  async clearAll() {
    if (!canUseIndexedDb()) return true;
    const result = await transaction("readwrite", (store) => store.clear());
    return result.ok;
  }
};
