import { Platform } from "../../platform/index.js";

import { isWebOsCompanionServiceAvailable, requestWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";

import { TorrentSettingsStore, getTorrentProfilePeerLimits } from "../../data/local/torrentSettingsStore.js";

import { normalizeBaseUrl, withTimeout, ENGINEFS_CREATE_TIMEOUT_MS } from "./webOsEngineFsResolverHelpers-01-enginefs-create-timeout-ms.js";

export function describeError(error) {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error?.message) {
    return String(error.message);
  }
  if (error?.errorText) {
    return String(error.errorText);
  }
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

export function buildNuvioPeerSearchSources(infoHash, trackerSources = []) {
  if (!Array.isArray(trackerSources) || trackerSources.length === 0) {
    return [];
  }
  const sources = [];
  const seen = new Set();
  const addSource = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return;
    }
    const source = /^tracker:/i.test(raw) || /^dht:/i.test(raw) ? raw : `tracker:${raw}`;
    const key = source.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      sources.push(source);
    }
  };
  if (infoHash) {
    addSource(`dht:${infoHash}`);
  }
  trackerSources.forEach(addSource);
  return sources;
}

export function buildDirectCreateBody({ infoHash, trackerSources = [], hasExplicitFileIdx = false, guessFileIdx = null } = {}) {
  const sources = buildNuvioPeerSearchSources(infoHash, trackerSources);
  const peerLimits = getTorrentProfilePeerLimits(TorrentSettingsStore.get().torrentProfile);
  const body = {
    torrent: { infoHash }
  };
  if (sources.length) {
    body.peerSearch = {
      sources,
      ...peerLimits
    };
  } else if (peerLimits.min !== 40 || peerLimits.max !== 200) {
    body.peerSearch = {
      sources: [`dht:${infoHash}`],
      ...peerLimits
    };
  }
  body.guessFileIdx = hasExplicitFileIdx ? false : guessFileIdx || {};
  return body;
}

export async function requestEngineFsCreateDirect(
  baseUrl,
  { infoHash, magnetUri = "", trackerSources = [], hasExplicitFileIdx = false, guessFileIdx = null } = {}
) {
  const baseRoot = normalizeBaseUrl(baseUrl);
  if (!baseRoot || !infoHash) {
    return null;
  }
  const path = `/${encodeURIComponent(infoHash)}/create`;
  const url = `${baseRoot}${path}`;
  void magnetUri;
  const body = buildDirectCreateBody({
    infoHash,
    trackerSources,
    hasExplicitFileIdx,
    guessFileIdx
  });
  const playbackSources = body.peerSearch ? body.peerSearch.sources : [];
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      cache: "no-cache"
    }),
    ENGINEFS_CREATE_TIMEOUT_MS,
    "EngineFS direct create request timed out"
  );
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  return {
    returnValue: response.ok,
    url,
    proxiedPath: path,
    statusCode: response.status,
    body: text,
    json,
    createRequest: {
      method: "POST",
      path,
      bodyKeys: Object.keys(body)
    },
    playbackSources,
    errorText: response.ok ? "" : `EngineFS direct create failed with HTTP ${response.status}`
  };
}

export const READINESS_TIMEOUT_MS = 60000;

export const READINESS_POLL_INTERVAL_MS = 700;

export const PROBE_TIMEOUT_MS = 2000;

export const READINESS_MIN_BUFFER_BYTES = 4 * 1024 * 1024;

export const READINESS_MIN_ACTIVE_BYTES = 1 * 1024 * 1024;

export const READINESS_MIN_STREAM_PROGRESS = 0.001;

export const READINESS_MIN_ACTIVE_WAIT_MS = 12000;

export const READINESS_RANGE_ONLY_FALLBACK_MS = 5000;

export function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getStatsNumber(stats = {}, keys = [], fallback = 0) {
  for (const key of keys) {
    if (stats && stats[key] != null) {
      const parsed = Number(stats[key]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

export function getEngineFsReadinessSnapshot(stats = {}) {
  const source = stats || {};
  return {
    streamProgress: getStatsNumber(source, ["streamProgress", "progress"], 0),
    downloaded: getStatsNumber(source, ["downloaded", "downloadedBytes"], 0),
    downloadSpeed: getStatsNumber(source, ["downloadSpeed", "speed"], 0),
    peers: getStatsNumber(source, ["peerCount", "peers"], 0),
    uniquePeerCount: getStatsNumber(source, ["uniquePeerCount", "unique"], 0),
    connectionTries: getStatsNumber(source, ["connectionTries", "tries"], 0),
    peerSearchRunning: Boolean(source.peerSearchRunning ?? source.peerSearch),
    streamLen: getStatsNumber(source, ["streamLen", "length", "fileLength"], 0),
    streamName: String(source.streamName || source.name || "").trim()
  };
}

export function hasEnoughEngineFsBuffer(snapshot = {}) {
  return (
    finiteNumber(snapshot.downloaded) >= READINESS_MIN_BUFFER_BYTES ||
    finiteNumber(snapshot.streamProgress) >= READINESS_MIN_STREAM_PROGRESS
  );
}

export function isEngineFsSwarmActive(snapshot = {}) {
  return (
    finiteNumber(snapshot.downloadSpeed) > 0 ||
    finiteNumber(snapshot.peers) > 0 ||
    finiteNumber(snapshot.uniquePeerCount) > 0 ||
    finiteNumber(snapshot.connectionTries) > 0 ||
    Boolean(snapshot.peerSearchRunning)
  );
}
