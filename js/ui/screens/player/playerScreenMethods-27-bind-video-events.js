import { handleListedStreamRedirect } from "./streamRedirectMetadata.js";
import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
import * as internals from "./playerScreenContext.js";
import { createPlayerVideoLifecycleHandlers } from "./playerVideoLifecycleHandlers.js";
import { createPlayerVideoEventHandlers } from "./playerVideoEventHandlers.js";

export function createPlayerScreenMethods27() {
  return {
    bindVideoEvents() {
      const {
        PlayerController,
        Environment,
        HDR_PRESET_STORAGE_KEY,
        normalizeHdrBrightnessPreset,
        getSavedHdrBrightnessPreset,
        PlayerSettingsStore
      } = internals;
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
        [
          "webosexactseekvisual",
          (event) => {
            if (!Environment.isWebOS() || !this.seekLoading) return;
            this.seekLoadingVisualComplete = event.detail?.moving === true;
            this.updateLoadingVisibility();
          }
        ],
        ["streamredirect", (event) => handleListedStreamRedirect(this, PlayerController, event.detail)],
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
        [
          "webosaudioconversionchanged",
          () => {
            this.invalidateTrackDialogCaches();
            this.renderAudioDialog();
            this.updateLoadingVisibility();
          }
        ],
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
          // applyAspectMode() restores the playback surface. Invalidate the
          // post-play mode before re-applying the Android mini-window geometry.
          this.cancelPostPlayPlayerSurfaceAnimation();
          const viewport = PlayerController.getCssPlayerViewportSize?.() || {
            width: 1920,
            height: 1080
          };
          if (this.isPostPlayVisible()) {
            this.postPlayPlayerSurfaceStateKey = "";
            this.postPlayPlayerSurfaceRect = {
              x: 0,
              y: 0,
              width: Math.max(1, Math.round(Number(viewport.width || 1920))),
              height: Math.max(1, Math.round(Number(viewport.height || 1080)))
            };
          }
          this.syncPostPlayPlayerSurface(this.getPostPlayState());
          syncHtmlSubtitleClearance(this);
        };
        window.addEventListener("resize", onViewportResize);
        this.videoListeners.push({
          target: window,
          eventName: "resize",
          handler: onViewportResize
        });

        const onHdrPresetChanged = (event) => {
          const next = event && event.detail ? normalizeHdrBrightnessPreset(event.detail) : getSavedHdrBrightnessPreset(PlayerSettingsStore);
          if (!this.subtitleStyleSettings) {
            this.subtitleStyleSettings = {};
          }
          if (this.subtitleStyleSettings.hdrBrightnessPreset !== next) {
            this.subtitleStyleSettings.hdrBrightnessPreset = next;
            this.bitmapSubtitleLastFrameKey = "";
            this.applySubtitlePresentationSettings?.({ refreshTrackRendering: true });
            this.syncPlayerHdrBadge?.();
          }
        };
        const onStorage = (event) => {
          if (event?.key === HDR_PRESET_STORAGE_KEY) {
            const next = getSavedHdrBrightnessPreset(PlayerSettingsStore);
            if (!this.subtitleStyleSettings) {
              this.subtitleStyleSettings = {};
            }
            if (this.subtitleStyleSettings.hdrBrightnessPreset !== next) {
              this.subtitleStyleSettings.hdrBrightnessPreset = next;
              this.bitmapSubtitleLastFrameKey = "";
              this.applySubtitlePresentationSettings?.({ refreshTrackRendering: true });
              this.syncPlayerHdrBadge?.();
            }
          }
        };
        window.addEventListener("hdr-preset-changed", onHdrPresetChanged);
        window.addEventListener("storage", onStorage);
        this.videoListeners.push({
          target: window,
          eventName: "hdr-preset-changed",
          handler: onHdrPresetChanged
        });
        this.videoListeners.push({
          target: window,
          eventName: "storage",
          handler: onStorage
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
