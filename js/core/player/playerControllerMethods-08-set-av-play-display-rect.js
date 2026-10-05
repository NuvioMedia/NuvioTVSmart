/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods08() {
  const {
    Platform,
    AVPLAY_BUFFER_FOR_PLAY_SECONDS,
    AVPLAY_BUFFER_FOR_RESUME_SECONDS,
    AVPLAY_BUFFERING_TIMEOUT_SECONDS,
    TIZEN_AVPLAY_DISPLAY_RECT_STATES,
    normalizeTizenAvPlayDisplayRect,
    syncTizenAvPlayObjectStyle
  } = internals;

  return {
    setAvPlayDisplayRect(rect = null, displayMethod = null) {
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      const viewport = this.getAvPlayViewportSize();
      if (Platform.isTizen() && displayMethod === "PLAYER_DISPLAY_MODE_LETTER_BOX") {
        // AVPlay applies letterboxing inside the display area. Keep that area
        // fullscreen instead of passing an already letterboxed rectangle.
        this.avplayDisplayRect = {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height
        };
      } else if (rect) {
        this.avplayDisplayRect = {
          x: Math.round(Number(rect.x || 0)),
          y: Math.round(Number(rect.y || 0)),
          width: Math.max(1, Math.round(Number(rect.width || viewport.width))),
          height: Math.max(1, Math.round(Number(rect.height || viewport.height)))
        };
      }
      if (displayMethod) {
        this.avplayDisplayMethod = String(displayMethod);
      }
      let targetRect = this.avplayDisplayRect || {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height
      };
      if (Platform.isTizen()) {
        targetRect = normalizeTizenAvPlayDisplayRect(targetRect, viewport);
        this.avplayDisplayRect = targetRect;
        syncTizenAvPlayObjectStyle(targetRect);
      }
      if (Platform.isTizen()) {
        let state = "";
        try {
          state = String(avplay.getState?.() || "")
            .trim()
            .toUpperCase();
        } catch (_) {
          return;
        }
        // Samsung rejects setDisplayRect/setDisplayMethod in NONE or other
        // transitional states. Keep the desired rectangle above and apply it
        // on the next IDLE/READY callback instead of issuing an invalid call.
        if (!TIZEN_AVPLAY_DISPLAY_RECT_STATES.has(state)) {
          return;
        }
      }
      try {
        avplay.setDisplayRect?.(targetRect.x, targetRect.y, targetRect.width, targetRect.height);
      } catch (_) {
        // Ignore display-rect failures.
      }
      try {
        avplay.setDisplayMethod?.(this.avplayDisplayMethod || "PLAYER_DISPLAY_MODE_FULL_SCREEN");
      } catch (_) {
        // Ignore display-method failures.
      }
    },
    reapplyTizenAvPlayDisplayRect(delayMs = 0) {
      if (!Platform.isTizen()) {
        return;
      }
      const apply = () => {
        if (this.isUsingAvPlay()) {
          this.setAvPlayDisplayRect();
        }
      };
      if (Number(delayMs || 0) > 0) {
        setTimeout(apply, Number(delayMs || 0));
        return;
      }
      apply();
    },
    teardownAvPlay() {
      this.clearAvPlaySeekTimeout();
      this.avplaySeekRequestToken = Number(this.avplaySeekRequestToken || 0) + 1;
      this.avplaySeekInFlight = false;
      const avplay = this.getAvPlay();

      this.stopAvPlayTickTimer();
      if (avplay) {
        try {
          // Clear Samsung's native subtitle plane while AVPlay is still in a
          // state where setSilentSubtitle() is valid. Otherwise a corrupted
          // subtitle surface can remain visible after the player DOM is gone.
          avplay.setSilentSubtitle?.(true);
        } catch (_) {
          // Continue with stop/close even when the firmware rejects the toggle.
        }
        try {
          avplay.setListener?.({});
        } catch (_) {
          // Ignore listener reset failures.
        }
        try {
          const state = String(avplay.getState?.() || "").toUpperCase();
          if (state && state !== "NONE" && state !== "IDLE") {
            avplay.stop?.();
          }
        } catch (_) {
          // Ignore stop failures.
        }
        try {
          avplay.close?.();
        } catch (_) {
          // Ignore close failures.
        }
      }

      this.avplayActive = false;
      this.avplayUrl = "";
      this.avplayAudioTracks = [];
      this.avplaySubtitleTracks = [];
      this.selectedAvPlayAudioTrackIndex = -1;
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.pendingAvPlayAudioTrackIndex = -1;
      this.desiredAvPlayAudioTrackIndex = -1;
      this.desiredAvPlayAudioTrackUntil = 0;
      this.pendingAvPlaySubtitleTrackIndex = -1;
      this.pendingAvPlaySubtitleReactivation = false;
      this.desiredAvPlaySubtitleTrackIndex = -1;
      this.desiredAvPlaySubtitleTrackUntil = 0;
      this.avplaySubtitleSelectionToken = Number(this.avplaySubtitleSelectionToken || 0) + 1;
      this.avplaySubtitlesSilent = false;
      this.avplayNativeSubtitleRendering = false;
      this.avplaySubtitleRenderMode = "native";
      this.avplayExternalSubtitlePath = "";
      this.avplayExternalSubtitleDelayMs = 0;
      this.appliedAvPlayExternalSubtitleDelayKey = "";
      this.avplayReady = false;
      this.avplayEnded = false;
      this.avplayCurrentTimeMs = 0;
      this.avplayDurationMs = 0;
      this.avplayBufferingProgress = null;
      this.avplayBufferingStartedAt = 0;
      this.avplayLastBufferingDurationMs = 0;
      this.avplayLastErrorDiagnostic = null;
      this.appliedAvPlayPlaybackRate = 1;
    },
    configureAvPlayForSource(requestHeaders = {}) {
      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.setStreamingProperty !== "function") {
        return;
      }

      const headers = requestHeaders && typeof requestHeaders === "object" ? requestHeaders : {};
      const cookieHeader = Object.entries(headers).find(
        ([key]) =>
          String(key || "")
            .trim()
            .toLowerCase() === "cookie"
      )?.[1];
      const userAgentHeader = Object.entries(headers).find(
        ([key]) =>
          String(key || "")
            .trim()
            .toLowerCase() === "user-agent"
      )?.[1];

      try {
        if (cookieHeader) {
          avplay.setStreamingProperty("COOKIE", String(cookieHeader));
        }
      } catch (_) {
        // Ignore unsupported AVPlay header properties.
      }
      try {
        if (userAgentHeader) {
          avplay.setStreamingProperty("USER_AGENT", String(userAgentHeader));
        }
      } catch (_) {
        // Ignore unsupported AVPlay header properties.
      }
    },
    configureAvPlayBuffering() {
      const avplay = this.getAvPlay();
      if (!avplay || Platform.isTizen()) {
        // Match Stremio's Tizen AVPlay path: leave buffering thresholds and the
        // timeout to Samsung's model-specific defaults. Small fixed buffers can
        // make high-bitrate REMUX playback repeatedly drain and resume.
        return;
      }

      try {
        avplay.setBufferingParam?.("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", AVPLAY_BUFFER_FOR_PLAY_SECONDS);
      } catch (_) {
        // Older firmware can reject custom buffering parameters.
      }
      try {
        avplay.setBufferingParam?.("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", AVPLAY_BUFFER_FOR_RESUME_SECONDS);
      } catch (_) {
        // Keep AVPlay's default resume buffer when unsupported.
      }
      try {
        avplay.setTimeoutForBuffering?.(AVPLAY_BUFFERING_TIMEOUT_SECONDS);
      } catch (_) {
        // Keep AVPlay's default timeout when unsupported.
      }
    }
  };
}
