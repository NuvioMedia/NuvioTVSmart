import { TRAILER_API_URL } from "../../config.js";
import { httpRequest } from "../network/httpClient.js";

// Android's TrailerService keeps resolved YouTube sources for 3h; mirror that
// so repeated Home focus does not re-query the configured resolver.
const TRAILER_API_TIMEOUT_MS = 2500;
const TRAILER_API_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const TRAILER_API_CACHE_MAX_ENTRIES = 64;
const resolvedTrailerUrls = new Map();

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || "").trim());
}

function buildTrailerApiEndpoint(base, ytId, title, year) {
  const endpoint = new URL("trailer", /\/$/.test(base) ? base : `${base}/`);
  endpoint.searchParams.set("youtube_url", `https://www.youtube.com/watch?v=${ytId}`);
  if (title) {
    endpoint.searchParams.set("title", title);
  }
  if (year) {
    endpoint.searchParams.set("year", year);
  }
  return endpoint.toString();
}

export async function resolveTrailerVideoUrl(ytId, { title = "", year = "" } = {}) {
  const id = String(ytId || "").trim();
  const base = String(TRAILER_API_URL || "").trim();
  if (!id || !/^https?:\/\//i.test(base)) {
    return "";
  }
  const cached = resolvedTrailerUrls.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  let endpoint = "";
  try {
    endpoint = buildTrailerApiEndpoint(
      base,
      id,
      String(title || "").trim(),
      String(year || "").trim()
    );
  } catch (_) {
    return "";
  }
  try {
    const payload = await httpRequest(endpoint, {
      includeSessionAuth: false,
      timeoutMs: TRAILER_API_TIMEOUT_MS,
      cache: "no-store"
    });
    const url = String(payload?.url || "").trim();
    if (!isHttpUrl(url)) {
      return "";
    }
    // Signed media URLs carry their own expiry; never outlive it.
    const signedExpiryMs = Number(url.match(/\/expire\/(\d+)\//)?.[1] || 0) * 1000;
    resolvedTrailerUrls.delete(id);
    resolvedTrailerUrls.set(id, {
      url,
      expiresAt: signedExpiryMs > 0 ? signedExpiryMs : Date.now() + TRAILER_API_CACHE_TTL_MS
    });
    while (resolvedTrailerUrls.size > TRAILER_API_CACHE_MAX_ENTRIES) {
      resolvedTrailerUrls.delete(resolvedTrailerUrls.keys().next().value);
    }
    return url;
  } catch (_) {
    return "";
  }
}

export async function withResolvedTrailerSource(source, { title = "", year = "" } = {}) {
  if (!source || source.kind !== "youtube" || !source.ytId) {
    return source;
  }
  const ytId = String(source.ytId);
  const url = await resolveTrailerVideoUrl(ytId, { title, year });
  return url ? { kind: "video", url, ytId } : source;
}
