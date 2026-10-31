import { Platform } from "../../platform/index.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";
import { requestWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";

const REQUEST_TIMEOUT_MS = 30000;
const WINDOW_REQUEST_TIMEOUT_MS = 60000;
const TIZEN_BITMAP_SUBTITLE_PORT = 2715;
const preparedSources = new Map();
const MAX_PREPARED_SOURCES = 4;

function withTimeout(promise, timeoutMs, message = "Embedded bitmap subtitle request timed out") {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function decodeBase64(value) {
  const binary = globalThis.atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getRequestErrorMessage(error, fallback) {
  return String(error?.errorText || error?.message || error?.errorCode || fallback);
}

function getTizenBitmapSubtitleServiceUrl() {
  const baseUrl = String(TizenEngineFsService.getLocalBaseUrls?.()[0] || "").trim();
  if (!baseUrl) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    parsed.port = String(TIZEN_BITMAP_SUBTITLE_PORT);
    return `${parsed.origin}/bitmap-subtitle`;
  } catch (_) {
    return "";
  }
}

async function requestTizenBitmapSubtitleWindow({ url, trackNumber, startSeconds, endSeconds }) {
  const capabilities = TizenCapabilities.get();
  if (
    (capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4) ||
    !capabilities.supportsWebService
  ) {
    throw new Error("Tizen bitmap subtitles are not supported on this TV");
  }
  const service = await withTimeout(
    TizenEngineFsService.ensureStarted({ purpose: "subtitle" }),
    REQUEST_TIMEOUT_MS,
    "Tizen bitmap subtitle service start timed out"
  );
  if (service?.status !== "success") {
    throw new Error(service?.detail || "Tizen bitmap subtitle service unavailable");
  }

  const endpoint = getTizenBitmapSubtitleServiceUrl();
  if (!endpoint) {
    throw new Error("Tizen bitmap subtitle service URL unavailable");
  }
  const query = [
    `url=${encodeURIComponent(String(url || ""))}`,
    `trackNumber=${encodeURIComponent(String(trackNumber))}`,
    `startSeconds=${encodeURIComponent(String(startSeconds))}`,
    `endSeconds=${encodeURIComponent(String(endSeconds))}`
  ].join("&");
  const response = await withTimeout(
    fetch(`${endpoint}?${query}`, { method: "GET", cache: "no-store" }),
    WINDOW_REQUEST_TIMEOUT_MS,
    "Tizen bitmap subtitle request timed out"
  );
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok || payload?.returnValue === false) {
    throw new Error(
      payload?.errorText ||
        payload?.errorCode ||
        `Tizen bitmap subtitle request failed with HTTP ${response.status}`
    );
  }
  return payload || {};
}

function normalizeWindowPayload(payload, targetTrack) {
  const format = String(payload.format || "").toLowerCase();
  if (format !== "vobsub" && format !== "pgs") {
    throw new Error("Unsupported bitmap subtitle response");
  }
  const encodedData = format === "pgs" ? payload.supBase64 : payload.subBase64;

  return {
    format,
    trackNumber: targetTrack,
    windowStartSeconds: Math.max(0, Number(payload.windowStartSeconds) || 0),
    windowEndSeconds: Math.max(0, Number(payload.windowEndSeconds) || 0),
    contextStartSeconds: Math.max(0, Number(payload.contextStartSeconds) || 0),
    contextType: String(payload.contextType || ""),
    cueCount: Math.max(0, Math.trunc(Number(payload.cueCount) || 0)),
    segmentCount: Math.max(0, Math.trunc(Number(payload.segmentCount) || 0)),
    idxContent: format === "vobsub" ? String(payload.idxContent || "") : "",
    data: decodeBase64(encodedData)
  };
}

export const localMediaBitmapSubtitleRepository = {
  async prepare(url) {
    const targetUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error("Invalid embedded bitmap subtitle source");
    }
    if (preparedSources.has(targetUrl)) {
      return preparedSources.get(targetUrl);
    }
    const request = withTimeout(
      requestWebOsCompanionService({
        method: "bitmapSubtitlePrepare",
        parameters: { url: targetUrl }
      }),
      REQUEST_TIMEOUT_MS
    )
      .then((result) => {
        const payload = result?.payload || {};
        if (payload.returnValue === false) {
          throw new Error(
            payload.errorText || payload.errorCode || "Bitmap subtitle preparation failed"
          );
        }
        return payload;
      })
      .catch((error) => {
        preparedSources.delete(targetUrl);
        throw error;
      });
    preparedSources.set(targetUrl, request);
    while (preparedSources.size > MAX_PREPARED_SOURCES) {
      preparedSources.delete(preparedSources.keys().next().value);
    }
    return request;
  },

  async getWindow({ url, trackNumber, startSeconds, endSeconds }) {
    const targetUrl = String(url || "").trim();
    const targetTrack = Math.trunc(Number(trackNumber));
    if (!/^https?:\/\//i.test(targetUrl) || !Number.isFinite(targetTrack) || targetTrack <= 0) {
      throw new Error("Invalid embedded bitmap subtitle request");
    }

    let result;
    try {
      result = await withTimeout(
        Platform.isTizen()
          ? requestTizenBitmapSubtitleWindow({
              url: targetUrl,
              trackNumber: targetTrack,
              startSeconds: Math.max(0, Number(startSeconds) || 0),
              endSeconds: Math.max(1, Number(endSeconds) || 0)
            })
          : requestWebOsCompanionService({
              method: "bitmapSubtitleWindow",
              parameters: {
                url: targetUrl,
                trackNumber: targetTrack,
                startSeconds: Math.max(0, Number(startSeconds) || 0),
                endSeconds: Math.max(1, Number(endSeconds) || 0)
              }
            }),
        WINDOW_REQUEST_TIMEOUT_MS
      );
    } catch (error) {
      throw new Error(getRequestErrorMessage(error, "Bitmap subtitle extraction failed"));
    }
    const payload = result?.payload || result || {};
    if (payload.returnValue === false) {
      throw new Error(
        payload.errorText || payload.errorCode || "Bitmap subtitle extraction failed"
      );
    }
    return normalizeWindowPayload(payload, targetTrack);
  }
};
