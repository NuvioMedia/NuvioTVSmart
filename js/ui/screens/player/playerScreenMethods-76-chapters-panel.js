/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

const CHAPTER_PANEL_TRANSITION_MS = 180;

function formatChapterTime(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

export function createPlayerScreenMethods76() {
  const { escapeHtml, contentTextDirection, t, clamp, isSelectKeyCode, isBackEvent } = internals;

  return {
    normalizePlayerChapters(chapters = []) {
      const sorted = (Array.isArray(chapters) ? chapters : [])
        .map((chapter) => ({ ...chapter, startMs: Number(chapter?.startMs) }))
        .filter((chapter) => Number.isFinite(chapter.startMs) && chapter.startMs >= 0)
        .sort((left, right) => left.startMs - right.startMs);
      const seen = new Set();
      const unique = sorted.filter((chapter) => {
        if (seen.has(chapter.startMs)) {
          return false;
        }
        seen.add(chapter.startMs);
        return true;
      });
      // A lone chapter (often a single "Chapter 1" at 0) has nothing to skip to.
      return unique.length >= 2 ? unique : [];
    },

    applyPlayerChapters(chapters = []) {
      if (!Array.isArray(chapters) || !chapters.length) {
        return false;
      }
      const normalized = this.normalizePlayerChapters?.(chapters);
      this.playerChapters = Array.isArray(normalized) ? normalized : [];
      if (!this.playerChapters.length) {
        return false;
      }
      if (this.chaptersPanelVisible) {
        this.renderChaptersPanel?.();
      } else if (this.controlsVisible) {
        this.renderControlButtons?.();
      }
      return true;
    },

    chapterIndexAt(positionMs = 0) {
      const chapters = Array.isArray(this.playerChapters) ? this.playerChapters : [];
      const position = Number(positionMs);
      if (!chapters.length || !Number.isFinite(position)) {
        return 0;
      }
      let index = 0;
      chapters.forEach((chapter, chapterIndex) => {
        if (Number(chapter.startMs) <= position) {
          index = chapterIndex;
        }
      });
      return index;
    },

    ensurePlayerChaptersPanel() {
      const root = this.uiRefs?.root;
      if (!root) {
        return null;
      }
      let panel = root.querySelector("#playerChaptersPanel");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "playerChaptersPanel";
        panel.className = "player-sources-panel player-chapters-panel hidden";
        panel.setAttribute("data-chapters-panel", "true");
        root.appendChild(panel);
      }
      return panel;
    },

    toggleChaptersPanel() {
      if (this.chaptersPanelVisible) {
        return this.closeChaptersPanel();
      }
      return this.openChaptersPanel();
    },

    openChaptersPanel() {
      if (!Array.isArray(this.playerChapters) || this.playerChapters.length < 2) {
        return false;
      }
      if (typeof this.isLivePlayback === "function" && this.isLivePlayback()) {
        return false;
      }
      // Android keeps one side panel at a time.
      if (this.sourcesPanelVisible) {
        this.sourcesPanelVisible = false;
        this.renderSourcesPanel?.();
      }
      if (this.episodePanelVisible) {
        this.hideEpisodePanel?.();
      }
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.renderSubtitleDialog?.();
      this.renderAudioDialog?.();
      this.renderSpeedDialog?.();
      const positionMs = Math.round(Number(this.getPlaybackCurrentSeconds?.() || 0) * 1000);
      this.chaptersPanelVisible = true;
      this.chaptersFocusIndex = this.chapterIndexAt(positionMs);
      this.setControlsVisible?.(true, { focus: false });
      this.resetControlsAutoHide?.();
      this.updateModalBackdrop?.();
      this.renderChaptersPanel();
      return true;
    },

    closeChaptersPanel({ restoreFocus = true } = {}) {
      if (!this.chaptersPanelVisible) {
        return false;
      }
      this.chaptersPanelVisible = false;
      const panel = this.uiRefs?.root?.querySelector("#playerChaptersPanel");
      if (panel) {
        panel.classList.add("hidden");
        panel.innerHTML = "";
      }
      this.updateModalBackdrop?.();
      if (restoreFocus) {
        this.controlFocusZone = "buttons";
        this.controlFocusIndex = Number(this.controlFocusIndex || 0);
        this.renderControlButtons?.();
      }
      this.resetControlsAutoHide?.();
      return true;
    },

    renderChaptersPanel() {
      const panel = this.ensurePlayerChaptersPanel();
      if (!panel) {
        return;
      }
      panel.classList.toggle("hidden", !this.chaptersPanelVisible);
      if (!this.chaptersPanelVisible) {
        return;
      }
      const chapters = Array.isArray(this.playerChapters) ? this.playerChapters : [];
      const durationMs = Math.round(Number(this.getPlaybackDurationSeconds?.() || 0) * 1000);
      const positionMs = Math.round(Number(this.getPlaybackCurrentSeconds?.() || 0) * 1000);
      const currentIndex = this.chapterIndexAt(positionMs);
      const focusIndex = clamp(Number(this.chaptersFocusIndex || 0), 0, Math.max(0, chapters.length - 1));
      panel.innerHTML = `
        <div class="player-sources-header">
          <div class="player-sources-title">${escapeHtml(
            t("player_chapters_title", [chapters.length], `Chapters (${chapters.length})`)
          )}</div>
          <button type="button" class="player-sources-top-btn focusable" data-chapters-action="close">
            ${escapeHtml(t("episodes_panel_close", {}, "Close"))}
          </button>
        </div>
        <div class="player-chapters-list">
          ${chapters
            .map((chapter, index) => {
              const endMs = index + 1 < chapters.length ? chapters[index + 1].startMs : durationMs;
              const isCurrent = index === currentIndex;
              const progress =
                isCurrent && endMs > chapter.startMs
                  ? Math.max(0, Math.min(1, (positionMs - chapter.startMs) / (endMs - chapter.startMs)))
                  : null;
              const title = String(chapter.title || "").trim();
              const label = title || t("player_chapter_number", [index + 1], `Chapter ${index + 1}`);
              return `
                <button type="button"
                        class="player-chapter-item focusable${index === focusIndex ? " focused" : ""}${isCurrent ? " is-current" : ""}"
                        data-chapters-index="${index}"
                        data-chapters-zone="list">
                  <span class="player-chapter-number">${isCurrent ? "▶" : index + 1}</span>
                  <span class="player-chapter-copy">
                    <span class="player-chapter-title" dir="${contentTextDirection(label)}">${escapeHtml(label)}</span>
                    ${
                      progress != null
                        ? `<span class="player-chapter-progress-track"><span class="player-chapter-progress-fill" style="width:${Math.round(progress * 100)}%"></span></span>`
                        : ""
                    }
                  </span>
                  <span class="player-chapter-time">${escapeHtml(formatChapterTime(chapter.startMs))}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      `;
      const focused = panel.querySelector(`[data-chapters-index="${focusIndex}"]`);
      focused?.scrollIntoView?.({ block: "nearest" });
    },

    moveChaptersFocus(direction) {
      const chapters = Array.isArray(this.playerChapters) ? this.playerChapters : [];
      if (!chapters.length) {
        return false;
      }
      const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
      if (!delta) {
        return false;
      }
      this.chaptersFocusIndex = clamp(Number(this.chaptersFocusIndex || 0) + delta, 0, chapters.length - 1);
      this.renderChaptersPanel();
      return true;
    },

    activateChaptersFocus() {
      const chapters = Array.isArray(this.playerChapters) ? this.playerChapters : [];
      const chapter = chapters[clamp(Number(this.chaptersFocusIndex || 0), 0, chapters.length - 1)];
      if (!chapter) {
        return false;
      }
      const startSeconds = Number(chapter.startMs) / 1000;
      if (!Number.isFinite(startSeconds)) {
        return false;
      }
      // Android dismisses the panel when a chapter is selected.
      this.closeChaptersPanel({ restoreFocus: false });
      this.seekPlaybackSeconds(startSeconds);
      this.resetControlsAutoHide?.();
      return true;
    },

    /** Media next/previous (and channel up/down) jump between chapters like Android. */
    skipPlayerChapter(forward) {
      const chapters = Array.isArray(this.playerChapters) ? this.playerChapters : [];
      if (chapters.length < 2 || this.isLivePlayback?.() === true) {
        return false;
      }
      const positionMs = Number(this.getPlaybackCurrentSeconds?.() || 0) * 1000;
      let targetMs = null;
      if (forward) {
        targetMs = chapters.find((chapter) => Number(chapter.startMs) > positionMs)?.startMs ?? null;
      } else {
        const index = this.chapterIndexAt(positionMs);
        if (index < 0) {
          return false;
        }
        const currentStart = Number(chapters[index].startMs);
        targetMs = positionMs - currentStart > 3000 || index === 0 ? currentStart : Number(chapters[index - 1].startMs);
      }
      if (!Number.isFinite(Number(targetMs))) {
        return false;
      }
      this.seekPlaybackSeconds(Number(targetMs) / 1000);
      this.resetControlsAutoHide?.();
      return true;
    },

    handleChaptersPanelKey(event) {
      if (!this.chaptersPanelVisible) {
        return false;
      }
      if (isBackEvent?.(event)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.closeChaptersPanel();
        return true;
      }
      const keyCode = Number(event?.keyCode || 0);
      const isSelect = isSelectKeyCode(keyCode) || keyCode === 66;
      if (keyCode === 38 || keyCode === 40) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.moveChaptersFocus(keyCode === 38 ? "up" : "down");
        return true;
      }
      if (isSelect) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.activateChaptersFocus();
        return true;
      }
      return false;
    },

    syncChaptersPanelHighlight() {
      if (!this.chaptersPanelVisible) {
        return;
      }
      const panel = this.uiRefs?.root?.querySelector("#playerChaptersPanel");
      if (!panel) {
        return;
      }
      const positionMs = Math.round(Number(this.getPlaybackCurrentSeconds?.() || 0) * 1000);
      const currentIndex = this.chapterIndexAt(positionMs);
      const buttons = Array.from(panel.querySelectorAll("[data-chapters-index]"));
      buttons.forEach((button, index) => {
        button.classList.toggle("is-current", index === currentIndex);
        const number = button.querySelector(".player-chapter-number");
        if (number) {
          number.textContent = index === currentIndex ? "▶" : String(index + 1);
        }
      });
    }
  };
}
