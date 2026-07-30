import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { SessionStore } from "../../../core/storage/sessionStore.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { ThemeStore } from "../../../data/local/themeStore.js";
import { ThemeManager } from "../../theme/themeManager.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_MAX,
  SUBTITLE_VERTICAL_OFFSET_MIN,
  normalizeSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";
import { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";
import { WebOsAudioCompatibilityStore } from "../../../data/local/webOsAudioCompatibilityStore.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";
import { AnimeSkipSettingsStore } from "../../../data/local/animeSkipSettingsStore.js";
import {
  DEBRID_SETTINGS_DEFAULTS,
  DEBRID_SORT_PROFILES,
  DEBRID_STREAM_AUDIO_CHANNELS,
  DEBRID_STREAM_AUDIO_TAGS,
  DEBRID_STREAM_ENCODES,
  DEBRID_STREAM_LANGUAGES,
  DEBRID_STREAM_QUALITIES,
  DEBRID_STREAM_RESOLUTIONS,
  DEBRID_STREAM_VISUAL_TAGS,
  DEFAULT_STREAM_PREFERENCES,
  normalizeDebridStreamPreferences,
  DebridSettingsStore
} from "../../../data/local/debridSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { DebridApi } from "../../../data/remote/api/debridApi.js";
import { DebridProviders } from "../../../core/debrid/debridProviders.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { ProfileSyncService } from "../../../core/profile/profileSyncService.js";
import { LibrarySyncService } from "../../../core/profile/librarySyncService.js";
import { SavedLibrarySyncService } from "../../../core/profile/savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "../../../core/profile/watchedItemsSyncService.js";
import { WatchProgressSyncService } from "../../../core/profile/watchProgressSyncService.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { SupabaseApi } from "../../../data/remote/supabase/supabaseApi.js";
import { Platform } from "../../../platform/index.js";
import {
  FAST_HORIZONTAL_NAVIGATION_KEY,
  ROTATED_DPAD_KEY,
  isFastHorizontalNavigationEnabled,
  shouldUseRotatedMapping
} from "../../../platform/sharedKeys.js";
import { CW_DISPLAY_SNAPSHOT_KEY, CW_ENRICHMENT_CACHE_KEY } from "../home/homeConstants.js";
import { I18n } from "../../../i18n/index.js";
import { PluginManager } from "../../../core/player/pluginManager.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { TraktAuthService } from "../../../data/repository/traktAuthService.js";
import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";
import {
  getStreamBadgePreviewSections,
  normalizeStreamBadgeChipColor,
  STREAM_BADGE_IMPORT_LIMIT
} from "../../../core/streams/streamBadgeRules.js";
import {
  TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL,
  TraktLibrarySourceMode,
  TraktSettingsStore,
  WatchProgressSource
} from "../../../data/local/traktSettingsStore.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isModernSidebarBlurAvailable,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

const STRICT_DPAD_GRID_KEY = "strictDpadGridNavigation";
const SETTINGS_UI_STATE_KEY = "settingsScreenUiState";
const SETTINGS_RAIL_SCROLL_TARGET_RATIO = 0.42;
const SETTINGS_RAIL_SCROLL_STIFFNESS = 180;
const SETTINGS_RAIL_SCROLL_DAMPING_RATIO = 0.95;
const SETTINGS_MARQUEE_VELOCITY_PX_PER_SECOND = 90; // ATV 45dp/s -> 90px/s
const SETTINGS_VERSION_LABEL = formatSettingsVersionLabel(
  typeof __NUVIO_APP_VERSION__ !== "undefined" ? __NUVIO_APP_VERSION__ : "0.0.0"
);
const PRIVACY_URL = "https://tapframe.github.io/NuvioStreaming/#privacy-policy";

function formatHalfStepSettingValue(value, suffix = "") {
  const rounded = Math.round(Number(value || 0) * 2) / 2;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/, "");
  return `${text}${suffix}`;
}

const NEXT_EPISODE_THRESHOLD_MODE_OPTIONS = [
  { id: "PERCENTAGE", label: "Percentage" },
  { id: "MINUTES_BEFORE_END", label: "Minutes before end" }
];

const NEXT_EPISODE_THRESHOLD_PERCENT_OPTIONS = [97, 97.5, 98, 98.5, 99, 99.5, 100].map((value) => ({
  id: value,
  label: `${formatHalfStepSettingValue(value, "")}%`
}));

const NEXT_EPISODE_THRESHOLD_MINUTE_OPTIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((value) => ({
  id: value,
  label: `${formatHalfStepSettingValue(value, "")} min`
}));

const STILL_WATCHING_THRESHOLD_OPTIONS = [2, 3, 4, 5, 6].map((value) => ({
  id: value,
  label: String(value)
}));

const THEME_OPTIONS = [
  {
    id: "WHITE",
    labelKey: "settings.appearance.themes.white",
    color: "#f5f5f5",
    onColor: "#111111"
  },
  {
    id: "CRIMSON",
    labelKey: "settings.appearance.themes.crimson",
    color: "#e53935",
    onColor: "#ffffff"
  },
  {
    id: "OCEAN",
    labelKey: "settings.appearance.themes.ocean",
    color: "#1e88e5",
    onColor: "#ffffff"
  },
  {
    id: "VIOLET",
    labelKey: "settings.appearance.themes.violet",
    color: "#8e24aa",
    onColor: "#ffffff"
  },
  {
    id: "EMERALD",
    labelKey: "settings.appearance.themes.emerald",
    color: "#43a047",
    onColor: "#ffffff"
  },
  {
    id: "AMBER",
    labelKey: "settings.appearance.themes.amber",
    color: "#fb8c00",
    onColor: "#ffffff"
  },
  { id: "ROSE", labelKey: "settings.appearance.themes.rose", color: "#d81b60", onColor: "#ffffff" }
];

const FONT_OPTIONS = [
  { id: "INTER", label: "Inter" },
  { id: "DM_SANS", label: "DM Sans" },
  { id: "OPEN_SANS", label: "Open Sans" }
];

const APP_LANGUAGE_NATIVE_LABELS = {
  ar: "Arabic",
  bs: "Bosnian",
  cs: "Cestina",
  de: "Deutsch",
  en: "English",
  el: "Greek",
  es: "Espanol",
  "es-419": "Espanol (Latinoamerica)",
  fr: "Francais",
  he: "Hebrew",
  hi: "Hindi",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "Japanese",
  lt: "Lietuviu",
  nl: "Nederlands",
  no: "Norsk",
  pl: "Polski",
  "pt-br": "Portugues (Brasil)",
  "pt-pt": "Portugues (Portugal)",
  ro: "Romana",
  ru: "Russian",
  sk: "Slovencina",
  sl: "Slovenscina",
  sv: "Svenska",
  ta: "Tamil",
  tr: "Turkce",
  vi: "Tieng Viet",
  "zh-cn": "Chinese (Simplified)"
};

function appLanguageOptionLabel(localeId) {
  const normalized = String(localeId || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "System Default";
  }
  return APP_LANGUAGE_NATIVE_LABELS[normalized] || normalized.toUpperCase();
}

const LANGUAGE_OPTIONS = [
  { id: null, labelKey: "common.systemDefault" },
  ...I18n.getSupportedLocales()
    .map((localeId) => ({
      id: localeId,
      label: appLanguageOptionLabel(localeId)
    }))
    .sort((left, right) => String(left.label || "").localeCompare(String(right.label || "")))
];

// Shared language catalogue used to build the subtitle, audio and TMDB
// language pickers below.
const AVAILABLE_LANGUAGES = [
  { id: "af", label: "Afrikaans" },
  { id: "sq", label: "Albanian" },
  { id: "am", label: "Amharic" },
  { id: "ar", label: "Arabic" },
  { id: "hy", label: "Armenian" },
  { id: "az", label: "Azerbaijani" },
  { id: "eu", label: "Basque" },
  { id: "be", label: "Belarusian" },
  { id: "bn", label: "Bengali" },
  { id: "bs", label: "Bosnian" },
  { id: "bg", label: "Bulgarian" },
  { id: "my", label: "Burmese" },
  { id: "ca", label: "Catalan" },
  { id: "zh", label: "Chinese" },
  { id: "zh-cn", label: "Chinese (Simplified)" },
  { id: "zh-tw", label: "Chinese (Traditional)" },
  { id: "hr", label: "Croatian" },
  { id: "cs", label: "Czech" },
  { id: "da", label: "Danish" },
  { id: "nl", label: "Dutch" },
  { id: "en", label: "English" },
  { id: "et", label: "Estonian" },
  { id: "tl", label: "Filipino" },
  { id: "fi", label: "Finnish" },
  { id: "fr", label: "French" },
  { id: "gl", label: "Galician" },
  { id: "ka", label: "Georgian" },
  { id: "de", label: "German" },
  { id: "el", label: "Greek" },
  { id: "gu", label: "Gujarati" },
  { id: "he", label: "Hebrew" },
  { id: "hi", label: "Hindi" },
  { id: "hu", label: "Hungarian" },
  { id: "is", label: "Icelandic" },
  { id: "id", label: "Indonesian" },
  { id: "ga", label: "Irish" },
  { id: "it", label: "Italian" },
  { id: "ja", label: "Japanese" },
  { id: "kn", label: "Kannada" },
  { id: "kk", label: "Kazakh" },
  { id: "km", label: "Khmer" },
  { id: "ko", label: "Korean" },
  { id: "lo", label: "Lao" },
  { id: "lv", label: "Latvian" },
  { id: "lt", label: "Lithuanian" },
  { id: "mk", label: "Macedonian" },
  { id: "ms", label: "Malay" },
  { id: "ml", label: "Malayalam" },
  { id: "mt", label: "Maltese" },
  { id: "mr", label: "Marathi" },
  { id: "mn", label: "Mongolian" },
  { id: "ne", label: "Nepali" },
  { id: "no", label: "Norwegian" },
  { id: "pa", label: "Punjabi" },
  { id: "fa", label: "Persian" },
  { id: "pl", label: "Polish" },
  { id: "pt", label: "Portuguese (Portugal)" },
  { id: "pt-br", label: "Portuguese (Brazil)" },
  { id: "ro", label: "Romanian" },
  { id: "ru", label: "Russian" },
  { id: "sr", label: "Serbian" },
  { id: "si", label: "Sinhala" },
  { id: "sk", label: "Slovak" },
  { id: "sl", label: "Slovenian" },
  { id: "es", label: "Spanish" },
  { id: "es-419", label: "Spanish (Latin America)" },
  { id: "sw", label: "Swahili" },
  { id: "sv", label: "Swedish" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
  { id: "th", label: "Thai" },
  { id: "tr", label: "Turkish" },
  { id: "uk", label: "Ukrainian" },
  { id: "ur", label: "Urdu" },
  { id: "uz", label: "Uzbek" },
  { id: "vi", label: "Vietnamese" },
  { id: "cy", label: "Welsh" },
  { id: "zu", label: "Zulu" }
].sort((left, right) => left.label.localeCompare(right.label));

const PREFERRED_SUBTITLE_LANGUAGE_OPTIONS = [{ id: "off", label: "Off" }, ...AVAILABLE_LANGUAGES];

// Preferred audio language previously only offered System / English / Italian.
// The selected value is matched generically against each stream's audio tracks,
// so the full shared language catalogue can be offered.
const PREFERRED_PLAYBACK_LANGUAGE_OPTIONS = [
  { id: "system", labelKey: "common.system" },
  { id: "original", labelKey: "audio_lang_original", label: "Original language" },
  // "None" never auto-selects an audio track, leaving the stream's own
  // default playing (the player already treats "none" as no preference).
  { id: "none", labelKey: "common.none" },
  ...AVAILABLE_LANGUAGES
];

const STREAM_AUTOPLAY_MODE_OPTIONS = [
  {
    id: "MANUAL",
    labelKey: "autoplay_mode_manual",
    captionKey: "autoplay_mode_manual_desc",
    label: "Manual (choose stream)"
  },
  {
    id: "FIRST_STREAM",
    labelKey: "autoplay_mode_first",
    captionKey: "autoplay_mode_first_desc",
    label: "Auto-play first source"
  },
  {
    id: "REGEX_MATCH",
    labelKey: "autoplay_mode_regex",
    captionKey: "autoplay_mode_regex_desc",
    label: "Auto-play regex match"
  }
];

const STREAM_AUTOPLAY_SOURCE_OPTIONS = [
  {
    id: "ALL_SOURCES",
    labelKey: "autoplay_scope_all",
    captionKey: "autoplay_scope_all_desc",
    label: "All sources"
  },
  {
    id: "INSTALLED_ADDONS_ONLY",
    labelKey: "autoplay_scope_addons",
    captionKey: "autoplay_scope_addons_desc",
    label: "Installed addons only"
  },
  {
    id: "ENABLED_PLUGINS_ONLY",
    labelKey: "autoplay_scope_plugins",
    captionKey: "autoplay_scope_plugins_desc",
    label: "Enabled plugins only"
  }
];

const STREAM_AUTOPLAY_TIMEOUT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30]
  .map((seconds) => ({
    id: seconds,
    labelKey: seconds === 0 ? "autoplay_timeout_instant" : null,
    label: seconds === 0 ? "Instant" : `${seconds}s`
  }))
  .concat([{ id: 2147483647, labelKey: "autoplay_timeout_unlimited", label: "Unlimited" }]);

const STREAM_REUSE_CACHE_HOURS_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72, 168].map((hours) => ({
  id: hours,
  label: ""
}));

function labelForOptionId(options, id, fallback) {
  const match = options.find((option) => String(option.id) === String(id));
  return match ? translateOptionLabel(match, fallback) : fallback;
}

function formatReuseCacheDuration(hoursValue) {
  const hours = Math.min(168, Math.max(1, Math.trunc(Number(hoursValue) || 24)));
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (!remainingHours) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
}

// Subtitle appearance options, kept in sync with the in-player subtitle style
// rail (playerScreen.js): same colour palettes, same size/offset ranges so the
// settings screen and the player edit the exact same values. Mirrors the Android
// TV app, which exposes these under Settings > Playback > Subtitles.
const SUBTITLE_SIZE_OPTIONS = [
  { id: 50, label: "50%" },
  { id: 60, label: "60%" },
  { id: 70, label: "70%" },
  { id: 80, label: "80%" },
  { id: 90, label: "90%" },
  { id: 100, label: "100%" },
  { id: 110, label: "110%" },
  { id: 120, label: "120%" },
  { id: 130, label: "130%" },
  { id: 140, label: "140%" },
  { id: 150, label: "150%" },
  { id: 160, label: "160%" },
  { id: 170, label: "170%" },
  { id: 180, label: "180%" },
  { id: 190, label: "190%" },
  { id: 200, label: "200%" }
];

const SUBTITLE_OFFSET_OPTIONS = Array.from(
  { length: SUBTITLE_VERTICAL_OFFSET_MAX - SUBTITLE_VERTICAL_OFFSET_MIN + 1 },
  (_, index) => {
    const value = SUBTITLE_VERTICAL_OFFSET_MIN + index;
    return {
      id: value,
      label: value === SUBTITLE_VERTICAL_OFFSET_DEFAULT ? `Default (${value}%)` : `${value}%`
    };
  }
);

const SUBTITLE_TEXT_COLOR_OPTIONS = [
  { id: "#FFFFFF", label: "White" },
  { id: "#D9D9D9", label: "Silver" },
  { id: "#FFD700", label: "Gold" },
  { id: "#00E5FF", label: "Cyan" },
  { id: "#FF5C5C", label: "Red" },
  { id: "#00FF88", label: "Green" }
];

const SUBTITLE_OUTLINE_COLOR_OPTIONS = [
  { id: "#000000", label: "Black" },
  { id: "#FFFFFF", label: "White" },
  { id: "#00E5FF", label: "Cyan" },
  { id: "#FF5C5C", label: "Red" }
];

function normalizeSubtitleStyleHex(value, fallback) {
  const hex = String(value || "")
    .trim()
    .toUpperCase();
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : fallback;
}

function clampSubtitleSize(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return 120;
  }
  return Math.min(200, Math.max(50, parsed));
}

function clampSubtitleOffset(value) {
  return normalizeSubtitleVerticalOffset(value);
}

const TMDB_LANGUAGE_OPTIONS = [
  { id: "en", label: "English" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "en-CA", label: "English (Canada)" },
  { id: "en-GB", label: "English (United Kingdom)" },
  ...AVAILABLE_LANGUAGES.filter((option) => option.id !== "en")
].sort((left, right) => String(left.label || "").localeCompare(String(right.label || "")));

const DEBRID_PREPARE_LIMIT_OPTIONS = [
  { id: 0, labelKey: "common.off", label: "Off" },
  { id: 1, labelKey: "settings.integration.debrid.prepare.countOne", label: "1 link" },
  {
    id: 2,
    labelKey: "settings.integration.debrid.prepare.countMany",
    labelParams: { count: 2 },
    label: "2 links"
  },
  {
    id: 3,
    labelKey: "settings.integration.debrid.prepare.countMany",
    labelParams: { count: 3 },
    label: "3 links"
  },
  {
    id: 5,
    labelKey: "settings.integration.debrid.prepare.countMany",
    labelParams: { count: 5 },
    label: "5 links"
  }
];

const DEBRID_PREPARE_COUNT_OPTIONS = DEBRID_PREPARE_LIMIT_OPTIONS.filter(
  (option) => Number(option.id) > 0
);

const DEBRID_MAX_RESULTS_OPTIONS = [
  { id: 0, labelKey: "settings.integration.debrid.maxResults.all", label: "All streams" },
  {
    id: 5,
    labelKey: "settings.integration.debrid.maxResults.count",
    labelParams: { count: 5 },
    label: "5 streams"
  },
  {
    id: 10,
    labelKey: "settings.integration.debrid.maxResults.count",
    labelParams: { count: 10 },
    label: "10 streams"
  },
  {
    id: 20,
    labelKey: "settings.integration.debrid.maxResults.count",
    labelParams: { count: 20 },
    label: "20 streams"
  },
  {
    id: 50,
    labelKey: "settings.integration.debrid.maxResults.count",
    labelParams: { count: 50 },
    label: "50 streams"
  }
];

const DEBRID_SORT_PROFILE_OPTIONS = [
  { id: "ORIGINAL", labelKey: "debrid_stream_sort_original", label: "Original order" },
  { id: "BEST_QUALITY", labelKey: "debrid_stream_sort_best_quality", label: "Best quality first" },
  { id: "LARGEST", labelKey: "debrid_stream_sort_largest", label: "Largest first" },
  { id: "SMALLEST", labelKey: "debrid_stream_sort_smallest", label: "Smallest first" },
  { id: "AUDIO", labelKey: "debrid_stream_sort_best_audio", label: "Best audio first" },
  { id: "LANGUAGE", labelKey: "debrid_stream_sort_language", label: "Language first" }
];

const DEBRID_SIZE_RANGE_OPTIONS = [
  { id: "0:0", min: 0, max: 0 },
  { id: "0:5", min: 0, max: 5 },
  { id: "0:10", min: 0, max: 10 },
  { id: "5:20", min: 5, max: 20 },
  { id: "10:50", min: 10, max: 50 },
  { id: "20:100", min: 20, max: 100 }
];

const DEBRID_MIN_QUALITY_OPTIONS = [
  { id: "ANY", labelKey: "settings.integration.debrid.minQuality.any", label: "Any quality" },
  { id: "P720", labelKey: "settings.integration.debrid.minQuality.720", label: "720p and above" },
  {
    id: "P1080",
    labelKey: "settings.integration.debrid.minQuality.1080",
    label: "1080p and above"
  },
  { id: "P2160", labelKey: "settings.integration.debrid.minQuality.2160", label: "4K only" }
];

const DEBRID_FEATURE_FILTER_OPTIONS = [
  { id: "ANY", labelKey: "settings.integration.debrid.feature.any", label: "Any" },
  { id: "EXCLUDE", labelKey: "settings.integration.debrid.feature.exclude", label: "Hide" },
  { id: "ONLY", labelKey: "settings.integration.debrid.feature.only", label: "Only" }
];

const DEBRID_CODEC_OPTIONS = [
  { id: "ANY", labelKey: "settings.integration.debrid.codec.any", label: "Any codec" },
  { id: "H264", labelKey: "settings.integration.debrid.codec.h264", label: "H.264 / AVC" },
  { id: "HEVC", labelKey: "settings.integration.debrid.codec.hevc", label: "HEVC / H.265" },
  { id: "AV1", labelKey: "settings.integration.debrid.codec.av1", label: "AV1" }
];

const HOME_LAYOUT_OPTIONS = [
  {
    id: "modern",
    labelKey: "settings.layout.homeLayouts.modern.label",
    captionKey: "settings.layout.homeLayouts.modern.caption"
  },
  {
    id: "grid",
    labelKey: "settings.layout.homeLayouts.grid.label",
    captionKey: "settings.layout.homeLayouts.grid.caption"
  },
  {
    id: "classic",
    labelKey: "settings.layout.homeLayouts.classic.label",
    captionKey: "settings.layout.homeLayouts.classic.caption"
  }
];

const TRAKT_CONTINUE_WATCHING_DAY_OPTIONS = [
  14,
  30,
  60,
  90,
  180,
  365,
  TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL
];

const TRAKT_WATCH_PROGRESS_OPTIONS = [
  { id: WatchProgressSource.TRAKT, labelKey: "trakt_watch_progress_source_trakt" },
  { id: WatchProgressSource.NUVIO_SYNC, labelKey: "trakt_watch_progress_source_nuvio" }
];

const TRAKT_LIBRARY_SOURCE_OPTIONS = [
  { id: TraktLibrarySourceMode.TRAKT, labelKey: "trakt_library_source_trakt" },
  { id: TraktLibrarySourceMode.LOCAL, labelKey: "trakt_library_source_nuvio" }
];

const TRAKT_COMMENTS_OPTIONS = [
  { id: "on", labelKey: "trakt_setting_on" },
  { id: "off", labelKey: "trakt_setting_off" }
];

const SECTION_META = [
  {
    id: "account",
    labelKey: "settings.sections.account.label",
    subtitleKey: "settings.sections.account.subtitle"
  },
  {
    id: "profiles",
    labelKey: "settings.sections.profiles.label",
    subtitleKey: "settings.sections.profiles.subtitle"
  },
  {
    id: "appearance",
    labelKey: "settings.sections.appearance.label",
    subtitleKey: "settings.sections.appearance.subtitle"
  },
  {
    id: "layout",
    labelKey: "settings.sections.layout.label",
    subtitleKey: "settings.sections.layout.subtitle"
  },
  {
    id: "contentDiscovery",
    labelKey: "settings.sections.contentDiscovery.label",
    label: "Content & Discovery",
    subtitleKey: "settings.sections.contentDiscovery.subtitle",
    subtitle: "Add-ons, plugins, catalogs, and discovery sources"
  },
  {
    id: "plugins",
    labelKey: "settings.sections.plugins.label",
    subtitleKey: "settings.sections.plugins.subtitle",
    hideFromNav: true
  },
  {
    id: "integration",
    labelKey: "settings.sections.integration.label",
    subtitleKey: "settings.sections.integration.subtitle"
  },
  {
    id: "streams",
    labelKey: "settings_stream_badges_section",
    subtitle: "Import and manage Fusion badge URLs"
  },
  {
    id: "playback",
    labelKey: "settings.sections.playback.label",
    subtitleKey: "settings.sections.playback.subtitle"
  },
  {
    id: "trakt",
    labelKey: "settings.sections.trakt.label",
    subtitleKey: "settings.sections.trakt.subtitle"
  },
  {
    id: "advanced",
    labelKey: "settings_advanced",
    subtitleKey: "settings_advanced_subtitle"
  },
  {
    id: "about",
    labelKey: "settings.sections.about.label",
    subtitleKey: "settings.sections.about.subtitle"
  }
];

const SECTION_ICONS = {
  account: "person",
  profiles: "people",
  appearance: "palette",
  layout: "grid_view",
  contentDiscovery: "explore",
  plugins: "build",
  integration: "link",
  streams: "style",
  advanced: "tune",
  trakt: "trakt",
  about: "info"
};

const ROW_ICONS = {
  external:
    '<path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14z"></path><path d="M5 5h7v2H7v10h10v-5h2v7H5z"></path>',
  chevron: '<path d="m9 6 6 6-6 6"></path>',
  expand: '<path d="m7 10 5 5 5-5"></path>',
  qr: '<path d="M3 3h7v7H3zm2 2v3h3V5zm6-2h2v2h-2zm3 0h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3zm8-1h2v2h-2zm2 2h2v2h-2zm-4 0h2v2h-2zm8-3h2v2h-2zm-6 6h2v2h-2zm3-3h5v5h-5zm2 2v1h1v-1z"></path>',
  phone:
    '<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5zm4 15h2v1h-2z"></path>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"></path>',
  back: '<path d="m15 6-6 6 6 6"></path>',
  check: '<path d="m5 13 4 4L19 7"></path>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"></path><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"></path>',
  trash:
    '<path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 12h10l1-12"></path><path d="M9 7V4h6v3"></path>',
  plugins:
    '<path d="m11 17-5-5.28 1.4-1.42 3.6 3.8L17.6 7.5 19 8.92 11 17zM12 22q-2.075 0-3.9-.788t-3.175-2.137Q3.6 17.725 2.8 15.9T2 12q0-2.075.788-3.9t2.137-3.175Q6.275 3.6 8.1 2.8T12 2q2.075 0 3.9.788t3.175 2.137Q20.4 6.275 21.2 8.1T22 12q0 2.075-.788 3.9t-2.137 3.175Q17.725 20.4 15.9 21.2T12 22z"></path>'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatSettingsVersionLabel(value) {
  const normalized = String(value || "").trim();
  const shortMatch = normalized.match(/^(\d+\.\d+)\.0$/);
  if (shortMatch) {
    return shortMatch[1];
  }
  return normalized || "0.0.0";
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function renderLayoutPreviewMarkup(layoutId) {
  const normalized = String(layoutId || "classic").toLowerCase();
  if (normalized === "modern") {
    return `
      <span class="settings-layout-preview-modern-stage">
        <span class="settings-layout-preview-modern-hero"></span>
        <span class="settings-layout-preview-modern-row">
          ${Array.from({ length: 12 }, (_, index) => `<span class="settings-layout-preview-modern-card${index % 3 === 1 ? " is-strong" : ""}"></span>`).join("")}
        </span>
      </span>
    `;
  }

  if (normalized === "grid") {
    return `
      <span class="settings-layout-preview-grid-canvas">
        ${Array.from(
          { length: 35 },
          (_, index) => `
          <span class="settings-layout-preview-grid-cell${Math.floor(index / 5) % 3 === 2 ? " is-dim" : ""}"></span>
        `
        ).join("")}
      </span>
    `;
  }

  return `
    <span class="settings-layout-preview-classic-stage">
      <span class="settings-layout-preview-classic-row is-top">
        ${Array.from({ length: 7 }, () => '<span class="settings-layout-preview-classic-card"></span>').join("")}
      </span>
      <span class="settings-layout-preview-classic-row is-featured">
        ${Array.from({ length: 7 }, () => '<span class="settings-layout-preview-classic-card is-strong"></span>').join("")}
      </span>
      <span class="settings-layout-preview-classic-row is-bottom">
        ${Array.from({ length: 7 }, () => '<span class="settings-layout-preview-classic-card"></span>').join("")}
      </span>
    </span>
  `;
}

function renderLayoutPreviewPlaceholderMarkup() {
  return `
    <span class="settings-layout-preview-placeholder" aria-hidden="true">
      <span class="settings-layout-placeholder-line is-short"></span>
      <span class="settings-layout-placeholder-panel"></span>
      <span class="settings-layout-placeholder-bars">
        <span class="settings-layout-placeholder-line"></span>
        <span class="settings-layout-placeholder-line"></span>
        <span class="settings-layout-placeholder-line"></span>
      </span>
    </span>
  `;
}

function setLayoutPreviewMetric(node, name, value) {
  if (!node?.style || !Number.isFinite(value)) return;
  node.style.setProperty(name, `${Math.round(value * 100) / 100}px`);
}

function syncLayoutPreviewMetrics(root) {
  const previews = Array.from(root?.querySelectorAll?.(".settings-layout-preview") || []);
  previews.forEach((preview) => {
    const card = preview.closest?.(".settings-layout-card");
    const cardRect = card?.getBoundingClientRect?.();
    if (!card || !cardRect) return;

    const cardStyle = getComputedStyle(card);
    const previewStyle = getComputedStyle(preview);
    const paddingX =
      (parseFloat(cardStyle.paddingLeft) || 0) + (parseFloat(cardStyle.paddingRight) || 0);
    const borderX =
      (parseFloat(cardStyle.borderLeftWidth) || 0) + (parseFloat(cardStyle.borderRightWidth) || 0);
    const previewRect = preview.getBoundingClientRect?.();
    const width = Math.max(0, previewRect?.width || cardRect.width - paddingX - borderX);
    const height = Math.max(0, parseFloat(previewStyle.height) || previewRect?.height || 224);
    if (!width || !height) return;

    if (preview.classList.contains("settings-layout-preview-modern")) {
      const cardHeight = height * 0.24;
      const cardWidth = cardHeight * 1.45;
      const gap = width * 0.03;
      setLayoutPreviewMetric(preview, "--settings-layout-modern-card-width", cardWidth);
      setLayoutPreviewMetric(preview, "--settings-layout-modern-gap", gap);
      setLayoutPreviewMetric(
        preview,
        "--settings-layout-modern-cycle-width",
        (cardWidth + gap) * 3
      );
      return;
    }

    if (preview.classList.contains("settings-layout-preview-grid")) {
      const gap = width * 0.025;
      const cardWidth = (width - gap * 6) / 5;
      const cardHeight = cardWidth * 1.4;
      setLayoutPreviewMetric(preview, "--settings-layout-grid-gap", gap);
      setLayoutPreviewMetric(preview, "--settings-layout-grid-card-width", cardWidth);
      setLayoutPreviewMetric(preview, "--settings-layout-grid-card-height", cardHeight);
      setLayoutPreviewMetric(
        preview,
        "--settings-layout-grid-canvas-height",
        cardHeight * 7 + gap * 6
      );
      setLayoutPreviewMetric(
        preview,
        "--settings-layout-grid-cycle-height",
        (cardHeight + gap) * 3
      );
      return;
    }

    if (preview.classList.contains("settings-layout-preview-classic")) {
      const rowSpacing = height * 0.04;
      const rowHeight = (height - rowSpacing * 4) / 3;
      const cardWidth = width / 5.5;
      const gap = width / 40;
      setLayoutPreviewMetric(preview, "--settings-layout-classic-row-spacing", rowSpacing);
      setLayoutPreviewMetric(preview, "--settings-layout-classic-row-height", rowHeight);
      setLayoutPreviewMetric(preview, "--settings-layout-classic-card-width", cardWidth);
      setLayoutPreviewMetric(preview, "--settings-layout-classic-gap", gap);
      setLayoutPreviewMetric(
        preview,
        "--settings-layout-classic-cycle-width",
        (cardWidth + gap) * 2
      );
    }
  });
}

function syncLayoutPreviewMetricsSoon(root) {
  if (!root) return;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => syncLayoutPreviewMetrics(root));
    return;
  }
  syncLayoutPreviewMetrics(root);
}

function iconSvg(path, className = "settings-inline-icon", viewBox = "0 0 24 24") {
  return `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${path}</svg>`;
}

function translateOptionLabel(option, fallback = "") {
  if (!option) {
    return fallback;
  }
  if (option.labelKey) {
    return t(option.labelKey, option.labelParams || {}, option.label || fallback);
  }
  return String(option.label || fallback);
}

function translateOptionCaption(option, fallback = "") {
  if (!option) {
    return fallback;
  }
  if (option.captionKey) {
    return t(option.captionKey, option.captionParams || {}, option.caption || fallback);
  }
  return String(option.caption || fallback);
}

function translateSectionCopy(section) {
  if (!section) {
    return { label: "", subtitle: "" };
  }
  return {
    label: section.labelKey
      ? t(section.labelKey, section.labelParams || {}, section.label || "")
      : String(section.label || ""),
    subtitle: section.subtitleKey
      ? t(section.subtitleKey, section.subtitleParams || {}, section.subtitle || "")
      : String(section.subtitle || "")
  };
}

function renderSectionNavIcon(sectionId) {
  if (sectionId === "trakt") {
    return '<img class="settings-nav-icon settings-nav-icon-image" src="assets/icons/trakt_tv_glyph.svg" alt="" aria-hidden="true" />';
  }
  if (sectionId === "playback") {
    return iconSvg(
      '<path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"></path>',
      "settings-nav-icon settings-nav-icon-svg"
    );
  }
  const iconName = SECTION_ICONS[sectionId] || "settings";
  return `<span class="settings-nav-icon settings-nav-icon-material material-icons" aria-hidden="true">${iconName}</span>`;
}

function cycleOption(options, currentValue) {
  const index = options.findIndex((option) => String(option.id) === String(currentValue));
  if (index < 0 || index === options.length - 1) {
    return options[0];
  }
  return options[index + 1];
}

function maskValue(value, fallback) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.length <= 4) {
    return "••••";
  }
  return `••••••${trimmed.slice(-4)}`;
}

function labelForTheme(themeName) {
  return translateOptionLabel(
    THEME_OPTIONS.find((item) => item.id === String(themeName || "").toUpperCase()),
    t("settings.appearance.themes.white")
  );
}

function labelForFont(fontFamily) {
  return (
    FONT_OPTIONS.find((item) => item.id === String(fontFamily || "").toUpperCase())?.label ||
    "Inter"
  );
}

function labelForLanguage(language) {
  return translateOptionLabel(
    LANGUAGE_OPTIONS.find((item) => String(item.id) === String(language)),
    t("common.systemDefault")
  );
}

function labelForLayout(layout) {
  return translateOptionLabel(
    HOME_LAYOUT_OPTIONS.find((item) => item.id === String(layout || "").toLowerCase()),
    t("settings.layout.homeLayouts.classic.label")
  );
}

function labelForTraktContinueWatchingDays(days) {
  const normalizedDays = Number(days || 0);
  if (normalizedDays === TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL) {
    return t("trakt_all_history", {}, "All history");
  }
  return t("trakt_days_format", [normalizedDays], `${normalizedDays} days`);
}

function labelForTraktWatchProgressSource(source) {
  return translateOptionLabel(
    TRAKT_WATCH_PROGRESS_OPTIONS.find(
      (item) => item.id === String(source || WatchProgressSource.TRAKT)
    ),
    t("trakt_watch_progress_source_trakt", {}, "Trakt")
  );
}

function labelForTraktLibrarySource(mode) {
  return translateOptionLabel(
    TRAKT_LIBRARY_SOURCE_OPTIONS.find(
      (item) => item.id === String(mode || TraktLibrarySourceMode.TRAKT)
    ),
    t("trakt_library_source_trakt", {}, "Trakt")
  );
}

function labelForTraktComments(enabled) {
  return enabled ? t("trakt_setting_on", {}, "On") : t("trakt_setting_off", {}, "Off");
}

function formatTraktDuration(valueMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(valueMs || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderTraktCountdownText(key, remainingMs, fallbackPrefix, attributeName) {
  const duration = formatTraktDuration(remainingMs);
  const text = t(key, [duration], `${fallbackPrefix} ${duration}`);
  const escapedDuration = escapeHtml(duration);
  return escapeHtml(text).replace(
    escapedDuration,
    `<span ${attributeName}>${escapedDuration}</span>`
  );
}

function createTraktQrDataUrl(userCode) {
  if (!userCode || typeof document === "undefined") {
    return "";
  }
  try {
    const canvas = document.createElement("canvas");
    QrCodeGenerator.generate(
      canvas,
      `https://trakt.tv/activate/${encodeURIComponent(userCode)}`,
      420
    );
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("Failed to generate Trakt QR", error);
    return "";
  }
}

function labelForTmdbLanguage(language) {
  const normalized = normalizeTmdbLanguageCode(language);
  return translateOptionLabel(
    TMDB_LANGUAGE_OPTIONS.find((item) => String(item.id) === normalized),
    String(language || normalized || "en")
  );
}

function labelForPlaybackLanguage(language) {
  return translateOptionLabel(
    PREFERRED_PLAYBACK_LANGUAGE_OPTIONS.find((item) => String(item.id) === String(language)),
    t("common.system")
  );
}

function labelForDebridProvider(providerId) {
  const provider = DebridProviders.byId(providerId);
  return provider?.displayName || t("common.none", {}, "None");
}

function labelForOption(options, value, fallback = "") {
  return translateOptionLabel(
    options.find((option) => String(option.id) === String(value)),
    fallback || String(value ?? "")
  );
}

function sameDebridSortCriteria(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every(
    (criterion, index) =>
      criterion?.key === right[index]?.key && criterion?.direction === right[index]?.direction
  );
}

function debridSortProfileFor(criteria = []) {
  const normalized = Array.isArray(criteria) ? criteria : [];
  const legacyQuality = [
    { key: "RESOLUTION", direction: "DESC" },
    { key: "QUALITY", direction: "DESC" },
    { key: "SIZE", direction: "DESC" }
  ];
  if (!normalized.length) return "ORIGINAL";
  if (
    sameDebridSortCriteria(normalized, DEBRID_SORT_PROFILES.BEST_QUALITY) ||
    sameDebridSortCriteria(normalized, legacyQuality)
  ) {
    return "BEST_QUALITY";
  }
  if (sameDebridSortCriteria(normalized, DEBRID_SORT_PROFILES.LARGEST)) return "LARGEST";
  if (sameDebridSortCriteria(normalized, DEBRID_SORT_PROFILES.SMALLEST)) return "SMALLEST";
  if (
    normalized[0]?.key === "AUDIO_TAG" &&
    normalized[0]?.direction === "DESC" &&
    normalized[1]?.key === "AUDIO_CHANNEL" &&
    normalized[1]?.direction === "DESC"
  ) {
    return "AUDIO";
  }
  if (normalized[0]?.key === "LANGUAGE" && normalized[0]?.direction === "DESC") {
    return "LANGUAGE";
  }
  return "BEST_QUALITY";
}

function debridSortProfileLabel(criteria = []) {
  return labelForOption(
    DEBRID_SORT_PROFILE_OPTIONS,
    debridSortProfileFor(criteria),
    t("debrid_stream_sort_best_quality", {}, "Best quality first")
  );
}

function debridSelectionCountLabel(values = []) {
  const count = Array.isArray(values) ? values.length : 0;
  if (!count) {
    return t("debrid_selection_count_any", {}, "Any");
  }
  return t("debrid_selection_count_value", { count }, `${count} selected`);
}

function debridSizeRangeId(preferences = {}) {
  const min = Math.max(0, Math.trunc(Number(preferences.sizeMinGb || 0)));
  const max = Math.max(0, Math.trunc(Number(preferences.sizeMaxGb || 0)));
  return `${min}:${max}`;
}

function debridSizeRangeLabel(minGb = 0, maxGb = 0) {
  const min = Math.max(0, Math.trunc(Number(minGb || 0)));
  const max = Math.max(0, Math.trunc(Number(maxGb || 0)));
  if (min <= 0 && max <= 0) {
    return t("debrid_size_range_any", {}, "Any");
  }
  if (min <= 0) {
    return t("debrid_size_range_up_to", { count: max, max }, `Up to ${max} GB`);
  }
  if (max <= 0) {
    return t("debrid_size_range_min_plus", { count: min, min }, `${min} GB+`);
  }
  return t("debrid_size_range_min_max", { min, max }, `${min}-${max} GB`);
}

function debridOptionList(items = []) {
  return items.map((item) => ({ id: item.id, label: item.label }));
}

function debridRuleRows(preferences = {}) {
  return [
    {
      field: "preferredResolutions",
      titleKey: "debrid_picker_preferred_resolutions_title",
      subtitleKey: "debrid_picker_preferred_resolutions_subtitle",
      dialogTitleKey: "debrid_stream_resolutions_preferred",
      options: debridOptionList(DEBRID_STREAM_RESOLUTIONS),
      defaultWhenEmpty: DEFAULT_STREAM_PREFERENCES.preferredResolutions
    },
    {
      field: "requiredResolutions",
      titleKey: "debrid_picker_required_resolutions_title",
      subtitleKey: "debrid_picker_required_resolutions_subtitle",
      dialogTitleKey: "debrid_stream_resolutions_required",
      options: debridOptionList(DEBRID_STREAM_RESOLUTIONS)
    },
    {
      field: "excludedResolutions",
      titleKey: "debrid_picker_excluded_resolutions_title",
      subtitleKey: "debrid_picker_excluded_resolutions_subtitle",
      dialogTitleKey: "debrid_stream_resolutions_excluded",
      options: debridOptionList(DEBRID_STREAM_RESOLUTIONS)
    },
    {
      field: "preferredQualities",
      titleKey: "debrid_picker_preferred_qualities_title",
      subtitleKey: "debrid_picker_preferred_qualities_subtitle",
      dialogTitleKey: "debrid_stream_qualities_preferred",
      options: debridOptionList(DEBRID_STREAM_QUALITIES),
      defaultWhenEmpty: DEFAULT_STREAM_PREFERENCES.preferredQualities
    },
    {
      field: "requiredQualities",
      titleKey: "debrid_picker_required_qualities_title",
      subtitleKey: "debrid_picker_required_qualities_subtitle",
      dialogTitleKey: "debrid_stream_qualities_required",
      options: debridOptionList(DEBRID_STREAM_QUALITIES)
    },
    {
      field: "excludedQualities",
      titleKey: "debrid_picker_excluded_qualities_title",
      subtitleKey: "debrid_picker_excluded_qualities_subtitle",
      dialogTitleKey: "debrid_stream_qualities_excluded",
      options: debridOptionList(DEBRID_STREAM_QUALITIES)
    },
    {
      field: "preferredVisualTags",
      titleKey: "debrid_picker_preferred_visual_tags_title",
      subtitleKey: "debrid_picker_preferred_visual_tags_subtitle",
      dialogTitleKey: "debrid_stream_visual_tags_preferred",
      options: debridOptionList(DEBRID_STREAM_VISUAL_TAGS),
      defaultWhenEmpty: DEFAULT_STREAM_PREFERENCES.preferredVisualTags
    },
    {
      field: "requiredVisualTags",
      titleKey: "debrid_picker_required_visual_tags_title",
      subtitleKey: "debrid_picker_required_visual_tags_subtitle",
      dialogTitleKey: "debrid_stream_visual_tags_required",
      options: debridOptionList(DEBRID_STREAM_VISUAL_TAGS)
    },
    {
      field: "excludedVisualTags",
      titleKey: "debrid_picker_excluded_visual_tags_title",
      subtitleKey: "debrid_picker_excluded_visual_tags_subtitle",
      dialogTitleKey: "debrid_stream_visual_tags_excluded",
      options: debridOptionList(DEBRID_STREAM_VISUAL_TAGS)
    },
    {
      field: "preferredAudioTags",
      titleKey: "debrid_picker_preferred_audio_tags_title",
      subtitleKey: "debrid_picker_preferred_audio_tags_subtitle",
      dialogTitleKey: "debrid_stream_audio_tags_preferred",
      options: debridOptionList(DEBRID_STREAM_AUDIO_TAGS),
      defaultWhenEmpty: DEFAULT_STREAM_PREFERENCES.preferredAudioTags
    },
    {
      field: "requiredAudioTags",
      titleKey: "debrid_picker_required_audio_tags_title",
      subtitleKey: "debrid_picker_required_audio_tags_subtitle",
      dialogTitleKey: "debrid_stream_audio_tags_required",
      options: debridOptionList(DEBRID_STREAM_AUDIO_TAGS)
    },
    {
      field: "excludedAudioTags",
      titleKey: "debrid_picker_excluded_audio_tags_title",
      subtitleKey: "debrid_picker_excluded_audio_tags_subtitle",
      dialogTitleKey: "debrid_stream_audio_tags_excluded",
      options: debridOptionList(DEBRID_STREAM_AUDIO_TAGS)
    },
    {
      field: "preferredAudioChannels",
      titleKey: "debrid_picker_preferred_audio_channels_title",
      subtitleKey: "debrid_picker_preferred_audio_channels_subtitle",
      dialogTitleKey: "debrid_stream_channels_preferred",
      options: debridOptionList(DEBRID_STREAM_AUDIO_CHANNELS),
      defaultWhenEmpty: DEFAULT_STREAM_PREFERENCES.preferredAudioChannels
    },
    {
      field: "requiredAudioChannels",
      titleKey: "debrid_picker_required_audio_channels_title",
      subtitleKey: "debrid_picker_required_audio_channels_subtitle",
      dialogTitleKey: "debrid_stream_channels_required",
      options: debridOptionList(DEBRID_STREAM_AUDIO_CHANNELS)
    },
    {
      field: "excludedAudioChannels",
      titleKey: "debrid_picker_excluded_audio_channels_title",
      subtitleKey: "debrid_picker_excluded_audio_channels_subtitle",
      dialogTitleKey: "debrid_stream_channels_excluded",
      options: debridOptionList(DEBRID_STREAM_AUDIO_CHANNELS)
    },
    {
      field: "preferredEncodes",
      titleKey: "debrid_picker_preferred_encodes_title",
      subtitleKey: "debrid_picker_preferred_encodes_subtitle",
      dialogTitleKey: "debrid_stream_encodes_preferred",
      options: debridOptionList(DEBRID_STREAM_ENCODES),
      defaultWhenEmpty: DEFAULT_STREAM_PREFERENCES.preferredEncodes
    },
    {
      field: "requiredEncodes",
      titleKey: "debrid_picker_required_encodes_title",
      subtitleKey: "debrid_picker_required_encodes_subtitle",
      dialogTitleKey: "debrid_stream_encodes_required",
      options: debridOptionList(DEBRID_STREAM_ENCODES)
    },
    {
      field: "excludedEncodes",
      titleKey: "debrid_picker_excluded_encodes_title",
      subtitleKey: "debrid_picker_excluded_encodes_subtitle",
      dialogTitleKey: "debrid_stream_encodes_excluded",
      options: debridOptionList(DEBRID_STREAM_ENCODES)
    },
    {
      field: "preferredLanguages",
      titleKey: "debrid_picker_preferred_languages_title",
      subtitleKey: "debrid_picker_preferred_languages_subtitle",
      dialogTitleKey: "debrid_stream_languages_preferred",
      options: debridOptionList(DEBRID_STREAM_LANGUAGES)
    },
    {
      field: "requiredLanguages",
      titleKey: "debrid_picker_required_languages_title",
      subtitleKey: "debrid_picker_required_languages_subtitle",
      dialogTitleKey: "debrid_stream_languages_required",
      options: debridOptionList(DEBRID_STREAM_LANGUAGES)
    },
    {
      field: "excludedLanguages",
      titleKey: "debrid_picker_excluded_languages_title",
      subtitleKey: "debrid_picker_excluded_languages_subtitle",
      dialogTitleKey: "debrid_stream_languages_excluded",
      options: debridOptionList(DEBRID_STREAM_LANGUAGES)
    },
    {
      field: "requiredReleaseGroups",
      titleKey: "debrid_picker_required_release_groups_title",
      subtitleKey: "debrid_picker_required_release_groups_subtitle",
      dialogTitleKey: "debrid_stream_release_groups_required",
      textList: true
    },
    {
      field: "excludedReleaseGroups",
      titleKey: "debrid_picker_excluded_release_groups_title",
      subtitleKey: "debrid_picker_excluded_release_groups_subtitle",
      dialogTitleKey: "debrid_stream_release_groups_excluded",
      textList: true
    }
  ].map((row) => ({
    ...row,
    selectedValues: Array.isArray(preferences[row.field]) ? preferences[row.field] : []
  }));
}

async function validateDebridApiKey(providerId, apiKey) {
  const normalized = String(apiKey || "").trim();
  if (!normalized) {
    return true;
  }
  const provider = DebridProviders.byId(providerId);
  if (!provider) {
    return false;
  }
  if (provider.id === "torbox") {
    return DebridApi.validateTorboxApiKey(normalized);
  }
  if (provider.id === "premiumize") {
    return DebridApi.validatePremiumizeApiKey(normalized);
  }
  if (provider.id === "realdebrid") {
    return DebridApi.validateRealDebridApiKey(normalized);
  }
  return false;
}

function normalizeSelectableSubtitleLanguageCode(language) {
  const code = String(language ?? "")
    .trim()
    .toLowerCase();
  if (!code) {
    return "off";
  }
  switch (code) {
    case "pt-br":
    case "pt_br":
    case "br":
    case "pob":
      return "pt-br";
    case "pt-pt":
    case "pt_pt":
    case "por":
      return "pt";
    case "forced":
    case "force":
    case "forc":
      return "forced";
    case "none":
    case "off":
      return "off";
    default:
      return code;
  }
}

function normalizeTmdbLanguageCode(language) {
  const code = String(language ?? "")
    .trim()
    .replace(/_/g, "-");
  if (!code) {
    return "en";
  }

  switch (code.toLowerCase()) {
    case "en":
    case "en-us":
      return "en";
    case "en-au":
      return "en-AU";
    case "en-ca":
      return "en-CA";
    case "en-gb":
      return "en-GB";
    case "it-it":
      return "it";
    case "es-es":
      return "es";
    case "pt-pt":
      return "pt";
    default:
      return code.toLowerCase();
  }
}

function labelForSubtitlePlaybackLanguage(language) {
  const normalized = normalizeSelectableSubtitleLanguageCode(language);
  return translateOptionLabel(
    PREFERRED_SUBTITLE_LANGUAGE_OPTIONS.find((item) => String(item.id) === normalized),
    normalized === "off"
      ? "Off"
      : normalized === "forced"
        ? t("settings.playback.useForcedSubtitles.title", {}, "Use forced subtitles")
        : normalized === "system"
          ? t("common.system")
          : String(language || "system")
  );
}

function subtitleLanguageOptionCode(option) {
  const normalized = normalizeSelectableSubtitleLanguageCode(option?.id);
  if (!normalized || normalized === "off") {
    return "";
  }
  return normalized.toUpperCase();
}

function renderModeLabel(value) {
  return String(value || "native").toLowerCase() === "html"
    ? t("common.htmlOverlay")
    : t("common.native");
}

function escapeSelector(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

function plannedSubtitle(subtitle) {
  return subtitle
    ? t("common.comingSoonWithContext", { subject: subtitle })
    : t("common.comingSoon");
}

function focusKeySelector(selector, key) {
  return `${selector}[data-focus-key="${escapeSelector(String(key))}"]`;
}

function isSettingsActivateEvent(event) {
  const code = Number(event?.keyCode || event?.which || 0);
  const key = String(event?.key || "");
  return (
    code === 13 ||
    code === 23 ||
    key === "Enter" ||
    key === "NumpadEnter" ||
    key === "OK" ||
    key === "Select"
  );
}

function scrollIntoNearestView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }
  try {
    node.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  } catch (_) {
    node.scrollIntoView();
  }
}

function getScrollMax(node, axis = "y") {
  if (!node) {
    return 0;
  }
  return Math.max(
    0,
    axis === "x" ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight
  );
}

function getScrollPosition(node, axis = "y") {
  return Number(axis === "x" ? node?.scrollLeft || 0 : node?.scrollTop || 0);
}

function setScrollPosition(node, value, axis = "y") {
  if (!node) {
    return;
  }
  if (axis === "x") {
    node.scrollLeft = value;
    return;
  }
  node.scrollTop = value;
}

function animateSettingsScroll(container, nextPosition, axis = "y") {
  if (!container) {
    return;
  }

  const frameKey = axis === "x" ? "settingsScrollAnimationFrameX" : "settingsScrollAnimationFrameY";
  if (container[frameKey]) {
    cancelAnimationFrame(container[frameKey]);
    container[frameKey] = null;
  }

  const startPosition = getScrollPosition(container, axis);
  if (Math.abs(nextPosition - startPosition) < 1 || typeof requestAnimationFrame !== "function") {
    setScrollPosition(container, nextPosition, axis);
    updateSettingsScrollIndicators(container);
    return;
  }

  let position = startPosition;
  let velocity = 0;
  let lastTime = performance.now();
  const damping =
    2 * SETTINGS_RAIL_SCROLL_DAMPING_RATIO * Math.sqrt(SETTINGS_RAIL_SCROLL_STIFFNESS);
  const step = (now) => {
    const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    const displacement = position - nextPosition;
    const acceleration = -SETTINGS_RAIL_SCROLL_STIFFNESS * displacement - damping * velocity;
    velocity += acceleration * deltaSeconds;
    position += velocity * deltaSeconds;
    setScrollPosition(container, position, axis);
    updateSettingsScrollIndicators(container);

    if (Math.abs(position - nextPosition) > 0.5 || Math.abs(velocity) > 0.5) {
      container[frameKey] = requestAnimationFrame(step);
    } else {
      setScrollPosition(container, nextPosition, axis);
      container[frameKey] = null;
      updateSettingsScrollIndicators(container);
    }
  };

  container[frameKey] = requestAnimationFrame(step);
}

function scrollSettingsNodeIntoContainer(node, container, axis = "y") {
  if (!node || !container) {
    return;
  }

  const maxScroll = getScrollMax(container, axis);
  if (maxScroll <= 0) {
    updateSettingsScrollIndicators(container);
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const containerSize = axis === "x" ? container.clientWidth : container.clientHeight;
  const nodeStart =
    axis === "x" ? nodeRect.left - containerRect.left : nodeRect.top - containerRect.top;
  const nodeSize =
    axis === "x"
      ? nodeRect.width || node.offsetWidth || 0
      : nodeRect.height || node.offsetHeight || 0;
  const itemCenterInViewport = nodeStart + nodeSize / 2;
  const targetCenter = containerSize * SETTINGS_RAIL_SCROLL_TARGET_RATIO;
  const nextPosition = clamp(
    getScrollPosition(container, axis) + itemCenterInViewport - targetCenter,
    0,
    maxScroll
  );

  if (Math.abs(getScrollPosition(container, axis) - nextPosition) < 1) {
    updateSettingsScrollIndicators(container);
    return;
  }
  animateSettingsScroll(container, nextPosition, axis);
}

export function scrollSettingsContentItem(node) {
  if (!node) {
    return;
  }

  const dialogContainer = node.closest?.(".settings-dialog-list");
  if (dialogContainer) {
    scrollSettingsNodeIntoContainer(node, dialogContainer, "y");
    return;
  }

  const horizontalContainer = node.closest?.(".settings-theme-row");
  if (horizontalContainer) {
    scrollSettingsNodeIntoContainer(node, horizontalContainer, "x");
  }

  const verticalContainer = node.closest?.(
    ".settings-content, .settings-group-card-fill, .settings-trakt-scroll-area, .supporters-list"
  );
  if (verticalContainer) {
    scrollSettingsNodeIntoContainer(node, verticalContainer, "y");
    return;
  }

  scrollIntoNearestView(node);
}

function updateSettingsScrollIndicators(container) {
  if (!container) {
    return;
  }

  const verticalFrame = container.closest?.(
    ".settings-content-frame, .settings-sidebar-frame, .settings-trakt-scroll-frame"
  );
  if (
    verticalFrame &&
    (container.classList?.contains("settings-content") ||
      container.classList?.contains("settings-sidebar") ||
      container.classList?.contains("settings-trakt-scroll-area"))
  ) {
    const maxScroll = getScrollMax(container, "y");
    const scrollTop = getScrollPosition(container, "y");
    verticalFrame.classList.toggle("can-scroll-backward", scrollTop > 1);
    verticalFrame.classList.toggle(
      "can-scroll-forward",
      maxScroll > 1 && scrollTop < maxScroll - 1
    );
  }

  const horizontalFrame = container.closest?.(".settings-horizontal-scroll-frame");
  if (horizontalFrame && container.classList?.contains("settings-theme-row")) {
    const maxScroll = getScrollMax(container, "x");
    const scrollLeft = getScrollPosition(container, "x");
    horizontalFrame.classList.toggle("can-scroll-backward", scrollLeft > 1);
    horizontalFrame.classList.toggle(
      "can-scroll-forward",
      maxScroll > 1 && scrollLeft < maxScroll - 1
    );
  }
}

function updateSettingsScrollIndicatorsSoon(container) {
  if (!container) {
    return;
  }
  requestAnimationFrame(() => updateSettingsScrollIndicators(container));
}

export function bindSettingsScrollIndicators(root) {
  if (!root) {
    return;
  }

  root
    .querySelectorAll?.(
      ".settings-sidebar, .settings-content, .settings-theme-row, .settings-trakt-scroll-area"
    )
    .forEach((container) => {
      if (!container.settingsScrollIndicatorBound) {
        container.settingsScrollIndicatorBound = true;
        container.addEventListener("scroll", () => updateSettingsScrollIndicators(container), {
          passive: true
        });
      }
      updateSettingsScrollIndicatorsSoon(container);
    });
}

export function settingsScrollIndicatorMarkup(axis = "vertical") {
  if (axis === "horizontal") {
    return `
      <span class="settings-scroll-indicator settings-scroll-indicator-left" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M14.6 7.4 10 12l4.6 4.6" /></svg>
      </span>
      <span class="settings-scroll-indicator settings-scroll-indicator-right" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="m9.4 7.4 4.6 4.6-4.6 4.6" /></svg>
      </span>
    `;
  }
  return `
    <span class="settings-scroll-indicator settings-scroll-indicator-up" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="M7.4 14.6 12 10l4.6 4.6" /></svg>
    </span>
    <span class="settings-scroll-indicator settings-scroll-indicator-down" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="m7.4 9.4 4.6 4.6 4.6-4.6" /></svg>
    </span>
  `;
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function getSessionEmail() {
  const payload = decodeJwtPayload(SessionStore.accessToken);
  return String(payload?.email || payload?.user_metadata?.email || "").trim() || null;
}

async function fetchAccountSyncOverview() {
  const response = await SupabaseApi.rpc("get_sync_overview", {}, true);
  const source =
    response && typeof response === "object" && !Array.isArray(response) ? response : {};
  const addons = source.addons && typeof source.addons === "object" ? source.addons : {};
  const plugins = source.plugins && typeof source.plugins === "object" ? source.plugins : {};
  const libraryItems =
    source.library_items && typeof source.library_items === "object" ? source.library_items : {};
  const watchProgress =
    source.watch_progress && typeof source.watch_progress === "object" ? source.watch_progress : {};
  const watchedItems =
    source.watched_items && typeof source.watched_items === "object" ? source.watched_items : {};
  const remoteProfiles =
    source.profiles && typeof source.profiles === "object" ? source.profiles : {};
  const profiles = await ProfileManager.getProfiles();
  const allProfileIds = Array.from(
    new Set([
      ...Object.keys(addons),
      ...Object.keys(plugins),
      ...Object.keys(libraryItems),
      ...Object.keys(watchProgress),
      ...Object.keys(watchedItems),
      ...Object.keys(remoteProfiles)
    ])
  )
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((left, right) => left - right);

  const readCount = (bucket, id) => {
    const value = Number(bucket[String(id)] || 0);
    return Number.isFinite(value) ? value : 0;
  };
  const total = (bucket) =>
    Object.values(bucket).reduce((sum, value) => {
      const count = Number(value || 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

  return {
    profileCount: Object.keys(remoteProfiles).length,
    totalAddons: total(addons),
    totalPlugins: total(plugins),
    totalLibrary: total(libraryItems),
    totalWatchProgress: total(watchProgress),
    totalWatchedItems: total(watchedItems),
    perProfile: allProfileIds.map((profileId) => {
      const profileIdString = String(profileId);
      const localProfile = profiles.find(
        (profile) =>
          String(profile?.id) === profileIdString ||
          String(profile?.profileIndex) === profileIdString
      );
      const remoteProfile = remoteProfiles[profileIdString] || {};
      return {
        profileId,
        profileName: localProfile?.name || remoteProfile.name || `Profile ${profileId}`,
        avatarColorHex: localProfile?.avatarColorHex || remoteProfile.color || "#1E88E5",
        addons: readCount(addons, profileId),
        plugins: readCount(plugins, profileId),
        library: readCount(libraryItems, profileId),
        watchProgress: readCount(watchProgress, profileId),
        watchedItems: readCount(watchedItems, profileId)
      };
    })
  };
}

function getVisibleSections(model) {
  const isPrimaryProfileActive = String(model?.activeProfileId || "1") === "1";
  return SECTION_META.filter((section) => {
    if (section.hideFromNav) {
      return false;
    }
    if (section.id === "account" || section.id === "trakt") {
      return isPrimaryProfileActive;
    }
    return true;
  });
}

function getSettingsSectionById(sectionId) {
  return SECTION_META.find((section) => section.id === sectionId) || null;
}

function canOpenSettingsSection(sectionId) {
  return Boolean(getSettingsSectionById(sectionId));
}

function updateSettingsMarqueeTargets(root) {
  root?.querySelectorAll?.(".settings-nav-label").forEach((label) => {
    label._settingsMarqueeAnimation?.cancel?.();
    label._settingsMarqueeAnimation = null;
    label.classList.remove("is-marquee-active");
    label.style.transform = "";
    label.style.removeProperty("--settings-marquee-gap");
    const originalText = label.dataset.marqueeText || String(label.textContent || "");
    label.dataset.marqueeText = originalText;
    label.textContent = originalText;

    const item = label.closest(".settings-nav-item");
    if (!item?.classList.contains("focused")) {
      return;
    }

    const textWidth = Number(label.scrollWidth || 0);
    const viewportWidth = Number(label.clientWidth || 0);
    if (textWidth <= viewportWidth + 1) {
      return;
    }

    const spacing = Math.max(24, viewportWidth / 3);
    const distance = textWidth + spacing;
    const travelMs = (distance / SETTINGS_MARQUEE_VELOCITY_PX_PER_SECOND) * 1000;

    label.style.setProperty("--settings-marquee-gap", `${spacing}px`);
    label.classList.add("is-marquee-active");
    if (typeof label.animate === "function") {
      label._settingsMarqueeAnimation = label.animate(
        [{ transform: "translateX(0)" }, { transform: `translateX(-${distance}px)` }],
        {
          duration: travelMs,
          iterations: Infinity,
          easing: "linear"
        }
      );
    }
  });
}

function scrollSettingsRailItem(node, options = {}) {
  const rail = node?.closest?.(".settings-sidebar");
  if (!rail || !node) {
    return;
  }

  const clientHeight = rail.clientHeight || 0;
  const maxScroll = Math.max(0, rail.scrollHeight - clientHeight);
  if (!clientHeight || maxScroll <= 0) {
    return;
  }

  const railRect = rail.getBoundingClientRect();
  const itemRect = node.getBoundingClientRect();
  const itemCenterInViewport =
    itemRect.top - railRect.top + (itemRect.height || node.offsetHeight || 0) / 2;
  const targetCenter = clientHeight * SETTINGS_RAIL_SCROLL_TARGET_RATIO;
  const nextScrollTop = clamp(rail.scrollTop + itemCenterInViewport - targetCenter, 0, maxScroll);

  if (Math.abs(rail.scrollTop - nextScrollTop) < 1) {
    return;
  }
  if (options?.immediate) {
    if (rail.settingsScrollAnimationFrame) {
      cancelAnimationFrame(rail.settingsScrollAnimationFrame);
      rail.settingsScrollAnimationFrame = null;
    }
    rail.scrollTop = nextScrollTop;
    updateSettingsRailIndicators(rail);
    return;
  }
  animateSettingsRailScroll(rail, nextScrollTop);
}

function animateSettingsRailScroll(rail, nextScrollTop) {
  if (!rail) {
    return;
  }

  if (rail.settingsScrollAnimationFrame) {
    cancelAnimationFrame(rail.settingsScrollAnimationFrame);
    rail.settingsScrollAnimationFrame = null;
  }

  const startTop = Number(rail.scrollTop || 0);
  if (Math.abs(nextScrollTop - startTop) < 1 || typeof requestAnimationFrame !== "function") {
    rail.scrollTop = nextScrollTop;
    updateSettingsRailIndicators(rail);
    return;
  }

  let position = startTop;
  let velocity = 0;
  let lastTime = performance.now();
  const damping =
    2 * SETTINGS_RAIL_SCROLL_DAMPING_RATIO * Math.sqrt(SETTINGS_RAIL_SCROLL_STIFFNESS);
  const step = (now) => {
    const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    const displacement = position - nextScrollTop;
    const acceleration = -SETTINGS_RAIL_SCROLL_STIFFNESS * displacement - damping * velocity;
    velocity += acceleration * deltaSeconds;
    position += velocity * deltaSeconds;
    rail.scrollTop = position;
    updateSettingsRailIndicators(rail);

    if (Math.abs(position - nextScrollTop) > 0.5 || Math.abs(velocity) > 0.5) {
      rail.settingsScrollAnimationFrame = requestAnimationFrame(step);
    } else {
      rail.scrollTop = nextScrollTop;
      rail.settingsScrollAnimationFrame = null;
      updateSettingsRailIndicators(rail);
    }
  };

  rail.settingsScrollAnimationFrame = requestAnimationFrame(step);
}

function updateSettingsRailIndicators(rail) {
  if (!rail) {
    return;
  }

  const frame = rail.closest?.(".settings-sidebar-frame");
  if (!frame) {
    return;
  }

  const maxScroll = Math.max(0, rail.scrollHeight - rail.clientHeight);
  const scrollTop = Number(rail.scrollTop || 0);
  frame.classList.toggle("can-scroll-backward", scrollTop > 1);
  frame.classList.toggle("can-scroll-forward", maxScroll > 1 && scrollTop < maxScroll - 1);
}

function updateSettingsRailIndicatorsSoon(rail) {
  if (!rail) {
    return;
  }
  requestAnimationFrame(() => updateSettingsRailIndicators(rail));
}

function focusSettingsNode(node) {
  if (!node || typeof node.focus !== "function") {
    return;
  }

  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}

function isScrollContainerAtBoundary(node, direction) {
  if (!node) {
    return true;
  }

  const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  if (maxScrollTop <= 0) {
    return true;
  }

  const scrollTop = Number(node.scrollTop || 0);
  if (direction === "up") {
    return scrollTop <= 1;
  }
  if (direction === "down") {
    return scrollTop >= maxScrollTop - 1;
  }
  return false;
}

function captureSettingsScrollState(contentNode) {
  if (!contentNode) {
    return null;
  }

  const fillScrollers = Array.from(
    contentNode.querySelectorAll(".settings-group-card-fill, .settings-trakt-scroll-area")
  );
  const horizontalScrollers = Array.from(contentNode.querySelectorAll(".settings-theme-row"));
  return {
    contentScrollTop: Number(contentNode.scrollTop || 0),
    fillScrollTops: fillScrollers.map((node) => Number(node.scrollTop || 0)),
    horizontalScrollLefts: horizontalScrollers.map((node) => Number(node.scrollLeft || 0))
  };
}

function restoreSettingsScrollState(contentNode, scrollState) {
  if (!contentNode || !scrollState) {
    return;
  }

  contentNode.scrollTop = Number(scrollState.contentScrollTop || 0);
  Array.from(
    contentNode.querySelectorAll(".settings-group-card-fill, .settings-trakt-scroll-area")
  ).forEach((node, index) => {
    node.scrollTop = Number(scrollState.fillScrollTops?.[index] || 0);
  });
  Array.from(contentNode.querySelectorAll(".settings-theme-row")).forEach((node, index) => {
    node.scrollLeft = Number(scrollState.horizontalScrollLefts?.[index] || 0);
  });
}

function addonKindsLabel(addon) {
  const kinds = Array.isArray(addon?.types) ? addon.types.filter(Boolean) : [];
  if (!kinds.length) {
    return t("common.repository");
  }
  return kinds.map((entry) => String(entry)).join(", ");
}

function createDefaultExpandedState(sectionId) {
  if (sectionId === "layout") {
    return {
      homeLayout: false,
      homeContent: false,
      continueWatching: false,
      detailPage: false,
      focusedPoster: false
    };
  }

  if (sectionId === "playback") {
    return {
      general: false,
      stream: false,
      audio: false,
      audioCompatibility: false,
      subtitles: false,
      p2p: false
    };
  }

  return {};
}

function normalizeExpandedState(sectionId, value) {
  const defaults = createDefaultExpandedState(sectionId);
  if (!value || typeof value !== "object") {
    return { ...defaults };
  }

  const normalized = { ...defaults };
  Object.keys(defaults).forEach((key) => {
    normalized[key] = Boolean(value[key]);
  });
  return normalized;
}

function normalizeExpandedSections(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    layout: normalizeExpandedState("layout", source.layout),
    playback: normalizeExpandedState("playback", source.playback)
  };
}

function readSettingsUiState() {
  const state = LocalStore.get(SETTINGS_UI_STATE_KEY, null);
  return {
    activeSection: typeof state?.activeSection === "string" ? state.activeSection : null,
    navIndex: Number.isFinite(state?.navIndex) ? state.navIndex : null,
    railScrollTop: Number.isFinite(state?.railScrollTop) ? Math.max(0, state.railScrollTop) : 0,
    contentFocusKey: typeof state?.contentFocusKey === "string" ? state.contentFocusKey : null,
    appearanceThemeFocusKey:
      typeof state?.appearanceThemeFocusKey === "string" ? state.appearanceThemeFocusKey : null,
    integrationView: typeof state?.integrationView === "string" ? state.integrationView : "hub",
    expandedSections: normalizeExpandedSections(state?.expandedSections)
  };
}

function isAppearanceThemeFocusKey(focusKey) {
  return String(focusKey || "").startsWith("appearance:theme:");
}

export const SettingsScreen = {
  getCurrentRailScrollTop() {
    const rail = this.container?.querySelector?.("[data-settings-nav]");
    if (rail) {
      this.railScrollTop = Number(rail.scrollTop || 0);
    }
    return Number.isFinite(this.railScrollTop) ? Math.max(0, this.railScrollTop) : 0;
  },

  ensureShell() {
    if (
      this.container?.querySelector?.(".settings-shell .settings-sidebar-frame") &&
      this.container?.querySelector?.(".settings-shell .settings-content-frame")
    ) {
      return;
    }
    this.container.innerHTML = `
      <div class="home-shell settings-shell">
        <div class="settings-root-sidebar-slot" data-settings-root-sidebar></div>
        <div class="settings-workspace">
          <div class="settings-sidebar-frame">
            <aside class="settings-sidebar" data-settings-nav></aside>
            ${settingsScrollIndicatorMarkup("vertical")}
          </div>
          <div class="settings-content-frame">
            <section class="settings-content" data-settings-content></section>
            ${settingsScrollIndicatorMarkup("vertical")}
          </div>
        </div>
        <div data-settings-dialog></div>
      </div>
    `;
  },

  async mount(_params = {}, navigationContext = {}) {
    this.container = document.getElementById("settings");
    ScreenUtils.show(this.container);
    if (!this.handleWheelBound) {
      this.handleWheelBound = this.handleWheelEvent.bind(this);
      this.container.addEventListener("wheel", this.handleWheelBound, { passive: false });
    }
    if (!this.handleClickBound) {
      this.handleClickBound = this.handleClickEvent.bind(this);
      this.container.addEventListener("click", this.handleClickBound);
    }
    this.settingsRouteEnterPending = true;
    const persistedUiState = readSettingsUiState();
    this.restoreRailScrollTop = persistedUiState.railScrollTop;
    this.railScrollTop = persistedUiState.railScrollTop;
    this.suppressNextRailFocusScroll = Boolean(navigationContext?.isBackNavigation);
    this.activeSection = persistedUiState.activeSection || this.activeSection || null;
    this.focusZone = "nav";
    this.sidebarFocusIndex = Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0;
    this.navIndex = Number.isFinite(persistedUiState.navIndex)
      ? persistedUiState.navIndex
      : Number.isFinite(this.navIndex)
        ? this.navIndex
        : SECTION_META.findIndex((section) => section.id === this.activeSection);
    this.contentFocusKey = persistedUiState.contentFocusKey || this.contentFocusKey || null;
    this.appearanceThemeFocusKey =
      persistedUiState.appearanceThemeFocusKey || this.appearanceThemeFocusKey || null;
    this.pluginDraft = this.pluginDraft || "";
    this.integrationView = persistedUiState.integrationView || this.integrationView || "hub";
    this.expandedSections = normalizeExpandedSections(
      persistedUiState.expandedSections || this.expandedSections
    );
    this.streamBadgePreviewSourceUrl = null;
    this.advancedCacheCleared = false;
    this.optionDialog = this.optionDialog || null;
    this.textDialog = this.textDialog || null;
    this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    const [sidebarProfile, initialModel] = await Promise.all([
      getSidebarProfileState(),
      this.collectModel()
    ]);
    this.sidebarProfile = sidebarProfile;
    this.model = initialModel;
    await this.render({ refreshModel: false });
  },

  ensureExpandedState(sectionId) {
    this.expandedSections[sectionId] = normalizeExpandedState(
      sectionId,
      this.expandedSections[sectionId]
    );
  },

  persistUiState() {
    LocalStore.set(SETTINGS_UI_STATE_KEY, {
      activeSection: this.activeSection || null,
      navIndex: Number.isFinite(this.navIndex) ? this.navIndex : null,
      railScrollTop: this.getCurrentRailScrollTop(),
      contentFocusKey: this.contentFocusKey || null,
      appearanceThemeFocusKey: this.appearanceThemeFocusKey || null,
      integrationView: this.integrationView || "hub",
      expandedSections: normalizeExpandedSections(this.expandedSections)
    });
  },

  rememberAppearanceThemeFocusKey(focusKey = this.contentFocusKey) {
    if (!isAppearanceThemeFocusKey(focusKey)) {
      return;
    }
    if (this.appearanceThemeFocusKey === focusKey) {
      return;
    }
    this.appearanceThemeFocusKey = focusKey;
    this.persistUiState();
  },

  getAppearanceThemeFocusKey() {
    return this.appearanceThemeFocusKey || `appearance:theme:${THEME_OPTIONS[0]?.id || "WHITE"}`;
  },

  collapseExpandedSection(sectionId) {
    if (!sectionId) {
      return;
    }
    this.expandedSections[sectionId] = createDefaultExpandedState(sectionId);
  },

  setActiveSection(sectionId) {
    const nextSectionId = sectionId || null;
    if (this.activeSection && this.activeSection !== nextSectionId) {
      this.rememberAppearanceThemeFocusKey();
      this.collapseExpandedSection(this.activeSection);
    }
    this.activeSection = sectionId || null;
    this.contentFocusKey =
      this.activeSection === "appearance" ? this.getAppearanceThemeFocusKey() : null;
    this.persistUiState();
  },

  toggleExpandedSection(sectionId, groupId) {
    this.ensureExpandedState(sectionId);
    this.expandedSections[sectionId][groupId] = !this.expandedSections[sectionId][groupId];
    this.persistUiState();
  },

  registerAction(focusKey, action) {
    this.actionMap.set(focusKey, action);
    return `data-focus-key="${escapeHtml(focusKey)}"`;
  },

  async collectModel() {
    const authState = AuthManager.getAuthState();
    this.ensureAccountSyncOverview(authState);
    const [addons, profiles] = await Promise.all([
      addonRepository.getInstalledAddons(),
      ProfileManager.getProfiles()
    ]);
    const activeProfileId = ProfileManager.getActiveProfileId();
    const pluginSources = PluginManager.listPluginSources();

    return {
      addons,
      profiles,
      activeProfileId,
      accountEmail: getSessionEmail(),
      pluginSources,
      pluginsEnabled: PluginManager.pluginsEnabled,
      theme: ThemeStore.get(),
      player: PlayerSettingsStore.get(),
      webOsAudioCompatibility: Platform.isWebOS()
        ? WebOsAudioCompatibilityStore.get({
            legacyForceAll: Boolean(PlayerSettingsStore.get().forceDtsTrueHdAudio)
          })
        : null,
      torrent: TorrentSettingsStore.get(),
      layout: LayoutPreferences.get(),
      tmdb: TmdbSettingsStore.get(),
      mdbList: MdbListSettingsStore.get(),
      animeSkip: AnimeSkipSettingsStore.get(),
      streamBadgeSettings: StreamBadgeSettingsStore.get(),
      debrid: DebridSettingsStore.get(),
      trakt: this.collectTraktModel(),
      fastHorizontalNavigation: isFastHorizontalNavigationEnabled(),
      rotatedDpad: shouldUseRotatedMapping(),
      strictDpadGrid: Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true)),
      authState,
      accountSyncOverview: this.accountSyncOverview || null,
      accountSyncOverviewLoading: Boolean(this.accountSyncOverviewPromise)
    };
  },

  collectTraktModel() {
    const auth = TraktAuthService.getCurrentAuthState();
    const settings = TraktSettingsStore.get();
    const mode =
      auth.accessToken && auth.refreshToken
        ? "connected"
        : auth.deviceCode
          ? "awaiting_approval"
          : "disconnected";
    return {
      auth,
      settings,
      mode,
      credentialsConfigured: TraktAuthService.hasRequiredCredentials(),
      isLoading: Boolean(this.traktLoading),
      isStatsLoading: Boolean(this.traktStatsLoading),
      statusMessage: this.traktStatusMessage || null,
      errorMessage: this.traktErrorMessage || null,
      stats: this.traktStats || null
    };
  },

  ensureAccountSyncOverview(authState = AuthManager.getAuthState()) {
    if (authState !== "authenticated") {
      this.accountSyncOverview = null;
      this.accountSyncOverviewPromise = null;
      this.accountSyncOverviewLoaded = false;
      return;
    }
    if (this.accountSyncOverviewLoaded || this.accountSyncOverviewPromise) {
      return;
    }
    this.accountSyncOverviewPromise = fetchAccountSyncOverview()
      .then((overview) => {
        this.accountSyncOverview = overview;
      })
      .catch((error) => {
        console.warn("Account sync overview failed", error);
      })
      .finally(() => {
        this.accountSyncOverviewLoaded = true;
        this.accountSyncOverviewPromise = null;
        if (this.container && this.activeSection === "account") {
          void this.render();
        }
      });
  },

  renderNav() {
    return this.visibleSections
      .map(
        (item, index) => `
      <button class="settings-nav-item focusable${this.activeSection === item.id ? " selected" : ""}"
              data-zone="nav"
              data-nav-index="${index}"
              data-focus-key="nav:${item.id}"
              data-section="${item.id}">
        <span class="settings-nav-leading">
          ${renderSectionNavIcon(item.id)}
          <span class="settings-nav-label-wrap">
            <span class="settings-nav-label">${escapeHtml(translateSectionCopy(item).label)}</span>
            ${item.id === "plugins" ? `<span class="settings-nav-badge">${escapeHtml(t("common.soon", {}, "Soon"))}</span>` : ""}
          </span>
        </span>
        ${iconSvg(ROW_ICONS.chevron, "settings-nav-chevron")}
      </button>
    `
      )
      .join("");
  },

  renderSectionHeader(section) {
    const copy = translateSectionCopy(section);
    return `
      <header class="settings-content-header">
        <h1 class="settings-title">${escapeHtml(copy.label)}</h1>
        <p class="settings-subtitle">${escapeHtml(copy.subtitle)}</p>
      </header>
    `;
  },

  renderActionRow({
    focusKey,
    title,
    subtitle = "",
    value = "",
    icon = "chevron",
    leadingIcon = "",
    external = false,
    classes = "",
    disabled = false,
    planned = false
  }) {
    const inert = disabled || planned;
    const trailing = external ? "external" : icon;
    const tailContent = [
      planned ? `<span class="settings-row-badge">${escapeHtml(t("common.soon"))}</span>` : "",
      value ? `<span class="settings-row-value">${escapeHtml(value)}</span>` : "",
      trailing
        ? iconSvg(ROW_ICONS[trailing], `settings-row-icon${external ? " is-external" : ""}`)
        : ""
    ]
      .filter(Boolean)
      .join("");
    return `
      <button class="settings-action-row settings-content-focusable focusable${classes ? ` ${classes}` : ""}${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}
              data-role="action">
        ${leadingIcon ? `<span class="settings-row-leading-icon material-icons" aria-hidden="true">${escapeHtml(leadingIcon)}</span>` : ""}
        <span class="settings-row-copy">
          <span class="settings-row-title">${escapeHtml(title)}</span>
          ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
        </span>
        ${tailContent ? `<span class="settings-row-tail">${tailContent}</span>` : ""}
      </button>
    `;
  },

  renderToggleRow({
    focusKey,
    title,
    subtitle = "",
    checked = false,
    disabled = false,
    planned = false
  }) {
    const inert = disabled || planned;
    return `
      <button class="settings-action-row settings-toggle-row settings-content-focusable focusable${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}
              data-role="toggle">
        <span class="settings-row-copy">
          <span class="settings-row-title">${escapeHtml(title)}</span>
          ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
        </span>
        <span class="settings-row-tail">
          ${planned ? `<span class="settings-row-badge">${escapeHtml(t("common.soon"))}</span>` : ""}
          <span class="settings-toggle-pill${checked ? " is-checked" : ""}">
            <span class="settings-toggle-thumb"></span>
          </span>
        </span>
      </button>
    `;
  },

  renderThemeCard(theme, selected, focusKey) {
    const selectedClass = selected ? " is-selected" : "";
    const swatchClass = theme.id === "WHITE" ? " settings-theme-swatch-light" : "";
    return `
      <button class="settings-theme-card settings-content-focusable focusable${selectedClass}"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
        <span class="settings-theme-swatch-wrap">
          <span class="settings-theme-swatch${swatchClass}" style="background:${escapeHtml(theme.color)};">
            ${selected ? `<span class="settings-theme-check-wrap" style="color:${escapeHtml(theme.onColor || "#fff")};">${iconSvg(ROW_ICONS.check, "settings-theme-check")}</span>` : ""}
          </span>
        </span>
        <span class="settings-theme-name">${escapeHtml(translateOptionLabel(theme))}</span>
      </button>
    `;
  },

  renderLayoutCard(option, selected, focusKey) {
    return `
      <button class="settings-layout-card settings-content-focusable focusable${selected ? " is-selected" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
        <span class="settings-layout-badge">${escapeHtml(t("common.beta", {}, "Beta"))}</span>
        ${renderLayoutPreviewPlaceholderMarkup()}
        <span class="settings-layout-preview settings-layout-preview-${escapeHtml(option.id)}">${renderLayoutPreviewMarkup(option.id)}</span>
        <span class="settings-layout-name">${escapeHtml(translateOptionLabel(option))}</span>
      </button>
    `;
  },

  renderPluginIconButton({
    focusKey,
    icon,
    label,
    destructive = false,
    disabled = false,
    planned = false
  }) {
    const inert = disabled || planned;
    return `
      <button class="settings-plugin-icon-button settings-content-focusable focusable${inert ? " is-disabled" : ""}${destructive ? " is-destructive" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              aria-label="${escapeHtml(label)}"
              title="${escapeHtml(label)}"
              ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}>
        ${planned ? `<span class="settings-plugin-icon-badge">${escapeHtml(t("common.soon"))}</span>` : iconSvg(ROW_ICONS[icon], "settings-plugin-icon-symbol")}
      </button>
    `;
  },

  renderPluginRepositoryCard(addon, index) {
    const streamResourceCount = Array.isArray(addon.resources)
      ? addon.resources.filter((resource) => resource?.name === "stream").length
      : 0;
    return `
      <article class="settings-plugin-repo-card">
        <div class="settings-plugin-repo-copy">
          <div class="settings-plugin-repo-title">${escapeHtml(addon.displayName || addon.name || t("common.repository"))}</div>
          <div class="settings-plugin-repo-meta">
            ${escapeHtml(
              t(
                streamResourceCount === 1
                  ? "settings.plugins.repoMetaSingular"
                  : "settings.plugins.repoMetaPlural",
                { count: streamResourceCount, version: addon.version || "0.0.0" }
              )
            )}
          </div>
          <div class="settings-plugin-repo-url">${escapeHtml(addon.baseUrl || addon.description || addonKindsLabel(addon))}</div>
        </div>
        <div class="settings-plugin-repo-actions">
          ${this.renderPluginIconButton({
            focusKey: `plugins:refresh:${index}`,
            icon: "refresh",
            label: t("settings.plugins.refreshRepository")
          })}
          ${this.renderPluginIconButton({
            focusKey: `plugins:remove:${index}`,
            icon: "trash",
            label: t("settings.plugins.removeRepository"),
            destructive: true
          })}
        </div>
      </article>
    `;
  },

  openOptionDialog({
    title,
    message = "",
    options,
    selectedId,
    onSelect,
    returnFocusKey,
    dialogClassName = "",
    optionRenderer = "default",
    optionColumns = null
  }) {
    this.textDialog = null;
    this.optionDialog = {
      title,
      message,
      options: Array.isArray(options) ? options : [],
      selectedId: selectedId ?? null,
      onSelect,
      returnFocusKey,
      dialogClassName,
      optionRenderer,
      // Compact action dialogs can opt into multiple columns so dpad left/right
      // can move between visually adjacent options.
      optionColumns: Number.isFinite(Number(optionColumns))
        ? Math.max(1, Math.trunc(Number(optionColumns)))
        : 1
    };
    const selectedIndex = this.optionDialog.options.findIndex(
      (option) => String(option.id) === String(selectedId)
    );
    this.dialogFocusIndex = clamp(
      selectedIndex >= 0 ? selectedIndex : 0,
      0,
      Math.max(0, this.optionDialog.options.length - 1)
    );
    this.focusZone = "dialog";
  },

  openMultiChoiceDialog({
    title,
    message = "",
    options,
    selectedIds = [],
    onToggle,
    returnFocusKey,
    dialogClassName = ""
  }) {
    this.textDialog = null;
    this.optionDialog = {
      title,
      message,
      options: Array.isArray(options) ? options : [],
      selectedId: null,
      selectedIds: new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id))),
      onToggle,
      returnFocusKey,
      dialogClassName,
      optionRenderer: "multi",
      multiChoice: true,
      optionColumns: 1
    };
    this.dialogFocusIndex = 0;
    this.focusZone = "dialog";
  },

  openTextDialog({
    title,
    value = "",
    multiline = false,
    placeholder = "",
    returnFocusKey,
    saveLabel = t("common.save", {}, "Save"),
    cancelLabel = t("common.cancel", {}, "Cancel"),
    clearLabel = "",
    onClear,
    onSubmit
  }) {
    this.optionDialog = null;
    this.textDialog = {
      title,
      value: String(value ?? ""),
      draft: String(value ?? ""),
      multiline: Boolean(multiline),
      placeholder,
      returnFocusKey,
      saveLabel,
      cancelLabel,
      clearLabel,
      statusMessage: "",
      statusKind: "error",
      onClear,
      onSubmit
    };
    this.dialogFocusIndex = 0;
    this.focusZone = "dialog";
  },

  closeOptionDialog() {
    if (!this.optionDialog) {
      return;
    }
    this.contentFocusKey = this.optionDialog.returnFocusKey || this.contentFocusKey;
    this.optionDialog = null;
    this.focusZone = "content";
  },

  closeTextDialog() {
    if (!this.textDialog) {
      return;
    }
    this.contentFocusKey = this.textDialog.returnFocusKey || this.contentFocusKey;
    this.textDialog = null;
    this.focusZone = "content";
  },

  renderOptionDialog() {
    if (!this.optionDialog) {
      return "";
    }

    const dialogClassName = this.optionDialog.dialogClassName
      ? ` ${escapeHtml(this.optionDialog.dialogClassName)}`
      : "";
    const useLanguageRenderer = this.optionDialog.optionRenderer === "subtitle-language";
    const useSingleChoiceRenderer = this.optionDialog.optionRenderer === "single-choice";
    const useMultiRenderer = this.optionDialog.optionRenderer === "multi";
    const isP2pConsentDialog =
      String(this.optionDialog.dialogClassName || "") === "settings-p2p-consent-dialog";
    const messageHtml = this.optionDialog.message
      ? `<div class="settings-text-dialog-message settings-option-dialog-message${isP2pConsentDialog ? " settings-p2p-consent-message" : ""}">${escapeHtml(String(this.optionDialog.message)).replace(/\n/g, "<br>")}</div>`
      : "";

    return `
      <div class="settings-dialog-backdrop">
        <div class="settings-dialog${dialogClassName}">
          <div class="settings-dialog-title">${escapeHtml(this.optionDialog.title || t("common.selectOption"))}</div>
          ${messageHtml}
          <div class="settings-dialog-list${useLanguageRenderer ? " settings-language-dialog-list" : ""}">
            ${this.optionDialog.options
              .map((option, index) => {
                const optionId = String(option.id);
                const isSelected = useMultiRenderer
                  ? this.optionDialog.selectedIds?.has?.(optionId)
                  : optionId === String(this.optionDialog.selectedId);
                return `
              <button class="settings-dialog-option settings-content-focusable focusable${useLanguageRenderer ? " settings-language-option" : ""}${useSingleChoiceRenderer ? " settings-single-choice-option" : ""}${isSelected ? " is-selected" : ""}"
                      data-zone="dialog"
                      data-dialog-index="${index}"
                      data-dialog-option-id="${escapeHtml(option.id)}">
                ${
                  useLanguageRenderer
                    ? `<span class="settings-language-option-copy">
                      <span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>
                    </span>
                    <span class="settings-language-option-meta">
                      ${
                        subtitleLanguageOptionCode(option)
                          ? `<span class="settings-language-option-code">${escapeHtml(subtitleLanguageOptionCode(option))}</span>`
                          : ""
                      }
                      ${
                        isSelected
                          ? `<span class="settings-language-option-check" aria-hidden="true">&#10003;</span>`
                          : ""
                      }
                    </span>`
                    : useMultiRenderer
                      ? `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span><span class="settings-language-option-check" aria-hidden="true">${isSelected ? "&#10003;" : ""}</span>`
                      : useSingleChoiceRenderer
                        ? `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>${isSelected ? '<span class="settings-single-choice-option-check" aria-hidden="true">&#10003;</span>' : ""}`
                        : `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>`
                }
              </button>
            `;
              })
              .join("")}
          </div>
        </div>
      </div>
    `;
  },

  renderTextDialog() {
    if (!this.textDialog) {
      return "";
    }
    const field = this.textDialog.multiline
      ? `<textarea class="settings-text-dialog-field settings-text-dialog-textarea focusable"
                   data-zone="dialog"
                   data-text-dialog-role="field"
                   placeholder="${escapeAttribute(this.textDialog.placeholder || "")}">${escapeHtml(this.textDialog.draft)}</textarea>`
      : `<input class="settings-text-dialog-field settings-text-dialog-input focusable"
                data-zone="dialog"
                data-text-dialog-role="field"
                type="text"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder="${escapeAttribute(this.textDialog.placeholder || "")}"
                value="${escapeAttribute(this.textDialog.draft)}" />`;
    return `
      <div class="settings-dialog-backdrop">
        <div class="settings-dialog settings-text-dialog">
          <div class="settings-dialog-title">${escapeHtml(this.textDialog.title || "")}</div>
          ${field}
          ${
            this.textDialog.statusMessage
              ? `<p class="settings-text-dialog-message ${escapeHtml(this.textDialog.statusKind || "error")}">${escapeHtml(this.textDialog.statusMessage)}</p>`
              : ""
          }
          <div class="settings-text-dialog-actions">
            <button class="settings-dialog-option settings-text-dialog-button settings-content-focusable focusable"
                    data-zone="dialog"
                    data-text-dialog-action="save"
                    data-dialog-index="1">
              <span class="settings-dialog-option-label">${escapeHtml(this.textDialog.saveLabel || t("common.save", {}, "Save"))}</span>
            </button>
            ${
              typeof this.textDialog.onClear === "function"
                ? `<button class="settings-dialog-option settings-text-dialog-button settings-content-focusable focusable"
                    data-zone="dialog"
                    data-text-dialog-action="clear"
                    data-dialog-index="2">
              <span class="settings-dialog-option-label">${escapeHtml(this.textDialog.clearLabel || t("common.clear", {}, "Clear"))}</span>
            </button>`
                : ""
            }
            <button class="settings-dialog-option settings-text-dialog-button settings-content-focusable focusable"
                    data-zone="dialog"
                    data-text-dialog-action="cancel"
                    data-dialog-index="${typeof this.textDialog.onClear === "function" ? 3 : 2}">
              <span class="settings-dialog-option-label">${escapeHtml(this.textDialog.cancelLabel || t("common.cancel", {}, "Cancel"))}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  },

  bindTextDialogEvents() {
    if (!this.textDialog) {
      return;
    }
    const field = this.container?.querySelector?.("[data-text-dialog-role='field']");
    if (field && !field.__settingsTextDialogBound) {
      field.__settingsTextDialogBound = true;
      field.addEventListener("input", (event) => {
        if (this.textDialog) {
          this.textDialog.draft = String(event.target?.value ?? "");
          this.textDialog.statusMessage = "";
        }
      });
    }
  },

  async submitTextDialog() {
    if (!this.textDialog) {
      return;
    }
    const field = this.container?.querySelector?.("[data-text-dialog-role='field']");
    const value = String(field?.value ?? this.textDialog.draft ?? "");
    const submit = this.textDialog.onSubmit;
    const returnFocusKey = this.textDialog.returnFocusKey;
    if (typeof submit === "function") {
      const shouldClose = await submit(value);
      if (shouldClose === false) {
        return;
      }
    }
    this.textDialog = null;
    this.contentFocusKey = returnFocusKey || this.contentFocusKey;
    this.focusZone = "content";
  },

  async clearTextDialog() {
    if (!this.textDialog || typeof this.textDialog.onClear !== "function") {
      return;
    }
    const returnFocusKey = this.textDialog.returnFocusKey;
    const shouldClose = await this.textDialog.onClear();
    if (shouldClose === false) {
      return;
    }
    this.textDialog = null;
    this.contentFocusKey = returnFocusKey || this.contentFocusKey;
    this.focusZone = "content";
  },

  getTextDialogMaxFocusIndex() {
    return this.textDialog && typeof this.textDialog.onClear === "function" ? 3 : 2;
  },

  renderCollapsibleRow({ focusKey, title, subtitle, expanded, bodyHtml = "", classes = "" }) {
    return `
      <div class="settings-collapsible${classes ? ` ${classes}` : ""}${expanded ? " is-open" : ""}">
        <button class="settings-action-row settings-collapsible-trigger settings-content-focusable focusable${expanded ? " is-open" : ""}"
                data-zone="content"
                ${this.registerAction(focusKey, this.actionMap.get(focusKey))}
                data-role="section-toggle">
          <span class="settings-row-copy">
            <span class="settings-row-title">${escapeHtml(title)}</span>
            ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
          </span>
          <span class="settings-row-tail">
            <span class="settings-row-value">${expanded ? t("common.open") : t("common.closed")}</span>
            ${iconSvg(expanded ? ROW_ICONS.expand : ROW_ICONS.chevron, "settings-row-icon")}
          </span>
        </button>
        ${
          expanded
            ? `
          <div class="settings-collapsible-body">
            <div class="settings-group-card settings-subsection-card">
              ${bodyHtml}
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
  },

  renderAccountSection(model) {
    const signedIn = model.authState === "authenticated";
    const loading = model.authState === "loading";
    this.actionMap.set("account:signin", () => Router.navigate("authQrSignIn"));
    this.actionMap.set("account:signout", async () => {
      await AuthManager.signOut();
      this.accountSyncOverview = null;
      this.accountSyncOverviewPromise = null;
      this.accountSyncOverviewLoaded = false;
      await this.render();
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "account"))}
      <div class="settings-group-card settings-group-card-fill settings-account-card">
        <div class="settings-account-list">
          ${
            loading
              ? `
            <div class="settings-account-loading">
              ${renderLoadingIndicator()}
              <span>${escapeHtml(t("account_loading", {}, "Loading..."))}</span>
            </div>
          `
              : ""
          }
          ${
            !loading && !signedIn
              ? `
            <p class="settings-account-description">${escapeHtml(t("account_sync_description", {}, "Sync your library, watch progress, addons, and plugins across devices."))}</p>
            <p class="settings-account-inline-note">${escapeHtml(t("account_sync_restart_note", {}, "Sync is not real-time across active devices. Restart this device after signing in or to pick up changes made elsewhere."))}</p>
            ${this.renderAccountActionButton({
              focusKey: "account:signin",
              icon: "vpn_key",
              title: t("account_signin_qr_title", {}, "Sign In with QR"),
              subtitle: t(
                "account_signin_qr_subtitle",
                {},
                "Scan a QR code and complete email login on your phone"
              )
            })}
          `
              : ""
          }
          ${
            signedIn
              ? `
            ${this.renderAccountStatusCard(model.accountEmail || t("settings.status.linkedFallback", {}, "Linked account"))}
            <p class="settings-account-inline-note">${escapeHtml(t("account_sync_restart_note", {}, "Sync is not real-time across active devices. Restart this device after signing in or to pick up changes made elsewhere."))}</p>
            ${
              model.accountSyncOverview
                ? this.renderAccountSyncOverview(model.accountSyncOverview)
                : model.accountSyncOverviewLoading
                  ? this.renderAccountSyncOverviewLoading()
                  : ""
            }
            ${this.renderAccountSignOutButton()}
          `
              : ""
          }
        </div>
      </div>
    `;
  },

  renderAccountStatusCard(value) {
    return `
      <div class="settings-account-status-card">
        <span class="settings-account-status-icon material-icons" aria-hidden="true">check_circle</span>
        <span class="settings-account-status-label">${escapeHtml(t("account_signed_in_label", {}, "Signed in"))}</span>
        <strong class="settings-account-status-value">${escapeHtml(value)}</strong>
      </div>
    `;
  },

  renderAccountActionButton({ focusKey, icon, title, subtitle }) {
    return `
      <button class="settings-account-action-button settings-content-focusable focusable"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}
              data-role="action">
        <span class="settings-account-button-icon material-icons" aria-hidden="true">${escapeHtml(icon)}</span>
        <span class="settings-account-button-copy">
          <span class="settings-account-button-title">${escapeHtml(title)}</span>
          <span class="settings-account-button-subtitle">${escapeHtml(subtitle)}</span>
        </span>
      </button>
    `;
  },

  renderAccountSignOutButton() {
    return `
      <button class="settings-account-signout-button settings-content-focusable focusable"
              data-zone="content"
              ${this.registerAction("account:signout", this.actionMap.get("account:signout"))}
              data-role="action">
        <span class="settings-account-signout-icon material-icons" aria-hidden="true">logout</span>
        <span class="settings-account-signout-label">${escapeHtml(t("account_sign_out", {}, "Sign Out"))}</span>
      </button>
    `;
  },

  renderAccountSyncOverviewLoading() {
    return `
      <div class="settings-account-sync-overview settings-account-sync-loading">
        ${renderLoadingIndicator()}
        <span>${escapeHtml(t("account_loading_sync", {}, "Loading sync data..."))}</span>
      </div>
    `;
  },

  renderAccountSyncOverview(overview) {
    const statLabels = [
      t("account_stat_addons", {}, "addons"),
      t("account_stat_plugins", {}, "plugins"),
      t("account_stat_library", {}, "library"),
      t("account_stat_progress", {}, "progress"),
      t("account_stat_watched", {}, "watched")
    ];
    const renderStats = (values) =>
      values
        .map(
          (value, index) => `
      <span class="settings-account-stat">
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(statLabels[index])}</small>
      </span>
    `
        )
        .join("");
    const rows = Array.isArray(overview?.perProfile) ? overview.perProfile : [];
    return `
      <div class="settings-account-sync-overview">
        <div class="settings-account-sync-row settings-account-sync-total-row">
          <span class="settings-account-sync-total-label">${escapeHtml(t("account_total_label", {}, "Total"))}</span>
          <span class="settings-account-sync-stats">
            ${renderStats([
              overview.totalAddons || 0,
              overview.totalPlugins || 0,
              overview.totalLibrary || 0,
              overview.totalWatchProgress || 0,
              overview.totalWatchedItems || 0
            ])}
          </span>
        </div>
        ${rows
          .map(
            (profile) => `
          <div class="settings-account-sync-row">
            <span class="settings-account-profile-badge" style="background:${escapeHtml(profile.avatarColorHex || "#1E88E5")};">${escapeHtml(
              String(profile.profileName || "?")
                .charAt(0)
                .toUpperCase() || "?"
            )}</span>
            <span class="settings-account-profile-name">${escapeHtml(profile.profileName || `Profile ${profile.profileId || ""}`)}</span>
            <span class="settings-account-sync-stats">
              ${renderStats([
                profile.addons || 0,
                profile.plugins || 0,
                profile.library || 0,
                profile.watchProgress || 0,
                profile.watchedItems || 0
              ])}
            </span>
          </div>
        `
          )
          .join("")}
      </div>
    `;
  },

  renderProfilesSection(model) {
    const isPrimaryProfileActive = String(model?.activeProfileId || "1") === "1";
    if (isPrimaryProfileActive) {
      this.actionMap.set("profiles:manage", () =>
        Router.navigate("profileSelection", {
          mode: "management",
          returnRoute: "settings"
        })
      );
    }
    this.actionMap.set("profiles:rememberLast", () => {
      ProfileManager.setRememberLastProfileEnabled(!ProfileManager.isRememberLastProfileEnabled());
    });
    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "profiles"))}
      <div class="settings-group-card settings-profile-card">
        <div class="settings-stack">
          ${
            isPrimaryProfileActive
              ? this.renderActionRow({
                  focusKey: "profiles:manage",
                  title: t("profile_manage_button", {}, "Manage Profiles"),
                  subtitle: "",
                  icon: null,
                  classes: "settings-profile-manage-row"
                })
              : ""
          }
          ${this.renderToggleRow({
            focusKey: "profiles:rememberLast",
            title: t("settings.profiles.rememberLast.title", {}, "Remember Last Profile"),
            subtitle: t(
              "settings.profiles.rememberLast.subtitle",
              {},
              "Skip the profile picker at startup and use the last selected profile. Profiles with a PIN are always asked."
            ),
            checked: ProfileManager.isRememberLastProfileEnabled()
          })}
        </div>
      </div>
    `;
  },

  renderAdvancedSection(model) {
    this.actionMap.set("advanced:fastHorizontalNavigation", () => {
      LocalStore.set(FAST_HORIZONTAL_NAVIGATION_KEY, !isFastHorizontalNavigationEnabled());
    });
    this.actionMap.set("advanced:strictDpadGrid", () => {
      LocalStore.set(STRICT_DPAD_GRID_KEY, !Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true)));
    });
    this.actionMap.set("advanced:rotatedDpad", () => {
      LocalStore.set(ROTATED_DPAD_KEY, !shouldUseRotatedMapping());
    });
    this.actionMap.set("advanced:clearContinueWatchingCache", () => {
      LocalStore.remove(CW_ENRICHMENT_CACHE_KEY);
      LocalStore.remove(CW_DISPLAY_SNAPSHOT_KEY);
      this.advancedCacheCleared = true;
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "advanced"))}
      <div class="settings-group-heading">
        <div class="settings-group-title">${escapeHtml(t("advanced_section_performance", {}, "Performance & navigation"))}</div>
      </div>
      <div class="settings-group-card">
        <div class="settings-stack">
          ${this.renderToggleRow({
            focusKey: "advanced:fastHorizontalNavigation",
            title: t("advanced_fast_horizontal_navigation", {}, "Fast Horizontal Navigation"),
            subtitle: t(
              "advanced_fast_horizontal_navigation_subtitle",
              {},
              "Increase D-pad repeat speed in rows while keeping repeat throttling enabled."
            ),
            checked: Boolean(model.fastHorizontalNavigation)
          })}
          ${this.renderToggleRow({
            focusKey: "advanced:strictDpadGrid",
            title: t("advanced_strict_dpad_grid", {}, "Strict D-pad Grid Navigation"),
            subtitle: t(
              "advanced_strict_dpad_grid_subtitle",
              {},
              "Keep directional focus movement aligned to rows and columns when possible."
            ),
            checked: Boolean(model.strictDpadGrid)
          })}
          ${this.renderToggleRow({
            focusKey: "advanced:rotatedDpad",
            title: t("advanced_rotated_dpad", {}, "Rotated D-pad Mapping"),
            subtitle: t(
              "advanced_rotated_dpad_subtitle",
              {},
              "Swap directional key mapping for simulators or remotes that report rotated arrows."
            ),
            checked: Boolean(model.rotatedDpad)
          })}
        </div>
      </div>
      <div class="settings-group-heading">
        <div class="settings-group-title">${escapeHtml(t("advanced_section_cache", {}, "Cache"))}</div>
      </div>
      <div class="settings-group-card">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "advanced:clearContinueWatchingCache",
            title: t("advanced_clear_cw_cache", {}, "Clear Continue Watching Cache"),
            subtitle: this.advancedCacheCleared
              ? t("advanced_clear_cw_cache_done", {}, "Cache cleared")
              : t(
                  "advanced_clear_cw_cache_subtitle",
                  {},
                  "Remove cached thumbnails, titles, and enrichment data for Continue Watching"
                ),
            icon: null,
            disabled: Boolean(this.advancedCacheCleared)
          })}
        </div>
      </div>
    `;
  },

  renderAppearanceSection(model) {
    THEME_OPTIONS.forEach((theme) => {
      this.actionMap.set(`appearance:theme:${theme.id}`, () => {
        ThemeStore.set({ themeName: theme.id, accentColor: theme.color });
        ThemeManager.apply();
      });
    });

    this.actionMap.set("appearance:font", () => {
      this.openOptionDialog({
        title: t("appearance_font_dialog_title", {}, "Choose Font"),
        options: FONT_OPTIONS,
        selectedId: model.theme.fontFamily,
        returnFocusKey: "appearance:font",
        dialogClassName: "settings-appearance-dialog",
        onSelect: (option) => {
          ThemeStore.set({ fontFamily: option.id });
          ThemeManager.apply();
        }
      });
    });

    this.actionMap.set("appearance:language", () => {
      this.openOptionDialog({
        title: t("appearance_language_dialog_title", {}, "Choose Language"),
        options: LANGUAGE_OPTIONS,
        selectedId: model.theme.language,
        returnFocusKey: "appearance:language",
        dialogClassName: "settings-appearance-dialog",
        onSelect: async (option) => {
          ThemeStore.set({ language: option.id });
          await I18n.init();
          ThemeManager.apply();
          I18n.apply();
        }
      });
    });
    this.actionMap.set("appearance:amoled", () => {
      const nextAmoled = !ThemeStore.get().amoledMode;
      ThemeStore.set({
        amoledMode: nextAmoled,
        amoledSurfacesMode: nextAmoled ? Boolean(ThemeStore.get().amoledSurfacesMode) : false
      });
      ThemeManager.apply();
    });
    this.actionMap.set("appearance:amoledSurfaces", () => {
      ThemeStore.set({ amoledSurfacesMode: !ThemeStore.get().amoledSurfacesMode });
      ThemeManager.apply();
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "appearance"))}
      <div class="settings-group-card settings-appearance-group-card settings-theme-grid-card">
        <div class="settings-group-heading">
          <div class="settings-group-title">${escapeHtml(t("appearance_color_theme", {}, "Color Theme"))}</div>
          <div class="settings-group-subtitle">${escapeHtml(t("appearance_color_theme_subtitle", {}, "Pick the accent color used across the app"))}</div>
        </div>
        <div class="settings-horizontal-scroll-frame">
          <div class="settings-theme-row">
            ${THEME_OPTIONS.map((theme) =>
              this.renderThemeCard(
                theme,
                String(model.theme.themeName).toUpperCase() === theme.id,
                `appearance:theme:${theme.id}`
              )
            ).join("")}
          </div>
          ${settingsScrollIndicatorMarkup("horizontal")}
        </div>
        ${this.renderToggleRow({
          focusKey: "appearance:amoled",
          title: t("appearance_amoled_mode", {}, "AMOLED Mode"),
          subtitle: t("appearance_amoled_mode_subtitle", {}, "Use pure black for app backgrounds"),
          checked: Boolean(model.theme.amoledMode)
        })}
        ${
          model.theme.amoledMode
            ? this.renderToggleRow({
                focusKey: "appearance:amoledSurfaces",
                title: t("appearance_amoled_surfaces_mode", {}, "Pure Black Surfaces"),
                subtitle: t(
                  "appearance_amoled_surfaces_mode_subtitle",
                  {},
                  "Also make cards, panels, and containers pure black"
                ),
                checked: Boolean(model.theme.amoledSurfacesMode)
              })
            : ""
        }
      </div>
      <div class="settings-group-card settings-appearance-group-card">
        <div class="settings-group-heading">
          <div class="settings-group-title">${escapeHtml(t("appearance_font_and_language", {}, "Font and Language"))}</div>
          <div class="settings-group-subtitle">${escapeHtml(t("appearance_font_and_language_subtitle", {}, "Choose the typeface and locale used throughout the app"))}</div>
        </div>
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "appearance:font",
            title: t("appearance_font", {}, "App Font"),
            subtitle: t("appearance_font_subtitle", {}, "Choose your preferred font"),
            value: labelForFont(model.theme.fontFamily)
          })}
          ${this.renderActionRow({
            focusKey: "appearance:language",
            title: t("appearance_language", {}, "App Language"),
            subtitle: t("appearance_language_subtitle", {}, "Override system language"),
            value: labelForLanguage(model.theme.language)
          })}
        </div>
      </div>
    `;
  },

  renderLayoutSection(model) {
    this.ensureExpandedState("layout");
    const expanded = this.expandedSections.layout;

    this.actionMap.set("layout:toggle:homeLayout", () => {
      this.toggleExpandedSection("layout", "homeLayout");
    });
    this.actionMap.set("layout:toggle:homeContent", () => {
      this.toggleExpandedSection("layout", "homeContent");
    });
    this.actionMap.set("layout:toggle:continueWatching", () => {
      this.toggleExpandedSection("layout", "continueWatching");
    });
    this.actionMap.set("layout:toggle:detailPage", () => {
      this.toggleExpandedSection("layout", "detailPage");
    });
    this.actionMap.set("layout:toggle:focusedPoster", () => {
      this.toggleExpandedSection("layout", "focusedPoster");
    });

    HOME_LAYOUT_OPTIONS.forEach((option) => {
      this.actionMap.set(`layout:layout:${option.id}`, () => {
        LayoutPreferences.set({ homeLayout: option.id });
      });
    });

    this.actionMap.set("layout:collapseSidebar", () => {
      LayoutPreferences.set({ collapseSidebar: !LayoutPreferences.get().collapseSidebar });
    });
    this.actionMap.set("layout:modernSidebar", () => {
      LayoutPreferences.set({ modernSidebar: !LayoutPreferences.get().modernSidebar });
    });
    this.actionMap.set("layout:modernSidebarBlur", () => {
      LayoutPreferences.set({ modernSidebarBlur: !LayoutPreferences.get().modernSidebarBlur });
    });
    this.actionMap.set("layout:heroSection", () => {
      LayoutPreferences.set({ heroSectionEnabled: !LayoutPreferences.get().heroSectionEnabled });
    });
    this.actionMap.set("layout:searchDiscover", () => {
      LayoutPreferences.set({
        searchDiscoverEnabled: !LayoutPreferences.get().searchDiscoverEnabled
      });
    });
    this.actionMap.set("layout:hideUnreleased", () => {
      LayoutPreferences.set({
        hideUnreleasedContent: !LayoutPreferences.get().hideUnreleasedContent
      });
    });
    this.actionMap.set("layout:useEpisodeThumbnailsInCw", () => {
      LayoutPreferences.set({
        useEpisodeThumbnailsInCw: !LayoutPreferences.get().useEpisodeThumbnailsInCw
      });
    });
    this.actionMap.set("layout:blurContinueWatchingNextUp", () => {
      LayoutPreferences.set({
        blurContinueWatchingNextUp: !LayoutPreferences.get().blurContinueWatchingNextUp
      });
    });
    this.actionMap.set("layout:nextUpFromFurthest", () => {
      LayoutPreferences.set({
        nextUpFromFurthestEpisode: !LayoutPreferences.get().nextUpFromFurthestEpisode
      });
    });
    this.actionMap.set("layout:showUnairedNextUp", () => {
      LayoutPreferences.set({ showUnairedNextUp: !LayoutPreferences.get().showUnairedNextUp });
    });
    this.actionMap.set("layout:continueWatchingSortMode", () => {
      const options = [
        {
          id: "default",
          labelKey: "settings.layout.continueWatchingSort.default",
          label: "Default"
        },
        {
          id: "streaming_style",
          labelKey: "settings.layout.continueWatchingSort.streamingStyle",
          label: "Streaming Style"
        }
      ];
      this.openOptionDialog({
        title: t("settings.dialogs.continueWatchingSortMode", {}, "Continue Watching Sort"),
        options,
        selectedId: String(model.layout.continueWatchingSortMode || "default"),
        returnFocusKey: "layout:continueWatchingSortMode",
        onSelect: (option) => {
          LayoutPreferences.set({ continueWatchingSortMode: String(option.id || "default") });
        }
      });
    });
    this.actionMap.set("layout:posterLabels", () => {
      LayoutPreferences.set({ posterLabelsEnabled: !LayoutPreferences.get().posterLabelsEnabled });
    });
    this.actionMap.set("layout:addonName", () => {
      LayoutPreferences.set({
        catalogAddonNameEnabled: !LayoutPreferences.get().catalogAddonNameEnabled
      });
    });
    this.actionMap.set("layout:catalogType", () => {
      LayoutPreferences.set({
        catalogTypeSuffixEnabled: !LayoutPreferences.get().catalogTypeSuffixEnabled
      });
    });
    this.actionMap.set("layout:modernLandscapePosters", () => {
      LayoutPreferences.set({
        modernLandscapePostersEnabled: !LayoutPreferences.get().modernLandscapePostersEnabled
      });
    });
    this.actionMap.set("layout:modernHeroFullScreenBackdrop", () => {
      LayoutPreferences.set({
        modernHeroFullScreenBackdropEnabled:
          !LayoutPreferences.get().modernHeroFullScreenBackdropEnabled
      });
    });
    this.actionMap.set("layout:focusedPosterExpand", () => {
      LayoutPreferences.set({
        focusedPosterBackdropExpandEnabled:
          !LayoutPreferences.get().focusedPosterBackdropExpandEnabled
      });
    });
    this.actionMap.set("layout:focusedPosterExpandDelay", () => {
      const options = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({
        id: String(value),
        label: `${value}s`
      }));
      this.openOptionDialog({
        title: t("settings.dialogs.backdropExpandDelay"),
        options,
        selectedId: String(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3),
        returnFocusKey: "layout:focusedPosterExpandDelay",
        onSelect: (option) => {
          LayoutPreferences.set({
            focusedPosterBackdropExpandDelaySeconds: Number(option.id || 0) || 0
          });
        }
      });
    });
    this.actionMap.set("layout:focusedPosterTrailer", () => {
      LayoutPreferences.set({
        focusedPosterBackdropTrailerEnabled:
          !LayoutPreferences.get().focusedPosterBackdropTrailerEnabled
      });
    });
    this.actionMap.set("layout:focusedPosterTrailerMuted", () => {
      LayoutPreferences.set({
        focusedPosterBackdropTrailerMuted:
          !LayoutPreferences.get().focusedPosterBackdropTrailerMuted
      });
    });
    this.actionMap.set("layout:focusedPosterTrailerTarget", () => {
      const options = [
        { id: "hero_media", labelKey: "settings.layout.trailerTargets.heroMedia" },
        { id: "expanded_card", labelKey: "settings.layout.trailerTargets.expandedCard" }
      ];
      this.openOptionDialog({
        title: t("settings.dialogs.modernTrailerPlaybackLocation"),
        options,
        selectedId: String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media"),
        returnFocusKey: "layout:focusedPosterTrailerTarget",
        onSelect: (option) => {
          LayoutPreferences.set({
            focusedPosterBackdropTrailerPlaybackTarget: String(option.id || "hero_media")
          });
        }
      });
    });
    this.actionMap.set("layout:detail:trailerButton", () => {
      LayoutPreferences.set({
        detailPageTrailerButtonEnabled: !LayoutPreferences.get().detailPageTrailerButtonEnabled
      });
    });
    this.actionMap.set("layout:detail:blurUnwatched", () => {
      LayoutPreferences.set({
        blurUnwatchedEpisodes: !LayoutPreferences.get().blurUnwatchedEpisodes
      });
    });

    const selectedLayout = String(model.layout.homeLayout || "").toLowerCase();
    const isModernLayout = selectedLayout === "modern";
    const isModernLandscape = isModernLayout && Boolean(model.layout.modernLandscapePostersEnabled);
    const cardExpansionEnabled = Boolean(model.layout.focusedPosterBackdropExpandEnabled);
    const showAutoplayRow = cardExpansionEnabled || isModernLandscape;
    const continueWatchingSortMode = String(model.layout.continueWatchingSortMode || "default");
    const continueWatchingSortLabel =
      continueWatchingSortMode === "streaming_style"
        ? t("settings.layout.continueWatchingSort.streamingStyle", {}, "Streaming Style")
        : t("settings.layout.continueWatchingSort.default", {}, "Default");

    const homeLayoutBody = `
      <div class="settings-stack">
        <div class="settings-layout-grid">
          ${HOME_LAYOUT_OPTIONS.map((option) =>
            this.renderLayoutCard(
              option,
              selectedLayout === option.id,
              `layout:layout:${option.id}`
            )
          ).join("")}
        </div>
        ${
          isModernLayout
            ? this.renderToggleRow({
                focusKey: "layout:modernLandscapePosters",
                title: t("settings.layout.landscapePosters.title"),
                subtitle: t("settings.layout.landscapePosters.subtitle"),
                checked: Boolean(model.layout.modernLandscapePostersEnabled)
              })
            : ""
        }
        ${
          isModernLayout
            ? this.renderToggleRow({
                focusKey: "layout:modernHeroFullScreenBackdrop",
                title: t("settings.layout.fullscreenHeroBackdrop.title"),
                subtitle: t("settings.layout.fullscreenHeroBackdrop.subtitle"),
                checked: Boolean(model.layout.modernHeroFullScreenBackdropEnabled)
              })
            : ""
        }
      </div>
    `;

    const homeContentBody = `
      <div class="settings-stack">
        ${
          !model.layout.modernSidebar
            ? this.renderToggleRow({
                focusKey: "layout:collapseSidebar",
                title: t("settings.layout.collapseSidebar.title"),
                subtitle: t("settings.layout.collapseSidebar.subtitle"),
                checked: Boolean(model.layout.collapseSidebar)
              })
            : ""
        }
        ${this.renderToggleRow({
          focusKey: "layout:modernSidebar",
          title: t("settings.layout.modernSidebar.title"),
          subtitle: t("settings.layout.modernSidebar.subtitle"),
          checked: Boolean(model.layout.modernSidebar)
        })}
        ${
          model.layout.modernSidebar && isModernSidebarBlurAvailable()
            ? this.renderToggleRow({
                focusKey: "layout:modernSidebarBlur",
                title: t("settings.layout.modernSidebarBlur.title"),
                subtitle: t("settings.layout.modernSidebarBlur.subtitle"),
                checked: Boolean(model.layout.modernSidebarBlur)
              })
            : ""
        }
        ${this.renderToggleRow({
          focusKey: "layout:heroSection",
          title: t("settings.layout.heroSection.title"),
          subtitle: t("settings.layout.heroSection.subtitle"),
          checked: Boolean(model.layout.heroSectionEnabled)
        })}
        ${this.renderToggleRow({
          focusKey: "layout:searchDiscover",
          title: t("settings.layout.searchDiscover.title"),
          subtitle: t("settings.layout.searchDiscover.subtitle"),
          checked: Boolean(model.layout.searchDiscoverEnabled)
        })}
        ${
          !isModernLayout
            ? this.renderToggleRow({
                focusKey: "layout:posterLabels",
                title: t("settings.layout.posterLabels.title"),
                subtitle: t("settings.layout.posterLabels.subtitle"),
                checked: Boolean(model.layout.posterLabelsEnabled)
              })
            : ""
        }
        ${
          !isModernLayout
            ? this.renderToggleRow({
                focusKey: "layout:addonName",
                title: t("settings.layout.addonName.title"),
                subtitle: t("settings.layout.addonName.subtitle"),
                checked: Boolean(model.layout.catalogAddonNameEnabled)
              })
            : ""
        }
        ${this.renderToggleRow({
          focusKey: "layout:catalogType",
          title: t("settings.layout.catalogType.title"),
          subtitle: t("settings.layout.catalogType.subtitle"),
          checked: Boolean(model.layout.catalogTypeSuffixEnabled)
        })}
        ${this.renderToggleRow({
          focusKey: "layout:hideUnreleased",
          title: t("settings.layout.hideUnreleased.title"),
          subtitle: t("settings.layout.hideUnreleased.subtitle"),
          checked: Boolean(model.layout.hideUnreleasedContent)
        })}
      </div>
    `;

    const continueWatchingBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "layout:useEpisodeThumbnailsInCw",
          title: t("settings.layout.useEpisodeThumbnailsInCw.title", {}, "Use Episode Thumbnails"),
          subtitle: t(
            "settings.layout.useEpisodeThumbnailsInCw.subtitle",
            {},
            "Show episode artwork in Continue Watching cards."
          ),
          checked: model.layout.useEpisodeThumbnailsInCw !== false
        })}
        ${
          model.layout.useEpisodeThumbnailsInCw !== false
            ? this.renderToggleRow({
                focusKey: "layout:blurContinueWatchingNextUp",
                title: t(
                  "settings.layout.blurContinueWatchingNextUp.title",
                  {},
                  "Blur Next Up Artwork"
                ),
                subtitle: t(
                  "settings.layout.blurContinueWatchingNextUp.subtitle",
                  {},
                  "Blur upcoming episode artwork in Continue Watching."
                ),
                checked: Boolean(model.layout.blurContinueWatchingNextUp)
              })
            : ""
        }
        ${this.renderToggleRow({
          focusKey: "layout:nextUpFromFurthest",
          title: t("settings.layout.nextUpFromFurthest.title", {}, "Up Next From Furthest Episode"),
          subtitle: t(
            "settings.layout.nextUpFromFurthest.subtitle",
            {},
            "Use the highest watched episode as the seed for the next episode."
          ),
          checked: model.layout.nextUpFromFurthestEpisode !== false
        })}
        ${this.renderToggleRow({
          focusKey: "layout:showUnairedNextUp",
          title: t("settings.layout.showUnairedNextUp.title", {}, "Show Unaired Next Up Episodes"),
          subtitle: t(
            "settings.layout.showUnairedNextUp.subtitle",
            {},
            "Allow upcoming episodes to appear in Continue Watching."
          ),
          checked: model.layout.showUnairedNextUp !== false
        })}
        ${this.renderActionRow({
          focusKey: "layout:continueWatchingSortMode",
          title: t("settings.layout.continueWatchingSort.title", {}, "Sort Order"),
          subtitle: t(
            "settings.layout.continueWatchingSort.subtitle",
            {},
            "Choose the same Continue Watching ordering used on Android TV."
          ),
          value: continueWatchingSortLabel
        })}
      </div>
    `;

    const detailPageBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "layout:detail:blurUnwatched",
          title: t("settings.layout.blurUnwatched.title"),
          subtitle: t("settings.layout.blurUnwatched.subtitle"),
          checked: Boolean(model.layout.blurUnwatchedEpisodes)
        })}
        ${this.renderToggleRow({
          focusKey: "layout:detail:trailerButton",
          title: t("settings.layout.showTrailerButton.title"),
          subtitle: t("settings.layout.showTrailerButton.subtitle"),
          checked: Boolean(model.layout.detailPageTrailerButtonEnabled)
        })}
        ${this.renderToggleRow({
          focusKey: "layout:detail:preferExternalMeta",
          title: t("settings.layout.preferExternalMeta.title"),
          subtitle: t("settings.layout.preferExternalMeta.subtitle"),
          checked: false,
          disabled: true
        })}
      </div>
    `;

    const focusedPosterBody = `
      <div class="settings-stack">
        ${
          !isModernLandscape
            ? this.renderToggleRow({
                focusKey: "layout:focusedPosterExpand",
                title: t("settings.layout.focusedPosterExpand.title"),
                subtitle: t("settings.layout.focusedPosterExpand.subtitle"),
                checked: Boolean(model.layout.focusedPosterBackdropExpandEnabled)
              })
            : ""
        }
        ${
          !isModernLandscape && Boolean(model.layout.focusedPosterBackdropExpandEnabled)
            ? this.renderActionRow({
                focusKey: "layout:focusedPosterExpandDelay",
                title: t("settings.layout.focusedPosterExpandDelay.title"),
                subtitle: t("settings.layout.focusedPosterExpandDelay.subtitle"),
                value: `${Number(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3)}s`
              })
            : ""
        }
        ${
          showAutoplayRow
            ? this.renderToggleRow({
                focusKey: "layout:focusedPosterTrailer",
                title: isModernLayout
                  ? t("settings.layout.autoplayTrailer.title")
                  : t("settings.layout.autoplayTrailerExpandedCard.title"),
                subtitle: isModernLayout
                  ? t("settings.layout.autoplayTrailer.subtitle")
                  : t("settings.layout.autoplayTrailerExpandedCard.subtitle"),
                checked: Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
              })
            : ""
        }
        ${
          showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
            ? this.renderToggleRow({
                focusKey: "layout:focusedPosterTrailerMuted",
                title: isModernLayout
                  ? t("settings.layout.trailerMuted.title")
                  : t("settings.layout.trailerMutedExpandedCard.title"),
                subtitle: isModernLayout
                  ? t("settings.layout.trailerMuted.subtitle")
                  : t("settings.layout.trailerMutedExpandedCard.subtitle"),
                checked: Boolean(model.layout.focusedPosterBackdropTrailerMuted)
              })
            : ""
        }
        ${
          isModernLayout &&
          showAutoplayRow &&
          Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
            ? this.renderActionRow({
                focusKey: "layout:focusedPosterTrailerTarget",
                title: t("settings.layout.trailerTarget.title"),
                subtitle: t("settings.layout.trailerTarget.subtitle"),
                value:
                  String(
                    model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media"
                  ) === "expanded_card"
                    ? t("settings.layout.trailerTargets.expandedCard")
                    : t("settings.layout.trailerTargets.heroMedia")
              })
            : ""
        }
      </div>
    `;

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "layout"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:homeLayout",
            title: t("settings.layout.groups.homeLayout.title"),
            subtitle: t("settings.layout.groups.homeLayout.subtitle"),
            expanded: Boolean(expanded.homeLayout),
            bodyHtml: homeLayoutBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:homeContent",
            title: t("settings.layout.groups.homeContent.title"),
            subtitle: t("settings.layout.groups.homeContent.subtitle"),
            expanded: Boolean(expanded.homeContent),
            bodyHtml: homeContentBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:continueWatching",
            title: t("settings.layout.groups.continueWatching.title", {}, "Continue Watching"),
            subtitle: t(
              "settings.layout.groups.continueWatching.subtitle",
              {},
              "Configure next episodes and ordering"
            ),
            expanded: Boolean(expanded.continueWatching),
            bodyHtml: continueWatchingBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:detailPage",
            title: t("settings.layout.groups.detailPage.title"),
            subtitle: t("settings.layout.groups.detailPage.subtitle"),
            expanded: Boolean(expanded.detailPage),
            bodyHtml: detailPageBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:focusedPoster",
            title: t("settings.layout.groups.focusedPoster.title"),
            subtitle: t("settings.layout.groups.focusedPoster.subtitle"),
            expanded: Boolean(expanded.focusedPoster),
            bodyHtml: focusedPosterBody
          })}
        </div>
      </div>
    `;
  },

  renderPluginsSection() {
    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "plugins"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-empty-state settings-empty-state-plugins">
          <p class="settings-plugin-soon-text">Plugin support is coming soon.</p>
        </div>
      </div>
    `;
  },

  renderContentDiscoverySection() {
    this.actionMap.set("contentDiscovery:addons", async () => {
      await Router.navigate("plugin");
    });
    this.actionMap.set("contentDiscovery:plugins", async () => {
      await Router.navigate("plugins");
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "contentDiscovery"))}
      <div class="settings-group-card">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "contentDiscovery:addons",
            title: t("addon_title", {}, "Addons"),
            subtitle: t(
              "settings.contentDiscovery.addonsSubtitle",
              {},
              "Manage add-ons, catalog order, and collections"
            ),
            leadingIcon: "grid_view"
          })}
          ${this.renderActionRow({
            focusKey: "contentDiscovery:plugins",
            title: t("plugin_title", {}, "Plugins"),
            subtitle: t(
              "settings.contentDiscovery.pluginsSubtitle",
              {},
              "Manage repositories and stream providers"
            ),
            leadingIcon: "build"
          })}
        </div>
      </div>
    `;
  },

  renderIntegrationHub() {
    this.actionMap.set("integration:hub:debrid", () => {
      this.integrationView = "debrid";
      this.contentFocusKey = "integration:back";
    });
    this.actionMap.set("integration:hub:tmdb", () => {
      this.integrationView = "tmdb";
      this.contentFocusKey = "integration:back";
    });
    this.actionMap.set("integration:hub:mdblist", () => {
      this.integrationView = "mdblist";
      this.contentFocusKey = "integration:back";
    });
    this.actionMap.set("integration:hub:animeskip", () => {
      this.integrationView = "animeskip";
      this.contentFocusKey = "integration:back";
    });

    return `
        ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "integration"))}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:hub:debrid",
              title: t("settings.integration.debrid.label", {}, "Debrid"),
              subtitle: t(
                "settings.integration.debrid.subtitle",
                {},
                "Connect accounts for links and library access"
              )
            })}
            ${this.renderActionRow({
              focusKey: "integration:hub:tmdb",
              title: t("settings.integration.tmdb.label"),
              subtitle: t("settings.integration.tmdb.subtitle")
            })}
            ${this.renderActionRow({
              focusKey: "integration:hub:mdblist",
              title: t("settings.integration.mdblist.label"),
              subtitle: t("settings.integration.mdblist.subtitle")
            })}
            ${this.renderActionRow({
              focusKey: "integration:hub:animeskip",
              title: t("settings.integration.animeskip.label"),
              subtitle: t("settings.integration.animeskip.subtitle")
            })}
          </div>
        </div>
    `;
  },

  renderIntegrationDetail(model, key) {
    this.actionMap.set("integration:back", () => {
      this.integrationView = "hub";
      const focusByIntegration = {
        debrid: "integration:hub:debrid",
        tmdb: "integration:hub:tmdb",
        mdblist: "integration:hub:mdblist",
        animeskip: "integration:hub:animeskip"
      };
      this.contentFocusKey = focusByIntegration[key] || "integration:hub:tmdb";
    });

    if (key === "debrid") {
      const providers = DebridProviders.visible();
      const configuredProviders = providers.filter((provider) =>
        DebridProviders.apiKeyFor(model.debrid, provider.id)
      );
      const resolverProviders = DebridProviders.configuredResolverServices(model.debrid).map(
        (credential) => credential.provider
      );
      const activeResolverProvider =
        DebridProviders.preferredResolverService(model.debrid)?.provider || null;
      const hasResolverProvider = Boolean(activeResolverProvider);
      const canResolvePlayableLinks = Boolean(model.debrid.enabled && hasResolverProvider);
      const hasCloudLibraryProvider = configuredProviders.some((provider) =>
        provider.capabilities?.includes?.("cloudLibrary")
      );
      const canUseCloudLibrary = Boolean(
        model.debrid.cloudLibraryEnabled && hasCloudLibraryProvider
      );
      const streamPreferences = normalizeDebridStreamPreferences(model.debrid.streamPreferences);
      const resolverOptions = resolverProviders.map((provider) => ({
        id: provider.id,
        label: provider.displayName
      }));
      const preferredProviderId = activeResolverProvider?.id || "";

      this.actionMap.set("integration:debrid:enabled", () => {
        if (!hasResolverProvider) return;
        DebridSettingsStore.set({ enabled: !DebridSettingsStore.get().enabled });
      });
      this.actionMap.set("integration:debrid:cloud", () => {
        if (!hasCloudLibraryProvider) return;
        DebridSettingsStore.set({
          cloudLibraryEnabled: !DebridSettingsStore.get().cloudLibraryEnabled
        });
      });
      this.actionMap.set("integration:debrid:provider", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.resolveWith.title", {}, "Resolve with"),
          options: resolverOptions,
          selectedId: preferredProviderId,
          returnFocusKey: "integration:debrid:provider",
          onSelect: (option) => {
            DebridSettingsStore.set({ preferredResolverProviderId: String(option.id || "") });
          }
        });
      });
      providers.forEach((provider) => {
        this.actionMap.set(`integration:debrid:key:${provider.id}`, () => {
          const current = DebridProviders.apiKeyFor(DebridSettingsStore.get(), provider.id);
          this.openTextDialog({
            title: t(
              "settings.integration.debrid.apiKey.prompt",
              { provider: provider.displayName },
              `${provider.displayName} API key`
            ),
            value: current,
            returnFocusKey: `integration:debrid:key:${provider.id}`,
            onSubmit: async (value) => {
              const trimmed = String(value || "").trim();
              if (trimmed && !(await validateDebridApiKey(provider.id, trimmed))) {
                window.alert?.(
                  t("settings.integration.debrid.apiKey.invalid", {}, "Invalid Debrid API key.")
                );
                return false;
              }
              DebridSettingsStore.setProviderApiKey(provider.id, trimmed);
              return true;
            }
          });
        });
      });
      this.actionMap.set("integration:debrid:prepareToggle", () => {
        const enabled = Number(DebridSettingsStore.get().instantPlaybackPreparationLimit || 0) > 0;
        DebridSettingsStore.set({ instantPlaybackPreparationLimit: enabled ? 0 : 2 });
      });
      this.actionMap.set("integration:debrid:prepareCount", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.prepare.count.title", {}, "Links to prepare"),
          options: DEBRID_PREPARE_COUNT_OPTIONS,
          selectedId: model.debrid.instantPlaybackPreparationLimit,
          returnFocusKey: "integration:debrid:prepareCount",
          onSelect: (option) =>
            DebridSettingsStore.set({ instantPlaybackPreparationLimit: Number(option.id || 0) })
        });
      });
      this.actionMap.set("integration:debrid:maxResults", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.maxResults.title", {}, "Max results"),
          options: DEBRID_MAX_RESULTS_OPTIONS,
          selectedId: streamPreferences.maxResults,
          returnFocusKey: "integration:debrid:maxResults",
          onSelect: (option) => DebridSettingsStore.setStreamMaxResults(Number(option.id || 0))
        });
      });
      this.actionMap.set("integration:debrid:sort", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.sort.title", {}, "Sort streams"),
          options: DEBRID_SORT_PROFILE_OPTIONS,
          selectedId: debridSortProfileFor(streamPreferences.sortCriteria),
          returnFocusKey: "integration:debrid:sort",
          onSelect: (option) =>
            DebridSettingsStore.setStreamPreferences({
              ...DebridSettingsStore.get().streamPreferences,
              sortCriteria: DEBRID_SORT_PROFILES[option.id] || []
            })
        });
      });
      this.actionMap.set("integration:debrid:minQuality", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.minQuality.title", {}, "Minimum quality"),
          options: DEBRID_MIN_QUALITY_OPTIONS,
          selectedId: model.debrid.streamMinimumQuality,
          returnFocusKey: "integration:debrid:minQuality",
          onSelect: (option) => DebridSettingsStore.setStreamMinimumQuality(option.id)
        });
      });
      this.actionMap.set("integration:debrid:dv", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.dolbyVision.title", {}, "Dolby Vision"),
          options: DEBRID_FEATURE_FILTER_OPTIONS,
          selectedId: model.debrid.streamDolbyVisionFilter,
          returnFocusKey: "integration:debrid:dv",
          onSelect: (option) => DebridSettingsStore.setStreamDolbyVisionFilter(option.id)
        });
      });
      this.actionMap.set("integration:debrid:hdr", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.hdr.title", {}, "HDR"),
          options: DEBRID_FEATURE_FILTER_OPTIONS,
          selectedId: model.debrid.streamHdrFilter,
          returnFocusKey: "integration:debrid:hdr",
          onSelect: (option) => DebridSettingsStore.setStreamHdrFilter(option.id)
        });
      });
      this.actionMap.set("integration:debrid:codec", () => {
        this.openOptionDialog({
          title: t("settings.integration.debrid.codec.title", {}, "Codec"),
          options: DEBRID_CODEC_OPTIONS,
          selectedId: model.debrid.streamCodecFilter,
          returnFocusKey: "integration:debrid:codec",
          onSelect: (option) => DebridSettingsStore.setStreamCodecFilter(option.id)
        });
      });
      this.actionMap.set("integration:debrid:maxPerResolution", () => {
        this.openOptionDialog({
          title: t("debrid_stream_per_resolution_limit_title", {}, "Per resolution limit"),
          options: DEBRID_MAX_RESULTS_OPTIONS,
          selectedId: streamPreferences.maxPerResolution,
          returnFocusKey: "integration:debrid:maxPerResolution",
          onSelect: (option) =>
            DebridSettingsStore.setStreamPreferences({
              ...DebridSettingsStore.get().streamPreferences,
              maxPerResolution: Number(option.id || 0)
            })
        });
      });
      this.actionMap.set("integration:debrid:maxPerQuality", () => {
        this.openOptionDialog({
          title: t("debrid_stream_per_quality_limit_title", {}, "Per quality limit"),
          options: DEBRID_MAX_RESULTS_OPTIONS,
          selectedId: streamPreferences.maxPerQuality,
          returnFocusKey: "integration:debrid:maxPerQuality",
          onSelect: (option) =>
            DebridSettingsStore.setStreamPreferences({
              ...DebridSettingsStore.get().streamPreferences,
              maxPerQuality: Number(option.id || 0)
            })
        });
      });
      this.actionMap.set("integration:debrid:sizeRange", () => {
        this.openOptionDialog({
          title: t("debrid_stream_size_range_title", {}, "Size range"),
          options: DEBRID_SIZE_RANGE_OPTIONS.map((option) => ({
            ...option,
            label: debridSizeRangeLabel(option.min, option.max)
          })),
          selectedId: debridSizeRangeId(streamPreferences),
          returnFocusKey: "integration:debrid:sizeRange",
          onSelect: (option) =>
            DebridSettingsStore.setStreamPreferences({
              ...DebridSettingsStore.get().streamPreferences,
              sizeMinGb: option.min,
              sizeMaxGb: option.max
            })
        });
      });
      debridRuleRows(streamPreferences).forEach((row) => {
        this.actionMap.set(`integration:debrid:pref:${row.field}`, () => {
          if (row.textList) {
            this.openTextDialog({
              title: t(row.dialogTitleKey, {}, row.field),
              value: row.selectedValues.join("\n"),
              multiline: true,
              returnFocusKey: `integration:debrid:pref:${row.field}`,
              onSubmit: (value) => {
                const values = String(value || "")
                  .split(/[\n,]/)
                  .map((entry) => entry.trim())
                  .filter(Boolean)
                  .filter((entry, index, array) => array.indexOf(entry) === index);
                DebridSettingsStore.setStreamPreferences({
                  ...DebridSettingsStore.get().streamPreferences,
                  [row.field]: values
                });
                return true;
              }
            });
            return;
          }
          this.openMultiChoiceDialog({
            title: t(row.dialogTitleKey, {}, row.field),
            options: row.options,
            selectedIds: row.selectedValues,
            returnFocusKey: `integration:debrid:pref:${row.field}`,
            onToggle: (selectedIds) => {
              DebridSettingsStore.setStreamPreferences({
                ...DebridSettingsStore.get().streamPreferences,
                [row.field]: selectedIds.length ? selectedIds : row.defaultWhenEmpty || []
              });
            }
          });
        });
      });
      this.actionMap.set("integration:debrid:nameTemplate", () => {
        this.openTextDialog({
          title: t("settings.integration.debrid.template.name.prompt", {}, "Stream name pattern"),
          value:
            DebridSettingsStore.get().streamNameTemplate ||
            DEBRID_SETTINGS_DEFAULTS.streamNameTemplate,
          returnFocusKey: "integration:debrid:nameTemplate",
          onSubmit: (value) => {
            DebridSettingsStore.set({ streamNameTemplate: String(value) });
            return true;
          }
        });
      });
      this.actionMap.set("integration:debrid:descriptionTemplate", () => {
        this.openTextDialog({
          title: t(
            "settings.integration.debrid.template.description.prompt",
            {},
            "Stream description pattern"
          ),
          value:
            DebridSettingsStore.get().streamDescriptionTemplate ??
            DEBRID_SETTINGS_DEFAULTS.streamDescriptionTemplate,
          multiline: true,
          returnFocusKey: "integration:debrid:descriptionTemplate",
          onSubmit: (value) => {
            DebridSettingsStore.set({ streamDescriptionTemplate: String(value) });
            return true;
          }
        });
      });
      this.actionMap.set("integration:debrid:resetTemplates", () => {
        DebridSettingsStore.set({
          streamNameTemplate: DEBRID_SETTINGS_DEFAULTS.streamNameTemplate,
          streamDescriptionTemplate: DEBRID_SETTINGS_DEFAULTS.streamDescriptionTemplate
        });
      });

      return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.debrid.label", subtitleKey: "settings.integration.debrid.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: t("settings.integration.backToIntegrations.title"),
              subtitle: t("settings.integration.backToIntegrations.subtitle"),
              icon: "back"
            })}
            <div class="settings-group-heading">
              <div class="settings-group-title">${escapeHtml(t("debrid_experimental_notice", {}, "Experimental Direct Debrid integration"))}</div>
            </div>
            ${this.renderToggleRow({
              focusKey: "integration:debrid:cloud",
              title: t("settings.integration.debrid.cloud.title", {}, "Cloud library"),
              subtitle: t(
                "settings.integration.debrid.cloud.subtitle",
                {},
                "Browse and play files already in your connected accounts."
              ),
              checked: canUseCloudLibrary,
              disabled: !hasCloudLibraryProvider
            })}
            ${this.renderToggleRow({
              focusKey: "integration:debrid:enabled",
              title: t("settings.integration.debrid.enable.title", {}, "Resolve playable links"),
              subtitle: t(
                "settings.integration.debrid.enable.subtitle",
                {},
                "Ask a connected service for playable links when a result needs it. This may add the item to that service."
              ),
              checked: canResolvePlayableLinks,
              disabled: !hasResolverProvider
            })}
            ${
              canResolvePlayableLinks && resolverProviders.length > 1 && activeResolverProvider
                ? this.renderActionRow({
                    focusKey: "integration:debrid:provider",
                    title: t("settings.integration.debrid.resolveWith.title", {}, "Resolve with"),
                    subtitle: t(
                      "settings.integration.debrid.resolveWith.subtitle",
                      {},
                      "Choose which connected account handles playable links."
                    ),
                    value: preferredProviderId
                      ? labelForDebridProvider(preferredProviderId)
                      : activeResolverProvider.displayName
                  })
                : ""
            }
            ${
              !hasResolverProvider
                ? `<div class="settings-group-heading"><div class="settings-group-subtitle">${escapeHtml(t("settings.integration.debrid.addKeyFirst", {}, "Connect an account first."))}</div></div>`
                : ""
            }
            <div class="settings-group-heading">
              <div class="settings-group-title">${escapeHtml(t("debrid_section_account", {}, "Account"))}</div>
            </div>
            ${providers
              .map((provider) =>
                this.renderActionRow({
                  focusKey: `integration:debrid:key:${provider.id}`,
                  title: provider.displayName,
                  subtitle: t(
                    "settings.integration.debrid.providerDescription",
                    { provider: provider.displayName },
                    `Connect your ${provider.displayName} account.`
                  ),
                  value: maskValue(
                    DebridProviders.apiKeyFor(model.debrid, provider.id),
                    t("settings.integration.debrid.notSet", {}, "Not set")
                  ),
                  icon: "chevron"
                })
              )
              .join("")}
            ${
              canResolvePlayableLinks
                ? `
                  <div class="settings-group-heading">
                    <div class="settings-group-title">${escapeHtml(t("debrid_section_instant_playback", {}, "Instant Playback"))}</div>
                  </div>
                  ${this.renderToggleRow({
                    focusKey: "integration:debrid:prepareToggle",
                    title: t("settings.integration.debrid.prepare.title", {}, "Prepare links"),
                    subtitle: t(
                      "settings.integration.debrid.prepare.subtitle",
                      {},
                      "Resolve playable links before playback starts."
                    ),
                    checked: Number(model.debrid.instantPlaybackPreparationLimit || 0) > 0
                  })}
                  ${
                    Number(model.debrid.instantPlaybackPreparationLimit || 0) > 0
                      ? this.renderActionRow({
                          focusKey: "integration:debrid:prepareCount",
                          title: t(
                            "settings.integration.debrid.prepare.count.title",
                            {},
                            "Links to prepare"
                          ),
                          value: labelForOption(
                            DEBRID_PREPARE_COUNT_OPTIONS,
                            model.debrid.instantPlaybackPreparationLimit,
                            "2 links"
                          )
                        })
                      : ""
                  }
                `
                : ""
            }
            <div class="settings-group-heading">
              <div class="settings-group-title">${escapeHtml(t("debrid_section_formatting", {}, "Formatting"))}</div>
            </div>
            ${this.renderActionRow({
              focusKey: "integration:debrid:nameTemplate",
              title: t(
                "settings.integration.debrid.template.name.title",
                {},
                "Stream name pattern"
              ),
              subtitle: t(
                "settings.integration.debrid.template.name.subtitle",
                {},
                "Pattern used to generate Direct Debrid source names."
              ),
              value: t("common.edit", {}, "Edit"),
              disabled: !model.debrid.enabled
            })}
            ${this.renderActionRow({
              focusKey: "integration:debrid:descriptionTemplate",
              title: t(
                "settings.integration.debrid.template.description.title",
                {},
                "Stream description pattern"
              ),
              subtitle: t(
                "settings.integration.debrid.template.description.subtitle",
                {},
                "Pattern used to generate Direct Debrid source details."
              ),
              value: t("common.edit", {}, "Edit"),
              disabled: !model.debrid.enabled
            })}
            ${this.renderActionRow({
              focusKey: "integration:debrid:resetTemplates",
              title: t("settings.integration.debrid.template.reset.title", {}, "Reset formatting"),
              subtitle: t(
                "settings.integration.debrid.template.reset.subtitle",
                {},
                "Restore default source formatting."
              ),
              value: t("settings.integration.debrid.template.reset.value", {}, "Reset"),
              disabled: !model.debrid.enabled
            })}
            ${
              canResolvePlayableLinks
                ? `
                  <div class="settings-group-heading">
                    <div class="settings-group-title">${escapeHtml(t("debrid_section_filters", {}, "Filters"))}</div>
                  </div>
                  ${this.renderActionRow({
                    focusKey: "integration:debrid:maxResults",
                    title: t("settings.integration.debrid.maxResults.title", {}, "Max results"),
                    subtitle: t(
                      "settings.integration.debrid.maxResults.subtitle",
                      {},
                      "Limit how many Direct Debrid sources appear."
                    ),
                    value: labelForOption(
                      DEBRID_MAX_RESULTS_OPTIONS,
                      streamPreferences.maxResults,
                      "All streams"
                    )
                  })}
                  ${this.renderActionRow({
                    focusKey: "integration:debrid:sort",
                    title: t("settings.integration.debrid.sort.title", {}, "Sort streams"),
                    subtitle: t(
                      "settings.integration.debrid.sort.subtitle",
                      {},
                      "Choose how Direct Debrid sources are ordered."
                    ),
                    value: debridSortProfileLabel(streamPreferences.sortCriteria)
                  })}
                  ${this.renderActionRow({
                    focusKey: "integration:debrid:maxPerResolution",
                    title: t(
                      "debrid_stream_per_resolution_limit_title",
                      {},
                      "Per resolution limit"
                    ),
                    subtitle: t(
                      "debrid_stream_per_resolution_limit_subtitle",
                      {},
                      "Cap repeated 2160p, 1080p, 720p results after sorting."
                    ),
                    value: labelForOption(
                      DEBRID_MAX_RESULTS_OPTIONS,
                      streamPreferences.maxPerResolution,
                      "All streams"
                    )
                  })}
                  ${this.renderActionRow({
                    focusKey: "integration:debrid:maxPerQuality",
                    title: t("debrid_stream_per_quality_limit_title", {}, "Per quality limit"),
                    subtitle: t(
                      "debrid_stream_per_quality_limit_subtitle",
                      {},
                      "Cap repeated BluRay, WEB-DL, REMUX results after sorting."
                    ),
                    value: labelForOption(
                      DEBRID_MAX_RESULTS_OPTIONS,
                      streamPreferences.maxPerQuality,
                      "All streams"
                    )
                  })}
                  ${this.renderActionRow({
                    focusKey: "integration:debrid:sizeRange",
                    title: t("debrid_stream_size_range_title", {}, "Size range"),
                    subtitle: t(
                      "debrid_stream_size_range_subtitle",
                      {},
                      "Filter streams by file size."
                    ),
                    value: debridSizeRangeLabel(
                      streamPreferences.sizeMinGb,
                      streamPreferences.sizeMaxGb
                    )
                  })}
                  ${debridRuleRows(streamPreferences)
                    .map((row) =>
                      this.renderActionRow({
                        focusKey: `integration:debrid:pref:${row.field}`,
                        title: t(row.titleKey, {}, row.field),
                        subtitle: t(row.subtitleKey, {}, ""),
                        value: debridSelectionCountLabel(row.selectedValues)
                      })
                    )
                    .join("")}
                `
                : ""
            }
          </div>
        </div>
      `;
    }

    if (key === "tmdb") {
      const toggleTmdbSetting = (field) => {
        TmdbSettingsStore.set({ [field]: !TmdbSettingsStore.get()[field] });
      };
      this.actionMap.set("integration:tmdb:enabled", () => {
        TmdbSettingsStore.set({ enabled: !TmdbSettingsStore.get().enabled });
      });
      this.actionMap.set("integration:tmdb:modernHome", () => {
        toggleTmdbSetting("modernHomeEnabled");
      });
      this.actionMap.set("integration:tmdb:continueWatching", () => {
        toggleTmdbSetting("enrichContinueWatching");
      });
      this.actionMap.set("integration:tmdb:artwork", () => {
        toggleTmdbSetting("useArtwork");
      });
      this.actionMap.set("integration:tmdb:basic", () => {
        toggleTmdbSetting("useBasicInfo");
      });
      this.actionMap.set("integration:tmdb:details", () => {
        toggleTmdbSetting("useDetails");
      });
      this.actionMap.set("integration:tmdb:releaseDates", () => {
        toggleTmdbSetting("useReleaseDates");
      });
      this.actionMap.set("integration:tmdb:credits", () => {
        toggleTmdbSetting("useCredits");
      });
      this.actionMap.set("integration:tmdb:productions", () => {
        toggleTmdbSetting("useProductions");
      });
      this.actionMap.set("integration:tmdb:networks", () => {
        toggleTmdbSetting("useNetworks");
      });
      this.actionMap.set("integration:tmdb:episodes", () => {
        toggleTmdbSetting("useEpisodes");
      });
      this.actionMap.set("integration:tmdb:trailers", () => {
        toggleTmdbSetting("useTrailers");
      });
      this.actionMap.set("integration:tmdb:moreLikeThis", () => {
        toggleTmdbSetting("useMoreLikeThis");
      });
      this.actionMap.set("integration:tmdb:collections", () => {
        toggleTmdbSetting("useCollections");
      });
      this.actionMap.set("integration:tmdb:language", () => {
        this.openOptionDialog({
          title: t("settings.dialogs.selectTmdbLanguage"),
          options: TMDB_LANGUAGE_OPTIONS,
          selectedId: normalizeTmdbLanguageCode(TmdbSettingsStore.get().language),
          returnFocusKey: "integration:tmdb:language",
          onSelect: (option) => {
            TmdbSettingsStore.set({ language: option.id });
          }
        });
      });
      return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.tmdb.label", subtitleKey: "settings.integration.tmdb.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: t("settings.integration.backToIntegrations.title"),
              subtitle: t("settings.integration.backToIntegrations.subtitle"),
              icon: "back"
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:enabled",
              title: t("settings.integration.tmdb.enable.title"),
              subtitle: t("settings.integration.tmdb.enable.subtitle"),
              checked: Boolean(model.tmdb.enabled)
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:modernHome",
              title: t("tmdb_modern_home_title", {}, "Enable on Modern Home"),
              subtitle: t(
                "tmdb_modern_home_subtitle",
                {},
                "Also apply TMDB enrichment to Modern Home hero and focused cards"
              ),
              checked: Boolean(model.tmdb.modernHomeEnabled),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:continueWatching",
              title: t("tmdb_enrich_continue_watching_title", {}, "Enrich Continue Watching"),
              subtitle: t(
                "tmdb_enrich_continue_watching_subtitle",
                {},
                "Apply TMDB enrichment to Continue Watching items"
              ),
              checked: model.tmdb.enrichContinueWatching !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderActionRow({
              focusKey: "integration:tmdb:language",
              title: t("settings.integration.tmdb.language.title"),
              subtitle: t("settings.integration.tmdb.language.subtitle"),
              value: labelForTmdbLanguage(model.tmdb.language),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:artwork",
              title: t("settings.integration.tmdb.artwork.title"),
              subtitle: t("settings.integration.tmdb.artwork.subtitle"),
              checked: Boolean(model.tmdb.useArtwork),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:basic",
              title: t("settings.integration.tmdb.basicInfo.title"),
              subtitle: t("settings.integration.tmdb.basicInfo.subtitle"),
              checked: Boolean(model.tmdb.useBasicInfo),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:details",
              title: t("settings.integration.tmdb.details.title"),
              subtitle: t("settings.integration.tmdb.details.subtitle"),
              checked: Boolean(model.tmdb.useDetails),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:releaseDates",
              title: t("tmdb_release_dates_title", {}, "Release Dates"),
              subtitle: t("tmdb_release_dates_subtitle", {}, "Release and air dates from TMDB"),
              checked: model.tmdb.useReleaseDates !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:credits",
              title: t("tmdb_credits_title", {}, "Credits"),
              subtitle: t(
                "tmdb_credits_subtitle",
                {},
                "Cast with photos, director, and writer from TMDB"
              ),
              checked: model.tmdb.useCredits !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:productions",
              title: t("tmdb_productions_title", {}, "Productions"),
              subtitle: t("tmdb_productions_subtitle", {}, "Production companies from TMDB"),
              checked: model.tmdb.useProductions !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:networks",
              title: t("tmdb_networks_title", {}, "Networks"),
              subtitle: t("tmdb_networks_subtitle", {}, "Networks with logos from TMDB"),
              checked: model.tmdb.useNetworks !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:episodes",
              title: t("tmdb_episodes_title", {}, "Episodes"),
              subtitle: t(
                "tmdb_episodes_subtitle",
                {},
                "Episode titles, overviews, thumbnails, and runtime from TMDB"
              ),
              checked: model.tmdb.useEpisodes !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:trailers",
              title: t("tmdb_trailers_title", {}, "Trailers"),
              subtitle: t(
                "tmdb_trailers_subtitle",
                {},
                "Trailer candidates from TMDB videos for the detail trailer section"
              ),
              checked: model.tmdb.useTrailers !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:moreLikeThis",
              title: t("tmdb_more_like_this_title", {}, "More Like This"),
              subtitle: t(
                "tmdb_more_like_this_subtitle",
                {},
                "TMDB recommendation backdrops on detail page"
              ),
              checked: model.tmdb.useMoreLikeThis !== false,
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:collections",
              title: t("tmdb_collections_title", {}, "Collections"),
              subtitle: t(
                "tmdb_collections_subtitle",
                {},
                "TMDB movie collections in release order"
              ),
              checked: model.tmdb.useCollections !== false,
              disabled: !model.tmdb.enabled
            })}
          </div>
        </div>
      `;
    }

    if (key === "mdblist") {
      const toggleMdbListSetting = (field) => {
        MdbListSettingsStore.set({ [field]: !MdbListSettingsStore.get()[field] });
      };
      this.actionMap.set("integration:mdblist:enabled", () => {
        MdbListSettingsStore.set({ enabled: !MdbListSettingsStore.get().enabled });
      });
      this.actionMap.set("integration:mdblist:key", () => {
        this.openTextDialog({
          title: t("settings.integration.mdblist.dialog.title"),
          value: MdbListSettingsStore.get().apiKey || "",
          placeholder: t("settings.integration.mdblist.dialog.placeholder"),
          returnFocusKey: "integration:mdblist:key",
          clearLabel: t("common.clear", {}, t("action_clear", {}, "Clear")),
          onClear: () => {
            MdbListSettingsStore.set({ apiKey: "" });
            return true;
          },
          onSubmit: async (value) => {
            const trimmed = String(value || "").trim();
            if (trimmed) {
              if (this.textDialog) {
                this.textDialog.statusMessage = t("action_saving", {}, "Saving...");
                this.textDialog.statusKind = "info";
                await this.render({ refreshModel: false });
              }
              const valid = await mdbListRepository.validateApiKey(trimmed);
              if (!valid) {
                if (this.textDialog) {
                  this.textDialog.statusMessage = t("settings.integration.mdblist.invalidApiKey");
                  this.textDialog.statusKind = "error";
                }
                return false;
              }
            }
            MdbListSettingsStore.set({ apiKey: trimmed });
            return true;
          }
        });
      });
      [
        ["trakt", "showTrakt"],
        ["imdb", "showImdb"],
        ["tmdb", "showTmdb"],
        ["letterboxd", "showLetterboxd"],
        ["tomatoes", "showTomatoes"],
        ["audience", "showAudience"],
        ["metacritic", "showMetacritic"]
      ].forEach(([provider, field]) => {
        this.actionMap.set(`integration:mdblist:${provider}`, () => toggleMdbListSetting(field));
      });

      return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.mdblist.label", subtitleKey: "settings.integration.mdblist.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: t("settings.integration.backToIntegrations.title"),
              subtitle: t("settings.integration.backToIntegrations.subtitle"),
              icon: "back"
            })}
            ${this.renderToggleRow({
              focusKey: "integration:mdblist:enabled",
              title: t("settings.integration.mdblist.enable.title"),
              subtitle: t("settings.integration.mdblist.enable.subtitle"),
              checked: Boolean(model.mdbList.enabled)
            })}
            ${this.renderActionRow({
              focusKey: "integration:mdblist:key",
              title: t("settings.integration.mdblist.apiKey.title"),
              subtitle: t("settings.integration.mdblist.apiKey.subtitle"),
              value: maskValue(model.mdbList.apiKey, t("common.notSet")),
              disabled: !model.mdbList.enabled
            })}
            ${[
              ["trakt", "showTrakt"],
              ["imdb", "showImdb"],
              ["tmdb", "showTmdb"],
              ["letterboxd", "showLetterboxd"],
              ["tomatoes", "showTomatoes"],
              ["audience", "showAudience"],
              ["metacritic", "showMetacritic"]
            ]
              .map(([provider, field]) =>
                this.renderToggleRow({
                  focusKey: `integration:mdblist:${provider}`,
                  title: t(`settings.integration.mdblist.${provider}.title`),
                  subtitle: t(`settings.integration.mdblist.${provider}.subtitle`),
                  checked: model.mdbList[field] !== false,
                  disabled: !model.mdbList.enabled
                })
              )
              .join("")}
          </div>
        </div>
      `;
    }

    this.actionMap.set("integration:animeskip:enabled", () => {
      AnimeSkipSettingsStore.set({ enabled: !AnimeSkipSettingsStore.get().enabled });
    });
    this.actionMap.set("integration:animeskip:id", () => {
      this.openTextDialog({
        title: t("settings.integration.animeskip.clientId.prompt"),
        value: AnimeSkipSettingsStore.get().clientId || "",
        returnFocusKey: "integration:animeskip:id",
        onSubmit: (value) => {
          AnimeSkipSettingsStore.set({ clientId: String(value).trim() });
          return true;
        }
      });
    });

    return `
      ${this.renderSectionHeader({ labelKey: "settings.integration.animeskip.label", subtitleKey: "settings.integration.animeskip.subtitle" })}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "integration:back",
            title: t("settings.integration.backToIntegrations.title"),
            subtitle: t("settings.integration.backToIntegrations.subtitle"),
            icon: "back"
          })}
          ${this.renderToggleRow({
            focusKey: "integration:animeskip:enabled",
            title: t("settings.integration.animeskip.enable.title"),
            subtitle: plannedSubtitle(t("settings.integration.animeskip.enable.subtitle")),
            checked: Boolean(model.animeSkip.enabled),
            planned: true
          })}
          ${this.renderActionRow({
            focusKey: "integration:animeskip:id",
            title: t("settings.integration.animeskip.clientId.title"),
            subtitle: plannedSubtitle(t("settings.integration.animeskip.clientId.subtitle")),
            value: maskValue(model.animeSkip.clientId, t("common.notSet")),
            disabled: !model.animeSkip.enabled,
            planned: true
          })}
        </div>
      </div>
    `;
  },

  renderIntegrationSection(model) {
    if (this.integrationView && this.integrationView !== "hub") {
      return this.renderIntegrationDetail(model, this.integrationView);
    }
    return this.renderIntegrationHub();
  },

  renderStreamsSection(model) {
    const badgeSettings = model.streamBadgeSettings || StreamBadgeSettingsStore.get();
    const rules = badgeSettings.rules || { imports: [] };
    const imports = Array.isArray(rules.imports) ? rules.imports : [];
    const previewSourceUrl = String(this.streamBadgePreviewSourceUrl || "").trim();
    const previewImport = previewSourceUrl
      ? imports.find(
          (importItem) =>
            String(importItem?.sourceUrl || "")
              .trim()
              .toLowerCase() === previewSourceUrl.toLowerCase()
        )
      : null;

    this.actionMap.set("streams:add", () => {
      this.openTextDialog({
        title: t("settings_stream_badge_urls_title", {}, "Fusion badge URLs"),
        value: "",
        placeholder: "https://...",
        returnFocusKey: "streams:add",
        onSubmit: async (value) => {
          const result = await StreamBadgeSettingsStore.importStreamBadgeRulesFromUrl(value);
          if (result.status !== "success") {
            if (this.textDialog) {
              this.textDialog.statusMessage =
                result.message ||
                t("settings_fusion_badges_empty", {}, "No Fusion badge URLs imported.");
              this.textDialog.statusKind = "error";
            }
            return false;
          }
          this.streamBadgePreviewSourceUrl =
            result.rules?.imports?.[0]?.sourceUrl || this.streamBadgePreviewSourceUrl || null;
          return true;
        }
      });
    });

    this.actionMap.set("streams:toggle:sizeBadges", () => {
      StreamBadgeSettingsStore.setShowFileSizeBadges(!badgeSettings.showFileSizeBadges);
    });

    this.actionMap.set("streams:toggle:addonLogo", () => {
      StreamBadgeSettingsStore.setShowAddonLogo(!badgeSettings.showAddonLogo);
    });

    const badgePlacement =
      String(badgeSettings.badgePlacement || "BOTTOM")
        .trim()
        .toUpperCase() === "TOP"
        ? "TOP"
        : "BOTTOM";
    const badgePlacementOptions = [
      { id: "BOTTOM", label: t("settings_stream_badge_position_bottom", {}, "Bottom") },
      { id: "TOP", label: t("settings_stream_badge_position_top", {}, "Top") }
    ];
    this.actionMap.set("streams:badgePlacement", () => {
      this.openOptionDialog({
        title: t("settings_stream_badge_position_dialog_title", {}, "Badge position"),
        subtitle: t(
          "settings_stream_badge_position_dialog_description",
          {},
          "Select where stream badges appear on stream cards."
        ),
        options: badgePlacementOptions,
        selectedId: badgePlacement,
        returnFocusKey: "streams:badgePlacement",
        onSelect: (option) => StreamBadgeSettingsStore.setBadgePlacement(option.id)
      });
    });

    this.actionMap.set("streams:preview:close", () => {
      this.streamBadgePreviewSourceUrl = null;
    });

    imports.forEach((importItem, index) => {
      const focusKey = `streams:import:${index}`;
      this.actionMap.set(focusKey, () => {
        const sourceUrl = String(importItem?.sourceUrl || "").trim();
        const options = [];
        if (imports.length > 1 && !importItem.isActive) {
          options.push({ id: "activate", label: "Activate" });
        }
        options.push({ id: "edit", label: "Edit URL" });
        options.push({ id: "preview", label: "Preview" });
        options.push({ id: "delete", label: "Delete" });
        options.push({ id: "cancel", labelKey: "action_cancel", label: "Cancel" });
        this.openOptionDialog({
          title: sourceUrl || t("settings_stream_badge_urls_title", {}, "Fusion badge URLs"),
          options,
          selectedId: "preview",
          returnFocusKey: focusKey,
          onSelect: async (option) => {
            if (option.id === "activate") {
              StreamBadgeSettingsStore.setActiveStreamBadgeRulesSource(sourceUrl);
              this.streamBadgePreviewSourceUrl = sourceUrl;
              return true;
            }
            if (option.id === "preview") {
              this.streamBadgePreviewSourceUrl = sourceUrl;
              return true;
            }
            if (option.id === "delete") {
              StreamBadgeSettingsStore.deleteStreamBadgeRulesSource(sourceUrl);
              if (previewSourceUrl && previewSourceUrl.toLowerCase() === sourceUrl.toLowerCase()) {
                this.streamBadgePreviewSourceUrl = null;
              }
              return true;
            }
            if (option.id === "edit") {
              this.openTextDialog({
                title: t("settings_fusion_badge_url_label", {}, "Fusion badge JSON URL"),
                value: sourceUrl,
                placeholder: "https://...",
                returnFocusKey: focusKey,
                onSubmit: async (nextValue) => {
                  const trimmed = String(nextValue || "").trim();
                  if (!trimmed) {
                    if (this.textDialog) {
                      this.textDialog.statusMessage = "Enter a badge JSON URL.";
                      this.textDialog.statusKind = "error";
                    }
                    return false;
                  }
                  if (trimmed.toLowerCase() === sourceUrl.toLowerCase()) {
                    return true;
                  }
                  const result =
                    await StreamBadgeSettingsStore.importStreamBadgeRulesFromUrl(trimmed);
                  if (result.status !== "success") {
                    if (this.textDialog) {
                      this.textDialog.statusMessage =
                        result.message ||
                        t("settings_fusion_badges_empty", {}, "No Fusion badge URLs imported.");
                      this.textDialog.statusKind = "error";
                    }
                    return false;
                  }
                  StreamBadgeSettingsStore.deleteStreamBadgeRulesSource(sourceUrl);
                  this.streamBadgePreviewSourceUrl =
                    result.rules?.imports?.[0]?.sourceUrl || trimmed;
                  return true;
                }
              });
              return true;
            }
            return true;
          }
        });
      });
    });

    const previewHtml = previewImport ? this.renderStreamBadgePreviewCard(previewImport) : "";
    const emptyHtml = imports.length
      ? ""
      : `<p class="settings-row-subtitle">${escapeHtml(t("settings_fusion_badges_empty", {}, "No Fusion badge URLs imported."))}</p>`;

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "streams"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderToggleRow({
            focusKey: "streams:toggle:sizeBadges",
            title: t("settings_stream_size_badges_title", {}, "Size badges"),
            subtitle: t(
              "settings_stream_size_badges_description",
              {},
              "Show file size badges in stream results and player source panels."
            ),
            checked: badgeSettings.showFileSizeBadges !== false
          })}
          ${this.renderToggleRow({
            focusKey: "streams:toggle:addonLogo",
            title: t("settings_stream_addon_logo_title", {}, "Addon logo"),
            subtitle: t(
              "settings_stream_addon_logo_description",
              {},
              "Show addon logo and name next to stream sources."
            ),
            checked: badgeSettings.showAddonLogo === true
          })}
          ${this.renderActionRow({
            focusKey: "streams:badgePlacement",
            title: t("settings_stream_badge_position_title", {}, "Badge position"),
            subtitle: t(
              "settings_stream_badge_position_description",
              {},
              "Choose whether Fusion and size badges appear above or below stream cards."
            ),
            value:
              badgePlacementOptions.find((option) => option.id === badgePlacement)?.label ||
              badgePlacementOptions[0].label
          })}
          ${this.renderActionRow({
            focusKey: "streams:add",
            title: t("settings_stream_badge_urls_title", {}, "Fusion badge URLs"),
            subtitle: t(
              "settings_stream_badge_urls_description",
              [STREAM_BADGE_IMPORT_LIMIT],
              `Import up to ${STREAM_BADGE_IMPORT_LIMIT} Fusion-style stream badge JSON URLs.`
            ),
            value: t("action_import", {}, "Import")
          })}
          ${imports
            .map((importItem, index) => {
              const sourceUrl = String(importItem?.sourceUrl || "").trim();
              const enabledCount = Array.isArray(importItem?.filters)
                ? importItem.filters.filter((filter) => filter?.isEnabled !== false).length
                : 0;
              const groupCount = Array.isArray(importItem?.groups) ? importItem.groups.length : 0;
              const statusLabel =
                importItem?.isActive === false
                  ? t("settings_fusion_badge_url_inactive", {}, "Inactive")
                  : t("settings_fusion_badge_url_active", {}, "Active");
              const summary = t(
                "settings_fusion_badge_url_status_summary",
                [statusLabel, enabledCount, groupCount],
                `${statusLabel}, ${enabledCount} enabled badges, ${groupCount} groups`
              );
              return this.renderActionRow({
                focusKey: `streams:import:${index}`,
                title: sourceUrl || `Badge URL ${index + 1}`,
                subtitle: summary,
                value: statusLabel
              });
            })
            .join("")}
          ${emptyHtml}
        </div>
      </div>
      ${previewHtml}
    `;
  },

  renderStreamBadgePreviewCard(importItem) {
    const sections = getStreamBadgePreviewSections(importItem);
    const badgeCount = sections.reduce(
      (total, section) => total + (Array.isArray(section.filters) ? section.filters.length : 0),
      0
    );
    const sourceUrl = String(importItem?.sourceUrl || "").trim();
    const bodyHtml = sections.length
      ? sections
          .map(
            (section) => `
          <div class="settings-stream-badge-preview-section">
            <div class="settings-row-title">${escapeHtml(
              section.id === "other"
                ? t("settings_fusion_badge_other_group_title", {}, "Other Fusion badges")
                : section.title
            )}</div>
            <div class="stream-route-card-badges">
              ${(section.filters || [])
                .filter((filter) => String(filter?.imageURL || "").trim())
                .map((filter) => {
                  const filled =
                    String(filter?.tagStyle || "")
                      .trim()
                      .toLowerCase() === "filled";
                  const background = filled ? normalizeStreamBadgeChipColor(filter?.tagColor) : "";
                  const border = normalizeStreamBadgeChipColor(filter?.borderColor);
                  const textColor = normalizeStreamBadgeChipColor(filter?.textColor);
                  const style = [
                    background ? `background:${background};` : "",
                    border ? `border-color:${border};` : "",
                    textColor ? `color:${textColor};` : ""
                  ].join("");
                  return `
        <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
          <img src="${escapeHtml(filter?.imageURL || "")}" alt="${escapeHtml(filter?.name || "")}" loading="lazy" />
        </span>
      `;
                })
                .join("")}
            </div>
          </div>
        `
          )
          .join("")
      : `<p class="settings-row-subtitle">${escapeHtml(t("settings_fusion_badge_preview_empty", {}, "No Fusion-style badge images in this URL."))}</p>`;

    this.actionMap.set("streams:preview:close", () => {
      this.streamBadgePreviewSourceUrl = null;
    });

    return `
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          <div class="settings-row-title">${escapeHtml(t("settings_fusion_badge_preview_title", {}, "Fusion badge preview"))}</div>
          <div class="settings-row-subtitle">${escapeHtml(sourceUrl)}</div>
          <div class="settings-row-subtitle">${escapeHtml(t("settings_fusion_badge_preview_count", [badgeCount], `${badgeCount} Fusion-style badges from this URL`))}</div>
          ${bodyHtml}
          ${this.renderActionRow({
            focusKey: "streams:preview:close",
            title: t("common.close", {}, "Close"),
            subtitle: "",
            value: ""
          })}
        </div>
      </div>
    `;
  },

  renderPlaybackSection(model) {
    this.ensureExpandedState("playback");
    const expanded = this.expandedSections.playback;
    const torrentSettings = model.torrent || TorrentSettingsStore.get();

    this.actionMap.set("playback:toggle:general", () => {
      this.toggleExpandedSection("playback", "general");
    });
    this.actionMap.set("playback:toggle:audio", () => {
      this.toggleExpandedSection("playback", "audio");
    });
    this.actionMap.set("playback:toggle:audioCompatibility", () => {
      this.toggleExpandedSection("playback", "audioCompatibility");
    });
    this.actionMap.set("playback:toggle:subtitles", () => {
      this.toggleExpandedSection("playback", "subtitles");
    });
    this.actionMap.set("playback:toggle:p2p", () => {
      this.toggleExpandedSection("playback", "p2p");
    });

    this.actionMap.set("playback:autoplay", () => {
      PlayerSettingsStore.set({
        autoplayNextEpisode: !PlayerSettingsStore.get().autoplayNextEpisode
      });
    });
    this.actionMap.set("playback:preferBingeGroup", () => {
      PlayerSettingsStore.set({
        streamAutoPlayPreferBingeGroupForNextEpisode:
          !PlayerSettingsStore.get().streamAutoPlayPreferBingeGroupForNextEpisode
      });
    });
    this.actionMap.set("playback:reuseBingeGroup", () => {
      PlayerSettingsStore.set({
        streamAutoPlayReuseBingeGroup: !PlayerSettingsStore.get().streamAutoPlayReuseBingeGroup
      });
    });
    this.actionMap.set("playback:reuseLastLink", () => {
      PlayerSettingsStore.set({
        streamReuseLastLinkEnabled: !PlayerSettingsStore.get().streamReuseLastLinkEnabled
      });
    });
    this.actionMap.set("playback:reuseLastLinkCache", () => {
      this.openOptionDialog({
        title: t("autoplay_last_link_cache", {}, "Last Link Cache Duration"),
        options: STREAM_REUSE_CACHE_HOURS_OPTIONS.map((option) => ({
          ...option,
          label: formatReuseCacheDuration(option.id)
        })),
        selectedId: PlayerSettingsStore.get().streamReuseLastLinkCacheHours,
        returnFocusKey: "playback:reuseLastLinkCache",
        onSelect: (option) => {
          PlayerSettingsStore.set({ streamReuseLastLinkCacheHours: Number(option.id) });
        }
      });
    });
    this.actionMap.set("playback:trailer", () => {
      PlayerSettingsStore.set({ trailerAutoplay: !PlayerSettingsStore.get().trailerAutoplay });
    });
    this.actionMap.set("playback:skipIntro", () => {
      PlayerSettingsStore.set({ skipIntroEnabled: !PlayerSettingsStore.get().skipIntroEnabled });
    });
    this.actionMap.set("playback:forceDts", () => {
      const current = WebOsAudioCompatibilityStore.get();
      WebOsAudioCompatibilityStore.set({
        forceDtsAudio: !current.forceDtsAudio
      });
    });
    this.actionMap.set("playback:forceTrueHd", () => {
      const current = WebOsAudioCompatibilityStore.get();
      WebOsAudioCompatibilityStore.set({
        forceTrueHdAudio: !current.forceTrueHdAudio
      });
    });
    this.actionMap.set("playback:nextEpisodeThresholdMode", () => {
      this.openOptionDialog({
        title: t("settings.playback.nextEpisodeThresholdMode.title", {}, "Next episode threshold"),
        options: NEXT_EPISODE_THRESHOLD_MODE_OPTIONS,
        selectedId: PlayerSettingsStore.get().nextEpisodeThresholdMode,
        returnFocusKey: "playback:nextEpisodeThresholdMode",
        onSelect: (option) => {
          PlayerSettingsStore.set({ nextEpisodeThresholdMode: String(option.id) });
        }
      });
    });
    this.actionMap.set("playback:nextEpisodeThresholdValue", () => {
      const mode = String(
        PlayerSettingsStore.get().nextEpisodeThresholdMode || "PERCENTAGE"
      ).toUpperCase();
      const options =
        mode === "MINUTES_BEFORE_END"
          ? NEXT_EPISODE_THRESHOLD_MINUTE_OPTIONS
          : NEXT_EPISODE_THRESHOLD_PERCENT_OPTIONS;
      const selectedId =
        mode === "MINUTES_BEFORE_END"
          ? PlayerSettingsStore.get().nextEpisodeThresholdMinutesBeforeEnd
          : PlayerSettingsStore.get().nextEpisodeThresholdPercent;
      this.openOptionDialog({
        title:
          mode === "MINUTES_BEFORE_END"
            ? t(
                "settings.playback.nextEpisodeThresholdMinutes.title",
                {},
                "Next episode minutes before end"
              )
            : t(
                "settings.playback.nextEpisodeThresholdPercent.title",
                {},
                "Next episode percentage"
              ),
        options,
        selectedId,
        returnFocusKey: "playback:nextEpisodeThresholdValue",
        onSelect: (option) => {
          const value = Number(option.id);
          if (mode === "MINUTES_BEFORE_END") {
            PlayerSettingsStore.set({ nextEpisodeThresholdMinutesBeforeEnd: value });
          } else {
            PlayerSettingsStore.set({ nextEpisodeThresholdPercent: value });
          }
        }
      });
    });
    this.actionMap.set("playback:stillWatching", () => {
      PlayerSettingsStore.set({
        stillWatchingEnabled: !PlayerSettingsStore.get().stillWatchingEnabled
      });
    });
    this.actionMap.set("playback:stillWatchingThreshold", () => {
      this.openOptionDialog({
        title: t("settings.playback.stillWatchingThreshold.title", {}, "Still watching threshold"),
        options: STILL_WATCHING_THRESHOLD_OPTIONS,
        selectedId: PlayerSettingsStore.get().stillWatchingEpisodeThreshold,
        returnFocusKey: "playback:stillWatchingThreshold",
        onSelect: (option) => {
          PlayerSettingsStore.set({ stillWatchingEpisodeThreshold: Number(option.id) });
        }
      });
    });
    this.actionMap.set("playback:autoStreamMode", () => {
      this.openOptionDialog({
        title: t("autoplay_stream_selection", {}, "Auto Stream Selection"),
        options: STREAM_AUTOPLAY_MODE_OPTIONS,
        selectedId: PlayerSettingsStore.get().streamAutoPlayMode,
        returnFocusKey: "playback:autoStreamMode",
        onSelect: (option) => {
          PlayerSettingsStore.set({ streamAutoPlayMode: option.id });
        }
      });
    });
    this.actionMap.set("playback:autoStreamTimeout", () => {
      this.openOptionDialog({
        title: t("autoplay_timeout_title", {}, "Stream Selection Timeout"),
        options: STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
        selectedId: PlayerSettingsStore.get().streamAutoPlayTimeoutSeconds,
        returnFocusKey: "playback:autoStreamTimeout",
        onSelect: (option) => {
          PlayerSettingsStore.set({ streamAutoPlayTimeoutSeconds: Number(option.id) });
        }
      });
    });
    this.actionMap.set("playback:autoStreamSource", () => {
      this.openOptionDialog({
        title: t("autoplay_scope", {}, "Auto-play Source Scope"),
        options: STREAM_AUTOPLAY_SOURCE_OPTIONS,
        selectedId: PlayerSettingsStore.get().streamAutoPlaySource,
        returnFocusKey: "playback:autoStreamSource",
        onSelect: (option) => {
          PlayerSettingsStore.set({ streamAutoPlaySource: option.id });
        }
      });
    });
    this.actionMap.set("playback:autoStreamRegex", () => {
      this.openTextDialog({
        title: t("autoplay_regex_title", {}, "Regex Pattern"),
        value: PlayerSettingsStore.get().streamAutoPlayRegex || "",
        returnFocusKey: "playback:autoStreamRegex",
        onSubmit: (value) => {
          PlayerSettingsStore.set({ streamAutoPlayRegex: String(value || "").trim() });
          return true;
        }
      });
    });
    this.actionMap.set("playback:autoStreamAddons", async () => {
      const addons = await addonRepository.getInstalledAddons().catch(() => []);
      const options = addons
        .map((addon) => String(addon?.displayName || addon?.name || "").trim())
        .filter(Boolean)
        .map((name) => ({ id: name, label: name }));
      this.openMultiChoiceDialog({
        title: t("autoplay_allowed_addons", {}, "Allowed Addons"),
        options,
        selectedIds: PlayerSettingsStore.get().streamAutoPlaySelectedAddons,
        returnFocusKey: "playback:autoStreamAddons",
        onToggle: (selectedIds) =>
          PlayerSettingsStore.set({ streamAutoPlaySelectedAddons: selectedIds })
      });
    });
    this.actionMap.set("playback:autoStreamPlugins", () => {
      const options = PluginManager.listPluginSources()
        .filter((source) => source?.enabled !== false)
        .map((source) => String(source?.name || "").trim())
        .filter(Boolean)
        .map((name) => ({ id: name, label: name }));
      this.openMultiChoiceDialog({
        title: t("autoplay_allowed_plugins", {}, "Allowed Plugins"),
        options,
        selectedIds: PlayerSettingsStore.get().streamAutoPlaySelectedPlugins,
        returnFocusKey: "playback:autoStreamPlugins",
        onToggle: (selectedIds) =>
          PlayerSettingsStore.set({ streamAutoPlaySelectedPlugins: selectedIds })
      });
    });
    this.actionMap.set("playback:audioLanguage", () => {
      this.openOptionDialog({
        title: t("settings.dialogs.preferredAudioLanguage"),
        options: PREFERRED_PLAYBACK_LANGUAGE_OPTIONS,
        selectedId: PlayerSettingsStore.get().preferredAudioLanguage,
        returnFocusKey: "playback:audioLanguage",
        onSelect: (option) => {
          PlayerSettingsStore.set({ preferredAudioLanguage: option.id });
        }
      });
    });
    this.actionMap.set("playback:subtitlesEnabled", () => {
      PlayerSettingsStore.set({ subtitlesEnabled: !PlayerSettingsStore.get().subtitlesEnabled });
    });
    this.actionMap.set("playback:useForcedSubtitles", () => {
      const currentSettings = PlayerSettingsStore.get();
      PlayerSettingsStore.set({
        subtitleStyle: {
          ...currentSettings.subtitleStyle,
          useForcedSubtitles: !currentSettings.subtitleStyle?.useForcedSubtitles
        }
      });
    });
    this.actionMap.set("playback:showOnlyPreferredSubtitleLanguages", () => {
      const currentSettings = PlayerSettingsStore.get();
      PlayerSettingsStore.set({
        subtitleStyle: {
          ...currentSettings.subtitleStyle,
          showOnlyPreferredLanguages: !currentSettings.subtitleStyle?.showOnlyPreferredLanguages
        }
      });
    });
    this.actionMap.set("playback:subtitleLanguage", () => {
      const currentSettings = PlayerSettingsStore.get();
      const currentLanguage = normalizeSelectableSubtitleLanguageCode(
        currentSettings.subtitleStyle?.preferredLanguage || currentSettings.subtitleLanguage
      );
      this.openOptionDialog({
        title: t("settings.dialogs.preferredSubtitleLanguage"),
        options: PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
        selectedId: currentLanguage === "system" ? "off" : currentLanguage,
        returnFocusKey: "playback:subtitleLanguage",
        dialogClassName: "settings-language-dialog",
        optionRenderer: "subtitle-language",
        onSelect: (option) => {
          const normalized = normalizeSelectableSubtitleLanguageCode(option.id);
          PlayerSettingsStore.set({
            subtitleLanguage: normalized,
            subtitleStyle: {
              ...currentSettings.subtitleStyle,
              preferredLanguage: normalized
            }
          });
        }
      });
    });
    this.actionMap.set("playback:renderMode", () => {
      this.openOptionDialog({
        title: t("settings.dialogs.subtitleRenderMode"),
        options: [
          { id: "native", labelKey: "common.native" },
          { id: "html", labelKey: "common.htmlOverlay" }
        ],
        selectedId: String(PlayerSettingsStore.get().subtitleRenderMode || "native").toLowerCase(),
        returnFocusKey: "playback:renderMode",
        onSelect: (option) => {
          PlayerSettingsStore.set({ subtitleRenderMode: option.id });
        }
      });
    });
    const updateSubtitleStyle = (partial) => {
      const current = PlayerSettingsStore.get();
      PlayerSettingsStore.set({
        subtitleStyle: { ...current.subtitleStyle, ...partial }
      });
    };
    this.actionMap.set("playback:subtitleSize", () => {
      this.openOptionDialog({
        title: t("settings.playback.subtitleSize.title", {}, "Subtitle size"),
        options: SUBTITLE_SIZE_OPTIONS,
        selectedId: clampSubtitleSize(PlayerSettingsStore.get().subtitleStyle?.fontSize ?? 120),
        returnFocusKey: "playback:subtitleSize",
        onSelect: (option) => {
          updateSubtitleStyle({ fontSize: clampSubtitleSize(option.id) });
        }
      });
    });
    this.actionMap.set("playback:subtitleOffset", () => {
      this.openOptionDialog({
        title: t("settings.playback.subtitleOffset.title", {}, "Subtitle position"),
        options: SUBTITLE_OFFSET_OPTIONS,
        selectedId: clampSubtitleOffset(
          PlayerSettingsStore.get().subtitleStyle?.verticalOffset ??
            SUBTITLE_VERTICAL_OFFSET_DEFAULT
        ),
        returnFocusKey: "playback:subtitleOffset",
        onSelect: (option) => {
          updateSubtitleStyle({ verticalOffset: clampSubtitleOffset(option.id) });
        }
      });
    });
    this.actionMap.set("playback:subtitleBold", () => {
      updateSubtitleStyle({ bold: !PlayerSettingsStore.get().subtitleStyle?.bold });
    });
    this.actionMap.set("playback:subtitleTextColor", () => {
      this.openOptionDialog({
        title: t("settings.playback.subtitleTextColor.title", {}, "Subtitle color"),
        options: SUBTITLE_TEXT_COLOR_OPTIONS,
        selectedId: normalizeSubtitleStyleHex(
          PlayerSettingsStore.get().subtitleStyle?.textColor,
          "#FFFFFF"
        ),
        returnFocusKey: "playback:subtitleTextColor",
        onSelect: (option) => {
          updateSubtitleStyle({ textColor: normalizeSubtitleStyleHex(option.id, "#FFFFFF") });
        }
      });
    });
    this.actionMap.set("playback:subtitleOutline", () => {
      updateSubtitleStyle({
        outlineEnabled: !PlayerSettingsStore.get().subtitleStyle?.outlineEnabled
      });
    });
    this.actionMap.set("playback:subtitleOutlineColor", () => {
      this.openOptionDialog({
        title: t("settings.playback.subtitleOutlineColor.title", {}, "Outline color"),
        options: SUBTITLE_OUTLINE_COLOR_OPTIONS,
        selectedId: normalizeSubtitleStyleHex(
          PlayerSettingsStore.get().subtitleStyle?.outlineColor,
          "#000000"
        ),
        returnFocusKey: "playback:subtitleOutlineColor",
        onSelect: (option) => {
          updateSubtitleStyle({ outlineColor: normalizeSubtitleStyleHex(option.id, "#000000") });
        }
      });
    });
    this.actionMap.set("playback:p2pEnabled", () => {
      const current = TorrentSettingsStore.get();
      if (current.p2pEnabled) {
        TorrentSettingsStore.setP2pEnabled(false);
        return;
      }
      this.openOptionDialog({
        title: t("settings_p2p_title"),
        message: t("p2p_consent_body"),
        options: [
          { id: "cancel", labelKey: "p2p_consent_cancel" },
          { id: "enable", labelKey: "p2p_consent_enable" }
        ],
        selectedId: "enable",
        returnFocusKey: "playback:p2pEnabled",
        dialogClassName: "settings-p2p-consent-dialog",
        optionColumns: 2,
        onSelect: (option) => {
          if (String(option.id) === "enable") {
            TorrentSettingsStore.setP2pEnabled(true);
          }
        }
      });
    });
    this.actionMap.set("playback:hideTorrentStats", () => {
      TorrentSettingsStore.setHideTorrentStats(!TorrentSettingsStore.get().hideTorrentStats);
    });

    const generalBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:autoplay",
          title: t("settings.playback.autoplayNextEpisode.title"),
          subtitle: t("settings.playback.autoplayNextEpisode.subtitle"),
          checked: Boolean(model.player.autoplayNextEpisode)
        })}
        ${this.renderToggleRow({
          focusKey: "playback:preferBingeGroup",
          title: t("autoplay_prefer_binge_group", {}, "Prefer Binge Group (Next Episode)"),
          subtitle: t(
            "autoplay_prefer_binge_group_sub",
            {},
            "Try the same source profile first before normal auto-play rules."
          ),
          checked: Boolean(model.player.streamAutoPlayPreferBingeGroupForNextEpisode)
        })}
        ${
          Boolean(model.player.streamAutoPlayPreferBingeGroupForNextEpisode)
            ? this.renderToggleRow({
                focusKey: "playback:reuseBingeGroup",
                title: t("autoplay_reuse_binge_group", {}, "Reuse Binge Group"),
                subtitle: t(
                  "autoplay_reuse_binge_group_sub",
                  {},
                  "Remember and reuse the last binge group across sessions."
                ),
                checked: Boolean(model.player.streamAutoPlayReuseBingeGroup)
              })
            : ""
        }
        ${this.renderToggleRow({
          focusKey: "playback:skipIntro",
          title: t("settings.playback.skipIntro.title", {}, "Skip Intro"),
          subtitle: t(
            "settings.playback.skipIntro.subtitle",
            {},
            "Use IntroDB to detect intro, recap and outro segments when available."
          ),
          checked: Boolean(model.player.skipIntroEnabled)
        })}
        ${this.renderActionRow({
          focusKey: "playback:nextEpisodeThresholdMode",
          title: t(
            "settings.playback.nextEpisodeThresholdMode.title",
            {},
            "Next episode threshold"
          ),
          subtitle: t(
            "settings.playback.nextEpisodeThresholdMode.subtitle",
            {},
            "Choose percentage or minutes before the end."
          ),
          value:
            String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() ===
            "MINUTES_BEFORE_END"
              ? t("settings.playback.nextEpisodeThresholdMode.minutes", {}, "Minutes before end")
              : t("settings.playback.nextEpisodeThresholdMode.percentage", {}, "Percentage")
        })}
        ${this.renderActionRow({
          focusKey: "playback:nextEpisodeThresholdValue",
          title:
            String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() ===
            "MINUTES_BEFORE_END"
              ? t(
                  "settings.playback.nextEpisodeThresholdMinutes.title",
                  {},
                  "Next episode minutes before end"
                )
              : t(
                  "settings.playback.nextEpisodeThresholdPercent.title",
                  {},
                  "Next episode percentage"
                ),
          subtitle:
            String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() ===
            "MINUTES_BEFORE_END"
              ? t(
                  "settings.playback.nextEpisodeThresholdMinutes.subtitle",
                  {},
                  "Start the next episode this many minutes before the end."
                )
              : t(
                  "settings.playback.nextEpisodeThresholdPercent.subtitle",
                  {},
                  "Start the next episode at this percentage."
                ),
          value:
            String(model.player.nextEpisodeThresholdMode || "PERCENTAGE").toUpperCase() ===
            "MINUTES_BEFORE_END"
              ? formatHalfStepSettingValue(
                  model.player.nextEpisodeThresholdMinutesBeforeEnd ?? 2,
                  " min"
                )
              : `${formatHalfStepSettingValue(model.player.nextEpisodeThresholdPercent ?? 99, "")}%`
        })}
        ${
          Boolean(model.player.autoplayNextEpisode)
            ? `
        ${this.renderToggleRow({
          focusKey: "playback:stillWatching",
          title: t("settings.playback.stillWatching.title", {}, "Still watching"),
          subtitle: t(
            "settings.playback.stillWatching.subtitle",
            {},
            "Show a prompt after repeated autoplay episodes."
          ),
          checked: Boolean(model.player.stillWatchingEnabled)
        })}
        ${
          Boolean(model.player.stillWatchingEnabled)
            ? this.renderActionRow({
                focusKey: "playback:stillWatchingThreshold",
                title: t(
                  "settings.playback.stillWatchingThreshold.title",
                  {},
                  "Still watching threshold"
                ),
                subtitle: t(
                  "settings.playback.stillWatchingThreshold.subtitle",
                  {},
                  "How many autoplayed episodes before prompting."
                ),
                value: String(model.player.stillWatchingEpisodeThreshold ?? 3)
              })
            : ""
        }
        `
            : ""
        }
        ${this.renderToggleRow({
          focusKey: "playback:reuseLastLink",
          title: t("autoplay_reuse_last_link", {}, "Reuse Last Link"),
          subtitle: t(
            "autoplay_reuse_last_link_sub",
            {},
            "Auto-play your last working stream for this same movie or episode while the cache is valid."
          ),
          checked: Boolean(model.player.streamReuseLastLinkEnabled)
        })}
        ${
          Boolean(model.player.streamReuseLastLinkEnabled)
            ? this.renderActionRow({
                focusKey: "playback:reuseLastLinkCache",
                title: t("autoplay_last_link_cache", {}, "Last Link Cache Duration"),
                subtitle: t(
                  "autoplay_reuse_last_link_sub",
                  {},
                  "Auto-play your last working stream while the cache is valid."
                ),
                value: formatReuseCacheDuration(model.player.streamReuseLastLinkCacheHours)
              })
            : ""
        }
        ${this.renderActionRow({
          focusKey: "playback:autoStreamMode",
          title: t("autoplay_stream_selection", {}, "Auto Stream Selection"),
          subtitle: translateOptionCaption(
            STREAM_AUTOPLAY_MODE_OPTIONS.find(
              (option) => String(option.id) === String(model.player.streamAutoPlayMode)
            ),
            t("autoplay_mode_manual_desc", {}, "Always show the source list and let me choose.")
          ),
          value: labelForOptionId(
            STREAM_AUTOPLAY_MODE_OPTIONS,
            model.player.streamAutoPlayMode,
            "Manual (choose stream)"
          )
        })}
        ${this.renderActionRow({
          focusKey: "playback:autoStreamTimeout",
          title: t("autoplay_timeout_title", {}, "Stream Selection Timeout"),
          subtitle: t("autoplay_timeout_sub", {}, "Wait time for addons before selecting."),
          value: labelForOptionId(
            STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
            model.player.streamAutoPlayTimeoutSeconds,
            `${model.player.streamAutoPlayTimeoutSeconds}s`
          )
        })}
        ${
          String(model.player.streamAutoPlayMode || "MANUAL") !== "MANUAL"
            ? `
        ${this.renderActionRow({
          focusKey: "playback:autoStreamSource",
          title: t("autoplay_scope", {}, "Auto-play Source Scope"),
          subtitle: labelForOptionId(
            STREAM_AUTOPLAY_SOURCE_OPTIONS,
            model.player.streamAutoPlaySource,
            "All sources"
          ),
          value: labelForOptionId(
            STREAM_AUTOPLAY_SOURCE_OPTIONS,
            model.player.streamAutoPlaySource,
            "All sources"
          )
        })}
        ${
          String(model.player.streamAutoPlaySource || "ALL_SOURCES") !== "ENABLED_PLUGINS_ONLY"
            ? this.renderActionRow({
                focusKey: "playback:autoStreamAddons",
                title: t("autoplay_allowed_addons", {}, "Allowed Addons"),
                subtitle: t(
                  "autoplay_scope_addons_desc",
                  {},
                  "Auto-play only considers selected installed addons."
                ),
                value: model.player.streamAutoPlaySelectedAddons?.length
                  ? String(model.player.streamAutoPlaySelectedAddons.length)
                  : t("autoplay_all_addons", {}, "All installed addons")
              })
            : ""
        }
        ${
          String(model.player.streamAutoPlaySource || "ALL_SOURCES") !== "INSTALLED_ADDONS_ONLY"
            ? this.renderActionRow({
                focusKey: "playback:autoStreamPlugins",
                title: t("autoplay_allowed_plugins", {}, "Allowed Plugins"),
                subtitle: t(
                  "autoplay_scope_plugins_desc",
                  {},
                  "Auto-play only considers selected enabled plugins."
                ),
                value: model.player.streamAutoPlaySelectedPlugins?.length
                  ? String(model.player.streamAutoPlaySelectedPlugins.length)
                  : t("autoplay_all_plugins", {}, "All enabled plugins")
              })
            : ""
        }`
            : ""
        }
        ${
          String(model.player.streamAutoPlayMode || "MANUAL") === "REGEX_MATCH"
            ? `
        ${this.renderActionRow({
          focusKey: "playback:autoStreamRegex",
          title: t("autoplay_regex_title", {}, "Regex Pattern"),
          subtitle: t(
            "autoplay_regex_matches",
            {},
            "Matches stream name, title, description, addon and URL."
          ),
          value:
            String(model.player.streamAutoPlayRegex || "").trim() ||
            t("common.notSet", {}, "Not set")
        })}`
            : ""
        }
      </div>
    `;

    const audioBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:trailer",
          title: t("settings.playback.autoplayTrailer.title"),
          subtitle: t("settings.playback.autoplayTrailer.subtitle"),
          checked: Boolean(model.player.trailerAutoplay)
        })}
        ${this.renderActionRow({
          focusKey: "playback:audioLanguage",
          title: t("settings.playback.preferredAudio.title"),
          subtitle: t("settings.playback.preferredAudio.subtitle"),
          value: labelForPlaybackLanguage(model.player.preferredAudioLanguage)
        })}
      </div>
    `;

    const audioCompatibilityBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:forceDts",
          title: t("settings.playback.forceDts.title", {}, "Force DTS audio"),
          subtitle: t(
            "settings.playback.forceDts.subtitle",
            {},
            "Keep DTS tracks selectable when automatic detection cannot see a working DTS restoration."
          ),
          checked: Boolean(model.webOsAudioCompatibility?.forceDtsAudio)
        })}
        ${this.renderToggleRow({
          focusKey: "playback:forceTrueHd",
          title: t("settings.playback.forceTrueHd.title", {}, "Force TrueHD audio"),
          subtitle: t(
            "settings.playback.forceTrueHd.subtitle",
            {},
            "Keep TrueHD tracks selectable only when this TV can actually decode or pass through TrueHD."
          ),
          checked: Boolean(model.webOsAudioCompatibility?.forceTrueHdAudio)
        })}
      </div>
    `;

    const subtitleBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:subtitlesEnabled",
          title: t("settings.playback.enableSubtitles.title"),
          subtitle: t("settings.playback.enableSubtitles.subtitle"),
          checked: Boolean(model.player.subtitlesEnabled)
        })}
        ${this.renderActionRow({
          focusKey: "playback:subtitleLanguage",
          title: t("settings.playback.subtitleLanguage.title"),
          subtitle: t("settings.playback.subtitleLanguage.subtitle"),
          value: labelForSubtitlePlaybackLanguage(model.player.subtitleLanguage)
        })}
        ${this.renderToggleRow({
          focusKey: "playback:showOnlyPreferredSubtitleLanguages",
          title: t("sub_show_only_preferred_languages", {}, "Show Only Preferred Languages"),
          subtitle: t(
            "sub_show_only_preferred_languages_desc",
            {},
            "Hide all other subtitles languages from selection list"
          ),
          checked: Boolean(model.player.subtitleStyle?.showOnlyPreferredLanguages)
        })}
        ${this.renderToggleRow({
          focusKey: "playback:useForcedSubtitles",
          title: t("settings.playback.useForcedSubtitles.title", {}, "Use forced subtitles"),
          subtitle: t(
            "settings.playback.useForcedSubtitles.subtitle",
            {},
            "Prefer forced subtitles when the audio matches the selected subtitle language."
          ),
          checked: Boolean(model.player.subtitleStyle?.useForcedSubtitles)
        })}
        ${this.renderActionRow({
          focusKey: "playback:subtitleSize",
          title: t("settings.playback.subtitleSize.title", {}, "Subtitle size"),
          subtitle: t(
            "settings.playback.subtitleSize.subtitle",
            {},
            "Text size used for subtitles during playback."
          ),
          value: labelForOptionId(
            SUBTITLE_SIZE_OPTIONS,
            clampSubtitleSize(model.player.subtitleStyle?.fontSize ?? 120),
            `${clampSubtitleSize(model.player.subtitleStyle?.fontSize ?? 120)}%`
          )
        })}
        ${this.renderActionRow({
          focusKey: "playback:subtitleOffset",
          title: t("settings.playback.subtitleOffset.title", {}, "Subtitle position"),
          subtitle: t(
            "settings.playback.subtitleOffset.subtitle",
            {},
            "Move subtitles up or down on the screen."
          ),
          value: labelForOptionId(
            SUBTITLE_OFFSET_OPTIONS,
            clampSubtitleOffset(
              model.player.subtitleStyle?.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT
            ),
            `${SUBTITLE_VERTICAL_OFFSET_DEFAULT}%`
          )
        })}
        ${this.renderToggleRow({
          focusKey: "playback:subtitleBold",
          title: t("settings.playback.subtitleBold.title", {}, "Bold subtitles"),
          subtitle: t("settings.playback.subtitleBold.subtitle", {}, "Show subtitle text in bold."),
          checked: Boolean(model.player.subtitleStyle?.bold)
        })}
        ${this.renderActionRow({
          focusKey: "playback:subtitleTextColor",
          title: t("settings.playback.subtitleTextColor.title", {}, "Subtitle color"),
          subtitle: t(
            "settings.playback.subtitleTextColor.subtitle",
            {},
            "Color of the subtitle text."
          ),
          value: labelForOptionId(
            SUBTITLE_TEXT_COLOR_OPTIONS,
            normalizeSubtitleStyleHex(model.player.subtitleStyle?.textColor, "#FFFFFF"),
            normalizeSubtitleStyleHex(model.player.subtitleStyle?.textColor, "#FFFFFF")
          )
        })}
        ${this.renderToggleRow({
          focusKey: "playback:subtitleOutline",
          title: t("settings.playback.subtitleOutline.title", {}, "Subtitle outline"),
          subtitle: t(
            "settings.playback.subtitleOutline.subtitle",
            {},
            "Draw an outline around subtitle text for readability."
          ),
          checked: Boolean(model.player.subtitleStyle?.outlineEnabled)
        })}
        ${
          model.player.subtitleStyle?.outlineEnabled
            ? this.renderActionRow({
                focusKey: "playback:subtitleOutlineColor",
                title: t("settings.playback.subtitleOutlineColor.title", {}, "Outline color"),
                subtitle: t(
                  "settings.playback.subtitleOutlineColor.subtitle",
                  {},
                  "Color of the subtitle outline."
                ),
                value: labelForOptionId(
                  SUBTITLE_OUTLINE_COLOR_OPTIONS,
                  normalizeSubtitleStyleHex(model.player.subtitleStyle?.outlineColor, "#000000"),
                  normalizeSubtitleStyleHex(model.player.subtitleStyle?.outlineColor, "#000000")
                )
              })
            : ""
        }
        ${this.renderActionRow({
          focusKey: "playback:renderMode",
          title: t("settings.playback.renderMode.title"),
          subtitle: t("settings.playback.renderMode.subtitle"),
          value: renderModeLabel(model.player.subtitleRenderMode)
        })}
      </div>
    `;

    const p2pBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:p2pEnabled",
          title: t("settings_p2p_title"),
          subtitle: t("settings_p2p_subtitle"),
          checked: Boolean(torrentSettings.p2pEnabled)
        })}
        ${this.renderToggleRow({
          focusKey: "playback:hideTorrentStats",
          title: t("settings_p2p_hide_stats_title"),
          subtitle: t("settings_p2p_hide_stats_subtitle"),
          checked: Boolean(torrentSettings.hideTorrentStats)
        })}
      </div>
    `;

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "playback"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:general",
            title: t("settings.playback.groups.general.title"),
            subtitle: t("settings.playback.groups.general.subtitle"),
            expanded: Boolean(expanded.general),
            bodyHtml: generalBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:audio",
            title: t("settings.playback.groups.audio.title"),
            subtitle: t("settings.playback.groups.audio.subtitle"),
            expanded: Boolean(expanded.audio),
            bodyHtml: audioBody
          })}
          ${
            Platform.isWebOS()
              ? this.renderCollapsibleRow({
                  focusKey: "playback:toggle:audioCompatibility",
                  title: t(
                    "settings.playback.groups.audioCompatibility.title",
                    {},
                    "Advanced audio compatibility"
                  ),
                  subtitle: t(
                    "settings.playback.groups.audioCompatibility.subtitle",
                    {},
                    "Automatic detection is used first. Override only when a rooted TV has a working decoder."
                  ),
                  expanded: Boolean(expanded.audioCompatibility),
                  bodyHtml: audioCompatibilityBody
                })
              : ""
          }
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:subtitles",
            title: t("settings.playback.groups.subtitles.title"),
            subtitle: t("settings.playback.groups.subtitles.subtitle"),
            expanded: Boolean(expanded.subtitles),
            bodyHtml: subtitleBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:p2p",
            title: t("settings_p2p_title"),
            subtitle: t("settings_p2p_subtitle"),
            expanded: Boolean(expanded.p2p),
            bodyHtml: p2pBody
          })}
        </div>
      </div>
    `;
  },

  async startTraktDeviceAuth() {
    this.traktLoading = true;
    this.traktErrorMessage = null;
    this.traktStatusMessage = null;
    this.contentFocusKey = "trakt:back";
    await this.render();
    try {
      await TraktAuthService.startDeviceAuth();
      this.traktStatusMessage = "Enter code on trakt.tv/activate";
      this.startTraktPolling();
    } catch (error) {
      this.traktErrorMessage = String(
        error?.message || error || t("qr_login_start_failed", {}, "Failed to start QR login")
      );
    } finally {
      this.traktLoading = false;
      await this.render();
    }
  },

  startTraktPolling(force = false) {
    if (this.traktPollTimer && !force) {
      return;
    }
    this.stopTraktPolling();
    const poll = async () => {
      const state = TraktAuthService.getCurrentAuthState();
      if (
        !state.deviceCode ||
        Router.getCurrent() !== "settings" ||
        this.activeSection !== "trakt"
      ) {
        this.stopTraktPolling();
        return;
      }
      const result = await TraktAuthService.pollDeviceToken().catch((error) => ({
        type: "failed",
        message: String(error?.message || error || "Network error, will retry")
      }));
      if (result.type === "approved") {
        this.stopTraktPolling();
        this.traktStatusMessage = `Connected as ${result.username || "Trakt user"}`;
        this.traktErrorMessage = null;
        await this.loadTraktStats(true);
        await this.render();
        return;
      }
      if (result.type === "pending") {
        this.traktStatusMessage = t("trakt_waiting_approval", {}, "Waiting for approval...");
        this.traktErrorMessage = null;
      } else if (result.type === "slow_down") {
        this.traktStatusMessage = "Rate limited, slowing down polling...";
        this.traktErrorMessage = null;
      } else if (result.type === "expired") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = t(
          "trakt_error_code_expired",
          {},
          "Code expired. Generate a new code."
        );
      } else if (result.type === "denied") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = t("trakt_error_denied", {}, "Trakt authorization was denied.");
      } else if (result.type === "already_used") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = t(
          "trakt_error_code_used",
          {},
          "This Trakt code was already used."
        );
      } else if (result.type === "failed") {
        this.traktStatusMessage = null;
        this.traktErrorMessage = result.message || "Token polling failed";
      }
      await this.render();
      const nextState = TraktAuthService.getCurrentAuthState();
      if (nextState.deviceCode && !this.traktPollTimer) {
        this.traktPollTimer = setTimeout(
          () => {
            this.traktPollTimer = null;
            void poll();
          },
          Math.max(1, Number(nextState.pollInterval || 5)) * 1000
        );
      }
    };
    void poll();
  },

  stopTraktPolling() {
    if (this.traktPollTimer) {
      clearTimeout(this.traktPollTimer);
      this.traktPollTimer = null;
    }
  },

  async loadTraktStats(forceRefresh = false) {
    if (!TraktAuthService.isAuthenticated()) {
      this.traktStats = null;
      this.traktStatsLoading = false;
      return;
    }
    this.traktStatsLoading = true;
    try {
      this.traktStats = await TraktAuthService.fetchStats(forceRefresh);
    } catch (error) {
      console.warn("Failed to load Trakt stats", error);
    } finally {
      this.traktStatsLoading = false;
    }
  },

  openTraktDisconnectDialog() {
    this.openOptionDialog({
      title: t("trakt_disconnect_title", {}, "Disconnect Trakt?"),
      options: [
        { id: "disconnect", labelKey: "trakt_disconnect" },
        { id: "cancel", labelKey: "action_cancel", label: "Cancel" }
      ],
      selectedId: "cancel",
      returnFocusKey: "trakt:disconnect",
      dialogClassName: "settings-trakt-confirm-dialog",
      onSelect: async (option) => {
        if (option.id !== "disconnect") {
          return;
        }
        this.stopTraktPolling();
        this.traktLoading = true;
        await TraktAuthService.disconnect();
        this.traktStats = null;
        this.traktLoading = false;
        this.traktStatusMessage = "Disconnected from Trakt";
      }
    });
  },

  renderTraktSection(model) {
    const trakt = model.trakt || this.collectTraktModel();
    const auth = trakt.auth || {};
    const settings = trakt.settings || TraktSettingsStore.get();
    const mode = trakt.mode || "disconnected";
    const isConnected = mode === "connected";
    const isAwaitingApproval = mode === "awaiting_approval";
    const userCode = auth.userCode || "";
    const remaining = auth.expiresAt ? Math.max(0, Number(auth.expiresAt) - Date.now()) : 0;
    const tokenRemaining =
      auth.createdAt && auth.expiresIn
        ? Math.max(0, (Number(auth.createdAt) + Number(auth.expiresIn)) * 1000 - Date.now())
        : 0;

    if (isAwaitingApproval) {
      if (!this.deferTraktAutoWork?.("polling")) {
        this.startTraktPolling();
      }
    }
    if (isConnected && !this.traktStats && !this.traktStatsLoading) {
      if (!this.deferTraktAutoWork?.("stats")) {
        void this.loadTraktStats(false).then(() => {
          if (this.container && this.activeSection === "trakt") {
            void this.render();
          }
        });
      }
    }

    this.actionMap.set("trakt:back", () => {
      this.syncNavFocusToActive();
      this.focusZone = "nav";
    });
    this.actionMap.set("trakt:login", () => this.startTraktDeviceAuth());
    this.actionMap.set("trakt:cancel", async () => {
      this.stopTraktPolling();
      await TraktAuthService.disconnect();
      this.traktStatusMessage = null;
      this.traktErrorMessage = null;
    });
    this.actionMap.set("trakt:retry", () => this.startTraktPolling(true));
    this.actionMap.set("trakt:disconnect", () => this.openTraktDisconnectDialog());
    this.actionMap.set("trakt:librarySource", () => {
      this.openOptionDialog({
        title: t("trakt_library_source_dialog_title", {}, "Library Source"),
        options: TRAKT_LIBRARY_SOURCE_OPTIONS,
        selectedId: settings.librarySourceMode,
        returnFocusKey: "trakt:librarySource",
        dialogClassName: "settings-trakt-dialog",
        onSelect: (option) => {
          TraktSettingsStore.setLibrarySourceMode(option.id);
          this.traktStatusMessage =
            option.id === TraktLibrarySourceMode.TRAKT
              ? t("trakt_library_source_trakt_selected", {}, "Trakt library selected")
              : t("trakt_library_source_nuvio_selected", {}, "Nuvio library selected");
        }
      });
    });
    this.actionMap.set("trakt:watchProgress", () => {
      this.openOptionDialog({
        title: t("trakt_watch_progress_dialog_title", {}, "Watch Progress"),
        options: TRAKT_WATCH_PROGRESS_OPTIONS,
        selectedId: settings.watchProgressSource,
        returnFocusKey: "trakt:watchProgress",
        dialogClassName: "settings-trakt-dialog",
        onSelect: (option) => {
          TraktSettingsStore.setWatchProgressSource(option.id);
          this.traktStatusMessage =
            option.id === WatchProgressSource.TRAKT
              ? t("trakt_watch_progress_trakt_selected", {}, "Watch progress source set to Trakt")
              : t(
                  "trakt_watch_progress_nuvio_selected",
                  {},
                  "Watch progress source set to Nuvio Sync"
                );
        }
      });
    });
    this.actionMap.set("trakt:cwWindow", () => {
      this.openOptionDialog({
        title: t("trakt_cw_window_title", {}, "Continue Watching Window"),
        message: t(
          "trakt_cw_window_subtitle",
          {},
          "Choose how much Trakt activity should appear in continue watching."
        ),
        options: TRAKT_CONTINUE_WATCHING_DAY_OPTIONS.map((days) => ({
          id: String(days),
          label: labelForTraktContinueWatchingDays(days)
        })),
        selectedId: String(settings.continueWatchingDaysCap),
        returnFocusKey: "trakt:cwWindow",
        dialogClassName: "settings-trakt-dialog",
        optionRenderer: "single-choice",
        onSelect: (option) => {
          TraktSettingsStore.setContinueWatchingDaysCap(Number(option.id));
          this.traktStatusMessage = t(
            "trakt_status_cw_window_updated",
            {},
            "Continue watching window updated"
          );
        }
      });
    });
    this.actionMap.set("trakt:comments", () => {
      this.openOptionDialog({
        title: t("trakt_comments_dialog_title", {}, "Comments"),
        options: TRAKT_COMMENTS_OPTIONS,
        selectedId: settings.showMetaComments ? "on" : "off",
        returnFocusKey: "trakt:comments",
        dialogClassName: "settings-trakt-dialog",
        onSelect: (option) => {
          const enabled = option.id === "on";
          TraktSettingsStore.setShowMetaComments(enabled);
          this.traktStatusMessage = enabled
            ? t("trakt_comments_now_shown", {}, "Trakt reviews on metadata pages are now shown")
            : t("trakt_comments_now_hidden", {}, "Trakt reviews on metadata pages are now hidden");
        }
      });
    });
    this.actionMap.set("trakt:toggleScrobbling", () => {
      const current = TraktSettingsStore.get().enableScrobbling;
      TraktSettingsStore.setEnableScrobbling(!current);
      this.traktStatusMessage = !current
        ? t("trakt_scrobbling_enabled", {}, "Scrobbling to Trakt is now enabled")
        : t("trakt_scrobbling_disabled", {}, "Scrobbling to Trakt is now disabled");
    });

    return `
      <div class="settings-slide-panel settings-trakt-panel">
        <div class="settings-trakt-hero">
          <img class="settings-trakt-logo" src="assets/icons/trakt_tv_favicon.svg" alt="" aria-hidden="true" />
          <div class="settings-trakt-title">Trakt</div>
          <p class="settings-trakt-description">${escapeHtml(t("trakt_description", {}, "Sync your watchlist, watch progress, continue watching, scrobbles, and personal lists with Trakt."))}</p>
          ${isConnected ? `<p class="settings-trakt-connected">${escapeHtml(t("trakt_connected_as", [auth.username || "Trakt user"], `Connected as ${auth.username || "Trakt user"}`))}</p>` : ""}
        </div>
        <div class="settings-trakt-card">
          <div class="settings-trakt-scroll-frame settings-content-frame">
            <div class="settings-trakt-scroll-area">
              <div class="settings-trakt-header-row">
                <div class="settings-trakt-card-title">${escapeHtml(t("trakt_account_login", {}, "Account Login"))}</div>
                ${isAwaitingApproval ? `<button class="settings-trakt-small-button settings-content-focusable focusable" data-zone="content" ${this.registerAction("trakt:cancel", this.actionMap.get("trakt:cancel"))}>${escapeHtml(t("action_cancel", {}, "Cancel"))}</button>` : ""}
              </div>
              ${isAwaitingApproval ? this.renderTraktAwaitingApproval(userCode, remaining) : ""}
              ${isConnected ? this.renderTraktConnected(auth, tokenRemaining, trakt) : ""}
              ${!isAwaitingApproval && !isConnected ? this.renderTraktDisconnected(trakt) : ""}
              ${isConnected ? this.renderTraktOptions(settings) : ""}
              ${!isConnected && trakt.statusMessage ? `<p class="settings-trakt-message">${escapeHtml(trakt.statusMessage)}</p>` : ""}
              ${trakt.errorMessage ? `<p class="settings-trakt-error">${escapeHtml(trakt.errorMessage)}</p>` : ""}
            </div>
            ${settingsScrollIndicatorMarkup("vertical")}
          </div>
          <div class="settings-trakt-footer-row">
            ${isAwaitingApproval ? `<button class="settings-trakt-button settings-content-focusable focusable" data-zone="content" ${this.registerAction("trakt:retry", this.actionMap.get("trakt:retry"))}>${escapeHtml(t("trakt_retry", {}, "Retry"))}</button>` : ""}
            <button class="settings-trakt-button settings-content-focusable focusable" data-zone="content" ${this.registerAction("trakt:back", this.actionMap.get("trakt:back"))}>${escapeHtml(t("trakt_back", {}, "Back"))}</button>
          </div>
        </div>
      </div>
    `;
  },

  renderTraktAwaitingApproval(userCode, remainingMs) {
    const qrDataUrl = createTraktQrDataUrl(userCode);
    return `
      <p class="settings-trakt-body-copy">${escapeHtml(t("trakt_awaiting_instruction", {}, "Go to trakt.tv/activate and enter this code:"))}</p>
      <div class="settings-trakt-code">${escapeHtml(userCode || "-")}</div>
      ${qrDataUrl ? `<img class="settings-trakt-qr" src="${escapeHtml(qrDataUrl)}" alt="${escapeHtml(t("cd_trakt_qr", {}, "Trakt QR code"))}" />` : ""}
      <p class="settings-trakt-meta-copy">${renderTraktCountdownText("trakt_code_expires", remainingMs, "Code expires in", "data-trakt-device-countdown")}</p>
    `;
  },

  renderTraktDisconnected(trakt) {
    return `
      <p class="settings-trakt-body-copy">${escapeHtml(t("trakt_login_instruction", {}, "Press Login to start Trakt device authentication. A QR code will appear here."))}</p>
      <button class="settings-trakt-button settings-trakt-login-button settings-content-focusable focusable${!trakt.credentialsConfigured || trakt.isLoading ? " is-disabled" : ""}"
              data-zone="content"
              ${this.registerAction("trakt:login", !trakt.credentialsConfigured || trakt.isLoading ? () => {} : this.actionMap.get("trakt:login"))}>
        ${escapeHtml(t("trakt_login", {}, "Login"))}
      </button>
      ${!trakt.credentialsConfigured ? `<p class="settings-trakt-warning">${escapeHtml(t("trakt_missing_credentials", {}, "Missing TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET in local.properties."))}</p>` : ""}
    `;
  },

  renderTraktConnected(auth, tokenRemainingMs, trakt) {
    return `
      ${tokenRemainingMs ? `<p class="settings-trakt-meta-copy">${renderTraktCountdownText("trakt_token_refreshes", tokenRemainingMs, "Trakt access token refreshes in", "data-trakt-token-countdown")}</p>` : ""}
      <button class="settings-trakt-button settings-content-focusable focusable" data-zone="content" ${this.registerAction("trakt:disconnect", this.actionMap.get("trakt:disconnect"))}>${escapeHtml(t("trakt_disconnect", {}, "Disconnect"))}</button>
      ${this.renderTraktStatsStrip(trakt.stats, trakt.isStatsLoading)}
    `;
  },

  renderTraktStatsStrip(stats, isLoading) {
    const values = isLoading
      ? ["...", "...", "...", "..."]
      : [
          stats?.moviesWatched ?? "-",
          stats?.showsWatched ?? "-",
          stats?.episodesWatched ?? "-",
          stats?.totalWatchedHours == null ? "-" : `${stats.totalWatchedHours}h`
        ];
    const labels = [
      t("trakt_stat_movies", {}, "Movies"),
      t("trakt_stat_shows", {}, "Shows"),
      t("trakt_stat_episodes", {}, "Episodes"),
      t("trakt_stat_watched_hours", {}, "Watched Hours")
    ];
    return `
      <div class="settings-trakt-stats">
        <div class="settings-trakt-stats-label">${escapeHtml(t("trakt_cached_label", {}, "Cached"))}</div>
        <div class="settings-trakt-stats-line" aria-hidden="true"></div>
        <div class="settings-trakt-stats-row">
          ${values
            .map(
              (value, index) => `
            <div class="settings-trakt-stat">
              <strong>${escapeHtml(value)}</strong>
              <span>${escapeHtml(labels[index])}</span>
            </div>
          `
            )
            .join("")}
        </div>
        <div class="settings-trakt-stats-line" aria-hidden="true"></div>
      </div>
    `;
  },

  renderTraktOptions(settings) {
    return `
      <div class="settings-stack settings-trakt-options-stack">
        ${this.renderActionRow({
          focusKey: "trakt:librarySource",
          title: t("trakt_library_source_title", {}, "Library Source"),
          subtitle: t(
            "trakt_library_source_subtitle",
            {},
            "Choose which library to use for saving and viewing your collection"
          ),
          value: labelForTraktLibrarySource(settings.librarySourceMode)
        })}
        ${this.renderActionRow({
          focusKey: "trakt:watchProgress",
          title: t("trakt_watch_progress_title", {}, "Watch Progress"),
          subtitle: t(
            "trakt_watch_progress_subtitle",
            {},
            "Choose which progress source powers resume and continue watching"
          ),
          value: labelForTraktWatchProgressSource(settings.watchProgressSource)
        })}
        ${this.renderActionRow({
          focusKey: "trakt:cwWindow",
          title: t("trakt_continue_watching_window", {}, "Continue Watching Window"),
          subtitle: t(
            "trakt_continue_watching_subtitle",
            {},
            "Trakt history considered for continue watching"
          ),
          value: labelForTraktContinueWatchingDays(settings.continueWatchingDaysCap)
        })}
        ${this.renderActionRow({
          focusKey: "trakt:comments",
          title: t("trakt_comments_title", {}, "Comments"),
          subtitle: t("trakt_comments_subtitle", {}, "Show Trakt reviews on metadata pages"),
          value: labelForTraktComments(settings.showMetaComments)
        })}
        ${this.renderToggleRow({
          focusKey: "trakt:toggleScrobbling",
          title: t("trakt_scrobbling_title", {}, "Scrobbling"),
          subtitle: t("trakt_scrobbling_subtitle", {}, "Automatically scrobble playback to Trakt"),
          checked: Boolean(settings.enableScrobbling)
        })}
      </div>
    `;
  },

  renderTraktLauncher() {
    this.actionMap.set("trakt:open", () => Router.navigate("trakt"));
    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "trakt"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "trakt:open",
            title: t("settings.trakt.openSettings", {}, "Trakt"),
            subtitle: t("settings.trakt.openSettingsSubtitle", {}, "Open Trakt connection screen.")
          })}
        </div>
      </div>
    `;
  },

  renderAboutSection() {
    this.actionMap.set("about:privacy", () => {
      window.open?.(PRIVACY_URL, "_blank");
    });
    this.actionMap.set("about:supporters", () => Router.navigate("supportersContributors"));
    this.actionMap.set("about:debugConsole", () => Router.navigate("debugConsole"));

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "about"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-about-brand">
          <img class="settings-about-logo" src="assets/brand/app_logo_wordmark.png" alt="Nuvio" />
          <p class="settings-about-copy">${t("settings.about.madeWithLove")}</p>
          <p class="settings-about-copy">${t("settings.about.version", { version: SETTINGS_VERSION_LABEL })}</p>
          <p class="settings-about-copy">${t("settings.about.portedBy")}</p>
        </div>
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "about:privacy",
            title: t("settings.about.privacyPolicy.title"),
            subtitle: t("settings.about.privacyPolicy.subtitle"),
            external: true
          })}
          ${this.renderActionRow({
            focusKey: "about:supporters",
            title: t("settings.about.supporters.title"),
            subtitle: t("settings.about.supporters.subtitle")
          })}
          ${this.renderActionRow({
            focusKey: "about:debugConsole",
            title: t("about_debug_console_title", {}, "Console debug"),
            subtitle: t("about_debug_console_subtitle", {}, "Show latest error/warning events"),
            leadingIcon: "terminal"
          })}
        </div>
      </div>
    `;
  },

  renderSection(section, model) {
    if (section.id === "account") return this.renderAccountSection(model);
    if (section.id === "profiles") return this.renderProfilesSection(model);
    if (section.id === "appearance") return this.renderAppearanceSection(model);
    if (section.id === "layout") return this.renderLayoutSection(model);
    if (section.id === "contentDiscovery") return this.renderContentDiscoverySection();
    if (section.id === "plugins") return this.renderPluginsSection();
    if (section.id === "integration") return this.renderIntegrationSection(model);
    if (section.id === "streams") return this.renderStreamsSection(model);
    if (section.id === "playback") return this.renderPlaybackSection(model);
    if (section.id === "trakt") return this.renderTraktLauncher(model);
    if (section.id === "advanced") return this.renderAdvancedSection(model);
    return this.renderAboutSection(model);
  },

  async render({ refreshModel = true } = {}) {
    if (refreshModel || !this.model) {
      this.model = await this.collectModel();
    }
    this.layoutPrefs = this.model.layout;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.visibleSections = getVisibleSections(this.model);
    this.actionMap = new Map();
    if (!this.visibleSections.length) {
      this.visibleSections = [
        SECTION_META.find((item) => item.id === "appearance") || SECTION_META[0]
      ];
    }
    if (!canOpenSettingsSection(this.activeSection)) {
      this.setActiveSection(this.visibleSections[0]?.id || "appearance");
    }
    this.navIndex = clamp(
      Number.isFinite(this.navIndex)
        ? this.navIndex
        : this.visibleSections.findIndex((item) => item.id === this.activeSection),
      0,
      this.visibleSections.length - 1
    );
    const section =
      getSettingsSectionById(this.activeSection) ||
      this.visibleSections.find((item) => item.id === this.activeSection) ||
      this.visibleSections[0];
    this.ensureExpandedState(section.id);
    this.persistUiState();

    this.ensureShell();

    const shell = this.container.querySelector(".settings-shell");
    if (shell) {
      shell.classList.toggle("settings-route-enter", Boolean(this.settingsRouteEnterPending));
      if (this.settingsRouteEnterPending) {
        void shell.offsetWidth;
      }
    }

    const rootSidebarSlot = this.container.querySelector("[data-settings-root-sidebar]");
    const navSlot = this.container.querySelector("[data-settings-nav]");
    const contentSlot = this.container.querySelector("[data-settings-content]");
    const dialogSlot = this.container.querySelector("[data-settings-dialog]");

    const rootSidebarHtml = renderRootSidebar({
      selectedRoute: "settings",
      profile: this.sidebarProfile,
      layout: this.layoutPrefs,
      expanded: Boolean(this.sidebarExpanded),
      pillIconOnly: Boolean(this.pillIconOnly)
    });
    if (rootSidebarSlot && rootSidebarSlot.innerHTML !== rootSidebarHtml) {
      rootSidebarSlot.innerHTML = rootSidebarHtml;
    }

    const navHtml = this.renderNav();
    if (navSlot && navSlot.innerHTML !== navHtml) {
      navSlot.innerHTML = navHtml;
    }
    if (navSlot && this.railScrollNode !== navSlot) {
      if (this.railScrollNode && this.handleRailScrollBound) {
        this.railScrollNode.removeEventListener("scroll", this.handleRailScrollBound);
      }
      this.handleRailScrollBound = () => {
        this.railScrollTop = Number(navSlot.scrollTop || 0);
        updateSettingsRailIndicators(navSlot);
      };
      navSlot.addEventListener("scroll", this.handleRailScrollBound, { passive: true });
      this.railScrollNode = navSlot;
    }
    if (navSlot && Number.isFinite(this.restoreRailScrollTop)) {
      if (navSlot.settingsScrollAnimationFrame) {
        cancelAnimationFrame(navSlot.settingsScrollAnimationFrame);
        navSlot.settingsScrollAnimationFrame = null;
      }
      navSlot.scrollTop = clamp(
        this.restoreRailScrollTop,
        0,
        Math.max(0, navSlot.scrollHeight - navSlot.clientHeight)
      );
      this.railScrollTop = Number(navSlot.scrollTop || 0);
      this.restoreRailScrollTop = null;
    }
    updateSettingsRailIndicatorsSoon(navSlot);
    updateSettingsScrollIndicatorsSoon(navSlot);

    const sectionChanged = this.renderedSectionId !== section.id;
    const previousScrollState = !sectionChanged ? captureSettingsScrollState(contentSlot) : null;
    this.renderedSectionId = section.id;
    if (contentSlot) {
      contentSlot.innerHTML = this.renderSection(section, this.model);
      if (previousScrollState) {
        restoreSettingsScrollState(contentSlot, previousScrollState);
      }
      if (sectionChanged) {
        contentSlot.classList.remove("is-section-transitioning");
        void contentSlot.offsetWidth;
        contentSlot.classList.add("is-section-transitioning");
      } else {
        contentSlot.classList.remove("is-section-transitioning");
      }
    }

    const dialogHtml = this.optionDialog ? this.renderOptionDialog() : this.renderTextDialog();
    if (dialogSlot && dialogSlot.innerHTML !== dialogHtml) {
      dialogSlot.innerHTML = dialogHtml;
    }
    this.bindTextDialogEvents();

    bindRootSidebarEvents(this.container, {
      currentRoute: "settings",
      onSelectedAction: () => this.closeSidebarToNav(),
      onExpandSidebar: () => this.openSidebar()
    });
    ScreenUtils.indexFocusables(this.container);
    bindSettingsScrollIndicators(this.container);
    this.settingsRouteEnterPending = false;
    this.applyFocus();
    syncLayoutPreviewMetricsSoon(this.container);
    updateSettingsRailIndicatorsSoon(navSlot);
    updateSettingsScrollIndicatorsSoon(contentSlot);
  },

  applyFocus() {
    this.container
      .querySelectorAll(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    updateSettingsMarqueeTargets(this.container);
    const selectedNode = this.container.querySelector(".settings-nav-item.selected");
    if (selectedNode && this.focusZone !== "nav") {
      scrollSettingsRailItem(selectedNode);
    }

    if (this.optionDialog) {
      const dialogNode =
        this.container.querySelector(
          `.settings-dialog-option[data-dialog-index="${this.dialogFocusIndex}"]`
        ) || this.container.querySelector(".settings-dialog-option");
      if (dialogNode) {
        dialogNode.classList.add("focused");
        focusSettingsNode(dialogNode);
        scrollSettingsContentItem(dialogNode);
      }
      return;
    }

    if (this.textDialog) {
      const dialogNode =
        this.dialogFocusIndex === 0
          ? this.container.querySelector("[data-text-dialog-role='field']")
          : this.container.querySelector(
              `.settings-text-dialog-button[data-dialog-index="${this.dialogFocusIndex}"]`
            );
      if (dialogNode) {
        dialogNode.classList.add("focused");
        focusSettingsNode(dialogNode);
        if (dialogNode.matches?.("[data-text-dialog-role='field']")) {
          try {
            const length = String(dialogNode.value || "").length;
            dialogNode.setSelectionRange?.(length, length);
          } catch (_) {
            // Ignore unsupported selection APIs on TV browsers.
          }
        }
        scrollSettingsContentItem(dialogNode);
      }
      return;
    }

    if (this.focusZone === "sidebar") {
      const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      const sidebarNode =
        sidebarNodes[this.sidebarFocusIndex] ||
        getRootSidebarSelectedNode(this.container, this.layoutPrefs);
      if (sidebarNode) {
        sidebarNode.classList.add("focused");
        focusSettingsNode(sidebarNode);
        if (!this.layoutPrefs?.modernSidebar) {
          setLegacySidebarExpanded(this.container, true);
        }
        return;
      }
      this.focusZone = "nav";
    }

    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    if (this.focusZone === "content") {
      const contentNode = this.contentFocusKey
        ? this.container.querySelector(
            focusKeySelector(".settings-content-focusable", this.contentFocusKey)
          )
        : null;
      const fallbackContent =
        contentNode || this.container.querySelector(".settings-content-focusable");
      if (fallbackContent) {
        fallbackContent.classList.add("focused");
        focusSettingsNode(fallbackContent);
        if (this.suppressNextContentFocusScroll) {
          this.suppressNextContentFocusScroll = false;
        } else {
          scrollSettingsContentItem(fallbackContent);
        }
        this.contentFocusKey = String(fallbackContent.dataset.focusKey || "");
        return;
      }
      this.focusZone = "nav";
    }

    const navNode =
      this.container.querySelector(`.settings-nav-item[data-nav-index="${this.navIndex}"]`) ||
      this.container.querySelector(".settings-nav-item");
    if (navNode) {
      navNode.classList.add("focused");
      focusSettingsNode(navNode);
      if (this.suppressNextRailFocusScroll) {
        this.suppressNextRailFocusScroll = false;
        updateSettingsRailIndicators(navNode.closest?.(".settings-sidebar"));
      } else {
        scrollSettingsRailItem(navNode);
      }
      updateSettingsMarqueeTargets(this.container);
    }
  },

  async openSidebar() {
    this.focusZone = "sidebar";
    const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    const selectedSidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
    this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selectedSidebarNode));
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    }
    this.applyFocus();
  },

  async closeSidebarToNav() {
    this.syncNavFocusToActive();
    this.focusZone = "nav";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    }
    this.applyFocus();
  },

  moveNavFocus(index) {
    this.navIndex = clamp(index, 0, this.visibleSections.length - 1);
    this.applyFocus();
  },

  async activateNavSelection() {
    const section = this.visibleSections[this.navIndex];
    if (!section) {
      return;
    }
    if (section.id === "trakt") {
      await Router.navigate("trakt");
      return;
    }
    this.setActiveSection(section.id);
    this.integrationView = "hub";
    this.contentFocusKey = section.id === "appearance" ? this.getAppearanceThemeFocusKey() : null;
    await this.render({ refreshModel: false });
  },

  syncNavFocusToActive() {
    const activeIndex = this.visibleSections.findIndex((item) => item.id === this.activeSection);
    if (activeIndex >= 0) {
      this.navIndex = activeIndex;
    }
  },

  updateFocusedContentKey() {
    const focused = this.container.querySelector(".settings-content-focusable.focused");
    if (focused) {
      this.contentFocusKey = String(focused.dataset.focusKey || "");
      this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
    }
  },

  moveContent(direction) {
    const before = this.container.querySelector(".settings-content-focusable.focused");
    const beforeFocusKey = String(before?.dataset?.focusKey || "");

    if (
      this.activeSection === "appearance" &&
      direction === "up" &&
      beforeFocusKey === "appearance:font"
    ) {
      const rememberedTheme =
        this.container.querySelector(
          focusKeySelector(".settings-content-focusable", this.getAppearanceThemeFocusKey())
        ) || this.container.querySelector(".settings-theme-card.settings-content-focusable");
      if (rememberedTheme) {
        before?.classList?.remove("focused");
        rememberedTheme.classList.add("focused");
        focusSettingsNode(rememberedTheme);
        this.contentFocusKey = String(rememberedTheme.dataset.focusKey || "");
        this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
        scrollSettingsContentItem(rememberedTheme);
        return before !== rememberedTheme;
      }
    }

    if (
      this.activeSection === "appearance" &&
      direction === "down" &&
      isAppearanceThemeFocusKey(beforeFocusKey)
    ) {
      const themeCards = Array.from(
        this.container.querySelectorAll(".settings-theme-card.settings-content-focusable")
      );
      const beforeRect = before?.getBoundingClientRect?.();
      const beforeCenterY = beforeRect ? beforeRect.top + beforeRect.height / 2 : 0;
      const beforeCenterX = beforeRect ? beforeRect.left + beforeRect.width / 2 : 0;
      const themeBelow = themeCards
        .filter((card) => card !== before)
        .map((card) => {
          const rect = card.getBoundingClientRect();
          const centerY = rect.top + rect.height / 2;
          const centerX = rect.left + rect.width / 2;
          return {
            card,
            verticalDistance: centerY - beforeCenterY,
            horizontalDistance: Math.abs(centerX - beforeCenterX)
          };
        })
        .filter((entry) => entry.verticalDistance > 2)
        .sort((left, right) => {
          if (left.verticalDistance !== right.verticalDistance) {
            return left.verticalDistance - right.verticalDistance;
          }
          return left.horizontalDistance - right.horizontalDistance;
        });

      const nextTheme = themeBelow[0]?.card || null;
      if (nextTheme) {
        before?.classList?.remove("focused");
        nextTheme.classList.add("focused");
        focusSettingsNode(nextTheme);
        this.contentFocusKey = String(nextTheme.dataset.focusKey || "");
        this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
        scrollSettingsContentItem(nextTheme);
        return before !== nextTheme;
      }
    }

    ScreenUtils.moveFocusDirectional(this.container, direction, ".settings-content-focusable");
    const after = this.container.querySelector(".settings-content-focusable.focused");
    if (after) {
      this.contentFocusKey = String(after.dataset.focusKey || "");
      if (isAppearanceThemeFocusKey(beforeFocusKey)) {
        this.rememberAppearanceThemeFocusKey(beforeFocusKey);
      }
      this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
      scrollSettingsContentItem(after);
    }
    return before !== after;
  },

  handleWheelEvent(event) {
    const themeGrid = event?.target?.closest?.(".settings-theme-grid");
    if (!themeGrid) {
      return;
    }

    const deltaY = Number(event.deltaY || 0);
    if (!deltaY) {
      return;
    }

    const direction = deltaY < 0 ? "up" : "down";
    if (!isScrollContainerAtBoundary(themeGrid, direction)) {
      return;
    }

    const content = themeGrid.closest(".settings-content");
    if (!content) {
      return;
    }

    event.preventDefault();
    if (typeof content.scrollBy === "function") {
      content.scrollBy({
        top: deltaY,
        behavior: "auto"
      });
      return;
    }

    content.scrollTop += deltaY;
  },

  async handleClickEvent(event) {
    const target = event?.target?.closest?.(
      ".settings-nav-item, .settings-content-focusable, .settings-dialog-option, [data-text-dialog-role='field']"
    );
    if (!target || !this.container?.contains?.(target)) {
      return;
    }

    event?.preventDefault?.();
    if (target.classList.contains("settings-nav-item")) {
      const navIndex = Number(target.dataset.navIndex);
      if (Number.isFinite(navIndex)) {
        this.navIndex = clamp(navIndex, 0, Math.max(0, this.visibleSections.length - 1));
      }
      this.focusZone = "nav";
      await this.activateNavSelection();
      return;
    }

    this.container
      .querySelectorAll(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusSettingsNode(target);

    if (String(target.dataset.focusKey || "") === "about:supporters") {
      await Router.navigate("supportersContributors");
      return;
    }

    if (this.textDialog) {
      const field = target.closest?.("[data-text-dialog-role='field']");
      if (field) {
        this.focusZone = "dialog";
        this.dialogFocusIndex = 0;
        return;
      }
      const button = target.closest?.(".settings-text-dialog-button[data-dialog-index]");
      if (button) {
        this.focusZone = "dialog";
        this.dialogFocusIndex = clamp(
          Number(button.dataset.dialogIndex || 1),
          1,
          this.getTextDialogMaxFocusIndex()
        );
        await this.activateFocused();
        return;
      }
      return;
    }

    if (target.classList.contains("settings-dialog-option")) {
      const dialogIndex = Number(target.dataset.dialogIndex);
      if (Number.isFinite(dialogIndex)) {
        this.dialogFocusIndex = dialogIndex;
      }
    } else {
      this.focusZone = "content";
      this.contentFocusKey = String(target.dataset.focusKey || this.contentFocusKey || "");
    }

    await this.activateFocused();
  },

  async activateFocused() {
    if (this.textDialog) {
      const current = this.container.querySelector(".focusable.focused");
      const action = current?.dataset?.textDialogAction || "";
      if (action === "save") {
        await this.submitTextDialog();
        await this.render();
        return;
      }
      if (action === "clear") {
        await this.clearTextDialog();
        await this.render();
        return;
      }
      if (action === "cancel") {
        this.closeTextDialog();
        await this.render({ refreshModel: false });
        return;
      }
      this.dialogFocusIndex = 0;
      this.applyFocus();
      return;
    }

    if (this.optionDialog) {
      const option = this.optionDialog.options[this.dialogFocusIndex];
      if (!option) {
        return;
      }
      if (this.optionDialog.multiChoice) {
        const optionId = String(option.id);
        const selectedIds = new Set(this.optionDialog.selectedIds || []);
        if (selectedIds.has(optionId)) {
          selectedIds.delete(optionId);
        } else {
          selectedIds.add(optionId);
        }
        this.optionDialog.selectedIds = selectedIds;
        if (typeof this.optionDialog.onToggle === "function") {
          await this.optionDialog.onToggle(Array.from(selectedIds), option);
        }
        await this.render();
        return;
      }
      if (typeof this.optionDialog.onSelect === "function") {
        await this.optionDialog.onSelect(option);
      }
      this.closeOptionDialog();
      await this.render();
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    if (String(current.dataset.focusKey || "") === "about:supporters") {
      await Router.navigate("supportersContributors");
      return;
    }

    const zone = String(current.dataset.zone || "");

    if (isRootSidebarNode(current)) {
      activateLegacySidebarAction(String(current.dataset.action || ""), "settings");
      if (isSelectedSidebarAction(String(current.dataset.action || ""), "settings")) {
        await this.closeSidebarToNav();
      }
      return;
    }

    if (zone === "nav") {
      await this.activateNavSelection();
      const firstContent = this.container.querySelector(".settings-content-focusable");
      if (firstContent) {
        this.focusZone = "content";
        this.contentFocusKey =
          this.activeSection === "appearance"
            ? this.getAppearanceThemeFocusKey()
            : String(firstContent.dataset.focusKey || "");
        this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
        this.applyFocus();
      }
      return;
    }

    const focusKey = String(current.dataset.focusKey || "");
    const action = this.actionMap.get(focusKey);
    if (!action) {
      return;
    }

    this.contentFocusKey = focusKey;
    this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
    const role = String(current.dataset.role || "");
    const isSectionToggle = role === "section-toggle";
    this.suppressNextContentFocusScroll =
      this.focusZone === "content" && (role === "toggle" || isSectionToggle);
    await action();

    if (Router.getCurrent() === "settings") {
      await this.render({ refreshModel: !isSectionToggle });
      this.focusZone = "content";
      this.applyFocus();
    }
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.textDialog) {
        this.closeTextDialog();
        await this.render({ refreshModel: false });
        return;
      }
      if (this.optionDialog) {
        this.closeOptionDialog();
        await this.render({ refreshModel: false });
        return;
      }
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.openSidebar();
      }
      return;
    }

    const code = Number(event?.keyCode || 0);

    if (this.textDialog) {
      const activeField = document.activeElement?.matches?.("[data-text-dialog-role='field']");
      if ((code === 38 || code === 40) && !(activeField && this.textDialog.multiline)) {
        event?.preventDefault?.();
        const delta = code === 38 ? -1 : 1;
        this.dialogFocusIndex = clamp(
          this.dialogFocusIndex + delta,
          0,
          this.getTextDialogMaxFocusIndex()
        );
        this.applyFocus();
        return;
      }
      if (code === 37 || code === 39) {
        if (!activeField) {
          event?.preventDefault?.();
          this.dialogFocusIndex = clamp(
            this.dialogFocusIndex + (code === 37 ? -1 : 1),
            0,
            this.getTextDialogMaxFocusIndex()
          );
          this.applyFocus();
        }
        return;
      }
      if (code === 13 && activeField) {
        if (this.textDialog.multiline) {
          return;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        await this.submitTextDialog();
        await this.render();
        return;
      }
    }

    if (this.optionDialog) {
      if (code === 38 || code === 40 || code === 37 || code === 39) {
        event?.preventDefault?.();
        const count = this.optionDialog.options.length;
        const cols = Math.max(1, Number(this.optionDialog.optionColumns || 1));
        const index = this.dialogFocusIndex;
        let next = index;
        if (code === 38) {
          next = index - cols;
        } else if (code === 40) {
          next = index + cols;
        } else if (code === 37) {
          if (index % cols > 0) next = index - 1;
        } else if (code === 39) {
          if (index % cols < cols - 1 && index + 1 < count) next = index + 1;
        }
        if (next >= 0 && next < count && next !== index) {
          this.dialogFocusIndex = next;
          this.applyFocus();
        }
        return;
      }
    }

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();

      if (this.focusZone === "sidebar") {
        if (code === 38) {
          this.sidebarFocusIndex = clamp(
            this.sidebarFocusIndex - 1,
            0,
            Math.max(0, getRootSidebarNodes(this.container, this.layoutPrefs).length - 1)
          );
          this.applyFocus();
          return;
        }
        if (code === 40) {
          this.sidebarFocusIndex = clamp(
            this.sidebarFocusIndex + 1,
            0,
            Math.max(0, getRootSidebarNodes(this.container, this.layoutPrefs).length - 1)
          );
          this.applyFocus();
          return;
        }
        if (code === 39) {
          await this.closeSidebarToNav();
          return;
        }
      }

      if (this.focusZone === "nav") {
        if (code === 38) {
          this.moveNavFocus(this.navIndex - 1);
          return;
        }
        if (code === 40) {
          this.moveNavFocus(this.navIndex + 1);
          return;
        }
        if (code === 37) {
          const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
          const selectedSidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
          this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selectedSidebarNode));
          await this.openSidebar();
          return;
        }
        if (code === 39) {
          const firstContent = this.container.querySelector(".settings-content-focusable");
          if (firstContent) {
            this.focusZone = "content";
            this.contentFocusKey = String(firstContent.dataset.focusKey || "");
            this.applyFocus();
          }
          return;
        }
      }

      if (this.focusZone === "content") {
        if (code === 37) {
          const moved = this.moveContent("left");
          if (!moved) {
            this.syncNavFocusToActive();
            this.focusZone = "nav";
            this.applyFocus();
          }
          return;
        }
        if (code === 38) {
          this.moveContent("up");
          return;
        }
        if (code === 40) {
          this.moveContent("down");
          return;
        }
        if (code === 39) {
          this.moveContent("right");
          return;
        }
      }
    }

    if (!isSettingsActivateEvent(event)) {
      return;
    }

    event?.preventDefault?.();
    await this.activateFocused();
  },

  consumeBackRequest() {
    if (this.textDialog) {
      this.closeTextDialog();
      void this.render({ refreshModel: false });
      return true;
    }
    if (this.optionDialog) {
      this.closeOptionDialog();
      void this.render({ refreshModel: false });
      return true;
    }
    if (this.focusZone === "sidebar") {
      Platform.exitApp();
    } else {
      void this.openSidebar();
    }
    return true;
  },

  cleanup() {
    this.persistUiState();
    this.stopTraktPolling?.();
    if (this.container && this.handleWheelBound) {
      this.container.removeEventListener("wheel", this.handleWheelBound);
    }
    if (this.container && this.handleClickBound) {
      this.container.removeEventListener("click", this.handleClickBound);
    }
    const navSlot = this.container?.querySelector?.("[data-settings-nav]");
    if (navSlot && this.handleRailScrollBound) {
      navSlot.removeEventListener("scroll", this.handleRailScrollBound);
    }
    if (navSlot?.settingsScrollAnimationFrame) {
      cancelAnimationFrame(navSlot.settingsScrollAnimationFrame);
      navSlot.settingsScrollAnimationFrame = null;
    }
    this.handleWheelBound = null;
    this.handleClickBound = null;
    this.handleRailScrollBound = null;
    this.railScrollNode = null;
    this.activeSection = null;
    this.focusZone = "nav";
    this.sidebarFocusIndex = 0;
    this.navIndex = -1;
    this.contentFocusKey = null;
    this.appearanceThemeFocusKey = null;
    this.integrationView = "hub";
    this.expandedSections = {};
    this.optionDialog = null;
    this.textDialog = null;
    this.dialogFocusIndex = 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.suppressNextContentFocusScroll = false;
    this.renderedSectionId = null;
    ScreenUtils.hide(this.container);
  }
};
