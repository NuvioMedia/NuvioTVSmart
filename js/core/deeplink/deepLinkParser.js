/**
 * Web port of the Android TV app's title deep links (core/deeplink/DeepLinkParser.kt, AppDeepLink.Meta).
 *
 * Accepts the same nuvio:// forms as Android TV, so other apps can open a title on its detail screen:
 *   nuvio://detail/movie/tt0133093, nuvio://open/series/tt0903747 (also details, watch)
 *   nuvio://movie/tt0133093, nuvio://series/tt0903747 (also movies, show, shows, tv)
 *   nuvio://tmdb/movie/603, nuvio://imdb/series/tt0903747, nuvio://tmdb/603?type=movie
 *   nuvio://meta?type=movie&tmdb=603 (or id/imdb/imdbId, tmdbId)
 * Addon install, party and auth links stay Android only.
 */

/**
 * @param {string} url
 * @returns {{ type: "movie" | "series", id: string } | null}
 */
export function parseTitleDeepLink(url) {
  if (typeof url !== "string" || /[\s<>"{}|\\^`]|%(?![0-9a-f]{2})/i.test(url.trim())) {
    return null;
  }
  const match = /^nuvio:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!match) {
    return null;
  }
  const host = match[1].toLowerCase();
  const segments = match[2]
    .split("/")
    .map((segment) => decode(segment).trim())
    .filter(Boolean);
  const parameters = queryParameters(match[3] || "");

  switch (host) {
    case "meta":
      return metaFromParameters(parameters) || metaFromPath(segments);
    case "detail":
    case "details":
    case "open":
    case "watch":
      return metaFromPath(segments);
    case "movie":
    case "movies":
    case "series":
    case "show":
    case "shows":
    case "tv":
      return meta(normalizeMediaType(host), normalizeId(segments[0] || ""));
    case "imdb":
    case "tmdb":
      return providerMeta(host, segments, parameters);
    default:
      return null;
  }
}

function metaFromParameters(parameters) {
  const type = normalizeMediaType(
    firstParameter(parameters, "type", "mediaType", "media_type") || ""
  );
  const imdb = firstParameter(parameters, "id", "imdb", "imdbId", "imdb_id");
  const tmdb = firstParameter(parameters, "tmdb", "tmdbId", "tmdb_id");
  const id = imdb ? normalizeId(imdb) : tmdb ? tmdbId(tmdb) : "";
  return meta(type, id);
}

function metaFromPath(segments) {
  if (segments.length < 2) {
    return null;
  }
  return meta(normalizeMediaType(segments[0]), normalizeId(segments[1]));
}

function providerMeta(provider, segments, parameters) {
  const firstAsType = normalizeMediaType(segments[0] || "");
  const type =
    firstAsType ||
    normalizeMediaType(firstParameter(parameters, "type", "mediaType", "media_type") || "");
  const rawId = (firstAsType ? segments[1] : segments[0]) || "";
  return meta(type, provider === "tmdb" ? tmdbId(rawId) : normalizeId(rawId));
}

function meta(type, id) {
  return type && id ? { type, id } : null;
}

function tmdbId(value) {
  const id = String(value)
    .trim()
    .replace(/^tmdb:/, "")
    .trim();
  return id ? `tmdb:${id}` : "";
}

function normalizeMediaType(value) {
  switch (String(value).trim().toLowerCase()) {
    case "movie":
    case "movies":
    case "film":
    case "films":
      return "movie";
    case "series":
    case "show":
    case "shows":
    case "tv":
    case "tvshow":
    case "tvshows":
      return "series";
    default:
      return "";
  }
}

function normalizeId(value) {
  return String(value)
    .trim()
    .replace(/^imdb:/, "");
}

function queryParameters(query) {
  const parameters = Object.create(null);
  query.split("&").forEach((pair) => {
    const index = pair.indexOf("=");
    if (index < 0) {
      return;
    }
    const key = decode(pair.slice(0, index)).trim();
    const value = decode(pair.slice(index + 1)).trim();
    if (key && value) {
      parameters[key] = value;
    }
  });
  return parameters;
}

function firstParameter(parameters, ...keys) {
  for (const key of keys) {
    if (parameters[key]) {
      return parameters[key];
    }
  }
  return null;
}

function decode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch (error) {
    return value;
  }
}
