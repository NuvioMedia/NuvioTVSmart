export function canReleasePlayingNativeStartupAudioGate({
  allowNativePlayback = false,
  hasPresentedPlaybackFrame = false,
  pendingAudioSelection = false,
  readyState = 0
} = {}) {
  return Boolean(
    allowNativePlayback &&
    hasPresentedPlaybackFrame &&
    !pendingAudioSelection &&
    Number.isFinite(Number(readyState)) &&
    Number(readyState) >= 3
  );
}

export function shouldAllowNativePlaybackDuringStartupAudioGate({
  isHlsPlayback = false,
  isPrioritizedWebOsRemoteMkvPlayback = false
} = {}) {
  return Boolean(isHlsPlayback || isPrioritizedWebOsRemoteMkvPlayback);
}

export function selectStartupAudioFallbackOption(options = []) {
  const supportedOptions = (Array.isArray(options) ? options : []).filter(
    (entry) => entry?.supported !== false
  );
  return supportedOptions.find((entry) => entry?.selected) || supportedOptions[0] || null;
}

// Startup exposes a synthetic audio entry as soon as a playback URL exists so
// the controls have something to render. Tizen AVPlay (and webOS) only publish
// the real track list a moment later, so that placeholder must never be treated
// as the final answer for the preferred audio language.
export function hasOnlyImplicitStartupAudioOptions(options = []) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) {
    return true;
  }
  return list.every((option) => Boolean(option?.entry?.implicitAudioTrack));
}
