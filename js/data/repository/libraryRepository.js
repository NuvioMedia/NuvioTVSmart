import { AuthManager } from "../../core/auth/authManager.js";
import { toTraktImageUrl } from "../../core/trakt/traktImageUrl.js";
import { SavedLibrarySyncService } from "../../core/profile/savedLibrarySyncService.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { savedLibraryRepository } from "./savedLibraryRepository.js";
import { metaRepository } from "./metaRepository.js";
import { requestJson, TraktAuthService } from "./traktAuthService.js";
import { TraktLibrarySourceMode, TraktSettingsStore } from "../local/traktSettingsStore.js";
import { SimklAuthService } from "./simklAuthService.js";
import { SimklSyncService } from "./simklSyncService.js";

export const LibrarySourceMode = {
  LOCAL: "local",
  TRAKT: "trakt",
  SIMKL: "simkl"
};

export const LibrarySortOptionKey = {
  DEFAULT: "default",
  ADDED_DESC: "added_desc",
  ADDED_ASC: "added_asc",
  TITLE_ASC: "title_asc",
  TITLE_DESC: "title_desc"
};

export const LibraryListPrivacy = {
  PRIVATE: "private",
  LINK: "link",
  FRIENDS: "friends",
  PUBLIC: "public"
};

export const LibraryListType = {
  WATCHLIST: "watchlist",
  PERSONAL: "personal"
};

const REMOTE_STORE_KEY = "libraryTraktState";
const WATCHLIST_KEY = "watchlist";
const PERSONAL_KEY_PREFIX = "personal:";
const TRAKT_PAGE_LIMIT = 100;
const TRAKT_LIST_FETCH_CONCURRENCY = 3;
const TRAKT_LIBRARY_CACHE_TTL_MS = 60 * 1000;
const META_TIMEOUT_MS = 2200;
const META_BATCH_SIZE = 6;
const VALID_POSTER_SHAPES = new Set(["POSTER", "LANDSCAPE", "SQUARE"]);

// Cache for library metadata enrichment with 5-minute TTL
const enrichedLibraryMetaCache = new Map();
const ENRICHED_LIBRARY_META_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {'local'|'trakt'} LibrarySourceModeValue
 */

/**
 * @typedef {'default'|'added_desc'|'added_asc'|'title_asc'|'title_desc'} LibrarySortOptionValue
 */

/**
 * @typedef {{ key: string, label: string }} LibraryTypeTab
 */

/**
 * @typedef {{ key: string, title: string, type: string, traktListId?: string|null, slug?: string|null, description?: string|null, privacy?: string|null, sortBy?: string|null, sortHow?: string|null }} LibraryListTab
 */

/**
 * @typedef {{ listedAt: number, traktRank: number|null }} LibraryEntryListMeta
 */

/**
 * @typedef {{ id: string, type: string, name: string, poster: string|null, background: string|null, description: string, releaseInfo: string, imdbRating: number|null, genres: string[], addonBaseUrl: string|null, listKeys: string[], listedAt: number, traktRank: number|null, listMeta: Record<string, LibraryEntryListMeta> }} LibraryEntry
 */

/**
 * @typedef {{ listMembership: Record<string, boolean> }} ListMembershipSnapshot
 */

/**
 * @typedef {{ desiredMembership: Record<string, boolean> }} ListMembershipChanges
 */

function isMissingResourceError(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  const message = String(error.message || "");
  return (
    message.includes("PGRST205") ||
    message.includes("PGRST202") ||
    message.includes("Could not find the table") ||
    message.includes("Could not find the function")
  );
}

function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function resolveProfileId() {
  const activeId = String(ProfileManager.getActiveProfileId() || "1");
  const direct = Number(activeId);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find(
    (profile) => String(profile.id || profile.profileIndex || "1") === activeId
  );
  const candidate = Number(activeProfile?.profileIndex || activeProfile?.id || 1);
  return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 1;
}

async function resolveRemoteStoreKey() {
  const profileId = await resolveProfileId();
  let ownerId = "guest";
  if (AuthManager.isAuthenticated) {
    try {
      ownerId = String(await AuthManager.getEffectiveUserId());
    } catch (error) {
      ownerId = "guest";
    }
  }
  return `${REMOTE_STORE_KEY}:${ownerId}:${profileId}`;
}

function createEmptyRemoteState() {
  return {
    nextListId: 1,
    syncedAt: 0,
    watchlist: [],
    lists: [],
    listItems: {}
  };
}

function cloneState(state) {
  return {
    nextListId: Number(state?.nextListId || 1),
    syncedAt: Number(state?.syncedAt || 0),
    watchlist: Array.isArray(state?.watchlist)
      ? state.watchlist.map((entry) => ({ ...entry }))
      : [],
    lists: Array.isArray(state?.lists) ? state.lists.map((entry) => ({ ...entry })) : [],
    listItems: Object.fromEntries(
      Object.entries(state?.listItems || {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map((item) => ({ ...item })) : []
      ])
    )
  };
}

async function readRemoteState() {
  const key = await resolveRemoteStoreKey();
  const stored = LocalStore.get(key, null);
  return cloneState(stored || createEmptyRemoteState());
}

async function writeRemoteState(state) {
  const key = await resolveRemoteStoreKey();
  LocalStore.set(key, cloneState(state));
}

function makeTypeLabel(type) {
  const key = String(type || "")
    .trim()
    .toLowerCase();
  if (!key) {
    return "Unknown";
  }
  if (key === "movie") {
    return "Movie";
  }
  if (key === "series") {
    return "Series";
  }
  return key
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function normalizeSavedItem(item = {}) {
  return {
    contentId: String(item.contentId || item.itemId || item.id || ""),
    contentType: String(item.contentType || item.itemType || item.type || "movie"),
    title: String(item.title || item.name || item.contentId || item.itemId || "Untitled"),
    poster: item.poster || null,
    posterShape: normalizePosterShape(item.posterShape || item.poster_shape),
    background: item.background || null,
    description: item.description || "",
    releaseInfo: item.releaseInfo || "",
    imdbRating: item.imdbRating == null ? null : Number(item.imdbRating),
    genres: Array.isArray(item.genres) ? item.genres : [],
    addonBaseUrl: item.addonBaseUrl || null,
    imdbId: item.imdbId || null,
    tmdbId: item.tmdbId == null ? null : Number(item.tmdbId),
    traktId: item.traktId == null ? null : Number(item.traktId),
    year: item.year == null ? null : Number(item.year),
    updatedAt: Number(item.updatedAt || item.listedAt || Date.now())
  };
}

function normalizePosterShape(value) {
  const shape = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_POSTER_SHAPES.has(shape) ? shape : "POSTER";
}

function toSavedItemFromTraktWatchlist(entry) {
  if (!entry) return null;
  const itemId = entry.imdbId
    ? String(entry.imdbId)
    : entry.tmdbId
      ? `tmdb:${entry.tmdbId}`
      : entry.traktId
        ? `trakt:${entry.traktId}`
        : null;
  if (!itemId) return null;
  const listedAtMs = entry.addedAt ? new Date(entry.addedAt).getTime() : Date.now();
  return {
    itemType: entry.type === "show" ? "series" : entry.type || "movie",
    itemId,
    imdbId: entry.imdbId || null,
    tmdbId: entry.tmdbId || null,
    traktId: entry.traktId || null,
    title: entry.title || "",
    year: entry.year || null,
    releaseInfo: entry.year ? String(entry.year) : "",
    posterUrl: "",
    updatedAt: listedAtMs,
    listedAt: listedAtMs
  };
}

function toRemoteListItem(item = {}, extra = {}) {
  const normalized = normalizeSavedItem(item);
  return {
    ...normalized,
    listedAt: Number(extra.listedAt || normalized.updatedAt || Date.now()),
    traktRank: extra.traktRank == null ? null : Number(extra.traktRank)
  };
}

function mergeItemIntoMap(target, listKey, baseItem, listedAt, traktRank) {
  const key = `${baseItem.contentType}:${baseItem.contentId}`;
  const existing = target.get(key);
  const nextListMeta = {
    ...(existing?.listMeta || {}),
    [listKey]: {
      listedAt: Number(listedAt || Date.now()),
      traktRank: traktRank == null ? null : Number(traktRank)
    }
  };
  const nextListKeys = Array.from(new Set([...(existing?.listKeys || []), listKey]));
  target.set(key, {
    id: baseItem.contentId,
    type: baseItem.contentType,
    name: baseItem.title || existing?.name || baseItem.contentId,
    poster: baseItem.poster || existing?.poster || null,
    background: baseItem.background || existing?.background || null,
    description: baseItem.description || existing?.description || "",
    releaseInfo: baseItem.releaseInfo || existing?.releaseInfo || "",
    imdbRating:
      baseItem.imdbRating == null ? (existing?.imdbRating ?? null) : Number(baseItem.imdbRating),
    genres:
      Array.isArray(baseItem.genres) && baseItem.genres.length
        ? baseItem.genres
        : existing?.genres || [],
    addonBaseUrl: baseItem.addonBaseUrl || existing?.addonBaseUrl || null,
    imdbId: baseItem.imdbId || existing?.imdbId || null,
    tmdbId: baseItem.tmdbId ?? existing?.tmdbId ?? null,
    traktId: baseItem.traktId ?? existing?.traktId ?? null,
    year: baseItem.year ?? existing?.year ?? null,
    listKeys: nextListKeys,
    listedAt: Number(listedAt || existing?.listedAt || Date.now()),
    traktRank: traktRank == null ? (existing?.traktRank ?? null) : Number(traktRank),
    listMeta: nextListMeta
  });
}

async function hydrateEntries(entries, { onBatch = null, shouldContinue = null } = {}) {
  const nextEntries = entries.map((entry) => ({
    ...entry,
    listKeys: [...entry.listKeys],
    listMeta: { ...(entry.listMeta || {}) }
  }));
  let hasPendingChanges = false;

  for (let index = 0; index < nextEntries.length; index += META_BATCH_SIZE) {
    if (shouldContinue && !shouldContinue()) {
      break;
    }
    const batch = nextEntries.slice(index, index + META_BATCH_SIZE);
    let didChange = false;
    await Promise.all(
      batch.map(async (entry) => {
        if (entry.poster && entry.name && entry.description) {
          return;
        }
        const cacheKey = `${entry.type}:${entry.id}`;
        const cached = enrichedLibraryMetaCache.get(cacheKey);
        const now = Date.now();
        let meta =
          cached && now - cached.timestamp < ENRICHED_LIBRARY_META_CACHE_TTL_MS
            ? cached.meta
            : null;
        if (!meta) {
          const result = await withTimeout(
            metaRepository.getMetaFromAllAddons(entry.type, entry.id),
            META_TIMEOUT_MS,
            { status: "error", message: "timeout" }
          );
          if (result?.status !== "success" || !result?.data) {
            return;
          }
          meta = result.data;
          enrichedLibraryMetaCache.set(cacheKey, { meta, timestamp: now });
        }
        const before = JSON.stringify([
          entry.name,
          entry.poster,
          entry.background,
          entry.description,
          entry.releaseInfo,
          entry.genres
        ]);
        entry.name = entry.name || meta.name || entry.id;
        entry.poster = entry.poster || meta.poster || meta.background || null;
        entry.background = entry.background || meta.background || null;
        entry.description = entry.description || meta.description || "";
        entry.releaseInfo = entry.releaseInfo || meta.releaseInfo || "";
        entry.genres = entry.genres?.length
          ? entry.genres
          : Array.isArray(meta.genres)
            ? meta.genres
            : [];
        didChange =
          didChange ||
          before !==
            JSON.stringify([
              entry.name,
              entry.poster,
              entry.background,
              entry.description,
              entry.releaseInfo,
              entry.genres
            ]);
      })
    );
    hasPendingChanges = hasPendingChanges || didChange;
    const processedCount = Math.min(index + META_BATCH_SIZE, nextEntries.length);
    const shouldNotify =
      processedCount === nextEntries.length || processedCount % (META_BATCH_SIZE * 4) === 0;
    if (hasPendingChanges && shouldNotify && (!shouldContinue || shouldContinue())) {
      onBatch?.(nextEntries);
      hasPendingChanges = false;
    }
  }

  return nextEntries;
}

function buildPersonalListTab(list = {}) {
  return {
    key: String(list.key || ""),
    title: String(list.title || "Untitled"),
    type: LibraryListType.PERSONAL,
    traktListId: String(list.traktListId || list.key || "").replace(PERSONAL_KEY_PREFIX, ""),
    slug: list.slug || null,
    description: list.description || null,
    privacy: list.privacy || LibraryListPrivacy.PRIVATE,
    sortBy: list.sortBy || null,
    sortHow: list.sortHow || null
  };
}

async function getRemotePersonalTabs() {
  const state = await readRemoteState();
  return state.lists.map((entry) => buildPersonalListTab(entry));
}

async function getLocalEntries({ hydrate = true } = {}) {
  const savedItems = await savedLibraryRepository.getAll(1000);
  const entriesMap = new Map();
  savedItems.forEach((item) => {
    const normalized = normalizeSavedItem(item);
    mergeItemIntoMap(entriesMap, "local", normalized, normalized.updatedAt, null);
  });
  const entries = Array.from(entriesMap.values());
  return hydrate ? hydrateEntries(entries) : entries;
}

async function getRemoteEntries({ hydrate = true } = {}) {
  const personalState = await readRemoteState();
  const entriesMap = new Map();

  personalState.watchlist.forEach((item, index) => {
    const normalized = normalizeSavedItem(item);
    mergeItemIntoMap(entriesMap, WATCHLIST_KEY, normalized, normalized.updatedAt, index);
  });

  personalState.lists.forEach((list) => {
    const listKey = String(list.key || "");
    const items = Array.isArray(personalState.listItems?.[listKey])
      ? personalState.listItems[listKey]
      : [];
    items.forEach((item, index) => {
      const normalized = normalizeSavedItem(item);
      mergeItemIntoMap(
        entriesMap,
        listKey,
        normalized,
        Number(item.listedAt || normalized.updatedAt || Date.now()),
        index
      );
    });
  });

  const entries = Array.from(entriesMap.values());
  return hydrate ? hydrateEntries(entries) : entries;
}

function membershipMapFromEntries(entries, listTabs) {
  const allKeys = listTabs.map((tab) => tab.key);
  return (item) => {
    const itemKey = `${item.itemType || item.type || "movie"}:${item.itemId || item.id || ""}`;
    const found = entries.find((entry) => `${entry.type}:${entry.id}` === itemKey);
    return {
      listMembership: Object.fromEntries(
        allKeys.map((key) => [key, Boolean(found?.listKeys?.includes(key))])
      )
    };
  };
}

function upsertPersonalItem(state, listKey, item) {
  const nextState = cloneState(state);
  const list = Array.isArray(nextState.listItems[listKey]) ? nextState.listItems[listKey] : [];
  const normalized = toRemoteListItem(item, { listedAt: Date.now() });
  nextState.listItems[listKey] = [
    normalized,
    ...list.filter(
      (entry) =>
        !(
          String(entry.contentId) === normalized.contentId &&
          String(entry.contentType) === normalized.contentType
        )
    )
  ];
  return nextState;
}

function removePersonalItem(state, listKey, item) {
  const nextState = cloneState(state);
  const current = Array.isArray(nextState.listItems[listKey]) ? nextState.listItems[listKey] : [];
  nextState.listItems[listKey] = current.filter((entry) => {
    return !(
      String(entry.contentId) === String(item.itemId || item.id || "") &&
      String(entry.contentType || "movie") === String(item.itemType || item.type || "movie")
    );
  });
  return nextState;
}

function traktErrorMessage(payload, fallback, status) {
  const message =
    payload && typeof payload === "object"
      ? payload.message || payload.error_description || payload.error
      : null;
  return String(message || `${fallback} (${status})`);
}

async function authorizedTraktRequest(path, options = {}) {
  const token = await TraktAuthService.getValidAccessToken();
  if (!token) {
    throw new Error("Trakt authentication required");
  }
  const { response, payload } = await requestJson(path, {
    ...options,
    authorization: `Bearer ${token}`
  });
  if (!response.ok) {
    throw new Error(
      traktErrorMessage(payload, options.errorMessage || "Trakt request failed", response.status)
    );
  }
  return { response, payload };
}

function toPersonalList(raw = {}) {
  const traktListId = raw.ids?.trakt;
  const slug = raw.ids?.slug || null;
  const pathId = traktListId == null ? slug : String(traktListId);
  if (!pathId) return null;
  return {
    key: `${PERSONAL_KEY_PREFIX}${pathId}`,
    title: String(raw.name || "Untitled"),
    description: raw.description || null,
    privacy: raw.privacy || LibraryListPrivacy.PRIVATE,
    traktListId: traktListId == null ? null : String(traktListId),
    slug,
    sortBy: raw.sort_by || null,
    sortHow: raw.sort_how || null
  };
}

function bestTraktImage(images = {}, kind) {
  const candidates = images?.[kind];
  let url = null;
  if (Array.isArray(candidates)) {
    url = candidates.find((entry) => typeof entry === "string") || null;
  } else if (typeof candidates === "string") {
    url = candidates;
  } else if (candidates && typeof candidates === "object") {
    url = candidates.full || candidates.medium || candidates.thumb || null;
  }
  return url ? toTraktImageUrl(url) : null;
}

function toSavedItemFromTraktList(entry) {
  const media = entry?.movie || entry?.show;
  const type = entry?.movie ? "movie" : entry?.show ? "series" : null;
  if (!media || !type) return null;
  const ids = media.ids || {};
  const contentId = ids.imdb
    ? String(ids.imdb)
    : ids.tmdb != null
      ? `tmdb:${ids.tmdb}`
      : ids.trakt != null
        ? `trakt:${ids.trakt}`
        : null;
  if (!contentId) return null;
  const listedAt = Date.parse(entry.listed_at || "") || Date.now();
  return {
    contentId,
    contentType: type,
    title: String(media.title || contentId),
    poster: bestTraktImage(media.images, "poster"),
    background: bestTraktImage(media.images, "fanart"),
    description: media.overview || "",
    releaseInfo: media.year == null ? "" : String(media.year),
    imdbRating: media.rating == null ? null : Number(media.rating),
    genres: Array.isArray(media.genres) ? media.genres : [],
    imdbId: ids.imdb || null,
    tmdbId: ids.tmdb == null ? null : Number(ids.tmdb),
    traktId: ids.trakt == null ? null : Number(ids.trakt),
    year: media.year == null ? null : Number(media.year),
    updatedAt: listedAt,
    listedAt,
    traktRank: entry.rank == null ? null : Number(entry.rank)
  };
}

async function fetchAllTraktPages(pathForPage) {
  const items = [];
  let page = 1;
  while (true) {
    const { response, payload } = await authorizedTraktRequest(pathForPage(page), {
      errorMessage: "Could not load Trakt list items"
    });
    if (!Array.isArray(payload)) break;
    items.push(...payload);
    const pageCount = Math.max(
      1,
      Number(response.headers.get("X-Pagination-Page-Count") || 1) || 1
    );
    if (page >= pageCount) break;
    page += 1;
  }
  return items;
}

async function fetchTraktListItems(list) {
  const listId = list.traktListId || list.slug || list.key.replace(PERSONAL_KEY_PREFIX, "");
  const query = (page) => {
    const params = new URLSearchParams({
      extended: "full,images",
      page: String(page),
      limit: String(TRAKT_PAGE_LIMIT)
    });
    if (list.sortBy) params.set("sort_by", list.sortBy);
    if (list.sortHow) params.set("sort_how", list.sortHow);
    return params.toString();
  };
  const [movies, shows] = await Promise.all(
    ["movie", "show"].map((type) =>
      fetchAllTraktPages(
        (page) => `/users/me/lists/${encodeURIComponent(listId)}/items/${type}?${query(page)}`
      )
    )
  );
  return [...movies, ...shows].map(toSavedItemFromTraktList).filter(Boolean);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchTraktPersonalState() {
  const { payload } = await authorizedTraktRequest("/users/me/lists", {
    errorMessage: "Could not load Trakt personal lists"
  });
  const lists = (Array.isArray(payload) ? payload : [])
    .filter((list) => String(list?.type || "personal").toLowerCase() === "personal")
    .map(toPersonalList)
    .filter(Boolean);
  const itemGroups = await mapWithConcurrency(
    lists,
    TRAKT_LIST_FETCH_CONCURRENCY,
    fetchTraktListItems
  );
  return { lists, itemGroups };
}

function resolveTraktIds(item = {}) {
  const rawId = String(item.itemId || item.id || item.contentId || "").trim();
  const prefixed = rawId.match(/^(imdb|tmdb|trakt):(.+)$/i);
  const ids = {
    imdb: item.imdbId || (prefixed?.[1].toLowerCase() === "imdb" ? prefixed[2] : null),
    tmdb: item.tmdbId ?? (prefixed?.[1].toLowerCase() === "tmdb" ? Number(prefixed[2]) : null),
    trakt: item.traktId ?? (prefixed?.[1].toLowerCase() === "trakt" ? Number(prefixed[2]) : null)
  };
  if (!ids.imdb && /^tt\d+$/i.test(rawId)) ids.imdb = rawId;
  if (!ids.imdb && !Number.isFinite(ids.tmdb) && !Number.isFinite(ids.trakt)) {
    throw new Error("This item has no Trakt-compatible ID");
  }
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value != null && value !== "")
  );
}

function buildTraktMutationBody(item) {
  const type = String(item.itemType || item.type || "movie").toLowerCase();
  const entry = {
    title: item.title || item.name || undefined,
    year: item.year == null ? undefined : Number(item.year),
    ids: resolveTraktIds(item)
  };
  return type === "movie" ? { movies: [entry] } : { shows: [entry] };
}

class LibraryRepository {
  constructor() {
    this.traktRefreshPromise = null;
  }

  async ensureFreshTraktState() {
    const state = await readRemoteState();
    if (Date.now() - state.syncedAt <= TRAKT_LIBRARY_CACHE_TTL_MS) {
      return;
    }
    if (!this.traktRefreshPromise) {
      this.traktRefreshPromise = this.refreshNow().finally(() => {
        this.traktRefreshPromise = null;
      });
    }
    await this.traktRefreshPromise;
  }

  async getSourceMode() {
    const selectedMode = TraktSettingsStore.get().librarySourceMode;
    if (selectedMode === TraktLibrarySourceMode.SIMKL) {
      return SimklAuthService.isAuthenticated()
        ? LibrarySourceMode.SIMKL
        : LibrarySourceMode.LOCAL;
    }
    if (selectedMode !== TraktLibrarySourceMode.TRAKT) {
      return LibrarySourceMode.LOCAL;
    }
    const traktToken = await TraktAuthService.getValidAccessToken().catch(() => null);
    if (!traktToken) {
      return LibrarySourceMode.LOCAL;
    }
    return LibrarySourceMode.TRAKT;
  }

  async getListTabs({ sourceMode = null } = {}) {
    const resolvedSourceMode = sourceMode || (await this.getSourceMode());
    if (resolvedSourceMode === LibrarySourceMode.LOCAL) {
      return [];
    }
    if (resolvedSourceMode === LibrarySourceMode.SIMKL) {
      return SimklSyncService.getLibraryTabs();
    }
    await this.ensureFreshTraktState();
    const personalTabs = await getRemotePersonalTabs();
    return [
      {
        key: WATCHLIST_KEY,
        title: "Watchlist",
        type: LibraryListType.WATCHLIST,
        traktListId: null,
        slug: null,
        description: null,
        privacy: null,
        sortBy: null,
        sortHow: null
      },
      ...personalTabs
    ];
  }

  async getItems({ hydrate = true, sourceMode = null } = {}) {
    const resolvedSourceMode = sourceMode || (await this.getSourceMode());
    if (resolvedSourceMode === LibrarySourceMode.TRAKT) {
      await this.ensureFreshTraktState();
    }
    if (resolvedSourceMode === LibrarySourceMode.SIMKL) {
      const entries = await SimklSyncService.getLibraryEntries();
      return hydrate ? hydrateEntries(entries) : entries;
    }
    return resolvedSourceMode === LibrarySourceMode.TRAKT
      ? getRemoteEntries({ hydrate })
      : getLocalEntries({ hydrate });
  }

  async hydrateItems(items, options = {}) {
    return hydrateEntries(items, options);
  }

  async getMembershipSnapshot(item) {
    const sourceMode = await this.getSourceMode();
    if (sourceMode === LibrarySourceMode.LOCAL) {
      const exists = await savedLibraryRepository.isSaved(item.itemId || item.id || "");
      return { listMembership: { local: exists } };
    }
    if (sourceMode === LibrarySourceMode.SIMKL) {
      return SimklSyncService.getMembershipSnapshot(item);
    }
    const [entries, listTabs] = await Promise.all([this.getItems(), this.getListTabs()]);
    return membershipMapFromEntries(entries, listTabs)(item);
  }

  async applyMembershipChanges(item, changes, options = {}) {
    const sourceMode = await this.getSourceMode();
    if (sourceMode === LibrarySourceMode.LOCAL) {
      const shouldSave = Object.values(changes?.desiredMembership || {}).some(Boolean);
      if (shouldSave) {
        await savedLibraryRepository.save(normalizeSavedItem(item));
      } else {
        await savedLibraryRepository.remove(item.itemId || item.id || "");
      }
      return;
    }
    if (sourceMode === LibrarySourceMode.SIMKL) {
      await SimklSyncService.applyMembershipChanges(item, changes, options);
      return;
    }

    const desiredMembership = changes?.desiredMembership || {};
    const currentSnapshot = await this.getMembershipSnapshot(item);
    let remoteState = await readRemoteState();

    for (const [listKey, desired] of Object.entries(desiredMembership)) {
      const before = currentSnapshot.listMembership?.[listKey] === true;
      const after = desired === true;
      if (before === after) {
        continue;
      }
      const body = buildTraktMutationBody(item);
      if (listKey === WATCHLIST_KEY) {
        await authorizedTraktRequest(after ? "/sync/watchlist" : "/sync/watchlist/remove", {
          method: "POST",
          body,
          errorMessage: after
            ? "Could not add item to Trakt watchlist"
            : "Could not remove item from Trakt watchlist"
        });
        remoteState.watchlist = after
          ? [
              toRemoteListItem(item, { listedAt: Date.now() }),
              ...(remoteState.watchlist || []).filter(
                (entry) =>
                  !(
                    String(entry.contentId) === String(item.itemId || item.id || "") &&
                    String(entry.contentType || "movie") ===
                      String(item.itemType || item.type || "movie")
                  )
              )
            ]
          : (remoteState.watchlist || []).filter(
              (entry) =>
                !(
                  String(entry.contentId) === String(item.itemId || item.id || "") &&
                  String(entry.contentType || "movie") ===
                    String(item.itemType || item.type || "movie")
                )
            );
        continue;
      }
      const listId = String(listKey).replace(PERSONAL_KEY_PREFIX, "");
      await authorizedTraktRequest(
        `/users/me/lists/${encodeURIComponent(listId)}/items${after ? "" : "/remove"}`,
        {
          method: "POST",
          body,
          errorMessage: after
            ? "Could not add item to Trakt list"
            : "Could not remove item from Trakt list"
        }
      );
      remoteState = after
        ? upsertPersonalItem(remoteState, listKey, item)
        : removePersonalItem(remoteState, listKey, item);
    }

    await writeRemoteState(remoteState);
  }

  async createPersonalList(name, description, privacy) {
    const { payload } = await authorizedTraktRequest("/users/me/lists", {
      method: "POST",
      body: {
        name: String(name || "Untitled"),
        description: description || null,
        privacy: privacy || LibraryListPrivacy.PRIVATE
      },
      errorMessage: "Could not create Trakt list"
    });
    const created = toPersonalList(payload);
    if (!created) {
      throw new Error("Trakt returned an invalid list");
    }
    const state = await readRemoteState();
    state.lists = [...state.lists.filter((list) => list.key !== created.key), created];
    state.listItems[created.key] = state.listItems[created.key] || [];
    await writeRemoteState(state);
    return created.key;
  }

  async updatePersonalList(listId, name, description, privacy) {
    const { payload } = await authorizedTraktRequest(
      `/users/me/lists/${encodeURIComponent(String(listId))}`,
      {
        method: "PUT",
        body: {
          name: String(name || "Untitled"),
          description: description || null,
          privacy: privacy || LibraryListPrivacy.PRIVATE
        },
        errorMessage: "Could not update Trakt list"
      }
    );
    const updated = toPersonalList(payload);
    const state = await readRemoteState();
    state.lists = state.lists.map((list) => {
      if (
        String(list.traktListId || list.key).replace(PERSONAL_KEY_PREFIX, "") !== String(listId)
      ) {
        return list;
      }
      return {
        ...list,
        ...(updated || {}),
        key: list.key,
        title: String(updated?.title || name || list.title || "Untitled"),
        description: updated?.description ?? description ?? null,
        privacy: updated?.privacy || privacy || list.privacy || LibraryListPrivacy.PRIVATE
      };
    });
    await writeRemoteState(state);
  }

  async deletePersonalList(listId) {
    await authorizedTraktRequest(`/users/me/lists/${encodeURIComponent(String(listId))}`, {
      method: "DELETE",
      errorMessage: "Could not delete Trakt list"
    });
    const state = await readRemoteState();
    const match = state.lists.find((list) => {
      return (
        String(list.traktListId || list.key).replace(PERSONAL_KEY_PREFIX, "") === String(listId)
      );
    });
    if (!match) {
      return;
    }
    state.lists = state.lists.filter((list) => list.key !== match.key);
    delete state.listItems[match.key];
    await writeRemoteState(state);
  }

  async reorderPersonalLists(orderedListIds = []) {
    const rank = orderedListIds
      .map((id) => Number(String(id).replace(PERSONAL_KEY_PREFIX, "")))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!rank.length) return;
    await authorizedTraktRequest("/users/me/lists/reorder", {
      method: "POST",
      body: { rank },
      errorMessage: "Could not reorder Trakt lists"
    });
    const state = await readRemoteState();
    const byId = new Map(
      state.lists.map((list) => [
        String(list.traktListId || list.key).replace(PERSONAL_KEY_PREFIX, ""),
        list
      ])
    );
    const reordered = orderedListIds
      .map((id) => byId.get(String(id).replace(PERSONAL_KEY_PREFIX, "")))
      .filter(Boolean);
    const untouched = state.lists.filter(
      (list) => !reordered.some((entry) => entry.key === list.key)
    );
    state.lists = [...reordered, ...untouched];
    await writeRemoteState(state);
  }

  async refreshNow() {
    const sourceMode = await this.getSourceMode();
    if (sourceMode === LibrarySourceMode.TRAKT) {
      if (!TraktAuthService.isAuthenticated()) return false;
      try {
        const [watchlistItems, personal] = await Promise.all([
          TraktAuthService.fetchWatchlist({ limit: 200 }),
          fetchTraktPersonalState()
        ]);
        const rawItems = watchlistItems.map(toSavedItemFromTraktWatchlist).filter(Boolean);
        const state = createEmptyRemoteState();
        state.syncedAt = Date.now();
        state.watchlist = rawItems;
        state.lists = personal.lists;
        personal.lists.forEach((list, index) => {
          state.listItems[list.key] = personal.itemGroups[index] || [];
        });
        await writeRemoteState(state);
        return true;
      } catch (error) {
        console.warn("[LIB] Trakt library fetch failed", error);
        return false;
      }
    }
    if (sourceMode === LibrarySourceMode.SIMKL) {
      try {
        return await SimklSyncService.refresh({ force: true });
      } catch (error) {
        console.warn("[LIB] Simkl library fetch failed", error);
        return false;
      }
    }
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    try {
      await SavedLibrarySyncService.pull();
      return true;
    } catch (error) {
      if (!isMissingResourceError(error)) {
        console.warn("LibraryRepository refreshNow failed", error);
      }
      return false;
    }
  }
}

export const libraryRepository = new LibraryRepository();
export const libraryTypeLabel = makeTypeLabel;
