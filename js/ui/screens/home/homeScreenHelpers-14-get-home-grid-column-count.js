/* eslint-disable no-unused-vars */
import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { catalogRepository } from "../../../data/repository/catalogRepository.js";

import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";

import { CloudLibraryPlaybackProgressStore, CloudLibraryPlaybackSessionStore } from "../../../data/local/cloudLibraryPlaybackStore.js";

import { cloudLibraryRepository } from "../../../data/repository/cloudLibraryRepository.js";

import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";

import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

import { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";

import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";

import { libraryRepository, LibrarySourceMode } from "../../../data/repository/libraryRepository.js";

import { mapWithConcurrency } from "../../../core/network/mapWithConcurrency.js";

import { filterReleasedItems } from "../../../core/util/releaseInfoUtils.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { showHomeRatings } from "../../../core/util/imdbRatingVisibility.js";

import { continueWatchingUsesEpisodeThumbnails, continueWatchingImageSources } from "../../../core/util/continueWatchingImage.js";

import { ContinueWatchingPreferences } from "../../../data/local/continueWatchingPreferences.js";

import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";

import { CollectionsStore, buildCollectionHomeKey } from "../../../data/local/collectionsStore.js";

import { TmdbService } from "../../../core/tmdb/tmdbService.js";

import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

import { supportsMembershipFor } from "../../../core/tracking/trackingLibraryMembership.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";

import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

import { ProfileManager } from "../../../core/profile/profileManager.js";

import { StartupSyncService } from "../../../core/profile/startupSyncService.js";

import { Platform } from "../../../platform/index.js";

import { WatchProgressSource } from "../../../data/local/traktSettingsStore.js";

import { watchProgressCompletedThreshold } from "../../../domain/model/watchProgress.js";

import { getTvHeroTransitionMode, getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { isFastHorizontalNavigationEnabled } from "../../../platform/sharedKeys.js";

import { LocalStore } from "../../../core/storage/localStore.js";

import { TMDB_API_KEY, YOUTUBE_PROXY_URL } from "../../../config.js";

import { I18n } from "../../../i18n/index.js";

import { localizedGenreLabel } from "../../../i18n/genreLabels.js";

import { buildWatchedTitleIdSet, isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";

import { buildModernRowKey, MODERN_HOME_CONSTANTS, renderModernHomeLayout } from "./modernHomeLayout.js";

import { formatHomeRuntimeText, shouldPreserveHomeRuntimeText } from "./homeRuntime.js";

import { shouldKeepNextUpForAiringSetting } from "./nextUpAiringVisibility.js";

import {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  catalogShouldShowOnHome,
  catalogSkipStep,
  catalogSupportsExtra
} from "../../../core/addons/homeCatalogs.js";

import {
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

import { NuvioDialog } from "../../components/nuvioDialog.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import {
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
  HOME_ADDON_MANIFEST_TIMEOUT_MS,
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

import { mergeRefreshedHomeRows } from "./homeRowMerge.js";

import { findHomeFocusIdentityMatch, getHomeFocusIdentity, shouldApplyLateContinueWatchingFocus } from "./homeFocusPolicy.js";

import { resolveNextUpCandidates } from "./nextUpCandidateResolver.js";

import { findAbsoluteEpisodeAnchorIndex } from "./nextUpEpisodeAnchor.js";

import { shouldSurfaceNextUpForUntrackedSeries } from "./nextUpWatchingPolicy.js";

import { getContinueWatchingRenderItems, shouldAppendContinueWatchingItems } from "./continueWatchingRenderWindow.js";

import { shouldProtectContinueWatchingDisplay } from "./continueWatchingLoadPolicy.js";

import { buildHeroBackdropSources, buildImageFallbackErrorHandler, encodeHeroBackdropFallbacks } from "./homeImageHelpers.js";

import {
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

import { groupNodesByOffsetTop } from "./homeScreenHelpers-13-continue-watching-stream-params.js";

export function getHomeGridColumnCount(track, cards = []) {
  if (!track || !cards.length) {
    return null;
  }
  const styles = typeof getComputedStyle === "function" ? getComputedStyle(track) : null;
  const columnGap = parseCssPx(styles?.columnGap, 12);
  const trackRect = track.getBoundingClientRect?.();
  const trackWidth = Number(track.clientWidth || trackRect?.width || 0);
  const firstCardRect = cards[0]?.getBoundingClientRect?.();
  const cardWidth = Number(cards[0]?.offsetWidth || firstCardRect?.width || 0);
  if (trackWidth > 0 && cardWidth > 0) {
    return Math.max(1, Math.floor((trackWidth + columnGap) / (cardWidth + columnGap) + 0.001));
  }

  // The flex fallback used by older Tizen engines still exposes row offsets
  // after layout. If dimensions are unavailable, only trust it when more than
  // one visual row is observable; a single group could simply be a hidden track.
  const visualRows = groupNodesByOffsetTop(cards);
  return visualRows.length > 1 ? Math.max(1, visualRows[0].length) : null;
}

export function normalizeHomeGridCatalogSections(
  container,
  { maxDisplayItems = HOME_GRID_SAFE_MAX_COLUMNS * HOME_GRID_DEFAULT_ROW_COUNT, rowCount = 3 } = {}
) {
  if (!container || typeof container.querySelectorAll !== "function") {
    return;
  }
  const safeMaxDisplayItems = Math.max(1, Number(maxDisplayItems) || 1);
  const safeRowCount = Math.max(1, Number(rowCount) || 1);
  const sections = Array.from(container.querySelectorAll(".home-grid-section"));
  sections.forEach((section) => {
    const track = section.querySelector?.(".home-grid-track");
    if (!track) {
      return;
    }
    const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
    const contentCards = cards.filter((card) => !card.classList.contains("home-seeall-card"));
    if (!contentCards.length) {
      return;
    }
    const columnCount = getHomeGridColumnCount(track, cards);
    if (!columnCount || columnCount <= 1) {
      return;
    }

    const seeAllCard = cards.find((card) => card.classList.contains("home-seeall-card")) || null;
    const maxDisplaySlots = Math.min(safeMaxDisplayItems, columnCount * safeRowCount);
    const maxContentCards = seeAllCard ? Math.max(0, maxDisplaySlots - 1) : maxDisplaySlots;
    let visibleContentCards = contentCards.slice(0, maxContentCards);

    // Android removes one content card when See All would otherwise be the
    // only item on the last row. This keeps D-pad row geometry identical to
    // GridHomeContent while retaining the full row in the route state.
    if (
      seeAllCard &&
      columnCount > 1 &&
      visibleContentCards.length >= columnCount &&
      (visibleContentCards.length + 1) % columnCount === 1
    ) {
      visibleContentCards = visibleContentCards.slice(0, -1);
    }

    const visibleSet = new Set(visibleContentCards);
    contentCards.forEach((card) => {
      if (!visibleSet.has(card)) {
        card.remove();
      }
    });
  });
}

export function shouldDeferHomeRowImages(rowIndex = 0, rowKey = "", focusedRowKey = "") {
  const safeRowIndex = Math.max(0, Number(rowIndex || 0));
  const focused = String(focusedRowKey || "").trim();
  if (focused && String(rowKey || "") === focused) {
    return false;
  }
  const eagerRows = getTvRuntimePerformanceProfile().isPerformanceConstrained ? 3 : 5;
  return safeRowIndex >= eagerRows;
}

export function buildLazyImageAttributes(src = "", { defer = false, highPriority = false } = {}) {
  const safeSrc = escapeAttribute(src);
  const priority = highPriority ? ' fetchpriority="high"' : "";
  // Tizen fast path: the old branch forced loading="eager" on constrained
  // runtimes, firing a decode storm for every mounted poster mid-transition.
  // Lazy everywhere except explicit hero priority; near-viewport images
  // still resolve immediately via the hydration pass.
  const loadingMode = highPriority ? "eager" : "lazy";
  if (defer) {
    return `data-src="${safeSrc}" loading="${loadingMode}" decoding="async"${priority}`;
  }
  return `src="${safeSrc}" loading="${loadingMode}" decoding="async"${priority}`;
}
