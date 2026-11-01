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

import { t, cleanDisplayText } from "./playerScreenHelpers-02-language-code-aliases.js";

export function trackListToArray(trackList) {
  if (!trackList) {
    return [];
  }

  try {
    const iterableTracks = Array.from(trackList).filter(Boolean);
    if (iterableTracks.length) {
      return iterableTracks;
    }
  } catch (_) {
    // Some WebOS track lists are not iterable.
  }

  const length = Number(trackList.length || 0);
  if (Number.isFinite(length) && length > 0) {
    const indexedTracks = [];
    for (let index = 0; index < length; index += 1) {
      const track = trackList[index] || (typeof trackList.item === "function" ? trackList.item(index) : null);
      if (track) {
        indexedTracks.push(track);
      }
    }
    if (indexedTracks.length) {
      return indexedTracks;
    }
  }

  if (typeof trackList.item === "function") {
    const probedTracks = [];
    for (let index = 0; index < 32; index += 1) {
      const track = trackList.item(index);
      if (!track) {
        if (probedTracks.length) {
          break;
        }
        continue;
      }
      probedTracks.push(track);
    }
    if (probedTracks.length) {
      return probedTracks;
    }
  }

  const objectTracks = Object.keys(trackList)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => trackList[key])
    .filter(Boolean);
  return objectTracks;
}

export function normalizeItemType(value) {
  const normalized = String(value || "movie")
    .trim()
    .toLowerCase();
  return normalized || "movie";
}

export function isSeriesItemType(value) {
  return ["series", "tv", "show", "tvshow"].includes(normalizeItemType(value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isPlayerDomNodeAttached(node) {
  if (!node) {
    return false;
  }
  const documentRef = globalThis.document;
  if (typeof documentRef?.contains === "function") {
    try {
      // Some webOS DOM transitions can report isConnected=false for a node
      // that is still reachable from the live document. The document itself
      // is the more reliable attachment check for focus routing.
      return documentRef.contains(node);
    } catch (_) {
      // Fall through to the node-level check on runtimes with partial DOM APIs.
    }
  }
  return node.isConnected !== false;
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function postPlayFastOutSlowIn(progress) {
  const target = Math.max(0, Math.min(1, Number(progress) || 0));
  let low = 0;
  let high = 1;
  // Android's default tween easing is FastOutSlowIn (0.4, 0, 0.2, 1).
  // Solve the cubic-bezier x component so the native AVPlay rectangle follows
  // the same curve as the CSS/Compose player-surface transition.
  for (let index = 0; index < 12; index += 1) {
    const time = (low + high) / 2;
    const x = 3 * (1 - time) ** 2 * time * 0.4 + 3 * (1 - time) * time ** 2 * 0.2 + time ** 3;
    if (x < target) {
      low = time;
    } else {
      high = time;
    }
  }
  const time = (low + high) / 2;
  return 3 * (1 - time) * time ** 2 + time ** 3;
}

export function interpolatePostPlayRect(from = {}, to = {}, progress = 1) {
  const eased = postPlayFastOutSlowIn(progress);
  return {
    x: Math.round(Number(from.x || 0) + (Number(to.x || 0) - Number(from.x || 0)) * eased),
    y: Math.round(Number(from.y || 0) + (Number(to.y || 0) - Number(from.y || 0)) * eased),
    width: Math.max(1, Math.round(Number(from.width || 1) + (Number(to.width || 1) - Number(from.width || 1)) * eased)),
    height: Math.max(1, Math.round(Number(from.height || 1) + (Number(to.height || 1) - Number(from.height || 1)) * eased))
  };
}

export const POST_PLAY_LONG_PRESS_DELAY_MS = 500;

export function cleanPlaybackDiagnosticValue(value, maxLength = 320) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function pushPlaybackDiagnosticLine(lines, label, value, maxLength = 320) {
  const text = cleanPlaybackDiagnosticValue(value, maxLength);
  if (!text) {
    return;
  }
  const line = `${label}: ${text}`;
  if (!lines.includes(line)) {
    lines.push(line);
  }
}

export function extractPlaybackHttpStatus(value = "") {
  const text = String(value || "");
  if (!text) {
    return 0;
  }
  const patterns = [
    /\bhttp(?:\s+status|\s+code)?\s*[:=]?\s*([45]\d{2})\b/i,
    /\bstatus(?:\s+code)?\s*[:=]?\s*([45]\d{2})\b/i,
    /\bresponse(?:\s+code)?\s*[:=]?\s*([45]\d{2})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const status = Number(match?.[1] || 0);
    if (status >= 400 && status <= 599) {
      return status;
    }
  }
  if (/\bhttp\b/i.test(text)) {
    const match = text.match(/\b([45]\d{2})\b/);
    const status = Number(match?.[1] || 0);
    if (status >= 400 && status <= 599) {
      return status;
    }
  }
  return 0;
}

export function formatEpisodePanelDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const localDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const parsed =
    localDateMatch && !raw.includes("T")
      ? new Date(Number(localDateMatch[1]), Number(localDateMatch[2]) - 1, Number(localDateMatch[3]))
      : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  try {
    return parsed.toLocaleDateString(I18n.getLocale(), {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  } catch (_) {
    return localDateMatch ? `${localDateMatch[1]}-${localDateMatch[2]}-${localDateMatch[3]}` : raw;
  }
}

export function formatNextEpisodeAirDate(value = "") {
  const raw = String(value || "").trim();
  const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "";
  const dateLabel = formatEpisodePanelDate(raw) || formatEpisodePanelDate(datePortion);
  return dateLabel ? t("cw_airs_date", [dateLabel], "Airs %1$s") : t("next_episode_not_aired_yet", {}, "Next episode hasn't aired yet");
}

export function episodeDisplayCode(episode = {}) {
  const season = Number(episode?.season);
  const episodeNumber = Number(episode?.episode);
  if (!Number.isFinite(season) || !Number.isFinite(episodeNumber)) {
    return "";
  }
  return `S${season} E${episodeNumber}`;
}

export function episodeThumbnailUrl(episode = {}) {
  return cleanDisplayText(
    episode?.thumbnail || episode?.thumbnailUrl || episode?.still || episode?.stillUrl || episode?.poster || episode?.image || ""
  );
}
