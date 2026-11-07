import { SIMKL_API_URL, SIMKL_APP_NAME, SIMKL_CLIENT_ID } from "../../config.js";
import { Platform } from "../../platform/index.js";

// Resolves the anime-specific IDs (MAL / AniList / Kitsu) and the anime episode number for a
// show, using the same Simkl lookup Android's SimklIdResolver performs. Everything is best-effort
// and cached per show; a missing client id or a non-anime title simply returns null.

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 200;
const APP_VERSION = "1.0.0";

const idsCache = new Map();
const detailsCache = new Map();
const seasonsCache = new Map();
const episodesCache = new Map();

function cacheSet(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cacheGet(cache, key) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function timeoutMs() {
  return Platform.isTizen() || Platform.isWebOS() ? 8000 : 3500;
}

async function fetchJson(url, options = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs()) : null;
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || undefined,
      body: options.body || undefined,
      mode: "cors",
      cache: "no-store",
      signal: controller?.signal
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function simklParams() {
  return `client_id=${encodeURIComponent(SIMKL_CLIENT_ID)}&app-name=${encodeURIComponent(SIMKL_APP_NAME)}&app-version=${encodeURIComponent(APP_VERSION)}`;
}

function normalizeAnimeId(value) {
  const match = String(value || "")
    .trim()
    .match(/^(mal|anilist|kitsu):(\d+)/i);
  return match ? { service: match[1].toLowerCase(), id: match[2] } : null;
}

async function simklDetails(simklId, type = "anime") {
  const id = Number(simklId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  const cached = cacheGet(detailsCache, id);
  if (cached !== undefined) {
    return cached;
  }
  const payload = await fetchJson(
    `${SIMKL_API_URL}/${encodeURIComponent(type)}/${id}?extended=full&${simklParams()}`
  );
  const value = payload && typeof payload === "object" ? payload : null;
  cacheSet(detailsCache, id, value);
  return value;
}

async function simklSearch(lookup) {
  if (!SIMKL_CLIENT_ID || !lookup?.service || !lookup?.id) {
    return null;
  }
  const key = `${lookup.service}:${lookup.id}`;
  const cached = cacheGet(idsCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const payload = await fetchJson(
    `${SIMKL_API_URL}/search/id?${lookup.service}=${encodeURIComponent(lookup.id)}&${simklParams()}`
  );
  const results = Array.isArray(payload) ? payload : [];
  const entry = results.find((item) => item?.type === "anime") || results[0] || null;
  const value = entry
    ? {
        simklId: Number(entry.ids?.simkl) || null,
        type: String(entry.type || "").toLowerCase()
      }
    : null;
  cacheSet(idsCache, key, value);
  return value;
}

async function simklSeasonSibling(simklId, season) {
  const id = Number(simklId);
  const seasonNumber = Number(season);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(seasonNumber) || seasonNumber <= 1) {
    return null;
  }
  const key = `${id}:${seasonNumber}`;
  const cached = cacheGet(seasonsCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const payload = await fetchJson(
    `${SIMKL_API_URL}/anime/${id}?extended=full_anime_seasons&${simklParams()}`
  );
  const seasons = Array.isArray(payload?.mapped_tvdb_seasons) ? payload.mapped_tvdb_seasons : [];
  const match = seasons.find((entry) => Number(entry?.tvdb_season) === seasonNumber);
  const siblingId = Number(match?.simkl_id) || null;
  cacheSet(seasonsCache, key, siblingId);
  return siblingId;
}

function idsFromDetails(details) {
  const ids = details?.ids || {};
  const pick = (key) => {
    const value = String(ids[key] ?? "").trim();
    return value || null;
  };
  return {
    mal: pick("mal"),
    anilist: pick("anilist"),
    kitsu: pick("kitsu"),
    imdb: pick("imdb")
  };
}

export const animeIdResolver = {
  /**
   * Anime IDs for the show, with the Simkl entry matching the requested season when possible.
   * Returns null for non-anime titles or when nothing could be resolved.
   */
  async resolveAnimeIds({ imdbId = "", contentId = "", videoId = "", season = null } = {}) {
    const direct = normalizeAnimeId(contentId) || normalizeAnimeId(videoId);
    const normalizedImdb = /^tt\d+$/i.test(String(imdbId || "").trim())
      ? String(imdbId).trim()
      : "";

    // Direct provider ids are already usable; ask Simkl only to fill the missing ones.
    if (direct?.service === "mal" || direct?.service === "anilist" || direct?.service === "kitsu") {
      if (!SIMKL_CLIENT_ID) {
        return {
          simklId: null,
          mal: direct.service === "mal" ? direct.id : null,
          anilist: direct.service === "anilist" ? direct.id : null,
          kitsu: direct.service === "kitsu" ? direct.id : null,
          imdb: normalizedImdb
        };
      }
      const lookup = { service: direct.service, id: direct.id };
      const found = await simklSearch(lookup);
      if (!found?.simklId || found.type !== "anime") {
        return {
          simklId: null,
          mal: direct.service === "mal" ? direct.id : null,
          anilist: direct.service === "anilist" ? direct.id : null,
          kitsu: direct.service === "kitsu" ? direct.id : null,
          imdb: normalizedImdb
        };
      }
      return this.resolveSimklEntry(found.simklId, season);
    }

    if (!normalizedImdb || !SIMKL_CLIENT_ID) {
      return null;
    }
    const found = await simklSearch({ service: "imdb", id: normalizedImdb });
    if (!found?.simklId || found.type !== "anime") {
      return null;
    }
    return this.resolveSimklEntry(found.simklId, season);
  },

  async resolveSimklEntry(simklId, season = null) {
    let resolvedId = Number(simklId) || null;
    let details = await simklDetails(resolvedId, "anime");
    if (!details) {
      return null;
    }
    const detailsSeason = Number(details.season);
    const requestedSeason = Number(season);
    if (
      Number.isFinite(requestedSeason) &&
      requestedSeason > 1 &&
      (!Number.isFinite(detailsSeason) || detailsSeason !== requestedSeason)
    ) {
      const siblingId = await simklSeasonSibling(resolvedId, requestedSeason);
      if (siblingId && siblingId !== resolvedId) {
        const siblingDetails = await simklDetails(siblingId, "anime");
        if (siblingDetails) {
          details = siblingDetails;
          resolvedId = siblingId;
        }
      }
    }
    const ids = idsFromDetails(details);
    return { simklId: resolvedId, ...ids };
  },

  /** The anime-local episode number for a TVDB/TMDB season+episode, or the requested number. */
  async resolveAnimeEpisode({ simklId = null, season = null, episode = null } = {}) {
    const requestedEpisode = Number(episode);
    const requestedSeason = Number(season);
    const id = Number(simklId);
    if (
      !Number.isFinite(id) ||
      id <= 0 ||
      !Number.isFinite(requestedEpisode) ||
      requestedEpisode <= 0 ||
      !Number.isFinite(requestedSeason) ||
      requestedSeason <= 0
    ) {
      return Number.isFinite(requestedEpisode) && requestedEpisode > 0 ? requestedEpisode : null;
    }
    const cached = cacheGet(episodesCache, id);
    let episodes = cached;
    if (episodes === undefined) {
      const payload = await fetchJson(`${SIMKL_API_URL}/anime/episodes/${id}?${simklParams()}`);
      episodes = Array.isArray(payload) ? payload : [];
      cacheSet(episodesCache, id, episodes);
    }
    const match = (episodes || []).find(
      (entry) =>
        Number(entry?.tvdb?.season) === requestedSeason &&
        Number(entry?.tvdb?.episode) === requestedEpisode
    );
    const resolved = Number(match?.episode);
    return Number.isFinite(resolved) && resolved > 0 ? resolved : requestedEpisode;
  },

  clearCache() {
    idsCache.clear();
    detailsCache.clear();
    seasonsCache.clear();
    episodesCache.clear();
  }
};
