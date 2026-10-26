// Android LivePlaybackUiPolicy: a media window is not a watched duration.
export function isLivePlayback(screen, controller) {
  if (String(screen.params?.itemType || "").toLowerCase() === "channel" || screen.livePlaybackLatched) return true;
  // Ignore the previous media's native state while the new route is starting.
  if (!screen.hasPresentedPlaybackFrame) return false;
  try {
    const hls = controller.hlsInstance;
    const reportsLive =
      hls?.latestLevelDetails?.live === true || controller.dashInstance?.isDynamic?.() === true || controller.video?.duration === Infinity;
    if (reportsLive) return (screen.livePlaybackLatched = true);
    const avplayLive =
      controller.isUsingAvPlay?.() &&
      controller.avplayReady &&
      !controller.avplaySeekInFlight &&
      controller.getAvPlay?.()?.getStreamingProperty?.("IS_LIVE");
    screen.livePlaybackLatched = avplayLive === "1" || String(avplayLive).toLowerCase() === "true";
  } catch (_) {
    // Native/adaptive metadata can be unavailable during engine transitions.
  }
  return Boolean(screen.livePlaybackLatched);
}

export class LivePlaybackWatchClock {
  accumulatedMs = 0;
  segmentStartedAt = null;

  update(isLive, isPlaying, now = performance.now()) {
    if (!isLive) {
      this.accumulatedMs = 0;
      this.segmentStartedAt = null;
      return 0;
    }
    if (isPlaying) {
      if (this.segmentStartedAt == null) this.segmentStartedAt = now;
    } else if (this.segmentStartedAt != null) {
      this.accumulatedMs += Math.max(0, now - this.segmentStartedAt);
      this.segmentStartedAt = null;
    }
    return this.accumulatedMs + (this.segmentStartedAt == null ? 0 : Math.max(0, now - this.segmentStartedAt));
  }
}
