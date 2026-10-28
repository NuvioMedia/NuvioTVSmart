import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods43() {
  const {
    PlayerController,
    Environment,
    parseVttCueLayout,
    convertAssBodyToVtt,
    createAssRenderer,
    isTx3gSubtitleTrack,
    getTx3gSubtitleSupportMessage,
    getBitmapSubtitleSupportMessage,
    getEmbeddedBitmapSubtitleFormat
  } = internals;

  return {
    getAssSubtitleContainer() {
      return this.uiRefs?.assSubtitles || document.getElementById("playerAssSubtitles");
    },
    destroyAssSubtitleRenderer(renderer = null) {
      // A stale async activation may finish after a newer selection replaced
      // this.assSubtitleRenderer. Destroy only the instance owned by that
      // activation; never hide or clear the newer renderer's container.
      if (renderer && this.assSubtitleRenderer !== renderer) {
        renderer.destroy?.();
        return;
      }
      if (this.assSubtitleRenderer) {
        this.assSubtitleRenderer.destroy();
        this.assSubtitleRenderer = null;
      }
      const node = this.getAssSubtitleContainer();
      if (node) {
        node.classList.add("hidden");
        node.setAttribute("aria-hidden", "true");
      }
    },
    showAssSubtitleContainer() {
      const node = this.getAssSubtitleContainer();
      if (node) {
        node.classList.remove("hidden");
        node.setAttribute("aria-hidden", "false");
      }
    },
    isAssAddonSubtitleActive() {
      return Boolean(this.assSubtitleRenderer?.active);
    },
    async applyAssSubtitleBody({ body, selectionToken, isCurrent = null }) {
      const isCurrentSelection = () =>
        Number(selectionToken) === Number(this.subtitleSelectionToken) &&
        (typeof isCurrent !== "function" || isCurrent()) &&
        (!renderer || this.assSubtitleRenderer === renderer);
      let renderer = null;
      if (!isCurrentSelection()) return { applied: false, stale: true };
      this.destroyAssSubtitleRenderer();
      const container = this.getAssSubtitleContainer();
      const video = PlayerController.video;
      renderer = createAssRenderer({
        body,
        stripSdh: Boolean(this.subtitleStyleSettings?.stripSdh),
        video,
        container,
        selectionToken,
        isCurrentSelection,
        // webOS exposes requestVideoFrameCallback but its video pipeline does
        // not fire it; make ass.js capture requestAnimationFrame instead.
        forceRafFrameLoop: Environment.isWebOS(),
        // The webOS native pipeline can leave video.paused=true while the app
        // is playing, and the UI paused flag can lag that state. The controller
        // state is authoritative when deciding whether to kick the renderer.
        forcePlaybackFrameLoopKick: Environment.isWebOS() && PlayerController.isPlaying
      });
      if (!renderer || typeof renderer.init !== "function") {
        return { applied: false, fallbackVtt: convertAssBodyToVtt(body) };
      }
      this.assSubtitleRenderer = renderer;
      const result = await renderer.init();
      if (!result.ok || !isCurrentSelection()) {
        const current = isCurrentSelection();
        this.destroyAssSubtitleRenderer(renderer);
        return current ? { applied: false, fallbackVtt: convertAssBodyToVtt(body) } : { applied: false, stale: true };
      }
      renderer.setDelay(this.subtitleDelayMs);
      this.showAssSubtitleContainer();
      syncHtmlSubtitleClearance(this);
      return { applied: true };
    },
    parseSubtitleCues(content = "") {
      const normalized = this.convertSrtToVtt(content)
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      return normalized
        .split(/\n{2,}/)
        .map((block) => {
          const lines = block.split("\n").map((line) => line.trimEnd());
          const timingIndex = lines.findIndex((line) => line.includes("-->"));
          if (timingIndex < 0) {
            return null;
          }
          const timingParts = String(lines[timingIndex] || "").split("-->");
          const start = this.parseSubtitleTimestamp(timingParts[0]);
          const end = this.parseSubtitleTimestamp(timingParts[1]);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return null;
          }
          const text = this.parseSubtitleCueText(lines.slice(timingIndex + 1).join("\n"));
          if (!text) {
            return null;
          }
          const layout = parseVttCueLayout(lines[timingIndex]);
          return {
            start,
            end,
            text,
            line: layout.line,
            position: layout.position,
            align: layout.align,
            size: layout.size
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    },
    clearHtmlSubtitleOverlay() {
      if (this.htmlSubtitleRenderFrame != null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.htmlSubtitleRenderFrame);
        } else {
          clearTimeout(this.htmlSubtitleRenderFrame);
        }
      }
      this.htmlSubtitleRenderFrame = null;
      if (this.htmlSubtitleRenderTimer != null) {
        clearTimeout(this.htmlSubtitleRenderTimer);
        this.htmlSubtitleRenderTimer = null;
      }
      if (this.avPlaySubtitleOverlayTimer) {
        clearTimeout(this.avPlaySubtitleOverlayTimer);
        this.avPlaySubtitleOverlayTimer = null;
      }
      this.htmlSubtitleCues = [];
      this.htmlSubtitleLastActiveCues = [];
      this.htmlSubtitleRenderedEmpty = true;
      this.htmlSubtitleActiveCueKey = "";
      this.htmlSubtitleSelectedId = null;
      this.webOsEmbeddedHtmlSubtitleTrack = null;
      this.webOsEmbeddedHtmlSubtitleCueCount = 0;
      this.webOsEmbeddedHtmlSubtitleActivationKey = "";
      const node = this.uiRefs?.htmlSubtitles || document.getElementById("playerHtmlSubtitles");
      if (node) {
        if (typeof node.replaceChildren === "function") {
          node.replaceChildren();
        } else {
          node.innerHTML = "";
        }
        node.classList.add("hidden");
        node.setAttribute("aria-hidden", "true");
      }
    },
    clearBitmapSubtitleCanvas() {
      const canvas = this.uiRefs?.bitmapSubtitles || document.getElementById("playerBitmapSubtitles");
      if (!canvas) {
        return;
      }
      try {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      } catch (_) {
        // Best effort on legacy Canvas implementations.
      }
      canvas.classList.add("hidden");
      canvas.setAttribute("aria-hidden", "true");
      this.bitmapSubtitleLastFrameKey = "";
    },
    clearBitmapSubtitleOverlay({ dispose = false } = {}) {
      this.bitmapSubtitleLoadToken = Number(this.bitmapSubtitleLoadToken || 0) + 1;
      this.bitmapSubtitleLoading = false;
      this.bitmapSubtitleWindowStart = 0;
      this.bitmapSubtitleWindowEnd = 0;
      this.bitmapSubtitleLastErrorAt = 0;
      this.clearBitmapSubtitleCanvas();
      if (dispose) {
        this.embeddedBitmapSubtitleSupportNotice = "";
        this.bitmapSubtitleDecoder?.dispose?.();
        this.bitmapSubtitleDecoder = null;
        this.bitmapSubtitleTrack = null;
        this.bitmapSubtitleScratchCanvas = null;
      }
    },
    markEmbeddedBitmapSubtitleUnsupported(track, reason = "webos-bitmap-runtime") {
      if (!Environment.isWebOS() || !getEmbeddedBitmapSubtitleFormat(track)) {
        return;
      }
      track.supported = false;
      track.unsupportedReason = reason;
      this.embeddedBitmapSubtitleSupportNotice = getBitmapSubtitleSupportMessage();
      this.bitmapSubtitleDecoder?.dispose?.();
      this.bitmapSubtitleDecoder = null;
      this.bitmapSubtitleWindowStart = 0;
      this.bitmapSubtitleWindowEnd = 0;
      this.clearBitmapSubtitleCanvas();
      this.invalidateTrackDialogCaches();
      if (this.subtitleDialogVisible) {
        this.renderSubtitleDialog();
      }
    },
    clearWebOsEmbeddedTextSubtitleOverlay({ dispose = false } = {}) {
      const overlayActive =
        this.webOsEmbeddedTextSubtitleUsingHtml ||
        String(this.htmlSubtitleSelectedId || "").startsWith("webos-embedded-text-") ||
        String(this.htmlSubtitleSelectedId || "").startsWith("tizen-tx3g-") ||
        String(this.htmlSubtitleSelectedId || "").startsWith("tizen-embedded-text-");
      if (this.webOsEmbeddedTextSubtitleUsingAss) {
        this.destroyAssSubtitleRenderer();
      }
      this.webOsEmbeddedTextSubtitleLoadToken = Number(this.webOsEmbeddedTextSubtitleLoadToken || 0) + 1;
      this.webOsEmbeddedTextSubtitleLoading = false;
      this.webOsEmbeddedTextSubtitleWindowStart = 0;
      this.webOsEmbeddedTextSubtitleWindowEnd = 0;
      this.webOsEmbeddedTextSubtitleWindowFailureCount = 0;
      this.webOsEmbeddedTextSubtitleLastErrorAt = 0;
      if (dispose) {
        this.embeddedTextSubtitleSupportNotice = "";
        this.webOsEmbeddedTextSubtitleFallbackUnavailable = false;
      }
      if (overlayActive) {
        this.clearHtmlSubtitleOverlay();
      }
      this.webOsEmbeddedTextSubtitleUsingAss = false;
      if (dispose) {
        this.webOsEmbeddedTextSubtitleTrack = null;
        this.webOsEmbeddedTextSubtitleUsingHtml = false;
      }
    },
    markEmbeddedTextSubtitleUnsupported(track, reason = "tx3g-runtime") {
      if (!isTx3gSubtitleTrack(track)) {
        return;
      }
      this.embeddedTextSubtitleSupportNotice = getTx3gSubtitleSupportMessage(reason);
      if (Environment.isTizen()) {
        track.supported = false;
        track.unsupportedReason = reason;
      }
      this.invalidateTrackDialogCaches();
      if (this.subtitleDialogVisible) {
        this.renderSubtitleDialog();
      }
    },
    prepareWebOsEmbeddedTextSubtitleForSeek(timeSeconds) {
      const track = this.webOsEmbeddedTextSubtitleTrack;
      if (!track) {
        return;
      }
      const targetSeconds = Math.max(0, Number(timeSeconds) || 0);
      const hasReusableWindow =
        this.webOsEmbeddedTextSubtitleWindowEnd > this.webOsEmbeddedTextSubtitleWindowStart &&
        targetSeconds >= this.webOsEmbeddedTextSubtitleWindowStart &&
        targetSeconds < this.webOsEmbeddedTextSubtitleWindowEnd;
      if (hasReusableWindow) {
        return;
      }
      this.webOsEmbeddedTextSubtitleLoadToken = Number(this.webOsEmbeddedTextSubtitleLoadToken || 0) + 1;
      this.webOsEmbeddedTextSubtitleLoading = false;
      this.webOsEmbeddedTextSubtitleWindowStart = 0;
      this.webOsEmbeddedTextSubtitleWindowEnd = 0;
      this.webOsEmbeddedTextSubtitleLastErrorAt = 0;
      if (this.webOsEmbeddedTextSubtitleUsingHtml) {
        this.htmlSubtitleCues = [];
        this.renderHtmlSubtitleOverlayCue([]);
      }
      if (this.webOsEmbeddedTextSubtitleUsingAss) {
        this.destroyAssSubtitleRenderer();
        this.webOsEmbeddedTextSubtitleUsingAss = false;
      }
      // AVPlay is still resolving the seek here. The seeked/timeupdate path
      // starts the optional extractor after the native media request settles.
    }
  };
}
