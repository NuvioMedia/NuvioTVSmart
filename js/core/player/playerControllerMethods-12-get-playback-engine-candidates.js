/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods12() {
  const { Platform, nativeVideoEngine, mp4MseEngine, WEBOS_MEDIA_TYPE_PROBE_TIMEOUT_MS } = internals;

  return {
    getPlaybackEngineCandidates(url, sourceType = null, itemType = this.currentItemType) {
      const normalizedSourceType = String(sourceType || this.guessMediaMimeType(url) || "").trim();
      const avplayEngine = this.getPlatformAvplayEngineName();
      const isTizenRuntime = Platform.isTizen();
      const isLivePlayback = this.isLivePlaybackItemType(itemType);
      const canUseAvPlay = this.canUseAvPlay();
      const preferTvNative = this.shouldPreferTvNativePipeline();
      const canUseHlsJs = this.canUseHlsJs();
      const canUseDashJs = this.canUseDashJs();
      const canPlayNativeHls = this.canPlayNatively("application/vnd.apple.mpegurl");
      const canPlayNativeDash = this.canPlayNatively("application/dash+xml");
      const canPlayNativeSmooth = this.canPlayNatively("application/vnd.ms-sstr+xml");
      const pushCandidate = (target, candidate) => {
        const normalized = String(candidate || "").trim();
        if (!normalized || target.includes(normalized)) {
          return;
        }
        target.push(normalized);
      };

      if (this.isLikelyHlsMimeType(normalizedSourceType)) {
        const candidates = [];
        if (isTizenRuntime && canUseHlsJs) {
          // Match Android's single HLS media pipeline when MSE is available.
          // This also avoids the long AVPlay connection-failure path observed
          // on affected Samsung TVs. AVPlay and native HLS remain fallbacks.
          pushCandidate(candidates, "hls.js");
        }
        if (isTizenRuntime && canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        if (preferTvNative && canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        if (isTizenRuntime && isLivePlayback) {
          // Keep hls.js in the live fallback ladder even when feature detection
          // is unavailable; the normal path above has already preferred it when
          // MSE support was confirmed.
          pushCandidate(candidates, "hls.js");
        }
        if (!isTizenRuntime) {
          // Android opens HLS through HlsMediaSource, which reports manifest
          // failures directly. Prefer the equivalent hls.js pipeline here; if
          // MSE is unavailable, playWithHlsJs falls back to native playback.
          pushCandidate(candidates, "hls.js");
        }
        if (canPlayNativeHls) {
          pushCandidate(candidates, "native-hls");
        }
        if (isLivePlayback && (canUseHlsJs || isTizenRuntime)) {
          pushCandidate(candidates, "hls.js");
        }
        if (isTizenRuntime && !isLivePlayback) {
          pushCandidate(candidates, "hls.js");
        }
        if (canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        return candidates;
      }

      if (this.isLikelyDashMimeType(normalizedSourceType)) {
        const candidates = [];
        if (isTizenRuntime && canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        if (preferTvNative && canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        if (canPlayNativeDash) {
          pushCandidate(candidates, "native-dash");
        }
        if (isLivePlayback && (canUseDashJs || isTizenRuntime)) {
          pushCandidate(candidates, "dash.js");
        }
        if (isTizenRuntime && !isLivePlayback) {
          pushCandidate(candidates, "dash.js");
        }
        if (!isTizenRuntime && canUseDashJs) {
          pushCandidate(candidates, "dash.js");
        }
        if (canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        return candidates;
      }

      if (this.isLikelySmoothStreamingMimeType(normalizedSourceType)) {
        const candidates = [];
        if (isTizenRuntime && canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        if (canPlayNativeSmooth) {
          pushCandidate(candidates, "native-file");
        }
        if (canUseAvPlay) {
          pushCandidate(candidates, avplayEngine);
        }
        return candidates;
      }

      const candidates = [];
      const isRemoteDirectHttpSource = this.isRemoteDirectHttpSource(url);
      if (this.shouldPreferTizenNativeFileForMp4(url, normalizedSourceType) && typeof globalThis.MediaSource === "function") {
        // Tizen plays `<video src=mp4>` through the same platform progressive
        // player as AVPlay, which drops audio on some files. MSE feeds the
        // decoder the way hls.js does. The existing remote-source exclusion
        // below still prevents an AVPlay failure from retrying through `<video>`.
        pushCandidate(candidates, "mse-mp4");
      }
      if (isTizenRuntime && canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
      }
      // Android keeps progressive network playback in a native Media3/OkHttp
      // pipeline. On Tizen, retrying a remote AVPlay failure with the browser
      // video element creates a second, misleading CORS/Same-Origin failure.
      // Keep the HTML fallback for local EngineFS URLs and non-Tizen platforms;
      // if AVPlay is unavailable, choosePlaybackEngine() keeps the remote source
      // on the AVPlay path and reports a controlled platform error.
      if (!isTizenRuntime || !isRemoteDirectHttpSource) {
        pushCandidate(candidates, "native-file");
      }
      if (!isTizenRuntime && canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
      }
      return candidates;
    },
    getAlternativePlaybackEngine(
      url = this.currentPlaybackUrl,
      sourceType = this.currentPlaybackMediaSourceType,
      itemType = this.currentItemType
    ) {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) {
        return null;
      }
      const attemptedEngines = this.getAttemptedPlaybackEngines(normalizedUrl);
      const currentEngine = String(this.playbackEngine || "").trim();
      const candidates = this.getPlaybackEngineCandidates(normalizedUrl, sourceType, itemType);
      return candidates.find((candidate) => candidate !== currentEngine && !attemptedEngines.has(candidate)) || null;
    },
    isEngineFsPlaybackUrl(url = "") {
      try {
        const parsedUrl = new URL(String(url || ""));
        return /\/([0-9a-f]{40})\/\d+(?:\/|$)/i.test(parsedUrl.pathname);
      } catch (_) {
        return false;
      }
    },
    isRemoteDirectHttpSource(url = "") {
      const normalizedUrl = String(url || "").trim();
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        return false;
      }
      try {
        const hostname = String(new URL(normalizedUrl).hostname || "")
          .toLowerCase()
          .replace(/^\[|\]$/g, "");
        return !["127.0.0.1", "localhost", "::1"].includes(hostname);
      } catch (_) {
        return !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(normalizedUrl);
      }
    },
    shouldPreferTizenNativeFileForMp4(url = "", sourceType = null) {
      if (!Platform.isTizen() || this.tizenMp4NativeFileEnabled !== true) {
        return false;
      }
      const normalizedUrl = String(url || "").trim();
      // Keep local EngineFS and other non-remote sources on the AVPlay-first
      // path they use today; this switch is only for remote progressive MP4.
      if (!this.isRemoteDirectHttpSource(normalizedUrl)) {
        return false;
      }
      const normalizedSourceType = String(sourceType || this.guessMediaMimeType(normalizedUrl) || "").trim();
      // A declared video/mp4 type is enough for redirect/proxy endpoints with no
      // file extension; otherwise require an .mp4/.m4v path.
      return this.normalizeMimeType(normalizedSourceType) === "video/mp4" || /\.(mp4|m4v)(?=($|[/?#&]))/i.test(normalizedUrl);
    },
    getPlaybackCapabilities() {
      const supports = (mimeType) => this.canPlayNatively(mimeType);
      const capabilities = {
        avplay: this.canUseAvPlay(),
        hls: supports("application/vnd.apple.mpegurl"),
        dash: supports("application/dash+xml"),
        smoothStreaming: supports("application/vnd.ms-sstr+xml"),
        mp4: supports("video/mp4"),
        mp4H264: supports('video/mp4; codecs="avc1.4d401f,mp4a.40.2"'),
        mp4Hevc: supports('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"') || supports('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"'),
        mp4HevcMain10:
          supports('video/mp4; codecs="hvc1.2.4.L153.B0,mp4a.40.2"') || supports('video/mp4; codecs="hev1.2.4.L153.B0,mp4a.40.2"'),
        mp4Av1: supports('video/mp4; codecs="av01.0.08M.08,mp4a.40.2"'),
        webmVp9: supports('video/webm; codecs="vp9,opus"'),
        webm: supports("video/webm"),
        mkvH264: supports('video/x-matroska; codecs="avc1.4d401f,mp4a.40.2"') || supports("video/x-matroska"),
        quicktime: supports("video/quicktime"),
        mpegTs: supports("video/mp2t"),
        audioAac: supports('audio/mp4; codecs="mp4a.40.2"'),
        audioMp3: supports("audio/mpeg"),
        audioFlac: supports("audio/flac"),
        audioAc3: supports('audio/mp4; codecs="ac-3"') || supports('audio/mp4; codecs="dac3"'),
        audioEac3: supports('audio/mp4; codecs="ec-3"') || supports('audio/mp4; codecs="dec3"'),
        dolbyVision: supports('video/mp4; codecs="dvh1.05.06,ec-3"') || supports('video/mp4; codecs="dvhe.05.06,ec-3"')
      };
      capabilities.hdrLikely = capabilities.mp4HevcMain10 || capabilities.mp4Av1;
      capabilities.atmosLikely = capabilities.audioEac3;
      return capabilities;
    },
    teardownHlsInstance() {
      this.clearHlsBufferStallWarning();
      if (!this.hlsInstance) {
        return;
      }
      try {
        this.hlsInstance.destroy();
      } catch (_) {
        // Ignore HLS cleanup failures.
      }
      this.hlsInstance = null;
    },
    teardownDashInstance() {
      if (!this.dashInstance) {
        return;
      }
      try {
        this.dashInstance.reset?.();
      } catch (_) {
        // Ignore DASH cleanup failures.
      }
      this.dashInstance = null;
    },
    teardownMp4MseSession() {
      if (!this.mp4MseSession) {
        return;
      }
      const session = this.mp4MseSession;
      this.mp4MseSession = null;
      session.destroy();
    },
    teardownAdaptiveInstances() {
      this.teardownHlsInstance();
      this.teardownDashInstance();
      this.teardownMp4MseSession();
      if (!this.isUsingAvPlay()) {
        this.playbackEngine = "none";
      }
    },
    playWithMp4Mse(url, { playToken = null, onFatalError = null } = {}) {
      if (!this.video || !mp4MseEngine.isSupported() || !this.isPlaybackRequestActive(playToken)) {
        return false;
      }
      this.teardownMp4MseSession();
      try {
        const session = mp4MseEngine.create(this.video, url, {
          onFatalError: (error) => {
            if (this.mp4MseSession === session) {
              this.mp4MseSession = null;
            }
            onFatalError?.(error);
          }
        });
        this.mp4MseSession = session;
      } catch (error) {
        console.warn("[Nuvio Tizen MP4] MSE session failed to start", error);
        return false;
      }
      this.playbackEngine = "mse-mp4";
      return true;
    },
    applyNativeSource(url, mimeType = null, engineName = "native-file") {
      const normalizedMimeType = this.normalizeMimeType(mimeType);
      const sourceMimeType =
        Platform.isWebOS() && (this.isEngineFsPlaybackUrl(url) || normalizedMimeType === "video/x-matroska") ? null : mimeType;
      if (!nativeVideoEngine.load(this.video, url, sourceMimeType)) {
        return false;
      }
      this.playbackEngine = String(engineName || "native-file");
      return true;
    },
    applyWebOsStagedNativeSource(url, engineName = "native-file") {
      if (!this.video) {
        return false;
      }
      Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
      this.video.src = url;
      this.playbackEngine = String(engineName || "native-file");
      return true;
    },
    async prepareWebOsStagedNativePlayback(playToken = null, url = null) {
      await this.waitForNativeMediaId();
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return;
      }
      try {
        this.video?.load?.();
      } catch (_) {
        // webOS may throw during staged native startup; play() will surface the real failure.
      }
    },
    shouldForwardHeaderToHls(name) {
      const lower = String(name || "")
        .trim()
        .toLowerCase();
      if (!lower) {
        return false;
      }
      if (lower === "range") {
        return false;
      }
      if (lower.startsWith("sec-")) {
        return false;
      }
      const forbidden = new Set([
        "host",
        "origin",
        "referer",
        "referrer",
        "user-agent",
        "content-length",
        "accept-encoding",
        "connection",
        "cookie"
      ]);
      return !forbidden.has(lower);
    },
    normalizePlaybackHeaders(headers) {
      if (!headers || typeof headers !== "object") {
        return {};
      }
      const entries = Object.entries(headers)
        .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
        .filter(([key, value]) => key && value)
        .filter(([key]) => this.shouldForwardHeaderToHls(key));
      return Object.fromEntries(entries);
    },
    async probeRemoteMediaSourceType(url, requestHeaders = {}) {
      if (!Platform.isWebOS() || !this.isRemoteDirectHttpSource(url)) {
        return null;
      }

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), WEBOS_MEDIA_TYPE_PROBE_TIMEOUT_MS) : null;
      try {
        const response = await fetch(url, {
          method: "HEAD",
          headers: this.normalizePlaybackHeaders(requestHeaders),
          cache: "no-store",
          redirect: "follow",
          ...(controller ? { signal: controller.signal } : {})
        });
        if (!response.ok) {
          return null;
        }
        return this.resolveRuntimeSourceType(response.headers?.get?.("content-type"));
      } catch (_) {
        return null;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }
  };
}
