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

import {
  cleanDisplayText,
  t,
  UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS,
  UNSUPPORTED_EMBEDDED_SUBTITLE_CODEC_PATTERNS
} from "./playerScreenHelpers-02-language-code-aliases.js";
import {
  isSubRipSubtitleCodec,
  SUBTITLE_CODEC_DISPLAY_LABELS,
  isTx3gSubtitleTrack,
  normalizeTrackCodecText,
  getTrackMetadataStrings
} from "./playerScreenHelpers-03-normalize-web-os-html-subtitle-text.js";

export function formatSubtitleCodecLabel(value) {
  const raw = cleanDisplayText(value);
  if (!raw) {
    return "";
  }
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "text/utf8" || isSubRipSubtitleCodec(raw)) {
    return "SRT";
  }
  if (
    [
      "stext/ass",
      "stext/ssa",
      "text/ass",
      "text/ssa",
      "text/xass",
      "application/ass",
      "application/ssa",
      "application/xass",
      "text/xssa",
      "application/xssa",
      "ass",
      "ssa",
      "advancedsubstationalpha",
      "substationalpha"
    ].includes(normalized)
  ) {
    return "SSA";
  }
  if (["application/tx3g", "text/tx3g", "tx3g", "movtext", "mpeg4timedtext"].includes(normalized)) {
    return "TX3G";
  }
  return SUBTITLE_CODEC_DISPLAY_LABELS.get(normalized) || raw;
}

export function getSubtitleCodecDisplayLabel(track = {}) {
  return formatSubtitleCodecLabel(track?.codec || track?.codecs || track?.codec_name || track?.format);
}

export function getSubRipSubtitleCodecValue(track = {}) {
  return (
    track?.codec ||
    track?.subtitleCodec ||
    track?.codec_name ||
    track?.codecId ||
    track?.codec_id ||
    track?.format ||
    track?.raw?.codec ||
    track?.raw?.codec_name ||
    track?.raw?.codecId ||
    track?.raw?.codec_id ||
    track?.raw?.format ||
    ""
  );
}

export function isSubRipSubtitleTrack(track = {}) {
  return isSubRipSubtitleCodec(getSubRipSubtitleCodecValue(track));
}

export function getBitmapSubtitleFormatLabel(track = {}) {
  const format = getEmbeddedBitmapSubtitleFormat(track);
  if (format === "pgs") {
    return "PGS";
  }
  if (format === "vobsub") {
    return "VobSub";
  }
  return "bitmap";
}

export function isBitmapSubtitleSupportReason(reason = "") {
  return ["bitmap", "bitmap-runtime", "webos-bitmap", "webos-bitmap-runtime", "tizen-bitmap", "tizen-bitmap-runtime"].includes(reason);
}

export function getBitmapSubtitleSupportState(track = {}) {
  const format = getEmbeddedBitmapSubtitleFormat(track);
  if (!format || (!Environment.isWebOS() && !Environment.isTizen())) {
    return { supported: true, unsupportedReason: null };
  }
  // Tizen renders PGS through AVPlay. Only VobSub needs the local bitmap
  // decoder because AVPlay does not draw that embedded format.
  if (Environment.isTizen() && format !== "vobsub") {
    return { supported: true, unsupportedReason: null };
  }

  if (track?.supported === false && isBitmapSubtitleSupportReason(track?.unsupportedReason)) {
    return {
      supported: false,
      unsupportedReason: track.unsupportedReason
    };
  }

  if (!canUseEmbeddedBitmapSubtitles()) {
    return {
      supported: false,
      unsupportedReason: Environment.isTizen() ? "tizen-bitmap" : "webos-bitmap"
    };
  }
  return { supported: true, unsupportedReason: null };
}

export function getTx3gSubtitleSupportState(track = {}) {
  if (!isTx3gSubtitleTrack(track) || !Environment.isTizen()) {
    return { supported: true, unsupportedReason: null };
  }

  const capabilities = TizenCapabilities.get();
  if (
    (capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4) ||
    !capabilities.engineFsServicePackaged ||
    capabilities.webServiceSupported === false
  ) {
    return { supported: false, unsupportedReason: "tizen-tx3g" };
  }
  return { supported: true, unsupportedReason: null };
}

export function getEmbeddedSubtitleSupportState(track = {}) {
  const bitmapSupport = getBitmapSubtitleSupportState(track);
  if (bitmapSupport.supported === false) {
    return bitmapSupport;
  }
  if (isTx3gSubtitleTrack(track) && track?.supported === false) {
    return {
      supported: false,
      unsupportedReason: track?.unsupportedReason || "tx3g-runtime"
    };
  }
  return getTx3gSubtitleSupportState(track);
}

export function getTx3gSubtitleSupportMessage(reason = "") {
  return reason === "tx3g-runtime"
    ? t("player_subtitle_tizen_advanced_unavailable_short", {}, "Not fully supported on this TV")
    : t("settings_p2p_unsupported_subtitle", {}, "Not supported on this TV.");
}

export function getBitmapSubtitleSupportMessage() {
  return t("settings_p2p_unsupported_subtitle", {}, "Not supported on this TV.");
}

export function isBitmapSubtitleSupportError(error) {
  const errorText = [error?.code, error?.errorCode, error?.message, error?.errorText].filter(Boolean).join(" ").toLowerCase();
  return /unsupported|not supported|decoder|invalid[_ ](?:pgs|vobsub)|laced[_ ]bitmap/.test(errorText);
}

export function isTizenTx3gEmbeddedSubtitleTrack(track = {}) {
  return Environment.isTizen() && isTx3gSubtitleTrack(track);
}

export function isTizenSubRipEmbeddedSubtitleTrack(track = {}) {
  return Environment.isTizen() && isSubRipSubtitleTrack(track);
}

export function isTizenEmbeddedTextSubtitleFallbackTrack(track = {}) {
  return isTizenTx3gEmbeddedSubtitleTrack(track) || isTizenSubRipEmbeddedSubtitleTrack(track);
}

export function isAssSubtitleCodec(value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return false;
  }
  // Matroska codec id (S_TEXT/ASS|SSA), MIME aliases, and short codec names
  // (ass|ssa) reported by ffprobe / the companion tracks endpoint.
  return (
    /^S_TEXT\/(?:ASS|SSA)$/i.test(text) ||
    /^(?:text\/x-ass|application\/x-ass|text\/x-ssa|application\/x-ssa)$/i.test(text) ||
    /^(?:ass|ssa|advanced substation alpha|substation alpha)$/i.test(text)
  );
}

export function isEmbeddedTextSubtitleSourceTrack(track = {}) {
  const codec = cleanDisplayText(
    track?.codec || track?.subtitleCodec || track?.codec_name || track?.codecId || track?.codec_id || track?.format || ""
  );
  return /^S_TEXT\//i.test(codec) || /^TEXT\//i.test(codec) || isSubRipSubtitleCodec(codec) || isAssSubtitleCodec(codec);
}

export function isUnsupportedEmbeddedSubtitleTrack(track = {}) {
  const codecText = normalizeTrackCodecText(track?.codec || track?.subtitleCodec || track?.codec_name || track?.format || "");
  if (codecText && UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS.has(codecText)) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ");
  return UNSUPPORTED_EMBEDDED_SUBTITLE_CODEC_PATTERNS.some((pattern) => pattern.test(searchText));
}

export function getEmbeddedBitmapSubtitleFormat(track = {}) {
  const explicitFormat = normalizeBitmapSubtitleFormat(track?.bitmapSubtitleFormat);
  if (explicitFormat) {
    return explicitFormat;
  }
  const primaryFormat = normalizeBitmapSubtitleFormat(track?.codec || track?.subtitleCodec || track?.codec_name || track?.format || "");
  if (primaryFormat) {
    return primaryFormat;
  }
  return normalizeBitmapSubtitleFormat(getTrackMetadataStrings(track).join(" "));
}

let bitmapSubtitleDecodingSupport = null;

export function canUseEmbeddedBitmapSubtitles() {
  if (Environment.isTizen()) {
    const capabilities = TizenCapabilities.get();
    if ((capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4) || !capabilities.supportsWebService) {
      return false;
    }
  } else if (!Environment.isWebOS()) {
    return false;
  }
  if (bitmapSubtitleDecodingSupport !== true) {
    bitmapSubtitleDecodingSupport = supportsBitmapSubtitleDecoding();
  }
  return bitmapSubtitleDecodingSupport === true;
}

export function getWebOsAudioTrackCompatibilityText(track = {}) {
  return getAudioTrackCodecCompatibilityText(track, getTrackMetadataStrings(track).join(" "));
}

export function isUnsupportedWebOsAudioTrack(track = {}) {
  if (!Environment.isWebOS()) {
    return false;
  }
  if (typeof PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription !== "function") {
    return false;
  }
  return PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription(getWebOsAudioTrackCompatibilityText(track));
}

export function getAudioTrackSupportState(track = {}) {
  const supported = !isUnsupportedWebOsAudioTrack(track);
  return {
    supported,
    canTryAudioConversion: !supported && Environment.isWebOS() && /dts|true[\s_-]*hd/i.test(getWebOsAudioTrackCompatibilityText(track)),
    unsupportedReason: supported ? null : "codec"
  };
}
