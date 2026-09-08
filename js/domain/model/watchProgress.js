export function createWatchProgress({
  contentId,
  contentType,
  videoId = null,
  positionMs = 0,
  durationMs = 0,
  updatedAt = Date.now()
}) {
  return {
    contentId,
    contentType,
    videoId,
    positionMs,
    durationMs,
    updatedAt
  };
}

export const WATCH_PROGRESS_STARTED_THRESHOLD = 0.02;
export const WATCH_PROGRESS_COMPLETED_THRESHOLD = 0.9;
// Simkl playback sessions report completion earlier than local progress, so
// Android treats them as finished at 80% instead of 90%.
export const WATCH_PROGRESS_SIMKL_COMPLETED_THRESHOLD = 0.8;
// Android keeps a small in-progress marker when a player cannot expose a
// meaningful duration (the usual case for live streams).
export const WATCH_PROGRESS_UNKNOWN_DURATION_PERCENT = 5;

export function watchProgressCompletedThreshold(progress = {}) {
  return String(progress?.source || "") === "simkl_playback"
    ? WATCH_PROGRESS_SIMKL_COMPLETED_THRESHOLD
    : WATCH_PROGRESS_COMPLETED_THRESHOLD;
}

export function getWatchProgressFraction(progress = {}) {
  const positionMs = Number(progress?.positionMs || 0);
  const durationMs = Number(progress?.durationMs || 0);
  if (
    Number.isFinite(positionMs) &&
    Number.isFinite(durationMs) &&
    positionMs > 0 &&
    durationMs > 0
  ) {
    return Math.max(0, Math.min(1, positionMs / durationMs));
  }
  if (progress?.progressPercent != null && progress.progressPercent !== "") {
    const explicitPercent = Number(progress.progressPercent);
    if (Number.isFinite(explicitPercent)) {
      return Math.max(0, Math.min(1, explicitPercent / 100));
    }
  }
  return 0;
}

export function isWatchProgressCompleted(progress = {}) {
  return getWatchProgressFraction(progress) >= watchProgressCompletedThreshold(progress);
}

export function isWatchProgressInProgress(progress = {}) {
  const fraction = getWatchProgressFraction(progress);
  return (
    fraction >= WATCH_PROGRESS_STARTED_THRESHOLD &&
    fraction < watchProgressCompletedThreshold(progress)
  );
}

export function hasWatchProgressStarted(progress = {}) {
  return Number(progress?.positionMs || 0) > 0 || Number(progress?.progressPercent || 0) > 0;
}

export function resolveWatchProgressResumePositionMs(progress = {}, actualDurationMs = 0) {
  const positionMs = Number(progress?.positionMs || 0);
  const durationMs = Number(actualDurationMs || progress?.durationMs || 0);
  if (Number.isFinite(positionMs) && positionMs > 0) {
    return Number.isFinite(durationMs) && durationMs > 0
      ? Math.max(0, Math.min(Math.trunc(positionMs), Math.trunc(durationMs)))
      : Math.trunc(positionMs);
  }
  const explicitPercent = Number(progress?.progressPercent);
  if (
    Number.isFinite(explicitPercent) &&
    explicitPercent > 0 &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    return Math.trunc((durationMs * Math.max(0, Math.min(100, explicitPercent))) / 100);
  }
  return 0;
}
