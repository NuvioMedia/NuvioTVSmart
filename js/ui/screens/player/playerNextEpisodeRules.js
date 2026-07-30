const VALID_NEXT_EPISODE_THRESHOLD_MODES = new Set(["PERCENTAGE", "MINUTES_BEFORE_END"]);
const OUTRO_SEGMENT_TYPES = new Set(["outro", "ed", "mixed-ed"]);

function normalizeNextEpisodeThresholdMode(value) {
  const mode = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_NEXT_EPISODE_THRESHOLD_MODES.has(mode) ? mode : "PERCENTAGE";
}

function normalizeThresholdPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return 99;
  }
  return Math.round(Math.max(97, Math.min(100, percent)) * 2) / 2;
}

function normalizeThresholdMinutesBeforeEnd(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) {
    return 2;
  }
  return Math.round(Math.max(0, Math.min(3.5, minutes)) * 2) / 2;
}

function getOutroSegments(skipIntervals = []) {
  return (Array.isArray(skipIntervals) ? skipIntervals : [])
    .filter((interval) =>
      OUTRO_SEGMENT_TYPES.has(
        String(interval?.type || "")
          .trim()
          .toLowerCase()
      )
    )
    .filter(
      (interval) =>
        Number.isFinite(Number(interval?.startTime)) && Number.isFinite(Number(interval?.endTime))
    )
    .map((interval) => ({
      startTime: Number(interval.startTime),
      endTime: Number(interval.endTime)
    }));
}

function shouldShowNextEpisodeCard({
  positionSeconds = 0,
  durationSeconds = 0,
  skipIntervals = [],
  thresholdMode = "PERCENTAGE",
  thresholdPercent = 99,
  thresholdMinutesBeforeEnd = 2
} = {}) {
  const duration = Number(durationSeconds);
  const position = Number(positionSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position < 0) {
    return false;
  }

  const outroSegments = getOutroSegments(skipIntervals);
  if (outroSegments.length) {
    const latestOutroEndSeconds = Math.max(...outroSegments.map((interval) => interval.endTime));
    const postOutroGapSeconds = duration - latestOutroEndSeconds;
    const mode = normalizeNextEpisodeThresholdMode(thresholdMode);
    const userThresholdSeconds =
      mode === "MINUTES_BEFORE_END"
        ? normalizeThresholdMinutesBeforeEnd(thresholdMinutesBeforeEnd) * 60
        : ((100 - normalizeThresholdPercent(thresholdPercent)) / 100) * duration;

    if (postOutroGapSeconds > userThresholdSeconds) {
      if (mode === "MINUTES_BEFORE_END") {
        const remainingSeconds = duration - position;
        return (
          remainingSeconds <= normalizeThresholdMinutesBeforeEnd(thresholdMinutesBeforeEnd) * 60
        );
      }
      return position / duration >= normalizeThresholdPercent(thresholdPercent) / 100;
    }

    return position >= Math.min(...outroSegments.map((interval) => interval.startTime));
  }

  const mode = normalizeNextEpisodeThresholdMode(thresholdMode);
  if (mode === "MINUTES_BEFORE_END") {
    const remainingSeconds = duration - position;
    return remainingSeconds <= normalizeThresholdMinutesBeforeEnd(thresholdMinutesBeforeEnd) * 60;
  }
  return position / duration >= normalizeThresholdPercent(thresholdPercent) / 100;
}

function shouldEnterStillWatchingPrompt({
  stillWatchingEnabled = false,
  autoPlayNextEpisodeEnabled = false,
  nextEpisodeHasAired = false,
  consecutiveAutoPlayCount = 0,
  threshold = 3
} = {}) {
  return (
    Boolean(stillWatchingEnabled) &&
    Boolean(autoPlayNextEpisodeEnabled) &&
    Boolean(nextEpisodeHasAired) &&
    Number(consecutiveAutoPlayCount || 0) >= Number(threshold || 0)
  );
}

export {
  normalizeNextEpisodeThresholdMode,
  normalizeThresholdMinutesBeforeEnd,
  normalizeThresholdPercent,
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCard
};
