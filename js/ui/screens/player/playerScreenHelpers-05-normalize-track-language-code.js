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

import { cleanDisplayText, LANGUAGE_CODE_ALIASES, LANGUAGE_NAME_ALIASES, t } from "./playerScreenHelpers-02-language-code-aliases.js";
import {
  normalizeComparableText,
  getTrackMetadataStrings,
  isGenericAudioTrackLabel,
  isGenericSubtitleTrackLabel
} from "./playerScreenHelpers-03-normalize-web-os-html-subtitle-text.js";
import { detectTrackLanguageVariant } from "./playerScreenHelpers-07-detect-track-language-variant.js";
import {
  LANGUAGE_DISPLAY_OVERRIDES,
  LANGUAGE_DISPLAY_NAME_CACHE,
  AUDIO_TRACK_LANGUAGE_KEY_BY_CODE
} from "./playerScreenHelpers-01-clock-formatter-cache.js";

export function normalizeTrackLanguageCode(value) {
  const raw = cleanDisplayText(value).toLowerCase();
  if (!raw || raw === "unknown") {
    return "";
  }
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(raw)) {
    return "";
  }
  const parts = raw.split(/[-_]/);
  const base = LANGUAGE_CODE_ALIASES[parts[0]] ?? parts[0];
  if (!base) {
    return "";
  }
  return [base, ...parts.slice(1)].join("-");
}

export function resolveRouteContentLanguage(params = {}) {
  return (
    [params?.contentLanguage, params?.originalLanguage, params?.original_language]
      .map((value) => normalizeTrackLanguageCode(value))
      .find(Boolean) || ""
  );
}

export function normalizeLanguageNameText(value) {
  const comparable = normalizeComparableText(value);
  const asciiComparable = typeof comparable.normalize === "function" ? comparable.normalize("NFD") : comparable;
  return asciiComparable
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(forced|force|forc|forzato|forzata|forzati|forzate|subtitle|subtitles|sub|sdh|cc|closed|captions?|full|normal|default|signs?|songs?|foreign|only)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function inferTrackLanguageCodeFromText(value) {
  const normalized = normalizeLanguageNameText(value);
  if (!normalized) {
    return "";
  }
  const padded = ` ${normalized} `;
  const aliasEntries = Object.entries(LANGUAGE_NAME_ALIASES).sort((left, right) => right[0].length - left[0].length);
  const match = aliasEntries.find(([name]) => padded.includes(` ${name} `));
  return match?.[1] || "";
}

export function inferUniqueTrackLanguageCodeFromText(value) {
  const normalized = normalizeLanguageNameText(value);
  if (!normalized) {
    return "";
  }
  const padded = ` ${normalized} `;
  const matchedCodes = new Set();
  Object.entries(LANGUAGE_NAME_ALIASES)
    .sort((left, right) => right[0].length - left[0].length)
    .forEach(([name, code]) => {
      if (padded.includes(` ${name} `)) {
        matchedCodes.add(code);
      }
    });
  if (matchedCodes.size === 1) {
    return Array.from(matchedCodes)[0];
  }
  // A regional alias also contains its generic language name (for example,
  // "Brazilian Portuguese" matches both pt-BR and pt). That is refinement,
  // not ambiguity: keep the single regional variant.
  const regionalCodes = Array.from(matchedCodes).filter((code) => code.includes("-"));
  if (
    regionalCodes.length === 1 &&
    Array.from(matchedCodes).every((code) => code === regionalCodes[0] || code === regionalCodes[0].split("-")[0])
  ) {
    return regionalCodes[0];
  }
  return "";
}

export function getTrackLanguageValue(track = {}) {
  const candidates = [track?.language, track?.lang, track?.track_lang, track?.extraInfo?.track_lang, track?.extraInfo?.language].map(
    (value) => cleanDisplayText(value)
  );
  const knownLanguage = candidates.find((value) => {
    const code = normalizeTrackLanguageCode(value) || inferTrackLanguageCodeFromText(value);
    const baseCode = String(code || "").split("-")[0];
    return Boolean(code) && !["und", "unk", "zxx"].includes(baseCode);
  });
  return knownLanguage || candidates.find((value) => value) || "";
}

export function isUnknownAudioTrackLanguageValue(value) {
  const normalized = cleanDisplayText(value).toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return false;
  }
  const normalizedCode = normalizeTrackLanguageCode(normalized);
  const baseCode = String(normalizedCode || "").split("-")[0];
  return ["und", "unk", "zxx"].includes(baseCode) || ["unknown", "unknown language", "undetermined", "undefined"].includes(normalized);
}

export function getUsableAudioTrackLanguageValue(track = {}) {
  const value = getTrackLanguageValue(track);
  return isUnknownAudioTrackLanguageValue(value) ? "" : value;
}

export function inferAudioTrackDisplayLanguageCode(track = {}, entry = {}) {
  const candidates = [track?.name, track?.label, track?.title, entry?.label];
  for (const candidate of candidates) {
    const inferredCode = inferUniqueTrackLanguageCodeFromText(candidate);
    if (inferredCode) {
      return inferredCode;
    }
  }
  return "";
}

export function inferAudioTrackLanguageKey(track = {}, entry = {}) {
  const explicit = detectTrackLanguageVariant(track, getUsableAudioTrackLanguageValue(track));
  const displayCode = inferAudioTrackDisplayLanguageCode(track, entry);
  if (displayCode) {
    if (!explicit) {
      return displayCode;
    }
    const explicitBase = explicit.split("-")[0];
    const displayBase = displayCode.split("-")[0];
    if (explicitBase === displayBase) {
      if (!explicit.includes("-") && displayCode.includes("-")) {
        return displayCode;
      }
      return explicit;
    }
    return explicit;
  }
  if (explicit) {
    return explicit;
  }

  const candidates = [track?.name, track?.label, track?.title, entry?.label, entry?.secondary, ...getTrackMetadataStrings(track)];
  for (const candidate of candidates) {
    const normalizedCode = normalizeTrackLanguageCode(candidate);
    if (normalizedCode && !isUnknownAudioTrackLanguageValue(normalizedCode)) {
      return normalizedCode;
    }
    const inferredCode = inferTrackLanguageCodeFromText(candidate);
    if (inferredCode) {
      return inferredCode;
    }
  }
  return "";
}

export function getAudioTrackLanguageLabel(track = {}, entry = {}) {
  const languageKey = inferAudioTrackLanguageKey(track, entry);
  return languageKey && !isUnknownAudioTrackLanguageValue(languageKey) ? getTrackLanguageLabel({ language: languageKey }) : "";
}

export function getTrackLanguageLabel(track = {}) {
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  if (!rawLanguage) {
    return "";
  }

  const normalizedCode = normalizeTrackLanguageCode(rawLanguage);
  const displayCode = normalizedCode ? normalizedCode.split("-")[0] : "";
  const displayOverride = LANGUAGE_DISPLAY_OVERRIDES[rawLanguage.toLowerCase()] || LANGUAGE_DISPLAY_OVERRIDES[displayCode];
  if (displayOverride) {
    return displayOverride;
  }
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : "en";
  if (displayCode) {
    const cacheKey = `${locale}::${displayCode}`;
    if (!LANGUAGE_DISPLAY_NAME_CACHE.has(cacheKey)) {
      let displayName = "";
      try {
        if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
          const formatter = new Intl.DisplayNames([locale], { type: "language" });
          displayName = cleanDisplayText(formatter.of(displayCode));
        }
      } catch (_) {
        displayName = "";
      }
      if (!displayName) {
        const fallbackKey = AUDIO_TRACK_LANGUAGE_KEY_BY_CODE[displayCode];
        displayName = fallbackKey ? t(fallbackKey, {}, rawLanguage.toUpperCase()) : rawLanguage.toUpperCase();
      }
      LANGUAGE_DISPLAY_NAME_CACHE.set(cacheKey, displayName);
    }
    return LANGUAGE_DISPLAY_NAME_CACHE.get(cacheKey) || "";
  }

  return rawLanguage;
}

export function getMeaningfulTrackLabel(track = {}) {
  const candidates = [track?.name, track?.label, track?.title];
  for (const candidate of candidates) {
    const text = cleanDisplayText(candidate);
    if (!text || isGenericAudioTrackLabel(text) || isGenericSubtitleTrackLabel(text)) {
      continue;
    }
    if (normalizeTrackLanguageCode(text)) {
      continue;
    }
    return text;
  }
  return "";
}

export function isTruthyTrackFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const text = cleanDisplayText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y";
}
