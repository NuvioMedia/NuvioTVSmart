import { getEffectivePluginProfileId } from "./pluginStore.js";
import { safePluginId, stablePluginHash } from "../../core/player/pluginModels.js";

const LEGACY_CACHE_KEY = "pluginCodeCache";
const DATABASE_NAME = "nuvio_plugin_code_cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "code";
// Every record key is `${profile}:plugin_...`; U+FFFF is the highest single
// code unit, so this closed upper bound covers exactly one profile's keys.
const PREFIX_UPPER_BOUND = "￿";
const memoryEntries = new Map();
const tombstonedPrefixes = new Set();
let tombstoneAll = false;
let databasePromise = null;
let memoryFallback = false;
let mutationQueue = Promise.resolve();

try {
  globalThis.localStorage?.removeItem(LEGACY_CACHE_KEY);
} catch (_) {
  // Cache cleanup must not prevent startup on a read-only storage area.
}

function canUseIndexedDb() {
  return typeof globalThis.indexedDB !== "undefined";
}

// Once IndexedDB has failed, session memory is authoritative but persistent
// records may still exist on disk. Where IndexedDB does not exist at all,
// nothing persistent was ever written, so cleanup is trivially complete.
function persistentCleanupUnverified() {
  return canUseIndexedDb() && memoryFallback;
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

function cacheKey(scraperId) {
  const raw = String(scraperId || "plugin");
  return `plugin_${stablePluginHash(raw)}_${safePluginId(raw, "plugin", 24)}`;
}

function profileId(value) {
  return getEffectivePluginProfileId(value);
}

function recordKey(scraperId, profile) {
  return `${String(profile)}:${cacheKey(scraperId)}`;
}

function byteLength(value) {
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(value).byteLength
    : unescape(encodeURIComponent(value)).length;
}

function enqueue(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

function transaction(mode, operation) {
  return openDatabase().then((database) => {
    if (!database) return { ok: false, value: null };
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(STORE_NAME, mode);
        const value = operation(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve({ ok: true, value });
        tx.onerror = () => resolve({ ok: false, value: null });
        tx.onabort = () => resolve({ ok: false, value: null });
      } catch (_) {
        resolve({ ok: false, value: null });
      }
    });
  });
}

function isTombstoned(key) {
  return tombstoneAll || [...tombstonedPrefixes].some((prefix) => key.startsWith(prefix));
}

async function readRecord(key) {
  if (memoryFallback || isTombstoned(key)) {
    return memoryEntries.get(key) || null;
  }
  const result = await transaction("readonly", (store) => {
    const request = store.get(key);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  });
  if (!result.ok) {
    memoryFallback = true;
    return memoryEntries.get(key) || null;
  }
  return result.value;
}

async function readProfileRecords(prefix) {
  if (memoryFallback || tombstoneAll || tombstonedPrefixes.has(prefix)) {
    return [...memoryEntries].filter(([key]) => key.startsWith(prefix));
  }
  const result = await transaction("readonly", (store) => {
    const records = [];
    const request = store.openCursor(
      globalThis.IDBKeyRange.bound(prefix, `${prefix}${PREFIX_UPPER_BOUND}`)
    );
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(records);
          return;
        }
        records.push([cursor.key, cursor.value]);
        cursor.continue();
      };
      request.onerror = () => resolve(null);
    });
  });
  if (!result.ok || !result.value) {
    memoryFallback = true;
    return [...memoryEntries].filter(([key]) => key.startsWith(prefix));
  }
  return result.value;
}

async function writeRecord(key, value) {
  if (memoryFallback) {
    memoryEntries.set(key, value);
    return true;
  }
  const result = await transaction("readwrite", (store) => store.put({ ...value, key }));
  if (!result.ok) {
    memoryFallback = true;
    memoryEntries.set(key, value);
    return true;
  }
  memoryEntries.set(key, value);
  return true;
}

// Returns whether persistent deletion is verified. The record is always gone
// from this session's view; a false result means disk records may remain.
async function deleteRecord(key) {
  if (memoryFallback || isTombstoned(key)) {
    memoryEntries.delete(key);
    if (!persistentCleanupUnverified()) return true;
    tombstonedPrefixes.add(key);
    return false;
  }
  const result = await transaction("readwrite", (store) => store.delete(key));
  memoryEntries.delete(key);
  if (!result.ok) {
    memoryFallback = true;
    tombstonedPrefixes.add(key);
    return false;
  }
  return true;
}

function bytesFor(records) {
  return records.reduce((total, [, entry]) => total + Number(entry?.bytes || 0), 0);
}

function markPrefixTombstone(prefix) {
  tombstonedPrefixes.add(prefix);
  [...memoryEntries.keys()]
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => memoryEntries.delete(key));
}

export const PluginCodeStore = {
  get(scraperId, profile) {
    const key = recordKey(scraperId, profileId(profile));
    return enqueue(async () => {
      const entry = await readRecord(key);
      if (!entry) return null;
      const touched = { ...entry, lastUsedAt: Date.now() };
      await writeRecord(key, touched);
      return touched;
    });
  },

  save(scraperId, code, metadata = {}, { maxBytes = 16 * 1024 * 1024, profile = null } = {}) {
    const id = profileId(profile);
    const key = recordKey(scraperId, id);
    const value = String(code || "");
    const bytes = byteLength(value);
    if (bytes > maxBytes) return Promise.resolve(false);
    return enqueue(async () => {
      const records = await readProfileRecords(`${id}:`);
      const now = Date.now();
      const next = {
        code: value,
        bytes,
        url: String(metadata.url || ""),
        version: String(metadata.version || ""),
        updatedAt: now,
        lastUsedAt: now
      };
      const retained = new Map(records);
      retained.set(key, next);
      while (bytesFor([...retained]) > maxBytes) {
        const oldest = [...retained]
          .filter(([entryKey]) => entryKey !== key)
          .sort(
            ([, left], [, right]) => Number(left.lastUsedAt || 0) - Number(right.lastUsedAt || 0)
          )[0];
        if (!oldest) return false;
        retained.delete(oldest[0]);
      }
      const evicted = records.filter(([entryKey]) => !retained.has(entryKey));
      for (const [evictedKey] of evicted) await deleteRecord(evictedKey);
      await writeRecord(key, next);
      return (await readRecord(key))?.code === value;
    });
  },

  remove(scraperId, profile) {
    const key = recordKey(scraperId, profileId(profile));
    return enqueue(async () => {
      const existed = Boolean(await readRecord(key));
      if (!existed) return false;
      const deleted = await deleteRecord(key);
      if (!deleted) {
        console.warn("Plugin code persistent removal failed; record hidden for this session", key);
      }
      return deleted;
    });
  },

  clear(profile) {
    const prefix = `${profileId(profile)}:`;
    return enqueue(async () => {
      const records = await readProfileRecords(prefix);
      let success = !persistentCleanupUnverified();
      for (const [key] of records) success = (await deleteRecord(key)) && success;
      if (!success) {
        markPrefixTombstone(prefix);
        console.warn(
          "Plugin code persistent clear failed; profile hidden for this session",
          prefix
        );
      }
      return success;
    });
  },

  clearProfile(profile) {
    const normalized = String(profile || "").trim();
    if (!normalized || normalized === "1" || profileId(normalized) !== normalized) {
      return Promise.resolve(false);
    }
    return this.clear(normalized);
  },

  clearAll() {
    return enqueue(async () => {
      memoryEntries.clear();
      if (!canUseIndexedDb()) return true;
      // Always attempt the persistent clear, even after an earlier failure:
      // sign-out must not leave a previous account's plugin source on disk.
      const result = await transaction("readwrite", (store) => store.clear());
      if (!result.ok) {
        memoryFallback = true;
        tombstoneAll = true;
        console.warn("Plugin code persistent clear failed; cache hidden for this session");
        return false;
      }
      return true;
    });
  },

  totalBytes(profile) {
    const prefix = `${profileId(profile)}:`;
    return enqueue(async () => bytesFor(await readProfileRecords(prefix)));
  }
};
