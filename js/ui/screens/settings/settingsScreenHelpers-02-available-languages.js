import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { LocalStore } from "../../../core/storage/localStore.js";

import { SessionStore } from "../../../core/storage/sessionStore.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";

import { accentColorForTheme, ThemeStore } from "../../../data/local/themeStore.js";

import { MemberAccessRepository } from "../../../data/remote/supabase/memberAccessRepository.js";

import { ThemeManager } from "../../theme/themeManager.js";

import { ThemeColors } from "../../theme/themeColors.js";

import { availableThemeIds, resolveThemeName } from "../../theme/themeAccess.js";

import { renderMemberBrandWordmark } from "../../components/memberBrandWordmark.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_MAX,
  SUBTITLE_VERTICAL_OFFSET_MIN,
  normalizeSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";

import {
  SUBTITLE_TEXT_OPACITY_MAX,
  SUBTITLE_TEXT_OPACITY_MIN,
  SUBTITLE_TEXT_OPACITY_STEP,
  normalizeSubtitleTextOpacity
} from "../../../core/player/subtitleTextOpacity.js";

import { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";

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

import { DEBRID_AUTH_METHODS, DebridProviders } from "../../../core/debrid/debridProviders.js";

import { DEBRID_DEVICE_AUTH_STATUS, DebridDeviceAuthService } from "../../../core/debrid/debridDeviceAuthService.js";

import { ProfileManager } from "../../../core/profile/profileManager.js";

import { AuthManager } from "../../../core/auth/authManager.js";

import { SupabaseApi } from "../../../data/remote/supabase/supabaseApi.js";

import { Platform } from "../../../platform/index.js";

import { TizenCapabilities } from "../../../platform/tizen/tizenCapabilities.js";

import { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";

import { CW_DISPLAY_SNAPSHOT_KEY, CW_ENRICHMENT_CACHE_KEY } from "../home/homeConstants.js";

import { I18n } from "../../../i18n/index.js";

import { isContentRtl } from "../../../core/util/contentTextDirection.js";

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

import { getLatestAppUpdate } from "../../../core/update/appUpdateService.js";

import { showAppUpdatePrompt } from "../../components/appUpdatePrompt.js";

import { translateOptionLabel } from "./settingsScreenHelpers-04-row-icons.js";

export const AVAILABLE_LANGUAGES = [
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

export const PREFERRED_SUBTITLE_LANGUAGE_OPTIONS = [{ id: "off", labelKey: "common.none", label: "None" }, ...AVAILABLE_LANGUAGES];

export const PREFERRED_PLAYBACK_LANGUAGE_OPTIONS = [
  { id: "system", labelKey: "common.system" },
  { id: "original", labelKey: "audio_lang_original", label: "Original language" },
  // "None" never auto-selects an audio track, leaving the stream's own
  // default playing (the player already treats "none" as no preference).
  { id: "none", labelKey: "common.none" },
  ...AVAILABLE_LANGUAGES
];

export const SECONDARY_PLAYBACK_LANGUAGE_OPTIONS = [
  { id: "none", labelKey: "common.none" },
  { id: "original", labelKey: "audio_lang_original", label: "Original language" },
  ...AVAILABLE_LANGUAGES
];

export const STREAM_AUTOPLAY_MODE_OPTIONS = [
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

export const STREAM_AUTOPLAY_SOURCE_OPTIONS = [
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

export const STREAM_AUTOPLAY_TIMEOUT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30]
  .map((seconds) => ({
    id: seconds,
    labelKey: seconds === 0 ? "autoplay_timeout_instant" : null,
    label: seconds === 0 ? "Instant" : `${seconds}s`
  }))
  .concat([{ id: 2147483647, labelKey: "autoplay_timeout_unlimited", label: "Unlimited" }]);

export const STREAM_REUSE_CACHE_HOURS_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72, 168].map((hours) => ({
  id: hours,
  label: ""
}));

export function labelForOptionId(options, id, fallback) {
  const match = options.find((option) => String(option.id) === String(id));
  return match ? translateOptionLabel(match, fallback) : fallback;
}

export function formatReuseCacheDuration(hoursValue) {
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

export const SUBTITLE_SIZE_OPTIONS = [
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

export const SUBTITLE_OFFSET_OPTIONS = Array.from(
  { length: SUBTITLE_VERTICAL_OFFSET_MAX - SUBTITLE_VERTICAL_OFFSET_MIN + 1 },
  (_, index) => {
    const value = SUBTITLE_VERTICAL_OFFSET_MIN + index;
    return {
      id: value,
      label: value === SUBTITLE_VERTICAL_OFFSET_DEFAULT ? `Default (${value}%)` : `${value}%`
    };
  }
);

export const SUBTITLE_TEXT_COLOR_OPTIONS = [
  { id: "#FFFFFF", label: "White" },
  { id: "#D9D9D9", label: "Silver" },
  { id: "#FFD700", label: "Gold" },
  { id: "#00E5FF", label: "Cyan" },
  { id: "#FF5C5C", label: "Red" },
  { id: "#00FF88", label: "Green" }
];

export const SUBTITLE_TEXT_OPACITY_OPTIONS = Array.from(
  {
    length: (SUBTITLE_TEXT_OPACITY_MAX - SUBTITLE_TEXT_OPACITY_MIN) / SUBTITLE_TEXT_OPACITY_STEP + 1
  },
  (_, index) => {
    const value = SUBTITLE_TEXT_OPACITY_MIN + index * SUBTITLE_TEXT_OPACITY_STEP;
    return { id: value, label: `${value}%` };
  }
);

export const SUBTITLE_HDR_BRIGHTNESS_OPTIONS = [
  { id: "DARK", labelKey: "subtitle_style_hdr_preset_dark", label: "Dark Room (~100–120 nits)" },
  { id: "REFERENCE", labelKey: "subtitle_style_hdr_preset_reference", label: "Reference (~180–200 nits)" },
  { id: "BRIGHT", labelKey: "subtitle_style_hdr_preset_bright", label: "Bright Room (~250–280 nits)" },
  { id: "OFF", labelKey: "subtitle_style_hdr_preset_off", label: "Off (Max Panel)" }
];

export const SUBTITLE_OUTLINE_COLOR_OPTIONS = [
  { id: "#000000", label: "Black" },
  { id: "#FFFFFF", label: "White" },
  { id: "#00E5FF", label: "Cyan" },
  { id: "#FF5C5C", label: "Red" }
];

export function normalizeSubtitleStyleHex(value, fallback) {
  const hex = String(value || "")
    .trim()
    .toUpperCase();
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : fallback;
}

export function clampSubtitleSize(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return 120;
  }
  return Math.min(200, Math.max(50, parsed));
}
