/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods09() {
  const { Platform, logTizenAvPlayDebug } = internals;

  return {
    playWithAvPlay(url, requestHeaders = {}, _sourceType = null, playToken = null) {
      if (!this.canUseAvPlay()) {
        return false;
      }
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return false;
      }

      const avplay = this.getAvPlay();
      if (!avplay) {
        return false;
      }

      this.teardownAvPlay();

      this.avplayUrl = String(url || "");
      this.avplayReady = false;
      this.avplayEnded = false;
      this.avplayCurrentTimeMs = 0;
      this.avplayDurationMs = 0;
      this.avplaySubtitleDiagnosticCallbackPendingAt = 0;
      this.lastPlaybackErrorCode = 0;
      this.playbackEngine = this.getPlatformAvplayEngineName();
      this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });

      try {
        avplay.open(this.avplayUrl);
        // Do not expose the AVPlay session to resize/focus callbacks until open
        // has moved the native object out of NONE and into IDLE.
        this.avplayActive = true;
        this.configureAvPlayForSource(requestHeaders);
        this.configureAvPlayBuffering();
      } catch (error) {
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode([error?.name, error?.message].filter(Boolean).join(": ") || error);
        this.teardownAvPlay();
        this.playbackEngine = "none";
        return false;
      }

      try {
        avplay.setListener?.({
          onbufferingstart: () => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            if (!this.avplayBufferingStartedAt) {
              this.avplayBufferingStartedAt = Date.now();
            }
            this.avplayBufferingProgress = null;
            this.avplayReady = false;
            this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
          },
          onbufferingprogress: (percent) => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            const numericPercent = Number(percent);
            if (Number.isFinite(numericPercent)) {
              this.avplayBufferingProgress = Math.max(0, Math.min(100, numericPercent));
            }
            logTizenAvPlayDebug("Tizen AVPlay buffering progress", {
              percent: this.avplayBufferingProgress,
              state: this.getAvPlayState(),
              currentTimeMs: this.avplayCurrentTimeMs
            });
          },
          onbufferingcomplete: () => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            if (this.avplayBufferingStartedAt) {
              this.avplayLastBufferingDurationMs = Math.max(0, Date.now() - this.avplayBufferingStartedAt);
            }
            this.avplayBufferingStartedAt = 0;
            if (this.avplaySeekInFlight) {
              return;
            }
            this.avplayReady = true;
            this.reapplyAvPlayPlaybackRate();
            this.retryPendingAvPlayStartupAudioTrackSelection();
            this.applyAvPlayExternalSubtitleDelay();
            this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
          },
          oncurrentplaytime: (currentTimeMs) => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            if (this.avplaySeekInFlight) {
              return;
            }
            const value = Number(currentTimeMs || 0);
            if (Number.isFinite(value) && value >= 0) {
              this.avplayCurrentTimeMs = value;
            }
            this.retryPendingAvPlayStartupAudioTrackSelection();
            this.applyAvPlayExternalSubtitleDelay();
            this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
          },
          onstreamcompleted: () => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            this.avplayEnded = true;
            this.isPlaying = false;
            this.syncWebOsPlaybackKeepAwake();
            this.stopAvPlayTickTimer();
            this.refreshAvPlayTimeline();
            const completedDurationMs = Number(this.avplayDurationMs || 0);
            if (Number.isFinite(completedDurationMs) && completedDurationMs > 0) {
              this.avplayCurrentTimeMs = Math.max(Number(this.avplayCurrentTimeMs || 0), completedDurationMs);
            }
            this.emitVideoEvent("ended", { playbackEngine: this.playbackEngine });
            try {
              avplay.stop?.();
            } catch (_) {
              // Ignore stream-complete stop failures.
            }
          },
          onsubtitlechange: (duration, subtitles, type, attributes) => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            const diagnosticSelectionAt = Number(this.avplaySubtitleDiagnosticCallbackPendingAt || 0);
            if (diagnosticSelectionAt > 0) {
              this.avplaySubtitleDiagnosticCallbackPendingAt = 0;
              const captureStartedAt = Number(globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY_STARTED_AT__ || 0);
              if (globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ === true && diagnosticSelectionAt >= captureStartedAt) {
                const subtitlePayload = String(subtitles || "");
                logTizenAvPlayDebug("Tizen AVPlay subtitle callback received", {
                  elapsedSinceSelectionMs: Math.max(0, Date.now() - diagnosticSelectionAt),
                  durationMs: Number(duration || 0) || 0,
                  type: String(type ?? ""),
                  attributeCount: Array.isArray(attributes) ? attributes.length : attributes == null ? 0 : 1,
                  hasPayload: subtitlePayload.length > 0,
                  payloadLength: subtitlePayload.length,
                  current: this.getAvPlaySubtitleDiagnosticSnapshot(),
                  selectedTrackIndex: Number(this.selectedAvPlaySubtitleTrackIndex),
                  outputDisabled: Boolean(this.avplaySubtitlesSilent),
                  renderMode: this.avplaySubtitleRenderMode,
                  nativeRendering: Boolean(this.avplayNativeSubtitleRendering)
                });
              }
            }
            this.emitVideoEvent("avplaysubtitlechange", {
              playbackEngine: this.playbackEngine,
              diagnosticSelectionAt,
              duration,
              subtitles,
              type,
              attributes
            });
          },
          onerror: (errorValue) => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            const avplayErrorDetail = this.getLastAvPlayErrorDiagnostic();
            const avplaySnapshot = this.getAvPlayDiagnosticSnapshot();
            this.clearAvPlaySeekTimeout();
            if (this.avplaySeekInFlight) {
              this.avplaySeekInFlight = false;
              this.avplaySeekRequestToken = Number(this.avplaySeekRequestToken || 0) + 1;
            }
            this.avplayReady = false;
            this.isPlaying = false;
            this.syncWebOsPlaybackKeepAwake();
            this.avplayBufferingStartedAt = 0;
            this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
            this.stopAvPlayTickTimer();
            this.emitVideoEvent("error", {
              playbackEngine: this.playbackEngine,
              mediaErrorCode: this.lastPlaybackErrorCode,
              avplayError: String(errorValue || ""),
              avplayErrorDetail,
              avplaySnapshot
            });
          },
          onerrormsg: (errorType, errorMessage) => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            const detail = this.normalizeAvPlayErrorDiagnostic(errorType, errorMessage);
            this.avplayLastErrorDiagnostic = detail;
            if (Platform.isTizen() && detail) {
              console.warn("[Nuvio AVPlay error detail]", detail);
            }
          }
        });
      } catch (_) {
        // Ignore listener setup failures; prepareAsync/play may still work.
      }

      // Samsung recommends installing the listener while AVPlay is IDLE before
      // configuring the display and starting prepareAsync.
      this.setAvPlayDisplayRect();

      const onPrepared = () => {
        if (!this.isUsingAvPlay() || !this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        this.avplayReady = true;
        this.avplayEnded = false;
        this.reapplyTizenAvPlayDisplayRect();
        this.refreshAvPlayTimeline();
        this.syncAvPlayTrackInfo({ force: true });
        this.emitVideoEvent("loadedmetadata", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("loadeddata", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        if (this.startupAudioGateActive) {
          return;
        }
        this.startPreparedAvPlayPlayback({ syncTracks: true });
        this.reapplyTizenAvPlayDisplayRect(250);
      };

      const onPrepareError = (errorValue) => {
        if (!this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        const avplayErrorDetail = this.getLastAvPlayErrorDiagnostic();
        const avplaySnapshot = this.getAvPlayDiagnosticSnapshot();
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
        this.isPlaying = false;
        this.syncWebOsPlaybackKeepAwake();
        this.teardownAvPlay();
        this.playbackEngine = "none";
        this.emitVideoEvent("error", {
          playbackEngine: this.getPlatformAvplayEngineName(),
          mediaErrorCode: this.lastPlaybackErrorCode,
          avplayError: String(errorValue || ""),
          avplayErrorDetail,
          avplaySnapshot
        });
      };

      try {
        if (typeof avplay.prepareAsync === "function") {
          avplay.prepareAsync(onPrepared, onPrepareError);
        } else if (typeof avplay.prepare === "function") {
          avplay.prepare();
          onPrepared();
        } else {
          onPrepareError("prepare_not_supported");
        }
      } catch (error) {
        onPrepareError([error?.name, error?.message].filter(Boolean).join(": ") || error);
      }

      return true;
    },
    getCurrentTimeSeconds() {
      if (this.isUsingAvPlay()) {
        this.refreshAvPlayTimeline();
        return Math.max(0, Number(this.avplayCurrentTimeMs || 0) / 1000);
      }
      return Math.max(0, Number(this.video?.currentTime || 0));
    },
    getDurationSeconds() {
      let durationSeconds = 0;
      if (this.isUsingAvPlay()) {
        this.refreshAvPlayTimeline();
        durationSeconds = Number(this.avplayDurationMs || 0) / 1000;
      } else {
        durationSeconds = Number(this.video?.duration || 0);
      }
      if (Number.isFinite(durationSeconds) && durationSeconds > Number(this.lastKnownDurationSeconds || 0)) {
        this.lastKnownDurationSeconds = durationSeconds;
      }
      return Math.max(0, Number(this.lastKnownDurationSeconds || 0));
    },
    getBufferedTimeSeconds() {
      // AVPlay reports buffering-operation progress, not a buffered media
      // timestamp. Returning no value prevents the UI from presenting that
      // percentage as playable time.
      if (this.isUsingAvPlay()) {
        return null;
      }

      try {
        const video = this.video;
        const durationSeconds = Number(video?.duration || 0);
        const currentSeconds = Number(video?.currentTime || 0);
        const ranges = video?.buffered;
        if (
          !ranges ||
          !Number.isFinite(durationSeconds) ||
          durationSeconds <= 0 ||
          !Number.isFinite(currentSeconds) ||
          currentSeconds < 0
        ) {
          return null;
        }

        const rangeCount = Number(ranges.length || 0);
        if (!Number.isFinite(rangeCount) || rangeCount <= 0) {
          return null;
        }
        for (let index = 0; index < rangeCount; index += 1) {
          const startSeconds = Number(ranges.start(index));
          const endSeconds = Number(ranges.end(index));
          if (
            Number.isFinite(startSeconds) &&
            Number.isFinite(endSeconds) &&
            startSeconds >= 0 &&
            endSeconds >= startSeconds &&
            startSeconds <= currentSeconds &&
            endSeconds >= currentSeconds
          ) {
            return Math.max(0, Math.min(endSeconds, durationSeconds));
          }
        }
      } catch (_) {
        // TimeRanges can change while it is being read on older TV engines.
      }

      return null;
    }
  };
}
