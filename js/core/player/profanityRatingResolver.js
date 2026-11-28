import { TMDB_API_KEY } from "../../config.js";
import { TmdbService, fetchTmdbJson } from "../tmdb/tmdbService.js";
import { selectAgeRating } from "../tmdb/tmdbMetadataServiceHelpers-03-fetch-tmdb-images.js";
import { normalizeContentRating } from "./profanityFilter.js";
import {
  ProfanityFilterStore,
  normalizeTitleKey,
  shouldLookUpTitleRating
} from "../../data/local/profanityFilterStore.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const inFlight = new Map();

function isSeriesType(itemType) {
  const type = String(itemType || "")
    .trim()
    .toLowerCase();
  return type === "series" || type === "tv" || type === "show";
}

async function fetchTmdbRating({ itemId, itemType, imdbId, tmdbId }) {
  const apiKey = String(TMDB_API_KEY || "").trim();
  if (!apiKey) {
    return "";
  }
  const series = isSeriesType(itemType);
  const lookupType = series ? "series" : "movie";
  const resolvedTmdbId =
    (tmdbId && /^\d+$/.test(String(tmdbId)) ? String(tmdbId) : "") ||
    (await TmdbService.ensureTmdbId(itemId, lookupType, {
      fallbackImdbId: imdbId,
      requireEnabled: false
    })) ||
    (imdbId ? await TmdbService.ensureTmdbId(imdbId, lookupType, { requireEnabled: false }) : null);
  if (!resolvedTmdbId) {
    return "";
  }
  const path = series ? "tv" : "movie";
  const append = series ? "content_ratings" : "release_dates";
  const url = `${TMDB_BASE_URL}/${path}/${encodeURIComponent(String(resolvedTmdbId))}/${append}?api_key=${encodeURIComponent(apiKey)}`;
  const data = await fetchTmdbJson(url);
  if (!data) {
    return "";
  }
  return normalizeContentRating(
    selectAgeRating(
      series ? { content_ratings: data } : { release_dates: data },
      series ? "tv" : "movie"
    )
  );
}

/**
 * The US-style rating of a title, from (in order) what the caller already
 * knows, the per-title cache, then TMDB. Resolves to "" when unknown; the
 * filter then stays off until the title is enabled by hand.
 */
export async function resolveTitleContentRating({
  titleKey = "",
  knownRating = "",
  itemId = "",
  itemType = "",
  imdbId = "",
  tmdbId = ""
} = {}) {
  const key = normalizeTitleKey(titleKey || itemId || imdbId);
  const known = normalizeContentRating(knownRating);
  if (known) {
    ProfanityFilterStore.rememberRating(key, known);
    return known;
  }
  const cached = ProfanityFilterStore.getCachedRating(key);
  if (cached) {
    return cached;
  }
  if (!key || !shouldLookUpTitleRating(key)) {
    return "";
  }
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }
  const request = fetchTmdbRating({
    itemId: itemId || key,
    itemType,
    imdbId: imdbId || (/^tt\d+$/.test(key) ? key : ""),
    tmdbId
  })
    .catch(() => "")
    .then((rating) => {
      inFlight.delete(key);
      if (rating) {
        ProfanityFilterStore.rememberRating(key, rating);
      }
      return rating;
    });
  inFlight.set(key, request);
  return request;
}
