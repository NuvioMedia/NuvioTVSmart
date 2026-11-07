/* eslint-disable no-unused-vars */
import * as internals from "./tmdbMetadataService.js";
import { fetchTmdbJson } from "./tmdbService.js";
import { mapWithConcurrency } from "../network/mapWithConcurrency.js";

export function createTmdbMetadataServiceMethods02() {
  const {
    normalizeTmdbLanguageCode,
    TmdbSettingsStore,
    TMDB_API_KEY,
    sortCollectionPartsByReleaseDate,
    TMDB_BASE_URL,
    TMDB_RECOMMENDATION_MAX_ITEMS,
    moreLikeThisCache,
    resolveType,
    languageBase,
    normalizeMoreLikeThisLanguage,
    toImageUrl,
    selectBestLocalizedImagePath,
    fetchTmdbImages,
    resolveRecommendationReleaseInfo
  } = internals;

  return {
    async fetchEpisodeEnrichment({ tmdbId, seasonNumbers = [], language = null } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!settings.enabled || !settings.useEpisodes || !apiKey || !tmdbId) {
        return new Map();
      }

      const lang = normalizeTmdbLanguageCode(language || settings.language);
      const seasons = [
        ...new Set(
          (Array.isArray(seasonNumbers) ? seasonNumbers : [])
            .map((season) => Number(season))
            .filter((season) => Number.isFinite(season) && season >= 0)
        )
      ];
      if (!seasons.length) {
        return new Map();
      }

      const entries = await mapWithConcurrency(seasons, 4, async (seasonNumber) => {
        try {
          const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
          const data = await fetchTmdbJson(url);
          if (!data) {
            return [];
          }
          return (Array.isArray(data?.episodes) ? data.episodes : [])
            .map((episode) => ({
              key: `${seasonNumber}:${Number(episode?.episode_number || 0)}`,
              title: episode?.name || "",
              overview: episode?.overview || "",
              airDate: episode?.air_date || "",
              thumbnail: toImageUrl(episode?.still_path || null, "still"),
              runtime: Number(episode?.runtime || 0) || null
            }))
            .filter((episode) => !episode.key.endsWith(":0"));
        } catch (error) {
          console.warn(`TMDB season ${seasonNumber} enrichment failed`, error);
          return [];
        }
      });

      const map = new Map();
      entries.flat().forEach((episode) => {
        map.set(episode.key, episode);
      });
      return map;
    },
    async fetchMovieCollection({ collectionId, language = null } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!settings.enabled || !apiKey || !collectionId) {
        return [];
      }

      const lang = normalizeTmdbLanguageCode(language || settings.language);
      const url = `${TMDB_BASE_URL}/collection/${encodeURIComponent(String(collectionId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return sortCollectionPartsByReleaseDate(data?.parts)
        .map((item) => ({
          id: item?.id ? `tmdb:${String(item.id)}` : "",
          type: "movie",
          name: item?.title || item?.name || "Untitled",
          poster: toImageUrl(item?.poster_path || null, "poster"),
          background: toImageUrl(item?.backdrop_path || null, "backdrop"),
          landscapePoster: toImageUrl(item?.backdrop_path || null, "backdrop"),
          releaseInfo: String(item?.release_date || "").slice(0, 4) || "",
          rating: typeof item?.vote_average === "number" ? item.vote_average : null,
          imdbRating: typeof item?.vote_average === "number" ? item.vote_average : null,
          voteCount: typeof item?.vote_count === "number" ? item.vote_count : null
        }))
        .filter((item) => item.id);
    },
    async fetchMoreLikeThis({ tmdbId, contentType, language = null, maxItems = TMDB_RECOMMENDATION_MAX_ITEMS } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      const numericId = String(tmdbId || "").trim();
      if (!settings.enabled || !settings.useMoreLikeThis || !apiKey || !/^\d+$/.test(numericId)) {
        return [];
      }

      const type = resolveType(contentType);
      const normalizedLanguage = normalizeMoreLikeThisLanguage(language || settings.language);
      const itemLimit = Math.max(1, Number(maxItems) || 1);
      const cacheKey = `${numericId}:${type}:${normalizedLanguage}:more_like:${itemLimit}`;
      if (moreLikeThisCache.has(cacheKey)) {
        return moreLikeThisCache.get(cacheKey);
      }

      const includeImageLanguage = [languageBase(normalizedLanguage), normalizedLanguage, "en", "null"].join(",");
      const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(numericId)}/recommendations?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(normalizedLanguage)}&page=1`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          return [];
        }
        const data = await response.json();
        const rawResults = (Array.isArray(data?.results) ? data.results : []).filter((item) => Number(item?.id) > 0);
        const preferredLanguage = languageBase(normalizedLanguage);
        const isLocalized = (item) =>
          String(item?.original_language || "")
            .trim()
            .toLowerCase() === preferredLanguage;
        const voteCount = (item) => {
          const value = Number(item?.vote_count);
          return Number.isFinite(value) ? value : 0;
        };
        const voteAverage = (item) => {
          const value = Number(item?.vote_average);
          return Number.isFinite(value) ? value : 0;
        };
        const sortedResults = [...rawResults].sort(
          (left, right) =>
            Number(isLocalized(right)) - Number(isLocalized(left)) ||
            voteCount(right) - voteCount(left) ||
            voteAverage(right) - voteAverage(left)
        );
        const qualityFilteredResults = sortedResults.filter((item) => isLocalized(item) || voteCount(item) >= 20 || voteAverage(item) >= 6);
        const recommendationResults = (qualityFilteredResults.length ? qualityFilteredResults : sortedResults).slice(0, itemLimit);

        const items = (
          await Promise.all(
            recommendationResults.map(async (item) => {
              const recommendationType = ["tv", "movie"].includes(
                String(item?.media_type || "")
                  .trim()
                  .toLowerCase()
              )
                ? String(item.media_type).trim().toLowerCase()
                : type;
              const recommendationContentType = recommendationType === "tv" ? "series" : "movie";
              const title = [item?.title, item?.name, item?.original_title, item?.original_name]
                .map((value) => String(value || "").trim())
                .find(Boolean);
              if (!title) {
                return null;
              }

              const images = await fetchTmdbImages({
                type: recommendationType,
                tmdbId: item.id,
                apiKey,
                includeImageLanguage
              });
              const localizedBackdropPath = selectBestLocalizedImagePath(images?.backdrops, normalizedLanguage);
              const backdrop = toImageUrl(localizedBackdropPath || item?.backdrop_path, "backdrop");
              const fallbackPoster = toImageUrl(item?.poster_path, "entityBackdrop");
              const releaseInfo = await resolveRecommendationReleaseInfo(item, {
                type: recommendationType,
                apiKey,
                language: normalizedLanguage
              });
              const description = typeof item?.overview === "string" && item.overview.trim() ? item.overview : null;
              const rating = typeof item?.vote_average === "number" ? item.vote_average : null;

              return {
                id: `tmdb:${String(item.id)}`,
                type: recommendationContentType,
                apiType: recommendationContentType,
                name: title,
                title,
                poster: backdrop || fallbackPoster,
                rawPosterUrl: fallbackPoster,
                posterShape: "landscape",
                background: backdrop,
                backdrop,
                landscapePoster: backdrop,
                logo: null,
                description,
                releaseInfo,
                imdbRating: rating,
                genres: []
              };
            })
          )
        ).filter(Boolean);

        moreLikeThisCache.set(cacheKey, items);
        return items;
      } catch (error) {
        console.warn("TMDB post-play recommendations failed", error);
        return [];
      }
    },
    async fetchRecommendations({ tmdbId, contentType, language = null } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(TMDB_API_KEY || "").trim();
      if (!settings.enabled || !settings.useMoreLikeThis || !apiKey || !tmdbId) {
        return [];
      }

      const type = resolveType(contentType);
      const lang = normalizeTmdbLanguageCode(language || settings.language);
      const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}/recommendations?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&page=1`;
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const recommendationResults = (Array.isArray(data?.results) ? data.results : [])
        .filter((item) => Number(item?.id) > 0)
        .slice(0, TMDB_RECOMMENDATION_MAX_ITEMS);
      const items = await Promise.all(
        recommendationResults.map(async (item) => ({
          id: item?.id ? `tmdb:${String(item.id)}` : "",
          type: type === "tv" ? "series" : "movie",
          name: item?.title || item?.name || "Untitled",
          poster: toImageUrl(item?.poster_path || null, "poster"),
          background: toImageUrl(item?.backdrop_path || null, "backdrop"),
          backdrop: toImageUrl(item?.backdrop_path || null, "backdrop"),
          landscapePoster: toImageUrl(item?.backdrop_path || null, "backdrop"),
          description: item?.overview || "",
          releaseInfo: await resolveRecommendationReleaseInfo(item, {
            type,
            apiKey,
            language: lang
          }),
          tmdbRating: typeof item?.vote_average === "number" ? Number(item.vote_average.toFixed(1)) : null
        }))
      );
      return items.filter((item) => item.id);
    }
  };
}
