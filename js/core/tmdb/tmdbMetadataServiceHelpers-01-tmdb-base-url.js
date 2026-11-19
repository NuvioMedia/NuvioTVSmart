import { normalizeTmdbLanguageCode, TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

import { TMDB_API_KEY } from "../../config.js";
import { BoundedCache } from "../util/boundedCache.js";

import { tmdbShowReleaseInfo, tmdbYearPart } from "../util/tmdbReleaseRange.js";

import { sortCollectionPartsByReleaseDate } from "./tmdbCollectionOrdering.js";
import { fetchTmdbJson } from "./tmdbService.js";

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
// Aggregate series credits can exceed the ID-lookup response limit.
export const TMDB_METADATA_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export const TMDB_IMAGE_SIZES = {
  poster: "w342",
  // Match Android TV: hero backdrops need enough source pixels for a 1080p TV.
  backdrop: "w1280",
  logo: "w300",
  titleLogo: "w500",
  // Match Android TV: episode cards are wider than 300px on the TV layout.
  still: "w500",
  // Entity browse cards and logos follow the Android TMDB screen sizes.
  entityPoster: "w500",
  entityBackdrop: "w780",
  entityLogo: "w500"
};

export const TMDB_TRAILER_FALLBACK_LANGUAGE = "en-US";

export const ENTITY_RAIL_MAX_ITEMS = 20;

export const TOP_RATED_VOTE_COUNT_FLOOR = 200;

export const ENTITY_RAIL_TYPES = ["popular", "top_rated", "recent"];

export const TMDB_ENGLISH_CREDIT_LANGUAGE = "en-US";

export const NATIVE_PERSON_NAME_LANGUAGES = new Set(["ja", "ko", "zh"]);

export const TMDB_RECOMMENDATION_MAX_ITEMS = 12;

export const TMDB_LANGUAGE_DEFAULT_REGIONS = Object.freeze({
  ar: "SA",
  bg: "BG",
  bs: "BA",
  cs: "CZ",
  da: "DK",
  de: "DE",
  el: "GR",
  es: "ES",
  et: "EE",
  fi: "FI",
  fr: "FR",
  he: "IL",
  hi: "IN",
  hr: "HR",
  hu: "HU",
  id: "ID",
  it: "IT",
  ja: "JP",
  ko: "KR",
  lt: "LT",
  lv: "LV",
  nl: "NL",
  no: "NO",
  pl: "PL",
  pt: "PT",
  ro: "RO",
  ru: "RU",
  sk: "SK",
  sl: "SI",
  sr: "RS",
  sv: "SE",
  th: "TH",
  tr: "TR",
  uk: "UA",
  vi: "VN",
  zh: "CN"
});

// Android recreates these TMDB collections with their screens; the Smart TV app
// keeps them for the session, so bound them instead of growing without limit.
const MAX_TMDB_ENTITY_CACHE_ENTRIES = 150;

export const entityHeaderCache = new BoundedCache(MAX_TMDB_ENTITY_CACHE_ENTRIES);

export const entityRailCache = new BoundedCache(MAX_TMDB_ENTITY_CACHE_ENTRIES);

export const entityBrowseCache = new BoundedCache(MAX_TMDB_ENTITY_CACHE_ENTRIES);

export const moreLikeThisCache = new BoundedCache(MAX_TMDB_ENTITY_CACHE_ENTRIES);

export function resolveType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show" || normalized === "tvshow") {
    return "tv";
  }
  return "movie";
}

export function languageBase(language = "") {
  return normalizeTmdbLanguageCode(language).split("-", 1)[0].toLowerCase();
}

export function normalizeMoreLikeThisLanguage(language = "") {
  const normalized = normalizeTmdbLanguageCode(language);
  // Android maps the synthetic Spanish Latin-America locale to TMDB's
  // concrete Mexico locale before making recommendation/image requests.
  return normalized === "es-419" ? "es-MX" : normalized;
}

export function containsCjkOrHangul(text = "") {
  for (const character of String(text || "")) {
    const codePoint = character.codePointAt(0) || 0;
    if (
      (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
      (codePoint >= 0x2e80 && codePoint <= 0x2fff) ||
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0x3130 && codePoint <= 0x318f) ||
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
      (codePoint >= 0xd7b0 && codePoint <= 0xd7ff)
    ) {
      return true;
    }
  }
  return false;
}

export function resolvePersonName({ localizedName = "", originalName = "", fallbackEnglishName = "", preferredLanguage = "en" } = {}) {
  const name = String(localizedName || "").trim();
  const original = String(originalName || "").trim();
  const fallback = String(fallbackEnglishName || "").trim();
  const language = languageBase(preferredLanguage);

  if (!name) {
    return original || fallback || null;
  }
  if (NATIVE_PERSON_NAME_LANGUAGES.has(language)) {
    return name;
  }
  if (!containsCjkOrHangul(name)) {
    return name;
  }
  if (original && !containsCjkOrHangul(original)) {
    return original;
  }
  if (fallback && !containsCjkOrHangul(fallback)) {
    return fallback;
  }
  return fallback || original || name;
}

export function resolveDisplayLabel({ localized = "", original = "", fallbackEnglish = "", preferredLanguage = "en" } = {}) {
  const name = String(localized || "").trim();
  const originalLabel = String(original || "").trim();
  const fallback = String(fallbackEnglish || "").trim();
  if (!name) {
    return originalLabel || fallback || null;
  }

  const language = languageBase(preferredLanguage);
  if (NATIVE_PERSON_NAME_LANGUAGES.has(language)) {
    return name;
  }
  if (!containsCjkOrHangul(name)) {
    return name;
  }
  if (originalLabel && !containsCjkOrHangul(originalLabel)) {
    return originalLabel;
  }
  if (fallback && !containsCjkOrHangul(fallback)) {
    return fallback;
  }
  return fallback || originalLabel || name;
}

export function needsEnglishPersonNameFallback(data = {}, language = "en") {
  const normalizedLanguage = languageBase(language);
  if (!normalizedLanguage || normalizedLanguage === "en") {
    return false;
  }
  if (NATIVE_PERSON_NAME_LANGUAGES.has(normalizedLanguage)) {
    return false;
  }

  const people = [
    ...(Array.isArray(data?.credits?.cast) ? data.credits.cast : []),
    ...(Array.isArray(data?.credits?.crew) ? data.credits.crew : []),
    ...(Array.isArray(data?.created_by) ? data.created_by : [])
  ];
  return people.some((person) => {
    const name = String(person?.name || "").trim();
    const original = String(person?.original_name || "").trim();
    return Boolean(name && containsCjkOrHangul(name) && (!original || containsCjkOrHangul(original)));
  });
}

export function addEnglishPersonNames(target, people = []) {
  (Array.isArray(people) ? people : []).forEach((person) => {
    const id = String(person?.id || "").trim();
    const name = String(person?.name || "").trim();
    if (id && name) {
      target.set(id, name);
    }
  });
}

export function resolveTmdbCredits(data, type) {
  if (type !== "tv") return data?.credits || null;
  const aggregate = data?.aggregate_credits;
  if (!aggregate) return null;
  return {
    cast: (Array.isArray(aggregate.cast) ? aggregate.cast : []).map((member) => ({
      ...member,
      character: member.roles?.[0]?.character || null
    })),
    crew: (Array.isArray(aggregate.crew) ? aggregate.crew : []).flatMap((member) =>
      (Array.isArray(member.jobs) ? member.jobs : []).map((job) => ({ ...member, job: job.job }))
    )
  };
}

export async function fetchEnglishPersonNames({ type, tmdbId, apiKey, data, language } = {}) {
  if (!needsEnglishPersonNameFallback(data, language)) {
    return new Map();
  }

  try {
    const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(TMDB_ENGLISH_CREDIT_LANGUAGE)}&append_to_response=${type === "tv" ? "aggregate_credits" : "credits"}`;
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;
    const englishData = await fetchTmdbJson(url, { maxResponseBytes: TMDB_METADATA_MAX_RESPONSE_BYTES });
    if (!englishData) {
      return new Map();
    }
    const credits = resolveTmdbCredits(englishData, type);
    const names = new Map();
    addEnglishPersonNames(names, credits?.cast);
    addEnglishPersonNames(names, credits?.crew);
    addEnglishPersonNames(names, englishData?.created_by);
    return names;
  } catch (error) {
    console.warn("TMDB English person-name fallback failed", error);
    return new Map();
  }
}

export async function fetchEnglishTitle({ type, tmdbId, apiKey } = {}) {
  const params = `api_key=${encodeURIComponent(apiKey)}&language=en`;
  const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;
  try {
    const data = await fetchTmdbJson(url);
    if (!data) {
      return "";
    }
    return String(data?.title || data?.name || "")
      .trim()
      .replace(/\s+/g, " ");
  } catch (error) {
    console.warn("TMDB English title fallback failed", error);
    return "";
  }
}
