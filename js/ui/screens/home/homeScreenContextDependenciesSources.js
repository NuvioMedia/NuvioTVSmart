export { Router } from "../../navigation/routerState.js";

export { ScreenUtils } from "../../navigation/screen.js";

export { addonRepository } from "../../../data/repository/addonRepository.js";

export { catalogRepository } from "../../../data/repository/catalogRepository.js";

export { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";

export { CloudLibraryPlaybackProgressStore, CloudLibraryPlaybackSessionStore } from "../../../data/local/cloudLibraryPlaybackStore.js";

export { cloudLibraryRepository } from "../../../data/repository/cloudLibraryRepository.js";

export { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

export { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";

export { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

export { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";

export { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";

export { libraryRepository, LibrarySourceMode } from "../../../data/repository/libraryRepository.js";

export { mapWithConcurrency } from "../../../core/network/mapWithConcurrency.js";

export { filterReleasedItems } from "../../../core/util/releaseInfoUtils.js";

export { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

export { showHomeRatings } from "../../../core/util/imdbRatingVisibility.js";

export { continueWatchingUsesEpisodeThumbnails, continueWatchingImageSources } from "../../../core/util/continueWatchingImage.js";

export { ContinueWatchingPreferences } from "../../../data/local/continueWatchingPreferences.js";

export { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";

export { CollectionsStore, buildCollectionHomeKey } from "../../../data/local/collectionsStore.js";

export { TmdbService } from "../../../core/tmdb/tmdbService.js";

export { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

export { supportsMembershipFor } from "../../../core/tracking/trackingLibraryMembership.js";

export { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

export { metaRepository } from "../../../data/repository/metaRepository.js";

export { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

export { ProfileManager } from "../../../core/profile/profileManager.js";

export { StartupSyncService } from "../../../core/profile/startupSyncService.js";

export { ProfileSettingsSyncService } from "../../../core/profile/profileSettingsSyncService.js";

export { Platform } from "../../../platform/index.js";

export { WatchProgressSource } from "../../../data/local/traktSettingsStore.js";

export { watchProgressCompletedThreshold } from "../../../domain/model/watchProgress.js";

export { getTvHeroTransitionMode, getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

export { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";

export { LocalStore } from "../../../core/storage/localStore.js";

export { TMDB_API_KEY, YOUTUBE_PROXY_URL } from "../../../config.js";

export { I18n } from "../../../i18n/index.js";

export { localizedGenreLabel } from "../../../i18n/genreLabels.js";

export { buildWatchedTitleIdSet, isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";

export { buildModernRowKey, MODERN_HOME_CONSTANTS, renderModernHomeLayout } from "./modernHomeLayout.js";

export { formatHomeRuntimeText, shouldPreserveHomeRuntimeText } from "./homeRuntime.js";

export { shouldKeepNextUpForAiringSetting } from "./nextUpAiringVisibility.js";

export {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  catalogShouldShowOnHome,
  catalogSkipStep,
  catalogSupportsExtra
} from "../../../core/addons/homeCatalogs.js";

export {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getLegacySidebarNodes,
  getLegacySidebarSelectedNode,
  getModernSidebarNodes,
  getModernSidebarSelectedNode,
  getSidebarProfileState,
  focusWithoutAutoScroll,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

export { NuvioDialog } from "../../components/nuvioDialog.js";

export { renderLoadingIndicator } from "../../components/loadingIndicator.js";

export {
  CW_DAYS_CAP,
  CW_DISPLAY_SNAPSHOT_KEY,
  CW_DISPLAY_SNAPSHOT_MAX_AGE_MS,
  CW_DISPLAY_SNAPSHOT_MAX_ITEMS,
  CW_DISPLAY_SNAPSHOT_MAX_SCOPES,
  CW_ENRICHMENT_CACHE_KEY,
  CW_ENRICHMENT_CACHE_MAX_AGE_MS,
  CW_ENTER_DELAY_MS,
  CW_HOLD_DELAY_MS,
  CW_MAX_ENRICHMENT_CONCURRENCY,
  CW_MAX_NEXT_UP_CONCURRENCY,
  CW_MAX_NEXT_UP_LOOKUPS,
  CW_MAX_VISIBLE_ITEMS,
  CW_META_TIMEOUT_MS,
  CW_META_TIMEOUT_TV_MS,
  CW_NEXT_UP_META_TIMEOUT_MS,
  CW_NEXT_UP_NEW_SEASON_UNAIRED_WINDOW_DAYS,
  CW_PROGRESS_START_THRESHOLD,
  CW_RENDER_BATCH_ITEMS_CONSTRAINED,
  CW_RENDER_BATCH_ITEMS_DEFAULT,
  CW_RENDER_BATCH_ITEMS_LEGACY_TV,
  CW_RENDER_LOAD_AHEAD_ITEMS,
  HERO_ROTATE_FIRST_DELAY_MS,
  HERO_ROTATE_INTERVAL_MS,
  HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS,
  HOME_BACKGROUND_RENDER_DELAY_MS,
  HOME_LAZY_IMAGE_EVICT_MARGIN_PX,
  HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS,
  HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME,
  HOME_ADDON_MANIFEST_TIMEOUT_MS,
  HOME_CATALOG_REFRESH_TTL_MS,
  HOME_GRID_COMPACT_ROW_COUNT,
  HOME_GRID_DEFAULT_ROW_COUNT,
  HOME_GRID_SAFE_MAX_COLUMNS,
  HOME_INITIAL_CATALOG_LOAD,
  HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS,
  HOME_LAYOUT_SEQUENCE,
  HOME_LOADING_ROW_ITEMS_CONSTRAINED,
  HOME_LOADING_ROW_ITEMS_DEFAULT,
  HOME_LOADING_ROW_ITEMS_LEGACY_TV,
  HOME_MAX_ITEMS_PER_ROW_CONSTRAINED,
  HOME_MAX_ITEMS_PER_ROW_CLASSIC,
  HOME_MAX_ITEMS_PER_ROW_DEFAULT,
  HOME_MAX_ITEMS_PER_ROW_LEGACY_TV,
  HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS,
  HOME_PERF_DEBUG,
  HOME_RETURN_FOCUS_STATE_KEY,
  HOME_ROW_RETRY_TIMEOUT_MS,
  HOME_ROW_TIMEOUT_MS,
  HOME_STABLE_GATE_TIMEOUT_MS
} from "./homeConstants.js";

export { mergeRefreshedHomeRows } from "./homeRowMerge.js";

export { findHomeFocusIdentityMatch, getHomeFocusIdentity, shouldApplyLateContinueWatchingFocus } from "./homeFocusPolicy.js";

export { resolveNextUpCandidates } from "./nextUpCandidateResolver.js";

export { findAbsoluteEpisodeAnchorIndex } from "./nextUpEpisodeAnchor.js";

export { shouldSurfaceNextUpForUntrackedSeries } from "./nextUpWatchingPolicy.js";

export { getContinueWatchingRenderItems, shouldAppendContinueWatchingItems } from "./continueWatchingRenderWindow.js";

export { shouldProtectContinueWatchingDisplay } from "./continueWatchingLoadPolicy.js";

export { buildHeroBackdropSources, buildImageFallbackErrorHandler, encodeHeroBackdropFallbacks } from "./homeImageHelpers.js";

export {
  escapeAttribute,
  escapeHtml,
  firstNonEmpty,
  formatContentTypeLabel,
  formatCatalogRowTitle,
  limitTextToWordCount,
  parseCssPx,
  prettyId,
  uniqueNonEmptyValues
} from "./homeUtils.js";

export {
  MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS,
  CW_RELEASE_ALERT_MAX_AGE_MS,
  isDirectionalKeyCode,
  HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR,
  HOME_LAZY_IMAGE_ROW_SELECTOR,
  homePerfNow,
  logHomePerf,
  t,
  getDirectionFromKeyCode,
  renderHeroBackdropImage,
  buildModernHomeSizingStyle,
  createCubicBezierEasing,
  MODERN_CAMERA_PAN_EASING,
  homeCatalogRowKey,
  hasHomeCatalogRowContent,
  getHomeCatalogRowKeys,
  getRenderedHomeCatalogRowKeys,
  sameStringArray,
  uniqueById,
  renderHomeLoadingState,
  resolveImdbRating,
  extractYear
} from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";

export {
  extractReleaseDateText,
  formatRuntimeText,
  shouldEnrichModernHero,
  HERO_IMAGE_PRELOAD_CACHE_LIMIT,
  HERO_IMAGE_PRELOAD_TIMEOUT_MS,
  heroImagePreloadCache,
  preloadImageSource,
  preloadHeroAssets,
  prepareHeroImageEnter
} from "./homeScreenHelpers-02-extract-release-date-text.js";

export { animateHeroBackdropSwap } from "./homeScreenHelpers-03-animate-hero-backdrop-swap.js";

export {
  animateHeroLogoSwap,
  parseRuntimeMinutes,
  formatDurationMinutes,
  normalizeCollectionPosterShape,
  normalizeAnimatedCollectionAssetUrl,
  isCollectionFolderItem
} from "./homeScreenHelpers-04-animate-hero-logo-swap.js";

export {
  normalizeCollectionFolderItem,
  buildCollectionHomeRow,
  normalizeHomeRowItem,
  formatEpisodeCode,
  resolveYoutubeId,
  buildYoutubeEmbedUrl
} from "./homeScreenHelpers-05-normalize-collection-folder-item.js";

export {
  resolveTrailerSource,
  applyTrailerAudioPreferences,
  withTimeout,
  fetchModernHeroTmdbEnrichment,
  resolveTrailerMetaWithTmdbFallback,
  getContinueWatchingMetaTimeout,
  progressFractionForContinueWatching,
  isSeriesTypeForContinueWatching,
  isPosterWatchedType,
  isCompletedForContinueWatching,
  isInProgressForContinueWatching,
  shouldTreatAsInProgressForContinueWatching,
  episodeKey,
  episodeSortKey,
  normalizeEpisodeEntry,
  normalizeEpisodeEntries,
  mapAbsoluteEpisodeKey
} from "./homeScreenHelpers-06-resolve-trailer-source.js";

export {
  mapAbsoluteWatchedEpisodeKeys,
  mapAbsoluteEpisodeProgress,
  findEpisodeEntry,
  hasEpisodeAiredForContinueWatching,
  parseEpisodeReleaseDateForContinueWatching,
  resolveNextUpReleaseState,
  refreshContinueWatchingReleaseState,
  parseEpisodeReleaseCalendarDateForContinueWatching,
  continueWatchingCalendarDayNumber,
  buildNextUpAirDateStatus,
  continueWatchingSortTimestamp,
  nextUpReleaseTimestamp,
  sortContinueWatchingItemsForDisplay
} from "./homeScreenHelpers-07-map-absolute-watched-episode-keys.js";

export {
  partitionContinueWatchingRows,
  shouldShowNextUpEpisodeForContinueWatching,
  buildProgressStatus,
  continueWatchingDurationMs,
  buildProgressFraction,
  buildCatalogLoadingItems,
  normalizeCatalogItem
} from "./homeScreenHelpers-08-partition-continue-watching-rows.js";

export {
  normalizeContinueWatchingItem,
  isCloudContinueWatchingItem,
  isRawContinueWatchingTitle,
  hasContinueWatchingArtwork,
  isPresentableContinueWatchingItem,
  buildVisibleContinueWatchingItems,
  buildCompleteContinueWatchingDisplay,
  hasContinueWatchingHeroMetadata,
  needsContinueWatchingMetadataRefresh,
  buildNextUpSeedFromWatchedItem,
  getContinueWatchingNextUpSeedOptions,
  continueWatchingEnrichmentCacheKey,
  readContinueWatchingEnrichmentCache
} from "./homeScreenHelpers-09-normalize-continue-watching-item.js";

export {
  getCachedContinueWatchingEnrichment,
  applyCachedContinueWatchingEnrichment,
  saveContinueWatchingEnrichment,
  readContinueWatchingDisplaySnapshot,
  writeContinueWatchingDisplaySnapshot,
  buildContinueWatchingSignature,
  buildSidebarProfileSignature,
  buildHeroIdentity,
  hideHomeHeroRatings
} from "./homeScreenHelpers-10-get-cached-continue-watching-enrichment.js";

export {
  buildHeroDisplayModel,
  buildModernHeroPresentation,
  renderModernHeroMetaGroup,
  renderModernHeroPrimary,
  renderModernHeroSecondary,
  renderMetaTokens
} from "./homeScreenHelpers-11-build-hero-display-model.js";

export {
  buildHeroIndicators,
  renderHeroMarkup,
  buildPosterSubtitle,
  renderRowHeader,
  resolveContinueWatchingBlurNextUp,
  renderContinueWatchingCard,
  renderContinueWatchingLoadingCard,
  renderContinueWatchingSection
} from "./homeScreenHelpers-12-build-hero-indicators.js";

export {
  continueWatchingStreamParams,
  renderLegacyCatalogRowsMarkup,
  createSeeAllCardMarkup,
  groupNodesByOffsetTop,
  getHomeGridRowCount
} from "./homeScreenHelpers-13-continue-watching-stream-params.js";

export {
  getHomeGridColumnCount,
  normalizeHomeGridCatalogSections,
  shouldDeferHomeRowImages,
  buildLazyImageAttributes
} from "./homeScreenHelpers-14-get-home-grid-column-count.js";

export { createPosterCardMarkup } from "./homeScreenHelpers-15-create-poster-card-markup.js";
