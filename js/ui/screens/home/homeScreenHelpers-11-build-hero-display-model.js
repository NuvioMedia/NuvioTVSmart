import { continueWatchingRating } from "./continueWatchingRating.js";
import { renderHeroMdbListRatings } from "./homeMdbListRatings.js";
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

import { buildModernRowKey, MODERN_HOME_CONSTANTS, renderModernHeroBadges, renderModernHomeLayout } from "./modernHomeLayout.js";

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

import { isCollectionFolderItem } from "./homeScreenHelpers-04-animate-hero-logo-swap.js";
import { normalizeCollectionFolderItem } from "./homeScreenHelpers-05-normalize-collection-folder-item.js";
import { extractYear, resolveImdbRating } from "./homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js";
import { hideHomeHeroRatings } from "./homeScreenHelpers-10-get-cached-continue-watching-enrichment.js";
import { formatRuntimeText, extractReleaseDateText } from "./homeScreenHelpers-02-extract-release-date-text.js";
import { normalizeContinueWatchingItem } from "./homeScreenHelpers-09-normalize-continue-watching-item.js";
import { normalizeCatalogItem } from "./homeScreenHelpers-08-partition-continue-watching-rows.js";

export function buildHeroDisplayModel(hero, layoutMode) {
  if (isCollectionFolderItem(hero)) {
    const normalized = normalizeCollectionFolderItem(hero);
    return {
      title: normalized?.heroTitle || normalized?.name || normalized?.collectionTitle || "Untitled",
      description: " ",
      logo: firstNonEmpty(normalized?.titleLogoUrl, normalized?.logo),
      backdrop: firstNonEmpty(normalized?.heroBackdropUrl, normalized?.background, normalized?.backdrop, normalized?.poster),
      backdropFallbacks: buildHeroBackdropSources(normalized).slice(1),
      metaPrimary: [],
      metaSecondary: [],
      chips: []
    };
  }
  const year = extractYear(hero);
  const mdbListMarkup = renderHeroMdbListRatings(hero, layoutMode);
  const imdb =
    mdbListMarkup || hideHomeHeroRatings()
      ? null
      : hero?.heroSource === "continueWatching"
        ? continueWatchingRating(hero, LayoutPreferences.get().detailImdbRatingsVisibility)
        : resolveImdbRating(hero);
  const genres = Array.isArray(hero?.genres) ? hero.genres.filter(Boolean).slice(0, 3).map(localizedGenreLabel) : [];
  const typeLabel = formatContentTypeLabel(hero?.type || hero?.apiType || "movie", "movie");
  const isContinueWatchingHero = hero?.heroSource === "continueWatching";
  const metaPrimary = [];
  const metaSecondary = [];
  let chips = [];

  if (layoutMode === "modern") {
    if (isContinueWatchingHero) {
      const episodeLabel = [hero?.episodeCode, hero?.episodeTitle].filter(Boolean).join(" · ");
      metaPrimary.push(episodeLabel || typeLabel, genres[0], year);
      metaSecondary.push(String(hero?.progressStatus || "").toUpperCase());
      if (imdb) {
        metaSecondary.push({ imdb });
      }
    } else {
      metaPrimary.push(typeLabel, genres[0], formatRuntimeText(hero), year);
      if (imdb) {
        metaSecondary.push({ imdb });
      }
      chips = [];
    }
  } else {
    if (imdb) {
      metaPrimary.push({ imdb });
    }
    if (year) {
      metaPrimary.push(year);
    }
    chips = genres;
  }

  return {
    mdbListMarkup,
    title: hero?.name || "Untitled",
    description: firstNonEmpty(hero?.description) || " ",
    logo: firstNonEmpty(hero?.logo),
    backdrop: buildHeroBackdropSources(hero)[0] || "",
    backdropFallbacks: buildHeroBackdropSources(hero).slice(1),
    metaPrimary: metaPrimary.filter(Boolean),
    metaSecondary: metaSecondary.filter(Boolean),
    chips
  };
}

export function buildModernHeroPresentation(hero) {
  if (isCollectionFolderItem(hero)) {
    const normalizedCollection = normalizeCollectionFolderItem(hero);
    if (!normalizedCollection) {
      return null;
    }
    return {
      title: normalizedCollection.heroTitle || normalizedCollection.name || normalizedCollection.rawTitle || "",
      logo: firstNonEmpty(normalizedCollection.titleLogoUrl, normalizedCollection.logo),
      description: "",
      backdrop: buildHeroBackdropSources(normalizedCollection)[0] || "",
      backdropFallbacks: buildHeroBackdropSources(normalizedCollection).slice(1),
      leadingMeta: [],
      trailingMeta: [],
      secondaryHighlightText: "",
      badges: [],
      languageText: "",
      showImdbPrimary: false,
      showImdbSecondary: false,
      imdbText: ""
    };
  }
  const isContinueWatchingHero = hero?.heroSource === "continueWatching";
  const normalized = isContinueWatchingHero ? normalizeContinueWatchingItem(hero) : normalizeCatalogItem(hero);
  if (!normalized) {
    return null;
  }

  const isSeries = String(normalized.type || normalized.apiType || "").toLowerCase() === "series";
  const genres = Array.isArray(normalized.genres) ? normalized.genres.filter(Boolean).map(localizedGenreLabel) : [];
  const contentTypeText = formatContentTypeLabel(normalized.type || normalized.apiType || "movie", "movie");
  const runtimeText = formatRuntimeText(normalized);
  const yearText = extractReleaseDateText(normalized);
  const mdbListMarkup = renderHeroMdbListRatings(normalized, "modern");
  const imdbText =
    mdbListMarkup || hideHomeHeroRatings()
      ? ""
      : isContinueWatchingHero
        ? continueWatchingRating(normalized, LayoutPreferences.get().detailImdbRatingsVisibility)
        : resolveImdbRating(normalized);
  const rawStatus = firstNonEmpty(normalized.status);
  const statusKeys = {
    ended: "ended",
    continuing: "continuing",
    "returning series": "continuing",
    current: "current",
    cancelled: "cancelled",
    canceled: "cancelled",
    released: "released",
    planned: "planned",
    rumored: "rumored",
    "in production": "in_production",
    "post production": "post_production"
  };
  const statusKey = statusKeys[rawStatus.toLowerCase()];
  const statusBadge = (
    statusKey ? I18n.t(`${isSeries ? "series" : "movie"}_status_${statusKey}`, {}, { fallback: rawStatus }) : rawStatus
  ).toUpperCase();
  const ageRatingBadge = firstNonEmpty(normalized.ageRating);
  const languageText = firstNonEmpty(normalized.language).toUpperCase();
  const secondaryHighlightText = isContinueWatchingHero ? firstNonEmpty(normalized.progressStatus).toUpperCase() : "";
  const episodeLabel =
    isSeries && isContinueWatchingHero ? [normalized.episodeCode, normalized.episodeTitle].filter(Boolean).join(" · ") : "";
  const leadingMeta = [episodeLabel || contentTypeText, genres[0]].filter(Boolean);
  const trailingMeta = isContinueWatchingHero ? [yearText].filter(Boolean) : [runtimeText, yearText].filter(Boolean);
  const badges = isContinueWatchingHero ? [] : [ageRatingBadge, statusBadge].filter(Boolean);
  const showImdbPrimary = Boolean(imdbText) && !isSeries && !badges.length && !secondaryHighlightText;
  const showImdbSecondary = Boolean(imdbText) && !showImdbPrimary;

  return {
    mdbListMarkup,
    title: normalized.name || "Untitled",
    logo: firstNonEmpty(normalized.logo),
    description: firstNonEmpty(isContinueWatchingHero ? normalized.episodeDescription : null, normalized.description) || "",
    backdrop: buildHeroBackdropSources(normalized)[0] || "",
    backdropFallbacks: buildHeroBackdropSources(normalized).slice(1),
    leadingMeta,
    trailingMeta,
    secondaryHighlightText,
    badges,
    languageText,
    showImdbPrimary,
    showImdbSecondary,
    imdbText
  };
}

export function renderModernHeroMetaGroup(tokens = []) {
  return tokens
    .filter(Boolean)
    .map((token) => `<span>${escapeHtml(token)}</span>`)
    .join('<span class="home-hero-dot">•</span>');
}

export function renderModernHeroPrimary(display) {
  const left = escapeHtml(display.leadingMeta.filter(Boolean).join(" • "));
  const rightTokens = display.trailingMeta.filter(Boolean).map((token) => `<span>${escapeHtml(token)}</span>`);
  if (display.showImdbPrimary) {
    rightTokens.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  const hasRight = rightTokens.length > 0;
  return `
    <div class="home-modern-hero-meta-group home-modern-hero-meta-group-leading">${left}</div>
    ${left && hasRight ? '<span class="home-hero-dot">•</span>' : ""}
    <div class="home-modern-hero-meta-group home-modern-hero-meta-group-trailing">${rightTokens.join('<span class="home-hero-dot">•</span>')}</div>
  `;
}

export function renderModernHeroSecondary(display) {
  const parts = [];
  if (display.secondaryHighlightText) {
    parts.push(`<span class="home-modern-hero-highlight">${escapeHtml(display.secondaryHighlightText)}</span>`);
  }
  if (display.badges.length) {
    parts.push(renderModernHeroBadges(display.badges, escapeHtml));
  }
  if (display.showImdbSecondary) {
    parts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  if (display.languageText) {
    parts.push(`<span class="home-modern-hero-secondary-detail">${escapeHtml(display.languageText)}</span>`);
  }
  if (display.mdbListMarkup) parts.push(display.mdbListMarkup);
  return parts.join('<span class="home-hero-dot">•</span>');
}

export function renderMetaTokens(tokens = []) {
  return tokens
    .map((token) => {
      if (token && typeof token === "object" && token.imdb) {
        return `
        <span class="home-hero-imdb">
          <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
          <span>${escapeHtml(token.imdb)}</span>
        </span>
      `;
      }
      return `<span>${escapeHtml(token)}</span>`;
    })
    .join('<span class="home-hero-dot">•</span>');
}
