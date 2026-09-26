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

import {
  continueWatchingEnrichmentCacheKey,
  readContinueWatchingEnrichmentCache,
  readContinueWatchingEnrichmentCacheReadOnly,
  normalizeContinueWatchingItem,
  isRawContinueWatchingTitle,
  hasContinueWatchingArtwork,
  isCloudContinueWatchingItem
} from "./homeScreenHelpers-09-normalize-continue-watching-item.js";
import { refreshContinueWatchingReleaseState } from "./homeScreenHelpers-07-map-absolute-watched-episode-keys.js";
import { resolveImdbRating } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { isCollectionFolderItem } from "./homeScreenHelpers-04-animate-hero-logo-swap.js";
import { normalizeCollectionFolderItem } from "./homeScreenHelpers-05-normalize-collection-folder-item.js";
import { normalizeCatalogItem } from "./homeScreenHelpers-08-partition-continue-watching-rows.js";

export function getCachedContinueWatchingEnrichment(item = {}) {
  const key = continueWatchingEnrichmentCacheKey(item);
  if (!key) {
    return null;
  }
  const cached = readContinueWatchingEnrichmentCacheReadOnly()[key];
  if (!cached || typeof cached !== "object") {
    return null;
  }
  if (Date.now() - Number(cached.cachedAt || 0) > CW_ENRICHMENT_CACHE_MAX_AGE_MS) {
    return null;
  }
  return { ...cached };
}

export function applyCachedContinueWatchingEnrichment(item = {}) {
  const cached = getCachedContinueWatchingEnrichment(item);
  if (!cached) {
    return refreshContinueWatchingReleaseState(item);
  }
  return refreshContinueWatchingReleaseState({
    ...item,
    ...cached,
    contentId: item.contentId,
    contentType: item.contentType,
    videoId: item.videoId,
    season: item.season,
    episode: item.episode,
    positionMs: item.positionMs,
    durationMs: item.durationMs,
    progressPercent: item.progressPercent,
    updatedAt: item.updatedAt,
    source: item.source
  });
}

export function saveContinueWatchingEnrichment(item = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized?.contentId || isRawContinueWatchingTitle(normalized) || !hasContinueWatchingArtwork(normalized)) {
    return;
  }
  const key = continueWatchingEnrichmentCacheKey(normalized);
  if (!key) {
    return;
  }
  const cache = readContinueWatchingEnrichmentCache();
  cache[key] = {
    cachedAt: Date.now(),
    title: normalized.title,
    name: normalized.name,
    landscapePoster: normalized.landscapePoster,
    episodeThumbnail: normalized.episodeThumbnail,
    poster: normalized.poster,
    background: normalized.background,
    backdrop: normalized.backdrop,
    thumbnail: normalized.thumbnail,
    logo: normalized.logo,
    description: normalized.description,
    releaseInfo: normalized.releaseInfo,
    imdbRating: normalized.imdbRating,
    genres: normalized.genres,
    runtimeMinutes: normalized.runtimeMinutes,
    ageRating: normalized.ageRating,
    status: normalized.status,
    language: normalized.language,
    country: normalized.country,
    episodeTitle: normalized.episodeTitle,
    episodeDescription: normalized.episodeDescription,
    continueWatchingMetaResolved: true
  };
  const enrichmentCacheLimit = getTvRuntimePerformanceProfile().isPerformanceConstrained ? 50 : 200;
  const entries = Object.entries(cache)
    .sort(([, left], [, right]) => Number(right?.cachedAt || 0) - Number(left?.cachedAt || 0))
    .slice(0, enrichmentCacheLimit);
  LocalStore.set(CW_ENRICHMENT_CACHE_KEY, Object.fromEntries(entries));
}

export function readContinueWatchingDisplaySnapshot(scopeKey) {
  const key = String(scopeKey || "").trim();
  if (!key) {
    return [];
  }
  const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
  const entry = store && typeof store === "object" ? store[key] : null;
  if (!entry || !Array.isArray(entry.items)) {
    return [];
  }
  if (Date.now() - Number(entry.savedAt || 0) > CW_DISPLAY_SNAPSHOT_MAX_AGE_MS) {
    return [];
  }
  const showUnairedNextUp = LayoutPreferences.get()?.showUnairedNextUp !== false;
  return entry.items
    .map((item) => refreshContinueWatchingReleaseState(item))
    .filter((item) => shouldKeepNextUpForAiringSetting(item, showUnairedNextUp))
    .filter((item) => {
      if (!isCloudContinueWatchingItem(item)) {
        return true;
      }
      return Boolean(CloudLibraryPlaybackProgressStore.findForContinueWatching(item.contentId, item.videoId));
    });
}

export function writeContinueWatchingDisplaySnapshot(scopeKey, items = []) {
  const key = String(scopeKey || "").trim();
  if (!key || !Array.isArray(items) || !items.length) {
    return;
  }
  const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
  const next = store && typeof store === "object" ? { ...store } : {};
  next[key] = { savedAt: Date.now(), items: items.slice(0, CW_DISPLAY_SNAPSHOT_MAX_ITEMS) };
  const entries = Object.entries(next)
    .sort(([, left], [, right]) => Number(right?.savedAt || 0) - Number(left?.savedAt || 0))
    .slice(0, CW_DISPLAY_SNAPSHOT_MAX_SCOPES);
  LocalStore.set(CW_DISPLAY_SNAPSHOT_KEY, Object.fromEntries(entries));
}

export function buildContinueWatchingSignature(items = []) {
  return (items || [])
    .map((item) => {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized) {
        return "";
      }
      const position = Math.round(Number(normalized.positionMs || 0) / 1000);
      const duration = Math.round(Number(normalized.durationMs || 0) / 1000);
      return [
        normalized.contentId,
        normalized.videoId || "",
        normalized.season ?? "",
        normalized.episode ?? "",
        normalized.title || normalized.name || "",
        normalized.poster || "",
        normalized.background || normalized.backdrop || normalized.thumbnail || "",
        normalized.logo || "",
        normalized.episodeTitle || "",
        normalized.episodeThumbnail || "",
        normalized.description || normalized.episodeDescription || "",
        resolveImdbRating(normalized) || "",
        (normalized.genres || []).join(","),
        normalized.releaseInfo || "",
        normalized.runtimeMinutes || "",
        normalized.ageRating || "",
        normalized.status || "",
        normalized.language || "",
        normalized.country || "",
        normalized.continueWatchingMetaResolved ? "resolved" : "",
        position,
        duration,
        normalized.progressStatus || "",
        normalized.progressFraction ?? "",
        normalized.hasAired === false ? "upcoming" : "aired",
        normalized.isReleaseAlert ? "release-alert" : "",
        normalized.airDateLabel || ""
      ].join("|");
    })
    .join("::");
}

export function buildSidebarProfileSignature(profile = null) {
  if (!profile || typeof profile !== "object") {
    return "";
  }
  return [
    profile.id || "",
    profile.name || "",
    profile.avatarColorHex || "",
    profile.avatarId || "",
    profile.avatarUrl || profile.activeProfileAvatarUrl || ""
  ].join("|");
}

export function buildHeroIdentity(item = null) {
  const normalized = isCollectionFolderItem(item) ? normalizeCollectionFolderItem(item) : normalizeCatalogItem(item || null, "movie");
  if (!normalized) {
    return "";
  }
  return [
    normalized.id || normalized.videoId || normalized.contentId || normalized.title || normalized.name || "",
    normalized.type || normalized.apiType || "",
    normalized.season ?? "",
    normalized.episode ?? ""
  ].join("|");
}

export function hideHomeHeroRatings() {
  return !showHomeRatings(LayoutPreferences.get()?.homeImdbRatingsVisibility);
}
