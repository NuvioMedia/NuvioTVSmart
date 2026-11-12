// Read playback state, rather than treating a mounted/loading trailer as playing.
export function isAmbientTrailerPlaying(screen) {
  if (screen?.isTrailerPlaying && typeof screen.getTrailerPlaybackSnapshot === "function") {
    const state = screen.getTrailerPlaybackSnapshot();
    if (state && !state.paused && !state.loading) return true;
  }
  for (const node of screen?.container?.querySelectorAll?.(".home-inline-trailer-video, .home-inline-trailer-frame") || []) {
    if (!node.isConnected) continue;
    if (node.tagName === "VIDEO") {
      if (!node.paused && !node.ended && node.readyState >= 2 && node.dataset?.ambientTrailerLooped !== "true") return true;
    } else if (node.dataset.ambientTrailerPlaying === "true") return true;
  }
  return false;
}
