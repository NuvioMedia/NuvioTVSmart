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

import { resolveYoutubeId, buildYoutubeEmbedUrl } from "./homeScreenHelpers-05-normalize-collection-folder-item.js";
import { parseRuntimeMinutes } from "./homeScreenHelpers-04-animate-hero-logo-swap.js";

export function resolveTrailerSource(meta = {}) {
  const trailerCandidates = [...(Array.isArray(meta?.trailers) ? meta.trailers : []), ...(Array.isArray(meta?.videos) ? meta.videos : [])];
  for (const entry of trailerCandidates) {
    const ytId = resolveYoutubeId(entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || "");
    if (ytId) {
      const embedUrl = buildYoutubeEmbedUrl(ytId);
      if (!embedUrl) {
        continue;
      }
      return {
        kind: "youtube",
        ytId,
        embedUrl
      };
    }
  }
  const fallbackId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!fallbackId) {
    return null;
  }
  const fallbackEmbedUrl = buildYoutubeEmbedUrl(fallbackId);
  if (!fallbackEmbedUrl) {
    return null;
  }
  return {
    kind: "youtube",
    ytId: fallbackId,
    embedUrl: fallbackEmbedUrl
  };
}

export function applyTrailerAudioPreferences(source, prefs = {}) {
  if (!source) {
    return null;
  }
  const muted = Boolean(prefs.focusedPosterBackdropTrailerMuted);
  if (source.kind === "youtube") {
    const embedUrl = buildYoutubeEmbedUrl(source.ytId, { muted });
    if (!embedUrl) {
      return null;
    }
    return {
      ...source,
      embedUrl,
      muted
    };
  }
  if (source.kind === "video") {
    return {
      ...source,
      muted
    };
  }
  return source;
}

export function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function fetchModernHeroTmdbEnrichment(hero = {}, itemType = "movie") {
  const settings = TmdbSettingsStore.get();
  if (!settings.enabled || !settings.modernHomeEnabled || !TMDB_API_KEY || !hero?.id) {
    return null;
  }
  try {
    const tmdbId = await withTimeout(TmdbService.ensureTmdbId(hero.id, itemType), 1800, null);
    if (!tmdbId) {
      return null;
    }
    return await withTimeout(
      TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: itemType,
        language: settings.language,
        includeCredits: false
      }),
      2200,
      null
    );
  } catch (_) {
    return null;
  }
}

export async function resolveTrailerMetaWithTmdbFallback(meta = {}, itemType = "movie") {
  const fallbackSource = resolveTrailerSource(meta);
  const settings = TmdbSettingsStore.get();
  if (!settings.enabled || !settings.useTrailers || !TMDB_API_KEY) {
    return fallbackSource;
  }
  try {
    const tmdbId = await withTimeout(TmdbService.ensureTmdbId(meta?.id, itemType), 1800, null);
    if (!tmdbId) {
      return fallbackSource;
    }
    const trailers = await withTimeout(
      TmdbMetadataService.fetchTrailerCandidates({
        tmdbId,
        contentType: itemType,
        language: settings.language
      }),
      2200,
      []
    );
    const tmdbSource = resolveTrailerSource({ trailers });
    return tmdbSource || fallbackSource;
  } catch (_) {
    return fallbackSource;
  }
}

export function getContinueWatchingMetaTimeout(timeoutMs) {
  const requestedTimeout = Math.max(500, Number(timeoutMs || 0) || CW_META_TIMEOUT_MS);
  if (getTvRuntimePerformanceProfile().isPerformanceConstrained) {
    return Math.max(requestedTimeout, CW_META_TIMEOUT_TV_MS);
  }
  return requestedTimeout;
}

export function progressFractionForContinueWatching(item = {}) {
  const explicitPercent = Number(item.progressPercent);
  if (Number.isFinite(explicitPercent) && explicitPercent > 0) {
    return Math.max(0, Math.min(1, explicitPercent / 100));
  }
  const durationMs = Number(item.durationMs || 0);
  const positionMs = Number(item.positionMs || 0);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(positionMs) || positionMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, positionMs / durationMs));
}

export function isSeriesTypeForContinueWatching(type) {
  const normalized = String(type || "").toLowerCase();
  return ["series", "tv", "anime"].includes(normalized);
}

export function isPosterWatchedType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "movie" || isSeriesTypeForContinueWatching(normalized);
}

export function isCompletedForContinueWatching(item = {}) {
  return progressFractionForContinueWatching(item) >= watchProgressCompletedThreshold(item);
}

export function isInProgressForContinueWatching(item = {}) {
  if (isCompletedForContinueWatching(item)) {
    return false;
  }
  // Android/mobile rule: any saved progress counts, with no 2% start threshold.
  return Number(item.positionMs || 0) > 0 || Number(item.progressPercent || 0) > 0;
}

export function shouldTreatAsInProgressForContinueWatching(item = {}) {
  return isInProgressForContinueWatching(item);
}

export function episodeKey(season, episode) {
  return `${Number(season || 0)}:${Number(episode || 0)}`;
}

export function episodeSortKey(season, episode) {
  return Number(season || 0) * 1000 + Number(episode || 0);
}

export function normalizeEpisodeEntry(video = {}) {
  return {
    id: String(video?.id || "").trim(),
    season: Number(video?.season ?? video?.seasonNumber ?? 0),
    episode: Number(video?.episode ?? video?.episodeNumber ?? 0),
    title: String(video?.title || video?.name || "").trim(),
    thumbnail: firstNonEmpty(video?.thumbnail, video?.thumbnailUrl, video?.still, video?.stillUrl, video?.image, video?.poster),
    overview: firstNonEmpty(video?.overview, video?.description),
    imdbRating: video?.imdbRating ?? video?.imdb_rating ?? video?.rating ?? null,
    released: firstNonEmpty(video?.released, video?.releaseInfo),
    runtimeMinutes: parseRuntimeMinutes(video?.runtimeMinutes ?? video?.runtime ?? 0),
    available: typeof video?.available === "boolean" ? video.available : null
  };
}

export function normalizeEpisodeEntries(videos = []) {
  return (Array.isArray(videos) ? videos : [])
    .map((video) => normalizeEpisodeEntry(video))
    .filter((entry) => entry.season > 0 && entry.episode > 0)
    .sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
}

export function mapAbsoluteEpisodeKey(episodes, key) {
  const [season, episode] = String(key || "")
    .split(":")
    .map(Number);
  if (season !== 1 || episode <= 0) {
    return null;
  }
  const index = findAbsoluteEpisodeAnchorIndex(episodes, { season, episode });
  const target = index >= 0 ? episodes[index] : null;
  return target ? episodeKey(target.season, target.episode) : null;
}
