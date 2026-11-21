/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods10() {
  const {
    PlayerController,
    Environment,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    subscribeWebOsCompanionService,
    logEngineFsDebug,
    isLocalEngineFsUrl,
    releaseEngineFsPlaybackClaim,
    hasActiveEngineFsPlaybackClaim,
    scheduleDeferredEngineFsRemoval
  } = internals;

  return {
    isDebridPlaybackCandidate(streamCandidate = this.getCurrentStreamCandidate()) {
      const stream = streamCandidate?.raw || streamCandidate || {};
      const resolve = streamCandidate?.clientResolve || stream?.clientResolve || {};
      const debridCacheStatus = streamCandidate?.debridCacheStatus || stream?.debridCacheStatus || null;
      return Boolean(String(resolve.type || "").toLowerCase() === "debrid" || debridCacheStatus);
    },
    getStreamSearchText(streamCandidate) {
      const stream = streamCandidate?.raw || streamCandidate || {};
      return String(
        [
          streamCandidate?.label || "",
          streamCandidate?.description || "",
          streamCandidate?.sourceType || "",
          streamCandidate?.url || "",
          stream?.title || "",
          stream?.name || "",
          stream?.description || "",
          stream?.url || ""
        ].join(" ")
      ).toLowerCase();
    },
    getWebOsAudioCompatibilityScore(streamCandidate) {
      const text = this.getStreamSearchText(streamCandidate);
      let score = 0;

      if (/\b(aac|mp4a)\b/.test(text)) score += 22;
      if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score += 14;
      if (/\b(mp3|mpeg audio)\b/.test(text)) score += 8;
      if (/\b(stereo|2\.0|2ch)\b/.test(text)) score += 8;

      if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score -= 28;
      const devicePenalty =
        typeof PlayerController.getWebOsUnsupportedAudioPenalty === "function"
          ? Number(PlayerController.getWebOsUnsupportedAudioPenalty(text) || 0)
          : 0;
      if (devicePenalty !== 0) {
        score += devicePenalty;
      } else if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
        score -= 45;
      }
      if (/\b(7\.1|8ch)\b/.test(text)) score -= 12;
      if (/\b(flac|alac)\b/.test(text)) score -= 10;

      return score;
    },
    getStreamCandidateByUrl(streamUrl) {
      const normalized = String(streamUrl || "").trim();
      if (!normalized) {
        return null;
      }
      return this.streamCandidates.find((entry) => String(entry?.url || "").trim() === normalized) || null;
    },
    getEngineFsStateForStream(streamCandidate = null) {
      if (Environment.isWebOS()) {
        const state = WebOsEngineFsResolver.getResolvedStreamState(streamCandidate || {});
        if (state) {
          return state;
        }
      } else if (Environment.isTizen() || Environment.isVidaa()) {
        const state = TizenStreamingServerResolver.getResolvedStreamState(streamCandidate || {});
        if (state) {
          return state;
        }
      } else {
        return null;
      }
      const playbackUrl = String(streamCandidate?.url || streamCandidate?.externalUrl || streamCandidate || "").trim();
      if (!playbackUrl) {
        return null;
      }
      try {
        const parsed = new URL(playbackUrl);
        const match = parsed.pathname.match(/\/([0-9a-f]{40})\/(-?\d+)(?:\/|$)/i);
        if (!match) {
          return null;
        }
        const isLocalPlayback = isLocalEngineFsUrl(playbackUrl);
        if ((Environment.isTizen() || Environment.isWebOS() || Environment.isVidaa()) && !isLocalPlayback) {
          return null;
        }
        const fileIdx = Number(match[2]);
        return {
          kind: Environment.isTizen() || Environment.isVidaa() ? "tizen-streaming-server" : "webos-enginefs",
          infoHash: String(match[1] || "").toLowerCase(),
          fileIdx: Number.isFinite(fileIdx) ? fileIdx : -1,
          playbackUrl,
          mimeType: String(streamCandidate?.mimeType || streamCandidate?.sourceType || "").trim() || null,
          baseUrlKind: isLocalPlayback ? "local-service" : "public-service",
          publicPlaybackUrl: isLocalEngineFsUrl(
            streamCandidate?.engineFs?.publicPlaybackUrl || streamCandidate?.raw?.engineFs?.publicPlaybackUrl || ""
          )
            ? String(streamCandidate?.engineFs?.publicPlaybackUrl || streamCandidate?.raw?.engineFs?.publicPlaybackUrl || "").trim()
            : null,
          baseUrl: `${parsed.protocol}//${parsed.host}`
        };
      } catch (_) {
        return null;
      }
    },
    engineFsStateKey(state = null) {
      return state?.infoHash ? `${state.infoHash}:${state.fileIdx ?? -1}` : "";
    },
    isSameEngineFsState(a = null, b = null) {
      return Boolean(a && b && this.engineFsStateKey(a) === this.engineFsStateKey(b));
    },
    engineFsCleanupKey(state = null) {
      return state?.infoHash ? String(state.infoHash).toLowerCase() : "";
    },
    isExpectedEngineFsCleanupError(value = "") {
      const text = String(
        typeof value === "object" && value ? value.detail || value.errorText || value.message || value.status || "" : value || ""
      ).toLowerCase();
      return (
        text.includes("message not processed") ||
        text.includes("connection refused") ||
        text.includes("econnrefused") ||
        text.includes("failed to fetch") ||
        text.includes("network error") ||
        text.includes("not found") ||
        text.includes("404") ||
        text.includes("unavailable") ||
        text.includes("timed out")
      );
    },
    async cleanupEngineFsState(state = null, reason = "cleanup", { deferMs = 0 } = {}) {
      const target = state?.infoHash ? state : null;
      if (!target) {
        return false;
      }
      const key = this.engineFsCleanupKey(target);
      const existing = this.engineFsRemovalRequests.get(key);
      if (existing) {
        return existing;
      }

      const performRemoval = async () => {
        if (hasActiveEngineFsPlaybackClaim(target)) {
          logEngineFsDebug("EngineFS torrent remove skipped; stream is active", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx
          });
          return false;
        }
        try {
          const result =
            target.kind === "tizen-streaming-server"
              ? await TizenStreamingServerResolver.remove(target.infoHash, {
                  baseUrl: target.baseUrl,
                  timeoutMs: 2500
                })
              : await WebOsEngineFsResolver.remove(target.infoHash, { timeoutMs: 2500 });
          if (result?.status === "success") {
            logEngineFsDebug("EngineFS torrent removed", {
              reason,
              infoHash: target.infoHash,
              fileIdx: target.fileIdx
            });
            return true;
          }
          if (result?.status === "unsupported" || result?.status === "unavailable") {
            logEngineFsDebug("EngineFS torrent remove unavailable", {
              reason,
              infoHash: target.infoHash,
              fileIdx: target.fileIdx,
              status: result.status
            });
            return false;
          }
          if (this.isExpectedEngineFsCleanupError(result)) {
            logEngineFsDebug("EngineFS torrent remove ignored", {
              reason,
              infoHash: target.infoHash,
              fileIdx: target.fileIdx,
              result
            });
            return false;
          }
          logEngineFsDebug("EngineFS torrent remove failed", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx,
            result
          });
          return false;
        } catch (error) {
          if (this.isExpectedEngineFsCleanupError(error)) {
            logEngineFsDebug("EngineFS torrent remove ignored", {
              reason,
              infoHash: target.infoHash,
              fileIdx: target.fileIdx,
              error
            });
            return false;
          }
          logEngineFsDebug("EngineFS torrent remove threw", {
            reason,
            infoHash: target.infoHash,
            fileIdx: target.fileIdx,
            error
          });
          return false;
        }
      };

      const removalPromise = scheduleDeferredEngineFsRemoval(target, reason, deferMs, performRemoval) || performRemoval();

      this.engineFsRemovalRequests.set(key, removalPromise);
      try {
        return await removalPromise;
      } finally {
        if (this.engineFsRemovalRequests.get(key) === removalPromise) {
          this.engineFsRemovalRequests.delete(key);
        }
      }
    },
    startEngineFsKeepAlive(state = this.currentEngineFsStream) {
      if (!state?.infoHash) {
        return;
      }
      if (state.kind === "tizen-streaming-server") {
        this.stopEngineFsKeepAlive();
        logEngineFsDebug("EngineFS keepalive skipped for Tizen local service", {
          infoHash: state.infoHash,
          fileIdx: state.fileIdx
        });
        return;
      }
      const token = `${state.infoHash}:${state.fileIdx ?? -1}:${Date.now()}`;
      this.stopEngineFsKeepAlive();
      this.engineFsKeepAliveToken = token;
      try {
        this.engineFsKeepAliveHandle = subscribeWebOsCompanionService({
          method: "enginefsKeepAlive",
          parameters: {
            token,
            infoHash: state.infoHash,
            fileIdx: state.fileIdx,
            intervalMs: 8000
          },
          onSuccess: (payload) => {
            if (payload?.settingsReachable === false) {
              logEngineFsDebug("EngineFS keepalive reports runtime unavailable", {
                token,
                payload
              });
            }
          },
          onFailure: (error) => {
            console.warn("EngineFS keepalive failed", {
              token,
              error
            });
          }
        });
        logEngineFsDebug("EngineFS keepalive started", {
          token,
          infoHash: state.infoHash,
          fileIdx: state.fileIdx
        });
      } catch (error) {
        console.warn("EngineFS keepalive could not start", {
          token,
          error
        });
      }
    },
    stopEngineFsKeepAlive() {
      if (this.engineFsKeepAliveHandle) {
        try {
          this.engineFsKeepAliveHandle.cancel?.();
        } catch (_) {
          // Ignore local cancellation failures.
        }
        this.engineFsKeepAliveHandle = null;
      }
      // The Luna subscription cancellation is the authoritative stop signal.
      // Do not send a second one-shot stop request here: if the service was
      // already evicted, that request would start it again just to stop a token
      // that no longer exists.
      this.engineFsKeepAliveToken = "";
    },
    async releaseCurrentEngineFsStream(reason = "cleanup", { removeTorrent = false, deferRemoveMs = 0 } = {}) {
      const current = this.currentEngineFsStream;
      if (!current) {
        return;
      }
      const playbackToken = this.engineFsPlaybackToken;
      this.stopEngineFsKeepAlive();
      this.clearPlaybackStallGuard();
      if (this.engineFsStartupRetryTimer) {
        clearTimeout(this.engineFsStartupRetryTimer);
        this.engineFsStartupRetryTimer = null;
      }
      this.engineFsStartupErrorRetries = 0;
      this.lastEngineFsStartupErrorStats = null;
      this.lastEngineFsStallStats = null;
      this.engineFsStallExtensions = 0;
      this.currentEngineFsStream = null;
      this.stopLoadingLogoFillAnimation();
      this.loadingProgress = null;
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.loadingTorrentStatus = "";
      this.torrentOverlayData = null;
      this.syncLoadingOverlayProgress();
      this.syncTorrentOverlay();
      this.engineFsPlaybackToken = "";
      releaseEngineFsPlaybackClaim(current, playbackToken);
      if (!removeTorrent || !current.infoHash) {
        return;
      }
      await this.cleanupEngineFsState(current, reason, { deferMs: deferRemoveMs });
    }
  };
}
