/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods25() {
  const {
    PlayerController,
    Environment,
    buildHtmlSubtitleCue,
    getSubtitleAssAlignment,
    getSubtitleAssAlignmentSettings,
    splitSubtitleVerticalOffset,
    clamp,
    hasExplicitSubtitleVerticalPosition
  } = internals;

  return {
    getSubtitleCueTrackList() {
      const trackList = this.getVideoTextTrackList();
      if (!trackList) {
        return [];
      }
      try {
        return Array.from(trackList).filter(Boolean);
      } catch (_) {
        const tracks = [];
        const length = Number(trackList.length || 0);
        for (let index = 0; index < length; index += 1) {
          const track = trackList[index] || trackList.item?.(index) || null;
          if (track) {
            tracks.push(track);
          }
        }
        return tracks;
      }
    },
    getSelectedWebOsEmbeddedTextTrack() {
      if (!Environment.isWebOS() || this.selectedEmbeddedSubtitleTrackIndex < 0) {
        return null;
      }
      const embeddedTrack = this.getEmbeddedSubtitleTrackByEmbeddedIndex(this.selectedEmbeddedSubtitleTrackIndex);
      if (!embeddedTrack || embeddedTrack.bitmapSubtitle) {
        return null;
      }
      const nativeTrackIndex = Number(embeddedTrack.nativeTrackIndex);
      if (!Number.isFinite(nativeTrackIndex) || nativeTrackIndex < 0) {
        return null;
      }
      return this.getSubtitleCueTrackList()[nativeTrackIndex] || null;
    },
    buildWebOsEmbeddedHtmlSubtitleCues(track) {
      return this.getSubtitleCueArray(track?.cues)
        .map((cue) =>
          buildHtmlSubtitleCue(
            cue,
            this.getSubtitleCueSnapshot(cue),
            this.parseSubtitleCueText(this.getSubtitleCueSnapshot(cue)?.text ?? cue?.text)
          )
        )
        .filter(Boolean);
    },
    activateWebOsEmbeddedHtmlSubtitleOverlay(track, cues, selectedIndex, overlayId) {
      if (
        this.webOsEmbeddedTextSubtitleUsingAss ||
        this.webOsEmbeddedTextSubtitleUsingHtml ||
        !track ||
        !cues.length ||
        this.selectedEmbeddedSubtitleTrackIndex !== selectedIndex ||
        this.getSelectedWebOsEmbeddedTextTrack() !== track
      ) {
        return false;
      }
      if (this.htmlSubtitleSelectedId !== overlayId) {
        this.clearHtmlSubtitleOverlay();
      }

      this.getSubtitleCueTrackList().forEach((candidate) => {
        try {
          candidate.mode = candidate === track ? "hidden" : "disabled";
        } catch (_) {
          // Luna has already hidden its renderer, so readonly modes remain harmless.
        }
      });
      this.webOsEmbeddedHtmlSubtitleTrack = track;
      this.webOsEmbeddedHtmlSubtitleCueCount = cues.length;
      this.htmlSubtitleCues = cues;
      this.htmlSubtitleSelectedId = overlayId;
      this.renderHtmlSubtitleOverlayAtCurrentTime();
      this.scheduleHtmlSubtitleOverlayRender();
      return true;
    },
    syncWebOsEmbeddedHtmlSubtitleOverlay(track = this.getSelectedWebOsEmbeddedTextTrack()) {
      if (
        !Environment.isWebOS() ||
        this.webOsEmbeddedTextSubtitleUsingAss ||
        this.webOsEmbeddedTextSubtitleUsingHtml ||
        !track ||
        this.selectedEmbeddedSubtitleTrackIndex < 0 ||
        track !== this.getSelectedWebOsEmbeddedTextTrack()
      ) {
        return false;
      }
      const cues = this.buildWebOsEmbeddedHtmlSubtitleCues(track);
      if (!cues.length) {
        // Keep the native renderer visible until webOS exposes real cue data.
        return false;
      }

      const selectedIndex = Number(this.selectedEmbeddedSubtitleTrackIndex);
      const overlayId = `webos-embedded-${selectedIndex}`;
      if (this.htmlSubtitleSelectedId === overlayId) {
        void PlayerController.setWebOsEmbeddedSubtitleNativeVisibility?.(false, selectedIndex);
        return this.activateWebOsEmbeddedHtmlSubtitleOverlay(track, cues, selectedIndex, overlayId);
      }
      if (
        this.webOsEmbeddedHtmlSubtitleActivationKey === overlayId ||
        typeof PlayerController.setWebOsEmbeddedSubtitleNativeVisibility !== "function"
      ) {
        return false;
      }

      this.webOsEmbeddedHtmlSubtitleActivationKey = overlayId;
      Promise.resolve(PlayerController.setWebOsEmbeddedSubtitleNativeVisibility(false, selectedIndex))
        .then((nativeRendererHidden) => {
          if (this.webOsEmbeddedHtmlSubtitleActivationKey !== overlayId) {
            return;
          }
          this.webOsEmbeddedHtmlSubtitleActivationKey = "";
          if (!nativeRendererHidden) {
            return;
          }
          const currentCues = this.buildWebOsEmbeddedHtmlSubtitleCues(track);
          this.activateWebOsEmbeddedHtmlSubtitleOverlay(track, currentCues, selectedIndex, overlayId);
        })
        .catch(() => {
          if (this.webOsEmbeddedHtmlSubtitleActivationKey === overlayId) {
            this.webOsEmbeddedHtmlSubtitleActivationKey = "";
          }
        });
      return false;
    },
    refreshWebOsEmbeddedHtmlSubtitleOverlayIfNeeded() {
      const track = this.webOsEmbeddedHtmlSubtitleTrack;
      if (!track || !this.htmlSubtitleSelectedId?.startsWith?.("webos-embedded-")) {
        return false;
      }
      const cueCount = this.getSubtitleCueArray(track.cues).length;
      if (cueCount !== this.webOsEmbeddedHtmlSubtitleCueCount) {
        return this.syncWebOsEmbeddedHtmlSubtitleOverlay(track);
      }
      return false;
    },
    clearSubtitleCueStyleBindings() {
      if (!(this.subtitleCueStyleBindings instanceof Map)) {
        this.subtitleCueStyleBindings = new Map();
        return;
      }
      this.subtitleCueStyleBindings.forEach((handler, track) => {
        try {
          track?.removeEventListener?.("cuechange", handler);
        } catch (_) {
          // Best effort.
        }
      });
      this.subtitleCueStyleBindings.clear();
    },
    clearEmbeddedSubtitleCueRefreshTimers() {
      if (this.embeddedSubtitleCueRefreshTimers instanceof Set) {
        this.embeddedSubtitleCueRefreshTimers.forEach((timerId) => clearTimeout(timerId));
        this.embeddedSubtitleCueRefreshTimers.clear();
      } else {
        this.embeddedSubtitleCueRefreshTimers = new Set();
      }
      this.webOsEmbeddedCueRefreshApplied = false;
    },
    refreshWebOsEmbeddedSubtitleAfterCueMutation() {
      if (!Environment.isWebOS() || this.webOsEmbeddedCueRefreshApplied || this.selectedEmbeddedSubtitleTrackIndex < 0) {
        return;
      }
      this.webOsEmbeddedCueRefreshApplied = true;
      this.refreshSubtitleTrackRendering();
    },
    scheduleEmbeddedSubtitleCueRefresh() {
      if (this.embeddedSubtitleCueRefreshTimers instanceof Set) {
        this.embeddedSubtitleCueRefreshTimers.forEach((timerId) => clearTimeout(timerId));
        this.embeddedSubtitleCueRefreshTimers.clear();
      } else {
        this.embeddedSubtitleCueRefreshTimers = new Set();
      }
      if (!Environment.isWebOS() || this.selectedEmbeddedSubtitleTrackIndex < 0) {
        return;
      }
      const selectedIndex = this.selectedEmbeddedSubtitleTrackIndex;
      [0, 400, 1200].forEach((delayMs) => {
        const timerId = setTimeout(() => {
          this.embeddedSubtitleCueRefreshTimers?.delete?.(timerId);
          if (this.selectedEmbeddedSubtitleTrackIndex !== selectedIndex) {
            return;
          }
          const changed = this.refreshSubtitleCueStyles();
          if (changed) {
            this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
          }
        }, delayMs);
        this.embeddedSubtitleCueRefreshTimers.add(timerId);
      });
    },
    getSubtitleCueSnapshot(cue) {
      if (!cue || typeof cue !== "object") {
        return null;
      }
      if (!(this.subtitleCueOriginalState instanceof WeakMap)) {
        this.subtitleCueOriginalState = new WeakMap();
      }
      let snapshot = this.subtitleCueOriginalState.get(cue);
      if (!snapshot) {
        snapshot = {
          text: cue.text,
          startTime: cue.startTime,
          endTime: cue.endTime,
          line: cue.line,
          lineAlign: cue.lineAlign,
          position: cue.position,
          positionAlign: cue.positionAlign,
          vertical: cue.vertical,
          snapToLines: cue.snapToLines
        };
        this.subtitleCueOriginalState.set(cue, snapshot);
      }
      if (typeof cue.text === "string" && cue.text !== snapshot.text && cue.text !== snapshot.sdhLastText) {
        snapshot.text = cue.text;
        snapshot.sdhSource = null;
        snapshot.sdhText = null;
      }
      return snapshot;
    },
    applySubtitleCueDelay(cue, snapshot, delayMs = 0) {
      if (!cue || !snapshot) {
        return;
      }
      const offsetSeconds = Number(delayMs || 0) / 1000;
      const startTime = Number(snapshot.startTime);
      const endTime = Number(snapshot.endTime);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        return;
      }
      const nextStart = Math.max(0, startTime + offsetSeconds);
      const nextEnd = Math.max(nextStart + 0.001, endTime + offsetSeconds);
      try {
        cue.startTime = nextStart;
        cue.endTime = nextEnd;
      } catch (_) {
        // Some native text tracks expose readonly cue timing.
      }
    },
    restoreSubtitleCueSnapshot(cue, snapshot) {
      if (!cue || !snapshot) {
        return;
      }
      try {
        cue.line = snapshot.line;
      } catch (_) {
        // Ignore cue restore failures.
      }
      try {
        if ("lineAlign" in cue) {
          cue.lineAlign = snapshot.lineAlign;
        }
      } catch (_) {
        // Ignore cue restore failures.
      }
      try {
        if ("position" in cue) {
          cue.position = snapshot.position;
        }
      } catch (_) {
        // Ignore cue restore failures.
      }
      try {
        if ("positionAlign" in cue) {
          cue.positionAlign = snapshot.positionAlign;
        }
      } catch (_) {
        // Ignore cue restore failures.
      }
      try {
        if ("snapToLines" in cue) {
          cue.snapToLines = snapshot.snapToLines;
        }
      } catch (_) {
        // Ignore cue restore failures.
      }
    },
    applySubtitleCueVerticalOffset(cue, snapshot, offset) {
      if (!cue || !snapshot) {
        return;
      }
      const { lineOffset } = splitSubtitleVerticalOffset(offset);
      // A source-authored line (including percentage positioning) belongs to
      // the subtitle itself. Keep it intact; Android applies its bottom padding
      // only when the cue has no explicit line.
      if (hasExplicitSubtitleVerticalPosition(snapshot) || (lineOffset === 0 && String(snapshot.line) === "auto")) {
        this.restoreSubtitleCueSnapshot(cue, snapshot);
        return;
      }

      try {
        if ("snapToLines" in cue) {
          cue.snapToLines = true;
        }
      } catch (_) {
        // Ignore cue styling failures.
      }

      const adjustedLine = lineOffset === 0 ? "auto" : clamp(-1 - lineOffset, -100, 100);
      try {
        cue.line = adjustedLine;
      } catch (_) {
        // Ignore cue styling failures.
      }
    },
    getSubtitleAssAlignment(content) {
      return getSubtitleAssAlignment(content);
    },
    hasSubtitleAssSyntax(content) {
      return /\{[^}]*[\\/][a-z0-9]+[^}]*\}|\\[Nnh]/i.test(String(content || ""));
    },
    getSubtitleAssAlignmentSettings(alignment) {
      return getSubtitleAssAlignmentSettings(alignment);
    },
    applySubtitleAssAlignmentToCue(cue, alignment) {
      const settings = this.getSubtitleAssAlignmentSettings(alignment);
      if (!cue || !settings) {
        return;
      }
      try {
        if ("snapToLines" in cue) {
          cue.snapToLines = false;
        }
      } catch (_) {
        // Ignore cue positioning failures.
      }
      try {
        cue.line = settings.line;
      } catch (_) {
        // Ignore cue positioning failures.
      }
      try {
        cue.align = settings.align;
      } catch (_) {
        // Ignore cue positioning failures.
      }
    }
  };
}
