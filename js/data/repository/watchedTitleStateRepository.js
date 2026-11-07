import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { TraktAuthService } from "./traktAuthService.js";
import { metaRepository } from "./metaRepository.js";
import { watchedItemsRepository } from "./watchedItemsRepository.js";
import { getReleasedMainEpisodes, isSeriesType } from "./watchedSeriesReconciliationService.js";
import { watchedItemIdentityValues, watchedItemsShareIdentity } from "./watchedIdentity.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";

const META_TIMEOUT_MS = 2500;
const META_CONCURRENCY = 2;

function withTimeout(promise, timeoutMs, fallback) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function shouldUseTrakt() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.TRAKT &&
    TraktAuthService.isAuthenticated()
  );
}

function identityKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildRemoteShowIndex(shows = []) {
  const byIdentity = new Map();
  (Array.isArray(shows) ? shows : []).forEach((show) => {
    watchedItemIdentityValues(show).forEach((identity) => {
      const key = identityKey(identity);
      if (!key) {
        return;
      }
      const entries = byIdentity.get(key) || [];
      if (!entries.includes(show)) {
        entries.push(show);
      }
      byIdentity.set(key, entries);
    });
  });
  return byIdentity;
}

function isStrongIdentity(identity) {
  const normalized = identityKey(identity);
  return normalized.startsWith("tmdb:") || normalized.startsWith("trakt:");
}

function matchingRemoteShows(item, byIdentity) {
  const matches = new Set();
  watchedItemIdentityValues(item).forEach((identity) => {
    const candidates = byIdentity.get(identityKey(identity)) || [];
    // A shared IMDB identity can represent multiple Trakt show entries (for
    // example anthology/season splits). Never merge those entries unless the
    // catalog also supplied a stable TMDB or Trakt identity.
    if (candidates.length > 1 && !isStrongIdentity(identity)) {
      return;
    }
    candidates.forEach((candidate) => matches.add(candidate));
  });
  return Array.from(matches);
}

function watchedEpisodeKeys(show = {}) {
  const keys = new Set();
  (Array.isArray(show?.seasons) ? show.seasons : []).forEach((season) => {
    const seasonNumber = Number(season?.number || 0);
    if (seasonNumber <= 0) {
      return;
    }
    (Array.isArray(season?.episodes) ? season.episodes : []).forEach((episode) => {
      const episodeNumber = Number(episode?.number || 0);
      if (episodeNumber > 0 && Number(episode?.plays || 0) > 0) {
        keys.add(`${seasonNumber}:${episodeNumber}`);
      }
    });
  });
  return keys;
}

/**
 * Builds watched (season, episode) sets from the merged watched-items projection
 * used by MDBList, Simkl and Nuvio Sync, so they get the same fully-watched
 * series badges as Trakt. Specials stay out of the comparison like Android.
 */
function buildWatchedEpisodeIndex(watchedItems = []) {
  const byIdentity = new Map();
  (Array.isArray(watchedItems) ? watchedItems : []).forEach((item) => {
    const seasonNumber = Number(item?.season);
    const episodeNumber = Number(item?.episode);
    if (!(seasonNumber > 0) || !(episodeNumber > 0)) {
      return;
    }
    const contentKey = String(item?.contentId || item?.id || "").trim();
    if (!contentKey) {
      return;
    }
    const key = `${seasonNumber}:${episodeNumber}`;
    watchedItemIdentityValues(item).forEach((identity) => {
      const normalized = identityKey(identity);
      if (!normalized) {
        return;
      }
      const groups = byIdentity.get(normalized) || new Map();
      const keys = groups.get(contentKey) || new Set();
      keys.add(key);
      groups.set(contentKey, keys);
      byIdentity.set(normalized, groups);
    });
  });
  return byIdentity;
}

function matchingWatchedEpisodeKeys(item, byIdentity) {
  const keys = new Set();
  watchedItemIdentityValues(item).forEach((identity) => {
    const groups = byIdentity.get(identityKey(identity));
    if (!groups) {
      return;
    }
    // Same ambiguity rule as the Trakt show index: a shared IMDB identity can
    // cover separate provider entries, so only merge it on a strong catalog ID.
    if (groups.size > 1 && !isStrongIdentity(identity)) {
      return;
    }
    groups.forEach((groupKeys) => groupKeys.forEach((key) => keys.add(key)));
  });
  return keys;
}

function metaIdCandidates(item = {}) {
  const ids = [];
  watchedItemIdentityValues(item).forEach((value) => {
    const normalized = String(value || "").trim();
    if (normalized && !ids.includes(normalized)) {
      ids.push(normalized);
    }
  });
  return ids;
}

async function loadSeriesMeta(item = {}) {
  if (Array.isArray(item.videos)) {
    return item;
  }
  const requestedTypes = [item.apiType, item.type, "series", "tv", "anime"]
    .map((type) =>
      String(type || "")
        .trim()
        .toLowerCase()
    )
    .filter((type, index, values) => type && values.indexOf(type) === index);
  const ids = metaIdCandidates(item);

  for (const type of requestedTypes) {
    for (const id of ids) {
      const result = await withTimeout(
        metaRepository.getMetaFromAllAddons(type, id),
        META_TIMEOUT_MS,
        { status: "error" }
      ).catch(() => ({ status: "error" }));
      if (result?.status === "success" && result.data) {
        return result.data;
      }
    }
  }
  return null;
}

function buildSyntheticSeriesMarker(item, remoteShows = []) {
  const remote = remoteShows[0] || {};
  const watchedAt = remoteShows.reduce((latest, show) => {
    const value = new Date(show?.lastWatchedAt || 0).getTime();
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, 0);
  return {
    contentId: String(item.id || item.contentId || "").trim(),
    contentType: String(item.type || item.apiType || "series").trim() || "series",
    title: item.name || item.title || remote.title || item.id,
    watchedAt: watchedAt || Date.now(),
    imdbId: item.imdbId || remote.imdbId || null,
    tmdbId: item.tmdbId || remote.tmdbId || null,
    traktId: item.traktId || remote.traktId || null,
    slug: item.slug || remote.slug || null,
    source: "trakt_fully_watched_series"
  };
}

/**
 * Projects provider watched episodes into the root watched markers consumed by
 * Home/Library badges. A series is marked only after the same released-main-
 * episode comparison used by the local reconciliation path succeeds. The same
 * projection runs for every watch-progress source, as Android does.
 */
class WatchedTitleStateRepository {
  async getTitleWatchedItems(items = [], { baseWatchedItems = null, limit = 2000 } = {}) {
    const base = Array.isArray(baseWatchedItems)
      ? baseWatchedItems
      : await watchedItemsRepository.getAll(limit).catch(() => []);

    const catalogSeries = [];
    const seenCatalogKeys = new Set();
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || !isSeriesType(item.type || item.apiType || item.contentType)) {
        return;
      }
      const contentId = String(item.id || item.contentId || "").trim();
      if (!contentId) {
        return;
      }
      const key = `${String(item.type || item.apiType || "series").toLowerCase()}:${contentId}`;
      if (seenCatalogKeys.has(key)) {
        return;
      }
      seenCatalogKeys.add(key);
      catalogSeries.push({ ...item, id: contentId });
    });
    if (!catalogSeries.length) {
      return base;
    }

    const useTrakt = shouldUseTrakt();
    let remoteIndex = null;
    let watchedEpisodeIndex = null;
    if (useTrakt) {
      const remoteShows = await watchedItemsRepository.getRemoteTraktWatchedShows().catch(() => []);
      if (!remoteShows.length) {
        return base;
      }
      remoteIndex = buildRemoteShowIndex(remoteShows);
    } else {
      watchedEpisodeIndex = buildWatchedEpisodeIndex(base);
      if (!watchedEpisodeIndex.size) {
        return base;
      }
    }

    const evaluations = await mapWithConcurrency(
      catalogSeries,
      META_CONCURRENCY,
      async (catalogItem) => {
        const matches = useTrakt ? matchingRemoteShows(catalogItem, remoteIndex) : [];
        if (useTrakt && !matches.length) {
          return { catalogItem, state: "unknown" };
        }
        const remoteWatched = useTrakt
          ? new Set(matches.flatMap((show) => Array.from(watchedEpisodeKeys(show))))
          : matchingWatchedEpisodeKeys(catalogItem, watchedEpisodeIndex);
        // Android does not validate or clear a badge when the watched-episode
        // map has no episode entry at all. Preserve the existing state for an
        // incomplete/empty provider projection instead of treating it as a
        // trustworthy partial show.
        if (!remoteWatched.size) {
          return { catalogItem, state: "unknown" };
        }
        const meta = await loadSeriesMeta(catalogItem);
        const releasedEpisodes = getReleasedMainEpisodes(meta || {});
        if (!releasedEpisodes.length) {
          return { catalogItem, state: "unknown" };
        }
        const allWatched = releasedEpisodes.every((episode) =>
          remoteWatched.has(`${episode.season}:${episode.episode}`)
        );
        // Android keeps a count fallback for provider/catalog episode-ID
        // remaps. Restrict it to the same matched show and aired-episode set;
        // it must not turn an unknown metadata response into a badge.
        const fullyWatched =
          allWatched || (!allWatched && remoteWatched.size >= releasedEpisodes.length);
        return {
          catalogItem,
          state: fullyWatched ? "fully-watched" : "partial"
        };
      }
    );

    const partialItems = evaluations
      .filter((evaluation) => evaluation.state === "partial")
      .map((evaluation) => evaluation.catalogItem);
    const fullyWatchedMarkers = evaluations
      .filter((evaluation) => evaluation.state === "fully-watched")
      .map((evaluation) =>
        buildSyntheticSeriesMarker(
          evaluation.catalogItem,
          useTrakt ? matchingRemoteShows(evaluation.catalogItem, remoteIndex) : []
        )
      );

    const withoutKnownPartialRoots = base.filter((entry) => {
      if (
        entry?.season != null ||
        entry?.episode != null ||
        !isSeriesType(entry?.contentType || entry?.type)
      ) {
        return true;
      }
      return !partialItems.some((catalogItem) => watchedItemsShareIdentity(entry, catalogItem));
    });
    return [...withoutKnownPartialRoots, ...fullyWatchedMarkers];
  }
}

export const watchedTitleStateRepository = new WatchedTitleStateRepository();
