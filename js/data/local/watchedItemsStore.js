import { LocalStore } from "../../core/storage/localStore.js";

const WATCHED_ITEMS_KEY = "watchedItems";

function normalizeEpisodeNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeExternalId(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value).trim() || null;
}

function normalizeItem(item = {}, profileId) {
  const ids = item.ids || item.externalIds || item.external_ids || {};
  return {
    profileId: String(profileId || 1),
    contentId: String(item.contentId || ""),
    contentType: String(item.contentType || "movie"),
    videoId: item.videoId || null,
    released: item.released || null,
    // Keep tracker aliases with the local canonical ID so later unmark and
    // reconciliation calls can match the same title across catalog sources.
    imdbId: item.imdbId || item.imdb_id || ids.imdb || null,
    tmdbId: normalizeExternalId(item.tmdbId ?? item.tmdb_id ?? ids.tmdb),
    traktId: normalizeExternalId(item.traktId ?? item.trakt_id ?? ids.trakt),
    slug: item.slug || ids.slug || null,
    title: String(item.title || ""),
    season: normalizeEpisodeNumber(item.season),
    episode: normalizeEpisodeNumber(item.episode),
    watchedAt: Number(item.watchedAt || Date.now())
  };
}

function watchedItemKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${season}::${episode}`;
}

function dedupeAndSort(items = []) {
  const byKey = new Map();
  (items || []).forEach((raw) => {
    const normalized = normalizeItem(raw, raw?.profileId);
    if (!normalized.contentId) {
      return;
    }
    const key = `${String(normalized.profileId || "1")}::${watchedItemKey(normalized)}`;
    const existing = byKey.get(key);
    if (!existing || Number(normalized.watchedAt || 0) >= Number(existing.watchedAt || 0)) {
      byKey.set(key, normalized);
    }
  });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right.watchedAt || 0) - Number(left.watchedAt || 0)
  );
}

// Home, Detail and Library read this list repeatedly while rendering. Memoize
// the normalized snapshot on the exact stored string so unchanged reads skip
// the parse and sort; any write changes the string and invalidates it.
let listAllCacheRaw = null;
let listAllCacheValue = null;

function readWatchedItemsRaw() {
  try {
    return localStorage.getItem(WATCHED_ITEMS_KEY);
  } catch (_) {
    return undefined;
  }
}

function loadWatchedItems() {
  const raw = readWatchedItemsRaw();
  if (raw !== undefined && raw === listAllCacheRaw && Array.isArray(listAllCacheValue)) {
    return listAllCacheValue;
  }

  let stored = [];
  if (raw === undefined) {
    stored = LocalStore.get(WATCHED_ITEMS_KEY, []);
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

function writeWatchedItems(items) {
  LocalStore.set(WATCHED_ITEMS_KEY, items);
  listAllCacheRaw = null;
  listAllCacheValue = null;
}

export const WatchedItemsStore = {
  listAll() {
    return loadWatchedItems();
  },

  listForProfile(profileId) {
    const pid = String(profileId || 1);
    return this.listAll().filter((item) => String(item.profileId || "1") === pid);
  },

  upsert(item, profileId) {
    const pid = String(profileId || 1);
    const normalized = normalizeItem(item, pid);
    if (!normalized.contentId) {
      return;
    }
    const key = watchedItemKey(normalized);
    const next = dedupeAndSort([
      normalized,
      ...this.listAll().filter(
        (entry) => !(String(entry.profileId || "1") === pid && watchedItemKey(entry) === key)
      )
    ]).slice(0, 5000);
    writeWatchedItems(next);
  },

  upsertMany(items, profileId) {
    const pid = String(profileId || 1);
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeItem(item, pid))
      .filter((item) => Boolean(item.contentId));
    if (!normalized.length) {
      return;
    }
    const keys = new Set(normalized.map(watchedItemKey));
    const next = dedupeAndSort([
      ...normalized,
      ...this.listAll().filter(
        (entry) => String(entry.profileId || "1") !== pid || !keys.has(watchedItemKey(entry))
      )
    ]).slice(0, 5000);
    writeWatchedItems(next);
  },

  remove(contentId, profileId, options = null) {
    const pid = String(profileId || 1);
    const targetContentId = String(contentId || "");
    const targetSeason = normalizeEpisodeNumber(options?.season);
    const targetEpisode = normalizeEpisodeNumber(options?.episode);
    const rootOnly = options?.rootOnly === true;
    const hasScopedEpisode = targetSeason != null || targetEpisode != null;
    const next = this.listAll().filter((entry) => {
      if (String(entry.profileId || "1") !== pid || entry.contentId !== targetContentId) {
        return true;
      }
      if (rootOnly) {
        return !(entry.season == null && entry.episode == null);
      }
      if (!hasScopedEpisode) {
        return false;
      }
      return !(entry.season === targetSeason && entry.episode === targetEpisode);
    });
    writeWatchedItems(next);
  },

  replaceForProfile(profileId, items = []) {
    const pid = String(profileId || 1);
    const keepOtherProfiles = this.listAll().filter(
      (entry) => String(entry.profileId || "1") !== pid
    );
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeItem(item, pid))
      .filter((item) => Boolean(item.contentId));
    writeWatchedItems(dedupeAndSort([...normalized, ...keepOtherProfiles]).slice(0, 5000));
  }
};
