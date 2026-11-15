import { LocalStore } from "../../../core/storage/localStore.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { nextUpReleaseTimestamp } from "./homeScreenHelpers-07-map-absolute-watched-episode-keys.js";

// Fields that belong to the series, not the episode (Android withSeriesFieldsFrom).
const SERIES_FIELDS = [
  "title",
  "poster",
  "background",
  "backdrop",
  "landscapePoster",
  "thumbnail",
  "logo",
  "genres",
  "releaseInfo",
  "language",
  "imdbRating"
];

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== "";
}

/**
 * Keeps what a card showed for its series while it moves on to another episode:
 * title, artwork, genres and title ratings stay until the new episode is enriched,
 * instead of the raw progress title. Episode fields are left to the new episode.
 */
export function withSeriesFieldsFrom(item = {}, source = null) {
  if (!source) {
    return item;
  }
  const next = { ...item };
  SERIES_FIELDS.forEach((field) => {
    if (hasValue(source[field])) {
      next[field] = source[field];
    }
  });
  return next;
}

/**
 * Cards on screen for series the current rebuild has not placed yet. A series whose
 * episode was just finished has no in-progress entry until its fresh next-up is built;
 * without these it leaves the row and comes back moments later, moving focus.
 */
export function continueWatchingCardsAwaitingNextUp(
  shownItems = [],
  placedContentIds = new Set(),
  seededContentIds = new Set(),
  dismissedKeys = new Set()
) {
  return (Array.isArray(shownItems) ? shownItems : []).filter((item) => {
    const contentId = String(item?.contentId || "").trim();
    return (
      contentId &&
      !placedContentIds.has(contentId) &&
      seededContentIds.has(contentId) &&
      !dismissedKeys.has(contentId)
    );
  });
}

/** Raw progress cards for the first render, with series fields and awaiting cards kept from the row on screen. */
export function stabilizeImmediateContinueWatchingItems({
  rawItems = [],
  shownItems = [],
  seededContentIds = new Set(),
  dismissedKeys = new Set()
} = {}) {
  const shownById = new Map();
  (Array.isArray(shownItems) ? shownItems : []).forEach((item) => {
    const contentId = String(item?.contentId || "").trim();
    if (contentId && !shownById.has(contentId)) {
      shownById.set(contentId, item);
    }
  });
  const placed = new Set();
  const items = (Array.isArray(rawItems) ? rawItems : []).map((item) => {
    const contentId = String(item?.contentId || "").trim();
    placed.add(contentId);
    return withSeriesFieldsFrom(item, shownById.get(contentId) || null);
  });
  return [
    ...items,
    ...continueWatchingCardsAwaitingNextUp(shownItems, placed, seededContentIds, dismissedKeys)
  ];
}

/** The longest a series confirmed to have no next episode is skipped before it is looked up again. */
export const NO_NEXT_UP_RECHECK_MS = 24 * 60 * 60 * 1000;
/** The longest single wait for a release; timers stall while the TV sleeps. */
export const CW_RELEASE_REFRESH_MAX_WAIT_MS = 15 * 60 * 1000;
/** Refreshes slightly after the release, so the episode already counts as aired. */
export const CW_RELEASE_REFRESH_MARGIN_MS = 1000;

/** When a seed with no episode after it is looked up again: its next release, at the latest after a day. */
export function noNextUpRecheckAt(nextReleaseMs, nowMs) {
  const latest = nowMs + NO_NEXT_UP_RECHECK_MS;
  return Number.isFinite(nextReleaseMs) ? Math.min(latest, Math.max(nowMs, nextReleaseMs)) : latest;
}

export function isNoNextUpStillConfirmed(recheckAt, nowMs) {
  return Number.isFinite(recheckAt) && nowMs < recheckAt;
}

/** The earliest release still ahead among a meta's episodes, for the no-next-up recheck. */
export function earliestUpcomingReleaseMs(videos = [], nowMs = Date.now()) {
  let earliest = null;
  (Array.isArray(videos) ? videos : []).forEach((video) => {
    const time = nextUpReleaseTimestamp({ released: video?.released });
    if (Number.isFinite(time) && time > nowMs && (earliest == null || time < earliest)) {
      earliest = time;
    }
  });
  return earliest;
}

/** The next time that changes what Continue Watching shows: an upcoming episode airing, or a no-next-up recheck. */
export function nextContinueWatchingReleaseMs(
  items = [],
  noNextUpRecheckTimes = [],
  nowMs = Date.now()
) {
  let next = null;
  const consider = (time) => {
    if (Number.isFinite(time) && time > nowMs && (next == null || time < next)) {
      next = time;
    }
  };
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (item?.isNextUp && item?.hasAired === false) {
      consider(nextUpReleaseTimestamp(item));
    }
  });
  (Array.isArray(noNextUpRecheckTimes) ? noNextUpRecheckTimes : []).forEach(consider);
  return next;
}

const NO_NEXT_UP_KEY = "homeContinueWatchingNoNextUpSeeds";

function profileKey() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

/** Android ContinueWatchingEnrichmentCache no-next-up seeds, kept per profile. */
export const NoNextUpSeedStore = {
  all() {
    const stored = LocalStore.get(NO_NEXT_UP_KEY, {});
    const seeds = stored && typeof stored === "object" ? stored[profileKey()] : null;
    return seeds && typeof seeds === "object" ? seeds : {};
  },
  save(seeds = {}) {
    const stored = LocalStore.get(NO_NEXT_UP_KEY, {});
    const next =
      stored && typeof stored === "object" && !Array.isArray(stored) ? { ...stored } : {};
    const nowMs = Date.now();
    next[profileKey()] = Object.fromEntries(
      Object.entries(seeds).filter(([, recheckAt]) => Number(recheckAt) > nowMs)
    );
    LocalStore.set(NO_NEXT_UP_KEY, next);
  }
};

export const NO_NEXT_UP_SEEDS_STORAGE_KEY = NO_NEXT_UP_KEY;
