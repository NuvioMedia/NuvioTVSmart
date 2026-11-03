/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods16() {
  const { Platform, loadStreamingLibs, WATCH_PROGRESS_SAVE_INTERVAL_MS } = internals;

  return {
    setWebOsEmbeddedSubtitleTrack(trackIndex, selectedTrackIndex = trackIndex) {
      if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
        return false;
      }

      const targetIndex = Number(trackIndex);
      const selectedIndex = Number(selectedTrackIndex);
      const storedSelectedIndex = Number.isFinite(selectedIndex) && selectedIndex >= 0 ? selectedIndex : targetIndex;
      if (!Number.isFinite(targetIndex) || targetIndex < -1) {
        return false;
      }

      const applySelection = (mediaId) => {
        if (!mediaId) {
          return;
        }

        if (targetIndex < 0) {
          this.requestWebOsMediaCommand("setSubtitleEnable", {
            mediaId,
            enable: false
          }).catch(() => {
            // Ignore Luna subtitle disable failures.
          });
          return;
        }

        this.requestWebOsMediaCommand("setSubtitleEnable", {
          mediaId,
          enable: true
        }).catch(() => {
          // Ignore Luna subtitle enable failures.
        });
        this.applyWebOsSubtitleFontSize(mediaId, { force: true });

        setTimeout(() => {
          if (Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !== storedSelectedIndex) {
            return;
          }
          if (this.nativeMediaId && mediaId !== this.nativeMediaId) {
            return;
          }
          this.requestWebOsMediaCommand("selectTrack", {
            type: "text",
            mediaId,
            index: targetIndex
          }).catch(() => {
            // Ignore Luna subtitle track selection failures.
          });
        }, 350);
      };

      this.selectedWebOsSubtitleTrackIndex = targetIndex;
      this.webOsSubtitleSelectionExplicit = true;
      this.selectedWebOsEmbeddedSubtitleTrackIndex = targetIndex < 0 ? -1 : storedSelectedIndex;

      const mediaId = this.syncNativeMediaId();
      if (mediaId) {
        applySelection(mediaId);
        return true;
      }

      this.waitForNativeMediaId()
        .then((resolvedMediaId) => {
          if (Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !== (targetIndex < 0 ? -1 : storedSelectedIndex)) {
            return;
          }
          applySelection(resolvedMediaId);
        })
        .catch(() => {
          // Ignore media-id lookup failures.
        });

      return true;
    },
    attemptVideoPlay({ warningLabel = "Playback start rejected", onRejected = null, beforePlay = null, playToken = null } = {}) {
      if (!this.video) {
        return;
      }
      Promise.resolve()
        .then(() => beforePlay?.())
        .then(() => {
          if (playToken !== null && playToken !== this.playRequestToken) {
            return null;
          }
          this.applyStartupAudioGateToVideo();
          const playPromise = this.video.play();
          return this.handleNativePlayStartedUnderStartupGate(playPromise);
        })
        .then((playPromise) => {
          if (!playPromise || typeof playPromise.catch !== "function") {
            return null;
          }
          return playPromise.catch((error) => {
            if (this.isExpectedPlayInterruption(error)) {
              return null;
            }
            if (typeof onRejected === "function") {
              try {
                const handled = onRejected(error);
                if (handled) {
                  return null;
                }
              } catch (_) {
                // Ignore rejection handler failures and continue to warning output.
              }
            }
            this.isPlaying = false;
            this.stopProgressSaving();
            console.warn(warningLabel, error);
            return null;
          });
        })
        .catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          this.isPlaying = false;
          this.stopProgressSaving();
          console.warn(warningLabel, error);
        });
    },
    choosePlaybackEngine(url, sourceType, itemType = this.currentItemType) {
      // Tizen keeps non-HLS sources on AVPlay by default. The MP4 compatibility
      // switch is the one exception; every other source keeps this fast path so
      // the browser never receives a remote URL that AVPlay already handles.
      if (
        Platform.isTizen() &&
        this.canUseAvPlay() &&
        !this.isTizenHlsSource(url, sourceType) &&
        !this.shouldPreferTizenNativeFileForMp4(url, sourceType)
      ) {
        return this.getPlatformAvplayEngineName();
      }
      const candidates = this.getPlaybackEngineCandidates(url, sourceType, itemType);
      if (candidates.length) {
        return candidates[0];
      }
      if (this.canUseAvPlay()) {
        return this.getPlatformAvplayEngineName();
      }
      if (Platform.isTizen() && this.isRemoteDirectHttpSource(url)) {
        // Keep remote progressive playback on the AVPlay path even when the
        // native API is unavailable, so the caller reports a controlled
        // unsupported-platform error instead of leaking the URL to <video>.
        return this.getPlatformAvplayEngineName();
      }
      return "native-file";
    },
    async ensureAdaptiveLibrariesForSource(sourceType, playbackEngine = null) {
      const normalizedEngine = String(playbackEngine || "").trim();
      if (normalizedEngine === "mse-mp4") {
        await loadStreamingLibs({ hls: false, dash: false, mp4box: true });
        return;
      }
      if (Platform.isTizen() && normalizedEngine !== "hls.js" && normalizedEngine !== "dash.js") {
        return;
      }
      const normalizedSourceType = String(sourceType || "").trim();
      if (!normalizedSourceType) {
        return;
      }
      if (this.isLikelyHlsMimeType(normalizedSourceType) || this.isLikelyDashMimeType(normalizedSourceType)) {
        await loadStreamingLibs({
          hls: this.isLikelyHlsMimeType(normalizedSourceType),
          dash: this.isLikelyDashMimeType(normalizedSourceType)
        });
      }
    },
    init() {
      this.video = document.getElementById("videoPlayer");
      Platform.prepareVideoElement(this.video);
      this.video.muted = false;
      this.video.defaultMuted = false;
      this.video.volume = 1;
      this.refreshWebOsDeviceInfo();
      if (!this.viewportSyncHandler) {
        this.viewportSyncHandler = () => {
          if (this.isUsingAvPlay()) {
            this.setAvPlayDisplayRect();
          }
        };
        window.addEventListener("resize", this.viewportSyncHandler);
      }

      this.video.addEventListener("ended", () => {
        if (this.isLivePlaybackItemType() && this.playbackSessionActive) {
          this.isPlaying = true;
          this.resume();
          this.syncWebOsPlaybackKeepAwake();
          return;
        }
        this.isPlaying = false;
        this.stopProgressSaving();
        this.cancelProgressSyncAfterSeek();
        this.syncWebOsPlaybackKeepAwake();
        const context = this.createProgressContext();
        const durationMs = Math.floor(this.getDurationSeconds() * 1000);
        const positionMs = Math.floor(this.getCurrentTimeSeconds() * 1000);
        // Android keeps an unknown-duration playback in progress. Do not turn
        // the current live position into a synthetic finite duration here.
        this.flushProgress(positionMs, durationMs, false, context);
      });

      this.video.addEventListener("error", (e) => {
        this.isPlaying = false;
        this.stopProgressSaving();
        this.cancelProgressSyncAfterSeek();
        this.syncWebOsPlaybackKeepAwake();
        const customErrorCode = Number(e?.detail?.mediaErrorCode || 0);
        const nativeErrorCode = Number(this.video?.error?.code || 0);
        const mediaErrorCode = customErrorCode || nativeErrorCode || this.getLastPlaybackErrorCode();
        console.error("Video error:", {
          event: e?.type || "error",
          mediaErrorCode,
          avplayError: e?.detail?.avplayError || "",
          currentSrc: this.video?.currentSrc || this.video?.src || "",
          playbackEngine: this.playbackEngine
        });
      });

      const syncNativeMediaId = (event) => {
        this.syncNativeMediaId();
        if (event?.type === "loadedmetadata" || event?.type === "canplay" || event?.type === "playing") {
          this.reapplyWebOsNativeTrackSelections();
        }
        if (event?.type === "canplay" || event?.type === "playing") {
          this.reapplyWebOsPlaybackRate().catch(() => {});
        }
        if (event?.type === "playing" && this.playbackSessionActive && this.isPlaying) {
          this.startProgressSaving();
        }
      };
      this.video.addEventListener("loadedmetadata", syncNativeMediaId);
      this.video.addEventListener("loadeddata", syncNativeMediaId);
      this.video.addEventListener("canplay", syncNativeMediaId);
      this.video.addEventListener("playing", syncNativeMediaId);
      this.video.addEventListener("waiting", () => {
        // Android takes a local checkpoint when playback enters buffering, then
        // waits for the next real playing event before resuming the periodic job.
        this.saveProgressIfNeeded();
        this.stopProgressSaving();
      });
      ["playing", "timeupdate", "pause", "ended", "emptied"].forEach((eventName) => {
        this.video.addEventListener(eventName, () => this.clearHlsBufferStallWarning());
      });
      this.video.addEventListener("seeked", () => {
        this.reapplyWebOsPlaybackRate().catch(() => {});
      });
      this.video.addEventListener("emptied", () => {
        this.resetNativeMediaState();
      });

      this.video.addEventListener("playing", () => {
        const audioTrackList = this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks;
        const audioTrackCount = Number(audioTrackList?.length || 0);
        const probeUrl = String(this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || "").trim();
        const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
        if (this.isUsingNativePlayback() && isDirectFile && audioTrackCount <= 0 && Platform.isWebOS() && this.canUseAvPlay()) {
          this.forceAvPlayFallbackForCurrentSource("native_playing_no_audio_tracks");
        }
      });

      this.video.addEventListener("loadedmetadata", () => {
        const audioTrackList = this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks;
        const audioTrackCount = Number(audioTrackList?.length || 0);
        const probeUrl = String(this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || "").trim();
        const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
        if (this.isUsingNativePlayback() && isDirectFile && audioTrackCount <= 0 && Platform.isWebOS() && this.canUseAvPlay()) {
          this.forceAvPlayFallbackForCurrentSource("native_no_audio_tracks");
        }
      });

      if (!this.lifecycleBound) {
        this.lifecycleBound = true;
        this.lifecycleFlushHandler = () => {
          this.flushCurrentProgress({ forceCloudSync: true });
        };
        this.visibilityFlushHandler = () => {
          if (document.visibilityState === "hidden") {
            this.lifecycleFlushHandler?.();
          }
        };
        window.addEventListener("pagehide", this.lifecycleFlushHandler);
        window.addEventListener("beforeunload", this.lifecycleFlushHandler);
        document.addEventListener("visibilitychange", this.visibilityFlushHandler);
      }
    },
    startProgressSaving() {
      this.stopProgressSaving();
      this.progressSaveTimer = setInterval(() => {
        this.saveProgressIfNeeded();
      }, WATCH_PROGRESS_SAVE_INTERVAL_MS);
    },
    stopProgressSaving() {
      if (this.progressSaveTimer !== null) {
        clearInterval(this.progressSaveTimer);
        this.progressSaveTimer = null;
      }
    }
  };
}
