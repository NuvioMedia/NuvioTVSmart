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

import { preloadHeroBackdrop, prepareHeroImageEnter } from "./homeScreenHelpers-02-extract-release-date-text.js";

export function animateHeroBackdropSwap(
  backdrop,
  nextSrc,
  nextAlt = "",
  durationMs = HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS,
  options = {}
) {
  if (!(backdrop instanceof HTMLImageElement)) {
    return;
  }

  const normalizedSrc = String(nextSrc || "").trim();
  // Decorative: the logo/brand carries the title, and a pending backdrop would
  // otherwise paint it as alt text over the hero.
  const normalizedAlt = "";
  const currentSrc = String(backdrop.heroBackdropCanvasSrc || backdrop.getAttribute("src") || "").trim();
  const transitionMode = options?.transitionMode || "crossfade";
  const token = Number(backdrop.heroBackdropTransitionToken || 0) + 1;
  backdrop.heroBackdropTransitionToken = token;

  const parent = backdrop.parentElement;
  // The visible bitmap layer on Tizen; the <img> stays the hero's anchor element.
  const getCanvas = () => parent?.querySelector?.(".home-hero-backdrop-canvas:not(.home-hero-backdrop-transition-ghost)") || null;

  const releaseCanvasLayer = (node) => {
    if (!node) {
      return;
    }
    if (String(node.tagName || "").toUpperCase() === "CANVAS") {
      node.width = 0;
      node.height = 0;
    }
    node.remove?.();
  };

  const clearGhosts = () => {
    parent?.querySelectorAll?.(".home-hero-backdrop-transition-ghost")?.forEach(releaseCanvasLayer);
  };

  const finalize = () => {
    if (Number(backdrop.heroBackdropTransitionToken || 0) !== token) {
      return;
    }
    backdrop.classList.remove("home-hero-backdrop-transition-enter", "is-visible");
    getCanvas()?.classList?.remove("home-hero-backdrop-transition-enter", "is-visible");
    clearGhosts();
  };

  // Turns the layer showing the current artwork into the fading-out ghost.
  const createGhost = () => {
    const canvas = getCanvas();
    if (canvas) {
      canvas.classList.remove("home-hero-backdrop-transition-enter", "is-visible");
      canvas.classList.add("home-hero-backdrop-transition-ghost");
      return canvas;
    }
    if (!parent || !currentSrc) {
      return null;
    }
    const ghost = backdrop.cloneNode(false);
    ghost.classList.remove("home-hero-backdrop-transition-enter", "is-visible");
    ghost.classList.add("home-hero-backdrop-transition-ghost");
    parent.insertBefore(ghost, backdrop);
    return ghost;
  };

  const showImageLayer = () => {
    releaseCanvasLayer(getCanvas());
    backdrop.heroBackdropCanvasSrc = "";
    backdrop.style.removeProperty("visibility");
  };

  if (!normalizedSrc) {
    finalize();
    showImageLayer();
    backdrop.removeAttribute("src");
    backdrop.setAttribute("alt", normalizedAlt);
    backdrop.classList.add("placeholder");
    return;
  }

  if (currentSrc === normalizedSrc) {
    finalize();
    backdrop.setAttribute("alt", normalizedAlt);
    backdrop.classList.remove("placeholder");
    return;
  }

  preloadHeroBackdrop(normalizedSrc).then((result) => {
    if (Number(backdrop.heroBackdropTransitionToken || 0) !== token || backdrop.isConnected === false) {
      return;
    }
    const bitmap = result.bitmap;
    const singleLayer = transitionMode === "single-layer";

    if (!bitmap && !result.loaded) {
      finalize();
      showImageLayer();
      backdrop.setAttribute("src", normalizedSrc);
      backdrop.setAttribute("alt", normalizedAlt);
      backdrop.classList.remove("placeholder");
      return;
    }

    clearGhosts();
    let ghost = null;
    if (!singleLayer) {
      ghost = createGhost();
    }

    let layer = backdrop;
    if (bitmap && parent) {
      const previousCanvas = getCanvas();
      layer = document.createElement("canvas");
      layer.className = "home-hero-backdrop home-hero-backdrop-canvas";
      layer.width = bitmap.width;
      layer.height = bitmap.height;
      layer.getContext("2d")?.drawImage(bitmap, 0, 0);
      // Last in the wrap, so it paints above the fading ghost.
      parent.appendChild(layer);
      releaseCanvasLayer(previousCanvas);
      backdrop.heroBackdropCanvasSrc = normalizedSrc;
      // Dropping src releases the full-size decode; the canvas carries the artwork.
      backdrop.removeAttribute("src");
      backdrop.style.setProperty("visibility", "hidden");
    } else {
      showImageLayer();
      backdrop.setAttribute("src", normalizedSrc);
    }
    prepareHeroImageEnter(layer, "home-hero-backdrop-transition-enter");
    backdrop.classList.remove("placeholder");
    backdrop.setAttribute("alt", normalizedAlt);

    const reveal = () => {
      if (Number(backdrop.heroBackdropTransitionToken || 0) !== token || backdrop.isConnected === false) {
        return;
      }
      layer.classList.add("is-visible");
      ghost?.classList?.add("is-fading-out");
      setTimeout(() => {
        finalize();
      }, durationMs);
    };
    requestAnimationFrame(() => {
      if (Number(backdrop.heroBackdropTransitionToken || 0) !== token || backdrop.isConnected === false) {
        return;
      }
      if (singleLayer) {
        reveal();
        return;
      }
      requestAnimationFrame(reveal);
    });
  });
}
