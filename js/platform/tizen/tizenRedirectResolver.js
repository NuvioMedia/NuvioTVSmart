// Resolve HTTP redirects for direct (non-proxied) Tizen AVPlay sources.
//
// Addon stream URLs are usually redirect endpoints (AIOStreams playback links,
// debrid "resolve" URLs, ...). AVPlay follows the redirect for the initial
// request but rejects every later seekTo()/jumpForward() on such sources with
// PLAYER_ERROR_INVALID_STATE. When the bundled Tizen proxy service is
// available it resolves these redirects itself; on TVs where the WRT service
// API is unavailable the raw redirect URL reached AVPlay and seeking failed.
//
// This helper performs one ranged GET, lets the platform follow redirects,
// and returns the final media URL. It never throws and always falls back to
// the original URL.

const DEFAULT_TIMEOUT_MS = 6000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parseHttpUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function hasHeadersThatCannotBeReplayed(headers = {}) {
  if (!headers || typeof headers !== "object") {
    return false;
  }
  // AVPlay forwards Cookie/User-Agent itself; a resolved CDN URL that needs
  // other request headers could not be played without them, so keep the
  // original URL in that case.
  return Object.entries(headers).some(([key, value]) => {
    const name = String(key || "")
      .trim()
      .toLowerCase();
    return name && String(value ?? "").trim() && name !== "user-agent";
  });
}

function isAdaptiveManifestUrl(parsed) {
  return /\.(m3u8|mpd)$/i.test(parsed.pathname || "");
}

// A header-less probe only proves the source plays without the addon headers
// when the server actually returned media (not a 200 HTML/challenge page).
export function isDirectMediaProbeResponse(details = {}) {
  const status = Number(details?.status || 0);
  const contentType = String(details?.contentType || "").toLowerCase();
  if (status === 206) return true;
  return status === 200 && /^(video|audio)\/|^application\/(octet-stream|mp4)/.test(contentType);
}

export function describeSourceHost(value = "") {
  const parsed = parseHttpUrl(value);
  return parsed ? parsed.host : null;
}

export async function resolveTizenDirectRedirect(
  sourceUrl = "",
  headers = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}
) {
  const originalUrl = String(sourceUrl || "").trim();
  const parsed = parseHttpUrl(originalUrl);
  const skip = (reason) => ({ url: originalUrl, redirected: false, reason });

  if (!parsed) return skip("not-http");
  if (LOCAL_HOSTS.has(parsed.hostname)) return skip("local");
  if (isAdaptiveManifestUrl(parsed)) return skip("adaptive-manifest");
  if (hasHeadersThatCannotBeReplayed(headers)) return skip("request-headers");
  if (typeof fetchImpl !== "function") return skip("no-fetch");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  try {
    const request = fetchImpl(originalUrl, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      cache: "no-store",
      credentials: "omit",
      signal: controller?.signal
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort?.();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const response = await Promise.race([request, timeout]);
    clearTimeout(timer);
    // Only the status line and headers are needed; stop the body transfer.
    try {
      response?.body?.cancel?.();
    } catch (_) {
      // Ignore body cancellation failures.
    }
    controller?.abort?.();

    const finalUrl = String(response?.url || "").trim();
    const readHeader = (name) => {
      try {
        return response?.headers?.get?.(name) || null;
      } catch (_) {
        return null;
      }
    };
    const details = {
      status: Number(response?.status || 0) || null,
      acceptRanges: readHeader("accept-ranges"),
      contentRange: readHeader("content-range"),
      contentType: readHeader("content-type")
    };
    const parsedFinal = parseHttpUrl(finalUrl);
    if (!parsedFinal || finalUrl === originalUrl) {
      return { url: originalUrl, redirected: false, reason: "no-redirect", details };
    }
    return { url: finalUrl, redirected: true, reason: "resolved", details };
  } catch (error) {
    clearTimeout(timer);
    return skip(error?.message === "timeout" ? "timeout" : "fetch-failed");
  }
}
