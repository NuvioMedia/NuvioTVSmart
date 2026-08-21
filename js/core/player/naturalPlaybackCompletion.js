// Ported from Android NuvioTV ui/screens/player/PlayerRuntimeControllerPlaybackEvents.kt
// (shouldTreatAsNaturalPlaybackCompletion / isShortPlaceholderDuration) so the web
// player matches the app when a stream reaches its end.
//
// Debrid cache-sync placeholders and unplayable source responses (RAR-only torrents,
// "service unavailable" error clips) report a duration of a few seconds and then reach
// the ended event. Counting those as a real finish marks the episode watched and chains
// auto play next through a whole season, so they are excluded here.

// Streams shorter than about 2:01 are treated as error or placeholder clips.
export function isShortPlaceholderDuration(durationMs) {
  return Number.isFinite(durationMs) && durationMs >= 1 && durationMs <= 120999;
}

export function shouldTreatAsNaturalPlaybackCompletion({
  hasRenderedFirstFrame = true,
  hasFatalError = false,
  durationMs
} = {}) {
  if (hasFatalError) {
    return false;
  }
  if (!hasRenderedFirstFrame) {
    return false;
  }
  if (isShortPlaceholderDuration(durationMs)) {
    return false;
  }
  return true;
}
