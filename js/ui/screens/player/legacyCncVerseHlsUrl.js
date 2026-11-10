/**
 * The CNCVerse bridge used to publish HLS masters at `/d/master.m3u8`. Its
 * current relay serves the same stream at `/proxy/mpd/manifest.m3u8`; the old
 * alias can answer 416 on the media playlist and init segment while the
 * current route works. Used only as a one-shot recovery after a 416.
 *
 * shortcut: maps the legacy CNCVerse `/d/` layout only; remove when the addon
 * stops emitting it.
 */
export function toCurrentCncVerseHlsUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return null;
  }
  if (
    !/\/d\/master\.m3u8$/i.test(parsed.pathname) ||
    !parsed.searchParams.get("d") ||
    !parsed.searchParams.get("h_x_cnc_plugin")
  ) {
    return null;
  }
  parsed.pathname = parsed.pathname.replace(/\/d\/master\.m3u8$/i, "/proxy/mpd/manifest.m3u8");
  return parsed.toString();
}
