import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "collectionsState";

export const CollectionPosterShape = {
  POSTER: "POSTER",
  LANDSCAPE: "LANDSCAPE",
  SQUARE: "SQUARE"
};

export const CollectionFolderViewMode = {
  TABBED_GRID: "TABBED_GRID",
  ROWS: "ROWS",
  FOLLOW_LAYOUT: "FOLLOW_LAYOUT"
};

function stringOrEmpty(value) {
  return String(value || "").trim();
}

function stringOrNull(value) {
  const normalized = stringOrEmpty(value);
  return normalized || null;
}

function normalizePosterShape(value) {
  const normalized = stringOrEmpty(value).toUpperCase();
  if (normalized === "LANDSCAPE" || normalized === "WIDE") {
    return CollectionPosterShape.LANDSCAPE;
  }
  if (normalized === "POSTER") {
    return CollectionPosterShape.POSTER;
  }
  return CollectionPosterShape.SQUARE;
}

function normalizeFolderViewMode(value) {
  const normalized = stringOrEmpty(value).toUpperCase();
  if (normalized === "ROWS") {
    return CollectionFolderViewMode.ROWS;
  }
  if (normalized === "FOLLOW_LAYOUT") {
    return CollectionFolderViewMode.FOLLOW_LAYOUT;
  }
  return CollectionFolderViewMode.TABBED_GRID;
}

function normalizeTmdbFilters(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    withGenres: stringOrNull(raw.withGenres),
    releaseDateGte: stringOrNull(raw.releaseDateGte),
    releaseDateLte: stringOrNull(raw.releaseDateLte),
    voteAverageGte: Number.isFinite(Number(raw.voteAverageGte)) ? Number(raw.voteAverageGte) : null,
    voteAverageLte: Number.isFinite(Number(raw.voteAverageLte)) ? Number(raw.voteAverageLte) : null,
    voteCountGte: Number.isFinite(Number(raw.voteCountGte))
      ? Math.trunc(Number(raw.voteCountGte))
      : null,
    withOriginalLanguage: stringOrNull(raw.withOriginalLanguage),
    withOriginCountry: stringOrNull(raw.withOriginCountry),
    withKeywords: stringOrNull(raw.withKeywords),
    withCompanies: stringOrNull(raw.withCompanies),
    withNetworks: stringOrNull(raw.withNetworks),
    year:
      Number.isFinite(Number(raw.year)) && Number(raw.year) > 0
        ? Math.trunc(Number(raw.year))
        : null,
    watchRegion: stringOrNull(raw.watchRegion),
    withWatchProviders: stringOrNull(raw.withWatchProviders)
  };
}

function normalizeCollectionSource(source = {}) {
  const raw = source && typeof source === "object" ? source : {};
  const provider = stringOrEmpty(raw.provider || "addon").toLowerCase();
  if (provider === "tmdb") {
    const tmdbSourceType = stringOrEmpty(raw.tmdbSourceType).toUpperCase();
    if (!tmdbSourceType) {
      return null;
    }
    return {
      provider: "tmdb",
      tmdbSourceType,
      title: stringOrEmpty(
        raw.title || tmdbSourceType.replace(/^./, (match) => match.toUpperCase())
      ),
      tmdbId: Number.isFinite(Number(raw.tmdbId)) ? Math.trunc(Number(raw.tmdbId)) : null,
      mediaType: stringOrEmpty(raw.mediaType || "MOVIE").toUpperCase() === "TV" ? "TV" : "MOVIE",
      sortBy: stringOrEmpty(raw.sortBy || "popularity.desc") || "popularity.desc",
      filters: normalizeTmdbFilters(raw.filters)
    };
  }
  if (provider === "trakt") {
    const traktListId = Number(raw.traktListId);
    if (!Number.isFinite(traktListId) || traktListId <= 0) {
      return null;
    }
    return {
      provider: "trakt",
      title: stringOrEmpty(raw.title || `List ${Math.trunc(traktListId)}`),
      traktListId: Math.trunc(traktListId),
      mediaType: stringOrEmpty(raw.mediaType || "MOVIE").toUpperCase() === "TV" ? "TV" : "MOVIE",
      sortBy: stringOrEmpty(raw.sortBy || "rank") || "rank",
      sortHow: stringOrEmpty(raw.sortHow || "asc") || "asc"
    };
  }

  const addonBaseUrl = stringOrNull(
    raw.addonBaseUrl || raw.addon_base_url || raw.baseUrl || raw.base_url || raw.addonUrl || raw.url
  );
  const addonId = stringOrEmpty(raw.addonId || raw.addon_id || addonBaseUrl);
  const type = stringOrEmpty(raw.type || raw.apiType || raw.api_type).toLowerCase();
  const catalogId = stringOrEmpty(raw.catalogId || raw.catalog_id);
  if (!addonId || !type || !catalogId) {
    return null;
  }
  return {
    provider: "addon",
    addonId,
    addonBaseUrl,
    addonName: stringOrNull(raw.addonName || raw.addon_name || raw.providerName),
    type,
    catalogId,
    catalogName: stringOrNull(raw.catalogName || raw.catalog_name || raw.title || raw.name),
    title: stringOrEmpty(raw.title || raw.catalogName || raw.catalog_name || raw.name),
    genre: stringOrNull(raw.genre)
  };
}

export function getCollectionFolderSources(folder = {}) {
  const primary = Array.isArray(folder.sources) ? folder.sources : [];
  if (primary.length) {
    return primary.map((source) => normalizeCollectionSource(source)).filter(Boolean);
  }
  const catalogSources = Array.isArray(folder.catalogSources) ? folder.catalogSources : [];
  return catalogSources
    .map((source) => normalizeCollectionSource({ ...source, provider: "addon" }))
    .filter(Boolean);
}

function normalizeFolder(folder = {}) {
  const id = stringOrEmpty(folder.id);
  const title = stringOrEmpty(folder.title);
  if (!id || !title) {
    return null;
  }
  const sources = getCollectionFolderSources(folder);
  return {
    id,
    title,
    coverImageUrl: stringOrNull(folder.coverImageUrl),
    focusGifUrl: stringOrNull(folder.focusGifUrl),
    focusGifEnabled: folder.focusGifEnabled !== false,
    coverEmoji: stringOrNull(folder.coverEmoji),
    tileShape: normalizePosterShape(folder.tileShape),
    hideTitle: Boolean(folder.hideTitle),
    sources,
    catalogSources: sources
      .filter((source) => source.provider === "addon")
      .map((source) => ({
        addonId: source.addonId,
        addonBaseUrl: source.addonBaseUrl || null,
        addonName: source.addonName || null,
        type: source.type,
        catalogId: source.catalogId,
        catalogName: source.catalogName || null,
        title: source.title || source.catalogName || null,
        genre: source.genre || null
      })),
    heroBackdropUrl: stringOrNull(folder.heroBackdropUrl),
    heroVideoUrl: stringOrNull(folder.heroVideoUrl),
    titleLogoUrl: stringOrNull(folder.titleLogoUrl)
  };
}

export function normalizeCollection(collection = {}) {
  const id = stringOrEmpty(collection.id);
  const title = stringOrEmpty(collection.title);
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    backdropImageUrl: stringOrNull(collection.backdropImageUrl),
    pinToTop: Boolean(collection.pinToTop),
    focusGlowEnabled: collection.focusGlowEnabled !== false,
    viewMode: normalizeFolderViewMode(collection.viewMode),
    showAllTab: collection.showAllTab !== false,
    folders: (Array.isArray(collection.folders) ? collection.folders : [])
      .map((folder) => normalizeFolder(folder))
      .filter(Boolean)
  };
}

function normalizeState(value = {}) {
  const raw = Array.isArray(value)
    ? { collections: value }
    : value && typeof value === "object"
      ? value
      : {};
  return {
    collections: (Array.isArray(raw.collections) ? raw.collections : [])
      .map((collection) => normalizeCollection(collection))
      .filter(Boolean)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeState,
  merge(current, partial) {
    const next = partial && typeof partial === "object" ? partial : {};
    return normalizeState({
      ...(current || {}),
      ...next,
      collections: Array.isArray(next.collections)
        ? next.collections
        : Array.isArray(current?.collections)
          ? current.collections
          : []
    });
  }
});

function queueCollectionSync(profileId = null) {
  import("../../core/profile/collectionSyncService.js")
    .then(({ CollectionSyncService }) => CollectionSyncService.triggerPush(profileId))
    .catch((error) => {
      console.warn("Collection sync enqueue failed", error);
    });
}

function cloneCollections(collections = []) {
  return JSON.parse(JSON.stringify(Array.isArray(collections) ? collections : []));
}

function generateId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `collection_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCollectionHomeKey(collection = {}) {
  return `collection_${stringOrEmpty(collection.id)}`;
}

export const CollectionsStore = {
  generateId,

  getState() {
    return store.get();
  },

  getStateForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return cloneCollections(this.getState().collections);
  },

  getForProfile(profileId) {
    return cloneCollections(this.getStateForProfile(profileId).collections);
  },

  replaceForProfile(profileId, collections = [], { silentSync = false } = {}) {
    const normalized = normalizeState({ collections }).collections;
    store.replaceForProfile(profileId, { collections: normalized }, { silentSync: true });
    if (!silentSync) {
      queueCollectionSync(profileId);
    }
    return cloneCollections(normalized);
  },

  replace(collections = [], options = {}) {
    return this.replaceForProfile(options.profileId, collections, options);
  },

  exportToJson(collections = []) {
    return JSON.stringify(normalizeState({ collections }).collections);
  },

  importFromJson(json = "") {
    if (!stringOrEmpty(json)) {
      return [];
    }
    try {
      const parsed = JSON.parse(String(json));
      return normalizeState(parsed).collections;
    } catch (_) {
      return [];
    }
  },

  exportCurrentProfileJson(profileId = null) {
    return this.exportToJson(this.getForProfile(profileId));
  },

  upsertCollection(collection, options = {}) {
    const normalized = normalizeCollection(collection);
    if (!normalized) {
      return this.getForProfile(options.profileId);
    }
    const current = this.getForProfile(options.profileId);
    const next = current.filter((entry) => entry.id !== normalized.id);
    next.push(normalized);
    return this.replaceForProfile(options.profileId, next, options);
  },

  removeCollection(collectionId, options = {}) {
    const id = stringOrEmpty(collectionId);
    const next = this.getForProfile(options.profileId).filter((entry) => entry.id !== id);
    return this.replaceForProfile(options.profileId, next, options);
  }
};
