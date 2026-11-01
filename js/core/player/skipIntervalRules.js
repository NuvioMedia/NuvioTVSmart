const OUTRO_SEGMENT_TYPES = new Set(["outro", "ed", "mixed-ed"]);

export function segmentCategory(type) {
  switch (
    String(type || "")
      .trim()
      .toLowerCase()
  ) {
    case "intro":
    case "op":
    case "mixed-op":
      return "opening";
    case "outro":
    case "ed":
    case "mixed-ed":
    case "credits":
    case "ending":
      return "ending";
    case "recap":
      return "recap";
    default:
      return null;
  }
}

export const POST_OUTRO_AUTOPLAY_GAP_SECONDS = 5;
export const END_OF_VIDEO_EPSILON_SECONDS = 1;

function normalizedType(interval) {
  return String(interval?.type || "")
    .trim()
    .toLowerCase();
}

function validInterval(interval, durationSeconds = 0) {
  const start = Number(interval?.startTime);
  const end = Number(interval?.endTime);
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    (!durationSeconds || start < durationSeconds)
  );
}

export function findActiveSkipInterval(intervals = [], positionSeconds = 0) {
  const position = Number(positionSeconds);
  if (!Number.isFinite(position)) {
    return null;
  }
  return (
    (Array.isArray(intervals) ? intervals : []).find((interval) => {
      if (normalizedType(interval) === "post-credits" || !validInterval(interval)) {
        return false;
      }
      return position >= Number(interval.startTime) && position < Number(interval.endTime) - 0.5;
    }) || null
  );
}

export function findFollowingPostCreditsScene(interval, intervals = [], durationSeconds = 0) {
  const type = normalizedType(interval);
  const endTime = Number(interval?.endTime);
  if ((!OUTRO_SEGMENT_TYPES.has(type) && type !== "movie-credits") || !Number.isFinite(endTime)) {
    return null;
  }

  const explicit = (Array.isArray(intervals) ? intervals : [])
    .filter((candidate) => {
      return (
        normalizedType(candidate) === "post-credits" &&
        validInterval(candidate, durationSeconds) &&
        Number(candidate.startTime) >= endTime
      );
    })
    .sort((left, right) => Number(left.startTime) - Number(right.startTime))[0];
  if (explicit) {
    return explicit;
  }

  const duration = Number(durationSeconds);
  if (
    Number.isFinite(duration) &&
    duration > 0 &&
    duration - endTime > POST_OUTRO_AUTOPLAY_GAP_SECONDS
  ) {
    return {
      startTime: endTime,
      endTime: duration,
      type: "post-credits",
      provider: "heuristic"
    };
  }
  return null;
}

export function getSkipIntervalTargetSeconds(interval, intervals = [], durationSeconds = 0) {
  if (!interval || normalizedType(interval) === "post-credits") {
    return null;
  }
  const followingScene = findFollowingPostCreditsScene(interval, intervals, durationSeconds);
  const target = followingScene?.startTime ?? interval.endTime;
  return Number.isFinite(Number(target)) ? Number(target) : null;
}

function normalizeMovieThreshold(value) {
  const threshold = Number(value);
  return Number.isFinite(threshold) ? Math.max(80, Math.min(100, threshold)) : 90;
}

function normalizeEpisodeThresholdPercent(value) {
  const threshold = Number(value);
  return Number.isFinite(threshold) ? Math.max(97, Math.min(100, threshold)) : 99;
}

function normalizeEpisodeThresholdMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? Math.max(0, Math.min(3.5, minutes)) : 2;
}

export function moviePostPlayTriggerSeconds({
  durationSeconds = 0,
  movieThresholdPercent = 90,
  skipIntervals = [],
  episodeThresholdMode = "PERCENTAGE",
  episodeThresholdPercent = 99,
  episodeThresholdMinutesBeforeEnd = 2
} = {}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const fallback = duration * (normalizeMovieThreshold(movieThresholdPercent) / 100);
  const validIntervals = (Array.isArray(skipIntervals) ? skipIntervals : []).filter((interval) =>
    validInterval(interval, duration + END_OF_VIDEO_EPSILON_SECONDS)
  );
  const credits = validIntervals.filter(
    (interval) =>
      normalizedType(interval) === "movie-credits" &&
      Number(interval.endTime) <= duration + END_OF_VIDEO_EPSILON_SECONDS
  );
  const firstCreditsStart = credits.length
    ? Math.min(...credits.map((interval) => Number(interval.startTime)))
    : null;
  const scenes = validIntervals.filter(
    (interval) =>
      normalizedType(interval) === "post-credits" &&
      (firstCreditsStart == null || Number(interval.startTime) >= firstCreditsStart)
  );
  if (scenes.length) {
    return Math.min(duration, Math.max(...scenes.map((interval) => Number(interval.endTime))));
  }
  if (!credits.length) {
    return fallback;
  }

  const latestCreditsEnd = Math.max(...credits.map((interval) => Number(interval.endTime)));
  const postCreditsGap = duration - latestCreditsEnd;
  const normalizedMode = String(episodeThresholdMode || "").toUpperCase();
  const userThreshold =
    normalizedMode === "MINUTES_BEFORE_END"
      ? normalizeEpisodeThresholdMinutes(episodeThresholdMinutesBeforeEnd) * 60
      : ((100 - normalizeEpisodeThresholdPercent(episodeThresholdPercent)) / 100) * duration;
  if (postCreditsGap > userThreshold) {
    return Math.max(latestCreditsEnd, duration - userThreshold);
  }
  return Math.min(...credits.map((interval) => Number(interval.startTime)));
}
