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
  getTrackLanguageValue,
  normalizeTrackLanguageCode,
  inferTrackLanguageCodeFromText,
  getMeaningfulTrackLabel,
  getUsableAudioTrackLanguageValue,
  getAudioTrackLanguageLabel
} from "./playerScreenHelpers-05-normalize-track-language-code.js";
import {
  getTrackMetadataStrings,
  capitalizeDisplayLabel,
  normalizeComparableText,
  pushUniqueText
} from "./playerScreenHelpers-03-normalize-web-os-html-subtitle-text.js";
import { cleanDisplayText, audioLabel } from "./playerScreenHelpers-02-language-code-aliases.js";
import { CLOCK_FORMATTER_CACHE } from "./playerScreenHelpers-01-clock-formatter-cache.js";

export function detectTrackLanguageVariant(track = {}, language = getTrackLanguageValue(track)) {
  const normalizedLanguage = normalizeTrackLanguageCode(language) || inferTrackLanguageCodeFromText(language);
  if (!normalizedLanguage) {
    return "";
  }
  if (
    normalizedLanguage === "pt-br" ||
    normalizedLanguage === "es-419" ||
    normalizedLanguage === "zh-ca" ||
    normalizedLanguage === "sr-me"
  ) {
    return normalizedLanguage;
  }
  const baseLanguage = normalizedLanguage.split("-")[0];
  const haystack = getTrackMetadataStrings(track)
    .concat([track?.trackId, track?.id])
    .map((value) => cleanDisplayText(value).toLowerCase())
    .join(" ");
  if (baseLanguage === "pt") {
    const hasBrazilian = ["pt-br", "pt_br", "pob", "brazilian", "brazil", "brasil", "brasileiro", " br", "(br)"].some((tag) =>
      haystack.includes(tag)
    );
    const hasEuropean = ["pt-pt", "pt_pt", "iberian", "european", "portugal", "europeu", " eu", "(eu)"].some((tag) =>
      haystack.includes(tag)
    );
    return hasBrazilian && !hasEuropean ? "pt-br" : "pt";
  }
  if (baseLanguage === "es") {
    const hasLatino = [
      "es-419",
      "es_419",
      "es-la",
      "es-lat",
      "latino",
      "latinoamerica",
      "latinoamericano",
      "latam",
      "lat am",
      "latin america"
    ].some((tag) => haystack.includes(tag));
    const hasCastilian = ["es-es", "es_es", "castilian", "castellano", "spain", "españa", "espana", "iberian"].some((tag) =>
      haystack.includes(tag)
    );
    return hasLatino && !hasCastilian ? "es-419" : "es";
  }
  return baseLanguage;
}

export function formatAudioChannelLayout(value) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    if (numericValue === 1) return "Mono";
    if (numericValue === 2) return "Stereo";
    if (numericValue === 6) return "5.1";
    if (numericValue === 8) return "7.1";
    return `${numericValue}ch`;
  }

  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("mono") || text === "1" || text === "1.0") return "Mono";
  if (text.includes("stereo") || text === "2" || text === "2.0") return "Stereo";
  if (text.includes("5.1") || text === "6") return "5.1";
  if (text.includes("7.1") || text === "8") return "7.1";
  const numericMatch = text.match(/\b(\d{1,2})(?:ch| channels?)\b/) || text.match(/^(\d{1,2})$/);
  if (!numericMatch) {
    return "";
  }
  const channels = Number(numericMatch[1]);
  if (!Number.isFinite(channels) || channels <= 0) {
    return "";
  }
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels}ch`;
}

function formatAudioChannelCount(value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return "";
  }
  const numericValue = Number(text);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return `${numericValue} ch`;
  }
  if (text === "Mono") return "1 ch";
  if (text === "Stereo") return "2 ch";
  if (text === "5.1") return "6 ch";
  if (text === "7.1") return "8 ch";
  const numericMatch = text.match(/^(\d{1,2})(?:\s*ch)?$/i);
  return numericMatch ? `${Number(numericMatch[1])} ch` : text;
}

export function formatAudioTrackDisplay(track = {}, index = 0) {
  const rawLabel = getMeaningfulTrackLabel(track);
  const rawLanguage = cleanDisplayText(getUsableAudioTrackLanguageValue(track));
  const languageLabel = capitalizeDisplayLabel(getAudioTrackLanguageLabel(track));
  const rawLanguageLabel = capitalizeDisplayLabel(rawLanguage);
  const authoritativeCodecValue = getAuthoritativeAudioCodecValue(track);
  const codecName = formatAudioCodecName(authoritativeCodecValue || getTrackMetadataStrings(track).join(" "));
  const channelLayout = formatAudioChannelLayout(track?.channelCount || track?.channels);
  const sampleRate = Number(track?.sampleRate || track?.audioSampleRate || 0);
  const labelConflictsWithCodec = audioTrackLabelConflictsWithCodec(rawLabel, authoritativeCodecValue);
  const labelPrefix = labelConflictsWithCodec ? getAudioTrackLabelPrefix(rawLabel) : "";
  const baseName = labelPrefix || (labelConflictsWithCodec ? "" : rawLabel) || languageLabel || rawLanguageLabel || audioLabel(index);
  const suffix = [codecName, channelLayout].filter(Boolean).join(" ");
  const label = suffix ? `${baseName} (${suffix})` : baseName;
  const secondaryParts = [];
  if (languageLabel && normalizeComparableText(languageLabel) !== normalizeComparableText(baseName)) {
    pushUniqueText(secondaryParts, languageLabel);
  }
  if (Number.isFinite(sampleRate) && sampleRate > 0) {
    pushUniqueText(secondaryParts, `${Math.round(sampleRate / 1000)} kHz`);
  }
  const secondary = secondaryParts.join(" | ");
  // Android's audio card keeps the language on its own line and the codec,
  // channel count and sample rate together on the metadata line.
  const metadataParts = [];
  pushUniqueText(metadataParts, codecName);
  pushUniqueText(metadataParts, formatAudioChannelCount(track?.channelCount || track?.channels));
  if (Number.isFinite(sampleRate) && sampleRate > 0) {
    pushUniqueText(metadataParts, `${Math.round(sampleRate / 1000)} kHz`);
  }

  return { label, secondary, languageText: languageLabel, metadata: metadataParts.join(" | ") };
}

export function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatClock(date = new Date(), webOsLocaleInfo = null) {
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const hour12 = resolveSystemHour12({
    tizenApi: typeof tizen !== "undefined" ? tizen : null,
    webOsLocaleInfo,
    intlApi: typeof Intl !== "undefined" ? Intl : null,
    locale
  });
  const localeKey = `${String(locale || "__default__")}:${String(hour12)}`;
  const options = buildClockFormatOptions(hour12);
  if (!CLOCK_FORMATTER_CACHE.has(localeKey)) {
    try {
      CLOCK_FORMATTER_CACHE.set(localeKey, new Intl.DateTimeFormat(locale || undefined, options));
    } catch (_) {
      CLOCK_FORMATTER_CACHE.set(localeKey, null);
    }
  }
  const formatter = CLOCK_FORMATTER_CACHE.get(localeKey);
  try {
    if (formatter?.format) {
      return formatter.format(date);
    }
    return date.toLocaleTimeString(locale || undefined, options);
  } catch (_) {
    return date.toLocaleTimeString(undefined, options);
  }
}

export function formatEndsAt(currentSeconds, durationSeconds, webOsLocaleInfo = null, playbackSpeed = 1) {
  const remainingMs = calculateRemainingPlaybackMilliseconds(currentSeconds, durationSeconds, playbackSpeed);
  if (remainingMs == null) {
    return "--:--";
  }
  const endDate = new Date(Date.now() + remainingMs);
  return formatClock(endDate, webOsLocaleInfo);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function hasExplicitSubtitleVerticalPosition(snapshot) {
  if (snapshot?.vertical) return true;
  const rawLine = snapshot?.line;
  if (rawLine == null || String(rawLine).trim().toLowerCase() === "auto") {
    return false;
  }
  const line = Number(rawLine);
  if (!Number.isFinite(line)) return false;
  // Android preserves top/middle placements, normalizing only bottom cues.
  return snapshot?.snapToLines === false ? line < 60 : line >= 0;
}
