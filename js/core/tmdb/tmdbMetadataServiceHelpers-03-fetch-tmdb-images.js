import { normalizeTmdbLanguageCode, TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

import { TMDB_API_KEY } from "../../config.js";

import { tmdbShowReleaseInfo, tmdbYearPart } from "../util/tmdbReleaseRange.js";

import { sortCollectionPartsByReleaseDate } from "./tmdbCollectionOrdering.js";

import { TMDB_BASE_URL, TMDB_TRAILER_FALLBACK_LANGUAGE } from "./tmdbMetadataServiceHelpers-01-tmdb-base-url.js";
import {
  normalizeTmdbTrailerLanguage,
  rankTmdbVideoCandidates,
  fetchTmdbVideos,
  toImageUrl
} from "./tmdbMetadataServiceHelpers-02-resolve-credit-entries.js";

export async function fetchTmdbImages({ type, tmdbId, apiKey, includeImageLanguage }) {
  const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}/images?api_key=${encodeURIComponent(apiKey)}&include_image_language=${encodeURIComponent(includeImageLanguage)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_error) {
    return null;
  }
}

export async function resolveTrailerCandidates({ type, tmdbId, apiKey, language, initialResults = null }) {
  const preferredLanguage = normalizeTmdbTrailerLanguage(language);
  // Like Android's TrailerService: query the preferred language first and fall
  // back to English only when it has nothing. Callers without an enrichment
  // response (Home hero, detail trailer button) used to skip straight to en-US.
  const localizedResults = Array.isArray(initialResults)
    ? initialResults
    : await fetchTmdbVideos({ type, tmdbId, apiKey, language: preferredLanguage });
  const preferred = rankTmdbVideoCandidates(localizedResults, preferredLanguage);
  if (preferred.length || preferredLanguage === TMDB_TRAILER_FALLBACK_LANGUAGE) {
    return preferred;
  }
  const fallback = await fetchTmdbVideos({
    type,
    tmdbId,
    apiKey,
    language: TMDB_TRAILER_FALLBACK_LANGUAGE
  });
  return rankTmdbVideoCandidates(fallback, TMDB_TRAILER_FALLBACK_LANGUAGE);
}

export async function fetchTmdbShowDetails({ tmdbId, apiKey, language }) {
  const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_error) {
    return null;
  }
}

export async function resolveRecommendationReleaseInfo(item, { type, apiKey, language }) {
  if (type !== "tv") {
    return String(item?.release_date || "").slice(0, 4) || "";
  }

  const startYear = tmdbYearPart(item?.first_air_date);
  if (startYear == null) {
    return "";
  }

  const details = await fetchTmdbShowDetails({
    tmdbId: item?.id,
    apiKey,
    language
  });
  return tmdbShowReleaseInfo(item?.first_air_date, details?.last_air_date, details?.status) || "";
}

export function mapTrailerCandidates(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => {
      const key = String(entry?.key || "").trim();
      return {
        ytId: key,
        youtubeId: key,
        source: key ? `https://www.youtube.com/watch?v=${key}` : "",
        type: entry?.type || "Trailer",
        name: entry?.name || "Trailer",
        official: Boolean(entry?.official),
        publishedAt: entry?.published_at || "",
        size: Number(entry?.size || 0) || 0
      };
    })
    .filter((entry) => entry.ytId);
}

export function mapCompanies(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((company) => {
      const rawId = company?.id ?? company?.tmdbId ?? company?.tmdb_id ?? null;
      const numericId = Number(rawId);
      return {
        name: company?.name || "",
        logo: toImageUrl(company?.logo_path || company?.logo || null, "logo"),
        tmdbId: Number.isInteger(numericId) && numericId > 0 ? numericId : null
      };
    })
    .filter((company) => company.name || company.logo);
}

export function selectAgeRating(data = {}, type = "movie") {
  if (type === "tv") {
    const ratings = Array.isArray(data?.content_ratings?.results) ? data.content_ratings.results : [];
    const preferred =
      ratings.find((item) => String(item?.iso_3166_1 || "").toUpperCase() === "US") ||
      ratings.find((item) => String(item?.rating || "").trim());
    return String(preferred?.rating || "").trim() || null;
  }
  const releases = Array.isArray(data?.release_dates?.results) ? data.release_dates.results : [];
  const preferred =
    releases.find((item) => String(item?.iso_3166_1 || "").toUpperCase() === "US") ||
    releases.find((item) => Array.isArray(item?.release_dates) && item.release_dates.length);
  const certification = (Array.isArray(preferred?.release_dates) ? preferred.release_dates : [])
    .map((entry) => String(entry?.certification || "").trim())
    .find(Boolean);
  return certification || null;
}

export function normalizeEntityKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "network"
    ? "network"
    : "company";
}

export function normalizeEntityId(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? normalized : "";
}

export function normalizeEntitySourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "movie" ? "movie" : "tv";
}

export function buildEntityMediaOrder(entityKind, sourceType) {
  if (entityKind === "network") {
    return ["tv"];
  }
  return normalizeEntitySourceType(sourceType) === "movie" ? ["movie", "tv"] : ["tv", "movie"];
}

export function entitySortBy(mediaType, railType) {
  if (railType === "top_rated") {
    return "vote_average.desc";
  }
  if (railType === "recent") {
    return mediaType === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
  }
  return "popularity.desc";
}

export function mapEntityDiscoverResult(result = {}, mediaType = "movie") {
  const title = result?.title || result?.name || result?.original_title || result?.original_name || "";
  const numericId = Number(result?.id);
  if (!title || !Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const poster = toImageUrl(result?.poster_path || null, "entityPoster") || toImageUrl(result?.backdrop_path || null, "entityBackdrop");
  if (!poster) {
    return null;
  }

  const releaseDate = mediaType === "tv" ? result?.first_air_date : result?.release_date;
  const background = toImageUrl(result?.backdrop_path || null, "backdrop");
  const rating = Number(result?.vote_average);
  return {
    id: `tmdb:${numericId}`,
    type: mediaType === "tv" ? "series" : "movie",
    name: title,
    poster,
    background,
    backdrop: background,
    landscapePoster: background,
    description: result?.overview || "",
    releaseInfo: String(releaseDate || "").slice(0, 4),
    tmdbRating: Number.isFinite(rating) ? Number(rating.toFixed(1)) : null
  };
}

export function fallbackEntityHeader(entityKind, entityId, fallbackName = "") {
  return {
    id: Number(entityId),
    kind: entityKind,
    name: String(fallbackName || "").trim() || "Unknown",
    logo: null,
    originCountry: null,
    secondaryLabel: null,
    description: null
  };
}
