/**
 * Whether Back on the full-screen trailer should hand playback back to the detail page as a
 * background trailer instead of stopping it. Ported from Android
 * MetaDetailsViewModel.shouldContinueTrailerInBackgroundOnBack.
 */
export function shouldContinueTrailerInBackgroundOnBack({
  isTrailerPlaying = false,
  autoplayEnabled = false,
  playInBackground = false
} = {}) {
  return Boolean(isTrailerPlaying && autoplayEnabled && playInBackground);
}
