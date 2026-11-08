import { Platform } from "../../platform/index.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";
import {
  TorrentSettingsStore,
  getTorrentProfilePeerLimits
} from "../../data/local/torrentSettingsStore.js";

import { createTizenStreamingServerResolverMethods01 } from "./tizenStreamingServerResolverMethods-01-can-resolve-stream.js";

export {
  Platform,
  TizenEngineFsService,
  TizenCapabilities,
  TIZEN_STREAMING_KIND,
  CREATE_TIMEOUT_MS,
  removeRequestsByInfoHash,
  LOCAL_HOST_NAMES,
  logTizenP2pDebug,
  normalizeInfoHash,
  extractInfoHashFromMagnet,
  scanObjectForInfoHash,
  getInfoHash,
  getMagnetUri,
  isMagnetUri,
  getDirectPlaybackUrl,
  normalizeTrackerSource,
  trackerSourcesFromMagnet,
  getTrackerSources,
  normalizeBaseUrl,
  uniqueBaseUrls,
  withTimeout,
  buildPeerSearchSources,
  buildPlaybackUrl,
  guessMimeFromPath,
  selectFileIdx,
  getFilename,
  createTorrent,
  buildResolvedStream
};
const TIZEN_STREAMING_KIND = "tizen-streaming-server";
const CREATE_TIMEOUT_MS = 60000;
const removeRequestsByInfoHash = new Map();
const LOCAL_HOST_NAMES = new Set(["127.0.0.1", "localhost", "::1"]);

function logTizenP2pDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_ENGINEFS__ || globalThis.__NUVIO_DEBUG_TIZEN_P2P__) {
    console.info(...args);
  }
}

function normalizeInfoHash(value = "") {
  const hash = String(value || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{40}$/.test(hash) ? hash : "";
}

function extractInfoHashFromMagnet(value = "") {
  const raw = String(value || "").trim();
  if (!raw.toLowerCase().startsWith("magnet:?")) {
    return "";
  }
  const match = raw.match(/xt=urn:btih:([0-9a-f]{40})/i);
  return match ? normalizeInfoHash(match[1]) : "";
}

function scanObjectForInfoHash(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) {
    return "";
  }
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string") {
      const hash = normalizeInfoHash(value) || extractInfoHashFromMagnet(value);
      if (hash) {
        return hash;
      }
    } else if (value && typeof value === "object") {
      const hash = scanObjectForInfoHash(value, depth + 1);
      if (hash) {
        return hash;
      }
    }
  }
  return "";
}

function getInfoHash(stream = {}) {
  const direct =
    stream.infoHash ||
    stream.raw?.infoHash ||
    stream.clientResolve?.infoHash ||
    stream.raw?.clientResolve?.infoHash;
  return normalizeInfoHash(direct) || scanObjectForInfoHash(stream.raw || stream);
}

function getMagnetUri(stream = {}) {
  const candidates = [
    stream.torrentMagnetUri,
    stream.magnetUri,
    stream.url,
    stream.externalUrl,
    stream.clientResolve?.magnetUri,
    stream.raw?.torrentMagnetUri,
    stream.raw?.magnetUri,
    stream.raw?.url,
    stream.raw?.externalUrl,
    stream.raw?.clientResolve?.magnetUri
  ];
  return (
    candidates.find((value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .startsWith("magnet:?")
    ) || ""
  );
}

function isMagnetUri(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function getDirectPlaybackUrl(stream = {}) {
  const candidates = [stream.url, stream.externalUrl];
  return (
    candidates.find((value) => {
      const url = String(value || "").trim();
      return url && !isMagnetUri(url);
    }) || ""
  );
}

function normalizeTrackerSource(value = "") {
  return String(value || "")
    .trim()
    .replace(/^tracker:/i, "")
    .trim();
}

function trackerSourcesFromMagnet(magnetUri = "") {
  const raw = String(magnetUri || "").trim();
  if (!raw.toLowerCase().startsWith("magnet:?")) {
    return [];
  }
  try {
    const params = new URLSearchParams(raw.slice(raw.indexOf("?") + 1));
    return params.getAll("tr").map(normalizeTrackerSource).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function getTrackerSources(stream = {}, magnetUri = "") {
  const lists = [
    trackerSourcesFromMagnet(magnetUri),
    stream.sources,
    stream.announce,
    stream.trackers,
    stream.clientResolve?.sources,
    stream.clientResolve?.announce,
    stream.raw?.sources,
    stream.raw?.announce,
    stream.raw?.trackers,
    stream.raw?.clientResolve?.sources,
    stream.raw?.clientResolve?.announce
  ];
  const seen = new Set();
  const result = [];
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((entry) => {
      const normalized = normalizeTrackerSource(entry);
      const key = normalized.toLowerCase();
      if (normalized && !seen.has(key)) {
        seen.add(key);
        result.push(normalized);
      }
    });
  });
  return result;
}

function normalizeBaseUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (parsed.protocol !== "http:" || !LOCAL_HOST_NAMES.has(hostname)) {
      return "";
    }
    return `http://${parsed.hostname}:${parsed.port || "80"}`;
  } catch (_) {
    return "";
  }
}

function uniqueBaseUrls(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = normalizeBaseUrl(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function buildPeerSearchSources(infoHash, trackerSources = []) {
  const sources = [`dht:${infoHash}`];
  trackerSources.forEach((source) => {
    const normalized = String(source || "").trim();
    if (!normalized) {
      return;
    }
    sources.push(
      normalized.startsWith("tracker:") || normalized.startsWith("dht:")
        ? normalized
        : `tracker:${normalized}`
    );
  });
  return sources.filter((source, index, all) => all.indexOf(source) === index);
}

function buildPlaybackUrl(baseUrl, infoHash, fileIdx, sources = []) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  const playbackUrl = `${root}/${encodeURIComponent(infoHash)}/${encodeURIComponent(String(fileIdx))}`;
  const cleanSources = (Array.isArray(sources) ? sources : [])
    .map((source) => String(source || "").trim())
    .filter(Boolean);
  if (!cleanSources.length) {
    return playbackUrl;
  }
  const params = new URLSearchParams();
  cleanSources.forEach((source) => params.append("tr", source));
  return `${playbackUrl}?${params.toString()}`;
}

function guessMimeFromPath(path = "") {
  const lower = String(path || "").toLowerCase();
  const match = lower.match(/\.(mp4|m4v|mov|webm|mkv|avi|wmv|ts|m2ts|mpg|mpeg)(?:$|[/?#&])/i);
  if (!match) {
    return null;
  }
  const map = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    ts: "video/mp2t",
    m2ts: "video/mp2t",
    mpg: "video/mpeg",
    mpeg: "video/mpeg"
  };
  return map[String(match[1] || "").toLowerCase()] || null;
}

function selectFileIdx(stream = {}, createJson = {}) {
  const explicit = Number(
    stream.fileIdx ??
      stream.raw?.fileIdx ??
      stream.clientResolve?.fileIdx ??
      stream.raw?.clientResolve?.fileIdx
  );
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  const guessed = Number(createJson.guessedFileIdx ?? createJson.fileIdx);
  return Number.isFinite(guessed) && guessed >= 0 ? guessed : -1;
}

function getFilename(createJson = {}, fileIdx = -1) {
  const candidates = [createJson.filename, createJson.fileName, createJson.streamName]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (candidates.length) {
    return candidates[0];
  }
  const files = Array.isArray(createJson.files) ? createJson.files : [];
  const file = files[Number(fileIdx)];
  return String(file?.name || file?.filename || "").trim();
}

async function createTorrent(
  baseUrl,
  { infoHash, fileIdx, trackerSources = [], season = null, episode = null } = {}
) {
  const body = {
    torrent: { infoHash }
  };
  const peerLimits = getTorrentProfilePeerLimits(TorrentSettingsStore.get().torrentProfile);
  body.peerSearch = {
    sources: buildPeerSearchSources(infoHash, trackerSources),
    ...peerLimits
  };
  if (Number.isFinite(fileIdx) && fileIdx >= 0) {
    body.guessFileIdx = false;
  } else {
    body.guessFileIdx = {};
    if (Number.isFinite(season)) {
      body.guessFileIdx.season = season;
    }
    if (Number.isFinite(episode)) {
      body.guessFileIdx.episode = episode;
    }
  }
  const response = await withTimeout(
    fetch(`${baseUrl}/${encodeURIComponent(infoHash)}/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    CREATE_TIMEOUT_MS,
    "Tizen streaming server create request timed out"
  );
  if (!response.ok) {
    throw new Error(`Tizen streaming server create failed with HTTP ${response.status}`);
  }
  return response.json();
}

function buildResolvedStream(
  stream = {},
  {
    baseUrl,
    baseUrlKind = "local-service",
    infoHash,
    fileIdx,
    playbackUrl,
    filename = "",
    sources = []
  } = {}
) {
  const mimeType =
    guessMimeFromPath(filename) ||
    guessMimeFromPath(playbackUrl) ||
    stream.mimeType ||
    stream.raw?.mimeType ||
    stream.sourceType ||
    stream.raw?.type ||
    "video/x-matroska";
  const p2p = {
    kind: TIZEN_STREAMING_KIND,
    baseUrl,
    baseUrlKind,
    infoHash,
    fileIdx,
    playbackUrl,
    sources,
    mimeType
  };
  const behaviorHints = {
    ...(stream.raw?.behaviorHints || {}),
    ...(stream.behaviorHints || {}),
    filename:
      filename || stream.behaviorHints?.filename || stream.raw?.behaviorHints?.filename || null
  };
  return {
    ...stream,
    infoHash,
    fileIdx,
    url: playbackUrl,
    externalUrl: null,
    mimeType,
    sourceType: mimeType,
    tizenP2p: p2p,
    behaviorHints,
    raw: {
      ...(stream.raw || stream),
      tizenP2p: p2p,
      mimeType,
      sourceType: mimeType,
      type: mimeType,
      behaviorHints
    }
  };
}

export const TizenStreamingServerResolver = {
  ...createTizenStreamingServerResolverMethods01()
};
