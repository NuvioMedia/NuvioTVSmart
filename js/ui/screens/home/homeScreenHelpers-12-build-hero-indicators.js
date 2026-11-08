import { customPosterForItem, posterFallbackAttributes } from "../../../core/poster/customPoster.js";
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

import { buildHeroDisplayModel, renderMetaTokens } from "./homeScreenHelpers-11-build-hero-display-model.js";
import { renderHeroBackdropImage, extractYear, t } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { isCollectionFolderItem } from "./homeScreenHelpers-04-animate-hero-logo-swap.js";
import { normalizeCatalogItem } from "./homeScreenHelpers-08-partition-continue-watching-rows.js";
import { normalizeContinueWatchingItem } from "./homeScreenHelpers-09-normalize-continue-watching-item.js";
import { isSeriesTypeForContinueWatching } from "./homeScreenHelpers-06-resolve-trailer-source.js";
import { buildLazyImageAttributes } from "./homeScreenHelpers-14-get-home-grid-column-count.js";
import { normalizeTmdbBackdropUrl, normalizeTmdbPosterUrl } from "../../../core/tmdb/tmdbImageUrl.js";

export function buildHeroIndicators(items = [], activeItem) {
  if (!Array.isArray(items) || items.length <= 1) {
    return "";
  }
  const activeId = String(activeItem?.id || "");
  const matchedIndex = items.findIndex((item) => String(item?.id || "") === activeId);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;
  return items
    .map(
      (_, index) => `
    <span class="home-hero-indicator${index === activeIndex ? " is-active" : ""}"></span>
  `
    )
    .join("");
}

export function renderHeroMarkup(layoutMode, heroItem, heroCandidates) {
  const display = buildHeroDisplayModel(heroItem, layoutMode);
  const isInteractive = layoutMode !== "modern";
  return `
    <section class="home-hero home-hero-${escapeAttribute(layoutMode)}">
      <article class="home-hero-card${isInteractive ? " focusable" : ""}"
               ${isInteractive ? 'tabindex="0"' : ""}
               ${isInteractive ? 'data-nav-zone="main" data-nav-row="0" data-nav-col="0" data-nav-row-key="__hero__"' : ""}
               ${
                 isInteractive
                   ? `data-action="openDetail"
               data-item-id="${escapeAttribute(heroItem?.id || "")}"
               data-item-type="${escapeAttribute(heroItem?.type || "movie")}"
               data-item-title="${escapeAttribute(heroItem?.name || "Untitled")}"`
                   : ""
               }>
        <div class="home-hero-backdrop-wrap">
          ${renderHeroBackdropImage(display)}
        </div>
        <div class="home-hero-copy">
          <div class="home-hero-brand">
            ${display.logo ? `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />` : ""}
            <h1 class="home-hero-title-text${display.logo ? " is-hidden" : ""}">${escapeHtml(display.title)}</h1>
          </div>
          <div class="home-hero-meta-primary${display.metaPrimary.length ? "" : " is-empty"}">${renderMetaTokens(display.metaPrimary)}</div>
          <div class="home-hero-chip-row${display.chips.length ? "" : " is-empty"}">${display.chips.map((chip) => `<span class="home-hero-chip">${escapeHtml(chip)}</span>`).join("")}</div>
          <div class="home-hero-meta-secondary${display.metaSecondary.length ? "" : " is-empty"}">${renderMetaTokens(display.metaSecondary)}</div>
          <div class="home-hero-mdb-ratings${display.mdbListMarkup ? "" : " is-empty"}">${display.mdbListMarkup || ""}</div>
          <p class="home-hero-description">${escapeHtml(display.description)}</p>
        </div>
        <div class="home-hero-indicators">${buildHeroIndicators(heroCandidates, heroItem)}</div>
      </article>
    </section>
  `;
}

export function buildPosterSubtitle(item, layoutMode) {
  if (layoutMode === "grid") {
    return "";
  }
  if (isCollectionFolderItem(item)) {
    return firstNonEmpty(item.collectionTitle, item.subtitle, "");
  }
  const normalized = normalizeCatalogItem(item);
  if (layoutMode === "modern") {
    return firstNonEmpty(normalized.releaseInfo, "");
  }
  return firstNonEmpty(extractYear(normalized), normalized.releaseInfo, "");
}

export function renderRowHeader(title, subtitle = "") {
  return `
    <div class="home-row-head">
      <h2 class="home-row-title">${escapeHtml(title)}</h2>
      ${subtitle ? `<div class="home-row-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  `;
}

export function resolveContinueWatchingBlurNextUp(layoutPrefs) {
  return Boolean(layoutPrefs?.blurContinueWatchingNextUp);
}

export function renderContinueWatchingCard(item, index, options = {}) {
  const originalItem = normalizeContinueWatchingItem(item);
  // Row renderers pass the preferences they already read; a lone card still
  // falls back to a fresh read so direct callers keep their behaviour.
  const normalized = customPosterForItem(originalItem, "continue_watching", "poster", options?.posterSettings || LayoutPreferences.get());
  const subtitle = normalized.episodeTitle || "";
  const isNextUp = Boolean(normalized?.isNextUp);
  const hasAired = normalized?.hasAired !== false;
  const requestedCardStyle = String(options?.cardStyle || "card")
    .trim()
    .toLowerCase();
  const cardStyle = ["card", "wide", "poster"].includes(requestedCardStyle) ? requestedCardStyle : "card";
  const useEpisodeThumbnails = continueWatchingUsesEpisodeThumbnails(cardStyle, options?.useEpisodeThumbnails);
  const blurNextUp = Boolean(options?.blurNextUp && isNextUp && useEpisodeThumbnails);
  const rowKey = String(options?.rowKey || "continue_watching").trim() || "continue_watching";
  const cardImageSources = continueWatchingImageSources(
    {
      poster: normalized.poster,
      backdrop: normalized.backdrop,
      thumbnail: normalized.thumbnail,
      episodeThumbnail: normalized.episodeThumbnail
    },
    {
      cardStyle,
      useEpisodeThumbnails: options?.useEpisodeThumbnails,
      isSeries: isSeriesTypeForContinueWatching(normalized.type),
      isNextUp,
      hasAired
    }
  );
  const originalCardImages =
    normalized === originalItem
      ? []
      : continueWatchingImageSources(
          {
            poster: originalItem.poster,
            backdrop: originalItem.backdrop,
            thumbnail: originalItem.thumbnail,
            episodeThumbnail: originalItem.episodeThumbnail
          },
          {
            cardStyle,
            useEpisodeThumbnails: options?.useEpisodeThumbnails,
            isSeries: isSeriesTypeForContinueWatching(normalized.type),
            isNextUp,
            hasAired
          }
        );
  const normalizeCardImageUrl = cardStyle === "card" ? normalizeTmdbBackdropUrl : normalizeTmdbPosterUrl;
  const uniqueCardImageSources = uniqueNonEmptyValues(cardImageSources.map((source) => normalizeCardImageUrl(source)));
  const cardImage = uniqueCardImageSources[0] || "";
  const fallbackQueue = encodeHeroBackdropFallbacks(uniqueCardImageSources.slice(1));
  const deferContinueImage = getTvRuntimePerformanceProfile().isPerformanceConstrained;
  const continueImageAttrs = cardImage ? buildLazyImageAttributes(cardImage, { defer: deferContinueImage }) : "";
  return `
    <article class="home-content-card home-continue-card${blurNextUp ? " home-continue-card-blur-next-up" : ""} focusable"
             tabindex="0"
             data-nav-zone="main"
             data-nav-row="0"
             data-nav-col="${Number(options?.navIndex ?? index)}"
             data-nav-row-key="${escapeAttribute(rowKey)}"
             data-action="resumeProgress"
             data-cw-index="${index}"
             data-item-id="${escapeAttribute(normalized.contentId)}"
             data-video-id="${escapeAttribute(normalized.videoId || "")}"
             data-season="${escapeAttribute(normalized.season ?? "")}"
             data-episode="${escapeAttribute(normalized.episode ?? "")}"
             data-item-type="${escapeAttribute(normalized.type || "movie")}"
             data-item-title="${escapeAttribute(normalized.title || "Untitled")}">
      <div class="home-continue-media">
        ${cardImage ? `<img class="home-continue-bg"${posterFallbackAttributes({ rawPosterUrl: originalCardImages[0] })} ${continueImageAttrs}${fallbackQueue ? ` data-fallback-srcs="${escapeAttribute(fallbackQueue)}"` : ""} alt="" aria-hidden="true" decoding="async" onerror="${buildImageFallbackErrorHandler()}" />` : ""}
        <span class="home-continue-badge">${escapeHtml(normalized.progressStatus || t("home.continueStatusContinue", {}, "Continue"))}</span>
        <div class="home-continue-copy">
          ${normalized.episodeCode ? `<div class="home-continue-kicker">${escapeHtml(normalized.episodeCode)}</div>` : ""}
          <div class="home-continue-title" dir="auto">${escapeHtml(normalized.title)}</div>
          ${subtitle ? `<div class="home-continue-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
        <div class="home-continue-progress"><span style="width:${Math.round((normalized.progressFraction || 0) * 100)}%"></span></div>
      </div>
    </article>
  `;
}

export function renderContinueWatchingLoadingCard(index = 0, rowKey = "continue_watching") {
  const titleWidths = [132, 148, 124, 156, 138, 144, 126, 152, 136, 142];
  const subtitleWidths = [108, 118, 96, 124, 110, 122, 102, 116, 106, 120];
  const safeIndex = Math.max(0, Number(index) || 0);
  const titleWidth = titleWidths[safeIndex % titleWidths.length];
  const subtitleWidth = subtitleWidths[safeIndex % subtitleWidths.length];
  return `
    <article class="home-content-card home-continue-card home-continue-card-loading focusable"
              tabindex="0"
              data-nav-zone="main"
              data-nav-row="0"
              data-nav-col="${index}"
              data-nav-row-key="${escapeAttribute(rowKey)}"
              data-action="continueWatchingLoading"
             data-cw-loading-index="${index}"
              aria-disabled="true">
      <div class="home-continue-media home-continue-media-loading"
           style="--cw-skeleton-title:${titleWidth}px;--cw-skeleton-subtitle:${subtitleWidth}px;">
        <span class="home-continue-badge" aria-hidden="true">${escapeHtml(t("common.loading", {}, "Loading"))}</span>
        <div class="home-continue-copy home-continue-copy-skeleton" aria-hidden="true">
          <div class="home-continue-skeleton-line home-continue-skeleton-kicker"></div>
          <div class="home-continue-skeleton-line home-continue-skeleton-title"></div>
          <div class="home-continue-skeleton-line home-continue-skeleton-subtitle"></div>
        </div>
      </div>
    </article>
  `;
}

export function renderContinueWatchingSection(items = [], options = {}) {
  const loading = Boolean(options?.loading);
  if (!items.length && !loading) {
    return "";
  }
  const rowKey = String(options?.rowKey || "").trim();
  const startIndex = Math.max(0, Number(options?.startIndex || 0));
  const loadingCount = Math.max(1, Math.min(10, Number(options?.loadingCount || items.length || 3)));
  const itemLimit = Math.max(1, Number(options?.itemLimit || items.length || 1));
  const cardStyle = ["card", "wide", "poster"].includes(String(options?.cardStyle || "card")) ? String(options.cardStyle) : "card";
  const renderedItems = getContinueWatchingRenderItems(items, itemLimit);
  // One preference read for the whole section instead of one per card.
  const posterSettings = options?.posterSettings || (renderedItems.length ? LayoutPreferences.get() : null);
  const cardOptions = {
    useEpisodeThumbnails: options?.useEpisodeThumbnails,
    blurNextUp: options?.blurNextUp,
    cardStyle,
    rowKey,
    posterSettings
  };
  return `
    <section class="home-row home-row-continue home-row-continue-${cardStyle}"${rowKey ? ` data-row-key="${escapeAttribute(rowKey)}"` : ""}>
      <div class="home-row-head">
        <h2 class="home-row-title">${escapeHtml(t(options?.titleKey || "home.continueWatching", {}, options?.title || "Continue Watching"))}</h2>
      </div>
      <div class="home-track home-track-continue"${rowKey ? ` data-track-row-key="${escapeAttribute(rowKey)}"` : ""}>
        ${
          renderedItems.length
            ? renderedItems
                .map((item, index) =>
                  renderContinueWatchingCard(item, startIndex + index, {
                    ...cardOptions,
                    navIndex: index
                  })
                )
                .join("")
            : Array.from({ length: loadingCount }, (_, index) => renderContinueWatchingLoadingCard(index, rowKey)).join("")
        }
      </div>
    </section>
  `;
}
