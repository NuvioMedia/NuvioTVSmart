import { TizenEngineFsService } from "./tizenEngineFsService.js";

const NATIVE_AVPLAY_REQUEST_HEADERS = new Set(["cookie", "user-agent"]);
const HLS_BROWSER_RESTRICTED_HEADERS = new Set(["cookie", "user-agent"]);
const BROWSER_HLS_ENGINES = new Set(["hls.js", "native-hls"]);
const HOP_BY_HOP_HEADERS = new Set(["connection", "content-length", "host", "range", "transfer-encoding"]);

function normalizeHeaderEntries(headers = {}) {
  if (!headers || typeof headers !== "object") {
    return [];
  }
  return Object.entries(headers)
    .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
    .filter(([key, value]) => key && value)
    .filter(([key]) => !HOP_BY_HOP_HEADERS.has(key.toLowerCase()))
    .filter(([key, value]) => !key.includes("\r") && !key.includes("\n") && !value.includes("\r") && !value.includes("\n"));
}

function parseHttpUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function isLocalProxyUrl(value = "") {
  const parsed = parseHttpUrl(value);
  if (!parsed || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) {
    return false;
  }
  return parsed.pathname.startsWith("/proxy/");
}

export function hasTizenUnsupportedPlaybackHeaders(headers = {}) {
  return normalizeHeaderEntries(headers).some(([key]) => !NATIVE_AVPLAY_REQUEST_HEADERS.has(key.toLowerCase()));
}

export function buildTizenPlaybackProxyUrl(baseUrl, sourceUrl, headers = {}) {
  const base = parseHttpUrl(baseUrl);
  const source = parseHttpUrl(sourceUrl);
  const entries = normalizeHeaderEntries(headers);
  if (!base || !source) {
    return "";
  }

  const options = new URLSearchParams();
  options.set("d", `${source.protocol}//${source.host}`);
  entries.forEach(([key, value]) => {
    options.append("h", `${key}:${value}`);
  });

  const root = `${base.protocol}//${base.host}`.replace(/\/+$/, "");
  return `${root}/proxy/${options.toString()}${source.pathname || "/"}${source.search}`;
}

export const TizenPlaybackProxy = {
  requiresProxy(sourceUrl = "", headers = {}, { playbackEngine = "", resolveRedirects = true } = {}) {
    const engine = String(playbackEngine || "")
      .trim()
      .toLowerCase();
    // AVPlay can set Cookie and User-Agent itself. Browser HLS paths cannot,
    // so keep those declared source headers on the EngineFS request instead.
    const browserHlsNeedsRestrictedHeaders =
      BROWSER_HLS_ENGINES.has(engine) &&
      normalizeHeaderEntries(headers).some(([key]) => HLS_BROWSER_RESTRICTED_HEADERS.has(key.toLowerCase()));
    return Boolean(
      parseHttpUrl(sourceUrl) &&
      !isLocalProxyUrl(sourceUrl) &&
      ((resolveRedirects && /(^|[.-])aiostreams([.-]|$)/i.test(parseHttpUrl(sourceUrl).hostname)) ||
        hasTizenUnsupportedPlaybackHeaders(headers) ||
        browserHlsNeedsRestrictedHeaders)
    );
  },

  async resolve(sourceUrl = "", headers = {}, options = {}) {
    const originalUrl = String(sourceUrl || "").trim();
    if (!this.requiresProxy(originalUrl, headers, options)) {
      return { status: "not-required", url: originalUrl, proxied: false };
    }

    let service;
    try {
      service = await TizenEngineFsService.ensureStarted({ purpose: "playback-proxy" });
    } catch (error) {
      return {
        status: "unavailable",
        url: originalUrl,
        proxied: false,
        detail: error?.message || String(error || "Tizen playback proxy service unavailable")
      };
    }
    const baseUrl = String(service?.baseUrl || "").trim();
    if (service?.status !== "success" || !baseUrl) {
      return {
        status: "unavailable",
        url: originalUrl,
        proxied: false,
        detail: service?.detail || "Tizen playback proxy service unavailable"
      };
    }

    const proxyUrl = buildTizenPlaybackProxyUrl(baseUrl, originalUrl, headers);
    if (!proxyUrl) {
      return {
        status: "unavailable",
        url: originalUrl,
        proxied: false,
        detail: "Tizen playback proxy URL could not be built"
      };
    }

    return {
      status: "success",
      url: proxyUrl,
      proxied: true,
      baseUrl,
      headerNames: normalizeHeaderEntries(headers).map(([key]) => key)
    };
  }
};
