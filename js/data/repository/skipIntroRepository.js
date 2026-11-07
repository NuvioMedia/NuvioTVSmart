import { ANIME_SKIP_API_URL, ANISKIP_API_URL, INTRODB_API_URL } from "../../config.js";
import { segmentCategory } from "../../core/player/skipIntervalRules.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";
import { Platform } from "../../platform/index.js";
import { AnimeSkipSettingsStore } from "../local/animeSkipSettingsStore.js";
import { animeIdResolver } from "./animeIdResolver.js";

const CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_EMPTY_TTL_MS = 2 * 60 * 1000;
const CACHE_LIMIT = 200;
const ANIME_SKIP_SHOW_ID_CACHE = new Map();
const ANIME_SKIP_SHOW_ID_TTL_MS = 30 * 60 * 1000;
const OPEN_ENDED_END_SECONDS = Number.MAX_SAFE_INTEGER;

function readCache(key) {
  const entry = CACHE.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return entry.intervals;
}

function writeCache(key, intervals) {
  if (CACHE.size >= CACHE_LIMIT) {
    CACHE.delete(CACHE.keys().next().value);
  }
  // A failed lookup is retried soon instead of hiding skip data for the session.
  CACHE.set(key, {
    intervals,
    expiresAt: Date.now() + (intervals.length ? CACHE_TTL_MS : CACHE_EMPTY_TTL_MS)
  });
}

function normalizeImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizeTmdbId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parts = raw.split(":");
  const candidate = parts[0].toLowerCase() === "tmdb" ? parts.slice(1) : parts;
  return candidate.find((part) => /^\d+$/.test(String(part || "").trim())) || "";
}

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function toSkipInterval(segment, type) {
  if (!segment || typeof segment !== "object") {
    return null;
  }
  const start = Number.isFinite(Number(segment.start_sec))
    ? Number(segment.start_sec)
    : Number.isFinite(Number(segment.start_ms))
      ? Number(segment.start_ms) / 1000
      : NaN;
  const end = Number.isFinite(Number(segment.end_sec))
    ? Number(segment.end_sec)
    : Number.isFinite(Number(segment.end_ms))
      ? Number(segment.end_ms) / 1000
      : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    return null;
  }
  return {
    startTime: start,
    endTime: end,
    type,
    provider: "introdb"
  };
}

export function mapIntroDbSegmentsToSkipIntervals(data = {}, { isMovie = false } = {}) {
  if (!isMovie) {
    return [
      toSkipInterval(data?.intro, "intro"),
      toSkipInterval(data?.recap, "recap"),
      toSkipInterval(data?.outro, "outro")
    ]
      .filter(Boolean)
      .sort((left, right) => left.startTime - right.startTime);
  }

  const credits = toSkipInterval(data?.outro, "movie-credits");
  const scene = toSkipInterval(data?.post_credits, "post-credits");
  const safeCredits =
    credits && scene && scene.startTime < credits.endTime && scene.endTime > credits.startTime
      ? { ...credits, endTime: scene.startTime }
      : credits;
  return [safeCredits, scene]
    .filter(Boolean)
    .filter((interval) => interval.endTime > interval.startTime)
    .sort((left, right) => left.startTime - right.startTime);
}

/** AniSkip already reports explicit segment ends; only the type mapping is needed. */
export function mapAniSkipPayload(payload = {}) {
  if (!payload?.found || !Array.isArray(payload.results)) {
    return [];
  }
  return payload.results
    .map((result) => {
      const start = Number(result?.interval?.startTime);
      const end = Number(result?.interval?.endTime);
      const type = String(result?.skipType || "").trim();
      if (!type || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return { startTime: start, endTime: end, type, provider: "aniskip" };
    })
    .filter(Boolean);
}

function animeSkipType(name) {
  switch (
    String(name || "")
      .trim()
      .toLowerCase()
  ) {
    case "intro":
    case "new intro":
      return "op";
    case "credits":
    case "new credits":
      return "ed";
    case "mixed intro":
      return "mixed-op";
    case "mixed credits":
      return "mixed-ed";
    case "recap":
      return "recap";
    default:
      return null;
  }
}

/**
 * Anime-Skip timestamps only mark where a segment starts; each ends where the next begins.
 * Only an ending may run to the end of the episode, and only when it starts in the second half;
 * an open-ended intro or recap is dropped instead of stretching over the whole episode.
 */
export function animeSkipTimestampsToIntervals(timestamps = [], baseDuration = null) {
  const sorted = (Array.isArray(timestamps) ? timestamps : [])
    .map((timestamp) => ({ at: Number(timestamp?.at), name: timestamp?.type?.name }))
    .filter((timestamp) => Number.isFinite(timestamp.at) && timestamp.at >= 0)
    .sort((left, right) => left.at - right.at);
  const intervals = [];
  sorted.forEach((timestamp, index) => {
    const type = animeSkipType(timestamp.name);
    if (!type) {
      return;
    }
    const next = sorted[index + 1] || null;
    let endTime = null;
    if (next && next.at > timestamp.at) {
      endTime = next.at;
    } else if (
      segmentCategory(type) === "ending" &&
      (baseDuration == null || timestamp.at >= Number(baseDuration) / 2)
    ) {
      endTime = OPEN_ENDED_END_SECONDS;
    }
    if (endTime == null || endTime <= timestamp.at) {
      return;
    }
    intervals.push({
      startTime: timestamp.at,
      endTime,
      type,
      provider: "animeskip"
    });
  });
  return intervals;
}

/**
 * A show can hold several community entries for the same episode, some incomplete. Pick the one
 * covering the most categories, then the one with the most segments.
 */
export function bestAnimeSkipIntervals(episodes = []) {
  let best = [];
  (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
    const intervals = animeSkipTimestampsToIntervals(
      episode?.timestamps,
      Number(episode?.baseDuration) || null
    );
    if (!intervals.length) {
      return;
    }
    const categories = new Set(
      intervals.map((interval) => segmentCategory(interval.type)).filter(Boolean)
    );
    const bestCategories = new Set(
      best.map((interval) => segmentCategory(interval.type)).filter(Boolean)
    );
    if (
      !best.length ||
      categories.size > bestCategories.size ||
      (categories.size === bestCategories.size && intervals.length > best.length)
    ) {
      best = intervals;
    }
  });
  return best;
}

/**
 * Fill each segment category (opening / ending / recap) from the first provider that has it.
 * Lists must be passed in priority order: IntroDB, AniSkip, Anime-Skip.
 */
export function mergeSkipIntervalsByPriority(providerLists = []) {
  const chosen = new Map();
  (Array.isArray(providerLists) ? providerLists : []).forEach((intervals) => {
    (Array.isArray(intervals) ? intervals : []).forEach((interval) => {
      const category = segmentCategory(interval?.type);
      if (!category || chosen.has(category)) {
        return;
      }
      chosen.set(category, interval);
    });
  });
  return [...chosen.values()];
}

async function fetchJson(url, options = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Platform.isTizen() || Platform.isWebOS() ? 8000 : 3500;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
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

async function fetchFromIntroDb(imdbId, season, episode) {
  const baseUrl = normalizeBaseUrl(INTRODB_API_URL);
  if (!baseUrl || !imdbId) {
    return [];
  }
  const url = new URL("segments", baseUrl);
  url.searchParams.set("imdb_id", imdbId);
  url.searchParams.set("season", String(season));
  url.searchParams.set("episode", String(episode));
  const data = await fetchJson(url.toString());
  return mapIntroDbSegmentsToSkipIntervals(data);
}

async function fetchFromAniSkip(malId, episode) {
  const baseUrl = normalizeBaseUrl(ANISKIP_API_URL);
  if (!baseUrl || !malId || !Number.isFinite(Number(episode)) || Number(episode) <= 0) {
    return [];
  }
  const url = new URL(`skip-times/${encodeURIComponent(malId)}/${Number(episode)}`, baseUrl);
  ["op", "ed", "recap", "mixed-op", "mixed-ed"].forEach((type) =>
    url.searchParams.append("types[]", type)
  );
  url.searchParams.set("episodeLength", "0");
  return mapAniSkipPayload(await fetchJson(url.toString()));
}

function readAnimeSkipShowIds(anilistId) {
  const entry = ANIME_SKIP_SHOW_ID_CACHE.get(String(anilistId));
  if (!entry || entry.expiresAt <= Date.now()) {
    ANIME_SKIP_SHOW_ID_CACHE.delete(String(anilistId));
    return null;
  }
  return entry.ids;
}

async function resolveAnimeSkipShowIds(anilistId, clientId) {
  const key = String(anilistId);
  const cached = readAnimeSkipShowIds(key);
  if (cached) {
    return cached;
  }
  const baseUrl = normalizeBaseUrl(ANIME_SKIP_API_URL);
  if (!baseUrl) {
    return [];
  }
  const data = await fetchJson(new URL("graphql", baseUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
    body: JSON.stringify({
      query: `{ findShowsByExternalId(service: ANILIST, serviceId: "${key}") { id } }`
    })
  });
  const ids = (data?.data?.findShowsByExternalId || [])
    .map((show) => String(show?.id || "").trim())
    .filter(Boolean);
  if (ANIME_SKIP_SHOW_ID_CACHE.size >= 100) {
    ANIME_SKIP_SHOW_ID_CACHE.delete(ANIME_SKIP_SHOW_ID_CACHE.keys().next().value);
  }
  ANIME_SKIP_SHOW_ID_CACHE.set(key, { ids, expiresAt: Date.now() + ANIME_SKIP_SHOW_ID_TTL_MS });
  return ids;
}

async function fetchFromAnimeSkip(anilistId, episode, season = null) {
  const settings = AnimeSkipSettingsStore.get();
  if (!settings?.enabled || !settings?.clientId || !anilistId) {
    return [];
  }
  const baseUrl = normalizeBaseUrl(ANIME_SKIP_API_URL);
  if (!baseUrl) {
    return [];
  }
  try {
    const showIds = await resolveAnimeSkipShowIds(anilistId, settings.clientId);
    for (const showId of showIds) {
      const data = await fetchJson(new URL("graphql", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-ID": settings.clientId },
        body: JSON.stringify({
          query: `{ findEpisodesByShowId(showId: "${showId}") { season number baseDuration timestamps { at type { name } } } }`
        })
      });
      const episodes = data?.data?.findEpisodesByShowId;
      if (!Array.isArray(episodes) || !episodes.length) {
        continue;
      }
      const matching = episodes.filter(
        (entry) =>
          Number(entry?.number) === Number(episode) &&
          (season == null || Number(entry?.season) === Number(season))
      );
      // Season numbering can differ between the add-on and Anime-Skip; prefer the
      // matching season but still use the unfiltered pool when it is empty.
      const pool = matching.length
        ? matching
        : episodes.filter((entry) => Number(entry?.number) === Number(episode));
      const result = bestAnimeSkipIntervals(pool);
      if (result.length) {
        return result;
      }
    }
  } catch (_) {
    return [];
  }
  return [];
}

export const skipIntroRepository = {
  async getSkipIntervals(imdbId, season, episode, options = {}) {
    const normalizedImdbId = normalizeImdbId(imdbId);
    const seasonNumber = Number(season || 0);
    const episodeNumber = Number(episode || 0);
    if (seasonNumber <= 0 || episodeNumber <= 0) {
      return [];
    }
    const animeSkipSettings = AnimeSkipSettingsStore.get();
    const animeSkipKey =
      animeSkipSettings?.enabled === true
        ? `animeskip:${String(animeSkipSettings.clientId || "")}`
        : "animeskip:off";
    const cacheKey = `${normalizedImdbId || "noimdb"}:${seasonNumber}:${episodeNumber}:${animeSkipKey}`;
    const cached = readCache(cacheKey);
    if (cached) {
      return cached;
    }

    // IntroDB does not depend on the anime ids: start it while Simkl resolves.
    const introDbPromise = normalizedImdbId
      ? fetchFromIntroDb(normalizedImdbId, seasonNumber, episodeNumber)
      : Promise.resolve([]);
    const animeIds = await animeIdResolver
      .resolveAnimeIds({
        imdbId: normalizedImdbId,
        contentId: options.contentId || "",
        videoId: options.videoId || "",
        season: seasonNumber
      })
      .catch(() => null);
    const animeEpisode =
      animeIds?.simklId != null
        ? await animeIdResolver
            .resolveAnimeEpisode({
              simklId: animeIds.simklId,
              season: seasonNumber,
              episode: episodeNumber
            })
            .catch(() => episodeNumber)
        : episodeNumber;

    const [introDb, aniSkip, animeSkip] = await Promise.all([
      introDbPromise,
      animeIds?.mal ? fetchFromAniSkip(animeIds.mal, animeEpisode) : Promise.resolve([]),
      animeIds?.anilist
        ? fetchFromAnimeSkip(animeIds.anilist, animeEpisode, seasonNumber)
        : Promise.resolve([])
    ]);
    const intervals = mergeSkipIntervalsByPriority([introDb, aniSkip, animeSkip]);
    writeCache(cacheKey, intervals);
    return intervals;
  },

  async getMovieSkipIntervals({ imdbId = "", tmdbId = "", contentId = "", videoId = "" } = {}) {
    const baseUrl = normalizeBaseUrl(INTRODB_API_URL);
    if (!baseUrl) {
      return [];
    }

    const candidates = [imdbId, videoId, contentId]
      .map((value) => normalizeImdbId(value))
      .filter(Boolean);
    let normalizedImdbId = candidates[0] || "";
    if (!normalizedImdbId) {
      const normalizedTmdbId = [tmdbId, contentId, videoId]
        .map((value) => normalizeTmdbId(value))
        .find(Boolean);
      if (normalizedTmdbId) {
        normalizedImdbId = (await TmdbService.tmdbToImdb(normalizedTmdbId, "movie")) || "";
      }
    }
    if (!normalizedImdbId) {
      return [];
    }

    const cacheKey = `movie:${normalizedImdbId}`;
    const cached = readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL("segments", baseUrl);
    url.searchParams.set("imdb_id", normalizedImdbId);
    url.searchParams.set("is_movie", "true");
    const data = await fetchJson(url.toString());
    const intervals = mapIntroDbSegmentsToSkipIntervals(data, { isMovie: true });
    writeCache(cacheKey, intervals);
    return intervals;
  }
};
