import { stripSubtitleSdh } from "../../../core/player/subtitleSdhFilter.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods45() {
  const {
    PlayerController,
    localMediaBitmapSubtitleRepository,
    getSubtitleVerticalOffsetVh,
    BitmapSubtitleDecoder,
    BITMAP_SUBTITLE_WINDOW_SECONDS,
    BITMAP_SUBTITLE_PREFETCH_SECONDS,
    BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS,
    normalizeWebOsHtmlSubtitleText,
    getEmbeddedSubtitleSupportState,
    isBitmapSubtitleSupportError,
    clamp,
    normalizeSubtitleFontSize
  } = internals;

  return {
    async loadBitmapSubtitleWindow(timeSeconds) {
      const track = this.bitmapSubtitleTrack;
      const sourceUrl = this.getTrackProbeUrl();
      if (!track || getEmbeddedSubtitleSupportState(track).supported === false || !sourceUrl || this.bitmapSubtitleLoading) {
        return false;
      }
      const requestToken = Number(this.bitmapSubtitleLoadToken || 0) + 1;
      this.bitmapSubtitleLoadToken = requestToken;
      this.bitmapSubtitleLoading = true;
      const subtitleTime = Math.max(0, Number(timeSeconds || 0));
      const startSeconds = Math.floor(subtitleTime / BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS) * BITMAP_SUBTITLE_WINDOW_BUCKET_SECONDS;
      try {
        const windowData = await localMediaBitmapSubtitleRepository.getWindow({
          url: sourceUrl,
          trackNumber: track.sourceTrackId,
          startSeconds,
          endSeconds: startSeconds + BITMAP_SUBTITLE_WINDOW_SECONDS
        });
        if (requestToken !== this.bitmapSubtitleLoadToken || this.bitmapSubtitleTrack !== track) {
          return false;
        }
        const decoder = new BitmapSubtitleDecoder();
        if (windowData.cueCount > 0) {
          await decoder.load({
            format: windowData.format,
            idxContent: windowData.idxContent,
            data: windowData.data
          });
        }
        if (requestToken !== this.bitmapSubtitleLoadToken || this.bitmapSubtitleTrack !== track) {
          decoder.dispose();
          return false;
        }
        this.embeddedBitmapSubtitleSupportNotice = "";
        track.supported = true;
        track.unsupportedReason = null;
        const previousDecoder = this.bitmapSubtitleDecoder;
        this.bitmapSubtitleDecoder = decoder;
        previousDecoder?.dispose?.();
        this.bitmapSubtitleWindowStart = windowData.windowStartSeconds;
        this.bitmapSubtitleWindowEnd = windowData.windowEndSeconds;
        this.bitmapSubtitleLastFrameKey = "";
        this.renderBitmapSubtitleAtCurrentTime({ force: true });
        return true;
      } catch (error) {
        if (requestToken === this.bitmapSubtitleLoadToken && this.bitmapSubtitleTrack === track) {
          this.bitmapSubtitleLastErrorAt = Date.now();
          this.clearBitmapSubtitleCanvas();
          console.warn("Embedded bitmap subtitle rendering failed", {
            format: track.bitmapSubtitleFormat || "unknown",
            trackNumber: track.sourceTrackId,
            error: error?.message || String(error || "")
          });
          if (isBitmapSubtitleSupportError(error)) {
            this.markEmbeddedBitmapSubtitleUnsupported(track);
          }
        }
        return false;
      } finally {
        if (requestToken === this.bitmapSubtitleLoadToken) {
          this.bitmapSubtitleLoading = false;
        }
      }
    },
    renderBitmapSubtitleAtCurrentTime({ force = false } = {}) {
      const track = this.bitmapSubtitleTrack;
      if (!track || getEmbeddedSubtitleSupportState(track).supported === false) {
        return false;
      }
      const currentTime = Number(this.getPlaybackCurrentSeconds() || 0);
      const subtitleTime = Math.max(0, currentTime - Number(this.subtitleDelayMs || 0) / 1000);
      const outsideWindow = subtitleTime < this.bitmapSubtitleWindowStart || subtitleTime >= this.bitmapSubtitleWindowEnd;
      const approachingWindowEnd =
        this.bitmapSubtitleWindowEnd > 0 && subtitleTime >= this.bitmapSubtitleWindowEnd - BITMAP_SUBTITLE_PREFETCH_SECONDS;
      if ((outsideWindow || approachingWindowEnd) && !this.bitmapSubtitleLoading) {
        const retryAllowed = !this.bitmapSubtitleLastErrorAt || Date.now() - this.bitmapSubtitleLastErrorAt >= 5000;
        if (retryAllowed) {
          void this.loadBitmapSubtitleWindow(subtitleTime);
        }
      }

      const frame = outsideWindow ? null : this.bitmapSubtitleDecoder?.renderAtSeconds(subtitleTime);
      if (!frame) {
        this.clearBitmapSubtitleCanvas();
        return false;
      }
      const canvas = this.uiRefs?.bitmapSubtitles || document.getElementById("playerBitmapSubtitles");
      const compositions = Array.isArray(frame.compositions) ? frame.compositions : [];
      if (!canvas || !frame.screenWidth || !frame.screenHeight) {
        return false;
      }
      const viewport = typeof PlayerController.getPlayerViewportSize === "function" ? PlayerController.getPlayerViewportSize() : null;
      const viewportWidth = Math.max(1, Number(viewport?.width || window.innerWidth || document.documentElement?.clientWidth || 1920));
      const viewportHeight = Math.max(1, Number(viewport?.height || window.innerHeight || document.documentElement?.clientHeight || 1080));
      const style = this.subtitleStyleSettings || {};
      const sizeScale = normalizeSubtitleFontSize(style.fontSize) / 100;
      const verticalOffsetVh = getSubtitleVerticalOffsetVh(style.verticalOffset);
      const verticalOffsetPx = (verticalOffsetVh / 100) * viewportHeight;
      const mode = this.getAspectModeDefinition();
      const rect = this.calculateAspectRect(mode.id, PlayerController.video);
      const modeScaleX = Number(rect.scaleX || 1);
      const modeScaleY = Number(rect.scaleY || 1);
      const renderKey = [
        frame.key,
        viewportWidth,
        viewportHeight,
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
        modeScaleX,
        modeScaleY,
        sizeScale,
        verticalOffsetPx
      ].join(":");
      const hasRenderableCompositions = compositions.some(
        (composition) =>
          composition?.width > 0 && composition?.height > 0 && composition.rgba?.length === composition.width * composition.height * 4
      );
      if (!force && renderKey === this.bitmapSubtitleLastFrameKey && canvas.classList.contains("hidden") !== hasRenderableCompositions) {
        return hasRenderableCompositions;
      }
      canvas.width = viewportWidth;
      canvas.height = viewportHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        return false;
      }
      context.clearRect(0, 0, viewportWidth, viewportHeight);
      if (!hasRenderableCompositions) {
        canvas.classList.add("hidden");
        canvas.setAttribute("aria-hidden", "true");
        this.bitmapSubtitleLastFrameKey = renderKey;
        return false;
      }
      const scratch = this.bitmapSubtitleScratchCanvas || document.createElement("canvas");
      this.bitmapSubtitleScratchCanvas = scratch;
      const scratchContext = scratch.getContext("2d");
      if (!scratchContext) {
        return false;
      }
      const contentScaleX = rect.width / frame.screenWidth;
      const contentScaleY = rect.height / frame.screenHeight;
      let renderedCompositions = 0;
      compositions.forEach((composition) => {
        if (!composition?.width || !composition?.height || composition.rgba?.length !== composition.width * composition.height * 4) {
          return;
        }
        scratch.width = composition.width;
        scratch.height = composition.height;
        const imageData = scratchContext.createImageData(composition.width, composition.height);
        imageData.data.set(composition.rgba);
        scratchContext.putImageData(imageData, 0, 0);
        const targetWidth = composition.width * contentScaleX * sizeScale * modeScaleX;
        const targetHeight = composition.height * contentScaleY * sizeScale * modeScaleY;
        const baseCenterX = rect.x + (composition.x + composition.width / 2) * contentScaleX;
        const baseCenterY = rect.y + (composition.y + composition.height / 2) * contentScaleY;
        const targetCenterX = viewportWidth / 2 + (baseCenterX - viewportWidth / 2) * modeScaleX;
        const requestedCenterY = viewportHeight / 2 + (baseCenterY - viewportHeight / 2) * modeScaleY + verticalOffsetPx;
        const targetCenterY =
          verticalOffsetPx === 0
            ? requestedCenterY
            : targetHeight >= viewportHeight
              ? viewportHeight / 2
              : clamp(requestedCenterY, targetHeight / 2, viewportHeight - targetHeight / 2);
        context.drawImage(scratch, targetCenterX - targetWidth / 2, targetCenterY - targetHeight / 2, targetWidth, targetHeight);
        renderedCompositions += 1;
      });
      if (!renderedCompositions) {
        canvas.classList.add("hidden");
        canvas.setAttribute("aria-hidden", "true");
        this.bitmapSubtitleLastFrameKey = renderKey;
        return false;
      }
      canvas.classList.remove("hidden");
      canvas.setAttribute("aria-hidden", "false");
      this.bitmapSubtitleLastFrameKey = renderKey;
      return true;
    },
    renderHtmlSubtitleOverlayCue(activeCues = []) {
      const node = this.uiRefs?.htmlSubtitles || document.getElementById("playerHtmlSubtitles");
      if (!node) {
        return;
      }
      this.htmlSubtitleLastActiveCues = activeCues;
      const cueKey =
        String(Boolean(this.subtitleStyleSettings?.stripSdh)) +
        activeCues
          .map(
            (cue) =>
              `${cue.start}-${cue.end}-${cue.line ?? "default"}-${cue.position ?? "default"}-${cue.align || "center"}-${cue.size ?? "default"}-${cue.text}`
          )
          .join("|");
      const hasRenderedActiveCue =
        activeCues.length > 0 &&
        !node.classList.contains("hidden") &&
        node.getAttribute("aria-hidden") === "false" &&
        node.childNodes.length > 0;
      const hasRenderedEmptyCue =
        (activeCues.length === 0 || this.htmlSubtitleRenderedEmpty) && node.classList.contains("hidden") && node.childNodes.length === 0;
      if (cueKey === this.htmlSubtitleActiveCueKey && (hasRenderedActiveCue || hasRenderedEmptyCue)) {
        return;
      }
      this.htmlSubtitleActiveCueKey = cueKey;
      if (this.subtitleStyleSettings?.stripSdh)
        activeCues = activeCues.map((cue) => ({ ...cue, text: stripSubtitleSdh(cue.text || "") })).filter((cue) => cue.text.trim());
      if (typeof node.replaceChildren === "function") {
        node.replaceChildren();
      } else {
        node.innerHTML = "";
      }
      this.htmlSubtitleRenderedEmpty = activeCues.length === 0;
      if (!activeCues.length) {
        node.classList.add("hidden");
        node.setAttribute("aria-hidden", "true");
        return;
      }
      const cueGroups = new Map();
      activeCues.forEach((cue) => {
        const rawLine = cue?.line == null ? NaN : Number(cue.line);
        const normalizedLine = Number.isFinite(rawLine) && rawLine < 60 ? clamp(rawLine, 0, 100) : null;
        const rawPosition = cue?.position == null ? NaN : Number(cue.position);
        const position = Number.isFinite(rawPosition) ? clamp(rawPosition, 0, 100) : null;
        const align = ["start", "end", "center"].includes(cue?.align) ? cue.align : "center";
        const rawSize = cue?.size == null ? NaN : Number(cue.size);
        const size = Number.isFinite(rawSize) && rawSize > 0 ? clamp(rawSize, 10, 200) : null;
        const groupKey = `${normalizedLine ?? "default"}:${position ?? "default"}:${align}:${size ?? ""}`;
        if (!cueGroups.has(groupKey)) {
          cueGroups.set(groupKey, { line: normalizedLine, position, align, size, cues: [] });
        }
        cueGroups.get(groupKey).cues.push(cue);
      });
      cueGroups.forEach((group) => {
        const cueNode = document.createElement("div");
        cueNode.className = `player-html-subtitle-cue player-html-subtitle-align-${group.align}`;
        if (group.line == null) {
          cueNode.classList.add("player-html-subtitle-default");
        } else {
          cueNode.classList.add("player-html-subtitle-positioned");
          cueNode.style.top = `${group.line}%`;
          if (group.position != null) {
            cueNode.style.left = `${group.position}%`;
            cueNode.style.right = "auto";
            const anchor = group.align === "start" ? "0%" : group.align === "end" ? "-100%" : "-50%";
            cueNode.style.transform = `translate(${anchor}, -50%)`;
          }
        }
        if (group.size != null && group.line != null) {
          cueNode.style.fontSize = `${group.size}%`;
        }
        group.cues.forEach((cue) =>
          String(cue.text || "")
            .split("\n")
            .forEach((line) => {
              const cleanLine = line.trim();
              if (!cleanLine) {
                return;
              }
              const lineNode = document.createElement("span");
              lineNode.className = "player-html-subtitle-line";
              const shadowNode = document.createElement("span");
              shadowNode.className = "player-html-subtitle-shadow";
              shadowNode.setAttribute("aria-hidden", "true");
              const textNode = document.createElement("span");
              textNode.className = "player-html-subtitle-text";
              const glyphNode = document.createElement("span");
              glyphNode.className = "player-html-subtitle-glyphs";
              const normalizedLine = normalizeWebOsHtmlSubtitleText(cleanLine);
              shadowNode.textContent = normalizedLine;
              glyphNode.textContent = normalizedLine;
              textNode.appendChild(glyphNode);
              lineNode.appendChild(shadowNode);
              lineNode.appendChild(textNode);
              cueNode.appendChild(lineNode);
            })
        );
        if (cueNode.childNodes.length) {
          node.appendChild(cueNode);
        }
      });
      node.classList.remove("hidden");
      node.setAttribute("aria-hidden", "false");
    },
    renderHtmlSubtitleOverlayAtCurrentTime() {
      if (!Array.isArray(this.htmlSubtitleCues) || !this.htmlSubtitleCues.length) {
        return false;
      }
      const currentTime = Number(this.getPlaybackCurrentSeconds() || 0);
      const delaySeconds = Number(this.subtitleDelayMs || 0) / 1000;
      const subtitleTime = currentTime - delaySeconds;
      const activeCues = this.htmlSubtitleCues.filter((cue) => subtitleTime >= cue.start && subtitleTime < cue.end);
      this.renderHtmlSubtitleOverlayCue(activeCues);
      return true;
    }
  };
}
