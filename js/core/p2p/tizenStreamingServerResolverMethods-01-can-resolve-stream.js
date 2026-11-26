/* eslint-disable no-unused-vars */
import * as internals from "./tizenStreamingServerResolver.js";

export function createTizenStreamingServerResolverMethods01() {
  const {
    Platform,
    TizenEngineFsService,
    TorrentSettingsStore,
    TizenCapabilities,
    TIZEN_STREAMING_KIND,
    removeRequestsByInfoHash,
    logTizenP2pDebug,
    normalizeInfoHash,
    getInfoHash,
    getMagnetUri,
    getDirectPlaybackUrl,
    getTrackerSources,
    normalizeBaseUrl,
    uniqueBaseUrls,
    withTimeout,
    buildPeerSearchSources,
    buildPlaybackUrl,
    selectFileIdx,
    getFilename,
    createTorrent,
    buildResolvedStream
  } = internals;

  return {
    canResolveStream(stream = {}) {
      return Platform.isTizen() && TizenCapabilities.canUseP2p() && Boolean(getInfoHash(stream));
    },
    // Starting EngineFS takes several seconds on Tizen 6 (#1609); begin while the
    // source list is open so playback does not wait for it.
    warmUpForStreams(streams = []) {
      if (!TorrentSettingsStore.get().p2pEnabled || !streams.some((stream) => this.canResolveStream(stream))) {
        return false;
      }
      void TizenEngineFsService.ensureStarted({ purpose: "p2p" }).catch(() => {});
      return true;
    },
    isTorrentStream(stream = {}) {
      return Boolean(getInfoHash(stream));
    },
    isUnsupportedOnCurrentTizen(stream = {}) {
      return Platform.isTizen() && this.isTorrentStream(stream) && !TizenCapabilities.canUseP2p();
    },
    getResolvedStreamState(stream = {}) {
      const state = stream?.tizenP2p || stream?.raw?.tizenP2p || null;
      if (state?.infoHash) {
        const playbackUrl = String(state.playbackUrl || stream.url || "").trim();
        if (playbackUrl && !normalizeBaseUrl(playbackUrl)) {
          return null;
        }
        return {
          kind: TIZEN_STREAMING_KIND,
          infoHash: normalizeInfoHash(state.infoHash),
          fileIdx: Number.isFinite(Number(state.fileIdx)) ? Number(state.fileIdx) : -1,
          playbackUrl,
          baseUrl: normalizeBaseUrl(state.baseUrl || ""),
          baseUrlKind: "local-service",
          mimeType: String(state.mimeType || stream.mimeType || stream.sourceType || "").trim() || null
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
        if (!normalizeBaseUrl(playbackUrl)) {
          return null;
        }
        const fileIdx = Number(match[2]);
        return {
          kind: TIZEN_STREAMING_KIND,
          infoHash: String(match[1] || "").toLowerCase(),
          fileIdx: Number.isFinite(fileIdx) ? fileIdx : -1,
          playbackUrl,
          baseUrl: `${parsed.protocol}//${parsed.host}`,
          baseUrlKind: "local-service",
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
      if (!TizenCapabilities.canUseP2p()) {
        return { status: "unsupported", detail: "Tizen P2P streaming is not supported on this TV" };
      }
      const infoHash = getInfoHash(stream);
      if (!infoHash) {
        return { status: "unsupported", detail: "Missing torrent infoHash" };
      }

      try {
        let baseUrl = "";
        const baseUrlKind = "local-service";
        const localService = await TizenEngineFsService.ensureStarted({ purpose: "p2p" });
        if (localService.status === "success" && localService.baseUrl) {
          baseUrl = localService.baseUrl;
        } else {
          return {
            status: "error",
            detail: localService.detail || "Tizen local EngineFS service did not start"
          };
        }
        const magnetUri = getMagnetUri(stream);
        const trackerSources = getTrackerSources(stream, magnetUri);
        const explicitFileIdx = Number(
          stream.fileIdx ?? stream.raw?.fileIdx ?? stream.clientResolve?.fileIdx ?? stream.raw?.clientResolve?.fileIdx
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
        const sources = needsCreate && trackerSources.length ? buildPeerSearchSources(infoHash, trackerSources) : [];
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
}
