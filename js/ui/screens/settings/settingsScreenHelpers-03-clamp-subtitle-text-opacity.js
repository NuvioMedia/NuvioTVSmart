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

import { AVAILABLE_LANGUAGES } from "./settingsScreenHelpers-02-available-languages.js";

export function clampSubtitleTextOpacity(value) {
  return normalizeSubtitleTextOpacity(value);
}

export function clampSubtitleOffset(value) {
  return normalizeSubtitleVerticalOffset(value);
}

export const TMDB_LANGUAGE_OPTIONS = [
  { id: "en", label: "English" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "en-CA", label: "English (Canada)" },
  { id: "en-GB", label: "English (United Kingdom)" },
  ...AVAILABLE_LANGUAGES.filter((option) => option.id !== "en")
].sort((left, right) => String(left.label || "").localeCompare(String(right.label || "")));

export const DEBRID_PREPARE_LIMIT_OPTIONS = [
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

export const DEBRID_PREPARE_COUNT_OPTIONS = DEBRID_PREPARE_LIMIT_OPTIONS.filter((option) => Number(option.id) > 0);

export const DEBRID_MAX_RESULTS_OPTIONS = [
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

export const DEBRID_SORT_PROFILE_OPTIONS = [
  { id: "ORIGINAL", labelKey: "debrid_stream_sort_original", label: "Original order" },
  { id: "BEST_QUALITY", labelKey: "debrid_stream_sort_best_quality", label: "Best quality first" },
  { id: "LARGEST", labelKey: "debrid_stream_sort_largest", label: "Largest first" },
  { id: "SMALLEST", labelKey: "debrid_stream_sort_smallest", label: "Smallest first" },
  { id: "AUDIO", labelKey: "debrid_stream_sort_best_audio", label: "Best audio first" },
  { id: "LANGUAGE", labelKey: "debrid_stream_sort_language", label: "Language first" }
];

export const DEBRID_SIZE_RANGE_OPTIONS = [
  { id: "0:0", min: 0, max: 0 },
  { id: "0:5", min: 0, max: 5 },
  { id: "0:10", min: 0, max: 10 },
  { id: "5:20", min: 5, max: 20 },
  { id: "10:50", min: 10, max: 50 },
  { id: "20:100", min: 20, max: 100 }
];

export const DEBRID_MIN_QUALITY_OPTIONS = [
  { id: "ANY", labelKey: "settings.integration.debrid.minQuality.any", label: "Any quality" },
  { id: "P720", labelKey: "settings.integration.debrid.minQuality.720", label: "720p and above" },
  {
    id: "P1080",
    labelKey: "settings.integration.debrid.minQuality.1080",
    label: "1080p and above"
  },
  { id: "P2160", labelKey: "settings.integration.debrid.minQuality.2160", label: "4K only" }
];

export const DEBRID_FEATURE_FILTER_OPTIONS = [
  { id: "ANY", labelKey: "settings.integration.debrid.feature.any", label: "Any" },
  { id: "EXCLUDE", labelKey: "settings.integration.debrid.feature.exclude", label: "Hide" },
  { id: "ONLY", labelKey: "settings.integration.debrid.feature.only", label: "Only" }
];

export const DEBRID_CODEC_OPTIONS = [
  { id: "ANY", labelKey: "settings.integration.debrid.codec.any", label: "Any codec" },
  { id: "H264", labelKey: "settings.integration.debrid.codec.h264", label: "H.264 / AVC" },
  { id: "HEVC", labelKey: "settings.integration.debrid.codec.hevc", label: "HEVC / H.265" },
  { id: "AV1", labelKey: "settings.integration.debrid.codec.av1", label: "AV1" }
];

export const HOME_LAYOUT_OPTIONS = [
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

export const TRAKT_CONTINUE_WATCHING_DAY_OPTIONS = [14, 30, 60, 90, 180, 365, TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL];

export const TRAKT_WATCH_PROGRESS_OPTIONS = [
  { id: WatchProgressSource.MDBLIST, label: "MDBList" },
  { id: WatchProgressSource.SIMKL, label: "Simkl" },
  { id: WatchProgressSource.TRAKT, labelKey: "trakt_watch_progress_source_trakt" },
  { id: WatchProgressSource.NUVIO_SYNC, labelKey: "trakt_watch_progress_source_nuvio" }
];

export const TRAKT_LIBRARY_SOURCE_OPTIONS = [
  { id: TraktLibrarySourceMode.TRAKT, labelKey: "trakt_library_source_trakt" },
  { id: TraktLibrarySourceMode.LOCAL, labelKey: "trakt_library_source_nuvio" }
];

export const TRAKT_COMMENTS_OPTIONS = [
  { id: "on", labelKey: "trakt_setting_on" },
  { id: "off", labelKey: "trakt_setting_off" }
];

export const SECTION_META = [
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
  { id: "watchParty", labelKey: "party_title", subtitleKey: "party_settings_description" },
  {
    id: "appearance",
    labelKey: "settings.sections.appearance.label",
    subtitleKey: "settings.sections.appearance.subtitle"
  },
  { id: "ambient", labelKey: "ambient_mode_title", subtitleKey: "ambient_mode_subtitle" },
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
    subtitleKey: "settings_stream_badges_description"
  },
  {
    id: "playback",
    labelKey: "settings.sections.playback.label",
    subtitleKey: "settings.sections.playback.subtitle"
  },
  {
    id: "trakt",
    labelKey: "settings_tracking_title",
    subtitleKey: "settings_tracking_subtitle"
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

export const SECTION_ICONS = {
  account: "person",
  profiles: "people",
  watchParty: "groups",
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
