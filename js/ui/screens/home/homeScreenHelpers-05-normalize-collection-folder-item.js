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

import { normalizeAnimatedCollectionAssetUrl, normalizeCollectionPosterShape } from "./homeScreenHelpers-04-animate-hero-logo-swap.js";
import { normalizeCatalogItem } from "./homeScreenHelpers-08-partition-continue-watching-rows.js";

export function normalizeCollectionFolderItem(item, collectionMeta = null) {
  if (!item) {
    return null;
  }
  const collectionId = firstNonEmpty(item.collectionId, collectionMeta?.id);
  const folderId = firstNonEmpty(item.folderId, item.id);
  const title = firstNonEmpty(item.rawTitle, item.folderTitle, item.title, item.name, item.heroTitle);
  if (!collectionId || !folderId || !title) {
    return null;
  }
  const collectionTitle = firstNonEmpty(item.collectionTitle, collectionMeta?.title);
  const coverImageUrl = firstNonEmpty(item.coverImageUrl, item.coverImage);
  const focusGifUrl = normalizeAnimatedCollectionAssetUrl(firstNonEmpty(item.focusGifUrl));
  const focusGifEnabled = item.focusGifEnabled !== false;
  const hideTitle = Boolean(item.hideTitle);
  const tileShape = normalizeCollectionPosterShape(item.tileShape || item.posterShape);
  const coverEmoji = firstNonEmpty(item.coverEmoji);
  const cardImage = firstNonEmpty(coverImageUrl, collectionMeta?.backdropImageUrl);
  const heroBackdrop = firstNonEmpty(item.heroBackdropUrl, coverImageUrl, collectionMeta?.backdropImageUrl);
  return {
    ...item,
    id: `collection:${collectionId}:${folderId}`,
    type: "collection_folder",
    apiType: "collection_folder",
    heroSource: "collection",
    rawTitle: title,
    name: hideTitle ? "" : title,
    title: hideTitle ? "" : title,
    heroTitle: hideTitle ? "" : coverEmoji ? `${coverEmoji}  ${title}` : title,
    subtitle: hideTitle ? "" : collectionTitle,
    poster: cardImage,
    background: heroBackdrop,
    backdrop: heroBackdrop,
    landscapePoster: heroBackdrop,
    logo: firstNonEmpty(item.titleLogoUrl),
    description: "",
    genres: [],
    collectionId,
    collectionTitle,
    folderId,
    coverImageUrl,
    focusGifUrl,
    focusGifEnabled,
    coverEmoji,
    tileShape,
    hideTitle,
    heroBackdropUrl: firstNonEmpty(item.heroBackdropUrl),
    heroVideoUrl: firstNonEmpty(item.heroVideoUrl),
    titleLogoUrl: firstNonEmpty(item.titleLogoUrl)
  };
}

export function buildCollectionHomeRow(collection = {}) {
  const rowKey = buildCollectionHomeKey(collection);
  return {
    rowKind: "collection",
    collectionId: collection.id,
    collectionTitle: collection.title,
    collection,
    type: "collection_folder",
    homeCatalogKey: rowKey,
    homeCatalogDisableKey: rowKey,
    pinToTop: Boolean(collection.pinToTop),
    focusGlowEnabled: collection.focusGlowEnabled !== false,
    viewMode: String(collection.viewMode || "TABBED_GRID"),
    showAllTab: collection.showAllTab !== false,
    result: {
      status: "success",
      data: {
        items: (Array.isArray(collection.folders) ? collection.folders : [])
          .map((folder) =>
            normalizeCollectionFolderItem(
              {
                ...folder,
                collectionId: collection.id,
                collectionTitle: collection.title
              },
              collection
            )
          )
          .filter(Boolean)
      }
    }
  };
}

export function normalizeHomeRowItem(row = null, item = null) {
  if (!row || !item) {
    return null;
  }
  if (row.rowKind === "collection") {
    return normalizeCollectionFolderItem(
      item,
      row.collection || {
        id: row.collectionId,
        title: row.collectionTitle
      }
    );
  }
  return normalizeCatalogItem(item, row.type || "movie");
}

export function formatEpisodeCode(season, episode) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (season != null && Number.isFinite(seasonNumber) && seasonNumber >= 0 && Number.isFinite(episodeNumber) && episodeNumber > 0) {
    return `S${seasonNumber} E${episodeNumber}`;
  }
  if (Number.isFinite(episodeNumber) && episodeNumber > 0) {
    return `E${episodeNumber}`;
  }
  return "";
}

export function resolveYoutubeId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const directMatch = raw.match(/^[A-Za-z0-9_-]{11}$/);
  if (directMatch) {
    return directMatch[0];
  }
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

export function buildYoutubeEmbedUrl(videoId, { muted = true } = {}) {
  const cleanId = resolveYoutubeId(videoId);
  if (!cleanId) {
    return "";
  }
  const proxyBase = String(YOUTUBE_PROXY_URL || "").trim();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", muted ? "1" : "0");
      proxyUrl.searchParams.set("controls", "0");
      proxyUrl.searchParams.set("loop", "1");
      proxyUrl.searchParams.set("playlist", cleanId);
      proxyUrl.searchParams.set("playsinline", "1");
      proxyUrl.searchParams.set("rel", "0");
      proxyUrl.searchParams.set("cc_load_policy", "0");
      proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      return proxyUrl.toString();
    } catch (_) {
      return "";
    }
  }
  if (typeof globalThis?.document === "undefined") {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: "1",
    playlist: cleanId,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    cc_load_policy: "0",
    iv_load_policy: "3"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube.com/embed/${cleanId}?${params.toString()}`;
}
