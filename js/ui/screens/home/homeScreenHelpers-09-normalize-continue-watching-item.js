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

import { isSeriesTypeForContinueWatching } from "./homeScreenHelpers-06-resolve-trailer-source.js";
import { resolveNextUpReleaseState } from "./homeScreenHelpers-07-map-absolute-watched-episode-keys.js";
import {
  continueWatchingDurationMs,
  buildProgressStatus,
  buildProgressFraction
} from "./homeScreenHelpers-08-partition-continue-watching-rows.js";
import { resolveImdbRating } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { formatEpisodeCode } from "./homeScreenHelpers-05-normalize-collection-folder-item.js";

export function normalizeContinueWatchingItem(item) {
  if (!item) {
    return null;
  }
  const title = firstNonEmpty(item.title, item.name, prettyId(item.contentId));
  const type = String(item.contentType || item.type || "movie").trim() || "movie";
  const isSeries = isSeriesTypeForContinueWatching(type);
  const releaseState = item?.isNextUp ? resolveNextUpReleaseState(item) : null;
  const resolvedItem = releaseState ? { ...item, ...releaseState } : item;
  return {
    ...resolvedItem,
    heroSource: "continueWatching",
    id: String(item.contentId || item.id || "").trim(),
    contentId: String(item.contentId || item.id || "").trim(),
    videoId: item.videoId || null,
    season: Number.isFinite(Number(item.season)) ? Number(item.season) : null,
    episode: Number.isFinite(Number(item.episode)) ? Number(item.episode) : null,
    positionMs: Number(item.positionMs || 0) || 0,
    durationMs: continueWatchingDurationMs(item),
    type,
    apiType: type,
    name: title,
    title,
    landscapePoster: firstNonEmpty(item.landscapePoster, item.thumbnail, item.backdrop, item.background, item.poster),
    thumbnail: firstNonEmpty(item.thumbnail, item.episodeThumbnail, item.poster, item.backdrop, item.background),
    backdrop: firstNonEmpty(item.backdrop, item.background, item.thumbnail, item.poster, item.episodeThumbnail),
    episodeThumbnail: firstNonEmpty(item.episodeThumbnail, item.thumbnail, item.backdrop, item.background, item.poster),
    poster: isSeries
      ? firstNonEmpty(item.poster, item.episodeThumbnail, item.thumbnail, item.backdrop, item.background)
      : firstNonEmpty(item.poster, item.backdrop, item.background, item.thumbnail, item.episodeThumbnail),
    background: isSeries
      ? firstNonEmpty(item.background, item.backdrop, item.poster, item.episodeThumbnail, item.thumbnail)
      : firstNonEmpty(item.background, item.backdrop, item.poster, item.thumbnail, item.episodeThumbnail),
    logo: firstNonEmpty(item.logo),
    description: firstNonEmpty(item.description),
    episodeDescription: firstNonEmpty(item.episodeDescription, item.episode_description),
    releaseInfo: firstNonEmpty(item.releaseInfo),
    genres: Array.isArray(item.genres) ? item.genres.filter(Boolean) : [],
    runtimeMinutes: Number(item.runtimeMinutes ?? item.runtime ?? 0) || 0,
    imdbRating: resolveImdbRating(item),
    ageRating: firstNonEmpty(item.ageRating, item.age_rating),
    status: firstNonEmpty(item.status),
    language: firstNonEmpty(item.language),
    country: firstNonEmpty(item.country),
    progressStatus: buildProgressStatus(resolvedItem),
    progressFraction: buildProgressFraction(resolvedItem),
    episodeCode: isSeries ? formatEpisodeCode(item.season, item.episode) : "",
    episodeTitle: isSeries ? firstNonEmpty(item.episodeTitle, item.subtitle) : ""
  };
}

export function isCloudContinueWatchingItem(item = {}) {
  return (
    String(item?.contentType || item?.type || "")
      .trim()
      .toLowerCase() === "cloud"
  );
}

export function isRawContinueWatchingTitle(item) {
  const contentId = String(item?.contentId || item?.id || "").trim();
  const title = firstNonEmpty(item?.title, item?.name);
  return Boolean(title) && Boolean(contentId) && title === prettyId(contentId);
}

export function hasContinueWatchingArtwork(item) {
  return Boolean(
    firstNonEmpty(item?.poster, item?.background, item?.backdrop, item?.backdropUrl, item?.thumbnail, item?.episodeThumbnail, item?.logo)
  );
}

export function isPresentableContinueWatchingItem(item, { requireArtwork = false } = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized) {
    return false;
  }
  const hasMeaningfulTitle = Boolean(firstNonEmpty(normalized.title, normalized.name)) && !isRawContinueWatchingTitle(normalized);
  const hasArtwork = hasContinueWatchingArtwork(normalized);
  return requireArtwork ? hasMeaningfulTitle && hasArtwork : hasMeaningfulTitle || hasArtwork;
}

export function buildVisibleContinueWatchingItems(items = [], options = {}) {
  return (items || [])
    .map((item) => normalizeContinueWatchingItem(item))
    .filter((item) => isPresentableContinueWatchingItem(item, options));
}

export function buildCompleteContinueWatchingDisplay(items = []) {
  return (items || []).map((item) => normalizeContinueWatchingItem(item)).filter((item) => item?.contentId);
}

export function hasContinueWatchingHeroMetadata(item = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized) {
    return false;
  }
  const hasDescription = Boolean(firstNonEmpty(normalized.description, normalized.episodeDescription));
  const hasDetails = Boolean(
    resolveImdbRating(normalized) ||
    normalized.genres?.length ||
    firstNonEmpty(normalized.releaseInfo, normalized.ageRating, normalized.status, normalized.language, normalized.country) ||
    Number(normalized.runtimeMinutes || 0) > 0
  );
  return hasDescription && hasDetails;
}

export function needsContinueWatchingMetadataRefresh(items = []) {
  return (items || []).some((item) => {
    const normalized = normalizeContinueWatchingItem(item);
    return (
      normalized?.contentId &&
      (isRawContinueWatchingTitle(normalized) ||
        !hasContinueWatchingArtwork(normalized) ||
        (!normalized.continueWatchingMetaResolved && !hasContinueWatchingHeroMetadata(normalized)))
    );
  });
}

export function buildNextUpSeedFromWatchedItem(item = {}) {
  const contentId = String(item?.contentId || "").trim();
  const contentType = String(item?.contentType || "series")
    .trim()
    .toLowerCase();
  const season = Number(item?.season || 0);
  const episode = Number(item?.episode || 0);
  if (!contentId || !isSeriesTypeForContinueWatching(contentType) || season <= 0 || episode <= 0) {
    return null;
  }
  const watchedAt = Number(item?.watchedAt || 0) || Date.now();
  return {
    contentId,
    contentType,
    videoId: item?.videoId || contentId,
    season,
    episode,
    title: firstNonEmpty(item?.title, prettyId(contentId)),
    episodeTitle: firstNonEmpty(item?.episodeTitle),
    positionMs: 100,
    durationMs: 100,
    progressPercent: 100,
    updatedAt: watchedAt,
    source: "watched_items",
    isSimklAbsoluteEpisode: item?.isSimklAbsoluteEpisode === true
  };
}

export function getContinueWatchingNextUpSeedOptions() {
  const source = watchProgressRepository.getContinueWatchingSource?.() || WatchProgressSource.NUVIO_SYNC;
  const useLocalWatchedItemSeeds = source === WatchProgressSource.NUVIO_SYNC;
  return {
    applyDaysCap: source === WatchProgressSource.TRAKT,
    includeProgressSeeds: !useLocalWatchedItemSeeds,
    includeWatchedItemSeeds: useLocalWatchedItemSeeds
  };
}

export function continueWatchingEnrichmentCacheKey(item = {}) {
  const type =
    String(item.contentType || item.type || "movie")
      .trim()
      .toLowerCase() || "movie";
  const contentId = String(item.contentId || item.id || "").trim();
  const season = item.season == null ? "" : String(Number(item.season || 0));
  const episode = item.episode == null ? "" : String(Number(item.episode || 0));
  return contentId ? `${type}:${contentId}:${season}:${episode}` : "";
}

export function readContinueWatchingEnrichmentCache() {
  const cache = LocalStore.get(CW_ENRICHMENT_CACHE_KEY, {});
  return cache && typeof cache === "object" ? cache : {};
}

// Continue Watching looks up one entry per card; parsing the whole cache for
// every card made each Home render quadratic. Reuse the parsed cache until the
// stored string changes. Callers must treat the result as read-only.
let enrichmentReadCache = { raw: null, cache: {} };

export function readContinueWatchingEnrichmentCacheReadOnly() {
  const raw = LocalStore.getRaw(CW_ENRICHMENT_CACHE_KEY);
  if (raw === null) {
    return {};
  }
  if (enrichmentReadCache.raw !== raw) {
    enrichmentReadCache = { raw, cache: readContinueWatchingEnrichmentCache() };
  }
  return enrichmentReadCache.cache;
}
