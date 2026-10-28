import { createProfileScopedStore } from "./profileScopedStore.js";

export const WatchProgressSource = {
  MDBLIST: "mdblist",
  TRAKT: "trakt",
  SIMKL: "simkl",
  NUVIO_SYNC: "nuvio_sync"
};

export const TraktLibrarySourceMode = {
  MDBLIST: "mdblist",
  TRAKT: "trakt",
  SIMKL: "simkl",
  LOCAL: "local"
};

export const SimklAnimeIdPreference = {
  IMDB: "imdb",
  MAL: "mal",
  KITSU: "kitsu",
  TVDB: "tvdb"
};

export const MoreLikeThisSourcePreference = {
  TRAKT: "trakt",
  TMDB: "tmdb"
};

export const TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL = 0;
export const TRAKT_DEFAULT_CONTINUE_WATCHING_DAYS_CAP = 60;

const STORE_KEY = "traktSettings";

function normalizeWatchProgressSource(value) {
  const normalized = String(value || WatchProgressSource.TRAKT).toLowerCase();
  if (normalized === WatchProgressSource.NUVIO_SYNC) return WatchProgressSource.NUVIO_SYNC;
  if (normalized === WatchProgressSource.SIMKL) return WatchProgressSource.SIMKL;
  if (normalized === WatchProgressSource.MDBLIST) return WatchProgressSource.MDBLIST;
  return WatchProgressSource.TRAKT;
}

function normalizeLibrarySourceMode(value) {
  const normalized = String(value || TraktLibrarySourceMode.TRAKT).toLowerCase();
  if (normalized === TraktLibrarySourceMode.MDBLIST) return TraktLibrarySourceMode.MDBLIST;
  if (normalized === TraktLibrarySourceMode.LOCAL) return TraktLibrarySourceMode.LOCAL;
  if (normalized === TraktLibrarySourceMode.SIMKL) return TraktLibrarySourceMode.SIMKL;
  return TraktLibrarySourceMode.TRAKT;
}

function normalizeSimklAnimeIdPreference(value) {
  const normalized = String(value || SimklAnimeIdPreference.IMDB).toLowerCase();
  return Object.values(SimklAnimeIdPreference).includes(normalized)
    ? normalized
    : SimklAnimeIdPreference.IMDB;
}

function normalizeMoreLikeThisSource(value) {
  return String(value || MoreLikeThisSourcePreference.TRAKT).toLowerCase() ===
    MoreLikeThisSourcePreference.TMDB
    ? MoreLikeThisSourcePreference.TMDB
    : MoreLikeThisSourcePreference.TRAKT;
}

export function normalizeTraktContinueWatchingDaysCap(days) {
  const value = Number(days);
  if (value === TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL) {
    return TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL;
  }
  if (!Number.isFinite(value)) {
    return TRAKT_DEFAULT_CONTINUE_WATCHING_DAYS_CAP;
  }
  return Math.max(7, Math.min(365, Math.trunc(value)));
}

function normalize(settings = {}) {
  return {
    continueWatchingDaysCap: normalizeTraktContinueWatchingDaysCap(
      settings.continueWatchingDaysCap
    ),
    showMetaComments: settings.showMetaComments !== false,
    watchProgressSource: normalizeWatchProgressSource(settings.watchProgressSource),
    librarySourceMode: normalizeLibrarySourceMode(settings.librarySourceMode),
    simklAnimeIdPreference: normalizeSimklAnimeIdPreference(settings.simklAnimeIdPreference),
    moreLikeThisSource: normalizeMoreLikeThisSource(settings.moreLikeThisSource)
  };
}

const store = createProfileScopedStore({
  key: STORE_KEY,
  normalize
});

// Remembered choices belong to this device and profile, never to the cloud
// settings payload or to a newly created profile seeded from the primary one.
const sourceMemory = createProfileScopedStore({
  key: "trackingSourceMemory",
  seedFromPrimary: false,
  normalize: (value = {}) => ({
    rememberedWatchProgressSource: ["trakt", "simkl"].includes(value.rememberedWatchProgressSource)
      ? value.rememberedWatchProgressSource
      : null,
    rememberedLibrarySourceMode: ["trakt", "simkl"].includes(value.rememberedLibrarySourceMode)
      ? value.rememberedLibrarySourceMode
      : null
  })
});

function applySourceSelection(profileId, partial) {
  if (!Object.keys(partial).length) return;
  const { rememberedWatchProgressSource, rememberedLibrarySourceMode, ...selection } = partial;
  const memory = {};
  if (rememberedWatchProgressSource !== undefined)
    memory.rememberedWatchProgressSource = rememberedWatchProgressSource;
  if (rememberedLibrarySourceMode !== undefined)
    memory.rememberedLibrarySourceMode = rememberedLibrarySourceMode;
  sourceMemory.setForProfile(profileId, memory, { silentSync: true });
  store.setForProfile(profileId, selection);
}

export const TraktSettingsStore = {
  get() {
    return { ...store.get(), ...sourceMemory.get() };
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  getForProfile(profileId) {
    return { ...store.getForProfile(profileId), ...sourceMemory.getForProfile(profileId) };
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  providerDisconnected(provider, profileId) {
    if (!["trakt", "simkl"].includes(provider)) return;
    const current = this.getForProfile(profileId);
    const partial = {};
    if (current.watchProgressSource === provider) {
      partial.rememberedWatchProgressSource = provider;
      partial.watchProgressSource = WatchProgressSource.NUVIO_SYNC;
    }
    if (current.librarySourceMode === provider) {
      partial.rememberedLibrarySourceMode = provider;
      partial.librarySourceMode = TraktLibrarySourceMode.LOCAL;
    }
    applySourceSelection(profileId, partial);
  },

  providerConnected(provider, profileId) {
    if (!["trakt", "simkl"].includes(provider)) return;
    const current = this.getForProfile(profileId);
    const partial = {};
    if (
      current.rememberedWatchProgressSource === provider &&
      current.watchProgressSource === WatchProgressSource.NUVIO_SYNC
    ) {
      partial.watchProgressSource = provider;
      partial.rememberedWatchProgressSource = null;
    }
    if (
      current.rememberedLibrarySourceMode === provider &&
      current.librarySourceMode === TraktLibrarySourceMode.LOCAL
    ) {
      partial.librarySourceMode = provider;
      partial.rememberedLibrarySourceMode = null;
    }
    applySourceSelection(profileId, partial);
  },

  setContinueWatchingDaysCap(days) {
    return this.set({ continueWatchingDaysCap: normalizeTraktContinueWatchingDaysCap(days) });
  },

  setShowMetaComments(enabled) {
    return this.set({ showMetaComments: Boolean(enabled) });
  },

  setWatchProgressSource(source) {
    sourceMemory.set({ rememberedWatchProgressSource: null }, { silentSync: true });
    return this.set({ watchProgressSource: normalizeWatchProgressSource(source) });
  },

  setLibrarySourceMode(mode) {
    sourceMemory.set({ rememberedLibrarySourceMode: null }, { silentSync: true });
    return this.set({ librarySourceMode: normalizeLibrarySourceMode(mode) });
  },

  setSimklAnimeIdPreference(preference) {
    return this.set({
      simklAnimeIdPreference: normalizeSimklAnimeIdPreference(preference)
    });
  },

  setMoreLikeThisSource(source) {
    return this.set({ moreLikeThisSource: normalizeMoreLikeThisSource(source) });
  }
};
