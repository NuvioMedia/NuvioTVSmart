import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import {
  libraryRepository,
  LibrarySourceMode
} from "../../../data/repository/libraryRepository.js";
import { detailWatchedEnrichmentService } from "../../../data/repository/detailWatchedEnrichmentService.js";
import { watchedSeriesReconciliationService } from "../../../data/repository/watchedSeriesReconciliationService.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import {
  showHomeRatings,
  showStandardDetailRatings
} from "../../../core/util/imdbRatingVisibility.js";
import { imdbEpisodeRatingsRepository } from "../../../data/repository/imdbEpisodeRatingsRepository.js";
import { normalizeEpisodeImdbRating, parseEpisodeRuntimeMinutes } from "./episodeCardMetadata.js";
import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import {
  MoreLikeThisSourcePreference,
  TraktSettingsStore
} from "../../../data/local/traktSettingsStore.js";
import {
  requestJson as traktRequestJson,
  TraktAuthService
} from "../../../data/repository/traktAuthService.js";
import { Environment } from "../../../platform/environment.js";
import { Platform } from "../../../platform/index.js";
import {
  TMDB_API_KEY,
  TRAKT_API_URL,
  TRAKT_CLIENT_ID,
  YOUTUBE_PROXY_URL
} from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { resolveMovieStreamIdentity } from "./movieStreamIdentity.js";
import {
  posterItemFromNode,
  PosterOptionsDialogController
} from "../../components/posterOptionsMenu.js";
import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";
import {
  WATCH_PROGRESS_COMPLETED_THRESHOLD,
  getWatchProgressFraction,
  isWatchProgressInProgress,
  resolveWatchProgressResumePositionMs
} from "../../../domain/model/watchProgress.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const EPISODE_HOLD_DELAY_MS = 650;
const POSTER_HOLD_DELAY_MS = 650;
const HERO_HOLD_DELAY_MS = 650;
const DETAIL_PROGRESS_END_THRESHOLD = WATCH_PROGRESS_COMPLETED_THRESHOLD;
const TRAKT_COMMENTS_LIMIT = 100;
const DETAIL_SCROLL_STIFFNESS = 180;
const DETAIL_SCROLL_DAMPING_RATIO = 0.95;
const DETAIL_TAB_FOCUS_TARGET = 0.4;
const DETAIL_ROW_FOCUS_TARGET = 0.33;
const DETAIL_SCROLL_MAX_FRAME_SECONDS = 0.016;
const EPISODE_VIRTUALIZATION_THRESHOLD = 72;
const EPISODE_VIRTUALIZATION_MIN_WINDOW = 20;
const EPISODE_VIRTUALIZATION_OVERSCAN = 8;
const EPISODE_VIRTUALIZATION_DEFAULT_CARD_WIDTH = 540;
const EPISODE_VIRTUALIZATION_DEFAULT_GAP = 34;
// Match Android TV's LazyRow behavior: one focus step per key event and only
// throttle native repeat events. Do not schedule a second move after keydown;
// Samsung remotes can deliver keyup late or not at all.
const EPISODE_SCROLL_REPEAT_THROTTLE_MS = 80;
const LOCAL_YOUTUBE_PROXY_URL = "youtube-proxy.html";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

// Returns the first value that is a non-negative integer (number or numeric
// string); null when none is. Whitespace-only strings, non-integers and
// non-numeric types count as missing — `Number("  ")` is 0 and would otherwise
// turn an empty field into a fake specials season. An explicit 0 is reported
// as 0 (not folded into a falsy default the way `Number(value || 0)` did) so
// resolveSeasonEpisode() can keep a declared specials season out of its
// missing-season fallback below.
function firstNonNegativeInt(values = []) {
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

// Stremio video ids frequently encode the season and episode as the trailing
// colon-separated segments (e.g. "tt1234567:1:2"). Many addons (AIOStreams and
// other aggregators included) rely on this and do NOT populate the explicit
// `season`/`episode` fields, which previously caused every episode to be
// dropped and the detail screen to report "No episodes available".
// Returns null when the id does not encode a season/episode pair.
function parseSeasonEpisodeFromId(rawId) {
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

function resolveSeasonEpisode(video = {}) {
  const fromId = parseSeasonEpisodeFromId(video.id);
  const season = firstNonNegativeInt([video.season, video.seasonNumber, fromId?.season]);
  const episode = firstNonNegativeInt([
    video.episode,
    video.episodeNumber,
    fromId?.episode,
    video.number
  ]);
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

function toEpisodeEntry(video = {}) {
  const { season, episode } = resolveSeasonEpisode(video);
  const runtimeMinutes = parseEpisodeRuntimeMinutes(
    video.runtime || video.runtimeMinutes || video.durationMinutes || video.duration
  );
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
    imdbRating:
      video.imdbRating ??
      video.imdb_score ??
      video.ratings?.imdb ??
      video.mdbListRatings?.imdb ??
      video.rating ??
      null
  };
}

function shouldSynthesizeAddonVideoEpisodes(contentType = "") {
  const normalizedType = String(contentType || "")
    .trim()
    .toLowerCase();
  return (
    normalizedType !== "" &&
    !["movie", "film", "series", "tv", "show", "tvshow", "channel"].includes(normalizedType)
  );
}

function sortEpisodeEntries(episodes = []) {
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

function normalizeEpisodes(videos = [], contentType = "") {
  const normalizedVideos = videos
    .map((video) => toEpisodeEntry(video))
    .filter((video) => video.id && video.season >= 0);
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

function detailProgressFraction(progress = {}) {
  return getWatchProgressFraction(progress);
}

function pushUniqueResumeId(ids, value) {
  const normalized = String(value || "").trim();
  if (normalized && !ids.includes(normalized)) {
    ids.push(normalized);
  }
}

function buildResumeContentIds(meta = {}, params = {}) {
  const ids = [];
  pushUniqueResumeId(ids, params?.itemId);
  pushUniqueResumeId(ids, params?.originalItemId);
  pushUniqueResumeId(ids, meta?.id);
  const imdb = String(
    meta?.ids?.imdb || meta?.imdb_id || meta?.imdbId || params?.imdbId || ""
  ).trim();
  if (imdb) {
    pushUniqueResumeId(ids, imdb);
    pushUniqueResumeId(ids, `imdb:${imdb}`);
  }
  const tmdb = meta?.ids?.tmdb ?? meta?.tmdb_id ?? meta?.tmdbId ?? params?.tmdbId;
  if (tmdb != null && String(tmdb).trim() !== "") {
    pushUniqueResumeId(ids, String(tmdb));
    pushUniqueResumeId(ids, `tmdb:${tmdb}`);
  }
  const trakt = meta?.ids?.trakt ?? meta?.trakt_id ?? meta?.traktId;
  if (trakt != null && String(trakt).trim() !== "") {
    pushUniqueResumeId(ids, String(trakt));
    pushUniqueResumeId(ids, `trakt:${trakt}`);
  }
  return ids;
}

function formatResumeRemaining(progress = {}) {
  const positionMs = Number(progress?.positionMs || 0);
  const durationMs = Number(progress?.durationMs || 0);
  if (
    !Number.isFinite(positionMs) ||
    !Number.isFinite(durationMs) ||
    positionMs <= 0 ||
    durationMs <= positionMs
  ) {
    return "";
  }
  const minutes = Math.max(1, Math.round((durationMs - positionMs) / 60000));
  const durationText = formatDurationMinutes(minutes);
  return durationText ? t("detail.timeLeftDuration", { time: durationText }, "{{time}} left") : "";
}

function isSeriesDetailMeta(meta = {}, episodes = null) {
  const normalizedType = String(meta?.type || "")
    .trim()
    .toLowerCase();
  if (normalizedType === "series") {
    return true;
  }
  const resolvedEpisodes = Array.isArray(episodes)
    ? episodes
    : normalizeEpisodes(meta?.videos || [], normalizedType);
  // Match Android TV: addon-defined types such as `other` are episodic when
  // their full meta contains videos, even if the addon omitted episode fields.
  return resolvedEpisodes.length > 0;
}

function resolvePlayableDetailType(itemType, meta = {}) {
  const rawType = String(itemType || meta?.type || "").trim();
  if (!rawType) {
    return "movie";
  }
  const normalizedType = rawType.toLowerCase();
  if (["movie", "series", "channel", "tv"].includes(normalizedType)) {
    return normalizedType;
  }
  // Match Android's ContentType.UNKNOWN behavior: preserve addon-defined API
  // types so the stream request uses the exact catalog type instead of movie.
  return rawType;
}

function resolveMetaImdbId(meta = {}, params = {}) {
  const candidates = [
    meta?.imdbId,
    meta?.imdb_id,
    meta?.externalIds?.imdb,
    meta?.external_ids?.imdb_id,
    params?.imdbId,
    params?.imdb_id,
    meta?.id,
    params?.itemId
  ];
  return (
    candidates
      .map(
        (value) =>
          String(value || "")
            .trim()
            .split(":")[0]
      )
      .find((value) => /^tt\d+$/i.test(value)) || null
  );
}

function resolveMetaTmdbId(meta = {}, params = {}) {
  const candidates = [
    meta?.tmdbId,
    meta?.tmdb_id,
    meta?.ids?.tmdb,
    meta?.externalIds?.tmdb,
    meta?.external_ids?.tmdb,
    params?.tmdbId,
    params?.tmdb_id,
    meta?.id,
    params?.itemId
  ];
  return (
    candidates
      .map(
        (value) =>
          String(value || "")
            .trim()
            .replace(/^tmdb:/i, "")
            .split(":")[0]
      )
      .find((value) => /^\d+$/.test(value)) || null
  );
}

function resolveMetaTraktId(meta = {}, params = {}) {
  const candidates = [
    meta?.traktId,
    meta?.trakt_id,
    meta?.ids?.trakt,
    meta?.externalIds?.trakt,
    meta?.external_ids?.trakt,
    params?.traktId,
    params?.trakt_id,
    meta?.id,
    params?.itemId
  ];
  return (
    candidates
      .map(
        (value) =>
          String(value || "")
            .trim()
            .replace(/^trakt:/i, "")
            .split(":")[0]
      )
      .find((value) => /^\d+$/.test(value)) || null
  );
}

function resolveMetaOriginalLanguage(meta = {}, params = {}) {
  return (
    [
      meta?.originalLanguage,
      meta?.original_language,
      params?.contentLanguage,
      params?.originalLanguage,
      params?.original_language
    ]
      .map((value) => String(value || "").trim())
      .find(Boolean) || null
  );
}

function metaWithRouteExternalIds(meta = {}, params = {}) {
  const imdbId = resolveMetaImdbId(meta, params);
  const tmdbId = resolveMetaTmdbId(meta, params);
  const traktId = resolveMetaTraktId(meta, params);
  const ids = {
    ...(meta?.ids && typeof meta.ids === "object" ? meta.ids : {})
  };
  if (imdbId && !ids.imdb) {
    ids.imdb = imdbId;
  }
  if (tmdbId && !ids.tmdb) {
    ids.tmdb = tmdbId;
  }
  if (traktId && !ids.trakt) {
    ids.trakt = traktId;
  }
  return {
    ...(meta || {}),
    ids,
    imdbId: meta?.imdbId || imdbId || null,
    tmdbId: meta?.tmdbId || tmdbId || null,
    traktId: meta?.traktId || traktId || null
  };
}

function extractCast(meta = {}) {
  const toPhoto = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    if (raw.startsWith("//")) {
      return `https:${raw}`;
    }
    if (raw.startsWith("http://")) {
      return `https://${raw.slice("http://".length)}`;
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return raw;
    }
    if (raw.startsWith("/")) {
      return `https://image.tmdb.org/t/p/w300${raw}`;
    }
    return raw;
  };
  const normalizeCastValue = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const selectBetterCastEntry = (current, candidate) => {
    if (!candidate) {
      return current;
    }
    if (!current) {
      return candidate;
    }
    const currentScore = Number(Boolean(current.photo)) + Number(Boolean(current.tmdbId));
    const candidateScore = Number(Boolean(candidate.photo)) + Number(Boolean(candidate.tmdbId));
    return candidateScore > currentScore ? candidate : current;
  };
  const mergeCastEntries = (primary = [], supplemental = []) => {
    if (!primary.length) {
      return supplemental;
    }
    if (!supplemental.length) {
      return primary;
    }

    const exactMatches = new Map();
    const nameMatches = new Map();
    supplemental.forEach((entry) => {
      const normalizedName = normalizeCastValue(entry?.name);
      if (!normalizedName) {
        return;
      }
      const normalizedCharacter = normalizeCastValue(entry?.character);
      if (normalizedCharacter) {
        const exactKey = `${normalizedName}|${normalizedCharacter}`;
        exactMatches.set(exactKey, selectBetterCastEntry(exactMatches.get(exactKey), entry));
      }
      nameMatches.set(
        normalizedName,
        selectBetterCastEntry(nameMatches.get(normalizedName), entry)
      );
    });

    return primary.map((entry) => {
      const normalizedName = normalizeCastValue(entry?.name);
      const normalizedCharacter = normalizeCastValue(entry?.character);
      const exactKey =
        normalizedName && normalizedCharacter ? `${normalizedName}|${normalizedCharacter}` : "";
      const match =
        (exactKey ? exactMatches.get(exactKey) : null) ||
        (normalizedName ? nameMatches.get(normalizedName) : null);
      return {
        ...entry,
        character: entry?.character || match?.character || "",
        photo: entry?.photo || match?.photo || "",
        tmdbId: entry?.tmdbId || match?.tmdbId || null
      };
    });
  };
  const mapCastEntries = (items = [], mapper) =>
    (Array.isArray(items) ? items : []).map(mapper).filter((entry) => Boolean(entry?.name));

  const members = Array.isArray(meta.castMembers) ? meta.castMembers : [];
  const memberEntries = mapCastEntries(members, (entry) => ({
    name: entry?.name || "",
    character: entry?.character || entry?.role || "",
    photo: toPhoto(
      entry?.photo ||
        entry?.profilePath ||
        entry?.profile_path ||
        entry?.avatar ||
        entry?.image ||
        entry?.poster ||
        ""
    ),
    tmdbId: entry?.tmdbId || entry?.id || null
  }));

  const direct = Array.isArray(meta.cast) ? meta.cast : [];
  const directEntries = mapCastEntries(direct, (entry) => {
    if (typeof entry === "string") {
      return { name: entry, character: "", photo: "", tmdbId: null };
    }
    return {
      name: entry?.name || "",
      character: entry?.character || "",
      photo: toPhoto(
        entry?.photo ||
          entry?.profilePath ||
          entry?.profile_path ||
          entry?.avatar ||
          entry?.image ||
          entry?.poster ||
          ""
      ),
      tmdbId: entry?.tmdbId || entry?.id || null
    };
  });

  const credits = meta.credits?.cast;
  const creditEntries = mapCastEntries(credits, (entry) => ({
    name: entry?.name || entry?.character || "",
    character: entry?.character || "",
    photo: toPhoto(
      entry?.profile_path ||
        entry?.photo ||
        entry?.profilePath ||
        entry?.avatar_path ||
        entry?.avatar ||
        entry?.image ||
        ""
    ),
    tmdbId: entry?.id || null
  }));

  if (memberEntries.length) {
    return mergeCastEntries(memberEntries, [...directEntries, ...creditEntries]).slice(0, 18);
  }
  if (directEntries.length) {
    return mergeCastEntries(directEntries, creditEntries).slice(0, 12);
  }
  if (creditEntries.length) {
    return creditEntries.slice(0, 12);
  }

  return [];
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function getDpadDirection(event) {
  const keyCode = Number(event?.keyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
  if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
  if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
  if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
  return null;
}

function getTrailerSeekStepSeconds(event) {
  const repeatCount = Number(event?.repeatCount || event?.detail?.repeatCount || 0);
  if (repeatCount >= 12) return 12;
  if (repeatCount >= 6) return 8;
  if (repeatCount >= 2) return 5;
  return 3;
}

function getTrailerMediaAction(event) {
  const keyCode = Number(event?.keyCode || event?.which || event?.originalKeyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  const keyName = String(event?.keyName || event?.detail?.keyName || "").toLowerCase();
  const code = String(event?.code || "").toLowerCase();
  const names = [key, keyName, code];
  if (names.some((name) => name === "mediaplaypause" || name === "playpause")) {
    return "toggle";
  }
  if (names.some((name) => name === "mediaplay" || name === "play")) {
    return "play";
  }
  if (names.some((name) => name === "mediapause" || name === "pause")) {
    return "pause";
  }
  if (keyCode === 179 || keyCode === 10252) return "toggle";
  if (keyCode === 415) return "play";
  if (keyCode === 19) return "pause";
  return "";
}

async function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4K";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  return "Auto";
}

function renderImdbBadge(rating) {
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

function formatRatingValue(value, { digits = 1, stripTrailingZero = false } = {}) {
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

function formatMdbListRating(provider, rating) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  if (["imdb", "tmdb", "letterboxd"].includes(normalizedProvider)) {
    return formatRatingValue(rating, { digits: 1 });
  }
  return formatRatingValue(rating, { digits: 1, stripTrailingZero: true });
}

function hasMdbListRatings(ratings = {}) {
  return ["trakt", "imdb", "tmdb", "letterboxd", "tomatoes", "audience", "metacritic"].some(
    (key) => ratings?.[key] != null && String(ratings[key]).trim() !== ""
  );
}

function normalizeGenreList(meta = {}) {
  const raw = Array.isArray(meta?.genres)
    ? meta.genres
    : String(meta?.genres || meta?.genre || "").split(/[•,|/]/);
  return raw.map((genre) => String(genre || "").trim()).filter(Boolean);
}

function mergeGenreLists(primary = [], fallback = []) {
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

function formatMovieReleaseDate(meta = {}) {
  const type = String(meta?.type || meta?.apiType || "").toLowerCase();
  const isMovie = type === "movie";
  const rawDate = String(meta?.released || meta?.releaseDate || meta?.release_date || "").trim();
  if (isMovie && rawDate) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? new Date(`${rawDate}T00:00:00`)
      : new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      if (LayoutPreferences.get().showFullReleaseDate === false) {
        return String(parsed.getFullYear());
      }
      return new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      }).format(parsed);
    }
  }
  return String(meta?.releaseInfo || "").trim();
}

function resolveImdbRating(meta = {}) {
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

// Ratings the addon supplied on meta.videos[].rating, in the same shape the
// episode-ratings service returns. Merged under it, so the service still wins.
function addonRatingsBySeason(episodes = []) {
  const seasons = {};
  episodes.forEach((episode) => {
    const season = Number(episode?.season);
    const number = Number(episode?.episode);
    const rating = normalizeEpisodeImdbRating(episode?.imdbRating);
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

function mergeSeasonRatings(addon = {}, service = {}) {
  const merged = {};
  new Set([...Object.keys(addon), ...Object.keys(service)]).forEach((season) => {
    const byEpisode = new Map();
    (addon[season] || []).forEach((entry) => byEpisode.set(Number(entry.episode), entry));
    (service[season] || []).forEach((entry) => byEpisode.set(Number(entry.episode), entry));
    merged[season] = [...byEpisode.values()].sort((l, r) => l.episode - r.episode);
  });
  return merged;
}

function resolveEpisodeImdbRating(episode = {}, seriesRatingsBySeason = {}) {
  const seasonRating = seriesRatingsBySeason?.[episode.season]?.find(
    (entry) => Number(entry?.episode || 0) === Number(episode.episode || 0)
  )?.rating;
  const normalizedSeasonRating = normalizeEpisodeImdbRating(seasonRating);
  if (normalizedSeasonRating != null) {
    return normalizedSeasonRating;
  }
  return normalizeEpisodeImdbRating(episode?.imdbRating);
}

function formatRuntimeMinutes(runtime) {
  return formatDurationMinutes(runtime);
}

function formatDurationMinutes(totalMinutes) {
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

function resolveEpisodeRuntimeForSeason(episodes = [], season = null) {
  const seasonNumber = Number(season || 0);
  const inSeason = episodes.find(
    (episode) =>
      Number(episode.season || 0) === seasonNumber && Number(episode.runtimeMinutes || 0) > 0
  );
  if (inSeason) {
    return Number(inSeason.runtimeMinutes || 0);
  }
  const anyEpisode = episodes.find((episode) => Number(episode.runtimeMinutes || 0) > 0);
  return anyEpisode ? Number(anyEpisode.runtimeMinutes || 0) : 0;
}

function renderPlayGlyph() {
  return `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z" fill="currentColor"/></svg>`;
}

function renderTrailerGlyph() {
  return `<svg class="series-btn-svg" viewBox="0 0 566.828 566.828" aria-hidden="true"><path d="M563.824,192.783c-1.58-17.399-3.85-32.944-6.801-46.659c-3.371-15.386-10.703-28.36-21.982-38.899c-11.285-10.539-24.412-16.652-39.383-18.348c-46.811-5.275-117.564-7.907-212.247-7.907c-94.688,0-165.436,2.632-212.248,7.907c-14.976,1.695-28.048,7.809-39.223,18.348c-11.181,10.539-18.458,23.513-21.824,38.899c-3.164,13.715-5.533,29.26-7.118,46.659c-1.579,17.399-2.479,31.793-2.687,43.183C0.098,247.343,0,263.163,0,283.414c0,20.238,0.104,36.053,0.312,47.449c0.208,11.377,1.107,25.777,2.687,43.17c1.585,17.398,3.843,32.957,6.799,46.658c3.372,15.41,10.704,28.373,21.983,38.912c11.279,10.551,24.407,16.67,39.382,18.348c46.812,5.275,117.559,7.906,212.248,7.906c94.683,0,165.431-2.631,212.247-7.906c14.971-1.684,28.043-7.797,39.225-18.348c11.174-10.539,18.451-23.502,21.822-38.912c3.164-13.701,5.533-29.26,7.119-46.658c1.578-17.398,2.479-31.793,2.686-43.17c0.209-11.391,0.318-27.211,0.318-47.449c0-20.251-0.109-36.065-0.318-47.448C566.303,224.57,565.402,210.176,563.824,192.783z M395.389,300.488L233.436,401.707c-2.956,2.111-6.537,3.164-10.753,3.164c-3.164,0-6.432-0.838-9.804-2.533c-6.958-3.795-10.441-9.688-10.441-17.705V182.189c0-8.005,3.476-13.923,10.441-17.717c7.167-3.794,14.021-3.568,20.557,0.63l161.953,101.219c6.328,3.599,9.492,9.29,9.492,17.087C404.875,291.223,401.711,296.914,395.389,300.488z" fill="currentColor"/></svg>`;
}

function renderLibraryGlyph(isSaved = false) {
  return isSaved
    ? `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`
    : `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12H20M12 4V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderWatchedBadgeGlyph(className = "series-watched-badge-svg") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`;
}

function renderWatchedGlyph(isWatched = false) {
  return isWatched
    ? `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Zm0 13c-3.04 0-5.5-2.46-5.5-5.5S8.96 6.5 12 6.5s5.5 2.46 5.5 5.5-2.46 5.5-5.5 5.5Zm0-8.8A3.3 3.3 0 0 0 8.7 12a3.3 3.3 0 1 0 6.6 0A3.3 3.3 0 0 0 12 8.7Z" fill="currentColor"/></svg>`
    : `<svg class="series-btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m2.1 3.51 1.39-1.39 18 18-1.39 1.39-2.94-2.94A10.94 10.94 0 0 1 12 19.5C7 19.5 2.73 16.39 1 12c.8-2.03 2.18-3.79 3.95-5.09L2.1 3.51Zm7.46 7.46 4.92 4.92A3.47 3.47 0 0 1 12 16.5 4.5 4.5 0 0 1 7.5 12c0-.9.27-1.74.73-2.47l1.33 1.44Zm6.05 6.05-1.67-1.67c-.61.41-1.34.65-2.12.65A4.5 4.5 0 0 1 7.33 11.5c0-.78.24-1.51.65-2.12L5.3 6.7A9.65 9.65 0 0 0 2.96 12c1.51 3.52 5.02 6 9.04 6 1.34 0 2.63-.28 3.61-.98ZM12 7.5c2.49 0 4.5 2.01 4.5 4.5 0 .78-.2 1.5-.56 2.13l2.59 2.59A9.77 9.77 0 0 0 21.04 12c-1.51-3.52-5.02-6-9.04-6-1.39 0-2.7.29-3.88 1.02l1.86 1.86c.62-.24 1.3-.38 2.02-.38Zm-.49 1.55 3.44 3.44c.03-.16.05-.32.05-.49A3 3 0 0 0 12 9c-.17 0-.33.02-.49.05Z" fill="currentColor"/></svg>`;
}

function ratingToneClass(value) {
  const num = Number(value || 0);
  if (num >= 9) return "excellent";
  if (num >= 8) return "great";
  if (num >= 7.5) return "good";
  if (num >= 7) return "mixed";
  if (num >= 6) return "bad";
  if (num > 0) return "poor";
  return "normal";
}

function getAddonIconPath(addonName = "") {
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

function getAddonBadgeLabel(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) {
    return "A";
  }
  if (/torrentio|torbox|torrent/i.test(cleaned)) {
    return "µ";
  }
  return (
    cleaned
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || cleaned.charAt(0).toUpperCase()
  );
}

function renderStreamAddonIcon(addonName = "") {
  const iconPath = getAddonIconPath(addonName);
  const fallback = escapeHtml(getAddonBadgeLabel(addonName));
  if (!iconPath) {
    return `<span class="series-stream-addon-fallback" aria-hidden="true">${fallback}</span>`;
  }
  return `
    <span class="series-stream-addon-badge" aria-hidden="true">
      <img class="series-stream-addon-icon" src="${escapeHtml(iconPath)}" alt="" decoding="async" onerror="this.hidden=true;var fallback=this.nextElementSibling;if(fallback){fallback.hidden=false;}" />
      <span class="series-stream-addon-fallback" hidden>${fallback}</span>
    </span>
  `;
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}

function escapeSelectorValue(value = "") {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function normalizeCountryLabel(raw = "") {
  return String(raw || "")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      return /^[A-Za-z]{2,3}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
    })
    .filter(Boolean)
    .join(", ");
}

function normalizePreviewItem(item = {}, fallbackType = "movie") {
  return {
    id: String(item.id || ""),
    name: item.name || item.title || "Untitled",
    type: item.type || item.apiType || fallbackType,
    poster: item.poster || "",
    landscapePoster: item.landscapePoster || item.background || item.poster || "",
    releaseInfo: item.releaseInfo || item.year || ""
  };
}

function bestTraktArtwork(images = {}, kind) {
  const candidates = images?.[kind];
  if (Array.isArray(candidates)) {
    return candidates.find((entry) => typeof entry === "string" && entry) || "";
  }
  if (typeof candidates === "string") return candidates;
  if (candidates && typeof candidates === "object") {
    return candidates.full || candidates.medium || candidates.thumb || "";
  }
  return "";
}

function traktRelatedPreview(media = {}, type = "movie") {
  const ids = media.ids || {};
  const id = ids.imdb
    ? String(ids.imdb)
    : ids.tmdb != null
      ? `tmdb:${ids.tmdb}`
      : ids.trakt != null
        ? `trakt:${ids.trakt}`
        : "";
  if (!id || !(media.title || media.original_title)) return null;
  const landscape = bestTraktArtwork(media.images, "fanart");
  const poster = bestTraktArtwork(media.images, "poster");
  return normalizePreviewItem(
    {
      id,
      name: media.title || media.original_title,
      type,
      poster: landscape || poster,
      landscapePoster: landscape || poster,
      releaseInfo: media.year == null ? "" : String(media.year)
    },
    type
  );
}

function normalizeEpisodeTitle(rawTitle, episodeNumber) {
  const label = t("episodes_episode", {}, "Episode");
  const trimmed = String(rawTitle || "").trim();
  const number = Number(episodeNumber || 0);
  if (!trimmed) {
    return number > 0 ? `${label} ${number}` : label;
  }
  const match = trimmed.match(/^episode\s*(\d+)$/i);
  if (match) {
    return `${label} ${match[1]}`;
  }
  return trimmed;
}

function extractPreviewYear(value = "") {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function resolveYoutubeId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  const watchMatch = raw.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) {
    return watchMatch[1];
  }
  const shortMatch = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }
  const embedMatch = raw.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch?.[1]) {
    return embedMatch[1];
  }
  return "";
}

function shouldUseDirectYoutubeEmbedOnTv() {
  return (Platform.isWebOS() || Platform.isTizen()) && !getYoutubeProxyBaseUrl();
}

function getYoutubeProxyBaseUrl() {
  const configured = String(YOUTUBE_PROXY_URL || "").trim();
  if (Platform.isWebOS() || Platform.isTizen()) {
    // The local proxy is served from a file:// origin, which YouTube rejects
    // (embed error 153). Prefer a configured https-hosted proxy when available
    // so the embedding origin is valid; otherwise fall back to the local file.
    return /^https?:\/\//i.test(configured) ? configured : LOCAL_YOUTUBE_PROXY_URL;
  }
  return configured || LOCAL_YOUTUBE_PROXY_URL;
}

function resolveTrailerPostMessageTargetOrigin(src = "") {
  try {
    const url = new URL(String(src || ""), globalThis?.location?.href || "https://example.com/");
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch (_) {
    // Fall through to wildcard for opaque/file origins.
  }
  return "*";
}

function resolveTrailerTrustedProxyOrigin() {
  try {
    const url = new URL(
      getYoutubeProxyBaseUrl(),
      globalThis?.location?.href || "https://example.com/"
    );
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch (_) {
    // Local file origins are validated by event.source instead.
  }
  return "";
}

function buildDirectYoutubeEmbedUrl(cleanId = "", { muted = false, loop = true } = {}) {
  const videoId = String(cleanId || "").trim();
  if (!videoId || !Environment.isBrowser()) {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: loop ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    cc_load_policy: "0",
    iv_load_policy: "3"
  });
  if (loop) {
    params.set("playlist", videoId);
  }
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function buildYoutubeEmbedUrl(ytId = "", { muted = false } = {}) {
  const cleanId = String(ytId || "").trim();
  if (!cleanId) {
    return "";
  }
  if (shouldUseDirectYoutubeEmbedOnTv()) {
    return buildDirectYoutubeEmbedUrl(cleanId, { muted });
  }
  const proxyBase = getYoutubeProxyBaseUrl();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", muted ? "1" : "0");
      proxyUrl.searchParams.set("controls", "0");
      proxyUrl.searchParams.set("loop", "1");
      proxyUrl.searchParams.set("playlist", cleanId);
      proxyUrl.searchParams.set("playsinline", "1");
      proxyUrl.searchParams.set("rel", "0");
      proxyUrl.searchParams.set("cc_load_policy", "0");
      proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      return proxyUrl.toString();
    } catch (_) {
      return "";
    }
  }
  if (!Environment.isBrowser()) {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: "1",
    playlist: cleanId,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    cc_load_policy: "0",
    enablejsapi: "1"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

function buildInlineYoutubePlayerUrl(
  ytId = "",
  { muted = false, loop = false, statePollMs = 250 } = {}
) {
  const cleanId = String(ytId || "").trim();
  if (!cleanId) {
    return "";
  }
  if (shouldUseDirectYoutubeEmbedOnTv()) {
    return buildDirectYoutubeEmbedUrl(cleanId, { muted, loop });
  }
  const proxyBase = getYoutubeProxyBaseUrl();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", muted ? "1" : "0");
      proxyUrl.searchParams.set("controls", "0");
      proxyUrl.searchParams.set("loop", loop ? "1" : "0");
      if (loop) {
        proxyUrl.searchParams.set("playlist", cleanId);
      } else {
        proxyUrl.searchParams.delete("playlist");
      }
      proxyUrl.searchParams.set("playsinline", "1");
      proxyUrl.searchParams.set("rel", "0");
      proxyUrl.searchParams.set("cc_load_policy", "0");
      proxyUrl.searchParams.set("state_poll_ms", String(Math.max(0, Number(statePollMs || 0))));
      proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      return proxyUrl.toString();
    } catch (_) {
      return "";
    }
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: loop ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1"
  });
  if (loop) {
    params.set("playlist", cleanId);
  }
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

function resolveTrailerSource(meta = {}) {
  const trailerCandidates = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.videos) ? meta.videos : [])
  ];
  for (const entry of trailerCandidates) {
    const ytId = resolveYoutubeId(
      entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || ""
    );
    if (ytId) {
      const embedUrl = buildYoutubeEmbedUrl(ytId);
      if (!embedUrl) {
        continue;
      }
      return {
        kind: "youtube",
        ytId,
        embedUrl
      };
    }
  }
  const ytId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!ytId) {
    return null;
  }
  const embedUrl = buildYoutubeEmbedUrl(ytId);
  if (!embedUrl) {
    return null;
  }
  return {
    kind: "youtube",
    ytId,
    embedUrl
  };
}

function resolveTrailerItems(meta = {}) {
  const candidates = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.trailerYtIds)
      ? meta.trailerYtIds.map((ytId) => ({ ytId, name: "Trailer" }))
      : [])
  ];
  const seen = new Set();
  return candidates
    .map((entry) => {
      const ytId = resolveYoutubeId(
        typeof entry === "string"
          ? entry
          : entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || ""
      );
      if (!ytId || seen.has(ytId)) return null;
      seen.add(ytId);
      return {
        ytId,
        name: typeof entry === "object" ? entry.name || entry.type || "Trailer" : "Trailer",
        type: typeof entry === "object" ? entry.type || "" : "",
        lang: typeof entry === "object" ? entry.lang || entry.language || "" : ""
      };
    })
    .filter(Boolean);
}

function stripTraktSpoilerMarkup(value = "") {
  return String(value || "")
    .replace(/\[\/?spoiler\]/gi, "")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function containsTraktInlineSpoiler(value = "") {
  return /\[spoiler\].*?\[\/spoiler\]/is.test(String(value || ""));
}

function formatEpisodeCardDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const localDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const parsed =
    localDateMatch && !raw.includes("T")
      ? new Date(
          Number(localDateMatch[1]),
          Number(localDateMatch[2]) - 1,
          Number(localDateMatch[3])
        )
      : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function renderEpisodeRuntimeLabel(runtimeMinutes = 0) {
  const runtime = formatRuntimeMinutes(runtimeMinutes);
  if (!runtime) {
    return "";
  }
  return `
    <span class="series-episode-runtime">
      <svg class="series-episode-runtime-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.1 3.3 3.3-1.4 1.4L11 12.9V6h2v6.1Z"></path>
      </svg>
      <span>${escapeHtml(runtime)}</span>
    </span>
  `;
}

function formatPlaybackTime(value = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeTrailerProxyStatePayload(
  payload,
  fallbackMuted = false,
  fallbackCaptionsEnabled = false
) {
  const source = payload && typeof payload === "object" ? payload : {};
  const nestedState = source.state && typeof source.state === "object" ? source.state : null;
  const candidate = nestedState || source;
  return {
    currentTime: Number(candidate.currentTime || 0),
    duration: Number(candidate.duration || 0),
    playerState: Number(candidate.playerState ?? -1),
    ended: Boolean(candidate.ended),
    paused: Boolean(candidate.paused),
    muted: candidate.muted == null ? Boolean(fallbackMuted) : Boolean(candidate.muted),
    captionsEnabled:
      candidate.captionsEnabled == null
        ? Boolean(fallbackCaptionsEnabled)
        : Boolean(candidate.captionsEnabled),
    loading: Boolean(candidate.loading),
    controllable: candidate.controllable !== false
  };
}

function captureHorizontalScrollMap(container) {
  const state = {};
  Array.from(container?.querySelectorAll("[data-scroll-key]") || []).forEach((node) => {
    const key = String(node.dataset.scrollKey || "").trim();
    if (!key) {
      return;
    }
    state[key] = Number(node.scrollLeft || 0);
  });
  return state;
}

export const MetaDetailsScreen = {
  getRouteStateKey(params = {}) {
    const itemId = String(params?.itemId || "").trim();
    if (!itemId) {
      return null;
    }
    return `detail:${String(params?.itemType || "movie").trim() || "movie"}:${itemId}`;
  },

  captureRouteState() {
    const content = this.container?.querySelector(".series-detail-content");
    return {
      params: this.params ? { ...this.params } : {},
      meta: this.meta ? { ...this.meta } : null,
      isSavedInLibrary: Boolean(this.isSavedInLibrary),
      isMarkedWatched: Boolean(this.isMarkedWatched),
      episodes: Array.isArray(this.episodes) ? [...this.episodes] : [],
      castItems: Array.isArray(this.castItems) ? [...this.castItems] : [],
      moreLikeThisItems: Array.isArray(this.moreLikeThisItems) ? [...this.moreLikeThisItems] : [],
      moreLikeThisSource: this.moreLikeThisSource || null,
      collectionItems: Array.isArray(this.collectionItems) ? [...this.collectionItems] : [],
      commentsItems: Array.isArray(this.commentsItems) ? [...this.commentsItems] : [],
      collectionName: String(this.collectionName || ""),
      seriesRatingsBySeason: this.seriesRatingsBySeason ? { ...this.seriesRatingsBySeason } : {},
      nextEpisodeToWatch: this.nextEpisodeToWatch ? { ...this.nextEpisodeToWatch } : null,
      trailerSource: this.trailerSource ? { ...this.trailerSource } : null,
      selectedSeason: Number(this.selectedSeason || 0),
      selectedRatingSeason: Number(this.selectedRatingSeason || 0),
      seriesInsightTab: String(this.seriesInsightTab || "cast"),
      movieInsightTab: String(this.movieInsightTab || "cast"),
      commentsPage: Number(this.commentsPage || 0),
      commentsPageCount: Number(this.commentsPageCount || 0),
      episodeFocusIndexBySeason: this.episodeFocusIndexBySeason
        ? { ...this.episodeFocusIndexBySeason }
        : {},
      railFocusIndexByKey: this.railFocusIndexByKey ? { ...this.railFocusIndexByKey } : {},
      pendingFocusRestore: this.captureDetailFocus(),
      contentScrollTop: Number(content?.scrollTop || 0),
      trackScrollLeftByKey: captureHorizontalScrollMap(this.container),
      episodeProgressEntries: Array.from(this.episodeProgressMap?.entries?.() || []),
      watchedEpisodeKeys: Array.from(this.watchedEpisodeKeys || [])
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    const restoredItemId = String(snapshot?.params?.itemId || "").trim();
    const nextItemId = String(params?.itemId || "").trim();
    if (!snapshot?.meta || !restoredItemId || restoredItemId !== nextItemId) {
      return false;
    }
    this.params = params || {};
    this.meta = { ...snapshot.meta };
    this.isSavedInLibrary = Boolean(snapshot.isSavedInLibrary);
    this.isMarkedWatched = Boolean(snapshot.isMarkedWatched);
    this.episodes = Array.isArray(snapshot.episodes) ? [...snapshot.episodes] : [];
    this.castItems = Array.isArray(snapshot.castItems) ? [...snapshot.castItems] : [];
    this.moreLikeThisItems = Array.isArray(snapshot.moreLikeThisItems)
      ? [...snapshot.moreLikeThisItems]
      : [];
    this.moreLikeThisSource = snapshot.moreLikeThisSource || null;
    this.collectionItems = Array.isArray(snapshot.collectionItems)
      ? [...snapshot.collectionItems]
      : [];
    this.commentsItems = Array.isArray(snapshot.commentsItems) ? [...snapshot.commentsItems] : [];
    this.collectionName = String(snapshot.collectionName || "");
    this.seriesRatingsBySeason = snapshot.seriesRatingsBySeason
      ? { ...snapshot.seriesRatingsBySeason }
      : {};
    this.nextEpisodeToWatch = snapshot.nextEpisodeToWatch
      ? { ...snapshot.nextEpisodeToWatch }
      : null;
    this.trailerSource = snapshot.trailerSource
      ? { ...snapshot.trailerSource }
      : resolveTrailerSource(this.meta);
    this.selectedSeason = Number(snapshot.selectedSeason ?? this.episodes[0]?.season ?? 1);
    this.selectedRatingSeason = Number(snapshot.selectedRatingSeason || this.selectedSeason || 1);
    this.seriesInsightTab = String(snapshot.seriesInsightTab || "cast");
    this.movieInsightTab = String(snapshot.movieInsightTab || "cast");
    this.commentsPage = Number(snapshot.commentsPage || 0);
    this.commentsPageCount = Number(snapshot.commentsPageCount || 0);
    this.episodeFocusIndexBySeason =
      snapshot.episodeFocusIndexBySeason && typeof snapshot.episodeFocusIndexBySeason === "object"
        ? { ...snapshot.episodeFocusIndexBySeason }
        : {};
    this.railFocusIndexByKey =
      snapshot.railFocusIndexByKey && typeof snapshot.railFocusIndexByKey === "object"
        ? { ...snapshot.railFocusIndexByKey }
        : {};
    this.pendingFocusRestore = snapshot.pendingFocusRestore
      ? { ...snapshot.pendingFocusRestore }
      : null;
    this.restoredContentScrollTop = Number(snapshot.contentScrollTop || 0);
    this.restoredTrackScrollLeftByKey =
      snapshot.trackScrollLeftByKey && typeof snapshot.trackScrollLeftByKey === "object"
        ? { ...snapshot.trackScrollLeftByKey }
        : {};
    this.episodeProgressMap = new Map(
      Array.isArray(snapshot.episodeProgressEntries) ? snapshot.episodeProgressEntries : []
    );
    this.watchedEpisodeKeys = new Set(
      Array.isArray(snapshot.watchedEpisodeKeys) ? snapshot.watchedEpisodeKeys : []
    );
    return true;
  },

  bindTrailerProxyMessaging() {
    if (this.trailerProxyMessageHandler) {
      window.removeEventListener("message", this.trailerProxyMessageHandler);
    }
    const trustedProxyOrigin = resolveTrailerTrustedProxyOrigin();
    this.trailerProxyMessageHandler = (event) => {
      const frameWindow = this.trailerUiRefs?.frame?.contentWindow;
      const data = event?.data;
      if (!data || typeof data !== "object" || data.source !== "nuvio-youtube-proxy") {
        return;
      }
      const eventOrigin = String(event?.origin || "").trim();
      const sourceMatchesFrame = Boolean(frameWindow && event?.source === frameWindow);
      const originMatchesProxy = Boolean(trustedProxyOrigin && eventOrigin === trustedProxyOrigin);
      if (!sourceMatchesFrame && !originMatchesProxy) {
        return;
      }
      if (data.type === "ready") {
        this.stopTrailerProxyLoadingTimer();
        this.trailerProxyState = {
          currentTime: 0,
          duration: 0,
          paused: false,
          muted: Boolean(this.trailerMuted),
          captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
          loading: true,
          controllable: true
        };
        this.postTrailerProxyCommand("setMuted", {
          muted: Boolean(this.trailerMuted)
        });
        this.postTrailerProxyCommand("setCaptionsEnabled", {
          enabled: Boolean(this.trailerSubtitlesEnabled)
        });
        this.postTrailerProxyCommand("play");
        this.postTrailerProxyCommand("getState");
        this.startTrailerFirstFramePolling();
        if (this.trailerPlaybackMode === "manual") {
          this.updateTrailerOverlay();
        }
        return;
      }
      if (data.type === "ended") {
        const endedId = String(data.videoId || "").trim();
        const activeId = String(this.trailerSource?.ytId || "").trim();
        if (
          this.isTrailerPlaying &&
          this.trailerSource?.kind === "youtube" &&
          (!endedId || !activeId || endedId === activeId)
        ) {
          this.stopTrailerPlayback();
        }
        return;
      }
      if (data.type === "firstFrame") {
        const frameVideoId = String(data.videoId || "").trim();
        const activeId = String(this.trailerSource?.ytId || "").trim();
        const frameTime = Number(data.currentTime || 0);
        if (frameTime > 0 && (!frameVideoId || !activeId || frameVideoId === activeId)) {
          this.markTrailerVisualReady();
        }
        return;
      }
      if (data.type === "state") {
        const stateVideoId = String(data.videoId || "").trim();
        const activeVideoId = String(this.trailerSource?.ytId || "").trim();
        if (stateVideoId && activeVideoId && stateVideoId !== activeVideoId) {
          return;
        }
        const nextState = normalizeTrailerProxyStatePayload(
          data,
          this.trailerMuted,
          this.trailerSubtitlesEnabled
        );
        if (
          nextState.loading === false ||
          Number(nextState.duration || 0) > 0 ||
          Number(nextState.currentTime || 0) > 0
        ) {
          this.stopTrailerProxyLoadingTimer();
        }
        this.trailerProxyState = nextState;
        this.trailerYoutubeFallbackActive = nextState.controllable === false;
        if (this.trailerYoutubeFallbackActive) {
          this.scheduleTrailerFallbackReveal(activeVideoId);
        }
        if (!nextState.loading && Number(nextState.currentTime || 0) > 0) {
          this.markTrailerVisualReady();
        }
        if (nextState.ended) {
          this.stopTrailerPlayback();
          return;
        }
        if (this.trailerPlaybackMode === "manual") {
          this.updateTrailerOverlay();
        }
      }
    };
    window.addEventListener("message", this.trailerProxyMessageHandler);
  },

  postTrailerProxyCommand(command, payload = {}) {
    const frameWindow = this.trailerUiRefs?.frame?.contentWindow;
    if (!frameWindow) {
      return false;
    }
    const src = String(this.trailerUiRefs?.frame?.src || this.trailerSource?.embedUrl || "");
    const targetOrigin = resolveTrailerPostMessageTargetOrigin(src);
    try {
      frameWindow.postMessage(
        {
          source: "nuvio-detail-trailer",
          type: "command",
          command: String(command || ""),
          payload: payload && typeof payload === "object" ? payload : {}
        },
        targetOrigin
      );
      return true;
    } catch (_) {
      return false;
    }
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("detail");
    ScreenUtils.show(this.container);
    this.stopTrailerPlayback({
      keepDom: false,
      restartAutoplay: false,
      restoreFocus: false
    });
    this.params = params;
    this.isBackNavigation = Boolean(navigationContext?.isBackNavigation);
    this.pendingEpisodeSelection = null;
    this.pendingMovieSelection = null;
    this.episodeHoldMenu = null;
    this.seasonHoldMenu = null;
    this.heroPlayMenu = null;
    this.libraryListMenu = null;
    this.detailHoldDialog = null;
    this.posterOptionsController = null;
    this.posterOptionsFocusRestore = null;
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;
    this.pendingHeroHoldTarget = null;
    this.pendingHeroHoldTimer = null;
    this.streamChooserFocus = null;
    this.streamChooserLoadToken = 0;
    this.isLoadingDetail = true;
    this.detailLoadToken = (this.detailLoadToken || 0) + 1;
    this.seriesInsightTab = "cast";
    this.movieInsightTab = "cast";
    this.selectedRatingSeason = 0;
    this.selectedSeason = 0;
    this.hasManualSeasonSelection = false;
    this.collectionItems = [];
    this.collectionName = "";
    this.commentsItems = [];
    this.commentsPage = 0;
    this.commentsPageCount = 0;
    this.commentsError = "";
    this.commentsLoading = false;
    this.commentsLoadingMore = false;
    this.commentsMode = "title";
    this.commentsEpisodeTarget = null;
    this.selectedCommentIndex = -1;
    this.trailerSource = null;
    this.isTrailerPlaying = false;
    this.trailerPlaybackMode = null;
    this.trailerVisualReady = false;
    this.trailerHasAutoplayed = false;
    this.trailerMuted = false;
    this.trailerSubtitlesEnabled = false;
    this.trailerMediaListeners = [];
    this.trailerUiRefs = null;
    this.trailerProgressTimer = null;
    this.trailerControlsTimer = null;
    this.trailerProxyLoadingTimer = null;
    this.trailerFirstFramePollTimer = null;
    this.trailerFallbackRevealTimer = null;
    this.trailerControlsVisible = true;
    this.trailerProxyState = null;
    this.trailerProxyMessageHandler = null;
    this.trailerYoutubeFallbackActive = false;
    this.trailerDomGeneration = 0;
    this.trailerFocusRestore = null;
    this.episodeProgressMap = new Map();
    this.resumeProgress = null;
    this.resumeContentIds = [];
    this.episodeFocusIndexBySeason = {};
    this.episodeVirtualWindow = null;
    this.episodeVirtualMetrics = null;
    this.episodeTrackScrollHandler = null;
    this.episodeTrackScrollNode = null;
    this.episodeVirtualSyncRaf = null;
    this.lastEpisodeHorizontalKeyRepeatAt = 0;
    this.episodeThumbnailPrefetchCache = new Set();
    this.selectedSeasonEpisodeState = null;
    this.railFocusIndexByKey = {};
    this.watchedEpisodeKeys = new Set();
    this.autoOpenedContinueWatchingStream = false;
    this.restoredContentScrollTop = 0;
    this.restoredTrackScrollLeftByKey = {};
    this.bindTrailerProxyMessaging();

    // Route snapshots preserve focus and scroll when navigating Back. A fresh
    // entry from Home must reload metadata instead of reviving a stale detail
    // snapshot captured before playback/background enrichment completed.
    const restoredRouteState = navigationContext?.isBackNavigation
      ? navigationContext?.restoredState || null
      : null;
    if (this.hydrateFromRouteState(restoredRouteState, params)) {
      this.isLoadingDetail = false;
      this.render(this.meta, this.pendingFocusRestore);
      const refreshToken = this.detailLoadToken;
      void this.refreshEpisodePlaybackState()
        .then(() => {
          if (refreshToken !== this.detailLoadToken || !this.container) {
            return;
          }
          this.updateRenderedDetailSections(this.meta, this.pendingFocusRestore || null);
        })
        .catch((error) => {
          console.warn("Detail playback state refresh failed", error);
        });
      if (!hasMdbListRatings(this.meta?.mdbListRatings)) {
        void this.loadMdbListRatings(this.meta, refreshToken);
      }
      this.maybeAutoOpenContinueWatchingStream();
      return;
    }

    this.container.innerHTML = `
      <div class="detail-loading-shell" aria-label="Loading detail">
        <div class="detail-loading-top">
          <div class="detail-loading-block detail-loading-poster"></div>
        </div>
        <div class="detail-loading-meta">
          <div class="detail-loading-block detail-loading-pill"></div>
          <div class="detail-loading-block detail-loading-pill short"></div>
        </div>
        <div class="detail-loading-copy">
          <div class="detail-loading-block detail-loading-line"></div>
          <div class="detail-loading-block detail-loading-line wide"></div>
          <div class="detail-loading-block detail-loading-line mid"></div>
        </div>
        <div class="detail-loading-tags">
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
        </div>
        <div class="detail-loading-tags">
          <div class="detail-loading-block detail-loading-chip"></div>
          <div class="detail-loading-block detail-loading-chip"></div>
        </div>
      </div>
    `;

    await this.loadDetail();
  },

  async loadDetail() {
    const token = this.detailLoadToken;
    let { itemId, itemType = "movie", fallbackTitle = "Untitled" } = this.params || {};
    if (!itemId) {
      this.renderError("Item id mancante.");
      return;
    }

    const sourceItemId = itemId;
    const sourceAddonBaseUrl = String(this.params?.addonBaseUrl || "").trim();
    // Match Android's MetaPreview.apiType semantics: the type declared by the
    // individual meta wins, while the catalog type is only a fallback. An
    // aggregator may expose a `channel` catalog whose entries are `tv`; using
    // the row type here makes the original TV addon miss both meta and streams.
    const sourceItemType = String(itemType || this.params?.catalogType).trim() || "movie";
    const canonicalItemId = await this.resolveCanonicalDetailItemId(itemId, itemType);
    if (token !== this.detailLoadToken) {
      return;
    }
    if (canonicalItemId && canonicalItemId !== itemId) {
      this.params = {
        ...(this.params || {}),
        itemId: canonicalItemId,
        originalItemId: this.params?.originalItemId || itemId
      };
      itemId = canonicalItemId;
    }

    const loadMeta = async () => {
      const globalResultPromise = metaRepository.getMetaFromAllAddons(itemType, itemId);
      if (sourceAddonBaseUrl && LayoutPreferences.get().preferExternalMetaAddonDetail !== false) {
        const sourceResult = await withTimeout(
          metaRepository.getMeta(sourceAddonBaseUrl, sourceItemType, sourceItemId),
          1800,
          { status: "error", message: "timeout" }
        );
        if (sourceResult.status === "success") {
          const sourceMeta = sourceResult.data || {};
          if (!sourceMeta.background) {
            const ownerResult = await withTimeout(globalResultPromise, 2200, {
              status: "error",
              message: "timeout"
            });
            if (ownerResult.status === "success") {
              const ownerMeta = ownerResult.data || {};
              return {
                status: "success",
                data: {
                  ...ownerMeta,
                  ...sourceMeta,
                  id: sourceMeta.id || ownerMeta.id || sourceItemId,
                  type: sourceMeta.type || ownerMeta.type || sourceItemType,
                  poster: sourceMeta.poster || ownerMeta.poster || null,
                  background: sourceMeta.background || ownerMeta.background || null,
                  logo: sourceMeta.logo || ownerMeta.logo || null,
                  description: sourceMeta.description || ownerMeta.description || "",
                  genres:
                    Array.isArray(sourceMeta.genres) && sourceMeta.genres.length
                      ? sourceMeta.genres
                      : ownerMeta.genres || [],
                  videos:
                    Array.isArray(sourceMeta.videos) && sourceMeta.videos.length
                      ? sourceMeta.videos
                      : ownerMeta.videos || []
                }
              };
            }
          }
          return sourceResult;
        }
      }
      return globalResultPromise;
    };
    const metaPromise = withTimeout(loadMeta(), 4500, {
      status: "error",
      message: "timeout"
    });
    const isSavedPromise = savedLibraryRepository.isSaved(itemId);
    const progressPromise = watchProgressRepository.getResumeByContentId(itemId);
    const watchedItemPromise = watchedItemsRepository.isWatched(itemId);
    const allProgressPromise = watchProgressRepository.getAll();
    const allWatchedPromise = watchedItemsRepository.getAll();

    const [metaResult, isSaved, initialProgress, watchedItem, allProgressItems, allWatchedItems] =
      await Promise.all([
        metaPromise,
        isSavedPromise,
        progressPromise,
        watchedItemPromise,
        allProgressPromise,
        allWatchedPromise
      ]);
    const meta =
      metaResult.status === "success"
        ? metaResult.data
        : {
            id: itemId,
            type: itemType,
            name: fallbackTitle,
            poster: this.params?.fallbackPoster || null,
            background: this.params?.fallbackBackground || null,
            description: ""
          };
    if (token !== this.detailLoadToken) {
      return;
    }
    this.resumeContentIds = buildResumeContentIds(meta, this.params);
    let progress = initialProgress;
    if (!progress && this.resumeContentIds.length > 1) {
      progress = await watchProgressRepository
        .getResumeByContentIds(this.resumeContentIds)
        .catch((error) => {
          console.warn("Detail resume lookup failed", error);
          return null;
        });
      if (token !== this.detailLoadToken) {
        return;
      }
    }
    this.resumeProgress = progress && isWatchProgressInProgress(progress) ? progress : null;
    this.isSavedInLibrary = isSaved;
    this.isMarkedWatched = Boolean(
      watchedItem ||
      (progress &&
        Number(progress.durationMs || 0) > 0 &&
        Number(progress.positionMs || 0) >= Number(progress.durationMs || 0))
    );

    // Fast first paint with base metadata.
    this.meta = meta;
    this.episodes = normalizeEpisodes(meta?.videos || [], meta?.type || itemType);
    this.castItems = extractCast(meta);
    const progressItemsForDetail = this.resumeProgress
      ? [this.resumeProgress, ...allProgressItems]
      : allProgressItems;
    this.buildEpisodeState(progressItemsForDetail, allWatchedItems);
    this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(this.resumeProgress || progress);
    this.selectedSeason = this.resolveInitialSelectedSeason(
      this.resumeProgress || progress,
      progressItemsForDetail
    );
    this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
    this.moreLikeThisItems = [];
    this.moreLikeThisSource = null;
    this.collectionItems = [];
    this.collectionName = "";
    this.streamItems = [];
    this.trailerSource = resolveTrailerSource(meta);
    if (isSeriesDetailMeta(meta, this.episodes)) {
      this.seriesRatingsBySeason = {};
    } else {
      this.seriesRatingsBySeason = {};
    }
    this.render(meta);
    this.isLoadingDetail = false;
    this.maybeAutoOpenContinueWatchingStream();
    void this.refreshTrailerSource(meta, token);
    void this.loadTraktComments({ force: true });

    // Match Android TV: recommendations are an independent detail-page job.
    // Starting them from the base meta keeps slower artwork/credits enrichment
    // (and its optional cast fallback) from delaying or starving this section.
    void withTimeout(this.fetchMoreLikeThis(meta), 5000, [])
      .then((items) => {
        if (token !== this.detailLoadToken) {
          return;
        }
        this.moreLikeThisItems = Array.isArray(items) ? items : [];
        this.updateRenderedDetailSections(this.meta || meta);
      })
      .catch((error) => {
        console.warn("More like this background load failed", error);
      });

    // Background enrichments: do not block initial screen rendering.
    (async () => {
      const enrichedMeta = await withTimeout(this.enrichMeta(meta), 4000, meta);
      if (token !== this.detailLoadToken) {
        return;
      }

      this.meta = enrichedMeta || meta;
      this.episodes = normalizeEpisodes(
        this.meta?.videos || [],
        this.meta?.type || this.params?.itemType
      );
      this.castItems = extractCast(this.meta);
      this.buildEpisodeState(progressItemsForDetail, allWatchedItems);
      this.trailerSource = resolveTrailerSource(this.meta);
      if (!this.castItems.length) {
        const fallbackCast = await withTimeout(this.fetchTmdbCastFallback(this.meta), 3200, []);
        if (Array.isArray(fallbackCast) && fallbackCast.length) {
          this.castItems = fallbackCast;
        }
      }
      this.selectedSeason = this.resolveInitialSelectedSeason(
        this.resumeProgress || progress,
        progressItemsForDetail
      );
      this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
      this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(this.resumeProgress || progress);
      this.updateRenderedDetailSections(this.meta);
      void this.loadMdbListRatings(this.meta, token);
      void this.refreshTrailerSource(this.meta, token);
      void this.loadTraktComments({ force: true });

      const tasks = [];
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
        tasks.push(withTimeout(this.fetchSeriesRatingsBySeason(this.meta), 5000, {}));
        const traktId = this.meta?.ids?.trakt;
        if (traktId) {
          tasks.push(
            withTimeout(
              detailWatchedEnrichmentService.enrichSeriesWatchedState(
                this.episodes,
                this.params?.itemId,
                traktId
              ),
              4500,
              new Map()
            )
          );
        }
      } else {
        tasks.push(
          withTimeout(this.fetchMovieCollection(this.meta), 5000, { items: [], name: "" })
        );
        const movieTraktId = this.meta?.ids?.trakt;
        if (movieTraktId) {
          tasks.push(
            withTimeout(
              detailWatchedEnrichmentService.enrichMovieWatchedState(
                this.params?.itemId,
                movieTraktId
              ),
              4500,
              null
            )
          );
        }
      }
      const results = await Promise.all(tasks);
      if (token !== this.detailLoadToken) {
        return;
      }
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
        this.seriesRatingsBySeason = mergeSeasonRatings(
          addonRatingsBySeason(this.episodes),
          results[0] || {}
        );
        if (this.meta?.ids?.trakt && results[1] instanceof Map) {
          this.enrichedWatchedState = results[1];
          this.buildEpisodeState(allProgressItems, allWatchedItems, this.enrichedWatchedState);
          this.updateRenderedDetailSections(this.meta);
        }
      } else {
        this.collectionItems = Array.isArray(results[0]?.items) ? results[0].items : [];
        this.collectionName = results[0]?.name || "";
        if (this.meta?.ids?.trakt && results[1]) {
          this.enrichedMovieState = results[1];
          this.isMarkedWatched = Boolean(this.enrichedMovieState?.isWatched);
          this.updateRenderedDetailSections(this.meta);
        }
      }
      this.updateRenderedDetailSections(this.meta);
    })().catch((error) => {
      console.warn("Detail background enrichment failed", error);
    });
  },

  async resolveCanonicalDetailItemId(itemId, itemType = "movie") {
    const rawItemId = String(itemId || "").trim();
    if (!/^tmdb:/i.test(rawItemId)) {
      return rawItemId;
    }
    try {
      const tmdbId = await TmdbService.ensureTmdbId(rawItemId, itemType);
      if (!tmdbId) {
        return rawItemId;
      }
      const enrichment = await TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: itemType,
        language: TmdbSettingsStore.get().language
      });
      const imdbId = String(enrichment?.imdbId || "").trim();
      return imdbId || rawItemId;
    } catch (error) {
      console.warn("Detail TMDB canonical id resolve failed", error);
      return rawItemId;
    }
  },

  async fetchMoreLikeThis(meta) {
    try {
      const trackingSettings = TraktSettingsStore.get();
      if (
        TraktAuthService.isAuthenticated() &&
        trackingSettings.moreLikeThisSource !== MoreLikeThisSourcePreference.TMDB
      ) {
        this.moreLikeThisSource = "trakt";
        return await this.fetchTraktRelated(meta);
      }
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !settings.useMoreLikeThis) {
        this.moreLikeThisSource = null;
        return [];
      }
      this.moreLikeThisSource = "tmdb";
      // Android resolves the route type first, then the meta type, and treats
      // both `tv` and `series` as TMDB TV content even when episodes are absent.
      const routeType = String(this.params?.itemType || "").toLowerCase();
      const metaType = String(meta?.type || "").toLowerCase();
      const seriesTypes = ["series", "tv", "show", "tvshow"];
      const movieTypes = ["movie", "film"];
      const resolvedType = [...seriesTypes, ...movieTypes].includes(routeType)
        ? routeType
        : [...seriesTypes, ...movieTypes].includes(metaType)
          ? metaType
          : "movie";
      const type = seriesTypes.includes(resolvedType) ? "series" : "movie";
      const tmdbId =
        (await TmdbService.ensureTmdbId(meta?.id, type)) ||
        (await TmdbService.ensureTmdbId(this.params?.itemId, type)) ||
        (await this.searchTmdbIdByTitle(meta, type));
      if (!tmdbId) {
        return [];
      }
      const recommendations = await TmdbMetadataService.fetchRecommendations({
        tmdbId,
        contentType: type,
        language: settings.language
      });
      return (Array.isArray(recommendations) ? recommendations : [])
        .map((item) => normalizePreviewItem(item, type))
        .filter((item) => item.id && item.id !== String(meta?.id || ""))
        .slice(0, 12);
    } catch (error) {
      console.warn("More like this load failed", error);
      this.moreLikeThisSource = null;
      return [];
    }
  },

  async fetchTraktRelated(meta) {
    const routeType = String(this.params?.itemType || meta?.type || meta?.apiType || "")
      .trim()
      .toLowerCase();
    const type = ["series", "tv", "show", "tvshow"].includes(routeType) ? "series" : "movie";
    const apiType = type === "series" ? "show" : "movie";
    const token = await TraktAuthService.getValidAccessToken();
    if (!token) return [];

    const rawIds = [meta?.id, this.params?.itemId].map((value) => String(value || "").trim());
    const directImdb = resolveMetaImdbId(meta, this.params);
    const directTrakt = rawIds
      .map((value) => value.match(/^trakt:(.+)$/i)?.[1] || null)
      .find(Boolean);
    let pathId = directImdb || directTrakt || String(meta?.slug || "").trim();
    if (!pathId) {
      const tmdbId =
        meta?.tmdbId ||
        rawIds.map((value) => value.match(/^tmdb:(\d+)$/i)?.[1] || null).find(Boolean);
      if (tmdbId) {
        const search = await traktRequestJson(
          `/search/tmdb/${encodeURIComponent(String(tmdbId))}?type=${apiType}`,
          { authorization: `Bearer ${token}` }
        );
        if (search.response.ok) {
          const result = (Array.isArray(search.payload) ? search.payload : []).find(
            (entry) => String(entry?.type || "").toLowerCase() === apiType
          );
          const ids = (type === "series" ? result?.show : result?.movie)?.ids || {};
          pathId = ids.imdb || ids.trakt || ids.slug || "";
        }
      }
    }
    if (!pathId) return [];

    const target = type === "series" ? "shows" : "movies";
    const result = await traktRequestJson(
      `/${target}/${encodeURIComponent(String(pathId))}/related?extended=full%2Cimages&page=1&limit=20`,
      { authorization: `Bearer ${token}` }
    );
    if (result.response.status === 404) return [];
    if (!result.response.ok) {
      throw new Error(`Trakt related titles failed (${result.response.status})`);
    }
    return (Array.isArray(result.payload) ? result.payload : [])
      .map((item) => traktRelatedPreview(item, type))
      .filter((item) => item?.id && item.id !== String(meta?.id || ""))
      .slice(0, 20);
  },

  getAvailableSeasons(episodes = this.episodes) {
    const seasons = Array.from(
      new Set(
        (Array.isArray(episodes) ? episodes : [])
          .map((episode) => Number(episode?.season || 0))
          .filter((season) => Number.isFinite(season) && season >= 0)
      )
    );
    const regular = seasons.filter((season) => season > 0).sort((left, right) => left - right);
    const specials = seasons.filter((season) => season === 0);
    return [...regular, ...specials];
  },

  supportsTraktComments(meta = this.meta) {
    const type = String(meta?.type || meta?.apiType || this.params?.itemType || "")
      .trim()
      .toLowerCase();
    return (
      ["movie", "series", "tv", "show"].includes(type) || isSeriesDetailMeta(meta, this.episodes)
    );
  },

  resolveTraktCommentsTarget(meta = this.meta) {
    if (!this.supportsTraktComments(meta)) return null;
    const isEpisode = this.commentsMode === "episode" && this.commentsEpisodeTarget;
    const directId =
      resolveMetaImdbId(meta, this.params) ||
      String(meta?.slug || "").trim() ||
      String(meta?.id || this.params?.itemId || "")
        .split(":")
        .find((part) => /^tt\d+$/i.test(part)) ||
      String(this.params?.itemId || meta?.id || "").trim();
    if (!directId) return null;
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
    if (isEpisode && isSeries) {
      const season = Number(this.commentsEpisodeTarget?.season || 0);
      const episode = Number(this.commentsEpisodeTarget?.episode || 0);
      if (season > 0 && episode > 0) {
        return {
          path: `/shows/${encodeURIComponent(directId)}/seasons/${season}/episodes/${episode}/comments/likes`
        };
      }
    }
    return {
      path: `/${isSeries ? "shows" : "movies"}/${encodeURIComponent(directId)}/comments/likes`
    };
  },

  async fetchTraktCommentsPage(page = 1) {
    const target = this.resolveTraktCommentsTarget(this.meta);
    if (!target || !TRAKT_CLIENT_ID) {
      return { items: [], page: 0, pageCount: 0 };
    }
    const token = await TraktAuthService.getValidAccessToken().catch(() => null);
    if (!token) {
      return { items: [], page: 0, pageCount: 0 };
    }
    const url = new URL(
      `${String(TRAKT_API_URL || "https://api.trakt.tv").replace(/\/+$/, "")}${target.path}`
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(TRAKT_COMMENTS_LIMIT));
    const response = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": TRAKT_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    });
    if (response.status === 404) {
      return { items: [], page, pageCount: 0 };
    }
    if (!response.ok) {
      throw new Error(`Trakt comments failed (${response.status})`);
    }
    const payload = await response.json();
    const items = (Array.isArray(payload) ? payload : [])
      .filter((entry) => String(entry?.comment || "").trim())
      .map((entry) => ({
        id: Number(entry.id || 0),
        authorDisplayName: entry.user?.name || entry.user?.username || "Trakt user",
        authorUsername: entry.user?.username || "",
        comment: stripTraktSpoilerMarkup(entry.comment),
        spoiler: Boolean(entry.spoiler),
        containsInlineSpoilers: containsTraktInlineSpoiler(entry.comment),
        review: Boolean(entry.review),
        likes: Number(entry.likes || 0),
        rating: entry.user_stats?.rating ?? entry.userStats?.rating ?? null,
        createdAt: entry.created_at || entry.createdAt || ""
      }));
    return {
      items,
      page,
      pageCount: Number(response.headers.get("X-Pagination-Page-Count") || page || 0)
    };
  },

  async loadTraktComments({ force: _force = false, append = false } = {}) {
    if (
      !TraktSettingsStore.get().showMetaComments ||
      !TraktAuthService.isAuthenticated() ||
      !this.supportsTraktComments(this.meta)
    ) {
      this.commentsItems = [];
      this.commentsPage = 0;
      this.commentsPageCount = 0;
      this.commentsError = "";
      this.commentsLoading = false;
      this.commentsLoadingMore = false;
      return;
    }
    const page = append ? Number(this.commentsPage || 0) + 1 : 1;
    if (append && this.commentsPageCount > 0 && page > this.commentsPageCount) return;
    if (append) this.commentsLoadingMore = true;
    else this.commentsLoading = true;
    this.commentsError = "";
    this.updateRenderedDetailSections(this.meta);
    try {
      const result = await this.fetchTraktCommentsPage(page);
      const existingIds = new Set(
        (append ? this.commentsItems : []).map((item) => Number(item.id || 0))
      );
      const nextItems = result.items.filter((item) => !existingIds.has(Number(item.id || 0)));
      this.commentsItems = append ? [...this.commentsItems, ...nextItems] : nextItems;
      this.commentsPage = result.page;
      this.commentsPageCount = result.pageCount;
      this.commentsError = "";
    } catch (error) {
      console.warn("Trakt comments load failed", error);
      this.commentsError = t("detail_comments_error", {}, "Could not load Trakt comments.");
    } finally {
      this.commentsLoading = false;
      this.commentsLoadingMore = false;
      this.updateRenderedDetailSections(this.meta);
    }
  },

  hasAvailableSeason(season, episodes = this.episodes) {
    const wanted = Number(season || 0);
    return wanted >= 0 && this.getAvailableSeasons(episodes).includes(wanted);
  },

  findEpisodeFromProgress(progress = {}) {
    if (!this.episodes?.length || !progress) {
      return null;
    }
    const videoId = String(progress?.videoId || "").trim();
    if (videoId) {
      const directMatch = this.episodes.find((episode) => String(episode?.id || "") === videoId);
      if (directMatch) {
        return directMatch;
      }
    }
    const season = Number(progress?.season);
    const episode = Number(progress?.episode || 0);
    if (Number.isFinite(season) && season >= 0 && episode > 0) {
      return (
        this.episodes.find(
          (entry) =>
            Number(entry?.season || 0) === season && Number(entry?.episode || 0) === episode
        ) || null
      );
    }
    return null;
  },

  getNextEpisodeAfter(episode = null) {
    if (!episode || !this.episodes?.length) {
      return null;
    }
    const sequence = this.getEpisodeSequence(episode);
    const currentIndex = sequence.findIndex(
      (entry) =>
        String(entry?.id || "") === String(episode?.id || "") ||
        (Number(entry?.season || 0) === Number(episode?.season || 0) &&
          Number(entry?.episode || 0) === Number(episode?.episode || 0))
    );
    return currentIndex >= 0 ? sequence[currentIndex + 1] || null : null;
  },

  getEpisodeSequence(anchorEpisode = null) {
    const episodes = Array.isArray(this.episodes) ? this.episodes : [];
    const anchorSeason = Number(anchorEpisode?.season);
    const specials = episodes.filter((episode) => Number(episode?.season) === 0);
    const regular = episodes.filter((episode) => Number(episode?.season) > 0);
    if (Number.isFinite(anchorSeason) && anchorSeason === 0) {
      return specials;
    }
    return regular.length ? regular : specials;
  },

  getLatestSeriesProgress(progress = null, progressItems = []) {
    const contentId = String(this.params?.itemId || "").trim();
    const candidates = [];
    if (progress && String(progress?.contentId || contentId) === contentId) {
      candidates.push(progress);
    }
    (Array.isArray(progressItems) ? progressItems : []).forEach((entry) => {
      if (String(entry?.contentId || "").trim() !== contentId) {
        return;
      }
      if (
        (entry?.season == null || Number(entry.season) < 0) &&
        !String(entry?.videoId || "").trim()
      ) {
        return;
      }
      candidates.push(entry);
    });
    return (
      candidates.sort(
        (left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
      )[0] || null
    );
  },

  resolvePreferredSeasonFromProgress(progress = null, progressItems = []) {
    const routeSeasonRaw =
      this.params?.preferredSeason ?? this.params?.resumeSeason ?? this.params?.initialSeason;
    const routeSeason = Number(routeSeasonRaw);
    if (routeSeasonRaw != null && Number.isFinite(routeSeason) && routeSeason >= 0) {
      return routeSeason;
    }

    const latestProgress = this.getLatestSeriesProgress(progress, progressItems);
    const progressEpisode = this.findEpisodeFromProgress(latestProgress);
    if (progressEpisode) {
      if (detailProgressFraction(latestProgress) >= DETAIL_PROGRESS_END_THRESHOLD) {
        return Number(
          this.getNextEpisodeAfter(progressEpisode)?.season || progressEpisode.season || 0
        );
      }
      return Number(progressEpisode.season || 0);
    }

    const progressSeason = Number(latestProgress?.season);
    return latestProgress?.season != null && Number.isFinite(progressSeason) && progressSeason >= 0
      ? progressSeason
      : null;
  },

  resolveInitialSelectedSeason(progress = null, progressItems = []) {
    const seasons = this.getAvailableSeasons();
    const currentSeason = Number(this.selectedSeason || 0);
    if (this.hasManualSeasonSelection && currentSeason >= 0 && seasons.includes(currentSeason)) {
      return currentSeason;
    }
    const preferredSeason = this.resolvePreferredSeasonFromProgress(progress, progressItems);
    if (preferredSeason != null && (!seasons.length || seasons.includes(preferredSeason))) {
      return preferredSeason;
    }

    if (currentSeason > 0 && seasons.includes(currentSeason)) {
      return currentSeason;
    }

    return seasons[0] ?? 1;
  },

  computeNextEpisodeToWatch(progress) {
    if (!this.episodes?.length) {
      return null;
    }
    const currentEpisode = this.findEpisodeFromProgress(progress);
    const episodes = this.getEpisodeSequence(currentEpisode);
    if (!episodes.length) {
      return null;
    }
    if (currentEpisode && detailProgressFraction(progress) < DETAIL_PROGRESS_END_THRESHOLD) {
      return currentEpisode;
    }
    const completedKeys =
      this.watchedEpisodeKeys instanceof Set ? new Set(this.watchedEpisodeKeys) : new Set();
    if (currentEpisode && detailProgressFraction(progress) >= DETAIL_PROGRESS_END_THRESHOLD) {
      completedKeys.add(
        `${Number(currentEpisode.season || 0)}:${Number(currentEpisode.episode || 0)}`
      );
    }
    const isEpisodeCompleted = (episode) => {
      const key = `${Number(episode?.season || 0)}:${Number(episode?.episode || 0)}`;
      if (!key || key === "0:0") {
        return false;
      }
      if (
        currentEpisode &&
        detailProgressFraction(progress) >= DETAIL_PROGRESS_END_THRESHOLD &&
        Number(episode?.season || 0) === Number(currentEpisode.season || 0) &&
        Number(episode?.episode || 0) === Number(currentEpisode.episode || 0)
      ) {
        return true;
      }
      if (this.enrichedWatchedState?.has(key)) {
        return Boolean(this.enrichedWatchedState.get(key)?.isWatched);
      }
      return completedKeys.has(key);
    };
    let latestCompletedIndex = -1;
    episodes.forEach((episode, index) => {
      if (isEpisodeCompleted(episode)) {
        latestCompletedIndex = Math.max(latestCompletedIndex, index);
      }
    });
    if (latestCompletedIndex >= 0) {
      const nextUnwatched = episodes
        .slice(latestCompletedIndex + 1)
        .find((episode) => !isEpisodeCompleted(episode));
      if (nextUnwatched) {
        return nextUnwatched;
      }
      return episodes.find((episode) => !isEpisodeCompleted(episode)) || episodes[0];
    }
    if (!currentEpisode) {
      return episodes[0];
    }
    const currentIndex = episodes.findIndex(
      (episode) =>
        String(episode?.id || "") === String(currentEpisode?.id || "") ||
        (Number(episode?.season || 0) === Number(currentEpisode?.season || 0) &&
          Number(episode?.episode || 0) === Number(currentEpisode?.episode || 0))
    );
    return episodes[currentIndex + 1] || episodes[currentIndex] || episodes[0];
  },

  buildEpisodeState(progressItems = [], watchedItems = [], remoteWatchedMap = null) {
    const progressMap = new Map();
    const watchedKeys = new Set();
    const contentId = String(this.params?.itemId || "");
    this.enrichedWatchedState = remoteWatchedMap instanceof Map ? remoteWatchedMap : null;

    (Array.isArray(progressItems) ? progressItems : []).forEach((entry) => {
      if (String(entry?.contentId || "") !== contentId) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (!Number.isFinite(season) || season < 0 || !Number.isFinite(episode) || episode <= 0) {
        return;
      }
      const key = `${season}:${episode}`;
      progressMap.set(key, entry);
      if (detailProgressFraction(entry) >= DETAIL_PROGRESS_END_THRESHOLD) {
        watchedKeys.add(key);
      }
    });

    (Array.isArray(watchedItems) ? watchedItems : []).forEach((entry) => {
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (
        String(entry?.contentId || "") === contentId &&
        Number.isFinite(season) &&
        season >= 0 &&
        Number.isFinite(episode) &&
        episode > 0
      ) {
        watchedKeys.add(`${season}:${episode}`);
      }
    });

    const animeWatchedKeys = new Set(
      (Array.isArray(watchedItems) ? watchedItems : [])
        .filter((entry) => entry?.episode != null)
        .map(
          (entry) => `${String(entry.contentId || "").toLowerCase()}:${Number(entry.episode || 0)}`
        )
    );
    (this.episodes || []).forEach((video) => {
      const match = String(video?.id || "").match(/^(mal|anidb|anilist|kitsu):(\d+):(\d+)/i);
      if (
        !match ||
        !animeWatchedKeys.has(`${match[1].toLowerCase()}:${match[2]}:${Number(match[3])}`)
      ) {
        return;
      }
      const season = Number(video?.season || 0);
      const episode = Number(video?.episode || 0);
      if (season >= 0 && episode > 0) watchedKeys.add(`${season}:${episode}`);
    });

    this.episodeProgressMap = progressMap;
    this.watchedEpisodeKeys = watchedKeys;
  },

  async fetchMovieCollection(meta = {}) {
    try {
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !settings.useCollections) {
        return { name: "", items: [] };
      }
      const collectionId =
        meta?.collectionId || meta?.belongsToCollection?.id || meta?.belongs_to_collection?.id;
      if (!collectionId) {
        return { name: "", items: [] };
      }
      const items = await TmdbMetadataService.fetchMovieCollection({
        collectionId,
        language: settings.language
      });
      const normalized = (Array.isArray(items) ? items : [])
        .map((item) => normalizePreviewItem(item, "movie"))
        .filter((item) => item.id && item.id !== String(meta.id || ""))
        .slice(0, 18);
      return {
        name:
          meta?.collectionName ||
          meta?.belongsToCollection?.name ||
          meta?.belongs_to_collection?.name ||
          "",
        items: normalized
      };
    } catch (error) {
      console.warn("Movie collection enrichment failed", error);
      return { name: "", items: [] };
    }
  },

  findContinueWatchingEpisodeTarget() {
    const resumeVideoId = String(this.params?.resumeVideoId || "").trim();
    if (resumeVideoId) {
      const directMatch = this.episodes.find((entry) => String(entry?.id || "") === resumeVideoId);
      if (directMatch) {
        return directMatch;
      }
    }
    const resumeSeasonRaw = this.params?.resumeSeason;
    const resumeSeason = Number(resumeSeasonRaw);
    const resumeEpisode = Number(this.params?.resumeEpisode || 0);
    if (
      resumeSeasonRaw != null &&
      Number.isFinite(resumeSeason) &&
      resumeSeason >= 0 &&
      resumeEpisode > 0
    ) {
      const episodeMatch = this.episodes.find(
        (entry) =>
          Number(entry?.season || 0) === resumeSeason &&
          Number(entry?.episode || 0) === resumeEpisode
      );
      if (episodeMatch) {
        return episodeMatch;
      }
    }
    return this.nextEpisodeToWatch || this.episodes[0] || null;
  },

  maybeAutoOpenContinueWatchingStream() {
    if (
      !this.params?.autoOpenContinueWatching ||
      this.autoOpenedContinueWatchingStream ||
      this.isBackNavigation
    ) {
      return;
    }
    this.autoOpenedContinueWatchingStream = true;
    const routeStartFromBeginning = Boolean(this.params?.startFromBeginning);
    const extraParams = {
      resumePositionMs: routeStartFromBeginning
        ? 0
        : Number(this.params?.resumeProgressMs || 0) || 0,
      resumeProgressPercent: routeStartFromBeginning
        ? null
        : (this.params?.resumeProgressPercent ?? this.resumeProgress?.progressPercent ?? null),
      resumeDurationMs: routeStartFromBeginning
        ? 0
        : Number(this.params?.resumeDurationMs || this.resumeProgress?.durationMs || 0) || 0,
      startFromBeginning: routeStartFromBeginning,
      manualSelection: Boolean(this.params?.manualSelection),
      returnToDetail: true,
      continueWatchingBackHome: true,
      resumeStreamIdentity: this.params?.resumeStreamIdentity || null
    };
    if (isSeriesDetailMeta(this.meta, this.episodes)) {
      const episode = this.findContinueWatchingEpisodeTarget();
      if (episode) {
        this.navigateToStreamScreenForEpisode(episode, extraParams);
        return;
      }
    }
    this.navigateToStreamScreenForMovie(extraParams);
  },

  getStreamNavigationOptions() {
    // Continue Watching mounts Detail only to resolve the Stream target. Replace
    // that transient browser-history entry too, otherwise it can resurface after
    // the user returns Home and opens a different title.
    return this.params?.autoOpenContinueWatching
      ? { skipStackPush: true, replaceHistory: true }
      : {};
  },

  navigateBackFromDetail() {
    if (this.params?.returnToSearchOnBack) {
      Router.navigate(
        "search",
        {},
        {
          isBackNavigation: true,
          skipStackPush: true,
          replaceHistory: true
        }
      );
      return true;
    }
    if (this.params?.returnHomeOnBack) {
      Router.navigate(
        "home",
        {},
        {
          isBackNavigation: true,
          skipStackPush: true,
          replaceHistory: true
        }
      );
      return true;
    }
    return false;
  },

  async enrichMeta(meta) {
    const settings = TmdbSettingsStore.get();
    if (!settings.enabled || !TMDB_API_KEY || !meta?.id) {
      return meta;
    }

    try {
      const tmdbId = await TmdbService.ensureTmdbId(meta.id, meta.type);
      if (!tmdbId) {
        return meta;
      }
      const enrichment = await TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: meta.type,
        language: settings.language
      });
      if (!enrichment) {
        return meta;
      }
      const isSeries = isSeriesDetailMeta(meta, meta?.videos || this.episodes);
      const episodeMap =
        settings.useEpisodes && isSeries
          ? await TmdbMetadataService.fetchEpisodeEnrichment({
              tmdbId,
              seasonNumbers: (Array.isArray(meta.videos) ? meta.videos : [])
                .map((video) => Number(video?.season || 0))
                .filter((season) => season > 0),
              language: settings.language
            })
          : new Map();
      const videos =
        episodeMap.size && Array.isArray(meta.videos)
          ? meta.videos.map((video) => {
              const key =
                Number(video?.season || 0) > 0 && Number(video?.episode || 0) > 0
                  ? `${Number(video.season)}:${Number(video.episode)}`
                  : "";
              const episode = key ? episodeMap.get(key) : null;
              if (!episode) {
                return video;
              }
              return {
                ...video,
                title: episode.title || video.title,
                overview: episode.overview || video.overview,
                released: settings.useReleaseDates
                  ? episode.airDate || video.released
                  : video.released,
                thumbnail: episode.thumbnail || video.thumbnail,
                runtime: episode.runtime || video.runtime
              };
            })
          : meta.videos;

      return {
        ...meta,
        name: settings.useBasicInfo ? enrichment.localizedTitle || meta.name : meta.name,
        description: settings.useBasicInfo
          ? enrichment.description || meta.description
          : meta.description,
        background: settings.useArtwork ? enrichment.backdrop || meta.background : meta.background,
        poster: settings.useArtwork ? enrichment.poster || meta.poster : meta.poster,
        // TMDB enrichment deliberately returns no logo when only unrelated
        // languages are available; show the localized text title in that case.
        logo: settings.useArtwork ? enrichment.logo : meta.logo,
        genres: settings.useBasicInfo
          ? mergeGenreLists(meta.genres, enrichment.genres)
          : meta.genres,
        releaseInfo: settings.useReleaseDates
          ? meta.releaseInfo || enrichment.releaseInfo
          : meta.releaseInfo,
        released: settings.useReleaseDates
          ? meta.released || meta.releaseDate || meta.release_date || enrichment.released || null
          : meta.released || meta.releaseDate || meta.release_date || null,
        runtime: settings.useDetails ? enrichment.runtime || meta.runtime : meta.runtime,
        country: settings.useDetails ? enrichment.country || meta.country : meta.country,
        language: settings.useDetails ? enrichment.language || meta.language : meta.language,
        originalLanguage:
          enrichment.originalLanguage || meta.originalLanguage || meta.original_language || null,
        imdbId: enrichment.imdbId || meta.imdbId || meta.imdb_id || null,
        tmdbRating:
          settings.useBasicInfo && typeof enrichment.rating === "number"
            ? Number(enrichment.rating.toFixed(1))
            : meta.tmdbRating || null,
        credits: settings.useCredits
          ? enrichment.credits || meta.credits || null
          : meta.credits || null,
        companies:
          settings.useProductions && Array.isArray(enrichment.companies)
            ? enrichment.companies
            : meta.companies || [],
        productionCompanies:
          settings.useProductions && Array.isArray(enrichment.productionCompanies)
            ? enrichment.productionCompanies
            : Array.isArray(meta.productionCompanies)
              ? meta.productionCompanies
              : [],
        networks:
          settings.useNetworks && Array.isArray(enrichment.networks)
            ? enrichment.networks
            : Array.isArray(meta.networks)
              ? meta.networks
              : [],
        trailers:
          Array.isArray(meta.trailers) && meta.trailers.length
            ? meta.trailers
            : settings.useTrailers && Array.isArray(enrichment.trailers)
              ? enrichment.trailers
              : [],
        trailerYtIds:
          Array.isArray(meta.trailerYtIds) && meta.trailerYtIds.length
            ? meta.trailerYtIds
            : settings.useTrailers && Array.isArray(enrichment.trailerYtIds)
              ? enrichment.trailerYtIds
              : [],
        collectionId:
          (settings.useCollections ? enrichment.collectionId : null) ||
          meta.collectionId ||
          meta?.belongsToCollection?.id ||
          meta?.belongs_to_collection?.id ||
          null,
        collectionName:
          (settings.useCollections ? enrichment.collectionName : null) ||
          meta.collectionName ||
          meta?.belongsToCollection?.name ||
          meta?.belongs_to_collection?.name ||
          "",
        belongsToCollection:
          settings.useCollections && enrichment.collectionId
            ? { id: enrichment.collectionId, name: enrichment.collectionName || "" }
            : meta.belongsToCollection || meta.belongs_to_collection || null,
        videos
      };
    } catch (error) {
      console.warn("Meta TMDB enrichment failed", error);
      return meta;
    }
  },

  async searchTmdbIdByTitle(meta = {}, contentType = "movie") {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey) {
      return null;
    }
    const name = String(meta?.name || "").trim();
    if (!name) {
      return null;
    }
    const type = contentType === "series" || contentType === "tv" ? "tv" : "movie";
    const releaseYear = String(meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const yearParam = releaseYear
      ? type === "tv"
        ? `&first_air_date_year=${encodeURIComponent(releaseYear)}`
        : `&year=${encodeURIComponent(releaseYear)}`
      : "";
    const url = `${TMDB_BASE_URL}/search/${type}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.language || "en")}&query=${encodeURIComponent(name)}${yearParam}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    return first?.id ? String(first.id) : null;
  },

  async fetchTmdbCastFallback(meta = {}) {
    const settings = TmdbSettingsStore.get();
    if (!settings.enabled || !settings.useCredits) {
      return [];
    }
    const contentType = String(meta?.type || this.params?.itemType || "movie").toLowerCase();
    const normalizedType = contentType === "tv" ? "series" : contentType;
    let tmdbId = await TmdbService.ensureTmdbId(meta?.id, normalizedType);
    if (!tmdbId) {
      tmdbId = await this.searchTmdbIdByTitle(meta, normalizedType);
    }
    if (!tmdbId) {
      return [];
    }
    const enrichment = await TmdbMetadataService.fetchEnrichment({
      tmdbId,
      contentType: normalizedType,
      language: settings.language
    });
    const fallbackCast = extractCast({ credits: enrichment?.credits || null });
    return Array.isArray(fallbackCast) ? fallbackCast : [];
  },

  async fetchSeriesRatingsBySeason(meta) {
    try {
      if (!meta?.id || !this.episodes?.length) {
        return {};
      }
      const imdbId = resolveMetaImdbId(meta, this.params);
      const knownTmdbId = resolveMetaTmdbId(meta, this.params);
      const tmdbId =
        knownTmdbId ||
        (await TmdbService.ensureTmdbId(meta.id, "series", {
          // Episode IMDb ratings are independent from optional TMDB metadata
          // enrichment, matching Android TV's detail-screen behavior.
          requireEnabled: false
        }));
      if (!imdbId && !tmdbId) {
        return {};
      }
      return await imdbEpisodeRatingsRepository.getEpisodeRatings({ imdbId, tmdbId });
    } catch (error) {
      console.warn("Series ratings enrichment failed", error);
      return {};
    }
  },

  async resolvePreferredTrailerSource(meta = this.meta) {
    if (!meta) {
      return null;
    }
    return resolveTrailerSource(meta);
  },

  async refreshTrailerSource(meta = this.meta, token = this.detailLoadToken) {
    const nextSource = await this.resolvePreferredTrailerSource(meta);
    if (token !== this.detailLoadToken) {
      return;
    }
    const currentKey = JSON.stringify(this.trailerSource || null);
    const nextKey = JSON.stringify(nextSource || null);
    if (currentKey === nextKey) {
      return;
    }
    this.trailerSource = nextSource;
    if (!this.isTrailerPlaying) {
      this.updateRenderedDetailSections(this.meta || meta);
    }
  },

  flattenStreams(streamResult) {
    if (!streamResult || streamResult.status !== "success") {
      return [];
    }

    const flattened = [];
    (streamResult.data || []).forEach((group) => {
      const groupName = group.addonName || "Addon";
      (group.streams || []).forEach((stream, index) => {
        const streamOrigin = {
          ...(group.streamOrigin || {}),
          ...(stream.streamOrigin || {}),
          addonId:
            stream.addonId ||
            group.addonId ||
            group.streamOrigin?.addonId ||
            stream.streamOrigin?.addonId ||
            null,
          addonBaseUrl:
            stream.addonBaseUrl ||
            group.addonBaseUrl ||
            group.streamOrigin?.addonBaseUrl ||
            stream.streamOrigin?.addonBaseUrl ||
            null,
          addonName:
            stream.addonName ||
            group.addonName ||
            group.streamOrigin?.addonName ||
            stream.streamOrigin?.addonName ||
            groupName,
          sourceProviderId:
            stream.sourceProviderId ||
            group.sourceProviderId ||
            stream.streamOrigin?.sourceProviderId ||
            group.streamOrigin?.sourceProviderId ||
            null
        };
        const entry = {
          id: `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,
          label: stream.title || stream.name || `${groupName} stream`,
          description: stream.description || stream.name || "",
          addonId: stream.addonId || group.addonId || null,
          addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
          addonName: groupName,
          addonLogo: group.addonLogo || stream.addonLogo || null,
          addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
            ? Number(stream.addonOrderIndex)
            : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
          sourceProviderId: stream.sourceProviderId || group.sourceProviderId || null,
          streamOrigin,
          sourceType: stream.type || stream.source || "",
          url: stream.url || stream.externalUrl || "",
          ytId: stream.ytId || null,
          infoHash: stream.infoHash || null,
          fileIdx: stream.fileIdx ?? null,
          externalUrl: stream.externalUrl || null,
          behaviorHints: stream.behaviorHints || null,
          subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
          raw: stream
        };
        if (entry.url) {
          flattened.push(entry);
        }
      });
    });
    return flattened;
  },

  mergeStreamItems(existing = [], incoming = []) {
    const byKey = new Set();
    const merged = [];
    const push = (item) => {
      if (!item?.url) {
        return;
      }
      const key = [
        String(item.addonName || "Addon"),
        String(item.url || ""),
        String(item.sourceType || ""),
        String(item.label || "")
      ].join("::");
      if (byKey.has(key)) {
        return;
      }
      byKey.add(key);
      merged.push(item);
    };
    (existing || []).forEach(push);
    (incoming || []).forEach(push);
    return merged;
  },

  render(meta, focusRestore = undefined) {
    if (this._sectionsUpdateRaf) {
      const cancelRaf =
        typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
      cancelRaf(this._sectionsUpdateRaf);
      this._sectionsUpdateRaf = null;
      this._pendingSectionsMeta = null;
      this._pendingSectionsFocusRestore = null;
    }
    if (focusRestore !== undefined) {
      this.pendingFocusRestore = focusRestore;
    } else if (!this.pendingFocusRestore) {
      this.pendingFocusRestore = this.captureDetailFocus();
    }
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
    if (isSeries) {
      this.renderSeriesLayout(meta);
      if (this.pendingEpisodeSelection) {
        this.renderEpisodeStreamChooser();
      }
      return;
    }
    this.renderMovieLayout(meta);
    if (this.pendingMovieSelection) {
      this.renderMovieStreamChooser();
    }
  },

  renderSeriesHeroMarkup(meta) {
    const nextEpisodeLabel = this.getSeriesHeroPlayLabel();
    const creditLine =
      Array.isArray(meta.director) && meta.director.length
        ? meta.director.slice(0, 2).join(", ")
        : Array.isArray(meta.writer) && meta.writer.length
          ? meta.writer.slice(0, 2).join(", ")
          : meta.director || meta.writer || "";
    const creditPrefix =
      Array.isArray(meta.director) && meta.director.length
        ? t("detail.creator", {}, "Creator")
        : t("detail.writer", {}, "Writer");
    return this.renderHeroSection({
      meta,
      playLabel: nextEpisodeLabel,
      creditLine,
      creditPrefix,
      showWatchedButton: false
    });
  },

  getSeriesHeroPlayLabel() {
    const progress = this.getActiveResumeProgress();
    if (progress) {
      const season = Number(progress.season || this.nextEpisodeToWatch?.season || 0);
      const episode = Number(progress.episode || this.nextEpisodeToWatch?.episode || 0);
      return season >= 0 && episode > 0
        ? t("detail.resumeEpisodeShort", { season, episode }, "Resume S{{season}}E{{episode}}")
        : t("detail.resume", {}, "Resume");
    }
    return this.nextEpisodeToWatch
      ? t(
          "detail.nextEpisodeShort",
          { season: this.nextEpisodeToWatch.season, episode: this.nextEpisodeToWatch.episode },
          "Next S{{season}}E{{episode}}"
        )
      : t("detail.play", {}, "Play");
  },

  getMovieHeroPlayLabel() {
    return this.getActiveResumeProgress()
      ? t("detail.resume", {}, "Resume")
      : t("detail.play", {}, "Play");
  },

  renderMovieHeroMarkup(meta) {
    const directorLine = Array.isArray(meta.director)
      ? meta.director.slice(0, 2).join(", ")
      : meta.director || "";
    const playableType = resolvePlayableDetailType(this.params?.itemType || meta?.type, meta);
    return this.renderHeroSection({
      meta,
      playLabel: this.getMovieHeroPlayLabel(),
      creditLine: directorLine,
      creditPrefix: t("detail.director", {}, "Director"),
      showWatchedButton: playableType !== "tv"
    });
  },

  getTrailerShellStateClasses() {
    if (!this.isTrailerPlaying) {
      return "";
    }
    const mode = this.trailerPlaybackMode === "autoplay" ? "autoplay" : "manual";
    return ` detail-trailer-active detail-trailer-${mode}${this.trailerVisualReady ? " detail-trailer-ready" : ""}`;
  },

  renderSeriesLayout(meta) {
    const backdrop = meta.background || meta.poster || "";
    const heroMarkup = this.renderSeriesHeroMarkup(meta);
    if (!this.selectedRatingSeason || !this.seriesRatingsBySeason?.[this.selectedRatingSeason]) {
      this.selectedRatingSeason = this.selectedSeason || this.episodes?.[0]?.season || 1;
    }

    this.container.innerHTML = `
      <div class="series-detail-shell${this.getTrailerShellStateClasses()}">
        <div class="series-detail-backdrop" data-backdrop-url="${escapeAttribute(backdrop || "")}"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
        <div class="detail-trailer-layer"></div>
        <div class="detail-trailer-loading-spinner" aria-hidden="true">${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}</div>
        <div class="series-detail-vignette"></div>
        <div class="detail-bottom-shadow"></div>

        <div class="series-detail-content">
          <div id="detailHeroSection">${heroMarkup}</div>
          <div id="detailSeasonRowMount">
            <div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>
          </div>
          <div id="detailEpisodeTrackMount">
            <div class="series-episode-track" data-scroll-key="episodes:${this.selectedSeason ?? 1}">${this.renderEpisodeCards()}</div>
          </div>
          <div id="detailInsightSectionMount">${this.renderSeriesInsightSection()}</div>
          <div id="detailCommentsSectionMount">${this.renderStandaloneCommentsSection()}</div>
          <div id="detailCompanySectionsMount">${this.renderCompanySections(meta)}</div>
        </div>

        <div id="episodeStreamChooserMount"></div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    if (!this.pendingFocusRestore) {
      ScreenUtils.setInitialFocus(this.container);
    }
    this._detailHeroMarkup = heroMarkup;
    this.bindDetailChrome();
    this.scheduleEpisodeVirtualizationSync(this.getRememberedEpisodeIndex());
  },

  async loadMdbListRatings(meta, token = this.detailLoadToken) {
    const lookupMeta = metaWithRouteExternalIds(meta, this.params);
    const ratingsResult = await mdbListRepository
      .getRatingsForMeta(lookupMeta, this.params?.itemId || "", this.params?.itemType || "movie")
      .catch(() => null);
    if (token !== this.detailLoadToken) {
      return;
    }
    this.meta = {
      ...(this.meta || meta || {}),
      mdbListRatings: ratingsResult?.ratings || null,
      showMdbListImdb: ratingsResult?.hasImdbRating === true
    };
    this.updateRenderedDetailSections(this.meta);
  },
  renderHeroSection({
    meta,
    playLabel,
    creditLine = "",
    creditPrefix = "",
    showWatchedButton = false
  }) {
    const logoOrTitle = meta.logo
      ? `<img src="${meta.logo}" class="series-detail-logo" alt="${escapeHtml(meta.name || "logo")}" decoding="async" fetchpriority="high" />`
      : `<h1 class="series-detail-title">${escapeHtml(meta.name || "Untitled")}</h1>`;
    const externalRatings = this.renderExternalRatingsRow(meta);
    const trailerSource = this.trailerSource || resolveTrailerSource(meta);
    const hasTrailerCandidate = Boolean(trailerSource);
    if (!this.trailerSource && trailerSource) {
      this.trailerSource = trailerSource;
    }
    const trailerButtonEnabled = Boolean(LayoutPreferences.get().detailPageTrailerButtonEnabled);
    const trailerButton =
      trailerButtonEnabled && hasTrailerCandidate
        ? `
          <button class="series-circle-btn focusable" data-action="toggleTrailer" aria-label="${escapeAttribute(t("detail.playTrailer", {}, "Play trailer"))}">
            ${renderTrailerGlyph()}
          </button>
        `
        : "";
    return `
      <section class="detail-hero-section">
        <div class="detail-hero-brand">
          ${logoOrTitle}
          <p class="detail-trailer-hint">${escapeHtml(t("detail.pressBackToReturn", {}, "Press back to return to details"))}</p>
        </div>
        <div class="detail-hero-body">
          <div class="series-detail-actions">
            <button class="series-primary-btn focusable" data-action="playDefault">
              <span class="series-btn-icon">${renderPlayGlyph()}</span>
              <span>${escapeHtml(playLabel)}</span>
            </button>
            ${this.getActiveResumeProgress() ? `<button class="series-secondary-btn focusable" data-action="playFromBeginning">${escapeHtml(t("detail.playFromBeginning", {}, "Play from Beginning"))}</button>` : ""}
            <button class="series-circle-btn focusable${this.isSavedInLibrary ? " is-library-selected" : ""}" data-action="toggleLibrary">
              ${renderLibraryGlyph(this.isSavedInLibrary)}
            </button>
            ${showWatchedButton ? `<button class="series-circle-btn focusable${this.isMarkedWatched ? " is-selected" : ""}" data-action="toggleWatched" aria-label="${escapeAttribute(this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched"))}">${renderWatchedGlyph(this.isMarkedWatched)}</button>` : ""}
            ${trailerButton}
          </div>
          ${this.renderResumeIndicator()}
          ${creditLine ? `<p class="series-detail-support">${escapeHtml(creditPrefix)}: ${escapeHtml(creditLine)}</p>` : ""}
          ${externalRatings}
          <p class="series-detail-description">${escapeHtml(meta.description || t("detail.noDescription", {}, "No description."))}</p>
          ${this.renderHeroMetaRows(meta)}
        </div>
      </section>
    `;
  },

  getActiveResumeProgress() {
    const progress = this.resumeProgress || null;
    return progress && isWatchProgressInProgress(progress) ? progress : null;
  },

  renderResumeIndicator() {
    const progress = this.getActiveResumeProgress();
    if (!progress) {
      return "";
    }
    const percent = Math.max(1, Math.min(99, Math.round(detailProgressFraction(progress) * 100)));
    const episodeParts = [];
    const season = Number(progress.season || 0);
    const episode = Number(progress.episode || 0);
    if (season >= 0 && episode > 0) {
      episodeParts.push(`S${season}E${episode}`);
    }
    const title = String(progress.episodeTitle || "").trim();
    if (title) {
      episodeParts.push(title);
    }
    const episodeText = episodeParts.join(" - ");
    const remaining = formatResumeRemaining(progress);
    const parts = [
      t("detail.resumeAvailable", {}, "Resume available"),
      `${percent}%`,
      episodeText
        ? t("detail.currentEpisode", { episode: episodeText }, "Episode {{episode}}")
        : "",
      remaining
    ].filter(Boolean);
    return `<div class="detail-resume-indicator">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>`;
  },

  renderHeroMetaRows(meta) {
    const hasExternalRatings = hasMdbListRatings(meta?.mdbListRatings);
    const genresText = normalizeGenreList(meta).join(" • ");
    const yearText = formatMovieReleaseDate(meta);
    const imdbValue = resolveImdbRating(meta);
    const imdbText =
      imdbValue != null && String(imdbValue).trim() !== ""
        ? String(imdbValue).replace(",", ".")
        : "";
    const runtimeText =
      String(meta?.runtime || "").trim() ||
      formatRuntimeMinutes(
        meta?.runtimeMinutes || resolveEpisodeRuntimeForSeason(this.episodes, this.selectedSeason)
      );
    const countryText = normalizeCountryLabel(
      Array.isArray(meta?.country) ? meta.country.join(", ") : meta?.country || ""
    );
    const languageText = String(meta?.language || "")
      .trim()
      .toUpperCase();
    const ageRating = String(meta?.ageRating || "").trim();
    const status = String(meta?.status || "")
      .trim()
      .toUpperCase();
    const primaryParts = [
      genresText ? `<span>${escapeHtml(genresText)}</span>` : "",
      yearText ? `<span>${escapeHtml(yearText)}</span>` : "",
      imdbText &&
      showStandardDetailRatings(
        LayoutPreferences.get().homeImdbRatingsVisibility,
        hasExternalRatings
      )
        ? renderImdbBadge(imdbText)
        : ""
    ].filter(Boolean);
    const secondaryParts = [];
    if (ageRating && status) {
      secondaryParts.push(`
        <span class="detail-meta-badge combined">
          <span>${escapeHtml(ageRating)}</span>
          <span class="detail-meta-badge-divider"></span>
          <span class="strong">${escapeHtml(status)}</span>
        </span>
      `);
    } else {
      if (ageRating) {
        secondaryParts.push(`<span class="detail-meta-badge">${escapeHtml(ageRating)}</span>`);
      }
      if (status) {
        secondaryParts.push(`<span class="detail-meta-badge strong">${escapeHtml(status)}</span>`);
      }
    }
    [runtimeText, countryText, languageText].filter(Boolean).forEach((value) => {
      secondaryParts.push(`<span>${escapeHtml(value)}</span>`);
    });

    return `
      <div class="detail-meta-stack">
        ${primaryParts.length ? `<div class="detail-meta-row">${primaryParts.join('<span class="detail-meta-dot"></span>')}</div>` : ""}
        ${secondaryParts.length ? `<div class="detail-meta-row secondary">${secondaryParts.join('<span class="detail-meta-dot"></span>')}</div>` : ""}
      </div>
    `;
  },

  renderExternalRatingsRow(meta = {}) {
    const ratings = meta?.mdbListRatings || {};
    const items = [
      ["trakt", getAddonIconPath("trakt"), ratings.trakt],
      ["imdb", "assets/icons/imdb_logo_2016.svg", ratings.imdb],
      ["tmdb", "assets/icons/mdblist_tmdb.svg", ratings.tmdb],
      ["letterboxd", "assets/icons/mdblist_letterboxd.svg", ratings.letterboxd],
      ["tomatoes", "assets/icons/mdblist_tomatoes.svg", ratings.tomatoes],
      ["audience", "assets/icons/mdblist_audience.png", ratings.audience],
      ["metacritic", "assets/icons/mdblist_metacritic.png", ratings.metacritic]
    ].filter(([, , value]) => value != null && String(value).trim() !== "");
    if (!items.length) {
      return "";
    }
    return `
      <div class="detail-ratings-row">
        ${items
          .map(
            ([label, icon, value]) => `
          <span class="detail-rating-item">
            <img src="${icon}" alt="${escapeHtml(label)}" />
            <span>${escapeHtml(formatMdbListRating(label, value))}</span>
          </span>
        `
          )
          .join("")}
      </div>
    `;
  },

  renderCompanySections(meta = {}) {
    const production = this.renderCompanyLogosSection(
      meta.productionCompanies || meta.production_companies || [],
      t("detail.productionCompanies", {}, "Production")
    );
    const networks = this.renderCompanyLogosSection(
      meta.networks || [],
      t("detail.networks", {}, "Network")
    );
    if (meta.type === "series" || meta.type === "tv") {
      return `${networks}${production}`;
    }
    return `${production}${networks}`;
  },
  renderDefaultLayout(meta, streamItems) {
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
    const seasonButtons = this.renderSeasonButtons();
    const episodeCards = this.renderEpisodeCards();
    const castCards = this.renderCastCards();
    const moreLikeCards = this.renderMoreLikeCards();

    this.container.innerHTML = `
      <div class="row">
        <h2>${meta.name || "Untitled"}</h2>
        <p>${meta.description || t("detail.noDescription", {}, "No description.")}</p>
        <p style="opacity:0.8;">Type: ${meta.type || "unknown"} | Id: ${meta.id || "-"}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="playDefault">${isSeries ? t("detail.playNextEpisode", {}, "Play Next Episode") : t("detail.play", {}, "Play")}</div>
        <div class="card focusable" data-action="toggleLibrary">${this.isSavedInLibrary ? t("detail.removeFromLibrary", {}, "Remove from Library") : t("detail.addToLibrary", {}, "Add to Library")}</div>
        <div class="card focusable" data-action="toggleWatched">${this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched")}</div>
        <div class="card focusable" data-action="openSearch">${t("detail.searchSimilar", {}, "Search Similar")}</div>
        <div class="card focusable" data-action="goBack">${t("common.back", {}, "Back")}</div>
      </div>
      ${
        isSeries
          ? `
      <div class="row">
        <h3>${t("detail.seasons", {}, "Seasons")}</h3>
        <div id="detailSeasons">${seasonButtons}</div>
      </div>
      <div class="row">
        <h3>${t("detail.episodes", {}, "Episodes")}</h3>
        <div id="detailEpisodes">${episodeCards}</div>
      </div>
      `
          : ""
      }
      ${
        castCards
          ? `
      <div class="row">
        <h3>${t("detail.cast", {}, "Cast")}</h3>
        <div id="detailCast">${castCards}</div>
      </div>
      `
          : ""
      }
      ${
        moreLikeCards
          ? `
      <div class="row">
        <h3>${t("detail.moreLikeThis", {}, "More Like This")}</h3>
        <div id="detailMoreLike">${moreLikeCards}</div>
      </div>
      `
          : ""
      }
      <div class="row">
        <h3>${t("detail.streams", {}, "Streams")} (${streamItems.length})</h3>
        <div id="detailStreams"></div>
      </div>
    `;

    const streamWrap = this.container.querySelector("#detailStreams");
    streamItems.slice(0, 30).forEach((stream, index) => {
      const node = document.createElement("div");
      node.className = "card focusable";
      node.dataset.action = "playStream";
      node.dataset.streamUrl = stream.url;
      node.dataset.streamIndex = String(index);
      node.innerHTML = `
        <div style="font-weight:700;">${stream.label}</div>
        <div style="opacity:0.8;">${stream.addonName}</div>
      `;
      streamWrap.appendChild(node);
    });

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  renderMovieLayout(meta) {
    const backdrop = meta.background || meta.poster || "";
    const heroMarkup = this.renderMovieHeroMarkup(meta);

    this.container.innerHTML = `
      <div class="series-detail-shell movie-detail-shell${this.getTrailerShellStateClasses()}">
        <div class="series-detail-backdrop" data-backdrop-url="${escapeAttribute(backdrop || "")}"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
        <div class="detail-trailer-layer"></div>
        <div class="detail-trailer-loading-spinner" aria-hidden="true">${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}</div>
        <div class="series-detail-vignette"></div>
        <div class="detail-bottom-shadow"></div>

        <div class="series-detail-content movie-detail-content">
          <div id="detailHeroSection">${heroMarkup}</div>
          <div id="detailInsightSectionMount">${this.renderMovieInsightSection(meta)}</div>
          <div id="detailCommentsSectionMount">${this.renderStandaloneCommentsSection()}</div>
          <div id="detailCompanySectionsMount">${this.renderCompanySections(meta)}</div>
        </div>
        <div id="movieStreamChooserMount"></div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    if (!this.pendingFocusRestore) {
      ScreenUtils.setInitialFocus(this.container, ".movie-detail-content .focusable");
    }
    this._detailHeroMarkup = heroMarkup;
    this.bindDetailChrome();
  },

  captureRenderedChromeState() {
    const content = this.getDetailContentScroller();
    this.restoredContentScrollTop = Number(content?.scrollTop || 0);
    this.restoredTrackScrollLeftByKey = captureHorizontalScrollMap(this.container);
  },

  applyDetailBackdrop(meta) {
    const node = this.container?.querySelector(".series-detail-backdrop");
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const desired = String(meta?.background || meta?.poster || "");
    if (node.dataset.backdropUrl === desired) {
      return;
    }
    node.dataset.backdropUrl = desired;
    if (!desired) {
      node.style.backgroundImage = "";
      return;
    }
    const token = this.detailLoadToken;
    const apply = () => {
      if (this.detailLoadToken !== token) {
        return;
      }
      const current = this.container?.querySelector(".series-detail-backdrop");
      if (current instanceof HTMLElement && current.dataset.backdropUrl === desired) {
        current.style.backgroundImage = `url('${desired.replace(/'/g, "%27")}')`;
      }
    };
    if (typeof Image === "function") {
      const preload = new Image();
      preload.onload = apply;
      preload.onerror = apply;
      preload.src = desired;
    } else {
      apply();
    }
  },

  updateRenderedDetailSections(meta, focusRestoreOverride = null) {
    if (!this.container || !meta || !this.container.querySelector(".series-detail-shell")) {
      this.render(meta, focusRestoreOverride || null);
      return;
    }
    this._pendingSectionsMeta = meta;
    if (focusRestoreOverride) {
      this._pendingSectionsFocusRestore = focusRestoreOverride;
    }
    if (this._sectionsUpdateRaf) {
      return;
    }
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
    this._sectionsUpdateRaf = raf(() => {
      this._sectionsUpdateRaf = null;
      const pendingMeta = this._pendingSectionsMeta;
      const pendingFocus = this._pendingSectionsFocusRestore || null;
      this._pendingSectionsMeta = null;
      this._pendingSectionsFocusRestore = null;
      if (pendingMeta) {
        this._renderDetailSectionsNow(pendingMeta, pendingFocus);
      }
    });
  },

  _renderDetailSectionsNow(meta, focusRestoreOverride = null) {
    if (!this.container || !this.container.querySelector(".series-detail-shell")) {
      return;
    }
    const focusRestore = focusRestoreOverride || this.captureDetailFocus();
    this.captureRenderedChromeState();
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
    this.applyDetailBackdrop(meta);

    const heroMount = this.container.querySelector("#detailHeroSection");
    if (heroMount) {
      const heroMarkup = isSeries
        ? this.renderSeriesHeroMarkup(meta)
        : this.renderMovieHeroMarkup(meta);
      if (heroMarkup !== this._detailHeroMarkup) {
        heroMount.innerHTML = heroMarkup;
        this._detailHeroMarkup = heroMarkup;
      }
    }

    const seasonMount = this.container.querySelector("#detailSeasonRowMount");
    if (isSeries && seasonMount) {
      seasonMount.innerHTML = `<div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>`;
    }

    const episodeMount = this.container.querySelector("#detailEpisodeTrackMount");
    if (isSeries && episodeMount) {
      episodeMount.innerHTML = `<div class="series-episode-track" data-scroll-key="episodes:${this.selectedSeason ?? 1}">${this.renderEpisodeCards()}</div>`;
    }

    const insightMount = this.container.querySelector("#detailInsightSectionMount");
    if (insightMount) {
      insightMount.innerHTML = isSeries
        ? this.renderSeriesInsightSection()
        : this.renderMovieInsightSection(meta);
    }

    const commentsMount = this.container.querySelector("#detailCommentsSectionMount");
    if (commentsMount) {
      commentsMount.innerHTML = this.renderStandaloneCommentsSection();
    }

    const companyMount = this.container.querySelector("#detailCompanySectionsMount");
    if (companyMount) {
      companyMount.innerHTML = this.renderCompanySections(meta);
    }

    ScreenUtils.indexFocusables(this.container);
    this.pendingFocusRestore = focusRestore;
    this.bindDetailChrome();
    this.scheduleEpisodeVirtualizationSync(this.getRememberedEpisodeIndex());
  },
  renderMovieInsightSection(meta) {
    const trailerItems = resolveTrailerItems(meta);
    const showRatings = showHomeRatings(LayoutPreferences.get().homeImdbRatingsVisibility);
    const tabItems = [
      ["cast", t("detail.creatorCast", {}, "Creator and Cast")],
      ...(showRatings ? [["ratings", t("detail.ratings", {}, "Ratings")]] : []),
      ...(this.moreLikeThisItems.length
        ? [["morelike", t("detail.moreLikeThis", {}, "More Like This")]]
        : []),
      ...(trailerItems.length ? [["trailer", t("detail_tab_trailer", {}, "Trailer")]] : []),
      ...(this.collectionItems.length ? [["collection", this.collectionName || "Collection"]] : [])
    ];
    const tabs =
      tabItems.length > 1 ? this.renderPeopleTabs("movie", this.movieInsightTab, tabItems) : "";
    if (this.movieInsightTab === "ratings" && showRatings) {
      const imdbValue = resolveImdbRating(meta);
      const imdb = imdbValue != null && String(imdbValue).trim() !== "" ? String(imdbValue) : "-";
      const tmdb = Number.isFinite(Number(meta?.tmdbRating)) ? String(meta.tmdbRating) : "-";
      return `
        <section class="series-insight-section">
          ${tabs}
          <div class="movie-ratings-row">
            <article class="movie-rating-card">
              <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
              <div class="movie-rating-value">${imdb}</div>
            </article>
            <article class="movie-rating-card">
              <img src="assets/icons/mdblist_tmdb.svg" alt="TMDB" />
              <div class="movie-rating-value">${tmdb}</div>
            </article>
          </div>
        </section>
      `;
    }
    if (this.movieInsightTab === "collection") {
      return `
        <section class="series-insight-section">
          ${tabs}
          ${this.renderPreviewRail(this.collectionItems, "movie", "collection:movie")}
        </section>
      `;
    }
    if (this.movieInsightTab === "morelike") {
      return `
        <section class="series-insight-section">
          ${tabs}
          ${this.renderPreviewRail(this.moreLikeThisItems, "movie", "morelike:movie")}
          ${this.renderMoreLikeThisAttribution()}
        </section>
      `;
    }
    if (this.movieInsightTab === "trailer") {
      return `
        <section class="series-insight-section is-switching">
          ${tabs}
          ${this.renderTrailerRail(trailerItems, "movie")}
        </section>
      `;
    }
    return `
      <section class="series-insight-section movie-cast-section is-switching">
        ${tabs}
        ${this.renderSeriesCastTrack("movie")}
      </section>
    `;
  },

  renderSeriesInsightSection() {
    const trailerItems = resolveTrailerItems(this.meta);
    const tabItems = [
      ["cast", t("detail.creatorCast", {}, "Creator and Cast")],
      ["ratings", t("detail.ratings", {}, "Ratings")],
      ...(this.moreLikeThisItems.length
        ? [["morelike", t("detail.moreLikeThis", {}, "More Like This")]]
        : []),
      ...(trailerItems.length ? [["trailer", t("detail_tab_trailer", {}, "Trailer")]] : []),
      ...(this.collectionItems.length ? [["collection", this.collectionName || "Collection"]] : [])
    ];
    const tabs =
      tabItems.length > 1 ? this.renderPeopleTabs("series", this.seriesInsightTab, tabItems) : "";
    return `
      <section class="series-insight-section is-switching">
        ${tabs}
        ${
          this.seriesInsightTab === "ratings"
            ? this.renderSeriesRatingsPanel()
            : this.seriesInsightTab === "collection"
              ? this.renderPreviewRail(this.collectionItems, "series", "collection:series")
              : this.seriesInsightTab === "morelike"
                ? `${this.renderPreviewRail(this.moreLikeThisItems, "series", "morelike:series")}${this.renderMoreLikeThisAttribution()}`
                : this.seriesInsightTab === "trailer"
                  ? this.renderTrailerRail(trailerItems, "series")
                  : this.renderSeriesCastTrack("series")
        }
      </section>
    `;
  },

  renderMoreLikeThisAttribution() {
    if (!this.moreLikeThisSource) return "";
    const provider = this.moreLikeThisSource === "trakt" ? "Trakt" : "TMDB";
    return `<p class="detail-more-like-source">Related titles provided by ${provider}.</p>`;
  },

  renderPeopleTabs(kind, activeTab, items = []) {
    const normalized = items.filter(([, label]) => Boolean(label));
    return `
      <div class="series-insight-tabs" data-scroll-key="people-tabs:${kind}">
        ${normalized
          .map(
            ([tab, label], index) => `
          ${index > 0 ? '<span class="series-insight-divider">|</span>' : ""}
          <button class="series-insight-tab focusable${activeTab === tab ? " selected" : ""}"
                  data-action="${kind === "series" ? "setSeriesInsightTab" : "setMovieInsightTab"}"
                  data-tab="${tab}">${escapeHtml(label)}</button>
        `
          )
          .join("")}
      </div>
    `;
  },

  renderSeriesCastTrack(kind = "series") {
    if (!Array.isArray(this.castItems) || !this.castItems.length) {
      return `<div class="series-insight-empty">No cast information.</div>`;
    }
    const className = kind === "movie" ? "movie-cast-track" : "series-cast-track";
    const cards = this.castItems
      .slice(0, 18)
      .map(
        (person) => `
      <article class="movie-cast-card focusable series-cast-card"
               data-action="openCastDetail"
               data-cast-id="${person.tmdbId || ""}"
               data-cast-key="${escapeHtml(String(person.tmdbId || `${person.name || ""}:${person.character || ""}`))}"
               data-cast-name="${escapeHtml(person.name || "")}"
               data-cast-role="${escapeHtml(person.character || "")}"
               data-cast-photo="${escapeHtml(person.photo || "")}">
        <div class="movie-cast-avatar"${person.photo ? ` style="background-image:url('${String(person.photo).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="movie-cast-name">${escapeHtml(person.name || "")}</div>
        <div class="movie-cast-role">${escapeHtml(person.character || "")}</div>
      </article>
    `
      )
      .join("");
    return `<div class="${className}" data-scroll-key="cast:${kind}">${cards}</div>`;
  },

  renderSeriesRatingsPanel() {
    const seasonKeys = Object.keys(this.seriesRatingsBySeason || {})
      .map((key) => Number(key))
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    if (!seasonKeys.length) {
      return `<div class="series-insight-empty">${escapeHtml(t("detail.ratingsNotAvailable", {}, "Ratings not available."))}</div>`;
    }
    if (!seasonKeys.includes(Number(this.selectedRatingSeason))) {
      this.selectedRatingSeason = seasonKeys[0];
    }
    const ratings = this.seriesRatingsBySeason?.[this.selectedRatingSeason] || [];
    const seasonButtons = seasonKeys
      .map(
        (season) => `
      <button class="series-rating-season focusable${season === this.selectedRatingSeason ? " selected" : ""}"
              data-action="selectRatingSeason"
              data-season="${season}">S${season}</button>
    `
      )
      .join("");
    const chips = ratings.length
      ? ratings
          .map(
            (entry) => `
          <div class="series-episode-rating-chip focusable ${ratingToneClass(entry.rating)}"
               data-rating-episode="${Number(entry.episode || 0)}">
            <span class="series-episode-rating-ep">E${entry.episode}</span>
            <span class="series-episode-rating-val">${entry.rating != null ? String(entry.rating).replace(".", ".") : "-"}</span>
          </div>
        `
          )
          .join("")
      : `<div class="series-insight-empty">${escapeHtml(t("detail.noEpisodeRatings", {}, "No episode ratings in this season."))}</div>`;
    return `
      <div class="series-rating-seasons" data-scroll-key="rating-seasons">${seasonButtons}</div>
      <div class="series-rating-summary">${escapeHtml(t("detail.seasonSummary", { season: this.selectedRatingSeason, count: ratings.length }, "Season {{season}} • {{count}} episodes"))}</div>
      <div class="series-episode-ratings-grid" data-scroll-key="rating-chips:${this.selectedRatingSeason}">${chips}</div>
    `;
  },

  renderSeasonButtons() {
    if (!this.episodes?.length) {
      return `<p>${escapeHtml(t("detail.noEpisodesFound", {}, "No episodes found."))}</p>`;
    }
    const seasons = this.getAvailableSeasons();
    return seasons
      .map(
        (season) => `
      <button class="series-season-btn focusable${season === this.selectedSeason ? " selected" : ""}"
              data-action="selectSeason"
              data-season="${season}">
        ${escapeHtml(
          season === 0
            ? t("episodes_specials", {}, "Specials")
            : t("detail.seasonLabel", { season }, "Season {{season}}")
        )}
      </button>
      `
      )
      .join("");
  },

  getSelectedSeasonEpisodes() {
    return this.getSelectedSeasonEpisodeState().episodes;
  },

  getSelectedSeasonEpisodeState() {
    const allEpisodes = Array.isArray(this.episodes) ? this.episodes : [];
    const season = Number(this.selectedSeason || 0);
    const cachedState = this.selectedSeasonEpisodeState;
    if (cachedState?.source === allEpisodes && cachedState.season === season) {
      return cachedState;
    }
    const seasonEpisodes = [];
    const indexByVideoId = new Map();
    for (const episode of allEpisodes) {
      if (Number(episode?.season || 0) !== season) {
        continue;
      }
      const absoluteIndex = seasonEpisodes.length;
      seasonEpisodes.push(episode);
      const videoId = String(episode?.id || "").trim();
      if (videoId && !indexByVideoId.has(videoId)) {
        indexByVideoId.set(videoId, absoluteIndex);
      }
    }
    this.selectedSeasonEpisodeState = {
      source: allEpisodes,
      season,
      episodes: seasonEpisodes,
      indexByVideoId
    };
    return this.selectedSeasonEpisodeState;
  },

  getEpisodeIndexByVideoId(videoId) {
    const wanted = String(videoId || "").trim();
    if (!wanted) {
      return -1;
    }
    return this.getSelectedSeasonEpisodeState().indexByVideoId.get(wanted) ?? -1;
  },

  getEpisodeTrackElement() {
    return this.container?.querySelector(".series-episode-track") || null;
  },

  getFocusedEpisodeCard() {
    const target = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
    return target instanceof HTMLElement ? target : null;
  },

  getEpisodeAbsoluteIndex(node) {
    if (!(node instanceof HTMLElement)) {
      return -1;
    }
    const explicitIndex = Number(node.dataset.episodeIndex || -1);
    if (Number.isFinite(explicitIndex) && explicitIndex >= 0) {
      return explicitIndex;
    }
    return this.getEpisodeIndexByVideoId(String(node.dataset.videoId || ""));
  },

  measureEpisodeTrackMetrics(track = null) {
    const target = track instanceof HTMLElement ? track : this.getEpisodeTrackElement();
    const season = Number(this.selectedSeason || 0);
    const viewportWidth = Number(target?.clientWidth || 0);
    const cachedMetrics = this.episodeVirtualMetrics;
    if (
      cachedMetrics &&
      cachedMetrics.season === season &&
      cachedMetrics.viewportWidth === viewportWidth &&
      cachedMetrics.cardWidth > 0 &&
      cachedMetrics.stride > 0
    ) {
      return cachedMetrics;
    }
    const sampleCard = target?.querySelector?.(".series-episode-card") || null;
    const sampleWindow = target?.querySelector?.(".series-episode-track-window") || target;
    const trackStyle =
      target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
    const windowStyle =
      sampleWindow && typeof getComputedStyle === "function"
        ? getComputedStyle(sampleWindow)
        : null;
    const rawGap = Number.parseFloat(
      windowStyle?.gap || windowStyle?.columnGap || trackStyle?.gap || trackStyle?.columnGap || "0"
    );
    const gap =
      Number.isFinite(rawGap) && rawGap >= 0 ? rawGap : EPISODE_VIRTUALIZATION_DEFAULT_GAP;
    const measuredWidth = Number(sampleCard?.getBoundingClientRect?.().width || 0);
    const cardWidth =
      measuredWidth > 0
        ? measuredWidth
        : cachedMetrics?.cardWidth || EPISODE_VIRTUALIZATION_DEFAULT_CARD_WIDTH;
    const stride = Math.max(1, cardWidth + gap);
    this.episodeVirtualMetrics = {
      season,
      cardWidth,
      gap,
      stride,
      viewportWidth
    };
    return this.episodeVirtualMetrics;
  },

  getEpisodeVirtualWindowState(episodes = this.getSelectedSeasonEpisodes(), preferredIndex = null) {
    const list = Array.isArray(episodes) ? episodes : [];
    const total = list.length;
    if (!total) {
      return null;
    }
    const virtualized = total > EPISODE_VIRTUALIZATION_THRESHOLD;
    const metrics = this.measureEpisodeTrackMetrics();
    if (!virtualized) {
      return {
        season: Number(this.selectedSeason || 0),
        virtualized: false,
        start: 0,
        end: total - 1,
        cardWidth: metrics.cardWidth,
        gap: metrics.gap,
        stride: metrics.stride,
        leftSpacer: 0,
        rightSpacer: 0,
        preferredIndex: Number.isFinite(preferredIndex) ? preferredIndex : null
      };
    }

    const visibleEstimate = Math.ceil(
      Math.max(1, metrics.viewportWidth || 0) / Math.max(1, metrics.stride || 1)
    );
    const windowSize = Math.min(
      total,
      Math.max(
        EPISODE_VIRTUALIZATION_MIN_WINDOW,
        visibleEstimate + EPISODE_VIRTUALIZATION_OVERSCAN * 2
      )
    );
    const maxStart = Math.max(0, total - windowSize);
    const currentTrack = this.getEpisodeTrackElement();
    const currentScrollLeft = Number(currentTrack?.scrollLeft || 0);
    const baseIndex = Number.isFinite(preferredIndex)
      ? preferredIndex
      : Math.floor(currentScrollLeft / Math.max(1, metrics.stride || 1));
    const start = Math.max(0, Math.min(maxStart, baseIndex - EPISODE_VIRTUALIZATION_OVERSCAN));
    const end = Math.min(total - 1, start + windowSize - 1);
    return {
      season: Number(this.selectedSeason || 0),
      virtualized: true,
      start,
      end,
      cardWidth: metrics.cardWidth,
      gap: metrics.gap,
      stride: metrics.stride,
      leftSpacer: start * metrics.stride,
      rightSpacer: Math.max(0, (total - end - 1) * metrics.stride),
      preferredIndex: Number.isFinite(preferredIndex) ? preferredIndex : null
    };
  },

  renderEpisodeCard(episode, absoluteIndex) {
    const progress = this.episodeProgressMap.get(`${episode.season}:${episode.episode}`) || null;
    const position = Number(progress?.positionMs || 0);
    const duration = Number(progress?.durationMs || 0);
    const progressRatio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    const episodeKey = `${episode.season}:${episode.episode}`;
    const isWatched = this.enrichedWatchedState?.has(episodeKey)
      ? Boolean(this.enrichedWatchedState.get(episodeKey)?.isWatched)
      : this.watchedEpisodeKeys.has(episodeKey);
    const shouldBlur = Boolean(LayoutPreferences.get().blurUnwatchedEpisodes) && !isWatched;
    const rating = resolveEpisodeImdbRating(episode, this.seriesRatingsBySeason);
    const dateLabel = formatEpisodeCardDate(episode.released || "");
    const isUnavailable = episode.available === false;
    const metaParts = [
      episode.runtimeMinutes > 0 ? renderEpisodeRuntimeLabel(episode.runtimeMinutes) : "",
      rating != null
        ? `<span class="series-episode-rating-inline">${renderImdbBadge(String(Number(rating).toFixed(1)))}</span>`
        : "",
      dateLabel ? `<span class="series-episode-date">${escapeHtml(dateLabel)}</span>` : ""
    ]
      .filter(Boolean)
      .join("");
    return `
      <article class="series-episode-card focusable${isWatched ? " watched" : ""}"
            data-action="openEpisodeStreams"
            data-video-id="${escapeHtml(episode.id)}"
            data-episode-index="${absoluteIndex}">
        <div class="series-episode-thumb">
          <div class="series-episode-image${shouldBlur ? " is-blurred" : ""}"${episode.thumbnail ? ` data-thumb="${escapeHtml(episode.thumbnail)}"` : ""}></div>
          <div class="series-episode-overlay"></div>
          ${isWatched ? `<div class="series-episode-status complete">${renderWatchedBadgeGlyph()}</div>` : progressRatio < 0.02 ? `<div class="series-episode-status idle"></div>` : ""}
          ${isUnavailable ? `<div class="series-episode-unavailable">${escapeHtml(t("episodes_unavailable", {}, "Unavailable").toUpperCase())}</div>` : ""}
          <div class="series-episode-copy">
            <div class="series-episode-badge">${escapeHtml(t("episodes_episode", {}, "Episode").toUpperCase())} ${Number(episode.episode || 0)}</div>
            <div class="series-episode-title">${escapeHtml(normalizeEpisodeTitle(episode.title, episode.episode))}</div>
            <div class="series-episode-overview">${escapeHtml(episode.overview || t("episodes_episode", {}, "Episode"))}</div>
            ${metaParts ? `<div class="series-episode-meta">${metaParts}</div>` : ""}
          </div>
          ${progressRatio > 0.02 && progressRatio < 0.98 ? `<div class="series-episode-progress"><span style="width:${Math.round(progressRatio * 100)}%"></span></div>` : ""}
        </div>
      </article>
    `;
  },

  warmEpisodeThumbnails() {
    // Eager prefetch removed: episode thumbnails are now lazy-loaded on demand via
    // IntersectionObserver (see observeEpisodeThumbnails). Eagerly decoding a whole
    // season's thumbnails at once stalled low-end TVs when switching seasons.
  },

  applyEpisodeThumb(el) {
    try {
      if (!el) return;
      const url = el.getAttribute("data-thumb");
      if (!url) return;
      el.style.backgroundImage = "url('" + String(url).replace(/'/g, "%27") + "')";
      el.removeAttribute("data-thumb");
    } catch (_) {}
  },

  observeEpisodeThumbnails() {
    try {
      const root = this.container;
      if (!root) return;
      const thumbs = Array.from(root.querySelectorAll(".series-episode-image[data-thumb]"));
      if (!thumbs.length) return;
      // Fallback for engines without IntersectionObserver: just load them all.
      if (typeof IntersectionObserver !== "function") {
        thumbs.forEach((el) => this.applyEpisodeThumb(el));
        return;
      }
      if (!this.episodeThumbObserver) {
        this.episodeThumbObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                this.applyEpisodeThumb(entry.target);
                try {
                  this.episodeThumbObserver.unobserve(entry.target);
                } catch (_) {}
              }
            });
          },
          { root: null, rootMargin: "300px", threshold: 0.01 }
        );
      }
      thumbs.forEach((el) => this.episodeThumbObserver.observe(el));
    } catch (_) {}
  },

  renderEpisodeCards(preferredIndex = null) {
    const episodes = this.getSelectedSeasonEpisodes();
    if (!episodes.length) {
      return `<p>${escapeHtml(t("episodes_panel_no_episodes", {}, "No episodes available"))}</p>`;
    }
    const windowState = this.getEpisodeVirtualWindowState(episodes, preferredIndex);
    if (!windowState) {
      return `<p>${escapeHtml(t("episodes_panel_no_episodes", {}, "No episodes available"))}</p>`;
    }
    this.episodeVirtualWindow = windowState;
    const visibleEpisodes = windowState.virtualized
      ? episodes.slice(windowState.start, windowState.end + 1)
      : episodes;
    this.warmEpisodeThumbnails(episodes, windowState.start, windowState.end);
    const cards = visibleEpisodes
      .map((episode, offset) =>
        this.renderEpisodeCard(
          episode,
          windowState.virtualized ? windowState.start + offset : offset
        )
      )
      .join("");
    if (!windowState.virtualized) {
      return cards;
    }
    return `
      <div class="series-episode-track-spacer" aria-hidden="true" style="flex-basis:${Math.max(0, windowState.leftSpacer)}px"></div>
      <div class="series-episode-track-window" style="--episode-track-gap:${windowState.gap}px">
        ${cards}
      </div>
      <div class="series-episode-track-spacer" aria-hidden="true" style="flex-basis:${Math.max(0, windowState.rightSpacer)}px"></div>
    `;
  },

  refreshEpisodeTrack(focusRestoreOverride = null, preferredIndex = null) {
    if (!this.container || !isSeriesDetailMeta(this.meta, this.episodes)) {
      return false;
    }
    const episodeMount = this.container.querySelector("#detailEpisodeTrackMount");
    if (!episodeMount) {
      return false;
    }
    const focusRestore = focusRestoreOverride || this.captureDetailFocus();
    this.captureRenderedChromeState();
    episodeMount.innerHTML = `<div class="series-episode-track${this.getSelectedSeasonEpisodes().length > EPISODE_VIRTUALIZATION_THRESHOLD ? " is-virtualized" : ""}" data-scroll-key="episodes:${this.selectedSeason ?? 1}">${this.renderEpisodeCards(preferredIndex)}</div>`;
    ScreenUtils.indexFocusables(this.container);
    this.pendingFocusRestore = focusRestore;
    this.bindDetailChrome();
    return true;
  },

  scheduleEpisodeVirtualizationSync(preferredIndex = null) {
    if (this.episodeVirtualSyncRaf) {
      cancelAnimationFrame(this.episodeVirtualSyncRaf);
    }
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
    this.episodeVirtualSyncRaf = raf(() => {
      this.episodeVirtualSyncRaf = null;
      this.syncEpisodeVirtualization(preferredIndex);
    });
  },

  syncEpisodeVirtualization(preferredIndex = null) {
    if (!this.container || !isSeriesDetailMeta(this.meta, this.episodes)) {
      return false;
    }
    const episodes = this.getSelectedSeasonEpisodes();
    if (episodes.length <= EPISODE_VIRTUALIZATION_THRESHOLD) {
      return false;
    }
    const track = this.getEpisodeTrackElement();
    if (!track) {
      return false;
    }
    const currentFocus = this.getFocusedEpisodeCard();
    const currentFocusIndex = this.getEpisodeAbsoluteIndex(currentFocus);
    const focusIndex = Number.isFinite(preferredIndex)
      ? preferredIndex
      : currentFocusIndex >= 0
        ? currentFocusIndex
        : this.getRememberedEpisodeIndex(episodes);
    const nextWindow = this.getEpisodeVirtualWindowState(episodes, focusIndex);
    if (!nextWindow) {
      return false;
    }
    const currentWindow = this.episodeVirtualWindow;
    if (
      currentWindow &&
      currentWindow.season === nextWindow.season &&
      currentWindow.start === nextWindow.start &&
      currentWindow.end === nextWindow.end &&
      currentWindow.virtualized === nextWindow.virtualized
    ) {
      return false;
    }
    this.episodeVirtualWindow = nextWindow;
    this.refreshEpisodeTrack(
      { episodeIndex: focusIndex, preserveVerticalScroll: true },
      focusIndex
    );
    return true;
  },

  focusEpisodeByIndex(index, options = {}) {
    const episodes = this.getSelectedSeasonEpisodes();
    if (!episodes.length) {
      return false;
    }
    const targetIndex = Math.max(0, Math.min(episodes.length - 1, Number(index || 0)));
    const focusRestore = {
      episodeIndex: targetIndex,
      preserveVerticalScroll: Boolean(options?.preserveVerticalScroll)
    };
    if (this.syncEpisodeVirtualization(targetIndex)) {
      const target =
        this.container?.querySelector(
          `.series-episode-card[data-episode-index="${targetIndex}"]`
        ) || null;
      if (target instanceof HTMLElement) {
        return this.focusInList([target], 0, {
          animated: options?.animated !== false,
          preserveVerticalScroll: Boolean(options?.preserveVerticalScroll)
        });
      }
      this.pendingFocusRestore = focusRestore;
      return true;
    }
    const target =
      this.container?.querySelector(`.series-episode-card[data-episode-index="${targetIndex}"]`) ||
      null;
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return this.focusInList([target], 0, {
      animated: options?.animated !== false,
      preserveVerticalScroll: Boolean(options?.preserveVerticalScroll)
    });
  },

  focusEpisodeByVideoId(videoId, options = {}) {
    const index = this.getEpisodeIndexByVideoId(videoId);
    if (index < 0) {
      return false;
    }
    return this.focusEpisodeByIndex(index, options);
  },

  syncSeriesHeroPlayButtonLabel() {
    const labelNode = this.container?.querySelector?.(
      ".series-detail-actions [data-action='playDefault'] span:last-child"
    );
    if (labelNode instanceof HTMLElement) {
      labelNode.textContent = this.getSeriesHeroPlayLabel();
    }
  },

  syncEpisodeCardWatchedDom(episode) {
    const videoId = String(episode?.id || "").trim();
    if (!videoId || !this.container) {
      return;
    }
    const card = this.container.querySelector(
      `.series-episode-card[data-video-id="${escapeSelectorValue(videoId)}"]`
    );
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const thumb = card.querySelector(".series-episode-thumb");
    const image = card.querySelector(".series-episode-image");
    const copy = card.querySelector(".series-episode-copy");
    if (
      !(thumb instanceof HTMLElement) ||
      !(image instanceof HTMLElement) ||
      !(copy instanceof HTMLElement)
    ) {
      return;
    }

    const progress =
      this.episodeProgressMap.get(
        `${Number(episode.season || 0)}:${Number(episode.episode || 0)}`
      ) || null;
    const position = Number(progress?.positionMs || 0);
    const duration = Number(progress?.durationMs || 0);
    const progressRatio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    const isWatched = this.isEpisodeMarkedWatched(episode);

    card.classList.toggle("watched", isWatched);
    image.classList.toggle(
      "is-blurred",
      Boolean(LayoutPreferences.get().blurUnwatchedEpisodes) && !isWatched
    );

    let statusNode = thumb.querySelector(".series-episode-status");
    if (isWatched) {
      if (!(statusNode instanceof HTMLElement)) {
        statusNode = document.createElement("div");
        thumb.appendChild(statusNode);
      }
      statusNode.className = "series-episode-status complete";
      statusNode.innerHTML = renderWatchedBadgeGlyph();
    } else if (progressRatio < 0.02) {
      if (!(statusNode instanceof HTMLElement)) {
        statusNode = document.createElement("div");
        thumb.appendChild(statusNode);
      }
      statusNode.className = "series-episode-status idle";
      statusNode.innerHTML = "";
    } else if (statusNode instanceof HTMLElement) {
      statusNode.remove();
    }

    let progressNode = thumb.querySelector(".series-episode-progress");
    if (progressRatio > 0.02 && progressRatio < 0.98) {
      if (!(progressNode instanceof HTMLElement)) {
        progressNode = document.createElement("div");
        progressNode.className = "series-episode-progress";
        thumb.appendChild(progressNode);
      }
      progressNode.innerHTML = `<span style="width:${Math.round(progressRatio * 100)}%"></span>`;
    } else if (progressNode instanceof HTMLElement) {
      progressNode.remove();
    }
  },

  syncEpisodePlaybackDom(episodes = []) {
    if (!isSeriesDetailMeta(this.meta, this.episodes) || !this.container) {
      this.updateRenderedDetailSections(this.meta);
      return;
    }
    this.syncSeriesHeroPlayButtonLabel();
    (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
      this.syncEpisodeCardWatchedDom(episode);
    });
  },

  getEpisodeByVideoId(videoId) {
    const wanted = String(videoId || "").trim();
    if (!wanted) {
      return null;
    }
    return this.episodes.find((episode) => String(episode?.id || "") === wanted) || null;
  },

  getEpisodeFocusDescriptor(videoId) {
    const value = String(videoId || "").trim();
    if (!value) {
      return null;
    }
    const episodeIndex = this.getEpisodeIndexByVideoId(value);
    return {
      episodeVideoId: value,
      episodeIndex: episodeIndex >= 0 ? episodeIndex : null,
      selector: `.series-episode-card[data-video-id="${escapeSelectorValue(value)}"]`
    };
  },

  getEpisodeMenuProgress(episode) {
    if (!episode) {
      return null;
    }
    return (
      this.episodeProgressMap.get(
        `${Number(episode.season || 0)}:${Number(episode.episode || 0)}`
      ) || null
    );
  },

  isEpisodeMarkedWatched(episode) {
    if (!episode) {
      return false;
    }
    const key = `${Number(episode.season || 0)}:${Number(episode.episode || 0)}`;
    if (this.enrichedWatchedState?.has(key)) {
      return Boolean(this.enrichedWatchedState.get(key)?.isWatched);
    }
    return this.watchedEpisodeKeys.has(key);
  },

  getEpisodeHoldMenuEpisode() {
    return (
      this.getEpisodeByVideoId(this.episodeHoldMenu?.videoId) ||
      this.episodeHoldMenu?.episode ||
      null
    );
  },

  getEpisodeHoldMenuOptions() {
    const episode = this.getEpisodeHoldMenuEpisode();
    if (!episode) {
      return [];
    }
    const watched = this.isEpisodeMarkedWatched(episode);
    const seasonFullyWatched = this.isSeasonFullyWatched(episode.season);
    const options = [
      {
        action: "toggleWatched",
        label: watched
          ? t("episodes_mark_unwatched", {}, "Mark as unwatched")
          : t("episodes_mark_watched", {}, "Mark as watched")
      },
      {
        action: seasonFullyWatched ? "markSeasonUnwatched" : "markSeasonWatched",
        label: seasonFullyWatched
          ? t("episodes_mark_season_unwatched", {}, "Mark season as unwatched")
          : t("episodes_mark_season_watched", {}, "Mark season as watched")
      }
    ];
    if (this.getPreviousEpisodes(episode).length > 0) {
      options.push({
        action: "markPreviousWatched",
        label: t("episodes_mark_previous_watched", {}, "Mark previous episodes as watched")
      });
    }
    const progress = this.getEpisodeMenuProgress(episode);
    options.push({
      action: "play",
      label:
        progress && isWatchProgressInProgress(progress)
          ? t("detail.resume", {}, "Resume")
          : t("episodes_play", {}, "Play")
    });
    options.push({
      action: "playManually",
      label: t("play_manually", {}, "Play manually")
    });
    if (progress && isWatchProgressInProgress(progress)) {
      options.push({
        action: "playFromBeginning",
        label: t("detail.playFromBeginning", {}, "Play from Beginning")
      });
    }
    return options;
  },

  getSeasonHoldMenuSeason() {
    const season = Number(this.seasonHoldMenu?.season);
    return Number.isFinite(season) && season >= 0 ? season : null;
  },

  getSeasonHoldMenuOptions() {
    const season = this.getSeasonHoldMenuSeason();
    if (season == null) {
      return [];
    }
    const fullyWatched = this.isSeasonFullyWatched(season);
    return [
      {
        action: fullyWatched ? "markSeasonUnwatched" : "markSeasonWatched",
        label: fullyWatched
          ? t("episodes_mark_season_unwatched", {}, "Mark season as unwatched")
          : t("episodes_mark_season_watched", {}, "Mark season as watched")
      }
    ];
  },

  getCurrentLibraryItem() {
    return {
      itemId: this.params?.itemId || this.meta?.id || "",
      itemType: this.params?.itemType || this.meta?.type || "movie",
      title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      poster: this.meta?.poster || null,
      background: this.meta?.background || this.meta?.landscapePoster || null,
      description: this.meta?.description || "",
      releaseInfo: this.meta?.releaseInfo || "",
      imdbRating: this.meta?.imdbRating == null ? null : Number(this.meta.imdbRating),
      genres: Array.isArray(this.meta?.genres) ? this.meta.genres : []
    };
  },

  getLibraryListMenuOptions() {
    if (!this.libraryListMenu) {
      return [];
    }
    const membership = this.libraryListMenu.membership || {};
    const tabs = Array.isArray(this.libraryListMenu.tabs) ? this.libraryListMenu.tabs : [];
    return [
      ...tabs.map((tab) => ({
        action: `toggleLibraryList:${tab.key}`,
        label: tab.title || tab.key,
        selected: membership[tab.key] === true,
        className: "poster-list-picker-list-button"
      })),
      {
        action: this.libraryListMenu.destructiveRemovalRequired
          ? "confirmDestructiveSimklRemoval"
          : "saveLibraryLists",
        label: this.libraryListMenu.destructiveRemovalRequired
          ? "Remove status and clear Simkl history"
          : t("action_save", {}, "Save"),
        className: "poster-list-picker-save-button"
      }
    ];
  },

  destroyDetailHoldDialog() {
    if (this.detailHoldDialog) {
      this.detailHoldDialog.destroy();
      this.detailHoldDialog = null;
    }
  },

  focusDetailDescriptor(descriptor) {
    if (!descriptor || !this.container) {
      return false;
    }
    if (Number.isFinite(descriptor.episodeIndex) && descriptor.episodeIndex >= 0) {
      return this.focusEpisodeByIndex(Number(descriptor.episodeIndex), {
        animated: false,
        preserveVerticalScroll: Boolean(descriptor.preserveVerticalScroll)
      });
    }
    if (descriptor.episodeVideoId) {
      return this.focusEpisodeByVideoId(descriptor.episodeVideoId, {
        animated: false,
        preserveVerticalScroll: Boolean(descriptor.preserveVerticalScroll)
      });
    }
    if (!descriptor?.selector) {
      return false;
    }
    const target = this.container.querySelector(descriptor.selector);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return this.focusInList([target], 0, {
      animated: false,
      preserveVerticalScroll: Boolean(descriptor.preserveVerticalScroll)
    });
  },

  mountEpisodeHoldDialog() {
    const episode = this.getEpisodeHoldMenuEpisode();
    if (!episode) {
      return false;
    }
    const options = this.getEpisodeHoldMenuOptions();
    const focusRestore = this.getEpisodeFocusDescriptor(episode.id);
    this.destroyDetailHoldDialog();
    this.detailHoldDialog = new NuvioDialog({
      title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      subtitle: [
        `S${Number(episode.season || 0)}E${Number(episode.episode || 0)}`,
        episode.title || ""
      ]
        .filter(Boolean)
        .join(" - "),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons: options.map((option, index) => ({
        label: option.label,
        key: option.action,
        onAction: () => {
          this.episodeHoldMenu = {
            ...(this.episodeHoldMenu || {}),
            optionIndex: index
          };
          void this.activateEpisodeHoldMenuOption();
        }
      })),
      onDismiss: () => {
        this.detailHoldDialog = null;
        this.episodeHoldMenu = null;
        this.focusDetailDescriptor(focusRestore);
      }
    }).mount(document.body);
    return true;
  },

  mountSeasonHoldDialog() {
    const season = this.getSeasonHoldMenuSeason();
    if (season == null) {
      return false;
    }
    const focusRestore = { selector: `.series-season-btn[data-season="${season}"]` };
    this.destroyDetailHoldDialog();
    this.detailHoldDialog = new NuvioDialog({
      title:
        season === 0
          ? t("episodes_specials", {}, "Specials")
          : t("detail.seasonLabel", { season }, "Season {{season}}"),
      subtitle: t("episodes_season_actions", {}, "Season actions"),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons: this.getSeasonHoldMenuOptions().map((option, index) => ({
        label: option.label,
        key: option.action,
        onAction: () => {
          this.seasonHoldMenu = {
            ...(this.seasonHoldMenu || {}),
            optionIndex: index
          };
          void this.activateSeasonHoldMenuOption();
        }
      })),
      onDismiss: () => {
        this.detailHoldDialog = null;
        this.seasonHoldMenu = null;
        this.focusDetailDescriptor(focusRestore);
      }
    }).mount(document.body);
    return true;
  },

  mountHeroPlayDialog() {
    const hasResume = Boolean(this.getActiveResumeProgress());
    const buttons = hasResume
      ? [
          {
            label: t("detail.resume", {}, "Resume"),
            key: "resume",
            onAction: () => {
              void this.activateHeroOptionsMenu("resume");
            }
          },
          {
            label: t("play_manually", {}, "Play manually"),
            key: "playManually",
            onAction: () => {
              void this.activateHeroOptionsMenu("playManually");
            }
          },
          {
            label: t("detail.playFromBeginning", {}, "Play from Beginning"),
            key: "playFromBeginning",
            onAction: () => {
              void this.activateHeroOptionsMenu("playFromBeginning");
            }
          }
        ]
      : [
          {
            label: t("play_manually", {}, "Play manually"),
            key: "playManually",
            onAction: () => {
              void this.activateHeroOptionsMenu("playManually");
            }
          }
        ];
    this.destroyDetailHoldDialog();
    this.detailHoldDialog = new NuvioDialog({
      title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
      subtitle: t("detail.playOptions", {}, "Play options"),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons,
      onDismiss: () => {
        this.detailHoldDialog = null;
        this.heroPlayMenu = null;
        this.focusDetailDescriptor({
          selector: ".series-detail-actions [data-action='playDefault']"
        });
      }
    }).mount(document.body);
    return true;
  },

  mountLibraryListDialog() {
    if (!this.libraryListMenu) {
      return false;
    }
    const focusRestore = { selector: ".series-detail-actions [data-action='toggleLibrary']" };
    this.destroyDetailHoldDialog();
    this.detailHoldDialog = new NuvioDialog({
      title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
      subtitle: t("detail_lists_subtitle", {}, "Choose which lists should include this title"),
      error: this.libraryListMenu.error || null,
      widthVw: 52,
      suppressEnterUntilKeyUp: true,
      buttons: this.getLibraryListMenuOptions().map((option) => ({
        label: option.label,
        key: option.action,
        selected: option.selected,
        className: option.className,
        onAction: () => {
          void this.activateHeroOptionsMenu(option.action);
        }
      })),
      panelClassName: "poster-list-picker-dialog-panel",
      actionsClassName: "poster-list-picker-actions",
      onDismiss: () => {
        this.detailHoldDialog = null;
        this.libraryListMenu = null;
        this.focusDetailDescriptor(focusRestore);
      }
    }).mount(document.body);
    return true;
  },

  isEpisodeHoldTarget(node) {
    return Boolean(node?.matches?.(".series-episode-card.focusable"));
  },

  isSeasonHoldTarget(node) {
    return Boolean(node?.matches?.(".series-season-btn.focusable"));
  },

  isPosterHoldTarget(node) {
    return Boolean(node?.matches?.(".detail-morelike-card.focusable:not(.detail-trailer-card)"));
  },

  isHeroHoldTarget(node) {
    const action = String(node?.dataset?.action || "");
    return (
      Boolean(node?.matches?.(".series-primary-btn.focusable, .series-circle-btn.focusable")) &&
      (action === "playDefault" || action === "toggleLibrary")
    );
  },

  cancelPendingHeroHold() {
    if (this.pendingHeroHoldTimer) {
      clearTimeout(this.pendingHeroHoldTimer);
      this.pendingHeroHoldTimer = null;
    }
    this.pendingHeroHoldTarget = null;
  },

  hasPendingHeroHold(node) {
    const pending = this.pendingHeroHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return String(node.dataset.action || "") === String(pending.action || "");
  },

  startPendingHeroHold(node) {
    const action = String(node?.dataset?.action || "");
    if (action !== "playDefault" && action !== "toggleLibrary") {
      return false;
    }
    this.cancelPendingHeroHold();
    this.pendingHeroHoldTarget = {
      action,
      holdTriggered: false
    };
    this.pendingHeroHoldTimer = setTimeout(() => {
      this.pendingHeroHoldTimer = null;
      const pending = this.pendingHeroHoldTarget;
      if (!pending || Router.getCurrent() !== "detail") {
        return;
      }
      const current =
        this.container?.querySelector(".series-detail-actions .focusable.focused") || null;
      if (!this.hasPendingHeroHold(current)) {
        return;
      }
      pending.holdTriggered = true;
      if (pending.action === "playDefault") {
        this.openHeroPlayMenu();
      } else {
        void this.openLibraryListMenu();
      }
    }, HERO_HOLD_DELAY_MS);
    return true;
  },

  async completePendingHeroHold(node, event = null) {
    const pending = this.pendingHeroHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    const action = String(pending.action || "");
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= HERO_HOLD_DELAY_MS;
    const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingHeroHold(node);
    this.cancelPendingHeroHold();
    if (holdTriggered || shouldOpenHoldMenu) {
      if (shouldOpenHoldMenu) {
        if (action === "playDefault") {
          this.openHeroPlayMenu();
        } else if (action === "toggleLibrary") {
          void this.openLibraryListMenu();
        }
      }
      return true;
    }
    if (!node || String(node.dataset.action || "") !== action) {
      return false;
    }
    if (action === "playDefault") {
      await this.playDefaultFromHero();
      return true;
    }
    if (action === "toggleLibrary") {
      await this.toggleLibraryFromHero();
      return true;
    }
    return false;
  },

  openHeroPlayMenu() {
    this.heroPlayMenu = { optionIndex: 0 };
    this.libraryListMenu = null;
    return this.mountHeroPlayDialog();
  },

  closeHeroMenus({ restoreFocus = true } = {}) {
    if (!this.heroPlayMenu && !this.libraryListMenu) {
      return false;
    }
    const focusDescriptor = this.libraryListMenu
      ? { selector: ".series-detail-actions [data-action='toggleLibrary']" }
      : { selector: ".series-detail-actions [data-action='playDefault']" };
    this.heroPlayMenu = null;
    this.libraryListMenu = null;
    this.destroyDetailHoldDialog();
    if (restoreFocus) {
      this.focusDetailDescriptor(focusDescriptor);
    }
    return true;
  },

  async openLibraryListMenu() {
    const item = this.getCurrentLibraryItem();
    if (!item.itemId) {
      return false;
    }
    const tabs = await libraryRepository.getListTabs().catch(() => []);
    const resolvedTabs =
      Array.isArray(tabs) && tabs.length
        ? tabs.filter((tab) => tab.isMembershipDestination !== false)
        : [{ key: "local", title: t("detail.library", {}, "Library"), type: "local" }];
    const snapshot = await libraryRepository
      .getMembershipSnapshot(item)
      .catch(() => ({ listMembership: {} }));
    this.libraryListMenu = {
      item,
      sourceMode: await libraryRepository.getSourceMode().catch(() => LibrarySourceMode.LOCAL),
      tabs: resolvedTabs,
      membership: Object.fromEntries(
        resolvedTabs.map((tab) => [tab.key, Boolean(snapshot?.listMembership?.[tab.key])])
      ),
      error: ""
    };
    this.heroPlayMenu = null;
    return this.mountLibraryListDialog();
  },

  getResumeParamsForProgress(
    progress = null,
    { startOver = false, useActiveFallback = true } = {}
  ) {
    if (startOver) {
      return {
        startFromBeginning: true,
        resumePositionMs: 0,
        resumeProgressPercent: null,
        resumeDurationMs: 0
      };
    }
    const resume = progress || (useActiveFallback ? this.getActiveResumeProgress() : null);
    if (!resume || !isWatchProgressInProgress(resume)) {
      return {};
    }
    const params = {
      resumePositionMs: resolveWatchProgressResumePositionMs(resume),
      resumeProgressPercent:
        Number(resume.progressPercent ?? detailProgressFraction(resume) * 100) || null,
      resumeDurationMs: Number(resume.durationMs || 0) || 0
    };
    return params;
  },

  async playDefaultFromHero(options = {}) {
    const startOver = Boolean(options?.startOver);
    const manualSelection = Boolean(options?.manualSelection);
    if (isSeriesDetailMeta(this.meta, this.episodes)) {
      const targetEpisode =
        this.nextEpisodeToWatch ||
        this.episodes?.find((entry) => entry.season === this.selectedSeason) ||
        this.episodes?.[0] ||
        null;
      if (targetEpisode?.id) {
        await this.openEpisodeStreamChooser(targetEpisode.id, { startOver, manualSelection });
      }
      return;
    }
    await this.openMovieStreamChooser({ startOver, manualSelection });
  },

  async toggleLibraryFromHero() {
    await savedLibraryRepository.toggle({
      contentId: this.params?.itemId,
      contentType: this.params?.itemType || "movie",
      title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      poster: this.meta?.poster || null,
      background: this.meta?.background || null
    });
    this.isSavedInLibrary = !this.isSavedInLibrary;
    this.syncDetailActionButtons();
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
  },

  startPendingPosterHold(node) {
    this.cancelPendingPosterHold();
    if (!this.isPosterHoldTarget(node)) {
      return;
    }
    this.pendingPosterHoldTarget = node;
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const target = this.pendingPosterHoldTarget;
      this.pendingPosterHoldTarget = null;
      if (target?.isConnected && target.classList.contains("focused")) {
        void this.openPosterOptionsMenu(target);
      }
    }, POSTER_HOLD_DELAY_MS);
  },

  completePendingPosterHold(node, event = null) {
    if (!this.pendingPosterHoldTarget) {
      return false;
    }
    const target = this.pendingPosterHoldTarget;
    const hadTimer = Boolean(this.pendingPosterHoldTimer);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    this.cancelPendingPosterHold();
    if (hadTimer && target === node) {
      if (heldLongEnough) {
        void this.openPosterOptionsMenu(target);
      } else {
        this.openMoreLikeDetailFromNode(target);
      }
    }
    return true;
  },

  async openPosterOptionsMenu(node) {
    const parsedItem = posterItemFromNode(node, this.params?.itemType || "movie");
    const item = parsedItem
      ? {
          ...parsedItem,
          addonBaseUrl: parsedItem.addonBaseUrl || this.params?.addonBaseUrl || "",
          addonId: parsedItem.addonId || this.params?.addonId || "",
          addonName: parsedItem.addonName || this.params?.addonName || "",
          catalogType:
            parsedItem.catalogType ||
            this.params?.catalogType ||
            parsedItem.type ||
            this.params?.itemType ||
            "movie"
        }
      : null;
    if (!item?.id) {
      return false;
    }
    const focusRestore = this.getPosterFocusDescriptor(item.id);
    this.posterOptionsFocusRestore = focusRestore;
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          Router.navigate("detail", {
            itemId: target.id,
            itemType: target.type || "movie",
            fallbackTitle: target.title || "Untitled",
            fallbackPoster: target.poster || "",
            fallbackBackground: target.background || "",
            addonBaseUrl: target.addonBaseUrl || "",
            addonId: target.addonId || "",
            addonName: target.addonName || "",
            catalogType: target.catalogType || target.type || "movie"
          });
        },
        onDismiss: () => {
          const descriptor = this.posterOptionsFocusRestore;
          this.posterOptionsFocusRestore = null;
          this.focusDetailDescriptor(descriptor);
        },
        onChanged: () => {
          this.render(this.meta, this.posterOptionsFocusRestore || null);
        }
      });
    }
    return this.posterOptionsController.open(item);
  },

  closePosterOptionsMenu() {
    if (!this.posterOptionsController?.dialog) {
      return false;
    }
    this.posterOptionsController.destroy();
    this.posterOptionsFocusRestore = null;
    return true;
  },

  getPosterFocusDescriptor(itemId) {
    const id = String(itemId || "").trim();
    return id
      ? { selector: `.detail-morelike-card[data-item-id="${escapeSelectorValue(id)}"]` }
      : null;
  },

  openMoreLikeDetailFromNode(node) {
    const itemId = String(node?.dataset?.itemId || "").trim();
    if (!itemId) {
      return;
    }
    Router.navigate("detail", {
      itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
  },

  moveEpisodeFocus(direction) {
    if (direction !== "left" && direction !== "right") {
      return false;
    }
    const current = this.getFocusedEpisodeCard();
    if (!current) {
      return false;
    }
    const currentIndex = this.getEpisodeAbsoluteIndex(current);
    if (!Number.isFinite(currentIndex) || currentIndex < 0) {
      return false;
    }
    const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
    return this.focusEpisodeByIndex(nextIndex, { preserveVerticalScroll: true });
  },

  cancelPendingEpisodeHold() {
    if (this.pendingEpisodeHoldTimer) {
      clearTimeout(this.pendingEpisodeHoldTimer);
      this.pendingEpisodeHoldTimer = null;
    }
    this.pendingEpisodeHoldTarget = null;
  },

  cancelPendingSeasonHold() {
    if (this.pendingSeasonHoldTimer) {
      clearTimeout(this.pendingSeasonHoldTimer);
      this.pendingSeasonHoldTimer = null;
    }
    this.pendingSeasonHoldTarget = null;
  },

  hasPendingEpisodeHold(node) {
    const pending = this.pendingEpisodeHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return String(node.dataset.videoId || "") === String(pending.videoId || "");
  },

  hasPendingSeasonHold(node) {
    const pending = this.pendingSeasonHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return Number(node.dataset.season || 0) === Number(pending.season || 0);
  },

  startPendingEpisodeHold(node) {
    const videoId = String(node?.dataset?.videoId || "");
    if (!videoId) {
      return false;
    }
    this.cancelPendingEpisodeHold();
    this.pendingEpisodeHoldTarget = {
      videoId,
      holdTriggered: false
    };
    this.pendingEpisodeHoldTimer = setTimeout(() => {
      this.pendingEpisodeHoldTimer = null;
      const pending = this.pendingEpisodeHoldTarget;
      if (!pending || Router.getCurrent() !== "detail") {
        return;
      }
      const current =
        this.container?.querySelector(".series-episode-card.focusable.focused") || null;
      if (!this.hasPendingEpisodeHold(current)) {
        return;
      }
      pending.holdTriggered = true;
      this.openEpisodeHoldMenu(current);
    }, EPISODE_HOLD_DELAY_MS);
    return true;
  },

  startPendingSeasonHold(node) {
    const season = Number(node?.dataset?.season || 0);
    if (!Number.isFinite(season) || season < 0) {
      return false;
    }
    this.cancelPendingSeasonHold();
    this.pendingSeasonHoldTarget = {
      season,
      holdTriggered: false
    };
    this.pendingSeasonHoldTimer = setTimeout(() => {
      this.pendingSeasonHoldTimer = null;
      const pending = this.pendingSeasonHoldTarget;
      if (!pending || Router.getCurrent() !== "detail") {
        return;
      }
      const current = this.container?.querySelector(".series-season-btn.focusable.focused") || null;
      if (!this.hasPendingSeasonHold(current)) {
        return;
      }
      pending.holdTriggered = true;
      this.openSeasonHoldMenu(current);
    }, EPISODE_HOLD_DELAY_MS);
    return true;
  },

  async completePendingEpisodeHold(node, event = null) {
    const pending = this.pendingEpisodeHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= EPISODE_HOLD_DELAY_MS;
    const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingEpisodeHold(node);
    this.cancelPendingEpisodeHold();
    if (holdTriggered || shouldOpenHoldMenu) {
      if (shouldOpenHoldMenu) {
        this.openEpisodeHoldMenu(node);
      }
      return true;
    }
    if (!this.isEpisodeHoldTarget(node)) {
      return false;
    }
    const selectedEpisode = this.episodes.find((entry) => entry.id === node.dataset.videoId);
    if (!selectedEpisode) {
      return false;
    }
    await this.openEpisodeStreamChooser(selectedEpisode.id);
    return true;
  },

  completePendingSeasonHold(node, event = null) {
    const pending = this.pendingSeasonHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= EPISODE_HOLD_DELAY_MS;
    const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingSeasonHold(node);
    this.cancelPendingSeasonHold();
    if (holdTriggered || shouldOpenHoldMenu) {
      if (shouldOpenHoldMenu) {
        this.openSeasonHoldMenu(node);
      }
      return true;
    }
    if (!this.isSeasonHoldTarget(node)) {
      return false;
    }
    const season = Number(node?.dataset?.season || 0);
    if (!Number.isFinite(season) || season < 0) {
      return false;
    }
    if (season !== this.selectedSeason) {
      this.hasManualSeasonSelection = true;
      this.selectedSeason = season;
      this.render(this.meta);
    }
    return true;
  },

  openEpisodeHoldMenu(node) {
    const episode = this.getEpisodeByVideoId(node?.dataset?.videoId || "");
    if (!episode) {
      return false;
    }
    this.episodeHoldMenu = {
      videoId: String(episode.id || ""),
      optionIndex: 0,
      episode: { ...episode }
    };
    return this.mountEpisodeHoldDialog();
  },

  openSeasonHoldMenu(node) {
    const season = Number(node?.dataset?.season || 0);
    if (!Number.isFinite(season) || season < 0) {
      return false;
    }
    this.seasonHoldMenu = {
      season,
      optionIndex: 0
    };
    return this.mountSeasonHoldDialog();
  },

  closeEpisodeHoldMenu({ restoreFocus = true } = {}) {
    if (!this.episodeHoldMenu) {
      return false;
    }
    const focusRestore = this.getEpisodeFocusDescriptor(this.episodeHoldMenu.videoId);
    this.episodeHoldMenu = null;
    this.destroyDetailHoldDialog();
    if (restoreFocus) {
      this.focusDetailDescriptor(focusRestore);
    }
    return true;
  },

  closeSeasonHoldMenu({ restoreFocus = true } = {}) {
    if (!this.seasonHoldMenu) {
      return false;
    }
    const season = Number(this.seasonHoldMenu.season ?? this.selectedSeason ?? 1);
    this.seasonHoldMenu = null;
    this.destroyDetailHoldDialog();
    if (restoreFocus) {
      this.focusDetailDescriptor({ selector: `.series-season-btn[data-season="${season}"]` });
    }
    return true;
  },

  startEpisodeFromHoldMenu(episode, options = {}) {
    if (!episode?.id) {
      return false;
    }
    const progress = this.getEpisodeMenuProgress(episode);
    this.episodeHoldMenu = null;
    this.navigateToStreamScreenForEpisode(episode, {
      ...this.getResumeParamsForProgress(progress, {
        startOver: Boolean(options.startOver),
        useActiveFallback: false
      }),
      ...(options.manualSelection ? { manualSelection: true } : {})
    });
    return true;
  },

  getSeasonEpisodes(season) {
    const seasonNumber = Number(season || 0);
    return (this.episodes || []).filter((episode) => Number(episode?.season || 0) === seasonNumber);
  },

  isSeasonFullyWatched(season) {
    const episodes = this.getSeasonEpisodes(season);
    return episodes.length > 0 && episodes.every((episode) => this.isEpisodeMarkedWatched(episode));
  },

  getPreviousEpisodes(episode) {
    if (!episode) {
      return [];
    }
    const targetSeason = Number(episode?.season || 0);
    const targetEpisode = Number(episode?.episode || 0);
    return (this.episodes || []).filter((entry) => {
      const entrySeason = Number(entry?.season || 0);
      const entryEpisode = Number(entry?.episode || 0);
      return (
        entrySeason < targetSeason || (entrySeason === targetSeason && entryEpisode < targetEpisode)
      );
    });
  },

  async setEpisodesWatchedState(episodes = [], watched = true) {
    const targets = (episodes || []).filter((episode) => episode?.id);
    if (!targets.length) {
      return false;
    }
    for (const episode of targets) {
      if (watched) {
        await watchedItemsRepository.mark({
          contentId: this.params?.itemId,
          contentType: "series",
          title: this.meta?.name || this.params?.fallbackTitle || episode.title || "Untitled",
          season: episode.season,
          episode: episode.episode,
          videoId: episode.id,
          watchedAt: Date.now()
        });
        await watchProgressRepository.saveProgress({
          contentId: this.params?.itemId,
          contentType: "series",
          videoId: episode.id,
          season: episode.season,
          episode: episode.episode,
          positionMs: 100,
          durationMs: 100,
          updatedAt: Date.now()
        });
      } else {
        await watchedItemsRepository.unmark(this.params?.itemId, {
          season: episode.season,
          episode: episode.episode,
          videoId: episode.id
        });
        await watchProgressRepository.removeProgress(this.params?.itemId, episode.id);
      }
    }
    if (isSeriesDetailMeta(this.meta, this.episodes)) {
      await watchedSeriesReconciliationService.reconcile(
        this.params?.itemId,
        this.params?.itemType || this.meta?.type || "series",
        { meta: this.meta }
      );
    }
    await this.refreshEpisodePlaybackState();
    return true;
  },

  async setSeasonWatchedState(season, watched) {
    const episodes = this.getSeasonEpisodes(season);
    if (!episodes.length) {
      return false;
    }
    await this.setEpisodesWatchedState(episodes, watched);
    this.episodeHoldMenu = null;
    this.seasonHoldMenu = null;
    this.syncEpisodePlaybackDom(episodes);
    return true;
  },

  async markPreviousEpisodesWatched(episode) {
    const previousEpisodes = this.getPreviousEpisodes(episode);
    if (!previousEpisodes.length) {
      return false;
    }
    await this.setEpisodesWatchedState(previousEpisodes, true);
    this.episodeHoldMenu = null;
    this.syncEpisodePlaybackDom(previousEpisodes);
    return true;
  },

  async refreshEpisodePlaybackState() {
    detailWatchedEnrichmentService.invalidateCache(this.params?.itemId);
    const [progress, allProgressItems, allWatchedItems, watchedItem] = await Promise.all([
      watchProgressRepository.getResumeByContentIds(
        this.resumeContentIds?.length ? this.resumeContentIds : [this.params?.itemId]
      ),
      watchProgressRepository.getAll(),
      watchedItemsRepository.getAll(),
      watchedItemsRepository.isWatched(this.params?.itemId)
    ]);
    this.resumeProgress = progress && isWatchProgressInProgress(progress) ? progress : null;
    this.isMarkedWatched = Boolean(
      watchedItem ||
      (progress &&
        Number(progress.durationMs || 0) > 0 &&
        Number(progress.positionMs || 0) >= Number(progress.durationMs || 0))
    );
    const progressItemsForDetail = this.resumeProgress
      ? [this.resumeProgress, ...allProgressItems]
      : allProgressItems;
    this.buildEpisodeState(progressItemsForDetail, allWatchedItems, this.enrichedWatchedState);
    this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(this.resumeProgress || progress);
  },

  async setEpisodeWatchedState(episode, watched) {
    if (!episode?.id) {
      return false;
    }
    if (watched) {
      await watchedItemsRepository.mark({
        contentId: this.params?.itemId,
        contentType: "series",
        title: this.meta?.name || this.params?.fallbackTitle || episode.title || "Untitled",
        season: episode.season,
        episode: episode.episode,
        videoId: episode.id,
        watchedAt: Date.now()
      });
      await watchProgressRepository.saveProgress({
        contentId: this.params?.itemId,
        contentType: "series",
        videoId: episode.id,
        season: episode.season,
        episode: episode.episode,
        positionMs: 100,
        durationMs: 100,
        updatedAt: Date.now()
      });
    } else {
      await watchedItemsRepository.unmark(this.params?.itemId, {
        season: episode.season,
        episode: episode.episode,
        videoId: episode.id
      });
      await watchProgressRepository.removeProgress(this.params?.itemId, episode.id);
    }
    if (isSeriesDetailMeta(this.meta, this.episodes)) {
      await watchedSeriesReconciliationService.reconcile(
        this.params?.itemId,
        this.params?.itemType || this.meta?.type || "series",
        {
          meta: this.meta,
          completedEpisode: watched
            ? {
                season: episode.season,
                episode: episode.episode
              }
            : null
        }
      );
    }
    await this.refreshEpisodePlaybackState();
    this.episodeHoldMenu = null;
    this.syncEpisodePlaybackDom([episode]);
    return true;
  },

  async activateEpisodeHoldMenuOption() {
    const episode = this.getEpisodeHoldMenuEpisode();
    const options = this.getEpisodeHoldMenuOptions();
    const option =
      options[
        Math.max(0, Math.min(options.length - 1, Number(this.episodeHoldMenu?.optionIndex || 0)))
      ];
    if (!episode || !option) {
      return false;
    }
    if (option.action === "play") {
      this.closeEpisodeHoldMenu({ restoreFocus: false });
      return this.startEpisodeFromHoldMenu(episode);
    }
    if (option.action === "playFromBeginning") {
      this.closeEpisodeHoldMenu({ restoreFocus: false });
      return this.startEpisodeFromHoldMenu(episode, { startOver: true });
    }
    if (option.action === "playManually") {
      this.closeEpisodeHoldMenu({ restoreFocus: false });
      return this.startEpisodeFromHoldMenu(episode, { manualSelection: true });
    }
    if (option.action === "toggleWatched") {
      this.closeEpisodeHoldMenu({ restoreFocus: false });
      return this.setEpisodeWatchedState(episode, !this.isEpisodeMarkedWatched(episode));
    }
    if (option.action === "markSeasonWatched" || option.action === "markSeasonUnwatched") {
      this.closeEpisodeHoldMenu({ restoreFocus: false });
      return this.setSeasonWatchedState(episode.season, option.action === "markSeasonWatched");
    }
    if (option.action === "markPreviousWatched") {
      this.closeEpisodeHoldMenu({ restoreFocus: false });
      return this.markPreviousEpisodesWatched(episode);
    }
    return false;
  },

  async activateSeasonHoldMenuOption() {
    const season = this.getSeasonHoldMenuSeason();
    const options = this.getSeasonHoldMenuOptions();
    const option =
      options[
        Math.max(0, Math.min(options.length - 1, Number(this.seasonHoldMenu?.optionIndex || 0)))
      ];
    if (season == null || !option) {
      return false;
    }
    if (option.action === "markSeasonWatched" || option.action === "markSeasonUnwatched") {
      this.closeSeasonHoldMenu({ restoreFocus: false });
      return this.setSeasonWatchedState(season, option.action === "markSeasonWatched");
    }
    return false;
  },

  async activateHeroOptionsMenu(actionOverride = "") {
    if (this.heroPlayMenu) {
      this.closeHeroMenus({ restoreFocus: false });
      await this.playDefaultFromHero({
        startOver: actionOverride === "playFromBeginning",
        manualSelection: actionOverride === "playManually"
      });
      return true;
    }
    if (!this.libraryListMenu) {
      return false;
    }
    const action = String(actionOverride || "");
    if (action.startsWith("toggleLibraryList:")) {
      const key = action.slice("toggleLibraryList:".length);
      const nextSelected = !this.libraryListMenu.membership?.[key];
      this.libraryListMenu.membership =
        this.libraryListMenu.sourceMode === LibrarySourceMode.SIMKL
          ? Object.fromEntries(
              this.libraryListMenu.tabs.map((tab) => [tab.key, nextSelected && tab.key === key])
            )
          : { ...(this.libraryListMenu.membership || {}), [key]: nextSelected };
      this.libraryListMenu.destructiveRemovalRequired = false;
      if (this.libraryListMenu.sourceMode === LibrarySourceMode.SIMKL) {
        this.mountLibraryListDialog();
      } else {
        this.detailHoldDialog?.setButtonSelected?.(
          action,
          Boolean(this.libraryListMenu.membership[key])
        );
      }
      return true;
    }
    if (action === "saveLibraryLists" || action === "confirmDestructiveSimklRemoval") {
      try {
        await libraryRepository.applyMembershipChanges(
          this.libraryListMenu.item,
          {
            desiredMembership: this.libraryListMenu.membership || {}
          },
          {
            destructiveRemovalConfirmed: action === "confirmDestructiveSimklRemoval"
          }
        );
        this.isSavedInLibrary = Object.values(this.libraryListMenu.membership || {}).some(Boolean);
        this.closeHeroMenus({ restoreFocus: false });
        this.syncDetailActionButtons();
      } catch (error) {
        console.warn("Failed to update library lists", error);
        this.libraryListMenu.destructiveRemovalRequired =
          error?.code === "SIMKL_DESTRUCTIVE_REMOVAL_REQUIRED";
        this.libraryListMenu.error = this.libraryListMenu.destructiveRemovalRequired
          ? "Removing this status will also clear watched history or a rating on Simkl. Confirm only if that is intended."
          : t("detail_lists_save_failed", {}, "Could not save list changes.");
        this.mountLibraryListDialog();
      }
      return true;
    }
    return false;
  },

  renderCastCards() {
    if (!Array.isArray(this.castItems) || !this.castItems.length) {
      return "";
    }
    return this.castItems
      .map(
        (person) => `
      <div class="card focusable">
        <div style="font-weight:700;">${person.name}</div>
        <div style="opacity:0.8;">Cast</div>
      </div>
    `
      )
      .join("");
  },

  shouldRenderCommentsSection() {
    return Boolean(
      TraktSettingsStore.get().showMetaComments &&
      TraktAuthService.isAuthenticated() &&
      this.supportsTraktComments(this.meta)
    );
  },

  renderStandaloneCommentsSection() {
    if (!this.shouldRenderCommentsSection()) {
      return "";
    }
    return this.renderCommentsSection();
  },

  renderTrailerRail(trailerItems = resolveTrailerItems(this.meta), kind = "series") {
    const items = Array.isArray(trailerItems) ? trailerItems : [];
    if (!items.length) {
      return `<div class="series-insight-empty">${escapeHtml(t("detail.noTrailers", {}, "No trailers available."))}</div>`;
    }
    const cards = items
      .map((trailer, index) => {
        const ytId = String(trailer.ytId || "").trim();
        const title = trailer.name || trailer.type || t("detail_tab_trailer", {}, "Trailer");
        const subtitle = [trailer.type, trailer.lang ? String(trailer.lang).toUpperCase() : ""]
          .filter(Boolean)
          .join(" • ");
        return `
        <article class="detail-morelike-card detail-trailer-card focusable"
                 data-action="openSharedTrailer"
                 data-trailer-index="${index}"
                 data-trailer-yt-id="${escapeHtml(ytId)}">
          <div class="detail-morelike-poster-wrap">
            <img class="detail-morelike-poster-image" src="https://img.youtube.com/vi/${escapeHtml(ytId)}/hqdefault.jpg" alt="${escapeHtml(title)}" loading="lazy" decoding="async" />
            <span class="detail-trailer-play-badge"><img src="assets/icons/trailer_play_button.svg" alt="" aria-hidden="true" /></span>
          </div>
          <div class="detail-morelike-name">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="detail-morelike-type">${escapeHtml(subtitle)}</div>` : ""}
        </article>
      `;
      })
      .join("");
    return `<div class="detail-morelike-track detail-trailer-track" data-scroll-key="trailer:${escapeHtml(kind)}">${cards}</div>`;
  },

  renderCommentsSection() {
    if (this.commentsLoading) {
      const cards = Array.from({ length: 3 })
        .map(
          () =>
            `<article class="detail-comment-card is-loading"><span></span><span></span><span></span></article>`
        )
        .join("");
      return `<div class="detail-comments-track" data-scroll-key="comments:loading">${cards}</div>`;
    }
    if (this.commentsError) {
      return `
        <div class="detail-comments-error">
          <p>${escapeHtml(this.commentsError)}</p>
          <button class="series-season-btn focusable" data-action="retryComments">${escapeHtml(t("action_retry", {}, "Retry"))}</button>
        </div>
      `;
    }
    const modeButtons = isSeriesDetailMeta(this.meta, this.episodes)
      ? `<div class="detail-comments-modes">
          <button class="detail-comments-mode focusable${this.commentsMode !== "episode" ? " selected" : ""}" data-action="setCommentsMode" data-comments-mode="title">${escapeHtml(t("detail_comments_mode_show", {}, "Show"))}</button>
          <button class="detail-comments-mode focusable${this.commentsMode === "episode" ? " selected" : ""}" data-action="setCommentsMode" data-comments-mode="episode">${escapeHtml(this.commentsEpisodeTarget ? `S${this.commentsEpisodeTarget.season}E${this.commentsEpisodeTarget.episode}` : t("detail_comments_mode_episode", {}, "Episode"))}</button>
        </div>`
      : "";
    const subtitle =
      this.commentsMode === "episode" && this.commentsEpisodeTarget
        ? t(
            "detail_comments_subtitle_episode",
            {
              season: this.commentsEpisodeTarget.season,
              episode: this.commentsEpisodeTarget.episode
            },
            "Reviews for S{{season}}E{{episode}}"
          )
        : t("detail_comments_subtitle", {}, "Top Trakt reviews");
    if (!this.commentsItems.length) {
      return `
        <div class="detail-comments-section">
          <div class="detail-comments-heading"><img src="assets/icons/trakt_tv_glyph.svg" alt="" /><span>${escapeHtml(t("detail_comments_title", {}, "Comments"))}</span></div>
          <p class="detail-comments-subtitle">${escapeHtml(subtitle)}</p>
          ${modeButtons}
          <p class="series-insight-empty">${escapeHtml(t("detail_comments_empty", {}, "No Trakt comments yet."))}</p>
        </div>
      `;
    }
    const cards = this.commentsItems
      .map((review, index) => {
        const body =
          review.spoiler || review.containsInlineSpoilers
            ? t("detail_comments_spoiler_hidden", {}, "Spoiler review. Press OK to reveal.")
            : review.comment;
        const chips = [
          review.review ? t("detail_comments_badge_review", {}, "Review") : "",
          review.spoiler || review.containsInlineSpoilers
            ? t("detail_comments_badge_spoiler", {}, "Spoiler")
            : "",
          review.rating != null
            ? t(
                "detail_comments_badge_rating",
                {
                  rating: formatRatingValue(review.rating, { digits: 0, stripTrailingZero: true })
                },
                "{{rating}}/10"
              )
            : ""
        ]
          .filter(Boolean)
          .map((chip) => `<span>${escapeHtml(chip)}</span>`)
          .join("");
        return `
        <article class="detail-comment-card focusable" data-action="openComment" data-comment-index="${index}">
          <h4>${escapeHtml(review.authorDisplayName || "Trakt user")}</h4>
          ${chips ? `<div class="detail-comment-chips">${chips}</div>` : ""}
          <p>${escapeHtml(body)}</p>
          <small>${escapeHtml(t("detail_comments_likes", { likes: review.likes || 0 }, "{{likes}} likes"))}</small>
        </article>
      `;
      })
      .join("");
    const loadingMore = this.commentsLoadingMore
      ? `<article class="detail-comment-card is-loading"><span></span><span></span><span></span></article>`
      : "";
    return `
      <div class="detail-comments-section">
        <div class="detail-comments-heading"><img src="assets/icons/trakt_tv_glyph.svg" alt="" /><span>${escapeHtml(t("detail_comments_title", {}, "Comments"))}</span></div>
        <p class="detail-comments-subtitle">${escapeHtml(subtitle)}</p>
        ${modeButtons}
        <div class="detail-comments-track" data-scroll-key="comments:${escapeHtml(this.commentsMode)}">${cards}${loadingMore}</div>
      </div>
    `;
  },

  renderPreviewRail(items = [], fallbackType = "movie", railKey = "morelike") {
    if (!Array.isArray(items) || !items.length) {
      return "";
    }
    const cards = items
      .map((rawItem) => {
        const item = normalizePreviewItem(rawItem, fallbackType);
        const year = extractPreviewYear(item.releaseInfo);
        const primaryImage = item.landscapePoster || item.poster || "";
        const fallbackImage = item.poster && item.poster !== primaryImage ? item.poster : "";
        return `
      <article class="detail-morelike-card focusable"
           data-action="openMoreLikeDetail"
           data-item-id="${item.id}"
           data-item-type="${item.type || this.params?.itemType || "movie"}"
           data-item-title="${escapeHtml(item.name || "Untitled")}"
           data-poster-src="${escapeHtml(item.poster || primaryImage || "")}"
           data-backdrop-src="${escapeHtml(item.background || item.backdrop || item.landscapePoster || primaryImage || "")}">
        <div class="detail-morelike-poster-wrap">
          ${
            primaryImage
              ? `<img class="detail-morelike-poster-image" src="${escapeHtml(primaryImage)}" alt="${escapeHtml(item.name || "content")}" loading="lazy" decoding="async"${fallbackImage ? ` data-fallback-src="${escapeHtml(fallbackImage)}"` : ""} onerror="var next=this.dataset.fallbackSrc||''; if(next && this.src !== next){ this.src = next; this.dataset.fallbackSrc=''; return; } this.hidden = true; var placeholder = this.nextElementSibling; if(placeholder){ placeholder.hidden = false; }" />`
              : ""
          }
          <div class="detail-morelike-poster placeholder"${primaryImage ? " hidden" : ""}></div>
        </div>
        <div class="detail-morelike-name">${escapeHtml(item.name || "Untitled")}</div>
        ${year ? `<div class="detail-morelike-type">${escapeHtml(year)}</div>` : ""}
      </article>
    `;
      })
      .join("");
    return `<div class="detail-morelike-track" data-scroll-key="${escapeHtml(railKey)}">${cards}</div>`;
  },

  renderMoreLikeCards() {
    return this.renderPreviewRail(this.moreLikeThisItems, this.params?.itemType || "movie");
  },

  renderCompanyLogosSection(rawCompanies = [], title = "Studios") {
    const toLogo = (logo) => {
      const value = String(logo || "").trim();
      if (!value) {
        return "";
      }
      if (value.startsWith("http://") || value.startsWith("https://")) {
        return value;
      }
      if (value.startsWith("/")) {
        return `https://image.tmdb.org/t/p/w500${value}`;
      }
      return value;
    };
    const companies = rawCompanies
      .map((entry) => ({
        name: entry?.name || "",
        logo: toLogo(entry?.logo || entry?.logoPath || entry?.logo_path || "")
      }))
      .filter((entry) => entry.logo || entry.name);
    if (!companies.length) {
      return "";
    }
    const logos = companies
      .slice(0, 10)
      .map(
        (company) => `
      <article class="detail-company-card focusable"
               data-company-name="${escapeHtml(company.name || "")}">
        ${company.logo ? `<img src="${company.logo}" alt="${escapeHtml(company.name || "Company")}" loading="lazy" decoding="async" />` : `<span>${escapeHtml(company.name || "")}</span>`}
      </article>
    `
      )
      .join("");
    return `
      <section class="detail-company-section">
        <h3 class="detail-company-title">${escapeHtml(title)}</h3>
        <div class="detail-company-track" data-scroll-key="company:${escapeHtml(String(title || "").toLowerCase())}">${logos}</div>
      </section>
    `;
  },

  bindDetailChrome() {
    this.observeEpisodeThumbnails();
    const content = this.container?.querySelector(".series-detail-content");
    if (!content) {
      return;
    }
    if (this.detailScrollHandler) {
      content.removeEventListener("scroll", this.detailScrollHandler);
    }
    this.detailScrollHandler = () => {
      const shell = this.container?.querySelector(".series-detail-shell");
      if (!shell) {
        return;
      }
      if (this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay") {
        this.stopTrailerPlayback({ restartAutoplay: false });
      }
      shell.classList.toggle("detail-scrolled", content.scrollTop > 160);
    };
    content.addEventListener("scroll", this.detailScrollHandler, { passive: true });
    const episodeTrack = this.container?.querySelector(".series-episode-track");
    if (this.episodeTrackScrollNode && this.episodeTrackScrollHandler) {
      this.episodeTrackScrollNode.removeEventListener("scroll", this.episodeTrackScrollHandler);
    }
    this.episodeTrackScrollNode = episodeTrack instanceof HTMLElement ? episodeTrack : null;
    if (this.episodeTrackScrollNode) {
      this.episodeTrackScrollHandler = () => {
        this.scheduleEpisodeVirtualizationSync();
      };
      this.episodeTrackScrollNode.addEventListener("scroll", this.episodeTrackScrollHandler, {
        passive: true
      });
    } else {
      this.episodeTrackScrollHandler = null;
    }
    if (this.detailFocusHandler) {
      this.container.removeEventListener("focusin", this.detailFocusHandler, true);
    }
    this.detailFocusHandler = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement) || !this.container?.contains(target)) {
        return;
      }
      if (!this.isTrailerPlaying) {
        if (target.matches('.series-detail-actions [data-action="playDefault"]')) {
          this.restartTrailerAutoplayTimer();
        } else if (this.trailerAutoplayTimer) {
          clearTimeout(this.trailerAutoplayTimer);
          this.trailerAutoplayTimer = null;
        }
      }
      if (target.matches(".series-season-btn.focusable")) {
        const season = Number(target.dataset.season || 0);
        if (season >= 0 && season !== this.selectedSeason) {
          this.hasManualSeasonSelection = true;
          this.selectedSeason = season;
          this.render(this.meta, { selector: `.series-season-btn[data-season="${season}"]` });
        }
        return;
      }
      if (target.matches(".series-insight-tab.focusable")) {
        const tab = String(target.dataset.tab || "");
        if (!tab) {
          return;
        }
        if (isSeriesDetailMeta(this.meta, this.episodes) && tab !== this.seriesInsightTab) {
          this.seriesInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(
            tab
          )
            ? tab
            : "cast";
          this.updateRenderedDetailSections(this.meta);
          return;
        }
        if (!isSeriesDetailMeta(this.meta, this.episodes) && tab !== this.movieInsightTab) {
          this.movieInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(
            tab
          )
            ? tab
            : "cast";
          this.updateRenderedDetailSections(this.meta);
        }
        return;
      }
      if (target.matches(".series-rating-season.focusable")) {
        const season = Number(target.dataset.season || 0);
        if (season > 0 && season !== this.selectedRatingSeason) {
          this.selectedRatingSeason = season;
          this.render(this.meta, { selector: `.series-rating-season[data-season="${season}"]` });
        }
      }
    };
    this.container.addEventListener("focusin", this.detailFocusHandler, true);
    if (this.detailClickHandler) {
      this.container.removeEventListener("click", this.detailClickHandler, true);
    }
    this.detailClickHandler = () => {
      if (this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay") {
        this.stopTrailerPlayback({ restartAutoplay: false });
        return;
      }
    };
    this.container.addEventListener("click", this.detailClickHandler, true);
    this.detailScrollHandler();
    this.restoreChromeState();
    this.syncTrailerDom();
    this.restartTrailerAutoplayTimer();
    this.restorePendingFocus();
  },

  restoreChromeState() {
    const content = this.container?.querySelector(".series-detail-content");
    if (content) {
      content.scrollTop = Number(this.restoredContentScrollTop || 0);
    }
    Array.from(this.container?.querySelectorAll("[data-scroll-key]") || []).forEach((node) => {
      const key = String(node.dataset.scrollKey || "");
      if (!key) {
        return;
      }
      node.scrollLeft = Number(this.restoredTrackScrollLeftByKey?.[key] || 0);
    });
  },

  syncDetailActionButtons() {
    if (!this.container) {
      return;
    }
    Array.from(this.container.querySelectorAll('[data-action="toggleLibrary"]')).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (node.classList.contains("series-circle-btn")) {
        node.classList.toggle("is-library-selected", this.isSavedInLibrary);
        node.innerHTML = renderLibraryGlyph(this.isSavedInLibrary);
        node.setAttribute(
          "aria-label",
          this.isSavedInLibrary
            ? t("detail.removeFromLibrary", {}, "Remove from Library")
            : t("detail.addToLibrary", {}, "Add to Library")
        );
      } else {
        node.textContent = this.isSavedInLibrary
          ? t("detail.removeFromLibrary", {}, "Remove from Library")
          : t("detail.addToLibrary", {}, "Add to Library");
      }
    });
    Array.from(this.container.querySelectorAll('[data-action="toggleWatched"]')).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (node.classList.contains("series-circle-btn")) {
        node.classList.toggle("is-selected", this.isMarkedWatched);
        node.innerHTML = renderWatchedGlyph(this.isMarkedWatched);
        node.setAttribute(
          "aria-label",
          this.isMarkedWatched
            ? t("common.markUnwatched", {}, "Mark Unwatched")
            : t("common.markWatched", {}, "Mark Watched")
        );
      } else {
        node.textContent = this.isMarkedWatched
          ? t("common.markUnwatched", {}, "Mark Unwatched")
          : t("common.markWatched", {}, "Mark Watched");
      }
    });
    Router.captureCurrentRouteState();
  },

  captureDetailFocus() {
    if (this.episodeHoldMenu) {
      return this.getEpisodeFocusDescriptor(this.episodeHoldMenu?.videoId);
    }
    if (this.seasonHoldMenu) {
      const season = Number(this.seasonHoldMenu.season ?? this.selectedSeason ?? 1);
      return { selector: `.series-season-btn[data-season="${season}"]` };
    }
    if (this.posterOptionsController?.dialog) {
      return this.posterOptionsFocusRestore || null;
    }
    if (this.libraryListMenu) {
      return { selector: ".series-detail-actions [data-action='toggleLibrary']" };
    }
    if (this.heroPlayMenu) {
      return { selector: ".series-detail-actions [data-action='playDefault']" };
    }
    if (!this.container) {
      return null;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeTarget =
      active && this.container.contains(active) && active.classList.contains("focusable")
        ? active
        : null;
    const current = this.container.querySelector(".focusable.focused");
    const target =
      activeTarget || current || (active && this.container.contains(active) ? active : null);
    if (!(target instanceof HTMLElement) || !target.closest(".series-detail-content")) {
      return null;
    }
    const action = String(target.dataset.action || "");
    if (action === "selectSeason") {
      const season = Number(target.dataset.season || 0);
      return season >= 0 ? { selector: `.series-season-btn[data-season="${season}"]` } : null;
    }
    if (action === "setSeriesInsightTab" || action === "setMovieInsightTab") {
      const tab = String(target.dataset.tab || "");
      return tab ? { selector: `.series-insight-tab[data-tab="${tab}"]` } : null;
    }
    if (action === "setCommentsMode") {
      const mode =
        String(target.dataset.commentsMode || "title") === "episode" ? "episode" : "title";
      return {
        selector: `.detail-comments-mode[data-comments-mode="${mode}"]`,
        preserveVerticalScroll: true
      };
    }
    if (action === "openComment") {
      const index = Number(target.dataset.commentIndex || 0);
      return {
        selector: `.detail-comment-card[data-comment-index="${index}"]`,
        preserveVerticalScroll: true
      };
    }
    if (action === "openSharedTrailer") {
      const index = Number(target.dataset.trailerIndex || 0);
      return { selector: `.detail-trailer-card[data-trailer-index="${index}"]` };
    }
    if (action === "selectRatingSeason") {
      const season = Number(target.dataset.season || 0);
      return season > 0 ? { selector: `.series-rating-season[data-season="${season}"]` } : null;
    }
    if (action === "openEpisodeStreams") {
      const videoId = String(target.dataset.videoId || "");
      const episodeIndex = Number(target.dataset.episodeIndex || -1);
      return videoId
        ? {
            episodeVideoId: videoId,
            episodeIndex:
              Number.isFinite(episodeIndex) && episodeIndex >= 0
                ? episodeIndex
                : this.getEpisodeIndexByVideoId(videoId),
            selector: `.series-episode-card[data-video-id="${escapeSelectorValue(videoId)}"]`
          }
        : null;
    }
    if (action === "openCastDetail") {
      const castKey = String(target.dataset.castKey || "");
      return castKey
        ? { selector: `.series-cast-card[data-cast-key="${escapeSelectorValue(castKey)}"]` }
        : null;
    }
    if (action === "openMoreLikeDetail") {
      const itemId = String(target.dataset.itemId || "");
      return itemId
        ? { selector: `.detail-morelike-card[data-item-id="${escapeSelectorValue(itemId)}"]` }
        : null;
    }
    if (target.matches(".detail-company-card.focusable")) {
      const companyName = String(target.dataset.companyName || "");
      return companyName
        ? {
            selector: `.detail-company-card[data-company-name="${escapeSelectorValue(companyName)}"]`
          }
        : null;
    }
    if (target.matches(".series-episode-rating-chip.focusable")) {
      const episode = Number(target.dataset.ratingEpisode || 0);
      return episode > 0
        ? { selector: `.series-episode-rating-chip[data-rating-episode="${episode}"]` }
        : null;
    }
    if (action) {
      return { selector: `.series-detail-actions [data-action="${action}"]` };
    }
    return null;
  },

  restorePendingFocus() {
    const descriptor = this.pendingFocusRestore;
    this.pendingFocusRestore = null;
    return this.focusDetailDescriptor(descriptor);
  },

  isPerformanceConstrained() {
    return Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  },

  isLegacyTvRuntime() {
    if (Environment.isTizen()) {
      return true;
    }
    if (!Environment.isWebOS()) {
      return false;
    }
    const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
    return webOsMajor > 0 && webOsMajor <= 5;
  },

  shouldSuppressTrailerAutoplay() {
    const content = this.getDetailContentScroller();
    const focused = this.container?.querySelector(".focusable.focused") || null;
    return Boolean(
      this.trailerHasAutoplayed ||
      !content ||
      Number(content.scrollTop || 0) > 160 ||
      !focused?.matches?.('.series-detail-actions [data-action="playDefault"]') ||
      this.seasonHoldMenu ||
      this.episodeHoldMenu ||
      this.heroPlayMenu ||
      this.libraryListMenu ||
      this.detailHoldDialog ||
      this.posterOptionsController?.dialog
    );
  },

  animateScroll(container, axis, targetValue, duration = 150) {
    if (!container) {
      return;
    }
    if (!this.isLegacyTvRuntime()) {
      this.animateSpringScroll(container, axis, targetValue);
      return;
    }
    const property = axis === "y" ? "scrollTop" : "scrollLeft";
    const max =
      axis === "y"
        ? Math.max(0, container.scrollHeight - container.clientHeight)
        : Math.max(0, container.scrollWidth - container.clientWidth);
    const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
    const startValue = Number(container[property] || 0);
    if (Math.abs(startValue - nextValue) <= 1) {
      container[property] = nextValue;
      return;
    }

    const prefersReducedMotion = globalThis?.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    const effectiveDuration = this.isLegacyTvRuntime()
      ? 0
      : this.isPerformanceConstrained()
        ? Math.min(Number(duration || 150), 90)
        : Number(duration || 150);
    if (prefersReducedMotion || effectiveDuration <= 0) {
      container[property] = nextValue;
      return;
    }

    const ease = (t) => {
      const p1x = 0.4;
      const p1y = 0;
      const p2x = 0.2;
      const p2y = 1;
      const sampleCurveX = (x) =>
        ((1 - 3 * p2x + 3 * p1x) * x + (3 * p2x - 6 * p1x)) * x * x + 3 * p1x * x;
      const sampleCurveY = (x) =>
        ((1 - 3 * p2y + 3 * p1y) * x + (3 * p2y - 6 * p1y)) * x * x + 3 * p1y * x;
      const sampleDerivativeX = (x) =>
        (3 * (1 - 3 * p2x + 3 * p1x) * x + 2 * (3 * p2x - 6 * p1x)) * x + 3 * p1x;
      let x = t;
      for (let i = 0; i < 4; i += 1) {
        const derivative = sampleDerivativeX(x);
        if (Math.abs(derivative) < 0.001) break;
        x -= (sampleCurveX(x) - t) / derivative;
      }
      return sampleCurveY(Math.max(0, Math.min(1, x)));
    };
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const key = axis === "y" ? "y" : "x";
    const existing = map.get(container) || {};
    if (existing[key]) {
      cancelAnimationFrame(existing[key]);
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / effectiveDuration);
      container[property] = Math.round(startValue + (nextValue - startValue) * ease(progress));
      if (progress < 1) {
        existing[key] = requestAnimationFrame(tick);
        map.set(container, existing);
      } else {
        existing[key] = null;
        map.set(container, existing);
      }
    };

    existing[key] = requestAnimationFrame(tick);
    map.set(container, existing);
  },

  animateSpringScroll(container, axis, targetValue, options = {}) {
    if (!container) {
      return;
    }
    const property = axis === "y" ? "scrollTop" : "scrollLeft";
    const max =
      axis === "y"
        ? Math.max(0, container.scrollHeight - container.clientHeight)
        : Math.max(0, container.scrollWidth - container.clientWidth);
    const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
    const prefersReducedMotion = globalThis?.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    if (prefersReducedMotion) {
      container[property] = nextValue;
      return;
    }

    const tweenMap = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const key = axis === "y" ? "y" : "x";
    const tweenState = tweenMap.get(container);
    if (tweenState?.[key]) {
      cancelAnimationFrame(tweenState[key]);
      tweenState[key] = null;
      tweenMap.set(container, tweenState);
    }

    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const existing = springMap.get(container) || {};
    const active = existing[key];
    if (active) {
      active.target = nextValue;
      active.stiffness = Number(options?.stiffness ?? active.stiffness ?? DETAIL_SCROLL_STIFFNESS);
      active.dampingRatio = Number(
        options?.dampingRatio ?? active.dampingRatio ?? DETAIL_SCROLL_DAMPING_RATIO
      );
      active.precision = Number(options?.precision ?? active.precision ?? 0.5);
      active.velocityEpsilon = Number(options?.velocityEpsilon ?? active.velocityEpsilon ?? 0.5);
      active.damping = 2 * active.dampingRatio * Math.sqrt(active.stiffness);
      springMap.set(container, existing);
      return;
    }

    const stiffness = Number(options?.stiffness ?? DETAIL_SCROLL_STIFFNESS);
    const dampingRatio = Number(options?.dampingRatio ?? DETAIL_SCROLL_DAMPING_RATIO);
    const state = {
      target: nextValue,
      position: Number(container[property] || 0),
      velocity: 0,
      raf: null,
      lastTime: performance.now(),
      stiffness,
      dampingRatio,
      damping: 2 * dampingRatio * Math.sqrt(stiffness),
      precision: Number(options?.precision ?? 0.5),
      velocityEpsilon: Number(options?.velocityEpsilon ?? 0.5)
    };

    const tick = (now) => {
      const deltaSeconds = Math.min(
        DETAIL_SCROLL_MAX_FRAME_SECONDS,
        Math.max(0.001, (now - state.lastTime) / 1000)
      );
      state.lastTime = now;
      const displacement = state.position - Number(state.target || 0);
      const acceleration = -state.stiffness * displacement - state.damping * state.velocity;
      state.velocity += acceleration * deltaSeconds;
      state.position += state.velocity * deltaSeconds;
      container[property] = state.position;

      const remaining = Number(state.target || 0) - Number(container[property] || 0);
      if (
        Math.abs(remaining) <= state.precision &&
        Math.abs(state.velocity) <= state.velocityEpsilon
      ) {
        container[property] = state.target;
        existing[key] = null;
        springMap.set(container, existing);
        return;
      }

      state.raf = requestAnimationFrame(tick);
      existing[key] = state;
      springMap.set(container, existing);
    };

    state.raf = requestAnimationFrame(tick);
    existing[key] = state;
    springMap.set(container, existing);
  },

  restartTrailerAutoplayTimer() {
    if (this.trailerAutoplayTimer) {
      clearTimeout(this.trailerAutoplayTimer);
      this.trailerAutoplayTimer = null;
    }
    if (
      !this.trailerSource ||
      this.isTrailerPlaying ||
      this.params?.autoOpenContinueWatching ||
      this.pendingEpisodeSelection ||
      this.pendingMovieSelection ||
      this.shouldSuppressTrailerAutoplay() ||
      !PlayerSettingsStore.get().trailerAutoplay
    ) {
      return;
    }
    this.trailerAutoplayTimer = setTimeout(
      () => {
        this.playTrailer({ muted: false, restart: true, initiatedByUser: false });
      },
      Math.min(15, Math.max(0, Number(PlayerSettingsStore.get().trailerDelaySeconds ?? 7))) * 1000
    );
  },

  detachTrailerMediaListeners() {
    (this.trailerMediaListeners || []).forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.trailerMediaListeners = [];
  },

  stopTrailerProgressTimer() {
    if (this.trailerProgressTimer) {
      clearInterval(this.trailerProgressTimer);
      this.trailerProgressTimer = null;
    }
  },

  stopTrailerControlsTimer() {
    if (this.trailerControlsTimer) {
      clearTimeout(this.trailerControlsTimer);
      this.trailerControlsTimer = null;
    }
  },

  stopTrailerProxyLoadingTimer() {
    if (this.trailerProxyLoadingTimer) {
      clearTimeout(this.trailerProxyLoadingTimer);
      this.trailerProxyLoadingTimer = null;
    }
  },

  stopTrailerFirstFramePolling() {
    if (this.trailerFirstFramePollTimer) {
      clearInterval(this.trailerFirstFramePollTimer);
      this.trailerFirstFramePollTimer = null;
    }
  },

  stopTrailerFallbackRevealTimer() {
    if (this.trailerFallbackRevealTimer) {
      clearTimeout(this.trailerFallbackRevealTimer);
      this.trailerFallbackRevealTimer = null;
    }
  },

  scheduleTrailerFallbackReveal(ytId = "") {
    this.stopTrailerFallbackRevealTimer();
    const expectedId = String(ytId || "").trim();
    this.trailerFallbackRevealTimer = setTimeout(() => {
      this.trailerFallbackRevealTimer = null;
      if (
        this.isTrailerPlaying &&
        this.trailerSource?.kind === "youtube" &&
        (!expectedId || String(this.trailerSource?.ytId || "").trim() === expectedId)
      ) {
        this.markTrailerVisualReady();
      }
    }, 1200);
  },

  startTrailerFirstFramePolling() {
    this.stopTrailerFirstFramePolling();
    if (
      !this.isTrailerPlaying ||
      this.trailerSource?.kind !== "youtube" ||
      this.trailerVisualReady
    ) {
      return;
    }
    this.trailerFirstFramePollTimer = setInterval(() => {
      if (
        !this.isTrailerPlaying ||
        this.trailerSource?.kind !== "youtube" ||
        this.trailerVisualReady
      ) {
        this.stopTrailerFirstFramePolling();
        return;
      }
      this.postTrailerProxyCommand("getState");
    }, 120);
  },

  startTrailerProxyLoadingTimer(ytId = "") {
    this.stopTrailerProxyLoadingTimer();
    const expectedId = String(ytId || "").trim();
    if (!expectedId) {
      return;
    }
    this.trailerProxyLoadingTimer = setTimeout(() => {
      const activeId = String(this.trailerSource?.ytId || "").trim();
      if (
        !this.isTrailerPlaying ||
        this.trailerSource?.kind !== "youtube" ||
        activeId !== expectedId
      ) {
        return;
      }
      if (this.trailerProxyState && !this.trailerProxyState.loading) {
        return;
      }
      this.trailerProxyState = {
        currentTime: Number(this.trailerProxyState?.currentTime || 0),
        duration: Number(this.trailerProxyState?.duration || 0),
        paused: false,
        muted: Boolean(this.trailerMuted),
        loading: false,
        controllable: false
      };
      this.trailerYoutubeFallbackActive = true;
      if (this.trailerPlaybackMode === "manual") {
        this.updateTrailerOverlay();
        this.restartTrailerControlsTimer();
      }
    }, 4500);
  },

  setTrailerControlsVisible(visible) {
    this.trailerControlsVisible = Boolean(visible);
    const overlay = this.trailerUiRefs?.overlay;
    if (overlay) {
      overlay.classList.toggle("hidden", !this.trailerControlsVisible);
    }
  },

  restartTrailerControlsTimer() {
    this.stopTrailerControlsTimer();
    if (!this.isTrailerPlaying || !this.trailerSource || this.trailerPlaybackMode !== "manual") {
      this.setTrailerControlsVisible(false);
      return;
    }
    this.setTrailerControlsVisible(true);
    const playback = this.getTrailerPlaybackSnapshot();
    if (playback.loading || playback.paused) {
      return;
    }
    this.trailerControlsTimer = setTimeout(() => {
      this.setTrailerControlsVisible(false);
    }, 3200);
  },

  startTrailerProgressTimer() {
    this.stopTrailerProgressTimer();
    if (this.trailerPlaybackMode !== "manual") {
      return;
    }
    // YouTube proxy state messages and native timeupdate events already keep
    // the overlay current. A second 250 ms poll doubled cross-frame work and
    // caused recurring main-thread pressure on Samsung TV browsers.
    this.updateTrailerOverlay();
  },

  cacheTrailerRefs() {
    const layer = this.container?.querySelector(".detail-trailer-layer");
    this.trailerUiRefs = layer
      ? {
          layer,
          overlay: layer.querySelector(".detail-trailer-controls-overlay"),
          media: layer.querySelector("[data-trailer-media]"),
          frame: layer.querySelector(".detail-trailer-frame"),
          video: layer.querySelector(".detail-trailer-video"),
          status: layer.querySelector("[data-trailer-status]"),
          progressFill: layer.querySelector("[data-trailer-progress-fill]"),
          timeLabel: layer.querySelector("[data-trailer-time-label]")
        }
      : null;
  },

  getTrailerPlaybackSnapshot() {
    const snapshot = {
      currentTime: 0,
      duration: 0,
      paused: true,
      muted: Boolean(this.trailerMuted),
      captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
      loading: false,
      controllable: true
    };
    if (!this.isTrailerPlaying || !this.trailerSource) {
      return snapshot;
    }
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (!video) {
        return {
          ...snapshot,
          loading: true
        };
      }
      const duration = Number.isFinite(video.duration) ? Number(video.duration) : 0;
      return {
        currentTime: Number.isFinite(video.currentTime) ? Number(video.currentTime) : 0,
        duration,
        paused: Boolean(video.paused),
        muted: Boolean(video.muted),
        captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
        loading: Boolean(!video.readyState || video.readyState < 2),
        controllable: true
      };
    }

    if (!this.trailerProxyState) {
      return {
        ...snapshot,
        loading: true
      };
    }
    return {
      currentTime: Number(this.trailerProxyState.currentTime || 0),
      duration: Number(this.trailerProxyState.duration || 0),
      paused: Boolean(this.trailerProxyState.paused),
      muted: Boolean(this.trailerProxyState.muted),
      captionsEnabled: Boolean(this.trailerProxyState.captionsEnabled),
      loading: Boolean(this.trailerProxyState.loading),
      controllable: this.trailerProxyState.controllable !== false
    };
  },

  updateTrailerOverlay() {
    const refs = this.trailerUiRefs;
    if (!refs) {
      return;
    }
    const playback = this.getTrailerPlaybackSnapshot();
    this.trailerMuted = Boolean(playback.muted);
    this.trailerSubtitlesEnabled = Boolean(playback.captionsEnabled);
    if (!this.trailerControlsVisible && !playback.loading && !playback.paused) {
      return;
    }
    const progress =
      playback.duration > 0
        ? Math.max(0, Math.min(100, (playback.currentTime / playback.duration) * 100))
        : 0;
    if (refs.progressFill) {
      refs.progressFill.style.width = `${progress.toFixed(3)}%`;
    }
    if (refs.timeLabel) {
      refs.timeLabel.textContent = `${formatPlaybackTime(playback.currentTime)} / ${formatPlaybackTime(playback.duration)}`;
    }
    if (refs.status) {
      refs.status.textContent = playback.loading
        ? t("detail.trailerLoading", {}, "Loading trailer...")
        : playback.controllable
          ? ""
          : t("detail.trailerFallbackHint", {}, "Use back to close the trailer");
    }
    if (playback.loading || playback.paused) {
      this.stopTrailerControlsTimer();
      this.setTrailerControlsVisible(true);
      return;
    }
    if (this.trailerControlsVisible && !this.trailerControlsTimer) {
      this.restartTrailerControlsTimer();
    }
  },

  bindTrailerVideoEvents(video) {
    if (!video) {
      return;
    }
    this.detachTrailerMediaListeners();
    const sync = () => {
      this.applyTrailerVideoSubtitleState(video);
      this.updateTrailerOverlay();
    };
    const markReady = () => {
      if (!this.isTrailerPlaying || video.paused || !video.isConnected) {
        return;
      }
      this.markTrailerVisualReady();
      this.updateTrailerOverlay();
    };
    const handleEnded = () => {
      if (this.isTrailerPlaying) {
        this.stopTrailerPlayback();
      }
    };
    const handleError = () => {
      if (this.isTrailerPlaying && !this.trailerVisualReady) {
        this.stopTrailerPlayback();
      }
    };
    const eventNames =
      this.trailerPlaybackMode === "manual"
        ? [
            "play",
            "pause",
            "timeupdate",
            "volumechange",
            "loadedmetadata",
            "durationchange",
            "waiting",
            "playing",
            "canplay"
          ]
        : [];
    this.trailerMediaListeners = eventNames.map((eventName) => {
      video.addEventListener(eventName, sync);
      return { target: video, eventName, handler: sync };
    });
    [
      ["playing", markReady],
      ["ended", handleEnded],
      ["error", handleError]
    ].forEach(([eventName, handler]) => {
      video.addEventListener(eventName, handler);
      this.trailerMediaListeners.push({ target: video, eventName, handler });
    });
  },

  markTrailerVisualReady() {
    if (!this.isTrailerPlaying || this.trailerVisualReady) {
      return;
    }
    this.stopTrailerFirstFramePolling();
    this.stopTrailerFallbackRevealTimer();
    this.trailerVisualReady = true;
    const shell = this.container?.querySelector(".series-detail-shell");
    if (!shell) {
      return;
    }
    const reveal = () => {
      if (!this.isTrailerPlaying || !this.trailerVisualReady || !shell.isConnected) {
        return;
      }
      shell.classList.add("detail-trailer-ready");
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(reveal));
    } else {
      setTimeout(reveal, 32);
    }
  },

  destroyYoutubeTrailerPlayer() {
    this.stopTrailerProxyLoadingTimer();
    this.stopTrailerFirstFramePolling();
    this.stopTrailerFallbackRevealTimer();
    this.trailerProxyState = null;
    this.trailerYoutubeFallbackActive = false;
  },

  async initYoutubeTrailerPlayer() {
    const ytId = String(this.trailerSource?.ytId || "").trim();
    if (
      !ytId ||
      !this.trailerUiRefs?.frame ||
      !this.isTrailerPlaying ||
      this.trailerSource?.kind !== "youtube"
    ) {
      return;
    }
    this.destroyYoutubeTrailerPlayer();
    this.trailerProxyState = {
      currentTime: 0,
      duration: 0,
      paused: false,
      muted: Boolean(this.trailerMuted),
      captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
      loading: true,
      controllable: true
    };
    this.trailerYoutubeFallbackActive = false;
    this.startTrailerProxyLoadingTimer(ytId);
    this.updateTrailerOverlay();
  },

  toggleActiveTrailerPlayback() {
    if (!this.isTrailerPlaying || !this.trailerSource || this.trailerPlaybackMode !== "manual") {
      return;
    }
    this.restartTrailerControlsTimer();
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (!video) {
        return;
      }
      if (video.paused) {
        const playAttempt = video.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch(() => {});
        }
      } else {
        video.pause?.();
      }
      this.updateTrailerOverlay();
      return;
    }
    if (!this.trailerProxyState || this.trailerYoutubeFallbackActive) {
      return;
    }
    if (this.trailerProxyState.paused) {
      this.postTrailerProxyCommand("play");
    } else {
      this.postTrailerProxyCommand("pause");
    }
    this.updateTrailerOverlay();
  },

  applyTrailerVideoSubtitleState(video = null) {
    const target = video || this.trailerUiRefs?.video || null;
    if (!target) {
      return;
    }
    const tracks = target.textTracks || target.webkitTextTracks || target.mozTextTracks || null;
    if (!tracks) {
      return;
    }
    const enabled = Boolean(this.trailerSubtitlesEnabled);
    Array.from(tracks).forEach((track) => {
      try {
        track.mode = enabled ? "showing" : "disabled";
      } catch (_) {}
    });
  },

  seekTrailerBy(deltaSeconds) {
    const delta = Number(deltaSeconds || 0);
    if (
      !delta ||
      !this.isTrailerPlaying ||
      !this.trailerSource ||
      this.trailerPlaybackMode !== "manual"
    ) {
      return;
    }
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (!video) {
        return;
      }
      const duration = Number.isFinite(video.duration) ? Number(video.duration) : 0;
      if (duration <= 0) {
        return;
      }
      video.currentTime = Math.max(0, Math.min(duration, Number(video.currentTime || 0) + delta));
      this.updateTrailerOverlay();
      return;
    }
    if (!this.trailerProxyState || this.trailerYoutubeFallbackActive) {
      return;
    }
    const duration = Number(this.trailerProxyState.duration || 0);
    if (duration <= 0) {
      return;
    }
    const currentTime = Number(this.trailerProxyState.currentTime || 0);
    const target = Math.max(0, Math.min(duration, currentTime + delta));
    this.postTrailerProxyCommand("seekTo", { seconds: target });
    this.updateTrailerOverlay();
  },

  setActiveTrailerPausedState(paused) {
    if (!this.isTrailerPlaying || !this.trailerSource || this.trailerPlaybackMode !== "manual") {
      return;
    }
    const shouldPause = Boolean(paused);
    const playback = this.getTrailerPlaybackSnapshot();
    if (Boolean(playback.paused) === shouldPause) {
      this.restartTrailerControlsTimer();
      this.updateTrailerOverlay();
      return;
    }
    this.toggleActiveTrailerPlayback();
  },

  syncTrailerDom() {
    const shell = this.container?.querySelector(".series-detail-shell");
    const layer = this.container?.querySelector(".detail-trailer-layer");
    if (!shell || !layer) {
      return;
    }
    shell.classList.toggle("detail-trailer-active", Boolean(this.isTrailerPlaying));
    shell.classList.toggle(
      "detail-trailer-autoplay",
      this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay"
    );
    shell.classList.toggle(
      "detail-trailer-manual",
      this.isTrailerPlaying && this.trailerPlaybackMode === "manual"
    );
    shell.classList.toggle(
      "detail-trailer-ready",
      this.isTrailerPlaying && this.trailerVisualReady
    );
    if (!this.isTrailerPlaying || !this.trailerSource) {
      this.stopTrailerProgressTimer();
      this.detachTrailerMediaListeners();
      this.destroyYoutubeTrailerPlayer();
      this.trailerUiRefs = null;
      layer.innerHTML = "";
      return;
    }
    const title = escapeHtml(
      this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Trailer"
    );
    this.trailerDomGeneration = Number(this.trailerDomGeneration || 0) + 1;
    const trailerHint = escapeHtml(t("hero_press_back_trailer", {}, "Press back to exit trailer"));
    const controlsMarkup =
      this.trailerPlaybackMode === "manual"
        ? `
      <div class="detail-trailer-controls-overlay" tabindex="-1">
        <div class="detail-trailer-controls-gradient detail-trailer-controls-gradient-top"></div>
        <div class="detail-trailer-controls-gradient detail-trailer-controls-gradient-bottom"></div>
        <div class="detail-trailer-controls-top">
          <div class="detail-trailer-meta">
            <div class="detail-trailer-title">${title}</div>
            <div class="detail-trailer-subtitle">${trailerHint}</div>
          </div>
          <div class="detail-trailer-status" data-trailer-status aria-live="polite"></div>
        </div>
        <div class="detail-trailer-controls-bottom">
          <div class="detail-trailer-progress">
            <div class="detail-trailer-progress-track">
              <div class="detail-trailer-progress-fill" data-trailer-progress-fill></div>
            </div>
          </div>
          <div class="detail-trailer-controls-row">
            <div class="detail-trailer-time" data-trailer-time-label>0:00 / 0:00</div>
          </div>
        </div>
      </div>
    `
        : "";
    if (this.trailerSource.kind === "youtube") {
      const youtubeFrameUrl =
        buildInlineYoutubePlayerUrl(this.trailerSource.ytId, {
          muted: this.trailerMuted,
          loop: false,
          statePollMs: this.trailerPlaybackMode === "manual" ? 500 : 0
        }) ||
        this.trailerSource.embedUrl ||
        "";
      layer.innerHTML = `
        <div class="detail-trailer-media detail-trailer-youtube" data-trailer-media>
          <iframe
            class="detail-trailer-frame"
            src="${youtubeFrameUrl}"
            title="Trailer"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerpolicy="origin-when-cross-origin"
            allowfullscreen
            scrolling="no"
            tabindex="-1"
            aria-hidden="true"
          ></iframe>
        </div>
        ${controlsMarkup}
      `;
      this.cacheTrailerRefs();
      if (this.trailerPlaybackMode === "manual") {
        this.trailerUiRefs?.overlay?.focus?.({ preventScroll: true });
        this.startTrailerProgressTimer();
      }
      this.initYoutubeTrailerPlayer();
      return;
    }
    layer.innerHTML = `
      <div class="detail-trailer-media" data-trailer-media>
        <video class="detail-trailer-video" autoplay playsinline preload="auto"${this.trailerMuted ? " muted" : ""}>
          <source src="${this.trailerSource.url}" />
        </video>
      </div>
      ${controlsMarkup}
    `;
    this.cacheTrailerRefs();
    if (this.trailerPlaybackMode === "manual") {
      this.trailerUiRefs?.overlay?.focus?.({ preventScroll: true });
    }
    this.applyTrailerVideoSubtitleState(this.trailerUiRefs?.video || null);
    this.bindTrailerVideoEvents(this.trailerUiRefs?.video || null);
    const playAttempt = this.trailerUiRefs?.video?.play?.();
    if (playAttempt?.catch) {
      playAttempt.catch(() => {});
    }
    if (this.trailerPlaybackMode === "manual") {
      this.startTrailerProgressTimer();
    }
  },

  async playTrailer({
    muted = null,
    restart = false,
    initiatedByUser = true,
    preserveSource = false
  } = {}) {
    const requestedFocusRestore = initiatedByUser ? this.captureDetailFocus() : null;
    // Android TV starts the already-resolved hero trailer immediately when the
    // button is pressed. Only resolve here when no prepared source exists.
    if (!preserveSource && !this.trailerSource) {
      const preferredSource = await this.resolvePreferredTrailerSource(this.meta);
      if (preferredSource) {
        this.trailerSource = preferredSource;
      }
    }
    if (!this.trailerSource) {
      return;
    }
    if (muted != null) {
      this.trailerMuted = Boolean(muted);
    } else if (!this.isTrailerPlaying && initiatedByUser) {
      this.trailerMuted = false;
    }
    if (this.isTrailerPlaying && !restart) {
      if (this.trailerPlaybackMode === "manual") {
        this.toggleActiveTrailerPlayback();
      }
      return;
    }
    this.stopTrailerPlayback({
      keepDom: false,
      restartAutoplay: false,
      restoreFocus: false
    });
    this.trailerSubtitlesEnabled = false;
    this.trailerPlaybackMode = initiatedByUser ? "manual" : "autoplay";
    this.trailerFocusRestore =
      initiatedByUser && requestedFocusRestore?.selector?.includes(".series-detail-actions")
        ? { selector: '.series-detail-actions [data-action="playDefault"]' }
        : requestedFocusRestore;
    this.trailerVisualReady = false;
    if (!initiatedByUser) {
      this.trailerHasAutoplayed = true;
    }
    this.isTrailerPlaying = true;
    this.syncTrailerDom();
    if (this.trailerPlaybackMode === "manual") {
      this.stopTrailerControlsTimer();
      this.setTrailerControlsVisible(false);
    }
  },

  openTrailerInPlayer() {
    this.playTrailer({ restart: true, initiatedByUser: true });
  },

  stopTrailerPlayback({
    keepDom = false,
    restartAutoplay = true,
    restoreFocus = true,
    immediateClear = false
  } = {}) {
    if (this.trailerAutoplayTimer) {
      clearTimeout(this.trailerAutoplayTimer);
      this.trailerAutoplayTimer = null;
    }
    const layer = this.container?.querySelector(".detail-trailer-layer") || null;
    const wasVisualReady = Boolean(this.trailerVisualReady);
    const cleanupGeneration = Number(this.trailerDomGeneration || 0) + 1;
    this.trailerDomGeneration = cleanupGeneration;
    const hardStopLayerMedia = () => {
      if (!layer) {
        return;
      }
      const activeFrame = layer.querySelector("iframe");
      if (activeFrame) {
        try {
          activeFrame.src = "about:blank";
        } catch (_) {}
        try {
          activeFrame.removeAttribute("src");
        } catch (_) {}
      }
      const activeVideo = layer.querySelector("video");
      if (activeVideo) {
        try {
          activeVideo.pause?.();
        } catch (_) {}
        try {
          activeVideo.removeAttribute("src");
          activeVideo.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
          activeVideo.load?.();
        } catch (_) {}
      }
    };
    if (this.trailerSource?.kind === "youtube") {
      this.postTrailerProxyCommand("pause");
    } else {
      try {
        this.trailerUiRefs?.video?.pause?.();
      } catch (_) {}
    }
    if (immediateClear) {
      hardStopLayerMedia();
    }
    this.stopTrailerProgressTimer();
    this.stopTrailerControlsTimer();
    this.stopTrailerProxyLoadingTimer();
    this.detachTrailerMediaListeners();
    this.destroyYoutubeTrailerPlayer();
    const previousMode = this.trailerPlaybackMode;
    const focusRestore = this.trailerFocusRestore;
    this.isTrailerPlaying = false;
    this.trailerPlaybackMode = null;
    this.trailerVisualReady = false;
    this.trailerSubtitlesEnabled = false;
    this.trailerFocusRestore = null;
    const clearLayer = () => {
      if (
        !layer ||
        Number(this.trailerDomGeneration || 0) !== cleanupGeneration ||
        this.isTrailerPlaying
      ) {
        return;
      }
      if (layer) {
        hardStopLayerMedia();
        layer.innerHTML = "";
      }
    };
    this.trailerUiRefs = null;
    this.trailerControlsVisible = true;
    const shell = this.container?.querySelector(".series-detail-shell");
    if (shell) {
      shell.classList.remove(
        "detail-trailer-active",
        "detail-trailer-autoplay",
        "detail-trailer-manual",
        "detail-trailer-ready"
      );
    }
    if (!keepDom) {
      if (wasVisualReady) {
        setTimeout(clearLayer, 620);
      } else {
        clearLayer();
      }
    }
    if (restoreFocus && previousMode === "manual") {
      const restore = () => {
        this.focusDetailDescriptor(
          focusRestore || {
            selector: '.series-detail-actions [data-action="playDefault"]'
          }
        );
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(restore);
      } else {
        setTimeout(restore, 0);
      }
    }
    if (restartAutoplay) {
      this.restartTrailerAutoplayTimer();
    }
  },

  stopTrailerPlaybackForNavigation() {
    this.stopTrailerPlayback({
      keepDom: false,
      restartAutoplay: false,
      restoreFocus: false,
      immediateClear: true
    });
  },

  async openEpisodeStreamChooser(videoId, options = {}) {
    if (!videoId || !this.meta) {
      return;
    }
    this.stopTrailerPlaybackForNavigation();
    const episode = this.episodes.find((entry) => entry.id === videoId) || null;
    if (!episode) {
      return;
    }
    const progress = this.getEpisodeMenuProgress(episode);
    this.navigateToStreamScreenForEpisode(episode, {
      ...this.getResumeParamsForProgress(progress, {
        ...options,
        useActiveFallback: false
      }),
      ...(options.manualSelection ? { manualSelection: true } : {})
    });
  },

  async openMovieStreamChooser(options = {}) {
    this.stopTrailerPlaybackForNavigation();
    this.navigateToStreamScreenForMovie({
      ...this.getResumeParamsForProgress(this.getActiveResumeProgress(), options),
      ...(options.manualSelection ? { manualSelection: true } : {})
    });
  },

  getActivePendingSelection() {
    return this.pendingEpisodeSelection || this.pendingMovieSelection || null;
  },

  getFilteredEpisodeStreams() {
    const pending = this.getActivePendingSelection();
    if (!pending || !pending.streams.length) {
      return [];
    }
    if (pending.addonFilter === "all") {
      return pending.streams;
    }
    return pending.streams.filter((stream) => stream.addonName === pending.addonFilter);
  },

  renderEpisodeStreamChooser() {
    const mount = this.container.querySelector("#episodeStreamChooserMount");
    if (!mount) {
      return;
    }
    const pending = this.pendingEpisodeSelection;
    if (!pending) {
      mount.innerHTML = "";
      return;
    }

    const addons = Array.from(
      new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean))
    );
    const filtered = this.getFilteredEpisodeStreams();
    const filterTabs = [
      `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
      ...addons.map(
        (addon) => `
        <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
          ${addon}
        </button>
      `
      )
    ].join("");

    const streamCards = filtered.length
      ? filtered
          .map(
            (stream) => `
          <article class="series-stream-card focusable"
                   data-action="playEpisodeStream"
                   data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              ${renderStreamAddonIcon(stream.addonName)}
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${
                String(stream.sourceType || "")
                  .toLowerCase()
                  .includes("torrent")
                  ? "Torrent"
                  : "Stream"
              }</span>
            </div>
          </article>
        `
          )
          .join("")
      : pending.loading
        ? `
          <div class="series-stream-empty series-stream-loading">
            ${renderLoadingIndicator()}
            <span>Loading streams...</span>
          </div>
        `
        : `<div class="series-stream-empty">No streams found for this filter.</div>`;

    mount.innerHTML = `
      <div class="series-stream-overlay">
        <div class="series-stream-overlay-backdrop"></div>
        <div class="series-stream-panel">
          <div class="series-stream-left">
            ${this.meta?.logo ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${this.meta?.name || "Series"}</div>`}
            <div class="series-stream-episode">${pending.episode ? `S${pending.episode.season} E${pending.episode.episode}` : ""}</div>
            <div class="series-stream-episode-title">${pending.episode?.title || ""}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.applyStreamChooserFocus();
  },

  renderMovieStreamChooser() {
    const mount = this.container.querySelector("#movieStreamChooserMount");
    if (!mount) {
      return;
    }
    const pending = this.pendingMovieSelection;
    if (!pending) {
      mount.innerHTML = "";
      return;
    }

    const addons = Array.from(
      new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean))
    );
    const filtered = this.getFilteredEpisodeStreams();
    const filterTabs = [
      `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
      ...addons.map(
        (addon) => `
        <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
          ${addon}
        </button>
      `
      )
    ].join("");

    const streamCards = filtered.length
      ? filtered
          .map(
            (stream) => `
          <article class="series-stream-card focusable"
                   data-action="playPendingStream"
                   data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              ${renderStreamAddonIcon(stream.addonName)}
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${
                String(stream.sourceType || "")
                  .toLowerCase()
                  .includes("torrent")
                  ? "Torrent"
                  : "Stream"
              }</span>
            </div>
          </article>
        `
          )
          .join("")
      : pending.loading
        ? `
          <div class="series-stream-empty series-stream-loading">
            ${renderLoadingIndicator()}
            <span>Loading streams...</span>
          </div>
        `
        : `<div class="series-stream-empty">No streams found for this filter.</div>`;

    mount.innerHTML = `
      <div class="series-stream-overlay">
        <div class="series-stream-overlay-backdrop"></div>
        <div class="series-stream-panel">
          <div class="series-stream-left">
            ${this.meta?.logo ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${this.meta?.name || "Movie"}</div>`}
            <div class="series-stream-episode">${this.meta?.name || ""}</div>
            <div class="series-stream-episode-title">${Array.isArray(this.meta?.genres) ? this.meta.genres.slice(0, 3).join(" • ") : ""}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.applyStreamChooserFocus();
  },

  closeEpisodeStreamChooser() {
    this.streamChooserLoadToken = (this.streamChooserLoadToken || 0) + 1;
    this.pendingEpisodeSelection = null;
    this.pendingMovieSelection = null;
    this.streamChooserFocus = null;
    this.render(this.meta);
  },

  consumeBackRequest() {
    if (this.seasonHoldMenu) {
      this.closeSeasonHoldMenu();
      return true;
    }
    if (this.episodeHoldMenu) {
      this.closeEpisodeHoldMenu();
      return true;
    }
    if (this.posterOptionsController?.dialog) {
      this.closePosterOptionsMenu();
      return true;
    }
    if (this.heroPlayMenu || this.libraryListMenu) {
      this.closeHeroMenus();
      return true;
    }
    if (this.isTrailerPlaying) {
      this.stopTrailerPlayback();
      return true;
    }
    if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
      this.closeEpisodeStreamChooser();
      return true;
    }
    if (this.navigateBackFromDetail()) {
      return true;
    }
    if (this.isLoadingDetail) {
      void Router.backFromPendingNavigation();
      return true;
    }
    return false;
  },

  playEpisodeFromSelectedStream(streamId) {
    const pending = this.pendingEpisodeSelection;
    if (!pending) {
      return;
    }
    const selectedStream =
      pending.streams.find((stream) => stream.id === streamId) ||
      this.getFilteredEpisodeStreams()[0];
    if (!selectedStream?.url) {
      return;
    }
    const nextEpisode = this.getNextEpisodeAfter(pending.episode);
    const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    const tmdbId = resolveMetaTmdbId(this.meta, this.params);
    const traktId = resolveMetaTraktId(this.meta, this.params);
    const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
    const resumeParams = this.getResumeParamsForProgress(
      this.getEpisodeMenuProgress(pending.episode),
      { useActiveFallback: false }
    );
    this.stopTrailerPlaybackForNavigation();
    Router.navigate("player", {
      streamUrl: selectedStream.url,
      itemId: this.params?.itemId,
      itemType,
      imdbId,
      tmdbId,
      traktId,
      contentLanguage,
      returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
      videoId: pending.videoId,
      season: pending.episode?.season ?? null,
      episode: pending.episode?.episode ?? null,
      episodeLabel: pending.episode
        ? `S${pending.episode.season}E${pending.episode.episode}`
        : null,
      playerTitle:
        this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      playerReleaseYear: String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
      playerSubtitle: pending.episode
        ? `S${pending.episode.season}E${pending.episode.episode} - ${pending.episode.title || ""}`.replace(
            /\s+-\s*$/,
            ""
          )
        : "",
      playerEpisodeTitle: pending.episode?.title || "",
      playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
      playerLogoUrl: this.meta?.logo || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      episodes: this.episodes || [],
      streamCandidates: pending.streams || [],
      preferredStreamId: selectedStream.id || null,
      playbackSourceContext: selectedStream.streamOrigin || {
        addonId: selectedStream.addonId || "",
        addonBaseUrl: selectedStream.addonBaseUrl || "",
        addonName: selectedStream.addonName || "",
        addonOrderIndex: Number.isFinite(Number(selectedStream.addonOrderIndex))
          ? Number(selectedStream.addonOrderIndex)
          : null,
        sourceProviderId: selectedStream.sourceProviderId || "",
        sourceIds: Array.isArray(selectedStream.sources) ? selectedStream.sources : [],
        selectedStreamId: selectedStream.id || ""
      },
      fromDetailRoute: true,
      ...resumeParams,
      nextEpisodeVideoId: nextEpisode?.id || null,
      nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
      nextEpisodeSeason: nextEpisode?.season ?? null,
      nextEpisodeEpisode: nextEpisode?.episode ?? null,
      nextEpisodeTitle: nextEpisode?.title || "",
      nextEpisodeReleased: nextEpisode?.released || ""
    });
  },

  navigateToStreamScreenForEpisode(episode, extraParams = {}) {
    if (!episode?.id) {
      return;
    }
    const nextEpisode = this.getNextEpisodeAfter(episode);
    const streamBackdrop =
      this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
    const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    const tmdbId = resolveMetaTmdbId(this.meta, this.params);
    const traktId = resolveMetaTraktId(this.meta, this.params);
    const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
    const releaseYear = String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const resumeVideoId = String(this.params?.resumeVideoId || "").trim();
    const isContinueWatchingTarget = Boolean(
      this.params?.fromContinueWatching &&
      (resumeVideoId
        ? resumeVideoId === String(episode.id || "")
        : Number(this.params?.resumeSeason || 0) === Number(episode.season || 0) &&
          Number(this.params?.resumeEpisode || 0) === Number(episode.episode || 0))
    );
    this.stopTrailerPlaybackForNavigation();
    Router.navigate(
      "stream",
      {
        itemId: this.params?.itemId || null,
        itemType,
        imdbId,
        tmdbId,
        traktId,
        contentLanguage,
        originalItemId: this.params?.originalItemId || null,
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        returnToDetail: true,
        fromDetailRoute: true,
        itemTitle:
          this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        year: releaseYear,
        backdrop: streamBackdrop,
        poster: this.meta?.poster || null,
        logo: this.meta?.logo || null,
        runtime: episode.runtimeMinutes || null,
        parentalWarnings: this.meta?.parentalWarnings || null,
        parentalGuide: this.meta?.parentalGuide || null,
        videoId: episode.id,
        preferredStreamId: StreamPreferencesStore.get(this.params?.itemId, episode.id) || null,
        season: episode.season,
        episode: episode.episode,
        episodeTitle: episode.title || "",
        episodes: this.episodes || [],
        nextEpisodeVideoId: nextEpisode?.id || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
        nextEpisodeSeason: nextEpisode?.season ?? null,
        nextEpisodeEpisode: nextEpisode?.episode ?? null,
        nextEpisodeTitle: nextEpisode?.title || "",
        nextEpisodeReleased: nextEpisode?.released || "",
        continueWatchingBackHome: isContinueWatchingTarget,
        resumeStreamIdentity: isContinueWatchingTarget
          ? this.params?.resumeStreamIdentity || null
          : null,
        ...extraParams
      },
      this.getStreamNavigationOptions()
    );
  },

  navigateToStreamScreenForMovie(extraParams = {}) {
    const releaseYear = String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const streamBackdrop =
      this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
    const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
    const { itemId, videoId } = resolveMovieStreamIdentity(this.meta, this.params);
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    const tmdbId = resolveMetaTmdbId(this.meta, this.params);
    const traktId = resolveMetaTraktId(this.meta, this.params);
    const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
    this.stopTrailerPlaybackForNavigation();
    Router.navigate(
      "stream",
      {
        itemId,
        itemType,
        imdbId,
        tmdbId,
        traktId,
        contentLanguage,
        originalItemId: this.params?.originalItemId || null,
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        returnToDetail: true,
        fromDetailRoute: true,
        itemTitle:
          this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        itemSubtitle: "",
        genres: Array.isArray(this.meta?.genres) ? this.meta.genres.slice(0, 3).join(" • ") : "",
        year: releaseYear,
        backdrop: streamBackdrop,
        poster: this.meta?.poster || null,
        logo: this.meta?.logo || null,
        parentalWarnings: this.meta?.parentalWarnings || null,
        parentalGuide: this.meta?.parentalGuide || null,
        videoId,
        preferredStreamId: StreamPreferencesStore.get(itemId, videoId) || null,
        episodes: [],
        ...extraParams
      },
      this.getStreamNavigationOptions()
    );
  },

  playMovieFromSelectedStream(streamId) {
    const pending = this.pendingMovieSelection;
    if (!pending) {
      return;
    }
    const selectedStream =
      pending.streams.find((stream) => stream.id === streamId) ||
      this.getFilteredEpisodeStreams()[0];
    if (!selectedStream?.url) {
      return;
    }
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    const tmdbId = resolveMetaTmdbId(this.meta, this.params);
    const traktId = resolveMetaTraktId(this.meta, this.params);
    const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
    const resumeParams = this.getResumeParamsForProgress(this.getActiveResumeProgress());
    this.stopTrailerPlaybackForNavigation();
    Router.navigate("player", {
      streamUrl: selectedStream.url,
      itemId: this.params?.itemId,
      itemType: this.params?.itemType || "movie",
      imdbId,
      tmdbId,
      traktId,
      contentLanguage,
      returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
      season: null,
      episode: null,
      playerTitle:
        this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      playerSubtitle: "",
      playerReleaseYear: String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
      playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
      playerLogoUrl: this.meta?.logo || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      episodes: [],
      streamCandidates: pending.streams || [],
      preferredStreamId: selectedStream.id || null,
      playbackSourceContext: selectedStream.streamOrigin || {
        addonId: selectedStream.addonId || "",
        addonBaseUrl: selectedStream.addonBaseUrl || "",
        addonName: selectedStream.addonName || "",
        addonOrderIndex: Number.isFinite(Number(selectedStream.addonOrderIndex))
          ? Number(selectedStream.addonOrderIndex)
          : null,
        sourceProviderId: selectedStream.sourceProviderId || "",
        sourceIds: Array.isArray(selectedStream.sources) ? selectedStream.sources : [],
        selectedStreamId: selectedStream.id || ""
      },
      fromDetailRoute: true,
      ...resumeParams
    });
  },

  renderError(message) {
    this.isLoadingDetail = false;
    this.container.innerHTML = `
      <div class="row">
        <h2>Detail</h2>
        <p>${message}</p>
        <div class="card focusable" data-action="goBack">Back</div>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  getDetailContentScroller() {
    return this.container?.querySelector(".series-detail-content") || null;
  },

  getDetailFocusGroup(node) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    return (
      node.closest(
        ".series-detail-actions, .series-season-row, .series-episode-track, .series-insight-tabs, .detail-comments-modes, .detail-comments-track, .movie-cast-track, .series-cast-track, .series-rating-seasons, .series-episode-ratings-grid, .detail-morelike-track, .detail-company-track"
      ) || node
    );
  },

  getHorizontalTrackScrollLeft(horizontalTrack, target) {
    if (!(horizontalTrack instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      return 0;
    }
    const maxScrollLeft = Math.max(0, horizontalTrack.scrollWidth - horizontalTrack.clientWidth);
    if (horizontalTrack.classList.contains("series-episode-track")) {
      const styles = globalThis.getComputedStyle
        ? globalThis.getComputedStyle(horizontalTrack)
        : null;
      const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
      return Math.max(0, Math.min(maxScrollLeft, target.offsetLeft - leftPad));
    }
    if (
      horizontalTrack.classList.contains("detail-morelike-track") ||
      horizontalTrack.classList.contains("detail-comments-track")
    ) {
      const styles = globalThis.getComputedStyle
        ? globalThis.getComputedStyle(horizontalTrack)
        : null;
      const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
      return Math.max(0, Math.min(maxScrollLeft, target.offsetLeft - leftPad));
    }

    const edgePadding = horizontalTrack.classList.contains("home-track") ? 0 : 24;
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const viewLeft = horizontalTrack.scrollLeft;
    const viewRight = viewLeft + horizontalTrack.clientWidth;
    if (targetRight > viewRight - edgePadding) {
      return Math.max(
        0,
        Math.min(maxScrollLeft, targetRight - horizontalTrack.clientWidth + edgePadding)
      );
    }
    if (targetLeft < viewLeft + edgePadding) {
      return Math.max(0, Math.min(maxScrollLeft, targetLeft - edgePadding));
    }
    return viewLeft;
  },

  syncDetailScrollBounds(target) {
    const detailContent = this.getDetailContentScroller();
    if (!detailContent || !(target instanceof HTMLElement) || !detailContent.contains(target)) {
      return;
    }
    const focusables = Array.from(detailContent.querySelectorAll(".focusable")).filter(
      (node) => node instanceof HTMLElement
    );
    if (!focusables.length) {
      return;
    }
    const targetGroup = this.getDetailFocusGroup(target);
    const firstGroup = this.getDetailFocusGroup(focusables[0]);
    const lastGroup = this.getDetailFocusGroup(focusables[focusables.length - 1]);
    if (targetGroup && firstGroup && targetGroup === firstGroup) {
      detailContent.scrollTop = 0;
      return;
    }
    if (targetGroup && lastGroup && targetGroup === lastGroup) {
      detailContent.scrollTop = Math.max(
        0,
        detailContent.scrollHeight - detailContent.clientHeight
      );
    }
  },

  getRememberedEpisodeIndex(episodes = []) {
    const seasonEpisodes = this.getSelectedSeasonEpisodes();
    const total =
      Array.isArray(episodes) && episodes.length
        ? Math.max(episodes.length, seasonEpisodes.length)
        : seasonEpisodes.length;
    if (!total) {
      return 0;
    }
    const seasonKey = String(Number(this.selectedSeason || 0) || 0);
    const remembered = Number(this.episodeFocusIndexBySeason?.[seasonKey]);
    if (Number.isFinite(remembered) && remembered >= 0) {
      return Math.min(total - 1, remembered);
    }
    return 0;
  },

  getSelectedSeasonIndex(seasons = []) {
    if (!Array.isArray(seasons) || !seasons.length) {
      return 0;
    }
    const selectedIndex = seasons.findIndex(
      (node) => Number(node?.dataset?.season || 0) === Number(this.selectedSeason || 0)
    );
    return selectedIndex >= 0 ? selectedIndex : 0;
  },

  getActiveInsightTabKey() {
    return isSeriesDetailMeta(this.meta, this.episodes)
      ? String(this.seriesInsightTab || "cast")
      : String(this.movieInsightTab || "cast");
  },

  getActiveInsightTabIndex(tabs = [], fallbackIndex = 0) {
    if (!Array.isArray(tabs) || !tabs.length) {
      return 0;
    }
    const activeTabKey = this.getActiveInsightTabKey();
    const activeTabIndex = tabs.findIndex(
      (node) => String(node?.dataset?.tab || "") === activeTabKey
    );
    if (activeTabIndex >= 0) {
      return activeTabIndex;
    }
    const selectedTabIndex = tabs.findIndex((node) => node?.classList?.contains("selected"));
    if (selectedTabIndex >= 0) {
      return selectedTabIndex;
    }
    return Math.max(0, Math.min(tabs.length - 1, Number(fallbackIndex) || 0));
  },

  rememberEpisodeFocus(target, list = null) {
    if (!(target instanceof HTMLElement) || !target.matches(".series-episode-card")) {
      return;
    }
    const seasonKey = String(Number(this.selectedSeason || 0) || 0);
    const absoluteIndex = Number(target.dataset.episodeIndex || -1);
    if (Number.isFinite(absoluteIndex) && absoluteIndex >= 0) {
      this.episodeFocusIndexBySeason[seasonKey] = absoluteIndex;
      return;
    }
    const items =
      Array.isArray(list) && list.length
        ? list
        : Array.from(
            this.container?.querySelectorAll(
              ".series-episode-track .series-episode-card.focusable"
            ) || []
          );
    const index = items.indexOf(target);
    if (index >= 0) {
      this.episodeFocusIndexBySeason[seasonKey] = index;
    }
  },

  getRememberedRailIndex(railKey, items = []) {
    if (!railKey || !Array.isArray(items) || !items.length) {
      return 0;
    }
    const remembered = Number(this.railFocusIndexByKey?.[railKey]);
    if (Number.isFinite(remembered) && remembered >= 0) {
      return Math.min(items.length - 1, remembered);
    }
    return 0;
  },

  getRememberedCompanyIndex(companyTracks = [], companyCards = [], trackIndex = 0) {
    const cards = Array.isArray(companyCards?.[trackIndex]) ? companyCards[trackIndex] : [];
    if (!cards.length) {
      return 0;
    }
    const railKey = String(companyTracks?.[trackIndex]?.dataset?.scrollKey || "").trim();
    if (!railKey) {
      return 0;
    }
    return this.getRememberedRailIndex(railKey, cards);
  },

  rememberRailFocus(target, list = null) {
    if (
      !(target instanceof HTMLElement) ||
      !target.matches(".detail-morelike-card, .detail-company-card")
    ) {
      return;
    }
    const track = target.closest("[data-scroll-key]");
    const railKey = String(track?.dataset?.scrollKey || "").trim();
    if (!railKey) {
      return;
    }
    const itemSelector = target.matches(".detail-company-card")
      ? ".detail-company-card.focusable"
      : ".detail-morelike-card.focusable";
    const items =
      Array.isArray(list) && list.length ? list : Array.from(track.querySelectorAll(itemSelector));
    const index = items.indexOf(target);
    if (index >= 0) {
      this.railFocusIndexByKey[railKey] = index;
    }
  },

  getActivePreviewRailKey() {
    const kind = isSeriesDetailMeta(this.meta, this.episodes) ? "series" : "movie";
    const activeTab =
      kind === "series" ? String(this.seriesInsightTab || "") : String(this.movieInsightTab || "");
    return `${activeTab === "collection" ? "collection" : "morelike"}:${kind}`;
  },

  focusInList(list, targetIndex, options = {}) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    let preserveVerticalScroll = Boolean(options?.preserveVerticalScroll);
    const animated = options?.animated !== false;
    const index = Math.max(0, Math.min(list.length - 1, targetIndex));
    const target = list[index];
    if (!target) {
      return false;
    }
    const previous = this.container.querySelector(".focusable.focused");
    this.container
      .querySelectorAll(".focusable")
      .forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    target.focus({ preventScroll: true });
    this.rememberEpisodeFocus(target, list);
    this.rememberRailFocus(target, list);
    const horizontalTrack = target.closest(
      ".series-episode-track, .series-cast-track, .movie-cast-track, .home-track, .series-episode-ratings-grid, .series-rating-seasons, .detail-morelike-track, .detail-company-track, .series-season-row, .series-insight-tabs, .detail-comments-modes, .detail-comments-track"
    );
    if (horizontalTrack) {
      if (previous && previous !== target && horizontalTrack.contains(previous)) {
        preserveVerticalScroll = true;
      }
      const nextScrollLeft = this.getHorizontalTrackScrollLeft(horizontalTrack, target);
      if (animated) {
        this.animateScroll(horizontalTrack, "x", nextScrollLeft, 260);
      } else {
        horizontalTrack.scrollLeft = nextScrollLeft;
      }
      const detailContent = this.getDetailContentScroller();
      if (!preserveVerticalScroll && detailContent && detailContent.contains(horizontalTrack)) {
        const verticalTarget = horizontalTrack.matches(
          ".detail-comments-modes, .detail-comments-track"
        )
          ? target.closest(".detail-comments-section") || horizontalTrack
          : horizontalTrack;
        const rect = verticalTarget.getBoundingClientRect();
        const contentRect = detailContent.getBoundingClientRect();
        const focusTarget = horizontalTrack.matches(".series-insight-tabs")
          ? DETAIL_TAB_FOCUS_TARGET
          : DETAIL_ROW_FOCUS_TARGET;
        const targetTop = contentRect.top + detailContent.clientHeight * focusTarget;
        const nextScrollTop = detailContent.scrollTop + rect.top - targetTop;
        if (animated) {
          this.animateScroll(detailContent, "y", nextScrollTop, 280);
        } else {
          const maxScrollTop = Math.max(0, detailContent.scrollHeight - detailContent.clientHeight);
          detailContent.scrollTop = Math.max(0, Math.min(maxScrollTop, Math.round(nextScrollTop)));
        }
      }
    } else if (target.closest?.(".series-detail-actions")) {
      const detailContent = this.getDetailContentScroller();
      if (!preserveVerticalScroll && detailContent) {
        if (animated) {
          this.animateScroll(detailContent, "y", 0, 280);
        } else {
          detailContent.scrollTop = 0;
        }
      }
    } else if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (!preserveVerticalScroll) {
      this.syncDetailScrollBounds(target);
    }
    return true;
  },

  resolvePopupFocusNode() {
    let current = this.container.querySelector(".focusable.focused");
    if (current) {
      return current;
    }
    const active = document.activeElement;
    if (active && active.classList?.contains("focusable") && this.container.contains(active)) {
      active.classList.add("focused");
      return active;
    }
    const first = this.container.querySelector(
      ".series-stream-filter.focusable, .series-stream-card.focusable"
    );
    if (first) {
      this.container
        .querySelectorAll(".focusable")
        .forEach((node) => node.classList.remove("focused"));
      first.classList.add("focused");
      first.focus();
      return first;
    }
    return null;
  },

  getStreamChooserLists() {
    const filters = Array.from(this.container.querySelectorAll(".series-stream-filter.focusable"));
    const cards = Array.from(this.container.querySelectorAll(".series-stream-card.focusable"));
    const selectedFilterIndex = Math.max(
      0,
      filters.findIndex((node) => node.classList.contains("selected"))
    );
    return { filters, cards, selectedFilterIndex };
  },

  syncStreamChooserFocusFromDom() {
    const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
    const activeElement = document.activeElement;
    const focusedFilterIndex = filters.findIndex(
      (node) => node.classList.contains("focused") || node === activeElement
    );
    if (focusedFilterIndex >= 0) {
      this.streamChooserFocus = { zone: "filter", index: focusedFilterIndex };
      return this.streamChooserFocus;
    }
    const focusedCardIndex = cards.findIndex(
      (node) => node.classList.contains("focused") || node === activeElement
    );
    if (focusedCardIndex >= 0) {
      this.streamChooserFocus = { zone: "card", index: focusedCardIndex };
      return this.streamChooserFocus;
    }
    this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
    return this.streamChooserFocus;
  },

  applyStreamChooserFocus() {
    const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
    if (!filters.length && !cards.length) {
      this.streamChooserFocus = null;
      return false;
    }

    if (!this.streamChooserFocus) {
      this.syncStreamChooserFocusFromDom();
    }
    let zone = this.streamChooserFocus?.zone || "filter";
    let index = Number(this.streamChooserFocus?.index || 0);

    if (zone === "filter" && !filters.length && cards.length) {
      zone = "card";
      index = 0;
    } else if (zone === "card" && !cards.length && filters.length) {
      zone = "filter";
      index = selectedFilterIndex;
    }

    if (zone === "filter") {
      index = Math.max(0, Math.min(filters.length - 1, index));
      this.streamChooserFocus = { zone, index };
      return this.focusInList(filters, index);
    }

    index = Math.max(0, Math.min(cards.length - 1, index));
    this.streamChooserFocus = { zone: "card", index };
    return this.focusInList(cards, index);
  },

  handleStreamChooserDpad(event) {
    if (!this.pendingEpisodeSelection && !this.pendingMovieSelection) {
      return false;
    }
    const pending = this.getActivePendingSelection();
    if (pending?.loading && !pending?.streams?.length) {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
      return true;
    }
    const direction = getDpadDirection(event);
    if (!direction) {
      return false;
    }

    const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
    const hasValidLocalFocus =
      this.streamChooserFocus &&
      ((this.streamChooserFocus.zone === "filter" &&
        filters.length &&
        Number(this.streamChooserFocus.index) >= 0 &&
        Number(this.streamChooserFocus.index) < filters.length) ||
        (this.streamChooserFocus.zone === "card" &&
          cards.length &&
          Number(this.streamChooserFocus.index) >= 0 &&
          Number(this.streamChooserFocus.index) < cards.length));
    const focusState = hasValidLocalFocus
      ? this.streamChooserFocus
      : this.syncStreamChooserFocusFromDom();
    let zone = focusState?.zone || (filters.length ? "filter" : "card");
    let index = Number(focusState?.index || 0);
    if (zone === "filter" && !filters.length && cards.length) {
      zone = "card";
      index = Math.max(0, Math.min(cards.length - 1, index));
    } else if (zone === "card" && !cards.length && filters.length) {
      zone = "filter";
      index = selectedFilterIndex;
    }
    if (zone === "filter" && filters.length) {
      const focusedFilterIndex = filters.findIndex(
        (node) => node.classList.contains("focused") || node === document.activeElement
      );
      if (focusedFilterIndex >= 0) {
        index = focusedFilterIndex;
      }
    } else if (zone === "card" && cards.length) {
      const focusedCardIndex = cards.findIndex(
        (node) => node.classList.contains("focused") || node === document.activeElement
      );
      if (focusedCardIndex >= 0) {
        index = focusedCardIndex;
      }
    }

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    if (zone === "filter") {
      if (direction === "left") {
        this.streamChooserFocus = { zone, index: Math.max(0, index - 1) };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "right") {
        this.streamChooserFocus = { zone, index: Math.min(filters.length - 1, index + 1) };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "down" && cards.length) {
        this.streamChooserFocus = { zone: "card", index: 0 };
        return this.applyStreamChooserFocus() || true;
      }
      return true;
    }

    if (zone === "card") {
      if (direction === "up") {
        if (index > 0) {
          this.streamChooserFocus = { zone: "card", index: index - 1 };
          return this.applyStreamChooserFocus() || true;
        }
        if (filters.length) {
          this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
          return this.applyStreamChooserFocus() || true;
        }
        return true;
      }
      if (direction === "down") {
        this.streamChooserFocus = { zone: "card", index: Math.min(cards.length - 1, index + 1) };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "left" || direction === "right") {
        return true;
      }
      return true;
    }

    if (direction === "up" && filters.length) {
      this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
      return this.applyStreamChooserFocus() || true;
    }
    if (direction === "down" && cards.length) {
      this.streamChooserFocus = { zone: "card", index: 0 };
      return this.applyStreamChooserFocus() || true;
    }

    return true;
  },

  handleSeriesDpad(event) {
    if (
      !this.meta ||
      !isSeriesDetailMeta(this.meta, this.episodes) ||
      this.pendingEpisodeSelection ||
      this.pendingMovieSelection
    ) {
      return false;
    }
    const keyCode = Number(event?.keyCode || 0);
    const direction =
      keyCode === 37
        ? "left"
        : keyCode === 39
          ? "right"
          : keyCode === 38
            ? "up"
            : keyCode === 40
              ? "down"
              : null;
    if (!direction) {
      return false;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return false;
    }

    const actions = Array.from(
      this.container.querySelectorAll(".series-detail-actions .focusable")
    );
    const seasons = Array.from(
      this.container.querySelectorAll(".series-season-row .series-season-btn.focusable")
    );
    const episodes = Array.from(
      this.container.querySelectorAll(".series-episode-track .series-episode-card.focusable")
    );
    const insightTabs = Array.from(
      this.container.querySelectorAll(".series-insight-tabs .series-insight-tab.focusable")
    );
    const castCards = Array.from(
      this.container.querySelectorAll(".series-cast-track .series-cast-card.focusable")
    );
    const ratingSeasons = Array.from(
      this.container.querySelectorAll(".series-rating-seasons .series-rating-season.focusable")
    );
    const ratingChips = Array.from(
      this.container.querySelectorAll(
        ".series-episode-ratings-grid .series-episode-rating-chip.focusable"
      )
    );
    const moreLikeCards = Array.from(
      this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable")
    );
    const commentModes = Array.from(
      this.container.querySelectorAll(".detail-comments-modes .detail-comments-mode.focusable")
    );
    const commentCards = Array.from(
      this.container.querySelectorAll(".detail-comments-track .detail-comment-card.focusable")
    );
    const moreLikeRememberedIndex = this.getRememberedRailIndex(
      this.getActivePreviewRailKey(),
      moreLikeCards
    );
    const companyTracks = Array.from(this.container.querySelectorAll(".detail-company-track"));
    const companyCards = companyTracks.map((track) =>
      Array.from(track.querySelectorAll(".detail-company-card.focusable"))
    );
    const rememberedCompanyIndex = (trackIndex = 0) =>
      this.getRememberedCompanyIndex(companyTracks, companyCards, trackIndex);
    const focusCommentsEntry = (index = 0, options = {}) => {
      if (commentModes.length) {
        return this.focusInList(commentModes, Math.min(index, commentModes.length - 1), options);
      }
      if (commentCards.length) {
        return this.focusInList(commentCards, Math.min(index, commentCards.length - 1), options);
      }
      return false;
    };
    const focusActiveSectionFromComments = (index = 0) => {
      if (this.seriesInsightTab === "ratings") {
        if (ratingChips.length)
          return this.focusInList(ratingChips, Math.min(index, ratingChips.length - 1));
        if (ratingSeasons.length)
          return this.focusInList(ratingSeasons, Math.min(index, ratingSeasons.length - 1));
      }
      if (
        (this.seriesInsightTab === "morelike" ||
          this.seriesInsightTab === "trailer" ||
          this.seriesInsightTab === "collection") &&
        moreLikeCards.length
      ) {
        return this.focusInList(
          moreLikeCards,
          this.getRememberedRailIndex(this.getActivePreviewRailKey(), moreLikeCards)
        );
      }
      if (castCards.length)
        return this.focusInList(castCards, Math.min(index, castCards.length - 1));
      if (insightTabs.length)
        return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs));
      if (episodes.length)
        return this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
          preserveVerticalScroll: false
        });
      return false;
    };
    const focusFirstSeriesSectionBelowHero = () => {
      if (insightTabs.length) {
        return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs));
      }
      if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
        return this.focusInList(ratingSeasons, 0);
      }
      if (castCards.length) {
        return this.focusInList(castCards, 0);
      }
      if (moreLikeCards.length) {
        return this.focusInList(moreLikeCards, 0);
      }
      if (focusCommentsEntry(0)) {
        return true;
      }
      if (companyCards[0]?.length) {
        return this.focusInList(companyCards[0], 0);
      }
      return false;
    };
    const focusSeriesSectionAboveInsights = (index = 0) => {
      if (episodes.length) {
        return this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
          preserveVerticalScroll: false
        });
      }
      if (seasons.length) {
        return this.focusInList(seasons, Math.min(index, seasons.length - 1));
      }
      if (actions.length) {
        return this.focusInList(actions, Math.min(index, actions.length - 1));
      }
      return false;
    };

    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    const actionIndex = actions.indexOf(current);
    if (actionIndex >= 0) {
      if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
      if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
      if (direction === "down") {
        if (seasons.length) {
          return this.focusInList(seasons, this.getSelectedSeasonIndex(seasons)) || true;
        }
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
        if (focusFirstSeriesSectionBelowHero()) {
          return true;
        }
      }
      return true;
    }

    const seasonIndex = seasons.indexOf(current);
    if (seasonIndex >= 0) {
      if (direction === "left") return this.focusInList(seasons, seasonIndex - 1) || true;
      if (direction === "right") return this.focusInList(seasons, seasonIndex + 1) || true;
      if (direction === "up") {
        if (actions.length) {
          return this.focusInList(actions, Math.min(seasonIndex, actions.length - 1)) || true;
        }
      }
      if (direction === "down") {
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
        if (focusFirstSeriesSectionBelowHero()) {
          return true;
        }
      }
      return true;
    }

    const episodeIndex = episodes.indexOf(current);
    if (episodeIndex >= 0) {
      const absoluteEpisodeIndex = Number(current.dataset.episodeIndex || episodeIndex);
      if (direction === "left")
        return (
          this.focusEpisodeByIndex(absoluteEpisodeIndex - 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "right")
        return (
          this.focusEpisodeByIndex(absoluteEpisodeIndex + 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "up") {
        if (seasons.length) {
          return (
            this.focusInList(seasons, this.getSelectedSeasonIndex(seasons), {
              preserveVerticalScroll: true
            }) || true
          );
        }
        if (actions.length) {
          return (
            this.focusInList(actions, Math.min(absoluteEpisodeIndex, actions.length - 1)) || true
          );
        }
      }
      if (direction === "down" && insightTabs.length) {
        return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
      }
      if (direction === "down") {
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, 0) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, 0) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
        }
      }
      return true;
    }

    const tabIndex = insightTabs.indexOf(current);
    if (tabIndex >= 0) {
      if (direction === "left")
        return (
          this.focusInList(insightTabs, tabIndex - 1, { preserveVerticalScroll: true }) || true
        );
      if (direction === "right")
        return (
          this.focusInList(insightTabs, tabIndex + 1, { preserveVerticalScroll: true }) || true
        );
      if (direction === "up") {
        if (focusSeriesSectionAboveInsights(tabIndex)) {
          return true;
        }
      }
      if (direction === "down") {
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, 0) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, 0) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
      }
      return true;
    }

    const castIndex = castCards.indexOf(current);
    if (castIndex >= 0) {
      if (direction === "left") return this.focusInList(castCards, castIndex - 1) || true;
      if (direction === "right") return this.focusInList(castCards, castIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
        }
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
      }
      if (direction === "down" && focusCommentsEntry(0)) {
        return true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, 0) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], 0) || true;
      }
      return true;
    }

    const ratingSeasonIndex = ratingSeasons.indexOf(current);
    if (ratingSeasonIndex >= 0) {
      if (direction === "left")
        return this.focusInList(ratingSeasons, ratingSeasonIndex - 1) || true;
      if (direction === "right")
        return this.focusInList(ratingSeasons, ratingSeasonIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          return (
            this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs, 1)) || true
          );
        }
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
      }
      if (direction === "down" && ratingChips.length) {
        return this.focusInList(ratingChips, 0) || true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, 0) || true;
      }
      if (direction === "down" && focusCommentsEntry(0)) {
        return true;
      }
      return true;
    }

    const ratingChipIndex = ratingChips.indexOf(current);
    if (ratingChipIndex >= 0) {
      if (direction === "left") return this.focusInList(ratingChips, ratingChipIndex - 1) || true;
      if (direction === "right") return this.focusInList(ratingChips, ratingChipIndex + 1) || true;
      if (direction === "up") {
        if (ratingSeasons.length) {
          return (
            this.focusInList(ratingSeasons, Math.min(ratingChipIndex, ratingSeasons.length - 1)) ||
            true
          );
        }
        if (insightTabs.length) {
          return (
            this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs, 1)) || true
          );
        }
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
      }
      if (direction === "down" && focusCommentsEntry(0)) {
        return true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, 0) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], 0) || true;
      }
      return true;
    }

    const commentModeIndex = commentModes.indexOf(current);
    if (commentModeIndex >= 0) {
      if (direction === "left")
        return (
          this.focusInList(commentModes, commentModeIndex - 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "right")
        return (
          this.focusInList(commentModes, commentModeIndex + 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "up") return focusActiveSectionFromComments(commentModeIndex) || true;
      if (direction === "down" && commentCards.length)
        return this.focusInList(commentCards, 0) || true;
      return true;
    }

    const commentCardIndex = commentCards.indexOf(current);
    if (commentCardIndex >= 0) {
      if (direction === "left")
        return (
          this.focusInList(commentCards, commentCardIndex - 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "right")
        return (
          this.focusInList(commentCards, commentCardIndex + 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "up") {
        if (commentModes.length)
          return (
            this.focusInList(commentModes, Math.min(commentCardIndex, commentModes.length - 1), {
              preserveVerticalScroll: true
            }) || true
          );
        return focusActiveSectionFromComments(commentCardIndex) || true;
      }
      if (direction === "down" && companyCards[0]?.length)
        return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          const moreLikeTabIndex = Math.max(
            0,
            insightTabs.findIndex((node) => String(node?.dataset?.tab || "") === "morelike")
          );
          return this.focusInList(insightTabs, moreLikeTabIndex) || true;
        }
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
      }
      if (direction === "down" && focusCommentsEntry(0)) {
        return true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], 0) || true;
      }
      return true;
    }

    for (let trackIndex = 0; trackIndex < companyCards.length; trackIndex += 1) {
      const cards = companyCards[trackIndex];
      const companyIndex = cards.indexOf(current);
      if (companyIndex < 0) {
        continue;
      }
      if (direction === "left") return this.focusInList(cards, companyIndex - 1) || true;
      if (direction === "right") return this.focusInList(cards, companyIndex + 1) || true;
      if (direction === "up") {
        if (trackIndex > 0 && companyCards[trackIndex - 1]?.length) {
          return (
            this.focusInList(
              companyCards[trackIndex - 1],
              rememberedCompanyIndex(trackIndex - 1)
            ) || true
          );
        }
        if (commentCards.length || commentModes.length) {
          return focusCommentsEntry(companyIndex) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (this.seriesInsightTab === "ratings" && ratingChips.length) {
          return (
            this.focusInList(ratingChips, Math.min(companyIndex, ratingChips.length - 1)) || true
          );
        }
        if (castCards.length) {
          return this.focusInList(castCards, Math.min(companyIndex, castCards.length - 1)) || true;
        }
        if (insightTabs.length) {
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
        }
        if (episodes.length) {
          return (
            this.focusEpisodeByIndex(this.getRememberedEpisodeIndex(episodes), {
              preserveVerticalScroll: false
            }) || true
          );
        }
      }
      if (
        direction === "down" &&
        trackIndex < companyCards.length - 1 &&
        companyCards[trackIndex + 1]?.length
      ) {
        return this.focusInList(companyCards[trackIndex + 1], 0) || true;
      }
      return true;
    }

    return false;
  },

  handleMovieDpad(event) {
    if (
      !this.meta ||
      isSeriesDetailMeta(this.meta, this.episodes) ||
      this.pendingEpisodeSelection ||
      this.pendingMovieSelection
    ) {
      return false;
    }
    const keyCode = Number(event?.keyCode || 0);
    const direction =
      keyCode === 37
        ? "left"
        : keyCode === 39
          ? "right"
          : keyCode === 38
            ? "up"
            : keyCode === 40
              ? "down"
              : null;
    if (!direction) {
      return false;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return false;
    }
    const actions = Array.from(
      this.container.querySelectorAll(".series-detail-actions .focusable")
    );
    const tabs = Array.from(
      this.container.querySelectorAll(".series-insight-tabs .series-insight-tab.focusable")
    );
    const cast = Array.from(
      this.container.querySelectorAll(".movie-cast-track .movie-cast-card.focusable")
    );
    const moreLikeCards = Array.from(
      this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable")
    );
    const commentModes = Array.from(
      this.container.querySelectorAll(".detail-comments-modes .detail-comments-mode.focusable")
    );
    const commentCards = Array.from(
      this.container.querySelectorAll(".detail-comments-track .detail-comment-card.focusable")
    );
    const moreLikeRememberedIndex = this.getRememberedRailIndex(
      this.getActivePreviewRailKey(),
      moreLikeCards
    );
    const companyTracks = Array.from(this.container.querySelectorAll(".detail-company-track"));
    const companyCards = companyTracks.map((track) =>
      Array.from(track.querySelectorAll(".detail-company-card.focusable"))
    );
    const rememberedCompanyIndex = (trackIndex = 0) =>
      this.getRememberedCompanyIndex(companyTracks, companyCards, trackIndex);
    const focusCommentsEntry = (index = 0, options = {}) => {
      if (commentModes.length) {
        return this.focusInList(commentModes, Math.min(index, commentModes.length - 1), options);
      }
      if (commentCards.length) {
        return this.focusInList(commentCards, Math.min(index, commentCards.length - 1), options);
      }
      return false;
    };
    const focusActiveSectionFromComments = (index = 0) => {
      if (
        (this.movieInsightTab === "morelike" ||
          this.movieInsightTab === "trailer" ||
          this.movieInsightTab === "collection") &&
        moreLikeCards.length
      ) {
        return this.focusInList(
          moreLikeCards,
          this.getRememberedRailIndex(this.getActivePreviewRailKey(), moreLikeCards)
        );
      }
      if (cast.length) return this.focusInList(cast, Math.min(index, cast.length - 1));
      if (tabs.length) return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs));
      return this.focusInList(actions, Math.min(index, actions.length - 1));
    };

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    const actionIndex = actions.indexOf(current);
    if (actionIndex >= 0) {
      if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
      if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
      if (direction === "down") {
        if (tabs.length) {
          return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs)) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, 0) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
      }
      return true;
    }

    const tabIndex = tabs.indexOf(current);
    if (tabIndex >= 0) {
      if (direction === "left")
        return this.focusInList(tabs, tabIndex - 1, { preserveVerticalScroll: true }) || true;
      if (direction === "right")
        return this.focusInList(tabs, tabIndex + 1, { preserveVerticalScroll: true }) || true;
      if (direction === "up")
        return this.focusInList(actions, Math.min(tabIndex, actions.length - 1)) || true;
      if (direction === "down") {
        if (cast.length) return this.focusInList(cast, 0) || true;
        if (moreLikeCards.length) return this.focusInList(moreLikeCards, 0) || true;
        if (focusCommentsEntry(0)) return true;
        if (companyCards[0]?.length) return this.focusInList(companyCards[0], 0) || true;
      }
      return true;
    }

    const castIndex = cast.indexOf(current);
    if (castIndex >= 0) {
      if (direction === "left") return this.focusInList(cast, castIndex - 1) || true;
      if (direction === "right") return this.focusInList(cast, castIndex + 1) || true;
      if (direction === "up") {
        if (tabs.length) {
          return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs)) || true;
        }
        return this.focusInList(actions, Math.min(castIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, 0) || true;
      }
      if (direction === "down" && focusCommentsEntry(0)) {
        return true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], 0) || true;
      }
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (tabs.length) {
          const moreLikeTabIndex = Math.max(
            0,
            tabs.findIndex((node) => String(node?.dataset?.tab || "") === "morelike")
          );
          return this.focusInList(tabs, moreLikeTabIndex) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, Math.min(moreLikeIndex, cast.length - 1)) || true;
        }
        return this.focusInList(actions, Math.min(moreLikeIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && focusCommentsEntry(0)) {
        return true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], 0) || true;
      }
      return true;
    }

    const commentModeIndex = commentModes.indexOf(current);
    if (commentModeIndex >= 0) {
      if (direction === "left")
        return (
          this.focusInList(commentModes, commentModeIndex - 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "right")
        return (
          this.focusInList(commentModes, commentModeIndex + 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "up") return focusActiveSectionFromComments(commentModeIndex) || true;
      if (direction === "down" && commentCards.length)
        return this.focusInList(commentCards, 0) || true;
      return true;
    }

    const commentCardIndex = commentCards.indexOf(current);
    if (commentCardIndex >= 0) {
      if (direction === "left")
        return (
          this.focusInList(commentCards, commentCardIndex - 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "right")
        return (
          this.focusInList(commentCards, commentCardIndex + 1, { preserveVerticalScroll: true }) ||
          true
        );
      if (direction === "up") {
        if (commentModes.length)
          return (
            this.focusInList(commentModes, Math.min(commentCardIndex, commentModes.length - 1), {
              preserveVerticalScroll: true
            }) || true
          );
        return focusActiveSectionFromComments(commentCardIndex) || true;
      }
      if (direction === "down" && companyCards[0]?.length)
        return this.focusInList(companyCards[0], 0) || true;
      return true;
    }

    for (let trackIndex = 0; trackIndex < companyCards.length; trackIndex += 1) {
      const cards = companyCards[trackIndex];
      const companyIndex = cards.indexOf(current);
      if (companyIndex < 0) {
        continue;
      }
      if (direction === "left") return this.focusInList(cards, companyIndex - 1) || true;
      if (direction === "right") return this.focusInList(cards, companyIndex + 1) || true;
      if (direction === "up") {
        if (trackIndex > 0 && companyCards[trackIndex - 1]?.length) {
          return (
            this.focusInList(
              companyCards[trackIndex - 1],
              rememberedCompanyIndex(trackIndex - 1)
            ) || true
          );
        }
        if (commentCards.length || commentModes.length) {
          return focusCommentsEntry(companyIndex) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, Math.min(companyIndex, cast.length - 1)) || true;
        }
        if (tabs.length) {
          return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs)) || true;
        }
        return this.focusInList(actions, Math.min(companyIndex, actions.length - 1)) || true;
      }
      if (
        direction === "down" &&
        trackIndex < companyCards.length - 1 &&
        companyCards[trackIndex + 1]?.length
      ) {
        return this.focusInList(companyCards[trackIndex + 1], 0) || true;
      }
      return true;
    }

    return false;
  },

  async onKeyDown(event) {
    if (!this.container) {
      return;
    }

    const code = Number(event?.keyCode || 0);
    const currentFocusedNode = this.container.querySelector(".focusable.focused") || null;

    const isEpisodeHoldTarget = this.isEpisodeHoldTarget(currentFocusedNode);
    const isSeasonHoldTarget = this.isSeasonHoldTarget(currentFocusedNode);
    const isPosterHoldTarget = this.isPosterHoldTarget(currentFocusedNode);
    const isHeroHoldTarget = this.isHeroHoldTarget(currentFocusedNode);
    if ((!isEpisodeHoldTarget && !isSeasonHoldTarget) || code !== 13) {
      this.cancelPendingEpisodeHold();
      this.cancelPendingSeasonHold();
    }
    if (!isPosterHoldTarget || code !== 13) {
      this.cancelPendingPosterHold();
    }
    if (!isHeroHoldTarget || code !== 13) {
      this.cancelPendingHeroHold();
    }

    if (isBackEvent(event)) {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (this.consumeBackRequest()) {
        return;
      }
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        this.closeEpisodeStreamChooser();
        return;
      }
      Router.back();
      return;
    }

    if (this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay") {
      this.stopTrailerPlayback({ restartAutoplay: false });
    }

    if (this.isTrailerPlaying && this.trailerPlaybackMode === "manual") {
      this.restartTrailerControlsTimer();
      const direction = getDpadDirection(event);
      const mediaAction = getTrailerMediaAction(event);
      if (event.keyCode === 13 || mediaAction === "toggle") {
        event?.preventDefault?.();
        this.toggleActiveTrailerPlayback();
        return;
      }
      if (mediaAction === "play") {
        event?.preventDefault?.();
        this.setActiveTrailerPausedState(false);
        return;
      }
      if (mediaAction === "pause") {
        event?.preventDefault?.();
        this.setActiveTrailerPausedState(true);
        return;
      }
      if (direction === "left") {
        event?.preventDefault?.();
        this.seekTrailerBy(-getTrailerSeekStepSeconds(event));
        return;
      }
      if (direction === "right") {
        event?.preventDefault?.();
        this.seekTrailerBy(getTrailerSeekStepSeconds(event));
        return;
      }
      if (direction === "up" || direction === "down") {
        event?.preventDefault?.();
        if (direction === "down") {
          this.stopTrailerControlsTimer();
          this.setTrailerControlsVisible(false);
        } else {
          this.restartTrailerControlsTimer();
        }
        return;
      }
    } else if (!this.isTrailerPlaying) {
      this.restartTrailerAutoplayTimer();
    }

    if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
      if (this.handleStreamChooserDpad(event)) {
        return;
      }
      if (getDpadDirection(event)) {
        event?.preventDefault?.();
        return;
      }
    }

    if (code === 13 && isEpisodeHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingEpisodeHold(currentFocusedNode)) {
        this.startPendingEpisodeHold(currentFocusedNode);
      }
      return;
    }
    if (code === 13 && isHeroHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingHeroHold(currentFocusedNode)) {
        this.startPendingHeroHold(currentFocusedNode);
      }
      return;
    }
    if (code === 13 && isPosterHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(currentFocusedNode)) {
        this.startPendingPosterHold(currentFocusedNode);
      }
      return;
    }
    if (code === 13 && isSeasonHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingSeasonHold(currentFocusedNode)) {
        this.startPendingSeasonHold(currentFocusedNode);
      }
      return;
    }

    const direction = getDpadDirection(event);
    const isEpisodeDirectionKey =
      Boolean(direction) && isEpisodeHoldTarget && (direction === "left" || direction === "right");
    if (isEpisodeDirectionKey) {
      event?.preventDefault?.();
      if (event?.repeat) {
        const now = Date.now();
        const elapsedSinceRepeat = now - Number(this.lastEpisodeHorizontalKeyRepeatAt || 0);
        if (elapsedSinceRepeat < EPISODE_SCROLL_REPEAT_THROTTLE_MS) {
          return;
        }
        this.lastEpisodeHorizontalKeyRepeatAt = now;
      }
      if (this.moveEpisodeFocus(direction)) {
        return;
      }
    }

    if (this.handleSeriesDpad(event)) {
      return;
    }

    if (this.handleMovieDpad(event)) {
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    if (code !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    const action = current.dataset.action;
    if (action === "goBack") {
      if (this.navigateBackFromDetail()) {
        return;
      }
      Router.back();
      return;
    }

    if (action === "openSearch") {
      Router.navigate("search", {
        query: this.params?.fallbackTitle || this.params?.itemId || ""
      });
      return;
    }

    if (action === "playDefault") {
      await this.playDefaultFromHero();
      return;
    }

    if (action === "playFromBeginning") {
      await this.playDefaultFromHero({ startOver: true });
      return;
    }

    if (action === "toggleTrailer") {
      this.playTrailer({ muted: false, restart: true, initiatedByUser: true });
      return;
    }

    if (action === "selectSeason") {
      const season = Number(current.dataset.season || 1);
      if (season !== this.selectedSeason) {
        this.hasManualSeasonSelection = true;
        this.selectedSeason = season;
        this.render(this.meta);
      }
      return;
    }

    if (action === "setSeriesInsightTab") {
      const tab = String(current.dataset.tab || "cast");
      if (tab !== this.seriesInsightTab) {
        this.seriesInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(
          tab
        )
          ? tab
          : "cast";
        this.updateRenderedDetailSections(this.meta);
      }
      return;
    }

    if (action === "setMovieInsightTab") {
      const tab = String(current.dataset.tab || "cast");
      if (tab !== this.movieInsightTab) {
        this.movieInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(
          tab
        )
          ? tab
          : "cast";
        this.updateRenderedDetailSections(this.meta);
      }
      return;
    }

    if (action === "setCommentsMode") {
      const mode =
        String(current.dataset.commentsMode || "title") === "episode" ? "episode" : "title";
      this.commentsMode = mode;
      if (mode === "episode" && !this.commentsEpisodeTarget) {
        this.commentsEpisodeTarget = this.nextEpisodeToWatch || this.episodes?.[0] || null;
      }
      this.commentsItems = [];
      this.commentsPage = 0;
      this.updateRenderedDetailSections(this.meta);
      void this.loadTraktComments({ force: true });
      return;
    }

    if (action === "retryComments") {
      void this.loadTraktComments({ force: true });
      return;
    }

    if (action === "openSharedTrailer") {
      const ytId = String(current.dataset.trailerYtId || "").trim();
      if (ytId) {
        this.trailerSource = {
          kind: "youtube",
          ytId,
          embedUrl: buildYoutubeEmbedUrl(ytId, { muted: false })
        };
        this.playTrailer({
          muted: false,
          restart: true,
          initiatedByUser: true,
          preserveSource: true
        });
      }
      return;
    }

    if (action === "openComment") {
      this.selectedCommentIndex = Number(current.dataset.commentIndex || 0);
      current.classList.toggle("is-expanded");
      return;
    }

    if (action === "selectRatingSeason") {
      const season = Number(current.dataset.season || this.selectedRatingSeason || 1);
      if (season !== this.selectedRatingSeason) {
        this.selectedRatingSeason = season;
        this.render(this.meta);
      }
      return;
    }

    if (action === "openEpisodeStreams") {
      const selectedEpisode = this.episodes.find((entry) => entry.id === current.dataset.videoId);
      if (selectedEpisode) {
        await this.openEpisodeStreamChooser(selectedEpisode.id);
      }
      return;
    }

    if (action === "setStreamFilter") {
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        const addon = current.dataset.addon || "all";
        if (this.pendingEpisodeSelection) {
          this.pendingEpisodeSelection.addonFilter = addon;
          const addons = Array.from(
            new Set(
              this.pendingEpisodeSelection.streams.map((stream) => stream.addonName).filter(Boolean)
            )
          );
          const order = ["all", ...addons];
          this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
          this.renderEpisodeStreamChooser();
        } else {
          this.pendingMovieSelection.addonFilter = addon;
          const addons = Array.from(
            new Set(
              this.pendingMovieSelection.streams.map((stream) => stream.addonName).filter(Boolean)
            )
          );
          const order = ["all", ...addons];
          this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
          this.renderMovieStreamChooser();
        }
      }
      return;
    }

    if (action === "playEpisodeStream" || action === "playPendingStream") {
      if (this.pendingEpisodeSelection) {
        this.playEpisodeFromSelectedStream(current.dataset.streamId);
      } else if (this.pendingMovieSelection) {
        this.playMovieFromSelectedStream(current.dataset.streamId);
      }
      return;
    }

    if (action === "openCastDetail") {
      Router.navigate("castDetail", {
        castId: current.dataset.castId || "",
        castName: current.dataset.castName || "",
        castRole: current.dataset.castRole || "",
        castPhoto: current.dataset.castPhoto || ""
      });
      return;
    }

    if (action === "toggleLibrary") {
      await this.toggleLibraryFromHero();
      return;
    }

    if (action === "toggleWatched") {
      const focusRestore = this.captureDetailFocus();
      const isSeries = isSeriesDetailMeta(this.meta, this.episodes);
      if (isSeries) {
        if (this.isMarkedWatched) {
          await watchedSeriesReconciliationService.unmarkSeriesWatched(this.params?.itemId, {
            meta: this.meta
          });
        } else {
          await watchedSeriesReconciliationService.markSeriesWatched(
            this.params?.itemId,
            this.params?.itemType || this.meta?.type || "series",
            {
              meta: this.meta,
              title: this.meta?.name || this.params?.fallbackTitle || "Untitled"
            }
          );
        }
      } else if (this.isMarkedWatched) {
        await watchedItemsRepository.unmark(this.params?.itemId);
        await watchProgressRepository.removeProgress(this.params?.itemId);
      } else {
        await watchedItemsRepository.mark({
          contentId: this.params?.itemId,
          contentType: this.params?.itemType || "movie",
          title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
          watchedAt: Date.now()
        });
        await watchProgressRepository.saveProgress({
          contentId: this.params?.itemId,
          contentType: this.params?.itemType || "movie",
          videoId: null,
          positionMs: 100,
          durationMs: 100,
          updatedAt: Date.now()
        });
      }
      if (!isSeries && this.meta?.ids?.trakt) {
        const enriched = await detailWatchedEnrichmentService.enrichMovieWatchedState(
          this.params?.itemId,
          this.meta.ids.trakt
        );
        this.enrichedMovieState = enriched;
        this.isMarkedWatched = Boolean(enriched?.isWatched);
      }
      await this.refreshEpisodePlaybackState();
      this.render(this.meta, focusRestore);
      return;
    }

    if (action === "playStream" && current.dataset.streamUrl) {
      const imdbId = resolveMetaImdbId(this.meta, this.params);
      const tmdbId = resolveMetaTmdbId(this.meta, this.params);
      const traktId = resolveMetaTraktId(this.meta, this.params);
      const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
      const resumeParams = this.getResumeParamsForProgress(this.getActiveResumeProgress());
      const selectedStream =
        (this.streamItems || []).find(
          (stream) => String(stream?.url || "") === String(current.dataset.streamUrl || "")
        ) || null;
      this.stopTrailerPlaybackForNavigation();
      Router.navigate("player", {
        streamUrl: current.dataset.streamUrl,
        itemId: this.params?.itemId,
        itemType: this.params?.itemType,
        imdbId,
        tmdbId,
        traktId,
        contentLanguage,
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        season: this.nextEpisodeToWatch?.season ?? null,
        episode: this.nextEpisodeToWatch?.episode ?? null,
        playerTitle:
          this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        playerSubtitle:
          this.params?.itemType === "series" ? this.nextEpisodeToWatch?.title || "" : "",
        playerEpisodeTitle: this.nextEpisodeToWatch?.title || "",
        playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
        playerLogoUrl: this.meta?.logo || null,
        episodes: this.episodes || [],
        streamCandidates: this.streamItems || [],
        preferredStreamId: selectedStream?.id || null,
        playbackSourceContext: selectedStream
          ? selectedStream.streamOrigin || {
              addonId: selectedStream.addonId || "",
              addonBaseUrl: selectedStream.addonBaseUrl || "",
              addonName: selectedStream.addonName || "",
              addonOrderIndex: Number.isFinite(Number(selectedStream.addonOrderIndex))
                ? Number(selectedStream.addonOrderIndex)
                : null,
              sourceProviderId: selectedStream.sourceProviderId || "",
              sourceIds: Array.isArray(selectedStream.sources) ? selectedStream.sources : [],
              selectedStreamId: selectedStream.id || ""
            }
          : null,
        ...resumeParams
      });
      return;
    }

    if (action === "openMoreLikeDetail") {
      this.openMoreLikeDetailFromNode(current);
    }
  },

  onPointerMove() {
    if (this.isTrailerPlaying && this.trailerPlaybackMode === "manual") {
      this.restartTrailerControlsTimer();
    }
  },

  onPointerFocus() {},

  onPointerActivate(target) {
    const actionTarget = target?.closest?.("[data-action]");
    const action = String(actionTarget?.dataset?.action || "");
    if (action === "toggleTrailer") {
      this.playTrailer({ muted: false, restart: true, initiatedByUser: true });
      return true;
    }
    if (action === "openSharedTrailer") {
      const ytId = String(actionTarget.dataset.trailerYtId || "").trim();
      if (!ytId) {
        return false;
      }
      this.trailerSource = {
        kind: "youtube",
        ytId,
        embedUrl: buildYoutubeEmbedUrl(ytId, { muted: false })
      };
      this.playTrailer({
        muted: false,
        restart: true,
        initiatedByUser: true,
        preserveSource: true
      });
      return true;
    }
    return false;
  },

  async onKeyUp(event) {
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
    if (await this.completePendingEpisodeHold(current, event)) {
      event?.preventDefault?.();
      return;
    }
    const season = this.container?.querySelector(".series-season-btn.focusable.focused") || null;
    if (this.completePendingSeasonHold(season, event)) {
      event?.preventDefault?.();
      return;
    }
    const poster = this.container?.querySelector(".detail-morelike-card.focusable.focused") || null;
    if (this.completePendingPosterHold(poster, event)) {
      event?.preventDefault?.();
      return;
    }
    const hero = this.container?.querySelector(".series-detail-actions .focusable.focused") || null;
    if (await this.completePendingHeroHold(hero, event)) {
      event?.preventDefault?.();
    }
  },

  cleanup() {
    this.detailLoadToken = (this.detailLoadToken || 0) + 1;
    this.cancelPendingEpisodeHold();
    this.cancelPendingSeasonHold();
    this.cancelPendingPosterHold();
    this.cancelPendingHeroHold();
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.posterOptionsFocusRestore = null;
    this.destroyDetailHoldDialog();
    this.episodeHoldMenu = null;
    this.seasonHoldMenu = null;
    this.heroPlayMenu = null;
    this.libraryListMenu = null;
    if (this.episodeVirtualSyncRaf) {
      cancelAnimationFrame(this.episodeVirtualSyncRaf);
      this.episodeVirtualSyncRaf = null;
    }
    this.episodeThumbnailPrefetchCache = new Set();
    if (this.episodeThumbObserver) {
      try {
        this.episodeThumbObserver.disconnect();
      } catch (_) {}
      this.episodeThumbObserver = null;
    }
    this.selectedSeasonEpisodeState = null;
    if (this.episodeTrackScrollNode && this.episodeTrackScrollHandler) {
      this.episodeTrackScrollNode.removeEventListener("scroll", this.episodeTrackScrollHandler);
    }
    this.episodeTrackScrollNode = null;
    this.episodeTrackScrollHandler = null;
    this.episodeVirtualWindow = null;
    this.episodeVirtualMetrics = null;
    this.stopTrailerPlayback({
      keepDom: false,
      restartAutoplay: false,
      restoreFocus: false,
      immediateClear: true
    });
    if (this.detailScrollHandler && this.container) {
      const content = this.container.querySelector(".series-detail-content");
      if (content) {
        content.removeEventListener("scroll", this.detailScrollHandler);
      }
      this.detailScrollHandler = null;
    }
    if (this.detailFocusHandler && this.container) {
      this.container.removeEventListener("focusin", this.detailFocusHandler, true);
      this.detailFocusHandler = null;
    }
    if (this.detailClickHandler && this.container) {
      this.container.removeEventListener("click", this.detailClickHandler, true);
      this.detailClickHandler = null;
    }
    if (this.trailerProxyMessageHandler) {
      window.removeEventListener("message", this.trailerProxyMessageHandler);
      this.trailerProxyMessageHandler = null;
    }
    ScreenUtils.hide(this.container);
  }
};
