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

import { escapeHtml, escapeAttribute } from "./playerScreenHelpers-08-track-list-to-array.js";
import {
  t,
  cleanDisplayText,
  SUBTITLE_LANGUAGE_UNKNOWN_KEY,
  SUBTITLE_LANGUAGE_OFF_KEY
} from "./playerScreenHelpers-02-language-code-aliases.js";
import { clamp } from "./playerScreenHelpers-07-detect-track-language-variant.js";
import {
  inferTrackLanguageCodeFromText,
  normalizeTrackLanguageCode,
  normalizeLanguageNameText,
  getTrackLanguageLabel
} from "./playerScreenHelpers-05-normalize-track-language-code.js";
import { AUDIO_TRACK_LANGUAGE_KEY_BY_CODE } from "./playerScreenHelpers-01-clock-formatter-cache.js";

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatBytesPerSecond(value) {
  const bytesPerSecond = Number(value || 0);
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "";
  }
  if (bytesPerSecond >= 1_048_576) {
    return `${(bytesPerSecond / 1_048_576).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1_024) {
    return `${Math.round(bytesPerSecond / 1_024)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}

export function normalizeStreamBadgeChipColor(value = "") {
  const hex = String(value || "")
    .trim()
    .replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    const cssColor = String(value || "").trim();
    return /^(transparent|rgba?\([\d\s,%.]+\))$/i.test(cssColor) ? cssColor : "";
  }
  if (hex.length === 6) {
    return `#${hex}`.toUpperCase();
  }
  const alpha = parseInt(hex.slice(0, 2), 16);
  const red = parseInt(hex.slice(2, 4), 16);
  const green = parseInt(hex.slice(4, 6), 16);
  const blue = parseInt(hex.slice(6, 8), 16);
  if (alpha >= 255) {
    return `#${hex.slice(2)}`.toUpperCase();
  }
  if (alpha <= 0) {
    return "transparent";
  }
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
}

export function renderPlayerImageBadgeChip(badge = {}) {
  const imageUrl = normalizeImageUrl(badge.imageURL);
  if (!imageUrl) {
    return "";
  }
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled =
    String(badge.tagStyle || "")
      .trim()
      .toLowerCase() === "filled";
  const style = [
    filled && backgroundColor ? `background:${backgroundColor};` : "",
    outlineColor ? `border-color:${outlineColor};` : "",
    textColor ? `color:${textColor};` : ""
  ].join("");
  return `
    <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
      <img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(badge.name || "")}" loading="lazy" decoding="async" />
    </span>
  `;
}

export function getPlayerSourceLogoDisplayUrl(value = "", onSettled = null) {
  const logoUrl = normalizeAddonLogoUrl(value);
  if (!logoUrl || hasFailedAddonLogo(logoUrl)) {
    return "";
  }
  const cachedLogoUrl = getCachedAddonLogoDisplayUrl(logoUrl);
  if (cachedLogoUrl) {
    return cachedLogoUrl;
  }
  void requestAddonLogo(logoUrl, onSettled);
  if (Environment.isWebOS()) {
    return "";
  }
  return logoUrl;
}

export function renderPlayerSourceBadges(stream = {}, badgeSettings = StreamBadgeSettingsStore.snapshot()) {
  const matchedBadges = matchStreamBadges(stream, badgeSettings.rules);
  const chips = [];
  const sizeBytes = stream.behaviorHints?.videoSize;
  if (badgeSettings.showFileSizeBadges !== false && sizeBytes != null) {
    const label = formatBytes(sizeBytes);
    if (label) {
      chips.push(`<span class="stream-route-stream-badge size">${escapeHtml(t("streams_size", [label], `SIZE ${label}`))}</span>`);
    }
  }
  matchedBadges.slice(0, 8).forEach((badge) => {
    const chip = renderPlayerImageBadgeChip(badge);
    if (chip) {
      chips.push(chip);
    }
  });
  return chips.length
    ? `<div class="stream-route-card-badges player-source-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${chips.join("")}</div>`
    : "";
}

export function resolvePlayerSourceBadgePlacement(badgeSettings = StreamBadgeSettingsStore.snapshot()) {
  return String(badgeSettings.badgePlacement || "BOTTOM")
    .trim()
    .toUpperCase() === "TOP"
    ? "TOP"
    : "BOTTOM";
}

export function formatSubtitleDelay(delayMs = 0) {
  const seconds = Number(delayMs || 0) / 1000;
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(3)}s`;
}

export function normalizeSubtitleFontSize(value = 120) {
  const parsed = Number(value ?? 120);
  if (!Number.isFinite(parsed)) {
    return 120;
  }
  return clamp(Math.round(parsed), 50, 200);
}

export function formatHtmlSubtitleFontSize(value = 120) {
  const scale = normalizeSubtitleFontSize(value) / 100;
  const documentRef = globalThis?.document;
  const viewportHeight = Number(
    globalThis?.innerHeight || documentRef?.documentElement?.clientHeight || documentRef?.body?.clientHeight || 0
  );
  const basePx = viewportHeight > 0 ? clamp(viewportHeight * 0.044, 30, 82) : 48;
  return `${Math.round(basePx * scale)}px`;
}

export function normalizeSubtitleLanguageKey(value) {
  const aliasCode = normalizeSubtitleLanguageAlias(value);
  const inferredCode = inferTrackLanguageCodeFromText(value);
  const normalizedCode = normalizeTrackLanguageCode(value);
  // Some providers expose `msa`/`ms` as the technical code while the human
  // label says Bahasa Indonesia. The text label wins for subtitle matching.
  const code = aliasCode || (normalizedCode?.split("-")[0] === "ms" && inferredCode === "id" ? "id" : normalizedCode || inferredCode);
  if (code) {
    return code;
  }
  const cleaned = cleanDisplayText(value);
  if (!normalizeLanguageNameText(cleaned)) {
    return SUBTITLE_LANGUAGE_UNKNOWN_KEY;
  }
  return cleaned ? cleaned.toLowerCase() : SUBTITLE_LANGUAGE_UNKNOWN_KEY;
}

export function extractSubtitleLanguageSetting(value, fallback = SUBTITLE_LANGUAGE_OFF_KEY) {
  if (value && typeof value === "object") {
    return extractSubtitleLanguageSetting(value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode, fallback);
  }
  const code = cleanDisplayText(value);
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

export function subtitleLanguageLabel(languageKey) {
  if (languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
    return t("subtitle_none", {}, "Off");
  }
  if (languageKey === SUBTITLE_LANGUAGE_UNKNOWN_KEY) {
    return t("common.unknown", {}, "Unknown");
  }
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const normalizedCode = normalizeTrackLanguageCode(languageKey);
  // Cantonese is `zh-ca` on OpenSubtitles; Intl would read "CA" as Canada.
  if (normalizedCode === "zh-ca") {
    return `${t("common.chinese", {}, "Chinese")} (${t("common.cantonese", {}, "Cantonese")})`;
  }
  if (normalizedCode === "sr-me") {
    try {
      if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
        const name = cleanDisplayText(new Intl.DisplayNames([locale], { type: "language" }).of("sr-ME"));
        if (name) {
          return `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)}`;
        }
      }
    } catch (_) {
      // Fall through to the stable English label.
    }
    return "Serbian (Montenegro)";
  }
  if (normalizedCode === "pt-br" || normalizedCode === "es-419") {
    try {
      if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
        const displayName = cleanDisplayText(new Intl.DisplayNames([locale], { type: "language" }).of(normalizedCode));
        if (displayName) {
          return `${displayName.charAt(0).toLocaleUpperCase(locale)}${displayName.slice(1)}`;
        }
      }
    } catch (_) {
      // Older TV engines use the stable English fallback below.
    }
    return normalizedCode === "pt-br" ? "Portuguese (Brazil)" : "Spanish (Latin America)";
  }
  const baseCode = normalizedCode?.split("-")[0] || "";
  let label = "";
  if (baseCode) {
    label = getTrackLanguageLabel({ language: baseCode });
  }
  if (!label) {
    label = getTrackLanguageLabel({ language: languageKey });
  }
  if (!label && baseCode) {
    const baseLabelKey = AUDIO_TRACK_LANGUAGE_KEY_BY_CODE[baseCode];
    label = baseLabelKey ? t(baseLabelKey, {}, baseCode.toUpperCase()) : baseCode.toUpperCase();
  }
  if (!label) {
    label = String(languageKey || "").toUpperCase();
  }
  return label ? `${label.charAt(0).toLocaleUpperCase(locale)}${label.slice(1)}` : "";
}
