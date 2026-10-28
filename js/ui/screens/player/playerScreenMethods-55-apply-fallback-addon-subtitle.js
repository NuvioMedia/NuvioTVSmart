/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods55() {
  const {
    PlayerController,
    Environment,
    isAssSubtitle,
    SUBTITLE_LANGUAGE_OFF_KEY,
    SUBTITLE_VIRTUAL_ROW_GAP,
    subtitleLabel,
    normalizeTrackLanguageCode,
    escapeHtml,
    escapeAttribute,
    createSubtitleOptionVirtualState
  } = internals;

  return {
    async applyFallbackAddonSubtitle(subtitleIndex, selectionToken = this.subtitleSelectionToken, subtitleOverride = null) {
      const subtitle = subtitleOverride || this.subtitles[subtitleIndex];
      if (!subtitle?.url) {
        return;
      }
      const subtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;
      const isCurrentSelection = () => Number(selectionToken) === Number(this.subtitleSelectionToken);
      if (!isCurrentSelection()) {
        return;
      }

      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      if ((usingAvPlay && Environment.isTizen()) || Environment.isWebOS()) {
        try {
          if (await this.applyTvHtmlAddonSubtitle(subtitle, subtitleIndex, selectionToken)) {
            return;
          }
        } catch (error) {
          if (!isCurrentSelection()) {
            return;
          }
          console.warn("HTML subtitle overlay failed", {
            subtitleUrl: subtitle.url,
            error: error?.message || String(error || "")
          });
        }
      }
      if (!isCurrentSelection()) {
        return;
      }
      if (usingAvPlay) {
        let avPlaySubtitleUrl = subtitle.url;
        try {
          avPlaySubtitleUrl = Environment.isTizen()
            ? (await this.resolveTizenAvPlaySubtitleUrl(subtitle.url)) || subtitle.url
            : (await this.resolveSubtitlePlaybackUrl(subtitle.url, {
                languageHint: subtitle?.lang || subtitle?.language || subtitle?.languageCode,
                subtitleHeaders: subtitle?.headers
              })) || subtitle.url;
        } catch (_) {
          avPlaySubtitleUrl = subtitle.url;
        }
        if (!isCurrentSelection()) {
          return;
        }
        const applied =
          typeof PlayerController.setAvPlayExternalSubtitle === "function"
            ? PlayerController.setAvPlayExternalSubtitle(avPlaySubtitleUrl)
            : false;
        const fallbackApplied =
          !applied && avPlaySubtitleUrl !== subtitle.url && typeof PlayerController.setAvPlayExternalSubtitle === "function"
            ? PlayerController.setAvPlayExternalSubtitle(subtitle.url)
            : false;
        if (applied || fallbackApplied) {
          this.clearHtmlSubtitleOverlay();
          this.selectedAddonSubtitleId = subtitleId;
          this.selectedSubtitleTrackIndex = -1;
          this.selectedEmbeddedSubtitleTrackIndex = -1;
          this.selectedManifestSubtitleTrackId = null;
          this.refreshSubtitleCueStyles();
          this.renderControlButtons();
          this.renderSubtitleDialog();
          return;
        }
      }

      const video = PlayerController.video;
      if (!video) {
        return;
      }

      const currentTracks = this.getTextTracks();
      this.builtInSubtitleCount = this.externalTrackNodes.length
        ? Math.max(0, currentTracks.length - this.externalTrackNodes.length)
        : currentTracks.length;

      this.disableEmbeddedSubtitleSelection();
      this.clearMountedExternalSubtitleTracks();

      // ASS branch: detect from the raw body and render through ass.js.
      let assFallbackVtt = "";
      let rawBody = null;
      let detectedAss = false;
      try {
        const raw = await this.fetchSubtitleRawBody(subtitle.url, {
          languageHint: subtitle?.lang || subtitle?.language || subtitle?.languageCode,
          subtitleHeaders: subtitle?.headers
        });
        rawBody = raw;
        detectedAss = Boolean(raw?.body != null && isAssSubtitle(raw.body, { sourceUrl: subtitle.url, contentType: raw.contentType }));
        if (detectedAss) {
          if (!isCurrentSelection()) {
            return;
          }
          this.clearHtmlSubtitleOverlay();
          const assResult = await this.applyAssSubtitleBody({
            body: raw.body,
            selectionToken
          });
          if (assResult.applied && isCurrentSelection()) {
            this.selectedAddonSubtitleId = subtitleId;
            this.selectedSubtitleTrackIndex = -1;
            this.selectedEmbeddedSubtitleTrackIndex = -1;
            this.selectedManifestSubtitleTrackId = null;
            this.renderControlButtons();
            this.renderSubtitleDialog();
            return;
          }
          assFallbackVtt = assResult.fallbackVtt || "";
        }
      } catch (assError) {
        if (!isCurrentSelection()) {
          return;
        }
        console.warn("ASS subtitle handling failed", {
          subtitleUrl: subtitle.url,
          error: assError?.message || String(assError || "")
        });
      }

      let resolvedSubtitleUrl = "";
      if (detectedAss) {
        if (!assFallbackVtt) {
          console.warn("ASS subtitle fallback produced no cues", { subtitleUrl: subtitle.url });
          return;
        }
        resolvedSubtitleUrl = URL.createObjectURL(new Blob([assFallbackVtt], { type: "text/vtt" }));
        this.externalSubtitleObjectUrls.push(resolvedSubtitleUrl);
      } else if (rawBody?.body == null && rawBody?.sourceUrl) {
        // blob:/data: URLs were not fetched; preserve the old direct URL path.
        resolvedSubtitleUrl = rawBody.sourceUrl;
      } else if (rawBody) {
        resolvedSubtitleUrl = this.createSubtitleObjectUrl(rawBody.body, rawBody.resolvedUrl || rawBody.sourceUrl, rawBody.contentType);
      } else {
        resolvedSubtitleUrl = subtitle.url;
      }
      if (!isCurrentSelection() || !resolvedSubtitleUrl) {
        return;
      }

      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || subtitleLabel(subtitleIndex);
      track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
      track.src = resolvedSubtitleUrl;
      track.default = true;
      track.setAttribute("data-addon-subtitle-id", subtitleId);
      video.appendChild(track);
      this.externalTrackNodes.push(track);

      try {
        if (track.track) {
          track.track.mode = "hidden";
        }
      } catch (_) {
        // Best effort.
      }

      const activateTrack = () => {
        if (!isCurrentSelection()) {
          return false;
        }
        return this.activateMountedExternalSubtitleTrack(track);
      };
      track.addEventListener("load", activateTrack, { once: true });
      track.addEventListener(
        "error",
        () => {
          console.warn("Subtitle track failed to load", { subtitleUrl: subtitle.url });
        },
        { once: true }
      );

      const preferredIndex = this.builtInSubtitleCount;
      this.selectedAddonSubtitleId = subtitleId;
      this.selectedSubtitleTrackIndex = preferredIndex;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedManifestSubtitleTrackId = null;
      this.renderControlButtons();
      this.renderSubtitleDialog();

      if (this.subtitleSelectionTimer) {
        clearTimeout(this.subtitleSelectionTimer);
        this.subtitleSelectionTimer = null;
      }

      let activationAttempts = 0;
      const scheduleActivation = () => {
        this.subtitleSelectionTimer = setTimeout(
          () => {
            if (!isCurrentSelection()) {
              this.subtitleSelectionTimer = null;
              return;
            }
            activationAttempts += 1;
            const activated = activateTrack();
            if (!activated && activationAttempts < 6) {
              scheduleActivation();
              return;
            }
            if (!activated) {
              this.selectedSubtitleTrackIndex = -1;
              this.refreshTrackDialogs();
              return;
            }
            this.refreshSubtitleCueStyles();
          },
          activationAttempts === 0 ? 80 : 140
        );
      };
      scheduleActivation();
    },
    getSubtitleOptionKeys(options = []) {
      const occurrences = new Map();
      return options.map((item, index) => {
        const baseKey = String(item?.id || `subtitle-option-${index}`);
        const occurrence = Number(occurrences.get(baseKey) || 0);
        occurrences.set(baseKey, occurrence + 1);
        return occurrence ? `${baseKey}#${occurrence}` : baseKey;
      });
    },
    renderSubtitleOptionItemMarkup(item, index, optionKey) {
      return `
                <div class="player-dialog-item focusable${item.selected ? " selected" : ""}${item.disabled ? " disabled" : ""}" role="radio" aria-checked="${item.selected ? "true" : "false"}" data-subtitle-rail="options" data-subtitle-index="${index}" data-subtitle-key="${escapeAttribute(optionKey)}" aria-disabled="${item.disabled ? "true" : "false"}">
                  <div class="player-subtitle-option-copy">
                    <span class="player-subtitle-source-chip">${escapeHtml(item.sourceLabel || "")}</span>
                    <div class="player-dialog-item-main">${escapeHtml(item.title || "")}</div>
                    ${item.meta ? `<div class="player-dialog-item-sub">${escapeHtml(item.meta)}</div>` : ""}
                  </div>
                  <div class="player-dialog-item-check">${item.selected ? "&#10003;" : ""}</div>
                </div>
              `;
    },
    prepareSubtitleOptionVirtualState(languageKey, keys) {
      const state = this.subtitleOptionVirtualState || createSubtitleOptionVirtualState();
      const normalizedLanguageKey = String(languageKey || SUBTITLE_LANGUAGE_OFF_KEY);
      const sameKeys =
        state.languageKey === normalizedLanguageKey &&
        state.keys.length === keys.length &&
        state.keys.every((key, index) => key === keys[index]);
      if (!sameKeys) {
        state.languageKey = normalizedLanguageKey;
        state.keys = keys.slice();
        state.measuredExtents = new Map();
        state.model = null;
        state.window = null;
        state.scrollTop = 0;
        state.initialized = false;
      }
      this.subtitleOptionVirtualState = state;
      return { state, languageChanged: !sameKeys };
    },
    getSubtitleVirtualRowGap() {
      // components.css supplies the same 8px spacing through margin when the
      // legacy runtime lacks flex-gap, so the logical model remains identical.
      return SUBTITLE_VIRTUAL_ROW_GAP;
    }
  };
}
