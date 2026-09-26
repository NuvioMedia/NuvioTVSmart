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

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export const EPISODE_HOLD_DELAY_MS = 650;

export const POSTER_HOLD_DELAY_MS = 650;

export const HERO_HOLD_DELAY_MS = 650;

export const TRAKT_COMMENTS_LIMIT = 100;

export const DETAIL_SCROLL_STIFFNESS = 180;

export const DETAIL_SCROLL_DAMPING_RATIO = 0.95;

export const DETAIL_TAB_FOCUS_TARGET = 0.4;

export const DETAIL_ROW_FOCUS_TARGET = 0.33;

export const DETAIL_SCROLL_MAX_FRAME_SECONDS = 0.016;

export const EPISODE_VIRTUALIZATION_THRESHOLD = 72;

export const EPISODE_VIRTUALIZATION_MIN_WINDOW = 20;

export const EPISODE_VIRTUALIZATION_OVERSCAN = 8;

export const EPISODE_VIRTUALIZATION_DEFAULT_CARD_WIDTH = 540;

export const EPISODE_VIRTUALIZATION_DEFAULT_GAP = 34;

export const EPISODE_TITLE_MARQUEE_VELOCITY_PX_PER_SECOND = 90;

export const RTL_DETAIL_LANGUAGES = new Set(["ar", "he"]);

export const SIMKL_DESTRUCTIVE_REMOVAL_MESSAGE =
  "Removing this status will also clear watched history or a rating on Simkl. Confirm only if that is intended.";

export const EPISODE_SCROLL_REPEAT_THROTTLE_MS = 80;

export const LOCAL_YOUTUBE_PROXY_URL = "youtube-proxy.html";

export function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function isRtlDetailLocale(locale = I18n.getLocale()) {
  const language = String(locale || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return RTL_DETAIL_LANGUAGES.has(language);
}

export function detailImageLoadingMode() {
  // NOTE: intentionally NOT inverted — lazy everywhere; near-viewport
  // images still resolve immediately via IntersectionObserver hydration.
  // (A previous revision returned "eager" on constrained runtimes, firing
  // a decode storm for every cast/morelike image during detail mount.)
  return "lazy";
}

export function resolveDetailBackdropUrl(meta = {}) {
  const candidates = [meta?.background, meta?.backdrop, meta?.backdropUrl, meta?.landscapePoster, meta?.poster];
  for (const [index, candidate] of candidates.entries()) {
    const value = String(candidate || "").trim();
    if (!value) {
      continue;
    }
    return index < candidates.length - 1 ? normalizeTmdbBackdropUrl(value) : value;
  }
  return "";
}

export function firstNonNegativeInt(values = []) {
  for (const value of values) {
    if (typeof value !== "number" && typeof value !== "string") {
      continue;
    }
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized === "") {
      continue;
    }
    const num = Number(normalized);
    if (Number.isInteger(num) && num >= 0) {
      return num;
    }
  }
  return null;
}

export function parseSeasonEpisodeFromId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) {
    return null;
  }
  const segments = id.split(":");
  if (segments.length < 3) {
    return null;
  }
  const lastSegment = segments[segments.length - 1];
  const secondLastSegment = segments[segments.length - 2];
  if (!/^\d+$/.test(lastSegment) || !/^\d+$/.test(secondLastSegment)) {
    return null;
  }
  // Three-segment ids are only safe to treat as "<series>:<season>:<episode>"
  // when the prefix is an IMDb id (e.g. "tt1234567:1:2"). Otherwise the middle
  // segment is an addon-specific identifier (e.g. "kitsu:12345:6") rather than a
  // season, and those metas always provide explicit season/episode fields.
  if (segments.length === 3 && !/^tt\d+$/i.test(segments[0])) {
    return null;
  }
  return { season: Number(secondLastSegment), episode: Number(lastSegment) };
}

export function resolveSeasonEpisode(video = {}) {
  const fromId = parseSeasonEpisodeFromId(video.id);
  const season = firstNonNegativeInt([video.season, video.seasonNumber, fromId?.season]);
  const episode = firstNonNegativeInt([video.episode, video.episodeNumber, fromId?.episode, video.number]);
  // Some addons omit the season entirely for single-season shows and only
  // provide an episode/number; treat those as season 1 instead of discarding
  // the episode. The explicit-0-vs-missing distinction from
  // firstNonNegativeInt() is consumed right here: a season explicitly set to 0
  // (specials) skips this fallback, while an omitted season still maps to season 1.
  if (season == null && episode > 0) {
    return { season: 1, episode };
  }
  return { season: season ?? 0, episode: episode ?? 0 };
}

export function toEpisodeEntry(video = {}) {
  const { season, episode } = resolveSeasonEpisode(video);
  const runtimeMinutes = parseEpisodeRuntimeMinutes(video.runtime || video.runtimeMinutes || video.durationMinutes || video.duration);
  return {
    id: video.id || "",
    title: video.title || video.name || `S${season}E${episode}`,
    season,
    episode,
    thumbnail: video.thumbnail || null,
    overview: video.overview || video.description || "",
    runtimeMinutes,
    released:
      video.released ||
      video.releaseDate ||
      video.release_date ||
      video.firstAired ||
      video.first_aired ||
      video.airDate ||
      video.air_date ||
      "",
    available: video.available,
    imdbRating: video.imdbRating ?? video.imdb_score ?? video.ratings?.imdb ?? video.mdbListRatings?.imdb ?? video.rating ?? null
  };
}

export function shouldSynthesizeAddonVideoEpisodes(contentType = "") {
  const normalizedType = String(contentType || "")
    .trim()
    .toLowerCase();
  // Addon-defined playable types can use unnumbered videos as files in one
  // virtual season. A `tv` item is a channel unless its videos carry episode
  // coordinates, so unnumbered EPG entries must stay on the direct TV path.
  return normalizedType !== "" && !["movie", "film", "channel", "tv"].includes(normalizedType);
}

export function sortEpisodeEntries(episodes = []) {
  return episodes.sort((left, right) => {
    if (left.season === 0 || right.season === 0) {
      if (left.season !== right.season) {
        return left.season === 0 ? 1 : -1;
      }
    }
    if (left.season !== right.season) {
      return left.season - right.season;
    }
    return left.episode - right.episode;
  });
}

export function normalizeEpisodes(videos = [], contentType = "") {
  const normalizedType = String(contentType || "")
    .trim()
    .toLowerCase();
  if (normalizedType === "tv") {
    // Match Mobile's hasEpisodes gate: only videos with an explicit season or
    // episode coordinate are episodic; unnumbered EPG entries remain channels.
    return sortEpisodeEntries(
      videos
        .filter((video) => video.season != null || video.episode != null)
        .map((video) => {
          const episode = toEpisodeEntry(video);
          // Mobile groups videos without a season under specials (season 0).
          return video.season == null && video.episode != null ? { ...episode, season: 0 } : episode;
        })
        .filter((video) => video.id && video.season >= 0)
    );
  }

  const normalizedVideos = videos.map((video) => toEpisodeEntry(video)).filter((video) => video.id && video.season >= 0);
  const explicitEpisodes = normalizedVideos.filter((video) => video.episode > 0);
  if (explicitEpisodes.length > 0 || !shouldSynthesizeAddonVideoEpisodes(contentType)) {
    return sortEpisodeEntries(explicitEpisodes);
  }

  // Android TV treats videos from addon-defined types such as `other` and
  // `library` as a virtual single season when the addon omits season/episode
  // numbers. DMM Cast uses exactly this shape: the playable file ID is in
  // videos[].id and its inline stream belongs to that video, not to meta.id.
  return sortEpisodeEntries(
    normalizedVideos.map((video, index) => ({
      ...video,
      season: 1,
      episode: index + 1
    }))
  );
}

export function detailProgressFraction(progress = {}) {
  return getWatchProgressFraction(progress);
}

export function isDetailProgressCompleted(progress = {}) {
  return detailProgressFraction(progress) >= watchProgressCompletedThreshold(progress);
}

export function isSimklProgressSourceSelected() {
  return watchProgressRepository.getContinueWatchingSource() === WatchProgressSource.SIMKL;
}

export function getDetailAllProgressPromise() {
  const progressPromise = isSimklProgressSourceSelected()
    ? watchProgressRepository.getAllForContinueWatching()
    : watchProgressRepository.getAll();
  return progressPromise.catch((error) => {
    console.warn("Detail all-progress lookup failed", error);
    return [];
  });
}

export function hasCompletedSimklMovieProgress(progressItems = [], contentReference = {}) {
  return (Array.isArray(progressItems) ? progressItems : []).some((entry) => {
    return (
      String(entry?.source || "")
        .trim()
        .toLowerCase() === "simkl_playback" &&
      String(entry?.contentType || "")
        .trim()
        .toLowerCase() === "movie" &&
      entry?.season == null &&
      entry?.episode == null &&
      watchedItemsShareIdentity(entry, contentReference) &&
      isWatchProgressCompleted(entry)
    );
  });
}
