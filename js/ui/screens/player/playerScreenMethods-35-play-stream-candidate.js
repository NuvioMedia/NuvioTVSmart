import { newerServerResume } from "../../../data/mediaserver/mediaServerUserState.js";
import { WatchProgressStore } from "../../../data/local/watchProgressStore.js";
import { MediaServerRepository, canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
import { StreamLinkCacheStore } from "../../../data/local/streamLinkCacheStore.js";
import { findSourceRefreshCandidate, hasLikelyExpiringPlaybackCredentials } from "../../../core/player/playbackUrlCredentials.js";
import { isSourceFallbackActive, nextSourceFallbackCandidate, sourceFallbackKey } from "../../../core/player/sourceFallback.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

const EXPIRED_LINK_REFRESH_TIMEOUT_MS = 15000;
// Android polls the joined source search 30 times, 500 ms apart.
const SOURCE_FALLBACK_POLL_COUNT = 30;
const SOURCE_FALLBACK_POLL_INTERVAL_MS = 500;

export function createPlayerScreenMethods35() {
  const {
    streamRepository,
    TorrentSettingsStore,
    DirectDebridResolver,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    logEngineFsDebug,
    getP2pInfoHash,
    t,
    streamDirectPlaybackUrl,
    normalizeItemType,
    flattenStreamGroups,
    mergeStreamItems,
    PlayerSettingsStore,
    addonRepository
  } = internals;

  return {
    tryServerPlaybackFallback(streamCandidate = this.getCurrentStreamCandidate()) {
      const playback = streamCandidate?.serverPlayback || streamCandidate?.raw?.serverPlayback;
      if (!this.activePlaybackUrl || playback?.playMethod !== "DirectPlay" || !canResolveMediaServerStream(streamCandidate)) return false;
      if (playback.fallbackRequested) return true;
      playback.fallbackRequested = true;
      if (!this.pendingPlaybackRestore) {
        this.pendingPlaybackRestore = {
          timeSeconds: this.getPlaybackCurrentSeconds(),
          paused: this.paused,
          attempts: 0,
          lastAttemptAt: 0
        };
      }
      void this.playStreamCandidate(streamCandidate, {
        serverFallbackUrl: this.activePlaybackUrl,
        preservePlaybackState: true,
        mountToken: this.playerMountToken
      });
      return true;
    },
    async playStreamCandidate(streamCandidate, options = {}) {
      const mountToken = options?.mountToken ?? null;
      if (!this.isActiveMountToken(mountToken)) {
        return;
      }
      if (!streamCandidate) {
        return;
      }
      streamRepository.setLocalPluginSearchPaused(true);
      const forceEngineFsResolve = options?.forceEngineFsResolve === true;
      let targetUrl = forceEngineFsResolve ? "" : streamDirectPlaybackUrl(streamCandidate);
      if (canResolveMediaServerStream(streamCandidate)) {
        const isCurrentRequest = () =>
          this.isActiveMountToken(mountToken) &&
          (!options.serverFallbackUrl ||
            (this.activePlaybackUrl === options.serverFallbackUrl && this.getCurrentStreamCandidate()?.id === streamCandidate.id));
        try {
          const result = await MediaServerRepository.resolve(streamCandidate, {
            allowDirectPlay: !options.serverFallbackUrl
          });
          if (!isCurrentRequest()) {
            if (result.status === "success" && options.serverFallbackUrl)
              void MediaServerRepository.report(result.stream.serverPlayback, "stop", 0, true).catch(() => {});
            return;
          }
          if (result.status !== "success" || !result.stream?.url) throw new Error("servers_playback_failed");
          Object.assign(streamCandidate, result.stream);
          targetUrl = result.stream.url;
          const saved = WatchProgressStore.listForProfile(result.stream.serverPlayback.profileId).find(
            (entry) =>
              entry.contentId === this.params?.itemId &&
              (entry.season ?? null) === (this.params?.season ?? null) &&
              (entry.episode ?? null) === (this.params?.episode ?? null)
          );
          const resume = newerServerResume(result.stream.serverUserState, saved, this.params?.startFromBeginning);
          if (resume && !options.preservePlaybackState) {
            this.pendingPlaybackRestore = { timeSeconds: resume.positionMs / 1000, paused: false, attempts: 0, lastAttemptAt: 0 };
            options = { ...options, preservePendingRestore: true };
          }
          this.streamCandidates = this.streamCandidates.map((entry) =>
            entry.id === streamCandidate.id ? { ...entry, ...streamCandidate } : entry
          );
        } catch (_) {
          if (isCurrentRequest()) this.showStartupError?.(t("servers_playback_failed", {}, "Could not start playback from the server."));
          return;
        }
      }
      if (!targetUrl) {
        const resolveContext = {
          season: this.params?.season == null ? null : Number(this.params.season),
          episode: this.params?.episode == null ? null : Number(this.params.episode)
        };
        const canUseEngineFs = WebOsEngineFsResolver.canResolveStream(streamCandidate);
        const canUseTizenP2p = TizenStreamingServerResolver.canResolveStream(streamCandidate);
        const canResolveP2p = canUseEngineFs || canUseTizenP2p;
        const tizenP2pUnsupported = TizenStreamingServerResolver.isUnsupportedOnCurrentTizen(streamCandidate);
        const p2pEnabled = Boolean(TorrentSettingsStore.get().p2pEnabled);
        const canUseP2p = p2pEnabled && canResolveP2p;
        let fallbackError = "";
        let resolveFailureStatus = "";
        let resolveFailureDetail = "";
        let preResolveEngineFsKeepAliveToken = "";
        const stopPreResolveEngineFsKeepAlive = () => {
          if (
            !preResolveEngineFsKeepAliveToken ||
            this.engineFsKeepAliveToken !== preResolveEngineFsKeepAliveToken ||
            this.currentEngineFsStream
          ) {
            return;
          }
          this.stopEngineFsKeepAlive();
        };

        if (DirectDebridResolver.canResolveStream(streamCandidate, resolveContext)) {
          const result = await DirectDebridResolver.resolve(streamCandidate, resolveContext);
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          if (result.status === "success" && result.stream?.url) {
            targetUrl = result.stream.url;
            Object.assign(streamCandidate, {
              url: targetUrl,
              externalUrl: null,
              // Android Stream.debridResolved: the URL came from Nuvio's resolver, not the add-on.
              debridResolved: true,
              mimeType: result.stream.mimeType || streamCandidate.mimeType,
              sourceType: result.stream.sourceType || streamCandidate.sourceType,
              behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
              raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
            });
          } else {
            fallbackError =
              result.status === "service_degraded"
                ? t(
                    "stream.debrid.serviceDegraded",
                    {},
                    "The Debrid service is currently degraded. Try again later or choose another source."
                  )
                : result.status === "not_cached"
                  ? t("stream.debrid.notCached", {}, "Not cached on this service.")
                  : result.status === "stale"
                    ? t("stream.debrid.stale", {}, "This Debrid result expired. Refreshing streams.")
                    : t("stream.debrid.failed", {}, "Could not resolve this Debrid stream.");
            resolveFailureStatus = result.status || "debrid-failed";
            resolveFailureDetail = result.detail || result.error || "";
            if (result.status === "service_degraded") {
              if (!this.hasPresentedPlaybackFrame) {
                this.showStartupError(fallbackError, {
                  streamCandidate,
                  reason: "debrid-resolve",
                  resolverStatus: resolveFailureStatus,
                  resolverDetail: resolveFailureDetail
                });
              } else {
                this.sourcesError = this.formatPlaybackErrorForSources(fallbackError, {
                  streamCandidate,
                  reason: "debrid-resolve",
                  resolverStatus: resolveFailureStatus,
                  resolverDetail: resolveFailureDetail
                });
                this.renderSourcesPanel();
              }
              return;
            }
          }
        }

        if (!targetUrl && canUseP2p) {
          if (canUseEngineFs && !this.currentEngineFsStream && !this.engineFsKeepAliveToken) {
            const infoHash = getP2pInfoHash(streamCandidate);
            if (infoHash) {
              this.startEngineFsKeepAlive({
                kind: "webos-enginefs",
                infoHash,
                fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
              });
              preResolveEngineFsKeepAliveToken = this.engineFsKeepAliveToken;
              logEngineFsDebug("EngineFS keepalive started before P2P resolve", {
                infoHash,
                fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
              });
            }
          }
          const result = canUseEngineFs
            ? await WebOsEngineFsResolver.resolve(streamCandidate, resolveContext)
            : await TizenStreamingServerResolver.resolve(streamCandidate, resolveContext);
          if (!this.isActiveMountToken(mountToken)) {
            stopPreResolveEngineFsKeepAlive();
            const resolvedEngineFs = result?.stream?.engineFs || null;
            if (resolvedEngineFs?.infoHash) {
              void this.cleanupEngineFsState(resolvedEngineFs, "stale-p2p-resolve", {
                deferMs: 0
              }).catch(() => null);
            }
            return;
          }
          if (result.status === "success" && result.stream?.url) {
            targetUrl = result.stream.url;
            Object.assign(streamCandidate, {
              url: targetUrl,
              externalUrl: null,
              infoHash: result.stream.infoHash || streamCandidate.infoHash,
              fileIdx: result.stream.fileIdx ?? streamCandidate.fileIdx,
              engineFs: result.stream.engineFs || streamCandidate.engineFs || null,
              tizenP2p: result.stream.tizenP2p || streamCandidate.tizenP2p || null,
              mimeType: result.stream.mimeType || streamCandidate.mimeType,
              sourceType: result.stream.sourceType || streamCandidate.sourceType,
              behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
              raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
            });
          } else {
            resolveFailureStatus = result?.status || "p2p-failed";
            resolveFailureDetail = result?.detail || result?.error || "";
            console.warn("PlayerScreen: P2P resolve failed", {
              status: result.status,
              detail: result.detail || "",
              infoHash:
                streamCandidate.infoHash ||
                streamCandidate.raw?.infoHash ||
                streamCandidate.clientResolve?.infoHash ||
                streamCandidate.raw?.clientResolve?.infoHash ||
                "",
              fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
            });

            stopPreResolveEngineFsKeepAlive();
          }
        }

        if (!targetUrl) {
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          const startupMessage =
            fallbackError ||
            (tizenP2pUnsupported
              ? t("player_error_tizen_p2p_unsupported", {}, "Torrent/P2P streaming is not supported on this TV.")
              : !p2pEnabled && canResolveP2p
                ? t("player_error_p2p_disabled", {}, "P2P streaming is disabled. Enable P2P in Settings to play torrent streams.")
                : canUseP2p
                  ? t(
                      "player_error_failed_start_torrent",
                      [t("player_error_playback_fallback", {}, "Playback error")],
                      "Failed to start torrent: %1$s"
                    )
                  : t("player_error_playback_fallback", {}, "Playback error"));
          if (!this.hasPresentedPlaybackFrame) {
            this.showStartupError(startupMessage, {
              streamCandidate,
              reason: tizenP2pUnsupported
                ? "tizen-p2p-unsupported"
                : !p2pEnabled && canResolveP2p
                  ? "p2p-disabled"
                  : canUseP2p
                    ? "p2p-resolve"
                    : "stream-resolve",
              resolverStatus: resolveFailureStatus,
              resolverDetail: resolveFailureDetail
            });
            return;
          }
          const sourceErrorMessage = tizenP2pUnsupported
            ? t("player_error_tizen_p2p_unsupported", {}, "Torrent/P2P streaming is not supported on this TV.")
            : !p2pEnabled && canResolveP2p
              ? t("player_error_p2p_disabled", {}, "P2P streaming is disabled. Enable P2P in Settings to play torrent streams.")
              : canUseP2p
                ? t("stream.p2p.failed", {}, "Could not start this torrent stream.")
                : fallbackError || t("stream.debrid.unavailable", {}, "This Debrid source needs a configured Debrid account.");
          this.sourcesError = this.formatPlaybackErrorForSources(sourceErrorMessage, {
            streamCandidate,
            reason: tizenP2pUnsupported
              ? "tizen-p2p-unsupported"
              : !p2pEnabled && canResolveP2p
                ? "p2p-disabled"
                : canUseP2p
                  ? "p2p-resolve"
                  : "stream-resolve",
            resolverStatus: resolveFailureStatus,
            resolverDetail: resolveFailureDetail
          });
          this.renderSourcesPanel();
          return;
        }

        this.streamCandidates = this.streamCandidates.map((entry) =>
          entry.id === streamCandidate.id ? { ...entry, ...streamCandidate } : entry
        );
      }
      this.rememberSelectedStreamPreference(streamCandidate);
      await this.playStreamByUrl(targetUrl, {
        ...options,
        mountToken,
        sourceCandidate: streamCandidate
      });
    },
    /**
     * Android tryRefreshExpiredLinkAfterError: a link reopened from the reuse-last-link
     * cache, or one with expiring credentials, is fetched again from its add-on (debrid
     * resolved anew) and continues from the saved position. Each URL is refreshed once.
     * Returns true when a refresh started and the error must not be shown yet.
     */
    tryRefreshExpiredLinkAfterError(message = "", errorOptions = {}) {
      const candidate = this.getCurrentStreamCandidate?.() || null;
      // The source's own URL; a candidate without one (an unresolved debrid result) has nothing to refresh.
      const failedUrl = String(candidate ? streamDirectPlaybackUrl(candidate) : this.activePlaybackUrl || "").trim();
      if (!/^https?:\/\//i.test(failedUrl) || this.isLivePlayback?.() === true) {
        return false;
      }
      const fromLinkCache = Boolean(this.linkCacheSourceUrl) && failedUrl === this.linkCacheSourceUrl;
      if (!fromLinkCache && !hasLikelyExpiringPlaybackCredentials(failedUrl)) {
        return false;
      }
      if (failedUrl === this.linkRefreshAttemptedUrl) {
        return false;
      }
      this.linkRefreshAttemptedUrl = failedUrl;
      this.linkCacheSourceUrl = null;
      const hints = candidate?.behaviorHints || candidate?.raw?.behaviorHints || {};
      const expected = {
        addonName: String(candidate?.addonName || "").trim(),
        streamName: String(candidate?.name || "").trim() || String(candidate?.addonName || "").trim(),
        infoHash: String(candidate?.infoHash || candidate?.raw?.infoHash || "").trim(),
        filename: hints.filename || null,
        bingeGroup: this.getCurrentStreamBingeGroup?.() || null
      };
      const mountToken = this.playerMountToken;
      const resolveContext = {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      };
      console.info("Link likely expired, fetching the source again", { addon: expected.addonName });
      this.loadingVisible = true;
      this.updateLoadingVisibility?.();
      this.refreshLoadingOverlayPresentation?.();
      const showError = () => {
        if (this.isActiveMountToken(mountToken)) {
          this.showStartupError(message, errorOptions);
        }
      };
      void (async () => {
        try {
          StreamLinkCacheStore.remove(this.params?.streamRouteParams || this.params || {});
          const type = normalizeItemType(this.params?.itemType || "movie");
          const videoId = String(this.params?.videoId || this.params?.itemId || "");
          const result = videoId
            ? await Promise.race([
                streamRepository.getStreamsFromAllAddons(type, videoId, {
                  itemId: String(this.params?.itemId || ""),
                  season: this.params?.season ?? null,
                  episode: this.params?.episode ?? null,
                  forceRefresh: true
                }),
                // Android polls the reloaded sources for up to 15 seconds.
                new Promise((resolve) => setTimeout(() => resolve(null), EXPIRED_LINK_REFRESH_TIMEOUT_MS))
              ])
            : null;
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          const freshStreams = result ? flattenStreamGroups(result) : [];
          const found = findSourceRefreshCandidate(freshStreams, failedUrl, expected, (stream) =>
            DirectDebridResolver.canResolveStream(stream, resolveContext)
          );
          // Debrid links are always requested anew; a prepared one may be the expired link.
          let refreshed = found
            ? found.debridResolved
              ? { ...found, url: null, externalUrl: null, debridResolved: false }
              : { ...found }
            : null;
          if (refreshed && !streamDirectPlaybackUrl(refreshed)) {
            const resolved = await DirectDebridResolver.resolve(refreshed, { ...resolveContext, forceRefresh: true });
            if (!this.isActiveMountToken(mountToken)) {
              return;
            }
            refreshed =
              resolved?.status === "success" && resolved.stream
                ? { ...refreshed, ...resolved.stream, externalUrl: null, debridResolved: true }
                : null;
          }
          const refreshedUrl = refreshed ? String(streamDirectPlaybackUrl(refreshed) || "").trim() : "";
          if (!refreshedUrl || refreshedUrl === failedUrl) {
            console.warn("No fresh link was found for the failed source");
            showError();
            return;
          }
          this.streamCandidates = mergeStreamItems(this.streamCandidates, [refreshed]);
          if (!this.streamCandidates.some((entry) => entry?.url === refreshedUrl)) {
            this.streamCandidates = [...this.streamCandidates, refreshed];
          }
          if (candidate && this.autoSelectedSourceKey === sourceFallbackKey(candidate)) {
            this.autoSelectedSourceKey = sourceFallbackKey(refreshed);
          }
          // Continues from the saved position; the new link is saved for reuse once it starts.
          await this.playStreamCandidate(refreshed, { preservePlaybackState: true, mountToken });
        } catch (error) {
          console.warn("Expired link refresh failed", error);
          showError();
        }
      })();
      return true;
    },
    /**
     * Android scheduleSourceStartupTimeout: an auto-selected source that shows no first
     * frame within the configured time counts as failed and falls back. The last source
     * allowed keeps loading, as it would without the fallback.
     */
    scheduleSourceStartupTimeout() {
      clearTimeout(this.sourceStartupTimeoutTimer);
      this.sourceStartupTimeoutTimer = null;
      const settings = PlayerSettingsStore.get();
      if (!isSourceFallbackActive(settings) || !this.autoSelectedSourceKey) {
        return;
      }
      const url = String(this.activePlaybackUrl || "");
      const mountToken = this.playerMountToken;
      const seconds = Number(settings.streamAutoPlayFallbackStartupTimeoutSeconds) || 15;
      this.sourceStartupTimeoutTimer = setTimeout(() => {
        this.sourceStartupTimeoutTimer = null;
        if (
          !this.isActiveMountToken(mountToken) ||
          this.hasPresentedPlaybackFrame ||
          String(this.activePlaybackUrl || "") !== url ||
          this.isStartupErrorVisible?.() ||
          globalThis.document?.hidden
        ) {
          return;
        }
        if (this.sourceFallbackAttempts >= Number(settings.streamAutoPlayFallbackMaxSources || 0)) {
          return;
        }
        const message = t("player_error_source_startup_timeout", [seconds], `The source did not start within ${seconds} seconds.`);
        if (this.tryFallbackToNextSourceAfterError(message)) {
          console.warn(`Source showed no first frame in ${seconds}s, falling back`);
        }
      }, seconds * 1000);
    },
    /**
     * Android tryFallbackToNextSourceAfterError: when the auto-selected source fails before
     * playback starts, quietly plays the next source auto selection would pick, up to the
     * configured number of further sources. A source the user picked never falls back.
     * Returns true when a fallback started and the error must not be shown yet.
     */
    tryFallbackToNextSourceAfterError(message = "", errorOptions = {}) {
      if (this.sourceFallbackInFlight) {
        return true;
      }
      const settings = PlayerSettingsStore.get();
      if (
        this.sourceFallbackExhausted ||
        !isSourceFallbackActive(settings) ||
        this.hasPresentedPlaybackFrame ||
        this.isLivePlayback?.() === true
      ) {
        return false;
      }
      const candidate = this.getCurrentStreamCandidate?.() || null;
      if (!candidate || !this.autoSelectedSourceKey || sourceFallbackKey(candidate) !== this.autoSelectedSourceKey) {
        return false;
      }
      const maxSources = Number(settings.streamAutoPlayFallbackMaxSources || 0);
      const linkCacheParams = this.params?.streamRouteParams || this.params || {};
      if (this.sourceFallbackAttempts >= maxSources) {
        // The last source tried was saved for reuse when it started, but it failed.
        StreamLinkCacheStore.remove(linkCacheParams);
        return false;
      }
      const failedUrl = String(streamDirectPlaybackUrl(candidate) || "").trim();
      const failedAddonName = String(candidate.addonName || "");
      const failedInfoHash = String(candidate.infoHash || candidate.raw?.infoHash || "");
      const triedKeys = this.sourceFallbackTriedKeys || (this.sourceFallbackTriedKeys = new Set());
      triedKeys.add(sourceFallbackKey(candidate));
      if (failedUrl) {
        triedKeys.add(`url:${failedUrl}`);
      }
      const mountToken = this.playerMountToken;
      const resolveContext = {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      };
      this.sourceFallbackInFlight = true;
      this.loadingVisible = true;
      this.loadingTorrentStatus = t("player_finding_next_stream", {}, "Finding the next stream…");
      this.updateLoadingVisibility?.();
      this.refreshLoadingOverlayPresentation?.();
      this.syncLoadingOverlayStatus?.();
      void (async () => {
        try {
          // Joins the source search, so results already found are reused.
          if (this.completedSourceRequestKey !== this.getSourceRequestKey?.()) {
            await this.reloadSources({ forceRefresh: false });
          }
          for (let polls = 0; this.sourcesLoading && polls < SOURCE_FALLBACK_POLL_COUNT; polls += 1) {
            await new Promise((resolve) => setTimeout(resolve, SOURCE_FALLBACK_POLL_INTERVAL_MS));
          }
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          const installedAddonNames = new Set(
            ((await addonRepository.getInstalledAddons().catch(() => [])) || [])
              .map((addon) => String(addon?.displayName || addon?.name || "").trim())
              .filter(Boolean)
          );
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          while (this.sourceFallbackAttempts < maxSources) {
            const next = nextSourceFallbackCandidate({
              streams: this.streamCandidates,
              settings,
              installedAddonNames,
              triedKeys,
              failedAddonName,
              failedInfoHash
            });
            if (!next) {
              break;
            }
            triedKeys.add(sourceFallbackKey(next));
            this.sourceFallbackAttempts += 1;
            this.loadingTorrentStatus = t("player_trying_next_stream", [this.sourceFallbackAttempts], `Trying next stream (attempt %1$d)…`);
            this.refreshLoadingOverlayPresentation?.();
            this.syncLoadingOverlayStatus?.();
            let playable = { ...next };
            if (!streamDirectPlaybackUrl(playable)) {
              if (!DirectDebridResolver.canResolveStream(playable, resolveContext)) {
                continue;
              }
              const resolved = await DirectDebridResolver.resolve(playable, resolveContext);
              if (!this.isActiveMountToken(mountToken)) {
                return;
              }
              if (resolved?.status !== "success" || !resolved.stream) {
                console.info(`Fallback source from ${next.addonName} has no playable link, trying the next one`);
                continue;
              }
              playable = { ...playable, ...resolved.stream, externalUrl: null, debridResolved: true };
            }
            const url = String(streamDirectPlaybackUrl(playable) || "").trim();
            if (!url || url === failedUrl) {
              continue;
            }
            console.info(`Source failed to start, falling back to ${playable.name || playable.addonName}`);
            this.streamCandidates = mergeStreamItems(this.streamCandidates, [playable]);
            if (!this.streamCandidates.some((entry) => entry?.url === url)) {
              this.streamCandidates = [...this.streamCandidates, playable];
            }
            this.sourceFallbackInFlight = false;
            this.autoSelectedSourceKey = sourceFallbackKey(playable);
            triedKeys.add(`url:${url}`);
            this.loadingTorrentStatus = "";
            await this.playStreamCandidate(playable, { preservePlaybackState: true, mountToken });
            return;
          }
          // The last source that failed may have been saved for reuse.
          StreamLinkCacheStore.remove(linkCacheParams);
        } catch (error) {
          console.warn("Source fallback failed", error);
          this.loadingTorrentStatus = "";
        }
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
        this.sourceFallbackInFlight = false;
        this.sourceFallbackExhausted = true;
        this.loadingTorrentStatus = "";
        const exhausted = t("player_stream_fallback_exhausted", {}, "No more working streams. Choose another source or retry.");
        this.showStartupError(String(message || "").trim() ? `${exhausted}\n${message}` : exhausted, errorOptions);
      })();
      return true;
    },
    async switchStream(direction) {
      if (!this.streamCandidates.length) {
        return;
      }

      this.currentStreamIndex += direction;
      if (this.currentStreamIndex >= this.streamCandidates.length) {
        this.currentStreamIndex = 0;
      }
      if (this.currentStreamIndex < 0) {
        this.currentStreamIndex = this.streamCandidates.length - 1;
      }

      const selected = this.streamCandidates[this.currentStreamIndex];
      if (!selected) {
        return;
      }
      await this.playStreamCandidate(selected, { preservePlaybackState: true });
    },
    markPlaybackSourceFailed(url = this.activePlaybackUrl, streamCandidate = this.getCurrentStreamCandidate()) {
      const normalizedUrl = String(url || "").trim();
      if (normalizedUrl) {
        (this.failedPlaybackUrls || (this.failedPlaybackUrls = new Set())).add(normalizedUrl);
      }
      const currentCandidate = streamCandidate || this.getCurrentStreamCandidate?.();
      const currentId = String(currentCandidate?.id || "").trim();
      if (currentId) {
        (this.failedPlaybackStreamIds || (this.failedPlaybackStreamIds = new Set())).add(currentId);
      }
    },
    mediaErrorMessage(errorCode = 0, detail = "", streamCandidate = this.getCurrentStreamCandidate()) {
      const code = Number(errorCode || 0);
      const text = String(detail || "").toLowerCase();
      const httpStatus = this.resolvePlaybackHttpStatus(detail);
      const httpMessage = this.getHttpPlaybackErrorMessage(httpStatus);
      if (httpMessage) {
        return httpMessage;
      }
      const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
      if (compatibilityMessage && (code === 0 || code === 2 || code === 4)) {
        return compatibilityMessage;
      }
      if (code === 1) return "Playback aborted";
      if (code === 2) return "Network error";
      if (code === 3) {
        const unsupported = t(
          "player_error_unsupported_format",
          [this.getPlaybackErrorCodeLabel(code) || "decode"],
          "This stream uses a format your device may not support. Try a different source. [%1$s]"
        );
        return `${t("player_error_decoder", {}, "Decoder error")}\n\n${unsupported}`;
      }
      if (code === 4) {
        if (this.isDebridPlaybackCandidate(streamCandidate)) {
          return t("player_error_stream_load_failed", {}, "Playback failed to load");
        }
        if (
          text.includes("manifestparsingerror") ||
          text.includes("manifest parsing") ||
          text.includes("unrecognized") ||
          text.includes("invalid content") ||
          text.includes("invalid data") ||
          text.includes("text/html") ||
          text.includes("html")
        ) {
          return t(
            "player_error_source_invalid_content",
            [this.getPlaybackErrorCodeLabel(code) || "source"],
            "Source error: The stream source returned invalid or unplayable content. The link may have expired or the server returned an error page instead of video.\n\nTry a different source. [%1$s]"
          );
        }
        if (
          text.includes("no supported source") ||
          text.includes("no supported sources") ||
          text.includes("not supported") ||
          text.includes("unsupported")
        ) {
          return t("player_error_source_not_supported", {}, "Source not supported on this TV");
        }
        return t("player_error_playback_fallback", {}, "Playback error");
      }
      return t("player_error_playback_fallback", {}, "Playback error");
    },
    attemptSilentAudioRecovery(reason = "silent-audio") {
      void reason;
      return false;
    },
    clearPlaybackStallGuard() {
      if (this.playbackStallTimer) {
        clearTimeout(this.playbackStallTimer);
        this.playbackStallTimer = null;
      }
    }
  };
}
