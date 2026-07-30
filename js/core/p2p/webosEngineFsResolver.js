import { Platform } from "../../platform/index.js";
import {
  isWebOsCompanionServiceAvailable,
  requestWebOsCompanionService
} from "../../platform/webos/webosCompanionService.js";

const ENGINEFS_CREATE_TIMEOUT_MS = 60000;
const ENGINEFS_KIND = "webos-enginefs";

function logEngineFsDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_ENGINEFS__) {
    console.info(...args);
  }
}

function normalizeInfoHash(value = "") {
  const hash = String(value || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{40}$/.test(hash) ? hash : "";
}

function getInfoHash(stream = {}) {
  // Try direct infoHash fields first
  const direct =
    stream.infoHash ||
    stream.raw?.infoHash ||
    stream.clientResolve?.infoHash ||
    stream.raw?.clientResolve?.infoHash;
  if (normalizeInfoHash(direct)) {
    return normalizeInfoHash(direct);
  }

  // Helper: extract from magnet URI
  function extractInfoHashFromMagnet(value = "") {
    if (typeof value !== "string") return "";
    const m = value.match(/xt=urn:btih:([0-9A-Fa-f]{40})/);
    if (m) return normalizeInfoHash(m[1]);
    const m2 = value.match(/magnet:\?xt=urn:btih:([0-9A-Fa-f]{40})/);
    if (m2) return normalizeInfoHash(m2[1]);
    return "";
  }

  // Check known URI fields
  const fieldsToCheck = [
    stream.url,
    stream.externalUrl,
    stream.torrentMagnetUri,
    stream.clientResolve?.magnetUri,
    stream.raw?.magnetUri,
    stream.raw?.torrentMagnetUri
  ];
  for (const val of fieldsToCheck) {
    const ih = normalizeInfoHash(val) || extractInfoHashFromMagnet(val);
    if (ih) return ih;
  }

  // Recursively scan `raw` for a magnet/xt entry
  function scanObjectForMagnet(obj) {
    if (!obj || typeof obj !== "object") return "";
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") {
        const ih = normalizeInfoHash(v) || extractInfoHashFromMagnet(v);
        if (ih) return ih;
      } else if (typeof v === "object") {
        const ih = scanObjectForMagnet(v);
        if (ih) return ih;
      }
    }
    return "";
  }

  const rawScan = scanObjectForMagnet(stream.raw || stream);
  if (rawScan) return rawScan;

  return "";
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

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().toLowerCase().startsWith("magnet:?")) {
      return value.trim();
    }
  }
  return "";
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
  const source = String(value || "").trim();
  if (!source) {
    return "";
  }
  return source.replace(/^tracker:/i, "").trim();
}

function trackerSourcesFromMagnet(magnetUri = "") {
  const raw = String(magnetUri || "").trim();
  if (!raw.toLowerCase().startsWith("magnet:?")) {
    return [];
  }
  try {
    const query = raw.slice(raw.indexOf("?") + 1);
    const params = new URLSearchParams(query);
    return params.getAll("tr").map(normalizeTrackerSource).filter(Boolean);
  } catch (_) {
    const matches = raw.match(/[?&]tr=([^&]+)/gi) || [];
    return matches
      .map((entry) => decodeURIComponent(String(entry).replace(/^[?&]tr=/i, "")))
      .map(normalizeTrackerSource)
      .filter(Boolean);
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
    if (parsed.protocol !== "http:") {
      return "";
    }
    return `http://${parsed.hostname}:${parsed.port || "80"}`;
  } catch (_) {
    return "";
  }
}

function buildPlaybackUrl(baseUrl, infoHash, fileIdx, sources = []) {
  const url = `${String(baseUrl || "").replace(/\/$/, "")}/${encodeURIComponent(infoHash)}/${String(fileIdx)}`;
  const cleanSources = (Array.isArray(sources) ? sources : [])
    .map((source) => String(source || "").trim())
    .filter(Boolean);
  if (!cleanSources.length) {
    return url;
  }
  const params = new URLSearchParams();
  cleanSources.forEach((source) => {
    params.append("tr", source);
  });
  return `${url}?${params.toString()}`;
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

function describeError(error) {
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

function buildNuvioPeerSearchSources(infoHash, trackerSources = []) {
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

function buildDirectCreateBody({
  infoHash,
  trackerSources = [],
  hasExplicitFileIdx = false,
  guessFileIdx = null
} = {}) {
  const sources = buildNuvioPeerSearchSources(infoHash, trackerSources);
  const body = {
    torrent: { infoHash }
  };
  if (sources.length) {
    body.peerSearch = {
      sources,
      min: 40,
      max: 200
    };
  }
  body.guessFileIdx = hasExplicitFileIdx ? false : guessFileIdx || {};
  return body;
}

async function requestEngineFsCreateDirect(
  baseUrl,
  {
    infoHash,
    magnetUri = "",
    trackerSources = [],
    hasExplicitFileIdx = false,
    guessFileIdx = null
  } = {}
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

const READINESS_TIMEOUT_MS = 60000; // max wait for EngineFS readiness (ms)
const READINESS_POLL_INTERVAL_MS = 700; // poll interval (ms)
const PROBE_TIMEOUT_MS = 2000; // per-probe timeout (ms)
const READINESS_MIN_BUFFER_BYTES = 4 * 1024 * 1024;
const READINESS_MIN_ACTIVE_BYTES = 1 * 1024 * 1024;
const READINESS_MIN_STREAM_PROGRESS = 0.001;
const READINESS_MIN_ACTIVE_WAIT_MS = 12000;
const READINESS_RANGE_ONLY_FALLBACK_MS = 5000;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStatsNumber(stats = {}, keys = [], fallback = 0) {
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

function getEngineFsReadinessSnapshot(stats = {}) {
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

function hasEnoughEngineFsBuffer(snapshot = {}) {
  return (
    finiteNumber(snapshot.downloaded) >= READINESS_MIN_BUFFER_BYTES ||
    finiteNumber(snapshot.streamProgress) >= READINESS_MIN_STREAM_PROGRESS
  );
}

function isEngineFsSwarmActive(snapshot = {}) {
  return (
    finiteNumber(snapshot.downloadSpeed) > 0 ||
    finiteNumber(snapshot.peers) > 0 ||
    finiteNumber(snapshot.uniquePeerCount) > 0 ||
    finiteNumber(snapshot.connectionTries) > 0 ||
    Boolean(snapshot.peerSearchRunning)
  );
}

async function waitForEngineFsReady(baseCandidate, infoHash, fileIdx, playbackUrl, _options = {}) {
  const start = Date.now();
  let baseRoot = String(baseCandidate || "").replace(/\/$/, "");
  try {
    // prefer origin when possible
    baseRoot = new URL(baseCandidate).origin;
  } catch (_) {
    // keep provided baseCandidate as-is
  }

  const diag = {
    statsAttempts: 0,
    statsSuccess: false,
    statsLastJson: null,
    statsLastStatus: null,
    rangeAttempts: 0,
    rangeSuccess: false,
    rangeLastStatus: null,
    rangeLastBytes: 0,
    elapsedMs: 0,
    readyReason: null,
    activeSeen: false,
    bufferedReady: false,
    statsLastSnapshot: null
  };

  const statsUrlFor = (ih, idx) => `${baseRoot}/${encodeURIComponent(ih)}/${idx}/stats.json`;
  const rangeUrlFor = (ih, idx) => `${baseRoot}/${encodeURIComponent(ih)}/${idx}`;

  const probeRangeAt = async (url) => {
    diag.rangeAttempts++;
    try {
      const resp = await withTimeout(
        fetch(url, { method: "GET", headers: { Range: "bytes=0-1023" }, cache: "no-cache" }),
        PROBE_TIMEOUT_MS,
        "EngineFS range probe timed out"
      );
      if (!resp) return false;
      diag.rangeLastStatus = resp.status;
      if (resp.status === 200 || resp.status === 206) {
        try {
          const buf = await resp.arrayBuffer();
          const len = buf ? buf.byteLength : 0;
          diag.rangeLastBytes = len;
          if (len > 0) {
            diag.rangeSuccess = true;
            return true;
          }
        } catch (_) {
          const cl = resp.headers && resp.headers.get && resp.headers.get("content-length");
          const n = cl ? Number(cl) : 0;
          diag.rangeLastBytes = n;
          if (n > 0) {
            diag.rangeSuccess = true;
            return true;
          }
        }
      }
    } catch (_) {
      // ignore transient errors
    }
    return false;
  };

  const probeStats = async (ih, idx) => {
    diag.statsAttempts++;
    try {
      const url = statsUrlFor(ih, idx);
      const resp = await withTimeout(
        fetch(url, { method: "GET", cache: "no-cache" }),
        PROBE_TIMEOUT_MS,
        "EngineFS stats probe timed out"
      );
      if (!resp) return false;
      diag.statsLastStatus = resp.status;
      if (!resp.ok) return false;
      const json = await resp.json().catch(() => null);
      diag.statsLastJson = json;
      if (!json) return false;
      diag.statsLastSnapshot = getEngineFsReadinessSnapshot(json);
      if (json.streamName || Number(json.streamLen) > 0) {
        diag.statsSuccess = true;
        return true;
      }
    } catch (_) {
      // ignore
    }
    return false;
  };

  while (Date.now() - start < READINESS_TIMEOUT_MS) {
    // If we have a valid fileIdx, probe stats for diagnostics
    if (Number.isFinite(fileIdx) && fileIdx >= 0) {
      try {
        await probeStats(infoHash, fileIdx);
      } catch (_) {}
    }

    const elapsedMs = Date.now() - start;
    const snapshot = diag.statsLastSnapshot || {};
    diag.activeSeen = diag.activeSeen || isEngineFsSwarmActive(snapshot);
    diag.bufferedReady = hasEnoughEngineFsBuffer(snapshot);

    // Prefer probing the exact playbackUrl when provided; otherwise probe the /{infoHash}/{idx} path
    try {
      let rangeReady = false;
      if (playbackUrl) {
        rangeReady = await probeRangeAt(playbackUrl);
      } else if (Number.isFinite(fileIdx) && fileIdx >= 0) {
        rangeReady = await probeRangeAt(rangeUrlFor(infoHash, fileIdx));
      }

      if (rangeReady) {
        if (diag.bufferedReady) {
          diag.elapsedMs = Date.now() - start;
          diag.readyReason = "buffered";
          return { ready: true, diag };
        }

        if (diag.statsSuccess && diag.activeSeen) {
          if (
            elapsedMs >= READINESS_MIN_ACTIVE_WAIT_MS &&
            finiteNumber(snapshot.downloaded) >= READINESS_MIN_ACTIVE_BYTES
          ) {
            diag.elapsedMs = Date.now() - start;
            diag.readyReason = "active-min-wait";
            return { ready: true, diag };
          }
        } else if (!diag.statsSuccess && elapsedMs >= READINESS_RANGE_ONLY_FALLBACK_MS) {
          diag.elapsedMs = Date.now() - start;
          diag.readyReason = "range-only-fallback";
          return { ready: true, diag };
        }
      }
    } catch (_) {
      // ignore transient errors
    }

    await new Promise((r) => setTimeout(r, READINESS_POLL_INTERVAL_MS));
  }

  diag.elapsedMs = Date.now() - start;
  if (diag.rangeSuccess && (diag.bufferedReady || diag.activeSeen)) {
    diag.readyReason = diag.bufferedReady ? "timeout-buffered" : "timeout-active";
    return { ready: true, diag };
  }
  return { ready: false, diag };
}

function selectFileIdx(stream = {}, createJson = {}) {
  const explicitFileIdx = Number(stream.fileIdx ?? stream.raw?.fileIdx);
  if (Number.isFinite(explicitFileIdx) && explicitFileIdx >= 0) {
    return explicitFileIdx;
  }

  // Prefer explicit fileIdx returned by the create JSON if present
  const createFileIdxCandidates = [
    createJson && createJson.fileIdx,
    createJson && createJson.fileIndex,
    createJson && createJson.idx,
    createJson && createJson.index
  ];
  for (const cand of createFileIdxCandidates) {
    const n = Number(cand);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const guessedFileIdx = Number(createJson && createJson.guessedFileIdx);
  if (Number.isFinite(guessedFileIdx) && guessedFileIdx >= 0) {
    return guessedFileIdx;
  }
  return -1;
}

function getFileNameFromCreateJson(createJson = {}, fileIdx) {
  try {
    if (!createJson || !Array.isArray(createJson.files)) return "";
    const f = createJson.files[fileIdx];
    if (!f) return "";
    // prefer `name` then `filename`
    return String(f.name || f.filename || "").trim();
  } catch (_) {
    return "";
  }
}

function guessMimeFromPath(path) {
  try {
    const lower = String(path || "").toLowerCase();
    const m = lower.match(
      /\.(mp4|m4v|mov|webm|mkv|avi|wmv|ts|m2ts|mpg|mpeg|3gp|mp3|aac|flac)(?:$|[/?#&])/i
    );
    if (!m) return null;
    const ext = String(m[1] || "").toLowerCase();
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
      mpeg: "video/mpeg",
      "3gp": "video/3gpp",
      mp3: "audio/mpeg",
      aac: "audio/aac",
      flac: "audio/flac"
    };
    return map[ext] || null;
  } catch (_) {
    return null;
  }
}

function normalizeEngineFsState(value = {}) {
  const source = value || {};
  if (source.kind !== ENGINEFS_KIND) {
    return null;
  }
  const infoHash = normalizeInfoHash(source.infoHash);
  if (!infoHash) {
    return null;
  }
  const fileIdx = Number(source.fileIdx);
  return {
    kind: ENGINEFS_KIND,
    infoHash,
    fileIdx: Number.isFinite(fileIdx) ? fileIdx : -1,
    playbackUrl: String(source.playbackUrl || source.url || "").trim(),
    mimeType: String(source.mimeType || source.sourceType || "").trim() || null,
    baseUrlKind: String(source.baseUrlKind || "").trim() || null,
    publicPlaybackUrl: String(source.publicPlaybackUrl || "").trim() || null
  };
}

function getResolvedMimeType(stream = {}, filename = "", playbackUrl = "") {
  return (
    guessMimeFromPath(filename) ||
    guessMimeFromPath(playbackUrl) ||
    stream?.mimeType ||
    stream?.raw?.mimeType ||
    stream?.sourceType ||
    stream?.raw?.type ||
    null
  );
}

function buildResolvedStream(
  stream = {},
  {
    infoHash,
    fileIdx,
    playbackUrl,
    filename = "",
    baseUrlKind = "public-service",
    publicPlaybackUrl = ""
  } = {}
) {
  const finalMime = getResolvedMimeType(stream, filename, playbackUrl);
  const engineFs = {
    kind: ENGINEFS_KIND,
    infoHash,
    fileIdx,
    playbackUrl,
    baseUrlKind,
    publicPlaybackUrl,
    mimeType: finalMime
  };
  return {
    ...stream,
    infoHash,
    fileIdx,
    url: playbackUrl,
    mimeType: finalMime,
    sourceType: finalMime || stream.sourceType,
    externalUrl: null,
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      filename: filename || (stream.behaviorHints && stream.behaviorHints.filename) || null
    },
    engineFs,
    raw: {
      ...(stream.raw || stream),
      engineFs,
      mimeType: finalMime,
      sourceType: finalMime || stream.sourceType,
      type: finalMime
    }
  };
}

export const WebOsEngineFsResolver = {
  canResolveStream(stream = {}) {
    return Platform.isWebOS() && isWebOsCompanionServiceAvailable() && Boolean(getInfoHash(stream));
  },

  getResolvedStreamState(stream = {}) {
    const state = normalizeEngineFsState(stream.engineFs || stream.raw?.engineFs || null);
    if (!state || state.kind !== ENGINEFS_KIND) {
      return null;
    }
    return state;
  },

  async resolve(stream = {}, context = {}) {
    if (getDirectPlaybackUrl(stream)) {
      return { status: "success", stream };
    }
    if (!this.canResolveStream(stream)) {
      return { status: "unsupported" };
    }

    try {
      const infoHash = getInfoHash(stream);
      const magnetUri = getMagnetUri(stream);
      const trackerSources = getTrackerSources(stream, magnetUri);
      const explicitFileIdx = Number(stream.fileIdx ?? stream.raw?.fileIdx);
      const hasExplicitFileIdx = Number.isFinite(explicitFileIdx) && explicitFileIdx >= 0;
      const season = Number(context?.season);
      const episode = Number(context?.episode);
      const guessFileIdx = {};
      if (Number.isFinite(season)) {
        guessFileIdx.season = season;
      }
      if (Number.isFinite(episode)) {
        guessFileIdx.episode = episode;
      }
      // Get companion status to attempt to discover a public baseUrl in settings
      let statusPayload = {};
      let statusError = "";
      try {
        const statusResult = await withTimeout(
          requestWebOsCompanionService({ method: "status", parameters: {} }),
          5000,
          "webOS companion status request timed out"
        );
        statusPayload = statusResult?.payload || {};
      } catch (error) {
        statusPayload = {};
        statusError = describeError(error);
      }

      const parseSettingsBase = (payload) => {
        if (!payload) return "";
        if (typeof payload.settingsBody === "string") {
          try {
            const settings = JSON.parse(payload.settingsBody || "{}");
            return normalizeBaseUrl(settings?.baseUrl || "");
          } catch (_) {
            // ignore
          }
        }
        return "";
      };

      const isLocalHostUrl = (urlStr) => {
        try {
          const p = new URL(String(urlStr));
          const host = p.hostname;
          return host === "127.0.0.1" || host === "localhost" || host === "::1";
        } catch (_) {
          return false;
        }
      };

      const settingsBase = parseSettingsBase(statusPayload);
      const statusUrl = normalizeBaseUrl(statusPayload?.url || "");
      const publicBaseCandidate =
        settingsBase && !isLocalHostUrl(settingsBase)
          ? settingsBase
          : statusUrl && !isLocalHostUrl(statusUrl)
            ? statusUrl
            : "";
      const localBaseCandidate = statusUrl && isLocalHostUrl(statusUrl) ? statusUrl : "";

      // Use Luna only to start/discover the runtime, then call
      // the local streaming server directly. Torrent create/playback is HTTP, not Luna.
      let createPayload = null;
      if (localBaseCandidate && hasExplicitFileIdx && trackerSources.length === 0) {
        createPayload = {
          returnValue: true,
          url: null,
          proxiedPath: null,
          statusCode: null,
          body: "",
          json: {
            infoHash,
            fileIdx: explicitFileIdx
          },
          createRequest: {
            method: "SKIP",
            path: null,
            bodyKeys: []
          },
          playbackSources: []
        };
      }
      if (localBaseCandidate) {
        if (createPayload) {
          // Skip /create when fileIdx is explicit and no peer sources are needed.
        } else {
          createPayload = await requestEngineFsCreateDirect(localBaseCandidate, {
            infoHash,
            magnetUri,
            trackerSources,
            hasExplicitFileIdx,
            guessFileIdx: Object.keys(guessFileIdx).length ? guessFileIdx : {}
          });
        }
      } else {
        const detail =
          statusError ||
          statusPayload?.error?.message ||
          (statusPayload?.settingsReachable === false
            ? "EngineFS local runtime settings endpoint is unreachable"
            : "") ||
          "EngineFS local runtime URL is unavailable";
        return { status: "unavailable", detail };
      }
      if (createPayload.returnValue === false) {
        console.warn("WebOsEngineFsResolver: EngineFS create failed", {
          infoHash,
          statusCode: createPayload.statusCode || null,
          proxiedPath: createPayload.proxiedPath || null,
          errorText: createPayload.errorText || "",
          body: createPayload.body || "",
          createRequest: createPayload.createRequest || null
        });
        return { status: "error", detail: createPayload.errorText || "" };
      }

      const createJson = createPayload.json || null;
      const selectedFileIdx = selectFileIdx(stream, createJson || {});
      const selectedInfoHash = normalizeInfoHash(createJson?.infoHash) || infoHash;
      const selectedFilename = getFileNameFromCreateJson(createJson || {}, selectedFileIdx);
      const hasSelectedFileIdx = Number.isFinite(selectedFileIdx) && selectedFileIdx >= 0;
      const playbackSources = Array.isArray(createPayload.playbackSources)
        ? createPayload.playbackSources
        : buildNuvioPeerSearchSources(infoHash, trackerSources);
      const publicPlaybackUrl = publicBaseCandidate
        ? buildPlaybackUrl(publicBaseCandidate, selectedInfoHash, selectedFileIdx, playbackSources)
        : "";

      if (localBaseCandidate && hasSelectedFileIdx) {
        const localPlaybackUrl = buildPlaybackUrl(
          localBaseCandidate,
          selectedInfoHash,
          selectedFileIdx,
          playbackSources
        );
        const guessedMime = guessMimeFromPath(selectedFilename || localPlaybackUrl) || null;
        const diagLog = {
          playbackUrl: localPlaybackUrl,
          publicPlaybackUrl: publicPlaybackUrl || null,
          infoHash: selectedInfoHash,
          fileIdx: selectedFileIdx,
          filename: selectedFilename || null,
          guessedMime,
          baseUrlKind: "local-service",
          companionStatusUrl: statusUrl || null,
          settingsBaseUrl: settingsBase || null,
          createResult: {
            returnValue: createPayload?.returnValue,
            json: createJson
              ? {
                  infoHash: createJson.infoHash,
                  guessedFileIdx: createJson.guessedFileIdx,
                  fileIdx: createJson.fileIdx,
                  baseUrl: createJson.baseUrl || createJson.base_url,
                  playbackUrl: createJson.playbackUrl || createJson.playback
                }
              : null
          },
          playbackSources,
          statsProbe: null,
          rangeProbe: null,
          finalReason: "create-ok-nuvio-mode",
          elapsedMs: null
        };
        logEngineFsDebug("WebOsEngineFsResolver: EngineFS probe result", diagLog);
        return {
          status: "success",
          stream: buildResolvedStream(stream, {
            infoHash: selectedInfoHash,
            fileIdx: selectedFileIdx,
            playbackUrl: localPlaybackUrl,
            filename: selectedFilename,
            baseUrlKind: "local-service",
            publicPlaybackUrl
          })
        };
      }

      // Prefer playbackUrl returned directly by the create proxy if it's public
      const candidatePlaybackFromCreate =
        createJson &&
        (createJson.playbackUrl ||
          createJson.playbackURL ||
          createJson.playback_url ||
          createJson.playback);
      if (candidatePlaybackFromCreate) {
        const chosenInfoHash = selectedInfoHash;
        const fileIdx = selectedFileIdx;
        // If absolute URL, accept only if it's not local
        try {
          const abs = new URL(candidatePlaybackFromCreate);
          if (!isLocalHostUrl(abs.href)) {
            const filename = selectedFilename;
            // Build playback URL as origin/<infoHash>/<fileIdx> (no filename)
            let finalPlayback = null;
            try {
              const parsed = new URL(abs.href);
              finalPlayback = buildPlaybackUrl(parsed.origin, chosenInfoHash, fileIdx);
            } catch (_) {
              finalPlayback = buildPlaybackUrl(abs.origin, chosenInfoHash, fileIdx);
            }
            const readyResWithDiag = await waitForEngineFsReady(
              new URL(finalPlayback).origin,
              chosenInfoHash,
              fileIdx,
              finalPlayback,
              { collectDiagnostics: true }
            );
            const readyFinal = Boolean(readyResWithDiag && readyResWithDiag.ready);
            const guessedMime = guessMimeFromPath(filename || finalPlayback) || null;
            const diagLog = {
              playbackUrl: finalPlayback,
              infoHash: chosenInfoHash,
              fileIdx,
              filename: filename || null,
              guessedMime,
              baseUrlKind: "public-create-playback",
              createResult: {
                returnValue: createPayload?.returnValue,
                json: createJson
                  ? {
                      infoHash: createJson.infoHash,
                      baseUrl: createJson.baseUrl || createJson.base_url,
                      playbackUrl: createJson.playbackUrl || createJson.playback
                    }
                  : null
              },
              statsProbe: readyResWithDiag?.diag?.statsLastStatus
                ? {
                    success: readyResWithDiag?.diag?.statsSuccess,
                    attempts: readyResWithDiag?.diag?.statsAttempts,
                    lastStatus: readyResWithDiag?.diag?.statsLastStatus,
                    lastJson: readyResWithDiag?.diag?.statsLastJson,
                    snapshot: readyResWithDiag?.diag?.statsLastSnapshot || null
                  }
                : null,
              rangeProbe: readyResWithDiag?.diag?.rangeLastStatus
                ? {
                    success: readyResWithDiag?.diag?.rangeSuccess,
                    attempts: readyResWithDiag?.diag?.rangeAttempts,
                    lastStatus: readyResWithDiag?.diag?.rangeLastStatus,
                    lastBytes: readyResWithDiag?.diag?.rangeLastBytes
                  }
                : null,
              finalReason: readyFinal
                ? readyResWithDiag?.diag?.readyReason || "ready"
                : "timeout_or_not_ready",
              elapsedMs: readyResWithDiag?.diag?.elapsedMs ?? null
            };
            logEngineFsDebug("WebOsEngineFsResolver: EngineFS probe result", diagLog);
            if (!readyFinal) {
              return { status: "unavailable" };
            }
            return {
              status: "success",
              stream: buildResolvedStream(stream, {
                infoHash: chosenInfoHash,
                fileIdx,
                playbackUrl: finalPlayback,
                filename,
                baseUrlKind: "public-create-playback",
                publicPlaybackUrl: finalPlayback
              })
            };
          }
        } catch (_) {
          // relative path - try to resolve with public base candidates
          const baseToUse =
            settingsBase && !isLocalHostUrl(settingsBase)
              ? settingsBase
              : createJson &&
                  (createJson.baseUrl || createJson.base_url) &&
                  !isLocalHostUrl(createJson.baseUrl || createJson.base_url)
                ? normalizeBaseUrl(createJson.baseUrl || createJson.base_url)
                : publicBaseCandidate;
          if (baseToUse) {
            const filename = selectedFilename;
            // Construct canonical playback URL: base/<infoHash>/<fileIdx> (no filename)
            let playbackUrl = buildPlaybackUrl(baseToUse, chosenInfoHash, fileIdx);
            const readyRes = await waitForEngineFsReady(
              baseToUse,
              chosenInfoHash,
              fileIdx,
              playbackUrl,
              { collectDiagnostics: true }
            );
            const ready = Boolean(readyRes && readyRes.ready);
            const guessedMime = guessMimeFromPath(filename || playbackUrl) || null;
            const diagLog = {
              playbackUrl,
              infoHash: chosenInfoHash,
              fileIdx,
              filename: filename || null,
              guessedMime,
              baseUrlKind: "public-create-relative",
              createResult: {
                returnValue: createPayload?.returnValue,
                json: createJson
                  ? {
                      infoHash: createJson.infoHash,
                      baseUrl: createJson.baseUrl || createJson.base_url,
                      playbackUrl: createJson.playbackUrl || createJson.playback
                    }
                  : null
              },
              statsProbe: readyRes?.diag?.statsLastStatus
                ? {
                    success: readyRes?.diag?.statsSuccess,
                    attempts: readyRes?.diag?.statsAttempts,
                    lastStatus: readyRes?.diag?.statsLastStatus,
                    lastJson: readyRes?.diag?.statsLastJson,
                    snapshot: readyRes?.diag?.statsLastSnapshot || null
                  }
                : null,
              rangeProbe: readyRes?.diag?.rangeLastStatus
                ? {
                    success: readyRes?.diag?.rangeSuccess,
                    attempts: readyRes?.diag?.rangeAttempts,
                    lastStatus: readyRes?.diag?.rangeLastStatus,
                    lastBytes: readyRes?.diag?.rangeLastBytes
                  }
                : null,
              finalReason: ready ? readyRes?.diag?.readyReason || "ready" : "timeout_or_not_ready",
              elapsedMs: readyRes?.diag?.elapsedMs ?? null
            };
            logEngineFsDebug("WebOsEngineFsResolver: EngineFS probe result", diagLog);
            if (!ready) {
              return { status: "unavailable" };
            }
            return {
              status: "success",
              stream: buildResolvedStream(stream, {
                infoHash: chosenInfoHash,
                fileIdx,
                playbackUrl,
                filename,
                baseUrlKind: "public-create-relative",
                publicPlaybackUrl: playbackUrl
              })
            };
          }
        }
      }

      // If createJson exposes a baseUrl that's public, use it
      const candidateBaseFromCreateRaw =
        createJson && (createJson.baseUrl || createJson.base_url || createJson.base);
      const candidateBaseFromCreate = candidateBaseFromCreateRaw
        ? normalizeBaseUrl(candidateBaseFromCreateRaw)
        : "";
      if (candidateBaseFromCreate && !isLocalHostUrl(candidateBaseFromCreate)) {
        const fileIdx = selectedFileIdx;
        const chosenInfoHash = selectedInfoHash;
        const filename = selectedFilename;
        // canonical playback URL without filename
        const playbackUrl = buildPlaybackUrl(candidateBaseFromCreate, chosenInfoHash, fileIdx);
        const readyRes = await waitForEngineFsReady(
          candidateBaseFromCreate,
          chosenInfoHash,
          fileIdx,
          playbackUrl,
          { collectDiagnostics: true }
        );
        const ready = Boolean(readyRes && readyRes.ready);
        const guessedMime = guessMimeFromPath(filename || playbackUrl) || null;
        const diagLog = {
          playbackUrl,
          infoHash: chosenInfoHash,
          fileIdx,
          filename: filename || null,
          guessedMime,
          baseUrlKind: "public-create-base",
          createResult: {
            returnValue: createPayload?.returnValue,
            json: createJson
              ? {
                  infoHash: createJson.infoHash,
                  baseUrl: createJson.baseUrl || createJson.base_url
                }
              : null
          },
          statsProbe: readyRes?.diag?.statsLastStatus
            ? {
                success: readyRes?.diag?.statsSuccess,
                attempts: readyRes?.diag?.statsAttempts,
                lastStatus: readyRes?.diag?.statsLastStatus,
                lastJson: readyRes?.diag?.statsLastJson,
                snapshot: readyRes?.diag?.statsLastSnapshot || null
              }
            : null,
          rangeProbe: readyRes?.diag?.rangeLastStatus
            ? {
                success: readyRes?.diag?.rangeSuccess,
                attempts: readyRes?.diag?.rangeAttempts,
                lastStatus: readyRes?.diag?.rangeLastStatus,
                lastBytes: readyRes?.diag?.rangeLastBytes
              }
            : null,
          finalReason: ready ? readyRes?.diag?.readyReason || "ready" : "timeout_or_not_ready",
          elapsedMs: readyRes?.diag?.elapsedMs ?? null
        };
        logEngineFsDebug("WebOsEngineFsResolver: EngineFS probe result", diagLog);
        if (!ready) return { status: "unavailable" };
        return {
          status: "success",
          stream: buildResolvedStream(stream, {
            infoHash: chosenInfoHash,
            fileIdx,
            playbackUrl,
            filename,
            baseUrlKind: "public-create-base",
            publicPlaybackUrl: playbackUrl
          })
        };
      }

      // If we have a public base URL from status/settings, use it
      if (publicBaseCandidate) {
        const fileIdx = selectedFileIdx;
        const chosenInfoHash = selectedInfoHash;
        const filename = selectedFilename;
        const playbackUrl = buildPlaybackUrl(publicBaseCandidate, chosenInfoHash, fileIdx);
        const readyRes = await waitForEngineFsReady(
          publicBaseCandidate,
          chosenInfoHash,
          fileIdx,
          playbackUrl,
          { collectDiagnostics: true }
        );
        const ready = Boolean(readyRes && readyRes.ready);
        const guessedMime = guessMimeFromPath(filename || playbackUrl) || null;
        const diagLog = {
          playbackUrl,
          infoHash: chosenInfoHash,
          fileIdx,
          filename: filename || null,
          guessedMime,
          baseUrlKind: "public-status",
          createResult: {
            returnValue: createPayload?.returnValue,
            json: createJson ? { infoHash: createJson.infoHash } : null
          },
          statsProbe: readyRes?.diag?.statsLastStatus
            ? {
                success: readyRes?.diag?.statsSuccess,
                attempts: readyRes?.diag?.statsAttempts,
                lastStatus: readyRes?.diag?.statsLastStatus,
                lastJson: readyRes?.diag?.statsLastJson,
                snapshot: readyRes?.diag?.statsLastSnapshot || null
              }
            : null,
          rangeProbe: readyRes?.diag?.rangeLastStatus
            ? {
                success: readyRes?.diag?.rangeSuccess,
                attempts: readyRes?.diag?.rangeAttempts,
                lastStatus: readyRes?.diag?.rangeLastStatus,
                lastBytes: readyRes?.diag?.rangeLastBytes
              }
            : null,
          finalReason: ready ? readyRes?.diag?.readyReason || "ready" : "timeout_or_not_ready",
          elapsedMs: readyRes?.diag?.elapsedMs ?? null
        };
        logEngineFsDebug("WebOsEngineFsResolver: EngineFS probe result", diagLog);
        if (!ready) return { status: "unavailable" };
        return {
          status: "success",
          stream: buildResolvedStream(stream, {
            infoHash: chosenInfoHash,
            fileIdx,
            playbackUrl,
            filename,
            baseUrlKind: "public-status",
            publicPlaybackUrl: playbackUrl
          })
        };
      }

      // No verified local or public EngineFS URL is available.
      console.warn("WebOsEngineFsResolver: no verified EngineFS playback URL", {
        infoHash: selectedInfoHash,
        fileIdx: selectedFileIdx,
        statusUrl: statusUrl || null,
        settingsBaseUrl: settingsBase || null,
        publicBaseCandidate: publicBaseCandidate || null,
        localBaseCandidate: localBaseCandidate || null,
        createResult: {
          returnValue: createPayload?.returnValue,
          statusCode: createPayload?.statusCode || null,
          proxiedPath: createPayload?.proxiedPath || null,
          json: createJson
            ? {
                infoHash: createJson.infoHash,
                guessedFileIdx: createJson.guessedFileIdx,
                fileIdx: createJson.fileIdx,
                baseUrl: createJson.baseUrl || createJson.base_url,
                playbackUrl: createJson.playbackUrl || createJson.playback
              }
            : null
        }
      });
      return { status: "unavailable" };
    } catch (error) {
      console.warn("WebOsEngineFsResolver: resolve failed", {
        error: describeError(error),
        rawError: error || null
      });
      return {
        status: "error",
        detail: describeError(error)
      };
    }
  },

  async remove(infoHash, { timeoutMs = 5000 } = {}) {
    const normalizedInfoHash = normalizeInfoHash(infoHash);
    if (!Platform.isWebOS() || !normalizedInfoHash) {
      return { status: "unsupported" };
    }
    if (!isWebOsCompanionServiceAvailable()) {
      return { status: "unavailable" };
    }
    try {
      const result = await withTimeout(
        requestWebOsCompanionService({
          method: "torrentRemove",
          parameters: {
            infoHash: normalizedInfoHash,
            timeoutMs
          }
        }),
        Math.max(1000, Number(timeoutMs || 5000) + 1000),
        "webOS EngineFS remove request timed out"
      );
      return result?.payload?.returnValue === false
        ? { status: "error", detail: result.payload.errorText || "" }
        : { status: "success", payload: result?.payload || null };
    } catch (error) {
      return {
        status: "error",
        detail: describeError(error)
      };
    }
  }
};
