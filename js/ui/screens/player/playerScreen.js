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
  selectStartupAudioFallbackOption
} from "../../../core/player/startupAudioGatePolicy.js";
import { resolveSubtitleStyleControlAvailability } from "../../../core/player/subtitlePresentationCapabilities.js";
import {
  ensureWebOsImageProxyReady,
  normalizeImageUrl,
  onWebOsImageProxyReady
} from "../../../core/media/imageProxy.js";
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
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { parentalGuideRepository } from "../../../data/repository/parentalGuideRepository.js";
import { skipIntroRepository } from "../../../data/repository/skipIntroRepository.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";
import { WebOsAudioCompatibilityStore } from "../../../data/local/webOsAudioCompatibilityStore.js";
import { matchStreamBadges } from "../../../core/streams/streamBadgeRules.js";
import { hasReleaseToken } from "../../../core/streams/releaseToken.js";
import { selectAutoPlayStream } from "../../../core/streams/streamAutoPlaySelector.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { I18n } from "../../../i18n/index.js";
import { Environment } from "../../../platform/environment.js";
import { Router } from "../../navigation/router.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import { TraktScrobbleService } from "../../../data/repository/traktScrobbleService.js";
import { WebOsEngineFsResolver } from "../../../core/p2p/webosEngineFsResolver.js";
import { TizenStreamingServerResolver } from "../../../core/p2p/tizenStreamingServerResolver.js";
import { TizenEngineFsService } from "../../../platform/tizen/tizenEngineFsService.js";
import { requestWebOsCompanionService, subscribeWebOsCompanionService } from "../../../platform/webos/webosCompanionService.js";
import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";
import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";
import { TrackPreferencesStore } from "../../../data/local/trackPreferencesStore.js";
import {
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCard as shouldShowNextEpisodeCardRule
} from "./playerNextEpisodeRules.js";
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
  normalizeSubtitleVerticalOffset,
  splitSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";
import {
  BitmapSubtitleDecoder,
  supportsBitmapSubtitleDecoding,
  warmBitmapSubtitleDecoder
} from "../../../core/player/bitmapSubtitleDecoder.js";

const CLOCK_FORMATTER_CACHE = new Map();
const LANGUAGE_DISPLAY_NAME_CACHE = new Map();
const ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS = 1500;
const STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS = 0.001;
const BUFFERING_SPINNER_STALL_MS = 0;
const LOADING_LOGO_FILL_TARGET_LERP = 0.22;
const LOADING_LOGO_FILL_IDLE_STEP = 0.006;
const LOADING_LOGO_FILL_FRAME_MS = 80;
const NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS = 45000;
const STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS = 6000;
const STARTUP_AUDIO_PREFERENCE_RETRY_INTERVAL_MS = 250;
const WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS = 30000;
const EPISODE_PANEL_TRANSITION_MS = 220;
const activeEngineFsPlaybackClaims = new Map();
const deferredEngineFsRemovalTimers = new Map();

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function isSelectKeyCode(keyCode) {
  return keyCode === 13 || keyCode === 23;
}

function logEngineFsDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_ENGINEFS__) {
    console.info(...args);
  }
}

function buildPendingPlaybackRestore(params = {}) {
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

function getEngineFsClaimKey(state = null) {
  const infoHash = String(state?.infoHash || "").trim().toLowerCase();
  return infoHash || "";
}

function createEngineFsClaimToken() {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function clearDeferredEngineFsRemoval(key = "") {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const pending = normalizedKey ? deferredEngineFsRemovalTimers.get(normalizedKey) : null;
  if (!pending) {
    return false;
  }
  clearTimeout(pending.timer);
  deferredEngineFsRemovalTimers.delete(normalizedKey);
  pending.resolve?.(false);
  return true;
}

function claimEngineFsPlayback(state = null) {
  const key = getEngineFsClaimKey(state);
  if (!key) {
    return "";
  }
  clearDeferredEngineFsRemoval(key);
  const token = createEngineFsClaimToken();
  activeEngineFsPlaybackClaims.set(key, token);
  return token;
}

function releaseEngineFsPlaybackClaim(state = null, token = "") {
  const key = getEngineFsClaimKey(state);
  if (!key || !token) {
    return;
  }
  if (activeEngineFsPlaybackClaims.get(key) === token) {
    activeEngineFsPlaybackClaims.delete(key);
  }
}

function hasActiveEngineFsPlaybackClaim(state = null) {
  const key = getEngineFsClaimKey(state);
  return Boolean(key && activeEngineFsPlaybackClaims.has(key));
}

function scheduleDeferredEngineFsRemoval(state = null, reason = "cleanup", delayMs = 0, removeFn = null) {
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

const AUDIO_TRACK_LANGUAGE_KEY_BY_CODE = {
  ar: "common.arabic",
  de: "common.german",
  en: "common.english",
  es: "common.spanish",
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
// Maps ISO 639-2 (bibliographic + terminologic) and a few legacy codes to
// the ISO 639-1 / app language ids, so subtitle and audio tracks labelled
// with 3-letter codes (common from OpenSubtitles and embedded tracks) match
// the preferred language and show the right language name.
const LANGUAGE_CODE_ALIASES = {
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
const LANGUAGE_NAME_ALIASES = {
  arabic: "ar",
  arabo: "ar",
  chinese: "zh",
  cinese: "zh",
  deutsch: "de",
  dutch: "nl",
  english: "en",
  inglese: "en",
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
const SUBTITLE_LANGUAGE_OFF_KEY = "__off__";
const SUBTITLE_LANGUAGE_UNKNOWN_KEY = "__unknown__";
const SUBTITLE_TEXT_COLORS = ["#FFFFFF", "#D9D9D9", "#FFD700", "#00E5FF", "#FF5C5C", "#00FF88"];
const SUBTITLE_OUTLINE_COLORS = ["#000000", "#FFFFFF", "#00E5FF", "#FF5C5C"];
const SUBTITLE_DELAY_MIN_MS = -60000;
const SUBTITLE_DELAY_MAX_MS = 60000;
const SUBTITLE_DELAY_STEP_MS = 100;
const SUBTITLE_FONT_STEP = 10;
const SUBTITLE_VERTICAL_OFFSET_STEP = SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP;
const AUDIO_AMPLIFICATION_MIN_DB = 0;
const AUDIO_AMPLIFICATION_MAX_DB = 10;
const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const NEXT_EPISODE_PREFETCH_PERCENT = 0.9;
const SKIP_INTERVAL_CHECK_MS = 250;
const SKIP_INTERVAL_SEEK_SUPPRESSION_MS = 12000;
const BITMAP_SUBTITLE_WINDOW_SECONDS = 120;
const BITMAP_SUBTITLE_PREFETCH_SECONDS = 20;
const BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS = 90;
const PARENTAL_GUIDE_ROW_HEIGHT = 36;
const PARENTAL_GUIDE_ROW_GAP = 4;
const PAUSE_OVERLAY_DELAY_MS = 5000;
const MAX_PAUSE_OVERLAY_CAST = 8;
const UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS = new Set(["HDMV/PGS", "VOBSUB"]);
const UNSUPPORTED_EMBEDDED_SUBTITLE_CODEC_PATTERNS = [
  /\b(hdmv[ /_-]*)?pgs\b/i,
  /\bpresentation graphic stream\b/i,
  /\bvob[ /_-]*sub\b/i,
  /\bdvd[ /_-]*sub(?:title)?\b/i
];
const PARENTAL_GUIDE_CONTAINER_IN_MS = 300;
const PARENTAL_GUIDE_LINE_IN_MS = 400;
const PARENTAL_GUIDE_ITEM_STAGGER_MS = 80;
const PARENTAL_GUIDE_ITEM_IN_MS = 200;
const PARENTAL_GUIDE_HOLD_MS = 5000;
const PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS = 60;
const PARENTAL_GUIDE_ITEM_EXIT_MS = 150;
const PARENTAL_GUIDE_LINE_OUT_DELAY_MS = 100;
const PARENTAL_GUIDE_LINE_OUT_MS = 300;
const PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS = 200;
const PARENTAL_GUIDE_CONTAINER_OUT_MS = 200;
const SKIP_INTRO_COUNTDOWN_MS = 10000;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function buildIndexedLabel(baseLabel, index) {
  return `${baseLabel} ${index + 1}`;
}

function subtitleLabel(index) {
  return buildIndexedLabel(t("subtitle_dialog_title", {}, "Subtitle"), index);
}

function audioLabel(index) {
  return buildIndexedLabel(t("audio_dialog_title", {}, "Audio"), index);
}

function cleanDisplayText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSubtitleRenderMode(value) {
  return String(value || "").trim().toLowerCase() === "html" ? "html" : "native";
}

function capitalizeDisplayLabel(value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return "";
  }
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  return `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;
}

function extractReleaseYear(value) {
  return String(value ?? "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
}

function normalizeComparableText(value) {
  return cleanDisplayText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function extractPauseOverlayCast(data = {}) {
  const result = [];
  const seen = new Set();
  const collections = [
    data?.castItems,
    data?.castMembers,
    data?.cast,
    data?.credits?.cast
  ];

  const pushEntry = (entry) => {
    if (!entry) {
      return;
    }
    const name = typeof entry === "string"
      ? cleanDisplayText(entry)
      : cleanDisplayText(entry?.name || entry?.fullName || entry?.actor || "");
    if (!name) {
      return;
    }
    const character = typeof entry === "string"
      ? ""
      : cleanDisplayText(entry?.character || entry?.role || "");
    const key = normalizeComparableText(`${name}|${character}`);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({ name, character });
  };

  collections.forEach((collection) => {
    if (!Array.isArray(collection)) {
      return;
    }
    collection.forEach(pushEntry);
  });

  return result.slice(0, MAX_PAUSE_OVERLAY_CAST);
}

function pushUniqueText(target, value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return;
  }
  const normalized = normalizeComparableText(text);
  if (target.some((entry) => normalizeComparableText(entry) === normalized)) {
    return;
  }
  target.push(text);
}

function flattenTrackMetadata(value, into = []) {
  if (value === null || value === undefined) {
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenTrackMetadata(entry, into));
    return into;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((entry) => flattenTrackMetadata(entry, into));
    return into;
  }
  const text = cleanDisplayText(value);
  if (text) {
    into.push(text);
  }
  return into;
}

function isGenericAudioTrackLabel(value) {
  const normalized = normalizeComparableText(value);
  return normalized === ""
    || /^audio\s*\d*$/.test(normalized)
    || /^track\s*\d*$/.test(normalized)
    || normalized === "soundhandler"
    || normalized === "sound handler";
}

function isGenericSubtitleTrackLabel(value) {
  const normalized = normalizeComparableText(value);
  return /^subtitles?\s*\d*$/.test(normalized)
    || /^text\s*\d*$/.test(normalized);
}

function getTrackMetadataStrings(track = {}) {
  const values = [];
  [
    track?.name,
    track?.label,
    track?.title,
    track?.language,
    track?.lang,
    track?.channels,
    track?.characteristics,
    track?.kind,
    track?.role,
    track?.accessibility,
    track?.forced,
    track?.isForced,
    track?.sdh,
    track?.isSdh,
    track?.is_sdh,
    track?.cc,
    track?.closedCaption,
    track?.closedCaptions,
    track?.closed_caption,
    track?.hearingImpaired,
    track?.hearing_impaired,
    track?.codec,
    track?.codecs,
    track?.audioCodec,
    track?.codecProfile,
    track?.profile,
    track?.codec_profile,
    track?.codec_id,
    track?.codec_name,
    track?.codec_tag_string,
    track?.mimeType,
    track?.mime_type,
    track?.sampleMimeType,
    track?.sample_mime_type,
    track?.format,
    track?.format_name,
    track?.format_long_name,
    track?.channelCount,
    track?.audioSampleRate,
    track?.sampleRate,
    track?.extraInfo,
    track?.attrs
  ].forEach((value) => flattenTrackMetadata(value, values));
  return values;
}

function normalizeTrackCodecText(value) {
  return cleanDisplayText(value)
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnsupportedEmbeddedSubtitleTrack(track = {}) {
  const codecText = normalizeTrackCodecText(track?.codec || track?.subtitleCodec || track?.codec_name || track?.format || "");
  if (codecText && UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS.has(codecText)) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ");
  return UNSUPPORTED_EMBEDDED_SUBTITLE_CODEC_PATTERNS.some((pattern) => pattern.test(searchText));
}

function isVobSubEmbeddedSubtitleTrack(track = {}) {
  const codecText = normalizeTrackCodecText(track?.codec || track?.subtitleCodec || track?.codec_name || track?.format || "");
  if (codecText === "VOBSUB" || codecText === "S VOBSUB") {
    return true;
  }
  return /\bvob[ /_-]*sub\b|\bdvd[ /_-]*sub(?:title)?\b/i.test(getTrackMetadataStrings(track).join(" "));
}

function canUseWebOsBitmapSubtitles() {
  return Environment.isWebOS() && supportsBitmapSubtitleDecoding();
}

function getWebOsAudioTrackCompatibilityText(track = {}) {
  return getAudioTrackCodecCompatibilityText(track, getTrackMetadataStrings(track).join(" "));
}

function isUnsupportedWebOsAudioTrack(track = {}) {
  if (!Environment.isWebOS()) {
    return false;
  }
  if (typeof PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription !== "function") {
    return false;
  }
  return PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription(
    getWebOsAudioTrackCompatibilityText(track)
  );
}

function getAudioTrackSupportState(track = {}) {
  const supported = !isUnsupportedWebOsAudioTrack(track);
  return {
    supported,
    unsupportedReason: supported ? null : "codec"
  };
}

function normalizeTrackLanguageCode(value) {
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

function resolveRouteContentLanguage(params = {}) {
  return [
    params?.contentLanguage,
    params?.originalLanguage,
    params?.original_language
  ]
    .map((value) => normalizeTrackLanguageCode(value))
    .find(Boolean) || "";
}

function normalizeLanguageNameText(value) {
  const comparable = normalizeComparableText(value);
  const asciiComparable = typeof comparable.normalize === "function"
    ? comparable.normalize("NFD")
    : comparable;
  return asciiComparable
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(forced|force|forc|forzato|forzata|forzati|forzate|subtitle|subtitles|sub|sdh|cc|closed|captions?|full|normal|default|signs?|songs?|foreign|only)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTrackLanguageCodeFromText(value) {
  const normalized = normalizeLanguageNameText(value);
  if (!normalized) {
    return "";
  }
  const padded = ` ${normalized} `;
  const aliasEntries = Object.entries(LANGUAGE_NAME_ALIASES)
    .sort((left, right) => right[0].length - left[0].length);
  const match = aliasEntries.find(([name]) => padded.includes(` ${name} `));
  return match?.[1] || "";
}

function inferUniqueTrackLanguageCodeFromText(value) {
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
    regionalCodes.length === 1
    && Array.from(matchedCodes).every((code) => (
      code === regionalCodes[0] || code === regionalCodes[0].split("-")[0]
    ))
  ) {
    return regionalCodes[0];
  }
  return "";
}

function getTrackLanguageValue(track = {}) {
  const candidates = [
    track?.language,
    track?.lang,
    track?.track_lang,
    track?.extraInfo?.track_lang,
    track?.extraInfo?.language
  ].map((value) => cleanDisplayText(value));
  const knownLanguage = candidates.find((value) => {
    const code = normalizeTrackLanguageCode(value) || inferTrackLanguageCodeFromText(value);
    const baseCode = String(code || "").split("-")[0];
    return Boolean(code) && !["und", "unk", "zxx"].includes(baseCode);
  });
  return knownLanguage || candidates.find((value) => value) || "";
}

function inferAudioTrackDisplayLanguageCode(track = {}, entry = {}) {
  const candidates = [
    track?.name,
    track?.label,
    track?.title,
    entry?.label
  ];
  for (const candidate of candidates) {
    const inferredCode = inferUniqueTrackLanguageCodeFromText(candidate);
    if (inferredCode) {
      return inferredCode;
    }
  }
  return "";
}

function inferAudioTrackLanguageKey(track = {}, entry = {}) {
  const explicit = detectTrackLanguageVariant(track, getTrackLanguageValue(track));
  const displayCode = inferAudioTrackDisplayLanguageCode(track, entry);
  if (
    displayCode
    && (
      !explicit
      || explicit.split("-")[0] !== displayCode.split("-")[0]
      || (!explicit.includes("-") && displayCode.includes("-"))
    )
  ) {
    return displayCode;
  }
  if (explicit) {
    return explicit;
  }
  if (displayCode) {
    return displayCode;
  }

  const candidates = [
    track?.name,
    track?.label,
    track?.title,
    entry?.label,
    entry?.secondary,
    ...getTrackMetadataStrings(track)
  ];
  for (const candidate of candidates) {
    const normalizedCode = normalizeTrackLanguageCode(candidate);
    if (normalizedCode) {
      return normalizedCode;
    }
    const inferredCode = inferTrackLanguageCodeFromText(candidate);
    if (inferredCode) {
      return inferredCode;
    }
  }
  return "";
}

function getAudioTrackLanguageLabel(track = {}, entry = {}) {
  const languageKey = inferAudioTrackLanguageKey(track, entry);
  return languageKey ? getTrackLanguageLabel({ language: languageKey }) : "";
}

function getTrackLanguageLabel(track = {}) {
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  if (!rawLanguage) {
    return "";
  }

  const normalizedCode = normalizeTrackLanguageCode(rawLanguage);
  const displayCode = normalizedCode ? normalizedCode.split("-")[0] : "";
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

function getMeaningfulTrackLabel(track = {}) {
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

function isTruthyTrackFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const text = cleanDisplayText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y";
}

function getTrackFlagCandidates(track = {}, keys = []) {
  const values = [];
  const pushFrom = (source) => {
    if (!source || typeof source !== "object") {
      return;
    }
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        values.push(source[key]);
      }
    });
  };

  pushFrom(track);
  pushFrom(track?.extraInfo);
  pushFrom(track?.attrs);
  pushFrom(track?.tags);
  pushFrom(track?.disposition);
  pushFrom(track?.raw);
  pushFrom(track?.raw?.extraInfo);
  pushFrom(track?.raw?.attrs);
  pushFrom(track?.raw?.tags);
  pushFrom(track?.raw?.disposition);
  return values;
}

function hasTruthyTrackFlag(track = {}, keys = []) {
  return getTrackFlagCandidates(track, keys).some((value) => isTruthyTrackFlag(value));
}

function isSdhSubtitleTrack(track = {}) {
  if (isTruthyTrackFlag(track?.sdh)
    || isTruthyTrackFlag(track?.isSdh)
    || isTruthyTrackFlag(track?.is_sdh)
    || isTruthyTrackFlag(track?.hearingImpaired)
    || isTruthyTrackFlag(track?.hearing_impaired)) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ").toLowerCase();
  return /\b(sdh|hearing impaired|hearing-impaired|hard of hearing|hoh)\b/.test(searchText);
}

function isClosedCaptionTrack(track = {}) {
  if (isTruthyTrackFlag(track?.cc)
    || isTruthyTrackFlag(track?.closedCaption)
    || isTruthyTrackFlag(track?.closedCaptions)
    || isTruthyTrackFlag(track?.closed_caption)) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ").toLowerCase();
  return /\b(cc|closed captions?|closed-caption(?:ed)?|captioned)\b/.test(searchText);
}

function detectChannelLayout(value) {
  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }
  const explicitLayout = text.match(/\b(7\.1|5\.1|2\.1|2\.0|1\.0)\b/);
  if (explicitLayout) {
    if (explicitLayout[1] === "2.0") {
      return t("player.track.stereo", {}, "Stereo");
    }
    return explicitLayout[1];
  }
  const numericMatch = text.match(/\b([0-9]{1,2})(?:ch| channels?)\b/) || text.match(/^([0-9]{1,2})(?:\/[a-z0-9.]+)?$/);
  if (!numericMatch) {
    return "";
  }
  const channels = Number(numericMatch[1]);
  if (!Number.isFinite(channels) || channels <= 0) {
    return "";
  }
  if (channels >= 8) {
    return "7.1";
  }
  if (channels >= 6) {
    return "5.1";
  }
  if (channels === 2) {
    return t("player.track.stereo", {}, "Stereo");
  }
  if (channels === 1) {
    return "1.0";
  }
  return `${channels}ch`;
}

function getTrackDescriptorLabels(track = {}) {
  const descriptors = [];
  const metadataStrings = getTrackMetadataStrings(track);
  const searchText = metadataStrings.join(" ").toLowerCase();

  const channelCandidates = [track?.channels, ...metadataStrings];
  for (const candidate of channelCandidates) {
    const channelLayout = detectChannelLayout(candidate);
    if (channelLayout) {
      pushUniqueText(descriptors, channelLayout);
      break;
    }
  }

  if (!descriptors.length) {
    if (/\bstereo\b/.test(searchText)) {
      pushUniqueText(descriptors, t("player.track.stereo", {}, "Stereo"));
    } else if (/\bsurround\b/.test(searchText)) {
      pushUniqueText(descriptors, t("player.track.surround", {}, "Surround"));
    }
  }

  if (/\b(atmos|joc)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Atmos");
  } else if (/\b(eac3|ec-3|ddp|dolby digital plus)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Digital Plus");
  } else if (/\b(ac3|ac-3|dolby digital)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Digital");
  } else if (/\b(truehd)\b/.test(searchText)) {
    pushUniqueText(descriptors, "TrueHD");
  } else if (/\b(dts:x|dts-hd|dts)\b/.test(searchText)) {
    pushUniqueText(descriptors, "DTS");
  } else if (/\b(aac|mp4a)\b/.test(searchText)) {
    pushUniqueText(descriptors, "AAC");
  } else if (/\b(opus)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Opus");
  } else if (/\b(flac)\b/.test(searchText)) {
    pushUniqueText(descriptors, "FLAC");
  } else if (/\b(mp3|mpeg audio)\b/.test(searchText)) {
    pushUniqueText(descriptors, "MP3");
  }

  if (isForcedSubtitleTrack(track)) {
    pushUniqueText(descriptors, t("sub_forced_lang", {}, "Forced"));
  }
  if (isSdhSubtitleTrack(track)) {
    pushUniqueText(descriptors, "SDH");
  }
  if (isClosedCaptionTrack(track)) {
    pushUniqueText(descriptors, "CC");
  }
  if (/\b(commentary)\b/.test(searchText)) {
    pushUniqueText(descriptors, t("player.track.commentary", {}, "Commentary"));
  }
  if (/\b(audio description|audio-description|describes-video|describes video|descriptive)\b/.test(searchText)) {
    pushUniqueText(descriptors, t("player.track.audioDescription", {}, "Audio description"));
  }

  return descriptors;
}

function isForcedSubtitleTrack(track = {}) {
  if (hasTruthyTrackFlag(track, [
    "forced",
    "isForced",
    "is_forced",
    "forcedSubtitle",
    "forced_subtitle",
    "flagForced",
    "flag_forced",
    "defaultForced",
    "default_forced",
    "trackForced",
    "track_forced"
  ])) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ").toLowerCase();
  const hasForcedName = /\b(forced|forc|forzato|forzata|forzati|forzate)\b/.test(searchText);
  // Match Android TV: anime releases commonly label forced dialogue tracks as
  // "Songs & Signs" without exposing "forced" in the track name.
  const isSongsAndSigns = searchText.includes("songs") && searchText.includes("sign");
  return hasForcedName || isSongsAndSigns;
}

function isForcedAddonSubtitle(subtitle = {}) {
  return [subtitle?.id, subtitle?.url, subtitle?.addonName]
    .map((value) => cleanDisplayText(value).toLowerCase())
    .some((value) => value.includes("forced"));
}

function getSubtitleEntryLanguageSource(entry = {}) {
  const track = entry?.track || entry;
  const explicitLanguage = getTrackLanguageValue(track) || getTrackLanguageValue(entry);
  if (explicitLanguage) {
    return detectTrackLanguageVariant(track, explicitLanguage);
  }
  const secondaryLanguage = normalizeTrackLanguageCode(entry.secondary) ? entry.secondary : "";
  if (secondaryLanguage) {
    return secondaryLanguage;
  }
  const fallbackLabel = entry.label || entry.title || "";
  return isGenericSubtitleTrackLabel(fallbackLabel) ? "" : fallbackLabel;
}

function detectTrackLanguageVariant(track = {}, language = getTrackLanguageValue(track)) {
  const normalizedLanguage = normalizeTrackLanguageCode(language) || inferTrackLanguageCodeFromText(language);
  if (!normalizedLanguage) {
    return "";
  }
  if (normalizedLanguage === "pt-br" || normalizedLanguage === "es-419") {
    return normalizedLanguage;
  }
  const baseLanguage = normalizedLanguage.split("-")[0];
  const haystack = getTrackMetadataStrings(track)
    .concat([track?.trackId, track?.id])
    .map((value) => cleanDisplayText(value).toLowerCase())
    .join(" ");
  if (baseLanguage === "pt") {
    const hasBrazilian = ["pt-br", "pt_br", "pob", "brazilian", "brazil", "brasil", "brasileiro", " br", "(br)"]
      .some((tag) => haystack.includes(tag));
    const hasEuropean = ["pt-pt", "pt_pt", "iberian", "european", "portugal", "europeu", " eu", "(eu)"]
      .some((tag) => haystack.includes(tag));
    return hasBrazilian && !hasEuropean ? "pt-br" : "pt";
  }
  if (baseLanguage === "es") {
    const hasLatino = ["es-419", "es_419", "es-la", "es-lat", "latino", "latinoamerica", "latinoamericano", "latam", "lat am", "latin america"]
      .some((tag) => haystack.includes(tag));
    const hasCastilian = ["es-es", "es_es", "castilian", "castellano", "spain", "españa", "espana", "iberian"]
      .some((tag) => haystack.includes(tag));
    return hasLatino && !hasCastilian ? "es-419" : "es";
  }
  return baseLanguage;
}

function formatAudioChannelLayout(value) {
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

function formatAudioTrackDisplay(track = {}, index = 0) {
  const rawLabel = getMeaningfulTrackLabel(track);
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  const languageLabel = capitalizeDisplayLabel(getAudioTrackLanguageLabel(track));
  const rawLanguageLabel = capitalizeDisplayLabel(rawLanguage);
  const authoritativeCodecValue = getAuthoritativeAudioCodecValue(track);
  const codecName = formatAudioCodecName(
    authoritativeCodecValue || getTrackMetadataStrings(track).join(" ")
  );
  const channelLayout = formatAudioChannelLayout(track?.channelCount || track?.channels);
  const sampleRate = Number(track?.sampleRate || track?.audioSampleRate || 0);
  const labelConflictsWithCodec = audioTrackLabelConflictsWithCodec(rawLabel, authoritativeCodecValue);
  const labelPrefix = labelConflictsWithCodec
    ? getAudioTrackLabelPrefix(rawLabel)
    : "";
  const baseName = labelPrefix
    || (labelConflictsWithCodec ? "" : rawLabel)
    || languageLabel
    || rawLanguageLabel
    || audioLabel(index);
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

  return { label, secondary };
}

function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(date = new Date()) {
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const localeKey = String(locale || "__default__");
  if (!CLOCK_FORMATTER_CACHE.has(localeKey)) {
    try {
      CLOCK_FORMATTER_CACHE.set(localeKey, new Intl.DateTimeFormat(locale || undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }));
    } catch (_) {
      CLOCK_FORMATTER_CACHE.set(localeKey, null);
    }
  }
  const formatter = CLOCK_FORMATTER_CACHE.get(localeKey);
  try {
    if (formatter?.format) {
      return formatter.format(date);
    }
    return date.toLocaleTimeString(locale || undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch (_) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }
}

function formatEndsAt(currentSeconds, durationSeconds) {
  const current = Number(currentSeconds || 0);
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "--:--";
  }
  const remainingMs = Math.max(0, (duration - current) * 1000);
  const endDate = new Date(Date.now() + remainingMs);
  return formatClock(endDate);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trackListToArray(trackList) {
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

function normalizeItemType(value) {
  const normalized = String(value || "movie").toLowerCase();
  return normalized || "movie";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cleanPlaybackDiagnosticValue(value, maxLength = 320) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function pushPlaybackDiagnosticLine(lines, label, value, maxLength = 320) {
  const text = cleanPlaybackDiagnosticValue(value, maxLength);
  if (!text) {
    return;
  }
  const line = `${label}: ${text}`;
  if (!lines.includes(line)) {
    lines.push(line);
  }
}

function extractPlaybackHttpStatus(value = "") {
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

function formatEpisodePanelDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const localDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const parsed =
    localDateMatch && !raw.includes("T")
      ? new Date(
          Number(localDateMatch[1]),
          Number(localDateMatch[2]) - 1,
          Number(localDateMatch[3])
        )
      : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  try {
    return parsed.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  } catch (_) {
    return localDateMatch ? `${localDateMatch[1]}-${localDateMatch[2]}-${localDateMatch[3]}` : raw;
  }
}

function formatNextEpisodeAirDate(value = "") {
  const raw = String(value || "").trim();
  const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "";
  const dateLabel = formatEpisodePanelDate(raw) || formatEpisodePanelDate(datePortion);
  return dateLabel
    ? t("cw_airs_date", [dateLabel], "Airs %1$s")
    : t("next_episode_not_aired_yet", {}, "Next episode hasn't aired yet");
}

function episodeDisplayCode(episode = {}) {
  const season = Number(episode?.season);
  const episodeNumber = Number(episode?.episode);
  if (!Number.isFinite(season) || !Number.isFinite(episodeNumber)) {
    return "";
  }
  return `S${season} E${episodeNumber}`;
}

function episodeThumbnailUrl(episode = {}) {
  return cleanDisplayText(
    episode?.thumbnail
    || episode?.thumbnailUrl
    || episode?.still
    || episode?.stillUrl
    || episode?.poster
    || episode?.image
    || ""
  );
}

function formatBytes(value) {
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

function formatBytesPerSecond(value) {
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

function normalizeStreamBadgeChipColor(value = "") {
  const hex = String(value || "").trim().replace(/^#/, "");
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

function renderPlayerImageBadgeChip(badge = {}) {
  const imageUrl = normalizeImageUrl(badge.imageURL);
  if (!imageUrl) {
    return "";
  }
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled = String(badge.tagStyle || "").trim().toLowerCase() === "filled";
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

function getPlayerSourceLogoDisplayUrl(value = "", onSettled = null) {
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

function renderPlayerSourceBadges(stream = {}, badgeSettings = StreamBadgeSettingsStore.snapshot()) {
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

function resolvePlayerSourceBadgePlacement(badgeSettings = StreamBadgeSettingsStore.snapshot()) {
  return String(badgeSettings.badgePlacement || "BOTTOM").trim().toUpperCase() === "TOP" ? "TOP" : "BOTTOM";
}

function formatSubtitleDelay(delayMs = 0) {
  const seconds = Number(delayMs || 0) / 1000;
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(3)}s`;
}

function normalizeSubtitleFontSize(value = 120) {
  const parsed = Number(value ?? 120);
  if (!Number.isFinite(parsed)) {
    return 120;
  }
  return clamp(Math.round(parsed), 50, 200);
}

function formatHtmlSubtitleFontSize(value = 120) {
  const scale = normalizeSubtitleFontSize(value) / 100;
  const documentRef = globalThis?.document;
  const viewportHeight = Number(
    globalThis?.innerHeight
    || documentRef?.documentElement?.clientHeight
    || documentRef?.body?.clientHeight
    || 0
  );
  const basePx = viewportHeight > 0
    ? clamp(viewportHeight * 0.044, 30, 82)
    : 48;
  return `${Math.round(basePx * scale)}px`;
}

function normalizeSubtitleLanguageKey(value) {
  const code = normalizeTrackLanguageCode(value) || inferTrackLanguageCodeFromText(value);
  if (code) {
    return code;
  }
  const cleaned = cleanDisplayText(value);
  if (!normalizeLanguageNameText(cleaned)) {
    return SUBTITLE_LANGUAGE_UNKNOWN_KEY;
  }
  return cleaned ? cleaned.toLowerCase() : SUBTITLE_LANGUAGE_UNKNOWN_KEY;
}

function extractSubtitleLanguageSetting(value, fallback = SUBTITLE_LANGUAGE_OFF_KEY) {
  if (value && typeof value === "object") {
    return extractSubtitleLanguageSetting(value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode, fallback);
  }
  const code = cleanDisplayText(value);
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

function subtitleLanguageLabel(languageKey) {
  if (languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
    return t("subtitle_none", {}, "Off");
  }
  if (languageKey === SUBTITLE_LANGUAGE_UNKNOWN_KEY) {
    return t("common.unknown", {}, "Unknown");
  }
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const normalizedCode = normalizeTrackLanguageCode(languageKey);
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
  return label
    ? `${label.charAt(0).toLocaleUpperCase(locale)}${label.slice(1)}`
    : "";
}

function formatSubtitleTrackDisplay(track = {}, index = 0) {
  const languageSource = getSubtitleEntryLanguageSource(track);
  const languageKey = normalizeSubtitleLanguageKey(languageSource);
  const languageLabel = subtitleLanguageLabel(languageKey);
  const descriptors = getTrackDescriptorLabels(track)
    .filter((detail) => !isSubtitleLanguageOnlyDetail(detail, languageLabel, languageKey));
  const rawLabel = getMeaningfulTrackLabel(track);
  const label = languageKey !== SUBTITLE_LANGUAGE_UNKNOWN_KEY && languageLabel
    ? languageLabel
    : (rawLabel || subtitleLabel(index));

  return {
    label,
    language: getTrackLanguageValue(track) || languageSource,
    secondary: descriptors.join(" · "),
    languageKey,
    languageLabel
  };
}

function isSubtitleLanguageOnlyDetail(value, languageLabel = "", languageKey = "") {
  const text = cleanDisplayText(value);
  if (!text) {
    return true;
  }
  const comparable = normalizeComparableText(text);
  const labelComparable = normalizeComparableText(languageLabel);
  if (labelComparable && comparable === labelComparable) {
    return true;
  }

  const normalizedDetailCode = normalizeTrackLanguageCode(text) || inferTrackLanguageCodeFromText(text);
  const normalizedLanguageCode = normalizeTrackLanguageCode(languageKey) || inferTrackLanguageCodeFromText(languageKey);
  if (normalizedDetailCode && normalizedLanguageCode) {
    return normalizedDetailCode === normalizedLanguageCode
      || normalizedDetailCode.split("-")[0] === normalizedLanguageCode.split("-")[0];
  }

  const inferredKey = normalizeSubtitleLanguageKey(text);
  if (normalizedLanguageCode && inferredKey && inferredKey !== SUBTITLE_LANGUAGE_UNKNOWN_KEY) {
    return inferredKey === normalizedLanguageCode
      || inferredKey.split("-")[0] === normalizedLanguageCode.split("-")[0];
  }
  return false;
}

function styleChipLabel(value = "") {
  return String(value || "").replace(/^#/, "").toUpperCase();
}

function createTrackDialogCache() {
  return {
    subtitleOptions: null,
    subtitleLanguageRail: null,
    subtitleOptionsByLanguage: new Map(),
    audioEntries: null,
    embeddedAudioByNativeIndex: null,
    embeddedAudioByEmbeddedIndex: null,
    embeddedSubtitleByNativeIndex: null,
    embeddedSubtitleByEmbeddedIndex: null
  };
}

function dbToGain(db = 0) {
  return Math.pow(10, Number(db || 0) / 20);
}

function supportsTvWebAudioAmplification() {
  return !Environment.isWebOS() && !Environment.isTizen();
}

function isMagnetUrl(value = "") {
  return String(value || "").trim().toLowerCase().startsWith("magnet:");
}

function directPlaybackUrl(value = "") {
  const url = String(value || "").trim();
  return url && !isMagnetUrl(url) ? url : "";
}

function streamDirectPlaybackUrl(stream = {}) {
  return directPlaybackUrl(stream?.url) || directPlaybackUrl(stream?.externalUrl);
}

function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};
  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};
  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";
  const magnetUri = resolve.magnetUri
    || (isMagnetUrl(item.url) ? item.url : "")
    || (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");
  const hasDebridMarker = Boolean(
    item.clientResolve
      || item.raw?.clientResolve
      || item.debridCacheStatus
      || item.raw?.debridCacheStatus
      || infoHash
      || magnetUri
  );
  if (!hasDebridMarker) {
    return "";
  }
  const locator = infoHash || magnetUri || item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(resolve.service || item.debridCacheStatus?.providerId || item.raw?.debridCacheStatus?.providerId || ""),
    String(locator),
    String(resolve.fileIdx ?? item.fileIdx ?? item.raw?.fileIdx ?? ""),
    String(behaviorHints.filename || resolve.filename || ""),
    String(resolve.torrentName || "")
  ].join("::");
}

function streamMergeKey(item = {}) {
  const debridIdentity = streamDebridIdentity(item);
  if (debridIdentity) {
    return `debrid::${debridIdentity}`;
  }
  const locator = item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(locator),
    String(item.sourceType || ""),
    String(item.fileIdx ?? ""),
    String(item.behaviorHints?.filename || "")
  ].join("::");
}

function mergeStreamItem(previous = {}, next = {}) {
  const behaviorHints = {
    ...(previous.behaviorHints || {}),
    ...(next.behaviorHints || {})
  };
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    url: next.url || previous.url || "",
    externalUrl: next.externalUrl || previous.externalUrl || null,
    ytId: next.ytId || previous.ytId || null,
    behaviorHints: Object.keys(behaviorHints).length ? behaviorHints : null,
    subtitles: Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,
    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources
  };
}

function flattenStreamGroups(streamResult) {
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
        addonId: stream.addonId || group.addonId || group.streamOrigin?.addonId || stream.streamOrigin?.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || group.streamOrigin?.addonBaseUrl || stream.streamOrigin?.addonBaseUrl || null,
        addonName: stream.addonName || group.addonName || group.streamOrigin?.addonName || stream.streamOrigin?.addonName || addonName,
        sourceProviderId: stream.sourceProviderId || group.sourceProviderId || stream.streamOrigin?.sourceProviderId || group.streamOrigin?.sourceProviderId || null
      };
      const entry = {
        id: stream.id || `${addonName}-${index}-${stream.url || stream.externalUrl || stream.ytId || stream.infoHash || resolve.infoHash || resolve.magnetUri || ""}`,
        label: stream.name || stream.title || `${addonName} stream`,
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || stream.name || "",
        addonId: stream.addonId || group.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
        addonName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceProviderId: stream.sourceProviderId || group.sourceProviderId || stream.streamOrigin?.sourceProviderId || group.streamOrigin?.sourceProviderId || null,
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
        DirectDebridResolver.shouldListStream(entry)
        || WebOsEngineFsResolver.canResolveStream(entry)
        || TizenStreamingServerResolver.canResolveStream(entry)
      ) {
        flattened.push(entry);
      }
    });
  });
  return flattened;
}

function mergeStreamItems(existing = [], incoming = []) {
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

function normalizeParentalWarnings(source) {
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

function buildLocalizedParentalWarnings(guide = {}) {
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
      severityKey: String(guide?.[key] || "").trim().toLowerCase()
    }))
    .filter((entry) => entry.severityKey && entry.severityKey !== "none")
    .sort((left, right) => (severityRank[left.severityKey] ?? 50) - (severityRank[right.severityKey] ?? 50))
    .map((entry) => ({
      label: entry.label,
      severity: severityLabels[entry.severityKey] || entry.severityKey
    }))
    .slice(0, 5);
}

function normalizePlayableImdbId(value = "") {
  const candidate = String(value || "").trim().split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizePlayableTmdbId(value = "") {
  const raw = String(value || "").trim();
  if (!raw || /^tt\d+$/i.test(raw)) {
    return 0;
  }
  const numeric = raw.replace(/^tmdb:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}

function normalizePlayableTraktId(value = "") {
  const raw = String(value || "").trim();
  const numeric = raw.replace(/^trakt:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}

function buildSkipIntervalLabel(interval = {}) {
  const type = String(interval?.type || "").trim().toLowerCase();
  if (type === "recap") {
    return t("skip_recap", {}, "Skip Recap");
  }
  if (type === "outro" || type === "ed" || type === "mixed-ed") {
    return t("skip_outro", {}, "Skip Outro");
  }
  return t("skip_intro", {}, "Skip Intro");
}

function getSkipIntervalKey(interval = null) {
  return interval ? `${interval.type}:${interval.startTime}:${interval.endTime}` : "";
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if (text.startsWith("\"") && text.endsWith("\"")) {
    return text.slice(1, -1);
  }
  return text;
}

function parseHlsAttributeList(value) {
  const raw = String(value || "");
  const attributes = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const key = String(match[1] || "").toUpperCase();
    const attributeValue = stripQuotes(match[2] || "");
    if (!key) {
      continue;
    }
    attributes[key] = attributeValue;
  }
  return attributes;
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  try {
    return new URL(String(maybeRelativeUrl || ""), String(baseUrl || "")).toString();
  } catch (_) {
    return String(maybeRelativeUrl || "");
  }
}

function uniqueNonEmptyValues(values = []) {
  const seen = new Set();
  const unique = [];
  (values || []).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    unique.push(normalized);
  });
  return unique;
}

export const PlayerScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("player");
    this.container.style.display = "block";
    this.container.classList.toggle("player-platform-webos", Environment.isWebOS());
    const mountToken = Number(this.playerMountToken || 0) + 1;
    this.playerMountToken = mountToken;
    this.playerRouteActive = true;
    this.params = params;
    this.trackPreferenceContentId = this.getTrackPreferenceContentId();
    this.rememberedAudioTrackPreference = TrackPreferencesStore.getAudio(this.trackPreferenceContentId);
    if (Environment.isWebOS()) {
      const legacyForceAll = Boolean(PlayerSettingsStore.get().forceDtsTrueHdAudio);
      const audioCompatibility = WebOsAudioCompatibilityStore.get({ legacyForceAll });
      PlayerController.setWebOsAudioCodecOverrides?.(audioCompatibility);
      void PlayerController.refreshWebOsDeviceInfo?.();
    }
    this.contentLanguage = resolveRouteContentLanguage(params);
    this.externalFrameUrl = String(params.externalFrameUrl || "").trim();
    if (this.releaseImageProxyReadyListener) {
      this.releaseImageProxyReadyListener();
      this.releaseImageProxyReadyListener = null;
    }
    if (Environment.isWebOS()) {
      this.releaseImageProxyReadyListener = onWebOsImageProxyReady(() => {
        this.renderControlButtons();
        void this.preloadPlayerSourceLogos();
        this.scheduleSourceLogoRender();
      });
      void ensureWebOsImageProxyReady();
    }

    this.aspectModes = [
      { objectFit: "contain", label: t("player_aspect_fit", {}, "Fit") },
      { objectFit: "cover", label: t("player_aspect_fill", {}, "Fill") },
      { objectFit: "fill", label: t("player_aspect_stretch", {}, "Stretch") }
    ];

    this.streamCandidates = this.normalizeStreamCandidates(Array.isArray(params.streamCandidates) ? params.streamCandidates : []);
    const preferredStreamId = String(params?.preferredStreamId || "").trim();
    const preferredStreamCandidate = preferredStreamId
      ? this.streamCandidates.find((stream) => String(stream?.id || "") === preferredStreamId) || null
      : null;
    const initialStreamCandidate = preferredStreamCandidate || this.selectBestStreamCandidate(this.streamCandidates);
    const initialStreamLocator = params.streamUrl || initialStreamCandidate?.url || initialStreamCandidate?.externalUrl || null;
    const initialStreamUrl =
      directPlaybackUrl(params.streamUrl) || streamDirectPlaybackUrl(initialStreamCandidate);
    if (!this.streamCandidates.length && initialStreamLocator) {
      this.streamCandidates = this.normalizeStreamCandidates([
        {
          url: initialStreamLocator,
          title: "Current source",
          addonName: "Current"
        }
      ]);
    }

    this.currentStreamIndex = this.streamCandidates.findIndex((stream) => (
      (preferredStreamCandidate && String(stream?.id || "") === String(preferredStreamCandidate.id || ""))
      || stream.url === initialStreamLocator
      || stream.externalUrl === initialStreamLocator
      || (initialStreamUrl && streamDirectPlaybackUrl(stream) === initialStreamUrl)
    ));
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = 0;
    }
    // Remember the stream that actually plays so the stream list can focus it on
    // the next visit. Only persist when the caller provided a real candidate list
    // (this skips trailers and synthetic single-url playback).
    if (Array.isArray(params.streamCandidates) && params.streamCandidates.length) {
      const playingStreamCandidate = this.streamCandidates[this.currentStreamIndex] || null;
      this.rememberSelectedStreamPreference(playingStreamCandidate);
    }
    this.activePlaybackSourceContext = this.getPlaybackSourceContext(
      preferredStreamCandidate || initialStreamCandidate || this.streamCandidates[this.currentStreamIndex] || null
    ) || this.normalizePlaybackSourceContext(params.playbackSourceContext || params.sourceContext || null);
    this.currentEngineFsStream = null;
    this.engineFsCleanupInFlight = new Set();

    this.subtitles = [];
    this.embeddedSubtitleTracks = [];
    this.nextEpisodeTransitionMeta = null;
    this.subtitleDialogVisible = false;
    this.subtitleDialogTab = "builtIn";
    this.subtitleDialogIndex = 0;
    this.subtitleLanguageRailIndex = 0;
    this.subtitleOptionRailIndex = 0;
    this.subtitleStyleRailIndex = 0;
    this.subtitleStyleControlSide = "minus";
    this.subtitleFocusedRail = "language";
    this.subtitleDialogScrollMode = "nearest";
    this.subtitleDialogScrollTimer = null;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.startupSubtitlePreferenceApplied = false;
    this.startupSubtitlePreferenceApplying = false;
    this.startupAudioPreferenceApplied = false;
    this.startupAudioPreferenceApplying = false;
    this.startupAudioFallbackApplied = false;
    this.startupAudioTrackSetSignature = "";
    this.startupAudioPreferenceRetryTimer = null;
    this.startupAudioPreferenceRetryDeadline = 0;
    this.startupTrackPreferenceReady = false;
    this.trackDialogCache = createTrackDialogCache();
    this.builtInSubtitleCount = 0;
    this.externalTrackNodes = [];
    this.externalSubtitleObjectUrls = [];
    this.htmlSubtitleCues = [];
    this.htmlSubtitleRenderFrame = null;
    this.htmlSubtitleRenderTimer = null;
    this.avPlaySubtitleOverlayTimer = null;
    this.htmlSubtitleActiveCueKey = "";
    this.htmlSubtitleSelectedId = null;
    this.webOsEmbeddedHtmlSubtitleTrack = null;
    this.webOsEmbeddedHtmlSubtitleCueCount = 0;
    this.webOsEmbeddedHtmlSubtitleActivationKey = "";
    this.bitmapSubtitleDecoder = null;
    this.bitmapSubtitleTrack = null;
    this.bitmapSubtitleLoadToken = 0;
    this.bitmapSubtitleLoading = false;
    this.bitmapSubtitleWindowStart = 0;
    this.bitmapSubtitleWindowEnd = 0;
    this.bitmapSubtitleLastFrameKey = "";
    this.bitmapSubtitleLastErrorAt = 0;
    this.bitmapSubtitleScratchCanvas = null;
    this.subtitleCueStyleBindings = new Map();
    this.subtitleCueOriginalState = new WeakMap();
    this.embeddedSubtitleCueRefreshTimers = new Set();
    this.webOsEmbeddedCueRefreshApplied = false;

    this.audioDialogVisible = false;
    this.audioDialogIndex = 0;
    this.audioMixFocusIndex = 0;
    this.audioFocusedColumn = "tracks";
    this.selectedAudioTrackIndex = -1;
    this.embeddedAudioTracks = [];
    this.selectedEmbeddedAudioTrackIndex = -1;
    this.audioFallbackApplying = false;
    this.pendingWebOsAudioSelection = null;
    this.failedAutomaticAudioFallbackEntryId = "";

    this.sourcesPanelVisible = false;
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourceFilter = "all";
    this.sourcesFocus = { zone: "filter", index: 0 };
    this.sourceLoadToken = 0;
    this.completedSourceRequestKey = "";
    this.streamCandidatesByVideoId = new Map();
    this.streamCandidatesLoadPromises = new Map();

    this.aspectModeIndex = 0;
    this.aspectToastTimer = null;
    this.speedDialogVisible = false;
    this.speedDialogIndex = Math.max(0, PLAYER_SPEEDS.indexOf(1));

    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.episodePanelVisible = false;
    const explicitEpisodeIndex = this.episodes.findIndex((entry) => entry.id === params.videoId);
    const fallbackEpisodeIndex = this.episodes.findIndex((entry) => {
      const seasonMatch = params.season == null || Number(entry?.season) === Number(params.season);
      const episodeMatch = params.episode == null || Number(entry?.episode) === Number(params.episode);
      return seasonMatch && episodeMatch;
    });
    this.episodePanelIndex = Math.max(0, explicitEpisodeIndex >= 0 ? explicitEpisodeIndex : fallbackEpisodeIndex);
    this.episodePanelFocusZone = "episodes";
    this.episodePanelSeason = null;
    this.episodePanelSeasonIndex = 0;
    this.episodePanelMode = "episodes";
    this.episodePanelStreams = [];
    this.episodePanelStreamsLoading = false;
    this.episodePanelStreamsError = "";
    this.episodePanelStreamFilter = "all";
    this.episodePanelStreamFocus = { zone: "actions", index: 0 };
    this.episodePanelStreamVideoId = "";
    this.episodePanelStreamLoadToken = 0;
    this.episodePanelExitTimer = null;
    this.switchingEpisode = false;

    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekCommitTimer = null;
    this.seekOverlayTimer = null;
    this.seekOverlaySuppressControlsUntil = 0;
    this.pauseOverlayVisible = false;
    this.pauseOverlayTimer = null;
    this.pauseOverlayDelayMs = PAUSE_OVERLAY_DELAY_MS;
    this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0);
    this.pauseOverlayMeta = null;
    this.nextEpisodeLaunching = false;
    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeCardTriggered = false;
    this.nextEpisodeCardSearching = false;
    this.nextEpisodeCardSourceName = "";
    this.nextEpisodeCardCountdownSec = null;
    this.nextEpisodeAutoplayAttemptedKey = "";
    this.consecutiveAutoPlayCount = Math.max(0, Math.trunc(Number(params.consecutiveAutoPlayCount || 0) || 0));
    this.stillWatchingPromptVisible = false;
    this.stillWatchingPromptCountdownSec = 0;
    this.stillWatchingPromptTimer = null;
    this.stillWatchingPromptFocusArmed = false;
    this.stillWatchingPromptFocus = "continue";
    this.playerBackNavigationInProgress = false;
    this.nextEpisodeCardDismissed = false;
    this.nextEpisodeBackExitArmed = false;

    this.parentalWarnings = normalizeParentalWarnings(params.parentalWarnings || params.parentalGuide);
    this.parentalGuideVisible = false;
    this.parentalGuideExiting = false;
    this.parentalGuideShown = false;
    this.parentalGuideTimer = null;
    this.parentalGuideExitTimer = null;
    this.parentalGuideLineEnterTimer = null;
    this.parentalGuideLineExitTimer = null;
    this.parentalGuideLineAnimationFrame = null;
    this.parentalGuideLineProgress = 0;
    this.skipIntervals = [];
    this.activeSkipInterval = null;
    this.skipIntervalDismissed = false;
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = 0;
    this.skipIntroCountdownStartAt = 0;
    this.skipIntroAnimationFrame = null;
    this.skipIntroFocusFrame = null;
    this.skipIntroRenderedKey = "";
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
    this.lastActionOverlayBottomPx = null;
    this.subtitleSelectionTimer = null;
    this.subtitleLoadToken = 0;
    this.subtitleLoading = false;
    this.embeddedSubtitleLoadToken = 0;
    this.embeddedSubtitleLoading = false;
    this.embeddedAudioLoading = false;
    this.initialEmbeddedTrackBootstrapPromise = null;
    this.embeddedTrackRequestPromise = null;
    this.embeddedTrackRequestUrl = "";
    this.lastEmbeddedTrackProbeUrl = "";
    this.lastEmbeddedTrackRetryAt = 0;
    this.manifestLoadToken = 0;
    this.manifestLoading = false;
    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = "";
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.hlsManifestSubtitlePromotionUrls = new Set();
    this.activePlaybackUrl = initialStreamUrl || null;
    this.pendingPlaybackRestore = buildPendingPlaybackRestore(params);
    this.trackDiscoveryToken = 0;
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryTimer = null;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.lastTrackWarmupAt = 0;
    this.silentAudioFallbackAttempts = new Set();
    this.silentAudioFallbackCount = 0;
    this.maxSilentAudioFallbackCount = 1;
    this.lastPlaybackErrorAt = 0;
    this.failedPlaybackUrls = new Set();
    this.failedPlaybackStreamIds = new Set();
    this.playbackStallTimer = null;
    this.engineFsStartupRetryTimer = null;
    this.engineFsStartupErrorRetries = 0;
    this.engineFsStallExtensions = 0;
    this.lastEngineFsStallStats = null;
    this.lastEngineFsStartupErrorStats = null;
    this.engineFsKeepAliveHandle = null;
    this.engineFsKeepAliveToken = "";
    this.engineFsRemovalRequests = new Map();
    this.engineFsPlaybackToken = "";
    this.playerExitCleanupHandler = null;
    this.lastPlaybackProgressAt = Date.now();
    this.hasPresentedPlaybackFrame = false;
    this.startupErrorMessage = "";
    this.startupErrorMediaCode = 0;
    this.startupErrorDetails = [];
    this.startupPlaybackBaselineSeconds = null;
    this.startupPlaybackHasAdvanced = false;
    this.paused = false;
    this.controlsVisible = true;
    this.loadingVisible = true;
    this.loadingProgress = null;
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.loadingLogoFillFrame = null;
    this.loadingTorrentStatus = "";
    this.torrentOverlayData = null;
    this.loadingProgressRefreshInFlight = false;
    this.seekLoading = false;
    this.seekLoadingBaselineSeconds = null;
    this.seekLoadingTargetSeconds = null;
    this.startupAudioGateActive = false;
    this.startupAudioGateAllowsNativePlayback = false;
    this.startupAudioGateDeadline = 0;
    this.loadingCompletionTimer = null;
    this.loadingCompletionToken = 0;
    this.bufferingSpinnerTimer = null;
    this.bufferingSpinnerBaselineSeconds = null;
    this.moreActionsVisible = false;
    this.controlFocusZone = "buttons";
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusIndex = 0;
    this.controlsHideTimer = null;
    this.tickTimer = null;
    this.skipIntervalCheckTimer = null;
    this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0);
    this.videoListeners = [];
    this.mediaSessionHandlersBound = false;
    this.mediaSessionActions = [];

    const playerSettings = PlayerSettingsStore.get();
    this.subtitleRenderMode = normalizeSubtitleRenderMode(playerSettings.subtitleRenderMode);
    this.subtitleDelayMs = 0;
    this.subtitleStyleSettings = {
      ...playerSettings.subtitleStyle,
      preferredLanguage: extractSubtitleLanguageSetting(playerSettings.subtitleStyle?.preferredLanguage || playerSettings.subtitleLanguage || "off"),
      secondaryPreferredLanguage: extractSubtitleLanguageSetting(playerSettings.subtitleStyle?.secondaryPreferredLanguage || playerSettings.secondarySubtitleLanguage || "off")
    };
    this.audioAmplificationDb = clamp(Number(playerSettings.audioAmplificationDb || 0), AUDIO_AMPLIFICATION_MIN_DB, AUDIO_AMPLIFICATION_MAX_DB);
    this.persistAudioAmplification = Boolean(playerSettings.persistAudioAmplification);
    this.audioAmplificationAvailable = supportsTvWebAudioAmplification()
      && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
    this.audioContext = null;
    this.audioGainNode = null;
    this.audioMediaSource = null;

    this.renderPlayerUi();
    this.bindPlayerExitCleanup();
    this.pauseOverlayMeta = this.buildPauseOverlayMeta();
    if (!this.isExternalFrameMode()) {
      this.bindVideoEvents();
      this.bindMediaSessionHandlers();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      void this.fetchParentalGuide();
      void this.fetchSkipIntervals();
      void this.hydratePauseOverlayMeta();
    }
    this.renderEpisodePanel();
    this.applyAspectMode({ showToast: false });
    if (!this.isExternalFrameMode()) {
      this.updateUiTick();
    }

    if (initialStreamUrl && !this.isExternalFrameMode()) {
      const sourceCandidate = this.getStreamCandidateByUrl(initialStreamUrl) || this.getCurrentStreamCandidate();
      this.activePlaybackUrl = initialStreamUrl;
      this.currentEngineFsStream = this.getEngineFsStateForStream(sourceCandidate);
      const prioritizeWebOsRemoteMkvPlayback = Environment.isWebOS()
        && !this.currentEngineFsStream
        && this.isCurrentSourceLikelyMkv(initialStreamUrl, sourceCandidate);
      if (prioritizeWebOsRemoteMkvPlayback) {
        // The probe must start only after webOS has accepted the media request,
        // but startup preference checks must already know discovery is pending.
        this.trackDiscoveryInProgress = true;
      }
      if (this.currentEngineFsStream) {
        this.engineFsPlaybackToken = claimEngineFsPlayback(this.currentEngineFsStream);
        this.releaseStartupAudioGate({ resume: false });
        this.startEngineFsKeepAlive(this.currentEngineFsStream);
      } else {
        this.engineFsPlaybackToken = "";
        this.enableStartupAudioGate({
          allowNativePlayback: prioritizeWebOsRemoteMkvPlayback,
          maxWaitMs: prioritizeWebOsRemoteMkvPlayback
            ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS
            : 0
        });
      }
      const playbackStartPromise = this.startPlayerControllerPlayback(
        this.activePlaybackUrl,
        this.buildPlaybackContext(sourceCandidate),
        { mountToken, sourceCandidate }
      );
      if (prioritizeWebOsRemoteMkvPlayback) {
        await playbackStartPromise;
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
      }
      this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
      this.startTrackDiscoveryWindow({
        durationMs: prioritizeWebOsRemoteMkvPlayback
          ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS
          : 7000
      });
      this.schedulePlaybackStallGuard();
    } else if (!this.isExternalFrameMode()) {
      const sourceCandidate = initialStreamCandidate || this.getCurrentStreamCandidate();
      if (
        sourceCandidate
        && (
          DirectDebridResolver.canResolveStream(sourceCandidate)
          || WebOsEngineFsResolver.canResolveStream(sourceCandidate)
          || TizenStreamingServerResolver.canResolveStream(sourceCandidate)
        )
      ) {
        void this.playStreamCandidate(sourceCandidate, {
          preservePendingRestore: true,
          mountToken
        });
      }
    }

    if (!this.isExternalFrameMode()) {
      this.loadSubtitles();
      this.syncTrackState();
      this.tickTimer = setInterval(() => this.updateUiTick(), 1000);
      this.startSkipIntervalCheckTimer();
      this.endedHandler = () => {
        this.handlePlaybackEnded();
      };
      PlayerController.video?.addEventListener("ended", this.endedHandler);
      this.setControlsVisible(true, { focus: true });
    } else {
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.setControlsVisible(false);
    }
  },

  isExternalFrameMode() {
    return Boolean(this.externalFrameUrl);
  },

  isActiveMountToken(mountToken = null) {
    if (!this.playerRouteActive) {
      return false;
    }
    if (mountToken !== null && Number(mountToken) !== Number(this.playerMountToken || 0)) {
      return false;
    }
    return Boolean(this.container);
  },

  resolvePlaybackMediaSourceType(streamCandidate = this.getCurrentStreamCandidate()) {
    const normalizeSourceType = typeof PlayerController.normalizePlaybackSourceType === "function"
      ? PlayerController.normalizePlaybackSourceType.bind(PlayerController)
      : (value) => String(value || "").includes("/") ? String(value || "").trim() : null;

    const declaredTypes = [
      streamCandidate?.raw?.mimeType,
      streamCandidate?.mimeType,
      streamCandidate?.sampleMimeType,
      streamCandidate?.engineFs?.mimeType,
      streamCandidate?.raw?.engineFs?.mimeType,
      streamCandidate?.sourceType,
      streamCandidate?.raw?.sourceType,
      streamCandidate?.raw?.type
    ];
    for (const value of declaredTypes) {
      const normalized = normalizeSourceType(value);
      if (normalized) {
        return normalized;
      }
    }

    const filenameHints = [
      streamCandidate?.behaviorHints?.filename,
      streamCandidate?.raw?.behaviorHints?.filename,
      streamCandidate?.raw?.filename
    ];
    for (const value of filenameHints) {
      const guessed = typeof PlayerController.guessMediaMimeType === "function"
        ? PlayerController.guessMediaMimeType(String(value || ""))
        : null;
      if (guessed) {
        return guessed;
      }
    }
    return null;
  },

  buildPlaybackContext(streamCandidate = this.getCurrentStreamCandidate()) {
    const requestHeaders = this.getCurrentStreamRequestHeaders(streamCandidate);
    const mediaSourceType = this.resolvePlaybackMediaSourceType(streamCandidate);
    return {
      itemId: this.params.itemId || null,
      itemType: normalizeItemType(this.params.itemType || "movie"),
      videoId: this.params.videoId || null,
      season: this.params.season == null ? null : Number(this.params.season),
      episode: this.params.episode == null ? null : Number(this.params.episode),
      title: this.params.playerTitle || this.params.itemTitle || null,
      poster: this.params.poster || null,
      background: this.params.playerBackdropUrl || this.params.backdrop || this.params.poster || null,
      logo: this.params.playerLogoUrl || this.params.logo || null,
      episodeTitle: this.params.episodeTitle || this.params.playerSubtitle || null,
      requestHeaders,
      mediaSourceType,
      streamIdentity: streamCandidate
        ? buildStreamResumeIdentity(streamCandidate) || streamMergeKey(streamCandidate) || null
        : null
    };
  },

  rememberSelectedStreamPreference(streamCandidate) {
    const prefContentId = String(this.params?.itemId || "").trim();
    const prefVideoId = String(this.params?.videoId || this.params?.itemId || "").trim();
    if (!streamCandidate?.id || !prefContentId) {
      return;
    }
    StreamPreferencesStore.set(prefContentId, prefVideoId, streamCandidate.id, {
      bingeGroup: streamCandidate?.behaviorHints?.bingeGroup ||
        streamCandidate?.raw?.behaviorHints?.bingeGroup || "",
      resumeIdentity: buildStreamResumeIdentity(streamCandidate)
    });
  },

  buildSubtitleLookupContext() {
    const type = normalizeItemType(this.params?.itemType || "movie");
    const identity = this.buildPlaybackIdentityContext();
    const rawItemId = String(this.params?.itemId || "").trim();
    const baseItemId = rawItemId ? String(rawItemId.split(":")[0] || "").trim() : "";
    const imdbItemId = normalizePlayableImdbId(identity.imdbId);
    const id = imdbItemId || baseItemId || rawItemId || "";
    const currentStream = this.getCurrentStreamCandidate();
    const rawStream = currentStream?.raw || currentStream || {};
    const behaviorHints = rawStream?.behaviorHints || {};

    let videoId = null;
    if (type === "series") {
      const routeVideoId = String(this.params?.videoId || "").trim();
      const season = Number(this.params?.season);
      const episode = Number(this.params?.episode);
      // The exact episode id used by the player is authoritative, matching Android TV.
      if (routeVideoId) {
        videoId = routeVideoId;
      } else if (id && Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
        videoId = `${id}:${season}:${episode}`;
      }
    }

    return {
      type,
      id,
      videoId,
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      title: this.params?.playerTitle || this.params?.itemTitle || null,
      year: this.params?.playerReleaseYear || this.params?.year || null,
      videoHash: behaviorHints.videoHash || rawStream.videoHash || this.params?.videoHash || null,
      videoSize: behaviorHints.videoSize || rawStream.videoSize || this.params?.videoSize || null,
      filename: behaviorHints.filename || rawStream.filename || this.params?.filename || null
    };
  },

  buildPlaybackIdentityContext() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const rawImdbId = String(this.params?.imdbId || this.params?.imdb_id || "").trim();
    const rawItemId = String(this.params?.itemId || "").trim();
    const rawVideoId = String(this.params?.videoId || "").trim();
    const seasonRaw = this.params?.season;
    const season = Number(seasonRaw);
    const episode = Number(this.params?.episode || 0);
    const imdbId = [
      normalizePlayableImdbId(rawImdbId),
      normalizePlayableImdbId(rawVideoId),
      normalizePlayableImdbId(rawItemId)
    ].find(Boolean) || "";
    const tmdbId = [
      normalizePlayableTmdbId(this.params?.tmdbId || this.params?.tmdb_id),
      normalizePlayableTmdbId(rawItemId),
      normalizePlayableTmdbId(rawVideoId)
    ].find(Boolean) || 0;
    const traktId = [
      normalizePlayableTraktId(this.params?.traktId || this.params?.trakt_id),
      normalizePlayableTraktId(rawItemId),
      normalizePlayableTraktId(rawVideoId)
    ].find(Boolean) || 0;
    return {
      itemType,
      imdbId,
      tmdbId,
      traktId,
      season:
        seasonRaw != null && Number.isFinite(season) && season >= 0 ? season : null,
      episode: Number.isFinite(episode) && episode > 0 ? episode : null
    };
  },

  getTrackPreferenceContentId() {
    const identity = this.buildPlaybackIdentityContext();
    const itemId = String(this.params?.itemId || "").trim();
    if (itemId) {
      return itemId;
    }
    if (identity.imdbId) {
      return identity.imdbId;
    }
    if (identity.tmdbId) {
      return `tmdb:${identity.itemType}:${identity.tmdbId}`;
    }
    if (identity.traktId) {
      return `trakt:${identity.itemType}:${identity.traktId}`;
    }
    return "";
  },

  getAudioTrackPreference(entry = {}) {
    const track = entry?.track || {};
    const sourceTrackId = Number(track?.sourceTrackId);
    const trackId = [
      track?.trackId,
      Number.isFinite(sourceTrackId) && sourceTrackId >= 0 ? sourceTrackId : null,
      track?.raw?.id,
      track?.id,
      entry?.manifestAudioTrackId
    ]
      .map((value) => cleanDisplayText(value))
      .find(Boolean) || "";
    const name = [track?.name, track?.label, track?.title, entry?.label]
      .map((value) => cleanDisplayText(value))
      .find(Boolean) || "";
    return {
      language: inferAudioTrackLanguageKey(track, entry),
      name,
      trackId
    };
  },

  rememberAudioTrackSelection(preference = null) {
    if (!preference || !this.trackPreferenceContentId) {
      return;
    }
    TrackPreferencesStore.setAudio(this.trackPreferenceContentId, preference);
    this.rememberedAudioTrackPreference = { ...preference };
  },

  findRememberedAudioOption(preference = this.rememberedAudioTrackPreference) {
    if (!preference) {
      return null;
    }
    const options = this.collectAudioOptionItems().filter((option) => option.supported);
    const targetId = normalizeComparableText(preference.trackId || "");
    const targetName = normalizeComparableText(preference.name || "");
    const targetLanguage = normalizeTrackLanguageCode(preference.language || "")
      || normalizeComparableText(preference.language || "");
    const describe = (option) => {
      const current = this.getAudioTrackPreference(option.entry);
      return {
        id: normalizeComparableText(current.trackId || ""),
        name: normalizeComparableText(current.name || ""),
        language: normalizeTrackLanguageCode(current.language || "")
          || normalizeComparableText(current.language || "")
      };
    };
    const languageMatchesExactly = (current) => !targetLanguage || current.language === targetLanguage;
    const nameMatches = (current) => !targetName
      || current.name === targetName
      || current.name.includes(targetName);

    if (targetId) {
      const exactId = options.find((option) => {
        const current = describe(option);
        return current.id === targetId
          && languageMatchesExactly(current)
          && nameMatches(current);
      });
      if (exactId) {
        return exactId;
      }
    }

    if (targetName) {
      const exactName = options.find((option) => {
        const current = describe(option);
        return current.name === targetName && languageMatchesExactly(current);
      });
      if (exactName) {
        return exactName;
      }
      const containedName = options.find((option) => {
        const current = describe(option);
        return current.name.includes(targetName) && languageMatchesExactly(current);
      });
      if (containedName) {
        return containedName;
      }
    }

    if (!targetLanguage) {
      return null;
    }
    const exactLanguage = options.find((option) => describe(option).language === targetLanguage);
    if (exactLanguage) {
      return exactLanguage;
    }
    const targetBase = targetLanguage.split("-")[0];
    return options.find((option) => describe(option).language.split("-")[0] === targetBase) || null;
  },

  buildScrobbleContext() {
    const identity = this.buildPlaybackIdentityContext();
    const currentSec = this.getPlaybackCurrentSeconds();
    const durationSec = this.getPlaybackDurationSeconds();
    const progress =
      durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;
    return {
      contentId: String(this.params?.itemId || identity.imdbId || ""),
      contentType: identity.itemType === "series" ? "series" : "movie",
      imdbId: identity.imdbId,
      tmdbId: identity.tmdbId || null,
      traktId: identity.traktId || null,
      title: String(this.params?.playerTitle || this.params?.itemTitle || this.params?.title || ""),
      year: Number(this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || 0) || null,
      seasonNumber: identity.season,
      episodeNumber: identity.episode,
      episodeTitle: String(this.params?.playerEpisodeTitle || this.params?.episodeTitle || this.params?.playerSubtitle || ""),
      positionMs: Math.round(currentSec * 1000),
      durationMs: Math.round(durationSec * 1000),
      progressPercent: progress,
    };
  },

  maybeShowParentalGuideOverlay() {
    if (
      this.parentalGuideShown
      || !this.parentalWarnings.length
      || this.paused
      || this.loadingVisible
      || this.startupAudioGateActive
      || !this.hasPresentedPlaybackFrame
    ) {
      return;
    }
    this.showParentalGuideOverlay();
  },

  async fetchParentalGuide() {
    const { itemType, imdbId, season, episode } = this.buildPlaybackIdentityContext();
    if (!imdbId) {
      return;
    }
    const response = (itemType === "series" || itemType === "tv") && season && episode
      ? await parentalGuideRepository.getTvGuide(imdbId, season, episode)
      : await parentalGuideRepository.getMovieGuide(imdbId);
    const warnings = buildLocalizedParentalWarnings(response?.parentalGuide || {});
    if (!warnings.length) {
      return;
    }
    if (JSON.stringify(this.parentalWarnings || []) === JSON.stringify(warnings)) {
      return;
    }
    const hasAlreadyShown = Boolean(this.parentalGuideShown);
    this.parentalWarnings = warnings;
    if (!hasAlreadyShown) {
      this.parentalGuideShown = false;
    }
    this.renderParentalGuideOverlay();
    if (!hasAlreadyShown) {
      this.maybeShowParentalGuideOverlay();
    }
  },

  async fetchSkipIntervals() {
    const requestToken = (this.skipIntervalsRequestToken || 0) + 1;
    this.skipIntervalsRequestToken = requestToken;
    if (!PlayerSettingsStore.get().skipIntroEnabled) {
      this.skipIntervals = [];
      this.activeSkipInterval = null;
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return;
    }
    const { imdbId, season, episode } = this.buildPlaybackIdentityContext();
    if (!imdbId || !season || !episode) {
      this.skipIntervals = [];
      this.activeSkipInterval = null;
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return;
    }
    const intervals = await skipIntroRepository.getSkipIntervals(imdbId, season, episode);
    if (this.skipIntervalsRequestToken !== requestToken) {
      return;
    }
    this.skipIntervals = Array.isArray(intervals) ? intervals : [];
    this.skipIntervalDismissed = false;
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = Date.now();
    this.skipIntroCountdownStartAt = 0;
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
    this.stopSkipIntroCountdownAnimation();
    this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
  },

  updateActiveSkipInterval(currentTime = this.getPlaybackCurrentSeconds()) {
    if (!PlayerSettingsStore.get().skipIntroEnabled) {
      if (this.activeSkipInterval != null) {
        this.activeSkipInterval = null;
      }
      return;
    }
    const previous = this.activeSkipInterval;
    let active = (Array.isArray(this.skipIntervals) ? this.skipIntervals : []).find((interval) => {
      const start = Number(interval?.startTime);
      const end = Number(interval?.endTime);
      return Number.isFinite(start) && Number.isFinite(end) && currentTime >= start && currentTime < (end - 0.5);
    }) || null;
    const candidateKey = getSkipIntervalKey(active);
    const suppressedKey = String(this.skipIntroSuppressedKey || "");
    const suppressionActive = suppressedKey
      && Date.now() < Number(this.skipIntroSuppressedUntil || 0);
    if (suppressedKey && !suppressionActive) {
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
    } else if (suppressionActive && candidateKey === suppressedKey) {
      // TV playback engines can briefly report the pre-seek position while a
      // skip seek settles. Keep the skipped interval hidden through that churn.
      active = null;
    }
    const previousKey = getSkipIntervalKey(previous);
    const nextKey = getSkipIntervalKey(active);
    if (previousKey !== nextKey) {
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.stopSkipIntroCountdownAnimation();
    }
    this.activeSkipInterval = active;
    if (previousKey !== nextKey) {
      this.renderSkipIntroButton();
      this.updateSkipIntroCountdown(Date.now());
    }
  },

  getSkipIntervalProgress(interval = this.activeSkipInterval, currentTime = this.getPlaybackCurrentSeconds()) {
    if (!interval) {
      return 0;
    }
    const start = Number(interval.startTime);
    const end = Number(interval.endTime);
    const current = Number(currentTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(current)) {
      return 0;
    }
    return clamp((current - start) / (end - start), 0, 1);
  },

  isSkipIntroPlaybackReady() {
    return Boolean(this.hasPresentedPlaybackFrame && !this.loadingVisible);
  },

  stopSkipIntroCountdownAnimation() {
    if (this.skipIntroAnimationFrame != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.skipIntroAnimationFrame);
    }
    this.skipIntroAnimationFrame = null;
    this.skipIntroCountdownStartAt = 0;
  },

  updateSkipIntroCountdown(now = Date.now()) {
    const playbackReady = this.isSkipIntroPlaybackReady();
    const shouldTrack = Boolean(this.activeSkipInterval) && playbackReady && !this.skipIntervalDismissed;
    if (!shouldTrack) {
      this.stopSkipIntroCountdownAnimation();
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Number(now || Date.now());
      return;
    }

    if (!this.controlsVisible) {
      this.startSkipIntroCountdownAnimation();
      return;
    }

    this.stopSkipIntroCountdownAnimation();
    this.skipIntroCountdownLastTickAt = Number(now || Date.now());
  },

  startSkipIntroCountdownAnimation() {
    if (typeof requestAnimationFrame !== "function") {
      this.skipIntroCountdownProgress = clamp(this.skipIntroCountdownProgress, 0, 1);
      if (this.skipIntroCountdownProgress >= 1) {
        this.skipIntroAutoHidden = true;
      }
      this.syncSkipIntroButtonProgress();
      return;
    }

    if (!this.activeSkipInterval || !this.isSkipIntroPlaybackReady() || this.skipIntervalDismissed || this.controlsVisible || this.skipIntroAutoHidden) {
      return;
    }

    if (this.skipIntroAnimationFrame != null) {
      return;
    }

    const currentProgress = clamp(this.skipIntroCountdownProgress, 0, 1);
    this.skipIntroCountdownStartAt = 0;

    const tick = (timestamp) => {
      this.skipIntroAnimationFrame = null;
      if (!this.activeSkipInterval || !this.isSkipIntroPlaybackReady() || this.skipIntervalDismissed || this.controlsVisible) {
        this.syncSkipIntroButtonProgress();
        return;
      }

      const now = Number(timestamp || Date.now());
      if (!this.skipIntroCountdownStartAt) {
        this.skipIntroCountdownStartAt = now - (currentProgress * SKIP_INTRO_COUNTDOWN_MS);
      }
      const elapsed = Math.max(0, now - Number(this.skipIntroCountdownStartAt || 0));
      this.skipIntroCountdownProgress = clamp(elapsed / SKIP_INTRO_COUNTDOWN_MS, 0, 1);
      this.syncSkipIntroButtonProgress();

      if (this.skipIntroCountdownProgress >= 1) {
        this.skipIntroAutoHidden = true;
        this.renderSkipIntroButton();
        return;
      }

      this.skipIntroAnimationFrame = requestAnimationFrame(tick);
    };

    this.skipIntroAnimationFrame = requestAnimationFrame(tick);
  },

  syncSkipIntroButtonProgress() {
    const button = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (!button) {
      return;
    }
    const fill = button.querySelector(".player-skip-intro-progress-fill");
    const progressNode = button.querySelector(".player-skip-intro-progress");
    if (fill) {
      fill.style.transform = `scaleX(${clamp(this.skipIntroCountdownProgress, 0, 1)})`;
    }
    if (progressNode) {
      const progressVisible = !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed;
      progressNode.style.opacity = progressVisible ? "1" : "0";
    }
  },

  syncSkipIntroButtonTheme(button = null) {
    const target = button || this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (!target) {
      return;
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const focusBackground =
      rootStyle.getPropertyValue("--player-focus-background").trim() || "#303030";
    const focusContent =
      rootStyle.getPropertyValue("--player-text-primary").trim() || "#ffffff";
    const focusRing = rootStyle.getPropertyValue("--player-focus-ring").trim() || "#ffffff";
    const isFocused = document.activeElement === target || target.classList.contains("focused");
    const background = isFocused ? focusBackground : "rgba(30, 30, 30, 0.85)";
    const color = isFocused ? focusContent : "#fff";
    const boxShadow = isFocused ? `0 0 0 4px ${focusRing}` : "none";

    target.style.setProperty("background", background, "important");
    target.style.setProperty("background-color", background, "important");
    target.style.setProperty("color", color, "important");
    target.style.setProperty("box-shadow", boxShadow, "important");

    const icon = target.querySelector(".player-skip-intro-icon");
    const label = target.querySelector(".player-skip-intro-label");
    icon?.style.setProperty("color", color, "important");
    label?.style.setProperty("color", color, "important");
    label?.style.setProperty("-webkit-text-fill-color", color, "important");
  },

  isSkipIntroButtonFocusable() {
    const container = this.uiRefs?.skipIntro;
    const button = container?.querySelector(".player-skip-intro-btn");
    return Boolean(
      button
      && button.isConnected
      && !container.classList.contains("hidden")
      && this.activeSkipInterval
      && !this.skipIntervalDismissed
      && this.isSkipIntroPlaybackReady()
    );
  },

  syncSkipIntroFocusState() {
    const button = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (!button) {
      return;
    }
    const focused = this.controlFocusZone === "skipIntro" && this.isSkipIntroButtonFocusable();
    button.classList.toggle("focused", focused);
    if (focused) {
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== button && activeElement !== document.body && typeof activeElement.blur === "function") {
        activeElement.blur();
      }
      if (document.activeElement !== button && typeof button.focus === "function") {
        try {
          button.focus();
        } catch (_) {
          // Some TV runtimes can reject focus during DOM churn.
        }
      }
    }
    this.syncSkipIntroButtonTheme(button);
  },

  focusSkipIntroButton() {
    if (!this.isSkipIntroButtonFocusable()) {
      return false;
    }
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusZone = "skipIntro";
    this.renderControlButtons();
    this.syncSkipIntroFocusState();
    this.resetControlsAutoHide();
    return true;
  },

  renderSkipIntroButton() {
    const button = this.uiRefs?.skipIntro;
    if (!button) {
      return;
    }
    const activeInterval = this.activeSkipInterval;
    const playbackReady = this.isSkipIntroPlaybackReady();
    const shouldShow = Boolean(activeInterval) && playbackReady && !this.skipIntervalDismissed;
    const isVisible = shouldShow && (!this.skipIntroAutoHidden || this.controlsVisible);
    const activeKey = activeInterval ? `${activeInterval.type}:${activeInterval.startTime}:${activeInterval.endTime}` : "none";
    const renderKey = `${activeKey}|ready:${playbackReady ? 1 : 0}|controls:${this.controlsVisible ? 1 : 0}|hidden:${this.skipIntroAutoHidden ? 1 : 0}|dismissed:${this.skipIntervalDismissed ? 1 : 0}`;
    button.classList.toggle("hidden", !isVisible);
    button.classList.toggle("is-raised", Boolean(this.controlsVisible));
    if (!isVisible && this.controlFocusZone === "skipIntro") {
      this.controlFocusZone = this.controlsVisible && this.isSeekBarAvailable() ? "progress" : "buttons";
    }
    if (!shouldShow) {
      button.innerHTML = "";
      this.skipIntroRenderedKey = renderKey;
      return;
    }
    if (this.skipIntroRenderedKey !== renderKey || !button.querySelector(".player-skip-intro-btn")) {
      const label = buildSkipIntervalLabel(activeInterval);
      const progress = clamp(this.skipIntroCountdownProgress, 0, 1);
      const progressVisible = !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed;
      button.innerHTML = `
        <button class="player-skip-intro-btn focusable" type="button" tabindex="-1" data-player-pointer-action="skipIntro" style="--skip-intro-progress-visible:${progressVisible ? 1 : 0};">
          <span class="player-skip-intro-content">
            <span class="player-skip-intro-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" fill="currentColor"></path>
              </svg>
            </span>
            <span class="player-skip-intro-label">${escapeHtml(label)}</span>
          </span>
          <span class="player-skip-intro-progress" aria-hidden="true">
            <span class="player-skip-intro-progress-track"></span>
            <span class="player-skip-intro-progress-fill" style="transform:scaleX(${progress.toFixed(4)})"></span>
          </span>
        </button>
      `;
      this.skipIntroRenderedKey = renderKey;
    }
    this.syncSkipIntroButtonProgress();
    const focusTarget = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (focusTarget) {
      if (!focusTarget.dataset.skipIntroThemeBound) {
        const syncTheme = () => this.syncSkipIntroButtonTheme(focusTarget);
        focusTarget.addEventListener("focus", syncTheme, true);
        focusTarget.addEventListener("blur", syncTheme, true);
        focusTarget.dataset.skipIntroThemeBound = "1";
      }
      focusTarget.classList.toggle("focused", this.controlFocusZone === "skipIntro");
      this.syncSkipIntroButtonTheme(focusTarget);
    }
    if (isVisible && !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed) {
      if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.skipIntroFocusFrame);
      }
      if (typeof requestAnimationFrame === "function") {
        this.skipIntroFocusFrame = requestAnimationFrame(() => {
          this.skipIntroFocusFrame = null;
          const focusTarget = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
          if (!focusTarget || !focusTarget.isConnected) {
            return;
          }
          if (document.activeElement === focusTarget) {
            return;
          }
          try {
            focusTarget.focus();
            this.syncSkipIntroButtonTheme(focusTarget);
          } catch (_) {
            // Some webOS runtimes can reject focus during DOM churn; harmless.
          }
        });
      } else {
        try {
          const fallbackTarget = button.querySelector(".player-skip-intro-btn");
          fallbackTarget?.focus?.();
          this.syncSkipIntroButtonTheme(fallbackTarget);
        } catch (_) {
          // no-op
        }
      }
    }
  },

  startSkipIntervalCheckTimer() {
    this.stopSkipIntervalCheckTimer();
    this.skipIntervalCheckTimer = setInterval(() => {
      if (this.isExternalFrameMode()) {
        return;
      }
      if (!PlayerSettingsStore.get().skipIntroEnabled) {
        return;
      }
      if (!Array.isArray(this.skipIntervals) || !this.skipIntervals.length) {
        return;
      }
      this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
    }, SKIP_INTERVAL_CHECK_MS);
  },

  stopSkipIntervalCheckTimer() {
    if (this.skipIntervalCheckTimer) {
      clearInterval(this.skipIntervalCheckTimer);
      this.skipIntervalCheckTimer = null;
    }
  },

  skipActiveInterval() {
    if (!this.activeSkipInterval) {
      return false;
    }
    const interval = this.activeSkipInterval;
    const targetTime = Number(interval.endTime || 0) + 0.25;
    this.skipIntroSuppressedKey = getSkipIntervalKey(interval);
    this.skipIntroSuppressedUntil = Date.now() + SKIP_INTERVAL_SEEK_SUPPRESSION_MS;
    this.seekPlaybackSeconds(targetTime, { preserveSkipIntroSuppression: true });
    this.skipIntervalDismissed = true;
    this.activeSkipInterval = null;
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = Date.now();
    this.skipIntroCountdownStartAt = 0;
    this.stopSkipIntroCountdownAnimation();
    this.renderSkipIntroButton();
    return true;
  },

  normalizeStreamCandidates(streams = []) {
    return (streams || []).map((stream, index) => {
      const streamUrl = stream?.url || stream?.externalUrl || "";
      const streamOrigin = {
        ...(stream.raw?.streamOrigin || {}),
        ...(stream.streamOrigin || {}),
        addonId: stream.addonId || stream.raw?.addonId || stream.streamOrigin?.addonId || stream.raw?.streamOrigin?.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || stream.raw?.addonBaseUrl || stream.streamOrigin?.addonBaseUrl || stream.raw?.streamOrigin?.addonBaseUrl || null,
        addonName: stream.addonName || stream.sourceName || stream.raw?.addonName || stream.streamOrigin?.addonName || stream.raw?.streamOrigin?.addonName || "Addon",
        sourceProviderId: stream.sourceProviderId || stream.raw?.sourceProviderId || stream.streamOrigin?.sourceProviderId || stream.raw?.streamOrigin?.sourceProviderId || null
      };
      const entry = {
        id: stream.id || `stream-${index}-${streamUrl}`,
        label: stream.name || stream.title || stream.label || `Source ${index + 1}`,
        name: stream.name || null,
        title: stream.title || stream.label || null,
        description: stream.description || stream.name || "",
        addonId: stream.addonId || stream.raw?.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || stream.raw?.addonBaseUrl || null,
        addonName: stream.addonName || stream.sourceName || "Addon",
        addonLogo: stream.addonLogo || null,
        sourceProviderId: stream.sourceProviderId || stream.raw?.sourceProviderId || stream.streamOrigin?.sourceProviderId || stream.raw?.streamOrigin?.sourceProviderId || null,
        streamOrigin,
        mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
        sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
        url: streamUrl,
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
        clientResolve: stream.clientResolve || stream.raw?.clientResolve || null,
        debridCacheStatus: stream.debridCacheStatus || null,
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        raw: stream
      };
      return (
        DirectDebridResolver.shouldListStream(entry)
        || WebOsEngineFsResolver.canResolveStream(entry)
        || TizenStreamingServerResolver.canResolveStream(entry)
      ) ? entry : null;
    }).filter(Boolean);
  },

  getCurrentStreamCandidate() {
    if (!this.streamCandidates.length) {
      return null;
    }
    const current = this.streamCandidates[this.currentStreamIndex] || null;
    if (current?.url) {
      return current;
    }
    return this.streamCandidates.find((entry) => Boolean(entry?.url)) || null;
  },

  normalizePlaybackSourceContext(context = null) {
    if (!context || typeof context !== "object") {
      return null;
    }
    const sourceIds = uniqueNonEmptyValues([
      ...(Array.isArray(context.sourceIds) ? context.sourceIds : []),
      context.sourceId,
      context.catalogId
    ]);
    const normalized = {
      addonId: String(context.addonId || "").trim(),
      addonBaseUrl: String(context.addonBaseUrl || "").trim(),
      addonName: String(context.addonName || "").trim(),
      addonOrderIndex: Number.isFinite(Number(context.addonOrderIndex)) ? Number(context.addonOrderIndex) : null,
      sourceProviderId: String(context.sourceProviderId || context.providerId || "").trim(),
      originKind: String(context.originKind || context.kind || context.streamOrigin?.kind || "").trim().toLowerCase(),
      sourceId: sourceIds[0] || "",
      sourceIds,
      catalogId: String(context.catalogId || "").trim(),
      streamOrigin: context.streamOrigin && typeof context.streamOrigin === "object" ? { ...context.streamOrigin } : null,
      selectedStreamId: String(context.selectedStreamId || "").trim(),
      selectedStreamIndex: Number.isFinite(Number(context.selectedStreamIndex)) ? Number(context.selectedStreamIndex) : null
    };
    return Object.values({
      addonId: normalized.addonId,
      addonBaseUrl: normalized.addonBaseUrl,
      addonName: normalized.addonName,
      sourceProviderId: normalized.sourceProviderId,
      sourceId: normalized.sourceId
    }).some(Boolean) ? normalized : null;
  },

  getPlaybackSourceContext(streamCandidate = null) {
    const stream = streamCandidate || null;
    if (!stream) {
      return this.normalizePlaybackSourceContext(this.activePlaybackSourceContext || this.params?.playbackSourceContext || this.params?.sourceContext || null);
    }
    const raw = stream.raw || {};
    const origin = stream.streamOrigin || raw.streamOrigin || {};
    const sourceIds = uniqueNonEmptyValues([
      ...(Array.isArray(stream.sources) ? stream.sources : []),
      ...(Array.isArray(raw.sources) ? raw.sources : []),
      stream.sourceId,
      raw.sourceId,
      origin.sourceId,
      stream.catalogId,
      raw.catalogId,
      origin.catalogId
    ]);
    const selectedStreamIndex = this.streamCandidates?.indexOf?.(stream);
    return this.normalizePlaybackSourceContext({
      addonId: stream.addonId || raw.addonId || origin.addonId || "",
      addonBaseUrl: stream.addonBaseUrl || raw.addonBaseUrl || origin.addonBaseUrl || "",
      addonName: stream.addonName || raw.addonName || origin.addonName || "",
      addonOrderIndex: stream.addonOrderIndex ?? raw.addonOrderIndex ?? origin.addonOrderIndex ?? null,
      sourceProviderId: stream.sourceProviderId
        || raw.sourceProviderId
        || origin.sourceProviderId
        || "",
      originKind: origin.kind || stream.originKind || raw.originKind || "",
      sourceIds,
      sourceId: sourceIds[0] || "",
      catalogId: stream.catalogId || raw.catalogId || origin.catalogId || "",
      streamOrigin: origin,
      selectedStreamId: stream.id || "",
      selectedStreamIndex: Number.isFinite(selectedStreamIndex) && selectedStreamIndex >= 0 ? selectedStreamIndex : null
    });
  },

  isDebridPlaybackCandidate(streamCandidate = this.getCurrentStreamCandidate()) {
    const stream = streamCandidate?.raw || streamCandidate || {};
    const resolve = streamCandidate?.clientResolve || stream?.clientResolve || {};
    const debridCacheStatus = streamCandidate?.debridCacheStatus || stream?.debridCacheStatus || null;
    return Boolean(
      String(resolve.type || "").toLowerCase() === "debrid"
      || debridCacheStatus
    );
  },

  getStreamSearchText(streamCandidate) {
    const stream = streamCandidate?.raw || streamCandidate || {};
    return String([
      streamCandidate?.label || "",
      streamCandidate?.description || "",
      streamCandidate?.sourceType || "",
      streamCandidate?.url || "",
      stream?.title || "",
      stream?.name || "",
      stream?.description || "",
      stream?.url || ""
    ].join(" ")).toLowerCase();
  },

  getWebOsAudioCompatibilityScore(streamCandidate) {
    const text = this.getStreamSearchText(streamCandidate);
    let score = 0;

    if (/\b(aac|mp4a)\b/.test(text)) score += 22;
    if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score += 14;
    if (/\b(mp3|mpeg audio)\b/.test(text)) score += 8;
    if (/\b(stereo|2\.0|2ch)\b/.test(text)) score += 8;

    if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score -= 28;
    const devicePenalty = typeof PlayerController.getWebOsUnsupportedAudioPenalty === "function"
      ? Number(PlayerController.getWebOsUnsupportedAudioPenalty(text) || 0)
      : 0;
    if (devicePenalty !== 0) {
      score += devicePenalty;
    } else if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
      score -= 45;
    }
    if (/\b(7\.1|8ch)\b/.test(text)) score -= 12;
    if (/\b(flac|alac)\b/.test(text)) score -= 10;

    return score;
  },

  getStreamCandidateByUrl(streamUrl) {
    const normalized = String(streamUrl || "").trim();
    if (!normalized) {
      return null;
    }
    return this.streamCandidates.find((entry) => String(entry?.url || "").trim() === normalized) || null;
  },

  getEngineFsStateForStream(streamCandidate = null) {
    if (Environment.isWebOS()) {
      const state = WebOsEngineFsResolver.getResolvedStreamState(streamCandidate || {});
      if (state) {
        return state;
      }
    } else if (Environment.isTizen()) {
      const state = TizenStreamingServerResolver.getResolvedStreamState(streamCandidate || {});
      if (state) {
        return state;
      }
    } else {
      return null;
    }
    const playbackUrl = String(streamCandidate?.url || streamCandidate?.externalUrl || streamCandidate || "").trim();
    if (!playbackUrl) {
      return null;
    }
    try {
      const parsed = new URL(playbackUrl);
      const match = parsed.pathname.match(/\/([0-9a-f]{40})\/(-?\d+)(?:\/|$)/i);
      if (!match) {
        return null;
      }
      const fileIdx = Number(match[2]);
      return {
        kind: Environment.isTizen() ? "tizen-streaming-server" : "webos-enginefs",
        infoHash: String(match[1] || "").toLowerCase(),
        fileIdx: Number.isFinite(fileIdx) ? fileIdx : -1,
        playbackUrl,
        mimeType: String(streamCandidate?.mimeType || streamCandidate?.sourceType || "").trim() || null,
        baseUrlKind: parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1"
          ? "local-service"
          : "public-service",
        publicPlaybackUrl: String(streamCandidate?.engineFs?.publicPlaybackUrl || streamCandidate?.raw?.engineFs?.publicPlaybackUrl || "").trim() || null,
        baseUrl: `${parsed.protocol}//${parsed.host}`
      };
    } catch (_) {
      return null;
    }
  },

  engineFsStateKey(state = null) {
    return state?.infoHash ? `${state.infoHash}:${state.fileIdx ?? -1}` : "";
  },

  isSameEngineFsState(a = null, b = null) {
    return Boolean(a && b && this.engineFsStateKey(a) === this.engineFsStateKey(b));
  },

  engineFsCleanupKey(state = null) {
    return state?.infoHash ? String(state.infoHash).toLowerCase() : "";
  },

  isExpectedEngineFsCleanupError(value = "") {
    const text = String(
      typeof value === "object" && value
        ? value.detail || value.errorText || value.message || value.status || ""
        : value || ""
    ).toLowerCase();
    return (
      text.includes("message not processed")
      || text.includes("connection refused")
      || text.includes("econnrefused")
      || text.includes("failed to fetch")
      || text.includes("network error")
      || text.includes("not found")
      || text.includes("404")
      || text.includes("unavailable")
      || text.includes("timed out")
    );
  },

  async cleanupEngineFsState(state = null, reason = "cleanup", { deferMs = 0 } = {}) {
    const target = state?.infoHash ? state : null;
    if (!target) {
      return false;
    }
    const key = this.engineFsCleanupKey(target);
    const existing = this.engineFsRemovalRequests.get(key);
    if (existing) {
      return existing;
    }

    const performRemoval = async () => {
      if (hasActiveEngineFsPlaybackClaim(target)) {
        logEngineFsDebug("EngineFS torrent remove skipped; stream is active", {
          reason,
          infoHash: target.infoHash,
          fileIdx: target.fileIdx
        });
        return false;
      }
      try {
        const result = target.kind === "tizen-streaming-server"
          ? await TizenStreamingServerResolver.remove(target.infoHash, { baseUrl: target.baseUrl, timeoutMs: 2500 })
          : await WebOsEngineFsResolver.remove(target.infoHash, { timeoutMs: 2500 });
        if (result?.status === "success") {
          logEngineFsDebug("EngineFS torrent removed", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx
          });
          return true;
        }
        if (result?.status === "unsupported" || result?.status === "unavailable") {
          logEngineFsDebug("EngineFS torrent remove unavailable", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx,
            status: result.status
          });
          return false;
        }
        if (this.isExpectedEngineFsCleanupError(result)) {
          logEngineFsDebug("EngineFS torrent remove ignored", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx,
            result
          });
          return false;
        }
        logEngineFsDebug("EngineFS torrent remove failed", {
          reason,
          infoHash: target.infoHash,
          fileIdx: target.fileIdx,
          result
        });
        return false;
      } catch (error) {
        if (this.isExpectedEngineFsCleanupError(error)) {
          logEngineFsDebug("EngineFS torrent remove ignored", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx,
            error
          });
          return false;
        }
        logEngineFsDebug("EngineFS torrent remove threw", {
          reason,
          infoHash: target.infoHash,
          fileIdx: target.fileIdx,
          error
        });
        return false;
      }
    };

    const removalPromise = scheduleDeferredEngineFsRemoval(target, reason, deferMs, performRemoval) || performRemoval();

    this.engineFsRemovalRequests.set(key, removalPromise);
    try {
      return await removalPromise;
    } finally {
      if (this.engineFsRemovalRequests.get(key) === removalPromise) {
        this.engineFsRemovalRequests.delete(key);
      }
    }
  },

  startEngineFsKeepAlive(state = this.currentEngineFsStream) {
    if (!state?.infoHash) {
      return;
    }
    if (state.kind === "tizen-streaming-server") {
      this.stopEngineFsKeepAlive();
      logEngineFsDebug("EngineFS keepalive skipped for Tizen local service", {
        infoHash: state.infoHash,
        fileIdx: state.fileIdx
      });
      return;
    }
    const token = `${state.infoHash}:${state.fileIdx ?? -1}:${Date.now()}`;
    this.stopEngineFsKeepAlive();
    this.engineFsKeepAliveToken = token;
    try {
      this.engineFsKeepAliveHandle = subscribeWebOsCompanionService({
        method: "enginefsKeepAlive",
        parameters: {
          token,
          infoHash: state.infoHash,
          fileIdx: state.fileIdx,
          intervalMs: 8000
        },
        onSuccess: (payload) => {
          if (payload?.settingsReachable === false) {
            logEngineFsDebug("EngineFS keepalive reports runtime unavailable", {
              token,
              payload
            });
          }
        },
        onFailure: (error) => {
          console.warn("EngineFS keepalive failed", {
            token,
            error
          });
        }
      });
      logEngineFsDebug("EngineFS keepalive started", {
        token,
        infoHash: state.infoHash,
        fileIdx: state.fileIdx
      });
    } catch (error) {
      console.warn("EngineFS keepalive could not start", {
        token,
        error
      });
    }
  },

  stopEngineFsKeepAlive() {
    const token = String(this.engineFsKeepAliveToken || "").trim();
    if (this.engineFsKeepAliveHandle) {
      try {
        this.engineFsKeepAliveHandle.cancel?.();
      } catch (_) {
        // Ignore local cancellation failures.
      }
      this.engineFsKeepAliveHandle = null;
    }
    if (token) {
      requestWebOsCompanionService({
        method: "enginefsKeepAliveStop",
        parameters: { token }
      }).catch(() => null);
    }
    this.engineFsKeepAliveToken = "";
  },

  async releaseCurrentEngineFsStream(reason = "cleanup", { removeTorrent = false, deferRemoveMs = 0 } = {}) {
    const current = this.currentEngineFsStream;
    if (!current) {
      return;
    }
    const playbackToken = this.engineFsPlaybackToken;
    this.stopEngineFsKeepAlive();
    this.clearPlaybackStallGuard();
    if (this.engineFsStartupRetryTimer) {
      clearTimeout(this.engineFsStartupRetryTimer);
      this.engineFsStartupRetryTimer = null;
    }
    this.engineFsStartupErrorRetries = 0;
    this.lastEngineFsStartupErrorStats = null;
    this.lastEngineFsStallStats = null;
    this.engineFsStallExtensions = 0;
    this.currentEngineFsStream = null;
    this.stopLoadingLogoFillAnimation();
    this.loadingProgress = null;
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.loadingTorrentStatus = "";
    this.torrentOverlayData = null;
    this.syncLoadingOverlayProgress();
    this.syncTorrentOverlay();
    this.engineFsPlaybackToken = "";
    releaseEngineFsPlaybackClaim(current, playbackToken);
    if (!removeTorrent || !current.infoHash) {
      return;
    }
    await this.cleanupEngineFsState(current, reason, { deferMs: deferRemoveMs });
  },

  releaseCurrentEngineFsStreamBestEffort(reason = "cleanup", { removeTorrent = false, deferRemoveMs = 0 } = {}) {
    const current = this.currentEngineFsStream;
    if (!current) {
      return;
    }
    void this.releaseCurrentEngineFsStream(reason, { removeTorrent, deferRemoveMs }).catch(() => null);
  },

  sendEngineFsRemoveOnPageExit(state = null) {
    const target = state?.infoHash ? state : this.currentEngineFsStream;
    if (!target?.infoHash) {
      return;
    }
    const playbackUrl = String(target.playbackUrl || target.publicPlaybackUrl || this.activePlaybackUrl || "").trim();
    if (!playbackUrl) {
      return;
    }
    try {
      const parsed = new URL(playbackUrl);
      const removeUrl = `${parsed.origin}/${encodeURIComponent(String(target.infoHash).toLowerCase())}/remove`;
      fetch(removeUrl, {
        method: "GET",
        cache: "no-cache",
        keepalive: true
      }).catch(() => null);
    } catch (_) {
      // Page-exit cleanup is best-effort; normal Luna cleanup still follows.
    }
  },

  bindPlayerExitCleanup() {
    this.unbindPlayerExitCleanup();
    this.playerExitCleanupHandler = () => {
      void PlayerController.flushCurrentProgress({ forceCloudSync: true });
      this.sendEngineFsRemoveOnPageExit();
      this.releaseCurrentEngineFsStreamBestEffort("player-exit", { removeTorrent: true });
    };
    window.addEventListener("pagehide", this.playerExitCleanupHandler);
    window.addEventListener("beforeunload", this.playerExitCleanupHandler);
    document.addEventListener("nuvio:beforeExitApp", this.playerExitCleanupHandler);
  },

  unbindPlayerExitCleanup() {
    if (!this.playerExitCleanupHandler) {
      return;
    }
    window.removeEventListener("pagehide", this.playerExitCleanupHandler);
    window.removeEventListener("beforeunload", this.playerExitCleanupHandler);
    document.removeEventListener("nuvio:beforeExitApp", this.playerExitCleanupHandler);
    this.playerExitCleanupHandler = null;
  },

  getTrackProbeUrl() {
    const currentCandidate = this.getCurrentStreamCandidate();
    return String(
      this.activePlaybackUrl
      || currentCandidate?.url
      || PlayerController.video?.currentSrc
      || ""
    ).trim();
  },

  isCurrentSourceAdaptiveManifest() {
    const probeUrl = this.getTrackProbeUrl();
    const probeMimeType = typeof PlayerController.guessMediaMimeType === "function"
      ? PlayerController.guessMediaMimeType(probeUrl)
      : null;
    return (typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType))
      || (typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType));
  },

  isCurrentSourceLikelyMkv(url = this.getTrackProbeUrl(), streamCandidate = this.getCurrentStreamCandidate()) {
    const probeUrl = String(url || "").trim().toLowerCase();
    if (probeUrl.includes(".mkv")) {
      return true;
    }
    const sourceType = this.resolvePlaybackMediaSourceType(streamCandidate);
    const normalizedSourceType = typeof PlayerController.normalizeMimeType === "function"
      ? PlayerController.normalizeMimeType(sourceType)
      : String(sourceType || "").toLowerCase().split(";")[0].trim();
    return normalizedSourceType === "video/x-matroska";
  },

  canDiscoverEmbeddedSubtitleTracks() {
    const usingNativePlayback = typeof PlayerController.isUsingNativePlayback === "function"
      ? PlayerController.isUsingNativePlayback()
      : false;
    if (!usingNativePlayback) {
      return false;
    }

    const probeUrl = this.getTrackProbeUrl();
    if (!probeUrl || this.isCurrentSourceAdaptiveManifest()) {
      return false;
    }

    if (Environment.isWebOS()) {
      return true;
    }

    if (Environment.isTizen()) {
      return false;
    }

    return typeof PlayerController.isLikelyDirectFileUrl === "function"
      ? PlayerController.isLikelyDirectFileUrl(probeUrl)
      : false;
  },

  canDiscoverEmbeddedAudioTracks() {
    return this.canDiscoverEmbeddedSubtitleTracks();
  },

  shouldUseEmbeddedSubtitleTracks() {
    if (!this.canDiscoverEmbeddedSubtitleTracks() || this.embeddedSubtitleTracks.length <= 0) {
      return false;
    }

    return Environment.isWebOS() || this.getTextTracks().length <= 0;
  },

  normalizeEmbeddedSubtitleTracks(rawTracks = []) {
    let nativeTrackIndex = 0;
    return rawTracks
      .filter((track) => {
        const type = String(track?.type || track?.track || track?.codecType || "").toLowerCase();
        return type === "text" || type === "subtitle";
      })
      .filter((track) => (
        isVobSubEmbeddedSubtitleTrack(track)
          ? canUseWebOsBitmapSubtitles()
          : !isUnsupportedEmbeddedSubtitleTrack(track)
      ))
      .map((track, index) => {
        const bitmapSubtitle = isVobSubEmbeddedSubtitleTrack(track);
        const sourceTrackId = Number(track?.id);
        const rawLanguage = getTrackLanguageValue(track);
        const normalizedLanguage = normalizeTrackLanguageCode(rawLanguage);
        const languageKey = normalizeSubtitleLanguageKey(normalizedLanguage || String(rawLanguage || ""));
        const fallbackLabel = languageKey && languageKey !== SUBTITLE_LANGUAGE_UNKNOWN_KEY
          ? subtitleLanguageLabel(languageKey)
          : subtitleLabel(index);
        const descriptors = getTrackDescriptorLabels(track);
        return {
          id: `embedded-subtitle-${index}`,
          embeddedTrackIndex: index,
          sourceTrackId: Number.isFinite(sourceTrackId) ? sourceTrackId : -1,
          nativeTrackIndex: bitmapSubtitle ? -1 : nativeTrackIndex++,
          bitmapSubtitle,
          label: getMeaningfulTrackLabel(track) || fallbackLabel,
          language: normalizedLanguage || String(rawLanguage || "").trim().toLowerCase(),
          secondary: descriptors.length ? descriptors.join(" · ") : String(normalizedLanguage || rawLanguage || "").trim().toUpperCase(),
          forced: isForcedSubtitleTrack(track),
          codec: cleanDisplayText(track?.codec || track?.subtitleCodec || track?.codec_name),
          format: cleanDisplayText(track?.format || track?.format_name),
          raw: track
        };
      });
  },

  warmBitmapSubtitleSharedResources() {
    if (
      !this.hasPresentedPlaybackFrame
      || !canUseWebOsBitmapSubtitles()
      || !this.embeddedSubtitleTracks.some((track) => track.bitmapSubtitle)
    ) {
      return;
    }
    void warmBitmapSubtitleDecoder().catch(() => {
      // Selection keeps the existing lazy decoder fallback if silent warming fails.
    });
  },

  normalizeEmbeddedAudioTracks(rawTracks = []) {
    const audioTracks = rawTracks
      .filter((track) => String(track?.type || "").toLowerCase() === "audio");
    const supportStates = audioTracks.map((track) => getAudioTrackSupportState(track));
    const nativeTrackIndexes = mapAudioTrackNativeIndexes(
      supportStates.map((support) => support.supported),
      { filterUnsupported: Environment.isWebOS() }
    );
    return audioTracks.map((track, index) => {
      const sourceTrackId = Number(track?.id);
      const support = supportStates[index];
      const rawLanguage = getTrackLanguageValue(track);
      const inferredLanguage = inferAudioTrackLanguageKey(track);
      return {
        id: `embedded-audio-${index}`,
        embeddedTrackIndex: index,
        sourceTrackId: Number.isFinite(sourceTrackId) ? sourceTrackId : -1,
        nativeTrackIndex: nativeTrackIndexes[index],
        supported: support.supported,
        unsupportedReason: support.unsupportedReason,
        label: getMeaningfulTrackLabel(track),
        name: cleanDisplayText(track?.name),
        title: cleanDisplayText(track?.title),
        language: inferredLanguage || normalizeTrackLanguageCode(rawLanguage) || String(rawLanguage || "").trim().toLowerCase(),
        lang: cleanDisplayText(rawLanguage),
        codec: cleanDisplayText(track?.codec || track?.audioCodec),
        codecs: cleanDisplayText(track?.codecs || track?.codec_id || track?.codec_tag_string),
        audioCodec: cleanDisplayText(track?.audioCodec || track?.codec),
        codecProfile: cleanDisplayText(track?.codecProfile || track?.profile || track?.codec_profile),
        mimeType: cleanDisplayText(track?.mimeType || track?.mime_type),
        sampleMimeType: cleanDisplayText(track?.sampleMimeType || track?.sample_mime_type),
        format: cleanDisplayText(track?.format || track?.format_name || track?.format_long_name),
        channels: track?.channels || track?.channelCount || "",
        channelCount: track?.channelCount || track?.channels || "",
        sampleRate: Number(track?.sampleRate || track?.audioSampleRate || track?.sample_rate || 0) || 0,
        raw: track
      };
    });
  },

  getUnavailableTrackMessage(kind = "audio") {
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (!usingAvPlay && this.isCurrentSourceLikelyMkv()) {
      if (kind === "subtitle") {
        return Environment.isWebOS()
          ? "No embedded subtitle tracks detected."
          : "MKV internal subtitles are not exposed by the webOS web player.";
      }
      return Environment.isWebOS()
        ? "No embedded audio tracks detected."
        : "MKV internal audio tracks are not exposed by the webOS web player.";
    }
    return kind === "subtitle"
      ? "No subtitle tracks available."
      : "No audio tracks available.";
  },

  getVideoTextTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.textTracks || video.webkitTextTracks || video.mozTextTracks || null;
  },

  getVideoAudioTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.audioTracks || video.webkitAudioTracks || video.mozAudioTracks || null;
  },

  collectStreamSidecarSubtitles(streamCandidate = this.getCurrentStreamCandidate()) {
    const mapSubtitles = (candidate) => {
      const stream = candidate?.raw || candidate || null;
      const rawSubtitles = Array.isArray(stream?.subtitles) ? stream.subtitles : [];
      return rawSubtitles
      .filter((subtitle) => Boolean(subtitle?.url))
      .map((subtitle, index) => ({
        id: subtitle.id || `${subtitle.lang || "unk"}-${index}-${subtitle.url}`,
        url: subtitle.url,
        lang: subtitle.lang || "unknown",
        addonName: candidate?.addonName || "Stream",
        addonLogo: candidate?.addonLogo || null
      }));
    };

    const current = mapSubtitles(streamCandidate);
    if (current.length) {
      return current;
    }

    return this.streamCandidates.reduce((items, candidate) => {
      const mapped = mapSubtitles(candidate);
      if (mapped.length) {
        items.push(...mapped);
      }
      return items;
    }, []);
  },

  mergeSubtitleCandidates(primary = [], secondary = []) {
    const merged = [];
    const seen = new Set();
    [...(primary || []), ...(secondary || [])].forEach((subtitle) => {
      if (!subtitle?.url) {
        return;
      }
      const key = `${String(subtitle.url).trim()}::${String(subtitle.lang || "").trim().toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(subtitle);
    });
    return merged;
  },

  getCurrentStreamRequestHeaders(streamCandidate = this.getCurrentStreamCandidate()) {
    const requestHeaders =
      streamCandidate?.raw?.behaviorHints?.proxyHeaders?.request ||
      streamCandidate?.behaviorHints?.proxyHeaders?.request;
    if (!requestHeaders || typeof requestHeaders !== "object") {
      return {};
    }
    return { ...requestHeaders };
  },

  parseHlsManifestTracks(manifestText, manifestUrl) {
    const lines = String(manifestText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const audioTracks = [];
    const subtitleTracks = [];
    const variants = [];
    let pendingVariantAttributes = null;

    lines.forEach((line) => {
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attributes = parseHlsAttributeList(line.slice("#EXT-X-MEDIA:".length));
        const mediaType = String(attributes.TYPE || "").toUpperCase();
        const groupId = String(attributes["GROUP-ID"] || "").trim();
        const name = String(attributes.NAME || attributes.LANGUAGE || "").trim();
        const language = String(attributes.LANGUAGE || "").trim();
        const channels = String(attributes.CHANNELS || "").trim();
        const characteristics = String(attributes.CHARACTERISTICS || "").trim();
        const uri = attributes.URI ? resolveUrl(manifestUrl, attributes.URI) : null;
        const isDefault = String(attributes.DEFAULT || "").toUpperCase() === "YES";
        const forced = String(attributes.FORCED || "").toUpperCase() === "YES";
        const autoselect = String(attributes.AUTOSELECT || "").toUpperCase() === "YES";
        const trackId = `${mediaType || "TRACK"}::${groupId || "main"}::${name || language || "default"}`;

        if (mediaType === "AUDIO") {
          audioTracks.push({
            id: trackId,
            groupId,
            name: name || `Audio ${audioTracks.length + 1}`,
            language,
            channels,
            characteristics,
            uri,
            isDefault,
            forced,
            autoselect
          });
          return;
        }

        if (mediaType === "SUBTITLES") {
          subtitleTracks.push({
            id: trackId,
            groupId,
            name: name || `Subtitle ${subtitleTracks.length + 1}`,
            language,
            characteristics,
            uri,
            isDefault,
            forced,
            autoselect
          });
          return;
        }
        return;
      }

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pendingVariantAttributes = parseHlsAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
        return;
      }

      if (line.startsWith("#")) {
        return;
      }

      if (!pendingVariantAttributes) {
        return;
      }

      variants.push({
        uri: resolveUrl(manifestUrl, line),
        audioGroupId: String(pendingVariantAttributes.AUDIO || "").trim() || null,
        subtitleGroupId: String(pendingVariantAttributes.SUBTITLES || "").trim() || null,
        codecs: String(pendingVariantAttributes.CODECS || "").trim(),
        bandwidth: Number(pendingVariantAttributes.BANDWIDTH || 0),
        resolution: String(pendingVariantAttributes.RESOLUTION || "").trim()
      });
      pendingVariantAttributes = null;
    });

    const codecsByAudioGroup = new Map();
    variants.forEach((variant) => {
      const groupId = cleanDisplayText(variant?.audioGroupId);
      const codecs = cleanDisplayText(variant?.codecs);
      if (!groupId || !codecs) {
        return;
      }
      const existing = codecsByAudioGroup.get(groupId) || [];
      if (!existing.includes(codecs)) {
        existing.push(codecs);
        codecsByAudioGroup.set(groupId, existing);
      }
    });
    audioTracks.forEach((track) => {
      const codecs = codecsByAudioGroup.get(cleanDisplayText(track?.groupId));
      if (codecs?.length) {
        track.codecs = codecs.join(", ");
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants
    };
  },

  parseDashManifestTracks(manifestText) {
    const parseErrorResult = {
      audioTracks: [],
      subtitleTracks: [],
      variants: []
    };

    const parser = typeof DOMParser === "function" ? new DOMParser() : null;
    if (!parser) {
      return parseErrorResult;
    }

    let xmlDocument = null;
    try {
      xmlDocument = parser.parseFromString(String(manifestText || ""), "application/xml");
    } catch (_) {
      return parseErrorResult;
    }
    if (!xmlDocument) {
      return parseErrorResult;
    }
    if (xmlDocument.getElementsByTagName("parsererror").length > 0) {
      return parseErrorResult;
    }

    const adaptationSets = Array.from(xmlDocument.getElementsByTagName("AdaptationSet"));
    if (!adaptationSets.length) {
      return parseErrorResult;
    }

    const audioTracks = [];
    const subtitleTracks = [];
    adaptationSets.forEach((adaptationSet, setIndex) => {
      const contentType = String(adaptationSet.getAttribute("contentType") || "").toLowerCase();
      const mimeType = String(adaptationSet.getAttribute("mimeType") || "").toLowerCase();
      const representation = adaptationSet.getElementsByTagName("Representation")[0] || null;
      const codecs = String(
        adaptationSet.getAttribute("codecs")
        || representation?.getAttribute("codecs")
        || ""
      ).toLowerCase();
      const roleValues = Array.from(adaptationSet.getElementsByTagName("Role"))
        .map((node) => String(node.getAttribute("value") || "").trim())
        .filter(Boolean);
      const accessibilityValues = Array.from(adaptationSet.getElementsByTagName("Accessibility"))
        .map((node) => String(node.getAttribute("value") || "").trim())
        .filter(Boolean);
      const audioChannelConfiguration = adaptationSet.getElementsByTagName("AudioChannelConfiguration")[0]
        || representation?.getElementsByTagName("AudioChannelConfiguration")?.[0]
        || null;
      const language = String(
        adaptationSet.getAttribute("lang")
        || representation?.getAttribute("lang")
        || ""
      ).trim();
      const label = String(
        adaptationSet.getAttribute("label")
        || representation?.getAttribute("label")
        || roleValues[0]
        || ""
      ).trim();
      const setId = String(adaptationSet.getAttribute("id") || setIndex).trim();
      const channels = String(audioChannelConfiguration?.getAttribute("value") || "").trim();
      const role = roleValues.join(" ");
      const accessibility = accessibilityValues.join(" ");

      const isAudio = contentType === "audio" || mimeType.startsWith("audio/");
      const isSubtitle = contentType === "text"
        || mimeType.startsWith("text/")
        || mimeType.includes("ttml")
        || mimeType.includes("vtt")
        || codecs.includes("stpp")
        || codecs.includes("wvtt");

      if (isAudio) {
        audioTracks.push({
          id: `DASH::AUDIO::${setId}::${language || label || audioTracks.length + 1}`,
          groupId: setId,
          name: label || `Audio ${audioTracks.length + 1}`,
          language,
          channels,
          role,
          accessibility,
          codecs,
          uri: null,
          isDefault: audioTracks.length === 0
        });
      } else if (isSubtitle) {
        subtitleTracks.push({
          id: `DASH::SUBTITLES::${setId}::${language || label || subtitleTracks.length + 1}`,
          groupId: setId,
          name: label || `Subtitle ${subtitleTracks.length + 1}`,
          language,
          role,
          accessibility,
          uri: null,
          isDefault: subtitleTracks.length === 0
        });
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants: []
    };
  },

  parseManifestTracks(manifestText, manifestUrl) {
    const text = String(manifestText || "");
    if (!text) {
      return { audioTracks: [], subtitleTracks: [], variants: [] };
    }
    if (text.includes("#EXTM3U")) {
      return this.parseHlsManifestTracks(text, manifestUrl);
    }
    if (/<\s*MPD[\s>]/i.test(text)) {
      return this.parseDashManifestTracks(text);
    }
    return { audioTracks: [], subtitleTracks: [], variants: [] };
  },

  async loadManifestTrackDataForCurrentStream(playbackUrl = this.activePlaybackUrl) {
    const currentCandidate = this.getCurrentStreamCandidate();
    const masterUrl = playbackUrl || currentCandidate?.url || "";
    const runtimeUrl = String(PlayerController.video?.currentSrc || "").trim();
    const loadToken = (this.manifestLoadToken || 0) + 1;
    this.manifestLoadToken = loadToken;
    this.manifestLoading = true;

    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = masterUrl;
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.refreshTrackDialogs();

    const probeUrl = masterUrl || runtimeUrl || playbackUrl || "";
    const probeMimeType = typeof PlayerController.guessMediaMimeType === "function"
      ? PlayerController.guessMediaMimeType(probeUrl)
      : null;
    const isAdaptiveManifest = (typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType))
      || (typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType));

    if (!isAdaptiveManifest) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    if (!masterUrl) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    try {
      const headers = this.getCurrentStreamRequestHeaders(currentCandidate);
      const manifestFetchTimeoutMs = 5000;
      const fetchManifestText = async (url, requestHeaders = {}) => {
        const requestController = typeof AbortController === "function" ? new AbortController() : null;
        let requestTimeoutId = null;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            requestTimeoutId = setTimeout(() => {
              try {
                requestController?.abort?.();
              } catch (_) {
                // Ignore abort failures.
              }
              reject(new Error("Manifest fetch timeout"));
            }, manifestFetchTimeoutMs);
          });
          const response = await Promise.race([
            fetch(url, {
              method: "GET",
              headers: requestHeaders,
              signal: requestController?.signal
            }),
            timeoutPromise
          ]);
          const text = await response.text();
          return {
            text,
            finalUrl: response.url || url
          };
        } finally {
          if (requestTimeoutId) {
            clearTimeout(requestTimeoutId);
          }
        }
      };

      const urlCandidates = uniqueNonEmptyValues([masterUrl, runtimeUrl, playbackUrl, this.activePlaybackUrl]);
      let selectedParsed = null;
      let selectedMasterUrl = masterUrl;

      for (const candidateUrl of urlCandidates) {
        let fetchedManifest = null;
        try {
          fetchedManifest = await fetchManifestText(candidateUrl, headers);
        } catch (_) {
          try {
            fetchedManifest = await fetchManifestText(candidateUrl, {});
          } catch (_) {
            fetchedManifest = null;
          }
        }

        if (loadToken !== this.manifestLoadToken) {
          return;
        }
        if (!fetchedManifest) {
          continue;
        }

        const parsed = this.parseManifestTracks(fetchedManifest.text, fetchedManifest.finalUrl || candidateUrl);
        const hasTracks = parsed.audioTracks.length || parsed.subtitleTracks.length;
        if (hasTracks) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
          break;
        }

        if (!selectedParsed && (parsed.variants.length > 0)) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
        }

        if (parsed.variants.length > 0) {
          const variant = parsed.variants[0];
          if (!variant?.uri) {
            continue;
          }
          try {
            const variantFetched = await fetchManifestText(variant.uri, headers);
            if (loadToken !== this.manifestLoadToken) {
              return;
            }
            const nestedParsed = this.parseManifestTracks(variantFetched.text, variantFetched.finalUrl || variant.uri);
            if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
              break;
            }
            if (!selectedParsed && nestedParsed.variants.length > 0) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
            }
          } catch (_) {
            try {
              const variantFetchedNoHeaders = await fetchManifestText(variant.uri, {});
              if (loadToken !== this.manifestLoadToken) {
                return;
              }
              const nestedParsed = this.parseManifestTracks(variantFetchedNoHeaders.text, variantFetchedNoHeaders.finalUrl || variant.uri);
              if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                break;
              }
              if (!selectedParsed && nestedParsed.variants.length > 0) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
              }
            } catch (_) {
              // Ignore nested manifest failures.
            }
          }
        }
      }

      if (!selectedParsed) {
        return;
      }

      this.manifestMasterUrl = selectedMasterUrl || masterUrl;
      this.manifestAudioTracks = selectedParsed.audioTracks;
      this.manifestSubtitleTracks = selectedParsed.subtitleTracks;
      this.manifestVariants = selectedParsed.variants;
      this.selectedManifestAudioTrackId = selectedParsed.audioTracks.find((track) => track.isDefault)?.id || selectedParsed.audioTracks[0]?.id || null;
      this.selectedManifestSubtitleTrackId = selectedParsed.subtitleTracks.find((track) => track.isDefault)?.id || null;
      this.refreshTrackDialogs();
      this.promoteHlsManifestSubtitlePlayback(selectedMasterUrl || masterUrl);
    } catch (_error) {
      // Ignore parsing failures on providers that block manifest fetch.
    } finally {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  promoteHlsManifestSubtitlePlayback(manifestUrl = this.manifestMasterUrl) {
    if (Environment.isTizen()) {
      return false;
    }
    const targetUrl = String(manifestUrl || this.activePlaybackUrl || "").trim();
    if (!targetUrl || !this.manifestSubtitleTracks.length) {
      return false;
    }
    if (String(PlayerController.playbackEngine || "") === "hls.js") {
      return false;
    }
    if (typeof PlayerController.canUseHlsJs !== "function" || !PlayerController.canUseHlsJs()) {
      return false;
    }
    if (this.hlsManifestSubtitlePromotionUrls.has(targetUrl)) {
      return false;
    }
    this.hlsManifestSubtitlePromotionUrls.add(targetUrl);
    void this.playStreamByUrl(targetUrl, {
      preservePanel: true,
      preservePlaybackState: true,
      resetSilentAudioState: false,
      forceEngine: "hls.js"
    });
    return true;
  },

  pickManifestVariant({ audioGroupId = null, subtitleGroupId = null } = {}) {
    if (!this.manifestVariants.length) {
      return null;
    }

    const byAudio = audioGroupId
      ? this.manifestVariants.filter((variant) => variant.audioGroupId === audioGroupId)
      : this.manifestVariants.slice();
    const candidatePool = byAudio.length ? byAudio : this.manifestVariants;

    let scopedCandidates = candidatePool;
    if (subtitleGroupId) {
      const bySubtitle = candidatePool.filter((variant) => variant.subtitleGroupId === subtitleGroupId);
      if (bySubtitle.length) {
        scopedCandidates = bySubtitle;
      }
    } else if (subtitleGroupId === null) {
      const withoutSubtitle = candidatePool.filter((variant) => !variant.subtitleGroupId);
      if (withoutSubtitle.length) {
        scopedCandidates = withoutSubtitle;
      }
    }

    const capabilityProbe = typeof PlayerController.getPlaybackCapabilities === "function"
      ? PlayerController.getPlaybackCapabilities()
      : null;
    const supports = (key, fallback = true) => {
      if (!capabilityProbe) {
        return fallback;
      }
      return Boolean(capabilityProbe[key]);
    };

    const scoreVariant = (variant) => {
      if (!variant) {
        return Number.NEGATIVE_INFINITY;
      }
      let score = 0;
      const codecs = String(variant.codecs || "").toLowerCase();
      const resolution = String(variant.resolution || "").toLowerCase();
      const bandwidth = Number(variant.bandwidth || 0);

      const resolutionMatch = resolution.match(/^(\d+)\s*x\s*(\d+)$/i);
      const width = Number(resolutionMatch?.[1] || 0);
      const height = Number(resolutionMatch?.[2] || 0);
      if (width >= 3840 || height >= 2160) score += 60;
      else if (width >= 1920 || height >= 1080) score += 40;
      else if (width >= 1280 || height >= 720) score += 20;
      else if (width > 0 || height > 0) score += 8;

      if (Number.isFinite(bandwidth) && bandwidth > 0) {
        score += Math.min(30, Math.round((bandwidth / 1000000) * 3));
      }

      if (codecs.includes("dvh1") || codecs.includes("dvhe")) {
        score += supports("dolbyVision", true) ? 18 : -100;
      }
      if (codecs.includes("hvc1") || codecs.includes("hev1")) {
        score += (supports("mp4Hevc", true) || supports("mp4HevcMain10", true)) ? 14 : -90;
      }
      if (codecs.includes("av01")) {
        score += supports("mp4Av1", true) ? 10 : -80;
      }
      if (codecs.includes("vp9")) {
        score += supports("webmVp9", true) ? 8 : -60;
      }
      if (codecs.includes("ec-3") || codecs.includes("eac3")) {
        score += supports("audioEac3", true) ? 10 : -50;
      }
      if (codecs.includes("ac-3") || codecs.includes("ac3")) {
        score += supports("audioAc3", true) ? 6 : -35;
      }

      return score;
    };

    return scopedCandidates
      .slice()
      .sort((left, right) => scoreVariant(right) - scoreVariant(left))[0] || null;
  },

  applyManifestTrackSelection({ audioTrackId, subtitleTrackId } = {}) {
    if (audioTrackId !== undefined) {
      this.selectedManifestAudioTrackId = audioTrackId;
    }
    if (subtitleTrackId !== undefined) {
      this.selectedManifestSubtitleTrackId = subtitleTrackId;
    }

    const selectedAudio = this.manifestAudioTracks.find((track) => track.id === this.selectedManifestAudioTrackId) || null;
    const selectedSubtitle = this.manifestSubtitleTracks.find((track) => track.id === this.selectedManifestSubtitleTrackId) || null;
    const variant = this.pickManifestVariant({
      audioGroupId: selectedAudio?.groupId || null,
      subtitleGroupId: selectedSubtitle ? (selectedSubtitle.groupId || null) : null
    });

    if (!variant?.uri) {
      this.refreshTrackDialogs();
      return;
    }

    const targetUrl = variant.uri;
    if (targetUrl === this.activePlaybackUrl) {
      this.refreshTrackDialogs();
      return;
    }

    const video = PlayerController.video;
    const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    const restorePaused = Boolean(this.paused || (!usingAvPlay && video?.paused));
    this.pendingPlaybackRestore = {
      timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
      paused: restorePaused,
      attempts: 0,
      lastAttemptAt: 0
    };

    this.activePlaybackUrl = targetUrl;
    const currentStreamCandidate = this.getCurrentStreamCandidate();
    this.paused = false;
    this.hasPresentedPlaybackFrame = false;
    this.startupPlaybackBaselineSeconds = null;
    this.startupPlaybackHasAdvanced = false;
    this.loadingVisible = true;
    this.loadingProgress = null;
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.loadingTorrentStatus = "";
    this.torrentOverlayData = null;
    this.syncLoadingOverlayProgress();
    this.syncTorrentOverlay();
    this.updateLoadingVisibility();
    this.enableStartupAudioGate();
    this.startPlayerControllerPlayback(
      targetUrl,
      this.buildPlaybackContext(currentStreamCandidate),
      { sourceCandidate: currentStreamCandidate }
    );
    this.schedulePlaybackStallGuard();
    this.setControlsVisible(true, { focus: false });
  },

  renderPlayerUi() {
    this.uiRefs = null;
    this.lastUiTickState = null;
    this.container.querySelector("#playerUiRoot")?.remove();

    const root = document.createElement("div");
    root.id = "playerUiRoot";
    root.className = "player-ui-root";
    root.tabIndex = -1;

    if (this.isExternalFrameMode()) {
      root.innerHTML = `
        <div class="player-external-frame-shell">
          <iframe
            class="player-external-frame"
            src="${escapeHtml(this.externalFrameUrl)}"
            title="${escapeHtml(this.params.playerTitle || "Trailer")}"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
            scrolling="no"
          ></iframe>
        </div>
      `;
    } else {
      const header = this.getPlayerHeaderData();
      const loadingMeta = this.getLoadingOverlayMeta();
      root.innerHTML = `
        <div id="playerLoadingOverlay" class="player-loading-overlay">
          <div class="player-loading-backdrop"${loadingMeta.backdropUrl ? ` style="background-image:url('${loadingMeta.backdropUrl}')"` : ""}></div>
          <div class="player-loading-gradient"></div>
          <div class="player-loading-center">
            <div class="player-loading-identity${loadingMeta.logoUrl ? " has-logo" : ""}">
              ${loadingMeta.logoUrl ? `
                <div class="player-loading-logo-stack">
                  <img class="player-loading-logo player-loading-logo-base" src="${escapeAttribute(loadingMeta.logoUrl)}" alt="${escapeAttribute(loadingMeta.title || "logo")}" />
                  <div class="player-loading-logo-fill-clip hidden">
                    <img class="player-loading-logo player-loading-logo-fill" src="${escapeAttribute(loadingMeta.logoUrl)}" alt="" aria-hidden="true" />
                  </div>
                </div>
              ` : ""}
              <div class="player-loading-title">${escapeHtml(loadingMeta.title || this.params.playerTitle || this.params.itemId || "Nuvio")}</div>
            </div>
            <div class="player-loading-subtitle${loadingMeta.subtitle ? "" : " hidden"}">${escapeHtml(loadingMeta.subtitle || "")}</div>
            <div class="player-loading-status hidden"></div>
          </div>
        </div>

        <div id="playerBufferingSpinner" class="player-loading-spinner hidden" aria-hidden="true">
          ${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}
          <div class="player-loading-status player-loading-spinner-status hidden"></div>
        </div>

        <div id="playerStartupErrorOverlay" class="player-startup-error-overlay hidden" aria-hidden="true"></div>

        <div id="playerTorrentOverlay" class="player-torrent-overlay hidden" aria-hidden="true">
          <div class="player-torrent-overlay-row">
            <span class="player-torrent-overlay-tag">P2P</span>
            <span class="player-torrent-overlay-speed"></span>
          </div>
          <div class="player-torrent-overlay-detail"></div>
        </div>

        <div id="playerParentalGuide" class="player-parental-guide hidden"></div>
        <div id="playerSkipIntro" class="player-skip-intro hidden"></div>

        <div id="playerAspectToast" class="player-aspect-toast hidden"></div>

        <div id="playerHtmlSubtitles" class="player-html-subtitles hidden" aria-hidden="true"></div>
        <canvas id="playerBitmapSubtitles" class="player-bitmap-subtitles hidden" aria-hidden="true"></canvas>

        <div id="playerSeekOverlay" class="player-seek-overlay hidden">
          <div class="player-seek-overlay-track"><div id="playerSeekFill" class="player-seek-fill"></div></div>
          <div class="player-seek-overlay-bottom">
            <span id="playerSeekDirection" class="player-seek-direction"></span>
            <span id="playerSeekPreview" class="player-seek-preview">0:00 / 0:00</span>
          </div>
        </div>

        <div id="playerPauseOverlay" class="player-pause-overlay hidden"></div>

        <div id="playerNextEpisodeCard" class="player-next-episode-card hidden"></div>

        <div id="playerModalBackdrop" class="player-modal-backdrop hidden"></div>
        <div id="playerSubtitleDialog" class="player-modal player-subtitle-modal hidden"></div>
        <div id="playerAudioDialog" class="player-modal player-audio-modal hidden"></div>
        <div id="playerSpeedDialog" class="player-modal player-speed-modal hidden"></div>
        <div id="playerSourcesPanel" class="player-sources-panel hidden"></div>

        <div id="playerControlsOverlay" class="player-controls-overlay">
          <div class="player-controls-gradient player-controls-gradient-top"></div>
          <div class="player-controls-gradient player-controls-gradient-bottom"></div>

          <div class="player-controls-top">
            <div id="playerClock" class="player-clock">--:--</div>
            <div id="playerEndsAt" class="player-ends-at">${escapeHtml(t("player_ends_at", ["--:--"], "Ends at %1$s"))}</div>
          </div>

          <div class="player-controls-bottom">
            <div class="player-meta">
              <div class="player-title">${escapeHtml(header.title)}</div>
              ${header.subtitle ? `<div class="player-subtitle">${escapeHtml(header.subtitle)}</div>` : ""}
              ${header.meta ? `<div class="player-meta-tertiary">${escapeHtml(header.meta)}</div>` : ""}
            </div>

            <div class="player-controls-bar">
              <div id="playerProgressShell" class="player-progress-shell focusable" tabindex="-1" data-player-pointer-action="progress">
                <div class="player-progress-track">
                  <div id="playerProgressBuffered" class="player-progress-buffered"></div>
                  <div id="playerProgressFill" class="player-progress-fill"></div>
                </div>
              </div>

              <div class="player-controls-row">
                <div id="playerControlButtons" class="player-control-buttons"></div>
                <div id="playerTimeLabel" class="player-time-label">0:00 / 0:00</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    this.container.appendChild(root);
    this.cachePlayerUiRefs(root);
    this.syncPlayerOverlayLayoutState();
    this.bindLoadingLogoFallback();
    if (!this.isExternalFrameMode()) {
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.renderParentalGuideOverlay();
      this.renderSkipIntroButton();
      this.renderSeekOverlay();
      this.renderPauseOverlay();
      this.renderNextEpisodeCard();
    }
  },

  cachePlayerUiRefs(root = null) {
    const uiRoot = root || this.container?.querySelector("#playerUiRoot");
    this.uiRefs = uiRoot ? {
      root: uiRoot,
      loadingOverlay: uiRoot.querySelector("#playerLoadingOverlay"),
      bufferingSpinner: uiRoot.querySelector("#playerBufferingSpinner"),
      startupErrorOverlay: uiRoot.querySelector("#playerStartupErrorOverlay"),
      torrentOverlay: uiRoot.querySelector("#playerTorrentOverlay"),
      torrentOverlaySpeed: uiRoot.querySelector("#playerTorrentOverlay .player-torrent-overlay-speed"),
      torrentOverlayDetail: uiRoot.querySelector("#playerTorrentOverlay .player-torrent-overlay-detail"),
      loadingIdentity: uiRoot.querySelector(".player-loading-identity"),
      loadingLogoStack: uiRoot.querySelector(".player-loading-logo-stack"),
      loadingLogoBase: uiRoot.querySelector(".player-loading-logo-base"),
      loadingLogoFillClip: uiRoot.querySelector(".player-loading-logo-fill-clip"),
      loadingLogoFill: uiRoot.querySelector(".player-loading-logo-fill"),
      loadingTitle: uiRoot.querySelector(".player-loading-title"),
      loadingSubtitle: uiRoot.querySelector(".player-loading-subtitle"),
      loadingStatus: uiRoot.querySelector("#playerLoadingOverlay .player-loading-status"),
      bufferingStatus: uiRoot.querySelector("#playerBufferingSpinner .player-loading-status"),
      parentalGuide: uiRoot.querySelector("#playerParentalGuide"),
      skipIntro: uiRoot.querySelector("#playerSkipIntro"),
      aspectToast: uiRoot.querySelector("#playerAspectToast"),
      htmlSubtitles: uiRoot.querySelector("#playerHtmlSubtitles"),
      bitmapSubtitles: uiRoot.querySelector("#playerBitmapSubtitles"),
      seekOverlay: uiRoot.querySelector("#playerSeekOverlay"),
      seekDirection: uiRoot.querySelector("#playerSeekDirection"),
      seekPreview: uiRoot.querySelector("#playerSeekPreview"),
      seekFill: uiRoot.querySelector("#playerSeekFill"),
      pauseOverlay: uiRoot.querySelector("#playerPauseOverlay"),
      nextEpisodeCard: uiRoot.querySelector("#playerNextEpisodeCard"),
      modalBackdrop: uiRoot.querySelector("#playerModalBackdrop"),
      subtitleDialog: uiRoot.querySelector("#playerSubtitleDialog"),
      audioDialog: uiRoot.querySelector("#playerAudioDialog"),
      speedDialog: uiRoot.querySelector("#playerSpeedDialog"),
      sourcesPanel: uiRoot.querySelector("#playerSourcesPanel"),
      controlsOverlay: uiRoot.querySelector("#playerControlsOverlay"),
      controlsBottom: uiRoot.querySelector(".player-controls-bottom"),
      progressShell: uiRoot.querySelector("#playerProgressShell"),
      clock: uiRoot.querySelector("#playerClock"),
      endsAt: uiRoot.querySelector("#playerEndsAt"),
      progressBuffered: uiRoot.querySelector("#playerProgressBuffered"),
      progressFill: uiRoot.querySelector("#playerProgressFill"),
      controlButtons: uiRoot.querySelector("#playerControlButtons"),
      timeLabel: uiRoot.querySelector("#playerTimeLabel"),
      startupErrorButton: uiRoot.querySelector("#playerStartupErrorOverlay .player-startup-error-button")
    } : null;
    this.lastUiTickState = {
      bufferedVisible: false,
      bufferedWidth: "",
      progressWidth: "",
      clockText: "",
      clockMinuteKey: "",
      endsAtText: "",
      endsAtMinuteBucket: null,
      timeLabelText: "",
      seekWidth: "",
      seekPreviewText: "",
      seekDirectionText: "",
      progressFocused: false
    };
    this.refreshLoadingOverlayPresentation();
    this.renderStartupErrorOverlay();
  },

  getLoadingOverlayMeta() {
    const transition = this.nextEpisodeTransitionMeta || null;
    return {
      title: String(transition?.title || this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Nuvio").trim(),
      subtitle: String(transition?.subtitle || this.params?.playerSubtitle || "").trim(),
      logoUrl: String(transition?.logoUrl || this.params?.playerLogoUrl || "").trim(),
      backdropUrl: String(transition?.backdropUrl || this.params?.playerBackdropUrl || "").trim()
    };
  },

  refreshLoadingOverlayPresentation() {
    const overlay = this.uiRefs?.loadingOverlay;
    if (!overlay) {
      return;
    }
    const loadingMeta = this.getLoadingOverlayMeta();
    const identity = this.uiRefs?.loadingIdentity;
    const logo = this.uiRefs?.loadingLogo;
    const title = this.uiRefs?.loadingTitle;
    const subtitle = this.uiRefs?.loadingSubtitle;
    if (identity) {
      identity.classList.toggle("has-logo", Boolean(loadingMeta.logoUrl));
    }
    if (logo) {
      if (loadingMeta.logoUrl) {
        if (logo.getAttribute("src") !== loadingMeta.logoUrl) {
          logo.setAttribute("src", loadingMeta.logoUrl);
        }
        logo.setAttribute("alt", loadingMeta.title || "logo");
      } else {
        logo.removeAttribute("src");
      }
    }
    if (title) {
      title.textContent = loadingMeta.title || this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Nuvio";
    }
    if (subtitle) {
      subtitle.textContent = loadingMeta.subtitle || "";
      subtitle.classList.toggle("hidden", !loadingMeta.subtitle);
    }
    const backdrop = overlay.querySelector(".player-loading-backdrop");
    if (backdrop instanceof HTMLElement) {
      backdrop.style.backgroundImage = loadingMeta.backdropUrl ? `url('${loadingMeta.backdropUrl.replace(/'/g, "%27")}')` : "";
    }
    this.syncLoadingOverlayStatus();
    this.syncLoadingOverlayProgress();
  },

  getLoadingOverlayProgress(stats = null) {
    const snapshot = stats ? this.getEngineFsStallSnapshot(stats) : null;
    if (!snapshot) {
      return null;
    }
    const directProgress = Number(snapshot.progress);
    if (Number.isFinite(directProgress) && directProgress > 0) {
      if (directProgress <= 1) {
        return clamp(directProgress, 0, 1);
      }
      if (directProgress <= 100) {
        return clamp(directProgress / 100, 0, 1);
      }
    }
    const downloaded = Number(snapshot.downloaded);
    if (Number.isFinite(downloaded) && downloaded > 0) {
      return clamp(downloaded / (4 * 1024 * 1024), 0, 1);
    }
    return null;
  },

  getLoadingOverlayStatusText(stats = null) {
    if (!this.currentEngineFsStream || TorrentSettingsStore.get().hideTorrentStats) {
      return "";
    }
    const snapshot = stats ? this.getEngineFsStallSnapshot(stats) : null;
    if (!snapshot) {
      return "";
    }
    const peers = Number.isFinite(Number(snapshot.peers)) ? Math.max(0, Math.trunc(Number(snapshot.peers))) : 0;
    const seeds = Number.isFinite(Number(snapshot.seeds)) ? Math.max(0, Math.trunc(Number(snapshot.seeds))) : null;
    const peerInfo = seeds != null
      ? t("player_torrent_peer_info", [seeds, peers], `${seeds} seeds · ${peers} peers`)
      : `${peers} peers`;
    const speed = formatBytesPerSecond(snapshot.downloadSpeed);
    if (!this.hasPresentedPlaybackFrame) {
      const buffered = formatBytes(snapshot.downloaded) || "0 B";
      return `${buffered} buffered · ${peerInfo}${speed ? ` · ${speed}` : ""}`;
    }
    return `${peerInfo}${speed ? ` · ${speed}` : ""}`;
  },

  getTorrentOverlayData(stats = null) {
    // These TV runtimes expose P2P/EngineFS stats through the runtime,
    // so the overlay stays shared across WebOS and Tizen.
    const supportsP2pStatsOverlay = Environment.isWebOS() || Environment.isTizen();
    if (!supportsP2pStatsOverlay || !this.currentEngineFsStream || TorrentSettingsStore.get().hideTorrentStats || this.isExternalFrameMode() || this.error) {
      return null;
    }
    const snapshot = stats ? this.getEngineFsStallSnapshot(stats) : null;
    if (!snapshot) {
      return null;
    }
    const downloadSpeed = formatBytesPerSecond(snapshot.downloadSpeed);
    const uploadSpeed = formatBytesPerSecond(snapshot.uploadSpeed);
    const peers = Number.isFinite(Number(snapshot.peers)) ? Math.max(0, Math.trunc(Number(snapshot.peers))) : 0;
    const seeds = Number.isFinite(Number(snapshot.seeds)) ? Math.max(0, Math.trunc(Number(snapshot.seeds))) : null;
    const progress = Number(snapshot.progress);
    const progressPercent = Number.isFinite(progress) && progress > 0
      ? (progress <= 1 ? progress * 100 : progress <= 100 ? progress : null)
      : null;
    const detailText = seeds != null && progressPercent != null
      ? t("player_torrent_stats", [peers, seeds, Math.round(progressPercent)], `${peers} peers · ${seeds} seeds · ${Math.round(progressPercent)}%`)
      : progressPercent != null
        ? t("player_torrent_status", [`${peers} peers`, `${Math.round(progressPercent)}%`], `${peers} peers · ${Math.round(progressPercent)}%`)
        : (seeds != null
          ? t("player_torrent_peer_info", [seeds, peers], `${seeds} seeds · ${peers} peers`)
          : `${peers} peers`);
    const speedParts = [];
    if (downloadSpeed) {
      speedParts.push(`↓ ${downloadSpeed}`);
    }
    if (uploadSpeed) {
      speedParts.push(`↑ ${uploadSpeed}`);
    }
    return {
      speedText: speedParts.join(" · "),
      detailText
    };
  },

  syncTorrentOverlay() {
    const overlay = this.uiRefs?.torrentOverlay;
    const speedNode = this.uiRefs?.torrentOverlaySpeed;
    const detailNode = this.uiRefs?.torrentOverlayDetail;
    const data = this.torrentOverlayData;
    const visible = Boolean(data);
    if (overlay) {
      overlay.classList.toggle("hidden", !visible);
      overlay.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    if (speedNode) {
      speedNode.textContent = data?.speedText || "";
      speedNode.classList.toggle("hidden", !data?.speedText);
    }
    if (detailNode) {
      detailNode.textContent = data?.detailText || "";
      detailNode.classList.toggle("hidden", !data?.detailText);
    }
  },

  syncLoadingOverlayStatus() {
    const loadingStatus = this.uiRefs?.loadingStatus;
    const bufferingStatus = this.uiRefs?.bufferingStatus;
    const subtitle = this.uiRefs?.loadingSubtitle;
    const statusText = String(this.loadingTorrentStatus || "").trim();
    const hasStatus = Boolean(statusText);
    const hasSubtitle = Boolean(subtitle?.textContent?.trim());
    if (loadingStatus) {
      loadingStatus.textContent = statusText;
      loadingStatus.classList.toggle("hidden", !hasStatus);
    }
    if (bufferingStatus) {
      bufferingStatus.textContent = statusText;
      bufferingStatus.classList.toggle("hidden", !hasStatus);
    }
    if (subtitle) {
      subtitle.classList.toggle("hidden", !hasSubtitle || hasStatus);
    }
  },

  isStartupErrorVisible() {
    return Boolean(String(this.startupErrorMessage || "").trim());
  },

  clearStartupError() {
    this.startupErrorMessage = "";
    this.startupErrorMediaCode = 0;
    this.startupErrorDetails = [];
    this.renderStartupErrorOverlay();
  },

  getPlaybackErrorCodeLabel(mediaErrorCode = 0) {
    const code = Number(mediaErrorCode || 0);
    if (code === 1) return "1 aborted";
    if (code === 2) return "2 network";
    if (code === 3) return "3 decode";
    if (code === 4) return "4 source not supported";
    return code > 0 ? String(code) : "";
  },

  getPlaybackEventErrorDetail(eventDetail = {}) {
    const detail = eventDetail && typeof eventDetail === "object" ? eventDetail : {};
    return [
      detail.avplayError,
      detail.hlsErrorType,
      detail.hlsErrorDetails,
      detail.dashError,
      detail.playbackEngine
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  },

  getHttpPlaybackErrorMessage(statusCode = 0) {
    const status = Number(statusCode || 0);
    if (status < 400 || status > 599) {
      return "";
    }
    const providerHint = status === 403
      ? t("player_error_stream_blocked", {}, "\n\nThe stream source is blocked or restricted. Try a different source.")
      : status === 404
        ? t("player_error_stream_removed", {}, "\n\nThe stream link has expired or been removed. Try a different source.")
        : status === 410
          ? t("player_error_stream_expired", {}, "\n\nThe stream link has expired. Try a different source.")
          : status === 429
            ? t("player_error_stream_rate_limited", {}, "\n\nToo many requests to the stream source. Wait a moment and try again.")
            : [500, 502, 503].includes(status)
              ? t("player_error_stream_unavailable", {}, "\n\nThe stream server is currently unavailable. Try a different source.")
              : "";
    return `HTTP ${status}${providerHint}`;
  },

  getWebHeaderRestrictedStreamMessage(streamCandidate = this.getCurrentStreamCandidate()) {
    const candidate = streamCandidate || {};
    const raw = candidate?.raw || {};
    const rawBehaviorHints = raw?.behaviorHints || {};
    const candidateBehaviorHints = candidate?.behaviorHints || {};
    const requestHeaders = rawBehaviorHints?.proxyHeaders?.request
      || candidateBehaviorHints?.proxyHeaders?.request;
    const notWebReadyValue = rawBehaviorHints?.notWebReady
      ?? candidateBehaviorHints?.notWebReady;
    const notWebReady = notWebReadyValue === true
      || String(notWebReadyValue || "").trim().toLowerCase() === "true";
    const hasRequiredHeaders = requestHeaders
      && typeof requestHeaders === "object"
      && Object.entries(requestHeaders).some(([name, value]) => (
        String(name || "").trim() && String(value ?? "").trim()
      ));
    if (!notWebReady || !hasRequiredHeaders) {
      return "";
    }
    return t(
      "player_error_web_headers_unsupported",
      {},
      "This source is not compatible with this device's player because it requires special request headers. Try a different source or contact the add-on provider."
    );
  },

  getPlaybackErrorDetailLines({
    mediaErrorCode = 0,
    detail = "",
    error = null,
    eventDetail = null,
    streamCandidate = null,
    playbackUrl = "",
    reason = "",
    resolverStatus = "",
    resolverDetail = ""
  } = {}) {
    const lines = [];
    const video = PlayerController.video || null;
    const candidate = streamCandidate || this.getStreamCandidateByUrl(playbackUrl || this.activePlaybackUrl) || this.getCurrentStreamCandidate();
    const raw = candidate?.raw || {};
    const requestHeaders = raw?.behaviorHints?.proxyHeaders?.request || candidate?.behaviorHints?.proxyHeaders?.request || null;
    const headerNames = requestHeaders && typeof requestHeaders === "object"
      ? Object.keys(requestHeaders).filter(Boolean).join(", ")
      : "";
    const engineFs = candidate?.engineFs || raw?.engineFs || this.currentEngineFsStream || null;
    const mediaError = video?.error || null;
    const eventErrorDetail = this.getPlaybackEventErrorDetail(eventDetail);
    const httpStatus = extractPlaybackHttpStatus([
      detail,
      eventErrorDetail,
      error?.message,
      error?.name,
      error?.errorText,
      error?.status
    ].filter(Boolean).join(" "));
    const runtimeDetail = detail
      || eventErrorDetail
      || error?.message
      || error?.name
      || error?.errorText
      || error?.status
      || "";
    const sourceLabel = [
      candidate?.addonName,
      candidate?.name || candidate?.title || candidate?.description,
      candidate?.id
    ].filter(Boolean).join(" / ");
    const sourceType = [
      candidate?.mimeType,
      raw?.mimeType,
      candidate?.sourceType,
      raw?.sourceType,
      raw?.type
    ].find(Boolean);
    const activeUrl = playbackUrl || this.activePlaybackUrl || candidate?.url || candidate?.externalUrl || raw?.url || raw?.externalUrl || "";

    pushPlaybackDiagnosticLine(lines, "Platform", Environment.isWebOS() ? "webOS" : Environment.isTizen() ? "Tizen" : "browser");
    pushPlaybackDiagnosticLine(lines, "Reason", reason);
    pushPlaybackDiagnosticLine(lines, "Media code", this.getPlaybackErrorCodeLabel(mediaErrorCode));
    pushPlaybackDiagnosticLine(lines, "HTTP status", httpStatus);
    pushPlaybackDiagnosticLine(lines, "Runtime error", runtimeDetail);
    pushPlaybackDiagnosticLine(lines, "HLS error", eventDetail?.hlsErrorDetails || eventDetail?.hlsErrorType);
    pushPlaybackDiagnosticLine(lines, "DASH error", eventDetail?.dashError);
    pushPlaybackDiagnosticLine(lines, "AVPlay error", eventDetail?.avplayError);
    pushPlaybackDiagnosticLine(lines, "HTML media error", mediaError?.message || mediaError?.code);
    pushPlaybackDiagnosticLine(lines, "Video readyState", video?.readyState);
    pushPlaybackDiagnosticLine(lines, "Video networkState", video?.networkState);
    pushPlaybackDiagnosticLine(lines, "Current src", video?.currentSrc || video?.src, 420);
    pushPlaybackDiagnosticLine(lines, "Playback engine", PlayerController.playbackEngine || "unknown");
    pushPlaybackDiagnosticLine(lines, "Source", sourceLabel);
    pushPlaybackDiagnosticLine(lines, "Source type", sourceType);
    pushPlaybackDiagnosticLine(lines, "URL", activeUrl, 420);
    pushPlaybackDiagnosticLine(lines, "Proxy header names", headerNames);
    pushPlaybackDiagnosticLine(lines, "Resolver status", resolverStatus);
    pushPlaybackDiagnosticLine(lines, "Resolver detail", resolverDetail);
    if (engineFs) {
      pushPlaybackDiagnosticLine(lines, "EngineFS infoHash", engineFs.infoHash);
      pushPlaybackDiagnosticLine(lines, "EngineFS fileIdx", engineFs.fileIdx);
      pushPlaybackDiagnosticLine(lines, "EngineFS base", engineFs.baseUrlKind);
      pushPlaybackDiagnosticLine(lines, "EngineFS playbackUrl", engineFs.playbackUrl || engineFs.url, 420);
      pushPlaybackDiagnosticLine(lines, "EngineFS publicUrl", engineFs.publicPlaybackUrl, 420);
    }
    return lines;
  },

  formatPlaybackErrorForSources(message = "", options = {}) {
    const baseMessage = String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
    const detailLines = this.getPlaybackErrorDetailLines(options);
    return detailLines.length
      ? `${baseMessage}\n\nDetails\n${detailLines.join("\n")}`
      : baseMessage;
  },

  showStartupError(message = "", { mediaErrorCode = 0, detail = "", error = null, eventDetail = null, streamCandidate = null, playbackUrl = "", reason = "", resolverStatus = "", resolverDetail = "", details = null } = {}) {
    this.startupErrorMessage = String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
    this.startupErrorMediaCode = Number(mediaErrorCode || 0);
    this.startupErrorDetails = Array.isArray(details)
      ? details.map((line) => cleanPlaybackDiagnosticValue(line)).filter(Boolean)
      : this.getPlaybackErrorDetailLines({
        mediaErrorCode,
        detail,
        error,
        eventDetail,
        streamCandidate,
        playbackUrl,
        reason,
        resolverStatus,
        resolverDetail
      });
    this.lastPlaybackErrorAt = 0;
    this.loadingVisible = false;
    this.loadingProgress = null;
    this.loadingTorrentStatus = "";
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.stopLoadingLogoFillAnimation();
    this.clearPlaybackStallGuard();
    this.clearBufferingSpinnerTimer();
    this.releaseStartupAudioGate({ resume: false });
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourcesPanelVisible = false;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.episodePanelVisible = false;
    this.moreActionsVisible = false;
    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.pauseOverlayVisible = false;
    this.updateLoadingVisibility();
    this.renderControlButtons();
    this.renderSourcesPanel();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderEpisodePanel();
    this.renderPauseOverlay();
    this.renderStartupErrorOverlay();
    this.focusStartupErrorButton();
  },

  startPlayerControllerPlayback(url, context = {}, { mountToken = null, sourceCandidate = null } = {}) {
    const playbackUrl = String(url || "").trim();
    if (!playbackUrl) {
      this.showStartupError(t("player_error_no_stream_url", {}, "No stream URL provided"), {
        streamCandidate: sourceCandidate,
        reason: "missing-url"
      });
      return;
    }
    PlayerController.setStartupPresentationAudioMuted?.(true);
    return Promise.resolve(PlayerController.play(playbackUrl, context)).catch((error) => {
      if (!this.isActiveMountToken(mountToken) || this.isExternalFrameMode()) {
        return;
      }
      if (playbackUrl !== String(this.activePlaybackUrl || "").trim()) {
        return;
      }
      if (this.isStartupErrorVisible()) {
        return;
      }
      const mediaErrorCode = typeof PlayerController.getLastPlaybackErrorCode === "function"
        ? Number(PlayerController.getLastPlaybackErrorCode() || 0)
        : 0;
      const detail = String(error?.message || error?.name || error || "").trim();
      const candidate = sourceCandidate || this.getStreamCandidateByUrl(playbackUrl) || this.getCurrentStreamCandidate();
      this.markPlaybackSourceFailed(playbackUrl);
      if (!this.hasPresentedPlaybackFrame) {
        this.showStartupError(this.getStartupErrorMessage(mediaErrorCode, detail, candidate), {
          mediaErrorCode,
          detail,
          error,
          streamCandidate: candidate,
          playbackUrl,
          reason: "play-start"
        });
        console.warn("Playback failed to start", {
          url: playbackUrl,
          mediaErrorCode,
          error
        });
        return;
      }
      this.sourcesError = this.formatPlaybackErrorForSources(
        `${this.mediaErrorMessage(mediaErrorCode, detail, candidate)}. Choose another source manually.`,
        {
          mediaErrorCode,
          detail,
          error,
          streamCandidate: candidate,
          playbackUrl,
          reason: "play-after-startup"
        }
      );
      this.renderSourcesPanel();
      console.warn("Playback failed after startup", {
        url: playbackUrl,
        mediaErrorCode,
        error
      });
    });
  },

  getStartupErrorMessage(mediaErrorCode = 0, detail = "", streamCandidate = this.getCurrentStreamCandidate()) {
    const code = Number(mediaErrorCode || 0);
    const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
    if (compatibilityMessage && (code === 0 || code === 2 || code === 4)) {
      return compatibilityMessage;
    }
    const baseMessage = this.mediaErrorMessage(code, detail, streamCandidate);
    const extra = String(detail || "").trim();
    if (!extra || (code === 4 && this.isDebridPlaybackCandidate(streamCandidate))) {
      return `${baseMessage}.`;
    }
    const normalizedExtra = extra.replace(/\s+/g, " ");
    if (baseMessage.toLowerCase().includes(normalizedExtra.toLowerCase())) {
      return baseMessage;
    }
    return `${baseMessage}. ${normalizedExtra}`;
  },

  focusStartupErrorButton() {
    const button = this.uiRefs?.startupErrorButton;
    if (button?.focus) {
      button.focus();
    }
    button?.classList?.add("focused");
  },

  renderStartupErrorOverlay() {
    const overlay = this.uiRefs?.startupErrorOverlay;
    if (!overlay) {
      return;
    }
    const visible = this.isStartupErrorVisible();
    overlay.classList.toggle("hidden", !visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      overlay.innerHTML = "";
      return;
    }
    const message = String(this.startupErrorMessage || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
    const detailLines = Array.isArray(this.startupErrorDetails) ? this.startupErrorDetails.filter(Boolean) : [];
    overlay.innerHTML = `
      <div class="player-startup-error-shell">
        <div class="player-startup-error-title">${escapeHtml(t("player_error_title", {}, "Playback Error"))}</div>
        <div class="player-startup-error-message">${escapeHtml(message)}</div>
        ${detailLines.length ? `
          <div class="player-startup-error-details" aria-label="${escapeHtml(t("player_error_details", {}, "Playback error details"))}">
            ${detailLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
          </div>
        ` : ""}
        <button class="player-startup-error-button focusable focused" type="button" tabindex="-1" data-player-error-action="back">
          ${escapeHtml(t("player_go_back", {}, "Go Back"))}
        </button>
      </div>
    `;
    this.uiRefs = {
      ...(this.uiRefs || {}),
      startupErrorButton: overlay.querySelector(".player-startup-error-button")
    };
  },

  shouldUseLoadingLogoFill() {
    return Boolean(this.currentEngineFsStream && !this.isExternalFrameMode());
  },

  stopLoadingLogoFillAnimation() {
    if (this.loadingLogoFillFrame != null) {
      clearTimeout(this.loadingLogoFillFrame);
      this.loadingLogoFillFrame = null;
    }
  },

  scheduleLoadingLogoFillAnimation() {
    if (this.loadingLogoFillFrame != null || !this.loadingLogoFillActive) {
      return;
    }
    this.loadingLogoFillFrame = setTimeout(() => {
      this.loadingLogoFillFrame = null;
      if (!this.loadingLogoFillActive) {
        return;
      }
      const current = clamp(Number(this.loadingLogoFillProgress || 0), 0, 1);
      const target = clamp(Number(this.loadingLogoFillTarget ?? current), current, 1);
      if (current >= 1 || target <= current) {
        this.syncLoadingOverlayProgress();
        return;
      }
      const distance = target - current;
      const step = Math.max(LOADING_LOGO_FILL_IDLE_STEP, distance * LOADING_LOGO_FILL_TARGET_LERP);
      this.loadingLogoFillProgress = Math.min(target, current + step);
      this.syncLoadingOverlayProgress();
      if (this.loadingLogoFillProgress < target) {
        this.scheduleLoadingLogoFillAnimation();
      }
    }, LOADING_LOGO_FILL_FRAME_MS);
  },

  setLoadingLogoFillTarget(progress = null, { immediate = false } = {}) {
    if (!this.shouldUseLoadingLogoFill()) {
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      this.syncLoadingOverlayProgress();
      return;
    }
    const parsed = Number(progress);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const current = clamp(Number(this.loadingLogoFillProgress || 0), 0, 1);
    const target = clamp(parsed, current, 1);
    this.loadingLogoFillActive = true;
    this.loadingLogoFillTarget = Math.max(Number(this.loadingLogoFillTarget || 0), target);
    if (immediate) {
      this.loadingLogoFillProgress = Math.max(current, target);
    }
    this.syncLoadingOverlayProgress();
    this.scheduleLoadingLogoFillAnimation();
  },

  syncLoadingOverlayProgress() {
    const identity = this.uiRefs?.loadingIdentity;
    const stack = this.uiRefs?.loadingLogoStack;
    const base = this.uiRefs?.loadingLogoBase;
    const fillClip = this.uiRefs?.loadingLogoFillClip;
    if (this.isStartupErrorVisible()) {
      if (identity) {
        identity.classList.remove("is-loading-progress");
      }
      if (stack) {
        stack.classList.remove("is-loading-progress");
      }
      if (base) {
        base.style.opacity = "";
      }
      if (fillClip) {
        fillClip.classList.add("hidden");
        fillClip.style.width = "0%";
      }
      return;
    }
    if (!this.shouldUseLoadingLogoFill()) {
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      if (identity) {
        identity.classList.remove("is-loading-progress");
      }
      if (stack) {
        stack.classList.remove("is-loading-progress");
      }
      if (base) {
        base.style.opacity = "";
      }
      if (fillClip) {
        fillClip.classList.add("hidden");
        fillClip.style.width = "0%";
      }
      return;
    }
    const progress = Number(this.loadingProgress);
    const hasProgress = Number.isFinite(progress) && progress > 0;
    if (hasProgress) {
      this.loadingLogoFillActive = true;
      this.loadingLogoFillTarget = Math.max(
        Number(this.loadingLogoFillTarget || 0),
        clamp(progress, 0, 1)
      );
    }
    if (this.currentEngineFsStream && this.hasPresentedPlaybackFrame && !this.isExternalFrameMode()) {
      this.loadingLogoFillActive = true;
      this.loadingLogoFillTarget = 1;
    }
    const showFill = Boolean(this.loadingLogoFillActive);
    if (identity) {
      identity.classList.toggle("is-loading-progress", showFill);
    }
    if (stack) {
      stack.classList.toggle("is-loading-progress", showFill);
    }
    if (base) {
      base.style.opacity = showFill ? "0.25" : "";
    }
    if (fillClip) {
      fillClip.classList.toggle("hidden", !showFill);
      if (showFill) {
        const visiblePercent = Math.round(clamp(this.loadingLogoFillProgress || 0, 0, 1) * 10000) / 100;
        fillClip.style.width = `${visiblePercent}%`;
      } else {
        fillClip.style.width = "0%";
      }
    }
    if (showFill && clamp(Number(this.loadingLogoFillProgress || 0), 0, 1) < clamp(Number(this.loadingLogoFillTarget || 0), 0, 1)) {
      this.scheduleLoadingLogoFillAnimation();
    }
  },

  async refreshLoadingOverlayProgress() {
    if (this.isStartupErrorVisible()) {
      return;
    }
    if (this.loadingProgressRefreshInFlight) {
      return;
    }
    const canShowLoadingProgress = Boolean(
      this.loadingVisible
      && this.currentEngineFsStream
      && !this.hasPresentedPlaybackFrame
      && !this.isExternalFrameMode()
    );
    const canShowTorrentOverlay = Boolean(
      this.currentEngineFsStream
      && !this.isExternalFrameMode()
      && !TorrentSettingsStore.get().hideTorrentStats
    );
    if (!canShowLoadingProgress && !canShowTorrentOverlay) {
      if (this.loadingProgress != null) {
        this.loadingProgress = null;
        this.loadingLogoFillTarget = 0;
        this.stopLoadingLogoFillAnimation();
        this.syncLoadingOverlayProgress();
      }
      if (this.loadingTorrentStatus) {
        this.loadingTorrentStatus = "";
        this.syncLoadingOverlayStatus();
      }
      if (this.torrentOverlayData) {
        this.torrentOverlayData = null;
        this.syncTorrentOverlay();
      }
      return;
    }

    this.loadingProgressRefreshInFlight = true;
    try {
      const stats = await this.fetchCurrentEngineFsStats({ timeoutMs: 1200 });
      if (
        !this.currentEngineFsStream
        || this.isExternalFrameMode()
        || this.isStartupErrorVisible()
      ) {
        if (this.loadingProgress != null) {
          this.loadingProgress = null;
          this.loadingLogoFillTarget = 0;
          this.stopLoadingLogoFillAnimation();
          this.syncLoadingOverlayProgress();
        }
        if (this.loadingTorrentStatus) {
          this.loadingTorrentStatus = "";
          this.syncLoadingOverlayStatus();
        }
        if (this.torrentOverlayData) {
          this.torrentOverlayData = null;
          this.syncTorrentOverlay();
        }
        return;
      }
      const nextProgress = canShowLoadingProgress ? this.getLoadingOverlayProgress(stats) : null;
      if (nextProgress != null && nextProgress !== this.loadingProgress) {
        this.loadingProgress = nextProgress;
        this.syncLoadingOverlayProgress();
      } else if (!canShowLoadingProgress && this.loadingProgress != null) {
        this.loadingProgress = null;
        this.loadingLogoFillTarget = 0;
        this.stopLoadingLogoFillAnimation();
        this.syncLoadingOverlayProgress();
      }
      const nextStatus = this.getLoadingOverlayStatusText(stats);
      if (nextStatus !== this.loadingTorrentStatus) {
        this.loadingTorrentStatus = nextStatus;
        this.syncLoadingOverlayStatus();
      }
      const nextTorrentOverlay = canShowTorrentOverlay ? this.getTorrentOverlayData(stats) : null;
      if (JSON.stringify(nextTorrentOverlay) !== JSON.stringify(this.torrentOverlayData)) {
        this.torrentOverlayData = nextTorrentOverlay;
        this.syncTorrentOverlay();
      }
    } finally {
      this.loadingProgressRefreshInFlight = false;
    }
  },

  bindLoadingLogoFallback() {
    const identity = this.uiRefs?.loadingIdentity;
    const logo = this.uiRefs?.loadingLogoBase;
    const fill = this.uiRefs?.loadingLogoFill;
    if (!identity || !logo) {
      return;
    }

    const showLogo = () => {
      identity.classList.add("logo-loaded");
      identity.classList.remove("logo-failed");
      if (fill && logo.getAttribute("src")) {
        fill.setAttribute("src", logo.getAttribute("src"));
      }
      this.syncLoadingOverlayProgress();
    };
    const showTitleFallback = () => {
      identity.classList.add("logo-failed");
      identity.classList.remove("logo-loaded");
      if (fill) {
        fill.removeAttribute("src");
      }
      this.loadingProgress = null;
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      this.loadingTorrentStatus = "";
      this.torrentOverlayData = null;
      this.syncLoadingOverlayProgress();
      this.syncLoadingOverlayStatus();
      this.syncTorrentOverlay();
    };

    logo.addEventListener("load", showLogo, { once: true });
    logo.addEventListener("error", showTitleFallback, { once: true });

    if (logo.complete) {
      if (logo.naturalWidth > 0 && logo.naturalHeight > 0) {
        showLogo();
      } else {
        showTitleFallback();
      }
    }
  },

  getPlayerUiState() {
    const header = this.getPlayerHeaderData();
    return {
      isPlaying: !this.paused,
      isBuffering: Boolean(this.loadingVisible),
      currentPosition: Math.round(this.getPlaybackCurrentSeconds() * 1000),
      duration: Math.round(this.getPlaybackDurationSeconds() * 1000),
      title: header.title,
      currentSeason: this.params?.season == null ? null : Number(this.params.season),
      currentEpisode: this.params?.episode == null ? null : Number(this.params.episode),
      currentEpisodeTitle: this.getDisplayEpisodeTitle() || null,
      releaseYear: header.meta || null,
      currentStreamName: this.getCurrentStreamCandidate()?.label || null,
      currentStreamUrl: this.getCurrentStreamCandidate()?.url || null,
      showControls: Boolean(this.controlsVisible),
      showSeekOverlay: Boolean(this.seekOverlayVisible),
      pendingPreviewSeekPosition: this.seekPreviewSeconds == null ? null : Math.round(Number(this.seekPreviewSeconds || 0) * 1000),
      playbackSpeed: this.getPlaybackSpeed(),
      showAudioOverlay: Boolean(this.audioDialogVisible),
      showSubtitleOverlay: Boolean(this.subtitleDialogVisible),
      subtitleDelayMs: Number(this.subtitleDelayMs || 0),
      subtitleStyle: { ...this.subtitleStyleSettings },
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      isAudioAmplificationAvailable: Boolean(this.audioAmplificationAvailable),
      persistAudioAmplification: Boolean(this.persistAudioAmplification),
      showPauseOverlay: Boolean(this.pauseOverlayVisible),
      showEpisodesPanel: Boolean(this.episodePanelVisible),
      episodesAll: Array.isArray(this.episodes) ? this.episodes : [],
      showSourcesPanel: Boolean(this.sourcesPanelVisible),
      isLoadingSourceStreams: Boolean(this.sourcesLoading),
      sourceStreamsError: this.sourcesError || null,
      sourceAllStreams: Array.isArray(this.streamCandidates) ? this.streamCandidates : [],
      sourceSelectedAddonFilter: this.sourceFilter === "all" ? null : this.sourceFilter,
      sourceFilteredStreams: this.getFilteredSources(),
      sourceAvailableAddons: this.getSourceFilters().filter((entry) => entry !== "all")
    };
  },

  resolvePauseOverlayEpisodeEntry(entries = []) {
    if (!Array.isArray(entries) || !entries.length) {
      return null;
    }
    const explicitVideoId = String(this.params?.videoId || "").trim();
    if (explicitVideoId) {
      const byId = entries.find((entry) => String(entry?.id || "").trim() === explicitVideoId);
      if (byId) {
        return byId;
      }
    }

    const seasonRaw = this.params?.season;
    const season = Number(seasonRaw);
    const episode = Number(this.params?.episode || 0);
    if (
      seasonRaw != null &&
      Number.isFinite(season) &&
      season >= 0 &&
      Number.isFinite(episode) &&
      episode > 0
    ) {
      return entries.find((entry) => (
        Number(entry?.season || 0) === season
        && Number(entry?.episode || 0) === episode
      )) || null;
    }

    return null;
  },

  buildPauseOverlayMeta(meta = null) {
    const resolvedMeta = meta && typeof meta === "object" ? meta : {};
    const episodeEntry = this.resolvePauseOverlayEpisodeEntry(this.episodes);
    const metaEpisodeEntry = this.resolvePauseOverlayEpisodeEntry(resolvedMeta?.videos);
    const title = cleanDisplayText(
      this.params?.playerTitle
      || this.params?.itemTitle
      || resolvedMeta?.name
      || this.params?.itemId
      || "Untitled"
    ) || "Untitled";
    const releaseYear = cleanDisplayText(
      this.params?.playerReleaseYear
      || this.params?.releaseYear
      || this.params?.year
      || extractReleaseYear(resolvedMeta?.releaseInfo)
    );
    const season = Number(this.params?.season ?? episodeEntry?.season ?? metaEpisodeEntry?.season ?? 0);
    const episode = Number(this.params?.episode ?? episodeEntry?.episode ?? metaEpisodeEntry?.episode ?? 0);
    const hasEpisodeContext =
      this.params?.season != null &&
      Number.isFinite(season) &&
      season >= 0 &&
      Number.isFinite(episode) &&
      episode > 0;
    const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
    const episodeTitle = cleanDisplayText(
      this.getDisplayEpisodeTitle()
      || this.params?.playerEpisodeTitle
      || episodeEntry?.title
      || metaEpisodeEntry?.title
      || metaEpisodeEntry?.name
      || ""
    );
    const description = cleanDisplayText(
      this.params?.playerDescription
      || this.params?.description
      || this.params?.overview
      || episodeEntry?.overview
      || episodeEntry?.description
      || metaEpisodeEntry?.overview
      || metaEpisodeEntry?.description
      || resolvedMeta?.description
      || resolvedMeta?.overview
      || ""
    );
    const backdropUrl = cleanDisplayText(
      this.params?.playerBackdropUrl
      || this.params?.backdrop
      || resolvedMeta?.background
      || resolvedMeta?.poster
      || this.params?.poster
      || ""
    );
    const logoUrl = cleanDisplayText(
      this.params?.playerLogoUrl
      || resolvedMeta?.logo
      || this.params?.logo
      || ""
    );

    return {
      title,
      releaseYear,
      episodeCode,
      episodeTitle,
      description,
      backdropUrl,
      logoUrl,
      cast: extractPauseOverlayCast({
        castItems: this.params?.castItems,
        castMembers: this.params?.castMembers || resolvedMeta?.castMembers,
        cast: this.params?.cast || resolvedMeta?.cast,
        credits: this.params?.credits || resolvedMeta?.credits
      })
    };
  },

  async hydratePauseOverlayMeta() {
    const itemId = String(this.params?.itemId || "").trim();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!itemId || this.isExternalFrameMode()) {
      return;
    }

    const requestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
    this.pauseOverlayMetaRequestToken = requestToken;

    try {
      const result = await metaRepository.getMetaFromAllAddons(itemType, itemId);
      if (requestToken !== this.pauseOverlayMetaRequestToken || result?.status !== "success" || !result?.data) {
        return;
      }
      this.pauseOverlayMeta = this.buildPauseOverlayMeta(result.data);
      this.renderPauseOverlay();
    } catch (error) {
      if (requestToken === this.pauseOverlayMetaRequestToken) {
        console.warn("Pause overlay metadata fetch failed", error);
      }
    }
  },

  clearPauseOverlayTimer() {
    if (this.pauseOverlayTimer) {
      clearTimeout(this.pauseOverlayTimer);
      this.pauseOverlayTimer = null;
    }
  },

  canShowPauseOverlay() {
    return !this.isExternalFrameMode()
      && this.paused
      && !this.loadingVisible
      && !this.seekOverlayVisible
      && this.seekPreviewSeconds == null
      && !this.isDialogOpen()
      && !this.parentalGuideVisible
      && !this.moreActionsVisible
      && !this.isNextEpisodeCardVisible();
  },

  syncNativePausedStateForPauseOverlay() {
    if (
      this.isExternalFrameMode()
      || this.loadingVisible
      || this.startupAudioGateActive
      || (typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay())
    ) {
      return false;
    }

    const video = PlayerController.video;
    if (!video?.paused) {
      return false;
    }

    const readyState = typeof PlayerController.getPlaybackReadyState === "function"
      ? Number(PlayerController.getPlaybackReadyState() || 0)
      : Number(video.readyState || 0);
    if (readyState < 3) {
      return false;
    }

    const ended = typeof PlayerController.isPlaybackEnded === "function"
      ? PlayerController.isPlaybackEnded()
      : Boolean(video.ended);
    if (ended) {
      return false;
    }

    const wasPaused = Boolean(this.paused);
    if (!wasPaused) {
      this.clearPlaybackStallGuard();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.renderControlButtons();
    }

    if (this.canShowPauseOverlay() && !this.pauseOverlayVisible && !this.pauseOverlayTimer) {
      this.schedulePauseOverlay();
      return true;
    }

    return !wasPaused;
  },

  dismissPauseOverlay({ revealControls = false, focus = false } = {}) {
    this.clearPauseOverlayTimer();
    if (!this.pauseOverlayVisible && !revealControls) {
      return;
    }
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    if (revealControls && !this.loadingVisible) {
      this.setControlsVisible(true, { focus });
    }
  },

  schedulePauseOverlay() {
    this.clearPauseOverlayTimer();
    if (!this.canShowPauseOverlay()) {
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      return;
    }
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    this.pauseOverlayTimer = setTimeout(() => {
      this.pauseOverlayTimer = null;
      if (!this.canShowPauseOverlay()) {
        return;
      }
      this.pauseOverlayVisible = true;
      this.renderPauseOverlay();
    }, this.pauseOverlayDelayMs);
  },

  syncPauseOverlayState() {
    if (this.syncNativePausedStateForPauseOverlay()) {
      return;
    }
    if (this.pauseOverlayVisible && !this.canShowPauseOverlay()) {
      this.dismissPauseOverlay();
      return;
    }
    if (!this.pauseOverlayVisible && this.pauseOverlayTimer && !this.canShowPauseOverlay()) {
      this.clearPauseOverlayTimer();
    }
  },

  renderPauseOverlay() {
    const overlay = this.uiRefs?.pauseOverlay;
    const controlsOverlay = this.uiRefs?.controlsOverlay;
    if (!overlay) {
      return;
    }
    const hidden = !this.pauseOverlayVisible || this.loadingVisible;
    overlay.classList.toggle("hidden", hidden);
    overlay.classList.toggle("is-still-watching", Boolean(this.stillWatchingPromptVisible));
    controlsOverlay?.classList.toggle("pause-overlay-active", !hidden);
    if (hidden) {
      return;
    }

    const clockText = String(this.lastUiTickState?.clockText || this.uiRefs?.clock?.textContent || "--:--").trim() || "--:--";
    if (this.stillWatchingPromptVisible) {
      const nextEpisode = this.resolveNextEpisodeInfo();
      const titleLine = [nextEpisode?.episodeLabel, nextEpisode?.episodeTitle].filter(Boolean).join(" • ");
      overlay.innerHTML = `
        <div class="player-pause-overlay-top">
          <div class="player-pause-overlay-clock">${escapeHtml(clockText)}</div>
        </div>
        <div class="player-pause-overlay-shade"></div>
        <div class="player-pause-overlay-content player-still-watching-content">
          <div class="player-pause-kicker">${escapeHtml(t("still_watching_title", {}, "Still watching"))}</div>
          <div class="player-pause-title">${escapeHtml(titleLine || t("next_episode_label", {}, "Next episode"))}</div>
          <div class="player-pause-description">${escapeHtml(t("still_watching_countdown", [this.stillWatchingPromptCountdownSec], "Continuing in %1$s"))}</div>
          <div class="player-still-watching-actions">
            <button class="player-still-watching-btn focusable is-primary${this.stillWatchingPromptFocus === "continue" ? " focused" : ""}" type="button" tabindex="-1" data-player-pointer-action="stillWatchingContinue">${escapeHtml(t("still_watching_continue", {}, "Continue"))}</button>
            <button class="player-still-watching-btn focusable${this.stillWatchingPromptFocus === "exit" ? " focused" : ""}" type="button" tabindex="-1" data-player-pointer-action="stillWatchingExit">${escapeHtml(t("still_watching_exit", {}, "Exit"))}</button>
          </div>
        </div>
      `;
      if (this.stillWatchingPromptFocusArmed) {
        this.stillWatchingPromptFocusArmed = false;
        setTimeout(() => {
          const focusTarget = overlay.querySelector("[data-player-pointer-action='stillWatchingContinue']");
          focusTarget?.focus?.();
        }, 0);
      }
      return;
    }

    const meta = this.pauseOverlayMeta || this.buildPauseOverlayMeta();
    const castItems = Array.isArray(meta.cast) ? meta.cast.slice(0, MAX_PAUSE_OVERLAY_CAST) : [];
    overlay.innerHTML = `
      <div class="player-pause-overlay-top">
        <div class="player-pause-overlay-clock">${escapeHtml(clockText)}</div>
      </div>
      <div class="player-pause-overlay-shade"></div>
      <div class="player-pause-overlay-content">
        <div class="player-pause-kicker">${escapeHtml(t("pause_you_are_watching", {}, "You're watching"))}</div>
        ${meta.logoUrl ? `<img class="player-pause-logo" src="${escapeAttribute(meta.logoUrl)}" alt="${escapeAttribute(meta.title)}" />` : `<div class="player-pause-title">${escapeHtml(meta.title)}</div>`}
        ${meta.releaseYear || meta.episodeCode ? `<div class="player-pause-meta-line">${escapeHtml([meta.releaseYear, meta.episodeCode].filter(Boolean).join(" • "))}</div>` : ""}
        ${meta.episodeTitle ? `<div class="player-pause-episode-title">${escapeHtml(meta.episodeTitle)}</div>` : ""}
        ${meta.description ? `<div class="player-pause-description">${escapeHtml(meta.description)}</div>` : ""}
        ${castItems.length ? `
          <div class="player-pause-cast-section">
            <div class="player-pause-cast-label">${escapeHtml(t("pause_cast_label", {}, "Cast"))}</div>
            <div class="player-pause-cast-row">
              ${castItems.map((member) => `
                <div class="player-pause-cast-chip">
                  <span>${escapeHtml(member.name || "")}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  },

  clearStillWatchingPromptTimer() {
    if (this.stillWatchingPromptTimer) {
      clearInterval(this.stillWatchingPromptTimer);
      this.stillWatchingPromptTimer = null;
    }
  },

  resetStillWatchingPromptState({ render = true } = {}) {
    this.clearStillWatchingPromptTimer();
    this.stillWatchingPromptVisible = false;
    this.stillWatchingPromptCountdownSec = 0;
    this.stillWatchingPromptFocusArmed = false;
    this.stillWatchingPromptFocus = "continue";
    if (render) {
      this.renderPauseOverlay();
    }
  },

  enterStillWatchingPromptMode() {
    if (this.stillWatchingPromptVisible || this.nextEpisodeLaunching) {
      return;
    }
    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode?.hasAired) {
      return;
    }

    this.clearStillWatchingPromptTimer();
    this.stillWatchingPromptVisible = true;
    this.stillWatchingPromptCountdownSec = 60;
    this.stillWatchingPromptFocusArmed = true;
    this.stillWatchingPromptFocus = "continue";
    PlayerController.pause();
    this.paused = true;
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(false, { focus: false });
    this.pauseOverlayVisible = true;
    this.renderPauseOverlay();

    this.stillWatchingPromptTimer = setInterval(() => {
      if (!this.stillWatchingPromptVisible) {
        this.clearStillWatchingPromptTimer();
        return;
      }
      const nextCountdown = Number(this.stillWatchingPromptCountdownSec || 0) - 1;
      if (nextCountdown <= 0) {
        this.onDismissStillWatchingPrompt();
        return;
      }
      this.stillWatchingPromptCountdownSec = nextCountdown;
      this.renderPauseOverlay();
    }, 1000);
  },

  async onStillWatchingContinue() {
    if (!this.stillWatchingPromptVisible) {
      return false;
    }
    this.resetStillWatchingPromptState({ render: false });
    this.consecutiveAutoPlayCount = 0;
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    await this.playNextEpisode({ userInitiated: true });
    return true;
  },

  onDismissStillWatchingPrompt() {
    if (!this.stillWatchingPromptVisible) {
      return false;
    }
    this.resetStillWatchingPromptState({ render: false });
    this.consecutiveAutoPlayCount = 0;
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    return this.navigateBackToStreamScreen();
  },

  getDisplayEpisodeTitle() {
    const rawEpisodeTitle = String(this.params?.playerEpisodeTitle || this.params?.episodeTitle || this.params?.playerSubtitle || "").trim();
    if (!rawEpisodeTitle) {
      return "";
    }
    const season = this.params?.season == null ? null : Number(this.params.season);
    const episode = this.params?.episode == null ? null : Number(this.params.episode);
    if (season == null || episode == null) {
      return rawEpisodeTitle;
    }
    return rawEpisodeTitle
      .replace(new RegExp(`^S0*${season}E0*${episode}\\s*[-\\u2022:]?\\s*`, "i"), "")
      .trim();
  },

  getPlayerHeaderData() {
    const title = String(this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled").trim() || "Untitled";
    const season = this.params?.season == null ? null : Number(this.params.season);
    const episode = this.params?.episode == null ? null : Number(this.params.episode);
    const hasEpisodeContext =
      this.params?.season != null &&
      Number.isFinite(season) &&
      season >= 0 &&
      Number.isFinite(episode) &&
      episode > 0;
    const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
    const episodeTitle = this.getDisplayEpisodeTitle();
    const subtitle = hasEpisodeContext
      ? [episodeCode, episodeTitle].filter(Boolean).join(" • ")
      : "";
    const meta = String(this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || "").trim();
    return { title, subtitle, meta };
  },

  hasEpisodeAired(released) {
    const raw = String(released || "").trim();
    if (!raw) {
      return true;
    }
    const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || raw;
    const parsedTime = Date.parse(datePortion);
    if (!Number.isFinite(parsedTime)) {
      return true;
    }
    return parsedTime <= Date.now();
  },

  resolveNextEpisodeInfo() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (itemType !== "series") {
      return null;
    }

    let nextEpisode = null;
    const explicitVideoId = String(this.params?.nextEpisodeVideoId || "").trim();
    if (explicitVideoId && this.episodes.length) {
      nextEpisode = this.episodes.find((episode) => String(episode?.id || "") === explicitVideoId) || null;
    }

    if (!nextEpisode && this.params?.videoId && this.episodes.length) {
      const currentEpisode = this.episodes.find(
        (episode) => String(episode?.id || "") === String(this.params?.videoId || "")
      );
      nextEpisode = this.getNextEpisodeInSequence(currentEpisode);
    }

    if (!nextEpisode && this.episodes.length) {
      const currentSeasonRaw = this.params?.season;
      const currentSeason = Number(currentSeasonRaw);
      const currentEpisode = Number(this.params?.episode || 0);
      if (
        currentSeasonRaw != null &&
        Number.isFinite(currentSeason) &&
        currentSeason >= 0 &&
        currentEpisode > 0
      ) {
        const currentEntry = this.episodes.find((episode) => (
          Number(episode?.season || 0) === currentSeason && Number(episode?.episode || 0) === currentEpisode
        ));
        nextEpisode = this.getNextEpisodeInSequence(currentEntry);
      }
    }

    const nextVideoId = String(nextEpisode?.id || explicitVideoId || "").trim();
    if (!nextVideoId) {
      return null;
    }

    const season = nextEpisode?.season ?? (this.params?.nextEpisodeSeason ?? null);
    const episode = nextEpisode?.episode ?? (this.params?.nextEpisodeEpisode ?? null);
    const episodeLabel = nextEpisode
      ? `S${nextEpisode.season}E${nextEpisode.episode}`
      : (this.params?.nextEpisodeLabel || "");
    const released = String(nextEpisode?.released || this.params?.nextEpisodeReleased || "").trim() || null;
    return {
      videoId: nextVideoId,
      season: season == null ? null : Number(season),
      episode: episode == null ? null : Number(episode),
      episodeLabel: episodeLabel || null,
      episodeTitle: String(nextEpisode?.title || this.params?.nextEpisodeTitle || "").trim() || null,
      released,
      hasAired: this.hasEpisodeAired(released)
    };
  },

  getNextEpisodeInSequence(currentEpisode = null) {
    if (!currentEpisode || !Array.isArray(this.episodes) || !this.episodes.length) {
      return null;
    }
    const currentSeason = Number(currentEpisode?.season);
    const sequence = this.episodes.filter((episode) =>
      currentSeason === 0
        ? Number(episode?.season) === 0
        : Number(episode?.season) > 0
    );
    const currentIndex = sequence.findIndex(
      (episode) =>
        String(episode?.id || "") === String(currentEpisode?.id || "") ||
        (Number(episode?.season || 0) === currentSeason &&
          Number(episode?.episode || 0) === Number(currentEpisode?.episode || 0))
    );
    return currentIndex >= 0 ? sequence[currentIndex + 1] || null : null;
  },

  resolveCurrentEpisodeEntry() {
    if (!Array.isArray(this.episodes) || !this.episodes.length) {
      return null;
    }
    const currentVideoId = String(this.params?.videoId || "").trim();
    if (currentVideoId) {
      const byVideoId = this.episodes.find((episode) => String(episode?.id || "") === currentVideoId);
      if (byVideoId) {
        return byVideoId;
      }
    }

    const currentSeasonRaw = this.params?.season;
    const currentSeason = Number(currentSeasonRaw);
    const currentEpisode = Number(this.params?.episode || 0);
    if (
      currentSeasonRaw == null ||
      !Number.isFinite(currentSeason) ||
      currentSeason < 0 ||
      currentEpisode <= 0
    ) {
      return null;
    }
    return this.episodes.find((episode) => (
      Number(episode?.season || 0) === currentSeason
      && Number(episode?.episode || 0) === currentEpisode
    )) || null;
  },

  buildStreamRouteParamsFromPlayer() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const currentEpisode = itemType === "series" ? this.resolveCurrentEpisodeEntry() : null;
    const nextEpisode = itemType === "series" ? this.resolveNextEpisodeInfo() : null;
    const currentPositionMs = Math.round(this.getPlaybackCurrentSeconds() * 1000);
    const title = this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled";
    const backdrop = this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || null;
    const logo = this.params?.playerLogoUrl || this.params?.logo || null;
    const videoId = itemType === "series"
      ? (this.params?.videoId || currentEpisode?.id || null)
      : (this.params?.videoId || this.params?.itemId || null);

    return {
      itemId: this.params?.itemId || null,
      itemType,
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      returnToDetail: true,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      itemTitle: title,
      itemSubtitle: itemType === "series" ? "" : (this.params?.playerSubtitle || ""),
      year: this.params?.playerReleaseYear || this.params?.year || "",
      backdrop,
      poster: this.params?.poster || backdrop,
      logo,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      videoId,
      season: itemType === "series" ? (this.params?.season ?? currentEpisode?.season ?? null) : null,
      episode: itemType === "series" ? (this.params?.episode ?? currentEpisode?.episode ?? null) : null,
      episodeTitle: itemType === "series"
        ? (this.params?.playerEpisodeTitle || this.params?.playerSubtitle || currentEpisode?.title || "")
        : "",
      episodes: Array.isArray(this.episodes) ? this.episodes : [],
      nextEpisodeVideoId: nextEpisode?.videoId || null,
      nextEpisodeLabel: nextEpisode?.episodeLabel || null,
      nextEpisodeSeason: nextEpisode?.season ?? null,
      nextEpisodeEpisode: nextEpisode?.episode ?? null,
      nextEpisodeTitle: nextEpisode?.episodeTitle || "",
      nextEpisodeReleased: nextEpisode?.released || "",
      resumePositionMs: Number.isFinite(currentPositionMs) && currentPositionMs > 0 ? currentPositionMs : 0
    };
  },

  buildReturnStreamRouteParamsFromPlayer() {
    const derivedParams = this.buildStreamRouteParamsFromPlayer();
    const originalParams = this.params?.streamRouteParams && typeof this.params.streamRouteParams === "object"
      ? { ...this.params.streamRouteParams }
      : null;
    if (!originalParams) {
      return derivedParams;
    }
    return {
      ...derivedParams,
      ...originalParams,
      resumePositionMs: derivedParams.resumePositionMs,
      startFromBeginning: false
    };
  },

  shouldReturnToStreamOnBack() {
    if (this.params?.returnToStreamOnBack === false) {
      return false;
    }
    const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
    return Boolean(
      this.params?.returnToStreamOnBack
      || this.params?.streamRouteParams
      || streamParams.itemId
      || streamParams.videoId
    );
  },

  buildDetailRouteParamsFromPlayer() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const currentEpisode = itemType === "series" ? this.resolveCurrentEpisodeEntry() : null;
    const preferredSeasonRaw =
      itemType === "series" ? this.params?.season ?? currentEpisode?.season : null;
    const preferredSeason = Number(preferredSeasonRaw);
    return {
      itemId: this.params?.itemId || null,
      itemType,
      fallbackTitle: this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled",
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      preferredSeason:
        preferredSeasonRaw != null &&
        Number.isFinite(preferredSeason) &&
        preferredSeason >= 0
          ? preferredSeason
          : null
    };
  },

  buildStreamRouteParamsForEpisode(episode = null) {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const targetEpisode = episode || null;
    const title = this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled";
    const backdrop = this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || null;
    const logo = this.params?.playerLogoUrl || this.params?.logo || null;
    return {
      itemId: this.params?.itemId || null,
      itemType,
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      returnToDetail: true,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      itemTitle: title,
      itemSubtitle: itemType === "series" ? "" : (this.params?.playerSubtitle || ""),
      year: this.params?.playerReleaseYear || this.params?.year || "",
      backdrop,
      poster: this.params?.poster || backdrop,
      logo,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      videoId: targetEpisode?.videoId || targetEpisode?.id || null,
      season: targetEpisode?.season == null ? null : Number(targetEpisode.season),
      episode: targetEpisode?.episode == null ? null : Number(targetEpisode.episode),
      episodeTitle: itemType === "series"
        ? (targetEpisode?.episodeTitle || targetEpisode?.title || "")
        : "",
      episodes: Array.isArray(this.episodes) ? this.episodes : []
    };
  },

  navigateBackToStreamScreen() {
    if (this.playerBackNavigationInProgress) {
      return true;
    }
    this.playerBackNavigationInProgress = true;
    this.releaseCurrentEngineFsStreamBestEffort("back-to-stream", {
      removeTorrent: true,
      deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
    });
    const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
    try {
      PlayerController.stop();
    } catch (_) {
      // Route cleanup will make a second best-effort stop if native teardown throws.
    }
    const shouldReturnToStream = this.shouldReturnToStreamOnBack();
    Router.suppressNextPopstate?.(1500);
    Router.ignoreSinglePopstate?.();
    const targetRoute = shouldReturnToStream
      ? "stream"
      : (this.params?.itemId ? "detail" : "home");
    const targetParams = targetRoute === "stream"
      ? streamParams
      : (targetRoute === "detail" ? this.buildDetailRouteParamsFromPlayer() : {});
    void Router.navigate(targetRoute, targetParams, {
      skipStackPush: true,
      replaceHistory: true,
      isBackNavigation: true
    });
    return true;
  },

  shouldShowNextEpisodeCard() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode) {
      return false;
    }
    if (!this.hasPresentedPlaybackFrame) {
      return false;
    }
    if (this.nextEpisodeCardTriggered) {
      return true;
    }
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
      return false;
    }
    const settings = PlayerSettingsStore.get();
    const shouldShow = shouldShowNextEpisodeCardRule({
      positionSeconds: currentSeconds,
      durationSeconds,
      skipIntervals: settings.skipIntroEnabled ? this.skipIntervals : [],
      thresholdMode: settings.nextEpisodeThresholdMode,
      thresholdPercent: settings.nextEpisodeThresholdPercent,
      thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
    });
    if (shouldShow) {
      this.nextEpisodeCardTriggered = true;
    }
    return shouldShow;
  },

  hasPlaybackReachedNaturalEnd() {
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
      return false;
    }
    const remainingSeconds = durationSeconds - currentSeconds;
    const progress = currentSeconds / durationSeconds;
    return remainingSeconds <= 1 || progress >= 0.999;
  },

  shouldPrefetchNextEpisodeStreams() {
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
      return false;
    }
    return (currentSeconds / durationSeconds) >= NEXT_EPISODE_PREFETCH_PERCENT;
  },

  getStreamCacheKey(videoId, itemType) {
    const normalizedVideoId = String(videoId || "").trim();
    if (!normalizedVideoId) {
      return "";
    }
    return `${normalizeItemType(itemType || this.params?.itemType || "movie")}:${normalizedVideoId}`;
  },

  getCachedPlayableStreamsForVideo(videoId, itemType) {
    const cacheKey = this.getStreamCacheKey(videoId, itemType);
    const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
    if (!cacheKey || !cache.has(cacheKey)) {
      return null;
    }
    const cached = cache.get(cacheKey);
    return Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [];
  },

  hasCachedPlayableStreamsForNextEpisode(nextEpisode = this.resolveNextEpisodeInfo()) {
    if (!nextEpisode?.videoId || nextEpisode.hasAired === false) {
      return false;
    }
    const cached = this.getCachedPlayableStreamsForVideo(nextEpisode.videoId, this.params?.itemType || "series");
    return Array.isArray(cached) && cached.length > 0;
  },

  ensureNextEpisodeStreamsPrefetch({ force = false } = {}) {
    const nextEpisode = this.resolveNextEpisodeInfo();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextEpisode?.videoId || itemType !== "series" || nextEpisode.hasAired === false) {
      return;
    }
    if (!force && !this.shouldPrefetchNextEpisodeStreams()) {
      return;
    }
    const cacheKey = this.getStreamCacheKey(nextEpisode.videoId, itemType);
    const loadPromises = this.streamCandidatesLoadPromises || (this.streamCandidatesLoadPromises = new Map());
    if (this.getCachedPlayableStreamsForVideo(nextEpisode.videoId, itemType) || loadPromises.has(cacheKey)) {
      return;
    }
    void this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType, {
      season: nextEpisode.season,
      episode: nextEpisode.episode
    })
      .then(() => this.renderNextEpisodeCard())
      .catch((error) => console.warn("Next episode stream prefetch failed", error));
  },

  dismissNextEpisodeCard({ revealControls = false, armExitOnNextBack = false } = {}) {
    if (this.nextEpisodeLaunching) {
      this.cancelNextEpisodeLaunch();
    }
    this.nextEpisodeCardDismissed = true;
    this.nextEpisodeBackExitArmed = Boolean(armExitOnNextBack);
    if (revealControls) {
      this.setControlsVisible(true, { focus: true });
      return;
    }
    this.renderNextEpisodeCard();
  },

  resetNextEpisodeCardDismissal() {
    if (!this.nextEpisodeCardDismissed && !this.nextEpisodeBackExitArmed) {
      return;
    }
    this.nextEpisodeCardDismissed = false;
    this.nextEpisodeBackExitArmed = false;
    this.renderNextEpisodeCard();
  },

  isNextEpisodeCardVisible() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    return Boolean(
      nextEpisode
      && this.shouldShowNextEpisodeCard()
      && !this.nextEpisodeCardDismissed
      && !this.stillWatchingPromptVisible
      && !this.loadingVisible
      && !this.pauseOverlayVisible
      && !this.subtitleDialogVisible
      && !this.audioDialogVisible
      && !this.speedDialogVisible
      && !this.sourcesPanelVisible
      && !this.episodePanelVisible
      && !this.moreActionsVisible
      && !this.isStartupErrorVisible()
    );
  },

  resetNextEpisodeLaunchPresentation() {
    this.nextEpisodeCardSearching = false;
    this.nextEpisodeCardSourceName = "";
    this.nextEpisodeCardCountdownSec = null;
  },

  cancelNextEpisodeLaunch() {
    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunching = false;
    this.nextEpisodeTransitionMeta = null;
    this.resetNextEpisodeLaunchPresentation();
    this.renderNextEpisodeCard();
  },

  isNextEpisodeLaunchActive(token) {
    return this.nextEpisodeLaunching
      && Number(token) === Number(this.nextEpisodeLaunchToken)
      && Router.getCurrent() === "player";
  },

  async runNextEpisodeCountdown(token, selectedStream) {
    const sourceName = String(selectedStream?.name || selectedStream?.addonName || "").trim();
    this.nextEpisodeCardSearching = false;
    this.nextEpisodeCardSourceName = sourceName;
    for (let remaining = 3; remaining >= 1; remaining -= 1) {
      if (!this.isNextEpisodeLaunchActive(token)) {
        return false;
      }
      this.nextEpisodeCardCountdownSec = remaining;
      this.renderNextEpisodeCard();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return this.isNextEpisodeLaunchActive(token);
  },

  maybeAutoplayNextEpisode() {
    const isAvPlayPlayback = typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay();
    const isVideoPaused = !isAvPlayPlayback && Boolean(PlayerController.video?.paused);
    if (this.nextEpisodeLaunching || this.paused || isVideoPaused || !this.hasPresentedPlaybackFrame) {
      return false;
    }

    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode || normalizeItemType(this.params?.itemType || "movie") !== "series") {
      this.nextEpisodeAutoplayAttemptedKey = "";
      return false;
    }

    const settings = PlayerSettingsStore.get();
    if (!settings.autoplayNextEpisode || !nextEpisode.hasAired) {
      this.nextEpisodeAutoplayAttemptedKey = "";
      return false;
    }
    const effectiveSkipIntervals = settings.skipIntroEnabled ? this.skipIntervals : [];

    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
      return false;
    }

    if (!shouldShowNextEpisodeCardRule({
      positionSeconds: currentSeconds,
      durationSeconds,
      skipIntervals: effectiveSkipIntervals,
      thresholdMode: settings.nextEpisodeThresholdMode,
      thresholdPercent: settings.nextEpisodeThresholdPercent,
      thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
    })) {
      this.nextEpisodeAutoplayAttemptedKey = "";
      return false;
    }

    const attemptKey = [
      String(nextEpisode.videoId || ""),
      String(nextEpisode.season ?? ""),
      String(nextEpisode.episode ?? "")
    ].join(":");
    if (this.nextEpisodeAutoplayAttemptedKey === attemptKey) {
      return false;
    }

    if (shouldEnterStillWatchingPrompt({
      stillWatchingEnabled: settings.stillWatchingEnabled,
      autoPlayNextEpisodeEnabled: settings.autoplayNextEpisode,
      nextEpisodeHasAired: nextEpisode.hasAired,
      consecutiveAutoPlayCount: this.consecutiveAutoPlayCount,
      threshold: settings.stillWatchingEpisodeThreshold
    })) {
      this.nextEpisodeAutoplayAttemptedKey = "";
      this.enterStillWatchingPromptMode();
      return true;
    }

    this.nextEpisodeAutoplayAttemptedKey = attemptKey;
    void this.playNextEpisode({ userInitiated: false });
    return true;
  },

  async getPlayableStreamsForVideo(videoId, itemType, options = {}) {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedType = normalizeItemType(itemType || this.params?.itemType || "movie");
    if (!normalizedVideoId) {
      return [];
    }
    const cacheKey = this.getStreamCacheKey(normalizedVideoId, normalizedType);
    const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      const cachedStreams = Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [];
      options.onChunk?.(cachedStreams);
      return cachedStreams;
    }
    const loadPromises = this.streamCandidatesLoadPromises || (this.streamCandidatesLoadPromises = new Map());
    if (loadPromises.has(cacheKey)) {
      const loaded = await loadPromises.get(cacheKey);
      const loadedStreams = Array.isArray(loaded) ? loaded.map((stream) => ({ ...stream })) : [];
      options.onChunk?.(loadedStreams);
      return loadedStreams;
    }

    let partialItems = [];
    const loadPromise = streamRepository.getStreamsFromAllAddons(normalizedType, normalizedVideoId, {
      itemId: String(this.params?.itemId || ""),
      season: options.season ?? null,
      episode: options.episode ?? null,
      onChunk: (chunkResult) => {
        const chunkItems = flattenStreamGroups(chunkResult);
        if (!chunkItems.length) {
          return;
        }
        partialItems = mergeStreamItems(partialItems, chunkItems);
        options.onChunk?.(partialItems.map((stream) => ({ ...stream })));
      }
    })
      .then((streamResult) => {
        const streamItems = mergeStreamItems(
          partialItems,
          streamResult?.status === "success" ? flattenStreamGroups(streamResult) : []
        );
        cache.set(cacheKey, streamItems.map((stream) => ({ ...stream })));
        return streamItems;
      })
      .finally(() => {
        loadPromises.delete(cacheKey);
      });
    loadPromises.set(cacheKey, loadPromise);

    const streamItems = await loadPromise;
    return streamItems;
  },

  getCurrentStreamBingeGroup() {
    const currentStream = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
    return String(
      currentStream?.behaviorHints?.bingeGroup ||
      currentStream?.raw?.behaviorHints?.bingeGroup ||
      ""
    ).trim();
  },

  async selectNextEpisodeStreamByAutoPlayPolicy(streamItems = [], settings = PlayerSettingsStore.get(), options = {}) {
    if (!Array.isArray(streamItems) || !streamItems.length) {
      return null;
    }

    const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
    const preferBingeGroup = Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode);
    const shouldAutoSelectInManualMode = mode === "MANUAL" && (
      Boolean(settings.autoplayNextEpisode) || preferBingeGroup
    );
    const preferredBingeGroup = preferBingeGroup ? this.getCurrentStreamBingeGroup() : "";
    const bingeGroupOnlyManualMode = shouldAutoSelectInManualMode &&
      preferBingeGroup;
    if (bingeGroupOnlyManualMode && !preferredBingeGroup) {
      return null;
    }
    const installedAddonNames = options.installedAddonNames instanceof Set
      ? options.installedAddonNames
      : new Set(
          ((await addonRepository.getInstalledAddons().catch(() => [])) || [])
            .map((addon) => String(addon?.displayName || addon?.name || "").trim())
            .filter(Boolean)
        );
    return selectAutoPlayStream(streamItems, {
      mode: shouldAutoSelectInManualMode ? "FIRST_STREAM" : mode,
      source: shouldAutoSelectInManualMode
        ? "ALL_SOURCES"
        : String(settings.streamAutoPlaySource || "ALL_SOURCES"),
      regexPattern: shouldAutoSelectInManualMode ? "" : String(settings.streamAutoPlayRegex || ""),
      installedAddonNames,
      selectedAddons: shouldAutoSelectInManualMode ? [] : settings.streamAutoPlaySelectedAddons,
      selectedPlugins: shouldAutoSelectInManualMode ? [] : settings.streamAutoPlaySelectedPlugins,
      preferredBingeGroup,
      preferBingeGroupInSelection: preferBingeGroup,
      bingeGroupOnly: Boolean(options.bingeGroupOnly || bingeGroupOnlyManualMode)
    });
  },

  async resolveNextEpisodeStreamByAutoPlayPolicy(nextEpisode, itemType, settings) {
    const installedAddonNames = new Set(
      ((await addonRepository.getInstalledAddons().catch(() => [])) || [])
        .map((addon) => String(addon?.displayName || addon?.name || "").trim())
        .filter(Boolean)
    );
    let latestStreams = [];
    let timeoutElapsed = Number(settings.streamAutoPlayTimeoutSeconds || 0) === 0;
    const hasPreferredBingeGroup = Boolean(
      settings.streamAutoPlayPreferBingeGroupForNextEpisode && this.getCurrentStreamBingeGroup()
    );
    let settled = false;
    let resolveSelection;
    let selectionTimer = null;
    let hardTimeout = null;

    const selection = new Promise((resolve) => {
      resolveSelection = resolve;
    });
    const finish = (selectedStream, error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(selectionTimer);
      clearTimeout(hardTimeout);
      resolveSelection({ selectedStream: selectedStream || null, streamItems: latestStreams, error });
    };
    const trySelect = async (bingeGroupOnly) => {
      const selected = await this.selectNextEpisodeStreamByAutoPlayPolicy(
        latestStreams,
        settings,
        { bingeGroupOnly, installedAddonNames }
      );
      if (selected) {
        finish(selected);
      }
      return selected;
    };
    const onChunk = (streams) => {
      latestStreams = Array.isArray(streams) ? streams : latestStreams;
      void (async () => {
        if (hasPreferredBingeGroup && await trySelect(true)) {
          return;
        }
        if (timeoutElapsed) {
          finish(await this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, { installedAddonNames }));
        }
      })();
    };

    const timeoutSeconds = Math.max(0, Math.trunc(Number(settings.streamAutoPlayTimeoutSeconds || 0)));
    if (timeoutSeconds > 0 && timeoutSeconds !== 2147483647) {
      selectionTimer = setTimeout(() => {
        timeoutElapsed = true;
        if (latestStreams.length) {
          void this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, { installedAddonNames })
            .then((selected) => finish(selected));
        }
      }, timeoutSeconds * 1000);
    }
    hardTimeout = setTimeout(() => finish(null, new Error("Next episode stream selection timed out")), NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS);

    void this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType, {
      season: nextEpisode.season,
      episode: nextEpisode.episode,
      onChunk
    }).then(async (streams) => {
      latestStreams = Array.isArray(streams) ? streams : latestStreams;
      finish(await this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, { installedAddonNames }));
    }).catch((error) => finish(null, error));

    return selection;
  },

  async openNextEpisodeStreamPicker(nextEpisode, { streamItems = null, forceReload = true, error = null } = {}) {
    let episodeIndex = this.episodes.findIndex(
      (episode) => String(episode?.id || "") === String(nextEpisode?.videoId || "")
    );
    if (episodeIndex < 0) {
      this.episodes = [
        ...this.episodes,
        {
          id: nextEpisode.videoId,
          season: nextEpisode.season ?? null,
          episode: nextEpisode.episode ?? null,
          title: nextEpisode.episodeTitle || nextEpisode.episodeLabel || ""
        }
      ];
      episodeIndex = this.episodes.length - 1;
    }

    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunching = false;
    this.resetNextEpisodeLaunchPresentation();
    this.loadingVisible = false;
    this.nextEpisodeTransitionMeta = null;
    this.updateLoadingVisibility();
    this.refreshLoadingOverlayPresentation();
    this.setControlsVisible(true, { focus: false });
    this.episodePanelIndex = episodeIndex;
    this.episodePanelVisible = true;
    this.episodePanelMode = "streams";
    this.episodePanelStreamVideoId = String(nextEpisode.videoId || "");
    this.episodePanelStreamFilter = "all";
    this.episodePanelStreamsError = error ? t("panel_failed_load_streams", {}, "Failed to load streams") : "";
    this.episodePanelStreamsLoading = !Array.isArray(streamItems);
    this.episodePanelStreams = Array.isArray(streamItems) ? streamItems : [];
    this.episodePanelStreamFocus = this.episodePanelStreams.length
      ? { zone: "streams", index: 0 }
      : { zone: "actions", index: 0 };
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.syncEpisodePanelSeasonToIndex();
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.renderEpisodePanel();

    if (!Array.isArray(streamItems)) {
      await this.openEpisodeStreamsView({ forceReload });
    }
    return true;
  },

  async playNextEpisode({ userInitiated = false } = {}) {
    const nextEpisode = this.resolveNextEpisodeInfo();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextEpisode?.videoId || itemType !== "series" || nextEpisode.hasAired === false || this.nextEpisodeLaunching) {
      return false;
    }

    const settings = PlayerSettingsStore.get();
    const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
    const shouldAutoSelectInManualMode = mode === "MANUAL" && (
      Boolean(settings.autoplayNextEpisode) ||
      Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode)
    );
    if (mode === "MANUAL" && !shouldAutoSelectInManualMode) {
      return this.openNextEpisodeStreamPicker(nextEpisode, { forceReload: true });
    }

    const launchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunchToken = launchToken;
    this.nextEpisodeLaunching = true;
    this.nextEpisodeCardTriggered = true;
    this.nextEpisodeCardSearching = true;
    this.nextEpisodeCardSourceName = "";
    this.nextEpisodeCardCountdownSec = null;
    if (userInitiated) {
      this.consecutiveAutoPlayCount = 0;
    }
    this.nextEpisodeTransitionMeta = {
      title: this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Nuvio",
      subtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
      logoUrl: this.params?.playerLogoUrl || this.params?.logo || "",
      backdropUrl: this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || ""
    };
    this.renderNextEpisodeCard();

    try {
      const resolution = await this.resolveNextEpisodeStreamByAutoPlayPolicy(nextEpisode, itemType, settings);
      if (!this.isNextEpisodeLaunchActive(launchToken)) {
        return false;
      }
      const streamItems = Array.isArray(resolution.streamItems) ? resolution.streamItems : [];
      const selectedStream = resolution.selectedStream || null;

      if (!selectedStream) {
        console.warn("Next episode auto-selection did not find a stream; opening picker", {
          videoId: nextEpisode.videoId,
          totalStreams: streamItems.length,
          mode,
          preferBingeGroup: Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode),
          error: resolution.error?.message || null
        });
        return this.openNextEpisodeStreamPicker(nextEpisode, {
          streamItems: resolution.error ? null : streamItems,
          forceReload: Boolean(resolution.error),
          error: resolution.error
        });
      }
      const bestStreamCandidate = selectedStream;
      const bestStream = streamDirectPlaybackUrl(bestStreamCandidate) || null;
      if (!await this.runNextEpisodeCountdown(launchToken, bestStreamCandidate)) {
        return false;
      }
      const nextEpisodeIndex = this.episodes.findIndex((episode) => String(episode?.id || "") === String(nextEpisode.videoId || ""));
      const followingEpisode = nextEpisodeIndex >= 0 ? this.episodes[nextEpisodeIndex + 1] || null : null;
      this.consecutiveAutoPlayCount = userInitiated ? 0 : (Number(this.consecutiveAutoPlayCount || 0) + 1);
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      this.refreshLoadingOverlayPresentation();
      this.setControlsVisible(false);
      this.renderNextEpisodeCard();
      await PlayerController.flushCurrentProgress({ allowCloudSync: false });
      if (!this.isNextEpisodeLaunchActive(launchToken)) {
        return false;
      }
      void PlayerController.pushProgressIfDue?.(true);
      this.releaseCurrentEngineFsStreamBestEffort("next-episode", {
        removeTorrent: true,
        deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
      });
      await Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
        traktId: this.params?.traktId || this.params?.trakt_id || null,
        contentLanguage: this.contentLanguage || null,
        videoId: nextEpisode.videoId,
        season: nextEpisode.season,
        episode: nextEpisode.episode,
        episodeLabel: nextEpisode.episodeLabel || null,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
        playerEpisodeTitle: nextEpisode.episodeTitle || "",
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes || [],
        streamCandidates: streamItems,
        preferredStreamId: bestStreamCandidate.id || null,
        playbackSourceContext: this.getPlaybackSourceContext(bestStreamCandidate),
        returnToStreamOnBack: false,
        nextEpisodeVideoId: followingEpisode?.id || null,
        nextEpisodeLabel: followingEpisode ? `S${followingEpisode.season}E${followingEpisode.episode}` : null,
        nextEpisodeSeason: followingEpisode?.season ?? null,
        nextEpisodeEpisode: followingEpisode?.episode ?? null,
        nextEpisodeTitle: followingEpisode?.title || "",
        nextEpisodeReleased: followingEpisode?.released || "",
        consecutiveAutoPlayCount: this.consecutiveAutoPlayCount
      }, {
        replaceHistory: true
      });
      return true;
    } catch (error) {
      if (!this.isNextEpisodeLaunchActive(launchToken)) {
        return false;
      }
      console.warn("Next episode play failed", error);
      return this.openNextEpisodeStreamPicker(nextEpisode, { forceReload: true, error });
    }
  },

  persistPlayerPresentationSettings() {
    PlayerSettingsStore.set({
      subtitleStyle: { ...this.subtitleStyleSettings },
      subtitleLanguage: this.subtitleStyleSettings?.preferredLanguage || "off",
      secondarySubtitleLanguage: this.subtitleStyleSettings?.secondaryPreferredLanguage || "off",
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      persistAudioAmplification: Boolean(this.persistAudioAmplification)
    });
  },

  ensureAudioAmplificationGraph() {
    const video = PlayerController.video;
    if (!supportsTvWebAudioAmplification()) {
      this.audioAmplificationAvailable = false;
      return false;
    }
    if (!video || this.audioGainNode) {
      return Boolean(this.audioGainNode);
    }
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") {
      return false;
    }
    try {
      this.audioContext = this.audioContext || new AudioContextCtor();
      this.audioMediaSource = this.audioMediaSource || this.audioContext.createMediaElementSource(video);
      this.audioGainNode = this.audioGainNode || this.audioContext.createGain();
      this.audioMediaSource.connect(this.audioGainNode);
      this.audioGainNode.connect(this.audioContext.destination);
      this.audioAmplificationAvailable = true;
      return true;
    } catch (_) {
      this.audioAmplificationAvailable = false;
      return false;
    }
  },

  applyAudioAmplification() {
    if (Number(this.audioAmplificationDb || 0) <= 0) {
      this.audioAmplificationAvailable = supportsTvWebAudioAmplification()
        && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
      if (this.audioGainNode) {
        try {
          this.audioGainNode.gain.value = 1;
        } catch (_) {
          // Best effort.
        }
      }
      return;
    }
    if (!this.ensureAudioAmplificationGraph()) {
      this.audioAmplificationAvailable = false;
      return;
    }
    try {
      if (this.audioContext?.state === "suspended") {
        void this.audioContext.resume().catch(() => {});
      }
      this.audioGainNode.gain.value = dbToGain(this.audioAmplificationDb);
      this.audioAmplificationAvailable = true;
    } catch (_) {
      this.audioAmplificationAvailable = false;
    }
  },

  applySubtitlePresentationSettings({ refreshTrackRendering = false } = {}) {
    const uiRoot = this.uiRefs?.root;
    const video = PlayerController.video;
    if (!uiRoot || !video) {
      return;
    }
    const style = this.subtitleStyleSettings || {};
    const verticalOffset = splitSubtitleVerticalOffset(style.verticalOffset);
    const subtitleColor = String(style.textColor || "#FFFFFF");
    const outlineColor = String(style.outlineColor || "#000000");
    const subtitleFontWeight = style.bold ? "800" : (Environment.isWebOS() ? "400" : "500");
    const boldShadow = style.bold
      ? `0.45px 0 0 ${subtitleColor}, -0.45px 0 0 ${subtitleColor}, 0 0.45px 0 ${subtitleColor}, 0 -0.45px 0 ${subtitleColor}`
      : "";
    const outlineShadow = style.outlineEnabled
      ? (Environment.isWebOS()
        ? `-2px -2px 0 ${outlineColor}, 0 -2px 0 ${outlineColor}, 2px -2px 0 ${outlineColor}, -2px 0 0 ${outlineColor}, 2px 0 0 ${outlineColor}, -2px 2px 0 ${outlineColor}, 0 2px 0 ${outlineColor}, 2px 2px 0 ${outlineColor}`
        : `0 0 2px ${outlineColor}, 0 0 4px ${outlineColor}`)
      : "";
    const subtitleShadow = [outlineShadow, boldShadow].filter(Boolean).join(", ") || "none";
    const subtitleFontSize = normalizeSubtitleFontSize(style.fontSize);
    const htmlSubtitleFontSize = formatHtmlSubtitleFontSize(subtitleFontSize);
    PlayerController.setWebOsSubtitleFontSize?.(subtitleFontSize);
    if (Environment.isTizen() && PlayerController.isUsingAvPlay?.()) {
      PlayerController.setAvPlayExternalSubtitleDelay?.(this.subtitleDelayMs);
    }
    uiRoot.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    uiRoot.style.setProperty("--player-subtitle-outline-color", outlineColor);
    uiRoot.style.setProperty("--player-subtitle-font-size", `${subtitleFontSize}%`);
    uiRoot.style.setProperty("--player-html-subtitle-font-size", htmlSubtitleFontSize);
    uiRoot.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
    uiRoot.style.setProperty("--player-subtitle-shadow", subtitleShadow);
    uiRoot.style.setProperty("--player-subtitle-offset", `${(verticalOffset.value * -2).toFixed(2)}vh`);
    video.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    video.style.setProperty("--player-subtitle-outline-color", outlineColor);
    video.style.setProperty("--player-subtitle-font-size", `${subtitleFontSize}%`);
    video.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
    video.style.setProperty("--player-subtitle-shadow", subtitleShadow);
    video.style.setProperty("--player-subtitle-offset", `${(verticalOffset.residualOffset * -2).toFixed(2)}vh`);
    this.refreshSubtitleCueStyles();
    this.renderBitmapSubtitleAtCurrentTime({ force: true });
    if (refreshTrackRendering) {
      this.refreshSubtitleTrackRendering();
    }
  },

  getSubtitleCueTrackList() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return Array.from(trackList).filter(Boolean);
    } catch (_) {
      const tracks = [];
      const length = Number(trackList.length || 0);
      for (let index = 0; index < length; index += 1) {
        const track = trackList[index] || trackList.item?.(index) || null;
        if (track) {
          tracks.push(track);
        }
      }
      return tracks;
    }
  },

  getSelectedWebOsEmbeddedTextTrack() {
    if (!Environment.isWebOS() || this.selectedEmbeddedSubtitleTrackIndex < 0) {
      return null;
    }
    const embeddedTrack = this.getEmbeddedSubtitleTrackByEmbeddedIndex(
      this.selectedEmbeddedSubtitleTrackIndex
    );
    if (!embeddedTrack || embeddedTrack.bitmapSubtitle) {
      return null;
    }
    const nativeTrackIndex = Number(embeddedTrack.nativeTrackIndex);
    if (!Number.isFinite(nativeTrackIndex) || nativeTrackIndex < 0) {
      return null;
    }
    return this.getSubtitleCueTrackList()[nativeTrackIndex] || null;
  },

  buildWebOsEmbeddedHtmlSubtitleCues(track) {
    return this.getSubtitleCueArray(track?.cues)
      .map((cue) => buildHtmlSubtitleCue(
        cue,
        this.getSubtitleCueSnapshot(cue),
        this.parseSubtitleCueText(cue?.text)
      ))
      .filter(Boolean);
  },

  activateWebOsEmbeddedHtmlSubtitleOverlay(track, cues, selectedIndex, overlayId) {
    if (
      !track
      || !cues.length
      || this.selectedEmbeddedSubtitleTrackIndex !== selectedIndex
      || this.getSelectedWebOsEmbeddedTextTrack() !== track
    ) {
      return false;
    }
    if (this.htmlSubtitleSelectedId !== overlayId) {
      this.clearHtmlSubtitleOverlay();
    }

    this.getSubtitleCueTrackList().forEach((candidate) => {
      try {
        candidate.mode = candidate === track ? "hidden" : "disabled";
      } catch (_) {
        // Luna has already hidden its renderer, so readonly modes remain harmless.
      }
    });
    this.webOsEmbeddedHtmlSubtitleTrack = track;
    this.webOsEmbeddedHtmlSubtitleCueCount = cues.length;
    this.htmlSubtitleCues = cues;
    this.htmlSubtitleSelectedId = overlayId;
    this.renderHtmlSubtitleOverlayAtCurrentTime();
    this.scheduleHtmlSubtitleOverlayRender();
    return true;
  },

  syncWebOsEmbeddedHtmlSubtitleOverlay(track = this.getSelectedWebOsEmbeddedTextTrack()) {
    if (
      !Environment.isWebOS()
      || !track
      || this.selectedEmbeddedSubtitleTrackIndex < 0
      || track !== this.getSelectedWebOsEmbeddedTextTrack()
    ) {
      return false;
    }
    const cues = this.buildWebOsEmbeddedHtmlSubtitleCues(track);
    if (!cues.length) {
      // Keep the native renderer visible until webOS exposes real cue data.
      return false;
    }

    const selectedIndex = Number(this.selectedEmbeddedSubtitleTrackIndex);
    const overlayId = `webos-embedded-${selectedIndex}`;
    if (this.htmlSubtitleSelectedId === overlayId) {
      void PlayerController.setWebOsEmbeddedSubtitleNativeVisibility?.(false, selectedIndex);
      return this.activateWebOsEmbeddedHtmlSubtitleOverlay(track, cues, selectedIndex, overlayId);
    }
    if (
      this.webOsEmbeddedHtmlSubtitleActivationKey === overlayId
      || typeof PlayerController.setWebOsEmbeddedSubtitleNativeVisibility !== "function"
    ) {
      return false;
    }

    this.webOsEmbeddedHtmlSubtitleActivationKey = overlayId;
    Promise.resolve(
      PlayerController.setWebOsEmbeddedSubtitleNativeVisibility(false, selectedIndex)
    ).then((nativeRendererHidden) => {
      if (this.webOsEmbeddedHtmlSubtitleActivationKey !== overlayId) {
        return;
      }
      this.webOsEmbeddedHtmlSubtitleActivationKey = "";
      if (!nativeRendererHidden) {
        return;
      }
      const currentCues = this.buildWebOsEmbeddedHtmlSubtitleCues(track);
      this.activateWebOsEmbeddedHtmlSubtitleOverlay(track, currentCues, selectedIndex, overlayId);
    }).catch(() => {
      if (this.webOsEmbeddedHtmlSubtitleActivationKey === overlayId) {
        this.webOsEmbeddedHtmlSubtitleActivationKey = "";
      }
    });
    return false;
  },

  refreshWebOsEmbeddedHtmlSubtitleOverlayIfNeeded() {
    const track = this.webOsEmbeddedHtmlSubtitleTrack;
    if (!track || !this.htmlSubtitleSelectedId?.startsWith?.("webos-embedded-")) {
      return false;
    }
    const cueCount = this.getSubtitleCueArray(track.cues).length;
    if (cueCount !== this.webOsEmbeddedHtmlSubtitleCueCount) {
      return this.syncWebOsEmbeddedHtmlSubtitleOverlay(track);
    }
    return false;
  },

  clearSubtitleCueStyleBindings() {
    if (!(this.subtitleCueStyleBindings instanceof Map)) {
      this.subtitleCueStyleBindings = new Map();
      return;
    }
    this.subtitleCueStyleBindings.forEach((handler, track) => {
      try {
        track?.removeEventListener?.("cuechange", handler);
      } catch (_) {
        // Best effort.
      }
    });
    this.subtitleCueStyleBindings.clear();
  },

  clearEmbeddedSubtitleCueRefreshTimers() {
    if (this.embeddedSubtitleCueRefreshTimers instanceof Set) {
      this.embeddedSubtitleCueRefreshTimers.forEach((timerId) => clearTimeout(timerId));
      this.embeddedSubtitleCueRefreshTimers.clear();
    } else {
      this.embeddedSubtitleCueRefreshTimers = new Set();
    }
    this.webOsEmbeddedCueRefreshApplied = false;
  },

  refreshWebOsEmbeddedSubtitleAfterCueMutation() {
    if (
      !Environment.isWebOS()
      || this.webOsEmbeddedCueRefreshApplied
      || this.selectedEmbeddedSubtitleTrackIndex < 0
    ) {
      return;
    }
    this.webOsEmbeddedCueRefreshApplied = true;
    this.refreshSubtitleTrackRendering();
  },

  scheduleEmbeddedSubtitleCueRefresh() {
    if (this.embeddedSubtitleCueRefreshTimers instanceof Set) {
      this.embeddedSubtitleCueRefreshTimers.forEach((timerId) => clearTimeout(timerId));
      this.embeddedSubtitleCueRefreshTimers.clear();
    } else {
      this.embeddedSubtitleCueRefreshTimers = new Set();
    }
    if (!Environment.isWebOS() || this.selectedEmbeddedSubtitleTrackIndex < 0) {
      return;
    }
    const selectedIndex = this.selectedEmbeddedSubtitleTrackIndex;
    [0, 400, 1200].forEach((delayMs) => {
      const timerId = setTimeout(() => {
        this.embeddedSubtitleCueRefreshTimers?.delete?.(timerId);
        if (this.selectedEmbeddedSubtitleTrackIndex !== selectedIndex) {
          return;
        }
        const changed = this.refreshSubtitleCueStyles();
        if (changed) {
          this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
        }
      }, delayMs);
      this.embeddedSubtitleCueRefreshTimers.add(timerId);
    });
  },

  getSubtitleCueSnapshot(cue) {
    if (!cue || typeof cue !== "object") {
      return null;
    }
    if (!(this.subtitleCueOriginalState instanceof WeakMap)) {
      this.subtitleCueOriginalState = new WeakMap();
    }
    let snapshot = this.subtitleCueOriginalState.get(cue);
    if (!snapshot) {
      snapshot = {
        startTime: cue.startTime,
        endTime: cue.endTime,
        line: cue.line,
        lineAlign: cue.lineAlign,
        position: cue.position,
        positionAlign: cue.positionAlign,
        snapToLines: cue.snapToLines
      };
      this.subtitleCueOriginalState.set(cue, snapshot);
    }
    return snapshot;
  },

  applySubtitleCueDelay(cue, snapshot, delayMs = 0) {
    if (!cue || !snapshot) {
      return;
    }
    const offsetSeconds = Number(delayMs || 0) / 1000;
    const startTime = Number(snapshot.startTime);
    const endTime = Number(snapshot.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return;
    }
    const nextStart = Math.max(0, startTime + offsetSeconds);
    const nextEnd = Math.max(nextStart + 0.001, endTime + offsetSeconds);
    try {
      cue.startTime = nextStart;
      cue.endTime = nextEnd;
    } catch (_) {
      // Some native text tracks expose readonly cue timing.
    }
  },

  restoreSubtitleCueSnapshot(cue, snapshot) {
    if (!cue || !snapshot) {
      return;
    }
    try {
      cue.line = snapshot.line;
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("lineAlign" in cue) {
        cue.lineAlign = snapshot.lineAlign;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("position" in cue) {
        cue.position = snapshot.position;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("positionAlign" in cue) {
        cue.positionAlign = snapshot.positionAlign;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("snapToLines" in cue) {
        cue.snapToLines = snapshot.snapToLines;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
  },

  applySubtitleCueVerticalOffset(cue, snapshot, offset) {
    if (!cue || !snapshot) {
      return;
    }
    const { lineOffset } = splitSubtitleVerticalOffset(offset);
    if (lineOffset === 0) {
      this.restoreSubtitleCueSnapshot(cue, snapshot);
      return;
    }

    try {
      if ("snapToLines" in cue) {
        cue.snapToLines = true;
      }
    } catch (_) {
      // Ignore cue styling failures.
    }

    const baseLine = Number.isFinite(Number(snapshot.line)) ? Number(snapshot.line) : -1;
    const adjustedLine = clamp(baseLine - lineOffset, -100, 100);
    try {
      cue.line = adjustedLine;
    } catch (_) {
      // Ignore cue styling failures.
    }
  },

  getSubtitleAssAlignment(content) {
    return getSubtitleAssAlignment(content);
  },

  hasSubtitleAssSyntax(content) {
    return /\{[^}]*[\\/][a-z0-9]+[^}]*\}|\\[Nnh]/i.test(String(content || ""));
  },

  getSubtitleAssAlignmentSettings(alignment) {
    return getSubtitleAssAlignmentSettings(alignment);
  },

  applySubtitleAssAlignmentToCue(cue, alignment) {
    const settings = this.getSubtitleAssAlignmentSettings(alignment);
    if (!cue || !settings) {
      return;
    }
    try {
      if ("snapToLines" in cue) {
        cue.snapToLines = false;
      }
    } catch (_) {
      // Ignore cue positioning failures.
    }
    try {
      cue.line = settings.line;
    } catch (_) {
      // Ignore cue positioning failures.
    }
    try {
      cue.align = settings.align;
    } catch (_) {
      // Ignore cue positioning failures.
    }
  },

  copySubtitleCuePresentation(sourceCue, targetCue) {
    if (!sourceCue || !targetCue) {
      return;
    }
    [
      "id",
      "pauseOnExit",
      "region",
      "vertical",
      "snapToLines",
      "line",
      "lineAlign",
      "position",
      "positionAlign",
      "size",
      "align"
    ].forEach((property) => {
      try {
        if (property in sourceCue && property in targetCue) {
          targetCue[property] = sourceCue[property];
        }
      } catch (_) {
        // Ignore cue presentation copy failures.
      }
    });
  },

  replaceSubtitleCueText(track, cue, text) {
    if (!track || !cue || typeof text !== "string") {
      return false;
    }
    const CueCtor = typeof VTTCue === "function"
      ? VTTCue
      : (typeof TextTrackCue === "function" ? TextTrackCue : null);
    if (!CueCtor || typeof track.removeCue !== "function" || typeof track.addCue !== "function") {
      return false;
    }
    try {
      const replacement = new CueCtor(cue.startTime, cue.endTime, text);
      this.copySubtitleCuePresentation(cue, replacement);
      const snapshot = this.subtitleCueOriginalState instanceof WeakMap
        ? this.subtitleCueOriginalState.get(cue)
        : null;
      if (snapshot && this.subtitleCueOriginalState instanceof WeakMap) {
        this.subtitleCueOriginalState.set(replacement, snapshot);
      }
      track.removeCue(cue);
      track.addCue(replacement);
      return true;
    } catch (_) {
      return false;
    }
  },

  sanitizeSubtitleCueText(cue, track = null) {
    if (!cue || typeof cue !== "object" || typeof cue.text !== "string") {
      return false;
    }
    if (!this.hasSubtitleAssSyntax(cue.text)) {
      return false;
    }
    this.applySubtitleAssAlignmentToCue(cue, this.getSubtitleAssAlignment(cue.text));
    const cleaned = this.sanitizeSubtitleText(cue.text, { preserveBasicStyle: false });
    if (cleaned === cue.text) {
      return false;
    }
    try {
      cue.text = cleaned;
      return true;
    } catch (_) {
      return this.replaceSubtitleCueText(track, cue, cleaned);
    }
  },

  getSubtitleCueArray(cues) {
    if (!cues || typeof cues.length !== "number") {
      return [];
    }
    const cueCount = Number(cues.length || 0);
    const items = [];
    for (let index = 0; index < cueCount; index += 1) {
      const cue = cues[index] || cues.item?.(index) || null;
      if (cue) {
        items.push(cue);
      }
    }
    return items;
  },

  sanitizeSubtitleCuesForTrack(track) {
    const allCues = this.getSubtitleCueArray(track?.cues);
    const activeCues = this.getSubtitleCueArray(track?.activeCues);
    const seen = new Set();
    let changed = false;
    [...allCues, ...activeCues].forEach((cue) => {
      if (!cue || seen.has(cue)) {
        return;
      }
      seen.add(cue);
      changed = this.sanitizeSubtitleCueText(cue, track) || changed;
    });
    return changed;
  },

  syncSubtitleCueStylesForTrack(track) {
    if (!track) {
      return false;
    }
    const subtitleTextChanged = this.sanitizeSubtitleCuesForTrack(track);
    const style = this.subtitleStyleSettings || {};
    const verticalOffset = normalizeSubtitleVerticalOffset(style.verticalOffset);
    const allCues = this.getSubtitleCueArray(track.cues);
    const activeCues = this.getSubtitleCueArray(track.activeCues);
    const seen = new Set();
    [...allCues, ...activeCues].forEach((cue) => {
      if (!cue || seen.has(cue)) {
        return;
      }
      seen.add(cue);
      const snapshot = this.getSubtitleCueSnapshot(cue);
      this.applySubtitleCueDelay(cue, snapshot, this.subtitleDelayMs);
      this.applySubtitleCueVerticalOffset(cue, snapshot, verticalOffset);
    });
    return subtitleTextChanged;
  },

  refreshSubtitleCueStyles() {
    const tracks = this.getSubtitleCueTrackList();
    if (!tracks.length) {
      return false;
    }

    let subtitleTextChanged = false;
    tracks.forEach((track) => {
      if (!track) {
        return;
      }
      if (typeof track.addEventListener === "function" && !this.subtitleCueStyleBindings.has(track)) {
        const handler = () => {
          const subtitleTextChanged = this.syncSubtitleCueStylesForTrack(track);
          if (subtitleTextChanged) {
            this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
          }
          this.syncWebOsEmbeddedHtmlSubtitleOverlay(track);
        };
        try {
          track.addEventListener("cuechange", handler);
          this.subtitleCueStyleBindings.set(track, handler);
        } catch (_) {
          // Ignore listener registration failures.
        }
      }
      subtitleTextChanged = this.syncSubtitleCueStylesForTrack(track) || subtitleTextChanged;
    });
    this.syncWebOsEmbeddedHtmlSubtitleOverlay();
    return subtitleTextChanged;
  },

  refreshSubtitleTrackRendering() {
    if (Environment.isWebOS()) {
      if (
        this.selectedEmbeddedSubtitleTrackIndex < 0
        || typeof PlayerController.setWebOsEmbeddedSubtitleTrack !== "function"
      ) {
        return;
      }
      const selectedIndex = this.selectedEmbeddedSubtitleTrackIndex;
      const embeddedTrack = this.getEmbeddedSubtitleTrackByEmbeddedIndex(selectedIndex);
      if (embeddedTrack?.bitmapSubtitle) {
        this.renderBitmapSubtitleAtCurrentTime({ force: true });
        return;
      }
      if (this.syncWebOsEmbeddedHtmlSubtitleOverlay()) {
        return;
      }
      const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
      const targetTrackIndex = Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0
        ? nativeTrackIndex
        : selectedIndex;
      const timerId = setTimeout(() => {
        this.embeddedSubtitleCueRefreshTimers?.delete?.(timerId);
        if (this.selectedEmbeddedSubtitleTrackIndex !== selectedIndex) {
          return;
        }
        PlayerController.setWebOsEmbeddedSubtitleTrack(targetTrackIndex, selectedIndex);
      }, 50);
      this.embeddedSubtitleCueRefreshTimers.add(timerId);
      return;
    }
    const restoreTrackMode = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    this.getSubtitleCueTrackList().forEach((track) => {
      if (!track || track.mode !== "showing") {
        return;
      }
      try {
        track.mode = "hidden";
      } catch (_) {
        return;
      }
      restoreTrackMode(() => {
        try {
          track.mode = "showing";
        } catch (_) {
          // Ignore native text-track refresh failures.
        }
      });
    });

  },

  updateModalBackdrop() {
    const modalBackdrop = this.uiRefs?.modalBackdrop;
    const controlsOverlay = this.uiRefs?.controlsOverlay;
    if (!modalBackdrop) {
      return;
    }
    const hasModal = this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible || this.speedDialogVisible;
    modalBackdrop.classList.toggle("hidden", !hasModal);
    modalBackdrop.classList.toggle("episodes-open", Boolean(this.episodePanelVisible));
    controlsOverlay?.classList.toggle("modal-blocked", hasModal);
  },

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const isTizenAvPlayPlayback = () => Boolean(
      Environment.isTizen()
      && typeof PlayerController.isUsingAvPlay === "function"
      && PlayerController.isUsingAvPlay()
    );

    const onWaiting = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      if (isTizenAvPlayPlayback() && this.hasPresentedPlaybackFrame && this.getPlaybackCurrentSeconds() > 0) {
        this.loadingVisible = false;
        this.updateLoadingVisibility();
        return;
      }
      this.dismissPauseOverlay();
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      if (!this.sourcesPanelVisible && !this.isSeekOverlaySuppressingControls()) {
        this.setControlsVisible(true, { focus: false });
      }
      this.schedulePlaybackStallGuard();
    };

    const onPlaying = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      if (this.seekLoading) {
        this.seekLoading = false;
        this.seekLoadingBaselineSeconds = null;
        this.seekLoadingTargetSeconds = null;
        this.clearBufferingSpinnerTimer();
      }
      if (isTizenAvPlayPlayback()) {
        this.lastPlaybackErrorAt = 0;
        this.sourcesError = "";
        if (this.currentEngineFsStream && !this.isEngineFsStartupReady()) {
          this.loadingVisible = true;
          this.updateLoadingVisibility();
          this.updateUiTick();
          this.schedulePlaybackStallGuard({ timeoutMs: 12000 });
          this.scheduleLoadingCompletionCheck(250);
          return;
        }
        this.markPlaybackProgress();
        this.paused = false;
        this.seekOverlaySuppressControlsUntil = 0;
        this.startupTrackPreferenceReady = true;
        this.dismissPauseOverlay();
        this.updateMediaSessionPlaybackState();
        this.refreshTrackDialogs();
        this.applyAudioAmplification();
        this.applySubtitlePresentationSettings();
        this.applyAspectMode({ showToast: false });
        this.attemptPendingPlaybackRestore();
        this.setLoadingLogoFillTarget(1);
        this.markPlaybackPresentedAfterAdvance();
        this.updateLoadingVisibility();
        this.scheduleLoadingCompletionCheck(250);
        this.updateUiTick();
        this.resetControlsAutoHide();
        this.maybeShowParentalGuideOverlay();
        return;
      }
      if (this.currentEngineFsStream && !this.hasPresentedPlaybackFrame) {
        this.lastPlaybackErrorAt = 0;
        this.sourcesError = "";
        this.paused = false;
        this.updateMediaSessionPlaybackState();
        this.schedulePlaybackStallGuard({ timeoutMs: 12000 });
        this.scheduleLoadingCompletionCheck(250);
        this.updateUiTick();
        return;
      }
      if (this.startupAudioGateActive && !this.startupAudioGateAllowsNativePlayback) {
        this.paused = false;
        this.startupTrackPreferenceReady = true;
        this.refreshTrackDialogs();
        this.applyAudioAmplification();
        this.applySubtitlePresentationSettings();
        this.applyAspectMode({ showToast: false });
        this.scheduleLoadingCompletionCheck(250);
        return;
      }
      // Fire-and-forget scrobble start (debounced internally)
      if (TraktScrobbleService.isEnabled()) {
        TraktScrobbleService.start(this.buildScrobbleContext());
      }
      this.lastPlaybackErrorAt = 0;
      this.sourcesError = "";
      this.markPlaybackProgress();
      this.paused = false;
      this.seekOverlaySuppressControlsUntil = 0;
      this.startupTrackPreferenceReady = true;
      this.dismissPauseOverlay();
      this.updateMediaSessionPlaybackState();
      this.refreshTrackDialogs();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.attemptPendingPlaybackRestore();
      this.setLoadingLogoFillTarget(1);
      this.markPlaybackPresentedAfterAdvance();
      this.updateLoadingVisibility();
      this.updateUiTick();
      this.scheduleLoadingCompletionCheck(900);
      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
      }
      this.resetControlsAutoHide();
      this.maybeShowParentalGuideOverlay();
      setTimeout(() => {
        this.attemptSilentAudioRecovery("playing");
      }, 700);
    };

    const onPause = () => {
      if (this.startupAudioGateActive) {
        this.paused = false;
        this.updateMediaSessionPlaybackState();
        return;
      }
      const ended = typeof PlayerController.isPlaybackEnded === "function"
        ? PlayerController.isPlaybackEnded()
        : Boolean(video.ended);
      if (ended) {
        return;
      }
      // Immediate scrobble pause
      if (TraktScrobbleService.isEnabled()) {
        TraktScrobbleService.pause(this.buildScrobbleContext());
      }
      this.clearPlaybackStallGuard();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.updateUiTick();
      this.renderControlButtons();
      this.schedulePauseOverlay();
    };

    const onTimeUpdate = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      if (
        isTizenAvPlayPlayback()
        && this.loadingVisible
        && (!this.currentEngineFsStream || this.isEngineFsStartupReady())
      ) {
        this.setLoadingLogoFillTarget(1);
        const playbackPresented = this.markPlaybackPresentedAfterAdvance();
        this.updateLoadingVisibility();
        this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 180);
      }
      if (this.currentEngineFsStream && !this.hasPresentedPlaybackFrame && this.isEngineFsStartupReady()) {
        this.setLoadingLogoFillTarget(1);
        const playbackPresented = this.markPlaybackPresentedAfterAdvance();
        this.updateLoadingVisibility();
        this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 180);
      }
      if (this.loadingVisible && !this.hasPresentedPlaybackFrame) {
        const playbackPresented = this.markPlaybackPresentedAfterAdvance();
        this.updateLoadingVisibility();
        this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 120);
      }
      this.markPlaybackProgress();
      this.attemptPendingPlaybackRestore();
      this.refreshWebOsEmbeddedHtmlSubtitleOverlayIfNeeded();
      this.renderHtmlSubtitleOverlayAtCurrentTime();
      this.updateUiTick();
    };

    const onProgress = () => {
      this.updateUiTick();
    };

    const onLoadedMetadata = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.attemptPendingPlaybackRestore({ force: true });

      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
      this.updateUiTick();
      this.markPlaybackProgress();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.ensureTrackDataWarmup();
      if (this.paused) {
        this.schedulePauseOverlay();
      }
      this.startTrackDiscoveryWindow({ durationMs: 5000, intervalMs: 300 });
      this.scheduleLoadingCompletionCheck(900);
      setTimeout(() => {
        this.attemptSilentAudioRecovery("metadata");
      }, 500);
    };

    const onPlayable = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.attemptPendingPlaybackRestore();
      this.completeSeekLoadingIfReady();
      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.scheduleLoadingCompletionCheck(120);
      this.updateUiTick();
    };

    const onSeeked = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.attemptPendingPlaybackRestore();
      this.completeSeekLoadingIfReady();
      this.markPlaybackProgress();
      this.updateUiTick();
    };

    const onTrackListChanged = () => {
      this.refreshTrackDialogs();
      if (this.refreshSubtitleCueStyles()) {
        this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
      }
      const embeddedAudioDiscoveryPending = this.canDiscoverEmbeddedAudioTracks()
        && this.embeddedAudioTracks.length <= 0;
      if (
        this.trackDiscoveryInProgress
        && !embeddedAudioDiscoveryPending
        && this.hasAudioTracksAvailable()
        && this.hasSubtitleTracksAvailable()
      ) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
      }
    };

    const onWebOsAudioTrackSelectionChanged = (event) => {
      const detail = event?.detail || {};
      const status = String(detail?.status || "");
      const existingPending = this.pendingWebOsAudioSelection;
      const samePendingSelection = existingPending
        && existingPending.selectionKind === detail.selectionKind
        && Number(existingPending.selectedTrackIndex) === Number(detail.selectedTrackIndex);

      if (status === "pending") {
        this.pendingWebOsAudioSelection = {
          ...detail,
          entryId: samePendingSelection ? existingPending.entryId : "",
          automaticFallback: samePendingSelection ? Boolean(existingPending.automaticFallback) : false,
          rememberSelection: samePendingSelection ? Boolean(existingPending.rememberSelection) : false,
          trackPreference: samePendingSelection ? existingPending.trackPreference : null
        };
        this.invalidateTrackDialogCaches();
        this.renderAudioDialog();
        return;
      }

      if (status === "confirmed") {
        const shouldReapplyStartupSubtitlePreference = !this.startupAudioPreferenceApplied;
        if (detail.selectionKind === "embedded") {
          this.selectedEmbeddedAudioTrackIndex = Number(detail.selectedTrackIndex);
          this.selectedAudioTrackIndex = Number(detail.selectedTrackIndex);
        } else {
          this.selectedEmbeddedAudioTrackIndex = -1;
          this.selectedAudioTrackIndex = Number(detail.targetTrackIndex);
        }
        this.pendingWebOsAudioSelection = null;
        this.failedAutomaticAudioFallbackEntryId = "";
        if (samePendingSelection && existingPending.rememberSelection) {
          this.rememberAudioTrackSelection(existingPending.trackPreference);
        }
        if (shouldReapplyStartupSubtitlePreference) {
          this.startupSubtitlePreferenceApplied = false;
        }
        if (this.startupAudioGateActive && existingPending?.automaticFallback) {
          this.clearStartupAudioPreferenceRetry();
          this.startupAudioPreferenceApplied = true;
        }
        this.refreshTrackDialogs();
        if (this.startupAudioGateActive && this.startupAudioPreferenceApplied) {
          this.scheduleLoadingCompletionCheck(0, { force: true });
        }
        return;
      }

      if (status === "failed") {
        if (samePendingSelection && existingPending.automaticFallback) {
          this.failedAutomaticAudioFallbackEntryId = existingPending.entryId || "";
          if (this.startupAudioGateActive) {
            this.clearStartupAudioPreferenceRetry();
            this.startupAudioPreferenceApplied = true;
          }
        }
        this.pendingWebOsAudioSelection = null;
        console.warn("webOS audio track selection failed", detail?.error || detail);
        this.invalidateTrackDialogCaches();
        this.renderControlButtons();
        this.renderAudioDialog();
        if (this.startupAudioGateActive && this.startupAudioPreferenceApplied) {
          this.scheduleLoadingCompletionCheck(0, { force: true });
        }
      }
    };

    const onAvPlaySubtitleChange = (event) => {
      this.renderAvPlaySubtitleChange(event?.detail || {});
    };

    const onError = async (event) => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.seekLoading = false;
      this.seekLoadingBaselineSeconds = null;
      this.seekLoadingTargetSeconds = null;
      const now = Date.now();
      if ((now - Number(this.lastPlaybackErrorAt || 0)) < 120) {
        return;
      }
      this.lastPlaybackErrorAt = now;

      const detailErrorCode = Number(event?.detail?.mediaErrorCode || 0);
      const controllerErrorCode = typeof PlayerController.getLastPlaybackErrorCode === "function"
        ? Number(PlayerController.getLastPlaybackErrorCode() || 0)
        : 0;
      const mediaErrorCode = detailErrorCode || Number(video?.error?.code || 0) || controllerErrorCode;
      const eventDetail = event?.detail && typeof event.detail === "object" ? event.detail : {};
      const playbackErrorDetail = this.getPlaybackEventErrorDetail(eventDetail);
      const avplayError = String(eventDetail?.avplayError || "").toLowerCase();
      const normalizedPlaybackErrorDetail = String(playbackErrorDetail || "").toLowerCase();
      const currentSourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
      const currentEngineFsState = this.currentEngineFsStream || null;
      const publicEngineFsUrl = String(currentEngineFsState?.publicPlaybackUrl || "").trim();
      const isLocalEngineFsNetworkFailure = currentEngineFsState?.baseUrlKind === "local-service"
        && publicEngineFsUrl
        && publicEngineFsUrl !== this.activePlaybackUrl
        && (
          mediaErrorCode === 2
          || avplayError.includes("connection refused")
          || normalizedPlaybackErrorDetail.includes("network")
          || normalizedPlaybackErrorDetail.includes("failed")
        );
      if (!this.hasPresentedPlaybackFrame && isLocalEngineFsNetworkFailure) {
        const sourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
        const engineFs = {
          ...(sourceCandidate?.engineFs || currentEngineFsState),
          playbackUrl: publicEngineFsUrl,
          publicPlaybackUrl: publicEngineFsUrl,
          baseUrlKind: "public-fallback"
        };
        if (sourceCandidate) {
          Object.assign(sourceCandidate, {
            url: publicEngineFsUrl,
            externalUrl: null,
            engineFs,
            raw: {
              ...(sourceCandidate.raw || {}),
              engineFs
            }
          });
          this.streamCandidates = this.streamCandidates.map((entry) => (
            entry.id === sourceCandidate.id ? { ...entry, ...sourceCandidate } : entry
          ));
        }
        this.lastPlaybackErrorAt = 0;
        this.loadingVisible = true;
        this.paused = false;
        this.sourcesError = null;
        this.currentEngineFsStream = engineFs;
        this.engineFsPlaybackToken = claimEngineFsPlayback(this.currentEngineFsStream);
        this.updateLoadingVisibility();
        console.warn("EngineFS local playback failed; switching to public playback URL", {
          fromBaseUrlKind: currentEngineFsState.baseUrlKind,
          playbackUrl: publicEngineFsUrl,
          mediaErrorCode,
          avplayError
        });
        void this.playStreamByUrl(publicEngineFsUrl, {
          preservePanel: true,
          resetSilentAudioState: false,
          preservePendingRestore: Boolean(this.pendingPlaybackRestore),
          sourceCandidate: sourceCandidate || {
            url: publicEngineFsUrl,
            engineFs
          }
        });
        return;
      }

      if (!this.hasPresentedPlaybackFrame && (mediaErrorCode === 2 || mediaErrorCode === 3 || mediaErrorCode === 4)) {
        if (currentEngineFsState) {
          const stats = await this.fetchCurrentEngineFsStats({ timeoutMs: 2500 });
          if (this.shouldRetryEngineFsStartupError(stats)) {
            this.scheduleEngineFsStartupRetry({ mediaErrorCode, stats });
            return;
          }
        }

        this.markPlaybackSourceFailed(this.activePlaybackUrl);
        const targetEngine = typeof PlayerController.getAlternativePlaybackEngine === "function"
          ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
          : null;
        if (targetEngine) {
          this.lastPlaybackErrorAt = 0;
          this.loadingVisible = true;
          this.paused = false;
          this.sourcesError = null;
          this.updateLoadingVisibility();
          console.warn("Playback failed during startup; switching player engine", {
            url: this.activePlaybackUrl,
            mediaErrorCode,
            from: PlayerController.playbackEngine,
            to: targetEngine
          });
          void this.playStreamByUrl(this.activePlaybackUrl, {
            preservePanel: true,
            resetSilentAudioState: false,
            preservePendingRestore: Boolean(this.pendingPlaybackRestore),
            forceEngine: targetEngine
          });
          return;
        }
        this.markPlaybackSourceFailed(this.activePlaybackUrl);
        const startupErrorMessage = this.getStartupErrorMessage(mediaErrorCode, playbackErrorDetail, currentSourceCandidate);
        this.clearPlaybackStallGuard();
        this.releaseStartupAudioGate({ resume: false });
        this.showStartupError(startupErrorMessage, {
          mediaErrorCode,
          detail: playbackErrorDetail,
          eventDetail,
          streamCandidate: currentSourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "startup-media-error"
        });
        console.warn("Playback failed during startup", {
          url: this.activePlaybackUrl,
          mediaErrorCode,
          avplayError
        });
        return;
      }

      this.markPlaybackSourceFailed(this.activePlaybackUrl);

      this.clearPlaybackStallGuard();
      this.releaseStartupAudioGate({ resume: false });
      this.loadingVisible = false;
      this.paused = true;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
      this.sourcesError = this.formatPlaybackErrorForSources(
        `${this.mediaErrorMessage(mediaErrorCode, playbackErrorDetail, currentSourceCandidate)}. Choose another source manually.`,
        {
          mediaErrorCode,
          detail: playbackErrorDetail,
          eventDetail,
          streamCandidate: currentSourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "media-error"
        }
      );
      if (this.currentEngineFsStream) {
        logEngineFsDebug("EngineFS playback failed; keeping torrent alive until player exit or source change", {
          reason: "playback-error",
          infoHash: this.currentEngineFsStream.infoHash,
          fileIdx: this.currentEngineFsStream.fileIdx
        });
      }
      if (this.currentEngineFsStream) {
        this.renderSourcesPanel();
      } else if (this.streamCandidates.length > 1) {
        this.openSourcesPanel();
      } else {
        this.renderSourcesPanel();
      }

      console.warn("Playback failed", {
        url: this.activePlaybackUrl,
        mediaErrorCode
      });
    };

    const bindings = [
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["error", onError],
      ["pause", onPause],
      ["progress", onProgress],
      ["timeupdate", onTimeUpdate],
      ["loadedmetadata", onLoadedMetadata],
      ["loadeddata", onPlayable],
      ["canplay", onPlayable],
      ["seeked", onSeeked],
      ["avplaytrackschanged", onTrackListChanged],
      ["avplaysubtitlechange", onAvPlaySubtitleChange],
      ["webosaudiotrackselectionchanged", onWebOsAudioTrackSelectionChanged],
      ["hlstrackschanged", onTrackListChanged],
      ["dashtrackschanged", onTrackListChanged]
    ];

    bindings.forEach(([eventName, handler]) => {
      video.addEventListener(eventName, handler);
      this.videoListeners.push({ target: video, eventName, handler });
    });

    const trackTargets = [this.getVideoTextTrackList(), this.getVideoAudioTrackList()].filter(Boolean);
    trackTargets.forEach((target) => {
      if (typeof target.addEventListener !== "function") {
        return;
      }
      ["addtrack", "removetrack", "change"].forEach((eventName) => {
        target.addEventListener(eventName, onTrackListChanged);
        this.videoListeners.push({ target, eventName, handler: onTrackListChanged });
      });
    });
  },

  unbindVideoEvents() {
    this.videoListeners.forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.videoListeners = [];
  },

  getControlDefinitions() {
    const uiState = this.getPlayerUiState();
    const nextEpisode = this.resolveNextEpisodeInfo();
    const base = [
      {
        action: "playPause",
        label: this.paused ? ">" : "II",
        icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
        title: "Play/Pause",
        primary: true
      }
    ];

    if (nextEpisode?.hasAired && !this.nextEpisodeLaunching) {
      base.push({
        action: "playNextEpisode",
        icon: "assets/icons/ic_player_skip_next.svg",
        useMask: true,
        title: t("next_episode_label", {}, "Next episode")
      });
    }

    base.push({ action: "subtitleDialog", icon: "assets/icons/ic_player_subtitles.svg", title: t("subtitle_dialog_title", {}, "Subtitles") });

    base.push({
      action: "audioTrack",
      icon: this.selectedAudioTrackIndex >= 0 || this.selectedManifestAudioTrackId
        ? "assets/icons/ic_player_audio_filled.svg"
        : "assets/icons/ic_player_audio_outline.svg",
      useMask: true,
      title: t("audio_dialog_title", {}, "Audio")
    });

    base.push({ action: "source", icon: "assets/icons/ic_player_source.svg", title: t("sources_title", {}, "Sources") });

    if (Array.isArray(uiState.episodesAll) && uiState.episodesAll.length) {
      base.push({ action: "episodes", icon: "assets/icons/ic_player_episodes.svg", title: t("episodes_panel_title", {}, "Episodes") });
    }

    base.push({ action: "more", label: this.moreActionsVisible ? "<" : ">", title: t("player_more_actions_title", {}, "More Actions") });

    if (!this.moreActionsVisible) {
      return base;
    }

    const playbackSpeed = this.getPlaybackSpeed();
    return [
      ...base.slice(0, Math.max(0, base.length - 1)),
      { action: "speed", label: `${playbackSpeed.toFixed(playbackSpeed % 1 ? 2 : 0)}x`, title: t("player_playback_speed", {}, "Playback speed") },
      { action: "aspect", icon: "assets/icons/ic_player_aspect_ratio.svg", title: t("player_more_aspect_ratio", {}, "Aspect Ratio") },
      { action: "backFromMore", label: "<", title: t("player_go_back", {}, "Back") }
    ];
  },

  renderControlButtons() {
    if (this.isExternalFrameMode()) {
      return;
    }
    const wrap = this.uiRefs?.controlButtons;
    if (!wrap) {
      return;
    }

    const controls = this.getControlDefinitions();
    if (this.stickyProgressFocus && this.controlsVisible && !this.isDialogOpen() && this.isSeekBarAvailable()) {
      this.controlFocusZone = "progress";
    }
    this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));

    wrap.innerHTML = controls.map((control) => `
      <button class="player-control-btn focusable${control.primary ? " is-primary" : ""}"
              data-action="${control.action}"
              title="${escapeHtml(control.title || "")}">
        ${control.icon
          ? ((control.primary || control.useMask)
            ? `<span class="player-control-icon player-control-icon-mask" style="-webkit-mask-image:url('${escapeHtml(control.icon)}');mask-image:url('${escapeHtml(control.icon)}');" aria-hidden="true"></span>`
            : `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />`)
          : `<span class="player-control-label">${escapeHtml(control.label || "")}</span>`}
      </button>
    `).join("");

    const buttons = Array.from(wrap.querySelectorAll(".player-control-btn"));
    buttons.forEach((button, index) => {
      button.classList.toggle("focused", this.controlFocusZone === "buttons" && index === this.controlFocusIndex);
    });
    const progressShell = this.uiRefs?.progressShell;
    if (progressShell) {
      progressShell.classList.toggle("focused", this.controlFocusZone === "progress");
    }

    if (this.controlFocusZone === "progress") {
      buttons.forEach((button) => {
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      if (progressShell && document.activeElement !== progressShell && typeof progressShell.focus === "function") {
        progressShell.focus();
      }
    } else if (this.controlFocusZone === "buttons") {
      if (progressShell && document.activeElement === progressShell && typeof progressShell.blur === "function") {
        progressShell.blur();
      }
      const focusedButton = buttons[this.controlFocusIndex] || null;
      if (focusedButton && document.activeElement !== focusedButton && typeof focusedButton.focus === "function") {
        focusedButton.focus();
      }
    } else if (this.controlFocusZone === "skipIntro") {
      buttons.forEach((button) => {
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      if (progressShell && document.activeElement === progressShell && typeof progressShell.blur === "function") {
        progressShell.blur();
      }
    }
    this.syncSkipIntroFocusState();
    this.renderNextEpisodeCard();
    this.syncPlayerOverlayLayoutState();
    this.renderBitmapSubtitleAtCurrentTime();
  },

  isDialogOpen() {
    return this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible || this.speedDialogVisible;
  },

  syncPlayerOverlayLayoutState() {
    const root = this.uiRefs?.root;
    if (!root) {
      return;
    }
    root.classList.toggle("controls-visible", Boolean(this.controlsVisible) && !this.isExternalFrameMode());
    this.syncPlayerActionOverlayOffset();
  },

  measurePlayerActionOverlayOffset() {
    const root = this.uiRefs?.root;
    const controlsBottom = this.uiRefs?.controlsBottom;
    if (!root || !controlsBottom || !this.controlsVisible || this.isExternalFrameMode()) {
      return null;
    }

    const rootRect = root.getBoundingClientRect?.();
    const controlsRect = controlsBottom.getBoundingClientRect?.();
    if (!rootRect || !controlsRect) {
      return null;
    }

    const rootBottom = Number(rootRect.bottom);
    const controlsTop = Number(controlsRect.top);
    const rootHeight = Number(rootRect.height);
    if (!Number.isFinite(rootBottom) || !Number.isFinite(controlsTop) || !Number.isFinite(rootHeight) || rootHeight <= 0) {
      return null;
    }

    const controlsHeightFromBottom = Math.max(0, rootBottom - controlsTop);
    const safetyGap = Math.max(18, Math.min(48, rootHeight * 0.03));
    return Math.ceil(controlsHeightFromBottom + safetyGap);
  },

  syncPlayerActionOverlayOffset() {
    const root = this.uiRefs?.root;
    if (!root) {
      return;
    }

    if (!this.controlsVisible || this.isExternalFrameMode()) {
      root.style.removeProperty("--player-action-controls-open-bottom");
      this.lastActionOverlayBottomPx = null;
      return;
    }

    const measuredBottom = this.measurePlayerActionOverlayOffset();
    if (!Number.isFinite(measuredBottom) || measuredBottom <= 0) {
      return;
    }
    if (Math.abs(Number(this.lastActionOverlayBottomPx || 0) - measuredBottom) < 1) {
      return;
    }

    this.lastActionOverlayBottomPx = measuredBottom;
    root.style.setProperty("--player-action-controls-open-bottom", `${measuredBottom}px`);
  },

  setControlsVisible(visible, { focus = false } = {}) {
    this.controlsVisible = Boolean(visible);
    if (this.isExternalFrameMode()) {
      return;
    }
    const overlay = this.uiRefs?.controlsOverlay;
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("hidden", !this.controlsVisible);
    this.syncPlayerOverlayLayoutState();
    this.updateSkipIntroCountdown(Date.now());
    this.renderSkipIntroButton();
    if (this.controlsVisible) {
      this.renderControlButtons();
      if (focus) {
        this.focusFirstControl();
      }
      this.resetControlsAutoHide();
    } else {
      this.clearControlsAutoHide();
      this.focusPlayerRootForHiddenControls();
    }
  },

  focusPlayerRootForHiddenControls() {
    if (this.isExternalFrameMode() || this.controlsVisible || this.isDialogOpen()) {
      return;
    }
    const root = this.uiRefs?.root;
    if (!root || typeof root.focus !== "function") {
      return;
    }
    try {
      root.focus({ preventScroll: true });
    } catch (_) {
      try {
        root.focus();
      } catch (_) {
        // Best effort on older TV engines.
      }
    }
  },

  focusFirstControl() {
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = 0;
    this.renderControlButtons();
    const firstButton = this.container.querySelector('.player-control-btn[data-action]');
    firstButton?.focus?.();
  },

  focusProgressBar() {
    if (!this.isSeekBarAvailable()) {
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "buttons";
      this.renderControlButtons();
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body && typeof activeElement.blur === "function") {
      activeElement.blur();
    }
    this.stickyProgressFocus = true;
    this.controlFocusZone = "progress";
    this.renderControlButtons();
    this.uiRefs?.progressShell?.focus?.();
    this.scheduleProgressBarRefocus();
  },

  scheduleProgressBarRefocus() {
    if (!this.controlsVisible || this.controlFocusZone !== "progress") {
      return;
    }
    const run = () => {
      if (!this.controlsVisible || this.controlFocusZone !== "progress") {
        return;
      }
      const buttons = Array.from(this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn") || []);
      buttons.forEach((button) => {
        button.classList.remove("focused");
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      this.uiRefs?.progressShell?.classList?.add("focused");
      this.uiRefs?.progressShell?.focus?.();
    };
    run();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    }
    setTimeout(run, 0);
  },

  isStartupLoadingVisible() {
    return Boolean(this.loadingVisible && !this.hasPresentedPlaybackFrame);
  },

  isBufferingSpinnerVisible() {
    if (this.seekLoading) {
      if (this.isStartupLoadingVisible()) {
        return false;
      }
      return !this.isExternalFrameMode() && !this.isStartupErrorVisible();
    }
    if (!this.loadingVisible || !this.hasPresentedPlaybackFrame || this.isExternalFrameMode() || this.isStartupErrorVisible()) {
      return false;
    }
    const currentSeconds = Number(this.getPlaybackCurrentSeconds());
    const baselineSeconds = Number(this.bufferingSpinnerBaselineSeconds);
    if (Number.isFinite(currentSeconds) && Number.isFinite(baselineSeconds)) {
      if (currentSeconds > (baselineSeconds + STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS)) {
        return false;
      }
    }
    const stalledForMs = Date.now() - Number(this.lastPlaybackProgressAt || 0);
    return stalledForMs >= BUFFERING_SPINNER_STALL_MS;
  },

  isSeekBarAvailable() {
    return !this.loadingVisible || this.hasPresentedPlaybackFrame || this.seekLoading;
  },

  isSeekOverlaySuppressingControls() {
    return Date.now() < Number(this.seekOverlaySuppressControlsUntil || 0);
  },

  suppressControlsForHiddenSeek(durationMs = 2500) {
    if (this.controlsVisible) {
      return;
    }
    this.seekOverlaySuppressControlsUntil = Math.max(
      Number(this.seekOverlaySuppressControlsUntil || 0),
      Date.now() + Math.max(0, Number(durationMs || 0))
    );
  },

  clearLoadingCompletionTimer() {
    if (this.loadingCompletionTimer) {
      clearTimeout(this.loadingCompletionTimer);
      this.loadingCompletionTimer = null;
    }
  },

  clearBufferingSpinnerTimer() {
    if (this.bufferingSpinnerTimer) {
      clearTimeout(this.bufferingSpinnerTimer);
      this.bufferingSpinnerTimer = null;
    }
  },

  scheduleBufferingSpinnerRefresh(delayMs = BUFFERING_SPINNER_STALL_MS) {
    this.clearBufferingSpinnerTimer();
    if (!this.loadingVisible || !this.hasPresentedPlaybackFrame || this.isExternalFrameMode() || this.isStartupErrorVisible()) {
      return;
    }
    this.bufferingSpinnerTimer = setTimeout(() => {
      this.bufferingSpinnerTimer = null;
      if (!this.loadingVisible || !this.hasPresentedPlaybackFrame || this.isExternalFrameMode() || this.isStartupErrorVisible()) {
        return;
      }
      this.updateLoadingVisibility();
    }, Math.max(0, Number(delayMs || 0)));
  },

  enableStartupAudioGate({ allowNativePlayback = false, maxWaitMs = 0 } = {}) {
    this.startupAudioGateActive = true;
    this.startupAudioGateAllowsNativePlayback = Boolean(allowNativePlayback);
    const boundedWaitMs = Math.max(0, Number(maxWaitMs || 0));
    this.startupAudioGateDeadline = boundedWaitMs > 0
      ? Date.now() + boundedWaitMs
      : 0;
    PlayerController.setStartupAudioGate?.(true, {
      pauseNativePlayback: !allowNativePlayback
    });
  },

  releaseStartupAudioGate({ resume = true } = {}) {
    if (!this.startupAudioGateActive) {
      return;
    }
    this.startupAudioGateActive = false;
    this.startupAudioGateAllowsNativePlayback = false;
    this.startupAudioGateDeadline = 0;
    // Once playback leaves the startup gate, later webOS track-list churn must
    // not reopen automatic language matching. A Luna selectTrack request during
    // normal playback can interrupt the native decoder on some LG TVs.
    this.startupAudioFallbackApplied = false;
    this.startupAudioTrackSetSignature = "";
    PlayerController.setStartupAudioGate?.(false, { resume });
  },

  isPlaybackStartupSettled() {
    if (!this.hasPresentedPlaybackFrame || this.pendingPlaybackRestore || this.startupAudioGateActive) {
      return false;
    }
    return true;
  },

  hasStartupPlaybackAdvanced(currentSeconds = this.getPlaybackCurrentSeconds()) {
    if (this.startupPlaybackHasAdvanced) {
      return true;
    }
    if (this.pendingPlaybackRestore) {
      this.startupPlaybackBaselineSeconds = null;
      return false;
    }
    const current = Number(currentSeconds);
    if (!Number.isFinite(current) || current < 0) {
      return false;
    }
    const baseline = Number(this.startupPlaybackBaselineSeconds);
    if (!Number.isFinite(baseline)) {
      this.startupPlaybackBaselineSeconds = current;
      return false;
    }
    if (current < baseline - 0.25) {
      this.startupPlaybackBaselineSeconds = current;
      return false;
    }
    if ((current - baseline) >= STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS) {
      this.startupPlaybackHasAdvanced = true;
      return true;
    }
    return false;
  },

  markPlaybackPresentedAfterAdvance(currentSeconds = this.getPlaybackCurrentSeconds()) {
    if (this.hasPresentedPlaybackFrame) {
      return true;
    }
    if (!this.hasStartupPlaybackAdvanced(currentSeconds)) {
      return false;
    }
    this.hasPresentedPlaybackFrame = true;
    this.warmBitmapSubtitleSharedResources();
    if (!this.startupTrackPreferenceReady) {
      // Some P2P / engineFs startups expose tracks before the first real frame
      // is presented. Re-run the startup track pass once playback is actually live.
      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
    }
    this.setLoadingLogoFillTarget(1, { immediate: true });
    if (this.isStartupGateReleaseReady()) {
      this.releaseStartupAudioGate();
    }
    this.clearPlaybackStallGuard();
    return true;
  },

  isStartupLogoDismissReady() {
    return Boolean(
      this.hasPresentedPlaybackFrame
      && this.startupPlaybackHasAdvanced
      && !this.pendingPlaybackRestore
      && !this.startupAudioGateActive
    );
  },

  presentStartedPlayback() {
    const overlay = this.uiRefs?.loadingOverlay;
    overlay?.classList.add("playback-ready");
    this.loadingVisible = false;
    this.updateLoadingVisibility();
    PlayerController.setStartupPresentationAudioMuted?.(false);
    setTimeout(() => overlay?.classList.remove("playback-ready"), 250);
    this.updateUiTick();
    setTimeout(() => this.maybeShowParentalGuideOverlay(), 80);
  },

  isStartupGateReleaseReady() {
    if (!this.startupAudioGateActive) {
      return false;
    }
    const readyState = typeof PlayerController.getPlaybackReadyState === "function"
      ? Number(PlayerController.getPlaybackReadyState() || 0)
      : Number(PlayerController.video?.readyState || 0);
    const gateDeadlineExpired = Number(this.startupAudioGateDeadline || 0) > 0
      && Date.now() >= Number(this.startupAudioGateDeadline || 0);
    if (canReleasePlayingNativeStartupAudioGate({
      allowNativePlayback: this.startupAudioGateAllowsNativePlayback,
      hasPresentedPlaybackFrame: this.hasPresentedPlaybackFrame,
      pendingAudioSelection: Boolean(this.pendingWebOsAudioSelection),
      readyState
    })) {
      if (!this.startupAudioPreferenceApplied) {
        this.applyStartupAudioFallback();
      }
      return Boolean(this.startupAudioPreferenceApplied)
        && !this.pendingWebOsAudioSelection;
    }
    if (gateDeadlineExpired && !this.pendingWebOsAudioSelection) {
      if (!this.startupAudioPreferenceApplied) {
        this.applyStartupAudioFallback();
      }
      return Boolean(this.startupAudioPreferenceApplied)
        && Number.isFinite(readyState)
        && readyState >= 2;
    }
    if (this.pendingPlaybackRestore) {
      return false;
    }
    const audioPreferenceSettled = !this.pendingWebOsAudioSelection && (
      Boolean(this.startupAudioPreferenceApplied)
      || (
        !Environment.isWebOS()
        && !this.startupAudioPreferenceApplying
        && !this.hasAudioTracksAvailable()
      )
    );
    return audioPreferenceSettled && Number.isFinite(readyState) && readyState >= 3;
  },

  scheduleLoadingCompletionCheck(delayMs = 250, { force = false } = {}) {
    this.clearLoadingCompletionTimer();
    if (!this.loadingVisible || this.isExternalFrameMode()) {
      return;
    }
    this.loadingCompletionTimer = setTimeout(() => {
      this.loadingCompletionTimer = null;
      if (!this.loadingVisible || this.isExternalFrameMode()) {
        return;
      }
      if (this.isStartupGateReleaseReady()) {
        this.releaseStartupAudioGate();
        this.scheduleLoadingCompletionCheck(120, { force: true });
        return;
      }
      const fillProgress = Number(this.loadingLogoFillProgress || 0);
      if (fillProgress >= 1 && !this.isPlaybackStartupSettled()) {
        this.markPlaybackPresentedAfterAdvance();
        if (this.isStartupLogoDismissReady()) {
          this.presentStartedPlayback();
          return;
        }
        this.updateUiTick();
        this.scheduleLoadingCompletionCheck(180, { force: true });
        return;
      }
      if (!force && !this.isPlaybackStartupSettled()) {
        this.scheduleLoadingCompletionCheck(250);
        return;
      }
      if (this.loadingProgress != null && fillProgress < 1) {
        this.loadingProgress = 1;
        this.setLoadingLogoFillTarget(1);
        this.scheduleLoadingCompletionCheck(180, { force: true });
        return;
      }
      if (!this.markPlaybackPresentedAfterAdvance()) {
        this.scheduleLoadingCompletionCheck(120, { force: true });
        return;
      }
      const currentFillProgress = Number(this.loadingLogoFillProgress || 0);
      const currentFillTarget = Number(this.loadingLogoFillTarget || 0);
      if (currentFillTarget >= 1 && currentFillProgress < 0.995) {
        this.scheduleLoadingCompletionCheck(120, { force: true });
        return;
      }
      this.presentStartedPlayback();
    }, Math.max(0, Number(delayMs || 0)));
  },

  clearControlsAutoHide() {
    if (this.controlsHideTimer) {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = null;
    }
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (!this.controlsVisible || this.paused || this.isDialogOpen() || this.seekOverlayVisible) {
      return;
    }
    this.controlsHideTimer = setTimeout(() => {
      this.setControlsVisible(false);
    }, 4200);
  },

  getPlaybackCurrentSeconds() {
    if (typeof PlayerController.getCurrentTimeSeconds === "function") {
      return Number(PlayerController.getCurrentTimeSeconds() || 0);
    }
    return Number(PlayerController.video?.currentTime || 0);
  },

  getPlaybackDurationSeconds() {
    if (typeof PlayerController.getDurationSeconds === "function") {
      return Number(PlayerController.getDurationSeconds() || 0);
    }
    return Number(PlayerController.video?.duration || 0);
  },

  getPlaybackBufferedSeconds() {
    if (typeof PlayerController.getBufferedTimeSeconds !== "function") {
      return null;
    }
    const bufferedSeconds = PlayerController.getBufferedTimeSeconds();
    return bufferedSeconds == null ? null : Number(bufferedSeconds);
  },

  getPlaybackSpeed() {
    if (typeof PlayerController.getPlaybackRate === "function") {
      return Number(PlayerController.getPlaybackRate() || 1);
    }
    return Number(PlayerController.video?.playbackRate || 1);
  },

  getPlaybackSpeedOptions() {
    if (typeof PlayerController.getSupportedPlaybackRates === "function") {
      const speeds = PlayerController.getSupportedPlaybackRates();
      if (Array.isArray(speeds) && speeds.length) {
        return speeds;
      }
    }
    return PLAYER_SPEEDS;
  },

  hasKnownPlaybackDuration() {
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    return Number.isFinite(durationSeconds) && durationSeconds > 0;
  },

  isPlaybackFrameReady() {
    const readyState = typeof PlayerController.getPlaybackReadyState === "function"
      ? Number(PlayerController.getPlaybackReadyState() || 0)
      : Number(PlayerController.video?.readyState || 0);
    return Number.isFinite(readyState) && readyState >= 2;
  },

  clearSeekLoading({ hideBuffering = false } = {}) {
    if (!this.seekLoading && this.seekLoadingBaselineSeconds == null && this.seekLoadingTargetSeconds == null) {
      return false;
    }
    this.seekLoading = false;
    this.seekLoadingBaselineSeconds = null;
    this.seekLoadingTargetSeconds = null;
    if (hideBuffering && this.hasPresentedPlaybackFrame) {
      this.loadingVisible = false;
    }
    this.clearBufferingSpinnerTimer();
    this.updateLoadingVisibility();
    return true;
  },

  completeSeekLoadingIfReady() {
    if (!this.seekLoading || this.pendingPlaybackRestore || this.isStartupLoadingVisible()) {
      return false;
    }
    if (!this.isPlaybackFrameReady()) {
      return false;
    }
    return this.clearSeekLoading({ hideBuffering: true });
  },

  isEngineFsStartupReady() {
    if (!this.currentEngineFsStream) {
      return true;
    }
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    return this.isPlaybackFrameReady()
      || (this.hasKnownPlaybackDuration()
      && Number.isFinite(currentSeconds)
      && currentSeconds > 0.2);
  },

  clearSkipIntroSeekSuppression() {
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
  },

  seekPlaybackSeconds(seconds, { preserveSkipIntroSuppression = false } = {}) {
    if (!preserveSkipIntroSuppression) {
      this.clearSkipIntroSeekSuppression();
    }
    // Mark user-initiated seeks so the player can stay responsive while it settles.
    this.seekLoadingBaselineSeconds = this.getPlaybackCurrentSeconds();
    this.seekLoadingTargetSeconds = Number(seconds || 0);
    this.seekLoading = true;
    this.updateLoadingVisibility();
    if (typeof PlayerController.seekToSeconds === "function") {
      const didSeek = Boolean(PlayerController.seekToSeconds(seconds));
      if (!didSeek) {
        this.clearSeekLoading();
      }
      return didSeek;
    }
    const video = PlayerController.video;
    if (!video) {
      this.clearSeekLoading();
      return false;
    }
    video.currentTime = Number(seconds || 0);
    return true;
  },

  finalizePendingPlaybackRestore(restore = this.pendingPlaybackRestore) {
    if (!restore || this.pendingPlaybackRestore !== restore) {
      return;
    }
    this.pendingPlaybackRestore = null;
    const currentSeconds = this.getPlaybackCurrentSeconds();
    this.startupPlaybackBaselineSeconds = Number.isFinite(currentSeconds)
      ? currentSeconds
      : null;
    this.startupPlaybackHasAdvanced = false;
    if (restore.paused) {
      PlayerController.pause();
      this.paused = true;
      return;
    }
    this.paused = false;
  },

  attemptPendingPlaybackRestore({ force = false } = {}) {
    const restore = this.pendingPlaybackRestore;
    if (!restore) {
      return;
    }

    const durationSeconds = this.getPlaybackDurationSeconds();
    let requestedSeconds = Number(restore.timeSeconds || 0);
    if ((!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) && Number(restore.progressPercent || 0) > 0) {
      const seededDuration = Number(restore.durationSeconds || 0);
      const effectiveDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : (Number.isFinite(seededDuration) && seededDuration > 0 ? seededDuration : 0);
      if (effectiveDuration > 0) {
        requestedSeconds = effectiveDuration * Math.max(0, Math.min(100, Number(restore.progressPercent || 0))) / 100;
        restore.timeSeconds = requestedSeconds;
      }
    }
    if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) {
      restore.attempts = Number(restore.attempts || 0) + 1;
      if (restore.attempts >= 8) {
        this.finalizePendingPlaybackRestore(restore);
      }
      return;
    }

    const targetSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.max(0, Math.min(requestedSeconds, Math.max(0, durationSeconds - 3)))
      : requestedSeconds;
    const currentSeconds = this.getPlaybackCurrentSeconds();
    const toleranceSeconds = Math.max(1.5, Math.min(8, targetSeconds * 0.03));

    if (Number.isFinite(currentSeconds) && currentSeconds >= Math.max(0, targetSeconds - toleranceSeconds)) {
      this.finalizePendingPlaybackRestore(restore);
      return;
    }

    const now = Date.now();
    if (!force && (now - Number(restore.lastAttemptAt || 0)) < 700) {
      return;
    }

    restore.timeSeconds = targetSeconds;
    restore.lastAttemptAt = now;
    restore.attempts = Number(restore.attempts || 0) + 1;

    const didSeek = this.seekPlaybackSeconds(targetSeconds);
    if (!didSeek && restore.attempts >= 8) {
      this.finalizePendingPlaybackRestore(restore);
    }
  },

  updateLoadingVisibility() {
    const overlay = this.uiRefs?.loadingOverlay;
    const bufferingSpinner = this.uiRefs?.bufferingSpinner;
    if (!overlay) {
      if (!this.loadingVisible) {
        if (this.isStartupGateReleaseReady()) {
          this.releaseStartupAudioGate();
        }
        this.clearBufferingSpinnerTimer();
      }
      return;
    }
    if (this.isStartupErrorVisible()) {
      overlay.classList.add("hidden");
      bufferingSpinner?.classList.add("hidden");
      this.clearBufferingSpinnerTimer();
      return;
    }
    const showStartupOverlay = this.isStartupLoadingVisible();
    const showBufferingSpinner = this.isBufferingSpinnerVisible();
    const preserveProgressFocus = Boolean(
      showStartupOverlay
      && this.controlsVisible
      && this.stickyProgressFocus
      && this.controlFocusZone === "progress"
      && this.hasPresentedPlaybackFrame
    );
    const preserveHiddenSeekOverlay = Boolean(
      showStartupOverlay
      && !this.controlsVisible
      && this.isSeekOverlaySuppressingControls()
    );
    overlay.classList.toggle("hidden", !showStartupOverlay);
    overlay.classList.remove("seek-only", "logo-only");
    bufferingSpinner?.classList.toggle("hidden", !showBufferingSpinner);
    if (!showStartupOverlay && this.loadingProgress != null) {
      this.loadingProgress = 1;
      this.setLoadingLogoFillTarget(1);
    }
    if (!showStartupOverlay && this.loadingTorrentStatus) {
      this.loadingTorrentStatus = "";
      this.syncLoadingOverlayStatus();
    }
    if (!this.loadingVisible && !this.seekLoading) {
      this.clearBufferingSpinnerTimer();
    }
    if (showStartupOverlay) {
      this.dismissPauseOverlay();
      if (!preserveProgressFocus && !preserveHiddenSeekOverlay && (this.seekOverlayVisible || this.seekPreviewSeconds != null)) {
        this.cancelSeekPreview({ commit: false });
      }
      if (!preserveProgressFocus && this.controlFocusZone === "progress") {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
      }
      this.renderControlButtons();
      if (preserveProgressFocus) {
        this.scheduleProgressBarRefocus();
      }
      if (preserveHiddenSeekOverlay) {
        this.renderSeekOverlay();
      }
    } else if (!showBufferingSpinner) {
      if (!this.loadingVisible) {
        this.clearBufferingSpinnerTimer();
      }
      if (this.isStartupGateReleaseReady()) {
        this.releaseStartupAudioGate();
      }
      if (this.paused) {
        this.schedulePauseOverlay();
      }
    }
    this.renderNextEpisodeCard();
  },

  renderNextEpisodeCard() {
    const card = this.uiRefs?.nextEpisodeCard;
    if (!card) {
      return;
    }

    this.ensureNextEpisodeStreamsPrefetch();
    const nextEpisode = this.resolveNextEpisodeInfo();
    const hidden = !this.isNextEpisodeCardVisible();

    card.classList.toggle("hidden", hidden);
    if (hidden) {
      card.innerHTML = "";
      return;
    }

    const titleLine = [nextEpisode.episodeLabel, nextEpisode.episodeTitle].filter(Boolean).join(" • ");
    const statusText = nextEpisode.hasAired
      ? t("next_episode_play", {}, "Play")
      : t("next_episode_unaired", {}, "Unaired");
    const airDateText = nextEpisode.hasAired
      ? ""
      : formatNextEpisodeAirDate(nextEpisode.released);
    const progressText = this.nextEpisodeCardSearching
      ? t("next_episode_finding_source", {}, "Finding source…")
      : (this.nextEpisodeCardSourceName && this.nextEpisodeCardCountdownSec != null
        ? t(
          "next_episode_playing_via",
          [this.nextEpisodeCardSourceName, this.nextEpisodeCardCountdownSec],
          `Playing via ${this.nextEpisodeCardSourceName} in ${this.nextEpisodeCardCountdownSec}s`
        )
        : airDateText);
    const thumb = this.episodes.find((entry) => String(entry?.id || "") === String(nextEpisode.videoId || ""))?.thumbnail || "";

    card.innerHTML = `
      <div class="player-next-episode-card-inner${nextEpisode.hasAired ? " focusable is-playable" : ""}${!this.controlsVisible ? " is-selected" : ""}"${nextEpisode.hasAired ? ' data-player-pointer-action="nextEpisode"' : ""}>
        <div class="player-next-episode-thumb-wrap">
          ${thumb ? `<img class="player-next-episode-thumb" src="${escapeHtml(thumb)}" alt="" aria-hidden="true" />` : `<div class="player-next-episode-thumb player-next-episode-thumb-fallback"></div>`}
          <div class="player-next-episode-thumb-shade"></div>
        </div>
        <div class="player-next-episode-copy">
          <div class="player-next-episode-kicker">${escapeHtml(t("next_episode_label", {}, "Next episode"))}</div>
          <div class="player-next-episode-title">${escapeHtml(titleLine || t("next_episode_label", {}, "Next episode"))}</div>
          ${progressText ? `<div class="player-next-episode-status">${escapeHtml(progressText)}</div>` : ""}
        </div>
        <div class="player-next-episode-pill${nextEpisode.hasAired ? " is-playable" : ""}">
          <span class="player-next-episode-pill-icon">&#9654;</span>
          <span class="player-next-episode-pill-text">${escapeHtml(statusText)}</span>
        </div>
      </div>
    `;
  },

  updateUiTick() {
    if (this.isExternalFrameMode()) {
      return;
    }
    this.ensureNextEpisodeStreamsPrefetch();
    this.shouldShowNextEpisodeCard();
    void this.refreshLoadingOverlayProgress();
    const current = this.getPlaybackCurrentSeconds();
    this.updateActiveSkipInterval(current);
    this.updateSkipIntroCountdown(Date.now());
    const duration = this.getPlaybackDurationSeconds();
    const effectiveProgressSeconds = this.controlsVisible && this.controlFocusZone === "progress" && this.seekPreviewSeconds != null
      ? Number(this.seekPreviewSeconds)
      : current;
    const progress = duration > 0 ? clamp(effectiveProgressSeconds / duration, 0, 1) : 0;
    const uiRefs = this.uiRefs || {};
    const uiState = this.lastUiTickState || (this.lastUiTickState = {});
    const progressBuffered = uiRefs.progressBuffered;
    if (progressBuffered) {
      const bufferedSeconds = this.getPlaybackBufferedSeconds();
      const bufferedVisible = Number.isFinite(bufferedSeconds)
        && duration > 0
        && bufferedSeconds > current + 0.25;
      const bufferedProgress = bufferedVisible
        ? clamp(bufferedSeconds / duration, 0, 1)
        : 0;
      const nextBufferedWidth = `${Math.round(bufferedProgress * 10000) / 100}%`;
      if (uiState.bufferedWidth !== nextBufferedWidth) {
        progressBuffered.style.width = nextBufferedWidth;
        uiState.bufferedWidth = nextBufferedWidth;
      }
      if (uiState.bufferedVisible !== bufferedVisible) {
        progressBuffered.classList.toggle("is-visible", bufferedVisible);
        uiState.bufferedVisible = bufferedVisible;
      }
    }
    const progressFill = uiRefs.progressFill;
    if (progressFill) {
      const nextWidth = `${Math.round(progress * 10000) / 100}%`;
      if (uiState.progressWidth !== nextWidth) {
        progressFill.style.width = nextWidth;
        uiState.progressWidth = nextWidth;
      }
    }
    this.syncSkipIntroButtonProgress();
    this.renderSkipIntroButton();
    this.syncPlayerOverlayLayoutState();
    this.renderBitmapSubtitleAtCurrentTime();
    this.maybeAutoplayNextEpisode();

    const clock = uiRefs.clock;
    if (clock) {
      const now = new Date();
      const nextClockMinuteKey = `${now.getHours()}:${now.getMinutes()}`;
      if (uiState.clockMinuteKey !== nextClockMinuteKey) {
        const nextClockText = formatClock(now);
        clock.textContent = nextClockText;
        uiState.clockText = nextClockText;
        uiState.clockMinuteKey = nextClockMinuteKey;
      }
    }

    const endsAt = uiRefs.endsAt;
    if (endsAt) {
      const remainingMs = Math.max(0, (Number(duration || 0) - Number(current || 0)) * 1000);
      const nextEndsAtMinuteBucket = duration > 0 ? Math.floor((Date.now() + remainingMs) / 60000) : -1;
      if (uiState.endsAtMinuteBucket !== nextEndsAtMinuteBucket) {
        const nextEndsAtText = t("player_ends_at", [formatEndsAt(current, duration)], "Ends at %1$s");
        endsAt.textContent = nextEndsAtText;
        uiState.endsAtText = nextEndsAtText;
        uiState.endsAtMinuteBucket = nextEndsAtMinuteBucket;
      }
    }

    if (this.pauseOverlayVisible) {
      const overlayClock = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-clock");
      if (overlayClock && overlayClock.textContent !== uiState.clockText) {
        overlayClock.textContent = uiState.clockText || "--:--";
      }
      const overlayEndsAt = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-ends-at");
      if (overlayEndsAt && overlayEndsAt.textContent !== uiState.endsAtText) {
        overlayEndsAt.textContent = uiState.endsAtText || t("player_ends_at", ["--:--"], "Ends at %1$s");
      }
    }

    const timeLabel = uiRefs.timeLabel;
    if (timeLabel) {
      const nextTimeLabel = `${formatTime(effectiveProgressSeconds)} / ${formatTime(duration)}`;
      if (uiState.timeLabelText !== nextTimeLabel) {
        timeLabel.textContent = nextTimeLabel;
        uiState.timeLabelText = nextTimeLabel;
      }
    }

    this.syncPauseOverlayState();
    this.renderNextEpisodeCard();

    if (this.seekOverlayVisible && this.seekPreviewSeconds == null) {
      this.renderSeekOverlay();
    }
  },
  renderSeekOverlay() {
    const overlay = this.uiRefs?.seekOverlay;
    const directionNode = this.uiRefs?.seekDirection;
    const previewNode = this.uiRefs?.seekPreview;
    const fillNode = this.uiRefs?.seekFill;
    if (!overlay || !directionNode || !previewNode || !fillNode) {
      return;
    }

    const duration = this.getPlaybackDurationSeconds();
    const currentPreview = this.seekPreviewSeconds != null
      ? Number(this.seekPreviewSeconds)
      : this.getPlaybackCurrentSeconds();

    const shouldShowOverlay = this.seekOverlayVisible && !this.controlsVisible;
    overlay.classList.toggle("hidden", !shouldShowOverlay);
    const uiState = this.lastUiTickState || (this.lastUiTickState = {});
    const nextPreviewText = `${formatTime(currentPreview)} / ${formatTime(duration)}`;
    const nextDirectionText = this.seekPreviewDirection < 0 ? "<<" : this.seekPreviewDirection > 0 ? ">>" : "";
    if (uiState.seekPreviewText !== nextPreviewText) {
      previewNode.textContent = nextPreviewText;
      uiState.seekPreviewText = nextPreviewText;
    }
    if (uiState.seekDirectionText !== nextDirectionText) {
      directionNode.textContent = nextDirectionText;
      uiState.seekDirectionText = nextDirectionText;
    }

    const percent = duration > 0 ? clamp(currentPreview / duration, 0, 1) : 0;
    const nextSeekWidth = `${Math.round(percent * 10000) / 100}%`;
    if (uiState.seekWidth !== nextSeekWidth) {
      fillNode.style.width = nextSeekWidth;
      uiState.seekWidth = nextSeekWidth;
    }
  },

  beginSeekPreview(direction, isRepeat = false) {
    if (!this.isSeekBarAvailable()) {
      return;
    }
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return;
    }

    if (direction !== this.seekPreviewDirection || !isRepeat) {
      this.seekRepeatCount = 0;
    }
    this.seekPreviewDirection = direction;
    this.seekRepeatCount += 1;

    const stepSeconds = this.seekRepeatCount >= 18
      ? 120
      : this.seekRepeatCount >= 12
        ? 60
        : this.seekRepeatCount >= 7
          ? 30
          : this.seekRepeatCount >= 3
            ? 20
            : 10;
    const duration = this.getPlaybackDurationSeconds();
    const base = this.seekPreviewSeconds == null ? currentTime : Number(this.seekPreviewSeconds);
    let next = base + (direction * stepSeconds);
    if (duration > 0) {
      next = clamp(next, 0, duration);
    } else {
      next = Math.max(0, next);
    }

    this.seekPreviewSeconds = next;
    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.scheduleSeekPreviewCommit();
  },

  scheduleSeekPreviewCommit() {
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
    }
    this.seekCommitTimer = setTimeout(() => {
      this.commitSeekPreview();
    }, 1000);
  },

  commitSeekPreview() {
    if (!PlayerController.video) {
      this.cancelSeekPreview({ commit: false });
      return;
    }

    if (this.seekPreviewSeconds != null) {
      this.suppressControlsForHiddenSeek();
      this.seekPlaybackSeconds(Number(this.seekPreviewSeconds));
    }

    if (this.stickyProgressFocus && this.controlsVisible) {
      this.focusProgressBar();
      this.scheduleProgressBarRefocus();
    }

    this.seekPreviewSeconds = null;
    this.seekRepeatCount = 0;
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }

    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
    }
    this.seekOverlayTimer = setTimeout(() => {
      this.seekOverlayVisible = false;
      this.seekPreviewDirection = 0;
      this.renderSeekOverlay();
      if (this.autoHideControlsAfterSeek && this.controlsVisible) {
        this.autoHideControlsAfterSeek = false;
        this.stickyProgressFocus = false;
        this.setControlsVisible(false);
        return;
      }
      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
        this.scheduleProgressBarRefocus();
      }
      this.resetControlsAutoHide();
    }, 700);
  },

  cancelSeekPreview({ commit = false } = {}) {
    if (commit) {
      this.commitSeekPreview();
      return;
    }

    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }
    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekOverlayVisible = false;
    this.autoHideControlsAfterSeek = false;
    this.seekOverlaySuppressControlsUntil = 0;
    this.renderSeekOverlay();
  },

  togglePause({ focusControls = true } = {}) {
    const preserveProgressFocus = this.controlFocusZone === "progress";
    if (this.isExternalFrameMode()) {
      return;
    }
    if (this.paused) {
      this.dismissPauseOverlay();
      PlayerController.resume();
      this.paused = false;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      if (preserveProgressFocus) {
        this.controlFocusZone = "progress";
      }
      this.renderControlButtons();
      return;
    }

    PlayerController.pause();
    this.paused = true;
    this.updateMediaSessionPlaybackState();
    if (!focusControls && !preserveProgressFocus) {
      this.controlFocusZone = "";
    }
    this.setControlsVisible(true, { focus: focusControls && !preserveProgressFocus });
    if (preserveProgressFocus) {
      this.controlFocusZone = "progress";
    }
    this.renderControlButtons();
    this.schedulePauseOverlay();
  },

  resolveMediaAction(event) {
    const key = String(event?.key || "");
    const keyName = String(event?.keyName || "");
    const code = String(event?.code || "");
    const keyCode = Number(event?.originalKeyCode || event?.keyCode || 0);

    const keyMap = {
      MediaPlayPause: "toggle",
      MediaPlay: "play",
      MediaPause: "pause",
      MediaStop: "stop",
      MediaFastForward: "fastForward",
      MediaRewind: "rewind",
      MediaTrackNext: "next",
      MediaTrackPrevious: "previous",
      Play: "play",
      Pause: "pause"
    };

    if (keyMap[key]) {
      return keyMap[key];
    }
    if (keyMap[keyName]) {
      return keyMap[keyName];
    }
    if (keyMap[code]) {
      return keyMap[code];
    }

    const codeMap = {
      179: "toggle",
      10252: "toggle",
      415: "play",
      19: "pause",
      413: "stop",
      178: "stop",
      417: "fastForward",
      412: "rewind",
      176: "next",
      177: "previous"
    };

    return codeMap[keyCode] || null;
  },

  applyMediaAction(action) {
    if (this.isExternalFrameMode() || !action) {
      return;
    }

    if (action === "play") {
      if (this.paused) {
        this.togglePause();
      }
      return;
    }

    if (action === "pause" || action === "stop") {
      if (!this.paused) {
        this.togglePause();
      }
      return;
    }

    if (action === "toggle") {
      this.togglePause();
      return;
    }

    if (action === "fastForward") {
      this.quickSeekBy(30);
      return;
    }

    if (action === "rewind") {
      this.quickSeekBy(-30);
    }
  },

  quickSeekBy(deltaSeconds) {
    if (!this.isSeekBarAvailable()) {
      return false;
    }
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return false;
    }
    const duration = this.getPlaybackDurationSeconds();
    let target = currentTime + Number(deltaSeconds || 0);
    if (duration > 0) {
      target = clamp(target, 0, duration);
    } else {
      target = Math.max(0, target);
    }
    this.seekPreviewSeconds = target;
    this.seekPreviewDirection = deltaSeconds < 0 ? -1 : 1;
    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();
    this.scheduleSeekPreviewCommit();
    return true;
  },

  bindMediaSessionHandlers() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession || this.mediaSessionHandlersBound) {
      return;
    }
    this.mediaSessionHandlersBound = true;
    this.mediaSessionActions = [];

    const safeBind = (action, handler) => {
      try {
        mediaSession.setActionHandler(action, handler);
        this.mediaSessionActions.push(action);
      } catch (_) {
        // Ignore unsupported actions.
      }
    };

    safeBind("play", () => this.applyMediaAction("play"));
    safeBind("pause", () => this.applyMediaAction("pause"));
    safeBind("stop", () => this.applyMediaAction("stop"));
    safeBind("seekforward", (details) => {
      const offset = Number(details?.seekOffset || 30);
      this.quickSeekBy(Number.isFinite(offset) ? offset : 30);
    });
    safeBind("seekbackward", (details) => {
      const offset = Number(details?.seekOffset || 30);
      this.quickSeekBy(Number.isFinite(offset) ? -offset : -30);
    });

    this.updateMediaSessionPlaybackState();
  },

  clearMediaSessionHandlers() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession || !this.mediaSessionHandlersBound) {
      return;
    }
    this.mediaSessionActions.forEach((action) => {
      try {
        mediaSession.setActionHandler(action, null);
      } catch (_) {
        // Ignore unsupported actions.
      }
    });
    this.mediaSessionActions = [];
    this.mediaSessionHandlersBound = false;
    try {
      mediaSession.playbackState = "none";
    } catch (_) {
      // Ignore unsupported playback state.
    }
  },

  updateMediaSessionPlaybackState() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession) {
      return;
    }
    try {
      mediaSession.playbackState = this.paused ? "paused" : "playing";
    } catch (_) {
      // Ignore unsupported playback state.
    }
  },

  async playStreamByUrl(streamUrl, { preservePanel = false, resetSilentAudioState = true, preservePlaybackState = false, preservePendingRestore = false, forceEngine = null, sourceCandidate: explicitSourceCandidate = null, mountToken = null } = {}) {
    if (!this.isActiveMountToken(mountToken)) {
      return;
    }
    if (this.isExternalFrameMode()) {
      return;
    }
    if (!streamUrl) {
      return;
    }

    const selectedIndex = this.streamCandidates.findIndex((entry) => entry.url === streamUrl);
    if (selectedIndex >= 0) {
      this.currentStreamIndex = selectedIndex;
    }
    const sourceCandidate = explicitSourceCandidate || this.getStreamCandidateByUrl(streamUrl) || this.getCurrentStreamCandidate();
    const sourceContext = this.getPlaybackSourceContext(sourceCandidate);
    if (sourceContext) {
      this.activePlaybackSourceContext = sourceContext;
    }
    const nextEngineFsState = this.getEngineFsStateForStream(sourceCandidate);
    const prioritizeWebOsRemoteMkvPlayback = Environment.isWebOS()
      && !nextEngineFsState
      && this.isCurrentSourceLikelyMkv(streamUrl, sourceCandidate);
    const sameEngineFsState = this.isSameEngineFsState(this.currentEngineFsStream, nextEngineFsState);
    if (this.currentEngineFsStream && !this.isSameEngineFsState(this.currentEngineFsStream, nextEngineFsState)) {
      const removePreviousTorrent = !nextEngineFsState
        || String(this.currentEngineFsStream.infoHash || "").toLowerCase() !== String(nextEngineFsState.infoHash || "").toLowerCase();
      await this.releaseCurrentEngineFsStream("source-change", { removeTorrent: removePreviousTorrent });
      if (!this.isActiveMountToken(mountToken)) {
        return;
      }
    }
    if (!sameEngineFsState) {
      if (this.engineFsStartupRetryTimer) {
        clearTimeout(this.engineFsStartupRetryTimer);
        this.engineFsStartupRetryTimer = null;
      }
      this.engineFsStartupErrorRetries = 0;
      this.lastEngineFsStartupErrorStats = null;
    }

    this.hasPresentedPlaybackFrame = false;
    this.startupPlaybackBaselineSeconds = null;
    this.startupPlaybackHasAdvanced = false;
    this.bufferingSpinnerBaselineSeconds = null;
    this.clearStartupError();
    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.clearBufferingSpinnerTimer();
    if (nextEngineFsState) {
      this.releaseStartupAudioGate({ resume: false });
    } else {
      this.enableStartupAudioGate({
        allowNativePlayback: prioritizeWebOsRemoteMkvPlayback,
        maxWaitMs: prioritizeWebOsRemoteMkvPlayback
          ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS
          : 0
      });
    }
    this.cancelSeekPreview({ commit: false });
    if (preservePlaybackState) {
      const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
      const video = PlayerController.video;
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
        ? PlayerController.isUsingAvPlay()
        : false;
      const hasExistingResumeRestore = Boolean(
        this.pendingPlaybackRestore
        && (
          Number(this.pendingPlaybackRestore.timeSeconds || 0) > 1
          || Number(this.pendingPlaybackRestore.progressPercent || 0) > 0
        )
      );
      const hasUsefulCurrentPosition = Number.isFinite(restoreTimeSeconds) && restoreTimeSeconds > 1;
      if (!(hasExistingResumeRestore && !hasUsefulCurrentPosition)) {
        this.pendingPlaybackRestore = {
          timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
          paused: Boolean(this.paused || (!usingAvPlay && video?.paused)),
          attempts: 0,
          lastAttemptAt: 0
        };
      }
    } else if (!(preservePendingRestore && this.pendingPlaybackRestore)) {
      this.pendingPlaybackRestore = null;
    }
    this.markPlaybackProgress();
    this.clearPlaybackStallGuard();
    this.clearSubtitleCueStyleBindings();
    this.clearEmbeddedSubtitleCueRefreshTimers();
    if (resetSilentAudioState) {
      this.silentAudioFallbackAttempts.clear();
      this.silentAudioFallbackCount = 0;
    }

    if (!preservePanel) {
      this.closeSourcesPanel();
    }

    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedManifestSubtitleTrackId = null;
    this.startupSubtitlePreferenceApplied = false;
    this.startupSubtitlePreferenceApplying = false;
    this.startupAudioPreferenceApplied = false;
    this.startupAudioPreferenceApplying = false;
    this.startupAudioFallbackApplied = false;
    this.startupAudioTrackSetSignature = "";
    this.clearStartupAudioPreferenceRetry();
    if (typeof PlayerController.cancelWebOsAudioTrackSelection === "function") {
      PlayerController.cancelWebOsAudioTrackSelection();
    }
    this.pendingWebOsAudioSelection = null;
    this.failedAutomaticAudioFallbackEntryId = "";
    this.startupTrackPreferenceReady = false;
    this.builtInSubtitleCount = 0;
    this.embeddedSubtitleTracks = [];
    this.embeddedAudioTracks = [];
    this.selectedEmbeddedAudioTrackIndex = -1;
    this.clearBitmapSubtitleOverlay({ dispose: true });
    this.clearSubtitleCueStyleBindings();
    this.clearMountedExternalSubtitleTracks();
    this.trackDiscoveryInProgress = true;
    this.clearTrackDiscoveryTimer();
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.activePlaybackUrl = streamUrl;
    this.currentEngineFsStream = nextEngineFsState || null;
    if (this.currentEngineFsStream) {
      this.engineFsPlaybackToken = claimEngineFsPlayback(this.currentEngineFsStream);
      this.startEngineFsKeepAlive(this.currentEngineFsStream);
    } else {
      this.engineFsPlaybackToken = "";
      this.stopEngineFsKeepAlive();
    }
    this.embeddedTrackRequestPromise = null;
    this.embeddedTrackRequestUrl = "";
    this.lastEmbeddedTrackProbeUrl = "";
    this.lastEmbeddedTrackRetryAt = 0;
    this.lastTrackWarmupAt = Date.now();
    const playbackContext = {
      ...this.buildPlaybackContext(sourceCandidate),
      forceEngine
    };
    if (prioritizeWebOsRemoteMkvPlayback) {
      // Claim the remote media request before the companion service probes the
      // same URL. Some providers rate-limit simultaneous Range requests.
      await this.startPlayerControllerPlayback(
        this.activePlaybackUrl,
        playbackContext,
        { mountToken, sourceCandidate }
      );
      if (!this.isActiveMountToken(mountToken)) {
        return;
      }
    }
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
    this.startTrackDiscoveryWindow({
      durationMs: prioritizeWebOsRemoteMkvPlayback
        ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS
        : 7000
    });
    if (this.currentEngineFsStream || prioritizeWebOsRemoteMkvPlayback) {
      this.initialEmbeddedTrackBootstrapPromise = null;
    } else {
      const embeddedSubtitleWarmupPromise = this.loadEmbeddedSubtitleTracks();
      this.initialEmbeddedTrackBootstrapPromise = embeddedSubtitleWarmupPromise;
      embeddedSubtitleWarmupPromise.finally(() => {
        if (this.initialEmbeddedTrackBootstrapPromise === embeddedSubtitleWarmupPromise) {
          this.initialEmbeddedTrackBootstrapPromise = null;
        }
      });
      await this.waitForInitialEmbeddedTrackBootstrap();
      if (!this.isActiveMountToken(mountToken)) {
        return;
      }
    }
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    if (!prioritizeWebOsRemoteMkvPlayback) {
      this.startPlayerControllerPlayback(
        this.activePlaybackUrl,
        playbackContext,
        { mountToken, sourceCandidate }
      );
    }
    this.paused = false;
    this.refreshTrackDialogs();
    this.updateUiTick();
    this.setControlsVisible(true, { focus: false });
    this.schedulePlaybackStallGuard();
  },

  async playStreamCandidate(streamCandidate, options = {}) {
    const mountToken = options?.mountToken ?? null;
    if (!this.isActiveMountToken(mountToken)) {
      return;
    }
    if (!streamCandidate) {
      return;
    }
    let targetUrl = streamDirectPlaybackUrl(streamCandidate);
    if (!targetUrl) {
      const resolveContext = {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      };
      const canUseEngineFs = WebOsEngineFsResolver.canResolveStream(streamCandidate);
      const canUseTizenP2p = TizenStreamingServerResolver.canResolveStream(streamCandidate);
      const canResolveP2p = canUseEngineFs || canUseTizenP2p;
      const p2pEnabled = Boolean(TorrentSettingsStore.get().p2pEnabled);
      const canUseP2p = p2pEnabled && canResolveP2p;
      let fallbackError = "";
      let resolveFailureStatus = "";
      let resolveFailureDetail = "";

      if (DirectDebridResolver.canResolveStream(streamCandidate, resolveContext)) {
        const result = await DirectDebridResolver.resolve(streamCandidate, resolveContext);
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
        if (result.status === "success" && result.stream?.url) {
          targetUrl = result.stream.url;
          Object.assign(streamCandidate, {
            url: targetUrl,
            externalUrl: null,
            mimeType: result.stream.mimeType || streamCandidate.mimeType,
            sourceType: result.stream.sourceType || streamCandidate.sourceType,
            behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
            raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
          });
        } else {
          fallbackError = result.status === "service_degraded"
            ? t("stream.debrid.serviceDegraded", {}, "The Debrid service is currently degraded. Try again later or choose another source.")
            : result.status === "not_cached"
            ? t("stream.debrid.notCached", {}, "Not cached on this service.")
            : result.status === "stale"
                ? t("stream.debrid.stale", {}, "This Debrid result expired. Refreshing streams.")
                : t("stream.debrid.failed", {}, "Could not resolve this Debrid stream.");
          resolveFailureStatus = result.status || "debrid-failed";
          resolveFailureDetail = result.detail || result.error || "";
          if (result.status === "service_degraded") {
            if (!this.hasPresentedPlaybackFrame) {
              this.showStartupError(fallbackError, {
                streamCandidate,
                reason: "debrid-resolve",
                resolverStatus: resolveFailureStatus,
                resolverDetail: resolveFailureDetail
              });
            } else {
              this.sourcesError = this.formatPlaybackErrorForSources(fallbackError, {
                streamCandidate,
                reason: "debrid-resolve",
                resolverStatus: resolveFailureStatus,
                resolverDetail: resolveFailureDetail
              });
              this.renderSourcesPanel();
            }
            return;
          }
        }
      }

      if (!targetUrl && canUseP2p) {
        const result = canUseEngineFs
          ? await WebOsEngineFsResolver.resolve(streamCandidate, resolveContext)
          : await TizenStreamingServerResolver.resolve(streamCandidate, resolveContext);
        if (!this.isActiveMountToken(mountToken)) {
          const resolvedEngineFs = result?.stream?.engineFs || null;
          if (resolvedEngineFs?.infoHash) {
            void this.cleanupEngineFsState(resolvedEngineFs, "stale-p2p-resolve", { deferMs: 0 }).catch(() => null);
          }
          return;
        }
        if (result.status === "success" && result.stream?.url) {
          targetUrl = result.stream.url;
          Object.assign(streamCandidate, {
            url: targetUrl,
            externalUrl: null,
            infoHash: result.stream.infoHash || streamCandidate.infoHash,
            fileIdx: result.stream.fileIdx ?? streamCandidate.fileIdx,
            engineFs: result.stream.engineFs || streamCandidate.engineFs || null,
            tizenP2p: result.stream.tizenP2p || streamCandidate.tizenP2p || null,
            mimeType: result.stream.mimeType || streamCandidate.mimeType,
            sourceType: result.stream.sourceType || streamCandidate.sourceType,
            behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
            raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
          });
        } else {
          resolveFailureStatus = result?.status || "p2p-failed";
          resolveFailureDetail = result?.detail || result?.error || "";
          console.warn("PlayerScreen: P2P resolve failed", {
            status: result.status,
            detail: result.detail || "",
            infoHash: streamCandidate.infoHash || streamCandidate.raw?.infoHash || streamCandidate.clientResolve?.infoHash || streamCandidate.raw?.clientResolve?.infoHash || "",
            fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
          });
        }
      }

      if (!targetUrl) {
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
        const startupMessage = fallbackError
          || (!p2pEnabled && canResolveP2p
            ? t("player_error_p2p_disabled", {}, "P2P streaming is disabled. Enable P2P in Settings to play torrent streams.")
            : canUseP2p
            ? t("player_error_failed_start_torrent", [t("player_error_playback_fallback", {}, "Playback error")], "Failed to start torrent: %1$s")
            : t("player_error_playback_fallback", {}, "Playback error"));
        if (!this.hasPresentedPlaybackFrame) {
          this.showStartupError(startupMessage, {
            streamCandidate,
            reason: !p2pEnabled && canResolveP2p ? "p2p-disabled" : canUseP2p ? "p2p-resolve" : "stream-resolve",
            resolverStatus: resolveFailureStatus,
            resolverDetail: resolveFailureDetail
          });
          return;
        }
        const sourceErrorMessage = !p2pEnabled && canResolveP2p
          ? t("player_error_p2p_disabled", {}, "P2P streaming is disabled. Enable P2P in Settings to play torrent streams.")
          : canUseP2p
          ? t("stream.p2p.failed", {}, "Could not start this torrent stream.")
          : (fallbackError || t("stream.debrid.unavailable", {}, "This Debrid source needs a configured Debrid account."));
        this.sourcesError = this.formatPlaybackErrorForSources(sourceErrorMessage, {
          streamCandidate,
          reason: !p2pEnabled && canResolveP2p ? "p2p-disabled" : canUseP2p ? "p2p-resolve" : "stream-resolve",
          resolverStatus: resolveFailureStatus,
          resolverDetail: resolveFailureDetail
        });
        this.renderSourcesPanel();
        return;
      }

      this.streamCandidates = this.streamCandidates.map((entry) => (
        entry.id === streamCandidate.id ? { ...entry, ...streamCandidate } : entry
      ));
    }
    this.rememberSelectedStreamPreference(streamCandidate);
    await this.playStreamByUrl(targetUrl, {
      ...options,
      mountToken,
      sourceCandidate: streamCandidate
    });
  },

  async switchStream(direction) {
    if (!this.streamCandidates.length) {
      return;
    }

    this.currentStreamIndex += direction;
    if (this.currentStreamIndex >= this.streamCandidates.length) {
      this.currentStreamIndex = 0;
    }
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = this.streamCandidates.length - 1;
    }

    const selected = this.streamCandidates[this.currentStreamIndex];
    if (!selected) {
      return;
    }
    await this.playStreamCandidate(selected, { preservePlaybackState: true });
  },

  markPlaybackSourceFailed(url = this.activePlaybackUrl) {
    const normalizedUrl = String(url || "").trim();
    if (normalizedUrl) {
      (this.failedPlaybackUrls || (this.failedPlaybackUrls = new Set())).add(normalizedUrl);
    }
    const currentCandidate = this.getCurrentStreamCandidate?.();
    const currentId = String(currentCandidate?.id || "").trim();
    if (currentId) {
      (this.failedPlaybackStreamIds || (this.failedPlaybackStreamIds = new Set())).add(currentId);
    }
  },

  mediaErrorMessage(errorCode = 0, detail = "", streamCandidate = this.getCurrentStreamCandidate()) {
    const code = Number(errorCode || 0);
    const text = String(detail || "").toLowerCase();
    const httpStatus = extractPlaybackHttpStatus(detail);
    const httpMessage = this.getHttpPlaybackErrorMessage(httpStatus);
    if (httpMessage) {
      return httpMessage;
    }
    const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
    if (compatibilityMessage && (code === 0 || code === 2 || code === 4)) {
      return compatibilityMessage;
    }
    if (code === 1) return "Playback aborted";
    if (code === 2) return "Network error";
    if (code === 3) {
      const unsupported = t("player_error_unsupported_format", [this.getPlaybackErrorCodeLabel(code) || "decode"], "This stream uses a format your device may not support. Try a different source. [%1$s]");
      return `${t("player_error_decoder", {}, "Decoder error")}\n\n${unsupported}`;
    }
    if (code === 4) {
      if (this.isDebridPlaybackCandidate(streamCandidate)) {
        return t("player_error_stream_load_failed", {}, "Playback failed to load");
      }
      if (
        text.includes("manifestparsingerror")
        || text.includes("manifest parsing")
        || text.includes("unrecognized")
        || text.includes("invalid content")
        || text.includes("invalid data")
        || text.includes("text/html")
        || text.includes("html")
      ) {
        return t("player_error_source_invalid_content", [this.getPlaybackErrorCodeLabel(code) || "source"], "Source error: The stream source returned invalid or unplayable content. The link may have expired or the server returned an error page instead of video.\n\nTry a different source. [%1$s]");
      }
      if (
        text.includes("no supported source")
        || text.includes("no supported sources")
        || text.includes("not supported")
        || text.includes("unsupported")
      ) {
        return t("player_error_source_not_supported", {}, "Source not supported on this TV");
      }
      return t("player_error_playback_fallback", {}, "Playback error");
    }
    return t("player_error_playback_fallback", {}, "Playback error");
  },

  attemptSilentAudioRecovery(reason = "silent-audio") {
    void reason;
    return false;
  },

  clearPlaybackStallGuard() {
    if (this.playbackStallTimer) {
      clearTimeout(this.playbackStallTimer);
      this.playbackStallTimer = null;
    }
  },

  markPlaybackProgress() {
    const currentSeconds = this.getPlaybackCurrentSeconds();
    if (typeof PlayerController.recordProgressSnapshot === "function") {
      PlayerController.recordProgressSnapshot(
        Math.floor(currentSeconds * 1000),
        Math.floor(this.getPlaybackDurationSeconds() * 1000),
        typeof PlayerController.createProgressContext === "function"
          ? PlayerController.createProgressContext()
          : null
      );
    }
    if (this.seekLoading) {
      const seekBaselineSeconds = Number(this.seekLoadingBaselineSeconds);
      const seekTargetSeconds = Number(this.seekLoadingTargetSeconds);
      const reachedSeekTarget = Number.isFinite(currentSeconds)
        && Number.isFinite(seekTargetSeconds)
        && Math.abs(currentSeconds - seekTargetSeconds) <= 0.75;
      if (
        (reachedSeekTarget && this.isPlaybackFrameReady())
        || (
          Number.isFinite(currentSeconds)
          && Number.isFinite(seekBaselineSeconds)
          && currentSeconds > (seekBaselineSeconds + STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS)
        )
      ) {
        this.clearSeekLoading({ hideBuffering: reachedSeekTarget });
      }
    }
    this.bufferingSpinnerBaselineSeconds = currentSeconds;
    this.lastPlaybackProgressAt = Date.now();
    this.engineFsStallExtensions = 0;
    this.lastEngineFsStallStats = null;
    this.scheduleBufferingSpinnerRefresh();
  },

  getCurrentEngineFsStatsUrl() {
    const state = this.currentEngineFsStream || null;
    const playbackUrl = String(state?.playbackUrl || this.activePlaybackUrl || "").trim();
    const infoHash = String(state?.infoHash || "").trim().toLowerCase();
    const fileIdx = Number(state?.fileIdx);
    if (!playbackUrl || !/^[0-9a-f]{40}$/.test(infoHash) || !Number.isFinite(fileIdx) || fileIdx < 0) {
      return "";
    }
    try {
      const parsed = new URL(playbackUrl);
      return `${parsed.origin}/${encodeURIComponent(infoHash)}/${String(fileIdx)}/stats.json`;
    } catch (_) {
      return "";
    }
  },

  async fetchCurrentEngineFsStats({ timeoutMs = 3500 } = {}) {
    const statsUrl = this.getCurrentEngineFsStatsUrl();
    if (!statsUrl) {
      return null;
    }
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs || 3500)))
      : 0;
    try {
      const response = await fetch(statsUrl, {
        cache: "no-cache",
        signal: controller?.signal
      });
      if (!response || !response.ok) {
        return null;
      }
      return await response.json().catch(() => null);
    } catch (error) {
      if (this.currentEngineFsStream) {
        logEngineFsDebug("EngineFS stats unavailable; requesting runtime recovery", {
          statsUrl,
          error: String(error?.message || error || "")
        });
        try {
          await requestWebOsCompanionService({ method: "status", parameters: {} });
        } catch (_) {
          // Recovery is best-effort; retry logic will decide the next step.
        }
      }
      return null;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  },

  getEngineFsStallSnapshot(stats = null) {
    if (!stats || typeof stats !== "object") {
      return null;
    }
    const readNumber = (keys = [], fallback = 0) => {
      for (const key of keys) {
        const parsed = Number(stats[key]);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return fallback;
    };
    const readOptionalNumber = (keys = []) => {
      for (const key of keys) {
        if (stats[key] == null) {
          continue;
        }
        const parsed = Number(stats[key]);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return null;
    };
    const progress = readNumber(["streamProgress", "progress"], -1);
    const downloaded = readNumber(["downloaded", "downloadedBytes"], -1);
    const downloadSpeed = readNumber(["downloadSpeed", "speed"], 0);
    const uploadSpeed = readNumber(["uploadSpeed"], 0);
    const peers = readNumber(["peerCount", "peers"], 0);
    const unique = readNumber(["uniquePeerCount", "unique"], 0);
    const connectionTries = readNumber(["connectionTries", "tries"], 0);
    const seeds = readOptionalNumber(["seedCount", "seeds", "seeders"]);
    return {
      progress,
      downloaded,
      downloadSpeed,
      uploadSpeed,
      peers,
      unique,
      connectionTries,
      seeds,
      peerSearchRunning: Boolean(stats.peerSearchRunning ?? stats.peerSearch),
      streamName: String(stats.streamName || "")
    };
  },

  shouldDeferEngineFsStartupStall(stats = null) {
    const snapshot = this.getEngineFsStallSnapshot(stats);
    if (!snapshot) {
      return false;
    }
    const previous = this.lastEngineFsStallStats || null;
    this.lastEngineFsStallStats = snapshot;

    const progressIncreased = previous
      && snapshot.progress >= 0
      && previous.progress >= 0
      && snapshot.progress > previous.progress + 0.000001;
    const downloadedIncreased = previous
      && snapshot.downloaded >= 0
      && previous.downloaded >= 0
      && snapshot.downloaded > previous.downloaded;
    const activelyDownloading = snapshot.downloadSpeed > 0 || progressIncreased || downloadedIncreased;
    const swarmIsAlive = snapshot.peers > 0
      || snapshot.unique > 0
      || snapshot.connectionTries > 0
      || snapshot.peerSearchRunning;

    if (activelyDownloading) {
      return true;
    }
    return swarmIsAlive && Number(this.engineFsStallExtensions || 0) < 10;
  },

  shouldRetryEngineFsStartupError(stats = null) {
    const retryCount = Number(this.engineFsStartupErrorRetries || 0);
    const snapshot = this.getEngineFsStallSnapshot(stats);
    if (!snapshot) {
      return retryCount < 3;
    }

    const previous = this.lastEngineFsStartupErrorStats || null;
    this.lastEngineFsStartupErrorStats = snapshot;
    const progressIncreased = previous
      && snapshot.progress >= 0
      && previous.progress >= 0
      && snapshot.progress > previous.progress + 0.000001;
    const downloadedIncreased = previous
      && snapshot.downloaded >= 0
      && previous.downloaded >= 0
      && snapshot.downloaded > previous.downloaded;
    const hasDownloadedData = snapshot.downloaded > 0;
    const activelyDownloading = snapshot.downloadSpeed > 0 || progressIncreased || downloadedIncreased;
    const swarmIsAlive = snapshot.peers > 0
      || snapshot.unique > 0
      || snapshot.connectionTries > 0
      || snapshot.peerSearchRunning;

    return retryCount < 10 && (activelyDownloading || hasDownloadedData || swarmIsAlive);
  },

  scheduleEngineFsStartupRetry({ mediaErrorCode = 0, stats = null } = {}) {
    if (!this.currentEngineFsStream || !this.activePlaybackUrl) {
      return false;
    }
    if (this.engineFsStartupRetryTimer) {
      clearTimeout(this.engineFsStartupRetryTimer);
      this.engineFsStartupRetryTimer = null;
    }

    this.engineFsStartupErrorRetries = Number(this.engineFsStartupErrorRetries || 0) + 1;
    const retry = this.engineFsStartupErrorRetries;
    const delayMs = Math.min(18000, 4500 + (retry * 2500));
    const retryUrl = this.activePlaybackUrl;
    const sourceCandidate = this.getStreamCandidateByUrl(retryUrl) || this.getCurrentStreamCandidate();
    const snapshot = this.getEngineFsStallSnapshot(stats);

    this.lastPlaybackErrorAt = 0;
    this.loadingVisible = true;
    this.paused = false;
    this.sourcesError = null;
    this.dismissPauseOverlay();
    this.updateLoadingVisibility();
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(false, { focus: false });
    this.schedulePlaybackStallGuard({ timeoutMs: delayMs + 12000 });

    logEngineFsDebug("EngineFS startup decode error while buffering; retrying same source", {
      retry,
      delayMs,
      mediaErrorCode,
      playbackUrl: retryUrl,
      stats: snapshot
    });

    this.engineFsStartupRetryTimer = setTimeout(() => {
      this.engineFsStartupRetryTimer = null;
      if (this.hasPresentedPlaybackFrame || this.activePlaybackUrl !== retryUrl || !this.currentEngineFsStream) {
        return;
      }
      void this.playStreamByUrl(retryUrl, {
        preservePanel: true,
        resetSilentAudioState: false,
        preservePendingRestore: Boolean(this.pendingPlaybackRestore),
        sourceCandidate
      });
    }, delayMs);
    return true;
  },

  getPlaybackStallTimeoutMs({ startup = false } = {}) {
    const playbackEngine = String(PlayerController.playbackEngine || "");
    if (startup) {
      if (Environment.isTizen() || Environment.isWebOS()) {
        return playbackEngine.endsWith("avplay") ? 60000 : 45000;
      }
      return 18000;
    }
    if (Environment.isTizen()) {
      return playbackEngine.endsWith("avplay") ? 22000 : 16000;
    }
    if (Environment.isWebOS()) {
      return playbackEngine.endsWith("avplay") ? 16000 : 12000;
    }
    return 9000;
  },

  schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {}) {
    this.clearPlaybackStallGuard();
    if (this.isExternalFrameMode() || !this.activePlaybackUrl) {
      return;
    }
    const startup = !this.hasPresentedPlaybackFrame;
    const timeoutMs = Number.isFinite(Number(timeoutOverrideMs)) && Number(timeoutOverrideMs) > 0
      ? Number(timeoutOverrideMs)
      : this.getPlaybackStallTimeoutMs({ startup });
    this.playbackStallTimer = setTimeout(async () => {
      this.playbackStallTimer = null;
      if (this.isExternalFrameMode() || !this.loadingVisible || !this.activePlaybackUrl) {
        return;
      }

      const readyState = typeof PlayerController.getPlaybackReadyState === "function"
        ? Number(PlayerController.getPlaybackReadyState() || 0)
        : Number(PlayerController.video?.readyState || 0);
      if (startup) {
        if (this.markPlaybackPresentedAfterAdvance()) {
          this.loadingVisible = false;
          this.updateLoadingVisibility();
          this.updateUiTick();
          return;
        }
        if (!Environment.isWebOS() && (readyState >= 3 || (this.currentEngineFsStream && this.isEngineFsStartupReady()))) {
          this.schedulePlaybackStallGuard({ timeoutMs: 1000 });
          return;
        }
      }
      if (readyState >= 3 && !startup) {
        this.loadingVisible = false;
        this.updateLoadingVisibility();
        this.updateUiTick();
        return;
      }

      if (startup && this.currentEngineFsStream) {
        const stats = await this.fetchCurrentEngineFsStats();
        if (this.shouldDeferEngineFsStartupStall(stats)) {
          this.engineFsStallExtensions = Number(this.engineFsStallExtensions || 0) + 1;
          logEngineFsDebug("EngineFS startup still buffering; extending stall guard", {
            playbackUrl: this.activePlaybackUrl,
            extension: this.engineFsStallExtensions,
            stats: this.lastEngineFsStallStats
          });
          this.schedulePlaybackStallGuard({ timeoutMs: 12000 });
          return;
        }
      }

      const targetEngine = typeof PlayerController.getAlternativePlaybackEngine === "function"
        ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
        : null;
      if (targetEngine) {
        console.warn("Playback stalled; switching player engine", {
          url: this.activePlaybackUrl,
          from: PlayerController.playbackEngine,
          to: targetEngine
        });
        void this.playStreamByUrl(this.activePlaybackUrl, {
          preservePlaybackState: true,
          resetSilentAudioState: false,
          forceEngine: targetEngine
        });
        return;
      }

      this.releaseStartupAudioGate({ resume: false });
      if (startup) {
        this.markPlaybackSourceFailed(this.activePlaybackUrl);
        const mediaErrorCode = Number(PlayerController.getLastPlaybackErrorCode?.() || 0);
        const sourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
        const startupErrorMessage = this.getStartupErrorMessage(mediaErrorCode, "", sourceCandidate);
        this.showStartupError(startupErrorMessage, {
          mediaErrorCode,
          streamCandidate: sourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "startup-stall"
        });
        if (this.currentEngineFsStream) {
          logEngineFsDebug("EngineFS playback stalled during startup; keeping torrent alive until player exit or source change", {
            reason: "playback-stall",
            infoHash: this.currentEngineFsStream.infoHash,
            fileIdx: this.currentEngineFsStream.fileIdx
          });
        }
        return;
      }

      this.loadingVisible = false;
      this.paused = true;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      {
        const sourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
        const mediaErrorCode = Number(PlayerController.getLastPlaybackErrorCode?.() || 0);
        this.sourcesError = this.formatPlaybackErrorForSources(
          `${this.mediaErrorMessage(mediaErrorCode, "", sourceCandidate)}. Choose another source manually.`,
          {
            mediaErrorCode,
            streamCandidate: sourceCandidate,
            playbackUrl: this.activePlaybackUrl,
            reason: "playback-stall"
          }
        );
      }
      if (this.currentEngineFsStream) {
        logEngineFsDebug("EngineFS playback stalled; keeping torrent alive until player exit or source change", {
          reason: "playback-stall",
          infoHash: this.currentEngineFsStream.infoHash,
          fileIdx: this.currentEngineFsStream.fileIdx
        });
      }
      if (this.currentEngineFsStream) {
        this.renderSourcesPanel();
      } else if (this.streamCandidates.length > 1) {
        this.openSourcesPanel();
      } else {
        this.renderSourcesPanel();
      }
      this.updateUiTick();
    }, timeoutMs);
  },

  getSubtitleTabs() {
    return [
      { id: "builtIn", label: t("subtitle_tab_builtin", {}, "Built-in") },
      { id: "addons", label: t("subtitle_tab_addons", {}, "Addons") },
      { id: "style", label: t("subtitle_tab_style", {}, "Style") },
      { id: "delay", label: t("subtitle_tab_delay", {}, "Delay") }
    ];
  },

  refreshTrackDialogs() {
    this.invalidateTrackDialogCaches();
    this.syncTrackState();
    const audioTrackSetSignature = this.getStartupAudioTrackSetSignature();
    if (
      Environment.isWebOS()
      && this.startupAudioGateActive
      && this.startupAudioFallbackApplied
      && this.startupAudioTrackSetSignature
      && audioTrackSetSignature !== this.startupAudioTrackSetSignature
    ) {
      // webOS may expose the default track before the complete multi-audio
      // list. Re-open matching only while startup still owns playback; after
      // the gate is released, the bounded fallback remains authoritative.
      if (this.pendingWebOsAudioSelection?.automaticFallback) {
        PlayerController.cancelWebOsAudioTrackSelection?.();
        this.pendingWebOsAudioSelection = null;
      }
      this.startupAudioFallbackApplied = false;
      this.startupAudioPreferenceApplied = false;
    }
    this.startupAudioTrackSetSignature = audioTrackSetSignature;
    this.ensureSupportedAudioTrackSelected();
    if (this.startupTrackPreferenceReady) {
      this.applyStartupAudioPreference();
      this.applyStartupSubtitlePreference();
    }
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    if (this.subtitleDialogVisible) {
      this.renderSubtitleDialog();
    }
    if (this.audioDialogVisible) {
      this.renderAudioDialog();
    }
  },

  invalidateTrackDialogCaches() {
    this.trackDialogCache = createTrackDialogCache();
  },

  getStartupAudioTrackSetSignature() {
    return this.collectAudioOptionItems()
      .map((option) => [
        option.id,
        option.languageKey,
        option.label,
        option.secondary,
        option.supported ? "supported" : "unsupported",
        option.entry?.implicitAudioTrack ? "implicit" : "explicit"
      ].map((value) => cleanDisplayText(value)).join("|"))
      .join("||");
  },

  hasAudioTracksAvailable() {
    let dashCount = 0;
    try {
      dashCount = typeof PlayerController.getDashAudioTracks === "function"
        ? PlayerController.getDashAudioTracks().length
        : 0;
    } catch (_) {
      dashCount = 0;
    }

    let avplayCount = 0;
    try {
      avplayCount = typeof PlayerController.getAvPlayAudioTracks === "function"
        ? PlayerController.getAvPlayAudioTracks().length
        : 0;
    } catch (_) {
      avplayCount = 0;
    }

    let hlsCount = 0;
    try {
      hlsCount = typeof PlayerController.getHlsAudioTracks === "function"
        ? PlayerController.getHlsAudioTracks().length
        : 0;
    } catch (_) {
      hlsCount = 0;
    }

    let nativeCount = 0;
    try {
      nativeCount = this.getAudioTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return dashCount > 0
      || avplayCount > 0
      || hlsCount > 0
      || nativeCount > 0
      || (this.canDiscoverEmbeddedAudioTracks() && this.embeddedAudioTracks.length > 0)
      || this.manifestAudioTracks.length > 0
      || Boolean(this.getImplicitAudioEntry());
  },

  hasSubtitleTracksAvailable() {
    let dashCount = 0;
    try {
      dashCount = typeof PlayerController.getDashTextTracks === "function"
        ? PlayerController.getDashTextTracks().length
        : 0;
    } catch (_) {
      dashCount = 0;
    }

    let avplayCount = 0;
    try {
      avplayCount = typeof PlayerController.getAvPlaySubtitleTracks === "function"
        ? PlayerController.getAvPlaySubtitleTracks().length
        : 0;
    } catch (_) {
      avplayCount = 0;
    }

    let hlsCount = 0;
    try {
      hlsCount = typeof PlayerController.getHlsSubtitleTracks === "function"
        ? PlayerController.getHlsSubtitleTracks().length
        : 0;
    } catch (_) {
      hlsCount = 0;
    }
    let nativeCount = 0;
    try {
      nativeCount = this.getTextTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return dashCount > 0
      || avplayCount > 0
      || hlsCount > 0
      || nativeCount > 0
      || this.shouldUseEmbeddedSubtitleTracks()
      || this.manifestSubtitleTracks.length > 0
      || this.subtitles.length > 0;
  },

  clearTrackDiscoveryTimer() {
    if (this.trackDiscoveryTimer) {
      clearTimeout(this.trackDiscoveryTimer);
      this.trackDiscoveryTimer = null;
    }
  },

  startTrackDiscoveryWindow({ durationMs = 7000, intervalMs = 350 } = {}) {
    const now = Date.now();
    const requestedDeadline = now + Math.max(500, Number(durationMs || 0));
    const existingDeadline = this.trackDiscoveryInProgress
      && Number(this.trackDiscoveryDeadline || 0) > now
      ? Number(this.trackDiscoveryDeadline || 0)
      : 0;
    const token = (this.trackDiscoveryToken || 0) + 1;
    this.trackDiscoveryToken = token;
    this.trackDiscoveryInProgress = true;
    this.trackDiscoveryStartedAt = existingDeadline && Number(this.trackDiscoveryStartedAt || 0) > 0
      ? Number(this.trackDiscoveryStartedAt)
      : now;
    this.trackDiscoveryDeadline = Math.max(requestedDeadline, existingDeadline);
    this.clearTrackDiscoveryTimer();

    const tick = () => {
      if (token !== this.trackDiscoveryToken) {
        return;
      }

      const now = Date.now();
      const shouldRetryEmbeddedTracks = this.canDiscoverEmbeddedSubtitleTracks()
        && this.embeddedSubtitleTracks.length <= 0
        && this.embeddedAudioTracks.length <= 0
        && !this.embeddedSubtitleLoading
        && !this.embeddedAudioLoading;
      if (
        shouldRetryEmbeddedTracks
        && (now - Number(this.lastEmbeddedTrackRetryAt || 0)) >= 1200
      ) {
        this.lastEmbeddedTrackRetryAt = now;
        this.loadEmbeddedSubtitleTracks();
      }

      const doneByData = (this.hasSubtitleTracksAvailable() || this.hasAudioTracksAvailable())
        && !shouldRetryEmbeddedTracks;
      const doneByIdle = !this.subtitleLoading
        && !this.embeddedSubtitleLoading
        && !this.embeddedAudioLoading
        && !this.manifestLoading
        && !shouldRetryEmbeddedTracks
        && (now - Number(this.trackDiscoveryStartedAt || 0)) >= 1200;
      const trackDiscoveryElapsedMs = now - Number(this.trackDiscoveryStartedAt || 0);
      const webOsStartupPreferenceUnresolved = Boolean(
        Environment.isWebOS()
        && this.startupAudioGateActive
        && !this.startupAudioPreferenceApplied
      );
      const webOsStartupPreferencePending = webOsStartupPreferenceUnresolved
        && trackDiscoveryElapsedMs < STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS;
      const webOsStartupPreferenceWaitExpired = webOsStartupPreferenceUnresolved
        && trackDiscoveryElapsedMs >= STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS;
      const doneByTimeout = now >= this.trackDiscoveryDeadline
        || webOsStartupPreferenceWaitExpired;
      this.refreshTrackDialogs();

      // webOS can expose only its default audio track first. Keep discovery
      // alive for the bounded startup preference window so a later complete
      // multi-audio list can be selected before playback is released. This
      // avoids the unsafe mid-playback selectTrack retry blocked by the gate.
      if ((!webOsStartupPreferencePending && (doneByData || doneByIdle)) || doneByTimeout) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        if (webOsStartupPreferenceWaitExpired) {
          this.clearStartupAudioPreferenceRetry();
        }
        this.refreshTrackDialogs();
        return;
      }

      this.trackDiscoveryTimer = setTimeout(tick, Math.max(120, Number(intervalMs || 0)));
    };

    tick();
  },

  ensureTrackDataWarmup(force = false) {
    const now = Date.now();
    if (!force && (now - Number(this.lastTrackWarmupAt || 0)) < 1200) {
      return;
    }
    if (!force && (this.subtitleLoading || this.embeddedSubtitleLoading || this.manifestLoading)) {
      this.startTrackDiscoveryWindow();
      return;
    }
    this.lastTrackWarmupAt = now;
    this.loadSubtitles();
    this.loadEmbeddedSubtitleTracks();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || null);
    this.startTrackDiscoveryWindow();
  },

  async waitForInitialEmbeddedTrackBootstrap(timeoutMs = 900) {
    const pending = this.initialEmbeddedTrackBootstrapPromise;
    if (!pending || typeof pending.then !== "function") {
      return;
    }
    try {
      await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(resolve, Math.max(150, Number(timeoutMs || 0))))
      ]);
    } catch (_) {
      // Ignore bootstrap probe failures and continue playback startup.
    }
  },

  async loadEmbeddedSubtitleTracks() {
    const probeUrl = this.getTrackProbeUrl();
    if (
      probeUrl
      && this.embeddedTrackRequestPromise
      && this.embeddedTrackRequestUrl === probeUrl
      && this.embeddedSubtitleLoading
    ) {
      return this.embeddedTrackRequestPromise;
    }

    const requestToken = (this.embeddedSubtitleLoadToken || 0) + 1;
    const preserveExistingTracks = Boolean(
      probeUrl
      && probeUrl === this.lastEmbeddedTrackProbeUrl
      && (this.embeddedSubtitleTracks.length > 0 || this.embeddedAudioTracks.length > 0)
    );
    this.embeddedSubtitleLoadToken = requestToken;
    this.embeddedSubtitleLoading = true;
    this.embeddedAudioLoading = true;
    if (!preserveExistingTracks) {
      this.embeddedSubtitleTracks = [];
      this.embeddedAudioTracks = [];
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedEmbeddedAudioTrackIndex = -1;
    }
    this.refreshTrackDialogs();

    const requestPromise = (async () => {
      const canLoadSubtitleTracks = this.canDiscoverEmbeddedSubtitleTracks();
      const canLoadAudioTracks = this.canDiscoverEmbeddedAudioTracks();
      if (!canLoadSubtitleTracks && !canLoadAudioTracks) {
        return;
      }

      const capabilityPromise = Environment.isWebOS()
        && typeof PlayerController.refreshWebOsDeviceInfo === "function"
        ? PlayerController.refreshWebOsDeviceInfo()
        : Promise.resolve();
      const [, tracks] = await Promise.all([
        capabilityPromise,
        localMediaTracksRepository.getTracks(probeUrl)
      ]);
      if (requestToken !== this.embeddedSubtitleLoadToken) {
        return;
      }

      this.lastEmbeddedTrackProbeUrl = probeUrl;
      this.embeddedSubtitleTracks = canLoadSubtitleTracks ? this.normalizeEmbeddedSubtitleTracks(tracks) : [];
      this.embeddedAudioTracks = canLoadAudioTracks ? this.normalizeEmbeddedAudioTracks(tracks) : [];
      this.warmBitmapSubtitleSharedResources();
      const selectedEmbeddedSubtitleTrack = typeof PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex === "function"
        ? PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex()
        : -1;
      const selectedEmbeddedAudioTrack = typeof PlayerController.getSelectedWebOsEmbeddedAudioTrackIndex === "function"
        ? PlayerController.getSelectedWebOsEmbeddedAudioTrackIndex()
        : -1;
      this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(selectedEmbeddedSubtitleTrack)
        ? selectedEmbeddedSubtitleTrack
        : -1;
      this.selectedEmbeddedAudioTrackIndex = Number.isFinite(selectedEmbeddedAudioTrack)
        ? selectedEmbeddedAudioTrack
        : -1;
      this.refreshTrackDialogs();
    })().catch((error) => {
      console.warn("Embedded subtitle discovery failed", error);
      if (requestToken !== this.embeddedSubtitleLoadToken) {
        return;
      }
      if (!preserveExistingTracks) {
        this.embeddedSubtitleTracks = [];
        this.embeddedAudioTracks = [];
        this.selectedEmbeddedSubtitleTrackIndex = -1;
        this.selectedEmbeddedAudioTrackIndex = -1;
      }
      this.refreshTrackDialogs();
    }).finally(() => {
      if (requestToken === this.embeddedSubtitleLoadToken) {
        this.embeddedSubtitleLoading = false;
        this.embeddedAudioLoading = false;
        this.refreshTrackDialogs();
      }
      if (this.embeddedTrackRequestPromise === requestPromise) {
        this.embeddedTrackRequestPromise = null;
        this.embeddedTrackRequestUrl = "";
      }
    });

    this.embeddedTrackRequestPromise = requestPromise;
    this.embeddedTrackRequestUrl = probeUrl;
    return requestPromise;
  },

  disableEmbeddedSubtitleSelection() {
    this.clearEmbeddedSubtitleCueRefreshTimers();
    const hadBitmapSelection = Boolean(this.bitmapSubtitleTrack);
    this.clearBitmapSubtitleOverlay({ dispose: true });
    if (this.selectedEmbeddedSubtitleTrackIndex < 0) {
      return;
    }
    if (hadBitmapSelection && typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function") {
      PlayerController.setWebOsEmbeddedSubtitleTrack(-1);
    } else if (Environment.isTizen() && typeof PlayerController.setAvPlaySubtitleTrack === "function") {
      PlayerController.setAvPlaySubtitleTrack(-1);
    } else if (typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function") {
      PlayerController.setWebOsEmbeddedSubtitleTrack(-1);
    }
    this.selectedEmbeddedSubtitleTrackIndex = -1;
  },

  getTextTracks() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  getAudioTracks() {
    const trackList = this.getVideoAudioTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  getEmbeddedAudioTrack(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.embeddedAudioTracks[targetIndex] || null;
  },

  ensureEmbeddedTrackLookupCache() {
    const cache = this.trackDialogCache || (this.trackDialogCache = createTrackDialogCache());
    if (
      cache.embeddedAudioByNativeIndex
      && cache.embeddedAudioByEmbeddedIndex
      && cache.embeddedSubtitleByNativeIndex
      && cache.embeddedSubtitleByEmbeddedIndex
    ) {
      return cache;
    }

    const embeddedAudioByNativeIndex = new Map();
    const embeddedAudioByEmbeddedIndex = new Map();
    const embeddedSubtitleByNativeIndex = new Map();
    const embeddedSubtitleByEmbeddedIndex = new Map();

    (this.embeddedAudioTracks || []).forEach((track, index) => {
      const nativeTrackIndex = Number(track?.nativeTrackIndex);
      const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
      if (Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0) {
        embeddedAudioByNativeIndex.set(nativeTrackIndex, track);
      }
      if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
        embeddedAudioByEmbeddedIndex.set(embeddedTrackIndex, track);
      } else {
        embeddedAudioByEmbeddedIndex.set(index, track);
      }
    });

    (this.embeddedSubtitleTracks || []).forEach((track, index) => {
      const nativeTrackIndex = Number(track?.nativeTrackIndex);
      const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
      if (Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0) {
        embeddedSubtitleByNativeIndex.set(nativeTrackIndex, track);
      }
      if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
        embeddedSubtitleByEmbeddedIndex.set(embeddedTrackIndex, track);
      } else {
        embeddedSubtitleByEmbeddedIndex.set(index, track);
      }
    });

    cache.embeddedAudioByNativeIndex = embeddedAudioByNativeIndex;
    cache.embeddedAudioByEmbeddedIndex = embeddedAudioByEmbeddedIndex;
    cache.embeddedSubtitleByNativeIndex = embeddedSubtitleByNativeIndex;
    cache.embeddedSubtitleByEmbeddedIndex = embeddedSubtitleByEmbeddedIndex;
    return cache;
  },

  getEmbeddedAudioTrackByNativeIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedAudioByNativeIndex.get(targetIndex) || null;
  },

  getEmbeddedAudioTrackByEmbeddedIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedAudioByEmbeddedIndex.get(targetIndex) || null;
  },

  getEmbeddedSubtitleTrackByNativeIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedSubtitleByNativeIndex.get(targetIndex) || null;
  },

  getEmbeddedSubtitleTrackByEmbeddedIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedSubtitleByEmbeddedIndex.get(targetIndex) || null;
  },

  buildSubtitleTrackSignature(track = {}, fallbackIndex = -1) {
    const normalizedLanguage = normalizeTrackLanguageCode(
      track?.language || track?.lang || track?.srclang || ""
    ) || String(track?.language || track?.lang || track?.srclang || "").trim().toLowerCase();
    const normalizedLabel = cleanDisplayText(track?.label || track?.name || "")
      .trim()
      .toLowerCase();
    if (normalizedLanguage || normalizedLabel) {
      return `${normalizedLanguage}|${normalizedLabel}`;
    }
    return `subtitle-${fallbackIndex}`;
  },

  dedupeBuiltInSubtitleTracks(builtInTracks = [], embeddedSubtitleTracks = []) {
    if (!Environment.isWebOS() || !embeddedSubtitleTracks.length || !builtInTracks.length) {
      return builtInTracks;
    }

    const embeddedNativeIndexes = new Set(
      embeddedSubtitleTracks
        .map((track) => Number(track?.nativeTrackIndex))
        .filter((index) => Number.isFinite(index) && index >= 0)
    );
    const embeddedSignatures = new Set(
      embeddedSubtitleTracks.map((track, index) => this.buildSubtitleTrackSignature(track, index))
    );

    return builtInTracks.filter((track, index) => {
      if (embeddedNativeIndexes.has(index)) {
        return false;
      }
      const signature = this.buildSubtitleTrackSignature(track, index);
      return !embeddedSignatures.has(signature);
    });
  },

  mergeAvPlaySubtitleTrackMetadata(track, index) {
    const avplayTrackIndex = Number(track?.avplayTrackIndex);
    const embeddedTrack = this.getEmbeddedSubtitleTrackByNativeIndex(
      Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index
    );
    if (!embeddedTrack) {
      return track;
    }
    const avplayLanguage = getTrackLanguageValue(track);
    const embeddedLanguage = getTrackLanguageValue(embeddedTrack);
    return {
      ...track,
      label: cleanDisplayText(track?.label) || cleanDisplayText(embeddedTrack.label) || subtitleLabel(index),
      // AVPlay's extra_info.track_lang is the authoritative Samsung language.
      // Local /tracks metadata only fills gaps and must not replace it with
      // placeholders such as "unknown" or "und".
      language: avplayLanguage || embeddedLanguage,
      forced: isForcedSubtitleTrack(track) || isForcedSubtitleTrack(embeddedTrack),
      secondary: embeddedTrack.secondary || String(avplayLanguage || embeddedLanguage || "").toUpperCase()
    };
  },

  mergeEmbeddedAudioTrackMetadata(track, index) {
    let embeddedTrack = this.getEmbeddedAudioTrackByNativeIndex(index) || this.getEmbeddedAudioTrack(index);
    const explicitLanguage = normalizeTrackLanguageCode(track?.language || track?.lang || "");
    let embeddedLanguage = normalizeTrackLanguageCode(embeddedTrack?.language || embeddedTrack?.lang || "");
    if (explicitLanguage && embeddedLanguage && explicitLanguage !== embeddedLanguage) {
      const languageMatchedTrack = (this.embeddedAudioTracks || []).find((candidate) => (
        normalizeTrackLanguageCode(candidate?.language || candidate?.lang || "") === explicitLanguage
      ));
      if (languageMatchedTrack) {
        embeddedTrack = languageMatchedTrack;
        embeddedLanguage = normalizeTrackLanguageCode(embeddedTrack?.language || embeddedTrack?.lang || "");
      }
    }
    if (!embeddedTrack) {
      return {
        ...track,
        ...getAudioTrackSupportState(track)
      };
    }
    const support = getAudioTrackSupportState(embeddedTrack);
    const embeddedLabel = cleanDisplayText(embeddedTrack.label);
    const trackLabel = cleanDisplayText(track?.label || track?.name);
    const useEmbeddedLabel = Boolean(embeddedLabel && (!explicitLanguage || !embeddedLanguage || explicitLanguage === embeddedLanguage));
    return {
      ...track,
      label: useEmbeddedLabel ? embeddedLabel : trackLabel || "",
      name: cleanDisplayText(track?.name || (useEmbeddedLabel ? embeddedLabel : "")) || track?.name || "",
      language: track?.language || track?.lang || embeddedTrack?.language || embeddedTrack?.lang || "",
      lang: track?.lang || track?.language || embeddedTrack?.lang || embeddedTrack?.language || "",
      codec: embeddedTrack.codec || track?.codec || track?.audioCodec || "",
      codecs: embeddedTrack.codecs || track?.codecs || "",
      audioCodec: embeddedTrack.audioCodec || track?.audioCodec || track?.codec || "",
      codecProfile: embeddedTrack.codecProfile || track?.codecProfile || track?.profile || "",
      mimeType: embeddedTrack.mimeType || track?.mimeType || "",
      sampleMimeType: embeddedTrack.sampleMimeType || track?.sampleMimeType || "",
      format: embeddedTrack.format || track?.format || "",
      channels: embeddedTrack.channels || track?.channels || track?.channelCount || "",
      channelCount: embeddedTrack.channelCount || track?.channelCount || track?.channels || "",
      sampleRate: embeddedTrack.sampleRate || track?.sampleRate || track?.audioSampleRate || 0,
      supported: support.supported,
      unsupportedReason: support.unsupportedReason,
      raw: embeddedTrack.raw || track?.raw || null
    };
  },

  mergeAvPlayAudioTrackMetadata(track, index) {
    const avplayTrackIndex = Number(track?.avplayTrackIndex);
    let embeddedTrack = this.getEmbeddedAudioTrackByNativeIndex(
      Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index
    );
    const explicitLanguage = normalizeTrackLanguageCode(track?.language || track?.lang || "");
    let embeddedLanguage = normalizeTrackLanguageCode(embeddedTrack?.language || embeddedTrack?.lang || "");
    if (explicitLanguage && embeddedLanguage && explicitLanguage !== embeddedLanguage) {
      const languageMatchedTrack = (this.embeddedAudioTracks || []).find((candidate) => (
        normalizeTrackLanguageCode(candidate?.language || candidate?.lang || "") === explicitLanguage
      ));
      if (languageMatchedTrack) {
        embeddedTrack = languageMatchedTrack;
        embeddedLanguage = normalizeTrackLanguageCode(embeddedTrack?.language || embeddedTrack?.lang || "");
      }
    }
    if (!embeddedTrack) {
      return {
        ...track,
        ...getAudioTrackSupportState(track)
      };
    }
    const support = getAudioTrackSupportState(embeddedTrack);
    const embeddedLabel = cleanDisplayText(embeddedTrack.label);
    const trackLabel = cleanDisplayText(track?.label || track?.name);
    const useEmbeddedLabel = Boolean(embeddedLabel && (!explicitLanguage || !embeddedLanguage || explicitLanguage === embeddedLanguage));
    return {
      ...track,
      label: useEmbeddedLabel ? embeddedLabel : trackLabel || "",
      name: cleanDisplayText(track?.name || (useEmbeddedLabel ? embeddedLabel : "")) || track?.name || "",
      language: track?.language || track?.lang || embeddedTrack?.language || embeddedTrack?.lang || "",
      lang: track?.lang || track?.language || embeddedTrack?.lang || embeddedTrack?.language || "",
      codec: embeddedTrack.codec || track?.codec || track?.audioCodec || "",
      codecs: embeddedTrack.codecs || track?.codecs || "",
      audioCodec: embeddedTrack.audioCodec || track?.audioCodec || track?.codec || "",
      codecProfile: embeddedTrack.codecProfile || track?.codecProfile || track?.profile || "",
      mimeType: embeddedTrack.mimeType || track?.mimeType || "",
      sampleMimeType: embeddedTrack.sampleMimeType || track?.sampleMimeType || "",
      format: embeddedTrack.format || track?.format || "",
      channels: embeddedTrack.channels || track?.channels || track?.channelCount || "",
      channelCount: embeddedTrack.channelCount || track?.channelCount || track?.channels || "",
      sampleRate: embeddedTrack.sampleRate || track?.sampleRate || track?.audioSampleRate || 0,
      supported: support.supported,
      unsupportedReason: support.unsupportedReason,
      raw: embeddedTrack.raw || track?.raw || null
    };
  },

  mergeHlsAudioTrackMetadata(track, index) {
    const hlsLanguage = normalizeTrackLanguageCode(getTrackLanguageValue(track));
    const hlsName = cleanDisplayText(track?.name || track?.label || "");
    const manifestTrack = this.manifestAudioTracks.find((entry) => {
      const manifestLanguage = normalizeTrackLanguageCode(getTrackLanguageValue(entry));
      const manifestName = cleanDisplayText(entry?.name || entry?.label || "");
      if (hlsLanguage && manifestLanguage && hlsLanguage === manifestLanguage) {
        return true;
      }
      if (hlsName && manifestName && normalizeComparableText(hlsName) === normalizeComparableText(manifestName)) {
        return true;
      }
      return false;
    }) || this.manifestAudioTracks[index] || null;
    if (!manifestTrack) {
      return {
        ...track,
        ...getAudioTrackSupportState(track)
      };
    }
    const mergedTrack = {
      ...track,
      label: cleanDisplayText(manifestTrack.label || manifestTrack.name) || track?.label || track?.name || "",
      name: cleanDisplayText(manifestTrack.name || manifestTrack.label) || track?.name || track?.label || "",
      language: manifestTrack.language || track?.language || track?.lang || "",
      lang: manifestTrack.language || track?.lang || track?.language || "",
      channels: manifestTrack.channels || track?.channels || track?.channelCount || "",
      channelCount: manifestTrack.channels || track?.channelCount || track?.channels || "",
      characteristics: manifestTrack.characteristics || track?.characteristics || "",
      isDefault: Boolean(manifestTrack.isDefault) || Boolean(track?.isDefault) || Boolean(track?.default),
      autoselect: Boolean(manifestTrack.autoselect) || Boolean(track?.autoselect),
      uri: manifestTrack.uri || track?.url || track?.uri || null
    };
    return {
      ...mergedTrack,
      ...getAudioTrackSupportState(mergedTrack)
    };
  },

  revokeExternalSubtitleObjectUrls() {
    if (!Array.isArray(this.externalSubtitleObjectUrls) || !this.externalSubtitleObjectUrls.length) {
      return;
    }
    this.externalSubtitleObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Best effort.
      }
    });
    this.externalSubtitleObjectUrls = [];
  },

  clearMountedExternalSubtitleTracks() {
    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];
    this.revokeExternalSubtitleObjectUrls();
  },

  getSubtitleRequestHeaders() {
    const baseHeaders = this.getCurrentStreamRequestHeaders();
    if (typeof PlayerController.normalizePlaybackHeaders === "function") {
      return PlayerController.normalizePlaybackHeaders(baseHeaders);
    }
    return { ...baseHeaders };
  },

  isLikelySrtSubtitleUrl(url) {
    const value = String(url || "").toLowerCase();
    return value.includes(".srt") || value.includes("format=srt");
  },

  createSubtitleObjectUrl(body, sourceUrl = "", contentType = "") {
    const normalizedContentType = String(contentType || "").toLowerCase();
    const shouldConvertToVtt = this.isLikelySrtSubtitleUrl(sourceUrl)
      || normalizedContentType.includes("subrip")
      || (!normalizedContentType.includes("vtt") && !/^\s*WEBVTT/i.test(body));
    const vttText = shouldConvertToVtt
      ? this.convertSrtToVtt(body)
      : this.applySubtitleAssAlignmentToVtt(body);
    const objectUrl = URL.createObjectURL(new Blob([vttText], { type: "text/vtt" }));
    this.externalSubtitleObjectUrls.push(objectUrl);
    return objectUrl;
  },

  sanitizeSubtitleText(content, { preserveBasicStyle = false } = {}) {
    const source = String(content || "");
    const openTags = [];
    const closeTag = (tag) => {
      const output = [];
      for (let index = openTags.length - 1; index >= 0; index -= 1) {
        const activeTag = openTags[index];
        output.push(`</${activeTag}>`);
        openTags.splice(index, 1);
        if (activeTag === tag) {
          break;
        }
      }
      return output.join("");
    };
    const openTag = (tag) => {
      if (openTags.includes(tag)) {
        return "";
      }
      openTags.push(tag);
      return `<${tag}>`;
    };

    const normalized = source
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ");

    const converted = normalized.replace(/\{[^}]*\}/g, (block) => {
      if (!preserveBasicStyle) {
        return "";
      }
      let output = "";
      const commandPattern = /\\([ibu])([01])\b|\\r\b/gi;
      let match;
      while ((match = commandPattern.exec(block)) !== null) {
        if (match[0].toLowerCase() === "\\r") {
          output += closeTag("u") + closeTag("i") + closeTag("b");
          continue;
        }
        const tag = String(match[1] || "").toLowerCase();
        const enabled = String(match[2] || "") === "1";
        if (tag === "i") {
          output += enabled ? openTag("i") : closeTag("i");
        } else if (tag === "b") {
          output += enabled ? openTag("b") : closeTag("b");
        } else if (tag === "u") {
          output += enabled ? openTag("u") : closeTag("u");
        }
      }
      return output;
    });

    return `${converted}${closeTag("u")}${closeTag("i")}${closeTag("b")}`;
  },

  buildVttAlignmentSettings(alignment) {
    const settings = this.getSubtitleAssAlignmentSettings(alignment);
    if (!settings) {
      return "";
    }
    return `line:${settings.line}% align:${settings.align}`;
  },

  applySubtitleAssAlignmentToVtt(content) {
    const normalized = String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!this.hasSubtitleAssSyntax(normalized)) {
      return normalized;
    }
    return normalized.split(/\n{2,}/).map((block) => {
      const alignment = this.getSubtitleAssAlignment(block);
      const settings = this.buildVttAlignmentSettings(alignment);
      if (!settings) {
        return this.sanitizeSubtitleText(block, { preserveBasicStyle: true });
      }

      const lines = block.split("\n");
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) {
        return this.sanitizeSubtitleText(block, { preserveBasicStyle: true });
      }

      const timingLine = lines[timingIndex];
      const alignmentSettings = this.getSubtitleAssAlignmentSettings(alignment);
      const nextTimingLine = [
        /\sline:/i.test(timingLine) ? "" : `line:${alignmentSettings.line}%`,
        /\salign:/i.test(timingLine) ? "" : `align:${alignmentSettings.align}`
      ].filter(Boolean).join(" ");
      if (nextTimingLine) {
        lines[timingIndex] = `${timingLine} ${nextTimingLine}`;
      }
      return this.sanitizeSubtitleText(lines.join("\n"), { preserveBasicStyle: true });
    }).join("\n\n");
  },

  convertSrtToVtt(content) {
    const raw = String(content || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!raw.trim()) {
      return "WEBVTT\n\n";
    }
    if (/^\s*WEBVTT/i.test(raw)) {
      return this.applySubtitleAssAlignmentToVtt(raw);
    }
    const withHours = raw.replace(/(\b\d{1,2}:\d{2}:\d{2}),(\d{3}\b)/g, "$1.$2");
    const normalized = withHours.replace(/(\b\d{1,2}:\d{2}),(\d{3}\b)/g, "00:$1.$2");
    return this.applySubtitleAssAlignmentToVtt(`WEBVTT\n\n${normalized}`);
  },

  async resolveSubtitlePlaybackUrl(url, { timeoutMs = 0 } = {}) {
    const original = String(url || "").trim();
    if (!original) {
      return "";
    }
    if (/^(blob:|data:)/i.test(original)) {
      return original;
    }
    const effectiveTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : (Environment.isWebOS() ? 5000 : 0);
    const requestController = typeof AbortController === "function" && effectiveTimeoutMs > 0
      ? new AbortController()
      : null;
    let requestTimeoutId = null;
    try {
      const requestPromise = fetch(original, {
        mode: "cors",
        headers: this.getSubtitleRequestHeaders(),
        ...(requestController ? { signal: requestController.signal } : {})
      });
      const response = effectiveTimeoutMs > 0
        ? await Promise.race([
          requestPromise,
          new Promise((_, reject) => {
            requestTimeoutId = setTimeout(() => {
              try {
                requestController?.abort();
              } catch (_) {
                // Ignore abort failures.
              }
              reject(new Error("Subtitle request timed out"));
            }, effectiveTimeoutMs);
          })
        ])
        : await requestPromise;
      if (!response.ok) {
        throw new Error(`Subtitle request failed with HTTP ${response.status}`);
      }
      const body = await response.text();
      const contentType = String(response.headers?.get("content-type") || "").toLowerCase();
      return this.createSubtitleObjectUrl(body, original, contentType);
    } catch (directError) {
      if (Environment.isWebOS()) {
        try {
          const resolved = await localMediaSubtitleRepository.getExternalSubtitleText(original);
          return this.createSubtitleObjectUrl(resolved.body, original, resolved.contentType);
        } catch (proxyError) {
          console.warn("webOS subtitle resolver failed", {
            subtitleUrl: original,
            directError: directError?.message || String(directError || ""),
            proxyError: proxyError?.message || String(proxyError || "")
          });
          return "";
        }
      }
      return original;
    } finally {
      if (requestTimeoutId) {
        clearTimeout(requestTimeoutId);
      }
    }
  },

  async resolveTizenAvPlaySubtitleUrl(url) {
    const original = String(url || "").trim();
    if (!original || !Environment.isTizen()) {
      return "";
    }
    if (!/^https?:\/\//i.test(original)) {
      return original;
    }
    try {
      const service = await TizenEngineFsService.ensureStarted();
      const baseUrl = String(service?.baseUrl || "").replace(/\/+$/, "");
      if (service?.status !== "success" || !baseUrl) {
        return original;
      }
      return `${baseUrl}/subtitles.vtt?from=${encodeURIComponent(original)}`;
    } catch (error) {
      console.warn("Tizen subtitle proxy unavailable", {
        subtitleUrl: original,
        error: error?.message || String(error || "")
      });
      return original;
    }
  },

  parseSubtitleTimestamp(value = "") {
    const match = String(value || "").trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/);
    if (!match) {
      return NaN;
    }
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const milliseconds = Number(String(match[4] || "0").padEnd(3, "0").slice(0, 3));
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
  },

  decodeSubtitleEntities(value = "") {
    const text = String(value || "");
    if (!text.includes("&")) {
      return text;
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value;
    } catch (_) {
      return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }
  },

  parseSubtitleCueText(text = "") {
    return this.decodeSubtitleEntities(
      this.sanitizeSubtitleText(String(text || ""), { preserveBasicStyle: false })
        .replace(/<[^>]*>/g, "")
    ).trim();
  },

  parseSubtitleCues(content = "") {
    const normalized = this.convertSrtToVtt(content)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    return normalized
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block.split("\n").map((line) => line.trimEnd());
        const timingIndex = lines.findIndex((line) => line.includes("-->"));
        if (timingIndex < 0) {
          return null;
        }
        const timingParts = String(lines[timingIndex] || "").split("-->");
        const start = this.parseSubtitleTimestamp(timingParts[0]);
        const end = this.parseSubtitleTimestamp(timingParts[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          return null;
        }
        const text = this.parseSubtitleCueText(lines.slice(timingIndex + 1).join("\n"));
        if (!text) {
          return null;
        }
        const layout = parseVttCueLayout(lines[timingIndex]);
        return { start, end, text, line: layout.line, align: layout.align };
      })
      .filter(Boolean)
      .sort((left, right) => left.start - right.start || left.end - right.end);
  },

  clearHtmlSubtitleOverlay() {
    if (this.htmlSubtitleRenderFrame != null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.htmlSubtitleRenderFrame);
      } else {
        clearTimeout(this.htmlSubtitleRenderFrame);
      }
    }
    this.htmlSubtitleRenderFrame = null;
    if (this.htmlSubtitleRenderTimer != null) {
      clearTimeout(this.htmlSubtitleRenderTimer);
      this.htmlSubtitleRenderTimer = null;
    }
    if (this.avPlaySubtitleOverlayTimer) {
      clearTimeout(this.avPlaySubtitleOverlayTimer);
      this.avPlaySubtitleOverlayTimer = null;
    }
    this.htmlSubtitleCues = [];
    this.htmlSubtitleActiveCueKey = "";
    this.htmlSubtitleSelectedId = null;
    this.webOsEmbeddedHtmlSubtitleTrack = null;
    this.webOsEmbeddedHtmlSubtitleCueCount = 0;
    this.webOsEmbeddedHtmlSubtitleActivationKey = "";
    const node = this.uiRefs?.htmlSubtitles || document.getElementById("playerHtmlSubtitles");
    if (node) {
      if (typeof node.replaceChildren === "function") {
        node.replaceChildren();
      } else {
        node.innerHTML = "";
      }
      node.classList.add("hidden");
      node.setAttribute("aria-hidden", "true");
    }
  },

  clearBitmapSubtitleCanvas() {
    const canvas = this.uiRefs?.bitmapSubtitles || document.getElementById("playerBitmapSubtitles");
    if (!canvas) {
      return;
    }
    try {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    } catch (_) {
      // Best effort on legacy Canvas implementations.
    }
    canvas.classList.add("hidden");
    canvas.setAttribute("aria-hidden", "true");
    this.bitmapSubtitleLastFrameKey = "";
  },

  clearBitmapSubtitleOverlay({ dispose = false } = {}) {
    this.bitmapSubtitleLoadToken = Number(this.bitmapSubtitleLoadToken || 0) + 1;
    this.bitmapSubtitleLoading = false;
    this.bitmapSubtitleWindowStart = 0;
    this.bitmapSubtitleWindowEnd = 0;
    this.bitmapSubtitleLastErrorAt = 0;
    this.clearBitmapSubtitleCanvas();
    if (dispose) {
      this.bitmapSubtitleDecoder?.dispose?.();
      this.bitmapSubtitleDecoder = null;
      this.bitmapSubtitleTrack = null;
      this.bitmapSubtitleScratchCanvas = null;
    }
  },

  async loadBitmapSubtitleWindow(timeSeconds) {
    const track = this.bitmapSubtitleTrack;
    const sourceUrl = this.getTrackProbeUrl();
    if (!track || !sourceUrl || this.bitmapSubtitleLoading) {
      return false;
    }
    const requestToken = Number(this.bitmapSubtitleLoadToken || 0) + 1;
    this.bitmapSubtitleLoadToken = requestToken;
    this.bitmapSubtitleLoading = true;
    const subtitleTime = Math.max(0, Number(timeSeconds || 0));
    const startSeconds = Math.floor(subtitleTime / BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS)
      * BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS;
    try {
      const windowData = await localMediaBitmapSubtitleRepository.getWindow({
        url: sourceUrl,
        trackNumber: track.sourceTrackId,
        startSeconds,
        endSeconds: startSeconds + BITMAP_SUBTITLE_WINDOW_SECONDS
      });
      if (requestToken !== this.bitmapSubtitleLoadToken || this.bitmapSubtitleTrack !== track) {
        return false;
      }
      const decoder = new BitmapSubtitleDecoder();
      if (windowData.cueCount > 0) {
        await decoder.load(windowData.idxContent, windowData.subData);
      }
      if (requestToken !== this.bitmapSubtitleLoadToken || this.bitmapSubtitleTrack !== track) {
        decoder.dispose();
        return false;
      }
      const previousDecoder = this.bitmapSubtitleDecoder;
      this.bitmapSubtitleDecoder = decoder;
      previousDecoder?.dispose?.();
      this.bitmapSubtitleWindowStart = windowData.windowStartSeconds;
      this.bitmapSubtitleWindowEnd = windowData.windowEndSeconds;
      this.bitmapSubtitleLastFrameKey = "";
      this.renderBitmapSubtitleAtCurrentTime({ force: true });
      return true;
    } catch (error) {
      if (requestToken === this.bitmapSubtitleLoadToken && this.bitmapSubtitleTrack === track) {
        this.bitmapSubtitleLastErrorAt = Date.now();
        this.clearBitmapSubtitleCanvas();
        console.warn("Embedded VOBSUB rendering failed", {
          trackNumber: track.sourceTrackId,
          error: error?.message || String(error || "")
        });
      }
      return false;
    } finally {
      if (requestToken === this.bitmapSubtitleLoadToken) {
        this.bitmapSubtitleLoading = false;
      }
    }
  },

  renderBitmapSubtitleAtCurrentTime({ force = false } = {}) {
    const track = this.bitmapSubtitleTrack;
    if (!track) {
      return false;
    }
    const currentTime = Number(this.getPlaybackCurrentSeconds() || 0);
    const subtitleTime = Math.max(0, currentTime - (Number(this.subtitleDelayMs || 0) / 1000));
    const outsideWindow = subtitleTime < this.bitmapSubtitleWindowStart
      || subtitleTime >= this.bitmapSubtitleWindowEnd;
    const approachingWindowEnd = this.bitmapSubtitleWindowEnd > 0
      && subtitleTime >= this.bitmapSubtitleWindowEnd - BITMAP_SUBTITLE_PREFETCH_SECONDS;
    if ((outsideWindow || approachingWindowEnd) && !this.bitmapSubtitleLoading) {
      const retryAllowed = !this.bitmapSubtitleLastErrorAt || Date.now() - this.bitmapSubtitleLastErrorAt >= 5000;
      if (retryAllowed) {
        void this.loadBitmapSubtitleWindow(subtitleTime);
      }
    }

    const frame = outsideWindow ? null : this.bitmapSubtitleDecoder?.renderAtSeconds(subtitleTime);
    if (!frame) {
      this.clearBitmapSubtitleCanvas();
      return false;
    }
    const canvas = this.uiRefs?.bitmapSubtitles || document.getElementById("playerBitmapSubtitles");
    if (!canvas || !frame.width || !frame.height || !frame.screenWidth || !frame.screenHeight) {
      return false;
    }
    const viewport = typeof PlayerController.getPlayerViewportSize === "function"
      ? PlayerController.getPlayerViewportSize()
      : null;
    const viewportWidth = Math.max(1, Number(viewport?.width || window.innerWidth || document.documentElement?.clientWidth || 1920));
    const viewportHeight = Math.max(1, Number(viewport?.height || window.innerHeight || document.documentElement?.clientHeight || 1080));
    const style = this.subtitleStyleSettings || {};
    const sizeScale = normalizeSubtitleFontSize(style.fontSize) / 100;
    const verticalOffsetPx = splitSubtitleVerticalOffset(style.verticalOffset).value * -0.02 * viewportHeight;
    const mode = this.aspectModes[this.aspectModeIndex] || this.aspectModes[0];
    const rect = this.calculateAspectRect(mode.objectFit, PlayerController.video);
    const renderKey = [
      frame.key,
      viewportWidth,
      viewportHeight,
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
      sizeScale,
      verticalOffsetPx
    ].join(":");
    if (!force && renderKey === this.bitmapSubtitleLastFrameKey && !canvas.classList.contains("hidden")) {
      return true;
    }
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    const scratch = this.bitmapSubtitleScratchCanvas || document.createElement("canvas");
    this.bitmapSubtitleScratchCanvas = scratch;
    scratch.width = frame.width;
    scratch.height = frame.height;
    const scratchContext = scratch.getContext("2d");
    if (!scratchContext || frame.rgba.length !== frame.width * frame.height * 4) {
      return false;
    }
    const imageData = scratchContext.createImageData(frame.width, frame.height);
    imageData.data.set(frame.rgba);
    scratchContext.putImageData(imageData, 0, 0);
    const scaleX = rect.width / frame.screenWidth;
    const scaleY = rect.height / frame.screenHeight;
    const targetWidth = frame.width * scaleX * sizeScale;
    const targetHeight = frame.height * scaleY * sizeScale;
    const targetCenterX = rect.x + ((frame.x + frame.width / 2) * scaleX);
    const targetCenterY = rect.y + ((frame.y + frame.height / 2) * scaleY) + verticalOffsetPx;
    context.drawImage(
      scratch,
      targetCenterX - targetWidth / 2,
      targetCenterY - targetHeight / 2,
      targetWidth,
      targetHeight
    );
    canvas.classList.remove("hidden");
    canvas.setAttribute("aria-hidden", "false");
    this.bitmapSubtitleLastFrameKey = renderKey;
    return true;
  },

  renderHtmlSubtitleOverlayCue(activeCues = []) {
    const node = this.uiRefs?.htmlSubtitles || document.getElementById("playerHtmlSubtitles");
    if (!node) {
      return;
    }
    const cueKey = activeCues
      .map((cue) => `${cue.start}-${cue.end}-${cue.line ?? "default"}-${cue.align || "center"}-${cue.text}`)
      .join("|");
    const hasRenderedActiveCue = activeCues.length > 0
      && !node.classList.contains("hidden")
      && node.getAttribute("aria-hidden") === "false"
      && node.childNodes.length > 0;
    const hasRenderedEmptyCue = activeCues.length === 0
      && node.classList.contains("hidden")
      && node.childNodes.length === 0;
    if (cueKey === this.htmlSubtitleActiveCueKey && (hasRenderedActiveCue || hasRenderedEmptyCue)) {
      return;
    }
    this.htmlSubtitleActiveCueKey = cueKey;
    if (typeof node.replaceChildren === "function") {
      node.replaceChildren();
    } else {
      node.innerHTML = "";
    }
    if (!activeCues.length) {
      node.classList.add("hidden");
      node.setAttribute("aria-hidden", "true");
      return;
    }
    const cueGroups = new Map();
    activeCues.forEach((cue) => {
      const line = cue?.line == null ? NaN : Number(cue.line);
      const normalizedLine = Number.isFinite(line) ? clamp(line, 0, 100) : null;
      const align = ["start", "end", "center"].includes(cue?.align) ? cue.align : "center";
      const groupKey = `${normalizedLine ?? "default"}:${align}`;
      if (!cueGroups.has(groupKey)) {
        cueGroups.set(groupKey, { line: normalizedLine, align, cues: [] });
      }
      cueGroups.get(groupKey).cues.push(cue);
    });
    cueGroups.forEach((group) => {
      const cueNode = document.createElement("div");
      cueNode.className = `player-html-subtitle-cue player-html-subtitle-align-${group.align}`;
      if (group.line == null) {
        cueNode.classList.add("player-html-subtitle-default");
      } else {
        cueNode.classList.add("player-html-subtitle-positioned");
        cueNode.style.top = `${group.line}%`;
      }
      group.cues.forEach((cue) => String(cue.text || "").split("\n").forEach((line) => {
        const cleanLine = line.trim();
        if (!cleanLine) {
          return;
        }
        const lineNode = document.createElement("span");
        lineNode.className = "player-html-subtitle-line";
        lineNode.textContent = cleanLine;
        cueNode.appendChild(lineNode);
      }));
      if (cueNode.childNodes.length) {
        node.appendChild(cueNode);
      }
    });
    node.classList.remove("hidden");
    node.setAttribute("aria-hidden", "false");
  },

  renderHtmlSubtitleOverlayAtCurrentTime() {
    if (!Array.isArray(this.htmlSubtitleCues) || !this.htmlSubtitleCues.length) {
      return false;
    }
    const currentTime = Number(this.getPlaybackCurrentSeconds() || 0);
    const delaySeconds = Number(this.subtitleDelayMs || 0) / 1000;
    const subtitleTime = currentTime - delaySeconds;
    const activeCues = this.htmlSubtitleCues.filter((cue) => (
      subtitleTime >= cue.start && subtitleTime < cue.end
    ));
    this.renderHtmlSubtitleOverlayCue(activeCues);
    return true;
  },

  scheduleHtmlSubtitleOverlayRender() {
    if (!Array.isArray(this.htmlSubtitleCues) || !this.htmlSubtitleCues.length) {
      return;
    }
    if (this.htmlSubtitleRenderTimer != null) {
      clearTimeout(this.htmlSubtitleRenderTimer);
      this.htmlSubtitleRenderTimer = null;
    }
    const render = () => {
      if (!this.renderHtmlSubtitleOverlayAtCurrentTime()) {
        this.htmlSubtitleRenderTimer = null;
        return;
      }
      this.htmlSubtitleRenderTimer = setTimeout(render, 120);
    };
    render();
  },

  renderAvPlaySubtitleChange(detail = {}) {
    if (
      !Environment.isTizen()
      || typeof PlayerController.isUsingAvPlay !== "function"
      || !PlayerController.isUsingAvPlay()
    ) {
      return;
    }
    const subtitleOutputActive = typeof PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml === "function"
      ? PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml()
      : Number(this.selectedSubtitleTrackIndex) >= 0;
    if (!subtitleOutputActive) {
      return;
    }
    if (this.avPlaySubtitleOverlayTimer) {
      clearTimeout(this.avPlaySubtitleOverlayTimer);
      this.avPlaySubtitleOverlayTimer = null;
    }
    const rawText = String(detail?.subtitles || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const text = this.parseSubtitleCueText(rawText);
    if (!text) {
      this.renderHtmlSubtitleOverlayCue([]);
      return;
    }
    this.htmlSubtitleCues = [];
    this.htmlSubtitleSelectedId = "avplay-native";
    const alignment = this.getSubtitleAssAlignment(rawText);
    const layout = this.getSubtitleAssAlignmentSettings(alignment) || { line: null, align: "center" };
    this.renderHtmlSubtitleOverlayCue([{ start: 0, end: 0, text, ...layout }]);
    const durationMs = Number(detail?.duration || 0);
    const hideDelayMs = Number.isFinite(durationMs) && durationMs > 0
      ? clamp(durationMs, 250, 12000)
      : 2500;
    this.avPlaySubtitleOverlayTimer = setTimeout(() => {
      this.avPlaySubtitleOverlayTimer = null;
      this.renderHtmlSubtitleOverlayCue([]);
    }, hideDelayMs);
  },

  async applyTvHtmlAddonSubtitle(subtitle, subtitleIndex) {
    const subtitleId = subtitle?.id || subtitle?.url || `subtitle-${subtitleIndex}`;
    const subtitleUrl = Environment.isTizen()
      ? await this.resolveTizenAvPlaySubtitleUrl(subtitle?.url)
      : await this.resolveSubtitlePlaybackUrl(subtitle?.url);
    if (!subtitleUrl) {
      return false;
    }
    const response = await fetch(subtitleUrl, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`HTML subtitle fetch failed with HTTP ${response.status}`);
    }
    const text = await response.text();
    const cues = this.parseSubtitleCues(text);
    if (!cues.length) {
      throw new Error("HTML subtitle fetch returned no cues");
    }
    this.clearMountedExternalSubtitleTracks();
    this.clearHtmlSubtitleOverlay();
    if (typeof PlayerController.setAvPlaySubtitleTrack === "function") {
      PlayerController.setAvPlaySubtitleTrack(-1);
    }
    this.htmlSubtitleCues = cues;
    this.htmlSubtitleSelectedId = subtitleId;
    this.selectedAddonSubtitleId = subtitleId;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedManifestSubtitleTrackId = null;
    this.renderHtmlSubtitleOverlayCue([]);
    this.scheduleHtmlSubtitleOverlayRender();
    this.invalidateTrackDialogCaches();
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    this.renderSubtitleDialog();
    return true;
  },

  activateMountedExternalSubtitleTrack(trackNode) {
    const textTracks = this.getTextTracks();
    const targetTrack = trackNode?.track || null;
    if (!targetTrack && !textTracks.length) {
      return false;
    }

    let activatedIndex = -1;
    textTracks.forEach((textTrack, index) => {
      const shouldShow = targetTrack ? textTrack === targetTrack : index === textTracks.length - 1;
      try {
        textTrack.mode = shouldShow ? "showing" : "disabled";
        if (shouldShow) {
          activatedIndex = index;
        }
      } catch (_) {
        // Best effort.
      }
    });

    if (activatedIndex < 0 && targetTrack) {
      try {
        targetTrack.mode = "showing";
        activatedIndex = textTracks.indexOf(targetTrack);
      } catch (_) {
        // Best effort.
      }
    }

    if (activatedIndex >= 0) {
      this.selectedSubtitleTrackIndex = activatedIndex;
      this.refreshTrackDialogs();
      return true;
    }

    return false;
  },

  resolveBuiltInSubtitleBoundary(textTracks = this.getTextTracks()) {
    const trackCount = textTracks.length;
    if (!trackCount) {
      return 0;
    }

    if (Number.isFinite(this.builtInSubtitleCount) && this.builtInSubtitleCount > 0) {
      return clamp(this.builtInSubtitleCount, 0, trackCount);
    }

    if (this.externalTrackNodes.length > 0) {
      const inferred = trackCount - this.externalTrackNodes.length;
      if (inferred >= 0) {
        return clamp(inferred, 0, trackCount);
      }
      return trackCount;
    }

    return trackCount;
  },

  syncTrackState() {
    const textTracks = this.getTextTracks();
    const audioTracks = this.getAudioTracks();
    const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function"
      ? PlayerController.getDashAudioTracks()
      : [];
    const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function"
      ? PlayerController.getDashTextTracks()
      : [];
    const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function"
      ? PlayerController.getAvPlayAudioTracks()
      : [];
    const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function"
      ? PlayerController.getAvPlaySubtitleTracks()
      : [];
    const selectedEmbeddedSubtitleTrack = typeof PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex === "function"
      ? PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex()
      : -1;
    const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function"
      ? PlayerController.getHlsAudioTracks()
      : [];
    const hlsSubtitleTracks = typeof PlayerController.getHlsSubtitleTracks === "function"
      ? PlayerController.getHlsSubtitleTracks()
      : [];

    if (!this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length;
    } else if ((!Number.isFinite(this.builtInSubtitleCount) || this.builtInSubtitleCount <= 0) && textTracks.length > this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length - this.externalTrackNodes.length;
    }

    if (avplaySubtitleTracks.length) {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function"
        ? PlayerController.getSelectedAvPlaySubtitleTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedAvPlaySubtitleTrack)
        ? selectedAvPlaySubtitleTrack
        : -1;
    } else if (dashSubtitleTracks.length) {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function"
        ? PlayerController.getSelectedDashTextTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedDashSubtitleTrack)
        ? selectedDashSubtitleTrack
        : -1;
    } else if (hlsSubtitleTracks.length) {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      const selectedHlsSubtitleTrack = typeof PlayerController.getSelectedHlsSubtitleTrackIndex === "function"
        ? PlayerController.getSelectedHlsSubtitleTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedHlsSubtitleTrack)
        ? selectedHlsSubtitleTrack
        : -1;
      this.selectedManifestSubtitleTrackId = null;
    } else if (this.shouldUseEmbeddedSubtitleTracks()) {
      if (!this.bitmapSubtitleTrack) {
        this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(selectedEmbeddedSubtitleTrack)
          ? selectedEmbeddedSubtitleTrack
          : -1;
      }
      this.selectedSubtitleTrackIndex = -1;
    } else {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedSubtitleTrackIndex = textTracks.findIndex((track) => track?.mode && track.mode !== "disabled");
    }

    if (avplayAudioTracks.length) {
      const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function"
        ? PlayerController.getSelectedAvPlayAudioTrackIndex()
        : -1;
      const fallbackTrackIndex = Number(avplayAudioTracks[0]?.avplayTrackIndex);
      this.selectedAudioTrackIndex = selectedAvPlayAudioTrack >= 0
        ? selectedAvPlayAudioTrack
        : (Number.isFinite(fallbackTrackIndex) ? fallbackTrackIndex : 0);
      this.invalidateTrackDialogCaches();
      return;
    }

    if (dashAudioTracks.length) {
      const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function"
        ? PlayerController.getSelectedDashAudioTrackIndex()
        : -1;
      this.selectedAudioTrackIndex = selectedDashAudioTrack >= 0 ? selectedDashAudioTrack : 0;
      this.invalidateTrackDialogCaches();
      return;
    }

    if (hlsAudioTracks.length) {
      const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function"
        ? PlayerController.getSelectedHlsAudioTrackIndex()
        : -1;
      const defaultHlsAudioTrack = hlsAudioTracks.findIndex((track) => Boolean(track?.default));
      this.selectedAudioTrackIndex = selectedHlsAudioTrack >= 0
        ? selectedHlsAudioTrack
        : (defaultHlsAudioTrack >= 0 ? defaultHlsAudioTrack : 0);
      this.invalidateTrackDialogCaches();
      return;
    }

    this.selectedAudioTrackIndex = audioTracks.findIndex((track) => Boolean(track?.enabled || track?.selected));
    this.invalidateTrackDialogCaches();
  },

  isSubtitleOffEntrySelected(nativeTrackIndex = this.selectedSubtitleTrackIndex) {
    return (
      Number(nativeTrackIndex) < 0 &&
      Number(this.selectedEmbeddedSubtitleTrackIndex) < 0 &&
      !this.selectedAddonSubtitleId &&
      !this.selectedManifestSubtitleTrackId
    );
  },

  getSubtitleEntries(tab = this.subtitleDialogTab) {
    const textTracks = this.getTextTracks();
    const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
    const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function"
      ? PlayerController.getDashTextTracks()
      : [];
    const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function"
      ? PlayerController.getSelectedDashTextTrackIndex()
      : -1;
    const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function"
      ? PlayerController.getAvPlaySubtitleTracks()
      : [];
    const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function"
      ? PlayerController.getSelectedAvPlaySubtitleTrackIndex()
      : -1;
    const hlsSubtitleTracks = typeof PlayerController.getHlsSubtitleTracks === "function"
      ? PlayerController.getHlsSubtitleTracks()
      : [];
    const selectedHlsSubtitleTrack = typeof PlayerController.getSelectedHlsSubtitleTrackIndex === "function"
      ? PlayerController.getSelectedHlsSubtitleTrackIndex()
      : -1;
    const embeddedSubtitleTracks = this.shouldUseEmbeddedSubtitleTracks()
      ? this.embeddedSubtitleTracks
      : [];

    const builtInTracks = this.dedupeBuiltInSubtitleTracks(
      textTracks.filter((_, index) => index < builtInBoundary),
      embeddedSubtitleTracks
    );
    const addonTracks = textTracks.filter((_, index) => index >= builtInBoundary);
    const trackDiscoveryPending = this.embeddedSubtitleLoading
      || (this.isCurrentSourceAdaptiveManifest()
        && (this.trackDiscoveryInProgress || this.subtitleLoading || this.manifestLoading));

    if (tab === "builtIn") {
	      if (avplaySubtitleTracks.length) {
	        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.isSubtitleOffEntrySelected(selectedAvPlaySubtitleTrack),
            trackIndex: -1,
            avplaySubtitleTrackIndex: -1
          },
          ...avplaySubtitleTracks.map((track, index) => {
            const mergedTrack = this.mergeAvPlaySubtitleTrackMetadata(track, index);
            const avplayTrackIndex = Number(track?.avplayTrackIndex);
            const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
            const display = formatSubtitleTrackDisplay(mergedTrack, index);
            return {
              id: `subtitle-avplay-${normalizedTrackIndex}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track: mergedTrack,
              isForced: isForcedSubtitleTrack(mergedTrack),
              selected: normalizedTrackIndex === selectedAvPlaySubtitleTrack,
              trackIndex: null,
              avplaySubtitleTrackIndex: normalizedTrackIndex
            };
          })
        ];
      }

      if (dashSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.isSubtitleOffEntrySelected(selectedDashSubtitleTrack),
            trackIndex: -1,
            dashSubtitleTrackIndex: -1
          },
          ...dashSubtitleTracks.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-dash-${index}-${track?.id ?? ""}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: index === selectedDashSubtitleTrack,
              trackIndex: null,
              dashSubtitleTrackIndex: index
            };
          })
        ];
      }

      if (hlsSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.isSubtitleOffEntrySelected(selectedHlsSubtitleTrack),
            trackIndex: -1,
            hlsSubtitleTrackIndex: -1
          },
          ...hlsSubtitleTracks.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-hls-${index}-${track?.id ?? track?.name ?? track?.lang ?? ""}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: index === selectedHlsSubtitleTrack,
              trackIndex: null,
              hlsSubtitleTrackIndex: index
            };
          })
        ];
      }

      const entries = [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.isSubtitleOffEntrySelected(this.selectedSubtitleTrackIndex),
            trackIndex: -1
          },
          ...embeddedSubtitleTracks.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-embedded-${track.embeddedTrackIndex}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: track.embeddedTrackIndex === this.selectedEmbeddedSubtitleTrackIndex,
              trackIndex: null,
              embeddedSubtitleTrackIndex: track.embeddedTrackIndex
            };
          }),
          ...builtInTracks.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-built-${index}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: this.selectedEmbeddedSubtitleTrackIndex < 0 && index === this.selectedSubtitleTrackIndex,
              trackIndex: index
            };
          }),
        ...this.manifestSubtitleTracks.map((track, index) => {
          const display = formatSubtitleTrackDisplay(track, index);
          return {
            id: `subtitle-manifest-${track.id}`,
            label: display.label,
            language: display.language,
            secondary: display.secondary,
            languageKey: display.languageKey,
            languageLabel: display.languageLabel,
            track,
            isForced: isForcedSubtitleTrack(track),
            selected: this.selectedManifestSubtitleTrackId === track.id,
            trackIndex: null,
            manifestSubtitleTrackId: track.id
          };
        })
      ];

      if (embeddedSubtitleTracks.length || builtInTracks.length || !trackDiscoveryPending) {
        return entries;
      }

      return [
        ...entries,
        {
          id: "subtitle-builtin-loading",
          label: "Loading subtitle tracks...",
          secondary: "",
          selected: false,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    if (tab === "addons") {
      if (this.subtitles.length) {
        return this.subtitles.map((subtitle, index) => {
          const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
          const display = formatSubtitleTrackDisplay(subtitle, index);
          return {
            id: `subtitle-addon-fallback-${subtitleId}`,
            label: display.label,
            language: display.language,
            secondary: subtitle.addonName || t("nav_addons", {}, "Addon"),
            languageKey: display.languageKey,
            languageLabel: display.languageLabel,
            track: subtitle,
            isForced: isForcedAddonSubtitle(subtitle),
            selected: this.selectedAddonSubtitleId === subtitleId,
            trackIndex: null,
            subtitleIndex: index,
            fallbackAddonSubtitle: true
          };
        });
      }
      if (addonTracks.length) {
        return addonTracks.map((track, relativeIndex) => {
          const absoluteIndex = builtInBoundary + relativeIndex;
          const display = formatSubtitleTrackDisplay(track, relativeIndex);
          return {
            id: `subtitle-addon-${absoluteIndex}`,
            label: display.label,
            language: display.language,
            secondary: display.secondary,
            languageKey: display.languageKey,
            languageLabel: display.languageLabel,
            track,
            isForced: isForcedAddonSubtitle(track),
            selected: absoluteIndex === this.selectedSubtitleTrackIndex,
            trackIndex: absoluteIndex
          };
        });
      }
      if (this.subtitleLoading || this.trackDiscoveryInProgress) {
        return [
          {
            id: "subtitle-addon-loading",
            label: "Loading addon subtitles...",
            secondary: "",
            selected: false,
            disabled: true,
            trackIndex: null
          }
        ];
      }
      return [
        {
          id: "subtitle-addon-empty",
          label: this.getUnavailableTrackMessage("subtitle"),
          secondary: "",
          selected: false,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    if (tab === "style") {
      return [
        {
          id: "subtitle-style-default",
          label: t("subtitle_style_defaults", {}, "Default"),
          secondary: "System style",
          selected: true,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    return [
      {
        id: "subtitle-delay-default",
        label: "0.0s",
        secondary: "Delay control not available in web player",
        selected: true,
        disabled: true,
        trackIndex: null
      }
    ];
  },

  collectSubtitleOptionItems() {
    const cachedOptions = this.trackDialogCache?.subtitleOptions;
    if (cachedOptions) {
      return cachedOptions;
    }
    const builtInEntries = this.getSubtitleEntries("builtIn").filter((entry) => !entry?.disabled || entry?.id === "subtitle-off");
    const addonEntries = this.getSubtitleEntries("addons").filter((entry) => !entry?.disabled);
    const options = [];

    builtInEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      if (entry.id === "subtitle-off") {
        options.push({
          id: entry.id,
          languageKey: SUBTITLE_LANGUAGE_OFF_KEY,
          languageLabel: t("subtitle_none", {}, "Off"),
          title: entry.label,
          secondary: "",
          selected: Boolean(entry.selected),
          sourceType: "off",
          isForced: false,
          entry
        });
        return;
      }
      const languageSource = getSubtitleEntryLanguageSource(entry);
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      const track = entry.track || entry;
      const isForced = Boolean(entry.isForced) || isForcedSubtitleTrack(track);
      const title = cleanDisplayText(track?.name)
        || cleanDisplayText(track?.label)
        || cleanDisplayText(track?.title)
        || entry.label
        || subtitleLabel(options.length);
      const metaParts = [];
      pushUniqueText(metaParts, track?.codec || track?.codecs || track?.codec_name || track?.format);
      if (isForced) {
        pushUniqueText(metaParts, t("sub_forced_lang", {}, "Forced"));
      }
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title,
        sourceLabel: t("subtitle_built_in", {}, "Built in"),
        meta: metaParts.join(" • "),
        secondary: metaParts.join(" • "),
        selected: Boolean(entry.selected),
        sourceType: "internal",
        isForced,
        entry
      });
    });

    addonEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      const languageSource = getSubtitleEntryLanguageSource(entry);
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      const track = entry.track || entry;
      const isForced = isForcedAddonSubtitle(track);
      const trackId = cleanDisplayText(track?.id);
      const normalizedTrackId = normalizeSubtitleLanguageKey(trackId);
      const meta = trackId && normalizedTrackId !== languageKey ? trackId : "";
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title: languageLabel,
        sourceLabel: entry.secondary || track?.addonName || t("subtitle_tab_addons", {}, "Addons"),
        meta,
        secondary: meta,
        selected: Boolean(entry.selected),
        sourceType: "addon",
        isForced,
        entry
      });
    });

    this.trackDialogCache.subtitleOptions = options;
    return options;
  },

  getSelectedSubtitleLanguageKey() {
    const selected = this.collectSubtitleOptionItems().find((entry) => entry.selected);
    return selected?.languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
  },

  getSubtitleLanguageRailItems() {
    const cachedLanguageRail = this.trackDialogCache?.subtitleLanguageRail;
    if (cachedLanguageRail) {
      return cachedLanguageRail;
    }
    const options = this.collectSubtitleOptionItems();
    const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
    const groups = new Map();
    options.forEach((option) => {
      if (option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
        return;
      }
      if (!groups.has(option.languageKey)) {
        groups.set(option.languageKey, {
          key: option.languageKey,
          label: option.languageLabel || subtitleLanguageLabel(option.languageKey),
          selected: false,
          count: 0,
          hasInternalTracks: false
        });
      }
      const group = groups.get(option.languageKey);
      group.count += 1;
      group.selected = group.selected || Boolean(option.selected);
      group.hasInternalTracks = group.hasInternalTracks || option.sourceType === "internal";
    });
    groups.set(SUBTITLE_LANGUAGE_OFF_KEY, {
      key: SUBTITLE_LANGUAGE_OFF_KEY,
      label: t("subtitle_none", {}, "Off"),
      selected: selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY,
      count: 0
    });
    const preferredTargets = this.getStartupPreferredSubtitleLanguageTargets();
    const preferredRankCache = new Map();
    const getPreferredRank = (entry) => {
      const key = String(entry?.key || "");
      if (!key || key === SUBTITLE_LANGUAGE_OFF_KEY) {
        return Number.MAX_SAFE_INTEGER;
      }
      if (preferredRankCache.has(key)) {
        return preferredRankCache.get(key);
      }
      const keyBase = key.split("-")[0];
      const rank = preferredTargets.findIndex((target) => {
        const targetKey = String(target || "");
        const targetBase = targetKey.split("-")[0];
        return key === targetKey || (keyBase && targetBase && keyBase === targetBase);
      });
      const resolvedRank = rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
      preferredRankCache.set(key, resolvedRank);
      return resolvedRank;
    };
    const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
    const matchesPreferredLanguage = (languageKey) => preferredTargets.some((target) => (
      languageKey === target || (languageKey && target.startsWith(`${languageKey}-`))
    ));
    const showOnlyPreferredLanguages = Boolean(this.subtitleStyleSettings?.showOnlyPreferredLanguages);
    const values = Array.from(groups.values())
      .filter((entry) => (
        !showOnlyPreferredLanguages
        || entry.key === SUBTITLE_LANGUAGE_OFF_KEY
        || entry.key === selectedLanguageKey
        || (entry.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY && entry.hasInternalTracks)
        || matchesPreferredLanguage(entry.key)
      ))
      .sort((left, right) => {
      if (left.key === right.key) return 0;
      if (left.key === SUBTITLE_LANGUAGE_OFF_KEY) return -1;
      if (right.key === SUBTITLE_LANGUAGE_OFF_KEY) return 1;
      // Sink the "Unknown" group below the real languages instead of letting
      // its label sort it into the middle of the alphabetical list.
      const leftUnknown = left.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY;
      const rightUnknown = right.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY;
      if (leftUnknown !== rightUnknown) {
        return leftUnknown ? 1 : -1;
      }
      const preferredDelta = getPreferredRank(left) - getPreferredRank(right);
      if (preferredDelta !== 0) {
        return preferredDelta;
      }
      const labelDelta = String(left.label || "").localeCompare(String(right.label || ""), locale, { sensitivity: "base" });
      if (labelDelta !== 0) {
        return labelDelta;
      }
      return String(left.key || "").localeCompare(String(right.key || ""), "en", { sensitivity: "base" });
      });
    this.trackDialogCache.subtitleLanguageRail = values;
    return values;
  },

  syncSubtitleOptionIndexForFocusedLanguage() {
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const selectedIndex = options.findIndex((item) => item.selected);
    this.subtitleOptionRailIndex = Math.max(0, selectedIndex >= 0 ? selectedIndex : 0);
  },

  selectSubtitleOption(option, { focusOptions = true } = {}) {
    if (!option?.entry || !option.languageKey || option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
      return false;
    }
    const languages = this.getSubtitleLanguageRailItems();
    const languageIndex = languages.findIndex((item) => item.key === option.languageKey);
    if (languageIndex >= 0) {
      this.subtitleLanguageRailIndex = languageIndex;
    }

    const options = this.getSubtitleOptionsForLanguage(option.languageKey);
    const optionIndex = options.findIndex((item) => item.id === option.id);
    this.subtitleOptionRailIndex = Math.max(0, optionIndex >= 0 ? optionIndex : 0);
    if (focusOptions) {
      this.subtitleFocusedRail = "options";
    }

    this.applySubtitleEntry(option.entry);
    return true;
  },

  selectFirstSubtitleOptionForLanguage(languageKey, { focusOptions = true } = {}) {
    if (!languageKey || languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
      return false;
    }
    const options = this.getSubtitleOptionsForLanguage(languageKey);
    if (!options.length) {
      return false;
    }
    return this.selectSubtitleOption(options[0], { focusOptions });
  },

  scrollSubtitleRailNodeIntoView(node, { center = false } = {}) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const rail = node.closest(".player-subtitle-rail");
    if (!(rail instanceof HTMLElement)) {
      return;
    }
    const margin = 12;
    const viewTop = Number(rail.scrollTop || 0);
    const maxScrollTop = Math.max(0, Number(rail.scrollHeight || 0) - Number(rail.clientHeight || 0));
    if (maxScrollTop <= 0) {
      return;
    }
    let nextScrollTop = viewTop;

    const railRect = typeof rail.getBoundingClientRect === "function" ? rail.getBoundingClientRect() : null;
    const nodeRect = typeof node.getBoundingClientRect === "function" ? node.getBoundingClientRect() : null;
    if (railRect && nodeRect && Number.isFinite(railRect.top) && Number.isFinite(nodeRect.top)) {
      if (center) {
        nextScrollTop = viewTop + (nodeRect.top - railRect.top) - Math.max(0, (rail.clientHeight - node.offsetHeight) / 2);
      } else if (nodeRect.top < railRect.top + margin) {
        nextScrollTop = viewTop - ((railRect.top + margin) - nodeRect.top);
      } else if (nodeRect.bottom > railRect.bottom - margin) {
        nextScrollTop = viewTop + (nodeRect.bottom - (railRect.bottom - margin));
      }
    } else {
      const nodeTop = Number(node.offsetTop || 0);
      const nodeBottom = nodeTop + Number(node.offsetHeight || 0);
      const viewBottom = viewTop + Number(rail.clientHeight || 0);
      if (center) {
        nextScrollTop = nodeTop - Math.max(0, (Number(rail.clientHeight || 0) - Number(node.offsetHeight || 0)) / 2);
      } else if (nodeTop < viewTop + margin) {
        nextScrollTop = nodeTop - margin;
      } else if (nodeBottom > viewBottom - margin) {
        nextScrollTop = nodeBottom - Number(rail.clientHeight || 0) + margin;
      }
    }
    if (nextScrollTop !== viewTop) {
      rail.scrollTop = Math.max(0, Math.min(maxScrollTop, Math.round(nextScrollTop)));
    }
  },

  scheduleSubtitleDialogScrollIntoView() {
    if (this.subtitleDialogScrollTimer) {
      clearTimeout(this.subtitleDialogScrollTimer);
      this.subtitleDialogScrollTimer = null;
    }
    this.subtitleDialogScrollTimer = setTimeout(() => {
      this.subtitleDialogScrollTimer = null;
      this.scrollSubtitleDialogIntoView();
    }, 0);
  },

  scrollSubtitleDialogIntoView() {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog || !this.subtitleDialogVisible) {
      return;
    }
    const selectedLanguageNode = dialog.querySelector(".player-subtitle-language-rail .player-dialog-item.selected");
    const focusedLanguageNode = dialog.querySelector(".player-subtitle-language-rail .player-dialog-item.focused");
    const languageNode = focusedLanguageNode || selectedLanguageNode;
    const optionNode = dialog.querySelector(".player-subtitle-options-rail .player-dialog-item.focused");
    const styleNode = dialog.querySelector(".player-subtitle-style-rail .player-dialog-item.focused");

    if (this.subtitleFocusedRail === "language") {
      this.scrollSubtitleRailNodeIntoView(languageNode);
    } else if (this.subtitleFocusedRail === "options") {
      this.scrollSubtitleRailNodeIntoView(optionNode);
    } else {
      this.scrollSubtitleRailNodeIntoView(styleNode);
    }
    this.subtitleDialogScrollMode = "nearest";
  },

  getSubtitleOptionsForLanguage(languageKey = this.getSelectedSubtitleLanguageKey()) {
    const normalizedLanguageKey = languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
    const optionsByLanguage = this.trackDialogCache?.subtitleOptionsByLanguage;
    if (optionsByLanguage?.has(normalizedLanguageKey)) {
      return optionsByLanguage.get(normalizedLanguageKey);
    }
    const sourceRank = { internal: 0, addon: 1, off: 2 };
    const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
    const filteredOptions = this.collectSubtitleOptionItems()
      .filter((entry) => entry.languageKey === normalizedLanguageKey && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY)
      .sort((left, right) => {
        const sourceDelta = (sourceRank[left.sourceType] ?? 99) - (sourceRank[right.sourceType] ?? 99);
        if (sourceDelta !== 0) {
          return sourceDelta;
        }
        const secondaryDelta = String(left.secondary || "").localeCompare(String(right.secondary || ""), locale, { sensitivity: "base" });
        if (secondaryDelta !== 0) {
          return secondaryDelta;
        }
        return String(left.title || "").localeCompare(String(right.title || ""), locale, { sensitivity: "base" });
      });
    optionsByLanguage?.set(normalizedLanguageKey, filteredOptions);
    return filteredOptions;
  },

  isTrackDiscoveryWindowPending() {
    return Number(this.trackDiscoveryDeadline || 0) > Date.now();
  },

  isAudioPreferenceDiscoveryPending() {
    return Boolean(
      this.embeddedAudioLoading
      || this.manifestLoading
      || this.trackDiscoveryInProgress
      || this.pendingWebOsAudioSelection
      || this.isStartupAudioPreferenceRetryPending()
      || (!this.getAudioEntries().length && this.isTrackDiscoveryWindowPending())
    );
  },

  clearStartupAudioPreferenceRetry() {
    if (this.startupAudioPreferenceRetryTimer) {
      clearTimeout(this.startupAudioPreferenceRetryTimer);
      this.startupAudioPreferenceRetryTimer = null;
    }
    this.startupAudioPreferenceRetryDeadline = 0;
  },

  isTizenAvPlayStartupAudioRetryPending() {
    return Boolean(
      Environment.isTizen()
      && typeof PlayerController.isUsingAvPlay === "function"
      && PlayerController.isUsingAvPlay()
      && Number(this.startupAudioPreferenceRetryDeadline || 0) > Date.now()
    );
  },

  isStartupAudioPreferenceRetryPending() {
    return Number(this.startupAudioPreferenceRetryDeadline || 0) > Date.now();
  },

  scheduleStartupAudioPreferenceRetry() {
    const canRetryTizenAvPlay = Boolean(
      Environment.isTizen()
      && typeof PlayerController.isUsingAvPlay === "function"
      && PlayerController.isUsingAvPlay()
    );
    const canRetryWebOsTracks = Environment.isWebOS();
    if (!canRetryTizenAvPlay && !canRetryWebOsTracks) {
      return false;
    }

    const now = Date.now();
    if (!Number(this.startupAudioPreferenceRetryDeadline || 0)) {
      this.startupAudioPreferenceRetryDeadline = now + STARTUP_AUDIO_PREFERENCE_RETRY_WINDOW_MS;
    }
    if (now >= Number(this.startupAudioPreferenceRetryDeadline || 0)) {
      this.clearStartupAudioPreferenceRetry();
      return false;
    }
    if (this.startupAudioPreferenceRetryTimer) {
      return true;
    }

    this.startupAudioPreferenceRetryTimer = setTimeout(() => {
      this.startupAudioPreferenceRetryTimer = null;
      if (this.startupAudioPreferenceApplied || !this.playerRouteActive) {
        this.clearStartupAudioPreferenceRetry();
        return;
      }
      if (typeof PlayerController.syncAvPlayTrackInfo === "function") {
        PlayerController.syncAvPlayTrackInfo({ force: true });
      }
      if (canRetryWebOsTracks) {
        this.loadEmbeddedSubtitleTracks();
        this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || null);
      }
      this.invalidateTrackDialogCaches();
      this.syncTrackState();
      this.applyStartupAudioPreference();
      this.renderControlButtons();
      if (this.audioDialogVisible) {
        this.renderAudioDialog();
      }
    }, STARTUP_AUDIO_PREFERENCE_RETRY_INTERVAL_MS);
    return true;
  },

  isSubtitlePreferenceDiscoveryPending() {
    const hasSubtitleOptions = this.collectSubtitleOptionItems()
      .some((entry) => entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    return Boolean(
      this.subtitleLoading
      || this.embeddedSubtitleLoading
      || this.manifestLoading
      || this.trackDiscoveryInProgress
      || (!hasSubtitleOptions && this.isTrackDiscoveryWindowPending())
    );
  },

  getStartupPreferredSubtitleLanguageKey() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return SUBTITLE_LANGUAGE_OFF_KEY;
    }

    const configured = extractSubtitleLanguageSetting(settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off").trim().toLowerCase();
    if (!configured || configured === "off" || configured === "none" || configured === "forced") {
      return SUBTITLE_LANGUAGE_OFF_KEY;
    }

    if (configured === "system") {
      const locale = typeof I18n.getLocale === "function"
        ? I18n.getLocale()
        : (globalThis.navigator?.language || "");
      const systemLanguage = normalizeTrackLanguageCode(locale);
      return systemLanguage ? normalizeSubtitleLanguageKey(systemLanguage) : SUBTITLE_LANGUAGE_OFF_KEY;
    }

    return normalizeSubtitleLanguageKey(configured);
  },

  getStartupPreferredSubtitleLanguageTargets() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return [];
    }

    const values = [
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off",
      settings.subtitleStyle?.secondaryPreferredLanguage || settings.secondarySubtitleLanguage || "off"
    ];

    const targets = values
      .map((value) => {
        const configured = String(value || "off").trim().toLowerCase();
        if (!configured || configured === "off" || configured === "none" || configured === "forced") {
          return "";
        }
        if (configured === "system") {
          const locale = typeof I18n.getLocale === "function"
            ? I18n.getLocale()
            : (globalThis.navigator?.language || "");
          return normalizeSubtitleLanguageKey(normalizeTrackLanguageCode(locale) || "");
        }
        return normalizeSubtitleLanguageKey(configured);
      })
      .filter(Boolean);

    return Array.from(new Set(targets));
  },

  shouldUseStartupForcedSubtitles(settings = PlayerSettingsStore.get()) {
    const preferred = extractSubtitleLanguageSetting(settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off").trim().toLowerCase();
    const secondary = extractSubtitleLanguageSetting(settings.subtitleStyle?.secondaryPreferredLanguage || settings.secondarySubtitleLanguage || "off").trim().toLowerCase();
    return Boolean(settings.subtitleStyle?.useForcedSubtitles || settings.useForcedSubtitles)
      || preferred === "forced"
      || secondary === "forced";
  },

  getStartupForcedSubtitleLanguageTarget() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled || !this.shouldUseStartupForcedSubtitles(settings)) {
      return null;
    }

    const explicitTargets = this.getStartupPreferredSubtitleLanguageTargets();
    const selectedAudioOption = this.collectAudioOptionItems().find((entry) => entry.selected && entry.languageKey);
    const primaryTarget = explicitTargets[0] || null;
    if (primaryTarget && selectedAudioOption && this.matchesStartupAudioTargetForForced(selectedAudioOption, primaryTarget)) {
      return primaryTarget;
    }

    const preferredAudioTargets = this.getStartupPreferredAudioLanguageTargets();
    if (!primaryTarget && selectedAudioOption && preferredAudioTargets.some((target) => this.matchesStartupAudioTarget(selectedAudioOption, target))) {
      return selectedAudioOption.languageKey;
    }

    return null;
  },

  getStartupSubtitlePreferenceMode() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return "off";
    }
    if (this.shouldUseStartupForcedSubtitles(settings)) {
      return "audio-forced";
    }
    const explicitTargets = this.getStartupPreferredSubtitleLanguageTargets();
    if (explicitTargets.length) {
      return "language";
    }
    return "off";
  },

  getStartupPreferredAudioLanguageTargets() {
    const settings = PlayerSettingsStore.get();
    const configured = String(settings.preferredAudioLanguage || "system").trim().toLowerCase();
    if (!configured || configured === "off" || configured === "none") {
      return [];
    }

    if (configured === "system") {
      const systemLanguage = this.getStartupSystemAudioLanguageTarget();
      return systemLanguage ? [systemLanguage] : [];
    }

    if (configured === "original") {
      const originalLanguage = normalizeTrackLanguageCode(this.contentLanguage);
      if (originalLanguage) {
        return [originalLanguage];
      }
      const systemLanguage = this.getStartupSystemAudioLanguageTarget();
      return systemLanguage ? [systemLanguage] : [];
    }

    const normalized = normalizeTrackLanguageCode(configured);
    return normalized ? [normalized] : [];
  },

  getStartupSystemAudioLanguageTarget() {
    const locale = typeof I18n.getLocale === "function"
      ? I18n.getLocale()
      : (globalThis.navigator?.language || "");
    return normalizeTrackLanguageCode(locale);
  },

  collectAudioOptionItems() {
    return this.getAudioEntries().map((entry, index) => {
      const track = entry?.track || {};
      const languageKey = inferAudioTrackLanguageKey(track, entry);
      return {
        id: entry?.id || `audio-option-${index}`,
        label: cleanDisplayText(entry?.label || ""),
        secondary: cleanDisplayText(entry?.secondary || ""),
        selected: Boolean(entry?.selected),
        supported: entry?.supported !== false,
        languageKey,
        languageLabel: getAudioTrackLanguageLabel(track, entry),
        entry,
        entryIndex: index
      };
    });
  },

  matchesStartupAudioTarget(option, target) {
    if (!option || !target) {
      return false;
    }
    if (option.languageKey === target) {
      return true;
    }
    const targetBase = String(target).split("-")[0];
    const optionBase = String(option.languageKey || "").split("-")[0];
    if (targetBase && optionBase && targetBase === optionBase) {
      return true;
    }
    const targetLabel = normalizeComparableText(getTrackLanguageLabel({ language: target }) || "");
    if (!targetLabel) {
      return false;
    }
    return [option.languageLabel, option.label, option.secondary]
      .map((value) => normalizeComparableText(value))
      .some((value) => value === targetLabel);
  },

  matchesStartupAudioTargetForForced(option, target) {
    if (!option || !target) {
      return false;
    }
    const normalizedTarget = normalizeTrackLanguageCode(target) || String(target).trim().toLowerCase();
    const optionLanguage = normalizeTrackLanguageCode(option.languageKey) || String(option.languageKey || "").trim().toLowerCase();
    if (optionLanguage === normalizedTarget) {
      return true;
    }
    const targetBase = normalizedTarget.split("-")[0];
    if (targetBase && targetBase !== normalizedTarget) {
      return optionLanguage === targetBase;
    }
    return this.matchesStartupAudioTarget(option, normalizedTarget);
  },

  findStartupPreferredAudioOption(targets = this.getStartupPreferredAudioLanguageTargets()) {
    const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!normalizedTargets.length) {
      return null;
    }
    const options = this.collectAudioOptionItems();
    for (const target of normalizedTargets) {
      const exactOption = options.find((entry) => entry.supported && entry.languageKey === target);
      if (exactOption) {
        return exactOption;
      }
      const matchingOption = options.find((entry) => entry.supported && this.matchesStartupAudioTarget(entry, target));
      if (matchingOption) {
        return matchingOption;
      }
    }
    return null;
  },

  applyStartupAudioPreference() {
    if (this.startupAudioPreferenceApplied || this.startupAudioPreferenceApplying) {
      return false;
    }

    const preferredTargets = this.getStartupPreferredAudioLanguageTargets();
    const isStillLoading = this.isAudioPreferenceDiscoveryPending();
    const matchedRememberedOption = this.findRememberedAudioOption();
    const rememberedOption = isStillLoading && matchedRememberedOption?.entry?.implicitAudioTrack
      ? null
      : matchedRememberedOption;
    if (rememberedOption?.entry && Number.isFinite(rememberedOption.entryIndex)) {
      this.startupAudioFallbackApplied = false;
      if (rememberedOption.selected) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioPreferenceApplied = true;
        return true;
      }
      this.startupAudioPreferenceApplying = true;
      try {
        this.applyAudioTrack(rememberedOption.entryIndex);
      } finally {
        this.startupAudioPreferenceApplying = false;
      }
      if (Environment.isWebOS() && this.pendingWebOsAudioSelection) {
        this.startupAudioPreferenceApplied = false;
        this.scheduleStartupAudioPreferenceRetry();
        return false;
      }
      if (this.findRememberedAudioOption()?.selected) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioPreferenceApplied = true;
        return true;
      }
      if (this.scheduleStartupAudioPreferenceRetry()) {
        return false;
      }
    } else if (this.rememberedAudioTrackPreference && isStillLoading) {
      const retryingTrackDiscovery = this.scheduleStartupAudioPreferenceRetry();
      if (retryingTrackDiscovery || this.isAudioPreferenceDiscoveryPending()) {
        return false;
      }
    }
    if (!preferredTargets.length) {
      this.clearStartupAudioPreferenceRetry();
      this.startupAudioFallbackApplied = false;
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    const selectedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
    if (
      selectedOption?.supported
      && !(isStillLoading && selectedOption.entry?.implicitAudioTrack)
      && preferredTargets.some((target) => this.matchesStartupAudioTarget(selectedOption, target))
    ) {
      this.clearStartupAudioPreferenceRetry();
      this.startupAudioFallbackApplied = false;
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    const matchedPreferredOption = this.findStartupPreferredAudioOption(preferredTargets);
    const preferredOption = isStillLoading && matchedPreferredOption?.entry?.implicitAudioTrack
      ? null
      : matchedPreferredOption;
    if (!preferredOption?.entry || !Number.isFinite(preferredOption.entryIndex)) {
      if (isStillLoading) {
        const retryingTrackDiscovery = this.scheduleStartupAudioPreferenceRetry();
        if (retryingTrackDiscovery || this.isAudioPreferenceDiscoveryPending()) {
          return false;
        }
      }
      return this.applyStartupAudioFallback();
    }

    this.startupAudioPreferenceApplying = true;
    this.startupAudioFallbackApplied = false;
    try {
      this.applyAudioTrack(preferredOption.entryIndex);
    } finally {
      this.startupAudioPreferenceApplying = false;
    }

    if (Environment.isWebOS() && this.pendingWebOsAudioSelection) {
      this.startupAudioPreferenceApplied = false;
      this.scheduleStartupAudioPreferenceRetry();
      return false;
    }

    const appliedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
    const applied = Boolean(
      appliedOption?.supported
      && preferredTargets.some((target) => this.matchesStartupAudioTarget(appliedOption, target))
    );
    this.startupAudioPreferenceApplied = applied;
    if (applied) {
      this.clearStartupAudioPreferenceRetry();
    } else {
      const retryingTizenAvPlay = this.scheduleStartupAudioPreferenceRetry();
      if (!retryingTizenAvPlay && !this.isAudioPreferenceDiscoveryPending()) {
        return this.applyStartupAudioFallback();
      }
    }
    return applied;
  },

  applyStartupAudioFallback() {
    this.clearStartupAudioPreferenceRetry();
    this.startupAudioFallbackApplied = true;
    const fallbackOption = selectStartupAudioFallbackOption(this.collectAudioOptionItems());
    if (!fallbackOption?.entry || !Number.isFinite(fallbackOption.entryIndex)) {
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    if (!fallbackOption.selected) {
      this.startupAudioPreferenceApplying = true;
      try {
        this.applyAudioTrack(fallbackOption.entryIndex, { automaticFallback: true });
      } finally {
        this.startupAudioPreferenceApplying = false;
      }
    }

    if (Environment.isWebOS() && this.pendingWebOsAudioSelection) {
      this.startupAudioPreferenceApplied = false;
      return false;
    }

    // The preferred language is unavailable or discovery hit its bounded limit.
    // If the runtime cannot expose/select tracks, its default first track remains
    // the fallback instead of keeping startup muted indefinitely.
    this.startupAudioPreferenceApplied = true;
    return true;
  },

  findStartupPreferredSubtitleOption(targets = this.getStartupPreferredSubtitleLanguageTargets(), mode = "language") {
    const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!normalizedTargets.length) {
      return null;
    }

    const options = this.collectSubtitleOptionItems().filter((entry) => entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    const matchTarget = (entry, target) => this.matchesStartupSubtitleTarget(entry, target);
    const findMatch = (target, { sourceType = null, forced = null } = {}) => options.find((entry) => {
      if (sourceType && entry.sourceType !== sourceType) {
        return false;
      }
      if (forced === true && !entry.isForced) {
        return false;
      }
      if (forced === false && entry.isForced) {
        return false;
      }
      return forced === true
        ? this.matchesStartupSubtitleTargetForForced(entry, target)
        : matchTarget(entry, target);
    });

    for (const target of normalizedTargets) {
      if (mode === "audio-forced") {
        const forcedInternal = findMatch(target, { sourceType: "internal", forced: true });
        if (forcedInternal) return forcedInternal;
        if (Environment.isWebOS()) {
          // Android can rely on ExoPlayer's forced flag, while webOS can omit
          // it for embedded tracks. Keep embedded tracks ahead of addons, but
          // only relax the regional match for an explicitly forced track or
          // when exactly one compatible embedded track exists.
          const compatibleForcedInternal = options.find((entry) => (
            entry.sourceType === "internal"
            && entry.isForced
            && matchTarget(entry, target)
          ));
          if (compatibleForcedInternal) return compatibleForcedInternal;

          const compatibleInternalTracks = options.filter((entry) => (
            entry.sourceType === "internal" && matchTarget(entry, target)
          ));
          if (compatibleInternalTracks.length === 1) return compatibleInternalTracks[0];
        }
        const forcedAddon = findMatch(target, { sourceType: "addon", forced: true });
        if (forcedAddon) return forcedAddon;
        continue;
      }

      const internalMatch = findMatch(target, { sourceType: "internal", forced: false });
      if (internalMatch) return internalMatch;
      const addonMatch = findMatch(target, { sourceType: "addon", forced: false });
      if (addonMatch) return addonMatch;
    }

    return null;
  },

  matchesStartupSubtitleTarget(entry, target) {
    if (!entry || !target) {
      return false;
    }
    if (target === "forced") {
      return Boolean(entry.isForced);
    }
    if (entry.languageKey === target) {
      return true;
    }
    const targetBase = String(target).split("-")[0];
    const entryBase = String(entry.languageKey || "").split("-")[0];
    if (targetBase && entryBase && targetBase === entryBase) {
      return true;
    }
    const normalizedTitle = normalizeComparableText(entry.title || "");
    const normalizedLabel = normalizeComparableText(entry.languageLabel || "");
    const targetLabel = normalizeComparableText(subtitleLanguageLabel(target));
    return Boolean(targetLabel && (normalizedTitle === targetLabel || normalizedLabel === targetLabel));
  },

  matchesStartupSubtitleTargetForForced(entry, target) {
    if (!entry || !target) {
      return false;
    }
    const normalizedTarget = normalizeSubtitleLanguageKey(target);
    const entryLanguage = normalizeSubtitleLanguageKey(entry.languageKey);
    if (entryLanguage === normalizedTarget) {
      return true;
    }
    if (normalizedTarget.includes("-")) {
      return false;
    }
    return this.matchesStartupSubtitleTarget(entry, normalizedTarget);
  },

  applyStartupSubtitlePreference() {
    if (this.startupSubtitlePreferenceApplied || this.startupSubtitlePreferenceApplying) {
      return false;
    }

    const configuredPreferenceMode = this.getStartupSubtitlePreferenceMode();
    const preferredSubtitleTargets = this.getStartupPreferredSubtitleLanguageTargets();
    if (
      configuredPreferenceMode !== "off"
      && !this.startupAudioPreferenceApplied
      && this.isAudioPreferenceDiscoveryPending()
    ) {
      return false;
    }
    const forcedTarget = configuredPreferenceMode === "audio-forced"
      ? this.getStartupForcedSubtitleLanguageTarget()
      : null;
    // Match Android TV: forced-only applies when the selected audio already
    // matches the subtitle language; foreign audio uses normal subtitles.
    const preferenceMode = configuredPreferenceMode === "audio-forced" && !forcedTarget
      ? "language"
      : configuredPreferenceMode;
    const preferredTargets = preferenceMode === "audio-forced"
      ? (forcedTarget ? [forcedTarget] : preferredSubtitleTargets)
      : preferredSubtitleTargets;
    const isStillLoading = this.isSubtitlePreferenceDiscoveryPending();

    if (this.shouldUseStartupForcedSubtitles() && !this.collectAudioOptionItems().some((entry) => entry.selected && entry.languageKey) && this.isAudioPreferenceDiscoveryPending()) {
      return false;
    }

    if (preferenceMode === "off") {
      if (this.selectedSubtitleTrackIndex >= 0 || this.selectedEmbeddedSubtitleTrackIndex >= 0 || this.selectedAddonSubtitleId || this.selectedManifestSubtitleTrackId) {
        const offEntry = this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || { trackIndex: -1 };
        this.startupSubtitlePreferenceApplying = true;
        try {
          this.applySubtitleEntry(offEntry);
        } finally {
          this.startupSubtitlePreferenceApplying = false;
        }
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      if (!isStillLoading) {
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      return false;
    }

    const selectedOption = this.collectSubtitleOptionItems().find((entry) => entry.selected && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    const preferredOption = this.findStartupPreferredSubtitleOption(preferredTargets, preferenceMode);
    if (selectedOption && preferredOption?.id === selectedOption.id) {
      this.startupSubtitlePreferenceApplied = true;
      return true;
    }

    if (!preferredOption?.entry) {
      if (!isStillLoading) {
        if (preferenceMode === "audio-forced" || selectedOption) {
          const offEntry = this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || { trackIndex: -1 };
          this.startupSubtitlePreferenceApplying = true;
          try {
            this.applySubtitleEntry(offEntry);
          } finally {
            this.startupSubtitlePreferenceApplying = false;
          }
        }
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      return false;
    }

    this.startupSubtitlePreferenceApplying = true;
    try {
      this.selectSubtitleOption(preferredOption, { focusOptions: false });
    } finally {
      this.startupSubtitlePreferenceApplying = false;
    }

    const appliedOption = this.collectSubtitleOptionItems().find((entry) => entry.selected && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    const applied = Boolean(appliedOption && preferredTargets.some((target) => this.matchesStartupSubtitleTarget(appliedOption, target)));
    this.startupSubtitlePreferenceApplied = applied;
    return applied;
  },

  getSubtitleStyleControls() {
    const style = this.subtitleStyleSettings || {};
    const htmlRendererActive = Boolean(
      this.htmlSubtitleSelectedId
      && (
        (Array.isArray(this.htmlSubtitleCues) && this.htmlSubtitleCues.length > 0)
        || PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml?.()
      )
    );
    const usingTizenAvPlay = Boolean(Environment.isTizen() && PlayerController.isUsingAvPlay?.());
    const rendererMode = htmlRendererActive
      ? "html"
      : (PlayerController.getAvPlaySubtitleOutputMode?.() || "none");
    const availability = resolveSubtitleStyleControlAvailability({
      isTizenAvPlay: usingTizenAvPlay,
      rendererMode,
      supportsExternalDelay: PlayerController.supportsAvPlayExternalSubtitleDelay?.() === true
    });
    const unavailableValue = t(
      "subtitle_style_unavailable_native",
      {},
      "Unavailable with native subtitles"
    );
    return [
      { id: "delay", label: t("subtitle_tab_delay", {}, "Delay"), value: formatSubtitleDelay(this.subtitleDelayMs) },
      { id: "fontSize", label: t("subtitle_style_font_size", {}, "Font Size"), value: `${normalizeSubtitleFontSize(style.fontSize)}%` },
      { id: "bold", label: t("subtitle_style_bold", {}, "Bold"), value: style.bold ? t("subtitle_style_on", {}, "On") : t("subtitle_style_off", {}, "Off") },
      { id: "textColor", label: t("subtitle_style_text_color", {}, "Text Color"), value: styleChipLabel(style.textColor || "#FFFFFF") },
      { id: "outlineEnabled", label: t("subtitle_style_outline", {}, "Outline"), value: style.outlineEnabled ? t("subtitle_style_on", {}, "On") : t("subtitle_style_off", {}, "Off") },
      { id: "outlineColor", label: t("subtitle_style_outline_color", {}, "Outline Color"), value: styleChipLabel(style.outlineColor || "#000000") },
      { id: "verticalOffset", label: t("subtitle_style_bottom_offset", {}, "Bottom Offset"), value: formatSubtitleVerticalOffset(style.verticalOffset) },
      { id: "reset", label: t("subtitle_style_defaults", {}, "Reset Defaults"), value: "" }
    ].map((item) => {
      const disabled = availability[item.id] === false;
      return {
        ...item,
        disabled,
        value: disabled ? unavailableValue : item.value
      };
    });
  },

  schedulePersistPlayerPresentationSettings(delayMs = 400) {
    clearTimeout(this.persistSettingsTimer);
    this.persistSettingsTimer = setTimeout(() => {
      this.persistSettingsTimer = null;
      this.persistPlayerPresentationSettings();
    }, delayMs);
  },

  flushPersistPlayerPresentationSettings() {
    if (this.persistSettingsTimer) {
      clearTimeout(this.persistSettingsTimer);
      this.persistSettingsTimer = null;
      this.persistPlayerPresentationSettings();
    }
  },

  renderSubtitleStyleControlInPlace(controlId) {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog || !this.subtitleDialogVisible) return false;
    const styleControls = this.getSubtitleStyleControls();
    const items = controlId === "reset" ? styleControls : styleControls.filter((c) => c.id === controlId);
    items.forEach((item) => {
      const subNode = dialog.querySelector(`button[data-style-id="${item.id}"]`)?.closest(".player-dialog-style-item")?.querySelector(".player-dialog-item-sub");
      if (subNode) subNode.textContent = item.value || "";
    });
    return items.length > 0;
  },

  adjustSubtitleStyleControl(controlId, delta = 0, { isRepeat = false } = {}) {
    const activeControl = this.getSubtitleStyleControls().find((item) => item.id === controlId);
    if (!activeControl || activeControl.disabled) {
      return false;
    }
    const style = { ...(this.subtitleStyleSettings || {}) };
    if (controlId === "delay") {
      this.subtitleDelayMs = clamp(
        Number(this.subtitleDelayMs || 0) + (delta * SUBTITLE_DELAY_STEP_MS),
        SUBTITLE_DELAY_MIN_MS,
        SUBTITLE_DELAY_MAX_MS
      );
    } else if (controlId === "fontSize") {
      style.fontSize = normalizeSubtitleFontSize(Number(style.fontSize || 120) + (delta * SUBTITLE_FONT_STEP));
    } else if (controlId === "bold" && delta !== 0) {
      style.bold = !style.bold;
    } else if (controlId === "textColor" && delta !== 0) {
      const currentIndex = Math.max(0, SUBTITLE_TEXT_COLORS.indexOf(String(style.textColor || "#FFFFFF").toUpperCase()));
      style.textColor = SUBTITLE_TEXT_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_TEXT_COLORS.length - 1)];
    } else if (controlId === "outlineEnabled" && delta !== 0) {
      style.outlineEnabled = !style.outlineEnabled;
    } else if (controlId === "outlineColor" && delta !== 0) {
      const currentIndex = Math.max(0, SUBTITLE_OUTLINE_COLORS.indexOf(String(style.outlineColor || "#000000").toUpperCase()));
      style.outlineColor = SUBTITLE_OUTLINE_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_OUTLINE_COLORS.length - 1)];
    } else if (controlId === "verticalOffset") {
      style.verticalOffset = normalizeSubtitleVerticalOffset(
        Number(style.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT)
          + (delta * SUBTITLE_VERTICAL_OFFSET_STEP)
      );
    } else if (controlId === "reset") {
      const defaults = PlayerSettingsStore.getDefaults().subtitleStyle;
      this.subtitleDelayMs = 0;
      this.subtitleStyleSettings = {
        ...style,
        fontSize: defaults.fontSize,
        textColor: defaults.textColor,
        bold: defaults.bold,
        outlineEnabled: defaults.outlineEnabled,
        outlineColor: defaults.outlineColor,
        verticalOffset: defaults.verticalOffset,
        verticalOffsetContract: defaults.verticalOffsetContract
      };
    }

    if (controlId !== "delay" && controlId !== "reset") {
      this.subtitleStyleSettings = style;
    }
    this.schedulePersistPlayerPresentationSettings();
    this.applySubtitlePresentationSettings({ refreshTrackRendering: !isRepeat });
    if (!this.renderSubtitleStyleControlInPlace(controlId)) {
      this.renderSubtitleDialog();
    }
    return true;
  },

  getSubtitleStyleControlDelta(side = this.subtitleStyleControlSide) {
    return String(side || "").toLowerCase() === "plus" ? 1 : -1;
  },
  openSubtitleDialog() {
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.subtitleDialogVisible = true;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    const languageRail = this.getSubtitleLanguageRailItems();
    const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
    this.subtitleLanguageRailIndex = Math.max(0, languageRail.findIndex((item) => item.key === selectedLanguageKey));
    this.syncSubtitleOptionIndexForFocusedLanguage();
    this.subtitleStyleRailIndex = 0;
    this.subtitleStyleControlSide = "minus";
    this.subtitleFocusedRail = selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY ? "language" : "options";
    this.subtitleDialogScrollMode = "start";
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeSubtitleDialog() {
    this.flushPersistPlayerPresentationSettings();
    this.subtitleDialogVisible = false;
    this.subtitleFocusedRail = "language";
    this.subtitleStyleControlSide = "minus";
    this.renderSubtitleDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  cycleSubtitleTab(delta) {
    const tabs = this.getSubtitleTabs();
    const index = tabs.findIndex((tab) => tab.id === this.subtitleDialogTab);
    const nextIndex = clamp(index + delta, 0, tabs.length - 1);
    this.subtitleDialogTab = tabs[nextIndex].id;
    const entries = this.getSubtitleEntries(this.subtitleDialogTab);
    const selected = entries.findIndex((entry) => entry.selected);
    this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
    this.renderSubtitleDialog();
  },

  getActiveSubtitleSelectionKey() {
    if (this.selectedAddonSubtitleId) {
      return `addon:${String(this.selectedAddonSubtitleId)}`;
    }
    if (this.selectedManifestSubtitleTrackId) {
      return `manifest:${String(this.selectedManifestSubtitleTrackId)}`;
    }
    if (Number(this.selectedEmbeddedSubtitleTrackIndex) >= 0) {
      return `embedded:${Number(this.selectedEmbeddedSubtitleTrackIndex)}`;
    }
    if (Number(this.selectedSubtitleTrackIndex) >= 0) {
      return `native:${Number(this.selectedSubtitleTrackIndex)}`;
    }
    return "off";
  },

  resetSubtitleDelayAfterSelectionChange(previousSelectionKey) {
    if (previousSelectionKey === this.getActiveSubtitleSelectionKey()) {
      return;
    }
    if (Number(this.subtitleDelayMs || 0) === 0) {
      return;
    }
    this.subtitleDelayMs = 0;
    this.applySubtitlePresentationSettings({ refreshTrackRendering: true });
  },

  applyNativeEmbeddedSubtitleTrack(embeddedTrack, targetTrackIndex) {
    const previousSubtitleSelectionKey = this.getActiveSubtitleSelectionKey();
    this.clearEmbeddedSubtitleCueRefreshTimers();
    if (this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }
    this.clearHtmlSubtitleOverlay();
    this.clearBitmapSubtitleOverlay({ dispose: true });

    let applied = false;
    if (Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay()) {
      const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
      applied = typeof PlayerController.setAvPlaySubtitleTrack === "function" && Number.isFinite(nativeTrackIndex)
        ? PlayerController.setAvPlaySubtitleTrack(nativeTrackIndex, { renderMode: this.subtitleRenderMode })
        : false;
    } else {
      const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
      const selectionTrackIndex = Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0
        ? nativeTrackIndex
        : targetTrackIndex;
      applied = typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function"
        ? PlayerController.setWebOsEmbeddedSubtitleTrack(selectionTrackIndex, targetTrackIndex)
        : false;
    }
    if (!applied) {
      return false;
    }

    this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
    this.invalidateTrackDialogCaches();
    this.scheduleEmbeddedSubtitleCueRefresh();
    if (this.refreshSubtitleCueStyles()) {
      this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
    }
    this.renderControlButtons();
    this.renderSubtitleDialog();
    return true;
  },

  applyBitmapEmbeddedSubtitleTrack(embeddedTrack, targetTrackIndex) {
    if (!embeddedTrack?.bitmapSubtitle || !canUseWebOsBitmapSubtitles()) {
      return false;
    }
    const sourceTrackId = Number(embeddedTrack.sourceTrackId);
    if (!Number.isFinite(sourceTrackId) || sourceTrackId <= 0) {
      return false;
    }
    const previousSubtitleSelectionKey = this.getActiveSubtitleSelectionKey();
    this.clearEmbeddedSubtitleCueRefreshTimers();
    if (this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }
    this.clearHtmlSubtitleOverlay();
    this.clearBitmapSubtitleOverlay({ dispose: true });
    PlayerController.setWebOsEmbeddedSubtitleTrack?.(-1);
    this.bitmapSubtitleTrack = embeddedTrack;
    this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
    this.invalidateTrackDialogCaches();
    this.renderControlButtons();
    this.renderSubtitleDialog();
    void this.loadBitmapSubtitleWindow(this.getPlaybackCurrentSeconds());
    return true;
  },

  applySubtitleEntry(entry) {
    if (!entry || entry.disabled) {
      return;
    }
    const previousSubtitleSelectionKey = this.getActiveSubtitleSelectionKey();

    const isEmbeddedEntry = Object.prototype.hasOwnProperty.call(entry, "embeddedSubtitleTrackIndex");
    if (!isEmbeddedEntry) {
      this.disableEmbeddedSubtitleSelection();
    }

    if (isEmbeddedEntry) {
      const targetTrackIndex = Number(entry.embeddedSubtitleTrackIndex);
      const embeddedTrack = this.getEmbeddedSubtitleTrackByEmbeddedIndex(targetTrackIndex);
      if (embeddedTrack?.bitmapSubtitle) {
        this.applyBitmapEmbeddedSubtitleTrack(embeddedTrack, targetTrackIndex);
      } else {
        this.applyNativeEmbeddedSubtitleTrack(embeddedTrack, targetTrackIndex);
      }
      return;
    }

    if (!entry.fallbackAddonSubtitle && this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }
    if (!entry.fallbackAddonSubtitle) {
      this.clearHtmlSubtitleOverlay();
    }

    if (Object.prototype.hasOwnProperty.call(entry, "avplaySubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.avplaySubtitleTrackIndex);
      const applied = typeof PlayerController.setAvPlaySubtitleTrack === "function"
        ? PlayerController.setAvPlaySubtitleTrack(targetTrackIndex, { renderMode: this.subtitleRenderMode })
        : false;
      if (!applied) {
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "dashSubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.dashSubtitleTrackIndex);
      const applied = typeof PlayerController.setDashTextTrack === "function"
        ? PlayerController.setDashTextTrack(targetTrackIndex)
        : false;
      if (!applied) {
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "hlsSubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.hlsSubtitleTrackIndex);
      const applied = typeof PlayerController.setHlsSubtitleTrack === "function"
        ? PlayerController.setHlsSubtitleTrack(targetTrackIndex)
        : false;
      if (!applied) {
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "manifestSubtitleTrackId")) {
      this.applyManifestTrackSelection({ subtitleTrackId: entry.manifestSubtitleTrackId });
      this.selectedSubtitleTrackIndex = -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (entry.fallbackAddonSubtitle) {
      const subtitle = this.subtitles[entry.subtitleIndex];
      const subtitleId = subtitle?.id || subtitle?.url || `subtitle-${entry.subtitleIndex}`;
      this.selectedAddonSubtitleId = subtitleId;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      void this.applyFallbackAddonSubtitle(entry.subtitleIndex);
      return;
    }

    if (this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }

    const textTracks = this.getTextTracks();
    const targetIndex = Number(entry.trackIndex);

    if (targetIndex < 0 && this.selectedManifestSubtitleTrackId) {
      this.applyManifestTrackSelection({ subtitleTrackId: null });
      this.selectedManifestSubtitleTrackId = null;
    } else if (this.selectedManifestSubtitleTrackId) {
      this.selectedManifestSubtitleTrackId = null;
    }

    const appliedByController = typeof PlayerController.setNativeTextTrack === "function"
      ? PlayerController.setNativeTextTrack(targetIndex)
      : false;
    if (appliedByController) {
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = targetIndex;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    textTracks.forEach((track, index) => {
      try {
        track.mode = index === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort: some WebOS builds expose readonly mode.
      }
    });

    if (targetIndex < 0) {
      textTracks.forEach((track) => {
        try {
          track.mode = "disabled";
        } catch (_) {
          // Best effort.
        }
      });
    }

    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = targetIndex;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
    this.invalidateTrackDialogCaches();
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    this.renderSubtitleDialog();
  },

  async applyFallbackAddonSubtitle(subtitleIndex) {
    const subtitle = this.subtitles[subtitleIndex];
    if (!subtitle?.url) {
      return;
    }
    const subtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;

    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if ((usingAvPlay && Environment.isTizen()) || Environment.isWebOS()) {
      try {
        if (await this.applyTvHtmlAddonSubtitle(subtitle, subtitleIndex)) {
          return;
        }
      } catch (error) {
        console.warn("HTML subtitle overlay failed", {
          subtitleUrl: subtitle.url,
          error: error?.message || String(error || "")
        });
      }
    }
    if (usingAvPlay) {
      let avPlaySubtitleUrl = subtitle.url;
      try {
        avPlaySubtitleUrl = Environment.isTizen()
          ? await this.resolveTizenAvPlaySubtitleUrl(subtitle.url) || subtitle.url
          : await this.resolveSubtitlePlaybackUrl(subtitle.url) || subtitle.url;
      } catch (_) {
        avPlaySubtitleUrl = subtitle.url;
      }
      const applied = typeof PlayerController.setAvPlayExternalSubtitle === "function"
        ? PlayerController.setAvPlayExternalSubtitle(avPlaySubtitleUrl)
        : false;
      const fallbackApplied = !applied && avPlaySubtitleUrl !== subtitle.url && typeof PlayerController.setAvPlayExternalSubtitle === "function"
        ? PlayerController.setAvPlayExternalSubtitle(subtitle.url)
        : false;
      if (applied || fallbackApplied) {
        this.clearHtmlSubtitleOverlay();
        this.selectedAddonSubtitleId = subtitleId;
        this.selectedSubtitleTrackIndex = -1;
        this.selectedEmbeddedSubtitleTrackIndex = -1;
        this.selectedManifestSubtitleTrackId = null;
        this.refreshSubtitleCueStyles();
        this.renderControlButtons();
        this.renderSubtitleDialog();
        return;
      }
    }

    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const currentTracks = this.getTextTracks();
    this.builtInSubtitleCount = this.externalTrackNodes.length
      ? Math.max(0, currentTracks.length - this.externalTrackNodes.length)
      : currentTracks.length;

    this.disableEmbeddedSubtitleSelection();
    this.clearMountedExternalSubtitleTracks();

    const resolvedSubtitleUrl = await this.resolveSubtitlePlaybackUrl(subtitle.url);
    if (!resolvedSubtitleUrl) {
      return;
    }

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.lang || subtitleLabel(subtitleIndex);
    track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
    track.src = resolvedSubtitleUrl;
    track.default = true;
    track.setAttribute("data-addon-subtitle-id", subtitleId);
    video.appendChild(track);
    this.externalTrackNodes.push(track);

    try {
      if (track.track) {
        track.track.mode = "hidden";
      }
    } catch (_) {
      // Best effort.
    }

    const activateTrack = () => this.activateMountedExternalSubtitleTrack(track);
    track.addEventListener("load", activateTrack, { once: true });
    track.addEventListener("error", () => {
      console.warn("Subtitle track failed to load", { subtitleUrl: subtitle.url });
    }, { once: true });

    const preferredIndex = this.builtInSubtitleCount;
    this.selectedAddonSubtitleId = subtitleId;
    this.selectedSubtitleTrackIndex = preferredIndex;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedManifestSubtitleTrackId = null;
    this.renderControlButtons();
    this.renderSubtitleDialog();

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    let activationAttempts = 0;
    const scheduleActivation = () => {
      this.subtitleSelectionTimer = setTimeout(() => {
        activationAttempts += 1;
        const activated = activateTrack();
        if (!activated && activationAttempts < 6) {
          scheduleActivation();
          return;
        }
        if (!activated) {
          this.selectedSubtitleTrackIndex = -1;
          this.refreshTrackDialogs();
          return;
        }
        this.refreshSubtitleCueStyles();
      }, activationAttempts === 0 ? 80 : 140);
    };
    scheduleActivation();
  },

  renderSubtitleDialog() {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
    if (!this.subtitleDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const languages = this.getSubtitleLanguageRailItems();
    this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex, 0, Math.max(0, languages.length - 1));
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex, 0, Math.max(0, options.length - 1));
    const styleItems = this.getSubtitleStyleControls();
    this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex, 0, Math.max(0, styleItems.length - 1));
    const subtitleLoadingVisible = Boolean(
      this.subtitleLoading ||
      this.manifestLoading ||
      this.trackDiscoveryInProgress ||
      (this.embeddedSubtitleLoading && this.canDiscoverEmbeddedSubtitleTracks())
    );
    const showOptionsRail = activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY || subtitleLoadingVisible;
    const focusedStyleSide = this.subtitleStyleControlSide === "plus" ? "plus" : "minus";
    const emptySubtitleOptionsMarkup = subtitleLoadingVisible
      ? `
        <div class="player-dialog-empty player-dialog-loading">
          ${renderLoadingIndicator()}
          <span>${escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks..."))}</span>
        </div>
      `
      : `<div class="player-dialog-empty">${escapeHtml(t("subtitle_none", {}, "No subtitles"))}</div>`;

    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("subtitle_dialog_title", {}, "Subtitles"))}</div>
      <div class="player-subtitle-overlay-grid">
        <div class="player-subtitle-rail player-subtitle-language-rail">
          ${languages.map((item, index) => `
          <div class="player-dialog-item focusable${item.selected ? " selected" : ""}${this.subtitleFocusedRail === "language" && index === this.subtitleLanguageRailIndex ? " focused" : ""}" data-subtitle-rail="language" data-subtitle-index="${index}">
              <div class="player-dialog-item-main">${escapeHtml(item.label)}${item.count > 0 ? `<span class="player-subtitle-language-count">${item.count}</span>` : ""}</div>
              <div class="player-dialog-item-sub">${item.key === SUBTITLE_LANGUAGE_OFF_KEY && subtitleLoadingVisible ? escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks...")) : ""}</div>
            </div>
          `).join("")}
        </div>
        <div class="player-subtitle-rail player-subtitle-options-rail${showOptionsRail ? "" : " hidden"}">
          ${options.length ? options.map((item, index) => `
            <div class="player-dialog-item focusable${item.selected ? " selected" : ""}${this.subtitleFocusedRail === "options" && index === this.subtitleOptionRailIndex ? " focused" : ""}" data-subtitle-rail="options" data-subtitle-index="${index}">
              <div class="player-subtitle-option-copy">
                <span class="player-subtitle-source-chip">${escapeHtml(item.sourceLabel || "")}</span>
                <div class="player-dialog-item-main">${escapeHtml(item.title || "")}</div>
                ${item.meta ? `<div class="player-dialog-item-sub">${escapeHtml(item.meta)}</div>` : ""}
              </div>
              <div class="player-dialog-item-check">${item.selected ? "&#10003;" : ""}</div>
            </div>
          `).join("") : emptySubtitleOptionsMarkup}
        </div>
        <div class="player-subtitle-rail player-subtitle-style-rail${showOptionsRail ? "" : " hidden"}">
          ${styleItems.map((item, index) => `
            <div class="player-dialog-item player-dialog-style-item${item.disabled ? " disabled" : ""}${this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex ? " focused" : ""}" data-subtitle-rail="style" data-subtitle-index="${index}" aria-disabled="${item.disabled ? "true" : "false"}">
              <button class="player-dialog-step player-dialog-step-minus${item.disabled ? "" : " focusable"}${!item.disabled && this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "minus" ? " focused" : ""}" type="button" data-subtitle-style-action="decrease" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} -`)}"${item.disabled ? " disabled" : ""}>&#8722;</button>
              <div class="player-dialog-item-center">
                <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
                <div class="player-dialog-item-sub">${escapeHtml(item.value || "")}</div>
              </div>
              <button class="player-dialog-step player-dialog-step-plus${item.disabled ? "" : " focusable"}${!item.disabled && this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "plus" ? " focused" : ""}" type="button" data-subtitle-style-action="increase" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} +`)}"${item.disabled ? " disabled" : ""}>&#43;</button>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    this.scrollSubtitleDialogIntoView();
    this.scheduleSubtitleDialogScrollIntoView();
  },

  handleSubtitleDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const styleItems = this.getSubtitleStyleControls();
    const styleItem = styleItems[this.subtitleStyleRailIndex];

    if (keyCode === 38) {
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex - 1, 0, Math.max(0, languages.length - 1));
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex - 1, 0, Math.max(0, options.length - 1));
      } else {
        this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex - 1, 0, Math.max(0, styleItems.length - 1));
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 40) {
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex + 1, 0, Math.max(0, languages.length - 1));
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex + 1, 0, Math.max(0, options.length - 1));
      } else {
        this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex + 1, 0, Math.max(0, styleItems.length - 1));
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 37) {
      if (this.subtitleFocusedRail === "style") {
        if (this.subtitleStyleControlSide === "plus") {
          this.subtitleStyleControlSide = "minus";
          this.renderSubtitleDialog();
          return true;
        } else {
          this.subtitleFocusedRail = options.length ? "options" : "language";
          this.subtitleStyleControlSide = "minus";
          this.renderSubtitleDialog();
          return true;
        }
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleFocusedRail = "language";
        this.renderSubtitleDialog();
        return true;
      }
      return true;
    }
    if (keyCode === 39) {
      if (this.subtitleFocusedRail === "language" && activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY && options.length) {
        this.subtitleFocusedRail = "options";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "options") {
        this.subtitleFocusedRail = "style";
        this.subtitleStyleControlSide = "minus";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "style") {
        if (this.subtitleStyleControlSide === "minus") {
          this.subtitleStyleControlSide = "plus";
          this.renderSubtitleDialog();
          return true;
        }
      }
      return true;
    }
    if (isSelectKeyCode(keyCode)) {
      if (this.subtitleFocusedRail === "language") {
        const language = languages[this.subtitleLanguageRailIndex];
        if (!language) {
          return true;
        }
        if (language.key === SUBTITLE_LANGUAGE_OFF_KEY) {
          this.applySubtitleEntry(this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || { trackIndex: -1 });
        } else {
          const selected = this.selectFirstSubtitleOptionForLanguage(language.key, { focusOptions: true });
          if (!selected) {
            const nextOptions = this.getSubtitleOptionsForLanguage(language.key);
            if (nextOptions.length) {
              this.subtitleFocusedRail = "options";
              this.subtitleOptionRailIndex = 0;
            }
          }
        }
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "options") {
        const option = options[this.subtitleOptionRailIndex];
        if (option?.entry) {
          this.applySubtitleEntry(option.entry);
        }
        return true;
      }
      if (styleItem && !styleItem.disabled) {
        this.adjustSubtitleStyleControl(
          styleItem.id,
          this.getSubtitleStyleControlDelta(this.subtitleStyleControlSide),
          { isRepeat: Boolean(event?.repeat) }
        );
      }
      return true;
    }
    if (this.subtitleFocusedRail === "style" && (keyCode === 10009 || keyCode === 461)) {
      this.subtitleFocusedRail = options.length ? "options" : "language";
      this.subtitleStyleControlSide = "minus";
      this.renderSubtitleDialog();
      return true;
    }
    return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
  },

  getMergedAudioTrackEntries(audioTracks = []) {
    const entries = [];
    const representedEmbeddedIndexes = new Set();

    audioTracks.forEach((track, index) => {
      const embeddedTrack = this.getEmbeddedAudioTrackByNativeIndex(index) || this.getEmbeddedAudioTrack(index);
      const embeddedTrackIndex = Number(embeddedTrack?.embeddedTrackIndex);
      if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
        representedEmbeddedIndexes.add(embeddedTrackIndex);
      }

      const mergedTrack = this.mergeEmbeddedAudioTrackMetadata(track, index);
      const support = getAudioTrackSupportState(mergedTrack);
      const display = formatAudioTrackDisplay(mergedTrack, index);
      entries.push({
        id: `audio-track-${index}`,
        label: display.label,
        secondary: display.secondary,
        selected: Number.isFinite(embeddedTrackIndex) && this.selectedEmbeddedAudioTrackIndex >= 0
          ? embeddedTrackIndex === this.selectedEmbeddedAudioTrackIndex
          : index === this.selectedAudioTrackIndex,
        supported: support.supported,
        unsupportedReason: support.unsupportedReason,
        audioTrackIndex: index,
        track: {
          ...mergedTrack,
          ...support
        }
      });
    });

    this.embeddedAudioTracks.forEach((track, index) => {
      const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
      const normalizedEmbeddedIndex = Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0
        ? embeddedTrackIndex
        : index;
      const nativeTrackIndex = Number(track?.nativeTrackIndex);
      const representedByNativeIndex = Number.isFinite(nativeTrackIndex)
        && nativeTrackIndex >= 0
        && nativeTrackIndex < audioTracks.length;
      const representedByOrder = index < audioTracks.length;

      if (
        representedEmbeddedIndexes.has(normalizedEmbeddedIndex)
        || representedByNativeIndex
        || representedByOrder
      ) {
        return;
      }

      const display = formatAudioTrackDisplay(track, index);
      const support = getAudioTrackSupportState(track);
      entries.push({
        id: `audio-embedded-${normalizedEmbeddedIndex}`,
        label: display.label,
        secondary: display.secondary,
        selected: normalizedEmbeddedIndex === this.selectedEmbeddedAudioTrackIndex,
        supported: support.supported,
        unsupportedReason: support.unsupportedReason,
        embeddedAudioTrackIndex: normalizedEmbeddedIndex,
        track: {
          ...track,
          ...support
        }
      });
    });

    return entries;
  },

  getAudioEntries() {
    const cachedEntries = this.trackDialogCache?.audioEntries;
    if (cachedEntries) {
      return cachedEntries;
    }
    const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function"
      ? PlayerController.getAvPlayAudioTracks()
      : [];
    let entries = [];
	    if (avplayAudioTracks.length) {
      const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function"
        ? PlayerController.getSelectedAvPlayAudioTrackIndex()
        : -1;
      entries = avplayAudioTracks.map((track, index) => {
        const mergedTrack = this.mergeAvPlayAudioTrackMetadata(track, index);
        const support = getAudioTrackSupportState(mergedTrack);
        const avplayTrackIndex = Number(track?.avplayTrackIndex);
        const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
        const display = formatAudioTrackDisplay(mergedTrack, index);
        return {
          id: `audio-avplay-${normalizedTrackIndex}`,
          label: display.label,
          secondary: display.secondary,
          selected: normalizedTrackIndex === selectedAvPlayAudioTrack
            || (selectedAvPlayAudioTrack < 0 && normalizedTrackIndex === this.selectedAudioTrackIndex),
          supported: support.supported,
          unsupportedReason: support.unsupportedReason,
          avplayAudioTrackIndex: normalizedTrackIndex,
          track: {
            ...mergedTrack,
            ...support
          }
        };
      });
    } else {
      const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function"
        ? PlayerController.getDashAudioTracks()
        : [];
      if (dashAudioTracks.length) {
      const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function"
        ? PlayerController.getSelectedDashAudioTrackIndex()
        : -1;
      entries = dashAudioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        const support = getAudioTrackSupportState(track);
        return {
          id: `audio-dash-${index}-${track?.id ?? ""}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === selectedDashAudioTrack || (selectedDashAudioTrack < 0 && index === this.selectedAudioTrackIndex),
          supported: support.supported,
          unsupportedReason: support.unsupportedReason,
          dashAudioTrackIndex: index,
          track: {
            ...track,
            ...support
          }
        };
      });
      } else {
        const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function"
          ? PlayerController.getHlsAudioTracks()
          : [];
        if (hlsAudioTracks.length) {
      const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function"
        ? PlayerController.getSelectedHlsAudioTrackIndex()
        : -1;
      entries = hlsAudioTracks.map((track, index) => {
        const mergedTrack = this.mergeHlsAudioTrackMetadata(track, index);
        const display = formatAudioTrackDisplay(mergedTrack, index);
        const support = getAudioTrackSupportState(mergedTrack);
        return {
          id: `audio-hls-${index}-${mergedTrack?.id ?? mergedTrack?.name ?? mergedTrack?.lang ?? ""}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === selectedHlsAudioTrack || (selectedHlsAudioTrack < 0 && index === this.selectedAudioTrackIndex),
          supported: support.supported,
          unsupportedReason: support.unsupportedReason,
          hlsAudioTrackIndex: index,
          track: {
            ...mergedTrack,
            ...support
          }
        };
      });
        } else {
          const audioTracks = this.getAudioTracks();
          if (audioTracks.length || this.embeddedAudioTracks.length) {
            entries = this.getMergedAudioTrackEntries(audioTracks);
          } else if (this.manifestAudioTracks.length) {
            entries = this.manifestAudioTracks.map((track, index) => {
              const display = formatAudioTrackDisplay(track, index);
              const support = getAudioTrackSupportState(track);
              return {
                id: `audio-manifest-${track.id}`,
                label: display.label,
                secondary: display.secondary,
                selected: this.selectedManifestAudioTrackId === track.id,
                supported: support.supported,
                unsupportedReason: support.unsupportedReason,
                manifestAudioTrackId: track.id,
                track: {
                  ...track,
                  ...support
                }
              };
            });
          } else {
            const implicitEntry = this.getImplicitAudioEntry();
            entries = implicitEntry ? [implicitEntry] : [];
          }
        }
      }
    }

    this.trackDialogCache.audioEntries = entries;
    return entries;
  },

  getImplicitAudioEntry() {
    const currentStream = this.getCurrentStreamCandidate()?.raw || this.getCurrentStreamCandidate() || {};
    const hasPlaybackContext = Boolean(this.activePlaybackUrl || currentStream?.url || currentStream?.externalUrl || currentStream?.ytId);
    if (!hasPlaybackContext) {
      return null;
    }

    const track = {
      language: currentStream?.language || currentStream?.lang || currentStream?.track_lang || currentStream?.extraInfo?.language || currentStream?.extraInfo?.track_lang || "",
      sampleMimeType: currentStream?.sampleMimeType || currentStream?.mimeType || currentStream?.sourceType || currentStream?.type || "",
      codec: currentStream?.codec || currentStream?.codecs || currentStream?.audioCodec || currentStream?.extraInfo?.audioCodec || "",
      codecs: currentStream?.codecs || currentStream?.codec || currentStream?.audioCodec || currentStream?.extraInfo?.codecs || "",
      audioCodec: currentStream?.audioCodec || currentStream?.extraInfo?.audioCodec || "",
      channelCount: currentStream?.channelCount || currentStream?.audioChannels || currentStream?.channels || currentStream?.extraInfo?.audioChannels || "",
      channels: currentStream?.channels || currentStream?.audioChannels || currentStream?.channelCount || currentStream?.extraInfo?.audioChannels || "",
      sampleRate: currentStream?.sampleRate || currentStream?.audioSampleRate || currentStream?.extraInfo?.audioSampleRate || 0
    };
    const display = formatAudioTrackDisplay(track, 0);
    const support = getAudioTrackSupportState(track);
    return {
      id: "audio-implicit-0",
      label: display.label,
      secondary: display.secondary,
      selected: true,
      supported: support.supported,
      unsupportedReason: support.unsupportedReason,
      implicitAudioTrack: true,
      audioTrackIndex: 0,
      track: {
        ...track,
        ...support
      }
    };
  },

  ensureSupportedAudioTrackSelected() {
    if (
      this.audioFallbackApplying
      || this.pendingWebOsAudioSelection
      || (Environment.isWebOS() && !this.startupTrackPreferenceReady)
      || (
        Environment.isWebOS()
        && this.startupAudioGateActive
        && this.isAudioPreferenceDiscoveryPending()
      )
    ) {
      return false;
    }
    const entries = this.getAudioEntries();
    const supportedEntryIndex = entries.findIndex((entry) => entry?.supported !== false);
    if (supportedEntryIndex < 0) {
      return false;
    }
    const supportedEntry = entries[supportedEntryIndex];
    if (supportedEntry?.id && supportedEntry.id === this.failedAutomaticAudioFallbackEntryId) {
      return false;
    }
    const selectedEntry = entries.find((entry) => entry?.selected);
    const shouldFallback = selectedEntry
      ? selectedEntry.supported === false
      : entries[0]?.supported === false;
    if (!shouldFallback) {
      return false;
    }

    this.audioFallbackApplying = true;
    try {
      this.applyAudioTrack(supportedEntryIndex, { automaticFallback: true });
    } finally {
      this.audioFallbackApplying = false;
    }
    return true;
  },

  isAudioEntryPending(entry = {}) {
    const pending = this.pendingWebOsAudioSelection;
    if (!pending) {
      return false;
    }
    if (pending.selectionKind === "embedded") {
      return Number(entry?.embeddedAudioTrackIndex) === Number(pending.selectedTrackIndex);
    }
    return Number(entry?.audioTrackIndex) === Number(pending.targetTrackIndex);
  },

  adjustAudioAmplification(delta = 0) {
    const nextDb = clamp(Number(this.audioAmplificationDb || 0) + Number(delta || 0), AUDIO_AMPLIFICATION_MIN_DB, AUDIO_AMPLIFICATION_MAX_DB);
    this.audioAmplificationDb = nextDb;
    this.persistPlayerPresentationSettings();
    this.applyAudioAmplification();
    this.renderAudioDialog();
  },

  togglePersistAudioAmplification() {
    this.persistAudioAmplification = !this.persistAudioAmplification;
    this.persistPlayerPresentationSettings();
    this.renderAudioDialog();
  },

  openAudioDialog() {
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.applyAudioAmplification();
    this.audioDialogVisible = true;
    this.subtitleDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    let entries = this.getAudioEntries();
    if (!entries.length) {
      this.ensureTrackDataWarmup();
      entries = this.getAudioEntries();
    }
    const selectedEntry = entries.findIndex((entry) => entry.selected);
    this.audioDialogIndex = Math.max(0, selectedEntry >= 0 ? selectedEntry : 0);
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeAudioDialog() {
    this.audioDialogVisible = false;
    this.renderAudioDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  applyAudioTrack(index, { automaticFallback = false, rememberSelection = false } = {}) {
    const entries = this.getAudioEntries();
    const selectedEntry = entries[index] || null;
    if (!selectedEntry) {
      return;
    }
    if (this.isAudioEntryPending(selectedEntry)) {
      return;
    }
    if (!automaticFallback) {
      this.failedAutomaticAudioFallbackEntryId = "";
    }
    if (rememberSelection) {
      this.startupAudioFallbackApplied = false;
    }
    if (selectedEntry.supported === false || isUnsupportedWebOsAudioTrack(selectedEntry.track)) {
      this.invalidateTrackDialogCaches();
      this.renderAudioDialog();
      return;
    }

    if (Number.isFinite(selectedEntry.avplayAudioTrackIndex)) {
      const applied = typeof PlayerController.setAvPlayAudioTrack === "function"
        ? PlayerController.setAvPlayAudioTrack(selectedEntry.avplayAudioTrackIndex)
        : false;
      if (applied) {
        this.selectedAudioTrackIndex = selectedEntry.avplayAudioTrackIndex;
        if (rememberSelection) {
          this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
        }
        this.invalidateTrackDialogCaches();
        this.refreshTrackDialogs();
      }
      return;
    }

    if (Number.isFinite(selectedEntry.dashAudioTrackIndex)) {
      const applied = typeof PlayerController.setDashAudioTrack === "function"
        ? PlayerController.setDashAudioTrack(selectedEntry.dashAudioTrackIndex)
        : false;
      if (applied) {
        this.selectedAudioTrackIndex = selectedEntry.dashAudioTrackIndex;
        if (rememberSelection) {
          this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
        }
        this.invalidateTrackDialogCaches();
        this.refreshTrackDialogs();
      }
      return;
    }

    if (Number.isFinite(selectedEntry.hlsAudioTrackIndex)) {
      const applied = typeof PlayerController.setHlsAudioTrack === "function"
        ? PlayerController.setHlsAudioTrack(selectedEntry.hlsAudioTrackIndex)
        : false;
      if (applied) {
        this.selectedAudioTrackIndex = selectedEntry.hlsAudioTrackIndex;
        if (rememberSelection) {
          this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
        }
        this.invalidateTrackDialogCaches();
        this.refreshTrackDialogs();
      }
      return;
    }

    if (selectedEntry.manifestAudioTrackId) {
      this.applyManifestTrackSelection({ audioTrackId: selectedEntry.manifestAudioTrackId });
      if (rememberSelection) {
        this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
      }
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

    if (selectedEntry.implicitAudioTrack) {
      this.selectedAudioTrackIndex = 0;
      this.selectedEmbeddedAudioTrackIndex = -1;
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

    if (Number.isFinite(selectedEntry.embeddedAudioTrackIndex)) {
      const embeddedTrack = this.getEmbeddedAudioTrackByEmbeddedIndex(selectedEntry.embeddedAudioTrackIndex);
      let applied = false;
      if (Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay()) {
        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
        applied = typeof PlayerController.setAvPlayAudioTrack === "function" && Number.isFinite(nativeTrackIndex)
          ? PlayerController.setAvPlayAudioTrack(nativeTrackIndex)
          : false;
      } else {
        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
        const targetTrackIndex = Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0
          ? nativeTrackIndex
          : selectedEntry.embeddedAudioTrackIndex;
        this.pendingWebOsAudioSelection = {
          selectionKind: "embedded",
          targetTrackIndex,
          selectedTrackIndex: selectedEntry.embeddedAudioTrackIndex,
          entryId: selectedEntry.id || "",
          automaticFallback: Boolean(automaticFallback),
          rememberSelection: Boolean(rememberSelection),
          trackPreference: this.getAudioTrackPreference(selectedEntry)
        };
        applied = typeof PlayerController.setWebOsEmbeddedAudioTrack === "function"
          ? PlayerController.setWebOsEmbeddedAudioTrack(targetTrackIndex, selectedEntry.embeddedAudioTrackIndex)
          : false;
      }
      if (applied) {
        if (Environment.isWebOS()) {
          this.invalidateTrackDialogCaches();
          this.renderAudioDialog();
          return;
        }
        this.selectedEmbeddedAudioTrackIndex = selectedEntry.embeddedAudioTrackIndex;
        this.selectedAudioTrackIndex = selectedEntry.embeddedAudioTrackIndex;
        if (rememberSelection) {
          this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
        }
        this.invalidateTrackDialogCaches();
        this.renderControlButtons();
        this.renderAudioDialog();
      } else if (Environment.isWebOS()) {
        this.pendingWebOsAudioSelection = null;
        this.invalidateTrackDialogCaches();
        this.renderAudioDialog();
      }
      return;
    }

    const audioTracks = this.getAudioTracks();
    const nativeTrackIndex = Number(selectedEntry.audioTrackIndex);
    if (!audioTracks.length || !Number.isFinite(nativeTrackIndex) || nativeTrackIndex < 0 || nativeTrackIndex >= audioTracks.length) {
      return;
    }

    if (Environment.isWebOS()) {
      this.pendingWebOsAudioSelection = {
        selectionKind: "native",
        targetTrackIndex: nativeTrackIndex,
        selectedTrackIndex: nativeTrackIndex,
        entryId: selectedEntry.id || "",
        automaticFallback: Boolean(automaticFallback),
        rememberSelection: Boolean(rememberSelection),
        trackPreference: this.getAudioTrackPreference(selectedEntry)
      };
    }
    const appliedByController = typeof PlayerController.setNativeAudioTrack === "function"
      ? PlayerController.setNativeAudioTrack(nativeTrackIndex)
      : false;
    if (appliedByController) {
      if (Environment.isWebOS()) {
        this.invalidateTrackDialogCaches();
        this.renderAudioDialog();
        return;
      }
      this.selectedAudioTrackIndex = nativeTrackIndex;
      this.selectedEmbeddedAudioTrackIndex = -1;
      if (rememberSelection) {
        this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
      }
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }
    if (Environment.isWebOS()) {
      this.pendingWebOsAudioSelection = null;
      this.invalidateTrackDialogCaches();
      this.renderAudioDialog();
      return;
    }

    audioTracks.forEach((track, trackIndex) => {
      const selected = trackIndex === nativeTrackIndex;
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
    this.selectedAudioTrackIndex = nativeTrackIndex;
    this.selectedEmbeddedAudioTrackIndex = -1;
    if (rememberSelection) {
      this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
    }
    this.invalidateTrackDialogCaches();
    this.renderControlButtons();
    this.renderAudioDialog();
  },

  renderAudioDialog() {
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.audioDialogVisible);
    if (!this.audioDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const entries = this.getAudioEntries();
    const hasSupportedEntries = entries.some((entry) => entry?.supported !== false);
    const audioControls = [
      {
        id: "amplification",
        title: t("audio_mix_label", {}, "Audio boost"),
        value: `${Math.round(Number(this.audioAmplificationDb || 0))} dB`,
        helper: this.audioAmplificationAvailable
          ? t("audio_mix_range", { min: AUDIO_AMPLIFICATION_MIN_DB, max: AUDIO_AMPLIFICATION_MAX_DB }, `Range ${AUDIO_AMPLIFICATION_MIN_DB}-${AUDIO_AMPLIFICATION_MAX_DB} dB`)
          : t("audio_mix_unavailable", {}, "Unavailable on this device"),
        enabled: Boolean(this.audioAmplificationAvailable),
        canDecrease: this.audioAmplificationAvailable && Number(this.audioAmplificationDb || 0) > AUDIO_AMPLIFICATION_MIN_DB,
        canIncrease: this.audioAmplificationAvailable && Number(this.audioAmplificationDb || 0) < AUDIO_AMPLIFICATION_MAX_DB
      },
      {
        id: "persist",
        title: this.persistAudioAmplification
          ? t("audio_mix_persist_on", {}, "Save audio boost: On")
          : t("audio_mix_persist_off", {}, "Save audio boost: Off"),
        value: "",
        helper: t("audio_mix_persist_help", {}, "Remember boost for future playback"),
        enabled: true,
        toggle: true
      }
    ];
    this.audioMixFocusIndex = clamp(this.audioMixFocusIndex, 0, audioControls.length - 1);
    if (!entries.length) {
      this.audioFocusedColumn = "controls";
      const loading = this.embeddedAudioLoading
        || (this.isCurrentSourceAdaptiveManifest() && (this.manifestLoading || this.trackDiscoveryInProgress));
      const emptyMessage = loading ? "Loading audio tracks..." : this.getUnavailableTrackMessage("audio");
      dialog.innerHTML = `
        <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
        <div class="player-dialog-empty${loading ? " player-dialog-loading" : ""}">
          ${loading ? renderLoadingIndicator() : ""}
          <span>${escapeHtml(emptyMessage)}</span>
        </div>
        <div class="player-audio-controls-list">
          ${audioControls.map((control, index) => this.renderAudioControlItem(control, index)).join("")}
        </div>
      `;
      return;
    }

    this.audioDialogIndex = clamp(this.audioDialogIndex, 0, entries.length - 1);
    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
      ${hasSupportedEntries ? "" : `<div class="player-audio-support-message">${escapeHtml(t("player.audio.noSupportedTracks", {}, "No supported audio tracks available"))}</div>`}
      <div class="player-audio-overlay-grid">
        <div class="player-dialog-list player-audio-track-list">
          ${entries.map((entry, index) => {
            const selected = entry.selected;
            const focused = this.audioFocusedColumn === "tracks" && index === this.audioDialogIndex;
            const disabled = entry.supported === false;
            const pending = this.isAudioEntryPending(entry);
            const label = disabled
              ? `${entry.label || ""} · ${t("player.audio.unsupported", {}, "Unsupported")}`
              : entry.label || "";
            const secondary = disabled
              ? [entry.secondary, t("player.audio.unsupportedCodec", {}, "Codec not supported by this device")].filter(Boolean).join(" · ")
              : entry.secondary || "";
            return `
              <div class="player-dialog-item focusable${selected ? " selected" : ""}${focused ? " focused" : ""}${disabled ? " disabled" : ""}${pending ? " pending" : ""}" data-audio-column="tracks" data-audio-index="${index}" aria-disabled="${disabled ? "true" : "false"}" aria-busy="${pending ? "true" : "false"}">
                <div class="player-dialog-item-main">${escapeHtml(label)}</div>
                <div class="player-dialog-item-sub">${escapeHtml(secondary)}</div>
                <div class="player-dialog-item-check">${pending ? "&#8230;" : (selected ? "&#10003;" : "")}</div>
              </div>
            `;
          }).join("")}
        </div>
        <div class="player-audio-controls-list">
          ${audioControls.map((control, index) => this.renderAudioControlItem(control, index)).join("")}
        </div>
      </div>
    `;
    this.scrollAudioDialogIntoView();
  },

  renderAudioControlItem(control, index) {
    const focused = this.audioFocusedColumn === "controls" && index === this.audioMixFocusIndex;
    if (control.toggle) {
      return `
        <div class="player-audio-control-card player-audio-toggle focusable${this.persistAudioAmplification ? " selected" : ""}${focused ? " focused" : ""}" data-audio-column="controls" data-audio-index="${index}">
          <div class="player-dialog-item-main">${escapeHtml(control.title)}</div>
          <div class="player-dialog-item-sub">${escapeHtml(control.helper || "")}</div>
        </div>
      `;
    }
    return `
      <div class="player-audio-control-card focusable${focused ? " focused" : ""}${!control.enabled ? " disabled" : ""}" data-audio-column="controls" data-audio-index="${index}">
        <div class="player-audio-control-title">${escapeHtml(control.title)}</div>
        <div class="player-audio-control-value">${escapeHtml(control.value)}</div>
        <div class="player-audio-step-row">
          <button class="player-dialog-step player-dialog-step-minus focusable${focused ? " focused" : ""}${!control.canDecrease ? " disabled" : ""}" type="button" tabindex="-1" data-audio-column="controls" data-audio-index="${index}" data-audio-step="-1">&#8722;</button>
          <button class="player-dialog-step player-dialog-step-plus focusable${focused ? " focused" : ""}${!control.canIncrease ? " disabled" : ""}" type="button" tabindex="-1" data-audio-column="controls" data-audio-index="${index}" data-audio-step="1">&#43;</button>
        </div>
        <div class="player-dialog-item-sub">${escapeHtml(control.helper || "")}</div>
      </div>
    `;
  },

  activateAudioControl(direction = 0) {
    if (this.audioMixFocusIndex === 0) {
      if (!this.audioAmplificationAvailable) {
        return;
      }
      this.adjustAudioAmplification(direction < 0 ? -1 : 1);
      return;
    }
    this.togglePersistAudioAmplification();
  },

  scrollAudioDialogIntoView() {
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog || !this.audioDialogVisible) {
      return;
    }
    const target = dialog.querySelector(".player-audio-track-list .player-dialog-item.focused");
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  },

  handleAudioDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const entries = this.getAudioEntries();
    const isNavigationKey = keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);

    if (keyCode === 37) {
      if (this.audioFocusedColumn === "controls") {
        if (this.audioMixFocusIndex === 0) {
          this.activateAudioControl(-1);
        } else if (entries.length) {
          this.audioFocusedColumn = "tracks";
          this.renderAudioDialog();
        }
      }
      return true;
    }

    if (keyCode === 39) {
      if (this.audioFocusedColumn === "tracks") {
        if (!entries.length) {
          this.audioFocusedColumn = "controls";
          this.renderAudioDialog();
          return true;
        }
        this.audioFocusedColumn = "controls";
        this.renderAudioDialog();
      } else if (this.audioMixFocusIndex === 0) {
        this.activateAudioControl(1);
      }
      return true;
    }

    if (keyCode === 38) {
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
      } else {
        this.audioMixFocusIndex = clamp(this.audioMixFocusIndex - 1, 0, 1);
      }
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 40) {
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
      } else {
        this.audioMixFocusIndex = clamp(this.audioMixFocusIndex + 1, 0, 1);
      }
      this.renderAudioDialog();
      return true;
    }

    if (isSelectKeyCode(keyCode)) {
      if (this.audioFocusedColumn === "tracks") {
        this.applyAudioTrack(this.audioDialogIndex, { rememberSelection: true });
      } else {
        this.activateAudioControl(this.audioMixFocusIndex === 0 ? 1 : 0);
      }
      return true;
    }

    return isNavigationKey;
  },

  openSpeedDialog() {
    const currentSpeed = this.getPlaybackSpeed();
    const speedOptions = this.getPlaybackSpeedOptions();
    this.speedDialogVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.speedDialogIndex = Math.max(0, speedOptions.findIndex((value) => value === currentSpeed));
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.renderSpeedDialog();
    this.updateModalBackdrop();
  },

  closeSpeedDialog() {
    this.speedDialogVisible = false;
    this.renderSpeedDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  applyPlaybackSpeed(speed = 1) {
    const applied = typeof PlayerController.setPlaybackRate === "function"
      ? PlayerController.setPlaybackRate(speed)
      : false;
    if (!applied) {
      return;
    }
    this.renderControlButtons();
    this.renderSpeedDialog();
  },

  renderSpeedDialog() {
    const dialog = this.uiRefs?.speedDialog;
    if (!dialog) {
      return;
    }
    dialog.classList.toggle("hidden", !this.speedDialogVisible);
    if (!this.speedDialogVisible) {
      dialog.innerHTML = "";
      return;
    }
    const currentSpeed = this.getPlaybackSpeed();
    const speedOptions = this.getPlaybackSpeedOptions();
    this.speedDialogIndex = clamp(this.speedDialogIndex, 0, speedOptions.length - 1);
    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("player_playback_speed", {}, "Playback speed"))}</div>
      <div class="player-dialog-list">
        ${speedOptions.map((speed, index) => `
          <div class="player-dialog-item focusable${speed === currentSpeed ? " selected" : ""}${index === this.speedDialogIndex ? " focused" : ""}" data-speed-index="${index}">
            <div class="player-dialog-item-main">${escapeHtml(`${speed}x`)}</div>
            <div class="player-dialog-item-sub">${escapeHtml(speed === 1 ? t("common.normal", {}, "Normal") : t("player_playback_speed", {}, "Playback speed"))}</div>
            <div class="player-dialog-item-check">${speed === currentSpeed ? "&#10003;" : ""}</div>
          </div>
        `).join("")}
      </div>
    `;
  },

  handleSpeedDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const speedOptions = this.getPlaybackSpeedOptions();
    if (keyCode === 38) {
      this.speedDialogIndex = clamp(this.speedDialogIndex - 1, 0, speedOptions.length - 1);
      this.renderSpeedDialog();
      return true;
    }
    if (keyCode === 40) {
      this.speedDialogIndex = clamp(this.speedDialogIndex + 1, 0, speedOptions.length - 1);
      this.renderSpeedDialog();
      return true;
    }
    if (isSelectKeyCode(keyCode)) {
      this.applyPlaybackSpeed(speedOptions[this.speedDialogIndex] || 1);
      return true;
    }
    return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
  },

  getSourceFilters() {
    const addons = [];
    this.getOrderedStreamCandidates().forEach((stream) => {
      const addonName = String(stream?.addonName || "").trim();
      if (addonName && !addons.includes(addonName)) {
        addons.push(addonName);
      }
    });
    return ["all", ...addons];
  },

  getOrderedStreamCandidates() {
    return (this.streamCandidates || [])
      .map((stream, index) => ({ stream, index }))
      .sort((left, right) => {
        const leftOrder = Number(left.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
        const rightOrder = Number(right.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.index - right.index;
      })
      .map((entry) => entry.stream);
  },

  getFilteredSources() {
    const ordered = this.getOrderedStreamCandidates();
    if (this.sourceFilter === "all") {
      return ordered;
    }
    return ordered.filter((stream) => stream.addonName === this.sourceFilter);
  },

  ensureSourcesFocus() {
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();

    if (!this.sourcesFocus || !["top", "filter", "list"].includes(this.sourcesFocus.zone)) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }

    if (this.sourcesFocus.zone === "top") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, 1);
      return;
    }

    if (this.sourcesFocus.zone === "filter") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, filters.length - 1));
      return;
    }

    this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, list.length - 1));
    if (!list.length && filters.length) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }
  },
  setSourceFilter(filter) {
    const available = this.getSourceFilters();
    if (!available.includes(filter)) {
      this.sourceFilter = "all";
      return;
    }
    this.sourceFilter = filter;
    this.sourcesFocus = { zone: "filter", index: clamp(available.indexOf(filter), 0, available.length - 1) };
  },

  openSourcesPanel({ forceReload = false } = {}) {
    this.cancelSeekPreview({ commit: false });
    this.sourcesPanelVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.moreActionsVisible = false;

    const filters = this.getSourceFilters();
    this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, Math.max(0, filters.length - 1)) };

    this.renderControlButtons();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
    void this.preloadPlayerSourceLogos();

    const sourceRequestKey = this.getSourceRequestKey();
    // The candidates passed into the player are only a snapshot of the addons
    // that had replied before playback started. Refresh once per video so a
    // slower addon can still join the in-player list without a manual reload.
    if (forceReload || !sourceRequestKey || sourceRequestKey !== this.completedSourceRequestKey) {
      this.reloadSources();
    }
  },

  getSourceRequestKey() {
    const type = normalizeItemType(this.params?.itemType || "movie");
    const videoId = String(this.params?.videoId || this.params?.itemId || "").trim();
    if (!videoId) {
      return "";
    }
    return [
      type,
      videoId,
      this.params?.season ?? "",
      this.params?.episode ?? ""
    ].join("|");
  },

  closeSourcesPanel() {
    this.sourcesPanelVisible = false;
    this.sourcesError = "";
    this.renderSourcesPanel();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async reloadSources() {
    if (this.sourcesLoading) {
      return;
    }

    const type = normalizeItemType(this.params?.itemType || "movie");
    const videoId = String(this.params?.videoId || this.params?.itemId || "");
    if (!videoId) {
      return;
    }
    const sourceRequestKey = this.getSourceRequestKey();

    const token = this.sourceLoadToken + 1;
    this.sourceLoadToken = token;
    this.sourcesLoading = true;
    this.sourcesError = "";
    this.renderSourcesPanel();

    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onChunk: (chunkResult) => {
        if (token !== this.sourceLoadToken) {
          return;
        }
        const chunkItems = flattenStreamGroups(chunkResult);
        if (!chunkItems.length) {
          return;
        }
        this.streamCandidates = mergeStreamItems(this.streamCandidates, chunkItems);
        this.renderSourcesPanel();
        void this.preloadPlayerSourceLogos(chunkItems);
      }
    };

    try {
      const result = await streamRepository.getStreamsFromAllAddons(type, videoId, options);
      if (token !== this.sourceLoadToken) {
        return;
      }
      const merged = mergeStreamItems(this.streamCandidates, flattenStreamGroups(result));
      if (merged.length) {
        this.streamCandidates = merged;
      }
    } catch (error) {
      if (token === this.sourceLoadToken) {
        this.sourcesError = this.formatPlaybackErrorForSources(
          t("panel_failed_load_streams", {}, "Failed to load streams"),
          {
            error,
            streamCandidate: this.getCurrentStreamCandidate(),
            playbackUrl: this.activePlaybackUrl,
            reason: "reload-sources"
          }
        );
      }
    } finally {
      if (token === this.sourceLoadToken) {
        this.completedSourceRequestKey = sourceRequestKey;
        this.sourcesLoading = false;
        this.renderSourcesPanel();
        void this.preloadPlayerSourceLogos();
      }
    }
  },

  async preloadPlayerSourceLogos(streams = this.getFilteredSources()) {
    if (
      StreamBadgeSettingsStore.snapshot().showAddonLogo !== true ||
      !Environment.isWebOS()
    ) {
      return;
    }
    try {
      await ensureWebOsImageProxyReady();
      await preloadAddonLogoImages(streams || []);
      this.scheduleSourceLogoRender();
    } catch (_) {
      // Logo cache warmup is best-effort; stream cards still render without logos.
    }
  },

  scheduleSourceLogoRender() {
    if (this.sourceLogoRenderTimer) {
      return;
    }
    this.sourceLogoRenderTimer = setTimeout(() => {
      this.sourceLogoRenderTimer = null;
      if (this.sourcesPanelVisible) {
        this.renderSourcesPanel();
      }
      if (this.episodePanelVisible) {
        this.renderEpisodePanel();
      }
    }, 120);
  },

  renderSourcesPanel() {
    const panel = this.uiRefs?.sourcesPanel;
    if (!panel) {
      return;
    }

    panel.classList.toggle("hidden", !this.sourcesPanelVisible);
    if (!this.sourcesPanelVisible) {
      panel.innerHTML = "";
      return;
    }

    const filters = this.getSourceFilters();
    const filtered = this.getFilteredSources();
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    const badgePlacement = resolvePlayerSourceBadgePlacement(badgeSettings);
    this.ensureSourcesFocus();

    panel.innerHTML = `
      <div class="player-sources-header">
        <div class="player-sources-title">${escapeHtml(t("sources_title", {}, "Sources"))}</div>
        <div class="player-sources-actions">
          <button class="player-sources-top-btn focusable${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 0 ? " focused" : ""}" data-top-action="reload" data-sources-zone="top" data-sources-index="0">${escapeHtml(t("sources_reload", {}, "Reload"))}</button>
          <button class="player-sources-top-btn focusable${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 1 ? " focused" : ""}" data-top-action="close" data-sources-zone="top" data-sources-index="1">${escapeHtml(t("sources_close", {}, "Close"))}</button>
        </div>
      </div>

      <div class="player-source-current-meta">
        ${escapeHtml(this.params?.season != null && this.params?.episode != null
          ? `S${this.params.season} E${this.params.episode}${this.params.playerSubtitle ? ` • ${this.params.playerSubtitle}` : ""}`
          : (this.params?.playerTitle || this.params?.itemId || ""))}
      </div>

      <div class="player-sources-filters">
        ${filters.map((filter, index) => {
          const selected = this.sourceFilter === filter;
          const focused = this.sourcesFocus.zone === "filter" && this.sourcesFocus.index === index;
          return `
            <div class="player-sources-filter focusable${selected ? " selected" : ""}${focused ? " focused" : ""}" data-sources-zone="filter" data-sources-index="${index}">
              ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
            </div>
          `;
        }).join("")}
      </div>

      <div class="player-sources-list">
        ${this.sourcesLoading ? `<div class="player-sources-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>` : ""}
        ${this.sourcesError ? `<div class="player-sources-empty">${escapeHtml(this.sourcesError)}</div>` : ""}
        ${!this.sourcesLoading && !filtered.length
          ? `<div class="player-sources-empty">${escapeHtml(t("sources_no_streams", {}, "No streams found"))}</div>`
          : filtered.map((stream, index) => {
            const focused = this.sourcesFocus.zone === "list" && this.sourcesFocus.index === index;
            const isCurrent = this.streamCandidates[this.currentStreamIndex]?.url === stream.url;
            const badges = renderPlayerSourceBadges(stream, badgeSettings);
            const topBadges = badgePlacement === "TOP" ? badges : "";
            const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
            const addonLogoUrl = showAddonLogo
              ? getPlayerSourceLogoDisplayUrl(stream.addonLogo, () => this.scheduleSourceLogoRender())
              : "";
            const playingMarker = isCurrent
              ? `<div class="player-source-playing">${escapeHtml(t("sources_playing", {}, "Playing"))}</div>`
              : "";
            const sourceTitle = `<div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>`;
            const mainTitle = !showAddonLogo && playingMarker
              ? `<div class="player-source-title-row">${sourceTitle}${playingMarker}</div>`
              : sourceTitle;
            const sourceSide = showAddonLogo
              ? `<div class="player-source-side">
                  ${addonLogoUrl ? `<img class="player-source-logo" src="${escapeAttribute(addonLogoUrl)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                  <div class="player-source-addon">${escapeHtml(stream.addonName || t("nav_addons", {}, "Addon"))}</div>
                  ${playingMarker}
                </div>`
              : "";
            return `
              <article class="player-source-card${sourceSide ? "" : " no-side"} focusable${focused ? " focused" : ""}${isCurrent ? " selected" : ""}" data-sources-zone="list" data-sources-index="${index}">
                <div class="player-source-main">
                  ${topBadges}
                  ${mainTitle}
                  <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                  ${bottomBadges}
                </div>
                ${sourceSide}
              </article>
            `;
          }).join("")}
      </div>
    `;

    const focusedCard = panel.querySelector(".player-source-card.focused");
    if (focusedCard) {
      focusedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },

  moveSourcesFocus(direction) {
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();
    const zone = this.sourcesFocus.zone;
    let index = Number(this.sourcesFocus.index || 0);

    if (zone === "top") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "top", index: clamp(index - 1, 0, 1) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "top", index: clamp(index + 1, 0, 1) };
        return;
      }
      if (direction === "down") {
        if (filters.length) {
          this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
        } else if (list.length) {
          this.sourcesFocus = { zone: "list", index: 0 };
        }
        return;
      }
      return;
    }

    if (zone === "filter") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "filter", index: clamp(index - 1, 0, Math.max(0, filters.length - 1)) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "filter", index: clamp(index + 1, 0, Math.max(0, filters.length - 1)) };
        return;
      }
      if (direction === "up") {
        this.sourcesFocus = { zone: "top", index: 0 };
        return;
      }
      if (direction === "down" && list.length) {
        this.sourcesFocus = { zone: "list", index: clamp(index, 0, list.length - 1) };
      }
      return;
    }

    if (zone === "list") {
      if (direction === "up") {
        if (index > 0) {
          this.sourcesFocus = { zone: "list", index: index - 1 };
        } else if (filters.length) {
          this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
        } else {
          this.sourcesFocus = { zone: "top", index: 0 };
        }
        return;
      }
      if (direction === "down") {
        this.sourcesFocus = { zone: "list", index: clamp(index + 1, 0, Math.max(0, list.length - 1)) };
      }
    }
  },

  async activateSourcesFocus() {
    const zone = this.sourcesFocus.zone;
    const index = Number(this.sourcesFocus.index || 0);
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();

    if (zone === "top") {
      if (index === 0) {
        await this.reloadSources();
        return;
      }
      this.closeSourcesPanel();
      return;
    }

    if (zone === "filter") {
      const selected = filters[clamp(index, 0, Math.max(0, filters.length - 1))] || "all";
      this.setSourceFilter(selected);
      this.renderSourcesPanel();
      return;
    }

    const selectedStream = list[clamp(index, 0, Math.max(0, list.length - 1))] || null;
    if (selectedStream) {
      await this.playStreamCandidate(selectedStream, { preservePlaybackState: true });
    }
  },

  async handleSourcesPanelKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 82) {
      await this.reloadSources();
      return true;
    }

    if (keyCode === 37) {
      this.moveSourcesFocus("left");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 39) {
      this.moveSourcesFocus("right");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 38) {
      this.moveSourcesFocus("up");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 40) {
      this.moveSourcesFocus("down");
      this.renderSourcesPanel();
      return true;
    }
    if (isSelectKeyCode(keyCode)) {
      await this.activateSourcesFocus();
      return true;
    }

    return false;
  },

  showAspectToast(label) {
    const toast = this.uiRefs?.aspectToast;
    if (!toast) {
      return;
    }

    toast.textContent = label;
    toast.classList.remove("hidden");

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
    }

    this.aspectToastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 1400);
  },

  applyAspectMode({ showToast = false } = {}) {
    const mode = this.aspectModes[this.aspectModeIndex] || this.aspectModes[0];
    const video = PlayerController.video;
    if (video) {
      const rect = this.calculateAspectRect(mode.objectFit, video);
      video.style.position = "fixed";
      if (Environment.isWebOS()) {
        // webOS suppresses its screensaver only when the video element itself
        // occupies the full viewport. Keep aspect handling inside that element.
        video.style.left = "0px";
        video.style.top = "0px";
        video.style.width = "100vw";
        video.style.height = "100vh";
        video.style.objectFit = mode.objectFit;
      } else {
        video.style.left = `${Math.round(rect.x)}px`;
        video.style.top = `${Math.round(rect.y)}px`;
        video.style.width = `${Math.round(rect.width)}px`;
        video.style.height = `${Math.round(rect.height)}px`;
        video.style.objectFit = "fill";
      }
      video.style.maxWidth = "none";
      video.style.maxHeight = "none";
      video.style.background = "black";
      if (typeof PlayerController.setAvPlayDisplayRect === "function") {
        PlayerController.setAvPlayDisplayRect(rect, rect.displayMethod);
      }
    }
    if (showToast) {
      this.showAspectToast(mode.label);
    }
    this.renderBitmapSubtitleAtCurrentTime({ force: true });
  },

  calculateAspectRect(objectFit = "contain", video = PlayerController.video) {
    const viewport = typeof PlayerController.getPlayerViewportSize === "function"
      ? PlayerController.getPlayerViewportSize()
      : {
        width: Math.max(1, Number(window.innerWidth || document.documentElement?.clientWidth || globalThis.screen?.width || 1920)),
        height: Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || globalThis.screen?.height || 1080))
      };
    const viewportWidth = viewport.width;
    const viewportHeight = viewport.height;
    if (objectFit === "fill") {
      return {
        x: 0,
        y: 0,
        width: viewportWidth,
        height: viewportHeight,
        displayMethod: "PLAYER_DISPLAY_MODE_FULL_SCREEN"
      };
    }

    const avplayDimensions = typeof PlayerController.getAvPlayVideoDimensions === "function"
      ? PlayerController.getAvPlayVideoDimensions()
      : null;
    const videoWidth = Number(video?.videoWidth || avplayDimensions?.width || 0);
    const videoHeight = Number(video?.videoHeight || avplayDimensions?.height || 0);
    const mediaRatio = videoWidth > 0 && videoHeight > 0
      ? videoWidth / videoHeight
      : 16 / 9;
    const viewportRatio = viewportWidth / viewportHeight;
    const shouldCover = objectFit === "cover";
    const widthLimited = shouldCover
      ? viewportRatio > mediaRatio
      : viewportRatio < mediaRatio;
    const width = widthLimited ? viewportWidth : viewportHeight * mediaRatio;
    const height = widthLimited ? viewportWidth / mediaRatio : viewportHeight;

    return {
      x: (viewportWidth - width) / 2,
      y: (viewportHeight - height) / 2,
      width,
      height,
      displayMethod: shouldCover ? "PLAYER_DISPLAY_MODE_FULL_SCREEN" : "PLAYER_DISPLAY_MODE_LETTER_BOX"
    };
  },

  cycleAspectMode() {
    this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
    this.applyAspectMode({ showToast: true });
  },
  renderParentalGuideOverlay() {
    const overlay = this.uiRefs?.parentalGuide;
    if (!overlay) {
      return;
    }

    const shouldRender = (this.parentalGuideVisible || this.parentalGuideExiting) && this.parentalWarnings.length;
    overlay.classList.toggle("hidden", !shouldRender);
    overlay.classList.toggle("is-exiting", Boolean(this.parentalGuideExiting));
    if (!shouldRender) {
      overlay.innerHTML = "";
      overlay.style.removeProperty("animation-delay");
      overlay.style.removeProperty("--parental-item-count");
      overlay.style.removeProperty("--parental-line-height");
      overlay.style.removeProperty("--parental-line-exit-delay");
      overlay.style.removeProperty("--parental-container-exit-delay");
      this.stopParentalGuideLineAnimation();
      return;
    }

    const total = this.parentalWarnings.length;
    const firstItemDelay = PARENTAL_GUIDE_CONTAINER_IN_MS + PARENTAL_GUIDE_LINE_IN_MS + PARENTAL_GUIDE_ITEM_STAGGER_MS;
    const lineExitDelay = Math.max(0, total * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS)) + PARENTAL_GUIDE_LINE_OUT_DELAY_MS;
    const containerExitDelay = lineExitDelay + PARENTAL_GUIDE_LINE_OUT_MS + PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS;
    const rowHeight = PARENTAL_GUIDE_ROW_HEIGHT;
    const rowGap = PARENTAL_GUIDE_ROW_GAP;
    const lineHeight = (rowHeight * total) + (rowGap * Math.max(0, total - 1));
    const currentLineHeight = clamp(Number(this.parentalGuideLineProgress || 0), 0, lineHeight);
    const rootStyle = getComputedStyle(document.documentElement);
    const parentalAccent = rootStyle.getPropertyValue("--secondary-color").trim() || "#f5f5f5";
    overlay.style.animationDelay = this.parentalGuideExiting ? `${containerExitDelay}ms` : "0ms";
    overlay.style.setProperty("--parental-row-height", `${rowHeight}px`);
    overlay.style.setProperty("--parental-row-gap", `${rowGap}px`);
    overlay.style.setProperty("--parental-item-count", String(total));
    overlay.style.setProperty("--parental-line-height", `${lineHeight}px`);
    overlay.style.setProperty("--parental-line-exit-delay", `${lineExitDelay}ms`);
    overlay.style.setProperty("--parental-container-exit-delay", `${containerExitDelay}ms`);
    overlay.style.setProperty("--parental-accent", parentalAccent);
    overlay.innerHTML = `
      <div class="player-parental-line">
        <div class="player-parental-line-fill"></div>
      </div>
      <div class="player-parental-list">
        ${this.parentalWarnings.map((warning, index) => {
          const enterDelay = firstItemDelay + (index * (PARENTAL_GUIDE_ITEM_STAGGER_MS + PARENTAL_GUIDE_ITEM_IN_MS));
          const exitDelay = PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + ((total - index - 1) * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS));
          const activeDelay = this.parentalGuideExiting ? exitDelay : enterDelay;
          return `
          <div class="player-parental-item" style="animation-delay:${activeDelay}ms;--parental-enter-delay:${enterDelay}ms;--parental-exit-delay:${exitDelay}ms">
            <span class="player-parental-label">${escapeHtml(warning.label)}</span>
            <span class="player-parental-separator"> · </span>
            <span class="player-parental-severity">${escapeHtml(warning.severity)}</span>
          </div>
        `;
        }).join("")}
      </div>
    `;

    const line = overlay.querySelector(".player-parental-line");
    const lineFill = overlay.querySelector(".player-parental-line-fill");
    if (line) {
      line.style.height = `${currentLineHeight.toFixed(2)}px`;
    }
    if (lineFill) {
      lineFill.style.background = parentalAccent;
    }
  },

  stopParentalGuideLineAnimation({ reset = true } = {}) {
    if (this.parentalGuideLineEnterTimer) {
      clearTimeout(this.parentalGuideLineEnterTimer);
      this.parentalGuideLineEnterTimer = null;
    }
    if (this.parentalGuideLineExitTimer) {
      clearTimeout(this.parentalGuideLineExitTimer);
      this.parentalGuideLineExitTimer = null;
    }
    if (this.parentalGuideLineAnimationFrame != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.parentalGuideLineAnimationFrame);
    }
    this.parentalGuideLineAnimationFrame = null;
    if (reset) {
      this.parentalGuideLineProgress = 0;
      const line = this.uiRefs?.parentalGuide?.querySelector(".player-parental-line");
      if (line) {
        line.style.height = "0px";
      }
    }
  },

  animateParentalGuideLine(targetProgress, durationMs = 1) {
    const line = this.uiRefs?.parentalGuide?.querySelector(".player-parental-line");
    if (!line) {
      return;
    }

    const target = Math.max(0, Number(targetProgress || 0));
    const from = Math.max(0, Number(this.parentalGuideLineProgress || 0));
    if (typeof requestAnimationFrame !== "function") {
      this.parentalGuideLineProgress = target;
      line.style.height = `${Math.max(0, target).toFixed(2)}px`;
      return;
    }

    if (this.parentalGuideLineAnimationFrame != null) {
      cancelAnimationFrame(this.parentalGuideLineAnimationFrame);
      this.parentalGuideLineAnimationFrame = null;
    }

    const startedAt = performance?.now?.() ?? Date.now();
    const tick = (timestamp) => {
      const elapsed = Math.max(0, Number(timestamp || Date.now()) - startedAt);
      const progress = clamp(elapsed / Math.max(1, Number(durationMs || 1)), 0, 1);
      this.parentalGuideLineProgress = from + ((target - from) * progress);
      line.style.height = `${Math.max(0, this.parentalGuideLineProgress).toFixed(2)}px`;
      if (progress < 1) {
        this.parentalGuideLineAnimationFrame = requestAnimationFrame(tick);
        return;
      }
      this.parentalGuideLineAnimationFrame = null;
    };

    this.parentalGuideLineAnimationFrame = requestAnimationFrame(tick);
  },

  scheduleParentalGuideLineAnimation(targetProgress, delayMs, durationMs) {
    const start = () => {
      this.parentalGuideLineEnterTimer = null;
      this.animateParentalGuideLine(targetProgress, durationMs);
    };
    if (delayMs > 0) {
      this.parentalGuideLineEnterTimer = setTimeout(start, delayMs);
      return;
    }
    start();
  },

  showParentalGuideOverlay() {
    if (!this.parentalWarnings.length) {
      return;
    }

    this.parentalGuideVisible = true;
    this.parentalGuideExiting = false;
    this.parentalGuideShown = true;
    this.renderParentalGuideOverlay();
    this.stopParentalGuideLineAnimation({ reset: true });
    const lineHeight = (PARENTAL_GUIDE_ROW_HEIGHT * this.parentalWarnings.length)
      + (PARENTAL_GUIDE_ROW_GAP * Math.max(0, this.parentalWarnings.length - 1));
    this.scheduleParentalGuideLineAnimation(lineHeight, PARENTAL_GUIDE_CONTAINER_IN_MS, PARENTAL_GUIDE_LINE_IN_MS);

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
    }
    if (this.parentalGuideExitTimer) {
      clearTimeout(this.parentalGuideExitTimer);
      this.parentalGuideExitTimer = null;
    }

    const enterDuration = PARENTAL_GUIDE_CONTAINER_IN_MS
      + PARENTAL_GUIDE_LINE_IN_MS
      + (this.parentalWarnings.length * (PARENTAL_GUIDE_ITEM_STAGGER_MS + PARENTAL_GUIDE_ITEM_IN_MS));
    this.parentalGuideTimer = setTimeout(() => {
      this.hideParentalGuideOverlay();
    }, enterDuration + PARENTAL_GUIDE_HOLD_MS);
  },

  hideParentalGuideOverlay() {
    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
      this.parentalGuideTimer = null;
    }
    if (!this.parentalGuideVisible || !this.parentalWarnings.length) {
      this.parentalGuideVisible = false;
      this.parentalGuideExiting = false;
      this.renderParentalGuideOverlay();
      return;
    }

    this.parentalGuideVisible = false;
    this.parentalGuideExiting = true;
    this.renderParentalGuideOverlay();
    this.stopParentalGuideLineAnimation({ reset: false });

    if (this.parentalGuideExitTimer) {
      clearTimeout(this.parentalGuideExitTimer);
    }
    const total = this.parentalWarnings.length;
    const lineExitDelay = Math.max(0, total * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS)) + PARENTAL_GUIDE_LINE_OUT_DELAY_MS;
    const containerExitDelay = lineExitDelay + PARENTAL_GUIDE_LINE_OUT_MS + PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS;
    this.parentalGuideLineExitTimer = setTimeout(() => {
      this.parentalGuideLineExitTimer = null;
      this.animateParentalGuideLine(0, PARENTAL_GUIDE_LINE_OUT_MS);
    }, lineExitDelay);
    this.parentalGuideExitTimer = setTimeout(() => {
      this.parentalGuideExiting = false;
      this.parentalGuideExitTimer = null;
      this.stopParentalGuideLineAnimation();
      this.renderParentalGuideOverlay();
    }, containerExitDelay + PARENTAL_GUIDE_CONTAINER_OUT_MS);
  },

  toggleEpisodePanel() {
    if (!this.episodes.length) {
      return;
    }
    if (this.episodePanelVisible) {
      this.hideEpisodePanel();
      return;
    }
    this.episodePanelVisible = true;
    this.episodePanelMode = "episodes";
    this.episodePanelStreamsError = "";
    this.episodePanelStreamsLoading = false;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.syncEpisodePanelSeasonToIndex();
    this.episodePanelFocusZone = "episodes";
    this.updateModalBackdrop();
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.renderEpisodePanel();
  },

  getEpisodePanelSeasons() {
    const seen = new Set();
    const seasons = [];
    this.episodes.forEach((episode) => {
      const season = Number(episode?.season);
      if (!Number.isFinite(season) || seen.has(season)) {
        return;
      }
      seen.add(season);
      seasons.push(season);
    });
    const regular = seasons.filter((season) => season > 0).sort((left, right) => left - right);
    const specials = seasons.filter((season) => season === 0);
    return [...regular, ...specials];
  },

  getEpisodePanelSeasonLabel(season) {
    if (!Number.isFinite(Number(season))) {
      return t("episodes_panel_title", {}, "Episodes");
    }
    return Number(season) === 0
      ? t("episodes_specials", {}, "Specials")
      : t("episodes_season", [Number(season)], "Season %1$d");
  },

  syncEpisodePanelSeasonToIndex() {
    const seasons = this.getEpisodePanelSeasons();
    if (seasons.length <= 1) {
      this.episodePanelSeason = null;
      this.episodePanelSeasonIndex = 0;
      return;
    }
    const selectedEpisode = this.episodes[this.episodePanelIndex] || null;
    const selectedSeason = Number(selectedEpisode?.season);
    const fallbackSeason = Number(this.params?.season);
    const resolvedSeason = Number.isFinite(selectedSeason)
      ? selectedSeason
      : (Number.isFinite(fallbackSeason) ? fallbackSeason : seasons[0]);
    const seasonIndex = Math.max(0, seasons.indexOf(resolvedSeason));
    this.episodePanelSeasonIndex = seasonIndex;
    this.episodePanelSeason = seasons[seasonIndex] ?? seasons[0];
  },

  getEpisodePanelEntries() {
    const seasons = this.getEpisodePanelSeasons();
    const activeSeason = seasons.length > 1 ? Number(this.episodePanelSeason) : null;
    return this.episodes
      .map((episode, index) => ({ episode, index }))
      .filter(({ episode }) => (
        activeSeason == null
        || Number(episode?.season) === activeSeason
      ));
  },

  moveEpisodePanel(delta) {
    if (!this.episodePanelVisible || !this.episodes.length) {
      return;
    }
    const entries = this.getEpisodePanelEntries();
    if (!entries.length) {
      return;
    }
    const currentPosition = Math.max(0, entries.findIndex((entry) => entry.index === this.episodePanelIndex));
    const nextPosition = clamp(currentPosition + delta, 0, entries.length - 1);
    this.episodePanelIndex = entries[nextPosition]?.index ?? this.episodePanelIndex;
    this.episodePanelFocusZone = "episodes";
    this.renderEpisodePanel();
  },

  moveEpisodePanelSeason(delta) {
    const seasons = this.getEpisodePanelSeasons();
    if (seasons.length <= 1) {
      return;
    }
    const currentIndex = seasons.indexOf(Number(this.episodePanelSeason));
    const nextIndex = clamp((currentIndex >= 0 ? currentIndex : this.episodePanelSeasonIndex) + delta, 0, seasons.length - 1);
    this.episodePanelSeasonIndex = nextIndex;
    this.episodePanelSeason = seasons[nextIndex];
    const firstEntry = this.getEpisodePanelEntries()[0];
    if (firstEntry) {
      this.episodePanelIndex = firstEntry.index;
    }
    this.episodePanelFocusZone = "seasons";
    this.renderEpisodePanel();
  },

  getEpisodePanelStreamFilters() {
    const addons = [];
    (this.episodePanelStreams || []).forEach((stream) => {
      const addonName = String(stream?.addonName || "").trim();
      if (addonName && !addons.includes(addonName)) {
        addons.push(addonName);
      }
    });
    return ["all", ...addons];
  },

  getFilteredEpisodePanelStreams() {
    const streams = Array.isArray(this.episodePanelStreams) ? this.episodePanelStreams : [];
    if (this.episodePanelStreamFilter === "all") {
      return streams;
    }
    return streams.filter(
      (stream) => String(stream?.addonName || "") === this.episodePanelStreamFilter
    );
  },

  closeEpisodeStreamsView() {
    this.episodePanelMode = "episodes";
    this.episodePanelStreamsLoading = false;
    this.episodePanelStreamsError = "";
    this.episodePanelFocusZone = "episodes";
    this.renderEpisodePanel();
  },

  async openEpisodeStreamsView({ forceReload = true } = {}) {
    const selected = this.episodes[this.episodePanelIndex] || null;
    if (!selected?.id) {
      return;
    }
    this.episodePanelMode = "streams";
    this.episodePanelStreamVideoId = String(selected.id);
    this.episodePanelStreamFilter = "all";
    this.episodePanelStreamFocus = { zone: "actions", index: 0 };
    this.episodePanelStreamsError = "";
    this.episodePanelStreamsLoading = true;
    this.renderEpisodePanel();

    const itemType = this.params?.itemType || "series";
    const cacheKey = this.getStreamCacheKey(selected.id, normalizeItemType(itemType));
    if (forceReload) {
      this.streamCandidatesByVideoId?.delete?.(cacheKey);
    }
    const token = Number(this.episodePanelStreamLoadToken || 0) + 1;
    this.episodePanelStreamLoadToken = token;
    try {
      const streams = await this.getPlayableStreamsForVideo(selected.id, itemType, {
        season: selected.season,
        episode: selected.episode
      });
      if (
        token !== this.episodePanelStreamLoadToken ||
        !this.episodePanelVisible ||
        this.episodePanelMode !== "streams" ||
        String(this.episodePanelStreamVideoId || "") !== String(selected.id)
      ) {
        return;
      }
      this.episodePanelStreams = streams;
      this.episodePanelStreamsLoading = false;
      this.episodePanelStreamFocus = streams.length
        ? { zone: "streams", index: 0 }
        : { zone: "actions", index: 0 };
    } catch (_error) {
      if (token !== this.episodePanelStreamLoadToken) {
        return;
      }
      this.episodePanelStreams = [];
      this.episodePanelStreamsLoading = false;
      this.episodePanelStreamsError = t(
        "panel_failed_load_streams",
        {},
        "Failed to load streams"
      );
      this.episodePanelStreamFocus = { zone: "actions", index: 0 };
    }
    this.renderEpisodePanel();
  },

  moveEpisodeStreamFocus(direction) {
    const filters = this.getEpisodePanelStreamFilters();
    const streams = this.getFilteredEpisodePanelStreams();
    const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    let index = Number(focus.index || 0);

    if (focus.zone === "close") {
      if (direction === "down") {
        this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      }
      return;
    }
    if (focus.zone === "actions") {
      if (direction === "left" || direction === "right") {
        this.episodePanelStreamFocus = {
          zone: "actions",
          index: clamp(index + (direction === "right" ? 1 : -1), 0, 1)
        };
      } else if (direction === "up") {
        this.episodePanelStreamFocus = { zone: "close", index: 0 };
      } else if (direction === "down") {
        this.episodePanelStreamFocus = filters.length
          ? { zone: "filters", index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, filters.length - 1) }
          : { zone: "streams", index: 0 };
      }
      return;
    }
    if (focus.zone === "filters") {
      if (direction === "left" || direction === "right") {
        this.episodePanelStreamFocus = {
          zone: "filters",
          index: clamp(index + (direction === "right" ? 1 : -1), 0, Math.max(0, filters.length - 1))
        };
      } else if (direction === "up") {
        this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      } else if (direction === "down" && streams.length) {
        this.episodePanelStreamFocus = { zone: "streams", index: 0 };
      }
      return;
    }
    if (focus.zone === "streams") {
      if (direction === "up") {
        this.episodePanelStreamFocus =
          index > 0
            ? { zone: "streams", index: index - 1 }
            : { zone: "filters", index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, Math.max(0, filters.length - 1)) };
      } else if (direction === "down") {
        this.episodePanelStreamFocus = {
          zone: "streams",
          index: clamp(index + 1, 0, Math.max(0, streams.length - 1))
        };
      }
    }
  },

  async activateEpisodeStreamFocus() {
    const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    if (focus.zone === "close") {
      this.hideEpisodePanel();
      return;
    }
    if (focus.zone === "actions") {
      if (Number(focus.index || 0) === 0) {
        this.closeEpisodeStreamsView();
      } else {
        await this.openEpisodeStreamsView({ forceReload: true });
      }
      return;
    }
    if (focus.zone === "filters") {
      const filters = this.getEpisodePanelStreamFilters();
      this.episodePanelStreamFilter =
        filters[clamp(Number(focus.index || 0), 0, Math.max(0, filters.length - 1))] ||
        "all";
      this.episodePanelStreamFocus = {
        zone: "filters",
        index: Math.max(0, filters.indexOf(this.episodePanelStreamFilter))
      };
      this.renderEpisodePanel();
      return;
    }
    const streams = this.getFilteredEpisodePanelStreams();
    const selectedStream =
      streams[clamp(Number(focus.index || 0), 0, Math.max(0, streams.length - 1))] ||
      null;
    if (selectedStream) {
      await this.playEpisodeFromPanel(selectedStream);
    }
  },

  handleEpisodePanelKey(event) {
    if (!this.episodePanelVisible) {
      return false;
    }
    const keyCode = Number(event?.keyCode || event?.which || event?.originalKeyCode || 0);
    const isNavigationKey = keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode);
    if (!isNavigationKey) {
      return false;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    if (this.episodePanelMode === "streams") {
      if (keyCode === 37) {
        this.moveEpisodeStreamFocus("left");
      } else if (keyCode === 38) {
        this.moveEpisodeStreamFocus("up");
      } else if (keyCode === 39) {
        this.moveEpisodeStreamFocus("right");
      } else if (keyCode === 40) {
        this.moveEpisodeStreamFocus("down");
      } else if (isSelectKeyCode(keyCode)) {
        void this.activateEpisodeStreamFocus();
        return true;
      }
      this.renderEpisodePanel();
      return true;
    }

    const seasons = this.getEpisodePanelSeasons();
    const hasSeasonTabs = seasons.length > 1;
    const entries = this.getEpisodePanelEntries();
    const currentPosition = Math.max(0, entries.findIndex((entry) => entry.index === this.episodePanelIndex));

    if (keyCode === 38) {
      if (this.episodePanelFocusZone === "episodes") {
        if (currentPosition > 0) {
          this.moveEpisodePanel(-1);
        } else {
          this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "close";
          this.renderEpisodePanel();
        }
        return true;
      }
      if (this.episodePanelFocusZone === "seasons") {
        this.episodePanelFocusZone = "close";
        this.renderEpisodePanel();
        return true;
      }
      return true;
    }

    if (keyCode === 40) {
      if (this.episodePanelFocusZone === "close") {
        this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "episodes";
        this.renderEpisodePanel();
        return true;
      }
      if (this.episodePanelFocusZone === "seasons") {
        this.episodePanelFocusZone = "episodes";
        this.renderEpisodePanel();
        return true;
      }
      this.moveEpisodePanel(1);
      return true;
    }

    if (keyCode === 37 || keyCode === 39) {
      if (this.episodePanelFocusZone === "seasons") {
        this.moveEpisodePanelSeason(keyCode === 37 ? -1 : 1);
      }
      return true;
    }

    if (isSelectKeyCode(keyCode)) {
      if (this.episodePanelFocusZone === "close") {
        this.hideEpisodePanel();
        return true;
      }
      if (this.episodePanelFocusZone === "seasons") {
        this.episodePanelFocusZone = "episodes";
        this.renderEpisodePanel();
        return true;
      }
      this.playEpisodeFromPanel();
      return true;
    }

    return true;
  },

  scrollEpisodePanelIntoView() {
    const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
    if (!panel || !this.episodePanelVisible) {
      return;
    }

    const scrollVerticallyWithin = (container, target, padding = 12) => {
      if (!container || !target) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.top < containerRect.top + padding) {
        container.scrollTop -= (containerRect.top + padding) - targetRect.top;
      } else if (targetRect.bottom > containerRect.bottom - padding) {
        container.scrollTop += targetRect.bottom - (containerRect.bottom - padding);
      }
    };

    const scrollHorizontallyWithin = (container, target, padding = 8) => {
      if (!container || !target) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.left < containerRect.left + padding) {
        container.scrollLeft -= (containerRect.left + padding) - targetRect.left;
      } else if (targetRect.right > containerRect.right - padding) {
        container.scrollLeft += targetRect.right - (containerRect.right - padding);
      }
    };

    const selected =
      panel.querySelector(".player-episode-item.focused")
      || panel.querySelector(".player-episode-item.selected");
    scrollVerticallyWithin(panel.querySelector(".player-episode-list"), selected);

    const focusedSeason = panel.querySelector(".player-episode-season-tab.focused");
    scrollHorizontallyWithin(
      panel.querySelector(".player-episode-season-tabs"),
      focusedSeason
    );

    const focusedStream = panel.querySelector(".player-episode-stream-card.focused");
    scrollVerticallyWithin(
      panel.querySelector(".player-episode-stream-list"),
      focusedStream
    );

    const focusedFilter = panel.querySelector(".player-episode-stream-filter.focused");
    scrollHorizontallyWithin(
      panel.querySelector(".player-episode-stream-filters"),
      focusedFilter
    );

    try {
      const focused = panel.querySelector(".focused");
      focused?.focus?.({ preventScroll: true });
    } catch (_) {
      // Some TV WebKit builds reject programmatic focus during DOM replacement.
    }
  },

  renderEpisodeStreamsView() {
    const selectedEpisode = this.episodes[this.episodePanelIndex] || null;
    const filters = this.getEpisodePanelStreamFilters();
    const streams = this.getFilteredEpisodePanelStreams();
    const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    const badgePlacement = resolvePlayerSourceBadgePlacement(badgeSettings);
    const episodeCode = episodeDisplayCode(selectedEpisode);
    const episodeTitle = String(
      selectedEpisode?.title || t("episodes_episode", {}, "Episode")
    ).trim();

    return `
      <div class="player-episode-stream-actions">
        <button type="button"
                class="player-episode-stream-action focusable${focus.zone === "actions" && focus.index === 0 ? " focused" : ""}"
                data-episode-stream-action="back">
          ${escapeHtml(t("episodes_panel_back", {}, "Back"))}
        </button>
        <button type="button"
                class="player-episode-stream-action focusable${focus.zone === "actions" && focus.index === 1 ? " focused" : ""}"
                data-episode-stream-action="reload">
          ${escapeHtml(t("episodes_panel_reload", {}, "Reload"))}
        </button>
        <div class="player-episode-stream-meta">
          ${escapeHtml([episodeCode, episodeTitle].filter(Boolean).join(" • "))}
        </div>
      </div>

      ${
        !this.episodePanelStreamsLoading && filters.length > 1
          ? `<div class="player-episode-stream-filters">
              ${filters
                .map((filter, index) => {
                  const selected = this.episodePanelStreamFilter === filter;
                  const focused = focus.zone === "filters" && focus.index === index;
                  return `
                    <button type="button"
                            class="player-episode-stream-filter focusable${selected ? " selected" : ""}${focused ? " focused" : ""}"
                            data-episode-stream-filter-index="${index}">
                      ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
                    </button>
                  `;
                })
                .join("")}
            </div>`
          : ""
      }

      <div class="player-episode-stream-list">
        ${
          this.episodePanelStreamsLoading
            ? `<div class="player-episode-stream-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>`
            : ""
        }
        ${
          this.episodePanelStreamsError
            ? `<div class="player-episode-stream-empty">${escapeHtml(this.episodePanelStreamsError)}</div>`
            : ""
        }
        ${
          !this.episodePanelStreamsLoading &&
          !this.episodePanelStreamsError &&
          !streams.length
            ? `<div class="player-episode-stream-empty">${escapeHtml(t("episodes_panel_no_streams", {}, "No streams found"))}</div>`
            : streams
                .map((stream, index) => {
                  const focused = focus.zone === "streams" && focus.index === index;
                  const badges = renderPlayerSourceBadges(stream, badgeSettings);
                  const topBadges = badgePlacement === "TOP" ? badges : "";
                  const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
                  const addonLogoUrl = showAddonLogo
                    ? getPlayerSourceLogoDisplayUrl(stream.addonLogo, () => this.scheduleSourceLogoRender())
                    : "";
                  const sourceSide = showAddonLogo
                    ? `<div class="player-source-side">
                        ${addonLogoUrl ? `<img class="player-source-logo" src="${escapeAttribute(addonLogoUrl)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                        <div class="player-source-addon">${escapeHtml(stream.addonName || t("nav_addons", {}, "Addon"))}</div>
                      </div>`
                    : "";
                  return `
                    <article class="player-source-card player-episode-stream-card${sourceSide ? "" : " no-side"} focusable${focused ? " focused" : ""}"
                             data-episode-stream-index="${index}">
                      <div class="player-source-main">
                        ${topBadges}
                        <div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>
                        <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                        ${bottomBadges}
                      </div>
                      ${sourceSide}
                    </article>
                  `;
                })
                .join("")
        }
      </div>
    `;
  },

  renderEpisodePanel() {
    if (this.episodePanelExitTimer) {
      clearTimeout(this.episodePanelExitTimer);
      this.episodePanelExitTimer = null;
    }
    const panelHost = this.uiRefs?.root;
    if (!panelHost) {
      return;
    }
    const existingPanel = panelHost.querySelector("#episodeSidePanel");
    const shouldAnimateEntry =
      !existingPanel || existingPanel.classList.contains("is-exiting");
    existingPanel?.remove();
    if (!this.episodePanelVisible) {
      return;
    }
    const panel = document.createElement("div");
    panel.id = "episodeSidePanel";
    panel.className = "player-episode-panel";

    this.syncEpisodePanelSeasonToIndex();
    const seasons = this.getEpisodePanelSeasons();
    const hasSeasonTabs = seasons.length > 1;
    panel.classList.toggle("has-season-tabs", hasSeasonTabs);
    const focusedZone = this.episodePanelFocusZone || "episodes";
    const seasonTabs = hasSeasonTabs
      ? `<div class="player-episode-season-tabs">
          ${seasons.map((season, index) => {
            const selected = Number(season) === Number(this.episodePanelSeason);
            const focused = focusedZone === "seasons" && selected;
            return `
              <button
                type="button"
                class="player-episode-season-tab focusable${selected ? " selected" : ""}${focused ? " focused" : ""}"
                tabindex="-1"
                data-episode-season-index="${index}"
                data-episode-season="${escapeAttribute(season)}"
              >${escapeHtml(this.getEpisodePanelSeasonLabel(season))}</button>
            `;
          }).join("")}
        </div>`
      : "";
    const entries = this.getEpisodePanelEntries();
    const cards = entries.map(({ episode, index }) => {
      const selected = index === this.episodePanelIndex;
      const focused = focusedZone === "episodes" && selected;
      const selectedClass = `${selected ? " selected" : ""}${focused ? " focused" : ""}`;
      const current = (episode?.id && episode.id === this.params?.videoId)
        || (Number(episode?.season) === Number(this.params?.season) && Number(episode?.episode) === Number(this.params?.episode));
      const code = episodeDisplayCode(episode);
      const thumbnail = episodeThumbnailUrl(episode);
      const date = formatEpisodePanelDate(episode.released);
      return `
        <div class="player-episode-item focusable${selectedClass}" tabindex="-1" data-episode-index="${index}">
          <div class="player-episode-thumb-wrap">
            ${thumbnail ? `<img class="player-episode-thumb" src="${escapeAttribute(thumbnail)}" alt="" />` : `<div class="player-episode-thumb-fallback"></div>`}
            ${code ? `<div class="player-episode-code">${escapeHtml(code)}</div>` : ""}
            ${current ? `<div class="player-episode-current">&#10003;</div>` : ""}
          </div>
          <div class="player-episode-copy">
            <div class="player-episode-item-title">${escapeHtml(episode.title || t("episodes_episode", {}, "Episode"))}</div>
            ${date ? `<div class="player-episode-date">${escapeHtml(date)}</div>` : ""}
            <div class="player-episode-item-subtitle">${escapeHtml(episode.overview || "")}</div>
          </div>
        </div>
      `;
    }).join("");

    const isStreamsView = this.episodePanelMode === "streams";
    const streamFocus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    panel.innerHTML = `
      <div class="player-episode-panel-header">
        <div class="player-episode-panel-title">${escapeHtml(isStreamsView ? t("episodes_panel_streams_title", {}, "Streams") : t("episodes_panel_title", {}, "Episodes"))}</div>
        <button type="button" class="player-episode-close-btn focusable${isStreamsView ? (streamFocus.zone === "close" ? " focused" : "") : (focusedZone === "close" ? " focused" : "")}" tabindex="-1" data-episode-action="close">
          ${escapeHtml(t("episodes_panel_close", {}, "Close"))}
        </button>
      </div>
      ${
        isStreamsView
          ? this.renderEpisodeStreamsView()
          : `${seasonTabs}
             <div class="player-episode-list">${cards}</div>`
      }
    `;
    panelHost.appendChild(panel);
    if (shouldAnimateEntry) {
      panel.classList.add("is-entering");
      const finishEntry = () => {
        panel.classList.remove("is-entering");
        this.scrollEpisodePanelIntoView();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(finishEntry));
      } else {
        setTimeout(finishEntry, 32);
      }
      return;
    }
    this.scrollEpisodePanelIntoView();
  },

  hideEpisodePanel() {
    this.episodePanelVisible = false;
    this.episodePanelStreamLoadToken = Number(this.episodePanelStreamLoadToken || 0) + 1;
    const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
    panel?.classList.add("is-exiting");
    if (this.episodePanelExitTimer) {
      clearTimeout(this.episodePanelExitTimer);
    }
    this.episodePanelExitTimer = setTimeout(() => {
      panel?.remove();
      this.episodePanelExitTimer = null;
    }, EPISODE_PANEL_TRANSITION_MS);
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async playEpisodeFromPanel(selectedStream = null) {
    if (this.switchingEpisode || !this.episodes.length) {
      return;
    }
    const selected = this.episodes[this.episodePanelIndex];
    if (!selected?.id) {
      return;
    }
    if (!selectedStream && this.episodePanelMode !== "streams") {
      await this.openEpisodeStreamsView({ forceReload: true });
      return;
    }
    this.switchingEpisode = true;
    try {
      const itemType = this.params?.itemType || "series";
      const streamItems = selectedStream
        ? this.episodePanelStreams
        : await this.getPlayableStreamsForVideo(selected.id, itemType, {
          season: selected.season,
          episode: selected.episode
        });
      if (!streamItems.length) {
        return;
      }
      const bestStreamCandidate =
        selectedStream || this.selectBestStreamCandidate(streamItems) || streamItems[0];
      const bestStream = streamDirectPlaybackUrl(bestStreamCandidate) || null;
      const nextEpisode = this.episodes[this.episodePanelIndex + 1] || null;
      await PlayerController.flushCurrentProgress({ allowCloudSync: false });
      void PlayerController.pushProgressIfDue?.(true);
      this.releaseCurrentEngineFsStreamBestEffort("episode-change", {
        removeTorrent: true,
        deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
      });
      await Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
        traktId: this.params?.traktId || this.params?.trakt_id || null,
        contentLanguage: this.contentLanguage || null,
        videoId: selected.id,
        season: selected.season ?? null,
        episode: selected.episode ?? null,
        episodeLabel: `S${selected.season}E${selected.episode}`,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerReleaseYear: this.params?.playerReleaseYear || this.params?.year || "",
        playerSubtitle: `${selected.title || ""}`.trim() || `S${selected.season}E${selected.episode}`,
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes,
        streamCandidates: streamItems,
        preferredStreamId: bestStreamCandidate.id || null,
        playbackSourceContext: this.getPlaybackSourceContext(bestStreamCandidate),
        returnToStreamOnBack: false,
        nextEpisodeVideoId: nextEpisode?.id || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
        nextEpisodeSeason: nextEpisode?.season ?? null,
        nextEpisodeEpisode: nextEpisode?.episode ?? null,
        nextEpisodeTitle: nextEpisode?.title || "",
        nextEpisodeReleased: nextEpisode?.released || ""
      }, {
        replaceHistory: true
      });
    } finally {
      this.switchingEpisode = false;
    }
  },

  async loadSubtitles() {
    const requestToken = (this.subtitleLoadToken || 0) + 1;
    this.subtitleLoadToken = requestToken;
    this.subtitleLoading = true;

    const sidecarSubtitles = this.collectStreamSidecarSubtitles();
    const subtitleLookup = this.buildSubtitleLookupContext();
    try {
      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.refreshTrackDialogs();

      let repositorySubtitles = [];

      try {
        if (subtitleLookup.id && subtitleLookup.type) {
          repositorySubtitles = await subtitleRepository.getSubtitles(
            subtitleLookup.type,
            subtitleLookup.id,
            subtitleLookup.videoId || null,
            {
              season: subtitleLookup.season,
              episode: subtitleLookup.episode,
              title: subtitleLookup.title,
              year: subtitleLookup.year,
              videoHash: subtitleLookup.videoHash || null,
              videoSize: subtitleLookup.videoSize || null,
              filename: subtitleLookup.filename || null
            }
          );
        }
      } catch (error) {
        console.error("Subtitle fetch failed", error);
      }

      if (requestToken !== this.subtitleLoadToken) {
        return;
      }

      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, repositorySubtitles);
      if (this.subtitleDialogVisible && this.subtitleDialogTab === "builtIn") {
        const builtInBoundary = this.resolveBuiltInSubtitleBoundary(this.getTextTracks());
        if (builtInBoundary <= 0 && this.subtitles.length > 0) {
          this.subtitleDialogTab = "addons";
          this.subtitleDialogIndex = 0;
        }
      }
      this.refreshTrackDialogs();
    } catch (error) {
      console.error("Subtitle attach failed", error);
      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.refreshTrackDialogs();
    } finally {
      if (requestToken === this.subtitleLoadToken) {
        this.subtitleLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  attachExternalSubtitles() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.clearMountedExternalSubtitleTracks();

    this.builtInSubtitleCount = this.getTextTracks().length;
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (usingAvPlay) {
      return;
    }

    this.subtitles.forEach((subtitle, index) => {
      if (!subtitle.url) {
        return;
      }
      const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || subtitleLabel(index);
      track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
      track.src = subtitle.url;
      track.default = false;
      track.setAttribute("data-addon-subtitle-id", subtitleId);
      video.appendChild(track);
      this.externalTrackNodes.push(track);
    });
  },
  moveControlFocus(delta) {
    const controls = this.getControlDefinitions();
    if (!controls.length) {
      return;
    }
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    if (this.controlFocusZone === "progress") {
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = delta < 0 ? 0 : 0;
      this.renderControlButtons();
      return;
    }
    const nextIndex = clamp(this.controlFocusIndex + delta, 0, controls.length - 1);
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = nextIndex;
    this.renderControlButtons();
    this.resetControlsAutoHide();
  },

  performFocusedControl() {
    if (this.controlFocusZone === "progress") {
      this.cancelSeekPreview({ commit: true });
      this.resetControlsAutoHide();
      return;
    }
    const controls = this.getControlDefinitions();
    const current = controls[this.controlFocusIndex] || null;
    if (!current) {
      return;
    }
    this.performControlAction(current.action || "");
  },

  performControlAction(action) {
    if (action === "playPause") {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (action === "playNextEpisode") {
      void this.playNextEpisode({ userInitiated: true });
      return;
    }

    if (action === "stillWatchingContinue") {
      void this.onStillWatchingContinue();
      return;
    }

    if (action === "stillWatchingExit") {
      this.onDismissStillWatchingPrompt();
      return;
    }

    if (action === "subtitleDialog") {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (action === "audioTrack") {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (action === "source") {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (action === "switchEngine") {
      this.switchPlaybackEngine();
      return;
    }

    if (action === "episodes") {
      this.toggleEpisodePanel();
      return;
    }

    if (action === "more") {
      this.stickyProgressFocus = false;
      this.moreActionsVisible = true;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(0, this.getControlDefinitions().findIndex((entry) => entry.action === "speed"));
      this.renderControlButtons();
      return;
    }

    if (action === "backFromMore") {
      this.stickyProgressFocus = false;
      this.moreActionsVisible = false;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(0, this.getControlDefinitions().findIndex((entry) => entry.action === "more"));
      this.renderControlButtons();
      return;
    }

    if (action === "speed") {
      this.openSpeedDialog();
      return;
    }

    if (action === "aspect") {
      this.cycleAspectMode();
      return;
    }
  },

  syncPointerFocus(target) {
    const skipIntroNode = target?.closest?.("[data-player-pointer-action='skipIntro']");
    if (skipIntroNode && this.isSkipIntroButtonFocusable()) {
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "skipIntro";
      this.resetControlsAutoHide();
      this.renderControlButtons();
      this.syncSkipIntroFocusState();
      return;
    }

    const controlButton = target?.closest?.(".player-control-btn[data-action]");
    if (controlButton) {
      const buttons = Array.from(this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn[data-action]") || []);
      const index = buttons.indexOf(controlButton);
      if (index >= 0) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
        this.controlFocusIndex = index;
        this.resetControlsAutoHide();
      }
      return;
    }

    if (target?.closest?.(".player-progress-shell")) {
      this.stickyProgressFocus = true;
      this.controlFocusZone = "progress";
      this.resetControlsAutoHide();
      return;
    }

    const sourcesNode = target?.closest?.("[data-sources-zone]");
    if (sourcesNode && this.sourcesPanelVisible) {
      this.sourcesFocus = {
        zone: sourcesNode.dataset.sourcesZone || "filter",
        index: Number(sourcesNode.dataset.sourcesIndex || 0)
      };
      return;
    }

    const subtitleNode = target?.closest?.("[data-subtitle-rail]");
    if (subtitleNode && this.subtitleDialogVisible) {
      this.subtitleFocusedRail = subtitleNode.dataset.subtitleRail || "language";
      const index = Number(subtitleNode.dataset.subtitleIndex || 0);
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = index;
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = index;
      } else {
        this.subtitleStyleRailIndex = index;
        this.subtitleStyleControlSide = String(subtitleNode.dataset.subtitleStyleAction || "").toLowerCase() === "increase" ? "plus" : "minus";
      }
      return;
    }

    const audioNode = target?.closest?.("[data-audio-column]");
    if (audioNode && this.audioDialogVisible) {
      this.audioFocusedColumn = audioNode.dataset.audioColumn || "tracks";
      const index = Number(audioNode.dataset.audioIndex || 0);
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = index;
      } else {
        this.audioMixFocusIndex = index;
      }
      return;
    }

    const speedNode = target?.closest?.("[data-speed-index]");
    if (speedNode && this.speedDialogVisible) {
      this.speedDialogIndex = Number(speedNode.dataset.speedIndex || 0);
      return;
    }

    const episodeCloseNode = target?.closest?.("[data-episode-action='close']");
    if (episodeCloseNode && this.episodePanelVisible) {
      if (this.episodePanelMode === "streams") {
        this.episodePanelStreamFocus = { zone: "close", index: 0 };
      } else {
        this.episodePanelFocusZone = "close";
      }
      return;
    }

    const episodeStreamAction = target?.closest?.("[data-episode-stream-action]");
    if (episodeStreamAction && this.episodePanelVisible) {
      this.episodePanelStreamFocus = {
        zone: "actions",
        index: episodeStreamAction.dataset.episodeStreamAction === "reload" ? 1 : 0
      };
      return;
    }

    const episodeStreamFilter = target?.closest?.("[data-episode-stream-filter-index]");
    if (episodeStreamFilter && this.episodePanelVisible) {
      this.episodePanelStreamFocus = {
        zone: "filters",
        index: Number(episodeStreamFilter.dataset.episodeStreamFilterIndex || 0)
      };
      return;
    }

    const episodeStreamNode = target?.closest?.("[data-episode-stream-index]");
    if (episodeStreamNode && this.episodePanelVisible) {
      this.episodePanelStreamFocus = {
        zone: "streams",
        index: Number(episodeStreamNode.dataset.episodeStreamIndex || 0)
      };
      return;
    }

    const episodeSeasonNode = target?.closest?.("[data-episode-season-index]");
    if (episodeSeasonNode && this.episodePanelVisible) {
      const seasonIndex = Number(episodeSeasonNode.dataset.episodeSeasonIndex || 0);
      const seasons = this.getEpisodePanelSeasons();
      this.episodePanelSeasonIndex = clamp(seasonIndex, 0, Math.max(0, seasons.length - 1));
      this.episodePanelSeason = seasons[this.episodePanelSeasonIndex] ?? this.episodePanelSeason;
      const firstEntry = this.getEpisodePanelEntries()[0];
      if (firstEntry) {
        this.episodePanelIndex = firstEntry.index;
      }
      this.episodePanelFocusZone = "seasons";
      return;
    }

    const episodeNode = target?.closest?.("[data-episode-index]");
    if (episodeNode && this.episodePanelVisible) {
      this.episodePanelIndex = Number(episodeNode.dataset.episodeIndex || 0);
      this.episodePanelFocusZone = "episodes";
    }
  },

  seekProgressFromPointer(event, target) {
    const shell = target?.closest?.(".player-progress-shell") || this.uiRefs?.progressShell;
    const rect = shell?.getBoundingClientRect?.();
    const duration = this.getPlaybackDurationSeconds();
    if (!rect || rect.width <= 0 || !Number.isFinite(duration) || duration <= 0) {
      return false;
    }
    const x = Number(event?.clientX ?? rect.left);
    const ratio = clamp((x - rect.left) / rect.width, 0, 1);
    this.seekPreviewSeconds = null;
    this.seekRepeatCount = 0;
    this.seekPlaybackSeconds(duration * ratio);
    this.resetControlsAutoHide();
    return true;
  },

  onPointerFocus(target) {
    this.syncPointerFocus(target);
  },

  async onPointerActivate(target, event) {
    if (!target || this.isExternalFrameMode()) {
      return false;
    }
    this.syncPointerFocus(target);

    const errorAction = target.closest?.("[data-player-error-action]");
    if (errorAction && this.isStartupErrorVisible()) {
      if (String(errorAction.dataset.playerErrorAction || "") === "back") {
        this.navigateBackToStreamScreen();
        return true;
      }
      return false;
    }

    if (target.closest?.("[data-player-pointer-action='skipIntro']")) {
      return this.skipActiveInterval();
    }

    if (target.closest?.("[data-player-pointer-action='nextEpisode']")) {
      await this.playNextEpisode({ userInitiated: true });
      return true;
    }

    if (target.closest?.("[data-player-pointer-action='stillWatchingContinue']")) {
      await this.onStillWatchingContinue();
      return true;
    }

    if (target.closest?.("[data-player-pointer-action='stillWatchingExit']")) {
      this.onDismissStillWatchingPrompt();
      return true;
    }

    if (target.closest?.(".player-progress-shell")) {
      return this.seekProgressFromPointer(event, target);
    }

    const controlButton = target.closest?.(".player-control-btn[data-action]");
    if (controlButton) {
      this.performControlAction(controlButton.dataset.action || "");
      return true;
    }

    const sourcesNode = target.closest?.("[data-sources-zone]");
    if (sourcesNode && this.sourcesPanelVisible) {
      await this.activateSourcesFocus();
      return true;
    }

    const subtitleStep = target.closest?.("[data-subtitle-style-action]");
    if (subtitleStep && this.subtitleDialogVisible) {
      const styleItems = this.getSubtitleStyleControls();
      const styleIndex = Number(subtitleStep.dataset.subtitleIndex);
      const styleItem = styleItems[styleIndex];
      if (styleItem && !styleItem.disabled) {
        this.subtitleStyleRailIndex = styleIndex;
        const side = String(subtitleStep.dataset.subtitleStyleAction || "").toLowerCase() === "increase" ? "plus" : "minus";
        this.subtitleStyleControlSide = side;
        this.adjustSubtitleStyleControl(styleItem.id, this.getSubtitleStyleControlDelta(side));
      }
      return true;
    }

    const subtitleNode = target.closest?.("[data-subtitle-rail]");
    if (subtitleNode && this.subtitleDialogVisible) {
      return this.handleSubtitleDialogKey({ keyCode: 13 });
    }

    const audioStep = target.closest?.("[data-audio-step]");
    if (audioStep && this.audioDialogVisible) {
      this.activateAudioControl(Number(audioStep.dataset.audioStep || 1));
      return true;
    }

    const audioNode = target.closest?.("[data-audio-column]");
    if (audioNode && this.audioDialogVisible) {
      if (this.audioFocusedColumn === "tracks") {
        this.applyAudioTrack(this.audioDialogIndex, { rememberSelection: true });
      } else {
        this.activateAudioControl(this.audioMixFocusIndex === 0 ? 1 : 0);
      }
      return true;
    }

    const speedNode = target.closest?.("[data-speed-index]");
    if (speedNode && this.speedDialogVisible) {
      const speedOptions = this.getPlaybackSpeedOptions();
      this.applyPlaybackSpeed(speedOptions[this.speedDialogIndex] || 1);
      return true;
    }

    const episodeCloseNode = target.closest?.("[data-episode-action='close']");
    if (episodeCloseNode && this.episodePanelVisible) {
      this.hideEpisodePanel();
      return true;
    }

    const episodeStreamAction = target.closest?.("[data-episode-stream-action]");
    if (episodeStreamAction && this.episodePanelVisible) {
      await this.activateEpisodeStreamFocus();
      return true;
    }

    const episodeStreamFilter = target.closest?.("[data-episode-stream-filter-index]");
    if (episodeStreamFilter && this.episodePanelVisible) {
      await this.activateEpisodeStreamFocus();
      return true;
    }

    const episodeStreamNode = target.closest?.("[data-episode-stream-index]");
    if (episodeStreamNode && this.episodePanelVisible) {
      await this.activateEpisodeStreamFocus();
      return true;
    }

    const episodeSeasonNode = target.closest?.("[data-episode-season-index]");
    if (episodeSeasonNode && this.episodePanelVisible) {
      this.episodePanelFocusZone = "episodes";
      this.renderEpisodePanel();
      return true;
    }

    const episodeNode = target.closest?.("[data-episode-index]");
    if (episodeNode && this.episodePanelVisible) {
      await this.playEpisodeFromPanel();
      return true;
    }

    return false;
  },

  switchPlaybackEngine() {
    const targetEngine = typeof PlayerController.getAlternativePlaybackEngine === "function"
      ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
      : null;
    if (!targetEngine || !this.activePlaybackUrl) {
      this.showAspectToast(t("player_engine_switch_unavailable", {}, "No alternate player engine"));
      return;
    }
    this.showAspectToast(t("player_engine_switching_title", {}, "Switching player"));
    void this.playStreamByUrl(this.activePlaybackUrl, {
      preservePlaybackState: true,
      resetSilentAudioState: false,
      forceEngine: targetEngine
    });
  },

  hasBackDismissableOverlay() {
    return Boolean(
      this.stillWatchingPromptVisible
      || this.seekOverlayVisible
      || this.seekPreviewSeconds != null
      || (!this.controlsVisible && this.isNextEpisodeCardVisible())
      || this.sourcesPanelVisible
      || this.subtitleDialogVisible
      || this.audioDialogVisible
      || this.speedDialogVisible
      || this.episodePanelVisible
      || this.moreActionsVisible
      || this.pauseOverlayVisible
      || this.pauseOverlayTimer
    );
  },

  consumeBackRequest() {
    if (this.isStartupErrorVisible()) {
      if (this.navigateBackToStreamScreen()) {
        return true;
      }
      Router.back();
      return true;
    }

    if (this.stillWatchingPromptVisible) {
      return this.onDismissStillWatchingPrompt();
    }

    if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
      this.cancelSeekPreview({ commit: false });
      return true;
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
      this.dismissNextEpisodeCard({ revealControls: true, armExitOnNextBack: true });
      return true;
    }

    if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed) {
      this.skipIntervalDismissed = true;
      this.skipIntroAutoHidden = false;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return true;
    }

    if (this.sourcesPanelVisible) {
      this.closeSourcesPanel();
      return true;
    }

    if (this.subtitleDialogVisible) {
      this.closeSubtitleDialog();
      return true;
    }

    if (this.audioDialogVisible) {
      this.closeAudioDialog();
      return true;
    }

    if (this.speedDialogVisible) {
      this.closeSpeedDialog();
      return true;
    }

    if (this.episodePanelVisible) {
      if (this.episodePanelMode === "streams") {
        this.closeEpisodeStreamsView();
      } else {
        this.hideEpisodePanel();
      }
      return true;
    }

    if (this.moreActionsVisible) {
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.focusFirstControl();
      return true;
    }

    if (this.pauseOverlayVisible || this.pauseOverlayTimer) {
      this.dismissPauseOverlay({ revealControls: false, focus: false });
    }

    if (this.loadingVisible && !this.hasPresentedPlaybackFrame) {
      return this.navigateBackToStreamScreen();
    }

    // Match Android TV: when the on screen controls are showing, Back hides
    // them and keeps the video playing. The player only leaves on a Back press
    // once the controls are already hidden.
    if (this.controlsVisible && !this.nextEpisodeBackExitArmed) {
      this.setControlsVisible(false, { focus: false });
      return true;
    }

    this.nextEpisodeBackExitArmed = false;
    return this.navigateBackToStreamScreen();
  },

  async onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    const isBackKey = isBackEvent(event);
    if (this.isStartupErrorVisible()) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (isBackKey || isSelectKeyCode(keyCode) || keyCode === 66) {
        if (!this.navigateBackToStreamScreen()) {
          Router.back();
        }
      }
      return;
    }
    if (isBackKey) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.consumeBackRequest();
      return;
    }
    if (this.nextEpisodeBackExitArmed) {
      this.nextEpisodeBackExitArmed = false;
    }
    if (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode)) {
      event?.preventDefault?.();
    }
    const mediaAction = this.resolveMediaAction(event);
    if (this.pauseOverlayVisible) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      if (this.stillWatchingPromptVisible) {
        if (keyCode === 37 || keyCode === 39) {
          this.stillWatchingPromptFocus = this.stillWatchingPromptFocus === "continue" ? "exit" : "continue";
          this.renderPauseOverlay();
          return;
        }
        if (mediaAction === "play" || mediaAction === "toggle" || isSelectKeyCode(keyCode)) {
          if (this.stillWatchingPromptFocus === "exit") {
            this.onDismissStillWatchingPrompt();
          } else {
            await this.onStillWatchingContinue();
          }
          return;
        }
        return;
      }
      if (mediaAction === "play" || mediaAction === "toggle" || isSelectKeyCode(keyCode)) {
        this.dismissPauseOverlay();
        this.togglePause();
        this.renderControlButtons();
        return;
      }
      this.dismissPauseOverlay({ revealControls: true, focus: false });
      if (this.paused) {
        this.schedulePauseOverlay();
      }
      return;
    }
    if (this.paused) {
      this.schedulePauseOverlay();
    }

    if (this.episodePanelVisible && this.handleEpisodePanelKey(event)) {
      return;
    }

    if (mediaAction) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.applyMediaAction(mediaAction);
      return;
    }

    if (this.sourcesPanelVisible) {
      if (await this.handleSourcesPanelKey(event)) {
        return;
      }
    }

    if (this.subtitleDialogVisible) {
      if (this.handleSubtitleDialogKey(event)) {
        return;
      }
    }

    if (this.audioDialogVisible) {
      if (this.handleAudioDialogKey(event)) {
        return;
      }
    }

    if (this.speedDialogVisible) {
      if (this.handleSpeedDialogKey(event)) {
        return;
      }
    }

    if (keyCode === 83) {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (keyCode === 84) {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (keyCode === 67) {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (keyCode === 69) {
      this.toggleEpisodePanel();
      return;
    }

    if (keyCode === 80) {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed && !this.skipIntroAutoHidden) {
      if (isSelectKeyCode(keyCode)) {
        if (this.skipActiveInterval()) {
          return;
        }
      }
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
      if (isSelectKeyCode(keyCode)) {
        await this.playNextEpisode({ userInitiated: true });
        return;
      }
      if (keyCode === 38 || keyCode === 40) {
        this.setControlsVisible(true, { focus: true });
        return;
      }
    }

    if (!this.paused && this.controlsVisible && !this.isDialogOpen() && Boolean(event?.repeat) && (keyCode === 37 || keyCode === 39)) {
      this.focusProgressBar();
      this.beginSeekPreview(keyCode === 37 ? -1 : 1, true);
      return;
    }

    if (!this.controlsVisible) {
      if (keyCode === 37) {
        this.autoHideControlsAfterSeek = false;
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.autoHideControlsAfterSeek = false;
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38) {
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(true, { focus: true });
        return;
      }
      if (keyCode === 40) {
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(true, { focus: true });
        return;
      }
      if (isSelectKeyCode(keyCode)) {
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        this.autoHideControlsAfterSeek = false;
        if (this.seekPreviewSeconds != null) {
          this.cancelSeekPreview({ commit: true });
        } else if (this.seekOverlayVisible) {
          this.cancelSeekPreview({ commit: false });
        }
        this.togglePause({ focusControls: true });
        this.renderControlButtons();
      }
      return;
    }

    if (this.controlFocusZone === "skipIntro") {
      if (isSelectKeyCode(keyCode)) {
        if (this.skipActiveInterval()) {
          return;
        }
      }
      if (keyCode === 40) {
        this.focusProgressBar();
        return;
      }
      if (keyCode === 38 || keyCode === 37 || keyCode === 39) {
        this.resetControlsAutoHide();
        return;
      }
    }

    if (this.controlFocusZone === "progress") {
      if (keyCode === 37) {
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        if (this.focusSkipIntroButton()) {
          return;
        }
        this.setControlsVisible(false);
        return;
      }
      if (keyCode === 40) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
        this.renderControlButtons();
        return;
      }
      if (isSelectKeyCode(keyCode)) {
        this.autoHideControlsAfterSeek = false;
        this.togglePause();
        this.focusProgressBar();
        this.renderControlButtons();
        return;
      }
    }

    if (keyCode === 37) {
      this.moveControlFocus(-1);
      return;
    }
    if (keyCode === 39) {
      this.moveControlFocus(1);
      return;
    }
    if (keyCode === 38) {
      this.focusProgressBar();
      return;
    }
    if (keyCode === 40) {
      this.setControlsVisible(false);
      return;
    }
    if (isSelectKeyCode(keyCode)) {
      this.performFocusedControl();
      return;
    }

    this.resetControlsAutoHide();
  },

  selectBestStreamCandidate(streams = []) {
    if (!Array.isArray(streams) || !streams.length) {
      return null;
    }

    const hasCapabilityProbe = Boolean(PlayerController?.video);
    const isWebOsRuntime = Environment.isWebOS();
    const capabilities = hasCapabilityProbe && typeof PlayerController.getPlaybackCapabilities === "function"
      ? PlayerController.getPlaybackCapabilities()
      : null;
    const supports = (key, fallback = true) => {
      if (!capabilities) {
        return fallback;
      }
      return Boolean(capabilities[key]);
    };

    const resolveContext = {
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode)
    };

    const scored = streams
      .filter((stream) => Boolean(
        stream?.url
          || stream?.externalUrl
          || DirectDebridResolver.canResolveStream(stream, resolveContext)
          || WebOsEngineFsResolver.canResolveStream(stream)
          || TizenStreamingServerResolver.canResolveStream(stream)
      ))
      .map((stream) => {
        const presentation = stream.streamPresentation || stream.raw?.streamPresentation || {};
        const text = [
          stream.title,
          stream.label,
          stream.name,
          stream.description,
          stream.behaviorHints?.filename,
          stream.raw?.behaviorHints?.filename,
          stream.raw?.filename,
          presentation.resolution,
          presentation.quality,
          presentation.encode,
          ...(Array.isArray(presentation.visualTags) ? presentation.visualTags : []),
          ...(Array.isArray(presentation.audioTags) ? presentation.audioTags : []),
          ...(Array.isArray(presentation.audioChannels) ? presentation.audioChannels : []),
          stream.url,
          stream.externalUrl,
          stream.infoHash
        ].filter(Boolean).join(" ").toLowerCase();
        let score = 0;

        if (text.includes("2160") || text.includes("4k")) score += 60;
        else if (text.includes("1080")) score += 40;
        else if (text.includes("720")) score += 20;
        else if (text.includes("480")) score += 10;

        if (text.includes("web")) score += 8;
        if (text.includes("bluray")) score += 8;
        if (hasReleaseToken(text, "cam")) score -= 70;
        if (hasReleaseToken(text, "ts")) score -= 40;

        if (text.includes("hevc") || text.includes("h265") || text.includes("x265")) {
          score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 12 : -90;
        }
        if (text.includes("av1")) {
          score += supports("mp4Av1", true) ? 10 : -80;
        }
        if (text.includes("vp9")) {
          score += supports("webmVp9", true) ? 8 : -50;
        }
        if (text.includes(".mkv") || text.includes("matroska")) {
          score += supports("mkvH264", true) ? 8 : -120;
          if (isWebOsRuntime && !supports("mkvH264", false)) score -= 220;
        }
        if (text.includes(".webm")) {
          score += supports("webmVp9", true) ? 6 : -45;
        }

        if (
          hasReleaseToken(text, "hdr") ||
          hasReleaseToken(text, "hdr10") ||
          hasReleaseToken(text, "hlg")
        ) {
          score += supports("hdrLikely", true) ? 16 : -35;
        }
        if (
          text.includes("dolby vision") ||
          hasReleaseToken(text, "dv") ||
          hasReleaseToken(text, "dovi")
        ) {
          score += supports("dolbyVision", true) ? 18 : -45;
        }
        if (text.includes("atmos") || text.includes("eac3") || text.includes("ec-3")) {
          score += supports("atmosLikely", true) || supports("audioEac3", true) ? 14 : -30;
        }
        if (/\b(aac|mp4a)\b/.test(text)) {
          score += 16;
        }
        if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += 10;
        }
        if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += isWebOsRuntime ? -70 : -18;
        }
        if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
          score += isWebOsRuntime ? -85 : -40;
        }
        if (/\b(stereo|2\.0|2ch)\b/.test(text)) {
          score += isWebOsRuntime ? 10 : 4;
        }

        if (!stream.url && !stream.externalUrl && (WebOsEngineFsResolver.canResolveStream(stream) || TizenStreamingServerResolver.canResolveStream(stream))) {
          score += 4;
        }
        if (!stream.url && !stream.externalUrl && DirectDebridResolver.canResolveStream(stream, resolveContext)) {
          score += 2;
        }

        return { stream, score };
      })
      .sort((left, right) => right.score - left.score);

    return scored[0]?.stream || null;
  },

  selectBestStreamUrl(streams = []) {
    const candidate = this.selectBestStreamCandidate(streams);
    return streamDirectPlaybackUrl(candidate) || null;
  },

  selectBestStreamCandidateForAddon(streams = [], addonName = "") {
    const normalizedAddonName = String(addonName || "").trim();
    if (!normalizedAddonName || !Array.isArray(streams) || !streams.length) {
      return null;
    }

    const addonStreams = streams.filter((stream) => String(stream?.addonName || "").trim() === normalizedAddonName);
    if (!addonStreams.length) {
      return null;
    }

    return this.selectBestStreamCandidate(addonStreams);
  },

  selectBestStreamUrlForAddon(streams = [], addonName = "") {
    const candidate = this.selectBestStreamCandidateForAddon(streams, addonName);
    return streamDirectPlaybackUrl(candidate) || null;
  },

  async handlePlaybackEnded() {
    // Immediate scrobble stop (may trigger mark-as-watched)
    if (TraktScrobbleService.isEnabled()) {
      TraktScrobbleService.stop(this.buildScrobbleContext());
    }
    this.clearPlaybackStallGuard();
    this.releaseStartupAudioGate({ resume: false });
    const autoplayEnabled = Boolean(PlayerSettingsStore.get().autoplayNextEpisode);
    const canAutoplayNext = autoplayEnabled && this.hasPlaybackReachedNaturalEnd();
    if (canAutoplayNext) {
      const nextEpisodeHandled = await this.playNextEpisode({ userInitiated: false });
      if (nextEpisodeHandled || this.nextEpisodeLaunching || Router.getCurrent() !== "player") {
        return;
      }
    }

    if (normalizeItemType(this.params?.itemType || "movie") === "series") {
      this.releaseCurrentEngineFsStreamBestEffort("playback-ended", { removeTorrent: true });
      void Router.navigate("detail", this.buildDetailRouteParamsFromPlayer(), {
        skipStackPush: true,
        replaceHistory: true
      });
      return;
    }

    this.loadingVisible = false;
    this.paused = true;
    this.dismissPauseOverlay();
    this.updateLoadingVisibility();
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(true, { focus: false });
    this.renderControlButtons();
    this.renderNextEpisodeCard();
    this.updateUiTick();
  },

  cleanup() {
    try {
    this.playerRouteActive = false;
    this.playerMountToken = Number(this.playerMountToken || 0) + 1;
    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunching = false;
    this.resetNextEpisodeLaunchPresentation();
    this.nextEpisodeAutoplayAttemptedKey = "";
    this.resetStillWatchingPromptState({ render: false });
    this.consecutiveAutoPlayCount = 0;
    this.unbindVideoEvents();
    if (this.endedHandler && PlayerController.video) {
      PlayerController.video.removeEventListener("ended", this.endedHandler);
      this.endedHandler = null;
    }
    TraktScrobbleService.cancel();
    this.unbindPlayerExitCleanup();
    this.releaseCurrentEngineFsStreamBestEffort("player-cleanup", {
      removeTorrent: true,
      deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
    });
    this.cancelSeekPreview({ commit: false });
    this.dismissPauseOverlay();
    this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
    this.nextEpisodeTransitionMeta = null;
    this.streamCandidatesByVideoId?.clear?.();
    this.streamCandidatesLoadPromises?.clear?.();
    this.hlsManifestSubtitlePromotionUrls?.clear?.();
    this.failedPlaybackUrls?.clear?.();
    this.failedPlaybackStreamIds?.clear?.();
    this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0) + 1;
    this.subtitleLoadToken = (this.subtitleLoadToken || 0) + 1;
    this.manifestLoadToken = (this.manifestLoadToken || 0) + 1;
    this.trackDiscoveryToken = (this.trackDiscoveryToken || 0) + 1;
    this.clearStartupAudioPreferenceRetry();
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.subtitleLoading = false;
    this.manifestLoading = false;
    this.clearHtmlSubtitleOverlay();
    this.clearBitmapSubtitleOverlay({ dispose: true });
    if (this.releaseImageProxyReadyListener) {
      this.releaseImageProxyReadyListener();
      this.releaseImageProxyReadyListener = null;
    }
    if (this.sourceLogoRenderTimer) {
      clearTimeout(this.sourceLogoRenderTimer);
      this.sourceLogoRenderTimer = null;
    }
    this.clearTrackDiscoveryTimer();
    this.stopLoadingLogoFillAnimation();
    this.clearPlaybackStallGuard();
    if (this.engineFsStartupRetryTimer) {
      clearTimeout(this.engineFsStartupRetryTimer);
      this.engineFsStartupRetryTimer = null;
    }

    this.clearSubtitleCueStyleBindings();
    this.clearEmbeddedSubtitleCueRefreshTimers();
    this.clearMountedExternalSubtitleTracks();

    this.clearControlsAutoHide();
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = 0;
    this.skipIntroCountdownStartAt = 0;
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
    this.stopSkipIntroCountdownAnimation();
    if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.skipIntroFocusFrame);
    }
    this.skipIntroFocusFrame = null;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.stopSkipIntervalCheckTimer();

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
      this.aspectToastTimer = null;
    }

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
      this.parentalGuideTimer = null;
    }
    if (this.parentalGuideExitTimer) {
      clearTimeout(this.parentalGuideExitTimer);
      this.parentalGuideExitTimer = null;
    }
    this.parentalGuideExiting = false;
    this.stopParentalGuideLineAnimation({ reset: true });

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }
    if (this.subtitleDialogScrollTimer) {
      clearTimeout(this.subtitleDialogScrollTimer);
      this.subtitleDialogScrollTimer = null;
    }

    this.clearMediaSessionHandlers();

    this.releaseStartupAudioGate({ resume: false });
    } catch (error) {
      try { console.warn("Player cleanup error suppressed to keep navigation working", error); } catch (_) {}
    } finally {
      // Always stop playback and hide the player surface, even if the teardown
      // above threw, so the user is never left stuck in the player with the
      // video still playing (seen on Samsung Tizen when the EngineFS release
      // throws during cleanup and aborts the route navigation).
      try { PlayerController.stop(); } catch (_) {}
      try {
        if (this.container) {
          this.container.style.display = "none";
          this.container.querySelector("#playerUiRoot")?.remove();
          this.container.querySelector("#episodeSidePanel")?.remove();
        }
      } catch (_) {}
      this.uiRefs = null;
      this.lastUiTickState = null;
    }
  }

};
