import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";
import {
  MoreLikeThisSourcePreference,
  TraktSettingsStore,
  WatchProgressSource
} from "../../../data/local/traktSettingsStore.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import {
  DEFAULT_POST_PLAY_MOVIE_THRESHOLD_PERCENT,
  MAX_POST_PLAY_MOVIE_THRESHOLD_PERCENT,
  MIN_POST_PLAY_MOVIE_THRESHOLD_PERCENT,
  PlayerSettingsStore,
  normalizePostPlayMovieThreshold
} from "../../../data/local/playerSettingsStore.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { isUnreleased } from "../../../core/util/releaseInfoUtils.js";
import { showStandardDetailRatings } from "../../../core/util/imdbRatingVisibility.js";
import { toTraktImageUrl } from "../../../core/trakt/traktImageUrl.js";
import { YOUTUBE_PROXY_URL } from "../../../config.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { isWatchProgressCompleted } from "../../../domain/model/watchProgress.js";
import {
  requestJson as traktRequestJson,
  TraktAuthService
} from "../../../data/repository/traktAuthService.js";
import { moviePostPlayTriggerSeconds } from "../../../core/player/skipIntervalRules.js";

// These values are the Android TV PostPlayRecommendation constants expressed
// in the same units used by the browser player.
export const POST_PLAY_RECOMMENDATION_PREFETCH_PROGRESS = 0.9;
export const POST_PLAY_RECOMMENDATION_PREFETCH_REMAINING_MS = 10 * 60 * 1000;
export const POST_PLAY_RECOMMENDATION_TRAILER_COUNTDOWN_SECONDS = 5;
export const POST_PLAY_RECOMMENDATION_TRANSITION_MS = 420;
export const POST_PLAY_RECOMMENDATION_TRAILER_TIMEOUT_MS = 15_000;
export const POST_PLAY_RECOMMENDATION_CANDIDATE_TIMEOUT_MS = 12_000;
export const POST_PLAY_RECOMMENDATION_META_TIMEOUT_MS = 8_000;
export const POST_PLAY_RECOMMENDATION_LOAD_TIMEOUT_MS = 10_000;
export const POST_PLAY_RECOMMENDATION_MIN_MOVIE_THRESHOLD_PERCENT =
  MIN_POST_PLAY_MOVIE_THRESHOLD_PERCENT;
export const POST_PLAY_RECOMMENDATION_MAX_MOVIE_THRESHOLD_PERCENT =
  MAX_POST_PLAY_MOVIE_THRESHOLD_PERCENT;
export const POST_PLAY_RECOMMENDATION_DEFAULT_MOVIE_THRESHOLD_PERCENT =
  DEFAULT_POST_PLAY_MOVIE_THRESHOLD_PERCENT;

// Smart TV has the local YouTube proxy used by the existing detail/player
// trailer flow. This is the equivalent of Android's full-flavor
// AppFeaturePolicy.inAppTrailerPlaybackEnabled flag.
export const POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED = true;

const POST_PLAY_RECOMMENDATION_FINAL_COUNTDOWN_SECONDS = 5;
const POST_PLAY_RECOMMENDATION_SEARCH_TIMEOUT_MS = 4_000;
const POST_PLAY_RECOMMENDATION_WATCHED_TIMEOUT_MS = 4_000;
const TRAKT_RELATED_CACHE_TTL_MS = 10 * 60 * 1000;
const traktRelatedCache = new Map();

function withTimeout(promise, timeoutMs, fallbackValue) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), Math.max(0, Number(timeoutMs) || 0));
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function firstNonBlank(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function numericOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContentType(value, fallback = "movie") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["series", "tv", "show", "tvshow"].includes(normalized)) {
    return "series";
  }
  if (["movie", "film"].includes(normalized)) {
    return "movie";
  }
  return fallback === "series" ? "series" : "movie";
}

function isSupportedPostPlayContentType(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return !normalized || ["movie", "film", "series", "tv", "show", "tvshow"].includes(normalized);
}

function resolvePostPlayContentType(value, fallback = null) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["movie", "film"].includes(normalized)) {
    return "movie";
  }
  if (["series", "tv", "show", "tvshow"].includes(normalized)) {
    return "series";
  }
  const fallbackType = String(fallback ?? "")
    .trim()
    .toLowerCase();
  if (["movie", "film"].includes(fallbackType)) {
    return "movie";
  }
  if (["series", "tv", "show", "tvshow"].includes(fallbackType)) {
    return "series";
  }
  return null;
}

export function postPlayRecommendationPrefetchProgress(
  contentType = "movie",
  movieThresholdPercent = POST_PLAY_RECOMMENDATION_DEFAULT_MOVIE_THRESHOLD_PERCENT,
  durationMs = 0,
  skipIntervals = [],
  episodeThresholdMode = "PERCENTAGE",
  episodeThresholdPercent = 99,
  episodeThresholdMinutesBeforeEnd = 2
) {
  if (normalizeContentType(contentType) === "series") {
    return POST_PLAY_RECOMMENDATION_PREFETCH_PROGRESS;
  }
  const duration = Number(durationMs);
  const triggerSeconds = moviePostPlayTriggerSeconds({
    durationSeconds: duration > 0 ? duration / 1000 : 0,
    movieThresholdPercent,
    skipIntervals,
    episodeThresholdMode,
    episodeThresholdPercent,
    episodeThresholdMinutesBeforeEnd
  });
  const triggerProgress =
    triggerSeconds != null && duration > 0
      ? triggerSeconds / (duration / 1000)
      : normalizePostPlayMovieThreshold(movieThresholdPercent) / 100;
  return Math.max(0, triggerProgress - 0.05);
}

export function shouldPrefetchPostPlayRecommendation({
  contentType = "movie",
  positionMs = 0,
  durationMs = 0,
  movieThresholdPercent = POST_PLAY_RECOMMENDATION_DEFAULT_MOVIE_THRESHOLD_PERCENT,
  skipIntervals = [],
  episodeThresholdMode = "PERCENTAGE",
  episodeThresholdPercent = 99,
  episodeThresholdMinutesBeforeEnd = 2
} = {}) {
  if (!isSupportedPostPlayContentType(contentType)) {
    return false;
  }
  const position = Number(positionMs);
  const duration = Number(durationMs);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0) {
    return false;
  }
  const progress = Math.max(0, Math.min(1, position / duration));
  const remaining = Math.max(0, duration - position);
  return (
    progress >=
      postPlayRecommendationPrefetchProgress(
        contentType,
        movieThresholdPercent,
        duration,
        skipIntervals,
        episodeThresholdMode,
        episodeThresholdPercent,
        episodeThresholdMinutesBeforeEnd
      ) || remaining <= POST_PLAY_RECOMMENDATION_PREFETCH_REMAINING_MS
  );
}

export function shouldShowPostPlayRecommendation({
  contentType = "movie",
  positionMs = 0,
  durationMs = 0,
  movieThresholdPercent = POST_PLAY_RECOMMENDATION_DEFAULT_MOVIE_THRESHOLD_PERCENT,
  skipIntervals = [],
  episodeThresholdMode = "PERCENTAGE",
  episodeThresholdPercent = 99,
  episodeThresholdMinutesBeforeEnd = 2,
  seriesThresholdReached = false,
  playbackEnded = false
} = {}) {
  if (!isSupportedPostPlayContentType(contentType)) {
    return false;
  }
  if (playbackEnded) {
    return true;
  }
  const position = Number(positionMs);
  const duration = Number(durationMs);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0) {
    return false;
  }
  if (normalizeContentType(contentType) === "series") {
    return Boolean(seriesThresholdReached);
  }
  const triggerSeconds = moviePostPlayTriggerSeconds({
    durationSeconds: duration / 1000,
    movieThresholdPercent,
    skipIntervals,
    episodeThresholdMode,
    episodeThresholdPercent,
    episodeThresholdMinutesBeforeEnd
  });
  return triggerSeconds != null && position / 1000 >= triggerSeconds;
}

export function postPlayRecommendationCountdownSeconds(positionMs = 0, durationMs = 0) {
  const position = Number(positionMs);
  const duration = Number(durationMs);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const remainingSeconds = Math.ceil(Math.max(0, duration - position) / 1000);
  if (remainingSeconds > POST_PLAY_RECOMMENDATION_FINAL_COUNTDOWN_SECONDS) {
    return null;
  }
  return Math.max(1, Math.min(POST_PLAY_RECOMMENDATION_FINAL_COUNTDOWN_SECONDS, remainingSeconds));
}

export function isShortPostPlayPlaceholderDuration(durationMs) {
  const duration = Number(durationMs);
  return Number.isFinite(duration) && duration >= 1 && duration <= 120_999;
}

export function shouldUsePostPlayRecommendation({
  enabled = true,
  contentType = "movie",
  nextEpisodeMetadataResolved = true,
  nextEpisodeHasAired = null
} = {}) {
  if (!enabled || !isSupportedPostPlayContentType(contentType)) {
    return false;
  }
  if (normalizeContentType(contentType) === "movie") {
    return true;
  }
  return Boolean(nextEpisodeMetadataResolved) && nextEpisodeHasAired !== true;
}

function normalizedId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function idVariants(value) {
  const raw = normalizedId(value);
  // Android compares the canonical ids exactly (trimmed and lower-cased).
  // Do not collapse provider prefixes or episode suffixes here: `trakt:42`,
  // `tmdb:42`, and `42` are distinct candidate identities on Android.
  return raw ? [raw] : [];
}

function idSetFromValues(values = []) {
  const set = new Set();
  values.forEach((value) => idVariants(value).forEach((entry) => set.add(entry)));
  return set;
}

function normalizeGenres(value) {
  if (!Array.isArray(value)) {
    if (typeof value === "string") {
      return value
        .split(/[|,•/]/)
        .map((entry) => normalizeText(entry))
        .filter(Boolean);
    }
    return [];
  }
  return value
    .map((entry) =>
      typeof entry === "object"
        ? firstNonBlank(entry.name, entry.title, entry.label)
        : normalizeText(entry)
    )
    .filter(Boolean)
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) => candidate.toLowerCase() === entry.toLowerCase()) === index
    );
}

function normalizeContentLanguage(language, country, fallback = "") {
  const languageValue = normalizeText(language).replace(/_/g, "-").toLowerCase();
  if (languageValue && languageValue.length >= 2) {
    return languageValue;
  }
  const countryValue = normalizeText(country).split(/[;,]/)[0].toLowerCase();
  if (countryValue.length === 2) {
    return countryValue;
  }
  return normalizeText(fallback).replace(/_/g, "-").toLowerCase();
}

function bestTraktArtwork(images = {}, kind) {
  const candidates = images?.[kind];
  const normalize = (value) => toTraktImageUrl(value);
  if (Array.isArray(candidates)) {
    return candidates.map(normalize).find(Boolean) || "";
  }
  if (typeof candidates === "string") {
    return normalize(candidates);
  }
  if (candidates && typeof candidates === "object") {
    return (
      [candidates.full, candidates.medium, candidates.thumb].map(normalize).find(Boolean) || ""
    );
  }
  return "";
}

function bestTraktPoster(images = {}) {
  // Android's TraktRelatedService stores traktBestLandscapeUrl() in both
  // `poster` and `rawPosterUrl`: thumb -> fanart -> banner -> poster.
  return (
    ["thumb", "fanart", "banner", "poster"]
      .map((kind) => bestTraktArtwork(images, kind))
      .find(Boolean) || ""
  );
}

function bestTraktBackdrop(images = {}) {
  return (
    ["fanart", "banner", "thumb", "poster"]
      .map((kind) => bestTraktArtwork(images, kind))
      .find(Boolean) || ""
  );
}

function normalizeTraktCandidate(media = {}, contentType = "movie") {
  const ids = media?.ids || {};
  const fallbackId = ids.trakt != null ? `trakt:${ids.trakt}` : firstNonBlank(ids.slug);
  const id = firstNonBlank(
    ids.imdb,
    ids.tmdb != null ? `tmdb:${ids.tmdb}` : "",
    ids.trakt != null ? `trakt:${ids.trakt}` : "",
    fallbackId
  );
  if (!id) {
    return null;
  }
  const title = firstNonBlank(media.title, media.original_title, media.name);
  if (!title) {
    return null;
  }
  const poster = bestTraktPoster(media.images);
  const backdrop = bestTraktBackdrop(media.images);
  const normalizedType = normalizeContentType(contentType);
  const releaseDate = firstNonBlank(
    normalizedType === "series" ? media.first_aired : media.released,
    media.released,
    media.first_aired
  );
  const releaseInfo =
    media.year == null ? String(releaseDate || "").slice(0, 4) : String(media.year);
  const language = Array.isArray(media.languages) ? firstNonBlank(media.languages[0]) : "";
  const rating = numericOrNull(media.rating);
  return {
    id,
    type: normalizedType,
    apiType: normalizedType,
    name: title,
    title,
    poster,
    rawPosterUrl: poster,
    posterShape: "landscape",
    background: backdrop,
    backdrop,
    landscapePoster: backdrop,
    releaseInfo,
    released: releaseDate,
    description: firstNonBlank(media.overview, media.description),
    genres: normalizeGenres(media.genres),
    runtime: numericOrNull(media.runtime),
    status: firstNonBlank(media.status),
    ageRating: firstNonBlank(media.certification),
    language: language || null,
    country: firstNonBlank(media.country),
    imdbRating: rating,
    logo:
      bestTraktArtwork(media.images, "logo") || bestTraktArtwork(media.images, "clearart") || "",
    imdbId: ids.imdb || null,
    tmdbId: ids.tmdb == null ? null : String(ids.tmdb),
    traktId: ids.trakt == null ? null : String(ids.trakt),
    slug: ids.slug || null,
    sourceAddonBaseUrl: ""
  };
}

function resolveTmdbIdFromValue(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(?:tmdb:)?(\d+)(?::.*)?$/i);
  return match?.[1] || "";
}

function resolveImdbIdFromValue(value) {
  const match = String(value || "")
    .trim()
    .match(/(tt\d+)/i);
  return match?.[1] || "";
}

function resolveTraktIdFromValue(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^trakt:(\d+)/i);
  return match?.[1] || (/^\d+$/.test(raw) ? raw : "");
}

function resolveTraktPathIdFromIds(ids = {}, fallback = "") {
  const imdbId = firstNonBlank(ids?.imdb);
  if (imdbId) {
    return imdbId;
  }
  const traktId = firstNonBlank(ids?.trakt);
  if (traktId) {
    return traktId;
  }
  return firstNonBlank(ids?.slug, fallback);
}

function resolveDirectTraktPathId(meta = {}, fallbackItemId = "") {
  const directImdbId = firstNonBlank(meta.imdbId, meta.imdb_id);
  if (directImdbId) {
    return directImdbId;
  }

  const metaImdbId = resolveImdbIdFromValue(meta.id);
  if (metaImdbId) {
    return metaImdbId;
  }
  const metaTraktId = resolveTraktIdFromValue(meta.id);
  if (metaTraktId) {
    return metaTraktId;
  }

  const slug = firstNonBlank(meta.slug);
  if (slug) {
    return slug;
  }

  const fallbackImdbId = resolveImdbIdFromValue(fallbackItemId);
  if (fallbackImdbId) {
    return fallbackImdbId;
  }
  return resolveTraktIdFromValue(fallbackItemId);
}

function resolveTraktTmdbId(meta = {}, fallbackItemId = "") {
  return firstNonBlank(resolveTmdbIdFromValue(meta.id), resolveTmdbIdFromValue(fallbackItemId));
}

function normalizeCandidateSeed(item = {}, fallbackType = "movie") {
  const contentType = normalizeContentType(item.type || item.apiType, fallbackType);
  const id = firstNonBlank(item.id, item.videoId);
  if (!id) {
    return null;
  }
  return {
    ...item,
    id,
    type: contentType,
    apiType: contentType,
    title: firstNonBlank(item.title, item.name, "Untitled"),
    name: firstNonBlank(item.name, item.title, "Untitled"),
    poster: firstNonBlank(item.poster, item.rawPosterUrl),
    backdrop: firstNonBlank(item.backdrop, item.background, item.landscapePoster),
    background: firstNonBlank(item.background, item.backdrop, item.landscapePoster, item.poster),
    landscapePoster: firstNonBlank(
      item.landscapePoster,
      item.background,
      item.backdrop,
      item.poster
    ),
    sourceAddonBaseUrl: firstNonBlank(item.sourceAddonBaseUrl, item.addonBaseUrl),
    releaseInfo: firstNonBlank(item.releaseInfo, item.year),
    released: firstNonBlank(item.released),
    description: firstNonBlank(item.description, item.overview),
    genres: normalizeGenres(item.genres),
    imdbId: firstNonBlank(item.imdbId, item.imdb_id, resolveImdbIdFromValue(id)) || null,
    tmdbId: firstNonBlank(item.tmdbId, item.tmdb_id, resolveTmdbIdFromValue(id)) || null,
    traktId: firstNonBlank(item.traktId, item.trakt_id, resolveTraktIdFromValue(id)) || null
  };
}

function resolveTrailerId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  try {
    const url = new URL(raw, "https://www.youtube.com");
    const queryId = url.searchParams.get("v");
    if (queryId && /^[A-Za-z0-9_-]{11}$/.test(queryId)) {
      return queryId;
    }
    const pathMatch = url.pathname.match(/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/i);
    if (pathMatch) {
      return pathMatch[1];
    }
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace(/^\//, "").split(/[/?#]/)[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
  } catch (_) {
    return "";
  }
  return "";
}

function resolveTrailerAsset(...values) {
  const entries = values.flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));
  const ordered = [
    ...entries.filter((entry) => String(entry?.type || "").toLowerCase() === "trailer"),
    ...entries.filter((entry) => String(entry?.type || "").toLowerCase() === "teaser"),
    ...entries
  ];
  const seen = new Set();
  for (const entry of ordered) {
    const candidate =
      typeof entry === "string"
        ? entry
        : entry?.ytId || entry?.youtubeId || entry?.key || entry?.url || entry?.videoUrl;
    const raw = String(candidate || "").trim();
    if (!raw || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    const ytId = resolveTrailerId(raw);
    if (ytId) {
      return { ytId, url: "", kind: "youtube" };
    }
    if (/^https?:\/\//i.test(raw)) {
      return { ytId: "", url: raw, kind: "direct" };
    }
  }
  return { ytId: "", url: "", kind: "" };
}

function buildInlineYoutubePlayerUrl(ytId) {
  const id = resolveTrailerId(ytId);
  if (!id) {
    return "";
  }
  const configured = String(YOUTUBE_PROXY_URL || "").trim();
  const proxyBase = configured || "youtube-proxy.html";
  const params = new URLSearchParams({
    v: id,
    autoplay: "1",
    muted: "0",
    controls: "0",
    loop: "0",
    playsinline: "1",
    rel: "0",
    cc_load_policy: "0",
    state_poll_ms: "500",
    _cb: String(Date.now())
  });
  try {
    const url = new URL(proxyBase, globalThis?.location?.href || "https://nuvio.tv/");
    url.search = params.toString();
    return url.toString();
  } catch (_) {
    return `${proxyBase}?${params.toString()}`;
  }
}

function isMdbListActive() {
  const settings = MdbListSettingsStore.get();
  return Boolean(settings.enabled && String(settings.apiKey || "").trim());
}

function resolveRating(meta = {}, candidate = {}) {
  return numericOrNull(
    meta.imdbRating ??
      meta.imdb_rating ??
      meta.ratings?.imdb ??
      meta.rating?.imdb ??
      candidate.imdbRating ??
      candidate.imdb_rating
  );
}

function projectRecommendation({
  meta = {},
  candidate = {},
  enrichment = null,
  contentType = "movie",
  contentLanguage = ""
} = {}) {
  const tmdbSettings = TmdbSettingsStore.get();
  const layoutSettings = LayoutPreferences.get();
  const type = normalizeContentType(contentType || meta.type || candidate.type);
  const baseTitle = firstNonBlank(meta.name, candidate.name, "Untitled");
  const basePoster = firstNonBlank(
    meta.rawPosterUrl,
    meta.poster,
    candidate.rawPosterUrl,
    candidate.poster
  );
  const baseBackdrop = firstNonBlank(
    meta.background,
    meta.landscapePoster,
    candidate.background,
    candidate.landscapePoster,
    basePoster
  );
  const baseLogo = firstNonBlank(meta.logo, candidate.logo);
  const useArtwork = Boolean(tmdbSettings.enabled && tmdbSettings.useArtwork);
  const useBasicInfo = Boolean(tmdbSettings.enabled && tmdbSettings.useBasicInfo);
  const useDetails = Boolean(tmdbSettings.enabled && tmdbSettings.useDetails);
  const title = useBasicInfo ? firstNonBlank(enrichment?.localizedTitle, baseTitle) : baseTitle;
  const poster = basePoster;
  const backdrop = useArtwork ? firstNonBlank(enrichment?.backdrop, baseBackdrop) : baseBackdrop;
  const logo = useArtwork ? firstNonBlank(enrichment?.logo, baseLogo) : baseLogo;
  const description = useBasicInfo
    ? firstNonBlank(enrichment?.description, meta.description, candidate.description)
    : firstNonBlank(meta.description, candidate.description);
  const releaseInfo = firstNonBlank(meta.releaseInfo, candidate.releaseInfo);
  const released = firstNonBlank(meta.released, candidate.released);
  const genres =
    useBasicInfo && normalizeGenres(enrichment?.genres).length
      ? normalizeGenres(enrichment.genres)
      : normalizeGenres(meta.genres).length
        ? normalizeGenres(meta.genres)
        : normalizeGenres(candidate.genres);
  const runtime = useDetails
    ? firstNonBlank(enrichment?.runtime, meta.runtime, candidate.runtime)
    : firstNonBlank(meta.runtime, candidate.runtime);
  const country = useDetails
    ? firstNonBlank(enrichment?.country, meta.country, candidate.country)
    : firstNonBlank(meta.country, candidate.country);
  const language = useDetails
    ? // Android's TmdbEnrichment.language is the original_language code. The
      // Smart service also keeps the spoken-language projection for the rest of
      // the app, so the post-play projection must explicitly prefer the
      // original-language field here.
      firstNonBlank(enrichment?.originalLanguage, meta.language, candidate.language)
    : firstNonBlank(meta.language, candidate.language);
  const status = useDetails
    ? firstNonBlank(enrichment?.status, meta.status, candidate.status)
    : firstNonBlank(meta.status, candidate.status);
  const ageRating = useDetails
    ? firstNonBlank(enrichment?.ageRating, meta.ageRating, candidate.ageRating)
    : firstNonBlank(meta.ageRating, candidate.ageRating);
  const normalizedMeta = {
    ...meta,
    id: firstNonBlank(candidate.id, meta.id),
    type: type === "series" ? "series" : "movie"
  };
  const rawTmdbId = firstNonBlank(
    meta.tmdbId,
    meta.tmdb_id,
    meta.ids?.tmdb,
    meta.externalIds?.tmdb,
    meta.external_ids?.tmdb,
    enrichment?.tmdbId,
    candidate.tmdbId,
    resolveTmdbIdFromValue(candidate.id)
  );
  const ids = {
    imdbId:
      firstNonBlank(
        meta.imdbId,
        meta.imdb_id,
        meta.externalIds?.imdb,
        meta.external_ids?.imdb_id,
        candidate.imdbId,
        resolveImdbIdFromValue(candidate.id)
      ) || null,
    tmdbId: resolveTmdbIdFromValue(rawTmdbId) || null,
    traktId:
      firstNonBlank(
        meta.traktId,
        meta.trakt_id,
        meta.ids?.trakt,
        meta.externalIds?.trakt,
        meta.external_ids?.trakt,
        candidate.traktId,
        resolveTraktIdFromValue(candidate.id)
      ) || null
  };
  return {
    id: firstNonBlank(candidate.id, meta.id),
    contentType: type,
    apiType: type,
    title,
    name: title,
    poster,
    backdrop,
    background: backdrop,
    landscapePoster: backdrop || poster,
    logo,
    description,
    releaseInfo,
    released,
    genres,
    runtime,
    country,
    language,
    originalLanguage: firstNonBlank(
      enrichment?.originalLanguage,
      meta.originalLanguage,
      candidate.originalLanguage
    ),
    contentLanguage: normalizeContentLanguage(language, country, contentLanguage),
    status,
    ageRating,
    imdbId: ids.imdbId,
    tmdbId: ids.tmdbId,
    traktId: ids.traktId,
    imdbRating: resolveRating(normalizedMeta, candidate),
    // Android exposes the TMDB rating in this row only when the optional
    // TMDB enrichment actually returned a rating. The source/candidate
    // ratings are not used as a fallback for this field.
    tmdbRating: useBasicInfo ? numericOrNull(enrichment?.rating) : null,
    sourceAddonBaseUrl: firstNonBlank(candidate.sourceAddonBaseUrl, meta.sourceAddonBaseUrl),
    // Android resolves the post-play trailer in the separate TrailerService
    // detail phase. Keep the initial recommendation state trailer-free so the
    // button appears only after that same asynchronous phase completes.
    trailerYtId: "",
    trailerVideoUrl: "",
    trailerKind: "",
    mdbListRatings: null,
    showStandardRatings: showStandardDetailRatings(
      layoutSettings.homeImdbRatingsVisibility,
      isMdbListActive()
    ),
    detailsLoaded: Boolean(enrichment),
    rawMeta: meta,
    rawCandidate: candidate
  };
}

function candidateIdentity(candidate = {}) {
  return `${normalizeContentType(candidate.contentType || candidate.type)}:${normalizedId(candidate.id)}`;
}

function currentIdentityValues(snapshot = {}, meta = {}) {
  // Android excludes only the current metadata id and the player content id.
  // External ids remain available for the watched/IMDb alias checks but do
  // not suppress an otherwise valid related candidate.
  return [meta.id, snapshot.contentId];
}

function watchedEntryIsRelevant(entry = {}, contentType = "movie", sourceKind = "progress") {
  const season = entry?.season;
  const episode = entry?.episode;
  const isRoot = season == null && episode == null;
  if (sourceKind === "watched") {
    return isRoot;
  }
  if (sourceKind === "completedMovie" || sourceKind === "completedSeries") {
    // Episode progress must never mark the parent movie/series as watched.
    // Android receives movie ids and fully-watched-series ids as separate
    // projections, both of which contain root-level completed entries only.
    return isRoot && isWatchProgressCompleted(entry);
  }
  if (normalizeContentType(contentType) === "movie") {
    return isRoot || isWatchProgressCompleted(entry);
  }
  return (
    isRoot &&
    (entry?.source === "watched" || entry?.watched === true || isWatchProgressCompleted(entry))
  );
}

function watchedIdentitySet(items = [], contentType = "movie", sourceKind = "progress") {
  const result = new Set();
  (Array.isArray(items) ? items : []).forEach((entry) => {
    if (!watchedEntryIsRelevant(entry, contentType, sourceKind)) {
      return;
    }
    // Android's watched projections contain canonical content ids only. The
    // candidate IMDb alias is checked separately in candidateIsWatched();
    // adding every external id here can hide a valid candidate that merely
    // shares an IMDb/TMDB alias with an unrelated local record.
    idVariants(entry?.contentId || entry?.id || entry?.itemId).forEach((value) =>
      result.add(value)
    );
  });
  return result;
}

function candidateIsWatched(candidate, watchedItems, progressItems) {
  const candidateId = normalizedId(candidate?.id);
  const imdbId = normalizedId(candidate?.imdbId);
  return [candidateId, imdbId].filter(Boolean).some((id) => {
    return watchedItems.has(id) || progressItems.has(id);
  });
}

function extractTraktMedia(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    return [payload.movie || payload.show || payload].filter(Boolean);
  }
  return [];
}

export class PostPlayRecommendationController {
  constructor({ onStateChange = null, onStartTrailer = null, onStopTrailer = null } = {}) {
    this.onStateChange = typeof onStateChange === "function" ? onStateChange : () => {};
    this.onStartTrailer = typeof onStartTrailer === "function" ? onStartTrailer : () => {};
    this.onStopTrailer = typeof onStopTrailer === "function" ? onStopTrailer : () => {};
    this.snapshot = null;
    this.identityKey = "";
    this.pipelineToken = 0;
    this.prefetchAttempted = false;
    this.prefetchPromise = null;
    this.postEndCountdownTimer = null;
    this.changeToken = 0;
    this.candidateResolutionCache = new Map();
    this.candidateResolutionJobs = new Map();
    this.candidateSeeds = [];
    this.recommendationDetailJobs = new Map();
    this.recommendationDetailCompleted = new Set();
    this.autoPlayTrailerEnabled = this.readAutoPlayTrailerSetting();
    this.state = this.createInitialState();
  }

  createInitialState() {
    return {
      recommendation: null,
      recommendations: [],
      recommendationIndex: 0,
      recommendationCount: 0,
      isLoadingRecommendation: false,
      isChangingRecommendation: false,
      isLoadingTrailer: false,
      isVisible: false,
      hasReturnedToPlayer: false,
      countdownSeconds: null,
      countdownKind: "",
      isTrailerPlaying: false,
      hasAutoPlayedTrailer: false
    };
  }

  getState() {
    const state = { ...this.state };
    state.canNavigatePrevious = Boolean(
      state.isVisible && !state.isChangingRecommendation && state.recommendationIndex > 0
    );
    state.canNavigateNext = Boolean(
      state.isVisible &&
      !state.isChangingRecommendation &&
      state.recommendationIndex >= 0 &&
      state.recommendationIndex < state.recommendationCount - 1
    );
    state.canReturnToPlayer = Boolean(
      state.isVisible && !state.isTrailerPlaying && !state.hasAutoPlayedTrailer
    );
    state.blocksNaturalCompletion = Boolean(
      state.isVisible || (state.isLoadingRecommendation && !state.hasReturnedToPlayer)
    );
    return state;
  }

  emit(force = false) {
    const nextState = this.getState();
    const signature = JSON.stringify(nextState);
    if (!force && signature === this.lastEmittedSignature) {
      return nextState;
    }
    this.lastEmittedSignature = signature;
    try {
      this.onStateChange(nextState);
    } catch (error) {
      console.warn("Post-play recommendation state listener failed", error);
    }
    return nextState;
  }

  resetForIdentity() {
    this.pipelineToken += 1;
    this.clearPostEndCountdown();
    this.prefetchAttempted = false;
    this.prefetchPromise = null;
    this.clearRecommendationPipeline();
    this.autoPlayTrailerEnabled = this.readAutoPlayTrailerSetting();
    this.state = this.createInitialState();
    this.emit(true);
  }

  update(snapshot = {}) {
    const rawContentType = String(snapshot.contentType ?? "")
      .trim()
      .toLowerCase();
    // Keep unsupported player types (cloud/live/etc.) intact instead of
    // normalizing them to movie. Android returns null for those types and
    // never starts the post-play pipeline for them.
    const contentType = isSupportedPostPlayContentType(rawContentType)
      ? normalizeContentType(rawContentType, "movie")
      : rawContentType;
    const contentId = firstNonBlank(snapshot.contentId, snapshot.itemId, snapshot.videoId);
    const nextIdentityKey = [
      contentType,
      contentId,
      snapshot.videoId || "",
      snapshot.season ?? "",
      snapshot.episode ?? ""
    ].join("|");
    if (nextIdentityKey !== this.identityKey) {
      this.identityKey = nextIdentityKey;
      this.resetForIdentity();
    }
    this.snapshot = {
      ...snapshot,
      contentType,
      contentId,
      movieThresholdPercent: normalizePostPlayMovieThreshold(snapshot.movieThresholdPercent),
      skipIntervals: Array.isArray(snapshot.skipIntervals) ? snapshot.skipIntervals : [],
      episodeThresholdMode: String(snapshot.episodeThresholdMode || "PERCENTAGE").toUpperCase(),
      episodeThresholdPercent: Number(snapshot.episodeThresholdPercent ?? 99),
      episodeThresholdMinutesBeforeEnd: Number(snapshot.episodeThresholdMinutesBeforeEnd ?? 2)
    };
    this.evaluate();
    return this.getState();
  }

  evaluate() {
    const snapshot = this.snapshot || {};
    const settings = PlayerSettingsStore.get();
    const enabled = snapshot.enabled !== false && settings.postPlayRecommendationsEnabled !== false;
    if (snapshot.hasActiveAutoPlay || !enabled || snapshot.hasFatalError) {
      this.clearInactiveState();
      return this.getState();
    }
    if (
      !shouldUsePostPlayRecommendation({
        enabled,
        contentType: snapshot.contentType,
        nextEpisodeMetadataResolved: snapshot.nextEpisodeMetadataResolved,
        nextEpisodeHasAired: snapshot.nextEpisodeHasAired
      })
    ) {
      this.clearInactiveState();
      return this.getState();
    }

    if (this.state.hasReturnedToPlayer) {
      return this.getState();
    }

    const durationMs = Number(snapshot.durationMs || 0);
    const positionMs = Number(snapshot.positionMs || 0);
    if (
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      isShortPostPlayPlaceholderDuration(durationMs)
    ) {
      return this.getState();
    }

    if (
      !this.prefetchAttempted &&
      shouldPrefetchPostPlayRecommendation({
        contentType: snapshot.contentType,
        positionMs,
        durationMs,
        movieThresholdPercent: snapshot.movieThresholdPercent,
        skipIntervals: snapshot.skipIntervals,
        episodeThresholdMode: snapshot.episodeThresholdMode,
        episodeThresholdPercent: snapshot.episodeThresholdPercent,
        episodeThresholdMinutesBeforeEnd: snapshot.episodeThresholdMinutesBeforeEnd
      })
    ) {
      this.prefetchAttempted = true;
      this.prefetchPromise = this.loadRecommendation();
    }

    if (!this.state.recommendation) {
      return this.getState();
    }
    const shouldShow = shouldShowPostPlayRecommendation({
      contentType: snapshot.contentType,
      positionMs,
      durationMs,
      movieThresholdPercent: snapshot.movieThresholdPercent,
      skipIntervals: snapshot.skipIntervals,
      episodeThresholdMode: snapshot.episodeThresholdMode,
      episodeThresholdPercent: snapshot.episodeThresholdPercent,
      episodeThresholdMinutesBeforeEnd: snapshot.episodeThresholdMinutesBeforeEnd,
      seriesThresholdReached: snapshot.seriesThresholdReached,
      playbackEnded: Boolean(snapshot.playbackEnded)
    });
    // Android blocks only the first presentation while another modal/input
    // interaction is active. Once the recommendation surface is already
    // visible it remains the owner of the player until the user dismisses or
    // navigates it, even if a transient blocking flag changes underneath it.
    if (!shouldShow || (!this.state.isVisible && snapshot.hasBlockingInteraction)) {
      return this.getState();
    }

    if (!this.state.isVisible) {
      this.state.isVisible = true;
      this.state.hasReturnedToPlayer = false;
      if (snapshot.playbackEnded && this.shouldAutoPlayTrailer()) {
        this.setPostEndCountdown();
      } else {
        this.updatePreEndCountdown(positionMs, durationMs);
      }
      this.emit(true);
    } else if (!this.state.isTrailerPlaying && !this.state.hasAutoPlayedTrailer) {
      if (snapshot.playbackEnded && this.shouldAutoPlayTrailer()) {
        this.setPostEndCountdown();
      } else {
        this.updatePreEndCountdown(positionMs, durationMs);
      }
    }
    return this.getState();
  }

  clearInactiveState() {
    if (
      !this.state.isVisible &&
      !this.state.isLoadingRecommendation &&
      !this.state.isTrailerPlaying &&
      !this.state.recommendation
    ) {
      return;
    }
    this.pipelineToken += 1;
    this.changeToken += 1;
    this.prefetchAttempted = false;
    this.prefetchPromise = null;
    this.clearPostEndCountdown();
    if (this.state.isTrailerPlaying) {
      this.onStopTrailer();
    }
    this.clearRecommendationPipeline();
    this.autoPlayTrailerEnabled = this.readAutoPlayTrailerSetting();
    this.state = this.createInitialState();
    this.emit(true);
  }

  clearRecommendationPipeline() {
    this.candidateResolutionCache.clear();
    this.candidateResolutionJobs.clear();
    this.candidateSeeds = [];
    this.recommendationDetailJobs.clear();
    this.recommendationDetailCompleted.clear();
  }

  readAutoPlayTrailerSetting() {
    return (
      POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED &&
      PlayerSettingsStore.get().trailerAutoplay !== false
    );
  }

  shouldAutoPlayTrailer() {
    return Boolean(this.autoPlayTrailerEnabled && !this.state.hasAutoPlayedTrailer);
  }

  setPostEndCountdown() {
    if (!this.state.recommendation?.trailerYtId && !this.state.recommendation?.trailerVideoUrl) {
      this.clearPostEndCountdown();
      return;
    }
    if (this.state.countdownKind === "postEnd" && this.postEndCountdownTimer) {
      return;
    }
    this.clearPostEndCountdown();
    this.state.countdownKind = "postEnd";
    this.state.countdownSeconds = POST_PLAY_RECOMMENDATION_TRAILER_COUNTDOWN_SECONDS;
    this.emit(true);
    const tick = () => {
      if (!this.state.isVisible || this.state.isTrailerPlaying || this.state.hasReturnedToPlayer) {
        this.clearPostEndCountdown();
        return;
      }
      const next = Number(this.state.countdownSeconds || 0) - 1;
      if (next <= 0) {
        this.clearPostEndCountdown();
        this.startTrailer({ auto: true });
        return;
      }
      this.state.countdownSeconds = next;
      this.emit(true);
      this.postEndCountdownTimer = setTimeout(tick, 1000);
    };
    this.postEndCountdownTimer = setTimeout(tick, 1000);
  }

  updatePreEndCountdown(positionMs, durationMs) {
    if (
      this.state.isTrailerPlaying ||
      this.state.hasAutoPlayedTrailer ||
      !this.shouldAutoPlayTrailer() ||
      (!this.state.recommendation?.trailerYtId && !this.state.recommendation?.trailerVideoUrl)
    ) {
      if (this.state.countdownKind === "preEnd") {
        this.state.countdownKind = "";
        this.state.countdownSeconds = null;
        this.emit(true);
      }
      return;
    }
    const seconds = postPlayRecommendationCountdownSeconds(positionMs, durationMs);
    if (seconds === this.state.countdownSeconds && this.state.countdownKind === "preEnd") {
      return;
    }
    this.state.countdownKind = seconds == null ? "" : "preEnd";
    this.state.countdownSeconds = seconds;
    this.emit(true);
  }

  clearPostEndCountdown() {
    if (this.postEndCountdownTimer) {
      clearTimeout(this.postEndCountdownTimer);
      this.postEndCountdownTimer = null;
    }
    if (this.state.countdownKind === "postEnd") {
      this.state.countdownKind = "";
      this.state.countdownSeconds = null;
      this.emit(true);
    }
  }

  async loadCurrentMeta() {
    const snapshot = this.snapshot || {};
    const type = normalizeContentType(snapshot.contentType);
    const itemId = firstNonBlank(snapshot.contentId, snapshot.itemId, snapshot.videoId);
    if (itemId) {
      const cachedMeta = metaRepository.getCachedMeta?.(type, itemId);
      if (cachedMeta) {
        return cachedMeta;
      }
    }
    if (itemId) {
      const globalResult = await withTimeout(
        metaRepository.getMetaFromAllAddons(type, itemId),
        POST_PLAY_RECOMMENDATION_META_TIMEOUT_MS,
        { status: "error" }
      );
      if (globalResult?.status === "success") {
        return globalResult.data || {};
      }
    }
    // Android does not synthesize a Meta from the player snapshot here. The
    // recommendation pipeline starts only after cached/all-addon metadata has
    // been resolved; the snapshot remains a fallback for rendering a resolved
    // candidate, not a source identity for related-content lookup.
    return null;
  }

  async loadRecommendation() {
    if (this.state.isLoadingRecommendation) {
      return this.prefetchPromise;
    }
    const token = ++this.pipelineToken;
    this.state.isLoadingRecommendation = true;
    this.state.hasReturnedToPlayer = false;
    this.emit(true);
    try {
      const currentMeta = await withTimeout(
        this.loadCurrentMeta(),
        POST_PLAY_RECOMMENDATION_META_TIMEOUT_MS,
        null
      );
      if (token !== this.pipelineToken) {
        return [];
      }
      if (!currentMeta) {
        this.state.isLoadingRecommendation = false;
        this.state.isLoadingTrailer = false;
        this.emit(true);
        return [];
      }
      const seeds = await withTimeout(
        this.loadCandidateSeeds(currentMeta),
        POST_PLAY_RECOMMENDATION_LOAD_TIMEOUT_MS,
        []
      );
      if (token !== this.pipelineToken) {
        return [];
      }
      this.candidateSeeds = Array.isArray(seeds) ? seeds : [];
      if (!this.candidateSeeds.length) {
        this.state.isLoadingRecommendation = false;
        this.state.isLoadingTrailer = false;
        this.emit(true);
        return [];
      }
      // Android snapshots the trailer-autoplay preference when the candidate
      // load begins. Re-read it here as well so a settings change made while
      // metadata was loading cannot start the post-end countdown with stale
      // state.
      this.autoPlayTrailerEnabled = this.readAutoPlayTrailerSetting();
      this.candidateSeeds.forEach((_, index) =>
        this.startCandidateResolution(index, currentMeta, token)
      );
      // Android starts every resolution concurrently but waits only for the
      // first candidate before making the overlay visible. Later candidates
      // remain selectable while their own metadata is still resolving.
      const firstResolved = await this.awaitCandidateResolution(0);
      if (token !== this.pipelineToken || !firstResolved) {
        this.clearRecommendationPipeline();
        this.state.isLoadingRecommendation = false;
        this.state.isLoadingTrailer = false;
        this.emit(true);
        return [];
      }
      const firstRecommendation = this.cacheRecommendation(0, firstResolved);
      this.preloadRecommendationArtwork(firstRecommendation);
      this.state.recommendations = Array.from({ length: this.candidateSeeds.length }, (_, index) =>
        index === 0 ? firstRecommendation : null
      );
      this.state.recommendationIndex = 0;
      this.state.recommendation = firstRecommendation;
      this.state.recommendationCount = this.candidateSeeds.length;
      this.state.isLoadingRecommendation = false;
      this.state.isLoadingTrailer = POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED;
      // Resolve visibility before notifying the PlayerScreen. When the
      // player ended while recommendations were loading, the listener must
      // observe the final blocking state in the same turn; otherwise it can
      // commit natural completion between `isLoadingRecommendation = false`
      // and `evaluate()`, skipping the post-play surface entirely.
      this.evaluate();
      this.emit(true);
      void this.prefetchRecommendations(currentMeta, token);
      return this.state.recommendations;
    } catch (error) {
      if (token === this.pipelineToken) {
        this.state.isLoadingRecommendation = false;
        this.state.isLoadingTrailer = false;
        this.emit(true);
      }
      console.warn("Post-play recommendations failed", error);
      return [];
    }
  }

  async loadCandidateSeeds(currentMeta = {}) {
    const snapshot = this.snapshot || {};
    const type = normalizeContentType(snapshot.contentType);
    const traktSettings = TraktSettingsStore.get();
    const tmdbSettings = TmdbSettingsStore.get();
    const preference = traktSettings.moreLikeThisSource || MoreLikeThisSourcePreference.TRAKT;
    let seeds = [];
    if (preference === MoreLikeThisSourcePreference.TRAKT && TraktAuthService.isAuthenticated()) {
      // Android deliberately does not fall back to TMDB after a failed Trakt
      // request when Trakt is the selected source.
      seeds = await withTimeout(
        this.loadTraktRelated(currentMeta, type),
        POST_PLAY_RECOMMENDATION_LOAD_TIMEOUT_MS,
        []
      );
    } else if (
      preference === MoreLikeThisSourcePreference.TMDB &&
      tmdbSettings.enabled &&
      tmdbSettings.useMoreLikeThis
    ) {
      seeds = await this.loadTmdbRecommendations(currentMeta, type);
    } else if (
      preference === MoreLikeThisSourcePreference.TRAKT &&
      !TraktAuthService.isAuthenticated() &&
      tmdbSettings.enabled &&
      tmdbSettings.useMoreLikeThis
    ) {
      seeds = await this.loadTmdbRecommendations(currentMeta, type);
    }
    const normalizedSeeds = (Array.isArray(seeds) ? seeds : [])
      .map((item) => normalizeCandidateSeed(item, type))
      .filter(Boolean);
    const currentIds = idSetFromValues(currentIdentityValues(snapshot, currentMeta));
    const selectedWatchSource = watchProgressRepository.getContinueWatchingSource?.();
    const traktWatchedMoviesPromise =
      selectedWatchSource === WatchProgressSource.TRAKT
        ? withTimeout(
            TraktAuthService.fetchWatchedMovies().catch(() => []),
            POST_PLAY_RECOMMENDATION_WATCHED_TIMEOUT_MS,
            []
          )
        : Promise.resolve([]);
    // Android filters with locally observed watched state, so a failed tracker
    // read only narrows the watched filter instead of dropping recommendations.
    const [watchedItemsRaw, progressItemsRaw, traktWatchedMoviesRaw] = await Promise.all([
      withTimeout(
        Promise.resolve()
          .then(() => watchedItemsRepository.getAll())
          .catch(() => []),
        POST_PLAY_RECOMMENDATION_WATCHED_TIMEOUT_MS,
        []
      ),
      withTimeout(
        Promise.resolve()
          .then(
            () =>
              watchProgressRepository.getAllForContinueWatching?.() ||
              watchProgressRepository.getAll()
          )
          .catch(() => []),
        POST_PLAY_RECOMMENDATION_WATCHED_TIMEOUT_MS,
        []
      ),
      traktWatchedMoviesPromise
    ]);
    const watchedItems = Array.isArray(watchedItemsRaw) ? watchedItemsRaw : [];
    const progressItems = Array.isArray(progressItemsRaw) ? progressItemsRaw : [];
    const traktWatchedMovies = Array.isArray(traktWatchedMoviesRaw) ? traktWatchedMoviesRaw : [];
    const seriesSeeds = normalizedSeeds.filter(
      (candidate) => normalizeContentType(candidate?.type || candidate?.contentType) === "series"
    );
    const watchedItemsForRecommendations = seriesSeeds.length
      ? await withTimeout(
          Promise.resolve()
            .then(() =>
              watchedTitleStateRepository.getTitleWatchedItems(seriesSeeds, {
                baseWatchedItems: watchedItems,
                limit: 5000
              })
            )
            .catch(() => watchedItems),
          POST_PLAY_RECOMMENDATION_WATCHED_TIMEOUT_MS,
          watchedItems
        )
      : watchedItems;
    const watchedIds = watchedIdentitySet(
      [...watchedItems, ...traktWatchedMovies],
      "movie",
      "watched"
    );
    // Trakt's watched-movie projection exposes all lookup aliases, while the
    // local watched store intentionally keeps only its canonical contentId.
    // Android checks candidate.id and candidate.imdbId against that complete
    // projection, so retain the remote IMDb aliases for movie filtering.
    traktWatchedMovies.forEach((item) => {
      idVariants(item?.imdbId).forEach((value) => watchedIds.add(value));
    });
    const watchedSeriesIds = watchedIdentitySet(
      watchedItemsForRecommendations,
      "series",
      "watched"
    );
    // Android excludes merely started items from its watched sets. Only a
    // completed progress record can suppress a recommendation; root watched
    // records are handled by the dedicated watched-items repository above.
    const progressIds = watchedIdentitySet(progressItems, "movie", "completedMovie");
    const progressSeriesIds = watchedIdentitySet(progressItems, "series", "completedSeries");
    const hideUnreleased = Boolean(LayoutPreferences.get().hideUnreleasedContent);
    const seen = new Set();
    const filtered = normalizedSeeds.filter((candidate) => {
      if (idVariants(candidate.id).some((id) => currentIds.has(id))) {
        return false;
      }
      if (
        candidateIsWatched(
          candidate,
          candidate.type === "series" ? watchedSeriesIds : watchedIds,
          candidate.type === "series" ? progressSeriesIds : progressIds
        )
      ) {
        return false;
      }
      if (hideUnreleased && isUnreleased(candidate)) {
        return false;
      }
      const key = candidateIdentity(candidate);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    const first =
      filtered.find((candidate) => Boolean(candidate.backdrop || candidate.background)) ||
      filtered[0] ||
      null;
    if (!first) {
      return [];
    }
    return [first, ...filtered.filter((candidate) => candidate !== first).slice(0, 3)];
  }

  async loadTmdbRecommendations(currentMeta = {}, type = "movie") {
    const settings = TmdbSettingsStore.get();
    let tmdbId = await withTimeout(
      TmdbService.ensureTmdbId(currentMeta.id || this.snapshot?.contentId, type),
      POST_PLAY_RECOMMENDATION_SEARCH_TIMEOUT_MS,
      null
    );
    if (!tmdbId && currentMeta.id !== this.snapshot?.contentId) {
      tmdbId = await withTimeout(
        TmdbService.ensureTmdbId(this.snapshot?.contentId, type),
        POST_PLAY_RECOMMENDATION_SEARCH_TIMEOUT_MS,
        null
      );
    }
    if (!tmdbId) {
      return [];
    }
    return TmdbMetadataService.fetchMoreLikeThis({
      tmdbId,
      contentType: type,
      language: settings.language,
      maxItems: 12
    });
  }

  async loadTraktRelated(currentMeta = {}, type = "movie") {
    const token = await TraktAuthService.getValidAccessToken();
    if (!token) {
      return [];
    }
    const target = type === "series" ? "shows" : "movies";
    const fallbackItemId = this.snapshot?.contentId || "";
    let pathId = resolveDirectTraktPathId(currentMeta, fallbackItemId);
    if (!pathId) {
      const tmdbId = resolveTraktTmdbId(currentMeta, fallbackItemId);
      const expectedType = type === "series" ? "show" : "movie";
      const searchPath = tmdbId
        ? `/search/tmdb/${encodeURIComponent(tmdbId)}?type=${expectedType}`
        : "";
      if (searchPath) {
        const searchResult = await traktRequestJson(searchPath, {
          authorization: `Bearer ${token}`
        });
        const entries = Array.isArray(searchResult?.payload) ? searchResult.payload : [];
        const resolved = entries
          .map((entry) => (expectedType === "show" ? entry?.show : entry?.movie))
          .find((media) => resolveTraktPathIdFromIds(media?.ids));
        pathId = resolveTraktPathIdFromIds(resolved?.ids);
      }
    }
    if (!pathId) {
      return [];
    }
    const cacheKey = `${target}|${String(pathId).trim().toLowerCase()}`;
    const cached = traktRelatedCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt <= TRAKT_RELATED_CACHE_TTL_MS) {
      return cached.items;
    }
    const related = await traktRequestJson(
      `/${target}/${encodeURIComponent(pathId)}/related?extended=full%2Cimages&page=1&limit=20`,
      { authorization: `Bearer ${token}` }
    );
    if (!related?.response?.ok) {
      return [];
    }
    const items = extractTraktMedia(related.payload)
      .map((item) => normalizeTraktCandidate(item, type))
      .filter(Boolean);
    traktRelatedCache.set(cacheKey, { items, updatedAt: Date.now() });
    return items;
  }

  startCandidateResolution(index, currentMeta = {}, token = this.pipelineToken) {
    if (
      index < 0 ||
      index >= this.candidateSeeds.length ||
      this.candidateResolutionJobs.has(index)
    ) {
      return this.candidateResolutionJobs.get(index) || Promise.resolve(null);
    }
    const seed = this.candidateSeeds[index];
    const job = withTimeout(
      this.resolveCandidate(seed, currentMeta, token),
      POST_PLAY_RECOMMENDATION_CANDIDATE_TIMEOUT_MS,
      null
    ).catch(() => null);
    this.candidateResolutionJobs.set(index, job);
    return job;
  }

  awaitCandidateResolution(index, currentMeta = {}, token = this.pipelineToken) {
    return this.startCandidateResolution(index, currentMeta, token);
  }

  preloadRecommendationArtwork(recommendation = {}) {
    const url = firstNonBlank(recommendation.backdrop, recommendation.poster);
    if (!url) {
      return;
    }
    // The post-play overlay mounts the backdrop synchronously. Warm the image
    // during the prefetch so its decode cannot stall the entrance transition.
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      image.decode?.().catch(() => {});
    } catch (_) {
      // Image preloading is best effort.
    }
  }

  cacheRecommendation(index, recommendation) {
    if (!recommendation) {
      return null;
    }
    const cached = this.candidateResolutionCache.get(candidateIdentity(recommendation));
    const next = cached || recommendation;
    this.candidateResolutionCache.set(candidateIdentity(recommendation), next);
    this.state.recommendations[index] = next;
    return next;
  }

  async prefetchRecommendations(currentMeta = {}, token = this.pipelineToken) {
    const tasks = this.candidateSeeds.map(async (_, index) => {
      const recommendation = await this.awaitCandidateResolution(index, currentMeta, token);
      if (!recommendation || token !== this.pipelineToken) {
        return;
      }
      const cached = this.cacheRecommendation(index, recommendation);
      void this.loadRecommendationDetails(index, cached, token);
      if (index === this.state.recommendationIndex) {
        this.state.recommendation = cached;
        this.emit(true);
      }
    });
    await Promise.all(tasks);
  }

  async resolveCandidate(seed = {}, _currentMeta = {}, token = this.pipelineToken) {
    const normalizedSeed = normalizeCandidateSeed(seed, this.snapshot?.contentType || "movie");
    if (!normalizedSeed) {
      return null;
    }
    const cacheKey = candidateIdentity(normalizedSeed);
    if (this.candidateResolutionCache.has(cacheKey)) {
      return this.candidateResolutionCache.get(cacheKey);
    }
    const type = normalizedSeed.type;
    let meta = null;
    const sourceAddonBaseUrl = firstNonBlank(normalizedSeed.sourceAddonBaseUrl);
    const cachedMeta = metaRepository.getCachedMeta?.(type, normalizedSeed.id);
    if (cachedMeta) {
      meta = cachedMeta;
    }
    if (!meta) {
      const globalResult = await withTimeout(
        metaRepository.getMetaFromAllAddons(type, normalizedSeed.id, sourceAddonBaseUrl),
        POST_PLAY_RECOMMENDATION_META_TIMEOUT_MS,
        { status: "error" }
      );
      if (globalResult?.status === "success") {
        meta = globalResult.data || null;
      }
    }
    const resolvedMeta = meta;
    meta = {
      ...(meta || {}),
      ...(!meta?.id ? { id: normalizedSeed.id } : {}),
      ...(!meta?.type ? { type } : {}),
      ...(!meta?.name ? { name: normalizedSeed.name } : {})
    };
    const candidateContentType =
      resolvePostPlayContentType(
        meta.apiType,
        meta.type || normalizedSeed.apiType || normalizedSeed.type
      ) || type;
    const metadataLookupId = firstNonBlank(meta.id, normalizedSeed.id);
    const metadataLookupType = firstNonBlank(meta.apiType, normalizedSeed.apiType, type);
    let tmdbId = await withTimeout(
      TmdbService.ensureTmdbId(metadataLookupId, metadataLookupType),
      POST_PLAY_RECOMMENDATION_SEARCH_TIMEOUT_MS,
      null
    );
    if (!tmdbId && metadataLookupId !== normalizedSeed.id) {
      tmdbId = await withTimeout(
        TmdbService.ensureTmdbId(normalizedSeed.id, normalizedSeed.apiType),
        POST_PLAY_RECOMMENDATION_SEARCH_TIMEOUT_MS,
        null
      );
    }
    const tmdbSettings = TmdbSettingsStore.get();
    const enrichment =
      tmdbId && tmdbSettings.enabled
        ? await withTimeout(
            TmdbMetadataService.fetchEnrichment({
              tmdbId,
              contentType: candidateContentType,
              language: tmdbSettings.language
            }),
            POST_PLAY_RECOMMENDATION_CANDIDATE_TIMEOUT_MS,
            null
          )
        : null;
    const recommendation = projectRecommendation({
      meta: { ...meta, tmdbId: tmdbId || meta.tmdbId },
      candidate: { ...normalizedSeed, tmdbId: tmdbId || normalizedSeed.tmdbId },
      enrichment,
      contentType: candidateContentType,
      contentLanguage: this.snapshot?.contentLanguage || ""
    });
    if (!recommendation.id || token !== this.pipelineToken) {
      return null;
    }
    const resolvedRecommendation = {
      ...recommendation,
      // Keep the synthesized fallback metadata out of the MDBList gate. The
      // Android controller requests ratings only after a real meta response
      // was loaded successfully for the candidate.
      rawMeta: resolvedMeta
    };
    this.candidateResolutionCache.set(cacheKey, resolvedRecommendation);
    return resolvedRecommendation;
  }

  async loadRecommendationTrailer(recommendation = {}) {
    const tmdbId = resolveTmdbIdFromValue(recommendation.tmdbId);
    if (!POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED || !tmdbId) {
      return { ytId: "", url: "" };
    }
    const settings = TmdbSettingsStore.get();
    const candidates = await TmdbMetadataService.fetchTrailerCandidates({
      tmdbId,
      contentType: recommendation.contentType,
      language: settings.language
    });
    const trailer = resolveTrailerAsset(candidates);
    return { ytId: trailer.ytId, url: trailer.url };
  }

  async loadRecommendationDetails(index, recommendation, token = this.pipelineToken) {
    if (
      !recommendation ||
      this.recommendationDetailJobs.has(index) ||
      token !== this.pipelineToken
    ) {
      return;
    }
    const active = isMdbListActive();
    const job = (async () => {
      const updateRecommendation = (transform) => {
        if (token !== this.pipelineToken) {
          return null;
        }
        const current = this.state.recommendations[index] || recommendation;
        const next = transform(current);
        this.candidateResolutionCache.set(candidateIdentity(next), next);
        this.state.recommendations[index] = next;
        if (this.state.recommendationIndex !== index) {
          return next;
        }
        this.state.recommendation = next;
        return next;
      };

      // Android starts the rating and trailer phases independently. Each one
      // publishes its result as soon as it completes; a slow MDBList request
      // must not delay the trailer action (or vice versa).
      const ratingsPromise =
        active && recommendation.rawMeta
          ? withTimeout(
              Promise.resolve().then(() =>
                mdbListRepository.getRatingsForMeta(
                  {
                    ...(recommendation.rawMeta || {}),
                    id: recommendation.id,
                    type: recommendation.contentType,
                    imdbId: recommendation.imdbId,
                    tmdbId: recommendation.tmdbId
                  },
                  recommendation.id,
                  recommendation.contentType
                )
              ),
              POST_PLAY_RECOMMENDATION_TRAILER_TIMEOUT_MS,
              null
            ).catch(() => null)
          : Promise.resolve(null);
      const trailerPromise = withTimeout(
        Promise.resolve().then(() => this.loadRecommendationTrailer(recommendation)),
        POST_PLAY_RECOMMENDATION_TRAILER_TIMEOUT_MS,
        { ytId: "", url: "" }
      ).catch(() => ({ ytId: "", url: "" }));
      const ratingsJob = ratingsPromise
        .then((ratings) => {
          const next = updateRecommendation((current) => ({
            ...current,
            mdbListRatings: ratings?.ratings || null,
            showStandardRatings: showStandardDetailRatings(
              LayoutPreferences.get().homeImdbRatingsVisibility,
              isMdbListActive()
            )
          }));
          if (next && this.state.recommendationIndex === index) {
            this.emit(true);
          }
          return next;
        })
        .catch(() => null);
      const trailerJob = trailerPromise
        .then((trailer) => {
          const next = updateRecommendation((current) => ({
            ...current,
            trailerYtId: firstNonBlank(trailer?.ytId),
            trailerVideoUrl: firstNonBlank(trailer?.url),
            trailerKind: trailer?.ytId ? "youtube" : trailer?.url ? "direct" : "",
            detailsLoaded: true
          }));
          if (next && this.state.recommendationIndex === index) {
            this.state.isLoadingTrailer = false;
            this.emit(true);
            this.evaluate();
          }
          return next;
        })
        .catch(() => null);
      await Promise.all([ratingsJob, trailerJob]);
      if (token !== this.pipelineToken) {
        return;
      }
      // Keep the terminal state deterministic if both phases were completed
      // while the recommendation was not the active selection.
      const completed = this.state.recommendations[index] || recommendation;
      this.candidateResolutionCache.set(candidateIdentity(completed), {
        ...completed,
        detailsLoaded: true
      });
      this.state.recommendations[index] = {
        ...completed,
        detailsLoaded: true
      };
      if (this.state.recommendationIndex === index) {
        this.state.recommendation = this.state.recommendations[index];
        this.state.isLoadingTrailer = false;
        this.emit(true);
        this.evaluate();
      }
    })().catch((error) => {
      if (token === this.pipelineToken) {
        const next = {
          ...recommendation,
          mdbListRatings: null,
          showStandardRatings: showStandardDetailRatings(
            LayoutPreferences.get().homeImdbRatingsVisibility,
            isMdbListActive()
          ),
          trailerYtId: "",
          trailerVideoUrl: "",
          trailerKind: "",
          detailsLoaded: true
        };
        this.candidateResolutionCache.set(candidateIdentity(next), next);
        this.state.recommendations[index] = next;
        if (this.state.recommendationIndex === index) {
          this.state.recommendation = next;
          this.state.isLoadingTrailer = false;
          this.emit(true);
        }
      }
      console.warn("Post-play recommendation details failed", error);
    });
    this.recommendationDetailJobs.set(index, job);
    try {
      await job;
    } finally {
      if (token === this.pipelineToken) {
        this.recommendationDetailCompleted.add(index);
      }
    }
  }

  selectRecommendation(index) {
    if (!this.state.isVisible || this.state.isChangingRecommendation) {
      return false;
    }
    const targetIndex = Number(index);
    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= this.state.recommendationCount ||
      targetIndex === this.state.recommendationIndex
    ) {
      return false;
    }
    this.clearPostEndCountdown();
    if (this.state.isTrailerPlaying) {
      this.onStopTrailer();
    }
    // Android disables automatic trailer playback after the user moves to a
    // different recommendation; the rest of this post-play session remains
    // manual until the player identity changes.
    this.autoPlayTrailerEnabled = false;
    this.state.isTrailerPlaying = false;
    this.state.isChangingRecommendation = true;
    this.state.countdownSeconds = null;
    this.state.countdownKind = "";
    const token = ++this.changeToken;
    this.emit(true);
    const currentMeta = {};
    this.awaitCandidateResolution(targetIndex, currentMeta, this.pipelineToken).then((target) => {
      if (token !== this.changeToken || this.state.hasReturnedToPlayer) {
        return;
      }
      if (!target) {
        this.state.isChangingRecommendation = false;
        this.emit(true);
        return;
      }
      const recommendation = this.cacheRecommendation(targetIndex, target);
      this.state.recommendationIndex = targetIndex;
      this.state.recommendation = recommendation;
      this.state.isChangingRecommendation = false;
      this.state.isLoadingTrailer =
        POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED &&
        !this.recommendationDetailCompleted.has(targetIndex);
      this.emit(true);
      void this.loadRecommendationDetails(targetIndex, recommendation, this.pipelineToken);
    });
    return true;
  }

  startTrailer({ auto = false } = {}) {
    const recommendation = this.state.recommendation;
    if (
      !POST_PLAY_IN_APP_TRAILER_PLAYBACK_ENABLED ||
      !this.state.isVisible ||
      this.state.isChangingRecommendation ||
      !recommendation ||
      (!recommendation.trailerYtId && !recommendation.trailerVideoUrl)
    ) {
      return false;
    }
    this.clearPostEndCountdown();
    this.state.isTrailerPlaying = true;
    // Android marks the trailer as consumed for both automatic and explicit
    // starts; this removes the player-window return target after playback has
    // taken over the screen.
    this.state.hasAutoPlayedTrailer = true;
    this.emit(true);
    try {
      this.onStartTrailer(recommendation, { auto });
    } catch (error) {
      console.warn("Post-play trailer start failed", error);
      this.onTrailerEnded();
    }
    return true;
  }

  onTrailerEnded() {
    if (!this.state.isTrailerPlaying) {
      return false;
    }
    try {
      this.onStopTrailer();
    } catch (_) {}
    this.state.isTrailerPlaying = false;
    this.emit(true);
    return true;
  }

  returnToPlayer() {
    if (!this.getState().canReturnToPlayer) {
      return false;
    }
    this.clearPostEndCountdown();
    this.pipelineToken += 1;
    this.changeToken += 1;
    this.clearRecommendationPipeline();
    this.autoPlayTrailerEnabled = this.readAutoPlayTrailerSetting();
    this.state.isVisible = false;
    this.state.hasReturnedToPlayer = true;
    this.state.countdownSeconds = null;
    this.state.countdownKind = "";
    this.emit(true);
    setTimeout(() => {
      if (!this.state.hasReturnedToPlayer) {
        return;
      }
      this.state = this.createInitialState();
      this.state.hasReturnedToPlayer = true;
      this.emit(true);
    }, POST_PLAY_RECOMMENDATION_TRANSITION_MS);
    return true;
  }

  stop() {
    this.pipelineToken += 1;
    this.changeToken += 1;
    this.clearPostEndCountdown();
    if (this.state.isTrailerPlaying) {
      try {
        this.onStopTrailer();
      } catch (_) {}
    }
    this.state = this.createInitialState();
    this.snapshot = null;
    this.identityKey = "";
    this.prefetchAttempted = false;
    this.prefetchPromise = null;
    this.clearRecommendationPipeline();
    this.autoPlayTrailerEnabled = this.readAutoPlayTrailerSetting();
    this.emit(true);
  }
}

export { buildInlineYoutubePlayerUrl };
