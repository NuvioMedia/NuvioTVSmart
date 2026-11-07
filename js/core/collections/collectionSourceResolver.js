import { TMDB_API_KEY, TRAKT_API_URL, TRAKT_CLIENT_ID } from "../../config.js";
import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { toTraktImageUrl } from "../trakt/traktImageUrl.js";

// Source metadata and discovery for the collection editor, mirroring Android's
// TmdbCollectionSourceResolver and TraktPublicListSourceResolver.

const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_URL = "https://image.tmdb.org/t/p";
const REQUEST_TIMEOUT_MS = 12000;

function tmdbImage(path, size) {
  const value = String(path || "").trim();
  return value ? `${TMDB_IMAGE_URL}/${size}${value}` : null;
}

function tmdbLanguage() {
  return String(TmdbSettingsStore.get().language || "en").trim() || "en";
}

async function fetchJson(url, options = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      ...options,
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

function tmdbUrl(path, params = {}) {
  const url = new URL(`${TMDB_API_URL}/${String(path).replace(/^\/+/, "")}`);
  if (TMDB_API_KEY) {
    url.searchParams.set("api_key", TMDB_API_KEY);
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function tmdbGet(path, params = {}) {
  if (!TMDB_API_KEY) {
    return null;
  }
  return fetchJson(tmdbUrl(path, params));
}

function traktHeaders() {
  const clientId = String(TRAKT_CLIENT_ID || "").trim();
  if (!clientId) {
    return null;
  }
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId
  };
}

async function traktGet(path, params = {}) {
  const headers = traktHeaders();
  if (!headers) {
    return null;
  }
  const url = new URL(
    `${String(TRAKT_API_URL || "https://api.trakt.tv").replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`
  );
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return fetchJson(url.toString(), { headers });
}

/** Accepts a bare id, a TMDB URL, or an `?id=` link. */
export function parseTmdbId(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  const pathMatch = raw.match(/\/(?:list|collection|company|network|person)\/(\d+)/i);
  if (pathMatch) {
    return Number(pathMatch[1]);
  }
  const idMatch = raw.match(/[?&]id=(\d+)/i);
  return idMatch ? Number(idMatch[1]) : null;
}

/** Returns the numeric id, or the list slug for a Trakt URL. */
export function parseTraktListPath(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  const queryMatch = raw.match(/[?&]id=([^&#/]+)/i);
  if (queryMatch) {
    return queryMatch[1];
  }
  const pathMatch = raw.match(/trakt\.tv\/lists\/([^/?#]+)/i) || raw.match(/\/lists\/([^/?#]+)/i);
  return pathMatch ? pathMatch[1] : null;
}

function traktImageFromImages(images = {}) {
  const posters = Array.isArray(images?.posters) ? images.posters : [];
  const banner = Array.isArray(images?.banners) ? images.banners : [];
  const candidate = posters[0] || banner[0] || null;
  return toTraktImageUrl(candidate) || null;
}

function traktResultFromSummary(list = {}, fallbackLikeCount = null) {
  const id = Number(list?.ids?.trakt);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  const title = String(list?.name || "").trim() || `Trakt List ${id}`;
  const owner = String(list?.user?.username || "").trim();
  const itemCount = Number(list?.item_count);
  const likes = Number(fallbackLikeCount ?? list?.likes);
  const stats = [];
  if (Number.isFinite(itemCount)) {
    stats.push(`${itemCount} items`);
  }
  if (Number.isFinite(likes) && likes > 0) {
    stats.push(`${likes} likes`);
  }
  return {
    traktListId: id,
    title,
    owner,
    itemCount: Number.isFinite(itemCount) ? itemCount : null,
    likes: Number.isFinite(likes) ? likes : null,
    subtitle: [owner, ...stats].filter(Boolean).join(" • "),
    coverImageUrl: traktImageFromImages(list?.images),
    sortBy: String(list?.sort_by || "").trim() || null,
    sortHow: String(list?.sort_how || "").trim() || null
  };
}

export const collectionSourceResolver = {
  parseTmdbId,
  parseTraktListPath,

  async searchTmdbCompanies(query) {
    const text = String(query || "").trim();
    if (!text) {
      return [];
    }
    const payload = await tmdbGet("search/company", { query: text, page: 1 });
    return (Array.isArray(payload?.results) ? payload.results : [])
      .map((result) => ({
        id: Number(result?.id),
        name: String(result?.name || "").trim(),
        originCountry: Array.isArray(result?.origin_country)
          ? result.origin_country.join(", ")
          : "",
        logoUrl: tmdbImage(result?.logo_path, "w500")
      }))
      .filter((result) => Number(result.id) > 0 && result.name);
  },

  async searchTmdbCollections(query) {
    const text = String(query || "").trim();
    if (!text) {
      return [];
    }
    const payload = await tmdbGet("search/collection", {
      query: text,
      language: tmdbLanguage(),
      page: 1
    });
    return (Array.isArray(payload?.results) ? payload.results : [])
      .map((result) => ({
        id: Number(result?.id),
        name: String(result?.name || "").trim(),
        posterUrl:
          tmdbImage(result?.poster_path, "w500") || tmdbImage(result?.backdrop_path, "w780")
      }))
      .filter((result) => Number(result.id) > 0 && result.name);
  },

  /** Title and (where available) cover for a TMDB source, like Android's import metadata. */
  async tmdbImportMetadata(sourceType, id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return null;
    }
    const type = String(sourceType || "").toUpperCase();
    if (type === "LIST") {
      const payload = await tmdbGet(`list/${numericId}`, { language: tmdbLanguage(), page: 1 });
      return payload
        ? { title: String(payload.name || "").trim() || null, coverImageUrl: null }
        : null;
    }
    if (type === "COLLECTION") {
      const payload = await tmdbGet(`collection/${numericId}`, { language: tmdbLanguage() });
      return payload
        ? {
            title: String(payload.name || "").trim() || null,
            coverImageUrl:
              tmdbImage(payload.poster_path, "w500") || tmdbImage(payload.backdrop_path, "w1280")
          }
        : null;
    }
    if (type === "COMPANY") {
      const payload = await tmdbGet(`company/${numericId}`);
      return payload
        ? {
            title: String(payload.name || "").trim() || null,
            coverImageUrl: tmdbImage(payload.logo_path, "w500")
          }
        : null;
    }
    if (type === "NETWORK") {
      const payload = await tmdbGet(`network/${numericId}`);
      return payload
        ? {
            title: String(payload.name || "").trim() || null,
            coverImageUrl: tmdbImage(payload.logo_path, "w500")
          }
        : null;
    }
    if (type === "PERSON" || type === "DIRECTOR") {
      const payload = await tmdbGet(`person/${numericId}`, { language: tmdbLanguage() });
      return payload
        ? {
            title: String(payload.name || "").trim() || null,
            coverImageUrl: tmdbImage(payload.profile_path, "w500")
          }
        : null;
    }
    return null;
  },

  async traktListMetadata(input) {
    const path = parseTraktListPath(input);
    if (!path) {
      return null;
    }
    const payload = await traktGet(`lists/${encodeURIComponent(path)}`, {
      extended: "full,images"
    });
    if (!payload) {
      return null;
    }
    const listId = Number(payload?.ids?.trakt);
    if (!Number.isFinite(listId) || listId <= 0) {
      return null;
    }
    return {
      traktListId: listId,
      title: String(payload?.name || "").trim() || null,
      coverImageUrl: traktImageFromImages(payload?.images)
    };
  },

  async searchTraktLists(query) {
    const text = String(query || "").trim();
    if (!text) {
      return [];
    }
    const payload = await traktGet("search/list", {
      query: text,
      extended: "full,images",
      page: 1,
      limit: 20
    });
    return (Array.isArray(payload) ? payload : [])
      .map((entry) => traktResultFromSummary(entry?.list))
      .filter(Boolean);
  },

  async trendingTraktLists() {
    const payload = await traktGet("lists/trending", {
      extended: "full,images",
      page: 1,
      limit: 20
    });
    return (Array.isArray(payload) ? payload : [])
      .map((entry) => traktResultFromSummary(entry?.list, entry?.like_count))
      .filter(Boolean);
  },

  async popularTraktLists() {
    const payload = await traktGet("lists/popular", {
      extended: "full,images",
      page: 1,
      limit: 20
    });
    return (Array.isArray(payload) ? payload : [])
      .map((entry) => traktResultFromSummary(entry?.list, entry?.like_count))
      .filter(Boolean);
  }
};
