/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods01() {
  const { Platform, nativeVideoEngine, hlsJsEngine, dashJsEngine, resolvePlatformAvplayEngine, detectWebOsAudioCapabilities } = internals;

  return {
    isExpectedPlayInterruption(error) {
      const message = String(error?.message || "").toLowerCase();
      const name = String(error?.name || "").toLowerCase();
      if (name === "aborterror") {
        return true;
      }
      return message.includes("interrupted by a new load request") || message.includes("the play() request was interrupted");
    },
    isPlaybackRequestActive(playToken = null, url = null) {
      if (playToken !== null && Number(playToken) !== Number(this.playRequestToken || 0)) {
        return false;
      }
      if (url !== null && String(this.currentPlaybackUrl || "") !== String(url || "").trim()) {
        return false;
      }
      return Boolean(this.video);
    },
    normalizeMimeType(mimeType) {
      return String(mimeType || "")
        .toLowerCase()
        .split(";")[0]
        .trim();
    },
    normalizePlaybackSourceType(sourceType) {
      const raw = String(sourceType || "").trim();
      if (!raw) {
        return null;
      }
      if (raw.includes("/")) {
        return raw;
      }

      const normalized = raw.toLowerCase();
      const aliases = {
        dash: "application/dash+xml",
        hls: "application/vnd.apple.mpegurl",
        m3u8: "application/vnd.apple.mpegurl",
        m4v: "video/mp4",
        mkv: "video/x-matroska",
        mov: "video/quicktime",
        mp4: "video/mp4",
        mpd: "application/dash+xml",
        ts: "video/mp2t",
        webm: "video/webm"
      };
      return aliases[normalized] || null;
    },
    resolveRuntimeSourceType(sourceType) {
      const normalized = this.normalizePlaybackSourceType(sourceType);
      if (!normalized) {
        return null;
      }
      if (
        this.isLikelyHlsMimeType(normalized) ||
        this.isLikelyDashMimeType(normalized) ||
        this.isLikelySmoothStreamingMimeType(normalized)
      ) {
        return normalized;
      }
      return this.canPlayNatively(normalized) ? normalized : null;
    },
    guessMediaMimeType(url) {
      const raw = String(url || "").trim();
      if (!raw) {
        return null;
      }

      const inferByPath = (pathname = "", search = null) => {
        const path = String(pathname || "").toLowerCase();
        const formatHint = String(
          search?.get?.("format") || search?.get?.("type") || search?.get?.("mime") || search?.get?.("output") || ""
        ).toLowerCase();
        if (path.endsWith(".m3u8")) {
          return "application/vnd.apple.mpegurl";
        }
        if (path.endsWith(".mpd")) {
          return "application/dash+xml";
        }
        if (path.includes(".ism/manifest") || path.includes(".isml/manifest")) {
          return "application/vnd.ms-sstr+xml";
        }
        if (formatHint === "m3u8" || formatHint === "hls") {
          return "application/vnd.apple.mpegurl";
        }
        if (formatHint === "mpd" || formatHint === "dash" || this.isLikelyDashMimeType(formatHint)) {
          return "application/dash+xml";
        }
        if (path.includes("/playlist")) {
          return "application/vnd.apple.mpegurl";
        }
        const extensionMatch = path.match(/\.(mp4|m4v|mov|webm|mkv|avi|wmv|ts|m2ts|mpg|mpeg|3gp|mp3|aac|flac)(?=($|[/?#&]))/i);
        if (extensionMatch) {
          const extension = String(extensionMatch[1] || "").toLowerCase();
          const directMimeMap = {
            "3gp": "video/3gpp",
            aac: "audio/aac",
            avi: "video/x-msvideo",
            flac: "audio/flac",
            m2ts: "video/mp2t",
            m4v: "video/mp4",
            mkv: "video/x-matroska",
            mov: "video/quicktime",
            mp3: "audio/mpeg",
            mp4: "video/mp4",
            mpeg: "video/mpeg",
            mpg: "video/mpeg",
            ts: "video/mp2t",
            webm: "video/webm",
            wmv: "video/x-ms-wmv"
          };
          return directMimeMap[extension] || null;
        }
        return null;
      };

      const inferFromNestedQueryValues = (search) => {
        if (!search?.forEach) {
          return null;
        }

        let inferredType = null;
        search.forEach((value) => {
          if (inferredType) {
            return;
          }

          const rawValue = String(value || "").trim();
          if (!rawValue) {
            return;
          }

          const candidates = [rawValue];
          try {
            const decodedValue = decodeURIComponent(rawValue);
            if (decodedValue !== rawValue) {
              candidates.push(decodedValue);
            }
          } catch (_) {
            // Keep the original query value when it is only partially encoded.
          }

          candidates.some((candidate) => {
            try {
              const nestedUrl = new URL(candidate);
              inferredType = inferByPath(nestedUrl.pathname, nestedUrl.searchParams);
            } catch (_) {
              inferredType = inferByPath(candidate, null);
            }

            if (inferredType) {
              return true;
            }

            const normalizedCandidate = candidate.toLowerCase();
            if (/(^|[=/_.?&-])m3u8($|[=/_.?&-])/.test(normalizedCandidate)) {
              inferredType = "application/vnd.apple.mpegurl";
            } else if (/(^|[=/_.?&-])mpd($|[=/_.?&-])/.test(normalizedCandidate)) {
              inferredType = "application/dash+xml";
            } else if (/(^|[=/_.?&-])isml?(?:\/manifest)?($|[=/_.?&-])/.test(normalizedCandidate)) {
              inferredType = "application/vnd.ms-sstr+xml";
            }
            return Boolean(inferredType);
          });
        });

        return inferredType;
      };

      try {
        const parsed = new URL(raw);
        return inferByPath(parsed.pathname, parsed.searchParams) || inferFromNestedQueryValues(parsed.searchParams);
      } catch (_) {
        return inferByPath(raw, null);
      }
    },
    isLikelyHlsMimeType(mimeType) {
      const normalized = this.normalizeMimeType(mimeType);
      return (
        normalized === "application/vnd.apple.mpegurl" ||
        normalized === "application/x-mpegurl" ||
        normalized === "audio/mpegurl" ||
        normalized === "audio/x-mpegurl"
      );
    },
    isLikelyDashMimeType(mimeType) {
      return this.normalizeMimeType(mimeType) === "application/dash+xml";
    },
    isLikelySmoothStreamingMimeType(mimeType) {
      return this.normalizeMimeType(mimeType) === "application/vnd.ms-sstr+xml";
    },
    canUseHlsJs() {
      return hlsJsEngine.isSupported();
    },
    canUseDashJs() {
      return dashJsEngine.isSupported();
    },
    canPlayNatively(mimeType) {
      return nativeVideoEngine.canPlay(this.video, mimeType);
    },
    isUnsupportedSourceError(error) {
      const message = String(error?.message || "").toLowerCase();
      return message.includes("no supported source") || message.includes("no supported sources") || message.includes("not supported");
    },
    getPlatformAvplayEngine() {
      return resolvePlatformAvplayEngine(Platform.getName());
    },
    getPlatformAvplayEngineName() {
      return this.getPlatformAvplayEngine().name;
    },
    shouldPreferTvNativePipeline() {
      return Platform.isTizen() || Platform.isWebOS();
    },
    getAvPlay() {
      return this.getPlatformAvplayEngine().getApi();
    },
    getAvPlayState() {
      if (!this.isUsingAvPlay()) {
        return "";
      }
      if (this.avplaySeekInFlight) {
        return "SEEKING";
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return "";
      }
      try {
        return String(avplay.getState?.() || "")
          .trim()
          .toUpperCase();
      } catch (_) {
        return "";
      }
    },
    canUseAvPlay() {
      if (Platform.isWebOS()) {
        return false;
      }
      return this.getPlatformAvplayEngine().isSupported();
    },
    isUsingNativePlayback() {
      return String(this.playbackEngine || "").startsWith("native");
    },
    refreshWebOsDeviceInfo({ forceRefresh = false } = {}) {
      if (!Platform.isWebOS()) {
        return Promise.resolve({
          unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
        });
      }
      if (this.webosDeviceInfoPromise && !forceRefresh) {
        return this.webosDeviceInfoPromise;
      }

      this.webosDeviceInfoPromise = detectWebOsAudioCapabilities({ forceRefresh })
        .then((capabilities) => {
          this.webosAudioCapabilities = capabilities;
          this.webosUnsupportedAudioCodecs = new Set(capabilities.unsupportedAudioCodecs);
          return {
            ...capabilities,
            unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
          };
        })
        .catch(() => ({
          unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
        }));

      return this.webosDeviceInfoPromise;
    },
    getWebOsUnsupportedAudioCodecs() {
      return Array.from(this.webosUnsupportedAudioCodecs);
    },
    getWebOsUnsupportedAudioPenalty(text = "") {
      const unsupportedAudioCodecs = new Set(this.getWebOsUnsupportedAudioCodecs());
      const normalizedText = String(text || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      let penalty = 0;
      if (unsupportedAudioCodecs.has("dts") && /\b(dts hd|dts hd ma|dts x|dtsx|dts)\b/.test(normalizedText)) {
        penalty -= 45;
      }
      if (unsupportedAudioCodecs.has("truehd") && /\b(truehd|true hd|dolby truehd|mlp fba|a truehd)\b/.test(normalizedText)) {
        penalty -= 45;
      }
      return penalty;
    },
    isLikelyUnsupportedWebOsAudioTrackDescription(text = "") {
      return this.getWebOsUnsupportedAudioPenalty(text) < 0;
    }
  };
}
