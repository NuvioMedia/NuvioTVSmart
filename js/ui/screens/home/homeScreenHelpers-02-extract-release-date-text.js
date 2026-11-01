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

import { extractYear } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { buildModernHeroPresentation, buildHeroDisplayModel } from "./homeScreenHelpers-11-build-hero-display-model.js";

export function extractReleaseDateText(item) {
  const type = String(item?.type || item?.apiType || "").toLowerCase();
  if (type === "movie") {
    const candidates = [item?.released, item?.releaseDate, item?.release_date, item?.releaseInfo];
    for (const candidate of candidates) {
      const str = String(candidate || "");
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleDateString(I18n.getLocale(), {
            year: "numeric",
            month: "long",
            day: "numeric"
          });
        }
      }
    }
  }
  return extractYear(item);
}

export function formatRuntimeText(item) {
  return formatHomeRuntimeText(item);
}

export function shouldEnrichModernHero(hero) {
  if (!hero || hero.heroSource === "continueWatching" || hero.heroSource === "collection" || hero.heroMetaEnriched) {
    return false;
  }
  const settings = TmdbSettingsStore.get();
  const tmdbEnabledForCurrentLayout = settings.enabled && settings.modernHomeEnabled;
  const externalMetaEnabled = LayoutPreferences.get()?.preferExternalMetaAddonDetail !== false;
  // Keep the two enrichment sources independent, as in Android's focused
  // pipeline: TMDB is optional, while external addon metadata is enabled by
  // default and supplies the Home hero's runtime/rating fields.
  return Boolean(tmdbEnabledForCurrentLayout || externalMetaEnabled);
}

export const HERO_IMAGE_PRELOAD_CACHE_LIMIT = 32;

export const HERO_IMAGE_PRELOAD_TIMEOUT_MS = 1500;

export const heroImagePreloadCache = new Map();

export function preloadImageSource(src) {
  const normalized = String(src || "").trim();
  if (!normalized || typeof Image === "undefined") {
    return Promise.resolve(false);
  }
  const cached = heroImagePreloadCache.get(normalized);
  if (cached) {
    return cached;
  }
  if (heroImagePreloadCache.size >= HERO_IMAGE_PRELOAD_CACHE_LIMIT) {
    const oldestSource = heroImagePreloadCache.keys().next().value;
    heroImagePreloadCache.delete(oldestSource);
  }
  const preload = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const settleLoadedImage = () => {
      if (Number(image.naturalWidth || 0) <= 0) {
        finish(false);
        return;
      }
      if (typeof image.decode !== "function") {
        finish(true);
        return;
      }
      try {
        const decoded = image.decode();
        if (decoded && typeof decoded.then === "function") {
          decoded.then(() => finish(true)).catch(() => finish(false));
        } else {
          finish(true);
        }
      } catch (_) {
        // Some older WebKit/Chromium builds expose decode but cannot call it.
        finish(true);
      }
    };
    const finish = (loaded) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(Boolean(loaded));
    };
    // Older TV engines can leave image requests pending without load/error.
    const timeoutId = setTimeout(() => finish(false), HERO_IMAGE_PRELOAD_TIMEOUT_MS);
    image.onload = settleLoadedImage;
    image.onerror = () => finish(false);
    image.decoding = "async";
    image.src = normalized;
    if (image.complete) {
      settleLoadedImage();
    }
  });
  heroImagePreloadCache.set(normalized, preload);
  preload.then((loaded) => {
    if (!loaded) {
      // Let the immediate DOM swap reuse the settled failure before allowing retries.
      setTimeout(() => {
        if (heroImagePreloadCache.get(normalized) === preload) {
          heroImagePreloadCache.delete(normalized);
        }
      }, 0);
    }
  });
  return preload;
}

export function preloadHeroAssets(hero, layoutMode = "modern") {
  const display = layoutMode === "modern" ? buildModernHeroPresentation(hero) : buildHeroDisplayModel(hero, layoutMode);
  return Promise.all([preloadImageSource(display?.backdrop), preloadImageSource(display?.logo)]);
}

export function prepareHeroImageEnter(image, enterClass) {
  // A reused image is already opaque. Without an immediate reset, changing src
  // flashes the new artwork while CSS starts fading from 1 towards 0; the next
  // animation frame then reverses that fade instead of entering from 0.
  const transition = image.style.getPropertyValue("transition");
  const priority = image.style.getPropertyPriority("transition");
  image.style.setProperty("transition", "none", "important");
  image.classList.remove("is-visible");
  image.classList.add(enterClass);
  void image.offsetWidth;
  if (transition) {
    image.style.setProperty("transition", transition, priority);
  } else {
    image.style.removeProperty("transition");
  }
}
