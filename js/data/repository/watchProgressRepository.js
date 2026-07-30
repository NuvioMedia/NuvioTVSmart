import { WatchProgressStore } from "../local/watchProgressStore.js";
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
import { metaRepository } from "./metaRepository.js";
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

let watchProgressSyncTimer = null;
let watchProgressSyncInFlight = null;
let traktProgressSnapshotCache = null;
let traktProgressSnapshotInFlight = null;
const TRAKT_PROGRESS_SNAPSHOT_TTL_MS = 30000;

function getWatchProgressSyncDebounceMs() {
  return globalThis.document?.body?.classList?.contains("performance-constrained") ? 15000 : 1500;
}

function queueWatchProgressCloudSync(delayMs = getWatchProgressSyncDebounceMs()) {
  if (watchProgressSyncTimer) {
    clearTimeout(watchProgressSyncTimer);
  }
  watchProgressSyncTimer = setTimeout(() => {
    watchProgressSyncTimer = null;
    const runPush = async () => {
      if (watchProgressSyncInFlight) {
        await watchProgressSyncInFlight.catch(() => false);
      }
      watchProgressSyncInFlight = import("../../core/profile/watchProgressSyncService.js")
        .then(({ WatchProgressSyncService }) => WatchProgressSyncService.push())
        .catch((error) => {
          console.warn("Watch progress cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          watchProgressSyncInFlight = null;
        });
      await watchProgressSyncInFlight;
    };
    void runPush();
  }, delayMs);
}

function invalidateContinueWatchingDisplaySnapshot() {
  const sourceKey = `${activeProfileId()}:${selectedContinueWatchingSource()}`;
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

function matchesProgressTarget(item = {}, contentId, videoId = null) {
  const wantedContentId = String(contentId || "").trim();
  if (!wantedContentId || String(item.contentId || "").trim() !== wantedContentId) {
    return false;
  }
  if (videoId == null) {
    return true;
  }
  return String(item.videoId || "") === String(videoId);
}

async function deleteWatchProgressFromCloud(items = []) {
  if (!items.length) {
    return false;
  }
  try {
    const { WatchProgressSyncService } =
      await import("../../core/profile/watchProgressSyncService.js");
    return WatchProgressSyncService.deleteItems(items);
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
  return requestedSource === WatchProgressSource.TRAKT && TraktAuthStore.isAuthenticated()
    ? WatchProgressSource.TRAKT
    : WatchProgressSource.NUVIO_SYNC;
}

function selectedLocalProgressSource() {
  // Playback is recorded locally even when Trakt owns Continue Watching.
  // Keep that fresh state in the selected source until Trakt catches up.
  return selectedContinueWatchingSource() === WatchProgressSource.TRAKT
    ? "trakt_local"
    : WatchProgressSource.NUVIO_SYNC;
}

function filterForSelectedContinueWatchingSource(items = []) {
  const useTrakt = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
  const all = Array.isArray(items) ? items : [];
  return all.filter((item) =>
    useTrakt
      ? isTraktProgressItem(item) || !isTraktCompatibleContentId(item?.contentId)
      : !isTraktProgressItem(item)
  );
}

function deduplicateInProgress(items = []) {
  const nonSeriesItems = [];
  const latestSeriesItems = [];
  const seenContentIds = new Set();

  (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .forEach((item) => {
      if (!isSeriesType(item?.contentType)) {
        if (shouldTreatAsInProgressForContinueWatching(item)) {
          nonSeriesItems.push(item);
        }
        return;
      }

      const contentId = String(item?.contentId || "").trim();
      if (!contentId || seenContentIds.has(contentId)) {
        return;
      }
      seenContentIds.add(contentId);
      // Decide Continue Watching eligibility only after selecting the newest
      // episode state for the series. Otherwise a completed episode is removed
      // first and an older partial record can reappear beside the real Next Up.
      if (shouldTreatAsInProgressForContinueWatching(item)) {
        latestSeriesItems.push(item);
      }
    });

  return [...nonSeriesItems, ...latestSeriesItems].sort(
    (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
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
  const normalized = String(item?.contentId || "").trim();
  return Boolean(normalized && contentIds.includes(normalized));
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
  const contentId = tmdbId ? `tmdb:${tmdbId}` : traktId ? `trakt:${traktId}` : null;
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
    imdbId: isEpisode ? historyItem.showImdbId : historyItem.imdbId,
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

async function fetchTraktProgressSnapshot() {
  const useTraktProgress = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
  if (!useTraktProgress || !TraktAuthStore.isAuthenticated()) {
    return { historyItems: [], playbackItems: [], watchedShowSeedItems: [] };
  }

  const now = Date.now();
  if (
    traktProgressSnapshotCache &&
    traktProgressSnapshotCache.profileId === activeProfileId() &&
    now - Number(traktProgressSnapshotCache.fetchedAt || 0) < TRAKT_PROGRESS_SNAPSHOT_TTL_MS
  ) {
    return traktProgressSnapshotCache.snapshot;
  }
  if (traktProgressSnapshotInFlight) {
    return traktProgressSnapshotInFlight;
  }

  traktProgressSnapshotInFlight = (async () => {
    const [history, playbackState, watchedShows] = await Promise.all([
      withTimeout(
        TraktAuthService.fetchWatchHistory({ limit: 300 }),
        TRAKT_API_TIMEOUT_MS,
        []
      ).catch((err) => {
        console.warn("[CW] Trakt history fetch failed", err);
        return [];
      }),
      withTimeout(
        TraktAuthService.fetchPlaybackState({ limit: 50 }),
        TRAKT_API_TIMEOUT_MS,
        []
      ).catch((err) => {
        console.warn("[CW] Trakt playback state fetch failed", err);
        return [];
      }),
      withTimeout(TraktAuthService.fetchWatchedShows(), TRAKT_API_TIMEOUT_MS, []).catch((err) => {
        console.warn("[CW] Trakt watched shows fetch failed", err);
        return [];
      })
    ]);

    const watchedShowSeedItems = [];
    watchedShows.forEach((watchedShow) => {
      Array.prototype.push.apply(watchedShowSeedItems, toWatchedShowSeedItems(watchedShow));
    });

    const snapshot = {
      historyItems: history.map(toProgressItemFromTraktHistory).filter(Boolean),
      playbackItems: playbackState.map(toProgressItemFromPlayback).filter(Boolean),
      watchedShowSeedItems
    };
    traktProgressSnapshotCache = {
      profileId: activeProfileId(),
      fetchedAt: Date.now(),
      snapshot
    };
    return snapshot;
  })().finally(() => {
    traktProgressSnapshotInFlight = null;
  });

  return traktProgressSnapshotInFlight;
}

// Cache for enriched metadata (5-minute TTL)
const enrichedMetaCache = new Map();
const ENRICHED_META_CACHE_TTL_MS = 5 * 60 * 1000;

async function batchEnrichProgressItems(items) {
  if (!items.length) return [];
  const now = Date.now();
  return Promise.all(
    items.map(async (item) => {
      const lookupId = item.imdbId || item.contentId;
      const cacheKey = `${item.contentType}:${lookupId}`;
      const cached = enrichedMetaCache.get(cacheKey);
      let meta = null;
      if (cached && now - cached.timestamp < ENRICHED_META_CACHE_TTL_MS) {
        meta = cached.meta;
      } else {
        const canonicalType = item.contentType === "series" ? "series" : "movie";
        meta = await withTimeout(
          metaRepository.getMetaFromAllAddons(canonicalType, lookupId),
          PROGRESS_META_TIMEOUT_MS,
          null
        ).catch(() => null);
        // Only cache real metadata. Caching a null (timeout/miss) would leave the
        // item unenriched for the full TTL after a single slow response.
        if (meta) {
          enrichedMetaCache.set(cacheKey, { meta, timestamp: now });
        }
      }
      return meta ? { ...item, enrichedMeta: meta } : item;
    })
  );
}

class WatchProgressRepository {
  async saveProgress(progress) {
    if (isSeriesType(progress?.contentType)) {
      ContinueWatchingPreferences.removeDismissedNextUpKeysForContent(
        progress?.contentId,
        activeProfileId()
      );
    }
    WatchProgressStore.upsert(
      {
        ...progress,
        source: String(progress?.source || "").trim() || selectedLocalProgressSource(),
        updatedAt: progress.updatedAt || Date.now()
      },
      activeProfileId()
    );
    invalidateContinueWatchingDisplaySnapshot();
    queueWatchProgressCloudSync();
  }

  async getProgressByContentId(contentId) {
    return WatchProgressStore.findByContentId(contentId, activeProfileId());
  }

  async getResumeByContentIds(contentIds, target = {}) {
    const candidates = normalizeContentIdList(contentIds);
    if (!candidates.length) {
      return null;
    }
    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    let sourceItems = filterForSelectedContinueWatchingSource(localItems);

    if (
      selectedContinueWatchingSource() === WatchProgressSource.TRAKT &&
      TraktAuthStore.isAuthenticated()
    ) {
      sourceItems = await this.getRecent(300).catch((error) => {
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
    const removedItems = WatchProgressStore.listForProfile(pid).filter((item) =>
      matchesProgressTarget(item, contentId, videoId)
    );
    WatchProgressStore.remove(contentId, videoId, pid);
    await deleteWatchProgressFromCloud(removedItems);
    invalidateContinueWatchingDisplaySnapshot();
    queueWatchProgressCloudSync();
  }

  async getRecent(limit = 30) {
    const now = Date.now();
    const useTraktProgress = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
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
    }

    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    const allItems = [
      ...localItems,
      ...traktHistoryItems,
      ...playbackItems,
      ...watchedShowSeedItems
    ];

    const recentItems = filterForSelectedContinueWatchingSource(allItems)
      .filter((item) => cutoffMs === 0 || Number(item?.updatedAt || 0) >= cutoffMs)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 300);

    const inProgressOnly = deduplicateInProgress(recentItems);

    const enrichedItems = await batchEnrichProgressItems(inProgressOnly.slice(0, limit));
    return enrichedItems;
  }

  async getAll() {
    return WatchProgressStore.listForProfile(activeProfileId());
  }

  async getAllForContinueWatching() {
    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    if (selectedContinueWatchingSource() !== WatchProgressSource.TRAKT) {
      return filterForSelectedContinueWatchingSource(localItems);
    }
    const snapshot = await fetchTraktProgressSnapshot();
    return filterForSelectedContinueWatchingSource([
      ...localItems,
      ...snapshot.historyItems,
      ...snapshot.playbackItems,
      ...snapshot.watchedShowSeedItems
    ]);
  }

  getContinueWatchingSourceKey() {
    return `${activeProfileId()}:${selectedContinueWatchingSource()}`;
  }

  getContinueWatchingSource() {
    return selectedContinueWatchingSource();
  }

  async replaceAll(items) {
    WatchProgressStore.replaceForProfile(activeProfileId(), items || []);
    invalidateContinueWatchingDisplaySnapshot();
  }
}

export const watchProgressRepository = new WatchProgressRepository();
