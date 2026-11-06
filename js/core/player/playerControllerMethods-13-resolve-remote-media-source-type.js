import { createStreamRedirectReporter } from "./streamRedirect.js";
import { applyAdaptiveRequestHeaders } from "./adaptiveRequestHeaders.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

const HLS_MAX_NETWORK_RECOVERY_ATTEMPTS = 2;
const HLS_NETWORK_RECOVERY_DELAY_MS = 1500;

export function createPlayerControllerMethods13() {
  const {
    Platform,
    hlsJsEngine,
    dashJsEngine,
    isTerminalHlsHttpStatus,
    WEBOS_LIVE_INITIAL_MANIFEST_SIZE,
    HLS_MAX_BUFFER_SECONDS,
    HLS_BACK_BUFFER_SECONDS
  } = internals;

  return {
    async resolveRemoteMediaSourceType(url, sourceType = null, requestHeaders = {}, itemType = null) {
      const normalizedSourceType =
        this.resolveRuntimeSourceType(sourceType) || this.resolveRuntimeSourceType(this.guessMediaMimeType(url)) || null;
      if (
        !Platform.isWebOS() ||
        !this.isLivePlaybackItemType(itemType || this.currentItemType) ||
        !this.isRemoteDirectHttpSource(url) ||
        !this.isLikelyHlsMimeType(normalizedSourceType)
      ) {
        return normalizedSourceType;
      }

      const responseSourceType = await this.probeRemoteMediaSourceType(url, requestHeaders);
      return responseSourceType || normalizedSourceType;
    },
    buildHlsConfig(requestHeaders = {}) {
      const forwardedHeaders = this.normalizePlaybackHeaders(requestHeaders);
      const isWebOs = Platform.isWebOS();
      const isLivePlayback = this.isLivePlaybackItemType();
      return {
        autoStartLoad: false,
        enableWorker: !isWebOs,
        lowLatencyMode: false,
        initialLiveManifestSize: isWebOs && isLivePlayback ? WEBOS_LIVE_INITIAL_MANIFEST_SIZE : 1,
        backBufferLength: HLS_BACK_BUFFER_SECONDS,
        maxBufferLength: HLS_MAX_BUFFER_SECONDS,
        maxMaxBufferLength: HLS_MAX_BUFFER_SECONDS,
        maxBufferHole: 0.5,
        startFragPrefetch: false,
        // Android PlayerLoadErrorHandlingPolicy (DefaultLoadErrorHandlingPolicy(6)) keeps
        // retrying playlist 5xx for ~15s while buffered media plays. hls.js shares one
        // playlist error counter across video and audio playlists, hence 12 retries.
        playlistLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10000,
            maxLoadTimeMs: 20000,
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 12, retryDelayMs: 1000, maxRetryDelayMs: 5000 }
          }
        },
        xhrSetup: (xhr) => {
          Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
            try {
              xhr.setRequestHeader(headerName, headerValue);
            } catch (_) {
              // Ignore forbidden/unsupported browser headers.
            }
          });
        },
        fetchSetup: (context, initParams = {}) => {
          const headers = new Headers(initParams.headers || {});
          Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
            try {
              headers.set(headerName, headerValue);
            } catch (_) {
              // Ignore forbidden/unsupported browser headers.
            }
          });
          return new Request(context.url, {
            ...initParams,
            headers
          });
        }
      };
    },
    playWithHlsJs(url, requestHeaders = {}, playToken = null) {
      if (!this.video || !this.canUseHlsJs()) {
        return false;
      }
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return false;
      }

      const Hls = hlsJsEngine.getConstructor();
      if (!Hls) {
        return false;
      }
      this.teardownHlsInstance();
      this.teardownDashInstance();
      const hls = hlsJsEngine.create(this.buildHlsConfig(requestHeaders));
      if (!hls) {
        return false;
      }
      this.hlsInstance = hls;
      this.playbackEngine = "hls.js";
      let networkRecoveryAttempts = 0;
      let mediaRecoveryAttempts = 0;

      const emitFatalHlsNetworkError = (data = {}, responseCode = 0) => {
        this.lastPlaybackErrorCode = 2;
        this.teardownHlsInstance();
        this.emitVideoEvent("error", {
          playbackEngine: "hls.js",
          mediaErrorCode: 2,
          hlsErrorType: String(data.type || ""),
          hlsErrorDetails: String(data.details || ""),
          hlsResponseCode: Number(responseCode) || null
        });
      };

      hls.on(Hls.Events.ERROR, (_, data = {}) => {
        if (!this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        this.captureHlsErrorDiagnostic(data);
        const responseCode = Number(data?.response?.code || data?.networkDetails?.status || 0);
        if (!data?.fatal) {
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Keep terminal playlist HTTP statuses aligned with Android TV; a 404
          // points to a missing bridge-generated playlist, not a recoverable load.
          if (isTerminalHlsHttpStatus(responseCode)) {
            emitFatalHlsNetworkError(data, responseCode);
            return;
          }
          // Android attemptAutoRetry: two retries 1.5s apart before surfacing the error.
          if (networkRecoveryAttempts >= HLS_MAX_NETWORK_RECOVERY_ATTEMPTS) {
            emitFatalHlsNetworkError(data, responseCode);
            return;
          }
          networkRecoveryAttempts += 1;
          setTimeout(() => {
            if (this.hlsInstance !== hls || !this.isPlaybackRequestActive(playToken, url)) return;
            try {
              hls.stopLoad();
              hls.startLoad();
            } catch (_) {
              emitFatalHlsNetworkError(data, responseCode);
            }
          }, HLS_NETWORK_RECOVERY_DELAY_MS);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveryAttempts >= 1) {
            this.lastPlaybackErrorCode = 3;
            this.teardownHlsInstance();
            this.emitVideoEvent("error", {
              playbackEngine: "hls.js",
              mediaErrorCode: 3,
              hlsErrorType: String(data.type || ""),
              hlsErrorDetails: String(data.details || "")
            });
            return;
          }
          try {
            mediaRecoveryAttempts += 1;
            hls.recoverMediaError();
            return;
          } catch (_) {
            // Fall through and destroy on unrecoverable media errors.
          }
        }
        this.lastPlaybackErrorCode = 4;
        this.teardownHlsInstance();
        this.emitVideoEvent("error", {
          playbackEngine: "hls.js",
          mediaErrorCode: 4,
          hlsErrorType: String(data.type || ""),
          hlsErrorDetails: String(data.details || "")
        });
      });

      // Android resets its retry budget once playback progresses again.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        networkRecoveryAttempts = 0;
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        try {
          hls.loadSource(url);
        } catch (error) {
          console.warn("HLS source attach failed", error);
          this.lastPlaybackErrorCode = 4;
          this.emitVideoEvent("error", {
            playbackEngine: "hls.js",
            mediaErrorCode: 4,
            hlsErrorType: "attach",
            hlsErrorDetails: String(error?.message || error || "")
          });
        }
      });

      const reportRedirect = createStreamRedirectReporter(this, url, playToken);
      hls.on(Hls.Events.MANIFEST_LOADED, (_, data = {}) => {
        reportRedirect(data.networkDetails?.responseURL || data.networkDetails?.url);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        // Android's HlsMediaSource delegates the initial rendition to adaptive
        // track selection. Keep the same contract here instead of forcing the
        // highest level before hls.js has a bandwidth sample; that first request
        // can drain the short webOS buffer and make the media element stall.
        try {
          hls.startLevel = -1;
        } catch (_) {
          // Ignore unsupported hls.js builds.
        }
        try {
          hls.startLoad();
        } catch (_) {
          // hls.js may already be loading on older builds.
        }
        this.applyStartupAudioGateToVideo();
        const playPromise = this.video.play();
        this.handleNativePlayStartedUnderStartupGate(playPromise);
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((error) => {
            if (this.isExpectedPlayInterruption(error)) {
              return;
            }
            console.warn("HLS playback start rejected", error);
          });
        }
      });

      [
        Hls.Events.AUDIO_TRACKS_UPDATED,
        Hls.Events.AUDIO_TRACK_SWITCHED,
        Hls.Events.AUDIO_TRACK_LOADED,
        Hls.Events.SUBTITLE_TRACKS_UPDATED,
        Hls.Events.SUBTITLE_TRACK_SWITCH,
        Hls.Events.SUBTITLE_TRACK_LOADED
      ]
        .filter(Boolean)
        .forEach((eventName) => {
          hls.on(eventName, () => {
            if (!this.isPlaybackRequestActive(playToken, url)) {
              return;
            }
            this.emitVideoEvent("hlstrackschanged", { playbackEngine: "hls.js" });
          });
        });

      this.video.removeAttribute("src");
      hls.attachMedia(this.video);
      return true;
    },
    playWithDashJs(url, playToken = null, requestHeaders = this.currentPlaybackHeaders || {}) {
      if (!this.video || !this.canUseDashJs()) {
        return false;
      }
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return false;
      }

      this.teardownDashInstance();
      this.teardownHlsInstance();

      let player = null;
      try {
        player = dashJsEngine.createPlayer();
        if (!player) {
          return false;
        }
        const isWebOs = Platform.isWebOS();
        player.updateSettings?.({
          streaming: {
            buffer: {
              fastSwitchEnabled: !isWebOs,
              bufferToKeep: isWebOs ? 8 : 20,
              bufferPruningInterval: isWebOs ? 10 : 20,
              bufferTimeDefault: isWebOs ? 8 : 12
            },
            scheduling: {
              scheduleWhilePaused: false
            },
            liveCatchup: {
              enabled: false
            }
          }
        });
        const forwardedHeaders = this.normalizePlaybackHeaders(requestHeaders);
        if (Object.keys(forwardedHeaders).length || String(url).includes("/proxy/")) {
          player.addRequestInterceptor((request) => applyAdaptiveRequestHeaders(request, forwardedHeaders, url));
        }
        const reportRedirect = createStreamRedirectReporter(this, url, playToken);
        player.addResponseInterceptor((response) => {
          if (response.request?.url === url && response.status >= 200 && response.status < 300) {
            reportRedirect(response.url);
          }
          return Promise.resolve(response);
        });
        player.initialize(this.video, url, true);
        const dashEvents = dashJsEngine.getEvents();
        const emitTracksChanged = () => {
          if (!this.isPlaybackRequestActive(playToken, url)) {
            return;
          }
          this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
        };
        const emitDashError = (event = {}) => {
          if (!this.isPlaybackRequestActive(playToken, url)) {
            return;
          }
          const errorText = String(event?.error?.message || event?.event?.message || event?.message || "").toLowerCase();
          let mediaErrorCode = 4;
          if (errorText.includes("network") || errorText.includes("download") || errorText.includes("manifest")) {
            mediaErrorCode = 2;
          } else if (errorText.includes("decode") || errorText.includes("mediasource") || errorText.includes("append")) {
            mediaErrorCode = 3;
          }
          this.lastPlaybackErrorCode = mediaErrorCode;
          this.emitVideoEvent("error", {
            playbackEngine: "dash.js",
            mediaErrorCode,
            dashError: String(event?.error?.message || event?.message || "")
          });
        };
        try {
          player.on?.(dashEvents.STREAM_INITIALIZED, emitTracksChanged);
          player.on?.(dashEvents.TRACK_CHANGE_RENDERED, emitTracksChanged);
          player.on?.(dashEvents.TEXT_TRACKS_ADDED, emitTracksChanged);
          player.on?.(dashEvents.PERIOD_SWITCH_COMPLETED, emitTracksChanged);
          if (dashEvents.ERROR) {
            player.on?.(dashEvents.ERROR, emitDashError);
          }
          if (dashEvents.PLAYBACK_ERROR) {
            player.on?.(dashEvents.PLAYBACK_ERROR, emitDashError);
          }
        } catch (_) {
          // Ignore dash event binding issues.
        }
        this.dashInstance = player;
        this.playbackEngine = "dash.js";
        return true;
      } catch (error) {
        console.warn("DASH source attach failed", error);
        try {
          player?.reset?.();
        } catch (_) {
          // Ignore reset failures on partial init.
        }
        this.dashInstance = null;
        this.lastPlaybackErrorCode = 4;
        this.emitVideoEvent("error", {
          playbackEngine: "dash.js",
          mediaErrorCode: 4,
          dashError: String(error?.message || error || "")
        });
        return false;
      }
    },
    getDashAudioTracks() {
      const tracks = this.dashInstance?.getTracksFor?.("audio");
      if (!Array.isArray(tracks)) {
        return [];
      }
      return tracks.filter(Boolean).map((track, index) => ({
        id: String(track?.id ?? `dash-audio-${index}`),
        index,
        label: String(track?.labels?.[0]?.text || track?.lang || `Track ${index + 1}`),
        language: String(track?.lang || ""),
        raw: track
      }));
    }
  };
}
