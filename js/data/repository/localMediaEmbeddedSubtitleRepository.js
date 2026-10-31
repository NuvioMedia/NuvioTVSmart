import { Platform } from "../../platform/index.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";
import { requestWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";

const REQUEST_TIMEOUT_MS = 60000;
const TIZEN_TX3G_PORT = 2715;

function withTimeout(
  promise,
  timeoutMs,
  timeoutMessage = "webOS embedded subtitle request timed out"
) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function getRequestErrorMessage(error, fallback) {
  return String(error?.errorText || error?.message || error?.errorCode || fallback);
}

function createRequestError(error, fallback) {
  const wrapped = new Error(getRequestErrorMessage(error, fallback));
  if (error?.errorCode != null) {
    wrapped.code = String(error.errorCode);
  }
  if (error?.errorDetails != null) {
    wrapped.details = error.errorDetails;
  }
  return wrapped;
}

function getTizenTx3gServiceUrl() {
  const baseUrl = String(TizenEngineFsService.getLocalBaseUrls?.()[0] || "").trim();
  if (!baseUrl) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    parsed.port = String(TIZEN_TX3G_PORT);
    return `${parsed.origin}/tx3g`;
  } catch (_) {
    return "";
  }
}

function getTizenEmbeddedTextServiceUrl() {
  const baseUrl = String(TizenEngineFsService.getLocalBaseUrls?.()[0] || "").trim();
  if (!baseUrl) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    parsed.port = String(TIZEN_TX3G_PORT);
    return `${parsed.origin}/embedded-text`;
  } catch (_) {
    return "";
  }
}

async function requestTizenTx3gWindow({ url, trackNumber, startSeconds, endSeconds }) {
  const capabilities = TizenCapabilities.get();
  if (capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4) {
    throw new Error("Tizen TX3G HTML fallback requires Tizen 4.0 or newer");
  }
  const service = await withTimeout(
    TizenEngineFsService.ensureStarted({ purpose: "subtitle" }),
    REQUEST_TIMEOUT_MS,
    "Tizen TX3G subtitle service start timed out"
  );
  if (service?.status !== "success") {
    throw new Error(service?.detail || "Tizen TX3G subtitle service unavailable");
  }

  const endpoint = getTizenTx3gServiceUrl();
  if (!endpoint) {
    throw new Error("Tizen TX3G subtitle service URL unavailable");
  }
  const query = [
    `url=${encodeURIComponent(String(url || ""))}`,
    `trackNumber=${encodeURIComponent(String(trackNumber))}`,
    `startSeconds=${encodeURIComponent(String(startSeconds))}`,
    `endSeconds=${encodeURIComponent(String(endSeconds))}`
  ].join("&");
  const response = await withTimeout(
    fetch(`${endpoint}?${query}`, { method: "GET", cache: "no-store" }),
    REQUEST_TIMEOUT_MS,
    "Tizen TX3G subtitle request timed out"
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
        `Tizen TX3G request failed with HTTP ${response.status}`
    );
  }
  return payload || {};
}

async function requestTizenSubtitleTimeline({ path, url, trackNumber, trackOrdinal }) {
  const capabilities = TizenCapabilities.get();
  if (capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4) {
    throw new Error("Tizen subtitle timeline requires Tizen 4.0 or newer");
  }
  const service = await withTimeout(
    TizenEngineFsService.ensureStarted({ purpose: "subtitle" }),
    REQUEST_TIMEOUT_MS,
    "Tizen subtitle service start timed out"
  );
  if (service?.status !== "success") {
    throw new Error(service?.detail || "Tizen subtitle service unavailable");
  }

  const baseUrl = String(TizenEngineFsService.getLocalBaseUrls?.()[0] || "").trim();
  if (!baseUrl) {
    throw new Error("Tizen subtitle service URL unavailable");
  }
  let endpoint = "";
  try {
    const parsed = new URL(baseUrl);
    parsed.port = String(TIZEN_TX3G_PORT);
    endpoint = `${parsed.origin}${path}`;
  } catch (_) {
    throw new Error("Tizen subtitle service URL unavailable");
  }

  const query = [`url=${encodeURIComponent(String(url || ""))}`];
  if (Number.isFinite(Number(trackNumber)) && Number(trackNumber) > 0) {
    query.push(`trackNumber=${encodeURIComponent(String(trackNumber))}`);
  }
  if (Number.isFinite(Number(trackOrdinal)) && Number(trackOrdinal) >= 0) {
    query.push(`trackOrdinal=${encodeURIComponent(String(trackOrdinal))}`);
  }
  const response = await withTimeout(
    fetch(`${endpoint}?${query.join("&")}`, { method: "GET", cache: "no-store" }),
    REQUEST_TIMEOUT_MS,
    "Tizen subtitle timeline request timed out"
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
        `Tizen subtitle timeline request failed with HTTP ${response.status}`
    );
  }
  return payload || {};
}

async function requestTizenEmbeddedTextWindow({ url, trackOrdinal, startSeconds, endSeconds }) {
  const capabilities = TizenCapabilities.get();
  if (capabilities.tizenVersionKnown && capabilities.tizenMajorVersion < 4) {
    throw new Error("Tizen embedded text subtitle fallback requires Tizen 4.0 or newer");
  }
  const service = await withTimeout(
    TizenEngineFsService.ensureStarted({ purpose: "subtitle" }),
    REQUEST_TIMEOUT_MS,
    "Tizen embedded text subtitle service start timed out"
  );
  if (service?.status !== "success") {
    throw new Error(service?.detail || "Tizen embedded text subtitle service unavailable");
  }

  const endpoint = getTizenEmbeddedTextServiceUrl();
  if (!endpoint) {
    throw new Error("Tizen embedded text subtitle service URL unavailable");
  }
  const query = [
    `url=${encodeURIComponent(String(url || ""))}`,
    `trackOrdinal=${encodeURIComponent(String(trackOrdinal))}`,
    `startSeconds=${encodeURIComponent(String(startSeconds))}`,
    `endSeconds=${encodeURIComponent(String(endSeconds))}`
  ].join("&");
  const response = await withTimeout(
    fetch(`${endpoint}?${query}`, { method: "GET", cache: "no-store" }),
    REQUEST_TIMEOUT_MS,
    "Tizen embedded text subtitle request timed out"
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
        `Tizen embedded text subtitle request failed with HTTP ${response.status}`
    );
  }
  return payload || {};
}

export const localMediaEmbeddedSubtitleRepository = {
  async getTimeline({ url, trackNumber, trackOrdinal }) {
    const targetUrl = String(url || "").trim();
    const targetTrack = Math.trunc(Number(trackNumber));
    const targetOrdinal = Math.trunc(Number(trackOrdinal));
    const hasTrackNumber = Number.isFinite(targetTrack) && targetTrack > 0;
    const hasTrackOrdinal = Number.isFinite(targetOrdinal) && targetOrdinal >= 0;
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error("Invalid embedded subtitle timeline request");
    }

    const tizenPath = hasTrackOrdinal
      ? "/embedded-text-timeline"
      : hasTrackNumber
        ? "/tx3g-timeline"
        : "/embedded-text-timeline";
    let result;
    try {
      result = await withTimeout(
        Platform.isTizen()
          ? requestTizenSubtitleTimeline({
              path: tizenPath,
              url: targetUrl,
              trackNumber: hasTrackNumber ? targetTrack : undefined,
              trackOrdinal: hasTrackOrdinal ? targetOrdinal : undefined
            })
          : requestWebOsCompanionService({
              method: "embeddedSubtitleTimeline",
              parameters: {
                url: targetUrl,
                trackNumber: hasTrackNumber ? targetTrack : undefined,
                trackOrdinal: hasTrackOrdinal ? targetOrdinal : undefined
              }
            }),
        REQUEST_TIMEOUT_MS
      );
    } catch (error) {
      throw createRequestError(error, "Embedded subtitle timeline extraction failed");
    }

    const payload = result?.payload || result || {};
    if (payload.returnValue === false) {
      throw createRequestError(payload, "Embedded subtitle timeline extraction failed");
    }
    const cues = (Array.isArray(payload.cues) ? payload.cues : [])
      .map((cue) => {
        const startMs = Math.trunc(Number(cue?.startMs));
        const durationMs = Math.trunc(Number(cue?.durationMs));
        return {
          startMs: Number.isFinite(startMs) ? Math.max(0, startMs) : NaN,
          durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null
        };
      })
      .filter((cue) => Number.isFinite(cue.startMs));
    if (!cues.length) {
      throw new Error("Embedded subtitle timeline is empty");
    }
    return {
      trackNumber: Math.trunc(Number(payload.trackNumber)) || (hasTrackNumber ? targetTrack : -1),
      codecId: String(payload.codecId || ""),
      language: String(payload.language || ""),
      name: String(payload.name || ""),
      cueCount: cues.length,
      cues
    };
  },
  async getWindow({
    url,
    trackNumber,
    trackOrdinal,
    startSeconds,
    endSeconds,
    includeAssBody = false
  }) {
    const targetUrl = String(url || "").trim();
    const targetTrack = Math.trunc(Number(trackNumber));
    const targetOrdinal = Math.trunc(Number(trackOrdinal));
    const hasTrackNumber = Number.isFinite(targetTrack) && targetTrack > 0;
    const hasTrackOrdinal = Number.isFinite(targetOrdinal) && targetOrdinal >= 0;
    if (
      !/^https?:\/\//i.test(targetUrl) ||
      (!hasTrackNumber && !(Platform.isTizen() && hasTrackOrdinal))
    ) {
      throw new Error("Invalid embedded text subtitle request");
    }

    let result;
    try {
      result = await withTimeout(
        Platform.isTizen()
          ? hasTrackOrdinal
            ? requestTizenEmbeddedTextWindow({
                url: targetUrl,
                trackOrdinal: targetOrdinal,
                startSeconds: Math.max(0, Number(startSeconds) || 0),
                endSeconds: Math.max(1, Number(endSeconds) || 0)
              })
            : requestTizenTx3gWindow({
                url: targetUrl,
                trackNumber: targetTrack,
                startSeconds: Math.max(0, Number(startSeconds) || 0),
                endSeconds: Math.max(1, Number(endSeconds) || 0)
              })
          : requestWebOsCompanionService({
              method: "embeddedSubtitleTextWindow",
              parameters: {
                url: targetUrl,
                trackNumber: targetTrack,
                startSeconds: Math.max(0, Number(startSeconds) || 0),
                endSeconds: Math.max(1, Number(endSeconds) || 0),
                includeAssBody: Boolean(includeAssBody)
              }
            }),
        REQUEST_TIMEOUT_MS
      );
    } catch (error) {
      throw createRequestError(error, "Embedded text subtitle extraction failed");
    }

    const payload = result?.payload || result || {};
    if (payload.returnValue === false) {
      throw createRequestError(payload, "Embedded text subtitle extraction failed");
    }
    if (payload.bodyTruncated) {
      throw new Error("Embedded text subtitle response is too large");
    }
    const body = String(payload.body || "");
    if (!body.trim()) {
      throw new Error("Embedded text subtitle response is empty");
    }

    return {
      format: String(payload.format || "vtt").toLowerCase(),
      trackNumber:
        Number.isFinite(Number(payload.trackNumber)) && Number(payload.trackNumber) > 0
          ? Math.trunc(Number(payload.trackNumber))
          : targetTrack,
      codecId: String(payload.codecId || ""),
      language: String(payload.language || ""),
      name: String(payload.name || ""),
      windowStartSeconds: Math.max(0, Number(payload.windowStartSeconds) || 0),
      windowEndSeconds: Math.max(0, Number(payload.windowEndSeconds) || 0),
      contextStartSeconds: Math.max(0, Number(payload.contextStartSeconds) || 0),
      cueCount: Math.max(0, Math.trunc(Number(payload.cueCount) || 0)),
      hasAssOverrideTags: Boolean(payload.hasAssOverrideTags),
      hasAdvancedAssOverrideTags: Boolean(payload.hasAdvancedAssOverrideTags),
      assBody: String(payload.assBody || ""),
      body
    };
  }
};
