/* eslint-disable no-unused-vars */
import * as internals from "./playerController.js";

export function createPlayerControllerMethods18() {
  const { Platform, TizenPlaybackProxy, WebOsPlaybackProxy, logEngineFsDebug, logTizenAvPlayDebug, logWebOsPlaybackDebug } = internals;

  return {
    async play(
      url,
      {
        itemId = null,
        itemType = "movie",
        imdbId = null,
        tmdbId = null,
        traktId = null,
        videoId = null,
        season = null,
        episode = null,
        title = null,
        poster = null,
        background = null,
        episodeTitle = null,
        requestHeaders = {},
        mediaSourceType = null,
        forceEngine = null,
        streamIdentity = null,
        cloudSessionToken = null,
        preserveTrackSelections = false
      } = {}
    ) {
      if (!this.video) return;

      const requestedUrl = String(url || "").trim();
      const playToken = Number(this.playRequestToken || 0) + 1;
      this.playRequestToken = playToken;
      this.stopProgressSaving();
      this.cancelProgressSyncAfterSeek();

      await this.flushCurrentProgress({ allowCloudSync: false });
      if (!this.isPlaybackRequestActive(playToken)) {
        return;
      }

      if (!preserveTrackSelections || !this.playbackSessionActive) {
        this.stopWebOsServiceKeepAlive();
        this.clearWebOsTrackSelections();
      }

      // Duration can temporarily regress while webOS tears down or restages its
      // native media pipeline. Keep the maximum duration for this playback only,
      // matching Android TV's lastKnownDuration contract.
      this.lastKnownDurationSeconds = 0;
      this.lastProgressSnapshot = null;
      this.lastSavedProgressPositionMs = 0;
      this.playbackSessionActive = true;
      this.applyStartupAudioGateToVideo();

      this.currentItemId = itemId;
      this.currentItemType = itemType;
      this.currentImdbId = imdbId || null;
      this.currentTmdbId = tmdbId || null;
      this.currentTraktId = traktId || null;
      this.currentVideoId = videoId;
      this.currentSeason = season == null ? null : Number(season);
      this.currentEpisode = episode == null ? null : Number(episode);
      this.currentCloudSessionToken = String(cloudSessionToken || "").trim() || null;
      this.currentItemTitle = title || null;
      this.currentItemPoster = poster || null;
      this.currentItemBackground = background || null;
      this.currentEpisodeTitle = episodeTitle || null;
      this.currentStreamIdentity = streamIdentity || null;
      this.currentPlaybackUrl = requestedUrl;
      this.currentPlaybackHeaders = { ...(requestHeaders || {}) };
      this.currentPlaybackMediaSourceType = this.resolveRuntimeSourceType(mediaSourceType);
      this.lastPlaybackErrorCode = 0;
      this.lastHlsErrorDiagnostic = null;

      let sourceType = this.currentPlaybackMediaSourceType || this.resolveRuntimeSourceType(this.guessMediaMimeType(url)) || null;
      if (!forceEngine) {
        sourceType = await this.resolveRemoteMediaSourceType(url, sourceType, requestHeaders, itemType);
        this.currentPlaybackMediaSourceType = sourceType;
        if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
          return;
        }
      }
      if (!forceEngine && this.isTizenHlsSource(url, sourceType)) {
        // Load hls.js before choosing the engine so getPlaybackEngineCandidates()
        // can distinguish a supported MSE path from a platform that needs the
        // existing AVPlay/native-HLS fallback ladder.
        await this.ensureAdaptiveLibrariesForSource(sourceType, "hls.js");
        if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
          return;
        }
      }
      let preferredEngine = forceEngine || this.choosePlaybackEngine(url, sourceType, itemType);
      await this.ensureAdaptiveLibrariesForSource(sourceType, preferredEngine);
      if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
        return;
      }

      let playbackUrl = requestedUrl;
      let tizenProxyUnavailable = false;
      let tizenAvPlayFallbackForProxyUnavailable = false;
      const canUseTizenPlaybackProxy =
        Platform.isTizen() && (this.canUseAvPlay() || preferredEngine === "hls.js" || preferredEngine === "native-hls");
      const playbackProxy = canUseTizenPlaybackProxy ? TizenPlaybackProxy : Platform.isWebOS() ? WebOsPlaybackProxy : null;
      if (playbackProxy) {
        const proxyResult = Platform.isTizen()
          ? await playbackProxy.resolve(requestedUrl, requestHeaders, { playbackEngine: preferredEngine })
          : await playbackProxy.resolve(requestedUrl, requestHeaders);
        if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
          return;
        }
        if (Platform.isTizen() && proxyResult?.status === "unavailable") {
          const avplayEngine = this.getPlatformAvplayEngineName();
          const canPreserveHeadersWithAvPlay = !TizenPlaybackProxy.requiresProxy(requestedUrl, requestHeaders, {
            playbackEngine: avplayEngine,
            resolveRedirects: false
          });
          const canFallbackToAvPlay =
            !forceEngine &&
            this.isLikelyHlsMimeType(sourceType) &&
            (preferredEngine === "hls.js" || preferredEngine === "native-hls") &&
            this.canUseAvPlay() &&
            canPreserveHeadersWithAvPlay;
          if (canFallbackToAvPlay) {
            // AVPlay can carry Cookie/User-Agent natively. Use the existing
            // Tizen HLS fallback only when it preserves every declared header.
            preferredEngine = avplayEngine;
            tizenAvPlayFallbackForProxyUnavailable = true;
          } else {
            // Never start a raw browser request after EngineFS failed to
            // preserve headers that Android's HTTP data source would send.
            tizenProxyUnavailable = TizenPlaybackProxy.requiresProxy(requestedUrl, requestHeaders, {
              playbackEngine: preferredEngine,
              resolveRedirects: false
            });
          }
        }
        playbackUrl = String(proxyResult?.url || requestedUrl).trim() || requestedUrl;
        if (proxyResult?.proxied) {
          this.currentPlaybackUrl = playbackUrl;
          this.startWebOsPlaybackKeepAlive();
          if (Platform.isTizen()) {
            let sourceHost = null;
            try {
              sourceHost = new URL(requestedUrl).host;
            } catch (_) {
              // Keep diagnostics useful without exposing header-bearing proxy URLs.
            }
            logTizenAvPlayDebug("PlayerController: Tizen playback proxy selected", {
              baseUrl: proxyResult.baseUrl,
              headerNames: proxyResult.headerNames,
              sourceHost
            });
          } else {
            logWebOsPlaybackDebug("PlayerController: webOS playback proxy selected", {
              baseUrl: proxyResult.baseUrl,
              headerNames: proxyResult.headerNames,
              playbackUrl
            });
          }
        } else if (Platform.isWebOS()) {
          this.stopWebOsPlaybackKeepAlive();
        }
      }

      if (Platform.isWebOS() && !this.webOsPlaybackKeepAliveHandle) {
        this.startWebOsServiceKeepAlive();
      }

      try {
        const parsedUrl = new URL(String(playbackUrl || ""));
        const isEngineFsUrl = /\/([0-9a-f]{40})\/\d+(?:\/|$)/i.test(parsedUrl.pathname);
        if (isEngineFsUrl) {
          const host = parsedUrl.hostname;
          const baseUrlKind = host === "127.0.0.1" || host === "localhost" || host === "::1" ? "local-service" : "public-service";
          logEngineFsDebug("PlayerController: EngineFS playback selected", {
            baseUrlKind,
            playbackUrl,
            declaredMediaSourceType: this.currentPlaybackMediaSourceType || null,
            chosenSourceType: sourceType || null,
            playbackEngine: preferredEngine,
            webOsLoadMode: Platform.isWebOS() ? "src-mediaid-load-play" : null
          });
        }
      } catch (_) {
        // ignore logging errors
      }
      // Tizen/webOS may replace the requested source with a local proxy URL.
      // Keep failover attempts keyed by the stable source URL because PlayerScreen
      // asks for alternatives using the original stream URL.
      this.rememberPlaybackEngineAttempt(requestedUrl, preferredEngine, {
        reset: !forceEngine
      });

      this.teardownAdaptiveInstances();
      this.teardownAvPlay();
      Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.resetNativeMediaState();
      if (tizenProxyUnavailable) {
        this.isPlaying = false;
        this.stopProgressSaving();
        throw new Error("Tizen playback proxy unavailable; declared request headers cannot be forwarded");
      }
      const nativeFallbackEngine = this.isLikelyHlsMimeType(sourceType)
        ? "native-hls"
        : this.isLikelyDashMimeType(sourceType)
          ? "native-dash"
          : "native-file";

      if (preferredEngine === this.getPlatformAvplayEngineName()) {
        const avplayStarted = this.playWithAvPlay(playbackUrl, requestHeaders, sourceType, playToken);
        if (!avplayStarted) {
          if (tizenAvPlayFallbackForProxyUnavailable) {
            this.isPlaying = false;
            this.stopProgressSaving();
            throw new Error("AVPlay could not start HLS while the Tizen playback proxy was unavailable");
          }
          const isRemoteProgressiveTizenSource =
            Platform.isTizen() && nativeFallbackEngine === "native-file" && this.isRemoteDirectHttpSource(playbackUrl);
          if (isRemoteProgressiveTizenSource) {
            if (!this.isPlaybackRequestActive(playToken, playbackUrl)) {
              return;
            }
            this.isPlaying = false;
            this.stopProgressSaving();
            this.emitVideoEvent("error", {
              playbackEngine: this.getPlatformAvplayEngineName(),
              mediaErrorCode: this.getLastPlaybackErrorCode() || 4,
              avplayError: "AVPlay startup failed before prepareAsync"
            });
            return;
          }
          this.applyNativeSource(playbackUrl, sourceType || null, nativeFallbackEngine);
          this.attemptVideoPlay({
            warningLabel: "Playback start rejected",
            playToken,
            beforePlay: () => this.waitForNativeMediaId(),
            onRejected: (error) => {
              if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay()) {
                return false;
              }
              const fallbackStarted = this.playWithAvPlay(playbackUrl, requestHeaders, sourceType, playToken);
              if (fallbackStarted) {
                this.isPlaying = true;
              }
              return fallbackStarted;
            }
          });
        }
      } else if (preferredEngine === "hls.js") {
        const hlsStarted = this.playWithHlsJs(playbackUrl, requestHeaders, playToken);
        if (!hlsStarted) {
          this.applyNativeSource(playbackUrl, sourceType || "application/vnd.apple.mpegurl", "native-hls");
          this.attemptVideoPlay({
            warningLabel: "Playback start rejected",
            playToken,
            beforePlay: () => this.waitForNativeMediaId()
          });
        }
      } else if (preferredEngine === "dash.js") {
        const dashStarted = this.playWithDashJs(playbackUrl, playToken);
        if (!dashStarted) {
          this.applyNativeSource(playbackUrl, sourceType || "application/dash+xml", "native-dash");
        }
        this.attemptVideoPlay({
          warningLabel: "DASH playback start rejected",
          playToken,
          beforePlay: dashStarted ? null : () => this.waitForNativeMediaId()
        });
      } else if (preferredEngine === "native-hls") {
        this.applyNativeSource(playbackUrl, sourceType || "application/vnd.apple.mpegurl", "native-hls");
        this.attemptVideoPlay({
          warningLabel: "Native HLS playback start rejected",
          playToken,
          beforePlay: () => this.waitForNativeMediaId(),
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error)) {
              return false;
            }
            const fallbackStarted = this.playWithHlsJs(playbackUrl, requestHeaders, playToken);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      } else if (preferredEngine === "native-dash") {
        this.applyNativeSource(playbackUrl, sourceType || "application/dash+xml", "native-dash");
        this.attemptVideoPlay({
          warningLabel: "Native DASH playback start rejected",
          playToken,
          beforePlay: () => this.waitForNativeMediaId(),
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error) || !this.canUseDashJs()) {
              return false;
            }
            const fallbackStarted = this.playWithDashJs(playbackUrl, playToken);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      } else {
        const isWebOsEngineFsPlayback = Platform.isWebOS() && this.isEngineFsPlaybackUrl(playbackUrl);
        const isWebOsMatroskaPlayback = Platform.isWebOS() && this.normalizeMimeType(sourceType) === "video/x-matroska";
        const shouldStageWebOsNativePlayback = isWebOsEngineFsPlayback || isWebOsMatroskaPlayback;
        if (shouldStageWebOsNativePlayback) {
          // Match Stremio's webOS startup order: src -> mediaId -> load -> play.
          this.applyWebOsStagedNativeSource(playbackUrl, "native-file");
          await this.prepareWebOsStagedNativePlayback(playToken, playbackUrl);
          if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
            return;
          }
        } else {
          this.applyNativeSource(playbackUrl, sourceType || null, "native-file");
        }
        this.attemptVideoPlay({
          warningLabel: "Playback start rejected",
          playToken,
          beforePlay: shouldStageWebOsNativePlayback ? null : () => this.waitForNativeMediaId(),
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay() || !this.isLikelyDirectFileUrl(playbackUrl)) {
              return false;
            }
            const fallbackStarted = this.playWithAvPlay(playbackUrl, requestHeaders, sourceType, playToken);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      }

      this.isPlaying = true;
      this.syncWebOsPlaybackKeepAwake();
      this.startProgressSaving();
    }
  };
}
