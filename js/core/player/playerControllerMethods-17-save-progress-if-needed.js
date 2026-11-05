/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods17() {
  const { isShortPlaceholderDuration, WATCH_PROGRESS_SAVE_THRESHOLD_MS } = internals;

  return {
    saveProgressIfNeeded() {
      if (this.currentPlaybackIsLive === true || !this.playbackSessionActive || !this.isPlaying || this.isWebOsExactSeekInFlight?.()) {
        return false;
      }

      const positionMs = Math.floor(this.getCurrentTimeSeconds() * 1000);
      const durationMs = Math.floor(this.getDurationSeconds() * 1000);
      if (!Number.isFinite(positionMs) || positionMs <= 0) {
        return false;
      }
      if (isShortPlaceholderDuration(durationMs)) {
        return false;
      }
      if (Math.abs(positionMs - Number(this.lastSavedProgressPositionMs || 0)) < WATCH_PROGRESS_SAVE_THRESHOLD_MS) {
        return false;
      }

      this.lastSavedProgressPositionMs = positionMs;
      const context = this.createProgressContext();
      void this.flushProgress(positionMs, durationMs, false, context, {
        allowCloudSync: false,
        syncRemote: false
      }).catch((error) => {
        console.warn("Watch progress local checkpoint failed", error);
      });
      return true;
    },
    cancelProgressSyncAfterSeek() {
      if (this.progressSeekSyncTimer !== null) {
        clearTimeout(this.progressSeekSyncTimer);
        this.progressSeekSyncTimer = null;
      }
    },
    scheduleProgressSyncAfterSeek() {
      this.cancelProgressSyncAfterSeek();
      if (!this.playbackSessionActive) {
        return;
      }
      this.progressSeekSyncTimer = setTimeout(() => {
        this.progressSeekSyncTimer = null;
        if (!this.playbackSessionActive) {
          return;
        }
        void this.flushCurrentProgress({ forceCloudSync: true }).catch((error) => {
          console.warn("Watch progress seek sync failed", error);
        });
      }, 700);
    }
  };
}
