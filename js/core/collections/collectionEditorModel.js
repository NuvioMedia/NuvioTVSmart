import {
  CollectionFolderViewMode,
  CollectionPosterShape
} from "../../data/local/collectionsStore.js";

export const COLLECTION_VIEW_MODES = [
  CollectionFolderViewMode.TABBED_GRID,
  CollectionFolderViewMode.ROWS,
  CollectionFolderViewMode.FOLLOW_LAYOUT
];

export const COLLECTION_TILE_SHAPES = [
  CollectionPosterShape.SQUARE,
  CollectionPosterShape.POSTER,
  CollectionPosterShape.LANDSCAPE
];

export function nextInList(values = [], current = null) {
  const list = Array.isArray(values) ? values : [];
  const index = list.indexOf(current);
  return list[(index + 1 + list.length) % Math.max(1, list.length)] || list[0];
}

export function createEmptyCollectionDraft(id) {
  return {
    id: String(id || ""),
    title: "",
    backdropImageUrl: null,
    pinToTop: false,
    focusGlowEnabled: true,
    viewMode: CollectionFolderViewMode.TABBED_GRID,
    showAllTab: true,
    folders: []
  };
}

export function createEmptyFolderDraft(id) {
  return {
    id: String(id || ""),
    title: "",
    coverImageUrl: null,
    focusGifUrl: null,
    focusGifEnabled: true,
    coverEmoji: null,
    tileShape: CollectionPosterShape.SQUARE,
    hideTitle: false,
    sources: [],
    catalogSources: [],
    heroBackdropUrl: null,
    heroVideoUrl: null,
    titleLogoUrl: null
  };
}

export function canSaveCollectionDraft(draft = {}) {
  return (
    Boolean(String(draft?.title || "").trim()) &&
    Array.isArray(draft?.folders) &&
    draft.folders.length > 0
  );
}

/** Accepts a bare numeric id or a URL/link that contains one. */
export function parseNumericSourceId(value = "") {
  const match = String(value || "").match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : null;
}

export function buildTmdbCollectionSource(tmdbId) {
  const id = parseNumericSourceId(tmdbId);
  if (!id) {
    return null;
  }
  return {
    provider: "tmdb",
    tmdbSourceType: "COLLECTION",
    title: `TMDB Collection ${id}`,
    tmdbId: id,
    mediaType: "MOVIE",
    sortBy: "original_order",
    filters: {}
  };
}

export function buildTraktListSource(listId) {
  const id = parseNumericSourceId(listId);
  if (!id) {
    return null;
  }
  return {
    provider: "trakt",
    title: `Trakt List ${id}`,
    traktListId: id,
    mediaType: "MOVIE",
    sortBy: "rank",
    sortHow: "asc"
  };
}

export function buildAddonCatalogSource(catalog = {}) {
  const addonId = String(catalog.addonId || catalog.addonBaseUrl || "").trim();
  const type = String(catalog.type || "")
    .trim()
    .toLowerCase();
  const catalogId = String(catalog.catalogId || "").trim();
  if (!addonId || !type || !catalogId) {
    return null;
  }
  return {
    provider: "addon",
    addonId,
    addonBaseUrl: catalog.addonBaseUrl || null,
    addonName: catalog.addonName || null,
    type,
    catalogId,
    catalogName: catalog.catalogName || null,
    title: catalog.catalogName || catalog.catalogId || "Catalog",
    genre: null
  };
}

export function sourceIdentity(source = {}) {
  const provider = String(source.provider || "addon").toLowerCase();
  if (provider === "addon") {
    return `addon:${source.addonId || ""}:${source.type || ""}:${source.catalogId || ""}`;
  }
  if (provider === "tmdb") {
    return `tmdb:${source.tmdbSourceType || ""}:${source.tmdbId || ""}`;
  }
  return `trakt:${source.traktListId || ""}`;
}

export function folderHasSource(folder = {}, source = {}) {
  const identity = sourceIdentity(source);
  return (Array.isArray(folder.sources) ? folder.sources : []).some(
    (entry) => sourceIdentity(entry) === identity
  );
}

export function addSourceToFolder(folder = {}, source = null) {
  return addSourcesToFolder(folder, [source]);
}

export function removeSourceFromFolder(folder = {}, index = -1) {
  const sources = Array.isArray(folder.sources) ? [...folder.sources] : [];
  if (index < 0 || index >= sources.length) {
    return folder;
  }
  sources.splice(index, 1);
  return { ...folder, sources };
}

export function moveSourceInFolder(folder = {}, index = 0, direction = 0) {
  const sources = Array.isArray(folder.sources) ? [...folder.sources] : [];
  const target = index + direction;
  if (index < 0 || index >= sources.length || target < 0 || target >= sources.length) {
    return folder;
  }
  const [moved] = sources.splice(index, 1);
  sources.splice(target, 0, moved);
  return { ...folder, sources };
}

export function toggleCatalogSource(folder = {}, catalog = {}) {
  const source = buildAddonCatalogSource(catalog);
  if (!source) {
    return folder;
  }
  if (folderHasSource(folder, source)) {
    return {
      ...folder,
      sources: (folder.sources || []).filter(
        (entry) => sourceIdentity(entry) !== sourceIdentity(source)
      )
    };
  }
  return addSourceToFolder(folder, source);
}

export const TMDB_SOURCE_MODES = [
  "PRESETS",
  "LIST",
  "PRODUCTION",
  "NETWORK",
  "COLLECTION",
  "PERSON",
  "DIRECTOR",
  "DISCOVER"
];

export const TMDB_MEDIA_TYPES = ["MOVIE", "TV"];

export const TMDB_SORT_OPTIONS = {
  ORIGINAL: "original",
  POPULAR: "popularity.desc",
  VOTE_AVERAGE: "vote_average.desc",
  VOTE_COUNT: "vote_count.desc",
  RECENT: "primary_release_date.desc",
  RECENT_TV: "first_air_date.desc"
};

export const TRAKT_SORTS = ["rank", "added", "title", "released", "popularity", "votes"];
export const TRAKT_SORT_HOWS = ["asc", "desc"];

export const TMDB_PRESETS = [
  ["Marvel Studios", "COMPANY", 420, "MOVIE"],
  ["Walt Disney Pictures", "COMPANY", 2, "MOVIE"],
  ["Pixar", "COMPANY", 3, "MOVIE"],
  ["Lucasfilm", "COMPANY", 1, "MOVIE"],
  ["Warner Bros.", "COMPANY", 174, "MOVIE"],
  ["Netflix", "NETWORK", 213, "TV"],
  ["HBO", "NETWORK", 49, "TV"],
  ["Disney+", "NETWORK", 2739, "TV"],
  ["Prime Video", "NETWORK", 1024, "TV"],
  ["Hulu", "NETWORK", 453, "TV"],
  ["Apple TV+", "NETWORK", 2552, "TV"]
].map(([title, tmdbSourceType, tmdbId, mediaType]) => ({
  title,
  source: {
    provider: "tmdb",
    tmdbSourceType,
    title,
    tmdbId,
    mediaType,
    sortBy: TMDB_SORT_OPTIONS.POPULAR,
    filters: {}
  }
}));

export function tmdbSortOptionsForMode(mode) {
  const sorts = [];
  if (mode === "LIST" || mode === "COLLECTION") {
    sorts.push(TMDB_SORT_OPTIONS.ORIGINAL);
  }
  if (mode !== "LIST" && mode !== "COLLECTION") {
    sorts.push(TMDB_SORT_OPTIONS.POPULAR);
  }
  sorts.push(TMDB_SORT_OPTIONS.VOTE_AVERAGE, TMDB_SORT_OPTIONS.VOTE_COUNT);
  sorts.push(mode === "NETWORK" ? TMDB_SORT_OPTIONS.RECENT_TV : TMDB_SORT_OPTIONS.RECENT);
  return [...new Set(sorts)];
}

export function createTmdbSourceState() {
  return {
    mode: "PRESETS",
    input: "",
    titleInput: "",
    mediaType: "MOVIE",
    mediaBoth: false,
    sortBy: TMDB_SORT_OPTIONS.POPULAR,
    filters: emptyTmdbFilters(),
    companyResults: [],
    collectionResults: [],
    error: ""
  };
}

export function createTraktSourceState() {
  return {
    input: "",
    titleInput: "",
    mediaType: "MOVIE",
    mediaBoth: true,
    sortBy: "rank",
    sortHow: "asc",
    results: [],
    error: ""
  };
}

export function emptyTmdbFilters() {
  return {
    withGenres: null,
    withoutGenres: null,
    releaseDateGte: null,
    releaseDateLte: null,
    voteAverageGte: null,
    voteAverageLte: null,
    voteCountGte: null,
    withOriginalLanguage: null,
    withOriginCountry: null,
    withKeywords: null,
    withoutKeywords: null,
    withCompanies: null,
    withoutCompanies: null,
    withNetworks: null,
    year: null,
    watchRegion: null,
    withWatchProviders: null,
    withoutWatchProviders: null
  };
}

function nullableNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Fills the Android filter shape from a (possibly partial) draft. */
export function normalizeTmdbDraftFilters(filters = {}) {
  const raw = filters && typeof filters === "object" ? filters : {};
  const text = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  };
  return {
    withGenres: text(raw.withGenres),
    withoutGenres: text(raw.withoutGenres),
    releaseDateGte: text(raw.releaseDateGte),
    releaseDateLte: text(raw.releaseDateLte),
    voteAverageGte: nullableNumber(raw.voteAverageGte),
    voteAverageLte: nullableNumber(raw.voteAverageLte),
    voteCountGte: nullableNumber(raw.voteCountGte),
    withOriginalLanguage: text(raw.withOriginalLanguage),
    withOriginCountry: text(raw.withOriginCountry),
    withKeywords: text(raw.withKeywords),
    withoutKeywords: text(raw.withoutKeywords),
    withCompanies: text(raw.withCompanies),
    withoutCompanies: text(raw.withoutCompanies),
    withNetworks: text(raw.withNetworks),
    year: nullableNumber(raw.year),
    watchRegion: text(raw.watchRegion),
    withWatchProviders: text(raw.withWatchProviders),
    withoutWatchProviders: text(raw.withoutWatchProviders)
  };
}

export function tmdbSelectedMediaTypes(state = {}) {
  return state.mediaBoth === true ? ["MOVIE", "TV"] : [state.mediaType === "TV" ? "TV" : "MOVIE"];
}

export function titleWithMediaSuffix(title, mediaType, both, labels = {}) {
  const base = String(title || "").trim();
  if (both !== true) {
    return base;
  }
  const suffix = mediaType === "TV" ? labels.tv || "Series" : labels.movie || "Movies";
  return `${base} ${suffix}`.trim();
}

/** Which TMDB source types enable media/both controls in Android's basic form. */
export function tmdbModeUsesMediaControls(mode) {
  return ["PRODUCTION", "PERSON", "DIRECTOR", "DISCOVER"].includes(mode);
}

export function tmdbModeUsesFilters(mode) {
  return ["DISCOVER", "PRODUCTION", "NETWORK"].includes(mode);
}

export function buildTmdbSourcesFromState(state = {}, { titles = {}, defaultTitles = {} } = {}) {
  const mode = String(state.mode || "DISCOVER");
  const sourceType = {
    LIST: "LIST",
    PRODUCTION: "COMPANY",
    NETWORK: "NETWORK",
    COLLECTION: "COLLECTION",
    PERSON: "PERSON",
    DIRECTOR: "DIRECTOR",
    DISCOVER: "DISCOVER"
  }[mode];
  if (!sourceType) {
    return [];
  }
  const input = String(state.input || "").trim();
  const id = parseNumericSourceId(input);
  const isDiscover = sourceType === "DISCOVER";
  if (!isDiscover && !id) {
    return [];
  }
  const baseTitle = String(state.titleInput || "").trim();
  let mediaTypes = tmdbSelectedMediaTypes(state);
  if (sourceType === "NETWORK") {
    mediaTypes = ["TV"];
  } else if (sourceType === "LIST" || sourceType === "COLLECTION") {
    mediaTypes = ["MOVIE"];
  }
  const filters = tmdbModeUsesFilters(mode) ? normalizeTmdbDraftFilters(state.filters) : {};
  const build = (mediaType) => {
    const defaultTitle =
      defaultTitles[sourceType] ||
      {
        LIST: `TMDB List ${id ?? ""}`,
        NETWORK: `TMDB Network ${id ?? ""}`,
        COLLECTION: `TMDB Collection ${id ?? ""}`,
        COMPANY: `TMDB Company ${id ?? ""}`,
        PERSON: "TMDB Person Credits",
        DIRECTOR: "TMDB Director Credits",
        DISCOVER: "TMDB Discover"
      }[sourceType];
    const title = baseTitle || defaultTitle;
    const sortBy =
      mediaType === "TV" && state.sortBy === TMDB_SORT_OPTIONS.RECENT
        ? TMDB_SORT_OPTIONS.RECENT_TV
        : String(state.sortBy || TMDB_SORT_OPTIONS.POPULAR);
    return {
      provider: "tmdb",
      tmdbSourceType: sourceType,
      title: titleWithMediaSuffix(title, mediaType, mediaTypes.length > 1, titles),
      tmdbId: isDiscover ? null : id,
      mediaType,
      sortBy,
      filters
    };
  };
  return {
    sourceType,
    sources: mediaTypes.map(build)
  };
}

export function buildTraktSourcesFromState(state = {}, { titles = {}, defaultTitle = null } = {}) {
  const listId = parseNumericSourceId(state.input);
  if (!listId) {
    return [];
  }
  const mediaTypes =
    state.mediaBoth === true ? ["MOVIE", "TV"] : [state.mediaType === "TV" ? "TV" : "MOVIE"];
  const baseTitle = String(state.titleInput || "").trim() || defaultTitle || `Trakt List ${listId}`;
  return mediaTypes.map((mediaType) => ({
    provider: "trakt",
    title: titleWithMediaSuffix(baseTitle, mediaType, mediaTypes.length > 1, titles),
    traktListId: listId,
    mediaType,
    sortBy: TRAKT_SORTS.includes(state.sortBy) ? state.sortBy : "rank",
    sortHow: TRAKT_SORT_HOWS.includes(state.sortHow) ? state.sortHow : "asc"
  }));
}

export function replaceSourceInFolder(folder = {}, index = -1, sources = []) {
  const list = Array.isArray(folder.sources) ? [...folder.sources] : [];
  const replacement = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (index < 0 || index >= list.length || !replacement.length) {
    return addSourcesToFolder(folder, replacement);
  }
  list.splice(index, 1, ...replacement);
  return { ...folder, sources: list };
}

function sameSource(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

export function addSourcesToFolder(folder = {}, sources = []) {
  let next = folder;
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    if (!source) {
      return;
    }
    const existing = Array.isArray(next.sources) ? next.sources : [];
    if (existing.some((entry) => sameSource(entry, source))) {
      return;
    }
    next = { ...next, sources: [...existing, source] };
  });
  return next;
}
