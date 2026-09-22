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

import { normalizeCollectionFolderItem } from "./homeScreenHelpers-05-normalize-collection-folder-item.js";
import { isCollectionFolderItem, normalizeCollectionPosterShape } from "./homeScreenHelpers-04-animate-hero-logo-swap.js";
import { buildPosterSubtitle } from "./homeScreenHelpers-12-build-hero-indicators.js";
import { buildLazyImageAttributes } from "./homeScreenHelpers-14-get-home-grid-column-count.js";
import { normalizeCatalogItem } from "./homeScreenHelpers-08-partition-continue-watching-rows.js";
import { normalizeTmdbBackdropUrl, normalizeTmdbPosterUrl } from "../../../core/tmdb/tmdbImageUrl.js";

export function createPosterCardMarkup(
  item,
  rowIndex,
  itemIndex,
  itemType,
  rowData = null,
  showLabels = true,
  layoutMode = "classic",
  isExpanded = false,
  preferLandscapePoster = false,
  deferImages = false,
  watchedTitleIds = null
) {
  const suppressPosterText = Boolean(rowData?.suppressPosterText);
  const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData || {})).trim();
  const collectionSeed =
    rowData?.rowKind === "collection"
      ? {
          ...(item || {}),
          collectionId: item?.collectionId || rowData?.collectionId || rowData?.collection?.id,
          collectionTitle: item?.collectionTitle || rowData?.collectionTitle || rowData?.collection?.title
        }
      : item;
  const collectionItem =
    rowData?.rowKind === "collection"
      ? normalizeCollectionFolderItem(collectionSeed, rowData?.collection || null)
      : isCollectionFolderItem(item)
        ? normalizeCollectionFolderItem(item)
        : null;
  if (collectionItem) {
    const visualSrc = firstNonEmpty(collectionItem.poster, collectionItem.coverImageUrl, collectionItem.backdrop);
    const subtitle = buildPosterSubtitle(collectionItem, layoutMode);
    const tileShape = normalizeCollectionPosterShape(collectionItem.tileShape);
    const shapeClass =
      tileShape === "POSTER" ? "" : tileShape === "SQUARE" ? " is-collection-square" : " is-landscape is-collection-landscape";
    const focusGifOverlay =
      collectionItem.focusGifEnabled && collectionItem.focusGifUrl
        ? `<img class="home-poster-focus-gif" data-src="${escapeAttribute(collectionItem.focusGifUrl)}" alt="" aria-hidden="true" />`
        : "";
    const collectionDisplayTitle = collectionItem.name || collectionItem.heroTitle || collectionItem.collectionTitle || "Collection";
    const gridCollectionTitle =
      layoutMode === "grid" && !collectionItem.hideTitle
        ? `<div class="home-collection-title-overlay" dir="auto">${escapeHtml(collectionDisplayTitle)}</div>`
        : "";
    const contentMarkup = visualSrc
      ? `<img class="content-poster" ${buildLazyImageAttributes(visualSrc, { defer: deferImages })} alt="${escapeAttribute(collectionItem.name || collectionItem.heroTitle || collectionItem.collectionTitle || "collection")}" />`
      : collectionItem.coverEmoji
        ? `<div class="home-collection-emoji" aria-hidden="true">${escapeHtml(collectionItem.coverEmoji)}</div>`
        : '<div class="content-poster placeholder"></div>';
    return `
      <article class="home-content-card home-poster-card home-collection-card focusable${shapeClass}"
               tabindex="0"
               data-nav-zone="main"
               data-nav-row="${rowIndex}"
               data-nav-col="${itemIndex}"
               data-nav-row-key="${escapeAttribute(rowKey)}"
               data-action="openCollectionFolder"
               data-row-index="${rowIndex}"
               data-item-index="${itemIndex}"
               data-item-id="${escapeAttribute(collectionItem.id)}"
               data-item-type="collection_folder"
               data-item-title="${escapeAttribute(collectionItem.name || collectionItem.heroTitle || collectionItem.collectionTitle || "Collection")}"
               data-collection-id="${escapeAttribute(collectionItem.collectionId)}"
               data-folder-id="${escapeAttribute(collectionItem.folderId)}"
               data-collection-title="${escapeAttribute(collectionItem.collectionTitle || "")}"
               data-focus-gif-enabled="${collectionItem.focusGifEnabled ? "true" : "false"}"
               data-focus-gif-src="${escapeAttribute(collectionItem.focusGifUrl || "")}"
               data-hero-video-url="${escapeAttribute(collectionItem.heroVideoUrl || "")}"
               data-logo-src="${escapeAttribute(collectionItem.titleLogoUrl || "")}"
               data-backdrop-src="${escapeAttribute(collectionItem.heroBackdropUrl || collectionItem.backdrop || "")}">
        <div class="home-poster-frame">
          ${contentMarkup}
          ${focusGifOverlay}
          ${gridCollectionTitle}
        </div>
        ${
          layoutMode === "classic" && !collectionItem.hideTitle
            ? `
          <div class="home-poster-copy">
            <div class="home-poster-title" dir="auto">${escapeHtml(collectionDisplayTitle)}</div>
            ${subtitle ? `<div class="home-poster-subtitle" dir="auto">${escapeHtml(subtitle)}</div>` : ""}
          </div>
        `
            : ""
        }
      </article>
    `;
  }
  const isLoading = Boolean(item?.isLoading);
  const normalized = normalizeCatalogItem(item, itemType);
  const subtitle = buildPosterSubtitle(normalized, layoutMode);
  const preferredLandscapePosterSrc = firstNonEmpty(normalized.landscapePoster);
  const useLandscapePoster = layoutMode === "modern" && preferLandscapePoster;
  const landscapeVisualSrc = firstNonEmpty(
    preferredLandscapePosterSrc,
    normalized.background,
    normalized.backdrop,
    normalized.backdropUrl,
    normalized.poster,
    normalized.thumbnail
  );
  const rawBackdropSrc = useLandscapePoster
    ? landscapeVisualSrc
    : firstNonEmpty(preferredLandscapePosterSrc, normalized.background, normalized.backdrop, normalized.backdropUrl, normalized.poster);
  const rawPosterSrc = useLandscapePoster
    ? landscapeVisualSrc
    : firstNonEmpty(normalized.poster, normalized.thumbnail, preferredLandscapePosterSrc, normalized.backdrop, normalized.backdropUrl);
  const backdropSrc = normalizeTmdbBackdropUrl(rawBackdropSrc);
  const posterSrc = useLandscapePoster ? backdropSrc : normalizeTmdbPosterUrl(rawPosterSrc);
  const expandedVisualSrc = firstNonEmpty(backdropSrc, posterSrc);
  const expandedClass = isExpanded ? " is-expanded" : "";
  const landscapeClass = useLandscapePoster ? " is-landscape" : "";
  const focusableClass = isLoading ? "" : " focusable";
  const loadingClass = isLoading ? " home-poster-card-loading" : "";
  const shouldShowLabels = showLabels && !isLoading && !suppressPosterText;
  const watchedBadge = !isLoading && isTitleItemWatched(normalized, watchedTitleIds) ? renderTitleWatchedBadge() : "";
  const titleWidths = [116, 128, 104, 132, 120, 140, 110, 124, 136, 112];
  const subtitleWidths = [82, 96, 74, 90, 88, 100, 80, 94, 86, 92];
  const safeIndex = Math.max(0, Number(itemIndex) || 0);
  const titleWidth = titleWidths[safeIndex % titleWidths.length];
  const subtitleWidth = subtitleWidths[safeIndex % subtitleWidths.length];
  return `
    <article class="home-content-card home-poster-card${focusableClass}${expandedClass}${landscapeClass}${loadingClass}"
             ${isLoading ? "" : 'tabindex="0"'}
             ${
               isLoading
                 ? ""
                 : `data-nav-zone="main"
             data-nav-row="${rowIndex}"
             data-nav-col="${itemIndex}"
             data-nav-row-key="${escapeAttribute(rowKey)}"`
             }
             ${
               isLoading
                 ? 'aria-disabled="true"'
                 : `data-action="openDetail"
             data-row-index="${rowIndex}"
             data-item-index="${itemIndex}"
             data-item-id="${escapeAttribute(normalized.id)}"
             data-item-type="${escapeAttribute(normalized.type || itemType || "movie")}"
             data-item-title="${escapeAttribute(normalized.name || "Untitled")}"
             data-poster-src="${escapeAttribute(posterSrc || "")}"
             data-backdrop-src="${escapeAttribute(backdropSrc || "")}"
             data-logo-src="${escapeAttribute(normalized.logo || "")}"
             data-addon-base-url="${escapeAttribute(rowData?.addonBaseUrl || normalized.addonBaseUrl || "")}"
             data-addon-id="${escapeAttribute(rowData?.addonId || normalized.addonId || "")}"
             data-addon-name="${escapeAttribute(rowData?.addonName || normalized.addonName || "")}"
             data-catalog-type="${escapeAttribute(rowData?.type || normalized.catalogType || "")}"`
             }>
      <div class="home-poster-frame">
        ${
          !isLoading && posterSrc
            ? `<img class="content-poster" ${buildLazyImageAttributes(posterSrc, { defer: deferImages })} alt="${escapeAttribute(normalized.name || "content")}" />`
            : '<div class="content-poster placeholder"></div>'
        }
        ${
          !isLoading && expandedVisualSrc
            ? `<img class="home-poster-expanded-backdrop" data-src="${escapeAttribute(expandedVisualSrc)}" decoding="async" loading="lazy" alt="" aria-hidden="true" />`
            : '<div class="home-poster-expanded-backdrop placeholder" aria-hidden="true"></div>'
        }
        <div class="home-poster-trailer-layer"></div>
        <div class="home-poster-expanded-gradient"></div>
        ${watchedBadge}
        <div class="home-poster-expanded-brand">
          ${
            !isLoading && normalized.logo
              ? `<img class="home-poster-expanded-logo" data-src="${escapeAttribute(normalized.logo)}" decoding="async" loading="lazy" alt="${escapeAttribute(normalized.name || "content")}" />`
              : `<div class="home-poster-expanded-title" dir="auto">${escapeHtml(normalized.name || "Untitled")}</div>`
          }
        </div>
        ${
          !isLoading && useLandscapePoster && !suppressPosterText
            ? `
          <div class="home-poster-landscape-copy" aria-hidden="true">
            ${
              normalized.logo
                ? `<img class="home-poster-landscape-logo" ${buildLazyImageAttributes(normalized.logo, { defer: deferImages })} alt="" />`
                : `<div class="home-poster-landscape-title">${escapeHtml(normalized.name || "Untitled")}</div>`
            }
            ${subtitle ? `<div class="home-poster-landscape-subtitle">${escapeHtml(subtitle)}</div>` : ""}
          </div>
        `
            : ""
        }
      </div>
      ${
        shouldShowLabels
          ? `
        <div class="home-poster-copy">
          <div class="home-poster-title" dir="auto">${escapeHtml(normalized.name || "Untitled")}</div>
          ${subtitle ? `<div class="home-poster-subtitle" dir="auto">${escapeHtml(subtitle)}</div>` : ""}
        </div>
      `
          : isLoading
            ? `
        <div class="home-poster-copy home-poster-copy-skeleton" aria-hidden="true"
             style="--poster-skeleton-title:${titleWidth}px;--poster-skeleton-subtitle:${subtitleWidth}px;">
          <div class="home-poster-skeleton-line home-poster-skeleton-title"></div>
          <div class="home-poster-skeleton-line home-poster-skeleton-subtitle"></div>
        </div>
      `
            : ""
      }
    </article>
  `;
}
