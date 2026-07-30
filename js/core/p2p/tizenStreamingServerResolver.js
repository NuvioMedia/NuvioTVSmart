import { Platform } from "../../platform/index.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";

const TIZEN_STREAMING_KIND = "tizen-streaming-server";
const CREATE_TIMEOUT_MS = 60000;
const removeRequestsByInfoHash = new Map();

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
    if (parsed.protocol !== "http:") {
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
  if (Array.isArray(trackerSources) && trackerSources.length) {
    body.peerSearch = {
      sources: buildPeerSearchSources(infoHash, trackerSources),
      min: 40,
      max: 200
    };
  }
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
  return {
    ...stream,
    infoHash,
    fileIdx,
    url: playbackUrl,
    externalUrl: null,
    mimeType,
    sourceType: mimeType,
    tizenP2p: p2p,
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      filename: filename || stream.behaviorHints?.filename || null
    },
    raw: {
      ...(stream.raw || stream),
      tizenP2p: p2p,
      mimeType,
      sourceType: mimeType,
      type: mimeType
    }
  };
}

export const TizenStreamingServerResolver = {
  canResolveStream(stream = {}) {
    return Platform.isTizen() && Boolean(getInfoHash(stream));
  },

  getResolvedStreamState(stream = {}) {
    const state = stream?.tizenP2p || stream?.raw?.tizenP2p || null;
    if (state?.infoHash) {
      return {
        kind: TIZEN_STREAMING_KIND,
        infoHash: normalizeInfoHash(state.infoHash),
        fileIdx: Number.isFinite(Number(state.fileIdx)) ? Number(state.fileIdx) : -1,
        playbackUrl: String(state.playbackUrl || stream.url || "").trim(),
        baseUrl: normalizeBaseUrl(state.baseUrl || ""),
        baseUrlKind: String(state.baseUrlKind || "local-service"),
        mimeType:
          String(state.mimeType || stream.mimeType || stream.sourceType || "").trim() || null
      };
    }
    const playbackUrl = String(stream?.url || stream?.externalUrl || stream || "").trim();
    if (!playbackUrl) {
      return null;
    }
    try {
      const parsed = new URL(playbackUrl);
      const match = parsed.pathname.match(/\/([0-9a-f]{40})\/(-?\d+)(?:\/|$)/i);
      if (!match) {
        return null;
      }
      const fileIdx = Number(match[2]);
      const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
      return {
        kind: TIZEN_STREAMING_KIND,
        infoHash: String(match[1] || "").toLowerCase(),
        fileIdx: Number.isFinite(fileIdx) ? fileIdx : -1,
        playbackUrl,
        baseUrl: `${parsed.protocol}//${parsed.host}`,
        baseUrlKind: localHosts.has(parsed.hostname) ? "local-service" : "external-service",
        mimeType: String(stream?.mimeType || stream?.sourceType || "").trim() || null
      };
    } catch (_) {
      return null;
    }
  },

  async remove(infoHash, { baseUrl = "", timeoutMs = 2500 } = {}) {
    const normalizedHash = normalizeInfoHash(infoHash);
    if (!normalizedHash || !Platform.isTizen()) {
      return { status: "unsupported" };
    }
    const existingRequest = removeRequestsByInfoHash.get(normalizedHash);
    if (existingRequest) {
      return existingRequest;
    }
    const removeRequest = (async () => {
      const bases = uniqueBaseUrls([baseUrl, ...TizenEngineFsService.getLocalBaseUrls()]);
      let lastError = null;
      for (const candidateBaseUrl of bases) {
        try {
          const response = await withTimeout(
            fetch(`${candidateBaseUrl}/${encodeURIComponent(normalizedHash)}/remove`, {
              method: "GET",
              cache: "no-cache"
            }),
            timeoutMs,
            "Tizen EngineFS remove request timed out"
          );
          if (response.ok || response.status === 404) {
            return { status: "success", baseUrl: candidateBaseUrl };
          }
          lastError = new Error(`Tizen EngineFS remove failed with HTTP ${response.status}`);
        } catch (error) {
          lastError = error;
        }
      }
      return {
        status: "unavailable",
        detail: lastError?.message || "Tizen EngineFS remove endpoint unavailable"
      };
    })().finally(() => {
      removeRequestsByInfoHash.delete(normalizedHash);
    });
    removeRequestsByInfoHash.set(normalizedHash, removeRequest);
    return removeRequest;
  },

  async resolve(stream = {}, context = {}) {
    if (getDirectPlaybackUrl(stream)) {
      return { status: "success", stream };
    }
    if (!Platform.isTizen()) {
      return { status: "unsupported" };
    }
    const infoHash = getInfoHash(stream);
    if (!infoHash) {
      return { status: "unsupported", detail: "Missing torrent infoHash" };
    }

    try {
      let baseUrl = "";
      let baseUrlKind = "local-service";
      const localService = await TizenEngineFsService.ensureStarted();
      if (localService.status === "success" && localService.baseUrl) {
        baseUrl = localService.baseUrl;
        baseUrlKind = "local-service";
      } else {
        return {
          status: "error",
          detail: localService.detail || "Tizen local EngineFS service did not start"
        };
      }
      const magnetUri = getMagnetUri(stream);
      const trackerSources = getTrackerSources(stream, magnetUri);
      const explicitFileIdx = Number(
        stream.fileIdx ??
          stream.raw?.fileIdx ??
          stream.clientResolve?.fileIdx ??
          stream.raw?.clientResolve?.fileIdx
      );
      const hasExplicitFileIdx = Number.isFinite(explicitFileIdx) && explicitFileIdx >= 0;
      const season = Number(context?.season);
      const episode = Number(context?.episode);
      const needsCreate = !hasExplicitFileIdx || trackerSources.length > 0;
      const createJson = needsCreate
        ? await createTorrent(baseUrl, {
            infoHash,
            fileIdx: explicitFileIdx,
            trackerSources,
            season: Number.isFinite(season) ? season : null,
            episode: Number.isFinite(episode) ? episode : null
          })
        : { infoHash, fileIdx: explicitFileIdx };
      const fileIdx = selectFileIdx(stream, createJson);
      if (!Number.isFinite(fileIdx) || fileIdx < 0) {
        return {
          status: "error",
          detail: "Tizen streaming server did not return a playable file index"
        };
      }
      const sources =
        needsCreate && trackerSources.length
          ? buildPeerSearchSources(infoHash, trackerSources)
          : [];
      const playbackUrl = buildPlaybackUrl(baseUrl, infoHash, fileIdx, sources);
      const filename = getFilename(createJson, fileIdx);
      logTizenP2pDebug("TizenStreamingServerResolver: P2P stream resolved", {
        baseUrl,
        playbackUrl,
        infoHash,
        fileIdx,
        filename: filename || null,
        createUsed: needsCreate
      });
      return {
        status: "success",
        stream: buildResolvedStream(stream, {
          baseUrl,
          baseUrlKind,
          infoHash,
          fileIdx,
          playbackUrl,
          filename,
          sources
        })
      };
    } catch (error) {
      return {
        status: "error",
        detail: error?.message || String(error || "Tizen streaming server resolve failed")
      };
    }
  }
};
