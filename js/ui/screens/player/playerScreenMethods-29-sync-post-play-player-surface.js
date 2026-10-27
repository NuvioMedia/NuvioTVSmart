import { isLivePlayback } from "./livePlaybackUi.js";
import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods29() {
  const { PlayerController, Environment, STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS, BUFFERING_SPINNER_STALL_MS, interpolatePostPlayRect } =
    internals;

  return {
    syncPostPlayPlayerSurface(state = this.getPostPlayState()) {
      const usingAvPlay = Boolean(Environment.isTizen() && PlayerController.isUsingAvPlay?.());
      const video = PlayerController.video;
      // Reading this native object can force style updates even on webOS.
      // Only Tizen uses the AVPlay surface; retain its visibility lifecycle.
      const avPlayObject = Environment.isTizen() ? document.getElementById("avPlayerObject") : null;
      const background = this.uiRefs?.postPlay?.querySelector(".player-post-play-background");
      const viewportWidth = Math.max(1, Math.round(Number(window.innerWidth || 1920)));
      const viewportHeight = Math.max(1, Math.round(Number(window.innerHeight || 1080)));
      const fullRect = { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
      const hidden = Boolean(state.isVisible && (state.isTrailerPlaying || state.hasAutoPlayedTrailer));
      const mode = hidden ? "hidden" : state.isVisible ? "mini" : "normal";
      const key = `${mode}:${usingAvPlay}:${viewportWidth}x${viewportHeight}:${document.documentElement?.dir || "ltr"}`;

      // The background is re-created when recommendations/focus change. Reapply
      // its opening even when the playback surface is already in the right mode.
      const syncBackground = (rect) => {
        const background = this.uiRefs?.postPlay?.querySelector(".player-post-play-background");
        const playerWindow = this.uiRefs?.postPlay?.querySelector(".player-post-play-player-window");
        if (playerWindow?.style) {
          Object.assign(playerWindow.style, {
            left: `${rect.x}px`,
            right: "auto",
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
          });
        }
        if (!background) return;
        const size = `100% 100%, ${rect.width}px ${rect.height}px`;
        const position = `0px 0px, ${rect.x}px ${rect.y}px`;
        background.style.webkitMaskSize = size;
        background.style.maskSize = size;
        background.style.webkitMaskPosition = position;
        background.style.maskPosition = position;
        background.classList.toggle("has-player-window", mode !== "hidden");
      };
      if (mode !== "hidden" && this.postPlayPlayerSurfaceRect) {
        syncBackground(this.postPlayPlayerSurfaceRect);
      } else {
        background?.classList.remove("has-player-window");
      }
      if (avPlayObject?.style) {
        avPlayObject.style.visibility = hidden ? "hidden" : "visible";
      }
      if (mode === "normal" && !this.postPlayPlayerSurfaceStateKey) {
        // A previous trailer can leave the reused player element hidden/rounded.
        if (video?.style) video.style.borderRadius = "";
        return;
      }
      if (key === this.postPlayPlayerSurfaceStateKey) return;
      this.postPlayPlayerSurfaceStateKey = key;
      this.cancelPostPlayPlayerSurfaceAnimation();
      if (hidden) {
        this.postPlayPlayerSurfaceRect = null;
        return;
      }

      const targetRect = { ...fullRect };
      if (mode === "mini") {
        targetRect.width = Math.round(viewportWidth * 0.32);
        targetRect.height = Math.round(targetRect.width * (9 / 16));
        targetRect.x = document.documentElement?.dir === "rtl" ? 32 : viewportWidth - targetRect.width - 32;
        targetRect.y = 32;
      }
      const currentRect = this.postPlayPlayerSurfaceRect || fullRect;
      const nativeViewport = PlayerController.getAvPlayViewportSize?.() || { width: 1920, height: 1080 };
      const applyRect = (rect) => {
        this.postPlayPlayerSurfaceRect = { ...rect };
        if (usingAvPlay) {
          // AVPlay uses 1920x1080 coordinates, independently of the CSS viewport.
          PlayerController.setAvPlayDisplayRect?.(
            {
              x: (rect.x * nativeViewport.width) / viewportWidth,
              y: (rect.y * nativeViewport.height) / viewportHeight,
              width: (rect.width * nativeViewport.width) / viewportWidth,
              height: (rect.height * nativeViewport.height) / viewportHeight
            },
            "PLAYER_DISPLAY_MODE_FULL_SCREEN"
          );
        } else if (video?.style) {
          Object.assign(video.style, {
            position: "fixed",
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            right: "auto",
            bottom: "auto",
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            maxWidth: "none",
            maxHeight: "none",
            objectFit: "cover",
            transform: "none",
            borderRadius: mode === "mini" ? "12px" : "0px"
          });
        }
        // Keep the native object, HTML player, transparent opening, and focus
        // target in the same CSS rectangle throughout Android's 420ms tween.
        syncBackground(rect);
      };
      const finish = () => {
        this.postPlayPlayerSurfaceAnimationFrame = null;
        if (mode === "normal") {
          this.postPlayPlayerSurfaceRect = null;
          background?.classList.remove("has-player-window");
          this.applyAspectMode({ showToast: false });
        }
      };
      if (["x", "y", "width", "height"].every((field) => currentRect[field] === targetRect[field])) {
        applyRect(targetRect);
        finish();
        return;
      }
      const startedAt = typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
      const schedule = (callback) => {
        this.postPlayPlayerSurfaceAnimationUsesRaf = typeof requestAnimationFrame === "function";
        return this.postPlayPlayerSurfaceAnimationUsesRaf ? requestAnimationFrame(callback) : setTimeout(callback, 16);
      };
      const animate = () => {
        if (this.postPlayPlayerSurfaceStateKey !== key) return;
        const now = typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
        const progress = Math.max(0, Math.min(1, (now - startedAt) / 420));
        applyRect(interpolatePostPlayRect(currentRect, targetRect, progress));
        if (progress >= 1) {
          finish();
        } else {
          this.postPlayPlayerSurfaceAnimationFrame = schedule(animate);
        }
      };
      animate();
    },
    measurePlayerActionOverlayOffset() {
      const root = this.uiRefs?.root;
      const controlsBottom = this.uiRefs?.controlsBottom;
      if (!root || !controlsBottom || !this.controlsVisible || this.isExternalFrameMode()) {
        return null;
      }

      const rootRect = root.getBoundingClientRect?.();
      const controlsRect = controlsBottom.getBoundingClientRect?.();
      if (!rootRect || !controlsRect) {
        return null;
      }

      const rootBottom = Number(rootRect.bottom);
      const controlsTop = Number(controlsRect.top);
      const rootHeight = Number(rootRect.height);
      if (!Number.isFinite(rootBottom) || !Number.isFinite(controlsTop) || !Number.isFinite(rootHeight) || rootHeight <= 0) {
        return null;
      }

      const controlsHeightFromBottom = Math.max(0, rootBottom - controlsTop);
      const safetyGap = Math.max(18, Math.min(48, rootHeight * 0.03));
      return Math.ceil(controlsHeightFromBottom + safetyGap);
    },
    syncPlayerActionOverlayOffset() {
      const root = this.uiRefs?.root;
      if (!root) {
        return;
      }

      if (!this.controlsVisible || this.isExternalFrameMode()) {
        root.style.removeProperty("--player-action-controls-open-bottom");
        this.lastActionOverlayBottomPx = null;
        return;
      }

      const measuredBottom = this.measurePlayerActionOverlayOffset();
      if (!Number.isFinite(measuredBottom) || measuredBottom <= 0) {
        return;
      }
      if (Math.abs(Number(this.lastActionOverlayBottomPx || 0) - measuredBottom) < 1) {
        return;
      }

      this.lastActionOverlayBottomPx = measuredBottom;
      root.style.setProperty("--player-action-controls-open-bottom", `${measuredBottom}px`);
    },
    setControlsVisible(visible, { focus = false } = {}) {
      const wasControlsVisible = this.controlsVisible;
      this.controlsVisible = Boolean(visible);
      if (this.isExternalFrameMode()) {
        return;
      }
      const overlay = this.uiRefs?.controlsOverlay;
      if (!overlay) {
        return;
      }
      if (this.controlsVisible) {
        // Android hides the seek overlay when opening controls, keeping any pending seek.
        if (this.seekOverlayTimer) {
          clearTimeout(this.seekOverlayTimer);
          this.seekOverlayTimer = null;
        }
        this.seekOverlayVisible = false;
        this.renderSeekOverlay();
      }
      overlay.classList.toggle("hidden", !this.controlsVisible);
      this.renderPartyPill?.();
      this.syncPlayerOverlayLayoutState();
      this.updateSkipIntroCountdown(Date.now());
      this.renderSkipIntroButton();
      if (this.controlsVisible) {
        this.renderControlButtons();
        if (focus) {
          this.focusFirstControl();
        }
        this.resetControlsAutoHide();
      } else {
        this.clearControlsAutoHide();
        // Android transfers focus to the visible next-episode overlay as part
        // of the same controls-hidden state update. Smart manages focus
        // manually, so waiting for the next playback tick leaves the DOM card
        // selected while the logical focus remains on the player root.
        if (wasControlsVisible) {
          this.renderNextEpisodeCard();
        }
        if (this.controlFocusZone === "nextEpisode" && this.isNextEpisodeCardFocusable()) {
          this.syncNextEpisodeCardFocusState();
        } else {
          this.focusPlayerRootForHiddenControls();
        }
      }
      syncHtmlSubtitleClearance(this);
    },
    focusPlayerRootForHiddenControls() {
      if (this.isExternalFrameMode() || this.controlsVisible || this.isDialogOpen()) {
        return;
      }
      const root = this.uiRefs?.root;
      if (!root || typeof root.focus !== "function") {
        return;
      }
      try {
        root.focus({ preventScroll: true });
      } catch (_) {
        try {
          root.focus();
        } catch (_) {
          // Best effort on older TV engines.
        }
      }
    },
    focusFirstControl() {
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = 0;
      this.syncControlFocusDom();
      const firstButton = this.container.querySelector(".player-control-btn[data-action]");
      firstButton?.focus?.();
    },
    focusProgressBar() {
      if (!this.isSeekBarAvailable()) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
        this.syncControlFocusDom();
        return;
      }
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && typeof activeElement.blur === "function") {
        activeElement.blur();
      }
      this.stickyProgressFocus = true;
      this.controlFocusZone = "progress";
      this.syncControlFocusDom();
      this.uiRefs?.progressShell?.focus?.();
      this.scheduleProgressBarRefocus();
    },
    scheduleProgressBarRefocus() {
      if (!this.controlsVisible || this.controlFocusZone !== "progress") {
        return;
      }
      const run = () => {
        if (!this.controlsVisible || this.controlFocusZone !== "progress") {
          return;
        }
        const buttons = Array.from(this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn") || []);
        buttons.forEach((button) => {
          button.classList.remove("focused");
          if (typeof button.blur === "function") {
            button.blur();
          }
        });
        this.uiRefs?.progressShell?.classList?.add("focused");
        this.uiRefs?.progressShell?.focus?.();
      };
      run();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
      }
      setTimeout(run, 0);
    },
    isStartupLoadingVisible() {
      return Boolean(this.loadingVisible && !this.hasPresentedPlaybackFrame);
    },
    isBufferingSpinnerVisible() {
      if (Environment.isWebOS() && PlayerController.isWebOsDtsAudioBuffering?.()) {
        return !this.isStartupLoadingVisible() && !this.isExternalFrameMode() && !this.isStartupErrorVisible();
      }
      if (this.seekLoading) {
        if (this.isStartupLoadingVisible() || this.seekLoadingVisualComplete) {
          return false;
        }
        return !this.isExternalFrameMode() && !this.isStartupErrorVisible();
      }
      if (
        (!this.loadingVisible && !this.bufferingActive) ||
        !this.hasPresentedPlaybackFrame ||
        this.isExternalFrameMode() ||
        this.isStartupErrorVisible()
      ) {
        return false;
      }
      const currentSeconds = Number(this.getPlaybackCurrentSeconds());
      const baselineSeconds = Number(this.bufferingSpinnerBaselineSeconds);
      if (Number.isFinite(currentSeconds) && Number.isFinite(baselineSeconds)) {
        if (currentSeconds > baselineSeconds + STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS) {
          return false;
        }
      }
      const stalledForMs = Date.now() - Number(this.lastPlaybackProgressAt || 0);
      return stalledForMs >= BUFFERING_SPINNER_STALL_MS;
    },
    isLivePlayback() {
      return isLivePlayback(this, PlayerController);
    },
    isSeekBarAvailable() {
      return !this.isLivePlayback() && (!this.loadingVisible || this.hasPresentedPlaybackFrame || this.seekLoading);
    },
    isSeekOverlaySuppressingControls() {
      return Date.now() < Number(this.seekOverlaySuppressControlsUntil || 0);
    },
    suppressControlsForHiddenSeek(durationMs = 2500) {
      if (this.controlsVisible) {
        return;
      }
      this.seekOverlaySuppressControlsUntil = Math.max(
        Number(this.seekOverlaySuppressControlsUntil || 0),
        Date.now() + Math.max(0, Number(durationMs || 0))
      );
    },
    clearLoadingCompletionTimer() {
      if (this.loadingCompletionTimer) {
        clearTimeout(this.loadingCompletionTimer);
        this.loadingCompletionTimer = null;
      }
    },
    clearBufferingSpinnerTimer() {
      if (this.bufferingSpinnerTimer) {
        clearTimeout(this.bufferingSpinnerTimer);
        this.bufferingSpinnerTimer = null;
      }
    }
  };
}
