import { PlayerController } from "../../../core/player/playerController.js";

import {
  audioTrackLabelConflictsWithCodec,
  formatAudioCodecName,
  getAuthoritativeAudioCodecValue,
  getAudioTrackCodecCompatibilityText,
  getAudioTrackLabelPrefix,
  mapAudioTrackNativeIndexes
} from "../../../core/player/audioTrackCodecMetadata.js";

import {
  canReleasePlayingNativeStartupAudioGate,
  hasOnlyImplicitStartupAudioOptions,
  selectStartupAudioFallbackOption,
  shouldAllowNativePlaybackDuringStartupAudioGate
} from "../../../core/player/startupAudioGatePolicy.js";

import {
  isRecoverableHlsFragmentTimeout,
  isExpiredStreamUrl,
  isTerminalHlsHttpStatus
} from "../../../core/player/hlsNetworkErrorPolicy.js";

import { deltaMsForKeyRepeat } from "../../../core/player/playerScrubRates.js";

import {
  ASPECT_MODE_DEFINITIONS,
  aspectModeIndex,
  normalizeAspectMode,
  parseAspectRatio,
  resolveAspectRender
} from "../../../core/player/playerAspect.js";

import { buildClockFormatOptions, resolveSystemHour12 } from "../../../core/player/clockFormat.js";

import { calculateRemainingPlaybackMilliseconds } from "../../../core/player/playbackEndTime.js";

import { resolveSubtitleStyleControlAvailability } from "../../../core/player/subtitlePresentationCapabilities.js";

import { shouldTreatAsNaturalPlaybackCompletion } from "../../../core/player/naturalPlaybackCompletion.js";

import { ensureWebOsImageProxyReady, normalizeImageUrl, onWebOsImageProxyReady } from "../../../core/media/imageProxy.js";

import {
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo,
  normalizeAddonLogoUrl,
  preloadAddonLogoImages,
  requestAddonLogo
} from "../../../core/media/addonLogoCache.js";

import { localMediaTracksRepository } from "../../../data/repository/localMediaTracksRepository.js";

import { localMediaSubtitleRepository } from "../../../data/repository/localMediaSubtitleRepository.js";

import { localMediaBitmapSubtitleRepository } from "../../../data/repository/localMediaBitmapSubtitleRepository.js";

import { localMediaEmbeddedSubtitleRepository } from "../../../data/repository/localMediaEmbeddedSubtitleRepository.js";

import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";

import { streamRepository } from "../../../data/repository/streamRepository.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { parentalGuideRepository } from "../../../data/repository/parentalGuideRepository.js";

import { skipIntroRepository } from "../../../data/repository/skipIntroRepository.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import { DeviceLocalPlayerPreferences } from "../../../data/local/deviceLocalPlayerPreferences.js";

import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";

import { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";

import { WebOsAudioCompatibilityStore } from "../../../data/local/webOsAudioCompatibilityStore.js";

import { matchStreamBadges } from "../../../core/streams/streamBadgeRules.js";

import { hasReleaseToken } from "../../../core/streams/releaseToken.js";

import { isAutoPlayEffectivelyEnabled, selectAutoPlayStream } from "../../../core/streams/streamAutoPlaySelector.js";

import { orderStreamsByAddonOrder } from "../../../core/streams/streamOrdering.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";

import { I18n } from "../../../i18n/index.js";

import { Environment } from "../../../platform/environment.js";

import { TizenCapabilities } from "../../../platform/tizen/tizenCapabilities.js";

import { Router } from "../../navigation/routerState.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";

import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";

import { TrackingScrobbleService } from "../../../data/repository/trackingScrobbleService.js";

import { WebOsEngineFsResolver } from "../../../core/p2p/webosEngineFsResolver.js";

import { TizenStreamingServerResolver } from "../../../core/p2p/tizenStreamingServerResolver.js";

import { TizenEngineFsService } from "../../../platform/tizen/tizenEngineFsService.js";

import { requestWebOsCompanionService, subscribeWebOsCompanionService } from "../../../platform/webos/webosCompanionService.js";

import { WebOsLunaService } from "../../../platform/webos/webosLunaService.js";

import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";

import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";

import { TrackPreferencesStore } from "../../../data/local/trackPreferencesStore.js";

import { SubtitleDelayPreferencesStore } from "../../../data/local/subtitleDelayPreferencesStore.js";

import {
  SUBTITLE_AUTO_SYNC_MARGIN_MS,
  SUBTITLE_AUTO_SYNC_MAX_VISIBLE_CUES,
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS,
  SUBTITLE_DELAY_OVERLAY_TIMEOUT_MS,
  SUBTITLE_DELAY_STEP_MS,
  calculateSubtitleAutoSyncDelayMs,
  formatSubtitleAutoSyncDelay,
  formatSubtitleAutoSyncTimestamp,
  sanitizeSubtitleAutoSyncCueText,
  selectSubtitleAutoSyncVisibleCues
} from "../../../core/player/subtitleAutoSync.js";

import { buildSubtitleRequestHeaders } from "../../../core/player/subtitleRequestHeaders.js";

import { normalizeSubtitleLanguageAlias } from "../../../core/player/subtitleLanguageAliases.js";

import { mdbListRatingIcon } from "../../../core/util/mdbListRatingStatus.js";

import {
  hasEpisodeAired as hasEpisodeAiredRule,
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCard as shouldShowNextEpisodeCardRule
} from "./playerNextEpisodeRules.js";

import {
  findActiveSkipInterval as findActiveSkipIntervalRule,
  findFollowingPostCreditsScene,
  getSkipIntervalTargetSeconds
} from "../../../core/player/skipIntervalRules.js";

import { normalizePlaybackDisplayLineBreaks, resolvePlaybackSourceName } from "./playbackDisplayText.js";

import { formatHeroRuntime } from "../detail/episodeCardMetadata.js";

import { localizedGenreLabel } from "../../../i18n/genreLabels.js";

import { contentTextDirection } from "../../../core/util/contentTextDirection.js";

import {
  buildInlineYoutubePlayerUrl,
  PostPlayRecommendationController,
  POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED
} from "./postPlayRecommendationController.js";

import { normalizePlayerEpisodeMetadata, resolvePostPlayEpisodeMetadataResolved } from "../../../core/player/playerEpisodeMetadata.js";

import {
  buildHtmlSubtitleCue,
  getSubtitleAssAlignment,
  getSubtitleAssAlignmentSettings,
  parseVttCueLayout
} from "../../../core/player/subtitleCueLayout.js";

import {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP,
  formatSubtitleVerticalOffset,
  getSubtitleVerticalOffsetVh,
  getSubtitleVerticalResidualOffsetVh,
  normalizeSubtitleVerticalOffset,
  splitSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";

import {
  SUBTITLE_TEXT_OPACITY_STEP,
  normalizeSubtitleTextOpacity,
  subtitleTextColorWithOpacity
} from "../../../core/player/subtitleTextOpacity.js";

import {
  BitmapSubtitleDecoder,
  normalizeBitmapSubtitleFormat,
  supportsBitmapSubtitleDecoding,
  warmBitmapSubtitleDecoder
} from "../../../core/player/bitmapSubtitleDecoder.js";

import { isAssSubtitle, convertAssBodyToVtt } from "../../../core/player/assSubtitle.js";

import { createAssRenderer } from "../../../core/player/assRenderer.js";

import { decodeSubtitleResponseBody } from "../../../core/player/subtitleCharsetDetector.js";

import { sanitizeSubtitleMojibake } from "../../../core/player/subtitleMojibakeSanitizer.js";

import {
  SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
  SUBTITLE_VIRTUALIZATION_MIN_WINDOW,
  SUBTITLE_VIRTUALIZATION_OVERSCAN_PX,
  SUBTITLE_VIRTUALIZATION_THRESHOLD,
  buildSubtitleVirtualModel,
  getSubtitleScrollTopForIndex,
  getSubtitleVirtualWindow
} from "./subtitleVirtualizer.js";

export const CLOCK_FORMATTER_CACHE = new Map();

export const LANGUAGE_DISPLAY_NAME_CACHE = new Map();

export const ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS = 1500;

export const STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS = 0.001;

export const BUFFERING_SPINNER_STALL_MS = 0;

export const LOADING_LOGO_FILL_TARGET_LERP = 0.22;

export const LOADING_LOGO_FILL_IDLE_STEP = 0.006;

export const LOADING_LOGO_FILL_FRAME_MS = 80;

export const NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS = 120000;

export const STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS = 6000;

export const STARTUP_AUDIO_PREFERENCE_RETRY_INTERVAL_MS = 250;

export const WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS = 30000;

export const WEBOS_NATIVE_STARTUP_LOADING_EXTENSION_MS = 120000;

export const WEBOS_HLS_REBUFFER_STALL_TIMEOUT_MS = 15000;

export const WEBOS_HLS_PLAYBACK_RECOVERY_MAX_ATTEMPTS = 2;

export const WEBOS_EMBEDDED_TEXT_SUBTITLE_MAX_TRANSIENT_FAILURES = 3;

export const TIZEN_NATIVE_HLS_STARTUP_STALL_TIMEOUT_MS = 22000;

export const PLAYBACK_ENGINE_VALIDATION_WINDOW_MS = 30000;

export const PLAYBACK_ENGINE_VALIDATION_MAX_PROGRESS_GAP_SECONDS = 15;

export const POST_VALIDATION_SAME_ENGINE_RECOVERY_MAX_ATTEMPTS = 1;

export const SOURCE_NAVIGATION_REPEAT_THROTTLE_MS = 112;

export const EPISODE_PANEL_TRANSITION_MS = 220;

export const activeEngineFsPlaybackClaims = new Map();

export const deferredEngineFsRemovalTimers = new Map();

export function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

export function isSelectKeyCode(keyCode) {
  return keyCode === 13 || keyCode === 23;
}

export function logEngineFsDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_ENGINEFS__) {
    console.info(...args);
  }
}

export function isLocalEngineFsUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(hostname);
  } catch (_) {
    return false;
  }
}

export function getP2pInfoHash(stream = {}) {
  const values = [
    stream?.infoHash,
    stream?.raw?.infoHash,
    stream?.clientResolve?.infoHash,
    stream?.raw?.clientResolve?.infoHash,
    stream?.torrentMagnetUri,
    stream?.magnetUri,
    stream?.url,
    stream?.externalUrl,
    stream?.raw?.url,
    stream?.raw?.externalUrl,
    stream?.raw?.clientResolve?.magnetUri
  ];
  for (const value of values) {
    const match = String(value || "").match(/(?:xt=urn:btih:)?([0-9a-f]{40})/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  return "";
}

export function buildPendingPlaybackRestore(params = {}) {
  if (params?.startFromBeginning) {
    return null;
  }
  const resumePositionMs = Number(params.resumePositionMs || 0);
  if (Number.isFinite(resumePositionMs) && resumePositionMs > 0) {
    return {
      timeSeconds: resumePositionMs / 1000,
      paused: false,
      attempts: 0,
      lastAttemptAt: 0
    };
  }
  const resumePercent = Number(params.resumeProgressPercent);
  if (Number.isFinite(resumePercent) && resumePercent > 0) {
    return {
      progressPercent: Math.max(0, Math.min(100, resumePercent)),
      durationSeconds: Number(params.resumeDurationMs || 0) > 0 ? Number(params.resumeDurationMs) / 1000 : 0,
      paused: false,
      attempts: 0,
      lastAttemptAt: 0
    };
  }
  return null;
}

export function getEngineFsClaimKey(state = null) {
  const infoHash = String(state?.infoHash || "")
    .trim()
    .toLowerCase();
  return infoHash || "";
}

export function createEngineFsClaimToken() {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function clearDeferredEngineFsRemoval(key = "") {
  const normalizedKey = String(key || "")
    .trim()
    .toLowerCase();
  const pending = normalizedKey ? deferredEngineFsRemovalTimers.get(normalizedKey) : null;
  if (!pending) {
    return false;
  }
  clearTimeout(pending.timer);
  deferredEngineFsRemovalTimers.delete(normalizedKey);
  pending.resolve?.(false);
  return true;
}

export function claimEngineFsPlayback(state = null) {
  const key = getEngineFsClaimKey(state);
  if (!key) {
    return "";
  }
  clearDeferredEngineFsRemoval(key);
  const token = createEngineFsClaimToken();
  activeEngineFsPlaybackClaims.set(key, token);
  return token;
}

export function releaseEngineFsPlaybackClaim(state = null, token = "") {
  const key = getEngineFsClaimKey(state);
  if (!key || !token) {
    return;
  }
  if (activeEngineFsPlaybackClaims.get(key) === token) {
    activeEngineFsPlaybackClaims.delete(key);
  }
}

export function hasActiveEngineFsPlaybackClaim(state = null) {
  const key = getEngineFsClaimKey(state);
  return Boolean(key && activeEngineFsPlaybackClaims.has(key));
}

export function scheduleDeferredEngineFsRemoval(state = null, reason = "cleanup", delayMs = 0, removeFn = null) {
  const key = getEngineFsClaimKey(state);
  const waitMs = Math.max(0, Number(delayMs || 0));
  if (!key || waitMs <= 0 || typeof removeFn !== "function") {
    return null;
  }
  clearDeferredEngineFsRemoval(key);
  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      const pending = deferredEngineFsRemovalTimers.get(key);
      if (!pending || pending.timer !== timer) {
        resolve(false);
        return;
      }
      deferredEngineFsRemovalTimers.delete(key);
      if (hasActiveEngineFsPlaybackClaim(state)) {
        logEngineFsDebug("EngineFS deferred torrent remove skipped; stream was reused", {
          reason,
          infoHash: state.infoHash,
          fileIdx: state.fileIdx
        });
        resolve(false);
        return;
      }
      resolve(await removeFn());
    }, waitMs);
    deferredEngineFsRemovalTimers.set(key, { timer, resolve });
  });
}

export const AUDIO_TRACK_LANGUAGE_KEY_BY_CODE = {
  ar: "common.arabic",
  de: "common.german",
  en: "common.english",
  es: "common.spanish",
  fi: "common.finnish",
  fr: "common.french",
  hi: "common.hindi",
  hu: "common.hungarian",
  it: "common.italian",
  ja: "common.japanese",
  ko: "common.korean",
  nl: "common.dutch",
  pl: "common.polish",
  pt: "common.portuguese",
  ro: "common.romanian",
  ru: "common.russian",
  sk: "common.slovak",
  sl: "common.slovenian",
  sv: "common.swedish",
  tr: "common.turkish",
  vi: "common.vietnamese",
  zh: "common.chinese"
};

export const LANGUAGE_DISPLAY_OVERRIDES = {
  id: "Indonesia",
  in: "Indonesia",
  ind: "Indonesia"
};
