import { IMDB_RATINGS_API_BASE_URL } from "../../config.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";
import { alignEpisodeRatings } from "./episodeRatingsAlignment.js";

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE = new Map();
const IN_FLIGHT = new Map();

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

async function fetchJson(url, timeoutMs = 4500) {
  try {
    return await withRequestTimeout(async (signal) => {
      const response = await fetch(url, {
        method: "GET",
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        return null;
      }
      return await response.json();
    }, timeoutMs);
  } catch (_) {
    return null;
  }
}

/**
 * Android toEpisodeRatings: every episode the provider lists, rated or not, with its air
 * date, so the ratings can be matched to the add-on's own episode order.
 */
export function mapExternalEpisodes(payload = []) {
  const episodes = [];
  (Array.isArray(payload) ? payload : []).forEach((seasonEntry) => {
    (Array.isArray(seasonEntry?.episodes) ? seasonEntry.episodes : []).forEach((episodeEntry) => {
      const seasonNumber = Number(episodeEntry?.season_number || 0);
      const episodeNumber = Number(episodeEntry?.episode_number || 0);
      if (
        !Number.isInteger(seasonNumber) ||
        seasonNumber < 0 ||
        !Number.isInteger(episodeNumber) ||
        episodeNumber <= 0
      ) {
        return;
      }
      const ratingValue =
        episodeEntry?.vote_average == null ? NaN : Number(episodeEntry.vote_average);
      episodes.push({
        season: seasonNumber,
        episode: episodeNumber,
        airDate: typeof episodeEntry?.air_date === "string" ? episodeEntry.air_date : null,
        rating: Number.isFinite(ratingValue) ? Number(ratingValue.toFixed(1)) : null
      });
    });
  });
  return episodes;
}

/** Ratings keyed "season:episode" as { [season]: [{ episode, rating }] }, episodes in order. */
function toSeasonRatings(ratings) {
  const seasons = {};
  ratings.forEach((rating, entryKey) => {
    const [seasonNumber, episodeNumber] = entryKey.split(":").map(Number);
    if (!Array.isArray(seasons[seasonNumber])) {
      seasons[seasonNumber] = [];
    }
    seasons[seasonNumber].push({ episode: episodeNumber, rating });
  });
  Object.keys(seasons).forEach((seasonNumber) => {
    seasons[seasonNumber].sort((left, right) => left.episode - right.episode);
  });
  return seasons;
}

function normalizeTmdbId(value) {
  const normalized = Number(value || 0);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
}

async function getExternalEpisodesById({ baseUrl, id, cacheKey }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl || !id) {
    return [];
  }

  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (IN_FLIGHT.has(cacheKey)) {
    return IN_FLIGHT.get(cacheKey);
  }

  const request = (async () => {
    const url = `${normalizedBaseUrl}api/shows/${encodeURIComponent(String(id))}/season-ratings`;
    const payload = await fetchJson(url);
    const mapped = payload ? mapExternalEpisodes(payload) : [];
    CACHE.set(cacheKey, {
      value: mapped,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
    return mapped;
  })().finally(() => {
    IN_FLIGHT.delete(cacheKey);
  });

  IN_FLIGHT.set(cacheKey, request);
  return request;
}

async function getExternalEpisodes(normalizedTmdbId) {
  if (!normalizedTmdbId) {
    return [];
  }
  return getExternalEpisodesById({
    baseUrl: IMDB_RATINGS_API_BASE_URL,
    id: normalizedTmdbId,
    cacheKey: `tmdb:${normalizedTmdbId}`
  });
}

export const imdbEpisodeRatingsRepository = {
  /**
   * Ratings by season in the add-on's own numbering: pass the add-on's episodes
   * (see addonEpisodeAirDates) so a split into other seasons still lines up.
   */
  async getEpisodeRatings({ tmdbId, addonEpisodes = [] } = {}) {
    const normalizedTmdbId = normalizeTmdbId(tmdbId);
    if (!normalizedTmdbId) {
      return {};
    }
    const episodes = await getExternalEpisodes(normalizedTmdbId);
    return toSeasonRatings(alignEpisodeRatings(addonEpisodes, episodes));
  },

  async getSeasonRatingsByTmdbId(tmdbId) {
    return this.getEpisodeRatings({ tmdbId });
  }
};
