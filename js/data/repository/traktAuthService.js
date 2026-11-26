import { ProfileManager } from "../../core/profile/profileManager.js";
import {
  TRAKT_API_URL,
  TRAKT_CLIENT_ID,
  TRAKT_CLIENT_SECRET,
  TRAKT_REDIRECT_URI
} from "../../config.js";
import { AuthManager } from "../../core/auth/authManager.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";
import { trackSessionRequest } from "../../core/auth/sessionLifecycle.js";
import { TraktAuthStore } from "../local/traktAuthStore.js";
import { detailWatchedEnrichmentService } from "./detailWatchedEnrichmentService.js";

import { createTraktAuthServiceMethods01 } from "./traktAuthServiceMethods-01-get-current-auth-state.js";

export {
  TRAKT_API_URL,
  TRAKT_CLIENT_ID,
  TRAKT_CLIENT_SECRET,
  TRAKT_REDIRECT_URI,
  AuthManager,
  trackSessionRequest,
  TraktAuthStore,
  detailWatchedEnrichmentService,
  API_VERSION,
  DEFAULT_API_URL,
  REFRESH_LEEWAY_SECONDS,
  WATCHED_MAX_PAGES,
  WATCHED_MOVIES_PAGE_LIMIT,
  WATCHED_SHOWS_PAGE_LIMIT,
  apiBaseUrl,
  hasRequiredCredentials,
  normalizeAuthErrorMessage,
  createAbortError,
  throwIfAborted,
  sleep,
  fetchWatchedPages,
  readResponseBody,
  isTokenExpiredOrExpiring,
  fetchUserSettings,
  normalizeHistoryItem,
  normalizeWatchlistItem,
  normalizePlaybackItem,
  normalizeWatchedShowItem,
  normalizeWatchedProgress,
  normalizeWatchedMovieItem
};
const API_VERSION = "2";
const DEFAULT_API_URL = "https://api.trakt.tv";
// Same 60 s read budget as the Android TV Trakt OkHttp client.
const REQUEST_TIMEOUT_MS = 60000;
const REFRESH_LEEWAY_SECONDS = 60;
const WATCHED_MAX_PAGES = 1000;
const WATCHED_MOVIES_PAGE_LIMIT = 250;
// Trakt caps /sync/watched/shows?extended=progress at 100 items per page.
const WATCHED_SHOWS_PAGE_LIMIT = 100;

function apiBaseUrl() {
  return String(TRAKT_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

function hasRequiredCredentials() {
  return Boolean(TRAKT_CLIENT_ID && TRAKT_CLIENT_SECRET);
}

function normalizeAuthErrorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    return String(payload.error_description || payload.error || payload.message || fallback);
  }
  return fallback;
}

function createAbortError() {
  const error = new Error("Trakt request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(createAbortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(
      () => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve();
      },
      Math.max(0, Number(ms) || 0)
    );
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function fetchWatchedPages({ token, path, pageLimit, normalize, label }) {
  const items = [];
  let page = 1;

  while (page <= WATCHED_MAX_PAGES) {
    const separator = path.includes("?") ? "&" : "?";
    const { response, payload } = await requestJson(
      `${path}${separator}page=${page}&limit=${pageLimit}`,
      { authorization: `Bearer ${token}` }
    );
    if (!response.ok || !Array.isArray(payload)) {
      const error = new Error(`Trakt ${label} lookup failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    items.push(...payload.map(normalize).filter(Boolean));
    if (payload.length === 0) {
      break;
    }

    const pageCount = Number(response.headers.get("X-Pagination-Page-Count") || 0);
    if (Number.isFinite(pageCount) && pageCount > 0 && page >= pageCount) {
      break;
    }
    if (payload.length < pageLimit) {
      break;
    }
    page += 1;
  }

  if (page > WATCHED_MAX_PAGES) {
    throw new Error(`Trakt ${label} lookup exceeded the pagination safety limit`);
  }
  return items;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

export function requestJson(
  path,
  {
    method = "GET",
    body = null,
    authorization = null,
    clientId = TRAKT_CLIENT_ID,
    signal = null
  } = {}
) {
  const requestSignal = signal || AuthManager.getSessionSignal?.() || null;
  return trackSessionRequest(
    withRequestTimeout(
      async (signal) => {
        throwIfAborted(signal);
        const headers = {
          "Content-Type": "application/json",
          "trakt-api-version": API_VERSION,
          "trakt-api-key": clientId
        };
        if (authorization) {
          headers.Authorization = authorization;
        }

        const response = await fetch(`${apiBaseUrl()}${path}`, {
          method,
          headers,
          body: body == null ? undefined : JSON.stringify(body),
          ...(signal ? { signal } : {})
        });
        throwIfAborted(signal);
        const payload = await readResponseBody(response);
        throwIfAborted(signal);
        return { response, payload };
      },
      REQUEST_TIMEOUT_MS,
      requestSignal
    )
  );
}

function isTokenExpiredOrExpiring(state) {
  const createdAt = Number(state.createdAt || 0);
  const expiresIn = Number(state.expiresIn || 0);
  if (!createdAt || !expiresIn) {
    return true;
  }
  const expiresAt = createdAt + expiresIn;
  return Date.now() / 1000 >= expiresAt - REFRESH_LEEWAY_SECONDS;
}

async function fetchUserSettings(
  profileId = ProfileManager.getActiveProfileId(),
  accessToken = null
) {
  if (ProfileManager.getActiveProfileId() !== profileId) return null;
  // The refresh path passes its fresh token so this call cannot re-enter the
  // refresh it is already waiting on when the token looks expired right away.
  const token = accessToken || (await TraktAuthService.getValidAccessToken());
  if (!token || ProfileManager.getActiveProfileId() !== profileId) {
    return null;
  }
  const { response, payload } = await requestJson("/users/settings", {
    authorization: `Bearer ${token}`
  });
  if (!response.ok) {
    return null;
  }
  const user = payload?.user || {};
  const username = user.username || null;
  const userSlug = user.ids?.slug || null;
  TraktAuthStore.saveUser({ username, userSlug }, profileId);
  return username;
}

export const TraktAuthService = {
  hasRequiredCredentials,
  ...createTraktAuthServiceMethods01(),
  fetchUserSettings
};

function normalizeHistoryItem(entry) {
  if (!entry || !entry.watched_at) return null;
  const item = {};
  item.watchedAt = entry.watched_at;
  item.action = "watch";

  if (entry.movie) {
    item.type = "movie";
    item.title = entry.movie.title;
    item.year = entry.movie.year;
    item.tmdbId = entry.movie.ids?.tmdb;
    item.imdbId = entry.movie.ids?.imdb;
    item.traktId = entry.movie.ids?.trakt;
  } else if (entry.show || entry.episode) {
    item.type = "episode";
    item.showTitle = entry.show?.title;
    item.showYear = entry.show?.year;
    item.showTmdbId = entry.show?.ids?.tmdb;
    item.showImdbId = entry.show?.ids?.imdb;
    item.showTraktId = entry.show?.ids?.trakt;
    if (entry.episode) {
      item.seasonNumber = entry.episode.season;
      item.episodeNumber = entry.episode.number;
      item.episodeTitle = entry.episode.title;
      item.episodeTmdbId = entry.episode.ids?.tmdb;
      item.episodeTraktId = entry.episode.ids?.trakt;
    }
  } else {
    return null;
  }
  return item;
}

function normalizeWatchlistItem(entry) {
  if (!entry || !entry.listed_at) return null;
  const item = {};
  item.addedAt = entry.listed_at;
  item.type = entry.type;

  if (entry.movie) {
    item.title = entry.movie.title;
    item.year = entry.movie.year;
    item.tmdbId = entry.movie.ids?.tmdb;
    item.imdbId = entry.movie.ids?.imdb;
    item.traktId = entry.movie.ids?.trakt;
  } else if (entry.show) {
    item.title = entry.show.title;
    item.year = entry.show.year;
    item.tmdbId = entry.show.ids?.tmdb;
    item.imdbId = entry.show.ids?.imdb;
    item.traktId = entry.show.ids?.trakt;
  } else {
    return null;
  }
  return item;
}

function normalizePlaybackItem(entry) {
  if (!entry || entry.progress == null) return null;
  const isEpisode = entry.type === "episode";
  const media = isEpisode ? entry.episode : entry.movie;
  const show = isEpisode ? entry.show : null;
  if (!media) return null;

  const tmdbId = isEpisode ? show?.ids?.tmdb : media.ids?.tmdb;
  const traktId = isEpisode ? show?.ids?.trakt : media.ids?.trakt;
  const imdbId = isEpisode ? show?.ids?.imdb : media.ids?.imdb;
  const contentId = imdbId
    ? imdbId
    : tmdbId
      ? `tmdb:${tmdbId}`
      : traktId
        ? `trakt:${traktId}`
        : null;
  if (!contentId) return null;

  return {
    type: isEpisode ? "episode" : "movie",
    contentId,
    videoId: isEpisode && media.ids?.tmdb ? `tmdb:${media.ids.tmdb}` : contentId,
    progressPercent: Math.max(0, Math.min(100, Number(entry.progress) || 0)),
    pausedAt: entry.paused_at,
    title: isEpisode ? show?.title : media.title,
    year: isEpisode ? show?.year : media.year,
    imdbId,
    tmdbId,
    traktId,
    seasonNumber: isEpisode ? media.season : undefined,
    episodeNumber: isEpisode ? media.number : undefined,
    episodeTitle: isEpisode ? media.title : undefined
  };
}

function normalizeWatchedShowItem(entry) {
  if (!entry || !entry.show?.ids) return null;
  const show = entry.show;

  const tmdbId = show.ids?.tmdb;
  const traktId = show.ids?.trakt;
  const imdbId = show.ids?.imdb;
  const slug = show.ids?.slug;
  // Android keeps the IMDB ID as the canonical content ID, while retaining
  // TMDB/Trakt IDs for cross-source lookup. This is important for catalogs
  // that use the same IMDB identity as Trakt's watched response.
  const contentId = imdbId
    ? imdbId
    : tmdbId
      ? `tmdb:${tmdbId}`
      : traktId
        ? `trakt:${traktId}`
        : slug || null;
  if (!contentId) return null;

  const seasons = Array.isArray(entry.seasons)
    ? entry.seasons
        .map((season) => ({
          number: Number(season?.number || 0),
          episodes: Array.isArray(season?.episodes)
            ? season.episodes
                .map((episode) => ({
                  number: Number(episode?.number || 0),
                  // Android treats an omitted plays field as one watched play.
                  // Trakt can omit it for older entries in the progress response.
                  plays: episode?.plays == null ? 1 : Number(episode.plays),
                  lastWatchedAt: episode?.last_watched_at || null
                }))
                .filter((episode) => episode.number > 0 && episode.plays > 0)
            : []
        }))
        .filter((season) => season.number > 0 && season.episodes.length)
    : [];

  return {
    type: "series",
    contentId,
    title: show.title,
    year: show.year,
    imdbId,
    tmdbId,
    traktId,
    slug: slug || null,
    plays: Number(entry.plays || 0),
    lastWatchedAt: entry.last_watched_at || null,
    lastUpdatedAt: entry.last_updated_at || null,
    seasons
  };
}

function normalizeWatchedProgress(payload) {
  const map = new Map();

  if (!payload?.seasons || !Array.isArray(payload.seasons)) {
    return map;
  }

  for (const season of payload.seasons) {
    const seasonNumber = season.number;
    if (!season.episodes || !Array.isArray(season.episodes)) continue;

    for (const episode of season.episodes) {
      if (!episode.completed) continue;

      const key = `${seasonNumber}:${episode.number}`;
      map.set(key, {
        isWatched: true,
        watchedAt: episode.last_watched_at || null,
        source: "trakt"
      });
    }
  }

  return map;
}

function normalizeWatchedMovieItem(entry) {
  if (!entry || !entry.movie?.ids) return null;
  const movie = entry.movie;

  const tmdbId = movie.ids?.tmdb;
  const traktId = movie.ids?.trakt;
  const imdbId = movie.ids?.imdb;
  const slug = movie.ids?.slug;
  // Keep the same canonical order as Android's Trakt ID normalization.
  const contentId = imdbId
    ? imdbId
    : tmdbId
      ? `tmdb:${tmdbId}`
      : traktId
        ? `trakt:${traktId}`
        : slug || null;
  if (!contentId) return null;
  const lastWatchedAt = entry.last_watched_at || null;
  const watchedAt = lastWatchedAt ? new Date(lastWatchedAt).getTime() : 0;

  return {
    type: "movie",
    contentType: "movie",
    contentId,
    title: movie.title,
    year: movie.year,
    imdbId,
    tmdbId,
    traktId,
    slug: slug || null,
    plays: Number(entry.plays || 0),
    watchedAt: Number.isFinite(watchedAt) ? watchedAt : 0,
    lastWatchedAt
  };
}
