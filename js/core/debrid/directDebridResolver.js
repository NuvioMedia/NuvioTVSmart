import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { DebridApi } from "../../data/remote/api/debridApi.js";
import { DEBRID_CAPABILITIES, DEBRID_PROVIDER_IDS, DebridProviders } from "./debridProviders.js";
import {
  getDebridFileDisplayName,
  getDebridFileSize,
  selectDebridFile
} from "./debridFileSelection.js";

const RESOLVE_CACHE_TTL_MS = 15 * 60 * 1000;
const RESOLVE_CACHE_MAX_ENTRIES = 100;
const resolvedCache = new Map();
const inFlightResolves = new Map();

function isMagnetLink(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function getStreamUrl(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => value && !isMagnetLink(value)) || null;
}

function torrentMagnetUri(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => isMagnetLink(value)) || null;
}

function isDirectDebrid(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve;
  return Boolean(
    resolve &&
    String(resolve.type || "").toLowerCase() === "debrid" &&
    DebridProviders.isSupported(resolve.service) &&
    resolve.isCached === true
  );
}

function needsLocalDebridResolve(stream = {}) {
  return (
    !isDirectDebrid(stream) &&
    !getStreamUrl(stream) &&
    Boolean(stream.infoHash || torrentMagnetUri(stream))
  );
}

function stableFingerprint(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function trackerUrl(source) {
  const value = String(source || "").trim();
  if (!value || value.toLowerCase().startsWith("dht:")) {
    return null;
  }
  return value.replace(/^tracker:/i, "").trim() || null;
}

function buildMagnetUri(resolve = {}) {
  const existing = String(resolve.magnetUri || "").trim();
  if (existing) {
    return existing;
  }
  const hash = String(resolve.infoHash || "").trim();
  if (!hash) {
    return null;
  }
  const displayName = String(resolve.filename || resolve.torrentName || "").trim();
  const trackers = (Array.isArray(resolve.sources) ? resolve.sources : [])
    .map(trackerUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  return `magnet:?xt=urn:btih:${encodeURIComponent(hash)}${displayName ? `&dn=${encodeURIComponent(displayName)}` : ""}${trackers.map((source) => `&tr=${encodeURIComponent(source)}`).join("")}`;
}

function buildLocalResolve(stream = {}, season, episode, providerId) {
  const magnet =
    torrentMagnetUri(stream) ||
    buildMagnetUri({
      infoHash: stream.infoHash,
      sources: stream.sources
    });
  if (!magnet) {
    return null;
  }
  return {
    type: "torrent",
    infoHash: stream.infoHash || null,
    fileIdx: stream.fileIdx ?? null,
    magnetUri: magnet,
    sources: Array.isArray(stream.sources) ? stream.sources : [],
    torrentName: stream.title || stream.name || null,
    filename: stream.behaviorHints?.filename || null,
    title: stream.title || stream.name || null,
    season,
    episode,
    service: providerId,
    isCached: stream.debridCacheStatus?.state === "CACHED"
  };
}

function getResolve(
  stream = {},
  season = null,
  episode = null,
  settings = DebridSettingsStore.get()
) {
  const directResolve = stream.clientResolve || stream.raw?.clientResolve || null;
  if (directResolve) {
    return directResolve;
  }
  if (!needsLocalDebridResolve(stream)) {
    return null;
  }
  const credential = DebridProviders.preferredResolverService(settings);
  if (
    !credential ||
    !DebridProviders.supports(credential.provider.id, DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
  ) {
    return null;
  }
  return buildLocalResolve(stream, season, episode, credential.provider.id);
}

function cacheKeyFor(
  stream = {},
  season = null,
  episode = null,
  settings = DebridSettingsStore.get()
) {
  const resolve = getResolve(stream, season, episode, settings);
  if (!resolve) {
    return null;
  }
  const provider = DebridProviders.byId(resolve.service);
  const apiKey = DebridProviders.apiKeyFor(settings, provider?.id);
  if (!provider || !apiKey) {
    return null;
  }
  const identity = resolve.infoHash || resolve.magnetUri || resolve.torrentName || resolve.filename;
  if (!identity) {
    return null;
  }
  return [
    provider.id,
    stableFingerprint(apiKey),
    String(identity).trim().toLowerCase(),
    String(resolve.fileIdx ?? ""),
    String(resolve.filename || stream.behaviorHints?.filename || "")
      .trim()
      .toLowerCase(),
    String(season ?? resolve.season ?? ""),
    String(episode ?? resolve.episode ?? "")
  ].join("|");
}

function cachedResult(cacheKey) {
  const entry = resolvedCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAtMs > RESOLVE_CACHE_TTL_MS) {
    resolvedCache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

function rememberResolved(cacheKey, result) {
  resolvedCache.set(cacheKey, { result, cachedAtMs: Date.now() });
  while (resolvedCache.size > RESOLVE_CACHE_MAX_ENTRIES) {
    const oldestKey = resolvedCache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    resolvedCache.delete(oldestKey);
  }
}

function failure(status, detail = "") {
  return { status, detail };
}

function success(url, filename = null, videoSize = null) {
  return { status: "success", url, filename, videoSize };
}

function isServiceDegradedResponse(response = {}) {
  const status = Number(response?.status || 0);
  return status === 502 || status === 503 || status === 504;
}

function serviceDegradedFailure(response = {}, providerName = "Debrid") {
  if (!isServiceDegradedResponse(response)) {
    return null;
  }
  const status = Number(response?.status || 0);
  return failure("service_degraded", `${providerName} service returned HTTP ${status}.`);
}

async function resolveTorbox(resolve, apiKey, season, episode) {
  const magnet = buildMagnetUri(resolve);
  if (!magnet) {
    return failure("stale");
  }
  const create = await DebridApi.torboxCreateTorrent(apiKey, magnet);
  const torrentId = create.data?.data?.torrent_id ?? create.data?.data?.id;
  if (!create.ok || !torrentId) {
    const degraded = serviceDegradedFailure(create, "Torbox");
    if (degraded) {
      return degraded;
    }
    return create.status === 409
      ? failure("not_cached")
      : failure(create.status === 401 || create.status === 403 ? "error" : "stale");
  }
  const torrent = await DebridApi.torboxGetTorrent(apiKey, torrentId);
  const files = torrent.data?.data?.files || [];
  if (!torrent.ok || !Array.isArray(files)) {
    const degraded = serviceDegradedFailure(torrent, "Torbox");
    if (degraded) {
      return degraded;
    }
    return failure("stale");
  }
  const file = selectDebridFile(files, resolve, { season, episode, kind: "torbox" });
  if (!file) {
    return failure("stale");
  }
  const link = await DebridApi.torboxRequestDownloadLink(apiKey, torrentId, file.id);
  const url = typeof link.data?.data === "string" ? link.data.data : "";
  if (!link.ok || !url) {
    const degraded = serviceDegradedFailure(link, "Torbox");
    if (degraded) {
      return degraded;
    }
    return failure("stale");
  }
  return success(url, getDebridFileDisplayName(file), getDebridFileSize(file));
}

async function resolvePremiumize(resolve, apiKey, season, episode, stream = {}) {
  const source = buildMagnetUri(resolve) || getStreamUrl(stream);
  if (!source) {
    return failure("stale");
  }
  const response = await DebridApi.premiumizeDirectDownload(apiKey, source);
  if (!response.ok) {
    return failure(response.status === 401 || response.status === 403 ? "error" : "stale");
  }
  const body = response.data || {};
  if (String(body.status || "").toLowerCase() === "error") {
    const message = `${body.message || ""} ${body.code || ""}`.toLowerCase();
    return failure(
      message.includes("cache") || message.includes("not found") ? "not_cached" : "stale",
      message
    );
  }
  const file = selectDebridFile(body.content || [], resolve, {
    season,
    episode,
    kind: "premiumize"
  });
  const url = file?.link || "";
  if (!file || !url) {
    return failure("stale");
  }
  return success(
    url,
    getDebridFileDisplayName(file) || stream.behaviorHints?.filename || null,
    getDebridFileSize(file) || stream.behaviorHints?.videoSize || null
  );
}

async function resolveRealDebrid(resolve, apiKey, season, episode) {
  const magnet = buildMagnetUri(resolve);
  if (!magnet) {
    return failure("stale");
  }
  const add = await DebridApi.realDebridAddMagnet(apiKey, magnet);
  const torrentId = add.data?.id;
  if (!add.ok || !torrentId) {
    return failure(add.status === 401 || add.status === 403 ? "error" : "stale");
  }
  let resolved = false;
  try {
    const infoBefore = await DebridApi.realDebridTorrentInfo(apiKey, torrentId);
    const files = infoBefore.data?.files || [];
    if (!infoBefore.ok || !Array.isArray(files)) {
      return failure("stale");
    }
    const file = selectDebridFile(files, resolve, { season, episode, kind: "realdebrid" });
    if (file?.id == null) {
      return failure("stale");
    }
    const select = await DebridApi.realDebridSelectFiles(apiKey, torrentId, String(file.id));
    if (!select.ok && select.status !== 202) {
      return failure("stale");
    }
    const infoAfter = await DebridApi.realDebridTorrentInfo(apiKey, torrentId);
    if (!infoAfter.ok || String(infoAfter.data?.status || "").toLowerCase() !== "downloaded") {
      return failure("stale");
    }
    const link = (Array.isArray(infoAfter.data?.links) ? infoAfter.data.links : []).find(Boolean);
    if (!link) {
      return failure("stale");
    }
    const unrestricted = await DebridApi.realDebridUnrestrictLink(apiKey, link);
    const url = unrestricted.data?.download || "";
    if (!unrestricted.ok || !url) {
      return failure("stale");
    }
    resolved = true;
    return success(
      url,
      unrestricted.data?.filename || getDebridFileDisplayName(file),
      unrestricted.data?.filesize || getDebridFileSize(file)
    );
  } finally {
    if (!resolved) {
      DebridApi.realDebridDeleteTorrent(apiKey, torrentId).catch(() => null);
    }
  }
}

async function getLocalTorrentCacheStatus(provider, apiKey, hash) {
  const normalized = String(hash || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { status: "unknown" };
  }
  if (provider.id === DEBRID_PROVIDER_IDS.TORBOX) {
    const response = await DebridApi.torboxCheckCached(apiKey, [normalized]);
    const degraded = serviceDegradedFailure(response, "Torbox");
    if (degraded) {
      return degraded;
    }
    if (!response.ok || response.data?.success === false) {
      return { status: "unknown" };
    }
    return { status: "success", cached: Boolean(response.data?.data?.[normalized]) };
  }
  if (provider.id === DEBRID_PROVIDER_IDS.PREMIUMIZE) {
    const response = await DebridApi.premiumizeCheckCache(apiKey, [normalized]);
    const degraded = serviceDegradedFailure(response, "Premiumize");
    if (degraded) {
      return degraded;
    }
    if (!response.ok || String(response.data?.status || "").toLowerCase() === "error") {
      return { status: "unknown" };
    }
    return { status: "success", cached: response.data?.response?.[0] === true };
  }
  return { status: "unknown" };
}

function withResolvedUrl(stream = {}, result) {
  return {
    ...stream,
    url: result.url,
    externalUrl: null,
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      filename: result.filename || stream.behaviorHints?.filename || null,
      videoSize: result.videoSize || stream.behaviorHints?.videoSize || null
    },
    raw: {
      ...(stream.raw || stream),
      url: result.url,
      externalUrl: null,
      behaviorHints: {
        ...(stream.raw?.behaviorHints || stream.behaviorHints || {}),
        filename: result.filename || stream.behaviorHints?.filename || null,
        videoSize: result.videoSize || stream.behaviorHints?.videoSize || null
      }
    }
  };
}

export const DirectDebridResolver = {
  canResolveStream(stream = {}, { season = null, episode = null } = {}) {
    const settings = DebridSettingsStore.get();
    if (!settings.enabled) {
      return false;
    }
    const resolve = getResolve(stream, season, episode, settings);
    if (!resolve) {
      return false;
    }
    const provider = DebridProviders.byId(resolve.service);
    if (!provider) {
      return false;
    }
    const activeProvider = DebridProviders.preferredResolverService(settings)?.provider || null;
    if (isDirectDebrid(stream) && activeProvider?.id && provider.id !== activeProvider.id) {
      return false;
    }
    if (
      needsLocalDebridResolve(stream) &&
      !provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
    ) {
      return false;
    }
    if (needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED") {
      return false;
    }
    return Boolean(DebridProviders.apiKeyFor(settings, provider.id));
  },

  shouldListStream(stream = {}) {
    return Boolean(getStreamUrl(stream) || stream.ytId || this.canResolveStream(stream));
  },

  async resolve(stream = {}, { season = null, episode = null } = {}) {
    if (getStreamUrl(stream)) {
      return { status: "success", stream };
    }
    const settings = DebridSettingsStore.get();
    if (!settings.enabled) {
      return failure("disabled");
    }
    const resolve = getResolve(stream, season, episode, settings);
    if (!resolve) {
      return failure("stale");
    }
    const provider = DebridProviders.byId(resolve.service);
    const apiKey = DebridProviders.apiKeyFor(settings, provider?.id);
    if (!provider || !apiKey) {
      return failure("missing_api_key");
    }
    const activeProvider = DebridProviders.preferredResolverService(settings)?.provider || null;
    if (isDirectDebrid(stream) && activeProvider?.id && provider.id !== activeProvider.id) {
      return failure("stale");
    }
    if (needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED") {
      return failure("not_cached");
    }
    if (
      needsLocalDebridResolve(stream) &&
      stream.infoHash &&
      stream.debridCacheStatus?.state !== "CACHED" &&
      provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_CACHE_CHECK)
    ) {
      const cacheStatus = await getLocalTorrentCacheStatus(provider, apiKey, stream.infoHash).catch(
        (error) => failure("error", error?.message || "")
      );
      if (cacheStatus?.status === "service_degraded") {
        return cacheStatus;
      }
      if (cacheStatus?.status === "success" && cacheStatus.cached === false) {
        return failure("not_cached");
      }
    }

    const key = cacheKeyFor(stream, season, episode, settings);
    if (key) {
      const cached = cachedResult(key);
      if (cached) {
        return { status: "success", stream: withResolvedUrl(stream, cached) };
      }
      const inFlight = inFlightResolves.get(key);
      if (inFlight) {
        const result = await inFlight;
        return result.status === "success"
          ? { status: "success", stream: withResolvedUrl(stream, result) }
          : result;
      }
    }

    const task = (async () => {
      switch (provider.id) {
        case DEBRID_PROVIDER_IDS.TORBOX:
          return resolveTorbox(resolve, apiKey, season, episode);
        case DEBRID_PROVIDER_IDS.PREMIUMIZE:
          return resolvePremiumize(resolve, apiKey, season, episode, stream);
        case DEBRID_PROVIDER_IDS.REAL_DEBRID:
          return resolveRealDebrid(resolve, apiKey, season, episode);
        default:
          return failure("error");
      }
    })();

    if (key) {
      inFlightResolves.set(key, task);
    }
    try {
      const result = await task;
      if (key && result.status === "success") {
        rememberResolved(key, result);
      }
      return result.status === "success"
        ? { status: "success", stream: withResolvedUrl(stream, result) }
        : result;
    } catch (error) {
      return failure("error", error?.message || "");
    } finally {
      if (key && inFlightResolves.get(key) === task) {
        inFlightResolves.delete(key);
      }
    }
  }
};
