import {
  StreamLinkCacheStore,
  activeStreamLinkProfile,
  isReusableHttpUrl
} from "../../data/local/streamLinkCacheStore.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";

export function saveReusableStreamLink(
  screen,
  candidate,
  { url = candidate?.url, headers = null } = {}
) {
  if (
    !candidate ||
    // A watch party host's shared link is never remembered as this device's own.
    candidate.partyShared ||
    candidate.raw?.partyShared ||
    !PlayerSettingsStore.get().streamReuseLastLinkEnabled ||
    screen.streamLinkCacheProfileId !== activeStreamLinkProfile() ||
    (screen.isActiveMountToken && !screen.isActiveMountToken())
  )
    return false;
  const raw = candidate.raw || {};
  if (
    candidate.serverPlayback ||
    raw.serverPlayback ||
    candidate.clientResolve?.mediaServer ||
    raw.clientResolve?.mediaServer ||
    candidate.externalUrl ||
    candidate.ytId ||
    raw.ytId
  )
    return false;
  const hints = { ...raw.behaviorHints, ...candidate.behaviorHints };
  const launchHints =
    candidate === screen.initialFilenameStreamCandidate ? screen.params || {} : {};
  const resolve = candidate.clientResolve || raw.clientResolve || {};
  const torrentState = candidate.engineFs || raw.engineFs || candidate.tizenP2p || raw.tizenP2p;
  const hash = String(
    candidate.infoHash || raw.infoHash || resolve.infoHash || torrentState?.infoHash || ""
  );
  const torrent = Boolean(
    torrentState || (!isReusableHttpUrl(url) && /^[0-9a-f]{40}$/i.test(hash))
  );
  const fileIdx = [torrentState?.fileIdx, candidate.fileIdx, raw.fileIdx, resolve.fileIdx].find(
    (value) => value != null && Number.isInteger(Number(value)) && Number(value) >= 0
  );
  const name =
    candidate.name ||
    candidate.title ||
    candidate.label ||
    candidate.addonName ||
    screen.params?.playerTitle ||
    screen.params?.itemTitle;
  return StreamLinkCacheStore.save(
    screen.params || {},
    {
      url: torrent ? "" : String(url || "").trim(),
      streamId: String(candidate.id || ""),
      streamName: String(name || "").trim(),
      headers: torrent ? {} : headers || hints.proxyHeaders?.request || {},
      filename:
        hints.filename || candidate.filename || raw.filename || launchHints.filename || null,
      // ClearKey streams are useless without their pairs: keep them with the link.
      clearKeys: hints.clearKeys || candidate.clearKeys || raw.clearKeys || null,
      videoHash: hints.videoHash || raw.videoHash || launchHints.videoHash || null,
      videoSize: hints.videoSize ?? raw.videoSize ?? launchHints.videoSize ?? null,
      bingeGroup: hints.bingeGroup || null,
      infoHash: torrent ? hash.toLowerCase() : null,
      fileIdx:
        torrent && fileIdx != null && Number.isInteger(Number(fileIdx)) && Number(fileIdx) >= 0
          ? Number(fileIdx)
          : null,
      sources:
        torrent && Array.isArray(candidate.sources || raw.sources)
          ? [...(candidate.sources || raw.sources)]
          : [],
      addonId: candidate.addonId || raw.addonId || null,
      addonBaseUrl: candidate.addonBaseUrl || raw.addonBaseUrl || null,
      addonName: candidate.addonName || raw.addonName || null,
      mimeType: torrent ? null : candidate.mimeType || null,
      sourceType: torrent ? null : candidate.sourceType || raw.sourceType || null,
      contentLanguage: screen.params?.contentLanguage || screen.params?.originalLanguage || null,
      year: screen.params?.year || screen.params?.playerReleaseYear || null
    },
    screen.streamLinkCacheProfileId
  );
}

export function cachedStreamLinkCandidate(cached) {
  return {
    id: cached.streamId || "cached-stream-link",
    name: cached.streamName,
    addonId: cached.addonId,
    addonBaseUrl: cached.addonBaseUrl,
    addonName: cached.addonName || cached.streamName,
    url: cached.url || null,
    infoHash: cached.infoHash || null,
    fileIdx: cached.fileIdx,
    sources: [...cached.sources],
    mimeType: cached.mimeType,
    sourceType: cached.sourceType,
    behaviorHints: {
      clearKeys: cached.clearKeys || null,
      filename: cached.filename,
      videoHash: cached.videoHash,
      videoSize: cached.videoSize,
      bingeGroup: cached.bingeGroup,
      proxyHeaders: { request: { ...cached.headers } }
    }
  };
}
