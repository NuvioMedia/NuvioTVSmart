/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods18() {
  const { t, formatPlaybackTime } = internals;

  return {
    stopTrailerProgressTimer() {
      if (this.trailerProgressTimer) {
        clearInterval(this.trailerProgressTimer);
        this.trailerProgressTimer = null;
      }
    },
    stopTrailerControlsTimer() {
      if (this.trailerControlsTimer) {
        clearTimeout(this.trailerControlsTimer);
        this.trailerControlsTimer = null;
      }
    },
    stopTrailerProxyLoadingTimer() {
      if (this.trailerProxyLoadingTimer) {
        clearTimeout(this.trailerProxyLoadingTimer);
        this.trailerProxyLoadingTimer = null;
      }
    },
    stopTrailerFirstFramePolling() {
      if (this.trailerFirstFramePollTimer) {
        clearInterval(this.trailerFirstFramePollTimer);
        this.trailerFirstFramePollTimer = null;
      }
    },
    stopTrailerFallbackRevealTimer() {
      if (this.trailerFallbackRevealTimer) {
        clearTimeout(this.trailerFallbackRevealTimer);
        this.trailerFallbackRevealTimer = null;
      }
    },
    scheduleTrailerFallbackReveal(ytId = "") {
      this.stopTrailerFallbackRevealTimer();
      const expectedId = String(ytId || "").trim();
      this.trailerFallbackRevealTimer = setTimeout(() => {
        this.trailerFallbackRevealTimer = null;
        if (
          this.isTrailerPlaying &&
          this.trailerSource?.kind === "youtube" &&
          (!expectedId || String(this.trailerSource?.ytId || "").trim() === expectedId)
        ) {
          this.markTrailerVisualReady();
        }
      }, 1200);
    },
    startTrailerFirstFramePolling() {
      this.stopTrailerFirstFramePolling();
      if (!this.isTrailerPlaying || this.trailerSource?.kind !== "youtube" || this.trailerVisualReady) {
        return;
      }
      this.trailerFirstFramePollTimer = setInterval(() => {
        if (!this.isTrailerPlaying || this.trailerSource?.kind !== "youtube" || this.trailerVisualReady) {
          this.stopTrailerFirstFramePolling();
          return;
        }
        this.postTrailerProxyCommand("getState");
      }, 120);
    },
    startTrailerProxyLoadingTimer(ytId = "") {
      this.stopTrailerProxyLoadingTimer();
      const expectedId = String(ytId || "").trim();
      if (!expectedId) {
        return;
      }
      this.trailerProxyLoadingTimer = setTimeout(() => {
        const activeId = String(this.trailerSource?.ytId || "").trim();
        if (!this.isTrailerPlaying || this.trailerSource?.kind !== "youtube" || activeId !== expectedId) {
          return;
        }
        if (this.trailerProxyState && !this.trailerProxyState.loading) {
          return;
        }
        this.trailerProxyState = {
          currentTime: Number(this.trailerProxyState?.currentTime || 0),
          duration: Number(this.trailerProxyState?.duration || 0),
          paused: false,
          muted: Boolean(this.trailerMuted),
          loading: false,
          controllable: false
        };
        this.trailerYoutubeFallbackActive = true;
        if (this.trailerPlaybackMode === "manual") {
          this.updateTrailerOverlay();
          this.restartTrailerControlsTimer();
        }
      }, 4500);
    },
    setTrailerControlsVisible(visible) {
      this.trailerControlsVisible = Boolean(visible);
      const overlay = this.trailerUiRefs?.overlay;
      if (overlay) {
        overlay.classList.toggle("hidden", !this.trailerControlsVisible);
      }
    },
    restartTrailerControlsTimer() {
      this.stopTrailerControlsTimer();
      if (!this.isTrailerPlaying || !this.trailerSource || this.trailerPlaybackMode !== "manual") {
        this.setTrailerControlsVisible(false);
        return;
      }
      this.setTrailerControlsVisible(true);
      const playback = this.getTrailerPlaybackSnapshot();
      if (playback.loading || playback.paused) {
        return;
      }
      this.trailerControlsTimer = setTimeout(() => {
        this.setTrailerControlsVisible(false);
      }, 3200);
    },
    startTrailerProgressTimer() {
      this.stopTrailerProgressTimer();
      if (this.trailerPlaybackMode !== "manual") {
        return;
      }
      // YouTube proxy state messages and native timeupdate events already keep
      // the overlay current. A second 250 ms poll doubled cross-frame work and
      // caused recurring main-thread pressure on Samsung TV browsers.
      this.updateTrailerOverlay();
    },
    cacheTrailerRefs() {
      const layer = this.container?.querySelector(".detail-trailer-layer");
      this.trailerUiRefs = layer
        ? {
            layer,
            overlay: layer.querySelector(".detail-trailer-controls-overlay"),
            media: layer.querySelector("[data-trailer-media]"),
            frame: layer.querySelector(".detail-trailer-frame"),
            video: layer.querySelector(".detail-trailer-video"),
            status: layer.querySelector("[data-trailer-status]"),
            progressFill: layer.querySelector("[data-trailer-progress-fill]"),
            timeLabel: layer.querySelector("[data-trailer-time-label]")
          }
        : null;
    },
    getTrailerPlaybackSnapshot() {
      const snapshot = {
        currentTime: 0,
        duration: 0,
        paused: true,
        muted: Boolean(this.trailerMuted),
        captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
        loading: false,
        controllable: true
      };
      if (!this.isTrailerPlaying || !this.trailerSource) {
        return snapshot;
      }
      if (this.trailerSource.kind === "video") {
        const video = this.trailerUiRefs?.video;
        if (!video) {
          return {
            ...snapshot,
            loading: true
          };
        }
        const duration = Number.isFinite(video.duration) ? Number(video.duration) : 0;
        return {
          currentTime: Number.isFinite(video.currentTime) ? Number(video.currentTime) : 0,
          duration,
          paused: Boolean(video.paused),
          muted: Boolean(video.muted),
          captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
          loading: Boolean(!video.readyState || video.readyState < 2),
          controllable: true
        };
      }

      if (!this.trailerProxyState) {
        return {
          ...snapshot,
          loading: true
        };
      }
      return {
        currentTime: Number(this.trailerProxyState.currentTime || 0),
        duration: Number(this.trailerProxyState.duration || 0),
        paused: Boolean(this.trailerProxyState.paused),
        muted: Boolean(this.trailerProxyState.muted),
        captionsEnabled: Boolean(this.trailerProxyState.captionsEnabled),
        loading: Boolean(this.trailerProxyState.loading),
        controllable: this.trailerProxyState.controllable !== false
      };
    },
    updateTrailerOverlay() {
      const refs = this.trailerUiRefs;
      if (!refs) {
        return;
      }
      const playback = this.getTrailerPlaybackSnapshot();
      this.trailerMuted = Boolean(playback.muted);
      this.trailerSubtitlesEnabled = Boolean(playback.captionsEnabled);
      if (!this.trailerControlsVisible && !playback.loading && !playback.paused) {
        return;
      }
      const progress = playback.duration > 0 ? Math.max(0, Math.min(100, (playback.currentTime / playback.duration) * 100)) : 0;
      if (refs.progressFill) {
        refs.progressFill.style.width = `${progress.toFixed(3)}%`;
      }
      if (refs.timeLabel) {
        refs.timeLabel.textContent = `${formatPlaybackTime(playback.currentTime)} / ${formatPlaybackTime(playback.duration)}`;
      }
      if (refs.status) {
        refs.status.textContent = playback.loading
          ? t("detail.trailerLoading", {}, "Loading trailer...")
          : playback.controllable
            ? ""
            : t("detail.trailerFallbackHint", {}, "Use back to close the trailer");
      }
      if (playback.loading || playback.paused) {
        this.stopTrailerControlsTimer();
        this.setTrailerControlsVisible(true);
        return;
      }
      if (this.trailerControlsVisible && !this.trailerControlsTimer) {
        this.restartTrailerControlsTimer();
      }
    },
    bindTrailerVideoEvents(video) {
      if (!video) {
        return;
      }
      this.detachTrailerMediaListeners();
      const sync = () => {
        this.applyTrailerVideoSubtitleState(video);
        this.updateTrailerOverlay();
      };
      const markReady = () => {
        if (!this.isTrailerPlaying || video.paused || !video.isConnected) {
          return;
        }
        this.markTrailerVisualReady();
        this.updateTrailerOverlay();
      };
      const handleEnded = () => {
        if (this.isTrailerPlaying) {
          this.stopTrailerPlayback();
        }
      };
      const handleError = () => {
        if (this.isTrailerPlaying) {
          this.stopTrailerPlayback();
        }
      };
      const eventNames =
        this.trailerPlaybackMode === "manual"
          ? ["play", "pause", "timeupdate", "volumechange", "loadedmetadata", "durationchange", "waiting", "playing", "canplay"]
          : [];
      this.trailerMediaListeners = eventNames.map((eventName) => {
        video.addEventListener(eventName, sync);
        return { target: video, eventName, handler: sync };
      });
      [
        ["playing", markReady],
        ["ended", handleEnded],
        ["error", handleError]
      ].forEach(([eventName, handler]) => {
        video.addEventListener(eventName, handler);
        this.trailerMediaListeners.push({ target: video, eventName, handler });
      });
    },
    markTrailerVisualReady() {
      if (!this.isTrailerPlaying || this.trailerVisualReady) {
        return;
      }
      this.stopTrailerFirstFramePolling();
      this.stopTrailerFallbackRevealTimer();
      this.trailerVisualReady = true;
      const shell = this.container?.querySelector(".series-detail-shell");
      if (!shell) {
        return;
      }
      const reveal = () => {
        if (!this.isTrailerPlaying || !this.trailerVisualReady || !shell.isConnected) {
          return;
        }
        shell.classList.add("detail-trailer-ready");
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(reveal));
      } else {
        setTimeout(reveal, 32);
      }
    },
    destroyYoutubeTrailerPlayer() {
      this.stopTrailerProxyLoadingTimer();
      this.stopTrailerFirstFramePolling();
      this.stopTrailerFallbackRevealTimer();
      this.trailerProxyState = null;
      this.trailerYoutubeFallbackActive = false;
    },
    async initYoutubeTrailerPlayer() {
      const ytId = String(this.trailerSource?.ytId || "").trim();
      if (!ytId || !this.trailerUiRefs?.frame || !this.isTrailerPlaying || this.trailerSource?.kind !== "youtube") {
        return;
      }
      this.destroyYoutubeTrailerPlayer();
      this.trailerProxyState = {
        currentTime: 0,
        duration: 0,
        paused: false,
        muted: Boolean(this.trailerMuted),
        captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
        loading: true,
        controllable: true
      };
      this.trailerYoutubeFallbackActive = false;
      this.startTrailerProxyLoadingTimer(ytId);
      this.updateTrailerOverlay();
    }
  };
}
