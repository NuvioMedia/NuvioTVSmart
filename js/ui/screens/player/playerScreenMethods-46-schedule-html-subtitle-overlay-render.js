/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods46() {
  const {
    PlayerController,
    Environment,
    isAssSubtitle,
    decodeSubtitleResponseBody,
    sanitizeSubtitleMojibake,
    isTizenSubRipEmbeddedSubtitleTrack,
    clamp
  } = internals;

  return {
    scheduleHtmlSubtitleOverlayRender() {
      if (!Array.isArray(this.htmlSubtitleCues) || !this.htmlSubtitleCues.length) {
        return;
      }
      if (this.htmlSubtitleRenderTimer != null) {
        clearTimeout(this.htmlSubtitleRenderTimer);
        this.htmlSubtitleRenderTimer = null;
      }
      const render = () => {
        if (!this.renderHtmlSubtitleOverlayAtCurrentTime()) {
          this.htmlSubtitleRenderTimer = null;
          return;
        }
        this.htmlSubtitleRenderTimer = setTimeout(render, 120);
      };
      render();
    },
    isAvPlaySubtitleControlPayload(value = "") {
      const text = String(value || "").trim();
      if (!text) {
        return false;
      }
      // AVPlay may expose the complete SSA event or its positional CSV fields.
      // Strip only the control prefix for structural validation; plain cue text
      // such as "Dialogue: hello" must remain renderable.
      const payload = text.replace(/^\s*(?:Dialogue|Comment)\s*:\s*/i, "");
      const hasAssTiming =
        /^(?:(?:\d+|Marked\s*=\s*\d+)\s*,\s*)?\d+:\d{1,2}:\d{1,2}[.,]\d{1,3}\s*,\s*\d+:\d{1,2}:\d{1,2}[.,]\d{1,3}\s*,/i.test(payload);
      if (hasAssTiming) {
        return true;
      }
      if (/[.!?\u00C0-\u024F]/.test(text)) {
        return false;
      }
      // Require the numeric prefix and a known AVPlay style token so ordinary
      // comma-containing dialogue remains valid.
      return /^\s*\d+\s*,\s*\d+\s*,\s*(?:Onscreen\d*|Screen)\s*,/i.test(payload) && payload.split(",").length >= 6;
    },
    renderAvPlaySubtitleChange(detail = {}) {
      if (!Environment.isTizen() || typeof PlayerController.isUsingAvPlay !== "function" || !PlayerController.isUsingAvPlay()) {
        return;
      }
      // SubRip is rendered from the bounded Matroska extractor below. Ignore a
      // late AVPlay callback only while that HTML overlay is active, so a failed
      // extractor can still fall back to native AVPlay rendering.
      if (
        isTizenSubRipEmbeddedSubtitleTrack(this.webOsEmbeddedTextSubtitleTrack) &&
        this.webOsEmbeddedTextSubtitleUsingHtml &&
        (typeof PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml !== "function" ||
          PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml())
      ) {
        return;
      }
      const subtitleOutputActive =
        typeof PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml === "function"
          ? PlayerController.shouldRenderAvPlaySubtitleCallbacksInHtml()
          : Number(this.selectedSubtitleTrackIndex) >= 0;
      if (!subtitleOutputActive) {
        return;
      }
      if (this.avPlaySubtitleOverlayTimer) {
        clearTimeout(this.avPlaySubtitleOverlayTimer);
        this.avPlaySubtitleOverlayTimer = null;
      }
      const rawText = String(detail?.subtitles || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      // Samsung AVPlay can expose SSA/ASS fields instead of dialogue text.
      // Never project that control payload into the video overlay.
      const text = this.parseSubtitleCueText(rawText);
      if (!text || this.isAvPlaySubtitleControlPayload(rawText)) {
        this.renderHtmlSubtitleOverlayCue([]);
        return;
      }

      this.htmlSubtitleCues = [];
      this.htmlSubtitleSelectedId = "avplay-native";
      const alignment = this.getSubtitleAssAlignment(rawText);
      const layout = this.getSubtitleAssAlignmentSettings(alignment) || {
        line: null,
        align: "center"
      };
      this.renderHtmlSubtitleOverlayCue([{ start: 0, end: 0, text, ...layout }]);
      const durationMs = Number(detail?.duration || 0);
      const hideDelayMs = Number.isFinite(durationMs) && durationMs > 0 ? clamp(durationMs, 250, 12000) : 2500;
      this.avPlaySubtitleOverlayTimer = setTimeout(() => {
        this.avPlaySubtitleOverlayTimer = null;
        this.renderHtmlSubtitleOverlayCue([]);
      }, hideDelayMs);
    },
    async applyTvHtmlAddonSubtitle(subtitle, subtitleIndex, selectionToken = this.subtitleSelectionToken) {
      const isCurrentSelection = () => Number(selectionToken) === Number(this.subtitleSelectionToken);
      if (!isCurrentSelection()) {
        return false;
      }
      const subtitleId = subtitle?.id || subtitle?.url || `subtitle-${subtitleIndex}`;
      const sourceUrl = String(subtitle?.url || "");

      // ASS branch: fetch the raw body and render through ass.js when
      // detected. Native AVPlay subtitle handling cannot consume ASS text,
      // so the HTML overlay (or ass.js overlay) is the only presentation.
      if (Environment.isWebOS() || (Environment.isTizen() && PlayerController.isUsingAvPlay?.())) {
        let raw = null;
        try {
          raw = await this.fetchSubtitleRawBody(sourceUrl, {
            languageHint: subtitle?.lang || subtitle?.language || subtitle?.languageCode,
            subtitleHeaders: subtitle?.headers
          });
        } catch (assFetchError) {
          if (!isCurrentSelection()) {
            return false;
          }
          console.warn("ASS subtitle fetch failed", {
            subtitleUrl: sourceUrl,
            error: assFetchError?.message || String(assFetchError || "")
          });
          // Fall through to the existing HTML subtitle path.
        }
        if (raw?.body != null && isAssSubtitle(raw.body, { sourceUrl, contentType: raw.contentType })) {
          if (!isCurrentSelection()) {
            return false;
          }
          this.clearMountedExternalSubtitleTracks();
          this.clearHtmlSubtitleOverlay();
          if (typeof PlayerController.setAvPlaySubtitleTrack === "function") {
            PlayerController.setAvPlaySubtitleTrack(-1);
          }
          const assResult = await this.applyAssSubtitleBody({
            body: raw.body,
            selectionToken
          });
          if (assResult.applied && isCurrentSelection()) {
            this.selectedAddonSubtitleId = subtitleId;
            this.selectedSubtitleTrackIndex = -1;
            this.selectedEmbeddedSubtitleTrackIndex = -1;
            this.selectedManifestSubtitleTrackId = null;
            this.invalidateTrackDialogCaches();
            this.renderControlButtons();
            this.renderSubtitleDialog();
            return true;
          }
          // ass.js unavailable or stale: plain-text VTT fallback below.
          const fallbackCues = this.parseSubtitleCues(assResult.fallbackVtt || "");
          if (fallbackCues.length && isCurrentSelection()) {
            this.clearMountedExternalSubtitleTracks();
            this.clearHtmlSubtitleOverlay();
            this.destroyAssSubtitleRenderer();
            this.htmlSubtitleCues = fallbackCues;
            this.htmlSubtitleSelectedId = subtitleId;
            this.selectedAddonSubtitleId = subtitleId;
            this.selectedSubtitleTrackIndex = -1;
            this.selectedEmbeddedSubtitleTrackIndex = -1;
            this.selectedManifestSubtitleTrackId = null;
            this.renderHtmlSubtitleOverlayCue([]);
            this.scheduleHtmlSubtitleOverlayRender();
            this.invalidateTrackDialogCaches();
            this.refreshSubtitleCueStyles();
            this.renderControlButtons();
            this.renderSubtitleDialog();
            return true;
          }
          console.warn("ASS subtitle fallback produced no cues", { subtitleUrl: sourceUrl });
          return false;
        }
        if (raw?.body != null) {
          // Non-ASS body already fetched: parse cues directly, no second
          // network round trip.
          if (!isCurrentSelection()) {
            return false;
          }
          const cues = this.parseSubtitleCues(raw.body);
          if (!cues.length) {
            throw new Error("HTML subtitle fetch returned no cues");
          }
          this.clearMountedExternalSubtitleTracks();
          this.clearHtmlSubtitleOverlay();
          this.destroyAssSubtitleRenderer();
          if (typeof PlayerController.setAvPlaySubtitleTrack === "function") {
            PlayerController.setAvPlaySubtitleTrack(-1);
          }
          this.htmlSubtitleCues = cues;
          this.htmlSubtitleSelectedId = subtitleId;
          this.selectedAddonSubtitleId = subtitleId;
          this.selectedSubtitleTrackIndex = -1;
          this.selectedEmbeddedSubtitleTrackIndex = -1;
          this.selectedManifestSubtitleTrackId = null;
          this.renderHtmlSubtitleOverlayCue([]);
          this.scheduleHtmlSubtitleOverlayRender();
          this.invalidateTrackDialogCaches();
          this.refreshSubtitleCueStyles();
          this.renderControlButtons();
          this.renderSubtitleDialog();
          return true;
        }
      }

      const subtitleUrl = Environment.isTizen()
        ? await this.resolveTizenAvPlaySubtitleUrl(subtitle?.url)
        : await this.resolveSubtitlePlaybackUrl(subtitle?.url, {
            languageHint: subtitle?.lang || subtitle?.language || subtitle?.languageCode,
            subtitleHeaders: subtitle?.headers
          });
      if (!subtitleUrl) {
        return false;
      }
      const response = await fetch(subtitleUrl, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`HTML subtitle fetch failed with HTTP ${response.status}`);
      }
      const decodedText =
        typeof TextDecoder === "function"
          ? await decodeSubtitleResponseBody(response, {
              languageHint: subtitle?.lang || subtitle?.language || subtitle?.languageCode
            })
          : null;
      const text = sanitizeSubtitleMojibake(decodedText ?? (await response.text()));
      if (!isCurrentSelection()) {
        return false;
      }
      const cues = this.parseSubtitleCues(text);
      if (!cues.length) {
        throw new Error("HTML subtitle fetch returned no cues");
      }
      this.clearMountedExternalSubtitleTracks();
      this.clearHtmlSubtitleOverlay();
      this.destroyAssSubtitleRenderer();
      if (typeof PlayerController.setAvPlaySubtitleTrack === "function") {
        PlayerController.setAvPlaySubtitleTrack(-1);
      }
      this.htmlSubtitleCues = cues;
      this.htmlSubtitleSelectedId = subtitleId;
      this.selectedAddonSubtitleId = subtitleId;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedManifestSubtitleTrackId = null;
      this.renderHtmlSubtitleOverlayCue([]);
      this.scheduleHtmlSubtitleOverlayRender();
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return true;
    },
    activateMountedExternalSubtitleTrack(trackNode) {
      const textTracks = this.getTextTracks();
      const targetTrack = trackNode?.track || null;
      if (!targetTrack && !textTracks.length) {
        return false;
      }

      let activatedIndex = -1;
      textTracks.forEach((textTrack, index) => {
        const shouldShow = targetTrack ? textTrack === targetTrack : index === textTracks.length - 1;
        try {
          textTrack.mode = shouldShow ? "showing" : "disabled";
          if (shouldShow) {
            activatedIndex = index;
          }
        } catch (_) {
          // Best effort.
        }
      });

      if (activatedIndex < 0 && targetTrack) {
        try {
          targetTrack.mode = "showing";
          activatedIndex = textTracks.indexOf(targetTrack);
        } catch (_) {
          // Best effort.
        }
      }

      if (activatedIndex >= 0) {
        this.selectedSubtitleTrackIndex = activatedIndex;
        this.refreshTrackDialogs();
        return true;
      }

      return false;
    },
    resolveBuiltInSubtitleBoundary(textTracks = this.getTextTracks()) {
      const trackCount = textTracks.length;
      if (!trackCount) {
        return 0;
      }

      if (Number.isFinite(this.builtInSubtitleCount) && this.builtInSubtitleCount > 0) {
        return clamp(this.builtInSubtitleCount, 0, trackCount);
      }

      if (this.externalTrackNodes.length > 0) {
        const inferred = trackCount - this.externalTrackNodes.length;
        if (inferred >= 0) {
          return clamp(inferred, 0, trackCount);
        }
        return trackCount;
      }

      return trackCount;
    }
  };
}
