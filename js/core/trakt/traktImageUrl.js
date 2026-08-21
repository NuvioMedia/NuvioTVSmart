// Ported from Android NuvioTV core/trakt/TraktImageUtils.kt so web renders the
// same Trakt artwork as the app.
//
// The Trakt API returns image URLs without a scheme, e.g.
// "media.trakt.tv/images/movies/poster.jpg.webp". A browser treats that as a
// relative path and the poster fails to load, so we restore the https scheme
// the app applies before using the URL.

const TRAKT_HOST_PATTERN = /^[a-z0-9.-]*trakt\.tv\//i;

// Returns the URL with an https scheme when it points at a Trakt host, leaving
// already-absolute or unrelated URLs untouched.
export function toTraktImageUrl(value) {
  const normalized = String(value || "").trim();
  if (/^https:\/\//i.test(normalized)) {
    return normalized;
  }
  if (/^http:\/\//i.test(normalized)) {
    return `https://${normalized.slice(normalized.indexOf("://") + 3)}`;
  }
  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }
  if (TRAKT_HOST_PATTERN.test(normalized)) {
    return `https://${normalized}`;
  }
  return normalized;
}
