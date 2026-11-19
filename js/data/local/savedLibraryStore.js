import { LocalStore } from "../../core/storage/localStore.js";

const SAVED_LIBRARY_KEY = "savedLibraryItems";

function normalizeItem(item = {}, profileId = 1) {
  const updatedAt = Number(item.updatedAt || item.addedAt || Date.now());
  return {
    ...item,
    profileId: String(item.profileId || profileId || "1"),
    contentId: String(item.contentId || item.itemId || item.id || ""),
    contentType: String(item.contentType || item.itemType || item.type || "movie"),
    title: String(item.title || item.name || item.contentId || item.itemId || "Untitled"),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function savedLibraryItemKey(item = {}) {
  const profileId = String(item.profileId || "1").trim() || "1";
  const contentType =
    String(item.contentType || "movie")
      .trim()
      .toLowerCase() || "movie";
  const contentId = String(item.contentId || "").trim();
  return `${profileId}::${contentType}::${contentId}`;
}

function dedupeAndSort(items = []) {
  const byKey = new Map();
  (items || []).forEach((raw) => {
    const normalized = normalizeItem(raw, raw?.profileId);
    if (!normalized.contentId) {
      return;
    }
    const key = savedLibraryItemKey(normalized);
    const existing = byKey.get(key);
    if (!existing || Number(normalized.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      byKey.set(key, normalized);
    }
  });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
  );
}

// Library checks and detail lookups read this list repeatedly. Memoize the
// normalized snapshot on the exact stored string so unchanged reads skip the
// parse and sort; any write changes the string and invalidates it.
let listAllCacheRaw = null;
let listAllCacheValue = null;

function readSavedLibraryRaw() {
  try {
    return localStorage.getItem(SAVED_LIBRARY_KEY);
  } catch (_) {
    return undefined;
  }
}

function loadSavedLibraryItems() {
  const raw = readSavedLibraryRaw();
  if (raw !== undefined && raw === listAllCacheRaw && Array.isArray(listAllCacheValue)) {
    return listAllCacheValue;
  }

  let stored = [];
  if (raw === undefined) {
    stored = LocalStore.get(SAVED_LIBRARY_KEY, []);
  } else if (raw !== null) {
    try {
      stored = JSON.parse(raw);
    } catch (_) {
      stored = [];
    }
  }

  const items = dedupeAndSort(Array.isArray(stored) ? stored : []);
  if (raw !== undefined) {
    listAllCacheRaw = raw;
    listAllCacheValue = items;
  }
  return items;
}

function writeSavedLibraryItems(items) {
  LocalStore.set(SAVED_LIBRARY_KEY, items);
  listAllCacheRaw = null;
  listAllCacheValue = null;
}

export const SavedLibraryStore = {
  listAll() {
    return loadSavedLibraryItems();
  },

  list() {
    return this.listAll();
  },

  listForProfile(profileId) {
    const pid = String(profileId || "1");
    return this.listAll().filter((item) => String(item.profileId || "1") === pid);
  },

  upsert(item, profileId) {
    const pid = String(profileId || "1");
    const normalized = normalizeItem(
      {
        ...item,
        updatedAt: item.updatedAt || Date.now()
      },
      pid
    );
    if (!normalized.contentId) {
      return;
    }
    const key = savedLibraryItemKey(normalized);
    const items = this.listAll();
    const next = [normalized, ...items.filter((entry) => savedLibraryItemKey(entry) !== key)].slice(
      0,
      1000
    );
    writeSavedLibraryItems(dedupeAndSort(next));
  },

  findByContentId(contentId, profileId) {
    const wanted = String(contentId || "").trim();
    return this.listForProfile(profileId).find((item) => item.contentId === wanted) || null;
  },

  remove(contentId, profileId) {
    const pid = String(profileId || "1");
    const wanted = String(contentId || "").trim();
    const next = this.listAll().filter((item) => {
      return String(item.profileId || "1") !== pid || item.contentId !== wanted;
    });
    writeSavedLibraryItems(next);
  },

  replaceAll(items = []) {
    writeSavedLibraryItems(dedupeAndSort(Array.isArray(items) ? items : []));
  },

  replaceForProfile(profileId, items = []) {
    const pid = String(profileId || "1");
    const keepOtherProfiles = this.listAll().filter(
      (item) => String(item.profileId || "1") !== pid
    );
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeItem(item, pid))
      .filter((item) => Boolean(item.contentId));
    writeSavedLibraryItems(dedupeAndSort([...normalized, ...keepOtherProfiles]).slice(0, 1000));
  }
};
