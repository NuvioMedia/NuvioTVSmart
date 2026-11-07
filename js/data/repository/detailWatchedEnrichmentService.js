import { watchedItemsRepository } from "./watchedItemsRepository.js";
import { watchProgressRepository } from "./watchProgressRepository.js";
import { TraktAuthService } from "./traktAuthService.js";
import { watchedItemsShareIdentity } from "./watchedIdentity.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { WatchProgressSource } from "../local/traktSettingsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { episodeMappingEntries } from "../../core/tracking/episodeMapping.js";
import { TraktEpisodeMappingService } from "./traktEpisodeMappingService.js";
import { MdbListEpisodeMappingService } from "./mdbListEpisodeMappingService.js";

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE = new Map();

function buildCacheKey(contentId, traktId) {
  const profileId = ProfileManager.getActiveProfileId() || "default";
  return (
    `${profileId}:${contentId}:${traktId}` +
    (isMdbListSelected()
      ? `:${watchProgressRepository.getContinueWatchingSourceKey()}:${LocalStore.revision("mdbListTracking")}:${LocalStore.revision("mdbListTrackingPlayback")}`
      : "")
  );
}

function getCachedEntry(cacheKey) {
  const entry = CACHE.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedEntry(cacheKey, value) {
  CACHE.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

function buildEpisodeKey(season, episode) {
  return `${season}:${episode}`;
}

async function fetchLocalWatchedMap(contentReference = {}) {
  const allWatched = await watchedItemsRepository.getAll(isMdbListSelected() ? Infinity : 2000);
  const watchedMap = new Map();

  for (const item of allWatched) {
    if (!watchedItemsShareIdentity(item, contentReference)) continue;
    if (item.contentType === "series" && item.season != null && item.episode != null) {
      const key = buildEpisodeKey(item.season, item.episode);
      watchedMap.set(key, {
        isWatched: true,
        watchedAt: item.watchedAt || null,
        source: item.source || "local",
        tmdbId: item.tmdbId || null,
        imdbId: item.imdbId || null,
        episodeNumberMapped: item.episodeNumberMapped === true
      });
    } else if (item.contentType === "movie") {
      watchedMap.set("movie", {
        isWatched: true,
        watchedAt: item.watchedAt || null,
        source: "local"
      });
    }
  }

  return watchedMap;
}

function isMdbListSelected() {
  return watchProgressRepository.getContinueWatchingSource() === WatchProgressSource.MDBLIST;
}

async function fetchProgressWatchedMap(contentReference = {}) {
  const allProgress = await (isMdbListSelected()
    ? watchProgressRepository.getAllForContinueWatching()
    : watchProgressRepository.getAll());
  const progressMap = new Map();

  for (const progress of allProgress) {
    if (!watchedItemsShareIdentity(progress, contentReference)) continue;
    const fraction =
      Number(progress.durationMs || 0) > 0
        ? Number(progress.positionMs || 0) / Number(progress.durationMs || 0)
        : 0;

    if (fraction >= 1.0 && progress.videoId) {
      const videoIdParts = progress.videoId.split(":");
      if (videoIdParts.length >= 3) {
        const season = parseInt(videoIdParts[1], 10);
        const episode = parseInt(videoIdParts[2], 10);
        if (!Number.isNaN(season) && !Number.isNaN(episode)) {
          const key = buildEpisodeKey(season, episode);
          progressMap.set(key, {
            isWatched: true,
            watchedAt: progress.updatedAt || null,
            source: progress.source || "progress",
            tmdbId: progress.tmdbId || null,
            imdbId: progress.imdbId || null,
            episodeNumberMapped: progress.episodeNumberMapped === true
          });
        }
      }
    } else if (fraction >= 1.0 && progress.contentType === "movie") {
      progressMap.set("movie", {
        isWatched: true,
        watchedAt: progress.updatedAt || null,
        source: "progress"
      });
    }
  }

  return progressMap;
}

async function fetchTraktSeriesWatchedMap(showTraktId) {
  if (!showTraktId || isMdbListSelected()) return new Map();

  const isAuthenticated = await TraktAuthService.isAuthenticated();
  if (!isAuthenticated) return new Map();

  try {
    const watchedMap = await TraktAuthService.fetchWatchedProgress(showTraktId);
    return watchedMap || new Map();
  } catch (error) {
    console.warn("[detailWatchedEnrichmentService] Failed to fetch Trakt series progress", error);
    return new Map();
  }
}

async function fetchTraktMovieWatchedState(movieTraktId) {
  if (!movieTraktId || isMdbListSelected()) return null;

  const isAuthenticated = await TraktAuthService.isAuthenticated();
  if (!isAuthenticated) return null;

  try {
    const watchedMovies = await TraktAuthService.fetchWatchedMovies();
    const watchedMovie = watchedMovies.find(
      (movie) => String(movie.traktId || "") === String(movieTraktId || "")
    );

    if (watchedMovie) {
      return {
        isWatched: true,
        watchedAt: watchedMovie.watchedAt || null,
        source: "trakt"
      };
    }

    return null;
  } catch (error) {
    console.warn(
      "[detailWatchedEnrichmentService] Failed to fetch Trakt movie watched state",
      error
    );
    return null;
  }
}

function mergeWatchedStates(localMap, progressMap, traktMap) {
  const mergedMap = new Map();
  const allKeys = new Set([...localMap.keys(), ...progressMap.keys(), ...traktMap.keys()]);

  for (const key of allKeys) {
    const localState = localMap.get(key);
    const progressState = progressMap.get(key);
    const traktState = traktMap.get(key);

    if (localState) {
      mergedMap.set(key, localState);
    } else if (progressState) {
      mergedMap.set(key, progressState);
    } else if (traktState) {
      mergedMap.set(key, traktState);
    }
  }

  return mergedMap;
}

function parseEpisodeMapKey(key) {
  const [season, episode] = String(key || "")
    .split(":")
    .map((part) => Number(part));
  return Number.isInteger(season) && Number.isInteger(episode) && season > 0 && episode > 0
    ? { season, episode }
    : null;
}

function isMdbListSource(source) {
  return String(source || "")
    .toLowerCase()
    .startsWith("mdblist");
}

/**
 * Trakt watched episodes are numbered the way Trakt splits the show. Translate the ones the
 * add-on does not have into the add-on's numbering, leaving every other key untouched.
 */
async function remapTraktWatchedMap(map, { contentId, showTraktId, addonEpisodes }) {
  if (!map.size || !addonEpisodes.length) {
    return map;
  }
  const remapped = new Map();
  for (const [key, state] of map) {
    const episode = parseEpisodeMapKey(key);
    if (!episode) {
      remapped.set(key, state);
      continue;
    }
    let mapping = null;
    try {
      mapping = await TraktEpisodeMappingService.resolveTraktToAddon({
        contentId,
        contentType: "series",
        season: episode.season,
        episode: episode.episode,
        title: null,
        traktId: showTraktId,
        addonEpisodes
      });
    } catch (_) {
      mapping = null;
    }
    if (!mapping) {
      remapped.set(key, state);
      continue;
    }
    const mappedKey = buildEpisodeKey(mapping.season, mapping.episode);
    if (!remapped.has(mappedKey)) {
      remapped.set(mappedKey, state);
    }
  }
  return remapped;
}

/** MDBList numbers episodes as TMDB does; translate only the MDBList-sourced entries. */
async function remapMdbListWatchedMap(map, { contentId, addonEpisodes }) {
  if (!map.size || !addonEpisodes.length || !isMdbListSelected()) {
    return map;
  }
  const remapped = new Map();
  for (const [key, state] of map) {
    const episode = parseEpisodeMapKey(key);
    if (!episode || !isMdbListSource(state?.source) || state?.episodeNumberMapped === true) {
      remapped.set(key, state);
      continue;
    }
    let mapping = null;
    try {
      mapping = await MdbListEpisodeMappingService.resolveToAddon({
        contentId,
        ids: { tmdb: state.tmdbId, imdb: state.imdbId },
        tmdbShowId: state.tmdbId,
        season: episode.season,
        episode: episode.episode,
        title: null,
        addonEpisodes
      });
    } catch (_) {
      mapping = null;
    }
    if (!mapping) {
      remapped.set(key, state);
      continue;
    }
    const mappedKey = buildEpisodeKey(mapping.season, mapping.episode);
    if (!remapped.has(mappedKey)) {
      remapped.set(mappedKey, state);
    }
  }
  return remapped;
}

export const detailWatchedEnrichmentService = {
  async enrichSeriesWatchedState(episodes, contentId, showTraktId) {
    if (!contentId) return new Map();

    const cacheKey = buildCacheKey(contentId, showTraktId || "none");
    const cached = getCachedEntry(cacheKey);
    if (cached) return cached;

    const [localMap, progressMap, traktMap] = await Promise.all([
      fetchLocalWatchedMap({ contentId, traktId: showTraktId }),
      fetchProgressWatchedMap({ contentId, traktId: showTraktId }),
      fetchTraktSeriesWatchedMap(showTraktId)
    ]);

    const addonEpisodes = episodeMappingEntries(episodes);
    const [addonLocalMap, addonProgressMap, addonTraktMap] = await Promise.all([
      remapMdbListWatchedMap(localMap, { contentId, addonEpisodes }),
      remapMdbListWatchedMap(progressMap, { contentId, addonEpisodes }),
      remapTraktWatchedMap(traktMap, { contentId, showTraktId, addonEpisodes })
    ]);

    const mergedMap = mergeWatchedStates(addonLocalMap, addonProgressMap, addonTraktMap);
    setCachedEntry(cacheKey, mergedMap);

    return mergedMap;
  },

  async enrichMovieWatchedState(contentId, movieTraktId) {
    if (!contentId) return null;

    const cacheKey = buildCacheKey(contentId, movieTraktId || "none");
    const cached = getCachedEntry(cacheKey);
    if (cached) return cached;

    const [localMap, progressMap] = await Promise.all([
      fetchLocalWatchedMap({ contentId, traktId: movieTraktId }),
      fetchProgressWatchedMap({ contentId, traktId: movieTraktId })
    ]);

    const localState = localMap.get("movie");
    const progressState = progressMap.get("movie");

    if (localState) {
      setCachedEntry(cacheKey, localState);
      return localState;
    }

    if (progressState) {
      setCachedEntry(cacheKey, progressState);
      return progressState;
    }

    const traktState = await fetchTraktMovieWatchedState(movieTraktId);
    if (traktState) {
      setCachedEntry(cacheKey, traktState);
      return traktState;
    }

    const unwatchedState = {
      isWatched: false,
      watchedAt: null,
      source: "local"
    };
    setCachedEntry(cacheKey, unwatchedState);
    return unwatchedState;
  },

  invalidateCache(contentId) {
    if (!contentId) return;
    const profileId = ProfileManager.getActiveProfileId() || "default";
    for (const [key] of CACHE) {
      if (key.startsWith(`${profileId}:${contentId}:`)) {
        CACHE.delete(key);
      }
    }
  },

  invalidateAllCache() {
    CACHE.clear();
  }
};
