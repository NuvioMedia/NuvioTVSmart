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

import {
  firstNonEmpty,
  toImageUrl,
  normalizeItem,
  buildPlaceholderPosterDataUrl,
  TMDB_API_URL
} from "./folderDetailScreenHelpers-01-tmdb-api-url.js";
import { getTmdbApiKey, getTmdbLanguage, fetchJson } from "./folderDetailScreenHelpers-02-build-fallback-streaming-sources.js";

export function setTmdbDiscoverParam(params, key, value) {
  if (value == null || value === "") {
    return;
  }
  params.set(key, String(value));
}

export function applyTmdbDiscoverFilters(params, filters = {}, mediaType = "movie") {
  const isTv = String(mediaType || "").toLowerCase() === "tv";
  setTmdbDiscoverParam(params, "with_genres", filters.withGenres);
  setTmdbDiscoverParam(params, "without_genres", filters.withoutGenres);
  setTmdbDiscoverParam(params, isTv ? "first_air_date.gte" : "primary_release_date.gte", filters.releaseDateGte);
  setTmdbDiscoverParam(params, isTv ? "first_air_date.lte" : "primary_release_date.lte", filters.releaseDateLte);
  setTmdbDiscoverParam(params, "vote_average.gte", filters.voteAverageGte);
  setTmdbDiscoverParam(params, "vote_average.lte", filters.voteAverageLte);
  setTmdbDiscoverParam(params, "vote_count.gte", filters.voteCountGte);
  setTmdbDiscoverParam(params, "with_original_language", filters.withOriginalLanguage);
  setTmdbDiscoverParam(params, "with_origin_country", filters.withOriginCountry);
  setTmdbDiscoverParam(params, "with_keywords", filters.withKeywords);
  setTmdbDiscoverParam(params, "without_keywords", filters.withoutKeywords);
  setTmdbDiscoverParam(params, "with_companies", filters.withCompanies);
  setTmdbDiscoverParam(params, "without_companies", filters.withoutCompanies);
  if (isTv) {
    setTmdbDiscoverParam(params, "with_networks", filters.withNetworks);
  }
  if (Number.isFinite(Number(filters.year)) && Number(filters.year) > 0) {
    params.set(isTv ? "first_air_date_year" : "year", String(Math.trunc(Number(filters.year))));
  }
  if (filters.withWatchProviders || filters.withoutWatchProviders) {
    setTmdbDiscoverParam(params, "watch_region", filters.watchRegion || "US");
  }
  if (filters.withWatchProviders) {
    setTmdbDiscoverParam(params, "with_watch_providers", filters.withWatchProviders);
    setTmdbDiscoverParam(params, "with_watch_monetization_types", "flatrate|free|ads|rent|buy");
  }
  setTmdbDiscoverParam(params, "without_watch_providers", filters.withoutWatchProviders);
}

export function mapTmdbListItem(item = {}, mediaType = "movie") {
  const type = mediaType === "tv" ? "series" : "movie";
  const title = firstNonEmpty(item.title, item.name, item.original_title, item.original_name);
  if (!item?.id || !title) {
    return null;
  }
  const posterUrl = toImageUrl(item.poster_path || item.posterPath, "poster");
  const backdropUrl = toImageUrl(item.backdrop_path || item.backdropPath, "backdrop");
  return normalizeItem(
    {
      id: `tmdb:${item.id}`,
      type,
      name: title,
      poster: firstNonEmpty(posterUrl, backdropUrl, buildPlaceholderPosterDataUrl()),
      landscapePoster: backdropUrl,
      background: backdropUrl,
      description: firstNonEmpty(item.overview, item.description),
      releaseInfo: String(item.release_date || item.first_air_date || "").slice(0, 4),
      released: item.release_date || item.first_air_date || "",
      releaseDate: item.release_date || item.first_air_date || "",
      rating: typeof item.vote_average === "number" ? item.vote_average : null,
      imdbRating: typeof item.vote_average === "number" ? item.vote_average : null,
      voteCount: typeof item.vote_count === "number" ? item.vote_count : null,
      tmdbId: String(item.id)
    },
    type
  );
}

export function hasTmdbItemId(item = {}) {
  const rawId = firstNonEmpty(item.tmdbId, item.id);
  const normalized = rawId.replace(/^tmdb:/i, "").trim();
  return /^\d+$/.test(normalized) || /^tt\d+$/i.test(normalized);
}

export function buildEnrichedTmdbItem(baseItem = {}, enriched = {}, settings = {}) {
  const useArtwork = settings.useArtwork !== false;
  const useBasicInfo = settings.useBasicInfo !== false;
  return normalizeItem(
    {
      ...baseItem,
      name: useBasicInfo ? firstNonEmpty(enriched.localizedTitle, baseItem.name) : baseItem.name,
      description: useBasicInfo ? firstNonEmpty(enriched.description, baseItem.description) : baseItem.description,
      background: useArtwork ? firstNonEmpty(enriched.backdrop, baseItem.background) : baseItem.background,
      backdrop: useArtwork ? firstNonEmpty(enriched.backdrop, baseItem.backdrop) : baseItem.backdrop,
      landscapePoster: useArtwork ? firstNonEmpty(enriched.backdrop, baseItem.landscapePoster) : baseItem.landscapePoster,
      poster: useArtwork ? firstNonEmpty(enriched.poster, baseItem.poster) : baseItem.poster,
      logo: useArtwork ? enriched.logo : baseItem.logo,
      genres: useBasicInfo && Array.isArray(enriched.genres) && enriched.genres.length ? enriched.genres : baseItem.genres,
      releaseInfo: useBasicInfo ? firstNonEmpty(enriched.releaseInfo, baseItem.releaseInfo) : baseItem.releaseInfo,
      released: useBasicInfo ? firstNonEmpty(enriched.released, baseItem.released) : baseItem.released,
      releaseDate: useBasicInfo ? firstNonEmpty(enriched.released, baseItem.releaseDate) : baseItem.releaseDate,
      runtime: useBasicInfo ? firstNonEmpty(enriched.runtime, baseItem.runtime) : baseItem.runtime,
      rating: useBasicInfo ? (enriched.rating ?? baseItem.rating) : baseItem.rating,
      imdbRating: useBasicInfo ? (enriched.rating ?? baseItem.imdbRating) : baseItem.imdbRating,
      language: useBasicInfo ? firstNonEmpty(enriched.language, baseItem.language) : baseItem.language,
      country: useBasicInfo ? firstNonEmpty(enriched.country, baseItem.country) : baseItem.country
    },
    baseItem.type || baseItem.apiType || "movie"
  );
}

function sortTmdbSourceItems(items = [], sortBy = "") {
  const list = Array.isArray(items) ? [...items] : [];
  if (sortBy === "vote_average.desc") {
    return list.sort(
      (left, right) =>
        Number(right.imdbRating ?? -1) - Number(left.imdbRating ?? -1) ||
        String(right.releaseInfo || "").localeCompare(String(left.releaseInfo || ""))
    );
  }
  if (sortBy === "vote_count.desc") {
    return list.sort(
      (left, right) =>
        Number(right.voteCount ?? -1) - Number(left.voteCount ?? -1) || Number(right.imdbRating ?? -1) - Number(left.imdbRating ?? -1)
    );
  }
  if (sortBy === "primary_release_date.desc" || sortBy === "first_air_date.desc") {
    return list.sort((left, right) => String(right.releaseInfo || "").localeCompare(String(left.releaseInfo || "")));
  }
  return list;
}

export async function fetchTmdbSourceItems(source = {}, page = 1) {
  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    throw new Error("TMDB is not configured");
  }
  const language = getTmdbLanguage();
  const type = String(source.tmdbSourceType || "").toUpperCase();
  const mediaType = type === "NETWORK" || String(source.mediaType || "MOVIE").toUpperCase() === "TV" ? "tv" : "movie";
  if (type === "COLLECTION") {
    const items = await TmdbMetadataService.fetchMovieCollection({
      collectionId: source.tmdbId,
      language
    });
    return {
      items: sortTmdbSourceItems(
        items.map((item) => normalizeItem(item, "movie")).filter((item) => item.id),
        source.sortBy
      ),
      hasMore: false,
      page: 1
    };
  }
  if (type === "LIST") {
    const url = `${TMDB_API_URL}/list/${encodeURIComponent(String(source.tmdbId || ""))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&page=${encodeURIComponent(String(page))}`;
    const { payload } = await fetchJson(url);
    return {
      items: sortTmdbSourceItems(
        (Array.isArray(payload?.items) ? payload.items : [])
          .map((item) => mapTmdbListItem(item, String(item?.media_type || mediaType)))
          .filter(Boolean),
        source.sortBy
      ),
      hasMore: Number(payload?.page || page) < Number(payload?.total_pages || page),
      page: Number(payload?.page || page)
    };
  }
  if (type === "PERSON" || type === "DIRECTOR") {
    const url = `${TMDB_API_URL}/person/${encodeURIComponent(String(source.tmdbId || ""))}/combined_credits?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`;
    const { payload } = await fetchJson(url);
    const sourceItems =
      type === "DIRECTOR"
        ? Array.isArray(payload?.crew)
          ? payload.crew.filter((entry) => String(entry?.job || "").toLowerCase() === "director")
          : []
        : Array.isArray(payload?.cast)
          ? payload.cast
          : [];
    return {
      items: sortTmdbSourceItems(
        sourceItems.map((item) => mapTmdbListItem(item, String(item?.media_type || mediaType))).filter(Boolean),
        source.sortBy
      ),
      hasMore: false,
      page: 1
    };
  }
  const params = new URLSearchParams({
    api_key: apiKey,
    language,
    page: String(page),
    sort_by: String(source.sortBy || (mediaType === "tv" ? "first_air_date.desc" : "popularity.desc"))
  });
  const filters = source.filters && typeof source.filters === "object" ? source.filters : {};
  applyTmdbDiscoverFilters(params, filters, mediaType);
  if (type === "COMPANY" && source.tmdbId) {
    params.set("with_companies", String(source.tmdbId));
  }
  if (type === "NETWORK" && source.tmdbId) {
    params.set("with_networks", String(source.tmdbId));
    params.set("first_air_date.lte", filters.releaseDateLte || new Date().toISOString().slice(0, 10));
    params.set("with_status", "0|3|4");
  }
  const url = `${TMDB_API_URL}/discover/${mediaType}?${params.toString()}`;
  const { payload } = await fetchJson(url);
  return {
    items: (Array.isArray(payload?.results) ? payload.results : []).map((item) => mapTmdbListItem(item, mediaType)).filter(Boolean),
    hasMore: Number(payload?.page || page) < Number(payload?.total_pages || page),
    page: Number(payload?.page || page)
  };
}

export function buildTraktHeaders() {
  const clientId = String(TRAKT_CLIENT_ID || "").trim();
  if (!clientId) {
    throw new Error("Trakt is not configured");
  }
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId
  };
}
