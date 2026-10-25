/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods68() {
  const {
    PlayerController,
    subtitleRepository,
    PlayerSettingsStore,
    subtitleLabel,
    normalizeTrackLanguageCode,
    clamp,
    normalizeSubtitleLanguageKey
  } = internals;

  return {
    async loadSubtitles() {
      const requestToken = (this.subtitleLoadToken || 0) + 1;
      this.subtitleLoadToken = requestToken;
      this.subtitleLoading = true;

      const sidecarSubtitles = this.collectStreamSidecarSubtitles();
      const subtitleLookup = this.buildSubtitleLookupContext();
      try {
        this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
        this.refreshTrackDialogs();

        let repositorySubtitles = [];

        try {
          if (subtitleLookup.id && subtitleLookup.type) {
            repositorySubtitles = await subtitleRepository.getSubtitles(
              subtitleLookup.type,
              subtitleLookup.id,
              subtitleLookup.videoId || null,
              {
                season: subtitleLookup.season,
                episode: subtitleLookup.episode,
                title: subtitleLookup.title,
                year: subtitleLookup.year,
                videoHash: subtitleLookup.videoHash || null,
                videoSize: subtitleLookup.videoSize || null,
                filename: subtitleLookup.filename || null
              }
            );
          }
        } catch (error) {
          console.error("Subtitle fetch failed", error);
        }

        if (requestToken !== this.subtitleLoadToken) {
          return;
        }

        const subtitleSettings = PlayerSettingsStore.get();
        const preferredOnly = Boolean(subtitleSettings.subtitleStyle?.showOnlyPreferredLanguages);
        if (preferredOnly) {
          const preferredTargets = new Set(this.getStartupPreferredSubtitleLanguageTargets());
          repositorySubtitles = repositorySubtitles.filter((entry) => {
            const language = normalizeSubtitleLanguageKey(entry?.lang || entry?.language || entry?.languageCode || "");
            return Array.from(preferredTargets).some((target) => {
              if (language === target) return true;
              if (target === "pt" || target === "es") return false;
              return language.startsWith(`${target}-`);
            });
          });
        }

        this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, repositorySubtitles);
        if (this.subtitleDialogVisible && this.subtitleDialogTab === "builtIn") {
          const builtInBoundary = this.resolveBuiltInSubtitleBoundary(this.getTextTracks());
          if (builtInBoundary <= 0 && this.subtitles.length > 0) {
            this.subtitleDialogTab = "addons";
            this.subtitleDialogIndex = 0;
          }
        }
        this.refreshTrackDialogs();
      } catch (error) {
        console.error("Subtitle attach failed", error);
        this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
        this.refreshTrackDialogs();
      } finally {
        if (requestToken === this.subtitleLoadToken) {
          this.subtitleLoading = false;
          this.refreshTrackDialogs();
          this.reapplyPendingWebOsAddonSubtitle?.();
        }
      }
    },
    attachExternalSubtitles() {
      const video = PlayerController.video;
      if (!video) {
        return;
      }

      this.clearMountedExternalSubtitleTracks();

      this.builtInSubtitleCount = this.getTextTracks().length;
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      if (usingAvPlay) {
        return;
      }

      this.subtitles.forEach((subtitle, index) => {
        if (!subtitle.url) {
          return;
        }
        const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = subtitle.lang || subtitleLabel(index);
        track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
        track.src = subtitle.url;
        track.default = false;
        track.setAttribute("data-addon-subtitle-id", subtitleId);
        video.appendChild(track);
        this.externalTrackNodes.push(track);
      });
    },
    moveControlFocus(delta) {
      const controls = this.getControlDefinitions();
      if (!controls.length) {
        return;
      }
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      if (this.controlFocusZone === "progress") {
        this.controlFocusZone = "buttons";
        this.controlFocusIndex = delta < 0 ? 0 : 0;
        this.syncControlFocusDom();
        return;
      }
      const nextIndex = clamp(this.controlFocusIndex + delta, 0, controls.length - 1);
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = nextIndex;
      this.syncControlFocusDom();
      this.resetControlsAutoHide();
    },
    performFocusedControl() {
      if (this.controlFocusZone === "progress") {
        this.cancelSeekPreview({ commit: true });
        this.resetControlsAutoHide();
        return;
      }
      if (this.controlFocusZone === "nextEpisode") {
        void this.playNextEpisode({ userInitiated: true });
        return;
      }
      const controls = this.getControlDefinitions();
      const current = controls[this.controlFocusIndex] || null;
      if (!current) {
        return;
      }
      this.performControlAction(current.action || "");
      this.resetControlsAutoHide();
    },
    performControlAction(action) {
      if (action === "playPause") {
        this.togglePause();
        this.renderControlButtons();
        return;
      }

      if (action === "playNextEpisode") {
        void this.playNextEpisode({ userInitiated: true });
        return;
      }

      if (action === "stillWatchingContinue") {
        void this.onStillWatchingContinue();
        return;
      }

      if (action === "stillWatchingExit") {
        this.onDismissStillWatchingPrompt();
        return;
      }

      if (action === "subtitleDialog") {
        if (this.subtitleDialogVisible) {
          this.closeSubtitleDialog();
        } else {
          this.openSubtitleDialog();
        }
        return;
      }

      if (action === "audioTrack") {
        if (this.audioDialogVisible) {
          this.closeAudioDialog();
        } else {
          this.openAudioDialog();
        }
        return;
      }

      if (action === "source") {
        if (this.sourcesPanelVisible) {
          this.closeSourcesPanel();
        } else {
          this.openSourcesPanel();
        }
        return;
      }

      if (action === "switchEngine") {
        this.switchPlaybackEngine();
        return;
      }

      if (action === "episodes") {
        this.toggleEpisodePanel();
        return;
      }

      if (action === "party") {
        this.togglePartyPanel();
        return;
      }

      if (action === "streamInfo") {
        this.showStreamInfo();
        return;
      }
      if (action === "more") {
        this.stickyProgressFocus = false;
        this.moreActionsVisible = true;
        this.controlFocusZone = "buttons";
        this.controlFocusIndex = Math.max(
          0,
          this.getControlDefinitions().findIndex((entry) => entry.action === "speed" || entry.action === "aspect")
        );
        this.renderControlButtons();
        return;
      }

      if (action === "backFromMore") {
        this.stickyProgressFocus = false;
        this.moreActionsVisible = false;
        this.controlFocusZone = "buttons";
        this.controlFocusIndex = 0;
        this.renderControlButtons();
        return;
      }

      if (action === "speed") {
        this.openSpeedDialog();
        return;
      }

      if (action === "aspect") {
        this.cycleAspectMode();
        return;
      }
    }
  };
}
