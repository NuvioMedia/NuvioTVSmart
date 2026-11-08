import { Platform } from "../../platform/index.js";
import { getTvArtworkPixelRatio } from "../../platform/tvRuntimePerformance.js";

const TMDB_IMAGE_HOST_PATTERN = /^(?:https?:)?\/\/image\.tmdb\.org\//i;

// Match Android TV: Home and library poster cards use w500 sources.
const TMDB_CARD_POSTER_SIZE = "w500";
// Tizen 4/5.0 and webOS 5 and older lack OffscreenCanvas, so tvPosterRescaler
// cannot downscale card posters off the main thread there and every poster
// decodes at its source size. Those 1080p panels paint the widest poster card
// (305 CSS px) at one device pixel per CSS pixel, which w342 still covers; a
// 4K panel paints it at two and keeps w500 so it stays as sharp as Android TV.
const TMDB_LEGACY_TV_CARD_POSTER_SIZE = "w342";

let cachedCardPosterSize = null;

function tvCanUseSmallCardPosters() {
  // A rescaler-less TV that paints at one device pixel per CSS pixel can take
  // w342; a panel that paints larger keeps w500 so it stays sharp.
  const isTv = Boolean(Platform.isTizen?.() || Platform.isWebOS?.());
  return isTv && typeof OffscreenCanvas === "undefined" && getTvArtworkPixelRatio() === 1;
}

/**
 * TMDB size used for poster-shaped Home/library cards. Computed once per run.
 */
export function preferredTmdbCardPosterSize() {
  if (cachedCardPosterSize === null) {
    cachedCardPosterSize = tvCanUseSmallCardPosters()
      ? TMDB_LEGACY_TV_CARD_POSTER_SIZE
      : TMDB_CARD_POSTER_SIZE;
  }
  return cachedCardPosterSize;
}

export function resetPreferredTmdbCardPosterSizeForTests() {
  cachedCardPosterSize = null;
}

/**
 * Keep Home artwork within the source sizes used by Android TV.
 * Keep unrelated artwork URLs byte-for-byte unchanged.
 */
export function normalizeTmdbBackdropUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(\/t\/p\/)(?:original|w780)\//i, "$1w1280/");
}

export function normalizeTmdbPosterUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  const size = preferredTmdbCardPosterSize();
  // Addon catalogs (TMDB addon, AIOMetadata, ...) send w500 posters directly;
  // only a TV without the rescaler trades those down as well.
  const oversized =
    size === TMDB_CARD_POSTER_SIZE ? /(\/t\/p\/)original\//i : /(\/t\/p\/)(?:original|w500)\//i;
  return normalized.replace(oversized, `$1${size}/`);
}
