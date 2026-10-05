/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods06() {
  const {
    logTizenAvPlayDebug,
    isValidAvPlayAudioTrackSelectionState,
    isValidAvPlaySubtitleTrackSelectionState,
    normalizeAvPlaySubtitleRenderMode
  } = internals;

  return {
    setAvPlayAudioTrack(trackIndex) {
      if (!this.isUsingAvPlay()) {
        return false;
      }
      const targetIndex = this.resolveAvPlayAudioTrackIndex(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return false;
      }

      const selectionIndex = this.getAvPlayAudioTrackSelectionIndex(targetIndex);
      if (selectionIndex < 0) {
        return false;
      }

      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.setSelectTrack !== "function") {
        return false;
      }

      const selectionToken = this.playRequestToken;
      this.desiredAvPlayAudioTrackIndex = targetIndex;
      this.desiredAvPlayAudioTrackUntil = Date.now() + 5000;
      const state = this.getAvPlayState();
      const canApplyNow = isValidAvPlayAudioTrackSelectionState(state);
      const shouldDeferUntilPlay = !canApplyNow;
      logTizenAvPlayDebug("Tizen AVPlay audio track requested", {
        state,
        uiTrackIndex: Number(trackIndex),
        realAvPlayTrackIndex: targetIndex,
        selectionIndex,
        canApplyNow,
        shouldDeferUntilPlay,
        audioTracks: this.avplayAudioTracks
      });
      if (!canApplyNow || shouldDeferUntilPlay) {
        this.pendingAvPlayAudioTrackIndex = targetIndex;
        this.selectedAvPlayAudioTrackIndex = targetIndex;
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      }

      try {
        if (!this.trySelectAvPlayAudioTrackIndex(selectionIndex)) {
          throw new Error("setSelectTrack failed");
        }
        this.pendingAvPlayAudioTrackIndex = -1;
        this.selectedAvPlayAudioTrackIndex = targetIndex;
        this.syncAvPlayTrackInfo({ force: true });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        setTimeout(() => {
          if (!this.isUsingAvPlay() || this.playRequestToken !== selectionToken || this.desiredAvPlayAudioTrackIndex !== targetIndex) {
            return;
          }
          this.retryAvPlayAudioTrackSelection(targetIndex);
          this.applyPendingAvPlayAudioTrackSelection();
          this.syncAvPlayTrackInfo({ force: true });
          this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        }, 400);
        setTimeout(() => {
          if (!this.isUsingAvPlay() || this.playRequestToken !== selectionToken || this.desiredAvPlayAudioTrackIndex !== targetIndex) {
            return;
          }
          this.retryAvPlayAudioTrackSelection(targetIndex);
          this.applyPendingAvPlayAudioTrackSelection();
          this.syncAvPlayTrackInfo({ force: true });
          this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        }, 1200);
        return true;
      } catch (error) {
        logTizenAvPlayDebug("Tizen AVPlay audio track request failed", {
          state,
          realAvPlayTrackIndex: targetIndex,
          error: error?.message || String(error || "")
        });
        return false;
      }
    },
    applyPendingAvPlayAudioTrackSelection() {
      const pendingIndex = Number(this.pendingAvPlayAudioTrackIndex);
      const desiredIndex = Number(this.desiredAvPlayAudioTrackIndex);
      const desiredActive =
        Number.isFinite(desiredIndex) && desiredIndex >= 0 && Date.now() < Number(this.desiredAvPlayAudioTrackUntil || 0);
      const targetIndex = Number.isFinite(pendingIndex) && pendingIndex >= 0 ? pendingIndex : desiredActive ? desiredIndex : -1;
      const canonicalIndex = this.resolveAvPlayAudioTrackIndex(targetIndex);
      if (!this.isUsingAvPlay() || !Number.isFinite(canonicalIndex) || canonicalIndex < 0) {
        return false;
      }

      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.setSelectTrack !== "function") {
        return false;
      }

      const state = this.getAvPlayState();
      if (state && !isValidAvPlayAudioTrackSelectionState(state)) {
        return false;
      }

      try {
        if (!this.retryAvPlayAudioTrackSelection(canonicalIndex)) {
          const selectionIndex = this.getAvPlayAudioTrackSelectionIndex(canonicalIndex);
          if (!this.trySelectAvPlayAudioTrackIndex(selectionIndex)) {
            throw new Error("setSelectTrack failed");
          }
        }
        if (Number.isFinite(pendingIndex) && pendingIndex === canonicalIndex) {
          this.pendingAvPlayAudioTrackIndex = -1;
        }
        this.selectedAvPlayAudioTrackIndex = canonicalIndex;
        this.desiredAvPlayAudioTrackIndex = canonicalIndex;
        this.desiredAvPlayAudioTrackUntil = Date.now() + 5000;
        this.syncAvPlayTrackInfo({ force: true });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      } catch (_) {
        return false;
      }
    },
    retryPendingAvPlayStartupAudioTrackSelection() {
      const pendingIndex = Number(this.pendingAvPlayAudioTrackIndex);
      if (!Number.isFinite(pendingIndex) || pendingIndex < 0) {
        return false;
      }

      const deadline = Number(this.desiredAvPlayAudioTrackUntil || 0);
      if (deadline > 0 && Date.now() >= deadline) {
        this.pendingAvPlayAudioTrackIndex = -1;
        return false;
      }

      return this.applyPendingAvPlayAudioTrackSelection();
    },
    nudgeAvPlayAfterTrackSwitch() {
      if (this.avplaySeekInFlight) {
        return;
      }
      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.seekTo !== "function") {
        return;
      }
      try {
        const currentMs = Math.max(0, Number(avplay.getCurrentTime?.() || this.avplayCurrentTimeMs || 0));
        if (Number.isFinite(currentMs) && currentMs > 0) {
          this.seekAvPlayTo(Math.max(0, currentMs - 1), { emitEvents: false });
        }
      } catch (_) {
        // Track switching is still valid without a seek nudge.
      }
    },
    setAvPlaySubtitleTrack(trackIndex, { renderMode = this.avplaySubtitleRenderMode } = {}) {
      if (!this.isUsingAvPlay()) {
        return false;
      }

      const avplay = this.getAvPlay();
      if (!avplay) {
        return false;
      }

      const selectionToken = Number(this.avplaySubtitleSelectionToken || 0) + 1;
      this.avplaySubtitleSelectionToken = selectionToken;
      this.avplaySubtitleRenderMode = normalizeAvPlaySubtitleRenderMode(renderMode);
      // AVPlay can keep reporting the previous TEXT index after subtitles were
      // hidden. Match Android's explicit TEXT re-enable by forcing only the
      // bounded retries that return from Off/an addon to a built-in track.
      const shouldForceSubtitleReactivation = Boolean(this.avplaySubtitlesSilent);

      const targetIndex = Number(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        this.pendingAvPlaySubtitleTrackIndex = -1;
        this.pendingAvPlaySubtitleReactivation = false;
        this.desiredAvPlaySubtitleTrackIndex = -1;
        this.desiredAvPlaySubtitleTrackUntil = Date.now() + 5000;
        this.clearAvPlayExternalSubtitlePath();
        try {
          avplay.setSilentSubtitle?.(true);
          this.avplaySubtitlesSilent = true;
        } catch (_) {
          this.avplaySubtitlesSilent = true;
          // Ignore subtitle mute failures.
        }
        this.avplayNativeSubtitleRendering = false;
        this.selectedAvPlaySubtitleTrackIndex = -1;
        this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
        this.avplaySubtitleDiagnosticCallbackPendingAt = 0;
        logTizenAvPlayDebug("Tizen AVPlay subtitle track disabled", {
          selectionToken,
          outputDisabled: true,
          renderMode: this.avplaySubtitleRenderMode
        });
        this.logAvPlaySubtitleDiagnostic("disabled", {
          selectionToken
        });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      }

      const canonicalIndex = this.resolveAvPlaySubtitleTrackIndex(targetIndex);
      if (!Number.isFinite(canonicalIndex) || canonicalIndex < 0) {
        return false;
      }

      this.clearAvPlayExternalSubtitlePath();
      this.desiredAvPlaySubtitleTrackIndex = canonicalIndex;
      this.desiredAvPlaySubtitleTrackUntil = Date.now() + 5000;
      const state = this.getAvPlayState();
      const canApplyNow = isValidAvPlaySubtitleTrackSelectionState(state);
      const shouldDeferUntilPlay = !canApplyNow;
      logTizenAvPlayDebug("Tizen AVPlay subtitle track requested", {
        state,
        uiTrackIndex: targetIndex,
        realAvPlayTrackIndex: canonicalIndex,
        canApplyNow,
        shouldDeferUntilPlay,
        subtitleTracks: this.avplaySubtitleTracks
      });
      this.logAvPlaySubtitleDiagnostic("requested", {
        selectionToken,
        targetIndex: canonicalIndex,
        mode: this.avplaySubtitleRenderMode,
        reactivate: shouldForceSubtitleReactivation,
        canApplyNow
      });
      if (!canApplyNow || shouldDeferUntilPlay) {
        this.pendingAvPlaySubtitleTrackIndex = canonicalIndex;
        this.pendingAvPlaySubtitleReactivation = shouldForceSubtitleReactivation;
        this.selectedAvPlaySubtitleTrackIndex = canonicalIndex;
        this.avplaySubtitlesSilent = false;
        this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      }

      try {
        if (
          !this.trySelectAvPlaySubtitleTrackIndex(canonicalIndex, {
            reactivate: shouldForceSubtitleReactivation,
            renderMode: this.avplaySubtitleRenderMode
          })
        ) {
          throw new Error("setSelectTrack failed");
        }
        this.pendingAvPlaySubtitleTrackIndex = -1;
        this.pendingAvPlaySubtitleReactivation = false;
      } catch (error) {
        logTizenAvPlayDebug("Tizen AVPlay subtitle track request failed", {
          state,
          realAvPlayTrackIndex: canonicalIndex,
          error: error?.message || String(error || "")
        });
        return false;
      }

      this.selectedAvPlaySubtitleTrackIndex = canonicalIndex;
      this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
      this.syncAvPlayTrackInfo({ force: true });
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      [350, 1000].forEach((delayMs) => {
        setTimeout(() => {
          if (
            !this.isUsingAvPlay() ||
            selectionToken !== Number(this.avplaySubtitleSelectionToken || 0) ||
            canonicalIndex !== Number(this.desiredAvPlaySubtitleTrackIndex)
          ) {
            return;
          }
          this.retryAvPlaySubtitleTrackSelection(canonicalIndex, {
            force: shouldForceSubtitleReactivation,
            renderMode: this.avplaySubtitleRenderMode
          });
          this.syncAvPlayTrackInfo({ force: true });
          this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        }, delayMs);
      });
      return true;
    },
    applyPendingAvPlaySubtitleTrackSelection() {
      const pendingIndex = Number(this.pendingAvPlaySubtitleTrackIndex);
      const pendingReactivation = Boolean(this.pendingAvPlaySubtitleReactivation);
      const desiredIndex = Number(this.desiredAvPlaySubtitleTrackIndex);
      const desiredActive =
        Number.isFinite(desiredIndex) && desiredIndex >= 0 && Date.now() < Number(this.desiredAvPlaySubtitleTrackUntil || 0);
      const targetIndex = Number.isFinite(pendingIndex) && pendingIndex >= 0 ? pendingIndex : desiredActive ? desiredIndex : -1;
      const canonicalIndex = this.resolveAvPlaySubtitleTrackIndex(targetIndex);
      if (!this.isUsingAvPlay() || !Number.isFinite(canonicalIndex) || canonicalIndex < 0) {
        return false;
      }

      const state = this.getAvPlayState();
      if (state && !isValidAvPlaySubtitleTrackSelectionState(state)) {
        return false;
      }

      try {
        if (
          !this.retryAvPlaySubtitleTrackSelection(canonicalIndex, {
            force: pendingReactivation,
            renderMode: this.avplaySubtitleRenderMode
          })
        ) {
          throw new Error("setSelectTrack failed");
        }
        if (Number.isFinite(pendingIndex) && pendingIndex === canonicalIndex) {
          this.pendingAvPlaySubtitleTrackIndex = -1;
          this.pendingAvPlaySubtitleReactivation = false;
        }
        this.selectedAvPlaySubtitleTrackIndex = canonicalIndex;
        this.desiredAvPlaySubtitleTrackIndex = canonicalIndex;
        this.desiredAvPlaySubtitleTrackUntil = Date.now() + 5000;
        this.avplaySubtitlesSilent = false;
        this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
        this.syncAvPlayTrackInfo({ force: true });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      } catch (_) {
        return false;
      }
    }
  };
}
