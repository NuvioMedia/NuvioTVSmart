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

import { normalizeContinueWatchingItem } from "./homeScreenHelpers-09-normalize-continue-watching-item.js";
import { isSeriesTypeForContinueWatching } from "./homeScreenHelpers-06-resolve-trailer-source.js";
import { buildCatalogLoadingItems } from "./homeScreenHelpers-08-partition-continue-watching-rows.js";
import { shouldDeferHomeRowImages } from "./homeScreenHelpers-14-get-home-grid-column-count.js";
import { createPosterCardMarkup } from "./homeScreenHelpers-15-create-poster-card-markup.js";
import { renderRowHeader } from "./homeScreenHelpers-12-build-hero-indicators.js";
import { t } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";

export function continueWatchingStreamParams(item, options = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized?.contentId) {
    return null;
  }
  const isSeries = isSeriesTypeForContinueWatching(normalized.type);
  return {
    itemId: normalized.contentId,
    itemType: normalized.type || "movie",
    imdbId: normalized.imdbId || null,
    tmdbId: normalized.tmdbId || null,
    traktId: normalized.traktId || null,
    itemTitle: normalized.title || normalized.contentId || "Untitled",
    playerTitle: normalized.title || normalized.contentId || "Untitled",
    playerEpisodeTitle: isSeries ? normalized.episodeTitle || "" : "",
    playerReleaseYear: isSeries ? "" : String(normalized.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
    // Do not turn contentId into a synthetic videoId; the player and sync layer should keep
    // progress identity stable across entry points.
    videoId: normalized.videoId || null,
    season: isSeries ? normalized.season : null,
    episode: isSeries ? normalized.episode : null,
    episodeTitle: isSeries ? normalized.episodeTitle || "" : "",
    backdrop: firstNonEmpty(normalized.backdrop, normalized.background, normalized.landscapePoster, normalized.poster),
    landscapePoster: firstNonEmpty(normalized.landscapePoster, normalized.backdrop, normalized.background, normalized.poster),
    poster: firstNonEmpty(normalized.poster, normalized.backdrop, normalized.background),
    logo: firstNonEmpty(normalized.logo),
    resumePositionMs: options.startOver ? 0 : Number(normalized.positionMs || 0) || 0,
    resumeProgressPercent: options.startOver ? null : (normalized.progressPercent ?? null),
    resumeDurationMs: options.startOver ? 0 : Number(normalized.durationMs || 0) || 0,
    resumeStreamIdentity: options.startOver ? null : normalized.streamIdentity || null,
    startFromBeginning: Boolean(options.startOver),
    manualSelection: Boolean(options.manualSelection)
  };
}

export function renderLegacyCatalogRowsMarkup(rows = [], options = {}) {
  const {
    layoutMode = "classic",
    showPosterLabels = true,
    showCatalogAddonName = true,
    showCatalogTypeSuffix = true,
    focusedRowKey = "",
    focusedItemIndex = -1,
    expandFocusedPoster = false,
    rowItemLimit = HOME_MAX_ITEMS_PER_ROW_DEFAULT,
    gridMaxDisplayItems = HOME_GRID_SAFE_MAX_COLUMNS * HOME_GRID_DEFAULT_ROW_COUNT,
    watchedTitleIds = null,
    posterSettings = null
  } = options;
  const catalogSeeAllMap = new Map();
  const sectionsMarkup = [];
  // One preference read per render pass: get() clones the profile store and
  // rewrites the root card-depth variables, which is far too much per card.
  const cardSettings = posterSettings || LayoutPreferences.get();

  rows.forEach((rowData, rowIndex) => {
    const isCollectionRow = rowData?.rowKind === "collection";
    const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
    const isLoading = rowData?.result?.status === "loading";
    const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData));
    const loadingItems = isLoading ? rowData.loadingItems || buildCatalogLoadingItems(rowKey, rowItemLimit) : [];
    const rowItems = items.length ? items : loadingItems;
    if (!rowItems.length) {
      return;
    }

    const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
    if (!isLoading && !isCollectionRow) {
      const catalogResultData = rowData?.result?.data || {};
      catalogSeeAllMap.set(seeAllId, {
        addonBaseUrl: rowData.addonBaseUrl || "",
        addonId: rowData.addonId || "",
        addonName: rowData.addonName || "",
        catalogId: rowData.catalogId || "",
        catalogName: rowData.catalogName || "",
        type: rowData.type || "movie",
        initialItems: items,
        initialNextSkip: Number(catalogResultData.nextSkip || 0),
        initialHasMore: Boolean(catalogResultData.hasMore),
        supportsSkip: rowData.supportsSkip !== false && catalogResultData.supportsSkip !== false,
        skipStep: Number(rowData.skipStep || catalogResultData.skipStep || 100)
      });
    }

    const rowTitle = isCollectionRow
      ? String(rowData.collectionTitle || rowData.collection?.title || "Collection")
      : formatCatalogRowTitle(rowData.catalogName, rowData.type, showCatalogTypeSuffix);
    const rowSubtitle = layoutMode === "classic" && showCatalogAddonName && rowData.addonName ? `from ${rowData.addonName}` : "";
    const maxItems = Math.max(1, Number(layoutMode === "grid" ? gridMaxDisplayItems : rowItemLimit || HOME_MAX_ITEMS_PER_ROW_DEFAULT));
    const hasSeeAll =
      !isCollectionRow &&
      !isLoading &&
      (layoutMode === "grid"
        ? Boolean(rowData?.result?.data?.hasMore) || items.length > maxItems
        : Boolean(rowData?.result?.data?.hasMore) || items.length >= 15);
    const gridLimit = Math.max(1, hasSeeAll ? maxItems - 1 : maxItems);
    const visibleItems = isCollectionRow ? rowItems : layoutMode === "grid" ? rowItems.slice(0, gridLimit) : rowItems.slice(0, maxItems);
    const deferRowImages = shouldDeferHomeRowImages(rowIndex, rowKey, focusedRowKey);
    const cardsMarkup = visibleItems
      .map((item, itemIndex) =>
        createPosterCardMarkup(
          item,
          rowIndex,
          itemIndex,
          rowData.type,
          rowData,
          showPosterLabels,
          layoutMode,
          expandFocusedPoster && focusedRowKey === rowKey && focusedItemIndex === itemIndex,
          false,
          deferRowImages,
          watchedTitleIds,
          cardSettings
        )
      )
      .join("");
    const trackMarkup = `
      <div class="${layoutMode === "grid" ? "home-grid-track" : "home-track"}" data-track-row-key="${escapeAttribute(rowKey)}">
        ${cardsMarkup}
        ${hasSeeAll ? createSeeAllCardMarkup(seeAllId, rowData, visibleItems.length, rowIndex) : ""}
      </div>
    `;

    if (layoutMode === "grid") {
      sectionsMarkup.push(`
        <section class="home-grid-section"
                 data-row-key="${escapeAttribute(rowKey)}"
                 data-row-index="${rowIndex}"
                 data-section-title="${escapeAttribute(rowTitle)}">
          <div class="home-grid-section-divider">${escapeHtml(rowTitle)}</div>
          ${trackMarkup}
        </section>
      `);
      return;
    }

    sectionsMarkup.push(`
      <section class="home-row"
               data-row-key="${escapeAttribute(rowKey)}"
               data-row-index="${rowIndex}">
        ${renderRowHeader(rowTitle, rowSubtitle)}
        ${trackMarkup}
      </section>
    `);
  });

  return {
    catalogSeeAllMap,
    markup: sectionsMarkup.join("")
  };
}

export function createSeeAllCardMarkup(seeAllId, rowData, itemIndex = 0, rowIndex = 0) {
  const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData)).trim();
  const catalogResultData = rowData?.result?.data || {};
  const hasMore = Boolean(catalogResultData.hasMore);
  const supportsSkip = rowData.supportsSkip !== false && catalogResultData.supportsSkip !== false;
  const seeAllLabel = t("action_see_all", {}, "See All");
  const arrowClass = I18n.isRtl() ? " is-rtl" : "";
  return `
    <article class="home-content-card home-seeall-card focusable"
             tabindex="0"
             data-nav-zone="main"
             data-nav-row="${Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : 0}"
             data-nav-col="${Math.max(0, Number(itemIndex || 0))}"
             data-nav-row-key="${escapeAttribute(rowKey)}"
             data-action="openCatalogSeeAll"
             data-see-all-id="${escapeAttribute(seeAllId)}"
             data-addon-base-url="${escapeAttribute(rowData.addonBaseUrl || "")}"
             data-addon-id="${escapeAttribute(rowData.addonId || "")}"
             data-addon-name="${escapeAttribute(rowData.addonName || "")}"
             data-catalog-id="${escapeAttribute(rowData.catalogId || "")}"
             data-catalog-name="${escapeAttribute(rowData.catalogName || "")}"
             data-catalog-type="${escapeAttribute(rowData.type || "")}"
             data-catalog-has-more="${hasMore ? "true" : "false"}"
             data-catalog-skip-step="${Math.max(1, Number(rowData.skipStep || catalogResultData.skipStep || 100))}"
             data-catalog-supports-skip="${supportsSkip ? "true" : "false"}">
      <div class="home-seeall-card-inner">
        <div class="home-seeall-arrow${arrowClass}" aria-hidden="true">&#8594;</div>
        <div class="home-seeall-label" dir="auto">${escapeHtml(seeAllLabel)}</div>
      </div>
      <div class="home-seeall-card-label-spacer" aria-hidden="true"></div>
    </article>
  `;
}

export function groupNodesByOffsetTop(nodes = []) {
  const grouped = [];
  nodes.forEach((node) => {
    const top = Math.round(node.offsetTop);
    const bucket = grouped.find((entry) => Math.abs(entry.top - top) <= 6);
    if (bucket) {
      bucket.nodes.push(node);
      return;
    }
    grouped.push({ top, nodes: [node] });
  });
  grouped.sort((left, right) => left.top - right.top);
  return grouped.map((entry) => entry.nodes);
}

export function getHomeGridRowCount(layoutPrefs = {}) {
  return Number(layoutPrefs?.posterCardWidthDp ?? 126) <= 104 ? HOME_GRID_COMPACT_ROW_COUNT : HOME_GRID_DEFAULT_ROW_COUNT;
}
