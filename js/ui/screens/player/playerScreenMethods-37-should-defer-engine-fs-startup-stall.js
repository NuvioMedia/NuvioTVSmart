/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

const TIZEN_AVPLAY_DIRECT_STARTUP_STALL_TIMEOUT_MS = 20000;

export function createPlayerScreenMethods37() {
  const {
    PlayerController,
    Environment,
    WEBOS_HLS_REBUFFER_STALL_TIMEOUT_MS,
    TIZEN_NATIVE_HLS_STARTUP_STALL_TIMEOUT_MS,
    logEngineFsDebug
  } = internals;

  return {
    shouldDeferEngineFsStartupStall(stats = null) {
      const snapshot = this.getEngineFsStallSnapshot(stats);
      if (!snapshot) {
        return false;
      }
      const previous = this.lastEngineFsStallStats || null;
      this.lastEngineFsStallStats = snapshot;

      const progressIncreased =
        previous && snapshot.progress >= 0 && previous.progress >= 0 && snapshot.progress > previous.progress + 0.000001;
      const downloadedIncreased =
        previous && snapshot.downloaded >= 0 && previous.downloaded >= 0 && snapshot.downloaded > previous.downloaded;
      const activelyDownloading = snapshot.downloadSpeed > 0 || progressIncreased || downloadedIncreased;
      const swarmIsAlive = snapshot.peers > 0 || snapshot.unique > 0 || snapshot.connectionTries > 0 || snapshot.peerSearchRunning;

      if (activelyDownloading) {
        return true;
      }
      return swarmIsAlive && Number(this.engineFsStallExtensions || 0) < 10;
    },
    shouldRetryEngineFsStartupError(stats = null) {
      const retryCount = Number(this.engineFsStartupErrorRetries || 0);
      const snapshot = this.getEngineFsStallSnapshot(stats);
      if (!snapshot) {
        return retryCount < 3;
      }

      const previous = this.lastEngineFsStartupErrorStats || null;
      this.lastEngineFsStartupErrorStats = snapshot;
      const progressIncreased =
        previous && snapshot.progress >= 0 && previous.progress >= 0 && snapshot.progress > previous.progress + 0.000001;
      const downloadedIncreased =
        previous && snapshot.downloaded >= 0 && previous.downloaded >= 0 && snapshot.downloaded > previous.downloaded;
      const hasDownloadedData = snapshot.downloaded > 0;
      const activelyDownloading = snapshot.downloadSpeed > 0 || progressIncreased || downloadedIncreased;
      const swarmIsAlive = snapshot.peers > 0 || snapshot.unique > 0 || snapshot.connectionTries > 0 || snapshot.peerSearchRunning;

      return retryCount < 10 && (activelyDownloading || hasDownloadedData || swarmIsAlive);
    },
    scheduleEngineFsStartupRetry({ mediaErrorCode = 0, stats = null } = {}) {
      if (!this.currentEngineFsStream || !this.activePlaybackUrl) {
        return false;
      }
      if (this.engineFsStartupRetryTimer) {
        clearTimeout(this.engineFsStartupRetryTimer);
        this.engineFsStartupRetryTimer = null;
      }

      this.engineFsStartupErrorRetries = Number(this.engineFsStartupErrorRetries || 0) + 1;
      const retry = this.engineFsStartupErrorRetries;
      const delayMs = Math.min(18000, 4500 + retry * 2500);
      const retryUrl = this.activePlaybackUrl;
      const sourceCandidate = this.getStreamCandidateByUrl(retryUrl) || this.getCurrentStreamCandidate();
      const snapshot = this.getEngineFsStallSnapshot(stats);
      const startupMediaErrorWithEmptyEngine =
        Number(mediaErrorCode) > 0 && snapshot && snapshot.downloaded <= 0 && snapshot.progress <= 0 && snapshot.downloadSpeed <= 0;
      const recreateLocalEngineFs =
        (!stats || (startupMediaErrorWithEmptyEngine && retry <= 3)) &&
        Environment.isWebOS() &&
        this.currentEngineFsStream.kind === "webos-enginefs" &&
        Boolean(sourceCandidate);

      this.lastPlaybackErrorAt = 0;
      this.loadingVisible = true;
      this.paused = false;
      this.sourcesError = null;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(false, { focus: false });
      this.schedulePlaybackStallGuard({ timeoutMs: delayMs + 12000 });

      logEngineFsDebug(
        recreateLocalEngineFs
          ? "EngineFS startup unavailable; recreating local torrent before retry"
          : "EngineFS startup decode error while buffering; retrying same source",
        {
          retry,
          delayMs,
          mediaErrorCode,
          playbackUrl: retryUrl,
          recreateLocalEngineFs,
          stats: snapshot
        }
      );

      this.engineFsStartupRetryTimer = setTimeout(() => {
        this.engineFsStartupRetryTimer = null;
        if (this.hasPresentedPlaybackFrame || this.activePlaybackUrl !== retryUrl || !this.currentEngineFsStream) {
          return;
        }
        if (recreateLocalEngineFs) {
          void this.playStreamCandidate(sourceCandidate, {
            preservePanel: true,
            resetSilentAudioState: false,
            preservePendingRestore: Boolean(this.pendingPlaybackRestore),
            forceEngineFsResolve: true
          });
          return;
        }
        void this.playStreamByUrl(retryUrl, {
          preservePanel: true,
          resetSilentAudioState: false,
          preservePendingRestore: Boolean(this.pendingPlaybackRestore),
          sourceCandidate
        });
      }, delayMs);
      return true;
    },
    getPlaybackStallTimeoutMs({ startup = false } = {}) {
      const playbackEngine = String(PlayerController.playbackEngine || "");
      if (startup) {
        if (Environment.isTizen() && playbackEngine === "native-hls") {
          // The native-hls path is the first fallback after AVPlay fails on the
          // affected Tizen TVs. Bound only this startup fallback; keep hls.js,
          // AVPlay and post-first-frame buffering on their existing policies.
          return TIZEN_NATIVE_HLS_STARTUP_STALL_TIMEOUT_MS;
        }
        if (this.canRetryTizenAvPlayThroughLocalProxy?.()) {
          // A healthy direct AVPlay start prepares in a few seconds; a stuck
          // one falls back to the local proxy instead of waiting a minute.
          return TIZEN_AVPLAY_DIRECT_STARTUP_STALL_TIMEOUT_MS;
        }
        if (Environment.isTizen() || Environment.isWebOS()) {
          return playbackEngine.endsWith("avplay") ? 60000 : 45000;
        }
        return 18000;
      }
      if (Environment.isTizen()) {
        return playbackEngine.endsWith("avplay") ? 22000 : 16000;
      }
      if (Environment.isWebOS()) {
        if (playbackEngine === "hls.js") {
          // Match Android's 15-second playback stall watchdog.
          return WEBOS_HLS_REBUFFER_STALL_TIMEOUT_MS;
        }
        return playbackEngine.endsWith("avplay") ? 16000 : 12000;
      }
      return 9000;
    }
  };
}
