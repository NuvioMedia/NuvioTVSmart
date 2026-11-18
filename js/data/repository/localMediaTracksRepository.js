import { Platform } from "../../platform/index.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";
import { withRequestTimeout } from "../../core/network/requestTimeout.js";
import { fetchMatroskaTracks } from "./matroskaTrackMetadata.js";
import {
  isWebOsCompanionServiceAvailable,
  requestWebOsCompanionService
} from "../../platform/webos/webosCompanionService.js";
import {
  isEmbeddedTrackContainerSupported,
  isTerminalTrackDiscoveryResponse
} from "./embeddedTrackSupport.js";

const LOCAL_MEDIA_SERVER_PORT_CANDIDATES = [2710, 2711, 2712, 2713, 2714];
const REQUEST_TIMEOUT_MS = 4000;
const TRACK_CACHE_TTL_MS = 30000;
const WEBOS_EMPTY_TRACK_CACHE_TTL_MS = 5000;
const UNSUPPORTED_TRACK_CACHE_TTL_MS = 10 * 60 * 1000;
const WEBOS_LUNA_TRACK_ATTEMPTS = 6;
const WEBOS_LUNA_TRACK_RETRY_DELAY_MS = 700;
const TIZEN_TRACK_SERVICE_GRACE_MS = 2000;
const pendingTizenServiceTracks = new Map();

class TerminalTrackDiscoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "TerminalTrackDiscoveryError";
    this.terminal = true;
  }
}

let cachedLocalMediaServerPort = LOCAL_MEDIA_SERVER_PORT_CANDIDATES[0];
const tracksCache = new Map();
const inFlightTrackRequests = new Map();

function getCandidatePorts() {
  const ordered = [cachedLocalMediaServerPort, ...LOCAL_MEDIA_SERVER_PORT_CANDIDATES];
  return Array.from(new Set(ordered.filter((port) => Number.isFinite(Number(port)))));
}

function buildTracksUrl(port, mediaUrl) {
  return `http://127.0.0.1:${port}/tracks/${encodeURIComponent(String(mediaUrl || "").trim())}`;
}

function buildSameOriginTracksUrl(mediaUrl) {
  return `/tracks/${encodeURIComponent(String(mediaUrl || "").trim())}`;
}

function rememberLocalMediaServerUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const port = Number(parsed.port || 0);
    if (Number.isFinite(port) && port > 0) {
      cachedLocalMediaServerPort = port;
    }
  } catch (_) {
    // Ignore malformed service URLs.
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => {
        reject(new Error(message || "Request timed out"));
      },
      Math.max(1, Number(timeoutMs || 0))
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

function isAudioTrack(track) {
  return (
    String(track?.type || track?.track || "")
      .trim()
      .toLowerCase() === "audio"
  );
}

function isSubtitleTrack(track) {
  const type = String(track?.type || track?.track || "")
    .trim()
    .toLowerCase();
  return type === "text" || type === "subtitle";
}

function appendHeaderSubtitles(tracks, headerTracks) {
  if (tracks.some(isSubtitleTrack)) {
    return tracks;
  }
  const headerSubtitles = (Array.isArray(headerTracks) ? headerTracks : []).filter(isSubtitleTrack);
  return headerSubtitles.length ? tracks.concat(headerSubtitles) : tracks;
}

function hasKnownTrackLanguage(track) {
  const language = String(track?.language || track?.lang || track?.track_lang || "")
    .trim()
    .toLowerCase();
  return Boolean(language) && !["und", "unknown", "zxx"].includes(language.split("-")[0]);
}

// The local service can expose the container's audio streams without their
// language tags. Fill only missing fields, and only when both lists agree on
// the number of audio streams, so a mismatch can never relabel a track.
function mergeTizenTrackMetadata(serviceTracks, headerTracks) {
  const tracks = Array.isArray(serviceTracks) ? serviceTracks : [];
  const serviceAudio = tracks.filter(isAudioTrack);
  const headerAudio = (Array.isArray(headerTracks) ? headerTracks : []).filter(isAudioTrack);
  if (!serviceAudio.length) {
    return tracks.some(isSubtitleTrack)
      ? tracks.concat(headerAudio)
      : tracks.concat(headerTracks || []);
  }
  if (serviceAudio.length !== headerAudio.length) {
    return appendHeaderSubtitles(tracks, headerTracks);
  }
  let audioIndex = 0;
  const merged = tracks.map((track) => {
    if (!isAudioTrack(track)) {
      return track;
    }
    const headerTrack = headerAudio[audioIndex++];
    const fillLanguage = !hasKnownTrackLanguage(track) && Boolean(headerTrack?.language);
    const fillStreamIndex =
      track?.containerStreamIndex == null && headerTrack?.containerStreamIndex != null;
    if (!fillLanguage && !fillStreamIndex) {
      return track;
    }
    return {
      ...track,
      ...(fillLanguage ? { language: headerTrack.language } : {}),
      ...(fillStreamIndex ? { containerStreamIndex: headerTrack.containerStreamIndex } : {})
    };
  });
  return appendHeaderSubtitles(merged, headerTracks);
}

async function requestTracksViaLuna(mediaUrl, filename = "") {
  let result;
  try {
    result = await withTimeout(
      requestWebOsCompanionService({
        method: "tracks",
        parameters: {
          url: String(mediaUrl || "").trim(),
          filename: String(filename || "").trim()
        }
      }),
      REQUEST_TIMEOUT_MS,
      "webOS companion track request timed out"
    );
  } catch (error) {
    if (isTerminalTrackDiscoveryResponse(error)) {
      throw new TerminalTrackDiscoveryError(
        String(error?.errorText || "Track discovery is not supported for this file")
      );
    }
    throw error;
  }
  const payload = result?.payload || {};
  rememberLocalMediaServerUrl(payload?.url);

  if (payload?.returnValue === false) {
    if (isTerminalTrackDiscoveryResponse(payload)) {
      throw new TerminalTrackDiscoveryError(
        String(payload?.errorText || "Track discovery is not supported for this file")
      );
    }
    throw new Error(String(payload?.errorText || "Track request failed"));
  }

  return Array.isArray(payload?.tracks) ? payload.tracks : [];
}

async function requestTracksViaLunaWithRetry(mediaUrl, filename = "") {
  let lastError = null;
  for (let attempt = 1; attempt <= WEBOS_LUNA_TRACK_ATTEMPTS; attempt += 1) {
    try {
      const tracks = await requestTracksViaLuna(mediaUrl, filename);
      if (tracks.length > 0 || attempt >= WEBOS_LUNA_TRACK_ATTEMPTS) {
        return tracks;
      }
    } catch (error) {
      if (error?.terminal) {
        throw error;
      }
      lastError = error;
    }

    await delay(WEBOS_LUNA_TRACK_RETRY_DELAY_MS);
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  // withRequestTimeout also settles the call where AbortController is missing
  // (Chromium before 66), although the connection itself then stays open.
  return withRequestTimeout(async (signal) => {
    const response = await fetch(url, { method: "GET", ...(signal ? { signal } : {}) });
    if (!response.ok) {
      throw new Error(`Track request failed with HTTP ${response.status}`);
    }
    return response.json();
  }, timeoutMs);
}

export const localMediaTracksRepository = {
  async getTracks(mediaUrl, { filename = "" } = {}) {
    const targetUrl = String(mediaUrl || "").trim();
    if (!targetUrl) {
      return [];
    }

    if (!isEmbeddedTrackContainerSupported(targetUrl, filename)) {
      tracksCache.set(targetUrl, {
        tracks: [],
        expiresAt: Date.now() + UNSUPPORTED_TRACK_CACHE_TTL_MS
      });
      return [];
    }

    const cachedEntry = tracksCache.get(targetUrl);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return Array.isArray(cachedEntry.tracks) ? cachedEntry.tracks.slice() : [];
    }

    const inFlightRequest = inFlightTrackRequests.get(targetUrl);
    if (inFlightRequest) {
      const sharedTracks = await inFlightRequest;
      return Array.isArray(sharedTracks) ? sharedTracks.slice() : [];
    }

    const requestPromise = (async () => {
      if (Platform.isWebOS() && isWebOsCompanionServiceAvailable()) {
        try {
          const lunaTracks = await requestTracksViaLunaWithRetry(targetUrl, filename);
          tracksCache.set(targetUrl, {
            tracks: Array.isArray(lunaTracks) ? lunaTracks : [],
            expiresAt:
              Date.now() +
              (lunaTracks.length > 0 ? TRACK_CACHE_TTL_MS : WEBOS_EMPTY_TRACK_CACHE_TTL_MS)
          });
          return Array.isArray(lunaTracks) ? lunaTracks : [];
        } catch (error) {
          tracksCache.set(targetUrl, {
            tracks: [],
            expiresAt:
              Date.now() +
              (error?.terminal ? UNSUPPORTED_TRACK_CACHE_TTL_MS : WEBOS_EMPTY_TRACK_CACHE_TTL_MS)
          });
          return [];
        }
      }

      if (Platform.isTizen()) {
        // The packaged service may take far longer than playback startup to
        // answer, so read the container header at the same time instead of
        // serializing the two sources.
        const headerPromise = fetchMatroskaTracks(targetUrl);
        // Without AbortController a timed-out request stays open, so there the
        // request is not timed out at all: retries share it until the service
        // answers, and the grace races below keep startup bounded.
        const servicePromise =
          pendingTizenServiceTracks.get(targetUrl) ||
          (async () => {
            try {
              const service = await TizenEngineFsService.ensureStarted();
              const baseUrl = String(service?.baseUrl || "").replace(/\/+$/, "");
              if (service?.status === "success" && baseUrl) {
                const payload = await fetchJson(
                  `${baseUrl}/tracks/${encodeURIComponent(targetUrl)}`,
                  {
                    timeoutMs: typeof AbortController === "function" ? REQUEST_TIMEOUT_MS : 0
                  }
                );
                rememberLocalMediaServerUrl(baseUrl);
                return Array.isArray(payload) ? payload : [];
              }
            } catch (_) {
              // Older Tizen TVs may have AVPlay but no usable packaged web service.
            }
            return [];
          })();
        if (!pendingTizenServiceTracks.has(targetUrl)) {
          pendingTizenServiceTracks.set(targetUrl, servicePromise);
          void servicePromise.finally(() => pendingTizenServiceTracks.delete(targetUrl));
        }
        const serviceTracks = await Promise.race([
          servicePromise,
          delay(TIZEN_TRACK_SERVICE_GRACE_MS).then(() => null)
        ]);
        const serviceAudio = (serviceTracks || []).filter(isAudioTrack);
        const serviceHasLanguages =
          serviceAudio.length > 0 && serviceAudio.every(hasKnownTrackLanguage);
        let tracks;
        if (serviceHasLanguages) {
          tracks = serviceTracks.some(isSubtitleTrack)
            ? serviceTracks
            : mergeTizenTrackMetadata(serviceTracks, await headerPromise);
        } else {
          const headerTracks = await headerPromise;
          if (!headerTracks.length && serviceTracks === null) {
            const lateServiceTracks = await Promise.race([
              servicePromise,
              delay(TIZEN_TRACK_SERVICE_GRACE_MS).then(() => null)
            ]);
            tracks = Array.isArray(lateServiceTracks) ? lateServiceTracks : [];
          } else {
            tracks =
              serviceTracks?.length > 0
                ? mergeTizenTrackMetadata(serviceTracks, headerTracks)
                : headerTracks;
          }
        }
        tracksCache.set(targetUrl, {
          tracks,
          expiresAt: Date.now() + (tracks.length ? TRACK_CACHE_TTL_MS : 5000)
        });
        return tracks;
      }

      if (Platform.isBrowser()) {
        try {
          const payload = await fetchJson(buildSameOriginTracksUrl(targetUrl));
          const tracks = Array.isArray(payload) ? payload : [];
          tracksCache.set(targetUrl, {
            tracks,
            expiresAt: Date.now() + TRACK_CACHE_TTL_MS
          });
          return tracks;
        } catch (_) {
          // Fall back to direct localhost probing below.
        }
      }

      for (const port of getCandidatePorts()) {
        try {
          const payload = await fetchJson(buildTracksUrl(port, targetUrl));
          const tracks = Array.isArray(payload) ? payload : [];
          cachedLocalMediaServerPort = port;
          tracksCache.set(targetUrl, {
            tracks,
            expiresAt: Date.now() + TRACK_CACHE_TTL_MS
          });
          return tracks;
        } catch (_) {
          // Try the next local media server port.
        }
      }

      tracksCache.set(targetUrl, {
        tracks: [],
        expiresAt: Date.now() + Math.min(TRACK_CACHE_TTL_MS, 5000)
      });
      return [];
    })();

    inFlightTrackRequests.set(targetUrl, requestPromise);
    try {
      const resolvedTracks = await requestPromise;
      return Array.isArray(resolvedTracks) ? resolvedTracks.slice() : [];
    } finally {
      inFlightTrackRequests.delete(targetUrl);
    }
  }
};
