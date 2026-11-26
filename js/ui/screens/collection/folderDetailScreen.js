import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { Environment } from "../../../platform/environment.js";
import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";
import { CollectionsStore } from "../../../data/local/collectionsStore.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { catalogSkipStep, catalogSupportsExtra } from "../../../core/addons/homeCatalogs.js";
import { toTraktImageUrl } from "../../../core/trakt/traktImageUrl.js";
import { TMDB_API_KEY, TRAKT_API_URL, TRAKT_CLIENT_ID } from "../../../config.js";
import {
  HomeScreen,
  buildModernHomeSizingStyle,
  buildModernHeroPresentation,
  createPosterCardMarkup,
  createSeeAllCardMarkup,
  escapeAttribute,
  escapeHtml,
  formatCatalogRowTitle,
  normalizeCollectionFolderItem,
  renderContinueWatchingSection
} from "../home/homeScreen.js";
import { renderModernHomeLayout } from "../home/modernHomeLayout.js";
import {
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge
} from "../../components/watchedTitleBadge.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { createFolderDetailScreenMethods01 } from "./folderDetailScreenMethods-01-get-route-state-key.js";
import { createFolderDetailScreenMethods02 } from "./folderDetailScreenMethods-02-load-tab.js";
import { createFolderDetailScreenMethods03 } from "./folderDetailScreenMethods-03-render.js";
import { createFolderDetailScreenMethods04 } from "./folderDetailScreenMethods-04-load-more-follow-layout-row.js";
import { createFolderDetailScreenMethods05 } from "./folderDetailScreenMethods-05-on-key-down.js";

export {
  Router,
  ScreenUtils,
  Environment,
  getTvRuntimePerformanceProfile,
  addonRepository,
  catalogRepository,
  watchedItemsRepository,
  watchedTitleStateRepository,
  CollectionsStore,
  LayoutPreferences,
  TmdbService,
  TmdbSettingsStore,
  TmdbMetadataService,
  catalogSkipStep,
  catalogSupportsExtra,
  toTraktImageUrl,
  TMDB_API_KEY,
  TRAKT_API_URL,
  TRAKT_CLIENT_ID,
  HomeScreen,
  buildModernHomeSizingStyle,
  buildModernHeroPresentation,
  createPosterCardMarkup,
  createSeeAllCardMarkup,
  escapeAttribute,
  escapeHtml,
  formatCatalogRowTitle,
  normalizeCollectionFolderItem,
  renderContinueWatchingSection,
  renderModernHomeLayout,
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge,
  renderLoadingIndicator
};
export * from "./folderDetailScreenHelpers-01-tmdb-api-url.js";
export * from "./folderDetailScreenHelpers-02-build-fallback-streaming-sources.js";
export * from "./folderDetailScreenHelpers-03-set-tmdb-discover-param.js";
export * from "./folderDetailScreenHelpers-04-map-trakt-entity.js";

export const FolderDetailScreen = {
  mountedHomeTrailerLayers: new Set(),
  homeTrailerLayerCleanupTimers: new WeakMap(),
  homeTrailerLayerHideTimers: new WeakMap(),
  homeTrailerFrameCleanup: new WeakMap(),
  _trackScrollHandlers: new Map(),
  activeScrollAnimationContainers: new Set(),
  boundHomeFocusInHandler: null,
  boundHomeClickHandler: null,
  boundHomeMouseDownHandler: null,
  boundHomeMouseOverHandler: null,
  boundHomeWheelHandler: null,
  boundHomeEventContainer: null,
  boundHomeViewportScrollHandler: null,
  boundHomeViewport: null,
  homeRowWindow: null,
  homeRowWindowRoot: null,
  _homeHoldDialog: null,
  continueWatchingMenu: null,
  posterHoldMenu: null,
  posterListPicker: null,
  pendingContinueWatchingHoldTimer: null,
  pendingContinueWatchingHoldTarget: null,
  pendingContinueWatchingEnterTimer: null,
  pendingContinueWatchingEnterTarget: null,
  suppressHoldMenuEnterUntilKeyUp: false,
  sidebarExpanded: false,
  ...createFolderDetailScreenMethods01(),
  ...createFolderDetailScreenMethods02(),
  ...createFolderDetailScreenMethods03(),
  ...createFolderDetailScreenMethods04(),
  ...createFolderDetailScreenMethods05()
};

Object.setPrototypeOf(FolderDetailScreen, HomeScreen);
