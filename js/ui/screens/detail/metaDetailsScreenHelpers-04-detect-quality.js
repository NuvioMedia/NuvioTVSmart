import { Router } from "../../navigation/routerState.js";

import { ScreenUtils } from "../../navigation/screen.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";

import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";

import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";

import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";

import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";

import { watchedTitleStateRepository } from "../../../data/repository/watchedTitleStateRepository.js";

import { libraryRepository, LibrarySourceMode } from "../../../data/repository/libraryRepository.js";

import { detailWatchedEnrichmentService } from "../../../data/repository/detailWatchedEnrichmentService.js";

import { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";

import { TmdbService } from "../../../core/tmdb/tmdbService.js";

import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";

import { normalizeTmdbBackdropUrl } from "../../../core/tmdb/tmdbImageUrl.js";

import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

import { showHomeRatings, showStandardDetailRatings } from "../../../core/util/imdbRatingVisibility.js";

import { imdbEpisodeRatingsRepository } from "../../../data/repository/imdbEpisodeRatingsRepository.js";

import { formatHeroRuntime, normalizeEpisodeImdbRating, parseEpisodeRuntimeMinutes } from "./episodeCardMetadata.js";

import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";

import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

import { MoreLikeThisSourcePreference, TraktSettingsStore, WatchProgressSource } from "../../../data/local/traktSettingsStore.js";

import { requestJson as traktRequestJson, TraktAuthService } from "../../../data/repository/traktAuthService.js";

import { toTraktImageUrl } from "../../../core/trakt/traktImageUrl.js";

import { supportsMembershipFor } from "../../../core/tracking/trackingLibraryMembership.js";

import { Environment } from "../../../platform/environment.js";

import { Platform } from "../../../platform/index.js";

import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

import { TMDB_API_KEY, TRAKT_API_URL, TRAKT_CLIENT_ID, YOUTUBE_PROXY_URL } from "../../../config.js";

import { I18n } from "../../../i18n/index.js";

import { localizedGenreLabel } from "../../../i18n/genreLabels.js";

import { contentTextDirection } from "../../../core/util/contentTextDirection.js";

import { mdbListRatingIcon } from "../../../core/util/mdbListRatingStatus.js";

import { NuvioDialog } from "../../components/nuvioDialog.js";

import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

import { resolveMovieStreamIdentity } from "./movieStreamIdentity.js";

import { posterItemFromNode, PosterOptionsDialogController } from "../../components/posterOptionsMenu.js";

import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";

import { buildWatchedTitleIdSet, isTitleItemWatched } from "../../components/watchedTitleBadge.js";

import {
  getWatchProgressFraction,
  isWatchProgressCompleted,
  isWatchProgressInProgress,
  watchProgressCompletedThreshold,
  resolveWatchProgressResumePositionMs
} from "../../../domain/model/watchProgress.js";

export function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4K";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  return "Auto";
}

export function renderImdbBadge(rating) {
  const raw = String(rating ?? "").trim();
  if (!raw) {
    return "";
  }
  const value = formatRatingValue(raw, { digits: 1 });
  return `
    <span class="series-imdb-badge">
      <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
      <span>${value}</span>
    </span>
  `;
}

export function formatRatingValue(value, { digits = 1, stripTrailingZero = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return raw.replace(",", ".");
  }
  const fixed = parsed.toFixed(digits);
  return stripTrailingZero ? fixed.replace(/\.0$/, "") : fixed;
}

export function formatMdbListRating(provider, rating) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  if (["imdb", "tmdb", "letterboxd"].includes(normalizedProvider)) {
    return formatRatingValue(rating, { digits: 1 });
  }
  return formatRatingValue(rating, { digits: 1, stripTrailingZero: true });
}

export function hasMdbListRatings(ratings = {}) {
  return ["trakt", "imdb", "tmdb", "letterboxd", "tomatoes", "audience", "metacritic"].some(
    (key) => ratings?.[key] != null && String(ratings[key]).trim() !== ""
  );
}

export function normalizeGenreList(meta = {}) {
  const raw = Array.isArray(meta?.genres) ? meta.genres : String(meta?.genres || meta?.genre || "").split(/[•,|/]/);
  return raw.map((genre) => String(genre || "").trim()).filter(Boolean);
}

export function mergeGenreLists(primary = [], fallback = []) {
  const seen = new Set();
  return [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(fallback) ? fallback : [])]
    .map((genre) => String(genre || "").trim())
    .filter((genre) => {
      const key = genre.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function formatMovieReleaseDate(meta = {}) {
  const type = String(meta?.type || meta?.apiType || "").toLowerCase();
  const isMovie = type === "movie";
  const rawDate = String(meta?.released || meta?.releaseDate || meta?.release_date || "").trim();
  if (isMovie && rawDate) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00`) : new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      if (LayoutPreferences.get().showFullReleaseDate === false) {
        return String(parsed.getFullYear());
      }
      return new Intl.DateTimeFormat(I18n.getLocale(), {
        month: "long",
        day: "numeric",
        year: "numeric"
      }).format(parsed);
    }
  }
  return String(meta?.releaseInfo || "").trim();
}

export function resolveImdbRating(meta = {}) {
  if (meta?.imdbRating != null && String(meta.imdbRating).trim() !== "") {
    return meta.imdbRating;
  }
  if (meta?.imdb_score != null && String(meta.imdb_score).trim() !== "") {
    return meta.imdb_score;
  }
  if (meta?.ratings?.imdb != null && String(meta.ratings.imdb).trim() !== "") {
    return meta.ratings.imdb;
  }
  if (meta?.mdbListRatings?.imdb != null && String(meta.mdbListRatings.imdb).trim() !== "") {
    return meta.mdbListRatings.imdb;
  }
  return null;
}

export function addonRatingsBySeason(episodes = []) {
  const seasons = {};
  episodes.forEach((episode) => {
    const season = Number(episode?.season);
    const number = Number(episode?.episode);
    const normalizedRating = normalizeEpisodeImdbRating(episode?.imdbRating);
    const rating = normalizedRating == null ? null : Number(normalizedRating.toFixed(1));
    if (!Number.isFinite(season) || !Number.isFinite(number) || rating == null) {
      return;
    }
    if (!Array.isArray(seasons[season])) {
      seasons[season] = [];
    }
    seasons[season].push({ episode: number, rating });
  });
  Object.keys(seasons).forEach((season) => {
    seasons[season].sort((left, right) => left.episode - right.episode);
  });
  return seasons;
}

export function mergeSeasonRatings(addon = {}, service = {}) {
  const merged = {};
  new Set([...Object.keys(addon), ...Object.keys(service)]).forEach((season) => {
    const byEpisode = new Map();
    (addon[season] || []).forEach((entry) => byEpisode.set(Number(entry.episode), entry));
    (service[season] || []).forEach((entry) => {
      const episode = Number(entry?.episode);
      const hasUsableRating = normalizeEpisodeImdbRating(entry?.rating) != null;
      if (!hasUsableRating && byEpisode.has(episode)) {
        return;
      }
      byEpisode.set(episode, entry);
    });
    merged[season] = [...byEpisode.values()].sort((l, r) => l.episode - r.episode);
  });
  return merged;
}

export function resolveEpisodeImdbRating(episode = {}, seriesRatingsBySeason = {}) {
  const seasonRating = seriesRatingsBySeason?.[episode.season]?.find(
    (entry) => Number(entry?.episode || 0) === Number(episode.episode || 0)
  )?.rating;
  const normalizedSeasonRating = normalizeEpisodeImdbRating(seasonRating);
  if (normalizedSeasonRating != null) {
    return normalizedSeasonRating;
  }
  return normalizeEpisodeImdbRating(episode?.imdbRating);
}

export function formatRuntimeMinutes(runtime) {
  return formatDurationMinutes(runtime);
}

export function formatDurationMinutes(totalMinutes) {
  const minutesValue = Number(totalMinutes || 0);
  if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
    return "";
  }
  const roundedMinutes = Math.max(0, Math.round(minutesValue));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function resolveEpisodeRuntimeForSeason(episodes = [], season = null) {
  const seasonNumber = Number(season || 0);
  const inSeason = episodes.find((episode) => Number(episode.season || 0) === seasonNumber && Number(episode.runtimeMinutes || 0) > 0);
  if (inSeason) {
    return Number(inSeason.runtimeMinutes || 0);
  }
  const anyEpisode = episodes.find((episode) => Number(episode.runtimeMinutes || 0) > 0);
  return anyEpisode ? Number(anyEpisode.runtimeMinutes || 0) : 0;
}

export function renderPlayGlyph() {
  return `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z" fill="currentColor"/></svg>`;
}

export function renderTrailerGlyph() {
  return `<svg class="series-btn-svg" viewBox="0 0 566.828 566.828" aria-hidden="true"><path d="M563.824,192.783c-1.58-17.399-3.85-32.944-6.801-46.659c-3.371-15.386-10.703-28.36-21.982-38.899c-11.285-10.539-24.412-16.652-39.383-18.348c-46.811-5.275-117.564-7.907-212.247-7.907c-94.688,0-165.436,2.632-212.248,7.907c-14.976,1.695-28.048,7.809-39.223,18.348c-11.181,10.539-18.458,23.513-21.824,38.899c-3.164,13.715-5.533,29.26-7.118,46.659c-1.579,17.399-2.479,31.793-2.687,43.183C0.098,247.343,0,263.163,0,283.414c0,20.238,0.104,36.053,0.312,47.449c0.208,11.377,1.107,25.777,2.687,43.17c1.585,17.398,3.843,32.957,6.799,46.658c3.372,15.41,10.704,28.373,21.983,38.912c11.279,10.551,24.407,16.67,39.382,18.348c46.812,5.275,117.559,7.906,212.248,7.906c94.683,0,165.431-2.631,212.247-7.906c14.971-1.684,28.043-7.797,39.225-18.348c11.174-10.539,18.451-23.502,21.822-38.912c3.164-13.701,5.533-29.26,7.119-46.658c1.578-17.398,2.479-31.793,2.686-43.17c0.209-11.391,0.318-27.211,0.318-47.449c0-20.251-0.109-36.065-0.318-47.448C566.303,224.57,565.402,210.176,563.824,192.783z M395.389,300.488L233.436,401.707c-2.956,2.111-6.537,3.164-10.753,3.164c-3.164,0-6.432-0.838-9.804-2.533c-6.958-3.795-10.441-9.688-10.441-17.705V182.189c0-8.005,3.476-13.923,10.441-17.717c7.167-3.794,14.021-3.568,20.557,0.63l161.953,101.219c6.328,3.599,9.492,9.29,9.492,17.087C404.875,291.223,401.711,296.914,395.389,300.488z" fill="currentColor"/></svg>`;
}

export function renderLibraryGlyph(isSaved = false) {
  return isSaved
    ? `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`
    : `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12H20M12 4V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function renderWatchedBadgeGlyph(className = "series-watched-badge-svg") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`;
}

export function renderWatchedGlyph(isWatched = false) {
  return isWatched
    ? `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Zm0 13c-3.04 0-5.5-2.46-5.5-5.5S8.96 6.5 12 6.5s5.5 2.46 5.5 5.5-2.46 5.5-5.5 5.5Zm0-8.8A3.3 3.3 0 0 0 8.7 12a3.3 3.3 0 1 0 6.6 0A3.3 3.3 0 0 0 12 8.7Z" fill="currentColor"/></svg>`
    : `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m2.1 3.51 1.39-1.39 18 18-1.39 1.39-2.94-2.94A10.94 10.94 0 0 1 12 19.5C7 19.5 2.73 16.39 1 12c.8-2.03 2.18-3.79 3.95-5.09L2.1 3.51Zm7.46 7.46 4.92 4.92A3.47 3.47 0 0 1 12 16.5 4.5 4.5 0 0 1 7.5 12c0-.9.27-1.74.73-2.47l1.33 1.44Zm6.05 6.05-1.67-1.67c-.61.41-1.34.65-2.12.65A4.5 4.5 0 0 1 7.33 11.5c0-.78.24-1.51.65-2.12L5.3 6.7A9.65 9.65 0 0 0 2.96 12c1.51 3.52 5.02 6 9.04 6 1.34 0 2.63-.28 3.61-.98ZM12 7.5c2.49 0 4.5 2.01 4.5 4.5 0 .78-.2 1.5-.56 2.13l2.59 2.59A9.77 9.77 0 0 0 21.04 12c-1.51-3.52-5.02-6-9.04-6-1.39 0-2.7.29-3.88 1.02l1.86 1.86c.62-.24 1.3-.38 2.02-.38Zm-.49 1.55 3.44 3.44c.03-.16.05-.32.05-.49A3 3 0 0 0 12 9c-.17 0-.33.02-.49.05Z" fill="currentColor"/></svg>`;
}

export function ratingToneClass(value) {
  const num = Number(value || 0);
  if (num >= 9.7) return "exceptional";
  if (num >= 9) return "excellent";
  if (num >= 8) return "great";
  if (num >= 7.5) return "good";
  if (num >= 7) return "mixed";
  if (num >= 6) return "bad";
  if (num > 0) return "poor";
  return "normal";
}

export function getAddonIconPath(addonName = "") {
  const value = String(addonName || "").toLowerCase();
  if (!value) {
    return "";
  }
  if (value.includes("trakt")) {
    return "assets/icons/trakt_tv_favicon.svg";
  }
  if (value.includes("letterboxd")) {
    return "assets/icons/mdblist_letterboxd.svg";
  }
  if (value.includes("tmdb")) {
    return "assets/icons/mdblist_tmdb.svg";
  }
  if (value.includes("tomato")) {
    return "assets/icons/mdblist_tomatoes.svg";
  }
  if (value.includes("mdblist")) {
    return "assets/icons/mdblist_trakt.svg";
  }
  return "";
}
