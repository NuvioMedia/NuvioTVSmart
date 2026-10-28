import { stripSubtitleSdh } from "../../../core/player/subtitleSdhFilter.js";
import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods26() {
  const { PlayerController, Environment, normalizeSubtitleVerticalOffset, isTizenEmbeddedTextSubtitleFallbackTrack } = internals;

  return {
    copySubtitleCuePresentation(sourceCue, targetCue) {
      if (!sourceCue || !targetCue) {
        return;
      }
      ["id", "pauseOnExit", "region", "vertical", "snapToLines", "line", "lineAlign", "position", "positionAlign", "size", "align"].forEach(
        (property) => {
          try {
            if (property in sourceCue && property in targetCue) {
              targetCue[property] = sourceCue[property];
            }
          } catch (_) {
            // Ignore cue presentation copy failures.
          }
        }
      );
    },
    replaceSubtitleCueText(track, cue, text) {
      if (!track || !cue || typeof text !== "string") {
        return false;
      }
      const CueCtor = typeof VTTCue === "function" ? VTTCue : typeof TextTrackCue === "function" ? TextTrackCue : null;
      if (!CueCtor || typeof track.removeCue !== "function" || typeof track.addCue !== "function") {
        return false;
      }
      try {
        const replacement = new CueCtor(cue.startTime, cue.endTime, text);
        this.copySubtitleCuePresentation(cue, replacement);
        const snapshot = this.subtitleCueOriginalState instanceof WeakMap ? this.subtitleCueOriginalState.get(cue) : null;
        if (snapshot && this.subtitleCueOriginalState instanceof WeakMap) {
          this.subtitleCueOriginalState.set(replacement, snapshot);
        }
        track.removeCue(cue);
        track.addCue(replacement);
        return true;
      } catch (_) {
        return false;
      }
    },
    sanitizeSubtitleCueText(cue, track = null) {
      if (!cue || typeof cue !== "object" || typeof cue.text !== "string") {
        return false;
      }
      const snapshot = this.getSubtitleCueSnapshot(cue);
      const original = snapshot?.text ?? cue.text;
      const assSyntax = this.hasSubtitleAssSyntax(original);
      if (assSyntax) this.applySubtitleAssAlignmentToCue(cue, this.getSubtitleAssAlignment(original));
      const baseline = assSyntax ? this.sanitizeSubtitleText(original, { preserveBasicStyle: false }) : original;
      let cleaned = baseline;
      if (this.subtitleStyleSettings?.stripSdh) {
        if (snapshot && snapshot.sdhSource === baseline) cleaned = snapshot.sdhText;
        else {
          cleaned = stripSubtitleSdh(baseline);
          if (snapshot) {
            snapshot.sdhSource = baseline;
            snapshot.sdhText = cleaned;
          }
        }
      }
      if (cleaned === cue.text) {
        if (snapshot) snapshot.sdhLastText = cleaned;
        return false;
      }
      try {
        cue.text = cleaned;
        if (snapshot) snapshot.sdhLastText = cleaned;
        return true;
      } catch (_) {
        const replaced = this.replaceSubtitleCueText(track, cue, cleaned);
        if (replaced && snapshot) snapshot.sdhLastText = cleaned;
        return replaced;
      }
    },
    getSubtitleCueArray(cues) {
      if (!cues || typeof cues.length !== "number") {
        return [];
      }
      const cueCount = Number(cues.length || 0);
      const items = [];
      for (let index = 0; index < cueCount; index += 1) {
        const cue = cues[index] || cues.item?.(index) || null;
        if (cue) {
          items.push(cue);
        }
      }
      return items;
    },
    sanitizeSubtitleCuesForTrack(track) {
      const allCues = this.getSubtitleCueArray(track?.cues);
      const activeCues = this.getSubtitleCueArray(track?.activeCues);
      const seen = new Set();
      let changed = false;
      [...allCues, ...activeCues].forEach((cue) => {
        if (!cue || seen.has(cue)) {
          return;
        }
        seen.add(cue);
        changed = this.sanitizeSubtitleCueText(cue, track) || changed;
      });
      return changed;
    },
    syncSubtitleCueStylesForTrack(track) {
      if (!track) {
        return false;
      }
      const subtitleTextChanged = this.sanitizeSubtitleCuesForTrack(track);
      const style = this.subtitleStyleSettings || {};
      const verticalOffset = normalizeSubtitleVerticalOffset(style.verticalOffset);
      const allCues = this.getSubtitleCueArray(track.cues);
      const activeCues = this.getSubtitleCueArray(track.activeCues);
      const seen = new Set();
      [...allCues, ...activeCues].forEach((cue) => {
        if (!cue || seen.has(cue)) {
          return;
        }
        seen.add(cue);
        const snapshot = this.getSubtitleCueSnapshot(cue);
        this.applySubtitleCueDelay(cue, snapshot, this.subtitleDelayMs);
        this.applySubtitleCueVerticalOffset(cue, snapshot, verticalOffset);
      });
      return subtitleTextChanged;
    },
    refreshSubtitleCueStyles() {
      const tracks = this.getSubtitleCueTrackList();
      if (!tracks.length) {
        return false;
      }

      let subtitleTextChanged = false;
      tracks.forEach((track) => {
        if (!track) {
          return;
        }
        if (typeof track.addEventListener === "function" && !this.subtitleCueStyleBindings.has(track)) {
          const handler = () => {
            const subtitleTextChanged = this.syncSubtitleCueStylesForTrack(track);
            if (subtitleTextChanged) {
              this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
            }
            this.syncWebOsEmbeddedHtmlSubtitleOverlay(track);
          };
          try {
            track.addEventListener("cuechange", handler);
            this.subtitleCueStyleBindings.set(track, handler);
          } catch (_) {
            // Ignore listener registration failures.
          }
        }
        subtitleTextChanged = this.syncSubtitleCueStylesForTrack(track) || subtitleTextChanged;
      });
      this.syncWebOsEmbeddedHtmlSubtitleOverlay();
      return subtitleTextChanged;
    },
    refreshSubtitleTrackRendering() {
      if (this.isTizenEmbeddedTextSubtitleActive()) {
        this.renderWebOsEmbeddedTextSubtitleAtCurrentTime();
        return;
      }
      if (Environment.isWebOS()) {
        if (this.webOsEmbeddedTextSubtitleUsingAss) {
          return;
        }
        if (this.webOsEmbeddedTextSubtitleUsingHtml) {
          this.renderWebOsEmbeddedTextSubtitleAtCurrentTime();
          return;
        }
        if (this.selectedEmbeddedSubtitleTrackIndex < 0 || typeof PlayerController.setWebOsEmbeddedSubtitleTrack !== "function") {
          return;
        }
        const selectedIndex = this.selectedEmbeddedSubtitleTrackIndex;
        const embeddedTrack = this.getEmbeddedSubtitleTrackByEmbeddedIndex(selectedIndex);
        if (embeddedTrack?.bitmapSubtitle) {
          this.renderBitmapSubtitleAtCurrentTime({ force: true });
          return;
        }
        if (this.syncWebOsEmbeddedHtmlSubtitleOverlay()) {
          return;
        }
        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
        const targetTrackIndex = Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0 ? nativeTrackIndex : selectedIndex;
        const timerId = setTimeout(() => {
          this.embeddedSubtitleCueRefreshTimers?.delete?.(timerId);
          if (this.selectedEmbeddedSubtitleTrackIndex !== selectedIndex) {
            return;
          }
          // Keep the native refresh from racing an app-owned renderer. The
          // activation key also covers the existing async HTML-overlay path,
          // which claims ownership before the renderer flags are committed.
          if (
            this.webOsEmbeddedTextSubtitleUsingAss ||
            this.webOsEmbeddedTextSubtitleUsingHtml ||
            this.webOsEmbeddedHtmlSubtitleActivationKey
          ) {
            return;
          }
          PlayerController.setWebOsEmbeddedSubtitleTrack(targetTrackIndex, selectedIndex);
        }, 50);
        this.embeddedSubtitleCueRefreshTimers.add(timerId);
        return;
      }
      const restoreTrackMode = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
      this.getSubtitleCueTrackList().forEach((track) => {
        if (!track || track.mode !== "showing") {
          return;
        }
        try {
          track.mode = "hidden";
        } catch (_) {
          return;
        }
        restoreTrackMode(() => {
          try {
            track.mode = "showing";
          } catch (_) {
            // Ignore native text-track refresh failures.
          }
        });
      });
    },
    isTizenEmbeddedTextSubtitleActive() {
      return Environment.isTizen() && isTizenEmbeddedTextSubtitleFallbackTrack(this.webOsEmbeddedTextSubtitleTrack);
    },
    updateModalBackdrop() {
      const modalBackdrop = this.uiRefs?.modalBackdrop;
      const controlsOverlay = this.uiRefs?.controlsOverlay;
      if (!modalBackdrop) {
        return;
      }
      const hasModal =
        this.subtitleDialogVisible ||
        this.subtitleTimingDialogVisible ||
        this.subtitleDelayOverlayVisible ||
        this.audioDialogVisible ||
        this.sourcesPanelVisible ||
        this.episodePanelVisible ||
        this.speedDialogVisible;
      modalBackdrop.classList.toggle("hidden", !hasModal);
      modalBackdrop.classList.toggle("episodes-open", Boolean(this.episodePanelVisible));
      controlsOverlay?.classList.toggle("modal-blocked", hasModal);
      syncHtmlSubtitleClearance(this);
    }
  };
}
