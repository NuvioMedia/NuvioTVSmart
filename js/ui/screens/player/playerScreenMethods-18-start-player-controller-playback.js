import { saveReusableStreamLink } from "../../../core/streams/streamLinkReuse.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods18() {
  const {
    PlayerController,
    isExpiredStreamUrl,
    LOADING_LOGO_FILL_TARGET_LERP,
    LOADING_LOGO_FILL_IDLE_STEP,
    LOADING_LOGO_FILL_FRAME_MS,
    t,
    clamp,
    escapeHtml
  } = internals;

  return {
    startPlayerControllerPlayback(url, context = {}, { mountToken = null, sourceCandidate = null } = {}) {
      const playbackUrl = String(url || "").trim();
      if (!playbackUrl) {
        this.showStartupError(t("player_error_no_stream_url", {}, "No stream URL provided"), {
          streamCandidate: sourceCandidate,
          reason: "missing-url"
        });
        return;
      }
      if (isExpiredStreamUrl(playbackUrl)) {
        this.showExpiredStreamError(playbackUrl, {
          sourceCandidate,
          reason: "stream-url-expired-before-start"
        });
        return Promise.resolve();
      }
      // Keep the candidate as a defensive source of truth. A route can be
      // rebuilt with a context that no longer contains requestHeaders, while
      // the plugin metadata is still present on the selected stream.
      const candidateHeaders = this.getCurrentStreamRequestHeaders(sourceCandidate);
      const contextHeaders = context?.requestHeaders && typeof context.requestHeaders === "object" ? context.requestHeaders : {};
      const requestHeaders = { ...candidateHeaders, ...contextHeaders };
      const playbackContext = {
        ...(context && typeof context === "object" ? context : {}),
        ...(Object.keys(requestHeaders).length ? { requestHeaders } : {})
      };
      saveReusableStreamLink(this, sourceCandidate || this.getCurrentStreamCandidate(), { url: playbackUrl, headers: requestHeaders });
      PlayerController.setStartupPresentationAudioMuted?.(true);
      return Promise.resolve(PlayerController.play(playbackUrl, playbackContext)).catch((error) => {
        if (!this.isActiveMountToken(mountToken) || this.isExternalFrameMode()) {
          return;
        }
        if (playbackUrl !== String(this.activePlaybackUrl || "").trim()) {
          return;
        }
        if (this.isStartupErrorVisible()) {
          return;
        }
        const mediaErrorCode =
          typeof PlayerController.getLastPlaybackErrorCode === "function" ? Number(PlayerController.getLastPlaybackErrorCode() || 0) : 0;
        const detail = String(error?.message || error?.name || error || "").trim();
        const candidate = sourceCandidate || this.getStreamCandidateByUrl(playbackUrl) || this.getCurrentStreamCandidate();
        this.markPlaybackSourceFailed(playbackUrl);
        if (!this.hasPresentedPlaybackFrame) {
          this.showStartupError(this.getStartupErrorMessage(mediaErrorCode, detail, candidate), {
            mediaErrorCode,
            detail,
            error,
            streamCandidate: candidate,
            playbackUrl,
            reason: "play-start"
          });
          console.warn("Playback failed to start", {
            url: playbackUrl,
            mediaErrorCode,
            error
          });
          return;
        }
        this.sourcesError = this.formatPlaybackErrorForSources(
          `${this.mediaErrorMessage(mediaErrorCode, detail, candidate)}. Choose another source manually.`,
          {
            mediaErrorCode,
            detail,
            error,
            streamCandidate: candidate,
            playbackUrl,
            reason: "play-after-startup"
          }
        );
        this.renderSourcesPanel();
        console.warn("Playback failed after startup", {
          url: playbackUrl,
          mediaErrorCode,
          error
        });
      });
    },
    getStartupErrorMessage(mediaErrorCode = 0, detail = "", streamCandidate = this.getCurrentStreamCandidate()) {
      const code = Number(mediaErrorCode || 0);
      const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
      if (compatibilityMessage && (code === 0 || code === 2 || code === 4) && !this.resolvePlaybackHttpStatus(detail)) {
        return compatibilityMessage;
      }
      const baseMessage = this.mediaErrorMessage(code, detail, streamCandidate);
      const extra = String(detail || "").trim();
      if (!extra || (code === 4 && this.isDebridPlaybackCandidate(streamCandidate))) {
        return `${baseMessage}.`;
      }
      const normalizedExtra = extra.replace(/\s+/g, " ");
      if (baseMessage.toLowerCase().includes(normalizedExtra.toLowerCase())) {
        return baseMessage;
      }
      return `${baseMessage}. ${normalizedExtra}`;
    },
    focusStartupErrorButton() {
      const button = this.uiRefs?.startupErrorButton;
      if (button?.focus) {
        button.focus();
      }
      button?.classList?.add("focused");
    },
    renderStartupErrorOverlay() {
      const overlay = this.uiRefs?.startupErrorOverlay;
      if (!overlay) {
        return;
      }
      const visible = this.isStartupErrorVisible();
      overlay.classList.toggle("hidden", !visible);
      overlay.setAttribute("aria-hidden", visible ? "false" : "true");
      if (!visible) {
        overlay.innerHTML = "";
        return;
      }
      const message = String(this.startupErrorMessage || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
      const detailLines = Array.isArray(this.startupErrorDetails) ? this.startupErrorDetails.filter(Boolean) : [];
      overlay.innerHTML = `
          <div class="player-startup-error-shell">
            <div class="player-startup-error-title">${escapeHtml(t("player_error_title", {}, "Playback Error"))}</div>
            <div class="player-startup-error-message" role="status" aria-live="polite">${escapeHtml(message)}</div>
            ${
              detailLines.length
                ? `
              <div class="player-startup-error-details" aria-label="${escapeHtml(t("player_error_details", {}, "Playback error details"))}">
                ${detailLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
              </div>
            `
                : ""
            }
            <button class="player-startup-error-button focusable focused" type="button" tabindex="-1" data-player-error-action="back">
              ${escapeHtml(t("player_go_back", {}, "Go Back"))}
            </button>
          </div>
        `;
      this.uiRefs = {
        ...(this.uiRefs || {}),
        startupErrorButton: overlay.querySelector(".player-startup-error-button")
      };
    },
    shouldUseLoadingLogoFill() {
      return Boolean(this.currentEngineFsStream && !this.isExternalFrameMode());
    },
    stopLoadingLogoFillAnimation() {
      if (this.loadingLogoFillFrame != null) {
        clearTimeout(this.loadingLogoFillFrame);
        this.loadingLogoFillFrame = null;
      }
    },
    scheduleLoadingLogoFillAnimation() {
      if (this.loadingLogoFillFrame != null || !this.loadingLogoFillActive) {
        return;
      }
      this.loadingLogoFillFrame = setTimeout(() => {
        this.loadingLogoFillFrame = null;
        if (!this.loadingLogoFillActive) {
          return;
        }
        const current = clamp(Number(this.loadingLogoFillProgress || 0), 0, 1);
        const target = clamp(Number(this.loadingLogoFillTarget ?? current), current, 1);
        if (current >= 1 || target <= current) {
          this.syncLoadingOverlayProgress();
          return;
        }
        const distance = target - current;
        const step = Math.max(LOADING_LOGO_FILL_IDLE_STEP, distance * LOADING_LOGO_FILL_TARGET_LERP);
        this.loadingLogoFillProgress = Math.min(target, current + step);
        this.syncLoadingOverlayProgress();
        if (this.loadingLogoFillProgress < target) {
          this.scheduleLoadingLogoFillAnimation();
        }
      }, LOADING_LOGO_FILL_FRAME_MS);
    },
    setLoadingLogoFillTarget(progress = null, { immediate = false } = {}) {
      if (!this.shouldUseLoadingLogoFill()) {
        this.loadingLogoFillActive = false;
        this.loadingLogoFillProgress = 0;
        this.loadingLogoFillTarget = 0;
        this.stopLoadingLogoFillAnimation();
        this.syncLoadingOverlayProgress();
        return;
      }
      const parsed = Number(progress);
      if (!Number.isFinite(parsed)) {
        return;
      }
      const current = clamp(Number(this.loadingLogoFillProgress || 0), 0, 1);
      const target = clamp(parsed, current, 1);
      this.loadingLogoFillActive = true;
      this.loadingLogoFillTarget = Math.max(Number(this.loadingLogoFillTarget || 0), target);
      if (immediate) {
        this.loadingLogoFillProgress = Math.max(current, target);
      }
      this.syncLoadingOverlayProgress();
      this.scheduleLoadingLogoFillAnimation();
    },
    syncLoadingOverlayProgress() {
      const identity = this.uiRefs?.loadingIdentity;
      const stack = this.uiRefs?.loadingLogoStack;
      const base = this.uiRefs?.loadingLogoBase;
      const fillClip = this.uiRefs?.loadingLogoFillClip;
      if (this.isStartupErrorVisible()) {
        if (identity) {
          identity.classList.remove("is-loading-progress");
        }
        if (stack) {
          stack.classList.remove("is-loading-progress");
        }
        if (base) {
          base.style.opacity = "";
        }
        if (fillClip) {
          fillClip.classList.add("hidden");
          fillClip.style.width = "0%";
        }
        return;
      }
      if (!this.shouldUseLoadingLogoFill()) {
        this.loadingLogoFillActive = false;
        this.loadingLogoFillProgress = 0;
        this.loadingLogoFillTarget = 0;
        this.stopLoadingLogoFillAnimation();
        if (identity) {
          identity.classList.remove("is-loading-progress");
        }
        if (stack) {
          stack.classList.remove("is-loading-progress");
        }
        if (base) {
          base.style.opacity = "";
        }
        if (fillClip) {
          fillClip.classList.add("hidden");
          fillClip.style.width = "0%";
        }
        return;
      }
      const progress = Number(this.loadingProgress);
      const hasProgress = Number.isFinite(progress) && progress > 0;
      if (hasProgress) {
        this.loadingLogoFillActive = true;
        this.loadingLogoFillTarget = Math.max(Number(this.loadingLogoFillTarget || 0), clamp(progress, 0, 1));
      }
      if (this.currentEngineFsStream && this.hasPresentedPlaybackFrame && !this.isExternalFrameMode()) {
        this.loadingLogoFillActive = true;
        this.loadingLogoFillTarget = 1;
      }
      const showFill = Boolean(this.loadingLogoFillActive);
      if (identity) {
        identity.classList.toggle("is-loading-progress", showFill);
      }
      if (stack) {
        stack.classList.toggle("is-loading-progress", showFill);
      }
      if (base) {
        base.style.opacity = showFill ? "0.25" : "";
      }
      if (fillClip) {
        fillClip.classList.toggle("hidden", !showFill);
        if (showFill) {
          const visiblePercent = Math.round(clamp(this.loadingLogoFillProgress || 0, 0, 1) * 10000) / 100;
          fillClip.style.width = `${visiblePercent}%`;
        } else {
          fillClip.style.width = "0%";
        }
      }
      if (showFill && clamp(Number(this.loadingLogoFillProgress || 0), 0, 1) < clamp(Number(this.loadingLogoFillTarget || 0), 0, 1)) {
        this.scheduleLoadingLogoFillAnimation();
      }
    }
  };
}
