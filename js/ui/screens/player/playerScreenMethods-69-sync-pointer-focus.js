/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods69() {
  const { SUBTITLE_LANGUAGE_OFF_KEY, clamp } = internals;

  return {
    syncPointerFocus(target) {
      const nextEpisodeNode = target?.closest?.("[data-player-pointer-action='nextEpisode']");
      if (nextEpisodeNode && this.isNextEpisodeCardFocusable()) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "nextEpisode";
        this.resetControlsAutoHide();
        this.renderControlButtons();
        this.syncNextEpisodeCardFocusState();
        return;
      }

      const skipIntroNode = target?.closest?.("[data-player-pointer-action='skipIntro']");
      if (skipIntroNode && this.isSkipIntroButtonFocusable()) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "skipIntro";
        this.resetControlsAutoHide();
        this.renderControlButtons();
        this.syncSkipIntroFocusState();
        return;
      }

      const controlButton = target?.closest?.(".player-control-btn[data-action]");
      if (controlButton) {
        const buttons = Array.from(this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn[data-action]") || []);
        const index = buttons.indexOf(controlButton);
        if (index >= 0) {
          this.stickyProgressFocus = false;
          this.autoHideControlsAfterSeek = false;
          this.controlFocusZone = "buttons";
          this.controlFocusIndex = index;
          this.resetControlsAutoHide();
        }
        return;
      }

      if (target?.closest?.(".player-progress-shell")) {
        this.stickyProgressFocus = true;
        this.controlFocusZone = "progress";
        this.resetControlsAutoHide();
        return;
      }

      const sourcesNode = target?.closest?.("[data-sources-zone]");
      if (sourcesNode && this.sourcesPanelVisible) {
        this.sourcesFocus = {
          zone: sourcesNode.dataset.sourcesZone || "filter",
          index: Number(sourcesNode.dataset.sourcesIndex || 0)
        };
        return;
      }

      const subtitleNode = target?.closest?.("[data-subtitle-rail]");
      if (subtitleNode && this.subtitleDialogVisible) {
        this.subtitleFocusedRail = subtitleNode.dataset.subtitleRail || "language";
        const index = Number(subtitleNode.dataset.subtitleIndex || 0);
        if (this.subtitleFocusedRail === "language") {
          this.subtitleLanguageRailIndex = index;
          this.subtitleFocusedLanguageKey = this.getSubtitleLanguageRailItems()[index]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
          this.syncSubtitleOptionIndexForFocusedLanguage();
        } else if (this.subtitleFocusedRail === "options") {
          this.subtitleOptionRailIndex = index;
          this.rememberSubtitleOptionFocus(
            this.getSelectedSubtitleLanguageKey(),
            this.getSubtitleOptionsForLanguage(this.getSelectedSubtitleLanguageKey()),
            index
          );
        } else {
          this.subtitleStyleRailIndex = index;
          this.subtitleStyleControlSide =
            String(subtitleNode.dataset.subtitleStyleAction || "").toLowerCase() === "increase" ? "plus" : "minus";
        }
        return;
      }

      const audioNode = target?.closest?.("[data-audio-column]");
      if (audioNode && this.audioDialogVisible) {
        this.audioFocusedColumn = audioNode.dataset.audioColumn || "tracks";
        const index = Number(audioNode.dataset.audioIndex || 0);
        if (this.audioFocusedColumn === "tracks") {
          this.audioDialogIndex = index;
        } else {
          this.audioMixFocusIndex = index;
        }
        return;
      }

      const speedNode = target?.closest?.("[data-speed-index]");
      if (speedNode && this.speedDialogVisible) {
        this.speedDialogIndex = Number(speedNode.dataset.speedIndex || 0);
        return;
      }

      const episodeCloseNode = target?.closest?.("[data-episode-action='close']");
      if (episodeCloseNode && this.episodePanelVisible) {
        if (this.episodePanelMode === "streams") {
          this.episodePanelStreamFocus = { zone: "close", index: 0 };
        } else {
          this.episodePanelFocusZone = "close";
        }
        return;
      }

      const episodeStreamAction = target?.closest?.("[data-episode-stream-action]");
      if (episodeStreamAction && this.episodePanelVisible) {
        this.episodePanelStreamFocus = {
          zone: "actions",
          index: episodeStreamAction.dataset.episodeStreamAction === "reload" ? 1 : 0
        };
        return;
      }

      const episodeStreamFilter = target?.closest?.("[data-episode-stream-filter-index]");
      if (episodeStreamFilter && this.episodePanelVisible) {
        this.episodePanelStreamFocus = {
          zone: "filters",
          index: Number(episodeStreamFilter.dataset.episodeStreamFilterIndex || 0)
        };
        return;
      }

      const episodeStreamNode = target?.closest?.("[data-episode-stream-index]");
      if (episodeStreamNode && this.episodePanelVisible) {
        this.episodePanelStreamFocus = {
          zone: "streams",
          index: Number(episodeStreamNode.dataset.episodeStreamIndex || 0)
        };
        return;
      }

      const episodeSeasonNode = target?.closest?.("[data-episode-season-index]");
      if (episodeSeasonNode && this.episodePanelVisible) {
        const seasonIndex = Number(episodeSeasonNode.dataset.episodeSeasonIndex || 0);
        const seasons = this.getEpisodePanelSeasons();
        this.episodePanelSeasonIndex = clamp(seasonIndex, 0, Math.max(0, seasons.length - 1));
        this.episodePanelSeason = seasons[this.episodePanelSeasonIndex] ?? this.episodePanelSeason;
        const firstEntry = this.getEpisodePanelEntries()[0];
        if (firstEntry) {
          this.episodePanelIndex = firstEntry.index;
        }
        this.episodePanelFocusZone = "seasons";
        return;
      }

      const episodeNode = target?.closest?.("[data-episode-index]");
      if (episodeNode && this.episodePanelVisible) {
        this.episodePanelIndex = Number(episodeNode.dataset.episodeIndex || 0);
        this.episodePanelFocusZone = "episodes";
      }
    },
    seekProgressFromPointer(event, target) {
      if (!this.isSeekBarAvailable()) return false;
      const shell = target?.closest?.(".player-progress-shell") || this.uiRefs?.progressShell;
      const rect = shell?.getBoundingClientRect?.();
      const duration = this.getPlaybackDurationSeconds();
      if (!rect || rect.width <= 0 || !Number.isFinite(duration) || duration <= 0) {
        return false;
      }
      const x = Number(event?.clientX ?? rect.left);
      const ratio = clamp((x - rect.left) / rect.width, 0, 1);
      this.seekPreviewSeconds = null;
      this.seekRepeatCount = 0;
      this.seekPlaybackSeconds(duration * ratio);
      this.resetControlsAutoHide();
      return true;
    },
    onPointerSurfaceActivate(target) {
      if (
        !target ||
        this.isExternalFrameMode() ||
        this.isDialogOpen() ||
        this.isStartupErrorVisible() ||
        this.isPostPlayVisible() ||
        this.controlsVisible
      ) {
        return false;
      }
      const video = this.container?.querySelector?.("#videoPlayer");
      if (!video || (target !== video && target?.closest?.("#videoPlayer") !== video)) {
        return false;
      }
      this.setControlsVisible(true, { focus: true });
      return true;
    },
    onPointerFocus(target) {
      if (this.isPostPlayVisible()) {
        const actionNode = target?.closest?.("[data-player-post-play-action]");
        if (actionNode && !actionNode.disabled) {
          this.postPlayFocusedAction = String(actionNode.dataset.playerPostPlayAction || "primary");
          this.uiRefs?.postPlay
            ?.querySelectorAll?.(".focusable.focused")
            ?.forEach((entry) => entry.classList.toggle("focused", entry === actionNode));
        }
        return;
      }
      if (this.subtitleTimingDialogVisible && target?.closest?.("#playerSubtitleTimingDialog")) {
        const cueNode = target.closest("[data-subtitle-timing-cue-index]");
        if (cueNode) {
          this.subtitleAutoSyncCueFocusIndex = Number(cueNode.dataset.subtitleTimingCueIndex || 0);
        }
        this.syncSubtitleTimingFocusDom({ focus: false, scroll: false });
        return;
      }
      if (this.subtitleDelayOverlayVisible && target?.closest?.("#playerSubtitleDelayOverlay")) {
        const delayNode = target.closest("[data-subtitle-delay-focus]");
        if (delayNode) {
          this.subtitleDelayFocusTarget = String(delayNode.dataset.subtitleDelayFocus || "slider");
          this.syncSubtitleDelayOverlayFocusDom({ focus: false });
        }
        return;
      }
      this.syncPointerFocus(target);
    }
  };
}
