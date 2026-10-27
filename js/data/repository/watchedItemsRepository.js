import { TraktAuthStore } from "../local/traktAuthStore.js";
import { requestTraktRefreshAfterWatchAction } from "./traktActivityRefreshState.js";
import {
  beginManualWatched,
  applyManualServerWatched,
  manualWatchedCurrent,
  captureManualWatched,
  finishManualWatched
} from "../mediaserver/manualServerWatched.js";
import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { MdbListAccount } from "./mdbListAccount.js";
import { MdbListTracking, mdbMutationTarget } from "./mdbListTracking.js";
import { SimklSyncService } from "./simklSyncService.js";
import { TraktAuthService, requestJson as traktRequestJson } from "./traktAuthService.js";
import { watchedItemIdentityValues, watchedItemsShareIdentity } from "./watchedIdentity.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function shouldUseSimkl() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.SIMKL &&
    SimklAuthStore.isAuthenticated()
  );
}

function shouldUseTrakt() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.TRAKT &&
    TraktAuthService.isAuthenticated()
  );
}

function isSimklConnected() {
  return SimklAuthStore.isAuthenticated();
}

function isTraktConnected() {
  return TraktAuthService.isAuthenticated();
}

function traktIds(item = {}) {
  const rawId = String(item.contentId || item.itemId || item.id || "").trim();
  const prefixed = rawId.match(/^(imdb|tmdb|trakt):(.+)$/i);
  const ids = {
    imdb: item.imdbId || (prefixed?.[1]?.toLowerCase() === "imdb" ? prefixed[2] : null),
    tmdb: item.tmdbId ?? (prefixed?.[1]?.toLowerCase() === "tmdb" ? Number(prefixed[2]) : null),
    trakt: item.traktId ?? (prefixed?.[1]?.toLowerCase() === "trakt" ? Number(prefixed[2]) : null)
  };
  if (!ids.imdb && /^tt\d+$/i.test(rawId)) ids.imdb = rawId;
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value != null && value !== "")
  );
}

function traktHistoryBody(item = {}) {
  const ids = traktIds(item);
  if (!Object.keys(ids).length) {
    throw new Error("This item has no Trakt-compatible ID");
  }
  const media = {
    title: item.title || item.name || undefined,
    year: item.year == null ? undefined : Number(item.year),
    ids
  };
  const isEpisode = item.season != null && item.episode != null;
  if (isEpisode) {
    media.seasons = [{ number: Number(item.season), episodes: [{ number: Number(item.episode) }] }];
  }
  const type = String(item.contentType || item.itemType || item.type || "movie").toLowerCase();
  return ["series", "show", "tv", "anime"].includes(type)
    ? { shows: [media] }
    : { movies: [media] };
}

async function writeTraktHistory(item, remove = false) {
  return writeTraktHistoryBatch([item], remove);
}

function historyMediaKey(media = {}) {
  const ids = Object.entries(media.ids || {}).sort(([left], [right]) =>
    String(left).localeCompare(String(right))
  );
  return ids.length
    ? JSON.stringify(ids)
    : `${String(media.title || "").toLowerCase()}::${String(media.year || "")}`;
}

function mergeTraktShow(target, source) {
  const merged = { ...target, ...source };
  const seasons = new Map(
    (target.seasons || []).map((season) => [
      Number(season.number),
      { ...season, episodes: [...(season.episodes || [])] }
    ])
  );
  (source.seasons || []).forEach((season) => {
    const seasonNumber = Number(season.number);
    const current = seasons.get(seasonNumber) || { number: seasonNumber, episodes: [] };
    const episodeNumbers = new Set(
      (current.episodes || []).map((episode) => Number(episode.number))
    );
    current.episodes = [
      ...(current.episodes || []),
      ...(season.episodes || []).filter((episode) => {
        const episodeNumber = Number(episode.number);
        if (episodeNumbers.has(episodeNumber)) {
          return false;
        }
        episodeNumbers.add(episodeNumber);
        return true;
      })
    ];
    seasons.set(seasonNumber, current);
  });
  if (seasons.size) {
    merged.seasons = Array.from(seasons.values()).sort((left, right) => left.number - right.number);
  }
  return merged;
}

function mergeTraktHistoryBodies(bodies = []) {
  const movies = new Map();
  const shows = new Map();
  bodies.forEach((body) => {
    (body?.movies || []).forEach((movie) => {
      movies.set(historyMediaKey(movie), movie);
    });
    (body?.shows || []).forEach((show) => {
      const key = historyMediaKey(show);
      shows.set(key, shows.has(key) ? mergeTraktShow(shows.get(key), show) : show);
    });
  });
  return {
    movies: Array.from(movies.values()),
    shows: Array.from(shows.values())
  };
}

async function writeTraktHistoryBatch(items = [], remove = false) {
  const bodies = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    try {
      bodies.push(traktHistoryBody(item));
    } catch (error) {
      console.warn("Trakt watched history write failed", error);
    }
  });
  const body = mergeTraktHistoryBodies(bodies);
  if (!body.movies.length && !body.shows.length) {
    return;
  }
  const token = await TraktAuthService.getValidAccessToken();
  if (!token) throw new Error("Trakt is not connected");
  const { response, payload } = await traktRequestJson(
    remove ? "/sync/history/remove" : "/sync/history",
    {
      method: "POST",
      body,
      authorization: `Bearer ${token}`
    }
  );
  if (!response.ok) {
    throw new Error(
      payload?.message || `Could not update Trakt watched history (${response.status})`
    );
  }
}

function watchedIdentityKeys(item = {}) {
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return Array.from(watchedItemIdentityValues(item)).map(
    (identity) => `${identity.toLowerCase()}::${season}::${episode}`
  );
}

const TRAKT_WATCHED_MOVIES_CACHE_TTL_MS = 30_000;
let traktWatchedMoviesCache = null;
let traktWatchedMoviesInFlight = null;
let traktWatchedShowsCache = null;
let traktWatchedShowsGeneration = 0;
let traktWatchedShowsInFlight = null;

export function invalidateTraktWatchedMoviesCache() {
  traktWatchedMoviesCache = null;
}

export function invalidateTraktWatchedShowsCache() {
  traktWatchedShowsGeneration++;
  traktWatchedShowsCache = null;
}

function invalidateTraktWatchedCaches() {
  invalidateTraktWatchedMoviesCache();
  invalidateTraktWatchedShowsCache();
}

function isSeriesWatchedItem(item = {}) {
  const type = String(item?.contentType || "").toLowerCase();
  return (
    type === "series" ||
    type === "tv" ||
    type === "show" ||
    item?.season != null ||
    item?.episode != null
  );
}

// Android refreshNow() after a watch action: refetch only the watched list the
// action touched and force the next Continue Watching reconciliation.
function invalidateTraktWatchedForItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  const shows = list.some(isSeriesWatchedItem);
  const movies = list.some((item) => !isSeriesWatchedItem(item));
  if (movies) invalidateTraktWatchedMoviesCache();
  if (shows) invalidateTraktWatchedShowsCache();
  requestTraktRefreshAfterWatchAction({ movies, shows });
}

async function getTraktWatchedMovies() {
  if (!shouldUseTrakt()) {
    return [];
  }

  const profileId = activeProfileId();
  const now = Date.now();
  if (
    traktWatchedMoviesCache?.profileId === profileId &&
    now - Number(traktWatchedMoviesCache.fetchedAt || 0) < TRAKT_WATCHED_MOVIES_CACHE_TTL_MS
  ) {
    return traktWatchedMoviesCache.items;
  }
  if (traktWatchedMoviesInFlight?.profileId === profileId) {
    return traktWatchedMoviesInFlight.promise;
  }

  const promise = TraktAuthService.fetchWatchedMovies()
    .then((items) => {
      const normalizedItems = Array.isArray(items) ? items : [];
      traktWatchedMoviesCache = {
        profileId,
        fetchedAt: Date.now(),
        items: normalizedItems
      };
      return normalizedItems;
    })
    .catch((error) => {
      console.warn("Trakt watched movies lookup failed", error);
      return traktWatchedMoviesCache?.profileId === profileId &&
        Array.isArray(traktWatchedMoviesCache.items)
        ? traktWatchedMoviesCache.items
        : [];
    })
    .finally(() => {
      if (traktWatchedMoviesInFlight?.promise === promise) {
        traktWatchedMoviesInFlight = null;
      }
    });
  traktWatchedMoviesInFlight = { profileId, promise };
  return promise;
}

async function getTraktWatchedShows({ strict = false } = {}) {
  if (!shouldUseTrakt()) {
    return [];
  }

  const profileId = activeProfileId();
  const generation = traktWatchedShowsGeneration;
  const auth = TraktAuthStore.get(profileId);
  const accountKey = JSON.stringify([
    auth.userSlug || auth.username || "",
    auth.userSlug || auth.username ? "" : auth.refreshToken
  ]);
  const fallback = (error) => {
    if (strict) throw error;
    console.warn("Trakt watched shows lookup failed", error);
    return traktWatchedShowsCache?.profileId === profileId &&
      traktWatchedShowsCache.accountKey === accountKey
      ? traktWatchedShowsCache.items
      : [];
  };
  const now = Date.now();
  if (
    traktWatchedShowsCache?.profileId === profileId &&
    traktWatchedShowsCache.accountKey === accountKey &&
    now - Number(traktWatchedShowsCache.fetchedAt || 0) < TRAKT_WATCHED_MOVIES_CACHE_TTL_MS
  ) {
    return traktWatchedShowsCache.items;
  }
  if (
    traktWatchedShowsInFlight?.profileId === profileId &&
    traktWatchedShowsInFlight.accountKey === accountKey &&
    traktWatchedShowsInFlight.generation === generation
  ) {
    return traktWatchedShowsInFlight.promise.catch(fallback);
  }

  const promise = TraktAuthService.fetchWatchedShows()
    .then((items) => {
      const currentAuth = TraktAuthStore.get(profileId);
      const currentAccountKey = JSON.stringify([
        currentAuth.userSlug || currentAuth.username || "",
        currentAuth.userSlug || currentAuth.username ? "" : currentAuth.refreshToken
      ]);
      if (
        generation !== traktWatchedShowsGeneration ||
        profileId !== activeProfileId() ||
        currentAccountKey !== accountKey ||
        !shouldUseTrakt()
      ) {
        throw new Error("Obsolete Trakt watched shows request");
      }
      if (!Array.isArray(items)) throw new Error("Invalid Trakt watched shows response");
      const normalizedItems = items;
      traktWatchedShowsCache = {
        profileId,
        accountKey,
        fetchedAt: Date.now(),
        items: normalizedItems
      };
      return normalizedItems;
    })
    .finally(() => {
      if (traktWatchedShowsInFlight?.promise === promise) {
        traktWatchedShowsInFlight = null;
      }
    });
  traktWatchedShowsInFlight = { profileId, accountKey, generation, promise };
  return promise.catch(fallback);
}

function toTraktWatchedShowEpisodeItems(show = {}) {
  if (!show?.contentId || !Array.isArray(show.seasons)) {
    return [];
  }
  const fallbackWatchedAt = show.lastWatchedAt
    ? new Date(show.lastWatchedAt).getTime()
    : Date.now();
  const watchedAt = Number.isFinite(fallbackWatchedAt) ? fallbackWatchedAt : Date.now();
  const items = [];
  show.seasons.forEach((season) => {
    const seasonNumber = Number(season?.number || 0);
    if (seasonNumber <= 0) {
      return;
    }
    (season?.episodes || []).forEach((episode) => {
      const episodeNumber = Number(episode?.number || 0);
      if (episodeNumber <= 0 || Number(episode?.plays || 0) <= 0) {
        return;
      }
      const episodeWatchedAt = episode?.lastWatchedAt
        ? new Date(episode.lastWatchedAt).getTime()
        : watchedAt;
      items.push({
        type: "series",
        contentType: "series",
        contentId: show.contentId,
        title: show.title,
        year: show.year,
        imdbId: show.imdbId,
        tmdbId: show.tmdbId,
        traktId: show.traktId,
        slug: show.slug || null,
        season: seasonNumber,
        episode: episodeNumber,
        watchedAt: Number.isFinite(episodeWatchedAt) ? episodeWatchedAt : watchedAt,
        source: "trakt_show_progress"
      });
    });
  });
  return items;
}

function watchedEpisodeRank(item = {}) {
  return Number(item.season || 0) * 100000 + Number(item.episode || 0);
}

function byWatchedAtDescending(left, right) {
  return Number(right?.watchedAt || 0) - Number(left?.watchedAt || 0);
}

/**
 * Trims a watched list to `limit` without dropping any title from it.
 *
 * The list is one entry per watched episode, in whatever order the tracker returned its library.
 * A handful of long-running series can therefore spend the whole budget before the rest is even
 * reached: a 1284-entry Simkl account projects to ~9000 episodes, and a plain slice at 2000 kept
 * only 81 of its 539 series - chosen by Simkl's ordering, not by anything the viewer did. Next Up
 * seeds from this list, so those series simply vanish from Continue Watching.
 *
 * Keeping the furthest-watched episode of every title first means each one stays represented, which
 * is all Next Up needs from it. The remaining budget then goes to the most recent episodes, which is
 * what the watched badges read.
 */
function limitWatchedItems(items, limit) {
  const all = Array.isArray(items) ? items : [];
  const max = Math.max(0, Number(limit || 0));
  if (max === 0) {
    return [];
  }
  if (!Number.isFinite(max) || all.length <= max) {
    return all;
  }

  const furthestByContent = new Map();
  all.forEach((item) => {
    const contentId = String(item?.contentId || "")
      .trim()
      .toLowerCase();
    if (!contentId) return;
    const existing = furthestByContent.get(contentId);
    const itemRank = watchedEpisodeRank(item);
    const existingRank = watchedEpisodeRank(existing);
    if (
      !existing ||
      itemRank > existingRank ||
      (itemRank === existingRank && Number(item?.watchedAt || 0) > Number(existing?.watchedAt || 0))
    ) {
      furthestByContent.set(contentId, item);
    }
  });

  const furthest = Array.from(furthestByContent.values()).sort(byWatchedAtDescending);
  const kept = new Set(furthest);
  const rest = all.filter((item) => !kept.has(item)).sort(byWatchedAtDescending);
  return [...furthest, ...rest].slice(0, max);
}

const watchedItemsSyncTimers = new Map();
const watchedItemsSyncInFlightByProfile = new Map();
let watchedItemsSyncGeneration = 0;

function queueWatchedItemsCloudSync(profileId = activeProfileId(), delayMs = 250) {
  const profileKey = String(profileId || "1");
  const generation = watchedItemsSyncGeneration;
  const existingTimer = watchedItemsSyncTimers.get(profileKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timerId = setTimeout(() => {
    if (generation !== watchedItemsSyncGeneration) {
      return;
    }
    watchedItemsSyncTimers.delete(profileKey);
    const runPush = async () => {
      if (generation !== watchedItemsSyncGeneration) {
        return;
      }
      const inFlight = watchedItemsSyncInFlightByProfile.get(profileKey);
      if (inFlight) {
        await inFlight.catch(() => false);
      }
      if (generation !== watchedItemsSyncGeneration) {
        return;
      }
      const pushPromise = import("../../core/profile/watchedItemsSyncService.js")
        .then(({ WatchedItemsSyncService }) => WatchedItemsSyncService.push(profileId))
        .catch((error) => {
          console.warn("Watched items cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (watchedItemsSyncInFlightByProfile.get(profileKey) === pushPromise) {
            watchedItemsSyncInFlightByProfile.delete(profileKey);
          }
        });
      watchedItemsSyncInFlightByProfile.set(profileKey, pushPromise);
      const didPush = await pushPromise;
      if (generation !== watchedItemsSyncGeneration) {
        return;
      }
      if (!didPush) {
        const retryDelayMs = getSyncBackoffRemainingMs();
        if (retryDelayMs > 0) {
          queueWatchedItemsCloudSync(profileId, Math.max(5000, retryDelayMs));
        }
      }
    };
    void runPush();
  }, delayMs);
  watchedItemsSyncTimers.set(profileKey, timerId);
}

function stopWatchedItemsCloudSync({ waitForInFlight = true } = {}) {
  const pending = waitForInFlight ? [...watchedItemsSyncInFlightByProfile.values()] : [];
  watchedItemsSyncGeneration += 1;
  watchedItemsSyncTimers.forEach((timerId) => clearTimeout(timerId));
  watchedItemsSyncTimers.clear();
  watchedItemsSyncInFlightByProfile.clear();
  if (!waitForInFlight || pending.length === 0) {
    return Promise.resolve(true);
  }
  return Promise.allSettled(pending).then(() => true);
}

registerSessionTeardownHandler?.(({ waitForInFlight = true } = {}) =>
  stopWatchedItemsCloudSync({ waitForInFlight })
);

function matchesWatchedTarget(item = {}, contentId, options = null) {
  const targetContentId = String(contentId || "").trim();
  if (
    !targetContentId ||
    !watchedItemsShareIdentity(item, { ...options, contentId: targetContentId })
  ) {
    return false;
  }
  const targetSeason =
    options?.season == null || options?.season === "" ? null : Number(options.season);
  const targetEpisode =
    options?.episode == null || options?.episode === "" ? null : Number(options.episode);
  if (options?.rootOnly === true) {
    return item.season == null && item.episode == null;
  }
  const hasScopedEpisode = targetSeason != null || targetEpisode != null;
  if (!hasScopedEpisode) {
    return true;
  }
  return item.season === targetSeason && item.episode === targetEpisode;
}

async function deleteWatchedItemsFromCloud(items = [], profileId = activeProfileId()) {
  if (!items.length) {
    return false;
  }
  try {
    const { WatchedItemsSyncService } =
      await import("../../core/profile/watchedItemsSyncService.js");
    return WatchedItemsSyncService.deleteItems(items, profileId);
  } catch (error) {
    console.warn("Watched items cloud delete failed", error);
    return false;
  }
}

async function writeWatchedItemsToProviders(items = [], mdbScope = null) {
  let succeeded = true;
  const profileId = activeProfileId();
  const validItems = (Array.isArray(items) ? items : []).filter((item) => item?.contentId);
  if (!validItems.length) {
    return;
  }
  if (isSimklConnected()) {
    try {
      await SimklSyncService.markWatchedBatch(validItems);
    } catch (error) {
      console.warn("Simkl watched history write failed", error);
    }
  }
  if (activeProfileId() !== profileId) return;
  if (mdbScope) {
    try {
      await MdbListTracking.writeHistory(validItems, false, mdbScope);
    } catch (error) {
      succeeded = false;
      console.warn("MDBList watched history write failed", error.code || error.message);
    }
  }
  if (activeProfileId() !== profileId) return;
  if (isTraktConnected()) {
    try {
      await writeTraktHistoryBatch(validItems, false);
    } catch (error) {
      console.warn("Trakt watched history write failed", error);
    }
  }
  return succeeded;
}

class WatchedItemsRepository {
  async getAll(limit = 2000, profileId = activeProfileId()) {
    const local = WatchedItemsStore.listForProfile(profileId);
    if (
      TraktSettingsStore.get().watchProgressSource === WatchProgressSource.MDBLIST &&
      MdbListAccount.connected()
    ) {
      const remote = await MdbListTracking.getWatchedItems();
      if (activeProfileId() !== String(profileId)) return [];
      return limitWatchedItems(
        [...remote, ...local.filter((item) => !mdbMutationTarget(item))],
        limit
      );
    }
    if (shouldUseTrakt()) {
      const [remoteMovies, remoteShows] = await Promise.all([
        getTraktWatchedMovies(),
        getTraktWatchedShows()
      ]);
      const remote = [
        ...remoteMovies,
        ...remoteShows.flatMap((show) => toTraktWatchedShowEpisodeItems(show))
      ];
      const remoteKeys = new Set(remote.flatMap(watchedIdentityKeys));
      return limitWatchedItems(
        [
          ...remote,
          ...local.filter((item) => !watchedIdentityKeys(item).some((key) => remoteKeys.has(key)))
        ],
        limit
      );
    }
    if (!shouldUseSimkl()) return local.slice(0, limit);
    const remote = await SimklSyncService.getWatchedItems().catch(() => []);
    const remoteKeys = new Set(remote.flatMap(watchedIdentityKeys));
    return limitWatchedItems(
      [
        ...remote,
        ...local.filter((item) => !watchedIdentityKeys(item).some((key) => remoteKeys.has(key)))
      ],
      limit
    );
  }

  async isWatched(contentId, options = {}) {
    const allowEpisodeEntries = Boolean(options?.allowEpisodeEntries);
    const all = await this.getAll(
      TraktSettingsStore.get().watchProgressSource === WatchProgressSource.MDBLIST &&
        MdbListAccount.connected()
        ? Infinity
        : 2000
    );
    return all.some((item) => {
      if (!watchedItemsShareIdentity(item, { ...options, contentId })) {
        return false;
      }
      if (options.season != null && options.episode != null)
        return (
          Number(item.season) === Number(options.season) &&
          Number(item.episode) === Number(options.episode)
        );
      return allowEpisodeEntries || (item.season == null && item.episode == null);
    });
  }

  async mark(item, options = {}) {
    if (!item?.contentId) return false;
    const result = await this.markBatch([item], options);
    return result.succeeded.length === 1;
  }

  async markBatch(items = [], options = {}) {
    const validItems = (Array.isArray(items) ? items : []).filter((item) => item?.contentId);
    const profileId = activeProfileId();
    const mdbScope = MdbListAccount.connected() ? MdbListAccount.scope() : null;
    const normalizedItems = validItems.map((item) => ({
      ...item,
      season: item.season == null || item.season === "" ? null : Number(item.season),
      episode: item.episode == null || item.episode === "" ? null : Number(item.episode),
      watchedAt: item.watchedAt || Date.now()
    }));
    const previous = WatchedItemsStore.listForProfile(profileId).filter((entry) =>
      normalizedItems.some(
        (item) =>
          entry.contentId === item.contentId &&
          entry.season === (item.season ?? null) &&
          entry.episode === (item.episode ?? null)
      )
    );
    const operation = beginManualWatched(normalizedItems, previous, profileId);
    WatchedItemsStore.upsertMany(normalizedItems, profileId);
    captureManualWatched(operation);
    invalidateTraktWatchedForItems(normalizedItems);
    const succeeded =
      options.skipTrackingWrite === true || options.skipServerWrite === true
        ? normalizedItems
        : await applyManualServerWatched(normalizedItems, true, operation);
    if (options.skipTrackingWrite === true || options.skipServerWrite === true)
      finishManualWatched(operation, normalizedItems, normalizedItems, true);
    let providerSucceeded = true;
    if (options.skipTrackingWrite !== true && activeProfileId() === profileId) {
      providerSucceeded = await writeWatchedItemsToProviders(
        succeeded.filter((item) => manualWatchedCurrent(operation, item)),
        mdbScope
      );
    }
    invalidateTraktWatchedForItems(normalizedItems);
    queueWatchedItemsCloudSync(profileId);
    const current = succeeded.filter((item) => manualWatchedCurrent(operation, item));
    return {
      ok: providerSucceeded && current.length === normalizedItems.length,
      succeeded: providerSucceeded ? current : []
    };
  }

  async unmark(contentId, options = null) {
    const pid = activeProfileId();
    const mdbScope = MdbListAccount.connected() ? MdbListAccount.scope() : null;
    const removedItems = WatchedItemsStore.listForProfile(pid).filter((item) =>
      matchesWatchedTarget(item, contentId, options)
    );
    const targets = removedItems.length
      ? removedItems.map((item) => ({
          ...options,
          ...item,
          videoId: item.videoId || options?.videoId || null
        }))
      : [
          {
            ...options,
            contentId,
            contentType: options?.contentType || "movie",
            season: options?.season ?? null,
            episode: options?.episode ?? null
          }
        ];
    const operation = beginManualWatched(targets, removedItems, pid);
    // Remove the local state first, matching Android's optimistic removal path.
    if (removedItems.length) {
      const remaining = WatchedItemsStore.listForProfile(pid).filter(
        (item) => !matchesWatchedTarget(item, contentId, options)
      );
      WatchedItemsStore.replaceForProfile(pid, remaining);
    } else {
      WatchedItemsStore.remove(contentId, pid, options);
    }
    invalidateTraktWatchedForItems(targets);

    captureManualWatched(operation);
    if (options?.skipTrackingWrite !== true && options?.skipServerWrite !== true) {
      const succeeded = await applyManualServerWatched(targets, false, operation);
      if (succeeded.length !== targets.length) {
        invalidateTraktWatchedForItems(targets);
        queueWatchedItemsCloudSync(pid);
        return false;
      }
    }
    if (options?.skipTrackingWrite === true || options?.skipServerWrite === true)
      finishManualWatched(operation, targets, targets, false);
    const isCurrent = () =>
      activeProfileId() === pid && targets.every((item) => manualWatchedCurrent(operation, item));
    if (!isCurrent()) return false;

    if (mdbScope && options?.skipTrackingWrite !== true) {
      try {
        await MdbListTracking.writeHistory(
          options?.season == null &&
            options?.episode == null &&
            ["series", "show", "tv", "anime"].includes(options?.contentType)
            ? [{ ...options, contentId, season: null, episode: null }]
            : targets,
          true,
          mdbScope
        );
      } catch (error) {
        console.warn("MDBList watched history removal failed", error.code || error.message);
        return false;
      }
    }
    if (!isCurrent()) return false;
    if (isSimklConnected() && options?.skipTrackingWrite !== true) {
      const remoteMatches = removedItems.length
        ? []
        : (await SimklSyncService.getWatchedItems().catch(() => [])).filter((item) =>
            matchesWatchedTarget(item, contentId, options)
          );
      const targets = removedItems.length
        ? removedItems
        : remoteMatches.length
          ? remoteMatches
          : [
              {
                contentId,
                contentType: options?.contentType || "movie",
                season: options?.season ?? null,
                episode: options?.episode ?? null,
                videoId: options?.videoId || null
              }
            ];
      for (const item of targets) {
        if (!isCurrent()) return false;
        try {
          await SimklSyncService.unmarkWatched(item);
        } catch (error) {
          console.warn("Simkl watched history removal failed", error);
        }
      }
    }
    if (!isCurrent()) return false;
    if (isTraktConnected() && options?.skipTrackingWrite !== true) {
      const targets = removedItems.length
        ? removedItems
        : [
            {
              contentId,
              contentType: options?.contentType || "movie",
              title: options?.title,
              year: options?.year,
              season: options?.season ?? null,
              episode: options?.episode ?? null,
              videoId: options?.videoId || null,
              imdbId: options?.imdbId,
              tmdbId: options?.tmdbId,
              traktId: options?.traktId
            }
          ];
      for (const item of targets) {
        if (!isCurrent()) return false;
        try {
          await writeTraktHistory(item, true);
        } catch (error) {
          console.warn("Trakt watched history removal failed", error);
        }
      }
    }
    if (!isCurrent()) return false;
    await deleteWatchedItemsFromCloud(removedItems, pid);
    queueWatchedItemsCloudSync(pid);
    return targets.every((item) => manualWatchedCurrent(operation, item));
  }

  async replaceAll(items, profileId = activeProfileId()) {
    WatchedItemsStore.replaceForProfile(profileId, items || []);
    invalidateTraktWatchedCaches();
  }

  async getRemoteTraktWatchedShows(options = {}) {
    return getTraktWatchedShows(options);
  }
}

export const watchedItemsRepository = new WatchedItemsRepository();
