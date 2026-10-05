import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchedSeriesReconciliationService } from "../../data/repository/watchedSeriesReconciliationService.js";
import {
  CloudLibraryPlaybackProgressStore,
  CloudLibraryPlaybackSessionStore,
  cloudPlaybackFileForSession
} from "../../data/local/cloudLibraryPlaybackStore.js";
import { Platform } from "../../platform/index.js";
import { TizenPlaybackProxy } from "../../platform/tizen/tizenPlaybackProxy.js";
import { WebOsPlaybackProxy } from "../../platform/webos/webosPlaybackProxy.js";
import { WatchProgressSyncService } from "../profile/watchProgressSyncService.js";
import { nativeVideoEngine } from "./engines/nativeVideoEngine.js";
import { hlsJsEngine } from "./engines/hlsJsEngine.js";
import { dashJsEngine } from "./engines/dashJsEngine.js";
import { resolvePlatformAvplayEngine } from "./engines/platformAvplayEngine.js";
import { isTerminalHlsHttpStatus } from "./hlsNetworkErrorPolicy.js";
import { isShortPlaceholderDuration } from "./naturalPlaybackCompletion.js";
import {
  applyWebOsAudioCodecOverrides,
  detectWebOsAudioCapabilities
} from "../../platform/webos/webosAudioCapabilities.js";
import { WebOsLunaService } from "../../platform/webos/webosLunaService.js";
import { subscribeWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";
import { WebOSPlayerExtensions } from "../../platform/webos/webosPlayerExtensions.js";
import { loadStreamingLibs } from "../../runtime/loadStreamingLibs.js";
import { WATCH_PROGRESS_UNKNOWN_DURATION_PERCENT } from "../../domain/model/watchProgress.js";
import { parseAspectRatio } from "./playerAspect.js";

import { createPlayerControllerMethods01 } from "./playerControllerMethods-01-is-expected-play-interruption.js";
import { createPlayerControllerMethods02 } from "./playerControllerMethods-02-is-likely-direct-file-url.js";
import { createPlayerControllerMethods03 } from "./playerControllerMethods-03-start-av-play-tick-timer.js";
import { createPlayerControllerMethods04 } from "./playerControllerMethods-04-sync-av-play-track-info.js";
import { createPlayerControllerMethods05 } from "./playerControllerMethods-05-get-av-play-subtitle-diagnostic-snapshot.js";
import { createPlayerControllerMethods06 } from "./playerControllerMethods-06-set-av-play-audio-track.js";
import { createPlayerControllerMethods07 } from "./playerControllerMethods-07-set-av-play-external-subtitle.js";
import { createPlayerControllerMethods08 } from "./playerControllerMethods-08-set-av-play-display-rect.js";
import { createPlayerControllerMethods09 } from "./playerControllerMethods-09-play-with-av-play.js";
import { createPlayerControllerMethods10 } from "./playerControllerMethods-10-seek-av-play-to.js";
import { createPlayerControllerMethods11 } from "./playerControllerMethods-11-get-av-play-diagnostic-snapshot.js";
import { createPlayerControllerMethods12 } from "./playerControllerMethods-12-get-playback-engine-candidates.js";
import { createPlayerControllerMethods13 } from "./playerControllerMethods-13-resolve-remote-media-source-type.js";
import { createPlayerControllerMethods14 } from "./playerControllerMethods-14-get-selected-dash-audio-track-index.js";
import { createPlayerControllerMethods15 } from "./playerControllerMethods-15-set-playback-rate.js";
import { createPlayerControllerMethods16 } from "./playerControllerMethods-16-set-web-os-embedded-subtitle-track.js";
import { createPlayerControllerMethods17 } from "./playerControllerMethods-17-save-progress-if-needed.js";
import { createPlayerControllerMethods18 } from "./playerControllerMethods-18-play.js";
import { createPlayerControllerMethods19 } from "./playerControllerMethods-19-pause.js";
import { createPlayerControllerMethods20 } from "./playerControllerMethods-20-flush-progress.js";

export {
  createPlayerControllerMethods01,
  createPlayerControllerMethods02,
  createPlayerControllerMethods03,
  createPlayerControllerMethods04,
  createPlayerControllerMethods05,
  createPlayerControllerMethods06,
  createPlayerControllerMethods07,
  createPlayerControllerMethods08,
  createPlayerControllerMethods09,
  createPlayerControllerMethods10,
  createPlayerControllerMethods11,
  createPlayerControllerMethods12,
  createPlayerControllerMethods13,
  createPlayerControllerMethods14,
  createPlayerControllerMethods15,
  createPlayerControllerMethods16,
  createPlayerControllerMethods17,
  createPlayerControllerMethods18,
  createPlayerControllerMethods19,
  createPlayerControllerMethods20
};
export {
  watchProgressRepository,
  watchedItemsRepository,
  watchedSeriesReconciliationService,
  CloudLibraryPlaybackProgressStore,
  CloudLibraryPlaybackSessionStore,
  cloudPlaybackFileForSession,
  Platform,
  TizenPlaybackProxy,
  WebOsPlaybackProxy,
  WatchProgressSyncService,
  nativeVideoEngine,
  hlsJsEngine,
  dashJsEngine,
  resolvePlatformAvplayEngine,
  isTerminalHlsHttpStatus,
  isShortPlaceholderDuration,
  applyWebOsAudioCodecOverrides,
  detectWebOsAudioCapabilities,
  WebOsLunaService,
  subscribeWebOsCompanionService,
  WebOSPlayerExtensions,
  loadStreamingLibs,
  WATCH_PROGRESS_UNKNOWN_DURATION_PERCENT,
  parseAspectRatio,
  MIN_PROGRESS_SYNC_DURATION_MS,
  WATCH_PROGRESS_SAVE_INTERVAL_MS,
  WATCH_PROGRESS_SAVE_THRESHOLD_MS,
  WEBOS_AUDIO_TRACK_SELECTION_TIMEOUT_MS,
  AVPLAY_BUFFER_FOR_PLAY_SECONDS,
  AVPLAY_BUFFER_FOR_RESUME_SECONDS,
  AVPLAY_BUFFERING_TIMEOUT_SECONDS,
  TIZEN_AVPLAY_DISPLAY_RECT_STATES,
  AVPLAY_SEEK_TIMEOUT_MS,
  WEBOS_LIVE_INITIAL_MANIFEST_SIZE,
  HLS_MAX_BUFFER_SECONDS,
  HLS_BACK_BUFFER_SECONDS,
  HLS_BUFFER_STALL_WARNING_DELAY_MS,
  TRANSIENT_HLS_BUFFER_ERROR_DETAILS,
  WEBOS_MEDIA_TYPE_PROBE_TIMEOUT_MS,
  logEngineFsDebug,
  logTizenAvPlayDebug,
  logWebOsPlaybackDebug,
  isValidAvPlayAudioTrackSelectionState,
  isValidAvPlaySubtitleTrackSelectionState,
  isValidAvPlayPlaybackSpeedState,
  normalizeAvPlaySubtitleRenderMode,
  isAbsoluteLocalAvPlaySubtitlePath,
  normalizeTizenAvPlayDisplayRect,
  syncTizenAvPlayObjectStyle,
  resolveWebOsSubtitleFontSizeLevel
};
const MIN_PROGRESS_SYNC_DURATION_MS = 1000;
const WATCH_PROGRESS_SAVE_INTERVAL_MS = 90_000;
const WATCH_PROGRESS_SAVE_THRESHOLD_MS = 5_000;
const WEBOS_AUDIO_TRACK_SELECTION_TIMEOUT_MS = 4000;
const AVPLAY_BUFFER_FOR_PLAY_SECONDS = 5;
const AVPLAY_BUFFER_FOR_RESUME_SECONDS = 4;
const AVPLAY_BUFFERING_TIMEOUT_SECONDS = 10;
const TIZEN_AVPLAY_DISPLAY_RECT_STATES = new Set(["IDLE", "READY", "PLAYING", "PAUSED"]);
// Tizen keeps Samsung's default 20-second buffering timeout; allow a short
// grace period for the seek callback before treating the native session as stuck.
const AVPLAY_SEEK_TIMEOUT_MS = 30_000;
// Keep webOS live HLS startup away from the moving playlist edge. This matches
// hls.js' default live sync distance and gives the first rendition enough data
// to establish a stable clock before playback begins.
const WEBOS_LIVE_INITIAL_MANIFEST_SIZE = 3;
// Keep the browser HLS buffer finite on TV runtimes. The forward cap limits
// memory use while the short back buffer avoids retaining already-played media.
const HLS_MAX_BUFFER_SECONDS = 50;
const HLS_BACK_BUFFER_SECONDS = 1.5;
// A short buffer starvation is expected on a slow provider. Only surface the
// diagnostic when the same playback stall remains continuous for one minute.
const HLS_BUFFER_STALL_WARNING_DELAY_MS = 60_000;
const TRANSIENT_HLS_BUFFER_ERROR_DETAILS = new Set(["bufferStalledError", "bufferNudgeOnStall"]);
const WEBOS_MEDIA_TYPE_PROBE_TIMEOUT_MS = 2_500;

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

function logWebOsPlaybackDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_WEBOS_PLAYBACK__ || globalThis.__NUVIO_DEBUG_ENGINEFS__) {
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

function normalizeTizenAvPlayDisplayRect(rect, viewport) {
  const viewportWidth = Math.max(1, Math.round(Number(viewport?.width || 1920)));
  const viewportHeight = Math.max(1, Math.round(Number(viewport?.height || 1080)));
  const rawWidth = Math.max(1, Math.round(Number(rect?.width || viewportWidth)));
  const rawHeight = Math.max(1, Math.round(Number(rect?.height || viewportHeight)));
  const width = Math.min(viewportWidth, rawWidth);
  const height = Math.min(viewportHeight, rawHeight);
  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(0, viewportHeight - height);
  const rawX = Math.round(Number(rect?.x || 0));
  const rawY = Math.round(Number(rect?.y || 0));

  return {
    x: Math.min(maxX, Math.max(0, rawX)),
    y: Math.min(maxY, Math.max(0, rawY)),
    width,
    height
  };
}

function syncTizenAvPlayObjectStyle(rect) {
  const object = globalThis.document?.getElementById?.("avPlayerObject");
  if (!object?.style || !rect) {
    return;
  }

  // Samsung renders AVPlay in the application/avplayer object, not in the
  // HTML video element. Keep the object CSS rectangle in lockstep with the
  // native display rectangle as required by the AVPlay API. Native coordinates
  // always use 1920x1080; the object style must use the actual CSS viewport.
  const cssWidth = Number(
    globalThis.window?.innerWidth || globalThis.document?.documentElement?.clientWidth || 1920
  );
  const cssHeight = Number(
    globalThis.window?.innerHeight || globalThis.document?.documentElement?.clientHeight || 1080
  );
  const scaleX = cssWidth / 1920;
  const scaleY = cssHeight / 1080;
  object.style.position = "fixed";
  object.style.left = `${rect.x * scaleX}px`;
  object.style.top = `${rect.y * scaleY}px`;
  object.style.right = "auto";
  object.style.bottom = "auto";
  object.style.width = `${rect.width * scaleX}px`;
  object.style.height = `${rect.height * scaleY}px`;
  object.style.maxWidth = "none";
  object.style.maxHeight = "none";
  object.style.transform = "none";
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
  currentImdbId: null,
  currentTmdbId: null,
  currentTraktId: null,
  currentVideoId: null,
  currentSeason: null,
  currentEpisode: null,
  currentCloudSessionToken: null,
  progressSaveTimer: null,
  progressSeekSyncTimer: null,
  lastSavedProgressPositionMs: 0,
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
  pendingAvPlaySubtitleReactivation: false,
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
  avplaySeekRequestToken: 0,
  avplaySeekInFlight: false,
  avplaySeekTimeoutTimer: null,
  avplayTrackSyncAt: 0,
  avplayBufferingProgress: null,
  avplayBufferingStartedAt: 0,
  avplayLastBufferingDurationMs: 0,
  avplayLastErrorDiagnostic: null,
  lastPlaybackErrorCode: 0,
  lastHlsErrorDiagnostic: null,
  hlsBufferStallWarningTimer: null,
  currentPlaybackUrl: "",
  currentPlaybackHeaders: {},
  currentPlaybackMediaSourceType: null,
  webOsPlaybackKeepAliveHandle: null,
  webOsPlaybackKeepAliveToken: "",
  webOsServiceKeepAliveHandle: null,
  webOsServiceKeepAliveToken: "",
  lastProgressSnapshot: null,
  lastKnownDurationSeconds: 0,
  avplayFallbackAttempts: new Set(),
  playbackEngineAttempts: new Map(),
  playRequestToken: 0,
  playbackSessionActive: false,
  nativeMediaId: "",
  nativeMediaIdLookupToken: 0,
  selectedWebOsAudioTrackIndex: -1,
  selectedWebOsSubtitleTrackIndex: -1,
  selectedWebOsEmbeddedAudioTrackIndex: -1,
  selectedWebOsEmbeddedSubtitleTrackIndex: -1,
  webOsAudioSelectionExplicit: false,
  webOsSubtitleSelectionExplicit: false,
  webOsAudioSelectionRequestToken: 0,
  webOsTrackReapplyMediaId: "",
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
  appliedWebOsPlaybackRate: 1,
  webOsPlaybackRateRequestToken: 0,
  webOsPlaybackRateCommandPromise: null,
  webOsPlaybackRateReapplyPromise: null,
  ...createPlayerControllerMethods01(),
  ...createPlayerControllerMethods02(),
  ...createPlayerControllerMethods03(),
  ...createPlayerControllerMethods04(),
  ...createPlayerControllerMethods05(),
  ...createPlayerControllerMethods06(),
  ...createPlayerControllerMethods07(),
  ...createPlayerControllerMethods08(),
  ...createPlayerControllerMethods09(),
  ...createPlayerControllerMethods10(),
  ...createPlayerControllerMethods11(),
  ...createPlayerControllerMethods12(),
  ...createPlayerControllerMethods13(),
  ...createPlayerControllerMethods14(),
  ...createPlayerControllerMethods15(),
  ...createPlayerControllerMethods16(),
  ...createPlayerControllerMethods17(),
  ...createPlayerControllerMethods18(),
  ...createPlayerControllerMethods19(),
  ...createPlayerControllerMethods20()
};
