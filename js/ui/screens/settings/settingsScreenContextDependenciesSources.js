export { Router } from "../../navigation/routerState.js";

export { ScreenUtils } from "../../navigation/screen.js";

export { addonRepository } from "../../../data/repository/addonRepository.js";

export { LocalStore } from "../../../core/storage/localStore.js";

export { SessionStore } from "../../../core/storage/sessionStore.js";

export { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

export { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";

export { accentColorForTheme, ThemeStore } from "../../../data/local/themeStore.js";

export { MemberAccessRepository } from "../../../data/remote/supabase/memberAccessRepository.js";

export { ThemeManager } from "../../theme/themeManager.js";

export { ThemeColors } from "../../theme/themeColors.js";

export { availableThemeIds, resolveThemeName } from "../../theme/themeAccess.js";

export { renderMemberBrandWordmark } from "../../components/memberBrandWordmark.js";

export { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

export {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_MAX,
  SUBTITLE_VERTICAL_OFFSET_MIN,
  normalizeSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";

export {
  SUBTITLE_TEXT_OPACITY_MAX,
  SUBTITLE_TEXT_OPACITY_MIN,
  SUBTITLE_TEXT_OPACITY_STEP,
  normalizeSubtitleTextOpacity
} from "../../../core/player/subtitleTextOpacity.js";

export { TorrentSettingsStore } from "../../../data/local/torrentSettingsStore.js";

export { WebOsAudioCompatibilityStore } from "../../../data/local/webOsAudioCompatibilityStore.js";

export { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

export { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";
export { DevicePerformancePreferences } from "../../../data/local/devicePerformancePreferences.js";

export { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";

export { AnimeSkipSettingsStore } from "../../../data/local/animeSkipSettingsStore.js";

export {
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

export { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";

export { DebridApi } from "../../../data/remote/api/debridApi.js";

export { DEBRID_AUTH_METHODS, DebridProviders } from "../../../core/debrid/debridProviders.js";

export { DEBRID_DEVICE_AUTH_STATUS, DebridDeviceAuthService } from "../../../core/debrid/debridDeviceAuthService.js";

export { ProfileManager } from "../../../core/profile/profileManager.js";

export { AuthManager } from "../../../core/auth/authManager.js";

export { SupabaseApi } from "../../../data/remote/supabase/supabaseApi.js";

export { Platform } from "../../../platform/index.js";

export { TizenCapabilities } from "../../../platform/tizen/tizenCapabilities.js";

export { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";

export { CW_DISPLAY_SNAPSHOT_KEY, CW_ENRICHMENT_CACHE_KEY } from "../home/homeConstants.js";

export { I18n } from "../../../i18n/index.js";

export { isContentRtl } from "../../../core/util/contentTextDirection.js";

export { PluginManager } from "../../../core/player/pluginManager.js";

export { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";

export { TraktAuthService } from "../../../data/repository/traktAuthService.js";

export { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

export {
  getStreamBadgePreviewSections,
  normalizeStreamBadgeChipColor,
  STREAM_BADGE_IMPORT_LIMIT
} from "../../../core/streams/streamBadgeRules.js";

export {
  TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL,
  TraktLibrarySourceMode,
  TraktSettingsStore,
  WatchProgressSource
} from "../../../data/local/traktSettingsStore.js";

export {
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

export { renderLoadingIndicator } from "../../components/loadingIndicator.js";

export { getLatestAppUpdate } from "../../../core/update/appUpdateService.js";

export { showAppUpdatePrompt } from "../../components/appUpdatePrompt.js";

export {
  SETTINGS_UI_STATE_KEY,
  SETTINGS_RAIL_SCROLL_TARGET_RATIO,
  SETTINGS_RAIL_SCROLL_STIFFNESS,
  SETTINGS_RAIL_SCROLL_DAMPING_RATIO,
  SETTINGS_MARQUEE_VELOCITY_PX_PER_SECOND,
  CURRENT_APP_VERSION,
  SETTINGS_VERSION_LABEL,
  PRIVACY_URL,
  formatHalfStepSettingValue,
  NEXT_EPISODE_THRESHOLD_MODE_OPTIONS,
  NEXT_EPISODE_THRESHOLD_PERCENT_OPTIONS,
  NEXT_EPISODE_THRESHOLD_MINUTE_OPTIONS,
  STILL_WATCHING_THRESHOLD_OPTIONS,
  THEME_OPTIONS,
  FONT_OPTIONS,
  APP_LANGUAGE_NATIVE_LABELS,
  appLanguageOptionLabel,
  LANGUAGE_OPTIONS
} from "./settingsScreenHelpers-01-settings-ui-state-key.js";

export {
  AVAILABLE_LANGUAGES,
  PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
  PREFERRED_PLAYBACK_LANGUAGE_OPTIONS,
  SECONDARY_PLAYBACK_LANGUAGE_OPTIONS,
  STREAM_AUTOPLAY_MODE_OPTIONS,
  STREAM_AUTOPLAY_SOURCE_OPTIONS,
  STREAM_AUTOPLAY_TIMEOUT_OPTIONS,
  STREAM_REUSE_CACHE_HOURS_OPTIONS,
  labelForOptionId,
  formatReuseCacheDuration,
  SUBTITLE_SIZE_OPTIONS,
  SUBTITLE_OFFSET_OPTIONS,
  SUBTITLE_TEXT_COLOR_OPTIONS,
  SUBTITLE_TEXT_OPACITY_OPTIONS,
  SUBTITLE_OUTLINE_COLOR_OPTIONS,
  normalizeSubtitleStyleHex,
  clampSubtitleSize
} from "./settingsScreenHelpers-02-available-languages.js";

export {
  clampSubtitleTextOpacity,
  clampSubtitleOffset,
  TMDB_LANGUAGE_OPTIONS,
  DEBRID_PREPARE_LIMIT_OPTIONS,
  DEBRID_PREPARE_COUNT_OPTIONS,
  DEBRID_MAX_RESULTS_OPTIONS,
  DEBRID_SORT_PROFILE_OPTIONS,
  DEBRID_SIZE_RANGE_OPTIONS,
  DEBRID_MIN_QUALITY_OPTIONS,
  DEBRID_FEATURE_FILTER_OPTIONS,
  DEBRID_CODEC_OPTIONS,
  HOME_LAYOUT_OPTIONS,
  TRAKT_CONTINUE_WATCHING_DAY_OPTIONS,
  TRAKT_WATCH_PROGRESS_OPTIONS,
  TRAKT_LIBRARY_SOURCE_OPTIONS,
  TRAKT_COMMENTS_OPTIONS,
  SECTION_META,
  SECTION_ICONS
} from "./settingsScreenHelpers-03-clamp-subtitle-text-opacity.js";

export {
  ROW_ICONS,
  clamp,
  formatSettingsVersionLabel,
  t,
  arePluginsSupported,
  escapeHtml,
  escapeAttribute,
  renderLayoutPreviewMarkup,
  renderLayoutPreviewPlaceholderMarkup,
  setLayoutPreviewMetric,
  syncLayoutPreviewMetrics,
  syncLayoutPreviewMetricsSoon,
  iconSvg,
  translateOptionLabel,
  translateOptionCaption,
  translateSectionCopy,
  renderSectionNavIcon
} from "./settingsScreenHelpers-04-row-icons.js";

export {
  maskValue,
  labelForFont,
  labelForLanguage,
  labelForTraktContinueWatchingDays,
  labelForTraktWatchProgressSource,
  labelForTraktLibrarySource,
  labelForTraktComments,
  formatTraktDuration,
  renderTraktCountdownText,
  createTraktQrDataUrl,
  labelForTmdbLanguage,
  labelForPlaybackLanguage,
  labelForDebridProvider,
  labelForOption,
  sameDebridSortCriteria,
  debridSortProfileFor,
  debridSortProfileLabel,
  debridSelectionCountLabel,
  debridSizeRangeId,
  debridSizeRangeLabel,
  debridOptionList
} from "./settingsScreenHelpers-05-mask-value.js";

export {
  debridRuleRows,
  validateDebridApiKey,
  normalizeSelectableSubtitleLanguageCode
} from "./settingsScreenHelpers-06-debrid-rule-rows.js";

export {
  normalizeTmdbLanguageCode,
  labelForSubtitlePlaybackLanguage,
  subtitleLanguageOptionCode,
  renderModeLabel,
  escapeSelector,
  plannedSubtitle,
  focusKeySelector,
  isSettingsActivateEvent,
  scrollIntoNearestView,
  getScrollMax,
  getScrollPosition,
  setScrollPosition,
  animateSettingsScroll,
  scrollSettingsNodeIntoContainer,
  scrollSettingsContentItem
} from "./settingsScreenHelpers-07-normalize-tmdb-language-code.js";

export {
  updateSettingsScrollIndicators,
  updateSettingsScrollIndicatorsSoon,
  bindSettingsScrollIndicators,
  settingsScrollIndicatorMarkup,
  decodeJwtPayload,
  getSessionEmail,
  fetchAccountSyncOverview,
  getVisibleSections,
  getSettingsSectionById
} from "./settingsScreenHelpers-08-update-settings-scroll-indicators.js";

export {
  updateSettingsMarqueeTargets,
  scrollSettingsRailItem,
  animateSettingsRailScroll,
  updateSettingsRailIndicators,
  updateSettingsRailIndicatorsSoon,
  focusSettingsNode,
  isScrollContainerAtBoundary,
  captureSettingsScrollState,
  restoreSettingsScrollState,
  addonKindsLabel
} from "./settingsScreenHelpers-09-update-settings-marquee-targets.js";

export {
  createDefaultExpandedState,
  normalizeExpandedState,
  normalizeExpandedSections,
  readSettingsUiState,
  isAppearanceThemeFocusKey
} from "./settingsScreenHelpers-10-create-default-expanded-state.js";
