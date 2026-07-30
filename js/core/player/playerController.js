import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchedSeriesReconciliationService } from "../../data/repository/watchedSeriesReconciliationService.js";
import { Platform } from "../../platform/index.js";
import { WatchProgressSyncService } from "../profile/watchProgressSyncService.js";
import { nativeVideoEngine } from "./engines/nativeVideoEngine.js";
import { hlsJsEngine } from "./engines/hlsJsEngine.js";
import { dashJsEngine } from "./engines/dashJsEngine.js";
import { resolvePlatformAvplayEngine } from "./engines/platformAvplayEngine.js";
import {
  applyWebOsAudioCodecOverrides,
  detectWebOsAudioCapabilities
} from "../../platform/webos/webosAudioCapabilities.js";
import { WebOsLunaService } from "../../platform/webos/webosLunaService.js";
import { WebOSPlayerExtensions } from "../../platform/webos/webosPlayerExtensions.js";
import { loadStreamingLibs } from "../../runtime/loadStreamingLibs.js";

const MIN_PROGRESS_SYNC_DURATION_MS = 1000;
const WEBOS_AUDIO_TRACK_SELECTION_TIMEOUT_MS = 4000;

function logEngineFsDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_ENGINEFS__) {
    console.info(...args);
  }
}

function logTizenAvPlayDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ || globalThis.__NUVIO_DEBUG_ENGINEFS__) {
    console.info(...args);
  }
}

function isValidAvPlayAudioTrackSelectionState(state) {
  return state === "PLAYING";
}

function isValidAvPlaySubtitleTrackSelectionState(state) {
  return state === "PLAYING" || state === "PAUSED";
}

function isValidAvPlayPlaybackSpeedState(state) {
  return state === "READY" || state === "PLAYING" || state === "PAUSED";
}

function normalizeAvPlaySubtitleRenderMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "html"
    ? "html"
    : "native";
}

function isAbsoluteLocalAvPlaySubtitlePath(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") || /^file:\/\//i.test(path);
}

// com.webos.media exposes five discrete subtitle sizes (0=tiny, 4=largest).
function resolveWebOsSubtitleFontSizeLevel(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return 1;
  }
  if (size <= 70) {
    return 0;
  }
  if (size <= 100) {
    return 1;
  }
  if (size <= 125) {
    return 2;
  }
  if (size <= 150) {
    return 3;
  }
  return 4;
}

export const PlayerController = {
  video: null,
  isPlaying: false,
  currentItemId: null,
  currentItemType: null,
  currentVideoId: null,
  currentSeason: null,
  currentEpisode: null,
  progressSaveTimer: null,
  lastProgressPushAt: 0,
  lifecycleBound: false,
  lifecycleFlushHandler: null,
  visibilityFlushHandler: null,
  hlsInstance: null,
  dashInstance: null,
  playbackEngine: "none",
  avplayActive: false,
  avplayUrl: "",
  avplayAudioTracks: [],
  avplaySubtitleTracks: [],
  selectedAvPlayAudioTrackIndex: -1,
  selectedAvPlaySubtitleTrackIndex: -1,
  pendingAvPlayAudioTrackIndex: -1,
  desiredAvPlayAudioTrackIndex: -1,
  desiredAvPlayAudioTrackUntil: 0,
  pendingAvPlaySubtitleTrackIndex: -1,
  desiredAvPlaySubtitleTrackIndex: -1,
  desiredAvPlaySubtitleTrackUntil: 0,
  avplaySubtitleSelectionToken: 0,
  avplaySubtitlesSilent: false,
  avplayNativeSubtitleRendering: false,
  avplaySubtitleRenderMode: "native",
  avplayExternalSubtitlePath: "",
  avplayExternalSubtitleDelayMs: 0,
  appliedAvPlayExternalSubtitleDelayKey: "",
  avplayTickTimer: null,
  avplayReady: false,
  avplayEnded: false,
  avplayCurrentTimeMs: 0,
  avplayDurationMs: 0,
  avplayTrackSyncAt: 0,
  lastPlaybackErrorCode: 0,
  currentPlaybackUrl: "",
  currentPlaybackHeaders: {},
  currentPlaybackMediaSourceType: null,
  lastProgressSnapshot: null,
  lastKnownDurationSeconds: 0,
  avplayFallbackAttempts: new Set(),
  playbackEngineAttempts: new Map(),
  playRequestToken: 0,
  playbackSessionActive: false,
  nativeMediaId: "",
  nativeMediaIdLookupToken: 0,
  selectedWebOsEmbeddedAudioTrackIndex: -1,
  selectedWebOsEmbeddedSubtitleTrackIndex: -1,
  webOsAudioSelectionRequestToken: 0,
  webOsSubtitleFontSizeLevel: 1,
  appliedWebOsSubtitleFontSizeKey: "",
  webosDeviceInfoPromise: null,
  webosAudioCapabilities: null,
  webosUnsupportedAudioCodecs: new Set(["dts", "truehd"]),
  forceDtsAudio: false,
  forceTrueHdAudio: false,
  viewportSyncHandler: null,
  avplayDisplayRect: null,
  avplayDisplayMethod: "PLAYER_DISPLAY_MODE_FULL_SCREEN",
  startupAudioGateActive: false,
  startupAudioGatePausesNativePlayback: true,
  startupPresentationAudioMuted: false,
  desiredPlaybackRate: 1,
  appliedAvPlayPlaybackRate: 1,

  isExpectedPlayInterruption(error) {
    const message = String(error?.message || "").toLowerCase();
    const name = String(error?.name || "").toLowerCase();
    if (name === "aborterror") {
      return true;
    }
    return (
      message.includes("interrupted by a new load request") ||
      message.includes("the play() request was interrupted")
    );
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
        search?.get?.("format") ||
          search?.get?.("type") ||
          search?.get?.("mime") ||
          search?.get?.("output") ||
          ""
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
      if (formatHint === "mpd" || formatHint === "dash") {
        return "application/dash+xml";
      }
      if (path.includes("/playlist")) {
        return "application/vnd.apple.mpegurl";
      }
      const extensionMatch = path.match(
        /\.(mp4|m4v|mov|webm|mkv|avi|wmv|ts|m2ts|mpg|mpeg|3gp|mp3|aac|flac)(?=($|[/?#&]))/i
      );
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

    try {
      const parsed = new URL(raw);
      return inferByPath(parsed.pathname, parsed.searchParams);
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
    return (
      message.includes("no supported source") ||
      message.includes("no supported sources") ||
      message.includes("not supported")
    );
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

  setWebOsAudioCodecOverrides({ forceDtsAudio = false, forceTrueHdAudio = false } = {}) {
    this.forceDtsAudio = Boolean(forceDtsAudio);
    this.forceTrueHdAudio = Boolean(forceTrueHdAudio);
  },

  setForceDtsTrueHdAudio(enabled) {
    const forceAll = Boolean(enabled);
    this.setWebOsAudioCodecOverrides({
      forceDtsAudio: forceAll,
      forceTrueHdAudio: forceAll
    });
  },

  getWebOsUnsupportedAudioCodecs() {
    return applyWebOsAudioCodecOverrides(this.webosUnsupportedAudioCodecs, {
      forceDtsAudio: this.forceDtsAudio,
      forceTrueHdAudio: this.forceTrueHdAudio
    });
  },

  getWebOsUnsupportedAudioPenalty(text = "") {
    const unsupportedAudioCodecs = new Set(this.getWebOsUnsupportedAudioCodecs());
    const normalizedText = String(text || "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let penalty = 0;
    if (
      unsupportedAudioCodecs.has("dts") &&
      /\b(dts hd|dts hd ma|dts x|dtsx|dts)\b/.test(normalizedText)
    ) {
      penalty -= 45;
    }
    if (
      unsupportedAudioCodecs.has("truehd") &&
      /\b(truehd|true hd|dolby truehd|mlp fba|a truehd)\b/.test(normalizedText)
    ) {
      penalty -= 45;
    }
    return penalty;
  },

  isLikelyUnsupportedWebOsAudioTrackDescription(text = "") {
    return this.getWebOsUnsupportedAudioPenalty(text) < 0;
  },

  isLikelyDirectFileUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) {
      return false;
    }

    const probes = [raw];
    try {
      probes.push(decodeURIComponent(raw));
    } catch (_) {
      // Ignore decode failures.
    }

    return probes.some((value) =>
      /\.(mkv|mp4|m4v|mov|webm|avi|wmv|ts|m2ts|mpg|mpeg|3gp)(?=($|[/?#&]))/i.test(
        String(value || "")
      )
    );
  },

  isUsingAvPlay() {
    return String(this.playbackEngine || "").endsWith("avplay") && this.avplayActive;
  },

  shouldKeepWebOsPlaybackAwake() {
    return Boolean(
      Platform.isWebOS() && this.playbackSessionActive && this.isPlaying && !this.isPlaybackEnded()
    );
  },

  syncWebOsPlaybackKeepAwake() {
    if (!Platform.isWebOS()) {
      return;
    }
    if (this.shouldKeepWebOsPlaybackAwake()) {
      WebOSPlayerExtensions.startPlaybackKeepAwake(() => this.shouldKeepWebOsPlaybackAwake());
    } else {
      WebOSPlayerExtensions.stopPlaybackKeepAwake();
    }
  },

  emitVideoEvent(eventName, detail = null) {
    if (!this.video || !eventName) {
      return;
    }

    try {
      const event =
        typeof CustomEvent === "function"
          ? new CustomEvent(eventName, { detail: detail || null })
          : (() => {
              const legacyEvent = document.createEvent("CustomEvent");
              legacyEvent.initCustomEvent(eventName, false, false, detail || null);
              return legacyEvent;
            })();
      this.video.dispatchEvent(event);
    } catch (_) {
      // Ignore synthetic event failures.
    }
  },

  requestWebOsMediaCommand(method, parameters = {}) {
    if (!Platform.isWebOS() || !WebOsLunaService.isAvailable()) {
      return Promise.reject(new Error("webOS Luna media service unavailable"));
    }
    return WebOsLunaService.request("luna://com.webos.media", {
      method,
      parameters
    });
  },

  resetNativeMediaState() {
    this.nativeMediaId = "";
    this.nativeMediaIdLookupToken = Number(this.nativeMediaIdLookupToken || 0) + 1;
    this.cancelWebOsAudioTrackSelection();
    this.selectedWebOsEmbeddedAudioTrackIndex = -1;
    this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
    this.appliedWebOsSubtitleFontSizeKey = "";
  },

  syncNativeMediaId() {
    const mediaId = String(this.video?.mediaId || "").trim();
    if (mediaId) {
      this.nativeMediaId = mediaId;
    }
    return this.nativeMediaId;
  },

  waitForNativeMediaId({ maxAttempts = 4, intervalMs = 300 } = {}) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return Promise.resolve(null);
    }

    const existingMediaId = this.syncNativeMediaId();
    if (existingMediaId) {
      return Promise.resolve(existingMediaId);
    }

    const lookupToken = Number(this.nativeMediaIdLookupToken || 0) + 1;
    this.nativeMediaIdLookupToken = lookupToken;

    return new Promise((resolve) => {
      let attempts = 0;
      const poll = () => {
        if (lookupToken !== this.nativeMediaIdLookupToken) {
          resolve(null);
          return;
        }
        const mediaId = this.syncNativeMediaId();
        if (mediaId || attempts >= maxAttempts) {
          resolve(mediaId || null);
          return;
        }
        attempts += 1;
        setTimeout(poll, intervalMs);
      };
      poll();
    });
  },

  nativeAudioTrackListToArray() {
    const audioTrackList =
      this.video?.audioTracks ||
      this.video?.webkitAudioTracks ||
      this.video?.mozAudioTracks ||
      null;
    if (!audioTrackList) {
      return [];
    }
    try {
      return Array.from(audioTrackList).filter(Boolean);
    } catch (_) {
      const tracks = [];
      const trackCount = Number(audioTrackList.length || 0);
      for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
        const track = audioTrackList[trackIndex] || audioTrackList.item?.(trackIndex) || null;
        if (track) {
          tracks.push(track);
        }
      }
      return tracks;
    }
  },

  stopAvPlayTickTimer() {
    if (this.avplayTickTimer) {
      clearInterval(this.avplayTickTimer);
      this.avplayTickTimer = null;
    }
  },

  startAvPlayTickTimer() {
    this.stopAvPlayTickTimer();
    this.avplayTickTimer = setInterval(() => {
      if (!this.isUsingAvPlay()) {
        return;
      }
      this.refreshAvPlayTimeline();
      this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
    }, 1000);
  },

  applyStartupAudioGateToVideo() {
    if (!this.video) {
      return;
    }
    try {
      const gated = Boolean(this.startupAudioGateActive || this.startupPresentationAudioMuted);
      this.video.muted = gated;
      this.video.defaultMuted = gated;
      if (
        !gated &&
        (!Number.isFinite(Number(this.video.volume)) || Number(this.video.volume) <= 0)
      ) {
        this.video.volume = 1;
      }
    } catch (_) {
      // Ignore unsupported volume/mute operations.
    }
  },

  setStartupPresentationAudioMuted(muted) {
    this.startupPresentationAudioMuted = Boolean(muted);
    this.applyStartupAudioGateToVideo();
  },

  pauseNativePlaybackForStartupGate() {
    if (!this.video || this.isUsingAvPlay() || !this.startupAudioGateActive) {
      return;
    }
    try {
      this.video.pause();
      this.isPlaying = false;
      this.syncWebOsPlaybackKeepAwake();
    } catch (_) {
      // Ignore pause failures while the media element is still loading.
    }
  },

  resumeNativePlaybackAfterStartupGate() {
    if (!this.video || this.isUsingAvPlay()) {
      return;
    }
    try {
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          console.warn("Playback start after startup gate rejected", error);
        });
      }
      this.isPlaying = true;
      this.syncWebOsPlaybackKeepAwake();
    } catch (error) {
      if (!this.isExpectedPlayInterruption(error)) {
        console.warn("Playback start after startup gate rejected", error);
      }
    }
  },

  handleNativePlayStartedUnderStartupGate(playPromise = null) {
    if (
      !this.startupAudioGateActive ||
      this.isUsingAvPlay() ||
      !this.startupAudioGatePausesNativePlayback
    ) {
      return playPromise;
    }
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          this.pauseNativePlaybackForStartupGate();
        })
        .catch(() => {
          // The normal playback-start rejection handler reports real failures.
        });
      return playPromise;
    }
    this.pauseNativePlaybackForStartupGate();
    return playPromise;
  },

  setStartupAudioGate(active, { resume = true, pauseNativePlayback = true } = {}) {
    const shouldGate = Boolean(active);
    const wasGated = Boolean(this.startupAudioGateActive);
    const nativePlaybackWasPausedForGate = Boolean(this.startupAudioGatePausesNativePlayback);
    this.startupAudioGateActive = shouldGate;
    this.startupAudioGatePausesNativePlayback = shouldGate ? Boolean(pauseNativePlayback) : true;
    this.applyStartupAudioGateToVideo();

    if (shouldGate) {
      if (this.isUsingAvPlay() && this.isPlaying) {
        const avplay = this.getAvPlay();
        try {
          avplay?.pause?.();
          this.isPlaying = false;
          this.syncWebOsPlaybackKeepAwake();
          this.stopAvPlayTickTimer();
        } catch (_) {
          // Ignore AVPlay pause failures while replacing the source.
        }
      }
      return;
    }

    if (!resume || !wasGated) {
      return;
    }
    if (this.isUsingAvPlay()) {
      if (this.avplayReady) {
        this.startPreparedAvPlayPlayback();
      }
      return;
    }
    if (nativePlaybackWasPausedForGate || this.video?.paused) {
      this.resumeNativePlaybackAfterStartupGate();
    }
  },

  startPreparedAvPlayPlayback({ syncTracks = true } = {}) {
    const avplay = this.getAvPlay();
    if (!avplay || !this.isUsingAvPlay()) {
      return false;
    }
    try {
      avplay.play?.();
      this.isPlaying = true;
      this.syncWebOsPlaybackKeepAwake();
      this.reapplyAvPlayPlaybackRate();
      this.reapplyTizenAvPlayDisplayRect();
      this.reapplyTizenAvPlayDisplayRect(250);
      this.startAvPlayTickTimer();
      this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
      [0, 250, 750, 1500].forEach((delayMs) => {
        setTimeout(() => {
          if (!this.isUsingAvPlay()) {
            return;
          }
          this.reapplyAvPlayPlaybackRate();
          this.applyPendingAvPlayAudioTrackSelection();
          this.applyPendingAvPlaySubtitleTrackSelection();
        }, delayMs);
      });
      setTimeout(
        () => {
          if (!this.isUsingAvPlay()) {
            return;
          }
          this.reapplyAvPlayPlaybackRate();
          this.applyPendingAvPlayAudioTrackSelection();
          this.applyPendingAvPlaySubtitleTrackSelection();
          if (syncTracks) {
            this.syncAvPlayTrackInfo({ force: true });
            this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
          }
        },
        syncTracks ? 500 : 300
      );
      return true;
    } catch (error) {
      this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(
        error?.name || error?.message || error
      );
      this.isPlaying = false;
      this.syncWebOsPlaybackKeepAwake();
      this.emitVideoEvent("error", {
        playbackEngine: this.playbackEngine,
        mediaErrorCode: this.lastPlaybackErrorCode
      });
      return false;
    }
  },

  refreshAvPlayTimeline() {
    if (!this.isUsingAvPlay()) {
      return;
    }
    const avplay = this.getAvPlay();
    if (!avplay) {
      return;
    }
    try {
      const currentMs = Number(avplay.getCurrentTime?.() || 0);
      if (Number.isFinite(currentMs) && currentMs >= 0) {
        this.avplayCurrentTimeMs = currentMs;
      }
    } catch (_) {
      // Ignore current-time polling failures.
    }
    try {
      const durationMs = Number(avplay.getDuration?.() || 0);
      if (Number.isFinite(durationMs) && durationMs >= 0) {
        this.avplayDurationMs = durationMs;
      }
    } catch (_) {
      // Ignore duration polling failures.
    }
  },

  parseAvPlayExtraInfo(extraInfoValue) {
    if (!extraInfoValue) {
      return null;
    }
    if (typeof extraInfoValue === "object") {
      return extraInfoValue;
    }

    const source = String(extraInfoValue)
      .replace(/^\uFEFF/, "")
      .split(String.fromCharCode(0))
      .join("")
      .trim();
    let candidate = source;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
        if (typeof parsed === "string" && parsed !== candidate) {
          candidate = parsed.trim();
          continue;
        }
      } catch (_) {
        break;
      }
      break;
    }

    // Some AVPlay firmware returns JSON-like metadata with single quotes or
    // stray bytes. Preserve the language/title fields even when JSON.parse fails.
    const recovered = {};
    [
      "track_lang",
      "trackLang",
      "language",
      "language_code",
      "lang",
      "track_name",
      "track_title",
      "title",
      "name",
      "label"
    ].forEach((key) => {
      const match = source.match(new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`, "i"));
      if (match?.[1]) {
        recovered[key] = match[1].trim();
      }
    });
    return Object.keys(recovered).length ? recovered : null;
  },

  normalizeAvPlayTrackType(typeValue) {
    const type = String(typeValue || "")
      .trim()
      .toUpperCase();
    if (type === "SUBTITLE") {
      return "TEXT";
    }
    if (type === "AUDIO" || type === "TEXT" || type === "VIDEO") {
      return type;
    }
    if (type.includes("AUDIO")) {
      return "AUDIO";
    }
    if (type.includes("TEXT") || type.includes("SUBTITLE")) {
      return "TEXT";
    }
    if (type.includes("VIDEO")) {
      return "VIDEO";
    }
    return type;
  },

  pickAvPlayTrackLabel(track = {}, trackIndex = 0, prefix = "Track") {
    const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
    return String(
      track.name ||
        track.label ||
        track.title ||
        extraInfo.name ||
        extraInfo.label ||
        extraInfo.track_name ||
        extraInfo.track_title ||
        extraInfo.title ||
        extraInfo.track_lang ||
        extraInfo.trackLang ||
        extraInfo.language ||
        extraInfo.language_code ||
        extraInfo.lang ||
        `${prefix} ${trackIndex + 1}`
    ).trim();
  },

  pickAvPlayTrackLanguage(track = {}) {
    const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
    const candidates = [
      track.language,
      track.lang,
      track.track_lang,
      track.trackLang,
      track.language_code,
      extraInfo.track_lang,
      extraInfo.trackLang,
      extraInfo.language,
      extraInfo.language_code,
      extraInfo.lang
    ].map((value) => String(value || "").trim());
    return (
      candidates.find(
        (value) =>
          value && !/^(unknown(?: language)?|undetermined|undefined|und|unk|zxx)$/i.test(value)
      ) || ""
    );
  },

  pickAvPlayExtraValue(extraInfo = {}, keys = []) {
    for (const key of keys) {
      const value = extraInfo?.[key];
      if (value === null || value === undefined) {
        continue;
      }
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
    return "";
  },

  syncAvPlayTrackInfo(options = {}) {
    if (!this.isUsingAvPlay()) {
      this.avplayAudioTracks = [];
      this.avplaySubtitleTracks = [];
      this.selectedAvPlayAudioTrackIndex = -1;
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.avplayTrackSyncAt = 0;
      return;
    }

    const avplay = this.getAvPlay();
    if (!avplay) {
      return;
    }

    const force = Boolean(options?.force);
    const now = Date.now();
    if (!force && now - Number(this.avplayTrackSyncAt || 0) < 220) {
      return;
    }
    this.avplayTrackSyncAt = now;

    const totalTracks = (() => {
      try {
        const value = avplay.getTotalTrackInfo?.();
        return Array.isArray(value) ? value : [];
      } catch (_) {
        return [];
      }
    })();

    const currentTracks = (() => {
      try {
        const value = avplay.getCurrentStreamInfo?.();
        return Array.isArray(value) ? value : [];
      } catch (_) {
        return [];
      }
    })();

    const currentAudio = currentTracks.find(
      (track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO"
    );
    const currentText = currentTracks.find(
      (track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT"
    );
    const selectedAudioIndex = Number(currentAudio?.index);
    const selectedTextIndex = Number(currentText?.index);

    this.avplayAudioTracks = totalTracks
      .filter((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO")
      .map((track, index) => {
        const trackIndex = Number(track?.index);
        const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : -1;
        const extraInfo =
          this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
        const forcedValue = this.pickAvPlayExtraValue(extraInfo, ["forced", "is_forced"]);
        return {
          id: `avplay-audio-${normalizedTrackIndex}`,
          label: this.pickAvPlayTrackLabel(track, index, "Track"),
          language: this.pickAvPlayTrackLanguage(track),
          channels: this.pickAvPlayExtraValue(extraInfo, [
            "channels",
            "channel",
            "audio_channel",
            "audio_channel_count",
            "channel_layout"
          ]),
          codec: this.pickAvPlayExtraValue(extraInfo, [
            "codec",
            "codec_name",
            "codec_id",
            "codec_tag_string",
            "audio_type",
            "audioType",
            "audioCodec",
            "fourCC"
          ]),
          codecProfile: this.pickAvPlayExtraValue(extraInfo, [
            "profile",
            "codecProfile",
            "codec_profile"
          ]),
          mimeType: this.pickAvPlayExtraValue(extraInfo, [
            "mimeType",
            "sampleMimeType",
            "mime_type",
            "sample_mime_type"
          ]),
          characteristics: this.pickAvPlayExtraValue(extraInfo, [
            "characteristics",
            "role",
            "type"
          ]),
          sampleRate:
            Number(
              this.pickAvPlayExtraValue(extraInfo, [
                "sampleRate",
                "audioSampleRate",
                "sample_rate"
              ]) || 0
            ) || 0,
          forced: /^(1|true|yes)$/i.test(forcedValue),
          extraInfo,
          avplayTrackIndex: normalizedTrackIndex,
          avplayAudioOrdinalIndex: index
        };
      })
      .filter(
        (track) =>
          Number.isFinite(Number(track?.avplayTrackIndex)) && Number(track.avplayTrackIndex) >= 0
      );

    this.avplaySubtitleTracks = totalTracks
      .filter((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT")
      .map((track, index) => {
        const trackIndex = Number(track?.index);
        const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : index;
        const extraInfo =
          this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
        const forcedValue = this.pickAvPlayExtraValue(extraInfo, ["forced", "is_forced"]);
        return {
          id: `avplay-sub-${normalizedTrackIndex}`,
          label: this.pickAvPlayTrackLabel(track, index, "Subtitle"),
          language: this.pickAvPlayTrackLanguage(track),
          codec: this.pickAvPlayExtraValue(extraInfo, [
            "codec",
            "codec_name",
            "codec_id",
            "codec_tag_string",
            "fourCC",
            "fourcc"
          ]),
          forced: /^(1|true|yes)$/i.test(forcedValue),
          extraInfo,
          avplayTrackIndex: normalizedTrackIndex
        };
      });

    if (Platform.isTizen()) {
      logTizenAvPlayDebug("Tizen AVPlay tracks synced", {
        state: this.getAvPlayState(),
        totalTracks,
        currentTracks,
        audioTracks: this.avplayAudioTracks,
        selectedAudioIndex,
        selectedAudioTrackIndex: this.selectedAvPlayAudioTrackIndex
      });
    }

    const desiredAudioIndex = Number(this.desiredAvPlayAudioTrackIndex);
    const desiredAudioActive =
      Number.isFinite(desiredAudioIndex) &&
      desiredAudioIndex >= 0 &&
      Date.now() < Number(this.desiredAvPlayAudioTrackUntil || 0);
    const resolvedSelectedAudioIndex = this.resolveAvPlayAudioTrackIndex(selectedAudioIndex);
    const resolvedSelectedTextIndex = this.resolveAvPlaySubtitleTrackIndex(selectedTextIndex);

    if (desiredAudioActive) {
      this.selectedAvPlayAudioTrackIndex = desiredAudioIndex;
    } else if (Number.isFinite(resolvedSelectedAudioIndex) && resolvedSelectedAudioIndex >= 0) {
      this.selectedAvPlayAudioTrackIndex = resolvedSelectedAudioIndex;
      this.pendingAvPlayAudioTrackIndex = -1;
      this.desiredAvPlayAudioTrackIndex = -1;
      this.desiredAvPlayAudioTrackUntil = 0;
    } else if (
      Number.isFinite(this.pendingAvPlayAudioTrackIndex) &&
      this.pendingAvPlayAudioTrackIndex >= 0
    ) {
      this.selectedAvPlayAudioTrackIndex = this.pendingAvPlayAudioTrackIndex;
    } else if (this.avplayAudioTracks.length && this.selectedAvPlayAudioTrackIndex < 0) {
      this.selectedAvPlayAudioTrackIndex = this.avplayAudioTracks[0].avplayTrackIndex;
    } else if (!this.avplayAudioTracks.length) {
      this.selectedAvPlayAudioTrackIndex = -1;
    }

    const desiredSubtitleIndex = Number(this.desiredAvPlaySubtitleTrackIndex);
    const desiredSubtitleActive =
      Number.isFinite(desiredSubtitleIndex) &&
      Date.now() < Number(this.desiredAvPlaySubtitleTrackUntil || 0);

    if (this.avplaySubtitlesSilent) {
      this.selectedAvPlaySubtitleTrackIndex = -1;
    } else if (desiredSubtitleActive) {
      this.selectedAvPlaySubtitleTrackIndex = desiredSubtitleIndex;
    } else if (Number.isFinite(resolvedSelectedTextIndex) && resolvedSelectedTextIndex >= 0) {
      this.selectedAvPlaySubtitleTrackIndex = resolvedSelectedTextIndex;
      this.pendingAvPlaySubtitleTrackIndex = -1;
      this.desiredAvPlaySubtitleTrackIndex = -1;
      this.desiredAvPlaySubtitleTrackUntil = 0;
    } else if (
      Number.isFinite(this.pendingAvPlaySubtitleTrackIndex) &&
      this.pendingAvPlaySubtitleTrackIndex >= 0
    ) {
      this.selectedAvPlaySubtitleTrackIndex = this.pendingAvPlaySubtitleTrackIndex;
    } else if (!this.avplaySubtitleTracks.length) {
      this.selectedAvPlaySubtitleTrackIndex = -1;
    }
  },

  getAvPlayAudioTracks() {
    return this.avplayAudioTracks.slice();
  },

  getAvPlaySubtitleTracks() {
    return this.avplaySubtitleTracks.slice();
  },

  getSelectedAvPlayAudioTrackIndex() {
    return Number.isFinite(this.selectedAvPlayAudioTrackIndex)
      ? this.selectedAvPlayAudioTrackIndex
      : -1;
  },

  resolveAvPlayAudioTrackIndex(trackIndex) {
    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return -1;
    }
    const exact = this.avplayAudioTracks.find(
      (track) => Number(track?.avplayTrackIndex) === targetIndex
    );
    if (exact) {
      return Number(exact.avplayTrackIndex);
    }
    return -1;
  },

  getAvPlayAudioTrackSelectionIndex(trackIndex) {
    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return -1;
    }
    const track = this.avplayAudioTracks.find(
      (entry) => Number(entry?.avplayTrackIndex) === targetIndex
    );
    return track ? Number(track.avplayTrackIndex) : -1;
  },

  getCurrentAvPlayAudioTrackIndex() {
    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.getCurrentStreamInfo !== "function") {
      return -1;
    }
    try {
      const streams = avplay.getCurrentStreamInfo();
      const audio = Array.isArray(streams)
        ? streams.find((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO")
        : null;
      return this.resolveAvPlayAudioTrackIndex(Number(audio?.index));
    } catch (_) {
      return -1;
    }
  },

  trySelectAvPlayAudioTrackIndex(trackIndex, { nudge = false } = {}) {
    const avplay = this.getAvPlay();
    const targetIndex = Number(trackIndex);
    if (
      !avplay ||
      typeof avplay.setSelectTrack !== "function" ||
      !Number.isFinite(targetIndex) ||
      targetIndex < 0
    ) {
      return false;
    }
    const state = this.getAvPlayState();
    if (!isValidAvPlayAudioTrackSelectionState(state)) {
      logTizenAvPlayDebug("Tizen AVPlay audio selection deferred; invalid state", {
        state,
        targetIndex
      });
      return false;
    }
    try {
      logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(AUDIO)", {
        state,
        targetIndex,
        audioTracks: this.avplayAudioTracks
      });
      avplay.setSelectTrack("AUDIO", targetIndex);
      if (nudge) {
        this.nudgeAvPlayAfterTrackSwitch();
      }
      logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(AUDIO) succeeded", {
        state: this.getAvPlayState(),
        targetIndex
      });
      return true;
    } catch (error) {
      logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(AUDIO) failed", {
        state,
        targetIndex,
        error: error?.message || String(error || "")
      });
      return false;
    }
  },

  retryAvPlayAudioTrackSelection(trackIndex, { nudge = false } = {}) {
    const canonicalIndex = this.resolveAvPlayAudioTrackIndex(trackIndex);
    if (canonicalIndex < 0) {
      return false;
    }
    const currentIndex = this.getCurrentAvPlayAudioTrackIndex();
    if (currentIndex === canonicalIndex) {
      return true;
    }
    const selectionIndex = this.getAvPlayAudioTrackSelectionIndex(canonicalIndex);
    if (selectionIndex < 0) {
      return false;
    }
    const attempted = this.trySelectAvPlayAudioTrackIndex(selectionIndex, { nudge });
    return attempted || this.getCurrentAvPlayAudioTrackIndex() === canonicalIndex;
  },

  getSelectedAvPlaySubtitleTrackIndex() {
    return Number.isFinite(this.selectedAvPlaySubtitleTrackIndex)
      ? this.selectedAvPlaySubtitleTrackIndex
      : -1;
  },

  resolveAvPlaySubtitleTrackIndex(trackIndex) {
    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return -1;
    }
    const exact = this.avplaySubtitleTracks.find(
      (track) => Number(track?.avplayTrackIndex) === targetIndex
    );
    if (exact) {
      return Number(exact.avplayTrackIndex);
    }
    return -1;
  },

  getCurrentAvPlaySubtitleTrackIndex() {
    const avplay = this.getAvPlay();
    if (
      !avplay ||
      typeof avplay.getCurrentStreamInfo !== "function" ||
      this.avplaySubtitlesSilent
    ) {
      return -1;
    }
    try {
      const streams = avplay.getCurrentStreamInfo();
      const text = Array.isArray(streams)
        ? streams.find((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT")
        : null;
      return this.resolveAvPlaySubtitleTrackIndex(Number(text?.index));
    } catch (_) {
      return -1;
    }
  },

  clearAvPlayExternalSubtitlePath() {
    this.avplayExternalSubtitlePath = "";
    this.avplayExternalSubtitleDelayMs = 0;
    this.appliedAvPlayExternalSubtitleDelayKey = "";
    // AVPlay has no documented "clear" value: the API accepts only an
    // absolute local path. Track selection and setSilentSubtitle control the
    // active output without sending an invalid empty path to the player.
    return true;
  },

  applyAvPlaySubtitleRenderMode(renderMode = this.avplaySubtitleRenderMode) {
    const mode = normalizeAvPlaySubtitleRenderMode(renderMode);
    this.avplaySubtitleRenderMode = mode;
    const avplay = this.getAvPlay();
    if (!avplay) {
      return false;
    }
    let applied = false;
    try {
      if (typeof avplay.setSilentSubtitle === "function") {
        // AVPlay emits subtitle callbacks for the HTML overlay only while its
        // own renderer is silent. Native mode restores Samsung's renderer.
        avplay.setSilentSubtitle(mode === "html");
        applied = true;
      }
    } catch (_) {
      // Track selection can still succeed when this toggle is unavailable.
    }
    this.avplaySubtitlesSilent = false;
    this.avplayNativeSubtitleRendering = mode === "native" && applied;
    return applied;
  },

  trySelectAvPlaySubtitleTrackIndex(
    trackIndex,
    { nudge = false, renderMode = this.avplaySubtitleRenderMode } = {}
  ) {
    const avplay = this.getAvPlay();
    const targetIndex = Number(trackIndex);
    if (
      !avplay ||
      typeof avplay.setSelectTrack !== "function" ||
      !Number.isFinite(targetIndex) ||
      targetIndex < 0
    ) {
      return false;
    }
    const state = this.getAvPlayState();
    if (!isValidAvPlaySubtitleTrackSelectionState(state)) {
      logTizenAvPlayDebug("Tizen AVPlay subtitle selection deferred; invalid state", {
        state,
        targetIndex
      });
      return false;
    }
    const mode = normalizeAvPlaySubtitleRenderMode(renderMode);
    try {
      // Re-arm AVPlay's subtitle decoder before selecting. Selecting the same
      // TEXT track is otherwise a no-op after subtitles were disabled.
      avplay.setSilentSubtitle?.(mode === "native");
    } catch (_) {
      // Track selection can still succeed when this toggle is unavailable.
    }
    try {
      logTizenAvPlayDebug("Tizen AVPlay setSelectTrack(TEXT)", {
        state,
        targetIndex,
        subtitleTracks: this.avplaySubtitleTracks
      });
      avplay.setSelectTrack("TEXT", targetIndex);
    } catch (error) {
      logTizenAvPlayDebug("Tizen AVPlay subtitle selection failed", {
        state,
        targetIndex,
        error: error?.message || String(error || "")
      });
      this.applyAvPlaySubtitleRenderMode(mode);
      return false;
    }
    this.applyAvPlaySubtitleRenderMode(mode);
    if (nudge) {
      this.nudgeAvPlayAfterTrackSwitch();
    }
    this.reapplyTizenAvPlayDisplayRect();
    this.reapplyTizenAvPlayDisplayRect(250);
    logTizenAvPlayDebug("Tizen AVPlay subtitle selection requested", {
      state: this.getAvPlayState(),
      targetIndex
    });
    return true;
  },

  retryAvPlaySubtitleTrackSelection(
    trackIndex,
    { nudge = false, renderMode = this.avplaySubtitleRenderMode } = {}
  ) {
    const canonicalIndex = this.resolveAvPlaySubtitleTrackIndex(trackIndex);
    if (canonicalIndex < 0) {
      return false;
    }
    const currentIndex = this.getCurrentAvPlaySubtitleTrackIndex();
    if (currentIndex === canonicalIndex) {
      // Selection and rendering are separate AVPlay states. Reapply the
      // renderer even when Samsung already reports the requested track.
      this.applyAvPlaySubtitleRenderMode(renderMode);
      return true;
    }
    const attempted = this.trySelectAvPlaySubtitleTrackIndex(canonicalIndex, { nudge, renderMode });
    return attempted || this.getCurrentAvPlaySubtitleTrackIndex() === canonicalIndex;
  },

  getSelectedWebOsEmbeddedAudioTrackIndex() {
    return Number.isFinite(this.selectedWebOsEmbeddedAudioTrackIndex)
      ? this.selectedWebOsEmbeddedAudioTrackIndex
      : -1;
  },

  cancelWebOsAudioTrackSelection() {
    this.webOsAudioSelectionRequestToken = Number(this.webOsAudioSelectionRequestToken || 0) + 1;
  },

  requestConfirmedWebOsAudioTrackSelection({
    targetTrackIndex,
    selectedTrackIndex = targetTrackIndex,
    selectionKind = "native",
    applySelection = null
  } = {}) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return false;
    }

    const targetIndex = Number(targetTrackIndex);
    const selectedIndex = Number(selectedTrackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return false;
    }

    const requestToken = Number(this.webOsAudioSelectionRequestToken || 0) + 1;
    this.webOsAudioSelectionRequestToken = requestToken;
    const detail = {
      requestToken,
      selectionKind,
      targetTrackIndex: targetIndex,
      selectedTrackIndex:
        Number.isFinite(selectedIndex) && selectedIndex >= 0 ? selectedIndex : targetIndex
    };

    const emitSelectionState = (status, extra = {}) => {
      if (requestToken !== this.webOsAudioSelectionRequestToken) {
        return;
      }
      const selectionState = {
        ...detail,
        status,
        ...extra
      };
      this.emitVideoEvent("webosaudiotrackselectionchanged", selectionState);
    };

    const commitSelection = () => {
      if (typeof applySelection === "function") {
        applySelection();
      }
      this.selectedWebOsEmbeddedAudioTrackIndex =
        selectionKind === "embedded" ? detail.selectedTrackIndex : -1;
    };

    emitSelectionState("pending");

    if (!WebOsLunaService.isAvailable()) {
      commitSelection();
      emitSelectionState("confirmed");
      return true;
    }

    void (async () => {
      try {
        const mediaId = this.syncNativeMediaId() || (await this.waitForNativeMediaId());
        if (requestToken !== this.webOsAudioSelectionRequestToken) {
          return;
        }
        if (!mediaId) {
          throw new Error("webOS media id unavailable");
        }

        let timeoutId = 0;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error("webOS audio track selection timed out"));
          }, WEBOS_AUDIO_TRACK_SELECTION_TIMEOUT_MS);
        });
        let result;
        try {
          result = await Promise.race([
            this.requestWebOsMediaCommand("selectTrack", {
              type: "audio",
              mediaId,
              index: targetIndex
            }),
            timeoutPromise
          ]);
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
        if (requestToken !== this.webOsAudioSelectionRequestToken) {
          return;
        }
        if (result?.returnValue === false || result?.errorCode) {
          throw new Error(result?.errorText || "webOS audio track selection failed");
        }

        commitSelection();
        emitSelectionState("confirmed");
      } catch (error) {
        emitSelectionState("failed", {
          error: String(
            error?.errorText || error?.message || error || "webOS audio track selection failed"
          )
        });
      }
    })();

    return true;
  },

  getSelectedWebOsEmbeddedSubtitleTrackIndex() {
    return Number.isFinite(this.selectedWebOsEmbeddedSubtitleTrackIndex)
      ? this.selectedWebOsEmbeddedSubtitleTrackIndex
      : -1;
  },

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
      if (
        !this.trySelectAvPlayAudioTrackIndex(selectionIndex, {
          nudge: state === "PLAYING" || state === "PAUSED"
        })
      ) {
        throw new Error("setSelectTrack failed");
      }
      this.pendingAvPlayAudioTrackIndex = -1;
      this.selectedAvPlayAudioTrackIndex = targetIndex;
      this.syncAvPlayTrackInfo({ force: true });
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      setTimeout(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.retryAvPlayAudioTrackSelection(targetIndex, { nudge: canApplyNow });
        this.applyPendingAvPlayAudioTrackSelection();
        this.syncAvPlayTrackInfo({ force: true });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      }, 400);
      setTimeout(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.retryAvPlayAudioTrackSelection(targetIndex, { nudge: canApplyNow });
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
      Number.isFinite(desiredIndex) &&
      desiredIndex >= 0 &&
      Date.now() < Number(this.desiredAvPlayAudioTrackUntil || 0);
    const targetIndex =
      Number.isFinite(pendingIndex) && pendingIndex >= 0
        ? pendingIndex
        : desiredActive
          ? desiredIndex
          : -1;
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
      if (!this.retryAvPlayAudioTrackSelection(canonicalIndex, { nudge: true })) {
        const selectionIndex = this.getAvPlayAudioTrackSelectionIndex(canonicalIndex);
        if (
          !this.trySelectAvPlayAudioTrackIndex(selectionIndex, {
            nudge: state === "PLAYING" || state === "PAUSED"
          })
        ) {
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

  nudgeAvPlayAfterTrackSwitch() {
    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.seekTo !== "function") {
      return;
    }
    try {
      const currentMs = Math.max(
        0,
        Number(avplay.getCurrentTime?.() || this.avplayCurrentTimeMs || 0)
      );
      if (Number.isFinite(currentMs) && currentMs > 0) {
        avplay.seekTo(Math.max(0, currentMs - 1));
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

    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      this.pendingAvPlaySubtitleTrackIndex = -1;
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
    if (!canApplyNow || shouldDeferUntilPlay) {
      this.pendingAvPlaySubtitleTrackIndex = canonicalIndex;
      this.selectedAvPlaySubtitleTrackIndex = canonicalIndex;
      this.avplaySubtitlesSilent = false;
      this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    }

    try {
      if (
        !this.trySelectAvPlaySubtitleTrackIndex(canonicalIndex, {
          renderMode: this.avplaySubtitleRenderMode
        })
      ) {
        throw new Error("setSelectTrack failed");
      }
      this.pendingAvPlaySubtitleTrackIndex = -1;
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
    const desiredIndex = Number(this.desiredAvPlaySubtitleTrackIndex);
    const desiredActive =
      Number.isFinite(desiredIndex) &&
      desiredIndex >= 0 &&
      Date.now() < Number(this.desiredAvPlaySubtitleTrackUntil || 0);
    const targetIndex =
      Number.isFinite(pendingIndex) && pendingIndex >= 0
        ? pendingIndex
        : desiredActive
          ? desiredIndex
          : -1;
    const canonicalIndex = this.resolveAvPlaySubtitleTrackIndex(targetIndex);
    if (!this.isUsingAvPlay() || !Number.isFinite(canonicalIndex) || canonicalIndex < 0) {
      return false;
    }

    const state = this.getAvPlayState();
    if (state && !isValidAvPlaySubtitleTrackSelectionState(state)) {
      return false;
    }

    try {
      if (!this.retryAvPlaySubtitleTrackSelection(canonicalIndex)) {
        throw new Error("setSelectTrack failed");
      }
      if (Number.isFinite(pendingIndex) && pendingIndex === canonicalIndex) {
        this.pendingAvPlaySubtitleTrackIndex = -1;
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
  },

  setAvPlayExternalSubtitle(subtitleUrl) {
    if (!this.isUsingAvPlay()) {
      return false;
    }

    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.setExternalSubtitlePath !== "function") {
      return false;
    }

    this.avplaySubtitleSelectionToken = Number(this.avplaySubtitleSelectionToken || 0) + 1;

    const path = String(subtitleUrl || "").trim();
    // Samsung AVPlay does not download external subtitles. Passing an HTTP(S)
    // URL is accepted synchronously on some TVs but later aborts through the
    // player onerror callback with PLAYER_ERROR_CONNECTION_FAILED.
    if (Platform.isTizen() && !isAbsoluteLocalAvPlaySubtitlePath(path)) {
      return false;
    }
    try {
      avplay.setExternalSubtitlePath(path);
      try {
        avplay.setSilentSubtitle?.(!path);
        this.avplaySubtitlesSilent = !path;
      } catch (_) {
        this.avplaySubtitlesSilent = !path;
        // Ignore subtitle mute/unmute failures.
      }
      this.pendingAvPlaySubtitleTrackIndex = -1;
      this.desiredAvPlaySubtitleTrackIndex = -1;
      this.desiredAvPlaySubtitleTrackUntil = 0;
      this.avplayNativeSubtitleRendering = false;
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
      this.avplayExternalSubtitlePath = path;
      this.appliedAvPlayExternalSubtitleDelayKey = "";
      this.applyAvPlayExternalSubtitleDelay();
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    } catch (_) {
      return false;
    }
  },

  hasActiveAvPlaySubtitleOutput() {
    if (!this.isUsingAvPlay() || this.avplaySubtitlesSilent) {
      return false;
    }
    if (String(this.avplayExternalSubtitlePath || "").trim()) {
      return true;
    }
    const selectedIndex = Number(this.selectedAvPlaySubtitleTrackIndex);
    const pendingIndex = Number(this.pendingAvPlaySubtitleTrackIndex);
    const desiredIndex = Number(this.desiredAvPlaySubtitleTrackIndex);
    return (
      (Number.isFinite(selectedIndex) && selectedIndex >= 0) ||
      (Number.isFinite(pendingIndex) && pendingIndex >= 0) ||
      (Number.isFinite(desiredIndex) &&
        desiredIndex >= 0 &&
        Date.now() < Number(this.desiredAvPlaySubtitleTrackUntil || 0))
    );
  },

  shouldRenderAvPlaySubtitleCallbacksInHtml() {
    return (
      !this.avplayNativeSubtitleRendering &&
      !String(this.avplayExternalSubtitlePath || "").trim() &&
      this.hasActiveAvPlaySubtitleOutput()
    );
  },

  getAvPlaySubtitleOutputMode() {
    if (!this.isUsingAvPlay() || this.avplaySubtitlesSilent) {
      return "none";
    }
    if (String(this.avplayExternalSubtitlePath || "").trim()) {
      return "external-native";
    }
    if (this.avplayNativeSubtitleRendering && this.hasActiveAvPlaySubtitleOutput()) {
      return "embedded-native";
    }
    if (this.hasActiveAvPlaySubtitleOutput()) {
      return "html-callback";
    }
    return "none";
  },

  supportsAvPlayExternalSubtitleDelay() {
    return typeof this.getAvPlay()?.setSubtitlePosition === "function";
  },

  setAvPlayExternalSubtitleDelay(delayMs = 0) {
    const normalizedDelayMs = Number(delayMs);
    this.avplayExternalSubtitleDelayMs = Number.isFinite(normalizedDelayMs)
      ? Math.round(normalizedDelayMs)
      : 0;
    this.appliedAvPlayExternalSubtitleDelayKey = "";
    return this.applyAvPlayExternalSubtitleDelay();
  },

  applyAvPlayExternalSubtitleDelay() {
    const path = String(this.avplayExternalSubtitlePath || "").trim();
    if (!this.isUsingAvPlay() || !path) {
      return false;
    }
    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.setSubtitlePosition !== "function") {
      return false;
    }
    const delayMs = Math.round(Number(this.avplayExternalSubtitleDelayMs || 0));
    const applyKey = `${path}:${delayMs}`;
    if (this.appliedAvPlayExternalSubtitleDelayKey === applyKey) {
      return true;
    }
    const state = this.getAvPlayState();
    if (state !== "PLAYING" && state !== "PAUSED") {
      return false;
    }
    try {
      avplay.setSubtitlePosition(delayMs);
      this.appliedAvPlayExternalSubtitleDelayKey = applyKey;
      return true;
    } catch (_) {
      return false;
    }
  },

  getAvPlayVideoDimensions() {
    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.getCurrentStreamInfo !== "function") {
      return null;
    }
    let streams = [];
    try {
      const value = avplay.getCurrentStreamInfo();
      streams = Array.isArray(value) ? value : [];
    } catch (_) {
      streams = [];
    }
    const videoTrack =
      streams.find((track) => this.normalizeAvPlayTrackType(track?.type) === "VIDEO") || null;
    if (!videoTrack) {
      return null;
    }
    const extraInfo =
      this.parseAvPlayExtraInfo(videoTrack.extra_info || videoTrack.extraInfo || null) || {};
    const widthCandidates = [
      videoTrack.width,
      videoTrack.Width,
      videoTrack.videoWidth,
      extraInfo.width,
      extraInfo.Width,
      extraInfo.videoWidth,
      extraInfo.video_width
    ];
    const heightCandidates = [
      videoTrack.height,
      videoTrack.Height,
      videoTrack.videoHeight,
      extraInfo.height,
      extraInfo.Height,
      extraInfo.videoHeight,
      extraInfo.video_height
    ];
    let width =
      widthCandidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
    let height =
      heightCandidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
    if (!width || !height) {
      const resolutionText = String(
        videoTrack.resolution ||
          videoTrack.Resolution ||
          extraInfo.resolution ||
          extraInfo.Resolution ||
          ""
      );
      const match = resolutionText.match(/(\d{2,5})\s*[xX]\s*(\d{2,5})/);
      if (match) {
        width = Number(match[1]);
        height = Number(match[2]);
      }
    }
    return width > 0 && height > 0 ? { width, height } : null;
  },

  mapAvPlayErrorToMediaCode(errorValue) {
    const errorText = String(errorValue || "").toLowerCase();
    if (!errorText) {
      return 4;
    }
    if (
      errorText.includes("network") ||
      errorText.includes("connection") ||
      errorText.includes("timeout")
    ) {
      return 2;
    }
    if (errorText.includes("decode")) {
      return 3;
    }
    return 4;
  },

  getPlayerViewportSize() {
    const playerRect =
      this.video?.parentElement?.getBoundingClientRect?.() ||
      document.getElementById("player")?.getBoundingClientRect?.() ||
      null;
    const playerWidth = Number(playerRect?.width || 0);
    const playerHeight = Number(playerRect?.height || 0);
    if (
      Number.isFinite(playerWidth) &&
      playerWidth > 0 &&
      Number.isFinite(playerHeight) &&
      playerHeight > 0
    ) {
      return {
        width: Math.max(1, Math.round(playerWidth)),
        height: Math.max(1, Math.round(playerHeight))
      };
    }
    const windowWidth = Number(window.innerWidth || 0);
    const windowHeight = Number(window.innerHeight || 0);
    const documentWidth = Number(document.documentElement?.clientWidth || 0);
    const documentHeight = Number(document.documentElement?.clientHeight || 0);
    const visualViewportWidth = Number(globalThis.visualViewport?.width || 0);
    const visualViewportHeight = Number(globalThis.visualViewport?.height || 0);
    const screenWidth = Number(globalThis.screen?.width || 0);
    const screenHeight = Number(globalThis.screen?.height || 0);
    const width = [windowWidth, documentWidth, visualViewportWidth, screenWidth].find(
      (value) => Number.isFinite(value) && value > 0
    );
    const height = [windowHeight, documentHeight, visualViewportHeight, screenHeight].find(
      (value) => Number.isFinite(value) && value > 0
    );
    return {
      width: Math.max(1, Math.round(width || 1920)),
      height: Math.max(1, Math.round(height || 1080))
    };
  },

  getCssPlayerViewportSize() {
    const playerSize = this.getPlayerViewportSize();
    const documentWidth = Number(document.documentElement?.clientWidth || 0);
    const documentHeight = Number(document.documentElement?.clientHeight || 0);
    const windowWidth = Number(window.innerWidth || 0);
    const windowHeight = Number(window.innerHeight || 0);
    const widthCandidates = [playerSize.width, documentWidth, windowWidth].filter(
      (value) => Number.isFinite(value) && value > 0
    );
    const heightCandidates = [playerSize.height, documentHeight, windowHeight].filter(
      (value) => Number.isFinite(value) && value > 0
    );
    return {
      width: Math.max(1, Math.round(widthCandidates[0] || 1920)),
      height: Math.max(1, Math.round(heightCandidates[0] || 1080))
    };
  },

  getAvPlayViewportSize() {
    if (Platform.isTizen()) {
      return {
        width: 1920,
        height: 1080
      };
    }
    const documentWidth = Number(document.documentElement?.clientWidth || 0);
    const documentHeight = Number(document.documentElement?.clientHeight || 0);
    const screenWidth = Number(globalThis.screen?.width || 0);
    const screenHeight = Number(globalThis.screen?.height || 0);
    const windowWidth = Number(window.innerWidth || 0);
    const windowHeight = Number(window.innerHeight || 0);
    const webOsMajorVersion = Platform.isWebOS() ? Number(Platform.getWebOsMajorVersion() || 0) : 0;
    if (webOsMajorVersion > 0 && webOsMajorVersion <= 6) {
      return this.getPlayerViewportSize();
    }
    return {
      width: Math.max(1, Math.round(Math.max(windowWidth, documentWidth, screenWidth, 1920))),
      height: Math.max(1, Math.round(Math.max(windowHeight, documentHeight, screenHeight, 1080)))
    };
  },

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
    const targetRect = this.avplayDisplayRect || {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height
    };
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

    this.avplayActive = true;
    this.avplayUrl = String(url || "");
    this.avplayReady = false;
    this.avplayEnded = false;
    this.avplayCurrentTimeMs = 0;
    this.avplayDurationMs = 0;
    this.lastPlaybackErrorCode = 0;
    this.playbackEngine = this.getPlatformAvplayEngineName();
    this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });

    try {
      avplay.open(this.avplayUrl);
      this.configureAvPlayForSource(requestHeaders);
    } catch (error) {
      this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(
        error?.name || error?.message || error
      );
      this.teardownAvPlay();
      this.playbackEngine = "none";
      return false;
    }

    this.setAvPlayDisplayRect();

    try {
      avplay.setListener?.({
        onbufferingstart: () => {
          if (!this.isPlaybackRequestActive(playToken, url)) {
            return;
          }
          this.avplayReady = false;
          this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
        },
        onbufferingcomplete: () => {
          if (!this.isPlaybackRequestActive(playToken, url)) {
            return;
          }
          this.avplayReady = true;
          this.reapplyAvPlayPlaybackRate();
          this.applyAvPlayExternalSubtitleDelay();
          this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
        },
        oncurrentplaytime: (currentTimeMs) => {
          if (!this.isPlaybackRequestActive(playToken, url)) {
            return;
          }
          const value = Number(currentTimeMs || 0);
          if (Number.isFinite(value) && value >= 0) {
            this.avplayCurrentTimeMs = value;
          }
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
            this.avplayCurrentTimeMs = Math.max(
              Number(this.avplayCurrentTimeMs || 0),
              completedDurationMs
            );
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
          this.emitVideoEvent("avplaysubtitlechange", {
            playbackEngine: this.playbackEngine,
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
          this.avplayReady = false;
          this.isPlaying = false;
          this.syncWebOsPlaybackKeepAwake();
          this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
          this.stopAvPlayTickTimer();
          this.emitVideoEvent("error", {
            playbackEngine: this.playbackEngine,
            mediaErrorCode: this.lastPlaybackErrorCode,
            avplayError: String(errorValue || "")
          });
        }
      });
    } catch (_) {
      // Ignore listener setup failures; prepareAsync/play may still work.
    }

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
      this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
      this.isPlaying = false;
      this.syncWebOsPlaybackKeepAwake();
      this.teardownAvPlay();
      this.playbackEngine = "none";
      this.emitVideoEvent("error", {
        playbackEngine: this.getPlatformAvplayEngineName(),
        mediaErrorCode: this.lastPlaybackErrorCode,
        avplayError: String(errorValue || "")
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
      onPrepareError(error?.name || error?.message || error);
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
    if (
      Number.isFinite(durationSeconds) &&
      durationSeconds > Number(this.lastKnownDurationSeconds || 0)
    ) {
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
  },

  seekToSeconds(targetSeconds) {
    const seconds = Number(targetSeconds || 0);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return false;
    }

    if (!this.isUsingAvPlay()) {
      if (!this.video) {
        return false;
      }
      this.video.currentTime = seconds;
      return true;
    }

    const avplay = this.getAvPlay();
    if (!avplay) {
      return false;
    }

    const targetMs = Math.max(0, Math.floor(seconds * 1000));
    try {
      this.avplayReady = false;
      this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("seeking", { playbackEngine: this.playbackEngine });
      if (typeof avplay.seekTo === "function") {
        avplay.seekTo(targetMs);
      } else {
        const currentMs = Number(avplay.getCurrentTime?.() || 0);
        if (targetMs > currentMs) {
          avplay.jumpForward?.(targetMs - currentMs);
        } else if (targetMs < currentMs) {
          avplay.jumpBackward?.(currentMs - targetMs);
        }
      }
      this.avplayCurrentTimeMs = targetMs;
      this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
      setTimeout(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.refreshAvPlayTimeline();
        this.avplayReady = true;
        this.reapplyAvPlayPlaybackRate();
        this.emitVideoEvent("seeked", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
      }, 120);
      return true;
    } catch (_) {
      return false;
    }
  },

  isPlaybackEnded() {
    if (this.isUsingAvPlay()) {
      return Boolean(this.avplayEnded);
    }
    return Boolean(this.video?.ended);
  },

  getPlaybackReadyState() {
    if (this.isUsingAvPlay()) {
      return this.avplayReady ? 4 : 1;
    }
    return Number(this.video?.readyState || 0);
  },

  getLastPlaybackErrorCode() {
    return Number(this.lastPlaybackErrorCode || 0);
  },

  forceAvPlayFallbackForCurrentSource(reason = "fallback") {
    const url = String(
      this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || ""
    ).trim();
    if (!url || this.avplayFallbackAttempts.has(url) || !this.canUseAvPlay()) {
      return false;
    }

    this.avplayFallbackAttempts.add(url);
    console.warn("Forcing AVPlay fallback:", { reason, url });
    this.play(url, {
      itemId: this.currentItemId,
      itemType: this.currentItemType || "movie",
      videoId: this.currentVideoId,
      season: this.currentSeason,
      episode: this.currentEpisode,
      requestHeaders: { ...(this.currentPlaybackHeaders || {}) },
      mediaSourceType: this.currentPlaybackMediaSourceType || null,
      forceEngine: this.getPlatformAvplayEngineName()
    });
    return true;
  },

  getAttemptedPlaybackEngines(url = this.currentPlaybackUrl) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return new Set();
    }
    return new Set(this.playbackEngineAttempts.get(normalizedUrl) || []);
  },

  rememberPlaybackEngineAttempt(url, engineName, { reset = false } = {}) {
    const normalizedUrl = String(url || "").trim();
    const normalizedEngine = String(engineName || "").trim();
    if (!normalizedUrl || !normalizedEngine) {
      return;
    }
    const nextSet = reset
      ? new Set()
      : new Set(this.playbackEngineAttempts.get(normalizedUrl) || []);
    nextSet.add(normalizedEngine);
    this.playbackEngineAttempts.set(normalizedUrl, nextSet);
  },

  clearPlaybackEngineAttempts(url = null) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      this.playbackEngineAttempts.clear();
      return;
    }
    this.playbackEngineAttempts.delete(normalizedUrl);
  },

  isLivePlaybackItemType(itemType = this.currentItemType) {
    const normalized = String(itemType || "")
      .trim()
      .toLowerCase();
    return (
      normalized === "channel" ||
      normalized === "live" ||
      normalized === "tvchannel" ||
      normalized === "stream"
    );
  },

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
      if (isTizenRuntime && canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
      }
      if (preferTvNative && canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
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
      if (!isTizenRuntime && canUseHlsJs) {
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
    if (isTizenRuntime && canUseAvPlay) {
      pushCandidate(candidates, avplayEngine);
    }
    pushCandidate(candidates, "native-file");
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
    return (
      candidates.find(
        (candidate) => candidate !== currentEngine && !attemptedEngines.has(candidate)
      ) || null
    );
  },

  isEngineFsPlaybackUrl(url = "") {
    try {
      const parsedUrl = new URL(String(url || ""));
      return /\/([0-9a-f]{40})\/\d+(?:\/|$)/i.test(parsedUrl.pathname);
    } catch (_) {
      return false;
    }
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
      mp4Hevc:
        supports('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"') ||
        supports('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"'),
      mp4HevcMain10:
        supports('video/mp4; codecs="hvc1.2.4.L153.B0,mp4a.40.2"') ||
        supports('video/mp4; codecs="hev1.2.4.L153.B0,mp4a.40.2"'),
      mp4Av1: supports('video/mp4; codecs="av01.0.08M.08,mp4a.40.2"'),
      webmVp9: supports('video/webm; codecs="vp9,opus"'),
      webm: supports("video/webm"),
      mkvH264:
        supports('video/x-matroska; codecs="avc1.4d401f,mp4a.40.2"') ||
        supports("video/x-matroska"),
      quicktime: supports("video/quicktime"),
      mpegTs: supports("video/mp2t"),
      audioAac: supports('audio/mp4; codecs="mp4a.40.2"'),
      audioMp3: supports("audio/mpeg"),
      audioFlac: supports("audio/flac"),
      audioAc3: supports('audio/mp4; codecs="ac-3"') || supports('audio/mp4; codecs="dac3"'),
      audioEac3: supports('audio/mp4; codecs="ec-3"') || supports('audio/mp4; codecs="dec3"'),
      dolbyVision:
        supports('video/mp4; codecs="dvh1.05.06,ec-3"') ||
        supports('video/mp4; codecs="dvhe.05.06,ec-3"')
    };
    capabilities.hdrLikely = capabilities.mp4HevcMain10 || capabilities.mp4Av1;
    capabilities.atmosLikely = capabilities.audioEac3;
    return capabilities;
  },

  teardownHlsInstance() {
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

  teardownAdaptiveInstances() {
    this.teardownHlsInstance();
    this.teardownDashInstance();
    if (!this.isUsingAvPlay()) {
      this.playbackEngine = "none";
    }
  },

  applyNativeSource(url, mimeType = null, engineName = "native-file") {
    const normalizedMimeType = this.normalizeMimeType(mimeType);
    const sourceMimeType =
      Platform.isWebOS() &&
      (this.isEngineFsPlaybackUrl(url) || normalizedMimeType === "video/x-matroska")
        ? null
        : mimeType;
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

  buildHlsConfig(requestHeaders = {}) {
    const forwardedHeaders = this.normalizePlaybackHeaders(requestHeaders);
    const isWebOs = Platform.isWebOS();
    return {
      autoStartLoad: false,
      enableWorker: !isWebOs,
      lowLatencyMode: false,
      backBufferLength: isWebOs ? 30 : 90,
      maxBufferLength: isWebOs ? 18 : 30,
      maxMaxBufferLength: isWebOs ? 24 : 60,
      maxBufferHole: 0.5,
      startFragPrefetch: false,
      fragLoadingTimeOut: isWebOs ? 18000 : 20000,
      manifestLoadingTimeOut: isWebOs ? 18000 : 20000,
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

  pickInitialHlsLevel(levels = []) {
    const candidates = Array.isArray(levels) ? levels : [];
    let selectedIndex = -1;
    let selectedScore = -1;
    candidates.forEach((level, index) => {
      const height = Number(level?.height || 0);
      const bitrate = Number(level?.bitrate || level?.attrs?.BANDWIDTH || 0);
      const score = height * 1000000000 + bitrate;
      if (score > selectedScore) {
        selectedScore = score;
        selectedIndex = index;
      }
    });
    return selectedIndex;
  },

  primeHlsInitialLevel(hls) {
    const initialLevel = this.pickInitialHlsLevel(hls?.levels);
    if (!Number.isFinite(initialLevel) || initialLevel < 0) {
      return -1;
    }
    try {
      hls.startLevel = initialLevel;
    } catch (_) {
      // Ignore unsupported hls.js builds.
    }
    try {
      hls.nextAutoLevel = initialLevel;
    } catch (_) {
      // Keep ABR enabled even if the hint is unsupported.
    }
    return initialLevel;
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

    hls.on(Hls.Events.ERROR, (_, data = {}) => {
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return;
      }
      if (!data?.fatal) {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (networkRecoveryAttempts >= 1) {
          this.lastPlaybackErrorCode = 2;
          this.teardownHlsInstance();
          this.emitVideoEvent("error", {
            playbackEngine: "hls.js",
            mediaErrorCode: 2,
            hlsErrorType: String(data.type || ""),
            hlsErrorDetails: String(data.details || "")
          });
          return;
        }
        try {
          networkRecoveryAttempts += 1;
          hls.startLoad();
          return;
        } catch (_) {
          // Fall through and destroy on unrecoverable load errors.
        }
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

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return;
      }
      this.primeHlsInitialLevel(hls);
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

  playWithDashJs(url, playToken = null) {
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
          fastSwitchEnabled: !isWebOs,
          lowLatencyEnabled: false,
          scheduleWhilePaused: false,
          bufferToKeep: isWebOs ? 8 : 20,
          bufferPruningInterval: isWebOs ? 10 : 20,
          stableBufferTime: isWebOs ? 8 : 12
        }
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
        const errorText = String(
          event?.error?.message || event?.event?.message || event?.message || ""
        ).toLowerCase();
        let mediaErrorCode = 4;
        if (
          errorText.includes("network") ||
          errorText.includes("download") ||
          errorText.includes("manifest")
        ) {
          mediaErrorCode = 2;
        } else if (
          errorText.includes("decode") ||
          errorText.includes("mediasource") ||
          errorText.includes("append")
        ) {
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
  },

  getSelectedDashAudioTrackIndex() {
    const current = this.dashInstance?.getCurrentTrackFor?.("audio");
    const tracks = this.getDashAudioTracks();
    if (!current || !tracks.length) {
      return -1;
    }
    const exactMatch = tracks.findIndex((track) => track.raw === current);
    if (exactMatch >= 0) {
      return exactMatch;
    }
    const currentId = String(current?.id ?? "");
    const currentLang = String(current?.lang ?? "");
    return tracks.findIndex(
      (track) =>
        String(track?.id ?? "") === currentId && String(track?.language ?? "") === currentLang
    );
  },

  setDashAudioTrack(index) {
    const targetIndex = Number(index);
    const tracks = this.getDashAudioTracks();
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }
    const target = tracks[targetIndex]?.raw || null;
    if (!target || typeof this.dashInstance?.setCurrentTrack !== "function") {
      return false;
    }
    try {
      this.dashInstance.setCurrentTrack(target);
      const currentTime = Number(this.video?.currentTime || 0);
      if (Number.isFinite(currentTime) && currentTime > 0) {
        this.video.currentTime = Math.max(0, currentTime - 0.001);
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    } catch (_) {
      return false;
    }
  },

  getDashTextTracks() {
    const tracks = this.dashInstance?.getTracksFor?.("text");
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks.filter(Boolean).map((track, index) => ({
      id: String(track?.id ?? `dash-text-${index}`),
      index,
      textTrackIndex: Number(track?.index),
      label: String(track?.labels?.[0]?.text || track?.lang || `Subtitle ${index + 1}`),
      language: String(track?.lang || ""),
      raw: track
    }));
  },

  getSelectedDashTextTrackIndex() {
    const current = this.dashInstance?.getCurrentTrackFor?.("text");
    const tracks = this.getDashTextTracks();
    if (!current || !tracks.length) {
      return -1;
    }
    const exactMatch = tracks.findIndex((track) => track.raw === current);
    if (exactMatch >= 0) {
      return exactMatch;
    }
    const currentId = String(current?.id ?? "");
    const currentLang = String(current?.lang ?? "");
    return tracks.findIndex(
      (track) =>
        String(track?.id ?? "") === currentId && String(track?.language ?? "") === currentLang
    );
  },

  setDashTextTrack(index) {
    const targetIndex = Number(index);
    const player = this.dashInstance;
    if (!player) {
      return false;
    }

    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      try {
        player.setTextTrack?.(-1);
      } catch (_) {
        // Ignore disable-text failures.
      }
      try {
        player.enableText?.(false);
      } catch (_) {
        // Ignore text disable fallback failures.
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    }

    const tracks = this.getDashTextTracks();
    if (targetIndex >= tracks.length) {
      return false;
    }

    const target = tracks[targetIndex] || null;
    try {
      player.enableText?.(true);
    } catch (_) {
      // Ignore text enable failures.
    }
    try {
      if (Number.isFinite(target?.textTrackIndex) && typeof player.setTextTrack === "function") {
        player.setTextTrack(target.textTrackIndex);
      } else if (target?.raw && typeof player.setCurrentTrack === "function") {
        player.setCurrentTrack(target.raw);
      } else {
        return false;
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    } catch (_) {
      return false;
    }
  },

  getHlsAudioTracks() {
    return hlsJsEngine.getAudioTracks(this.hlsInstance);
  },

  getSelectedHlsAudioTrackIndex() {
    return hlsJsEngine.getSelectedAudioTrackIndex(this.hlsInstance);
  },

  setHlsAudioTrack(index) {
    const applied = hlsJsEngine.setAudioTrack(this.hlsInstance, index);
    if (applied) {
      this.emitVideoEvent("hlstrackschanged", { playbackEngine: "hls.js" });
    }
    return applied;
  },

  getHlsSubtitleTracks() {
    return hlsJsEngine.getSubtitleTracks(this.hlsInstance);
  },

  getSelectedHlsSubtitleTrackIndex() {
    return hlsJsEngine.getSelectedSubtitleTrackIndex(this.hlsInstance);
  },

  setHlsSubtitleTrack(index) {
    const applied = hlsJsEngine.setSubtitleTrack(this.hlsInstance, index);
    if (applied) {
      this.emitVideoEvent("hlstrackschanged", { playbackEngine: "hls.js" });
    }
    return applied;
  },

  normalizePlaybackRate(speed = 1) {
    const targetSpeed = Number(speed || 1);
    if (!Number.isFinite(targetSpeed) || targetSpeed <= 0) {
      return NaN;
    }
    return targetSpeed;
  },

  getSupportedPlaybackRates() {
    if (Platform.isTizen() && this.isUsingAvPlay()) {
      return [1, 2];
    }
    return [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  },

  isSupportedAvPlayPlaybackRate(speed = 1) {
    const targetSpeed = this.normalizePlaybackRate(speed);
    if (!Number.isFinite(targetSpeed)) {
      return false;
    }
    return [1, 2, 4, 8, 16].includes(targetSpeed);
  },

  applyAvPlayPlaybackRate(speed = this.desiredPlaybackRate) {
    if (!this.isUsingAvPlay()) {
      return false;
    }
    const targetSpeed = this.normalizePlaybackRate(speed);
    if (!this.isSupportedAvPlayPlaybackRate(targetSpeed)) {
      return false;
    }
    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.setSpeed !== "function") {
      return false;
    }
    const state = this.getAvPlayState();
    if (!isValidAvPlayPlaybackSpeedState(state)) {
      return false;
    }
    try {
      avplay.setSpeed(targetSpeed);
      this.appliedAvPlayPlaybackRate = targetSpeed;
      logTizenAvPlayDebug("Tizen AVPlay setSpeed succeeded", {
        speed: targetSpeed,
        state
      });
      return true;
    } catch (error) {
      logTizenAvPlayDebug("Tizen AVPlay setSpeed failed", {
        speed: targetSpeed,
        state,
        error: error?.message || String(error || "")
      });
      return false;
    }
  },

  reapplyAvPlayPlaybackRate() {
    if (!this.isUsingAvPlay()) {
      return false;
    }
    const targetSpeed = this.normalizePlaybackRate(this.desiredPlaybackRate);
    if (!Number.isFinite(targetSpeed)) {
      return false;
    }
    return this.applyAvPlayPlaybackRate(targetSpeed);
  },

  getPlaybackRate() {
    const targetSpeed = this.normalizePlaybackRate(this.desiredPlaybackRate);
    if (Number.isFinite(targetSpeed)) {
      return targetSpeed;
    }
    return Number(this.video?.playbackRate || 1);
  },

  setPlaybackRate(speed = 1) {
    if (!this.video) {
      return false;
    }
    const targetSpeed = this.normalizePlaybackRate(speed);
    if (!Number.isFinite(targetSpeed)) {
      return false;
    }

    if (this.isUsingAvPlay()) {
      if (!this.isSupportedAvPlayPlaybackRate(targetSpeed)) {
        return false;
      }
      const state = this.getAvPlayState();
      if (isValidAvPlayPlaybackSpeedState(state) && !this.applyAvPlayPlaybackRate(targetSpeed)) {
        return false;
      }
      this.desiredPlaybackRate = targetSpeed;
      return true;
    }

    this.desiredPlaybackRate = targetSpeed;
    try {
      this.video.playbackRate = targetSpeed;
    } catch (_) {
      // webOS native playback can still accept the Luna play-rate command.
    }

    const mediaId = this.syncNativeMediaId();
    if (Platform.isWebOS() && mediaId) {
      this.requestWebOsMediaCommand("setPlayRate", {
        mediaId,
        playRate: targetSpeed,
        audioOutput: true
      }).catch(() => {
        // Keep the media-element playbackRate fallback.
      });
    }

    return true;
  },

  setNativeAudioTrack(index) {
    if (!this.video) {
      return false;
    }
    const targetIndex = Number(index);
    const tracks = this.nativeAudioTrackListToArray();
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }

    const applySelection = () => {
      tracks.forEach((track, trackIndex) => {
        const selected = trackIndex === targetIndex;
        try {
          if ("enabled" in track) {
            track.enabled = selected;
          }
        } catch (_) {
          // Best effort.
        }
        try {
          if ("selected" in track) {
            track.selected = selected;
          }
        } catch (_) {
          // Best effort.
        }
      });
    };

    if (Platform.isWebOS() && this.isUsingNativePlayback()) {
      return this.requestConfirmedWebOsAudioTrackSelection({
        targetTrackIndex: targetIndex,
        selectedTrackIndex: targetIndex,
        selectionKind: "native",
        applySelection
      });
    }

    this.selectedWebOsEmbeddedAudioTrackIndex = -1;
    applySelection();
    return true;
  },

  setWebOsEmbeddedAudioTrack(trackIndex, selectedTrackIndex = trackIndex) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return false;
    }

    const targetIndex = Number(trackIndex);
    const selectedIndex = Number(selectedTrackIndex);
    const storedSelectedIndex =
      Number.isFinite(selectedIndex) && selectedIndex >= 0 ? selectedIndex : targetIndex;
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      this.selectedWebOsEmbeddedAudioTrackIndex = -1;
      return false;
    }

    const applySelection = () => {
      const tracks = this.nativeAudioTrackListToArray();
      if (!tracks.length) {
        return;
      }

      tracks.forEach((track, trackListIndex) => {
        const selected = trackListIndex === targetIndex;
        try {
          if ("enabled" in track) {
            track.enabled = selected;
          }
        } catch (_) {
          // Best effort.
        }
        try {
          if ("selected" in track) {
            track.selected = selected;
          }
        } catch (_) {
          // Best effort.
        }
      });
    };

    return this.requestConfirmedWebOsAudioTrackSelection({
      targetTrackIndex: targetIndex,
      selectedTrackIndex: storedSelectedIndex,
      selectionKind: "embedded",
      applySelection
    });
  },

  setNativeTextTrack(index) {
    if (!this.video) {
      return false;
    }
    const targetIndex = Number(index);
    const textTrackList =
      this.video.textTracks || this.video.webkitTextTracks || this.video.mozTextTracks || null;
    let tracks = [];
    if (textTrackList) {
      try {
        tracks = Array.from(textTrackList).filter(Boolean);
      } catch (_) {
        const trackCount = Number(textTrackList.length || 0);
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          const track = textTrackList[trackIndex] || textTrackList.item?.(trackIndex) || null;
          if (track) {
            tracks.push(track);
          }
        }
      }
    }
    if (!Number.isFinite(targetIndex) || targetIndex < -1 || targetIndex >= tracks.length) {
      return false;
    }

    this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;

    const mediaId = this.syncNativeMediaId();
    if (mediaId && Platform.isWebOS()) {
      if (targetIndex < 0) {
        this.requestWebOsMediaCommand("setSubtitleEnable", {
          mediaId,
          enable: false
        }).catch(() => {
          // Ignore Luna subtitle disable failures and keep native toggles.
        });
      } else {
        this.requestWebOsMediaCommand("setSubtitleEnable", {
          mediaId,
          enable: true
        }).catch(() => {
          // Ignore Luna subtitle enable failures and keep native toggles.
        });
        this.applyWebOsSubtitleFontSize(mediaId, { force: true });
        setTimeout(() => {
          if (mediaId !== this.nativeMediaId) {
            return;
          }
          this.requestWebOsMediaCommand("selectTrack", {
            type: "text",
            mediaId,
            index: targetIndex
          }).catch(() => {
            // Ignore Luna subtitle track selection failures and keep native toggles.
          });
        }, 350);
      }
    }

    tracks.forEach((track, trackIndex) => {
      try {
        track.mode = targetIndex >= 0 && trackIndex === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort.
      }
    });

    return true;
  },

  applyWebOsSubtitleFontSize(mediaId, { force = false } = {}) {
    const normalizedMediaId = String(mediaId || "").trim();
    if (!Platform.isWebOS() || !normalizedMediaId) {
      return false;
    }

    const fontSize = Math.min(
      4,
      Math.max(0, Math.trunc(Number(this.webOsSubtitleFontSizeLevel) || 0))
    );
    const applyKey = `${normalizedMediaId}:${fontSize}`;
    if (!force && this.appliedWebOsSubtitleFontSizeKey === applyKey) {
      return true;
    }

    this.appliedWebOsSubtitleFontSizeKey = applyKey;
    this.requestWebOsMediaCommand("setSubtitleFontSize", {
      mediaId: normalizedMediaId,
      fontSize
    }).catch(() => {
      if (this.appliedWebOsSubtitleFontSizeKey === applyKey) {
        this.appliedWebOsSubtitleFontSizeKey = "";
      }
    });
    return true;
  },

  setWebOsSubtitleFontSize(value) {
    if (!Platform.isWebOS()) {
      return false;
    }

    this.webOsSubtitleFontSizeLevel = resolveWebOsSubtitleFontSizeLevel(value);
    const mediaId = this.syncNativeMediaId();
    if (mediaId) {
      return this.applyWebOsSubtitleFontSize(mediaId);
    }
    return true;
  },

  setWebOsEmbeddedSubtitleNativeVisibility(
    enabled,
    selectedTrackIndex = this.selectedWebOsEmbeddedSubtitleTrackIndex
  ) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return Promise.resolve(false);
    }
    const expectedSelectedIndex = Number(selectedTrackIndex);
    if (
      !Number.isFinite(expectedSelectedIndex) ||
      expectedSelectedIndex < 0 ||
      Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !== expectedSelectedIndex
    ) {
      return Promise.resolve(false);
    }

    const applyVisibility = (mediaId) => {
      if (
        !mediaId ||
        Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !== expectedSelectedIndex
      ) {
        return false;
      }
      return this.requestWebOsMediaCommand("setSubtitleEnable", {
        mediaId,
        enable: Boolean(enabled)
      })
        .then(() => true)
        .catch(() => false);
    };

    const mediaId = this.syncNativeMediaId();
    if (mediaId) {
      return Promise.resolve(applyVisibility(mediaId));
    }

    return this.waitForNativeMediaId()
      .then(applyVisibility)
      .catch(() => false);
  },

  setWebOsEmbeddedSubtitleTrack(trackIndex, selectedTrackIndex = trackIndex) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return false;
    }

    const targetIndex = Number(trackIndex);
    const selectedIndex = Number(selectedTrackIndex);
    const storedSelectedIndex =
      Number.isFinite(selectedIndex) && selectedIndex >= 0 ? selectedIndex : targetIndex;
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

    this.selectedWebOsEmbeddedSubtitleTrackIndex = targetIndex < 0 ? -1 : storedSelectedIndex;

    const mediaId = this.syncNativeMediaId();
    if (mediaId) {
      applySelection(mediaId);
      return true;
    }

    this.waitForNativeMediaId()
      .then((resolvedMediaId) => {
        if (
          Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !==
          (targetIndex < 0 ? -1 : storedSelectedIndex)
        ) {
          return;
        }
        applySelection(resolvedMediaId);
      })
      .catch(() => {
        // Ignore media-id lookup failures.
      });

    return true;
  },

  attemptVideoPlay({
    warningLabel = "Playback start rejected",
    onRejected = null,
    beforePlay = null,
    playToken = null
  } = {}) {
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
          console.warn(warningLabel, error);
          return null;
        });
      })
      .catch((error) => {
        if (this.isExpectedPlayInterruption(error)) {
          return;
        }
        this.isPlaying = false;
        console.warn(warningLabel, error);
      });
  },

  choosePlaybackEngine(url, sourceType, itemType = this.currentItemType) {
    if (Platform.isTizen() && this.canUseAvPlay()) {
      return this.getPlatformAvplayEngineName();
    }
    const candidates = this.getPlaybackEngineCandidates(url, sourceType, itemType);
    if (candidates.length) {
      return candidates[0];
    }
    if (this.canUseAvPlay()) {
      return this.getPlatformAvplayEngineName();
    }
    return "native-file";
  },

  async ensureAdaptiveLibrariesForSource(sourceType, playbackEngine = null) {
    const normalizedEngine = String(playbackEngine || "").trim();
    if (Platform.isTizen() && normalizedEngine !== "hls.js" && normalizedEngine !== "dash.js") {
      return;
    }
    const normalizedSourceType = String(sourceType || "").trim();
    if (!normalizedSourceType) {
      return;
    }
    if (
      this.isLikelyHlsMimeType(normalizedSourceType) ||
      this.isLikelyDashMimeType(normalizedSourceType)
    ) {
      await loadStreamingLibs();
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
      this.isPlaying = false;
      this.syncWebOsPlaybackKeepAwake();
      const context = this.createProgressContext();
      const durationMs = Math.floor(this.getDurationSeconds() * 1000);
      const completedMs =
        durationMs > 0 ? durationMs : Math.floor(this.getCurrentTimeSeconds() * 1000);
      this.flushProgress(completedMs, durationMs > 0 ? durationMs : completedMs, false, context);
    });

    this.video.addEventListener("error", (e) => {
      this.isPlaying = false;
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

    const syncNativeMediaId = () => {
      this.syncNativeMediaId();
    };
    this.video.addEventListener("loadedmetadata", syncNativeMediaId);
    this.video.addEventListener("loadeddata", syncNativeMediaId);
    this.video.addEventListener("canplay", syncNativeMediaId);
    this.video.addEventListener("playing", syncNativeMediaId);
    this.video.addEventListener("emptied", () => {
      this.resetNativeMediaState();
    });

    this.video.addEventListener("playing", () => {
      const audioTrackList =
        this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks;
      const audioTrackCount = Number(audioTrackList?.length || 0);
      const probeUrl = String(
        this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || ""
      ).trim();
      const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
      if (
        this.isUsingNativePlayback() &&
        isDirectFile &&
        audioTrackCount <= 0 &&
        Platform.isWebOS() &&
        this.canUseAvPlay()
      ) {
        this.forceAvPlayFallbackForCurrentSource("native_playing_no_audio_tracks");
      }
    });

    this.video.addEventListener("loadedmetadata", () => {
      const audioTrackList =
        this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks;
      const audioTrackCount = Number(audioTrackList?.length || 0);
      const probeUrl = String(
        this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || ""
      ).trim();
      const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
      if (
        this.isUsingNativePlayback() &&
        isDirectFile &&
        audioTrackCount <= 0 &&
        Platform.isWebOS() &&
        this.canUseAvPlay()
      ) {
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

  async play(
    url,
    {
      itemId = null,
      itemType = "movie",
      videoId = null,
      season = null,
      episode = null,
      title = null,
      poster = null,
      background = null,
      episodeTitle = null,
      requestHeaders = {},
      mediaSourceType = null,
      forceEngine = null,
      streamIdentity = null
    } = {}
  ) {
    if (!this.video) return;

    const requestedUrl = String(url || "").trim();
    const playToken = Number(this.playRequestToken || 0) + 1;
    this.playRequestToken = playToken;

    await this.flushCurrentProgress({ allowCloudSync: false });
    if (!this.isPlaybackRequestActive(playToken)) {
      return;
    }

    // Duration can temporarily regress while webOS tears down or restages its
    // native media pipeline. Keep the maximum duration for this playback only,
    // matching Android TV's lastKnownDuration contract.
    this.lastKnownDurationSeconds = 0;
    this.lastProgressSnapshot = null;
    this.playbackSessionActive = true;
    this.applyStartupAudioGateToVideo();

    this.currentItemId = itemId;
    this.currentItemType = itemType;
    this.currentVideoId = videoId;
    this.currentSeason = season == null ? null : Number(season);
    this.currentEpisode = episode == null ? null : Number(episode);
    this.currentItemTitle = title || null;
    this.currentItemPoster = poster || null;
    this.currentItemBackground = background || null;
    this.currentEpisodeTitle = episodeTitle || null;
    this.currentStreamIdentity = streamIdentity || null;
    this.currentPlaybackUrl = requestedUrl;
    this.currentPlaybackHeaders = { ...(requestHeaders || {}) };
    this.currentPlaybackMediaSourceType = this.resolveRuntimeSourceType(mediaSourceType);
    this.lastPlaybackErrorCode = 0;

    const sourceType =
      this.currentPlaybackMediaSourceType ||
      this.resolveRuntimeSourceType(this.guessMediaMimeType(url)) ||
      null;
    const preferredEngine = forceEngine || this.choosePlaybackEngine(url, sourceType, itemType);
    await this.ensureAdaptiveLibrariesForSource(sourceType, preferredEngine);
    if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
      return;
    }
    try {
      const parsedUrl = new URL(String(url || ""));
      const isEngineFsUrl = /\/([0-9a-f]{40})\/\d+(?:\/|$)/i.test(parsedUrl.pathname);
      if (isEngineFsUrl) {
        const host = parsedUrl.hostname;
        const baseUrlKind =
          host === "127.0.0.1" || host === "localhost" || host === "::1"
            ? "local-service"
            : "public-service";
        logEngineFsDebug("PlayerController: EngineFS playback selected", {
          baseUrlKind,
          playbackUrl: String(url || ""),
          declaredMediaSourceType: this.currentPlaybackMediaSourceType || null,
          chosenSourceType: sourceType || null,
          playbackEngine: preferredEngine,
          webOsLoadMode: Platform.isWebOS() ? "src-mediaid-load-play" : null
        });
      }
    } catch (_) {
      // ignore logging errors
    }
    this.rememberPlaybackEngineAttempt(this.currentPlaybackUrl, preferredEngine, {
      reset: !forceEngine
    });

    this.teardownAdaptiveInstances();
    this.teardownAvPlay();
    Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.resetNativeMediaState();
    const nativeFallbackEngine = this.isLikelyHlsMimeType(sourceType)
      ? "native-hls"
      : this.isLikelyDashMimeType(sourceType)
        ? "native-dash"
        : "native-file";

    if (preferredEngine === this.getPlatformAvplayEngineName()) {
      const avplayStarted = this.playWithAvPlay(url, requestHeaders, sourceType, playToken);
      if (!avplayStarted) {
        this.applyNativeSource(url, sourceType || null, nativeFallbackEngine);
        this.attemptVideoPlay({
          warningLabel: "Playback start rejected",
          playToken,
          beforePlay: () => this.waitForNativeMediaId(),
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay()) {
              return false;
            }
            const fallbackStarted = this.playWithAvPlay(url, requestHeaders, sourceType, playToken);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      }
    } else if (preferredEngine === "hls.js") {
      const hlsStarted = this.playWithHlsJs(url, requestHeaders, playToken);
      if (!hlsStarted) {
        this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl", "native-hls");
        this.attemptVideoPlay({
          warningLabel: "Playback start rejected",
          playToken,
          beforePlay: () => this.waitForNativeMediaId()
        });
      }
    } else if (preferredEngine === "dash.js") {
      const dashStarted = this.playWithDashJs(url, playToken);
      if (!dashStarted) {
        this.applyNativeSource(url, sourceType || "application/dash+xml", "native-dash");
      }
      this.attemptVideoPlay({
        warningLabel: "DASH playback start rejected",
        playToken,
        beforePlay: dashStarted ? null : () => this.waitForNativeMediaId()
      });
    } else if (preferredEngine === "native-hls") {
      this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl", "native-hls");
      this.attemptVideoPlay({
        warningLabel: "Native HLS playback start rejected",
        playToken,
        beforePlay: () => this.waitForNativeMediaId(),
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error)) {
            return false;
          }
          const fallbackStarted = this.playWithHlsJs(url, requestHeaders, playToken);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    } else if (preferredEngine === "native-dash") {
      this.applyNativeSource(url, sourceType || "application/dash+xml", "native-dash");
      this.attemptVideoPlay({
        warningLabel: "Native DASH playback start rejected",
        playToken,
        beforePlay: () => this.waitForNativeMediaId(),
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error) || !this.canUseDashJs()) {
            return false;
          }
          const fallbackStarted = this.playWithDashJs(url, playToken);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    } else {
      const isWebOsEngineFsPlayback = Platform.isWebOS() && this.isEngineFsPlaybackUrl(url);
      const isWebOsMatroskaPlayback =
        Platform.isWebOS() && this.normalizeMimeType(sourceType) === "video/x-matroska";
      const shouldStageWebOsNativePlayback = isWebOsEngineFsPlayback || isWebOsMatroskaPlayback;
      if (shouldStageWebOsNativePlayback) {
        // Match Stremio's webOS startup order: src -> mediaId -> load -> play.
        this.applyWebOsStagedNativeSource(url, "native-file");
        await this.prepareWebOsStagedNativePlayback(playToken, requestedUrl);
        if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
          return;
        }
      } else {
        this.applyNativeSource(url, sourceType || null, "native-file");
      }
      this.attemptVideoPlay({
        warningLabel: "Playback start rejected",
        playToken,
        beforePlay: shouldStageWebOsNativePlayback ? null : () => this.waitForNativeMediaId(),
        onRejected: (error) => {
          if (
            !this.isUnsupportedSourceError(error) ||
            !this.canUseAvPlay() ||
            !this.isLikelyDirectFileUrl(url)
          ) {
            return false;
          }
          const fallbackStarted = this.playWithAvPlay(url, requestHeaders, sourceType, playToken);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    }

    this.isPlaying = true;
    this.syncWebOsPlaybackKeepAwake();

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
    }

    this.progressSaveTimer = setInterval(() => {
      const context = this.createProgressContext();
      this.flushProgress(
        Math.floor(this.getCurrentTimeSeconds() * 1000),
        Math.floor(this.getDurationSeconds() * 1000),
        false,
        context
      );
    }, 5000);
  },

  pause() {
    if (!this.video) return;

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

    this.video.pause();
    this.isPlaying = false;
    this.syncWebOsPlaybackKeepAwake();
  },

  resume() {
    if (!this.video) return;

    this.flushCurrentProgress({ forceCloudSync: false });
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
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(
          error?.name || error?.message || error
        );
        console.warn("Playback resume rejected", error);
      }
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
    if (!this.video) return;

    this.playRequestToken = Number(this.playRequestToken || 0) + 1;
    this.setStartupPresentationAudioMuted(false);
    const flushPromise = flushProgress
      ? this.flushCurrentProgress({ forceCloudSync, allowCloudSync })
      : Promise.resolve(false);
    if (!this.playbackSessionActive) {
      this.syncWebOsPlaybackKeepAwake();
      if (this.progressSaveTimer) {
        clearInterval(this.progressSaveTimer);
        this.progressSaveTimer = null;
      }
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
    this.currentVideoId = null;
    this.currentSeason = null;
    this.currentEpisode = null;
    this.currentItemTitle = null;
    this.currentItemPoster = null;
    this.currentItemBackground = null;
    this.currentEpisodeTitle = null;
    this.currentStreamIdentity = null;
    this.currentPlaybackUrl = "";
    this.currentPlaybackHeaders = {};
    this.currentPlaybackMediaSourceType = null;
    this.lastKnownDurationSeconds = 0;
    this.playbackEngine = "none";
    this.lastPlaybackErrorCode = 0;
    this.clearPlaybackEngineAttempts();
    this.avplayFallbackAttempts.clear();

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
      this.progressSaveTimer = null;
    }

    return flushPromise;
  },

  createProgressContext() {
    return {
      itemId: this.currentItemId,
      itemType: this.currentItemType || "movie",
      videoId: this.currentVideoId || null,
      season: Number.isFinite(this.currentSeason) ? this.currentSeason : null,
      episode: Number.isFinite(this.currentEpisode) ? this.currentEpisode : null,
      title: this.currentItemTitle || null,
      poster: this.currentItemPoster || null,
      background: this.currentItemBackground || null,
      episodeTitle: this.currentEpisodeTitle || null,
      streamIdentity: this.currentStreamIdentity || null
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
      durationMs:
        Number.isFinite(safeDuration) && safeDuration > 0
          ? Math.max(0, Math.trunc(safeDuration))
          : 0,
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

  async flushCurrentProgress({ forceCloudSync = false, allowCloudSync = true } = {}) {
    const context = this.createProgressContext();
    if (!context.itemId) {
      return false;
    }

    const snapshot = this.getRecordedProgressSnapshot(context);
    const currentPositionMs = Math.floor(this.getCurrentTimeSeconds() * 1000);
    const currentDurationMs = Math.floor(this.getDurationSeconds() * 1000);
    const positionMs =
      Number.isFinite(currentPositionMs) && currentPositionMs > 0
        ? currentPositionMs
        : Number(snapshot?.positionMs || 0);
    const durationMs =
      Number.isFinite(currentDurationMs) && currentDurationMs > 0
        ? currentDurationMs
        : Number(snapshot?.durationMs || 0);

    await this.flushProgress(positionMs, durationMs, false, context, {
      allowCloudSync: allowCloudSync && !forceCloudSync
    });
    if (forceCloudSync) {
      await this.pushProgressIfDue(true);
    }
    return true;
  },

  async flushProgress(
    positionMs,
    durationMs,
    clear = false,
    context = null,
    { allowCloudSync = true } = {}
  ) {
    const active = context || this.createProgressContext();
    if (!active?.itemId) {
      return;
    }

    const safePosition = Number(positionMs || 0);
    const safeDuration = Number(durationMs || 0);
    const hasFiniteDuration = Number.isFinite(safeDuration) && safeDuration > 0;
    const hasReachedMinimumSyncPosition =
      Number.isFinite(safePosition) && safePosition >= MIN_PROGRESS_SYNC_DURATION_MS;
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

    if (isCompleted) {
      await watchedItemsRepository.mark({
        contentId: active.itemId,
        contentType: active.itemType || "movie",
        title: active.episodeTitle || active.title || active.itemId,
        season: active.season,
        episode: active.episode,
        watchedAt: Date.now()
      });
    }

    if (clear || isCompleted) {
      if (isCompleted) {
        await watchProgressRepository.saveProgress({
          contentId: active.itemId,
          contentType: active.itemType || "movie",
          videoId: active.videoId || null,
          season: active.season,
          episode: active.episode,
          title: active.title || null,
          poster: active.poster || null,
          background: active.background || null,
          logo: active.logo || null,
          episodeTitle: active.episodeTitle || null,
          positionMs: hasFiniteDuration
            ? Math.max(0, Math.trunc(safeDuration))
            : Math.max(0, Math.trunc(safePosition)),
          durationMs: hasFiniteDuration
            ? Math.max(0, Math.trunc(safeDuration))
            : Math.max(0, Math.trunc(safePosition))
        });
        if (watchedSeriesReconciliationService.isSeriesType(active.itemType)) {
          void watchedSeriesReconciliationService
            .reconcile(active.itemId, active.itemType, {
              title: active.title || active.itemId,
              completedEpisode: {
                season: active.season,
                episode: active.episode
              }
            })
            .catch((error) => {
              console.warn("Series watched reconciliation failed", error);
            });
        }
      } else {
        await watchProgressRepository.removeProgress(active.itemId, active.videoId || null);
      }
      if (!allowCloudSync) {
        return true;
      }
      return this.pushProgressIfDue(true);
    }

    if (!Number.isFinite(safePosition) || safePosition <= 0) {
      return false;
    }

    await watchProgressRepository.saveProgress({
      contentId: active.itemId,
      contentType: active.itemType || "movie",
      videoId: active.videoId || null,
      season: active.season,
      episode: active.episode,
      title: active.title || null,
      poster: active.poster || null,
      background: active.background || null,
      logo: active.logo || null,
      episodeTitle: active.episodeTitle || null,
      // Persist the stream identity so Continue Watching can resume the same
      // source instead of reopening the stream picker.
      streamIdentity: active.streamIdentity || null,
      positionMs: Math.max(0, Math.trunc(safePosition)),
      durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : 0
    });
    if (!allowCloudSync) {
      return true;
    }
    return this.pushProgressIfDue(false);
  },

  pushProgressIfDue(force = false) {
    const now = Date.now();
    if (!force && now - Number(this.lastProgressPushAt || 0) < 30000) {
      return Promise.resolve(false);
    }
    this.lastProgressPushAt = now;
    return WatchProgressSyncService.push().catch((error) => {
      console.warn("Watch progress auto push failed", error);
      return false;
    });
  }
};
