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

export const LANGUAGE_CODE_ALIASES = {
  afr: "af",
  alb: "sq",
  amh: "am",
  ara: "ar",
  arm: "hy",
  aze: "az",
  baq: "eu",
  bel: "be",
  ben: "bn",
  bos: "bs",
  br: "pt-br",
  bul: "bg",
  bur: "my",
  cat: "ca",
  ces: "cs",
  chi: "zh",
  cym: "cy",
  cze: "cs",
  dan: "da",
  deu: "de",
  dut: "nl",
  ell: "el",
  eng: "en",
  est: "et",
  eus: "eu",
  fas: "fa",
  fil: "tl",
  fin: "fi",
  fra: "fr",
  fre: "fr",
  geo: "ka",
  ger: "de",
  gle: "ga",
  glg: "gl",
  gre: "el",
  guj: "gu",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  hun: "hu",
  hye: "hy",
  ice: "is",
  in: "id",
  ind: "id",
  isl: "is",
  ita: "it",
  iw: "he",
  jpn: "ja",
  kan: "kn",
  kat: "ka",
  kaz: "kk",
  khm: "km",
  kor: "ko",
  lao: "lo",
  lav: "lv",
  lit: "lt",
  mac: "mk",
  mal: "ml",
  mar: "mr",
  may: "ms",
  mkd: "mk",
  mlt: "mt",
  mon: "mn",
  msa: "ms",
  mya: "my",
  nep: "ne",
  nld: "nl",
  nor: "no",
  pan: "pa",
  pb: "pt-br",
  per: "fa",
  pob: "pt-br",
  pol: "pl",
  por: "pt",
  ptb: "pt-br",
  ron: "ro",
  rum: "ro",
  rus: "ru",
  sin: "si",
  slk: "sk",
  slo: "sk",
  slv: "sl",
  spa: "es",
  sqi: "sq",
  srp: "sr",
  swa: "sw",
  swe: "sv",
  tam: "ta",
  tel: "te",
  tgl: "tl",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  und: "",
  urd: "ur",
  uzb: "uz",
  vie: "vi",
  wel: "cy",
  zho: "zh",
  zul: "zu"
};

export const LANGUAGE_NAME_ALIASES = {
  arabic: "ar",
  arabo: "ar",
  "bahasa indonesia": "id",
  indonesia: "id",
  indonesian: "id",
  "bahasa malaysia": "ms",
  "bahasa melayu": "ms",
  chinese: "zh",
  cinese: "zh",
  deutsch: "de",
  dutch: "nl",
  english: "en",
  inglese: "en",
  finnish: "fi",
  suomi: "fi",
  french: "fr",
  francais: "fr",
  francese: "fr",
  german: "de",
  hindi: "hi",
  hungarian: "hu",
  italiano: "it",
  italian: "it",
  giapponese: "ja",
  japanese: "ja",
  korean: "ko",
  coreano: "ko",
  malay: "ms",
  malaysian: "ms",
  olandese: "nl",
  polish: "pl",
  polacco: "pl",
  brazilian: "pt-br",
  "brazilian portuguese": "pt-br",
  brasileiro: "pt-br",
  portuguese: "pt",
  "portuguese br": "pt-br",
  "portuguese brazil": "pt-br",
  "portuguese brazilian": "pt-br",
  "portuguese brasil": "pt-br",
  "portuguese brasileiro": "pt-br",
  "portuguese do brasil": "pt-br",
  "portugues brasil": "pt-br",
  "portugues do brasil": "pt-br",
  portoghese: "pt",
  romanian: "ro",
  rumeno: "ro",
  russian: "ru",
  russo: "ru",
  slovak: "sk",
  slovacco: "sk",
  slovenian: "sl",
  sloveno: "sl",
  spanish: "es",
  espanol: "es",
  spagnolo: "es",
  castellano: "es",
  swedish: "sv",
  svedese: "sv",
  tamil: "ta",
  telugu: "te",
  turkish: "tr",
  turco: "tr",
  vietnamese: "vi",
  vietnamita: "vi"
};

export const SUBTITLE_LANGUAGE_OFF_KEY = "__off__";

export const SUBTITLE_LANGUAGE_UNKNOWN_KEY = "__unknown__";

export const SUBTITLE_TEXT_COLORS = ["#FFFFFF", "#D9D9D9", "#FFD700", "#00E5FF", "#FF5C5C", "#00FF88"];

export const SUBTITLE_OUTLINE_COLORS = ["#000000", "#FFFFFF", "#00E5FF", "#FF5C5C"];

export const SUBTITLE_FONT_STEP = 10;

export const SUBTITLE_VERTICAL_OFFSET_STEP = SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP;

export const AUDIO_AMPLIFICATION_MIN_DB = 0;

export const AUDIO_AMPLIFICATION_MAX_DB = 10;

export const PLAYER_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const NEXT_EPISODE_PREFETCH_PERCENT = 0.9;

export const SKIP_INTERVAL_CHECK_MS = 250;

export const SKIP_INTERVAL_SEEK_SUPPRESSION_MS = 12000;

export const BITMAP_SUBTITLE_WINDOW_SECONDS = 120;

export const BITMAP_SUBTITLE_PREFETCH_SECONDS = 20;

export const BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS = 90;

export const EMBEDDED_TEXT_SUBTITLE_WINDOW_SECONDS = 120;

export const EMBEDDED_TEXT_SUBTITLE_PREFETCH_SECONDS = 20;

export const EMBEDDED_TEXT_SUBTITLE_WINDOW_BUCKET_SECONDS = 90;

export const PARENTAL_GUIDE_ROW_HEIGHT = 36;

export const PARENTAL_GUIDE_ROW_GAP = 4;

export const PAUSE_OVERLAY_DELAY_MS = 5000;

export const MAX_PAUSE_OVERLAY_CAST = 8;

export const UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS = new Set(["HDMV/PGS", "VOBSUB"]);

export const UNSUPPORTED_EMBEDDED_SUBTITLE_CODEC_PATTERNS = [
  /\b(hdmv[ /_-]*)?pgs\b/i,
  /\bpresentation graphic stream\b/i,
  /\bvob[ /_-]*sub\b/i,
  /\bdvd[ /_-]*sub(?:title)?\b/i
];

export const PARENTAL_GUIDE_CONTAINER_IN_MS = 300;

export const PARENTAL_GUIDE_LINE_IN_MS = 400;

export const PARENTAL_GUIDE_ITEM_STAGGER_MS = 80;

export const PARENTAL_GUIDE_ITEM_IN_MS = 200;

export const PARENTAL_GUIDE_HOLD_MS = 5000;

export const PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS = 60;

export const PARENTAL_GUIDE_ITEM_EXIT_MS = 150;

export const PARENTAL_GUIDE_LINE_OUT_DELAY_MS = 100;

export const PARENTAL_GUIDE_LINE_OUT_MS = 300;

export const PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS = 200;

export const PARENTAL_GUIDE_CONTAINER_OUT_MS = 200;

export const SKIP_INTRO_COUNTDOWN_MS = 10000;

export const SUBTITLE_VIRTUAL_ROW_GAP = 8;

export function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function buildIndexedLabel(baseLabel, index) {
  return `${baseLabel} ${index + 1}`;
}

export function subtitleLabel(index) {
  return buildIndexedLabel(t("subtitle_dialog_title", {}, "Subtitle"), index);
}

export function audioLabel(index) {
  return buildIndexedLabel(t("audio_dialog_title", {}, "Audio"), index);
}

export function cleanDisplayText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
