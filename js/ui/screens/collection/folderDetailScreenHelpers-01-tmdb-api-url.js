import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { Environment } from "../../../platform/environment.js";

import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { addonRepository } from "../../../data/repository/addonRepository.js";

import { catalogRepository } from "../../../data/repository/catalogRepository.js";

import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

import { CollectionsStore } from "../../../data/local/collectionsStore.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { TmdbService } from "../../../core/tmdb/tmdbService.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

import { catalogSkipStep, catalogSupportsExtra } from "../../../core/addons/homeCatalogs.js";

import { toTraktImageUrl } from "../../../core/trakt/traktImageUrl.js";

import { TMDB_API_KEY, TRAKT_API_URL, TRAKT_CLIENT_ID } from "../../../config.js";

import {
  HomeScreen,
  buildModernHomeSizingStyle,
  buildModernHeroPresentation,
  createPosterCardMarkup,
  createSeeAllCardMarkup,
  escapeAttribute,
  escapeHtml,
  formatCatalogRowTitle,
  normalizeCollectionFolderItem,
  renderContinueWatchingSection
} from "../home/homeScreen.js";

import { renderModernHomeLayout } from "../home/modernHomeLayout.js";

import { buildWatchedTitleIdSet, isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

export const TMDB_API_URL = "https://api.themoviedb.org/3";

export const TMDB_POSTER_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w342";

export const TMDB_BACKDROP_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w1280";

export const TRAKT_PAGE_SIZE = 50;

export const FOLDER_LOADING_ROW_ITEM_COUNT = 6;

export const FOLDER_SOURCE_RENDER_BATCH_MS = 180;

export const STREAMING_NETWORK_PRESETS = new Map([
  ["netflix", { title: "Netflix", tmdbId: 213 }],
  ["hbo", { title: "HBO", tmdbId: 49 }],
  ["max", { title: "HBO", tmdbId: 49 }],
  ["disney", { title: "Disney+", tmdbId: 2739 }],
  ["disney+", { title: "Disney+", tmdbId: 2739 }],
  ["prime video", { title: "Prime Video", tmdbId: 1024 }],
  ["amazon prime video", { title: "Prime Video", tmdbId: 1024 }],
  ["hulu", { title: "Hulu", tmdbId: 453 }],
  ["apple tv", { title: "Apple TV+", tmdbId: 2552 }],
  ["apple tv+", { title: "Apple TV+", tmdbId: 2552 }],
  ["paramount+", { title: "Paramount+", tmdbId: 4330 }],
  ["paramount plus", { title: "Paramount+", tmdbId: 4330 }],
  ["starz", { title: "Starz", tmdbId: 318 }]
]);

export function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

export function escapeFolderHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function normalizeTraktImageCandidate(value) {
  if (typeof value === "string") {
    return toTraktImageUrl(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeTraktImageCandidate).find(Boolean) || "";
  }
  if (value && typeof value === "object") {
    return [value.full, value.medium, value.thumb].map(normalizeTraktImageCandidate).find(Boolean) || "";
  }
  return "";
}

export function bestTraktImage(images = {}, ...kinds) {
  return kinds.map((kind) => normalizeTraktImageCandidate(images?.[kind])).find(Boolean) || "";
}

export function folderPosterLoadingMode() {
  return getTvRuntimePerformanceProfile().isPerformanceConstrained ? "eager" : "lazy";
}

export function toImageUrl(path, kind = "poster") {
  if (!path) {
    return "";
  }
  const normalizedPath = String(path);
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }
  const baseUrl = kind === "backdrop" ? TMDB_BACKDROP_IMAGE_BASE_URL : TMDB_POSTER_IMAGE_BASE_URL;
  return `${baseUrl}${normalizedPath}`;
}

export function buildPlaceholderPosterDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2430" stop-opacity="0.92"/><stop offset="1" stop-color="#1f2430" stop-opacity="0.98"/></linearGradient></defs><rect width="500" height="750" fill="url(#g)"/><circle cx="250" cy="375" r="46" fill="none" stroke="#9ca3af" stroke-opacity="0.28" stroke-width="4"/><circle cx="250" cy="375" r="42" fill="#ffffff" fill-opacity="0.92" stroke="#9ca3af" stroke-opacity="0.18" stroke-width="3"/><path d="M240 352 L240 398 L278 375 Z" fill="#1f2430" fill-opacity="0.8"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function normalizeItem(item = {}, fallbackType = "movie") {
  const source = item && typeof item === "object" ? item : {};
  const rawType = String(source.type || source.apiType || fallbackType || "movie")
    .trim()
    .toLowerCase();
  const type = rawType || "movie";
  const runtimeValue = source.runtimeMinutes ?? source.runtime ?? source.durationMinutes ?? source.duration_minutes ?? 0;
  return {
    ...source,
    id: String(source.id || "").trim(),
    type,
    apiType: type,
    name: firstNonEmpty(source.name, source.title, source.id),
    poster: firstNonEmpty(source.poster, source.thumbnail, source.background, source.backdrop, source.backdropUrl, source.landscapePoster),
    landscapePoster: firstNonEmpty(source.landscapePoster, source.backdrop, source.backdropUrl, source.background),
    backdrop: firstNonEmpty(source.backdrop, source.backdropUrl, source.background, source.landscapePoster),
    background: firstNonEmpty(source.background, source.backdrop, source.backdropUrl, source.landscapePoster, source.poster),
    releaseInfo: firstNonEmpty(source.releaseInfo, source.released, source.releaseDate, source.release_date, source.year),
    released: firstNonEmpty(source.released, source.releaseDate, source.release_date),
    releaseDate: firstNonEmpty(source.releaseDate, source.release_date, source.released),
    logo: firstNonEmpty(source.logo),
    description: firstNonEmpty(source.description, source.overview, source.plot),
    genres: Array.isArray(source.genres) ? source.genres.filter(Boolean) : [],
    runtimeMinutes: Number(runtimeValue) || runtimeValue || 0,
    imdbRating: source.imdbRating ?? source.imdb_rating ?? source.rating ?? null,
    rating: source.rating ?? source.imdbRating ?? source.imdb_rating ?? null,
    ageRating: firstNonEmpty(source.ageRating, source.age_rating),
    status: firstNonEmpty(source.status),
    language: firstNonEmpty(source.language),
    country: firstNonEmpty(source.country),
    tmdbId: firstNonEmpty(source.tmdbId, String(source.id || "").replace(/^tmdb:/i, ""))
  };
}

export function buildHeroDisplay(item = null) {
  const normalized = normalizeItem(item || null);
  if (!normalized?.id) {
    return null;
  }
  const typeLabel = normalized.type === "series" ? "Series" : normalized.type === "tv" ? "TV" : "Movie";
  const year = firstNonEmpty(normalized.releaseInfo);
  return {
    title: normalized.name || "Untitled",
    description: firstNonEmpty(normalized.description) || " ",
    logo: firstNonEmpty(normalized.logo),
    backdrop: firstNonEmpty(normalized.background, normalized.poster),
    meta: [typeLabel, year].filter(Boolean)
  };
}

export function buildFolderHeroSeed(folder = null) {
  if (!folder) {
    return null;
  }
  return {
    id: `folder:${String(folder.id || "")}`,
    type: "series",
    name: firstNonEmpty(folder.title, "Collection"),
    poster: firstNonEmpty(folder.coverImageUrl),
    background: firstNonEmpty(folder.heroBackdropUrl, folder.coverImageUrl),
    logo: firstNonEmpty(folder.titleLogoUrl),
    description: "",
    releaseInfo: ""
  };
}

export function sourceType(source = {}) {
  const mediaType = String(source.mediaType || "")
    .trim()
    .toUpperCase();
  // TMDB/Trakt sources use mediaType TV for shows, while an add-on source's
  // own type is already the content type ("tv" is its live channel type).
  if (mediaType === "TV" || mediaType === "SERIES") {
    return "series";
  }
  const rawType = String(source.type || source.apiType || "movie")
    .trim()
    .toLowerCase();
  return rawType || "movie";
}

export function buildFolderSourceRows(tabs = []) {
  return tabs
    .filter((tab) => !tab.isAllTab)
    .map((tab, index) => {
      const sourceTabIndex = tabs.indexOf(tab);
      const type = sourceType(tab.source || {});
      const rowKey = tab.key || `folder_source_${index}`;
      return {
        homeCatalogKey: rowKey,
        folderTabIndex: sourceTabIndex >= 0 ? sourceTabIndex : index,
        addonId: tab.source?.addonId || tab.source?.provider || "collection",
        addonBaseUrl: tab.source?.addonBaseUrl || "",
        addonName: tab.source?.addonName || tab.source?.provider || "Collection",
        catalogId: tab.source?.catalogId || tab.source?.tmdbId || tab.source?.traktListId || tab.key || `source_${index}`,
        catalogName: tab.label || tab.source?.catalogName || tab.source?.title || "Collection",
        type,
        result: {
          status: tab.loading ? "loading" : tab.error ? "error" : "success",
          data: {
            items: Array.isArray(tab.items) ? tab.items : [],
            hasMore: Boolean(tab.hasMore),
            supportsSkip: tab.supportsSkip !== false,
            skipStep: Number(tab.skipStep || 100),
            currentPage: Math.max(0, Number(tab.page || 1) - 1),
            nextSkip: Math.max(0, Number(tab.nextSkip || 0))
          }
        },
        loadingItems: tab.loading
          ? Array.from({ length: FOLDER_LOADING_ROW_ITEM_COUNT }, (_, loadingIndex) => ({
              id: `${rowKey}__loading_${loadingIndex}`,
              name: "Loading",
              isLoading: true
            }))
          : null,
        suppressPosterText: true
      };
    });
}

export function normalizePresetKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
