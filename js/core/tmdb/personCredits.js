// Android TmdbMetadataService.fetchPersonDetail and CastDetailScreen: the cast page lists the
// person's movies and series as one filmography, newest first, with Movies/Series filters.
import {
  containsCjkOrHangul,
  resolveDisplayLabel
} from "./tmdbMetadataServiceHelpers-01-tmdb-base-url.js";
import { isTalkShowGuestAppearance } from "./talkShowCredits.js";

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

function imageUrl(path, size) {
  const value = String(path || "").trim();
  return value
    ? `${TMDB_IMAGE_BASE_URL}/${size}${value.startsWith("/") ? value : `/${value}`}`
    : "";
}

function text(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

/** Android personCreditsContainCjkTitles. */
export function personCreditsContainCjkTitles(credits) {
  const entries = [...(credits?.cast || []), ...(credits?.crew || [])];
  return entries.some((credit) => {
    const title = text(credit?.title) || text(credit?.name);
    return title ? containsCjkOrHangul(title) : false;
  });
}

/** Android englishCreditTitlesById: the first non-CJK English title of each credit. */
export function englishCreditTitlesById(credits) {
  const titles = new Map();
  [...(credits?.cast || []), ...(credits?.crew || [])].forEach((credit) => {
    const title = text(credit?.title) || text(credit?.name);
    if (title && !containsCjkOrHangul(title) && !titles.has(credit.id))
      titles.set(credit.id, title);
  });
  return titles;
}

/** Android CastDetailViewModel: a Creator, Director or Writer opens the crew filmography. */
export function shouldPreferCrewCredits(role = "") {
  return ["creator", "director", "writer"].includes(
    String(role || "")
      .trim()
      .toLowerCase()
  );
}

function mapCredits(entries, mediaType, { language, englishTitles, skipTalkShowGuests }) {
  const seen = new Set();
  const isMovie = mediaType === "movie";
  return (Array.isArray(entries) ? entries : [])
    .filter(
      (credit) =>
        credit?.media_type === mediaType &&
        credit?.poster_path != null &&
        !(skipTalkShowGuests && isTalkShowGuestAppearance(credit))
    )
    .map((credit, index) => ({ credit, index }))
    .sort(
      (left, right) =>
        (Number(right.credit.vote_average) || 0) - (Number(left.credit.vote_average) || 0) ||
        left.index - right.index
    )
    .map(({ credit }) => {
      if (seen.has(credit.id)) return null;
      seen.add(credit.id);
      const name = resolveDisplayLabel({
        localized: isMovie ? credit.title || credit.name : credit.name || credit.title,
        original: isMovie
          ? credit.original_title || credit.original_name
          : credit.original_name || credit.original_title,
        fallbackEnglish: englishTitles.get(credit.id),
        preferredLanguage: language
      });
      if (!name) return null;
      const date = String((isMovie ? credit.release_date : credit.first_air_date) || "");
      return {
        id: `tmdb:${credit.id}`,
        type: isMovie ? "movie" : "series",
        name,
        poster: imageUrl(credit.poster_path, "w500"),
        background: imageUrl(credit.backdrop_path, "w1280"),
        releaseInfo: date ? date.slice(0, 4) : null
      };
    })
    .filter(Boolean);
}

function pickCredits(castCredits, crewCredits, preferCrew) {
  if (preferCrew && crewCredits.length) return crewCredits;
  return castCredits.length ? castCredits : crewCredits;
}

/** Android fetchPersonDetail movieCredits / tvCredits. */
export function buildPersonCredits({
  credits = null,
  englishCredits = null,
  language = "en",
  preferCrew = false
} = {}) {
  const englishTitles = englishCreditTitlesById(englishCredits);
  const options = { language, englishTitles };
  const cast = credits?.cast || [];
  const crew = credits?.crew || [];
  return {
    movieCredits: pickCredits(
      mapCredits(cast, "movie", options),
      mapCredits(crew, "movie", options),
      preferCrew
    ),
    seriesCredits: pickCredits(
      mapCredits(cast, "tv", { ...options, skipTalkShowGuests: true }),
      mapCredits(crew, "tv", options),
      preferCrew
    )
  };
}

/** Android releaseYearSortKey. */
export function releaseYearSortKey(releaseInfo) {
  const head = String(releaseInfo || "")
    .trim()
    .slice(0, 4);
  // Kotlin toIntOrNull: the whole slice must be an integer.
  return /^[+-]?\d+$/.test(head) ? parseInt(head, 10) : 0;
}

function newestFirst(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        releaseYearSortKey(right.item.releaseInfo) - releaseYearSortKey(left.item.releaseInfo) ||
        left.index - right.index
    )
    .map(({ item }) => item);
}

export const FILMOGRAPHY_FILTERS = ["all", "movies", "series"];

/** Android CastDetailContent: the credits shown for a filter, and whether the tabs show. */
export function filmographyView(movieCredits = [], seriesCredits = [], filter = "all") {
  const seen = new Set();
  const all = newestFirst(
    [...movieCredits, ...seriesCredits].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
  );
  const showFilter = movieCredits.length > 0 && seriesCredits.length > 0;
  const credits = !showFilter
    ? all
    : filter === "movies"
      ? newestFirst(movieCredits)
      : filter === "series"
        ? newestFirst(seriesCredits)
        : all;
  return { all, credits, showFilter };
}

/** Android parseDateFlexible: yyyy-MM-dd or dd-MM-yyyy, nothing lenient. */
export function parsePersonDate(value) {
  const raw = String(value ?? "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let year, month, day;
  if (match) {
    [, year, month, day] = match.map(Number);
  } else if ((match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw))) {
    [, day, month, year] = match.map(Number);
  } else {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

/** Android calculateAge: full years at the death date, or today. */
export function calculatePersonAge(birthday, deathday = null, now = new Date()) {
  const birth = parsePersonDate(birthday);
  if (!birth) return null;
  const end = (deathday && parsePersonDate(deathday)) || now;
  let age = end.getFullYear() - birth.getFullYear();
  if (
    end.getMonth() < birth.getMonth() ||
    (end.getMonth() === birth.getMonth() && end.getDate() < birth.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/** Android formatDateForDisplay: the locale's day, short month and year pattern ("dMMMy"). */
export function formatPersonDate(value, locale) {
  const date = parsePersonDate(value);
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date);
  } catch (_) {
    return null;
  }
}
