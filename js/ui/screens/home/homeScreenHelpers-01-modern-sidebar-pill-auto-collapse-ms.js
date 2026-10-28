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

export const MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS = 4000;

export const CW_RELEASE_ALERT_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export function isDirectionalKeyCode(code) {
  return code >= 37 && code <= 40;
}

// Matches home artwork in every state, loaded or still waiting. The index
// built from this drives hydration and eviction alike, and eviction needs the
// images that already hold a decoded bitmap, so narrowing it to [data-src]
// would hide every poster the moment it painted.
export const HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR =
  ".home-main .content-poster, .home-main .home-poster-landscape-logo, .home-main .home-continue-bg";

export const HOME_LAZY_IMAGE_ROW_SELECTOR = ".home-row, .home-modern-row, .home-grid-section, .home-row-continue";

export function homePerfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function logHomePerf(stage, data = {}) {
  if (!HOME_PERF_DEBUG) {
    return;
  }
  try {
    console.info(`[home-perf] ${stage}`, data);
  } catch (_) {}
}

export function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function getDirectionFromKeyCode(keyCode) {
  switch (Number(keyCode || 0)) {
    case 37:
      return "left";
    case 38:
      return "up";
    case 39:
      return "right";
    case 40:
      return "down";
    default:
      return null;
  }
}

export function renderHeroBackdropImage(display) {
  if (!display?.backdrop) {
    return '<div class="home-hero-backdrop placeholder"></div>';
  }
  const fallbackQueue = encodeHeroBackdropFallbacks(display.backdropFallbacks || []);
  const fallbackAttribute = fallbackQueue ? ` data-fallback-srcs="${escapeAttribute(fallbackQueue)}"` : "";
  return `<img class="home-hero-backdrop" src="${escapeAttribute(display.backdrop)}"${fallbackAttribute} alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" onerror="${buildImageFallbackErrorHandler()}" />`;
}

export function buildModernHomeSizingStyle(layoutPrefs = {}) {
  const baseWidthDp = Math.max(72, Number(layoutPrefs?.posterCardWidthDp ?? 126) || 126);
  const radiusDp = Math.max(0, Number(layoutPrefs?.posterCardCornerRadiusDp ?? 12));
  const dpToPx = 2;
  const portraitWidth = Math.round(baseWidthDp * 0.84 * 1.08 * dpToPx);
  const portraitHeight = Math.round(baseWidthDp * 1.5 * 0.84 * 1.08 * dpToPx);
  const portraitExpandedWidth = Math.round(portraitHeight * (16 / 9));
  const landscapeWidth = Math.round(baseWidthDp * 1.24 * 1.34 * dpToPx);
  const landscapeHeight = Math.round(landscapeWidth / 1.77);
  const radius = Math.round(radiusDp * dpToPx);
  return [
    `--home-poster-width:${portraitWidth}px`,
    `--home-poster-height:${portraitHeight}px`,
    `--home-modern-portrait-poster-width:${portraitWidth}px`,
    `--home-modern-portrait-poster-height:${portraitHeight}px`,
    `--home-modern-portrait-expanded-width:${portraitExpandedWidth}px`,
    `--home-landscape-poster-width:${landscapeWidth}px`,
    `--home-landscape-poster-height:${landscapeHeight}px`,
    `--home-poster-expanded-width:${portraitExpandedWidth}px`,
    `--home-poster-radius:${radius}px`
  ].join(";");
}

export function createCubicBezierEasing(x1, y1, x2, y2) {
  const newtonIterations = 4;
  const newtonMinSlope = 0.001;
  const subdivisionPrecision = 0.0000001;
  const subdivisionMaxIterations = 10;
  const splineTableSize = 11;
  const sampleStepSize = 1 / (splineTableSize - 1);

  const calcBezier = (t, a1, a2) => (((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t + 3 * a1) * t;
  const getSlope = (t, a1, a2) => 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
  const sampleValues = new Float32Array(splineTableSize);

  for (let index = 0; index < splineTableSize; index += 1) {
    sampleValues[index] = calcBezier(index * sampleStepSize, x1, x2);
  }

  const binarySubdivide = (x, lower, upper) => {
    let current = 0;
    let currentX = 0;
    let iteration = 0;
    do {
      current = lower + (upper - lower) / 2;
      currentX = calcBezier(current, x1, x2) - x;
      if (currentX > 0) {
        upper = current;
      } else {
        lower = current;
      }
      iteration += 1;
    } while (Math.abs(currentX) > subdivisionPrecision && iteration < subdivisionMaxIterations);
    return current;
  };

  const newtonRaphsonIterate = (x, guess) => {
    let currentGuess = guess;
    for (let index = 0; index < newtonIterations; index += 1) {
      const currentSlope = getSlope(currentGuess, x1, x2);
      if (currentSlope === 0) {
        return currentGuess;
      }
      const currentX = calcBezier(currentGuess, x1, x2) - x;
      currentGuess -= currentX / currentSlope;
    }
    return currentGuess;
  };

  const getTForX = (x) => {
    let intervalStart = 0;
    let currentSample = 1;
    const lastSample = splineTableSize - 1;

    while (currentSample !== lastSample && sampleValues[currentSample] <= x) {
      intervalStart += sampleStepSize;
      currentSample += 1;
    }
    currentSample -= 1;

    const denominator = sampleValues[currentSample + 1] - sampleValues[currentSample];
    const dist = denominator === 0 ? 0 : (x - sampleValues[currentSample]) / denominator;
    const guess = intervalStart + dist * sampleStepSize;
    const initialSlope = getSlope(guess, x1, x2);

    if (initialSlope >= newtonMinSlope) {
      return newtonRaphsonIterate(x, guess);
    }
    if (initialSlope === 0) {
      return guess;
    }
    return binarySubdivide(x, intervalStart, intervalStart + sampleStepSize);
  };

  return (x) => {
    if (x <= 0) {
      return 0;
    }
    if (x >= 1) {
      return 1;
    }
    return calcBezier(getTForX(x), y1, y2);
  };
}

export const MODERN_CAMERA_PAN_EASING = createCubicBezierEasing(0.43, 0.7, 0.45, 1.0);

export function homeCatalogRowKey(row = {}) {
  return String(row?.homeCatalogKey || buildModernRowKey(row) || "").trim();
}

export function hasHomeCatalogRowContent(row = {}) {
  const items = row?.result?.data?.items;
  const loadingItems = row?.loadingItems;
  return Boolean((Array.isArray(items) && items.length) || (Array.isArray(loadingItems) && loadingItems.length));
}

export function getHomeCatalogRowKeys(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(hasHomeCatalogRowContent).map(homeCatalogRowKey).filter(Boolean);
}

export function getRenderedHomeCatalogRowKeys(container) {
  const nodes = container?.querySelectorAll?.(".home-modern-catalogs [data-row-key], #homeCatalogRows [data-row-key]");
  return Array.from(nodes || [])
    .map((node) => String(node?.dataset?.rowKey || "").trim())
    .filter(Boolean);
}

export function sameStringArray(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id || item?.contentId || "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

export function renderHomeLoadingState() {
  return `
    <div class="home-loading-state" aria-label="Loading">
      ${renderLoadingIndicator({ className: "home-loading-spinner" })}
    </div>
  `;
}

export function resolveImdbRating(item) {
  const direct = item?.imdbRating ?? item?.episodeImdbRating ?? item?.imdb_rating ?? item?.rating ?? null;
  if (direct == null || direct === "") {
    return null;
  }
  const value = Number(direct);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value.toFixed(1);
}

export function extractYear(item) {
  const candidates = [item?.releaseInfo, item?.released, item?.releaseDate, item?.release_date, item?.year];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }
  return "";
}
