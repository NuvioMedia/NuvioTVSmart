import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";
import { Platform } from "../../platform/index.js";
import {
  isTmdbHostBackedOff,
  isTmdbRequestBlocked,
  noteTmdbRequestResult
} from "../network/tmdbNegativeCache.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_SERVICE_FETCH_TIMEOUT_MS = 10000;
const TMDB_DIRECT_FETCH_TIMEOUT_MS = 60_000;
const TMDB_SERVICE_MAX_RESPONSE_BYTES = 512 * 1024;
const imdbToTmdbCache = new Map();
const imdbToTmdbInFlight = new Map();
const tmdbToImdbCache = new Map();
const tmdbToImdbInFlight = new Map();
const tvSeasonsCache = new Map();
const tvSeasonsInFlight = new Map();
const TV_SEASONS_CACHE_TTL_MS = 30 * 60 * 1000;
const TV_SEASONS_CACHE_LIMIT = 100;

export async function fetchTmdbJson(
  url,
  { signal = null, maxResponseBytes = TMDB_SERVICE_MAX_RESPONSE_BYTES } = {}
) {
  // A 400/404/410 already seen for this exact request is not asked again for
  // 24h (native legacy negcache). A different API key hits the same entry.
  if (isTmdbRequestBlocked(url)) {
    return null;
  }
  // Some webOS TV runtimes can reject direct cross-origin fetches even while
  // the packaged network service can reach the same HTTPS endpoint. Keep the
  // service path scoped to webOS and retain the browser fetch as a fallback
  // for older installs or when the optional service is unavailable.
  if (Platform.isWebOS()) {
    let result = null;
    try {
      result = await PluginServiceClient.fetch({
        url,
        method: "GET",
        maxResponseBytes,
        timeoutMs: TMDB_SERVICE_FETCH_TIMEOUT_MS,
        signal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // The service itself failed, not necessarily the host: keep the direct
      // request as the fallback and leave the host backoff to that path.
    }
    if (result) {
      if (!result.ok) {
        noteTmdbRequestResult(url, { status: Number(result.status || 0) });
        return null;
      }
      try {
        const parsed = JSON.parse(result.body || "");
        noteTmdbRequestResult(url, { status: 200 });
        return parsed;
      } catch (_) {
        // A malformed service body still falls back to the direct request.
      }
    }
  }

  if (signal?.aborted) throw new Error("TMDB request aborted");
  if (isTmdbHostBackedOff(url)) {
    return null;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const abortRequest = (error) => {
    try {
      controller?.abort();
    } catch (_) {
      // Abort is best effort; the deadline still settles the caller below.
    }
    rejectDeadline(error);
  };
  const forwardAbort = () => abortRequest(new Error("TMDB request aborted"));
  signal?.addEventListener?.("abort", forwardAbort, { once: true });
  const timeoutId = setTimeout(() => {
    noteTmdbRequestResult(url, { networkError: true });
    abortRequest(new Error(`TMDB request timed out after ${TMDB_DIRECT_FETCH_TIMEOUT_MS}ms`));
  }, TMDB_DIRECT_FETCH_TIMEOUT_MS);

  try {
    const request = (async () => {
      let response;
      try {
        response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      } catch (error) {
        if (!signal?.aborted) {
          noteTmdbRequestResult(url, { networkError: true });
        }
        throw error;
      }
      noteTmdbRequestResult(url, { status: Number(response.status || 0) });
      if (!response.ok) {
        return null;
      }
      return response.json();
    })();
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
}

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (["series", "tv", "show", "tvshow"].includes(normalized)) return "tv";
  if (["movie", "film"].includes(normalized)) return "movie";
  return normalized;
}

export function parseTmdbIdInput(value) {
  const rawId = String(value || "").trim();
  if (!rawId) return { idPart: "", kind: "unknown" };
  // Keep the same case-sensitive prefix handling as Android's
  // removePrefix("tmdb:").removePrefix("movie:").removePrefix("series:").
  const idPart = rawId
    .replace(/^tmdb:/, "")
    .replace(/^movie:/, "")
    .replace(/^series:/, "")
    .trim()
    .split(":")[0]
    .split("/")[0]
    .trim();
  if (/^\d+$/.test(idPart)) return { idPart, kind: "numeric" };
  if (idPart.startsWith("tt")) return { idPart, kind: "imdb" };
  return { idPart, kind: "unknown" };
}

function lookupKey(id, type) {
  return `${String(id || "")
    .trim()
    .toLowerCase()}::${getContentType(type)}`;
}

function readTvSeasonsCache(key) {
  const entry = tvSeasonsCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    tvSeasonsCache.delete(key);
    return null;
  }
  return entry.value;
}

function loadTvSeasonsCache(key, loader) {
  const pending = tvSeasonsInFlight.get(key);
  if (pending) {
    return pending;
  }
  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (value != null) {
        if (tvSeasonsCache.size >= TV_SEASONS_CACHE_LIMIT) {
          tvSeasonsCache.delete(tvSeasonsCache.keys().next().value);
        }
        tvSeasonsCache.set(key, { value, expiresAt: Date.now() + TV_SEASONS_CACHE_TTL_MS });
      }
      return value;
    })
    .finally(() => {
      if (tvSeasonsInFlight.get(key) === request) {
        tvSeasonsInFlight.delete(key);
      }
    });
  tvSeasonsInFlight.set(key, request);
  return request;
}

export const TmdbService = {
  async ensureTmdbId(id, type = "movie", options = {}) {
    const parsed = parseTmdbIdInput(id);
    // Android accepts an already numeric TMDB id without consulting settings,
    // API keys, or the network. This branch must stay before all Web-only
    // configuration gates.
    if (parsed.kind === "numeric") return parsed.idPart;
    if (parsed.kind !== "imdb") {
      const fallback = String(options?.fallbackImdbId || "")
        .trim()
        .split(":")[0];
      return /^tt/i.test(fallback)
        ? this.ensureTmdbId(fallback.toLowerCase(), type, { ...options, fallbackImdbId: null })
        : null;
    }

    const contentType = getContentType(type);
    const key = lookupKey(parsed.idPart, contentType);
    if (imdbToTmdbCache.has(key)) {
      return imdbToTmdbCache.get(key);
    }
    if (imdbToTmdbInFlight.has(key)) {
      return imdbToTmdbInFlight.get(key);
    }

    // Android checks its cache before any external lookup gate. Preserve a
    // cached conversion even when the optional Web TMDB feature is disabled;
    // only an uncached network lookup is subject to the Web configuration and
    // API-key requirements.
    const settings = TmdbSettingsStore.get();
    const requireEnabled = options?.requireEnabled !== false;
    const apiKey = String(TMDB_API_KEY || "").trim();
    if ((requireEnabled && !settings.enabled) || !apiKey) return null;

    const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(parsed.idPart)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
    const request = (async () => {
      const data = await fetchTmdbJson(url, { signal: options?.signal || null });
      if (!data) return null;
      const list = contentType === "tv" ? data.tv_results : data.movie_results;
      const first = Array.isArray(list) ? list[0] : null;
      if (!first?.id) {
        return null;
      }

      const resolvedId = String(first.id);
      imdbToTmdbCache.set(key, resolvedId);
      tmdbToImdbCache.set(lookupKey(resolvedId, contentType), parsed.idPart);
      return resolvedId;
    })();
    imdbToTmdbInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (imdbToTmdbInFlight.get(key) === request) {
        imdbToTmdbInFlight.delete(key);
      }
    }
  },

  async tmdbToImdb(tmdbId, type = "movie") {
    const apiKey = String(TMDB_API_KEY || "").trim();
    const numericId = String(tmdbId || "").trim();
    if (!apiKey || !/^\d+$/.test(numericId)) {
      return null;
    }

    const contentType = getContentType(type);
    const key = lookupKey(numericId, contentType);
    if (tmdbToImdbCache.has(key)) {
      return tmdbToImdbCache.get(key);
    }
    if (tmdbToImdbInFlight.has(key)) {
      return tmdbToImdbInFlight.get(key);
    }

    const url = `${TMDB_BASE_URL}/${contentType}/${encodeURIComponent(numericId)}/external_ids?api_key=${encodeURIComponent(apiKey)}`;
    const request = (async () => {
      const data = await fetchTmdbJson(url);
      if (!data) return null;
      const imdbId = String(data?.imdb_id || "").trim();
      if (!/^tt\d+$/i.test(imdbId)) {
        return null;
      }
      tmdbToImdbCache.set(key, imdbId);
      imdbToTmdbCache.set(lookupKey(imdbId, contentType), numericId);
      return imdbId;
    })();
    tmdbToImdbInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (tmdbToImdbInFlight.get(key) === request) {
        tmdbToImdbInFlight.delete(key);
      }
    }
  },

  /**
   * Season numbers with their episode counts for a TV show, used to decide whether the
   * add-on and TMDB number the same episodes the same way.
   */
  async tvSeasonCounts(tmdbId, { signal = null } = {}) {
    const id = String(tmdbId || "").trim();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!apiKey || !/^\d+$/.test(id)) {
      return null;
    }
    const cacheKey = `counts:${id}`;
    const cached = readTvSeasonsCache(cacheKey);
    if (cached) {
      return cached;
    }
    return loadTvSeasonsCache(cacheKey, async () => {
      const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`;
      const data = await fetchTmdbJson(url, { signal });
      if (!data) {
        return null;
      }
      return (Array.isArray(data?.seasons) ? data.seasons : [])
        .map((season) => ({
          season: Number(season?.season_number),
          episodeCount: Number(season?.episode_count)
        }))
        .filter(
          (entry) =>
            Number.isInteger(entry.season) &&
            entry.season > 0 &&
            Number.isInteger(entry.episodeCount) &&
            entry.episodeCount > 0
        )
        .sort((left, right) => left.season - right.season);
    });
  },

  /** TMDB's episodes for one season, with titles, for title-then-position remapping. */
  async tvSeasonEpisodes(tmdbId, seasonNumber, { signal = null } = {}) {
    const id = String(tmdbId || "").trim();
    const season = Number(seasonNumber);
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!apiKey || !/^\d+$/.test(id) || !Number.isInteger(season) || season <= 0) {
      return null;
    }
    const cacheKey = `season:${id}:${season}`;
    const cached = readTvSeasonsCache(cacheKey);
    if (cached) {
      return cached;
    }
    return loadTvSeasonsCache(cacheKey, async () => {
      const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(String(season))}?api_key=${encodeURIComponent(apiKey)}&language=en-US`;
      const data = await fetchTmdbJson(url, { signal });
      if (!data) {
        return null;
      }
      return (Array.isArray(data?.episodes) ? data.episodes : [])
        .map((episode) => ({
          season,
          episode: Number(episode?.episode_number),
          title: String(episode?.name || "").trim() || null
        }))
        .filter((entry) => Number.isInteger(entry.episode) && entry.episode > 0)
        .sort((left, right) => left.episode - right.episode);
    });
  },

  clearCache() {
    imdbToTmdbCache.clear();
    tmdbToImdbCache.clear();
    tvSeasonsCache.clear();
    tvSeasonsInFlight.clear();
  }
};
