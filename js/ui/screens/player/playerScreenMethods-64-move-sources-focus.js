/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods64() {
  const {
    PlayerController,
    ASPECT_MODE_DEFINITIONS,
    normalizeAspectMode,
    parseAspectRatio,
    resolveAspectRender,
    DeviceLocalPlayerPreferences,
    Environment,
    SOURCE_NAVIGATION_REPEAT_THROTTLE_MS,
    isSelectKeyCode,
    clamp
  } = internals;

  return {
    moveSourcesFocus(direction) {
      const orderedSources = this.getOrderedStreamCandidates();
      const filters = this.getSourceFilters(orderedSources);
      const list = this.getFilteredSources(orderedSources);
      this.ensureSourcesFocus(filters, list);
      const zone = this.sourcesFocus.zone;
      let index = Number(this.sourcesFocus.index || 0);

      if (zone === "top") {
        if (direction === "left") {
          this.sourcesFocus = { zone: "top", index: clamp(index - 1, 0, 1) };
          return;
        }
        if (direction === "right") {
          this.sourcesFocus = { zone: "top", index: clamp(index + 1, 0, 1) };
          return;
        }
        if (direction === "down") {
          if (filters.length) {
            this.sourcesFocus = {
              zone: "filter",
              index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1)
            };
          } else if (list.length) {
            this.sourcesFocus = { zone: "list", index: 0 };
          }
          return;
        }
        return;
      }

      if (zone === "filter") {
        if (direction === "left") {
          this.sourcesFocus = {
            zone: "filter",
            index: clamp(index - 1, 0, Math.max(0, filters.length - 1))
          };
          return;
        }
        if (direction === "right") {
          this.sourcesFocus = {
            zone: "filter",
            index: clamp(index + 1, 0, Math.max(0, filters.length - 1))
          };
          return;
        }
        if (direction === "up") {
          this.sourcesFocus = { zone: "top", index: 0 };
          return;
        }
        if (direction === "down" && list.length) {
          this.sourcesFocus = { zone: "list", index: clamp(index, 0, list.length - 1) };
        }
        return;
      }

      if (zone === "list") {
        if (direction === "up") {
          if (index > 0) {
            this.sourcesFocus = { zone: "list", index: index - 1 };
          } else if (filters.length) {
            this.sourcesFocus = {
              zone: "filter",
              index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1)
            };
          } else {
            this.sourcesFocus = { zone: "top", index: 0 };
          }
          return;
        }
        if (direction === "down") {
          this.sourcesFocus = {
            zone: "list",
            index: clamp(index + 1, 0, Math.max(0, list.length - 1))
          };
        }
      }
    },
    async activateSourcesFocus() {
      const zone = this.sourcesFocus.zone;
      const index = Number(this.sourcesFocus.index || 0);
      const orderedSources = this.getOrderedStreamCandidates();
      const filters = this.getSourceFilters(orderedSources);
      const list = this.getFilteredSources(orderedSources);

      if (zone === "top") {
        if (index === 0) {
          await this.reloadSources({ forceRefresh: true });
          return;
        }
        this.closeSourcesPanel();
        return;
      }

      if (zone === "filter") {
        const selected = filters[clamp(index, 0, Math.max(0, filters.length - 1))] || "all";
        this.setSourceFilter(selected);
        this.renderSourcesPanel();
        return;
      }

      const selectedStream = list[clamp(index, 0, Math.max(0, list.length - 1))] || null;
      if (selectedStream) {
        await this.playStreamCandidate(selectedStream, { preservePlaybackState: true });
      }
    },
    async handleSourcesPanelKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      const isDirectionalKey = keyCode >= 37 && keyCode <= 40;
      if (isDirectionalKey && event?.repeat) {
        const now = Date.now();
        if (now - Number(this.sourcesLastNavigationRepeatAt || 0) < SOURCE_NAVIGATION_REPEAT_THROTTLE_MS) {
          return true;
        }
        this.sourcesLastNavigationRepeatAt = now;
      }
      if (keyCode === 82) {
        await this.reloadSources({ forceRefresh: true });
        return true;
      }

      if (keyCode === 37) {
        this.moveSourcesFocus("left");
        this.syncSourcesFocusDom();
        return true;
      }
      if (keyCode === 39) {
        this.moveSourcesFocus("right");
        this.syncSourcesFocusDom();
        return true;
      }
      if (keyCode === 38) {
        this.moveSourcesFocus("up");
        this.syncSourcesFocusDom();
        return true;
      }
      if (keyCode === 40) {
        this.moveSourcesFocus("down");
        this.syncSourcesFocusDom();
        return true;
      }
      if (isSelectKeyCode(keyCode)) {
        await this.activateSourcesFocus();
        return true;
      }

      return false;
    },
    showAspectToast(label, durationMs = 1400) {
      const toast = this.uiRefs?.aspectToast;
      if (!toast) {
        return;
      }

      toast.textContent = label;
      toast.classList.remove("hidden");

      if (this.aspectToastTimer) {
        clearTimeout(this.aspectToastTimer);
      }

      this.aspectToastTimer = setTimeout(
        () => {
          toast.classList.add("hidden");
        },
        Math.max(500, Number(durationMs) || 1400)
      );
    },
    getAspectModeDefinition(mode = this.aspectModes?.[this.aspectModeIndex]) {
      const modeId = normalizeAspectMode(typeof mode === "object" ? mode?.id : mode);
      return this.aspectModes?.find((candidate) => candidate.id === modeId) || this.aspectModes?.[0] || ASPECT_MODE_DEFINITIONS[0];
    },
    getVideoAspectRatio(video = PlayerController.video) {
      const explicitAspectCandidates = [
        video?.pixelWidthHeightRatio,
        video?.pixelAspectRatio,
        video?.videoAspectRatio,
        video?.displayAspectRatio,
        video?.aspectRatio
      ];
      for (const candidate of explicitAspectCandidates) {
        const aspect = parseAspectRatio(candidate);
        if (aspect && aspect > 0) {
          const width = Number(video?.videoWidth || 0);
          const height = Number(video?.videoHeight || 0);
          if (candidate === video?.pixelWidthHeightRatio && width > 0 && height > 0) {
            return (width / height) * aspect;
          }
          if (candidate === video?.pixelWidthHeightRatio) {
            continue;
          }
          return aspect;
        }
      }

      const videoWidth = Number(video?.videoWidth || 0);
      const videoHeight = Number(video?.videoHeight || 0);
      if (videoWidth > 0 && videoHeight > 0) {
        return videoWidth / videoHeight;
      }

      const avplayDimensions =
        typeof PlayerController.getAvPlayVideoDimensions === "function" ? PlayerController.getAvPlayVideoDimensions() : null;
      const avplayAspect = parseAspectRatio(avplayDimensions?.aspect);
      if (avplayAspect && avplayAspect > 0) {
        return avplayAspect;
      }
      const avplayWidth = Number(avplayDimensions?.width || 0);
      const avplayHeight = Number(avplayDimensions?.height || 0);
      return avplayWidth > 0 && avplayHeight > 0 ? avplayWidth / avplayHeight : null;
    },
    applyAspectMode({ showToast = false } = {}) {
      const mode = this.getAspectModeDefinition();
      const video = PlayerController.video;
      if (video) {
        const rect = this.calculateAspectRect(mode.id, video);
        const usingTizenAvPlay = Boolean(Environment.isTizen() && PlayerController.isUsingAvPlay?.());
        const canTransformVideo = !Environment.isWebOS() && !usingTizenAvPlay;
        const videoRect = usingTizenAvPlay ? rect.displayRect : rect;
        video.style.position = "fixed";
        if (Environment.isWebOS()) {
          // webOS suppresses its screensaver only when the video element itself
          // occupies the full viewport. Keep aspect handling inside that element.
          video.style.left = "0px";
          video.style.top = "0px";
          video.style.width = "100vw";
          video.style.height = "100vh";
          video.style.objectFit = mode.objectFit;
        } else {
          video.style.left = `${Math.round(videoRect.x)}px`;
          video.style.top = `${Math.round(videoRect.y)}px`;
          video.style.width = `${Math.round(videoRect.width)}px`;
          video.style.height = `${Math.round(videoRect.height)}px`;
          video.style.objectFit = "fill";
        }
        video.style.maxWidth = "none";
        video.style.maxHeight = "none";
        video.style.background = "black";
        video.style.transformOrigin = "center center";
        video.style.transform =
          !canTransformVideo || (rect.scaleX === 1 && rect.scaleY === 1) ? "none" : `scale(${rect.scaleX}, ${rect.scaleY})`;
        if (typeof PlayerController.setAvPlayDisplayRect === "function") {
          PlayerController.setAvPlayDisplayRect(rect.displayRect, rect.displayMethod);
        }
      }
      if (showToast) {
        this.showAspectToast(mode.label);
      }
      this.renderBitmapSubtitleAtCurrentTime({ force: true });
    },
    calculateAspectRect(mode = "ORIGINAL", video = PlayerController.video) {
      const viewport =
        typeof PlayerController.getPlayerViewportSize === "function"
          ? PlayerController.getPlayerViewportSize()
          : {
              width: Math.max(1, Number(window.innerWidth || document.documentElement?.clientWidth || globalThis.screen?.width || 1920)),
              height: Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || globalThis.screen?.height || 1080))
            };
      const viewportWidth = viewport.width;
      const viewportHeight = viewport.height;
      const normalizedMode = normalizeAspectMode(typeof mode === "object" ? mode?.id : mode);
      const videoAspect = this.getVideoAspectRatio(video);
      const render = resolveAspectRender(normalizedMode, viewportWidth, viewportHeight, videoAspect);
      const displayRect = Environment.isTizen()
        ? { x: 0, y: 0, width: viewportWidth, height: viewportHeight }
        : {
            x: render.x,
            y: render.y,
            width: render.width,
            height: render.height
          };
      return {
        ...render,
        mode: normalizedMode,
        displayRect
      };
    },
    cycleAspectMode() {
      this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
      const mode = this.getAspectModeDefinition();
      DeviceLocalPlayerPreferences.setAspectMode(mode.id);
      this.applyAspectMode({ showToast: true });
    }
  };
}
