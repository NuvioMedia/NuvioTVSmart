import { MDBLIST_API_BASE_URL } from "../../config.js";
import { MdbListSettingsStore } from "../local/mdbListSettingsStore.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";

const CACHE_TTL_MS = 30 * 60 * 1000;
const API_BASE_URL = String(MDBLIST_API_BASE_URL || "https://api.mdblist.com/").replace(/\/+$/, "");

const PROVIDERS = {
  TRAKT: { key: "trakt", apiValue: "trakt", settingsKey: "showTrakt" },
  IMDB: { key: "imdb", apiValue: "imdb", settingsKey: "showImdb" },
  TMDB: { key: "tmdb", apiValue: "tmdb", settingsKey: "showTmdb" },
  LETTERBOXD: { key: "letterboxd", apiValue: "letterboxd", settingsKey: "showLetterboxd" },
  TOMATOES: { key: "tomatoes", apiValue: "tomatoes", settingsKey: "showTomatoes" },
  AUDIENCE: { key: "audience", apiValue: "audience", settingsKey: "showAudience" },
  METACRITIC: { key: "metacritic", apiValue: "metacritic", settingsKey: "showMetacritic" }
};

const cache = new Map();
const inFlight = new Map();

function javaStringHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
}

function normalizeMediaType(rawType) {
  switch (
    String(rawType || "")
      .trim()
      .toLowerCase()
  ) {
    case "movie":
    case "film":
      return "movie";
    case "series":
    case "tv":
    case "show":
    case "tvshow":
      return "show";
    default:
      return "movie";
  }
}

function extractImdbId(rawId) {
  const match = String(rawId || "").match(/tt\d+/i);
  return match?.[0] || null;
}

function extractTmdbId(rawId) {
  const trimmed = String(rawId || "").trim();
  if (/^tmdb:/i.test(trimmed)) {
    const value = trimmed.replace(/^tmdb:/i, "").split(":")[0];
    return /^\d+$/.test(value) ? value : null;
  }
  return null;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function enabledProviders(settings = {}) {
  return Object.values(PROVIDERS).filter((provider) => settings[provider.settingsKey] !== false);
}

function cacheGet(cacheKey) {
  const entry = cache.get(cacheKey);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAtMs > Date.now()) {
    return entry.result;
  }
  cache.delete(cacheKey);
  return undefined;
}

function cacheSet(cacheKey, result) {
  cache.set(cacheKey, {
    result,
    expiresAtMs: Date.now() + CACHE_TTL_MS
  });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchProviderRating({ mediaType, provider, apiKey, requestBody }) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/rating/${encodeURIComponent(mediaType)}/${encodeURIComponent(provider.apiValue)}?apikey=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );
    if (!response.ok) {
      console.warn(`MDBList ${provider.apiValue} request failed (${response.status})`);
      return [provider.key, null];
    }
    const payload = await response.json();
    const rating = payload?.ratings?.[0]?.rating;
    const numeric = Number(rating);
    return [provider.key, Number.isFinite(numeric) ? numeric : null];
  } catch (error) {
    console.warn(`MDBList ${provider.apiValue} request failed`, error);
    return [provider.key, null];
  }
}

async function fetchRatings({ imdbId, mediaType, apiKey, providers }) {
  const requestBody = {
    ids: [imdbId],
    provider: "imdb"
  };
  const entries = await runWithConcurrency(providers, 4, (provider) =>
    fetchProviderRating({ mediaType, provider, apiKey, requestBody })
  );
  const ratings = Object.fromEntries(entries);
  const normalizedRatings = {
    trakt: ratings.trakt ?? null,
    imdb: ratings.imdb ?? null,
    tmdb: ratings.tmdb ?? null,
    letterboxd: ratings.letterboxd ?? null,
    tomatoes: ratings.tomatoes ?? null,
    audience: ratings.audience ?? null,
    metacritic: ratings.metacritic ?? null
  };
  const hasAnyRating = Object.values(normalizedRatings).some((value) => value != null);
  if (!hasAnyRating) {
    return null;
  }
  return {
    ratings: normalizedRatings,
    hasImdbRating: normalizedRatings.imdb != null
  };
}

async function resolveImdbId(
  meta = {},
  fallbackItemId = "",
  fallbackItemType = "",
  mediaType = "movie"
) {
  const directImdb = firstNonEmpty(
    extractImdbId(meta?.id),
    extractImdbId(fallbackItemId),
    extractImdbId(meta?.imdbId),
    extractImdbId(meta?.imdb_id),
    extractImdbId(meta?.externalIds?.imdb),
    extractImdbId(meta?.external_ids?.imdb_id)
  );
  if (directImdb) {
    return directImdb;
  }

  const tmdbId = firstNonEmpty(
    extractTmdbId(meta?.id),
    extractTmdbId(fallbackItemId),
    meta?.tmdbId,
    meta?.tmdb_id,
    meta?.ids?.tmdb,
    meta?.externalIds?.tmdb,
    meta?.external_ids?.tmdb,
    /^\d+$/.test(String(meta?.id || "").trim()) ? meta.id : "",
    /^\d+$/.test(String(fallbackItemId || "").trim()) ? fallbackItemId : ""
  );
  if (tmdbId) {
    const mapped = await TmdbService.tmdbToImdb(tmdbId, fallbackItemType || mediaType);
    if (mapped) {
      return mapped;
    }
  }

  const lookupType = fallbackItemType || mediaType;
  const convertedTmdbId = await TmdbService.ensureTmdbId(meta?.id, lookupType, {
    requireEnabled: false
  });
  if (convertedTmdbId) {
    const mapped = await TmdbService.tmdbToImdb(convertedTmdbId, lookupType);
    if (mapped) {
      return mapped;
    }
  }

  return null;
}

async function getCachedOrFetch(cacheKey, factory) {
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }
  const promise = factory()
    .then((result) => {
      cacheSet(cacheKey, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, promise);
  return promise;
}

export const mdbListRepository = {
  async validateApiKey(apiKey) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      return true;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/user?apikey=${encodeURIComponent(trimmed)}`);
      return response.ok;
    } catch (_error) {
      return false;
    }
  },

  async getImdbRatingForItem(itemId, itemType = "movie") {
    const settings = MdbListSettingsStore.get();
    if (!settings.enabled) {
      return null;
    }
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }

    const mediaType = normalizeMediaType(itemType);
    const imdbId = await resolveImdbId(
      { id: itemId, type: mediaType === "show" ? "series" : "movie", name: itemId },
      itemId,
      itemType,
      mediaType
    );
    if (!imdbId) {
      return null;
    }

    const cacheKey = `${mediaType}:${imdbId}:imdb:${javaStringHash(apiKey)}`;
    const result = await getCachedOrFetch(cacheKey, () =>
      fetchRatings({
        imdbId,
        mediaType,
        apiKey,
        providers: [PROVIDERS.IMDB]
      })
    );
    return result?.ratings?.imdb ?? null;
  },

  async getRatingsForMeta(meta = {}, fallbackItemId = "", fallbackItemType = "movie") {
    const settings = MdbListSettingsStore.get();
    if (!settings.enabled) {
      return null;
    }
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }
    const providers = enabledProviders(settings);
    if (!providers.length) {
      return null;
    }

    const mediaType = normalizeMediaType(meta?.apiType || fallbackItemType);
    const imdbId = await resolveImdbId(meta, fallbackItemId, fallbackItemType, mediaType);
    if (!imdbId) {
      return null;
    }

    const providerHash = providers
      .map((provider) => provider.apiValue)
      .sort()
      .join(",");
    const cacheKey = `${mediaType}:${imdbId}:${providerHash}:${javaStringHash(apiKey)}`;
    return getCachedOrFetch(cacheKey, () =>
      fetchRatings({
        imdbId,
        mediaType,
        apiKey,
        providers
      })
    );
  }
};
