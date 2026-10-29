import { canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
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

import { streamMergeKey, mergeStreamItem } from "./playerScreenHelpers-10-format-subtitle-track-display.js";
import { t } from "./playerScreenHelpers-02-language-code-aliases.js";

export function flattenStreamGroups(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  const flattened = [];
  (streamResult.data || []).forEach((group) => {
    const addonName = group.addonName || "Addon";
    (group.streams || []).forEach((stream, index) => {
      const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
      const streamOrigin = {
        ...(group.streamOrigin || {}),
        ...(stream.streamOrigin || {}),
        kind:
          group.streamOrigin?.kind || stream.streamOrigin?.kind || (group.sourceProviderId || stream.sourceProviderId ? "plugin" : "addon"),
        addonId: stream.addonId || group.addonId || group.streamOrigin?.addonId || stream.streamOrigin?.addonId || null,
        addonBaseUrl:
          stream.addonBaseUrl || group.addonBaseUrl || group.streamOrigin?.addonBaseUrl || stream.streamOrigin?.addonBaseUrl || null,
        addonName: stream.addonName || group.addonName || group.streamOrigin?.addonName || stream.streamOrigin?.addonName || addonName,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null
      };
      const entry = {
        id:
          stream.id ||
          `${addonName}-${index}-${stream.url || stream.externalUrl || stream.ytId || stream.infoHash || resolve.infoHash || resolve.magnetUri || ""}`,
        label: stream.name || stream.title || `${addonName} stream`,
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || stream.name || "",
        addonId: stream.addonId || group.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
        addonName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null,
        streamOrigin,
        mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
        sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
        url: stream.url || stream.externalUrl || "",
        ytId: stream.ytId || null,
        infoHash: stream.infoHash || null,
        fileIdx: stream.fileIdx ?? null,
        engineFs: stream.engineFs || stream.raw?.engineFs || null,
        tizenP2p: stream.tizenP2p || stream.raw?.tizenP2p || null,
        externalUrl: stream.externalUrl || null,
        behaviorHints: stream.behaviorHints || null,
        sources: Array.isArray(stream.sources) ? stream.sources : [],
        quality: stream.quality || null,
        qualityValue: Number.isFinite(Number(stream.qualityValue)) ? Number(stream.qualityValue) : -1,
        clientResolve: stream.clientResolve || null,
        debridCacheStatus: stream.debridCacheStatus || null,
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
          ? Number(stream.addonOrderIndex)
          : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
        raw: stream
      };
      if (
        canResolveMediaServerStream(entry) ||
        DirectDebridResolver.shouldListStream(entry) ||
        WebOsEngineFsResolver.canResolveStream(entry) ||
        TizenStreamingServerResolver.canResolveStream(entry)
      ) {
        flattened.push(entry);
      }
    });
  });
  return flattened;
}

export function mergeStreamItems(existing = [], incoming = []) {
  const order = [];
  const byKey = new Map();
  const push = (item) => {
    const key = streamMergeKey(item);
    if (!key) {
      return;
    }
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, item);
      return;
    }
    byKey.set(key, mergeStreamItem(byKey.get(key), item));
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return order.map((key) => byKey.get(key));
}

export function normalizeParentalWarnings(source) {
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2,
    none: 99
  };

  if (Array.isArray(source)) {
    return source
      .map((entry) => ({
        label: String(entry?.label || "").trim(),
        severity: String(entry?.severity || "").trim()
      }))
      .filter((entry) => entry.label && entry.severity)
      .filter((entry) => entry.severity.toLowerCase() !== "none")
      .sort((left, right) => {
        const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
        const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
        return leftRank - rightRank;
      })
      .slice(0, 5);
  }

  const guide = source && typeof source === "object" ? source : null;
  if (!guide) {
    return [];
  }

  const labels = {
    nudity: "Nudity",
    violence: "Violence",
    profanity: "Profanity",
    alcohol: "Alcohol/Drugs",
    frightening: "Frightening"
  };

  return Object.entries(labels)
    .map(([key, label]) => {
      const severity = String(guide[key] || "").trim();
      if (!severity || severity.toLowerCase() === "none") {
        return null;
      }
      return { label, severity };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
      const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
      return leftRank - rightRank;
    })
    .slice(0, 5);
}

export function buildLocalizedParentalWarnings(guide = {}) {
  const labels = {
    nudity: t("parental_nudity", {}, "Nudity"),
    violence: t("parental_violence", {}, "Violence"),
    profanity: t("parental_profanity", {}, "Profanity"),
    alcohol: t("parental_alcohol", {}, "Alcohol/Drugs"),
    frightening: t("parental_frightening", {}, "Frightening")
  };
  const severityLabels = {
    severe: t("parental_severity_severe", {}, "Severe"),
    moderate: t("parental_severity_moderate", {}, "Moderate"),
    mild: t("parental_severity_mild", {}, "Mild")
  };
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2
  };
  return Object.entries(labels)
    .map(([key, label]) => ({
      label,
      severityKey: String(guide?.[key] || "")
        .trim()
        .toLowerCase()
    }))
    .filter((entry) => entry.severityKey && entry.severityKey !== "none")
    .sort((left, right) => (severityRank[left.severityKey] ?? 50) - (severityRank[right.severityKey] ?? 50))
    .map((entry) => ({
      label: entry.label,
      severity: severityLabels[entry.severityKey] || entry.severityKey
    }))
    .slice(0, 5);
}

export function normalizePlayableImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

export function normalizePlayableTmdbId(value = "") {
  const raw = String(value || "").trim();
  if (!raw || /^tt\d+$/i.test(raw)) {
    return 0;
  }
  const numeric = raw.replace(/^tmdb:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}

export function normalizePlayableTraktId(value = "") {
  const raw = String(value || "").trim();
  const numeric = raw.replace(/^trakt:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}
