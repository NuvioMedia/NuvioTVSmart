import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";
import {
  hasSameSeasonStructure,
  remapEpisodeByTitleOrIndex,
  reverseRemapEpisodeByTitleOrIndex
} from "../../core/tracking/episodeMapping.js";
import { addonEpisodeListRepository } from "./addonEpisodeListRepository.js";
import { TraktAuthService } from "./traktAuthService.js";

// Translates episode numbers between the add-on's list and Trakt's, mirroring Android
// TraktEpisodeMappingService: only episodes the add-on does not have are remapped, so a
// season-count mismatch in one season cannot shift every later episode of a long show.

const CACHE_LIMIT = 500;
const REMAP_CONCURRENCY = 6;
const EMPTY_EPISODES_TTL_MS = 2 * 60 * 1000;

const addonToTraktCache = new Map();
const traktToAddonCache = new Map();
const traktEpisodesCache = new Map();
const traktEpisodesInFlight = new Map();

function cacheSet(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

function normalizeContentType(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase();
  return type || "series";
}

function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isAuthenticated() {
  try {
    return TraktAuthService.isAuthenticated() === true;
  } catch (_) {
    return false;
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** Trakt accepts a Trakt id, an IMDb id or a slug; a TMDB-only id cannot be remapped. */
function resolveShowLookupId({ contentId, videoId, traktId, imdbId } = {}) {
  const explicitImdb = String(imdbId || "").trim();
  if (/^tt\d+$/i.test(explicitImdb)) {
    return explicitImdb;
  }
  const explicitTrakt = positiveInteger(traktId);
  if (explicitTrakt) {
    return String(explicitTrakt);
  }
  for (const value of [contentId, videoId]) {
    const raw = String(value || "").trim();
    if (!raw) {
      continue;
    }
    const imdbPrefixed = raw.match(/^imdb:(tt\d+)$/i);
    if (imdbPrefixed) {
      return imdbPrefixed[1];
    }
    if (/^tt\d+$/i.test(raw)) {
      return raw;
    }
    const traktPrefixed = raw.match(/^trakt:(\d+)$/i);
    if (traktPrefixed) {
      return traktPrefixed[1];
    }
  }
  return null;
}

function addonToTraktKey({ contentId, contentType, videoId, season, episode }) {
  const id = String(contentId || "").trim();
  const seasonNumber = positiveInteger(season);
  const episodeNumber = positiveInteger(episode);
  if (!id || !seasonNumber || !episodeNumber) {
    return "";
  }
  return `${normalizeContentType(contentType)}|${id}|${String(videoId || "").trim()}|${seasonNumber}|${episodeNumber}`;
}

function traktToAddonKey({ contentId, contentType, season, episode, title }) {
  const id = String(contentId || "").trim();
  const seasonNumber = positiveInteger(season);
  const episodeNumber = positiveInteger(episode);
  if (!id || !seasonNumber || !episodeNumber) {
    return "";
  }
  return `${normalizeContentType(contentType)}|${id}|${seasonNumber}|${episodeNumber}|${normalizeTitle(title)}`;
}

async function fetchTraktEpisodes(showLookupId) {
  const id = String(showLookupId || "").trim();
  if (!id) {
    return [];
  }
  const cached = traktEpisodesCache.get(id);
  if (cached && (cached.episodes.length || cached.expiresAt > Date.now())) {
    return cached.episodes;
  }
  const pending = traktEpisodesInFlight.get(id);
  if (pending) {
    return pending;
  }
  const request = (async () => {
    let seasons = null;
    try {
      seasons = await TraktAuthService.fetchShowSeasons(id);
    } catch (_) {
      seasons = null;
    }
    const episodes = [];
    if (Array.isArray(seasons)) {
      seasons.forEach((season) => {
        const seasonNumber = positiveInteger(season?.number);
        if (!seasonNumber) {
          return;
        }
        (Array.isArray(season?.episodes) ? season.episodes : []).forEach((episode) => {
          const number = positiveInteger(episode?.number);
          if (!number) {
            return;
          }
          episodes.push({
            season: seasonNumber,
            episode: number,
            title: String(episode?.title || "").trim() || null,
            videoId: null
          });
        });
      });
      episodes.sort((left, right) => left.season - right.season || left.episode - right.episode);
    }
    cacheSet(traktEpisodesCache, id, {
      episodes,
      // A failed or empty response is retried after a short delay instead of
      // being cached for the whole session.
      expiresAt: episodes.length ? Number.MAX_SAFE_INTEGER : Date.now() + EMPTY_EPISODES_TTL_MS
    });
    return episodes;
  })().finally(() => {
    if (traktEpisodesInFlight.get(id) === request) {
      traktEpisodesInFlight.delete(id);
    }
  });
  traktEpisodesInFlight.set(id, request);
  return request;
}

function remapVideoId(videoId, mapping) {
  const raw = String(videoId || "");
  if (!raw) {
    return videoId;
  }
  const seeds = raw.match(/^(.*):s(\d+)e(\d+)$/i);
  if (seeds) {
    return `${seeds[1]}:s${mapping.season}e${mapping.episode}`;
  }
  const progress = raw.match(/^(.*):(\d+):(\d+)$/);
  if (progress) {
    return `${progress[1]}:${mapping.season}:${mapping.episode}`;
  }
  return videoId;
}

function withEpisodeMapping(item, mapping) {
  const next = { ...item, season: mapping.season, episode: mapping.episode };
  if (Object.prototype.hasOwnProperty.call(item, "seasonNumber")) {
    next.seasonNumber = mapping.season;
  }
  if (Object.prototype.hasOwnProperty.call(item, "episodeNumber")) {
    next.episodeNumber = mapping.episode;
  }
  next.videoId = remapVideoId(item.videoId, mapping);
  if (mapping.title) {
    next.episodeTitle = mapping.title;
  }
  return next;
}

async function remapAll(items, resolve) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return list;
  }
  return mapWithConcurrency(list, REMAP_CONCURRENCY, async (item) => {
    if (!item || item.season == null || item.episode == null) {
      return item;
    }
    if (String(item.contentType || "").toLowerCase() !== "series") {
      return item;
    }
    try {
      const mapping = await resolve(item);
      return mapping ? withEpisodeMapping(item, mapping) : item;
    } catch (_) {
      return item;
    }
  });
}

export const TraktEpisodeMappingService = {
  isAuthenticated,

  prefetchAddonEpisodes(contentIds = [], concurrency = 8) {
    return addonEpisodeListRepository.prefetch(contentIds, concurrency);
  },

  /** Add-on numbering -> Trakt numbering. Null when the numberings already match. */
  async resolveAddonToTrakt({
    contentId,
    contentType = "series",
    videoId = null,
    season,
    episode,
    title = null,
    traktId = null,
    imdbId = null,
    addonEpisodes = null
  } = {}) {
    if (!isAuthenticated()) {
      return null;
    }
    const key = addonToTraktKey({ contentId, contentType, videoId, season, episode });
    if (!key) {
      return null;
    }
    const cached = addonToTraktCache.get(key);
    if (cached) {
      return cached;
    }
    const addon =
      Array.isArray(addonEpisodes) && addonEpisodes.length
        ? addonEpisodes
        : await addonEpisodeListRepository.episodes(contentId, contentType);
    if (!addon.length) {
      return null;
    }
    const lookupId = resolveShowLookupId({ contentId, videoId, traktId, imdbId });
    if (!lookupId) {
      return null;
    }
    const providerEpisodes = await fetchTraktEpisodes(lookupId);
    if (!providerEpisodes.length) {
      return null;
    }
    if (hasSameSeasonStructure(addon, providerEpisodes)) {
      return null;
    }
    const mapped = remapEpisodeByTitleOrIndex({
      requestedSeason: season,
      requestedEpisode: episode,
      requestedVideoId: videoId,
      requestedTitle: title,
      addonEpisodes: addon,
      providerEpisodes,
      preferSameNumberOverIndex: true
    });
    if (mapped) {
      cacheSet(addonToTraktCache, key, mapped);
    }
    return mapped;
  },

  /**
   * Trakt numbering -> add-on numbering. Only remaps when the add-on lacks the exact
   * season/episode (the mobile-app rule), so shows that already line up are untouched.
   */
  async resolveTraktToAddon({
    contentId,
    contentType = "series",
    season,
    episode,
    title = null,
    traktId = null,
    imdbId = null,
    addonEpisodes = null
  } = {}) {
    if (!isAuthenticated()) {
      return null;
    }
    const key = traktToAddonKey({ contentId, contentType, season, episode, title });
    if (!key) {
      return null;
    }
    const cached = traktToAddonCache.get(key);
    if (cached) {
      return cached;
    }
    const addon =
      Array.isArray(addonEpisodes) && addonEpisodes.length
        ? addonEpisodes
        : await addonEpisodeListRepository.episodes(contentId, contentType);
    if (!addon.length) {
      return null;
    }
    const seasonNumber = positiveInteger(season);
    const episodeNumber = positiveInteger(episode);
    if (!seasonNumber || !episodeNumber) {
      return null;
    }
    if (addon.some((entry) => entry.season === seasonNumber && entry.episode === episodeNumber)) {
      return null;
    }
    const lookupId = resolveShowLookupId({ contentId, traktId, imdbId });
    if (!lookupId) {
      return null;
    }
    const providerEpisodes = await fetchTraktEpisodes(lookupId);
    if (!providerEpisodes.length) {
      return null;
    }
    const mapped = reverseRemapEpisodeByTitleOrIndex({
      requestedSeason: seasonNumber,
      requestedEpisode: episodeNumber,
      requestedTitle: title,
      addonEpisodes: addon,
      providerEpisodes
    });
    if (mapped) {
      cacheSet(traktToAddonCache, key, mapped);
    }
    return mapped;
  },

  /** Items read from Trakt (history, playback, watched seeds) with add-on numbering. */
  remapItemsToAddon(items = []) {
    return remapAll(items, (item) =>
      this.resolveTraktToAddon({
        contentId: item.contentId,
        contentType: item.contentType || "series",
        season: item.season ?? item.seasonNumber,
        episode: item.episode ?? item.episodeNumber,
        title: item.episodeTitle || null,
        traktId: item.traktId || null,
        imdbId: item.imdbId || null
      })
    );
  },

  /** Items written to Trakt (history, scrobble) with Trakt numbering. */
  remapItemsToTrakt(items = []) {
    return remapAll(items, (item) =>
      this.resolveAddonToTrakt({
        contentId: item.contentId,
        contentType: item.contentType || "series",
        videoId: item.videoId || null,
        season: item.season ?? item.seasonNumber,
        episode: item.episode ?? item.episodeNumber,
        title: item.episodeTitle || null,
        traktId: item.traktId || null,
        imdbId: item.imdbId || null
      })
    );
  },

  clearCache() {
    addonToTraktCache.clear();
    traktToAddonCache.clear();
    traktEpisodesCache.clear();
    traktEpisodesInFlight.clear();
  }
};

registerSessionTeardownHandler(() => TraktEpisodeMappingService.clearCache());
