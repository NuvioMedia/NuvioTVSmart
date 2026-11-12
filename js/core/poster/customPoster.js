import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { CUSTOM_POSTER_SCREENS } from "./customPosterScreens.js";
import {
  normalizeTmdbBackdropUrl,
  normalizeTmdbPosterUrl,
  preferredTmdbCardPosterSize
} from "../tmdb/tmdbImageUrl.js";
import { Platform } from "../../platform/index.js";
export { CUSTOM_POSTER_SCREENS } from "./customPosterScreens.js";
const prepared = new Map();
export function extractPosterIds(id, imdbId = null) {
  const ids = { id: String(id || "") };
  const namespaces = {
    tmdb: "tmdb_id",
    tvdb: "tvdb_id",
    kitsu: "kitsu_id",
    anilist: "anilist_id",
    mal: "mal_id",
    anidb: "anidb_id"
  };
  if (ids.id.startsWith("tt")) ids.imdb_id = ids.id;
  else {
    const at = ids.id.indexOf(":");
    const key = namespaces[ids.id.slice(0, at)];
    if (at >= 0 && key) ids[key] = ids.id.slice(at + 1);
  }
  if (imdbId) ids.imdb_id = imdbId;
  return ids;
}
function prepare(pattern) {
  if (prepared.has(pattern)) return prepared.get(pattern);
  const decoded = pattern.replace(/%7b/gi, "{").replace(/%7d/gi, "}").replace(/%7c/gi, "|");
  const tokens = [...decoded.matchAll(/\{([a-z_]+(?:\|[a-z_]+)*)(\?)?\}/g)];
  const value = {
    decoded,
    tokens,
    rpdb: ["ratingposterdb.com", "aioratings.com", "top-posters.com", "btttr.cc"].some((domain) =>
      decoded.includes(domain)
    )
  };
  if (prepared.size >= 32) prepared.delete(prepared.keys().next().value);
  prepared.set(pattern, value);
  return value;
}
function fill(pattern, ids, type, shape, allowLiteral = true) {
  const { decoded, tokens } = prepare(pattern);
  if (!tokens.length) return allowLiteral ? decoded : null;
  const at = ids.id.indexOf(":");
  const idType = ids.id.startsWith("tt") ? "imdb" : at >= 0 ? ids.id.slice(0, at) : "unknown";
  const raw = at >= 0 && idType !== "imdb" ? ids.id.slice(at + 1) : ids.id;
  const values = {
    ...ids,
    id_type: idType,
    typed_id: ["tmdb", "tvdb"].includes(idType)
      ? `${type === "movie" ? "movie" : "series"}-${raw}`
      : raw,
    type,
    shape
  };
  for (const key of [
    "imdb_id",
    "tmdb_id",
    "tvdb_id",
    "kitsu_id",
    "anilist_id",
    "mal_id",
    "anidb_id"
  ])
    values[key] ||= "";
  let result = "",
    cursor = 0;
  for (const token of tokens) {
    result += decoded.slice(cursor, token.index);
    const keys = token[1].split("|");
    if (keys.length > 1) {
      const value = keys.map((key) => values[key]).find((value) => value != null && value !== "");
      if (value == null) return null;
      result += value;
    } else {
      const value = values[keys[0]];
      if (value === "" && !token[2]) return null;
      result += value == null ? token[0] : value;
    }
    cursor = token.index + token[0].length;
  }
  return result + decoded.slice(cursor);
}
export function resolveCustomPoster(pattern, ids, type, shape = "poster") {
  if (!pattern?.trim()) return null;
  const { decoded, tokens, rpdb } = prepare(pattern);
  if (!tokens.length) return null;
  const direct = fill(decoded, ids, type, shape);
  if (direct != null || !rpdb) return direct;
  const prefix = type === "movie" ? "movie" : "series";
  const fallbacks = [];
  if (decoded.includes("{imdb_id}")) {
    for (const target of ["tmdb", "tvdb"])
      if (ids[`${target}_id`])
        fallbacks.push(
          decoded
            .replaceAll("/imdb/", `/${target}/`)
            .replaceAll("{imdb_id}", `${prefix}-${ids[`${target}_id`]}`)
        );
  } else
    for (const source of ["tmdb", "tvdb"]) {
      if (!decoded.includes(`{${source}_id}`)) continue;
      if (ids.imdb_id)
        fallbacks.push(
          decoded
            .replaceAll(`/${source}/`, "/imdb/")
            .replaceAll(`${prefix}-{${source}_id}`, ids.imdb_id)
            .replaceAll(`{${source}_id}`, ids.imdb_id)
        );
      const target = source === "tmdb" ? "tvdb" : "tmdb";
      if (ids[`${target}_id`])
        fallbacks.push(
          decoded
            .replaceAll(`/${source}/`, `/${target}/`)
            .replaceAll(`{${source}_id}`, ids[`${target}_id`])
        );
      break;
    }
  for (const fallback of fallbacks) {
    const resolved = fill(fallback, ids, type, shape);
    if (resolved != null) return resolved;
  }
  return null;
}
// Android decodes a poster at the size of its card whatever the source is.
// An <img> decodes the whole file: an 800x1200 poster in a 221x339 card cost a
// 2019 Tizen set 408 ms of decoding for every row scrolled into view (130 ms
// at 342 px). Services that resize on request are asked for the card's width,
// the same width the TV takes from TMDB. Other hosts stay untouched.
const WIDTH_PARAM_BY_HOST = { "easyposters.realbestia.com": "w" };
function tvCardSizedPoster(url) {
  if (!url || !(Platform.isTizen() || Platform.isWebOS())) return url;
  const param = WIDTH_PARAM_BY_HOST[/^https?:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase()];
  if (!param || new RegExp(`[?&]${param}=`).test(url)) return url;
  const width = preferredTmdbCardPosterSize().slice(1);
  return `${url}${url.includes("?") ? "&" : "?"}${param}=${width}`;
}
export function customPosterForItem(
  item,
  screen,
  shape = "poster",
  settings = LayoutPreferences.get()
) {
  if (!item) return item;
  // Keep every screen on the same source sizes as Home. The helpers are
  // idempotent and leave artwork from any other host byte-for-byte unchanged.
  const normalizedItem = {
    ...item,
    poster: tvCardSizedPoster(normalizeTmdbPosterUrl(item.poster)),
    backdrop: normalizeTmdbBackdropUrl(item.backdrop),
    background: normalizeTmdbBackdropUrl(item.background),
    landscapePoster: normalizeTmdbBackdropUrl(item.landscapePoster),
    episodeThumbnail: normalizeTmdbBackdropUrl(item.episodeThumbnail)
  };
  item = normalizedItem;
  const pattern = settings.customPosterUrlPattern;
  if (!item || !pattern || !settings.customPosterEnabledScreens?.includes(screen)) return item;
  const supportsShape = prepare(pattern).decoded.includes("{shape}");
  if (!supportsShape && shape !== "poster") return item;
  const ids = extractPosterIds(item.id || item.contentId, item.imdbId || item.imdb_id);
  const type = item.apiType || item.type || item.contentType || "movie";
  const poster =
    shape === "poster"
      ? tvCardSizedPoster(resolveCustomPoster(pattern, ids, type, shape))
      : resolveCustomPoster(pattern, ids, type, shape);
  const landscape = supportsShape ? resolveCustomPoster(pattern, ids, type, "landscape") : null;
  if (!poster && !landscape) return item;
  return {
    ...item,
    rawPosterUrl: item.rawPosterUrl || item.poster,
    rawLandscapePosterUrl:
      item.rawLandscapePosterUrl || item.landscapePoster || item.background || item.backdrop,
    ...(screen === "continue_watching" ? { backdrop: landscape || item.backdrop } : {}),
    poster: poster || item.poster,
    landscapePoster: landscape || item.landscapePoster
  };
}
export function posterFallbackAttributes(item, landscape = false) {
  const raw = landscape ? item?.rawLandscapePosterUrl : item?.rawPosterUrl;
  if (!raw) return "";
  const normalized = landscape ? normalizeTmdbBackdropUrl(raw) : normalizeTmdbPosterUrl(raw);
  const escaped = String(normalized)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return ` data-original-poster="${escaped}"`;
}
let fallbackInstalled = false;
export function installCustomPosterFallback() {
  if (fallbackInstalled) return;
  fallbackInstalled = true;
  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (image?.tagName !== "IMG") return;
      const original = image.dataset?.originalPoster;
      if (original) {
        delete image.dataset.originalPoster;
        if (image.getAttribute("src") !== original) {
          event.stopImmediatePropagation();
          image.src = original;
          return;
        }
      }
      // Out of fallbacks: Chromium would draw the alt text over a broken frame.
      // Leave the empty card surface instead, like Android TV's failed artwork.
      // Logos keep their alt text; callers render the title in their place.
      if (!image.dataset?.fallbackSrcs && !/logo/i.test(image.className)) {
        image.alt = "";
        image.classList.add("placeholder");
      }
    },
    true
  );
  // A re-hydrated image that loads after an earlier failure must show again.
  document.addEventListener(
    "load",
    (event) => {
      const image = event.target;
      if (image?.tagName === "IMG" && image.classList.contains("placeholder")) {
        image.classList.remove("placeholder");
      }
    },
    true
  );
}
