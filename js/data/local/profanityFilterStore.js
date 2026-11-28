import { createProfileScopedStore } from "./profileScopedStore.js";
import {
  DEFAULT_PROFANITY_CATEGORIES,
  PROFANITY_CATEGORIES,
  PROFANITY_MASK_STYLES,
  PROFANITY_MUTE_PRECISIONS,
  PROFANITY_RATING_OPTIONS,
  normalizeContentRating,
  normalizeWordList
} from "../../core/player/profanityFilter.js";

// Device-local and per profile. Deliberately not part of the cloud-synced
// player settings: it carries per-title choices that only matter on this TV.
const KEY = "profanityFilterSettings";

// "manual": only titles switched on by hand. "rated": also titles whose
// rating is in `ratings`. "always": every title.
export const PROFANITY_FILTER_MODES = Object.freeze(["manual", "rated", "always"]);
export const PROFANITY_FILTER_ACTIONS = Object.freeze(["mute_and_mask", "mask", "mute"]);
export const PROFANITY_PADDING_OPTIONS_MS = Object.freeze([0, 100, 250, 400, 600, 1000]);

const MAX_TITLE_OVERRIDES = 500;
const MAX_RATING_CACHE = 400;

const DEFAULTS = Object.freeze({
  // Off by default: no UI on the details page or in the player, no rating
  // lookups and no subtitle changes until it is turned on in Settings.
  enabled: false,
  // Once enabled, nothing is filtered until a title is switched on by hand.
  mode: "manual",
  ratings: ["TV-MA"],
  action: "mute_and_mask",
  maskStyle: "stars",
  // "f***" instead of "****"; off so the word cannot be guessed.
  showFirstLetter: false,
  categories: [...DEFAULT_PROFANITY_CATEGORIES],
  customWords: [],
  allowedWords: [],
  mutePrecision: "word",
  mutePaddingMs: 250,
  // Load a hidden subtitle for timing when subtitles are turned off, so the
  // audio can still be muted.
  muteWithoutSubtitles: true,
  showIndicator: true,
  titleOverrides: {},
  ratingCache: {}
});

function pickOne(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeTitleMap(value, max, mapEntry) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = Object.keys(source)
    .map((key) => [normalizeTitleKey(key), mapEntry(source[key])])
    .filter(([key, entry]) => key && entry)
    .sort((left, right) => Number(right[1].at || 0) - Number(left[1].at || 0))
    .slice(0, max);
  const result = {};
  entries.forEach(([key, entry]) => {
    result[key] = entry;
  });
  return result;
}

export function normalizeProfanityFilterSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const ratings = (Array.isArray(source.ratings) ? source.ratings : DEFAULTS.ratings)
    .map(normalizeContentRating)
    .filter((rating) => PROFANITY_RATING_OPTIONS.includes(rating));
  const categories = (
    Array.isArray(source.categories) ? source.categories : DEFAULTS.categories
  ).filter((category) => PROFANITY_CATEGORIES.includes(category));
  const padding = Math.trunc(Number(source.mutePaddingMs));
  // Builds before the on/off switch had no `enabled` and used mode "off" as
  // the off state: keep a filter that was in use working after the update.
  const legacy = source.enabled === undefined && typeof source.mode === "string";
  return {
    enabled: source.enabled === true || (legacy && source.mode !== "off"),
    mode: pickOne(
      source.mode === "off" ? "manual" : source.mode,
      PROFANITY_FILTER_MODES,
      DEFAULTS.mode
    ),
    ratings: Array.from(new Set(ratings)),
    action: pickOne(source.action, PROFANITY_FILTER_ACTIONS, DEFAULTS.action),
    // Older builds saved "censor" (first letter kept): it becomes stars with
    // the first letter hidden, the new default.
    maskStyle: pickOne(
      source.maskStyle === "censor" ? "stars" : source.maskStyle,
      PROFANITY_MASK_STYLES,
      DEFAULTS.maskStyle
    ),
    showFirstLetter: source.showFirstLetter === true,
    categories: Array.from(new Set(categories)),
    customWords: normalizeWordList(source.customWords),
    allowedWords: normalizeWordList(source.allowedWords),
    mutePrecision: pickOne(source.mutePrecision, PROFANITY_MUTE_PRECISIONS, DEFAULTS.mutePrecision),
    mutePaddingMs: PROFANITY_PADDING_OPTIONS_MS.includes(padding)
      ? padding
      : DEFAULTS.mutePaddingMs,
    muteWithoutSubtitles: source.muteWithoutSubtitles !== false,
    showIndicator: source.showIndicator !== false,
    titleOverrides: normalizeTitleMap(source.titleOverrides, MAX_TITLE_OVERRIDES, (entry) =>
      entry && typeof entry.enabled === "boolean"
        ? {
            enabled: entry.enabled,
            name: String(entry.name || "").slice(0, 120),
            at: Number(entry.at) || 0
          }
        : null
    ),
    ratingCache: normalizeTitleMap(source.ratingCache, MAX_RATING_CACHE, (entry) => {
      const rating = normalizeContentRating(entry?.rating);
      return rating ? { rating, at: Number(entry.at) || 0 } : null;
    })
  };
}

/**
 * Per-title key. Series are keyed by the show, not the episode, so a choice
 * made on any episode applies to the whole show ("tt0903747:1:2" ->
 * "tt0903747").
 */
export function normalizeTitleKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const imdb = raw.match(/^(tt\d+)/i);
  if (imdb) {
    return imdb[1].toLowerCase();
  }
  return raw.replace(/:\d+:\d+$/, "").slice(0, 160);
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeProfanityFilterSettings,
  merge(current, partial) {
    return { ...current, ...(partial || {}) };
  }
});

function save(partial) {
  return store.set(partial, { silentSync: true });
}

export const ProfanityFilterStore = {
  get() {
    return store.get();
  },

  getDefaults() {
    return normalizeProfanityFilterSettings({});
  },

  set(partial) {
    return save(partial);
  },

  getTitleOverride(titleKey) {
    const key = normalizeTitleKey(titleKey);
    return key ? store.get().titleOverrides[key] || null : null;
  },

  setTitleOverride(titleKey, enabled, { name = "" } = {}) {
    const key = normalizeTitleKey(titleKey);
    if (!key) {
      return null;
    }
    const current = store.get();
    const titleOverrides = { ...current.titleOverrides };
    if (enabled === null || enabled === undefined) {
      delete titleOverrides[key];
    } else {
      titleOverrides[key] = { enabled: Boolean(enabled), name, at: Date.now() };
    }
    return save({ titleOverrides });
  },

  clearTitleOverrides() {
    return save({ titleOverrides: {} });
  },

  getCachedRating(titleKey) {
    const key = normalizeTitleKey(titleKey);
    return key ? store.get().ratingCache[key]?.rating || "" : "";
  },

  rememberRating(titleKey, rating) {
    const key = normalizeTitleKey(titleKey);
    const normalized = normalizeContentRating(rating);
    if (!key || !normalized) {
      return;
    }
    const current = store.get();
    // Nothing is written while the filter is off.
    if (!current.enabled || current.ratingCache[key]?.rating === normalized) {
      return;
    }
    save({
      ratingCache: { ...current.ratingCache, [key]: { rating: normalized, at: Date.now() } }
    });
  }
};

/**
 * Whether the filter applies to a title, and why. `reason` drives the UI copy:
 * "title_on" / "title_off" (per-title choice), "always", "off", "rating"
 * (rating in the list), "rating_skip" (rating known, not in the list) and
 * "unrated" (rating unknown; off until enabled per title).
 */
export function resolveProfanityFilterForTitle({
  titleKey = "",
  rating = "",
  settings = null
} = {}) {
  const current = settings || ProfanityFilterStore.get();
  const key = normalizeTitleKey(titleKey);
  const normalizedRating =
    normalizeContentRating(rating) || (key ? current.ratingCache[key]?.rating || "" : "");
  if (!current.enabled) {
    return { enabled: false, reason: "disabled", rating: normalizedRating };
  }
  const override = key ? current.titleOverrides[key] : null;
  if (override) {
    return {
      enabled: override.enabled,
      reason: override.enabled ? "title_on" : "title_off",
      rating: normalizedRating
    };
  }
  if (current.mode === "manual") {
    return { enabled: false, reason: "manual", rating: normalizedRating };
  }
  if (current.mode === "always") {
    return { enabled: true, reason: "always", rating: normalizedRating };
  }
  if (!normalizedRating) {
    return { enabled: false, reason: "unrated", rating: "" };
  }
  const enabled = current.ratings.includes(normalizedRating);
  return { enabled, reason: enabled ? "rating" : "rating_skip", rating: normalizedRating };
}

/**
 * Rating lookups (TMDB) only happen when they can change the outcome: the
 * filter is on, set to follow ratings, and the title has no manual choice.
 */
export function shouldLookUpTitleRating(titleKey, settings = null) {
  const current = settings || ProfanityFilterStore.get();
  const key = normalizeTitleKey(titleKey);
  return Boolean(
    current.enabled && current.mode === "rated" && key && !current.titleOverrides[key]
  );
}
