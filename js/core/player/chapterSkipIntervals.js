import { segmentCategory } from "./skipIntervalRules.js";

const MIN_DURATION_SEC = 5;
const MAX_DURATION_SEC = 240;
const PROVIDER = "chapters";

const OPENING_PATTERN = /^\s*(op(ening)?)(\s*(credits|theme))?\s*\d*\s*$/i;
const ENDING_PATTERN = /^\s*(ed|ending)(\s*(credits|theme))?\s*\d*\s*$/i;
const CREDITS_PATTERN = /^\s*(end|closing)?\s*credits\s*$/i;
const RECAP_PATTERN = /^\s*(recap|previously(\s+on.*)?)\s*$/i;
const INTRO_PATTERN = /^\s*intro\s*$/i;
const POST_CREDITS_PATTERN = /(post|mid|after)[\s-]credits/i;

function classifyTitle(title) {
  const value = String(title || "").trim();
  if (!value) {
    return null;
  }
  if (POST_CREDITS_PATTERN.test(value)) {
    return "post-credits";
  }
  if (OPENING_PATTERN.test(value)) {
    return "opening";
  }
  if (ENDING_PATTERN.test(value) || CREDITS_PATTERN.test(value)) {
    return "ending";
  }
  if (RECAP_PATTERN.test(value)) {
    return "recap";
  }
  if (INTRO_PATTERN.test(value)) {
    return "intro";
  }
  return null;
}

export function normalizeChapters(chapters = []) {
  return (Array.isArray(chapters) ? chapters : [])
    .filter((chapter) => Number.isFinite(Number(chapter?.startMs)) && Number(chapter.startMs) >= 0)
    .map((chapter) => ({
      startMs: Number(chapter.startMs),
      title: String(chapter.title || "").trim() || null
    }))
    .sort((left, right) => left.startMs - right.startMs)
    .filter((chapter, index, list) => index === 0 || chapter.startMs !== list[index - 1].startMs);
}

/** Android ChapterSkipIntervals: derive OP/ED/recap intervals from container chapters. */
export function chapterSkipIntervals(chapters = [], durationMs = 0) {
  const normalized = normalizeChapters(chapters);
  const duration = Number(durationMs);
  if (normalized.length < 2 || !Number.isFinite(duration) || duration <= 0) {
    return [];
  }
  const classified = normalized.map((chapter, index) => ({
    chapter,
    endMs: index + 1 < normalized.length ? normalized[index + 1].startMs : duration,
    type: classifyTitle(chapter.title)
  }));
  const hasExplicitOpening = classified.some((entry) => entry.type === "opening");
  return classified
    .map((entry) => {
      let type = entry.type;
      if (type === "intro") {
        type = hasExplicitOpening ? null : "opening";
      }
      if (!type || type === "post-credits") {
        return null;
      }
      const startSec = entry.chapter.startMs / 1000;
      const endSec = entry.endMs / 1000;
      const seconds = endSec - startSec;
      if (seconds < MIN_DURATION_SEC || seconds > MAX_DURATION_SEC) {
        return null;
      }
      const skipType = type === "opening" ? "intro" : type === "ending" ? "outro" : "recap";
      return {
        startTime: startSec,
        endTime: endSec,
        type: skipType,
        provider: PROVIDER
      };
    })
    .filter(Boolean);
}

/** Chapters win per category; API fills gaps; unknown API types stay after. */
export function mergeSkipIntervals(apiIntervals = [], chapterIntervals = [], isMovie = false) {
  const api = Array.isArray(apiIntervals) ? apiIntervals : [];
  const chapters = Array.isArray(chapterIntervals) ? chapterIntervals : [];
  if (!chapters.length) {
    return api;
  }
  if (!api.length) {
    return chapters;
  }
  if (isMovie) {
    return api;
  }
  const chosen = new Map();
  [...chapters, ...api].forEach((interval) => {
    const category = segmentCategory(interval?.type);
    if (category && !chosen.has(category)) {
      chosen.set(category, interval);
    }
  });
  const uncategorized = [...chapters, ...api].filter(
    (interval) => segmentCategory(interval?.type) == null
  );
  return [...chosen.values(), ...uncategorized];
}
