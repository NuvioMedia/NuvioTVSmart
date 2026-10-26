import { WatchProgressStore } from "../local/watchProgressStore.js";
import { CloudLibraryPlaybackProgressStore } from "../local/cloudLibraryPlaybackStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { ContinueWatchingPreferences } from "../local/continueWatchingPreferences.js";
import {
  TraktSettingsStore,
  WatchProgressSource,
  normalizeTraktContinueWatchingDaysCap
} from "../local/traktSettingsStore.js";
import { TraktAuthStore } from "../local/traktAuthStore.js";
import { TraktAuthService } from "./traktAuthService.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { MdbListAccount } from "./mdbListAccount.js";
import { MdbListTracking } from "./mdbListTracking.js";
import { SimklSyncService } from "./simklSyncService.js";
import { metaRepository } from "./metaRepository.js";
import {
  invalidateTraktWatchedMoviesCache,
  invalidateTraktWatchedShowsCache,
  watchedItemsRepository
} from "./watchedItemsRepository.js";
import {
  applyTraktLastActivities,
  getTraktActivityActionGeneration,
  getTraktActivityState,
  requestTraktRefreshAfterWatchAction,
  resetTraktActivityState,
  useTraktActivityScope
} from "./traktActivityRefreshState.js";
import { watchedItemIdentityValues, watchedItemsShareIdentity } from "./watchedIdentity.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";
import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";
import {
  WATCH_PROGRESS_COMPLETED_THRESHOLD,
  WATCH_PROGRESS_STARTED_THRESHOLD,
  getWatchProgressFraction,
  hasWatchProgressStarted,
  isWatchProgressCompleted,
  isWatchProgressInProgress,
  resolveWatchProgressResumePositionMs
} from "../../domain/model/watchProgress.js";

const CW_DISPLAY_SNAPSHOT_KEY = "homeContinueWatchingDisplaySnapshot";
const CW_PROGRESS_START_THRESHOLD = WATCH_PROGRESS_STARTED_THRESHOLD;
const CW_PROGRESS_END_THRESHOLD = WATCH_PROGRESS_COMPLETED_THRESHOLD;
// These bound a hung request so the fire-and-forget Continue Watching
// reconciliation can't leak a never-resolving promise. They are NOT on the
// app's critical path (the home screen paints from a snapshot), so they are
// generous — only a genuinely stuck request is abandoned.
const TRAKT_API_TIMEOUT_MS = 10000;
const PROGRESS_META_TIMEOUT_MS = 8000;
const PROGRESS_META_CONCURRENCY = 4;

function withTimeout(promise, ms, fallback) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

const watchProgressSyncTimers = new Map();
const watchProgressSyncInFlightByProfile = new Map();
let watchProgressSyncGeneration = 0;
let traktProgressSnapshotCache = null;
let traktProgressSnapshotInFlight = null;
let traktProgressSnapshotGeneration = 0;
const remoteProgressLoadState = new Map();
const TRAKT_PROGRESS_SNAPSHOT_TTL_MS = 30000;

function remoteProgressStateKey(source, profileId = activeProfileId()) {
  return `${String(profileId || "1")}:${String(source || "")}`;
}

function setRemoteProgressLoadState(source, profileId, status) {
  remoteProgressLoadState.set(remoteProgressStateKey(source, profileId), status);
}

function getWatchProgressSyncDebounceMs() {
  return globalThis.document?.body?.classList?.contains("performance-constrained") ? 15000 : 1500;
}

function queueWatchProgressCloudSync(
  profileId = activeProfileId(),
  delayMs = getWatchProgressSyncDebounceMs()
) {
  const profileKey = String(profileId || "1");
  const generation = watchProgressSyncGeneration;
  const existingTimer = watchProgressSyncTimers.get(profileKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timerId = setTimeout(() => {
    if (generation !== watchProgressSyncGeneration) {
      return;
    }
    watchProgressSyncTimers.delete(profileKey);
    const runPush = async () => {
      if (generation !== watchProgressSyncGeneration) {
        return;
      }
      const inFlight = watchProgressSyncInFlightByProfile.get(profileKey);
      if (inFlight) {
        await inFlight.catch(() => false);
      }
      if (generation !== watchProgressSyncGeneration) {
        return;
      }
      const pushPromise = import("../../core/profile/watchProgressSyncService.js")
        .then(({ WatchProgressSyncService }) => WatchProgressSyncService.push(profileId))
        .catch((error) => {
          console.warn("Watch progress cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (watchProgressSyncInFlightByProfile.get(profileKey) === pushPromise) {
            watchProgressSyncInFlightByProfile.delete(profileKey);
          }
        });
      watchProgressSyncInFlightByProfile.set(profileKey, pushPromise);
      const didPush = await pushPromise;
      if (generation !== watchProgressSyncGeneration) {
        return;
      }
      if (!didPush) {
        const retryDelayMs = getSyncBackoffRemainingMs();
        if (retryDelayMs > 0) {
          queueWatchProgressCloudSync(profileId, Math.max(5000, retryDelayMs));
        }
      }
    };
    void runPush();
  }, delayMs);
  watchProgressSyncTimers.set(profileKey, timerId);
}

function stopWatchProgressCloudSync({ waitForInFlight = true } = {}) {
  const pending = waitForInFlight ? [...watchProgressSyncInFlightByProfile.values()] : [];
  watchProgressSyncGeneration += 1;
  watchProgressSyncTimers.forEach((timerId) => clearTimeout(timerId));
  watchProgressSyncTimers.clear();
  watchProgressSyncInFlightByProfile.clear();
  traktProgressSnapshotCache = null;
  traktProgressSnapshotInFlight = null;
  traktProgressSnapshotGeneration = watchProgressSyncGeneration;
  resetTraktActivityState();
  remoteProgressLoadState.clear();
  if (!waitForInFlight || pending.length === 0) {
    return Promise.resolve(true);
  }
  return Promise.allSettled(pending).then(() => true);
}

registerSessionTeardownHandler?.(({ waitForInFlight = true } = {}) =>
  stopWatchProgressCloudSync({ waitForInFlight })
);

function continueWatchingSourceKey() {
  const source = selectedContinueWatchingSource();
  return (
    `${activeProfileId()}:${source}` +
    (source === WatchProgressSource.MDBLIST ? `:${MdbListAccount.scope().generation}` : "")
  );
}

function invalidateContinueWatchingDisplaySnapshot() {
  const sourceKey = continueWatchingSourceKey();
  const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
  if (
    !store ||
    typeof store !== "object" ||
    !Object.prototype.hasOwnProperty.call(store, sourceKey)
  ) {
    return;
  }
  const next = { ...store };
  delete next[sourceKey];
  LocalStore.set(CW_DISPLAY_SNAPSHOT_KEY, next);
}

function isSeriesType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "series" || normalized === "tv";
}

function isCloudProgressItem(item = {}) {
  return (
    String(item?.contentType || item?.type || "")
      .trim()
      .toLowerCase() === "cloud"
  );
}

function matchesProgressTarget(item = {}, contentId, videoId = null) {
  const wantedContentId = String(contentId || "").trim();
  if (!wantedContentId || !watchedItemsShareIdentity(item, { contentId: wantedContentId })) {
    return false;
  }
  if (videoId == null) {
    return true;
  }
  return String(item.videoId || "") === String(videoId);
}

async function deleteWatchProgressFromCloud(items = [], profileId = activeProfileId()) {
  if (!items.length) {
    return false;
  }
  try {
    const { WatchProgressSyncService } =
      await import("../../core/profile/watchProgressSyncService.js");
    return WatchProgressSyncService.deleteItems(items, profileId);
  } catch (error) {
    console.warn("Watch progress cloud delete failed", error);
    return false;
  }
}

function isCompletedForContinueWatching(item = {}) {
  return isWatchProgressCompleted(item);
}

function isInProgressForContinueWatching(item = {}) {
  return isWatchProgressInProgress(item);
}

function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isInProgressForContinueWatching(item)) {
    return true;
  }
  if (isCompletedForContinueWatching(item)) {
    return false;
  }
  return hasWatchProgressStarted(item);
}

function isTraktProgressItem(item = {}) {
  return String(item.source || "")
    .toLowerCase()
    .startsWith("trakt");
}

function isSimklProgressItem(item = {}) {
  return String(item.source || "")
    .toLowerCase()
    .startsWith("simkl");
}

function isTraktCompatibleContentId(contentId) {
  const raw = String(contentId || "").trim();
  if (!raw) {
    return false;
  }
  if (raw.toLowerCase().startsWith("tt")) {
    return true;
  }
  if (/^(tmdb|trakt):/i.test(raw)) {
    return true;
  }
  return /^\d+$/.test(raw.split(":")[0] || "");
}

function selectedContinueWatchingSource() {
  const settings = TraktSettingsStore.get();
  const requestedSource = settings.watchProgressSource || WatchProgressSource.TRAKT;
  if (requestedSource === WatchProgressSource.TRAKT && TraktAuthStore.isAuthenticated()) {
    return WatchProgressSource.TRAKT;
  }
  if (requestedSource === WatchProgressSource.SIMKL && SimklAuthStore.isAuthenticated()) {
    return WatchProgressSource.SIMKL;
  }
  if (requestedSource === WatchProgressSource.MDBLIST && MdbListAccount.connected())
    return WatchProgressSource.MDBLIST;
  return WatchProgressSource.NUVIO_SYNC;
}

function selectedLocalProgressSource() {
  // Playback is recorded locally even when Trakt owns Continue Watching.
  // Keep that fresh state in the selected source until Trakt catches up.
  const source = selectedContinueWatchingSource();
  if (source === WatchProgressSource.TRAKT) return "trakt_local";
  if (source === WatchProgressSource.SIMKL) return "simkl_local";
  if (source === WatchProgressSource.MDBLIST) return "mdblist_local";
  return WatchProgressSource.NUVIO_SYNC;
}

function filterForSelectedContinueWatchingSource(items = []) {
  const source = selectedContinueWatchingSource();
  // Cloud Library progress is local to the Cloud file and deliberately does
  // not enter generic account sync. The Home Continue Watching projection
  // appends it explicitly from CloudLibraryPlaybackProgressStore below.
  const all = (Array.isArray(items) ? items : []).filter((item) => !isCloudProgressItem(item));
  if (source === WatchProgressSource.TRAKT) {
    return all.filter(
      (item) => isTraktProgressItem(item) || !isTraktCompatibleContentId(item?.contentId)
    );
  }
  if (source === WatchProgressSource.SIMKL) {
    return all.filter(
      (item) =>
        isSimklProgressItem(item) ||
        (!isTraktCompatibleContentId(item?.contentId) &&
          !/^(tvdb|mal|anidb|anilist|kitsu|simkl):/i.test(String(item?.contentId || "")))
    );
  }
  if (source === WatchProgressSource.MDBLIST)
    return all.filter(
      (item) =>
        ["mdblist_history", "mdblist_playback"].includes(item.source) ||
        !/^(?:tt\d+|\d+$|(?:imdb|tmdb|tvdb|trakt|mdblist):)/i.test(String(item.contentId || ""))
    );
  return all.filter(
    (item) =>
      !isTraktProgressItem(item) &&
      !isSimklProgressItem(item) &&
      !String(item.source || "").startsWith("mdblist")
  );
}

function deduplicateInProgress(items = [], recentLimit = 300) {
  const seenContentIds = new Set();

  return (
    (Array.isArray(items) ? items : [])
      .slice()
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .filter((item) => {
        if (!isSeriesType(item?.contentType)) {
          return true;
        }

        const identities = Array.from(watchedItemIdentityValues(item))
          .map((value) => value.toLowerCase())
          .filter(Boolean);
        if (!identities.length || identities.some((identity) => seenContentIds.has(identity))) {
          return false;
        }
        identities.forEach((identity) => seenContentIds.add(identity));
        return true;
      })
      // Apply the recent-item budget after choosing one state per series.
      // A batch of completed episodes must not displace other titles.
      .slice(0, recentLimit)
      // Check eligibility after selecting the newest episode, so an older
      // partial record cannot reappear beside the real Next Up.
      .filter(shouldTreatAsInProgressForContinueWatching)
  );
}

function normalizeContentIdList(values = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function matchesAnyContentId(item = {}, contentIds = []) {
  return contentIds.some((contentId) => watchedItemsShareIdentity(item, { contentId }));
}

function matchesResumeTarget(item = {}, { videoId = null, season = null, episode = null } = {}) {
  const wantedVideoId = String(videoId || "").trim();
  if (wantedVideoId && String(item?.videoId || "").trim() === wantedVideoId) {
    return true;
  }
  const wantedSeason = Number(season);
  const wantedEpisode = Number(episode || 0);
  if (season != null && Number.isFinite(wantedSeason) && wantedSeason >= 0 && wantedEpisode > 0) {
    return (
      Number(item?.season || item?.seasonNumber || 0) === wantedSeason &&
      Number(item?.episode || item?.episodeNumber || 0) === wantedEpisode
    );
  }
  return !wantedVideoId;
}

function selectBestResumeProgress(items = [], contentIds = [], target = {}) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => matchesAnyContentId(item, contentIds))
    .filter((item) => shouldTreatAsInProgressForContinueWatching(item));
  if (!candidates.length) {
    return null;
  }
  const targetSeason = Number(target?.season);
  const hasExplicitTarget =
    Boolean(String(target?.videoId || "").trim()) ||
    (target?.season != null &&
      Number.isFinite(targetSeason) &&
      targetSeason >= 0 &&
      Number(target?.episode || 0) > 0);
  const targeted = candidates.filter((item) => matchesResumeTarget(item, target));
  const pool = hasExplicitTarget ? targeted : candidates;
  if (!pool.length) {
    return null;
  }
  return (
    pool
      .slice()
      .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))[0] ||
    null
  );
}

function normalizeResumeProgress(progress = null) {
  if (!progress) {
    return null;
  }
  const durationMs = Number(progress.durationMs || 0);
  const positionMs = resolveWatchProgressResumePositionMs(progress, durationMs);
  return {
    ...progress,
    positionMs,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.trunc(durationMs) : 0,
    progressFraction: getWatchProgressFraction(progress),
    progressPercent:
      progress.progressPercent != null && progress.progressPercent !== ""
        ? Number(progress.progressPercent)
        : getWatchProgressFraction(progress) * 100
  };
}

function toProgressItemFromTraktHistory(historyItem) {
  if (!historyItem) return null;
  const isEpisode = historyItem.type === "episode";
  const tmdbId = isEpisode ? historyItem.showTmdbId : historyItem.tmdbId;
  const traktId = isEpisode ? historyItem.showTraktId : historyItem.traktId;
  const imdbId = isEpisode ? historyItem.showImdbId : historyItem.imdbId;
  const contentId = imdbId
    ? imdbId
    : tmdbId
      ? `tmdb:${tmdbId}`
      : traktId
        ? `trakt:${traktId}`
        : null;
  if (!contentId) return null;
  const watchedAtMs = historyItem.watchedAt
    ? new Date(historyItem.watchedAt).getTime()
    : Date.now();
  return {
    contentId,
    videoId:
      isEpisode && historyItem.episodeTmdbId ? `tmdb:${historyItem.episodeTmdbId}` : contentId,
    contentType: isEpisode ? "series" : "movie",
    title: isEpisode ? historyItem.showTitle : historyItem.title,
    year: isEpisode ? historyItem.showYear : historyItem.year,
    imdbId,
    tmdbId: tmdbId || null,
    traktId: traktId || null,
    source: "trakt_history",
    updatedAt: watchedAtMs,
    positionMs: 0,
    durationMs: 0,
    // Trakt history represents completed items, not partial progress.
    // Keep it out of Continue Watching while still letting it seed Next Up.
    progressPercent: 100,
    profileId: activeProfileId(),
    season:
      isEpisode &&
      historyItem.seasonNumber != null &&
      Number.isFinite(Number(historyItem.seasonNumber)) &&
      Number(historyItem.seasonNumber) >= 0
        ? Number(historyItem.seasonNumber)
        : null,
    episode: isEpisode ? Number(historyItem.episodeNumber || 0) || null : null,
    seasonNumber: isEpisode ? historyItem.seasonNumber : undefined,
    episodeNumber: isEpisode ? historyItem.episodeNumber : undefined,
    episodeTitle: isEpisode ? historyItem.episodeTitle : undefined
  };
}

function toProgressItemFromPlayback(playbackItem) {
  if (!playbackItem || playbackItem.progressPercent == null) return null;
  const progressFraction = playbackItem.progressPercent / 100;
  if (
    progressFraction < CW_PROGRESS_START_THRESHOLD ||
    progressFraction >= CW_PROGRESS_END_THRESHOLD
  )
    return null;
  const isEpisode = playbackItem.type === "episode";
  const pausedAtMs = playbackItem.pausedAt ? new Date(playbackItem.pausedAt).getTime() : Date.now();
  return {
    contentId: playbackItem.contentId,
    videoId: playbackItem.videoId,
    contentType: isEpisode ? "series" : "movie",
    title: playbackItem.title || "",
    year: playbackItem.year,
    imdbId: playbackItem.imdbId,
    tmdbId: playbackItem.tmdbId || null,
    traktId: playbackItem.traktId || null,
    source: "trakt_playback",
    updatedAt: pausedAtMs,
    positionMs: 0,
    durationMs: 0,
    progressPercent: playbackItem.progressPercent,
    profileId: activeProfileId(),
    season:
      isEpisode &&
      playbackItem.seasonNumber != null &&
      Number.isFinite(Number(playbackItem.seasonNumber)) &&
      Number(playbackItem.seasonNumber) >= 0
        ? Number(playbackItem.seasonNumber)
        : null,
    episode: isEpisode ? Number(playbackItem.episodeNumber || 0) || null : null,
    seasonNumber: playbackItem.seasonNumber,
    episodeNumber: playbackItem.episodeNumber,
    episodeTitle: playbackItem.episodeTitle
  };
}

function toWatchedShowSeedItems(watchedShowItem) {
  if (!watchedShowItem || !Array.isArray(watchedShowItem.seasons)) return [];
  const watchedEpisodes = [];
  const fallbackWatchedAt = watchedShowItem.lastWatchedAt
    ? new Date(watchedShowItem.lastWatchedAt).getTime()
    : Date.now();
  const { contentId, title, year, imdbId, tmdbId, traktId } = watchedShowItem;
  if (!contentId) return [];
  watchedShowItem.seasons.forEach((season) => {
    const seasonNumber = Number(season?.number || 0);
    if (seasonNumber <= 0) return;
    (season?.episodes || []).forEach((episode) => {
      const episodeNumber = Number(episode?.number || 0);
      if (episodeNumber <= 0) return;
      const watchedAtMs = episode?.lastWatchedAt ? new Date(episode.lastWatchedAt).getTime() : 0;
      watchedEpisodes.push({
        season: seasonNumber,
        episode: episodeNumber,
        watchedAtMs: Number.isFinite(watchedAtMs) ? watchedAtMs : 0
      });
    });
  });
  return watchedEpisodes.map((watchedEpisode) => {
    const updatedAt = Number(watchedEpisode.watchedAtMs || 0) || fallbackWatchedAt || Date.now();
    return {
      contentId,
      videoId: `${contentId}:s${watchedEpisode.season}e${watchedEpisode.episode}`,
      contentType: "series",
      title: title || "",
      year,
      imdbId,
      tmdbId: tmdbId || null,
      traktId: traktId || null,
      source: "trakt_show_progress",
      updatedAt,
      positionMs: 1,
      durationMs: 1,
      progressPercent: 100,
      profileId: activeProfileId(),
      season: watchedEpisode.season,
      episode: watchedEpisode.episode,
      seasonNumber: watchedEpisode.season,
      episodeNumber: watchedEpisode.episode
    };
  });
}

function traktProgressAccountKey(profileId) {
  const auth = TraktAuthStore.get(profileId);
  return JSON.stringify([
    auth.userSlug || auth.username || "",
    auth.userSlug || auth.username ? "" : auth.refreshToken
  ]);
}

async function readTraktActivityChange() {
  try {
    const activities = await withTimeout(
      TraktAuthService.fetchLastActivities(),
      TRAKT_API_TIMEOUT_MS,
      undefined
    );
    // A successful response without a usable body counts as a change, as on Android.
    return activities === undefined ? null : (activities ?? true);
  } catch (_) {
    return null;
  }
}

async function fetchTraktProgressSnapshot() {
  if (
    selectedContinueWatchingSource() !== WatchProgressSource.TRAKT ||
    !TraktAuthStore.isAuthenticated()
  ) {
    return { historyItems: [], playbackItems: [], watchedShowSeedItems: [] };
  }
  const profileId = activeProfileId();
  const accountKey = traktProgressAccountKey(profileId);
  const generation = watchProgressSyncGeneration;
  const actionGeneration = getTraktActivityActionGeneration();
  const activity = useTraktActivityScope(`${profileId}:${accountKey}`);
  const current = () =>
    generation === watchProgressSyncGeneration &&
    activeProfileId() === profileId &&
    selectedContinueWatchingSource() === WatchProgressSource.TRAKT &&
    TraktAuthStore.isAuthenticated(profileId) &&
    traktProgressAccountKey(profileId) === accountKey &&
    getTraktActivityState() === activity;
  const cacheMatches = () =>
    traktProgressSnapshotCache?.profileId === profileId &&
    traktProgressSnapshotCache.accountKey === accountKey;
  const now = Date.now();
  const forceDeadline = activity.forceRefreshUntilMs;
  const force = now < forceDeadline;
  const progressRecheckPending =
    activity.progressRecheckAtMs > 0 && activity.progressRecheckAtMs <= now;
  if (
    !force &&
    !progressRecheckPending &&
    cacheMatches() &&
    now >= traktProgressSnapshotCache.fetchedAt &&
    now - traktProgressSnapshotCache.fetchedAt < TRAKT_PROGRESS_SNAPSHOT_TTL_MS
  ) {
    setRemoteProgressLoadState(WatchProgressSource.TRAKT, profileId, "loaded");
    return traktProgressSnapshotCache.snapshot;
  }
  if (
    traktProgressSnapshotInFlight?.profileId === profileId &&
    traktProgressSnapshotInFlight.accountKey === accountKey &&
    traktProgressSnapshotGeneration === generation &&
    traktProgressSnapshotInFlight.actionGeneration === actionGeneration
  ) {
    return traktProgressSnapshotInFlight.promise;
  }
  traktProgressSnapshotGeneration = generation;
  let snapshotPromise;
  snapshotPromise = (async () => {
    // Read last_activities on forced refreshes too, so the fingerprints and stale
    // flags already include this refresh's changes and the next poll skips them.
    const activityChanged = applyTraktLastActivities(await readTraktActivityChange());
    if (!current()) throw new Error("Obsolete Trakt progress request");
    if (activityChanged === true) activity.activityRefreshPending = true;
    const hasSnapshot = cacheMatches();
    const shouldRefresh =
      activity.activityRefreshPending || (activityChanged === null && !hasSnapshot);
    const progressRecheckDue =
      !force && activity.progressRecheckAtMs > 0 && activity.progressRecheckAtMs <= Date.now();
    if (hasSnapshot && !force && !shouldRefresh && !progressRecheckDue) {
      // Nothing changed on Trakt: keep the snapshot. Only a successful
      // last_activities read renews it; an unreadable one retries next time.
      if (activityChanged === false) traktProgressSnapshotCache.fetchedAt = Date.now();
      setRemoteProgressLoadState(WatchProgressSource.TRAKT, profileId, "loaded");
      return traktProgressSnapshotCache.snapshot;
    }
    setRemoteProgressLoadState(WatchProgressSource.TRAKT, profileId, "loading");
    // With last_activities read, the stale flags say which watched lists changed.
    // Only refetch both when it could not be read.
    if (force && activityChanged === null) {
      activity.watchedMoviesStale = true;
      activity.watchedShowsStale = true;
    }
    const watchedMoviesStale = activity.watchedMoviesStale;
    const watchedShowsStale = activity.watchedShowsStale;
    if (watchedMoviesStale) invalidateTraktWatchedMoviesCache();
    const reuseWatchedShows = hasSnapshot && !watchedShowsStale;
    if (!reuseWatchedShows) invalidateTraktWatchedShowsCache();
    const [history, playbackState, watchedShows] = await Promise.all([
      withTimeout(TraktAuthService.fetchWatchHistory({ limit: 300 }), TRAKT_API_TIMEOUT_MS, null),
      withTimeout(TraktAuthService.fetchPlaybackState({ limit: 50 }), TRAKT_API_TIMEOUT_MS, null),
      reuseWatchedShows
        ? null
        : withTimeout(
            watchedItemsRepository.getRemoteTraktWatchedShows({ strict: true }),
            TRAKT_API_TIMEOUT_MS,
            null
          )
    ]);
    if (!current()) throw new Error("Obsolete Trakt progress request");
    if (
      ![history, playbackState].every(Array.isArray) ||
      (!reuseWatchedShows && !Array.isArray(watchedShows))
    ) {
      throw new Error("Incomplete Trakt progress snapshot");
    }
    let watchedShowSeedItems;
    if (reuseWatchedShows) {
      watchedShowSeedItems = traktProgressSnapshotCache.snapshot.watchedShowSeedItems;
    } else {
      watchedShowSeedItems = [];
      watchedShows.forEach((show) => watchedShowSeedItems.push(...toWatchedShowSeedItems(show)));
    }
    const snapshot = {
      historyItems: history.map(toProgressItemFromTraktHistory).filter(Boolean),
      playbackItems: playbackState.map(toProgressItemFromPlayback).filter(Boolean),
      watchedShowSeedItems
    };
    traktProgressSnapshotCache = { profileId, accountKey, fetchedAt: Date.now(), snapshot };
    setRemoteProgressLoadState(WatchProgressSource.TRAKT, profileId, "loaded");
    activity.activityRefreshPending = false;
    if (watchedShowsStale && !reuseWatchedShows) activity.watchedShowsStale = false;
    if (watchedMoviesStale) activity.watchedMoviesStale = false;
    if (progressRecheckDue) activity.progressRecheckAtMs = 0;
    // One completed forced refresh is enough; later changes show up in last_activities.
    // Playback and history are still checked once more after the force window.
    if (force && activity.forceRefreshUntilMs === forceDeadline) {
      activity.forceRefreshUntilMs = 0;
      activity.progressRecheckAtMs = forceDeadline;
    }
    return snapshot;
  })()
    .catch((error) => {
      if (!current()) throw error;
      setRemoteProgressLoadState(WatchProgressSource.TRAKT, profileId, "error");
      // Do not extend the TTL: the next reconciliation must retry the failed read.
      if (cacheMatches()) return traktProgressSnapshotCache.snapshot;
      throw error;
    })
    .finally(() => {
      if (traktProgressSnapshotInFlight?.promise === snapshotPromise)
        traktProgressSnapshotInFlight = null;
    });
  traktProgressSnapshotInFlight = {
    profileId,
    accountKey,
    actionGeneration,
    promise: snapshotPromise
  };
  return snapshotPromise;
}

async function fetchSimklProgressSnapshot() {
  if (
    selectedContinueWatchingSource() !== WatchProgressSource.SIMKL ||
    !SimklAuthStore.isAuthenticated()
  ) {
    return { historyItems: [], playbackItems: [], watchedShowSeedItems: [] };
  }
  const profileId = activeProfileId();
  setRemoteProgressLoadState(WatchProgressSource.SIMKL, profileId, "loading");
  try {
    const snapshot = await SimklSyncService.getProgressSnapshot();
    const loaded = SimklSyncService.hasLoadedRemoteProgress?.(profileId) === true;
    setRemoteProgressLoadState(WatchProgressSource.SIMKL, profileId, loaded ? "loaded" : "error");
    return snapshot;
  } catch (error) {
    setRemoteProgressLoadState(WatchProgressSource.SIMKL, profileId, "error");
    throw error;
  }
}

// Cache for enriched metadata (5-minute TTL)
const enrichedMetaCache = new Map();
const ENRICHED_META_CACHE_TTL_MS = 5 * 60 * 1000;

function progressMetadataTypeCandidates(contentType) {
  const normalized = String(contentType || "")
    .trim()
    .toLowerCase();
  const candidates = normalized ? [normalized] : [];
  if (normalized === "series" || normalized === "tv") {
    candidates.push("series", "tv");
  } else {
    candidates.push("movie");
  }
  return [...new Set(candidates)];
}

async function getProgressItemMetadata(contentType, lookupId) {
  for (const candidateType of progressMetadataTypeCandidates(contentType)) {
    const result = await metaRepository
      .getMetaFromAllAddons(candidateType, lookupId)
      .catch(() => null);
    if (result?.status === "success" && result?.data) {
      return result.data;
    }
  }
  return null;
}

const progressMetadataAttempts = new Map();
const progressMetadataFlights = new Map();
let progressMetadataProfile = null;

async function batchEnrichProgressItems(items) {
  if (!items.length) return [];
  const pid = activeProfileId();
  if (progressMetadataProfile !== pid) {
    progressMetadataProfile = pid;
    progressMetadataAttempts.clear();
  }
  return mapWithConcurrency(items, PROGRESS_META_CONCURRENCY, async (item) => {
    const lookupId = item.imdbId || item.contentId;
    const cacheKey = `${item.contentType}:${lookupId}`;
    const key = `${pid}:${cacheKey}`;
    const now = Date.now();
    const cached = enrichedMetaCache.get(cacheKey);
    let meta = cached && now - cached.timestamp < ENRICHED_META_CACHE_TTL_MS ? cached.meta : null;
    if (!meta) {
      let flight = progressMetadataFlights.get(key);
      if (!flight) {
        const attempt = progressMetadataAttempts.get(key);
        if (attempt && (attempt.count >= 3 || now - attempt.at < 2000 * attempt.count)) return item;
        progressMetadataAttempts.set(key, { count: (attempt?.count || 0) + 1, at: now });
        flight = withTimeout(
          getProgressItemMetadata(item.contentType, lookupId),
          PROGRESS_META_TIMEOUT_MS,
          null
        )
          .catch(() => null)
          .then((result) => {
            if (result) {
              enrichedMetaCache.set(cacheKey, { meta: result, timestamp: Date.now() });
              progressMetadataAttempts.delete(key);
            }
            return result;
          })
          .finally(() => {
            if (progressMetadataFlights.get(key) === flight) progressMetadataFlights.delete(key);
          });
        progressMetadataFlights.set(key, flight);
      }
      meta = await flight;
    }
    return meta ? { ...item, enrichedMeta: meta } : item;
  });
}

class WatchProgressRepository {
  async saveProgress(progress, options = {}) {
    if (isCloudProgressItem(progress)) {
      return;
    }
    const syncRemote = options === false || options?.syncRemote === false ? false : true;
    const pid = activeProfileId();
    if (isSeriesType(progress?.contentType)) {
      ContinueWatchingPreferences.removeDismissedNextUpKeysForContent(progress?.contentId, pid);
    }
    WatchProgressStore.upsert(
      {
        ...progress,
        source: String(progress?.source || "").trim() || selectedLocalProgressSource(),
        updatedAt: progress.updatedAt || Date.now()
      },
      pid
    );
    // Keep the last Home display for cold startup; Home reconciles it against
    // fresh progress in the background, as Android does.
    if (syncRemote) {
      queueWatchProgressCloudSync(pid);
    }
  }

  async saveProgressBatch(progressList = [], options = {}) {
    const syncRemote = options === false || options?.syncRemote === false ? false : true;
    const pid = activeProfileId();
    const items = (Array.isArray(progressList) ? progressList : [])
      .filter((progress) => !isCloudProgressItem(progress))
      .filter((progress) => Boolean(progress?.contentId));
    if (!items.length) {
      return;
    }

    const seriesContentIds = new Set(
      items
        .filter((progress) => isSeriesType(progress?.contentType))
        .map((progress) => String(progress.contentId || "").trim())
        .filter(Boolean)
    );
    seriesContentIds.forEach((contentId) => {
      ContinueWatchingPreferences.removeDismissedNextUpKeysForContent(contentId, pid);
    });

    WatchProgressStore.upsertMany(
      items.map((progress) => ({
        ...progress,
        source: String(progress?.source || "").trim() || selectedLocalProgressSource(),
        updatedAt: progress.updatedAt || Date.now()
      })),
      pid
    );
    // Keep the last Home display for cold startup; Home reconciles it against
    // fresh progress in the background, as Android does.
    if (syncRemote) {
      queueWatchProgressCloudSync(pid);
    }
  }

  async getProgressByContentId(contentId) {
    return (
      WatchProgressStore.listForProfile(activeProfileId()).find((item) =>
        watchedItemsShareIdentity(item, { contentId })
      ) || null
    );
  }

  async getResumeByContentIds(contentIds, target = {}) {
    const candidates = normalizeContentIdList(contentIds);
    if (!candidates.length) {
      return null;
    }
    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    let sourceItems = filterForSelectedContinueWatchingSource(localItems);

    if (selectedContinueWatchingSource() !== WatchProgressSource.NUVIO_SYNC) {
      const remote =
        selectedContinueWatchingSource() === WatchProgressSource.MDBLIST
          ? this.getAllForContinueWatching()
          : this.getRecent(300, { enrichMetadata: false });
      sourceItems = await remote.catch((error) => {
        console.warn("[CW] Resume lookup failed", error);
        return sourceItems;
      });
    }

    return normalizeResumeProgress(selectBestResumeProgress(sourceItems, candidates, target));
  }

  async getResumeByContentId(contentId, target = {}) {
    return this.getResumeByContentIds([contentId], target);
  }

  async removeProgress(contentId, videoId = null) {
    const pid = activeProfileId();
    if (selectedContinueWatchingSource() === WatchProgressSource.MDBLIST)
      await MdbListTracking.clearProgress(contentId, videoId);
    if (activeProfileId() !== pid) return;
    const removedItems = WatchProgressStore.listForProfile(pid).filter((item) =>
      matchesProgressTarget(item, contentId, videoId)
    );
    if (removedItems.length) {
      const remaining = WatchProgressStore.listForProfile(pid).filter(
        (item) => !matchesProgressTarget(item, contentId, videoId)
      );
      WatchProgressStore.replaceForProfile(pid, remaining);
    } else {
      WatchProgressStore.remove(contentId, videoId, pid);
    }
    await deleteWatchProgressFromCloud(removedItems, pid);
    // Android removeProgress() -> refreshNow(): force the next reconciliation.
    requestTraktRefreshAfterWatchAction();
    invalidateContinueWatchingDisplaySnapshot();
    queueWatchProgressCloudSync(pid);
  }

  async getRecent(limit = 30, { enrichMetadata = true } = {}) {
    const now = Date.now();
    const useTraktProgress = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
    const useSimklProgress = selectedContinueWatchingSource() === WatchProgressSource.SIMKL;
    const daysCap = normalizeTraktContinueWatchingDaysCap(
      TraktSettingsStore.get().continueWatchingDaysCap
    );
    const cutoffMs = !useTraktProgress || daysCap === 0 ? 0 : now - daysCap * 24 * 60 * 60 * 1000;

    let traktHistoryItems = [];
    let playbackItems = [];
    let watchedShowSeedItems = [];

    if (useTraktProgress) {
      const snapshot = await fetchTraktProgressSnapshot();
      traktHistoryItems = snapshot.historyItems;
      playbackItems = snapshot.playbackItems;
      watchedShowSeedItems = snapshot.watchedShowSeedItems;
    } else if (selectedContinueWatchingSource() === WatchProgressSource.MDBLIST) {
      const snapshot = await MdbListTracking.getProgressSnapshot();
      traktHistoryItems = snapshot.historyItems;
      playbackItems = snapshot.playbackItems;
      watchedShowSeedItems = snapshot.watchedShowSeedItems;
    } else if (useSimklProgress) {
      const snapshot = await fetchSimklProgressSnapshot();
      traktHistoryItems = snapshot.historyItems;
      playbackItems = snapshot.playbackItems;
      watchedShowSeedItems = snapshot.watchedShowSeedItems;
    }

    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    const allItems = [
      ...localItems,
      ...traktHistoryItems,
      ...playbackItems,
      ...watchedShowSeedItems
    ];

    const recentItems = [
      ...filterForSelectedContinueWatchingSource(allItems).filter(
        (item) =>
          !this.isHiddenForContinueWatching(item.contentId, item.season) &&
          (cutoffMs === 0 || Number(item?.updatedAt || 0) >= cutoffMs)
      ),
      // Cloud progress is device-local and must remain visible independently
      // of the selected Trakt/Simkl history window, just like Android.
      ...CloudLibraryPlaybackProgressStore.listForContinueWatching()
    ].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));

    const inProgressOnly = deduplicateInProgress(recentItems);

    const limitedItems = inProgressOnly.slice(0, limit);
    return enrichMetadata ? batchEnrichProgressItems(limitedItems) : limitedItems;
  }

  async getAll(profileId = activeProfileId()) {
    return WatchProgressStore.listForProfile(profileId).filter(
      (item) => !isCloudProgressItem(item)
    );
  }

  async getAllForContinueWatching() {
    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    const cloudItems = CloudLibraryPlaybackProgressStore.listForContinueWatching();
    if (selectedContinueWatchingSource() === WatchProgressSource.NUVIO_SYNC) {
      return [...filterForSelectedContinueWatchingSource(localItems), ...cloudItems];
    }
    const snapshot =
      selectedContinueWatchingSource() === WatchProgressSource.TRAKT
        ? await fetchTraktProgressSnapshot()
        : selectedContinueWatchingSource() === WatchProgressSource.MDBLIST
          ? await MdbListTracking.getProgressSnapshot()
          : await fetchSimklProgressSnapshot();
    return [
      ...filterForSelectedContinueWatchingSource([
        ...localItems,
        ...snapshot.historyItems,
        ...snapshot.playbackItems,
        ...snapshot.watchedShowSeedItems
      ]),
      ...cloudItems
    ];
  }

  getContinueWatchingSourceKey() {
    return continueWatchingSourceKey();
  }

  getContinueWatchingSource() {
    return selectedContinueWatchingSource();
  }

  getContinueWatchingRemoteProgressState() {
    const source = selectedContinueWatchingSource();
    const sourceKey = continueWatchingSourceKey();
    if (source === WatchProgressSource.NUVIO_SYNC) {
      return { sourceKey, loaded: true };
    }
    if (source === WatchProgressSource.MDBLIST)
      return { sourceKey, loaded: MdbListTracking.hasLoadedRemoteProgress() };
    if (source === WatchProgressSource.SIMKL) {
      return {
        sourceKey,
        loaded: SimklSyncService.hasLoadedRemoteProgress?.(activeProfileId()) === true
      };
    }
    return {
      sourceKey,
      loaded:
        remoteProgressLoadState.get(remoteProgressStateKey(source, activeProfileId())) === "loaded"
    };
  }

  async replaceAll(items, profileId = activeProfileId()) {
    WatchProgressStore.replaceForProfile(
      profileId,
      (Array.isArray(items) ? items : []).filter((item) => !isCloudProgressItem(item))
    );
    // A remote pull must not erase the display cache before Home can reconcile it.
  }

  /**
   * True when the selected tracking source still lists `contentId` as being watched.
   *
   * Next Up is seeded from watch history, which says nothing about whether the viewer considers a
   * show current. Only Simkl models a watchlist here; every other source answers true and behaves
   * as before.
   */
  isHiddenForContinueWatching(contentId, season = null) {
    return (
      selectedContinueWatchingSource() === WatchProgressSource.MDBLIST &&
      MdbListTracking.isHidden(contentId, season)
    );
  }

  isTrackedAsWatching(contentId) {
    if (selectedContinueWatchingSource() !== WatchProgressSource.SIMKL) {
      return true;
    }
    try {
      return SimklSyncService.isTrackedAsWatching(contentId) !== false;
    } catch (error) {
      console.warn("Simkl watching-state lookup failed", error);
      return true;
    }
  }
}

export const watchProgressRepository = new WatchProgressRepository();
