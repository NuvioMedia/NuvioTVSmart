/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods20() {
  const {
    watchProgressRepository,
    watchedItemsRepository,
    watchedSeriesReconciliationService,
    WatchProgressSyncService,
    isShortPlaceholderDuration,
    WATCH_PROGRESS_UNKNOWN_DURATION_PERCENT,
    MIN_PROGRESS_SYNC_DURATION_MS
  } = internals;

  return {
    async flushProgress(
      positionMs,
      durationMs,
      clear = false,
      context = null,
      { allowCloudSync = true, syncRemote = allowCloudSync } = {}
    ) {
      if (this.currentPlaybackIsLive === true) {
        return false;
      }
      const active = context || this.createProgressContext();
      if (!active?.itemId) {
        return;
      }

      if (String(active.itemType || "").toLowerCase() === "cloud") {
        return this.flushCloudLibraryProgress(positionMs, durationMs, clear, active);
      }

      // Like Android's hasMarkedCurrentEpisodeCompleted, keep completion sticky
      // for this playback. Capture the session in the context so an old async
      // flush cannot latch completion in a newly opened episode or replay.
      const session = active.progressSession || (this.watchProgressSession ||= { completedKeys: new Set() });
      const progressKey = this.buildProgressSnapshotKey(active);
      if (!clear && session.completedKeys.has(progressKey)) return false;

      const safePosition = Number(positionMs || 0);
      const safeDuration = Number(durationMs || 0);
      if (isShortPlaceholderDuration(safeDuration)) {
        // Debrid cache-sync/error clips must not create watched state or progress
        // records, whether this is the periodic flush or the native ended event.
        return false;
      }
      const hasFiniteDuration = Number.isFinite(safeDuration) && safeDuration > 0;
      const hasReachedMinimumSyncPosition = Number.isFinite(safePosition) && safePosition >= MIN_PROGRESS_SYNC_DURATION_MS;
      const isCompleted = hasFiniteDuration && safePosition / safeDuration >= 0.9;
      if (safePosition > 0) {
        this.recordProgressSnapshot(safePosition, safeDuration, active);
      }
      if (!clear && !isCompleted) {
        if (hasFiniteDuration && safeDuration < MIN_PROGRESS_SYNC_DURATION_MS) {
          return false;
        }
        if (!hasFiniteDuration && !hasReachedMinimumSyncPosition) {
          return false;
        }
      }

      if (isCompleted) {
        session.completedKeys.add(progressKey);
        // Playback scrobbling owns provider history, matching Android's
        // broadcastTrackingHistory = false completion path. Keep this local
        // completion from duplicating the provider history write.
        await watchedItemsRepository.mark(
          {
            contentId: active.itemId,
            contentType: active.itemType || "movie",
            imdbId: active.imdbId || null,
            tmdbId: active.tmdbId || null,
            traktId: active.traktId || null,
            title: active.episodeTitle || active.title || active.itemId,
            season: active.season,
            episode: active.episode,
            watchedAt: Date.now()
          },
          { skipTrackingWrite: true }
        );
      }

      if (clear || isCompleted) {
        if (isCompleted) {
          await watchProgressRepository.saveProgress(
            {
              contentId: active.itemId,
              contentType: active.itemType || "movie",
              imdbId: active.imdbId || null,
              tmdbId: active.tmdbId || null,
              traktId: active.traktId || null,
              videoId: active.videoId || null,
              season: active.season,
              episode: active.episode,
              title: active.title || null,
              poster: active.poster || null,
              background: active.background || null,
              logo: active.logo || null,
              episodeTitle: active.episodeTitle || null,
              positionMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : Math.max(0, Math.trunc(safePosition)),
              durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : Math.max(0, Math.trunc(safePosition))
            },
            { syncRemote }
          );
          if (watchedSeriesReconciliationService.isSeriesType(active.itemType)) {
            void watchedSeriesReconciliationService
              .reconcile(active.itemId, active.itemType, {
                title: active.title || active.itemId,
                completedEpisode: {
                  season: active.season,
                  episode: active.episode
                }
              })
              .catch((error) => {
                console.warn("Series watched reconciliation failed", error);
              });
          }
        } else {
          await watchProgressRepository.removeProgress(active.itemId, active.videoId || null);
        }
        if (!allowCloudSync) {
          return true;
        }
        return this.pushProgressIfDue(true);
      }

      if (!Number.isFinite(safePosition) || safePosition <= 0) {
        return false;
      }

      await watchProgressRepository.saveProgress(
        {
          contentId: active.itemId,
          contentType: active.itemType || "movie",
          imdbId: active.imdbId || null,
          tmdbId: active.tmdbId || null,
          traktId: active.traktId || null,
          videoId: active.videoId || null,
          season: active.season,
          episode: active.episode,
          title: active.title || null,
          poster: active.poster || null,
          background: active.background || null,
          logo: active.logo || null,
          episodeTitle: active.episodeTitle || null,
          // Persist the stream identity so Continue Watching can resume the same
          // source instead of reopening the stream picker.
          streamIdentity: active.streamIdentity || null,
          positionMs: Math.max(0, Math.trunc(safePosition)),
          durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : 0,
          progressPercent: hasFiniteDuration ? null : WATCH_PROGRESS_UNKNOWN_DURATION_PERCENT
        },
        { syncRemote }
      );
      if (!allowCloudSync) {
        return true;
      }
      return this.pushProgressIfDue(false);
    },
    pushProgressIfDue(force = false) {
      const now = Date.now();
      if (!force && now - Number(this.lastProgressPushAt || 0) < 30000) {
        return Promise.resolve(false);
      }
      this.lastProgressPushAt = now;
      return WatchProgressSyncService.push().catch((error) => {
        console.warn("Watch progress auto push failed", error);
        return false;
      });
    }
  };
}
