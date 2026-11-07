/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods33() {
  const { PlayerController, clamp, isSeriesItemType } = internals;

  return {
    resolveMediaAction(event) {
      const key = String(event?.key || "");
      const keyName = String(event?.keyName || "");
      const code = String(event?.code || "");
      const keyCode = Number(event?.originalKeyCode || event?.keyCode || 0);

      const keyMap = {
        MediaPlayPause: "toggle",
        MediaPlay: "play",
        MediaPause: "pause",
        MediaStop: "stop",
        MediaFastForward: "fastForward",
        MediaRewind: "rewind",
        MediaTrackNext: "next",
        MediaTrackPrevious: "previous",
        ChannelUp: "chapterNext",
        ChannelDown: "chapterPrevious",
        Play: "play",
        Pause: "pause"
      };

      if (keyMap[key]) {
        return keyMap[key];
      }
      if (keyMap[keyName]) {
        return keyMap[keyName];
      }
      if (keyMap[code]) {
        return keyMap[code];
      }

      const codeMap = {
        179: "toggle",
        10252: "toggle",
        415: "play",
        19: "pause",
        413: "stop",
        178: "stop",
        417: "fastForward",
        412: "rewind",
        176: "next",
        177: "previous",
        427: "chapterNext",
        428: "chapterPrevious"
      };

      return codeMap[keyCode] || null;
    },
    applyMediaAction(action, event = null) {
      if (this.isExternalFrameMode() || !action) {
        return;
      }

      if (action === "play") {
        if (this.paused) {
          this.togglePause();
        }
        return;
      }

      if (action === "pause" || action === "stop") {
        if (!this.paused) {
          this.togglePause();
        }
        return;
      }

      if (action === "toggle") {
        this.togglePause();
        return;
      }

      if (action === "next" || action === "chapterNext") {
        this.skipPlayerChapter?.(true);
        return;
      }

      if (action === "previous" || action === "chapterPrevious") {
        this.skipPlayerChapter?.(false);
        return;
      }

      if (action === "fastForward") {
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }

      if (action === "rewind") {
        this.beginSeekPreview(-1, Boolean(event?.repeat));
      }
    },
    quickSeekBy(deltaSeconds, { showOverlay = true } = {}) {
      if (!this.isSeekBarAvailable()) {
        return false;
      }
      const currentTime = this.getPlaybackCurrentSeconds();
      if (Number.isNaN(currentTime)) {
        return false;
      }
      const duration = this.getPlaybackDurationSeconds();
      let target = currentTime + Number(deltaSeconds || 0);
      if (duration > 0) {
        target = clamp(target, 0, duration);
      } else {
        target = Math.max(0, target);
      }
      if (!showOverlay) {
        // External/media-session commands must not raise the seek overlay.
        this.seekPreviewSeconds = null;
        this.seekPreviewDirection = 0;
        this.seekOverlayVisible = false;
        this.seekPlaybackSeconds(target);
        return true;
      }
      this.seekPreviewSeconds = target;
      this.seekPreviewDirection = deltaSeconds < 0 ? -1 : 1;
      this.seekOverlayVisible = !this.controlsVisible;
      this.renderSeekOverlay();
      this.scheduleSeekPreviewCommit();
      return true;
    },
    seekMediaSessionTo(details = {}) {
      if (typeof this.isSeekBarAvailable === "function" && !this.isSeekBarAvailable()) {
        return false;
      }
      const time = Number(details?.seekTime);
      if (!Number.isFinite(time) || time < 0) {
        return false;
      }
      const duration = Number(this.getPlaybackDurationSeconds() || 0);
      const target = duration > 0 ? clamp(time, 0, duration) : time;
      this.seekPreviewSeconds = null;
      this.seekPreviewDirection = 0;
      this.seekOverlayVisible = false;
      const result = this.seekPlaybackSeconds(target);
      this.renderSeekOverlay?.();
      return result !== false;
    },
    bindMediaSessionHandlers() {
      const mediaSession = globalThis.navigator?.mediaSession;
      if (!mediaSession || this.mediaSessionHandlersBound) {
        return;
      }
      this.mediaSessionHandlersBound = true;
      this.mediaSessionActions = [];

      const safeBind = (action, handler) => {
        try {
          mediaSession.setActionHandler(action, handler);
          this.mediaSessionActions.push(action);
        } catch (_) {
          // Ignore unsupported actions.
        }
      };

      safeBind("play", () => this.applyMediaAction("play"));
      safeBind("pause", () => this.applyMediaAction("pause"));
      safeBind("stop", () => this.applyMediaAction("stop"));
      safeBind("seekforward", (details) => {
        const offset = Number(details?.seekOffset || 30);
        this.quickSeekBy(Number.isFinite(offset) ? offset : 30, { showOverlay: false });
      });
      safeBind("seekbackward", (details) => {
        const offset = Number(details?.seekOffset || 30);
        this.quickSeekBy(Number.isFinite(offset) ? -offset : -30, { showOverlay: false });
      });
      safeBind("seekto", (details) => {
        this.seekMediaSessionTo(details);
      });

      this.updateMediaSessionMetadata();
      this.updateMediaSessionPlaybackState();
    },
    updateMediaSessionMetadata() {
      const mediaSession = globalThis.navigator?.mediaSession;
      const MediaMetadataConstructor = globalThis.MediaMetadata;
      if (!mediaSession || typeof MediaMetadataConstructor !== "function") {
        return;
      }

      const title =
        String(this.params?.playerTitle || this.params?.itemTitle || this.params?.title || this.params?.itemId).trim() || "Nuvio";
      const episodeTitle = String(this.params?.playerEpisodeTitle || this.params?.episodeTitle || this.params?.playerSubtitle || "").trim();
      const season = Number(this.params?.season);
      const episode = Number(this.params?.episode);
      const isSeries = isSeriesItemType(this.params?.itemType || "movie");
      const episodeCode =
        isSeries && Number.isFinite(season) && season >= 0 && Number.isFinite(episode) && episode > 0 ? `S${season}:E${episode}` : "";
      const releaseYear = String(this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || "").trim();
      const artist = isSeries ? [episodeCode, episodeTitle].filter(Boolean).join(" – ") || "Nuvio" : releaseYear || "Nuvio";
      const artworkUrl = String(
        this.params?.playerPosterUrl || this.params?.poster || this.params?.playerBackdropUrl || this.params?.backdrop || ""
      ).trim();

      try {
        mediaSession.metadata = new MediaMetadataConstructor({
          title,
          artist,
          album: isSeries ? title : "Nuvio",
          artwork: artworkUrl ? [{ src: artworkUrl }] : []
        });
      } catch (_) {
        // Ignore runtimes with a partial MediaMetadata implementation.
      }
    },
    updateMediaSessionPositionState() {
      const mediaSession = globalThis.navigator?.mediaSession;
      if (!mediaSession || typeof mediaSession.setPositionState !== "function") {
        return;
      }

      const video = PlayerController.video || this.container?.querySelector?.("#videoPlayer");
      const duration = Number(video?.duration);
      const position = Number(video?.currentTime);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
        return;
      }

      const playbackRate = Number(video?.playbackRate);
      try {
        mediaSession.setPositionState({
          duration,
          position: Math.min(Math.max(0, position), duration),
          playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1
        });
      } catch (_) {
        // Ignore invalid or unsupported position updates.
      }
    },
    clearMediaSessionHandlers() {
      const mediaSession = globalThis.navigator?.mediaSession;
      if (!mediaSession || !this.mediaSessionHandlersBound) {
        return;
      }
      this.mediaSessionActions.forEach((action) => {
        try {
          mediaSession.setActionHandler(action, null);
        } catch (_) {
          // Ignore unsupported actions.
        }
      });
      this.mediaSessionActions = [];
      this.mediaSessionHandlersBound = false;
      try {
        mediaSession.playbackState = "none";
        mediaSession.metadata = null;
      } catch (_) {
        // Ignore unsupported playback state.
      }
    },
    updateMediaSessionPlaybackState() {
      const mediaSession = globalThis.navigator?.mediaSession;
      if (!mediaSession) {
        return;
      }
      try {
        mediaSession.playbackState = this.paused ? "paused" : "playing";
      } catch (_) {
        // Ignore unsupported playback state.
      }
      this.updateMediaSessionPositionState();
    }
  };
}
