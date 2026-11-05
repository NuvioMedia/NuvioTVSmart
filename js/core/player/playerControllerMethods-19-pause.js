/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods19() {
  const {
    CloudLibraryPlaybackProgressStore,
    CloudLibraryPlaybackSessionStore,
    cloudPlaybackFileForSession,
    MIN_PROGRESS_SYNC_DURATION_MS
  } = internals;

  return {
    pause() {
      if (!this.video) return;
      if (this.webOsDtsAudioState) {
        this.webOsDtsAudioState.resumePlayback = false;
        this.webOsDtsAudioState.controlPaused = true;
      }

      this.stopProgressSaving();
      this.cancelProgressSyncAfterSeek();
      this.flushCurrentProgress({ forceCloudSync: true });

      if (this.isUsingAvPlay()) {
        const avplay = this.getAvPlay();
        if (!avplay) {
          return;
        }
        try {
          avplay.pause?.();
          this.isPlaying = false;
          this.syncWebOsPlaybackKeepAwake();
          this.stopAvPlayTickTimer();
          this.emitVideoEvent("pause", { playbackEngine: this.playbackEngine });
        } catch (_) {
          // Ignore AVPlay pause failures.
        }
        return;
      }

      if (!this.setWebOsExactSeekPaused(true)) this.video.pause();
      this.isPlaying = false;
      this.syncWebOsPlaybackKeepAwake();
    },
    resume() {
      if (!this.video) return;
      if (this.webOsDtsAudioState) {
        this.webOsDtsAudioState.resumePlayback = true;
        this.webOsDtsAudioState.controlPaused = false;
      }

      this.cancelProgressSyncAfterSeek();
      this.flushCurrentProgress({ allowCloudSync: false });
      if (this.playbackSessionActive) {
        this.startProgressSaving();
      }
      if (this.startupAudioGateActive) {
        this.applyStartupAudioGateToVideo();
        return;
      }

      if (this.isUsingAvPlay()) {
        const avplay = this.getAvPlay();
        if (!avplay) {
          return;
        }
        try {
          avplay.play?.();
          this.isPlaying = true;
          this.syncWebOsPlaybackKeepAwake();
          this.reapplyAvPlayPlaybackRate();
          this.startAvPlayTickTimer();
          this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
          setTimeout(() => {
            this.reapplyAvPlayPlaybackRate();
            this.applyPendingAvPlayAudioTrackSelection();
            this.applyPendingAvPlaySubtitleTrackSelection();
          }, 0);
          setTimeout(() => {
            this.reapplyAvPlayPlaybackRate();
            this.applyPendingAvPlayAudioTrackSelection();
            this.applyPendingAvPlaySubtitleTrackSelection();
          }, 300);
        } catch (error) {
          this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(error?.name || error?.message || error);
          console.warn("Playback resume rejected", error);
        }
        return;
      }

      if (this.setWebOsExactSeekPaused(false)) {
        this.syncWebOsPlaybackKeepAwake();
        return;
      }
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          console.warn("Playback resume rejected", error);
        });
      }
      this.isPlaying = true;
      this.syncWebOsPlaybackKeepAwake();
    },
    stop({ forceCloudSync = true, allowCloudSync = true, flushProgress = true } = {}) {
      const seekTargetSeconds = this.getWebOsExactSeekTargetSeconds?.();
      this.cancelWebOsExactSeek({ pause: true });
      this.cancelProxyRedirectObservation?.();
      this.cancelProxyRedirectObservation = null;
      this.stopWebOsDtsAudioTranscode({ resetFailures: true });
      this.stopWebOsPlaybackKeepAlive();
      this.stopWebOsServiceKeepAlive();
      if (!this.video) return;

      this.stopProgressSaving();
      this.cancelProgressSyncAfterSeek();
      this.playRequestToken = Number(this.playRequestToken || 0) + 1;
      this.setStartupPresentationAudioMuted(false);
      const flushPromise = flushProgress
        ? this.flushCurrentProgress({ forceCloudSync, allowCloudSync, seekTargetSeconds })
        : Promise.resolve(false);
      if (!this.playbackSessionActive) {
        this.clearWebOsTrackSelections();
        this.syncWebOsPlaybackKeepAwake();
        return flushPromise;
      }
      this.playbackSessionActive = false;
      this.syncWebOsPlaybackKeepAwake();
      this.setStartupAudioGate(false, { resume: false });

      try {
        this.video.pause();
      } catch (_) {
        // Older TV media elements can throw while the native pipeline is tearing down.
      }
      this.teardownAdaptiveInstances();
      this.teardownAvPlay();
      this.clearWebOsTrackSelections();
      this.resetNativeMediaState();
      try {
        this.video.removeAttribute("src");
      } catch (_) {
        // Ignore source reset failures during route transitions.
      }
      try {
        Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
      } catch (_) {
        // Ignore source node cleanup failures.
      }
      try {
        this.video.load();
      } catch (_) {
        // Some legacy TV engines reject load() after AVPlay/native teardown.
      }

      this.isPlaying = false;
      this.syncWebOsPlaybackKeepAwake();
      this.currentItemId = null;
      this.currentItemType = null;
      this.currentImdbId = null;
      this.currentTmdbId = null;
      this.currentTraktId = null;
      this.currentVideoId = null;
      this.currentSeason = null;
      this.currentEpisode = null;
      this.currentCloudSessionToken = null;
      this.currentItemTitle = null;
      this.currentItemPoster = null;
      this.currentItemBackground = null;
      this.currentEpisodeTitle = null;
      this.currentStreamIdentity = null;
      this.currentPlaybackUrl = "";
      this.currentPlaybackHeaders = {};
      this.currentPlaybackMediaSourceType = null;
      this.lastKnownDurationSeconds = 0;
      this.lastSavedProgressPositionMs = 0;
      this.playbackEngine = "none";
      this.lastPlaybackErrorCode = 0;
      this.clearPlaybackEngineAttempts();
      this.avplayFallbackAttempts.clear();

      return flushPromise;
    },
    createProgressContext() {
      const itemType = this.currentItemType || "movie";
      const normalizedItemType = String(itemType).trim().toLowerCase();
      const isSeries = normalizedItemType === "series" || normalizedItemType === "tv";
      const isCloud = normalizedItemType === "cloud";
      return {
        itemId: this.currentItemId,
        itemType,
        imdbId: this.currentImdbId,
        tmdbId: this.currentTmdbId,
        traktId: this.currentTraktId,
        // Android stores movie progress at content level and episode progress at
        // the exact season/episode identity. A movie's discovery video ID can
        // vary between addons and must not split resume state by source.
        videoId: isSeries || isCloud ? this.currentVideoId || null : null,
        season: Number.isFinite(this.currentSeason) ? this.currentSeason : null,
        episode: Number.isFinite(this.currentEpisode) ? this.currentEpisode : null,
        title: this.currentItemTitle || null,
        poster: this.currentItemPoster || null,
        background: this.currentItemBackground || null,
        episodeTitle: this.currentEpisodeTitle || null,
        cloudSessionToken: isCloud ? this.currentCloudSessionToken : null,
        streamIdentity: this.currentStreamIdentity || null,
        progressSession: this.watchProgressSession || (this.watchProgressSession = { completedKeys: new Set() })
      };
    },
    buildProgressSnapshotKey(context = this.createProgressContext()) {
      if (!context?.itemId) {
        return "";
      }
      return [
        String(context.itemId || "").trim(),
        String(context.itemType || "movie").trim(),
        String(context.videoId || "").trim(),
        Number.isFinite(context.season) ? Number(context.season) : "",
        Number.isFinite(context.episode) ? Number(context.episode) : ""
      ].join("|");
    },
    recordProgressSnapshot(positionMs, durationMs, context = null) {
      const active = context || this.createProgressContext();
      const safePosition = Number(positionMs || 0);
      const safeDuration = Number(durationMs || 0);
      if (!active?.itemId || !Number.isFinite(safePosition) || safePosition <= 0) {
        return;
      }
      this.lastProgressSnapshot = {
        key: this.buildProgressSnapshotKey(active),
        positionMs: Math.max(0, Math.trunc(safePosition)),
        durationMs: Number.isFinite(safeDuration) && safeDuration > 0 ? Math.max(0, Math.trunc(safeDuration)) : 0,
        updatedAt: Date.now()
      };
    },
    getRecordedProgressSnapshot(context = null) {
      const active = context || this.createProgressContext();
      const snapshot = this.lastProgressSnapshot;
      if (!snapshot || !active?.itemId) {
        return null;
      }
      if (snapshot.key !== this.buildProgressSnapshotKey(active)) {
        return null;
      }
      return snapshot;
    },
    async flushCurrentProgress({
      forceCloudSync = false,
      allowCloudSync = true,
      seekTargetSeconds = this.getWebOsExactSeekTargetSeconds?.()
    } = {}) {
      if (this.currentPlaybackIsLive === true) {
        return false;
      }
      const context = this.createProgressContext();
      if (!context.itemId) {
        return false;
      }

      const snapshot = this.getRecordedProgressSnapshot(context);
      // Android exposes the requested position during an exact seek. LG's
      // decode pass can still be on earlier keyframes; never persist that clock.
      const seekTarget = seekTargetSeconds;
      const hasSeekTarget = typeof seekTarget === "number" && Number.isFinite(seekTarget);
      const currentPositionMs = Math.floor((hasSeekTarget ? seekTarget : this.getCurrentTimeSeconds()) * 1000);
      const currentDurationMs = Math.floor(this.getDurationSeconds() * 1000);
      const positionMs =
        hasSeekTarget || (Number.isFinite(currentPositionMs) && currentPositionMs > 0)
          ? currentPositionMs
          : Number(snapshot?.positionMs || 0);
      const durationMs =
        Number.isFinite(currentDurationMs) && currentDurationMs > 0 ? currentDurationMs : Number(snapshot?.durationMs || 0);

      await this.flushProgress(positionMs, durationMs, false, context, {
        allowCloudSync: allowCloudSync && !forceCloudSync,
        syncRemote: forceCloudSync ? true : allowCloudSync
      });
      if (forceCloudSync && String(context?.itemType || "").toLowerCase() !== "cloud") {
        await this.pushProgressIfDue(true);
      }
      return true;
    },
    async flushCloudLibraryProgress(positionMs, durationMs, clear = false, context = null) {
      const active = context || this.createProgressContext();
      const session = CloudLibraryPlaybackSessionStore.load(active?.cloudSessionToken);
      const file = cloudPlaybackFileForSession(session);
      if (!session?.item || !file) {
        return false;
      }

      const safePosition = Number(positionMs || 0);
      const safeDuration = Number(durationMs || 0);
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
      if (!Number.isFinite(safePosition) || safePosition <= 0) {
        return false;
      }
      return CloudLibraryPlaybackProgressStore.save(
        session.item,
        file,
        safePosition,
        hasFiniteDuration ? safeDuration : 0,
        isCompleted,
        active?.cloudSessionToken || null
      );
    }
  };
}
