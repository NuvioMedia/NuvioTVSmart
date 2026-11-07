/* global __NUVIO_APP_VERSION__ */

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

import { formatSettingsVersionLabel } from "./settingsScreenHelpers-04-row-icons.js";

export const SETTINGS_UI_STATE_KEY = "settingsScreenUiState";

export const SETTINGS_RAIL_SCROLL_TARGET_RATIO = 0.42;

export const SETTINGS_RAIL_SCROLL_STIFFNESS = 180;

export const SETTINGS_RAIL_SCROLL_DAMPING_RATIO = 0.95;

export const SETTINGS_MARQUEE_VELOCITY_PX_PER_SECOND = 90;

export const CURRENT_APP_VERSION = typeof __NUVIO_APP_VERSION__ !== "undefined" ? __NUVIO_APP_VERSION__ : "0.0.0";

export const SETTINGS_VERSION_LABEL = formatSettingsVersionLabel(CURRENT_APP_VERSION);

export const PRIVACY_URL = "https://nuvio.tv/privacy-policy";

export function formatHalfStepSettingValue(value, suffix = "") {
  const rounded = Math.round(Number(value || 0) * 2) / 2;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/, "");
  return `${text}${suffix}`;
}

export const NEXT_EPISODE_THRESHOLD_MODE_OPTIONS = [
  { id: "PERCENTAGE", label: "Percentage" },
  { id: "MINUTES_BEFORE_END", label: "Minutes before end" }
];

export const NEXT_EPISODE_THRESHOLD_PERCENT_OPTIONS = [97, 97.5, 98, 98.5, 99, 99.5, 100].map((value) => ({
  id: value,
  label: `${formatHalfStepSettingValue(value, "")}%`
}));

export const NEXT_EPISODE_THRESHOLD_MINUTE_OPTIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((value) => ({
  id: value,
  label: `${formatHalfStepSettingValue(value, "")} min`
}));

export const STILL_WATCHING_THRESHOLD_OPTIONS = [2, 3, 4, 5, 6].map((value) => ({
  id: value,
  label: String(value)
}));

export const THEME_OPTIONS = [
  {
    id: "GOLD",
    labelKey: "settings.appearance.themes.gold",
    color: "#e8a91c",
    onColor: "#111111"
  },
  {
    id: "JADE",
    labelKey: "settings.appearance.themes.jade",
    color: "#22d37c",
    onColor: "#111111"
  },
  {
    id: "ROSE_GOLD",
    labelKey: "settings.appearance.themes.roseGold",
    color: "#ec70a9",
    onColor: "#111111"
  },
  {
    id: "ARCTIC_BLUE",
    labelKey: "settings.appearance.themes.arcticBlue",
    color: "#3185f5",
    onColor: "#ffffff"
  },
  {
    id: "GRAPHITE",
    labelKey: "settings.appearance.themes.graphite",
    color: "#aab2be",
    onColor: "#111111"
  },
  {
    id: "CUSTOM",
    labelKey: "settings.appearance.themes.custom",
    color: "#ec70a9",
    onColor: "#111111"
  },
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

export const FONT_OPTIONS = [
  { id: "INTER", label: "Inter" },
  { id: "DM_SANS", label: "DM Sans" },
  { id: "OPEN_SANS", label: "Open Sans" }
];

export const APP_LANGUAGE_NATIVE_LABELS = {
  ar: "Arabic",
  bg: "Bulgarian",
  bn: "Bangla",
  bs: "Bosnian",
  cs: "Cestina",
  da: "Dansk",
  de: "Deutsch",
  en: "English",
  el: "Greek",
  es: "Espanol",
  "es-419": "Espanol (Latinoamerica)",
  fr: "Francais",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Hrvatski",
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
  "sr-latn": "Srpski (latinica)",
  sv: "Svenska",
  ta: "Tamil",
  tr: "Turkce",
  uk: "Ukrainian",
  vi: "Tieng Viet",
  "zh-cn": "Chinese (Simplified)",
  "zh-tw": "Chinese (Traditional)"
};

export function appLanguageOptionLabel(localeId) {
  const normalized = String(localeId || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "System Default";
  }
  return APP_LANGUAGE_NATIVE_LABELS[normalized] || normalized.toUpperCase();
}

export const LANGUAGE_OPTIONS = [
  { id: null, labelKey: "common.systemDefault" },
  ...I18n.getSupportedLocales()
    .map((localeId) => ({
      id: localeId,
      label: appLanguageOptionLabel(localeId)
    }))
    .sort((left, right) => String(left.label || "").localeCompare(String(right.label || "")))
];
