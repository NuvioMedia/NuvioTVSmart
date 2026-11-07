import { registerSessionTeardownHandler } from "../../core/auth/sessionLifecycle.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";
import {
  hasSameSeasonNumbers,
  hasSameSeasonStructure,
  remapEpisodeByTitleOrIndex,
  reverseRemapEpisodeByTitleOrIndex
} from "../../core/tracking/episodeMapping.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";
import { addonEpisodeListRepository } from "./addonEpisodeListRepository.js";

// MDBList reads and writes episodes in TMDB numbering. Ported from Android
// MdbListEpisodeMappingService: an anime TMDB lists as one season can be two or more
// seasons for the add-on, so watched marks, resume and history writes must be translated.

const CACHE_LIMIT = 200;
const SEASON_CONCURRENCY = 4;
const REMAP_CONCURRENCY = 6;
const EMPTY_CACHE_TTL_MS = 2 * 60 * 1000;

const mappingCache = new Map();
const mappingInFlight = new Map();
const mappingValueCache = new WeakMap();

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cacheKey(contentId, tmdbShowId) {
  const id = String(contentId || "").trim();
  if (id) {
    return id;
  }
  const tmdb = positiveInteger(tmdbShowId);
  return tmdb ? `tmdb:${tmdb}` : "";
}

function cacheSet(key, value) {
  if (mappingCache.size >= CACHE_LIMIT) {
    mappingCache.delete(mappingCache.keys().next().value);
  }
  mappingCache.set(key, value);
}

function cachedValue(mapping, key, compute) {
  let values = mappingValueCache.get(mapping);
  if (!values) {
    values = new Map();
    mappingValueCache.set(mapping, values);
  }
  if (values.has(key)) {
    return values.get(key);
  }
  const value = compute();
  values.set(key, value);
  return value;
}

async function resolveTmdbId({ contentId, ids = {}, tmdbShowId = null }) {
  const explicit = positiveInteger(tmdbShowId) || positiveInteger(ids?.tmdb);
  if (explicit) {
    return explicit;
  }
  const imdb = /^tt\d+$/i.test(String(ids?.imdb || ""))
    ? String(ids.imdb)
    : /^tt\d+$/i.test(String(contentId || "").trim())
      ? String(contentId).trim()
      : "";
  if (!imdb) {
    return null;
  }
  try {
    const resolved = await TmdbService.ensureTmdbId(imdb, "tv", { requireEnabled: false });
    return positiveInteger(resolved);
  } catch (_) {
    return null;
  }
}

async function loadTmdbEpisodes(tmdbId, seasonNumbers) {
  let cursor = 0;
  const seasons = [...seasonNumbers].sort((left, right) => left - right);
  const episodes = [];
  const worker = async () => {
    while (cursor < seasons.length) {
      const index = cursor;
      cursor += 1;
      const season = seasons[index];
      let list = null;
      try {
        list = await TmdbService.tvSeasonEpisodes(tmdbId, season);
      } catch (_) {
        list = null;
      }
      (Array.isArray(list) ? list : []).forEach((entry) => episodes.push(entry));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SEASON_CONCURRENCY, seasons.length) }, () => worker())
  );
  return episodes.sort((left, right) => left.season - right.season || left.episode - right.episode);
}

async function loadMapping({ contentId, ids, tmdbShowId, addonEpisodes }) {
  const addon =
    Array.isArray(addonEpisodes) && addonEpisodes.length
      ? addonEpisodes
      : await addonEpisodeListRepository.episodes(contentId, "series");
  if (!addon.length) {
    return null;
  }
  const tmdbId = await resolveTmdbId({ contentId, ids, tmdbShowId });
  if (!tmdbId) {
    return null;
  }
  const counts = await TmdbService.tvSeasonCounts(tmdbId);
  if (!Array.isArray(counts) || !counts.length) {
    return null;
  }
  const countEntries = counts.map((entry) => ({
    season: entry.season,
    episode: 1,
    title: null,
    videoId: null
  }));
  // Same season numbers on both sides: keep the numbers even when an episode count
  // differs somewhere (merged two-parters), exactly like Android.
  if (hasSameSeasonNumbers(countEntries, addon)) {
    return { remapped: false, tmdbId };
  }
  const tmdbEpisodes = await loadTmdbEpisodes(
    tmdbId,
    counts.map((entry) => entry.season)
  );
  if (!tmdbEpisodes.length) {
    return null;
  }
  if (hasSameSeasonStructure(addon, tmdbEpisodes)) {
    return { remapped: false, tmdbId };
  }
  return { remapped: true, tmdbId, addonEpisodes: addon, tmdbEpisodes };
}

export const MdbListEpisodeMappingService = {
  /** Cached mapping for a show, without touching the network. */
  cached(contentId, tmdbShowId = null) {
    return mappingCache.get(cacheKey(contentId, tmdbShowId)) || null;
  },

  /**
   * Resolves the show's numbering once (add-on vs TMDB). Returns null when either list is
   * unavailable, so callers keep the numbering they already have.
   */
  async resolve({ contentId, ids = {}, tmdbShowId = null, addonEpisodes = null } = {}) {
    const key = cacheKey(contentId, tmdbShowId);
    if (!key) {
      return null;
    }
    const cached = mappingCache.get(key);
    if (cached && (cached.value || cached.expiresAt > Date.now())) {
      return cached.value;
    }
    const pending = mappingInFlight.get(key);
    if (pending) {
      return pending;
    }
    const request = (async () => {
      let value = null;
      try {
        value = await loadMapping({ contentId, ids, tmdbShowId, addonEpisodes });
      } catch (_) {
        value = null;
      }
      cacheSet(key, {
        value,
        expiresAt: value ? Number.MAX_SAFE_INTEGER : Date.now() + EMPTY_CACHE_TTL_MS
      });
      return value;
    })().finally(() => {
      if (mappingInFlight.get(key) === request) {
        mappingInFlight.delete(key);
      }
    });
    mappingInFlight.set(key, request);
    return request;
  },

  /** TMDB (MDBList) numbering -> add-on numbering, or null when nothing needs remapping. */
  toAddon(mapping, { season, episode, title = null } = {}) {
    if (!mapping?.remapped) {
      return null;
    }
    const seasonNumber = positiveInteger(season);
    const episodeNumber = positiveInteger(episode);
    if (!seasonNumber || !episodeNumber) {
      return null;
    }
    return cachedValue(mapping, `addon:${seasonNumber}:${episodeNumber}:${title || ""}`, () =>
      reverseRemapEpisodeByTitleOrIndex({
        requestedSeason: seasonNumber,
        requestedEpisode: episodeNumber,
        requestedTitle: title,
        addonEpisodes: mapping.addonEpisodes,
        providerEpisodes: mapping.tmdbEpisodes
      })
    );
  },

  /** Add-on numbering -> TMDB (MDBList) numbering, or null when nothing needs remapping. */
  toTmdb(mapping, { season, episode, videoId = null, title = null } = {}) {
    if (!mapping?.remapped) {
      return null;
    }
    const seasonNumber = positiveInteger(season);
    const episodeNumber = positiveInteger(episode);
    if (!seasonNumber || !episodeNumber) {
      return null;
    }
    return cachedValue(
      mapping,
      `tmdb:${seasonNumber}:${episodeNumber}:${videoId || ""}:${title || ""}`,
      () =>
        remapEpisodeByTitleOrIndex({
          requestedSeason: seasonNumber,
          requestedEpisode: episodeNumber,
          requestedVideoId: videoId,
          requestedTitle: title,
          addonEpisodes: mapping.addonEpisodes,
          providerEpisodes: mapping.tmdbEpisodes
        })
    );
  },

  /** One call for the read side: the add-on episode for a TMDB season/episode. */
  async resolveToAddon({
    contentId,
    ids,
    tmdbShowId,
    season,
    episode,
    title = null,
    addonEpisodes = null
  } = {}) {
    const mapping = await this.resolve({ contentId, ids, tmdbShowId, addonEpisodes });
    return this.toAddon(mapping, { season, episode, title });
  },

  /** One call for the write side: the TMDB episode for an add-on season/episode. */
  async resolveToTmdb({
    contentId,
    ids,
    tmdbShowId,
    season,
    episode,
    videoId,
    title = null,
    addonEpisodes = null
  } = {}) {
    const mapping = await this.resolve({ contentId, ids, tmdbShowId, addonEpisodes });
    return this.toTmdb(mapping, { season, episode, videoId, title });
  },

  /** Items read from MDBList (TMDB numbering) with add-on numbering. */
  async remapItemsToAddon(items = []) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return list;
    }
    return mapWithConcurrency(list, REMAP_CONCURRENCY, async (item) => {
      if (String(item?.contentType || "") !== "series") {
        return item;
      }
      if (item.season == null || item.episode == null) {
        return item;
      }
      try {
        const mapped = await this.resolveToAddon({
          contentId: item.contentId,
          ids: {
            tmdb: item.tmdbId,
            imdb: item.imdbId,
            tvdb: item.tvdbId
          },
          tmdbShowId: item.tmdbId,
          season: item.season,
          episode: item.episode,
          title: item.episodeTitle || null
        });
        return mapped ? withEpisodeMapping(item, mapped) : item;
      } catch (_) {
        return item;
      }
    });
  },

  /** Items written to MDBList (add-on numbering) with TMDB numbering. */
  async remapItemsToMdbList(items = []) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return list;
    }
    return mapWithConcurrency(list, REMAP_CONCURRENCY, async (item) => {
      if (!item || item.season == null || item.episode == null) {
        return item;
      }
      if (String(item.contentType || item.itemType || item.type || "").toLowerCase() !== "series") {
        return item;
      }
      try {
        const mapped = await this.resolveToTmdb({
          contentId: item.contentId,
          ids: {
            tmdb: item.tmdbId,
            imdb: item.imdbId,
            tvdb: item.tvdbId
          },
          tmdbShowId: item.tmdbId,
          season: item.season,
          episode: item.episode,
          videoId: item.videoId || null,
          title: item.episodeTitle || null
        });
        return mapped ? withEpisodeMapping(item, mapped) : item;
      } catch (_) {
        return item;
      }
    });
  },

  clearCache() {
    mappingCache.clear();
    mappingInFlight.clear();
  }
};

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
  next.episodeNumberMapped = true;
  return next;
}

registerSessionTeardownHandler(() => MdbListEpisodeMappingService.clearCache());
