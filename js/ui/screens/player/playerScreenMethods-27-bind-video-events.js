import * as internals from "./playerScreenContext.js";
import { createPlayerVideoLifecycleHandlers } from "./playerVideoLifecycleHandlers.js";
import { createPlayerVideoEventHandlers } from "./playerVideoEventHandlers.js";

export function createPlayerScreenMethods27() {
  return {
    bindVideoEvents() {
      const { PlayerController, Environment } = internals;
      const video = PlayerController.video;
      if (!video) {
        return;
      }
      // Idempotent bind: re-mounts/episode switches used to stack duplicate
      // timeupdate/subtitle/track handlers, multiplying per-frame work on
      // single-core Tizen. Unbind first; unbindVideoEvents is a no-op when empty.
      try {
        if (typeof this.unbindVideoEvents === "function") {
          this.unbindVideoEvents();
        }
      } catch (_) {}
      const isTizenAvPlayPlayback = () =>
        Boolean(Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay());
      const lifecycleHandlers = createPlayerVideoLifecycleHandlers.call(this, video, isTizenAvPlayPlayback);
      const eventHandlers = createPlayerVideoEventHandlers.call(this, video, isTizenAvPlayPlayback);
      const { onWaiting, onPlaying, onPause, onProgress, onTimeUpdate, onLoadedMetadata, onPlayable, onSeeked, onTrackListChanged } =
        lifecycleHandlers;
      const { onWebOsAudioTrackSelectionChanged, onAvPlaySubtitleChange, onError } = eventHandlers;
      const bindings = [
        ["waiting", onWaiting],
        ["playing", onPlaying],
        ["error", onError],
        ["pause", onPause],
        ["progress", onProgress],
        ["timeupdate", onTimeUpdate],
        ["loadedmetadata", onLoadedMetadata],
        ["loadeddata", onPlayable],
        ["canplay", onPlayable],
        ["seeked", onSeeked],
        ["avplaytrackschanged", onTrackListChanged],
        ["avplaysubtitlechange", onAvPlaySubtitleChange],
        ["webosaudiotrackselectionchanged", onWebOsAudioTrackSelectionChanged],
        ["hlstrackschanged", onTrackListChanged],
        ["dashtrackschanged", onTrackListChanged]
      ];

      bindings.forEach(([eventName, handler]) => {
        video.addEventListener(eventName, handler);
        this.videoListeners.push({ target: video, eventName, handler });
      });

      if (typeof window?.addEventListener === "function") {
        const onViewportResize = () => {
          this.applyAspectMode({ showToast: false });
          // applyAspectMode() restores the native AVPlay surface to full screen.
          // In post-play the same mode key may still be current, so invalidate it
          // before re-applying the Android mini-window geometry.
          this.cancelPostPlayNativeSurfaceAnimation();
          const viewport = PlayerController.getAvPlayViewportSize?.() || {
            width: 1920,
            height: 1080
          };
          if (this.isPostPlayVisible()) {
            this.postPlayNativeSurfaceStateKey = "";
            this.postPlayNativeSurfaceRect = {
              x: 0,
              y: 0,
              width: Math.max(1, Math.round(Number(viewport.width || 1920))),
              height: Math.max(1, Math.round(Number(viewport.height || 1080)))
            };
          }
          this.syncPostPlayPlayerSurface(this.getPostPlayState());
        };
        window.addEventListener("resize", onViewportResize);
        this.videoListeners.push({
          target: window,
          eventName: "resize",
          handler: onViewportResize
        });
      }

      const trackTargets = [this.getVideoTextTrackList(), this.getVideoAudioTrackList()].filter(Boolean);
      trackTargets.forEach((target) => {
        if (typeof target.addEventListener !== "function") {
          return;
        }
        ["addtrack", "removetrack", "change"].forEach((eventName) => {
          target.addEventListener(eventName, onTrackListChanged);
          this.videoListeners.push({ target, eventName, handler: onTrackListChanged });
        });
      });
    }
  };
}
