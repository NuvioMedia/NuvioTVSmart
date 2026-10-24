/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods70() {
  const { PlayerController, Router, t } = internals;

  return {
    async onPointerActivate(target, event) {
      if (!target || this.isExternalFrameMode()) {
        return false;
      }
      this.syncPointerFocus(target);

      if (this.isPostPlayVisible() && this.handlePostPlayPointer(target, event)) {
        return true;
      }

      if (this.subtitleTimingDialogVisible && this.handleSubtitleTimingDialogPointer(target)) {
        return true;
      }

      if (this.subtitleDelayOverlayVisible && this.handleSubtitleDelayOverlayPointer(target)) {
        return true;
      }

      const errorAction = target.closest?.("[data-player-error-action]");
      if (errorAction && this.isStartupErrorVisible()) {
        if (String(errorAction.dataset.playerErrorAction || "") === "back") {
          this.navigateBackToStreamScreen();
          return true;
        }
        return false;
      }

      if (target.closest?.("[data-player-pointer-action='skipIntro']")) {
        return this.skipActiveInterval();
      }

      if (target.closest?.("[data-player-pointer-action='nextEpisode']")) {
        await this.playNextEpisode({ userInitiated: true });
        return true;
      }

      if (target.closest?.("[data-player-pointer-action='stillWatchingContinue']")) {
        await this.onStillWatchingContinue();
        return true;
      }

      if (target.closest?.("[data-player-pointer-action='stillWatchingExit']")) {
        this.onDismissStillWatchingPrompt();
        return true;
      }

      if (target.closest?.("[data-player-pointer-action='hdr-badge']") || target.closest?.("#playerHdrBadge")) {
        this.toggleHdrBrightnessPresetQuickly?.();
        this.resetControlsAutoHide();
        return true;
      }

      if (target.closest?.(".player-progress-shell")) {
        return this.seekProgressFromPointer(event, target);
      }

      const controlButton = target.closest?.(".player-control-btn[data-action]");
      if (controlButton) {
        this.performControlAction(controlButton.dataset.action || "");
        this.resetControlsAutoHide();
        return true;
      }

      const sourcesNode = target.closest?.("[data-sources-zone]");
      if (sourcesNode && this.sourcesPanelVisible) {
        await this.activateSourcesFocus();
        return true;
      }

      const subtitleStep = target.closest?.("[data-subtitle-style-action]");
      if (subtitleStep && this.subtitleDialogVisible) {
        const styleItems = this.getSubtitleStyleControls();
        const styleIndex = Number(subtitleStep.dataset.subtitleIndex);
        const styleItem = styleItems[styleIndex];
        if (styleItem && !styleItem.disabled) {
          this.subtitleStyleRailIndex = styleIndex;
          const side = String(subtitleStep.dataset.subtitleStyleAction || "").toLowerCase() === "increase" ? "plus" : "minus";
          this.subtitleStyleControlSide = side;
          this.adjustSubtitleStyleControl(styleItem.id, this.getSubtitleStyleControlDelta(side));
        }
        return true;
      }

      const subtitleDelayNode = target.closest?.("[data-subtitle-delay-action='open']");
      if (subtitleDelayNode && this.subtitleDialogVisible && subtitleDelayNode.getAttribute("aria-disabled") !== "true") {
        this.showSubtitleDelayOverlay();
        return true;
      }

      const subtitleNode = target.closest?.("[data-subtitle-rail]");
      if (subtitleNode && this.subtitleDialogVisible) {
        return this.handleSubtitleDialogKey({ keyCode: 13 });
      }

      const audioStep = target.closest?.("[data-audio-step]");
      if (audioStep && this.audioDialogVisible) {
        this.activateAudioControl(Number(audioStep.dataset.audioStep || 1));
        return true;
      }

      const audioNode = target.closest?.("[data-audio-column]");
      if (audioNode && this.audioDialogVisible) {
        if (this.audioFocusedColumn === "tracks") {
          this.applyAudioTrack(this.audioDialogIndex, { rememberSelection: true });
        } else {
          this.activateAudioControl(this.audioMixFocusIndex === 0 ? 1 : 0);
        }
        return true;
      }

      const speedNode = target.closest?.("[data-speed-index]");
      if (speedNode && this.speedDialogVisible) {
        const speedOptions = this.getPlaybackSpeedOptions();
        this.applyPlaybackSpeed(speedOptions[this.speedDialogIndex] || 1);
        return true;
      }

      const episodeCloseNode = target.closest?.("[data-episode-action='close']");
      if (episodeCloseNode && this.episodePanelVisible) {
        this.hideEpisodePanel();
        return true;
      }

      const episodeStreamAction = target.closest?.("[data-episode-stream-action]");
      if (episodeStreamAction && this.episodePanelVisible) {
        await this.activateEpisodeStreamFocus();
        return true;
      }

      const episodeStreamFilter = target.closest?.("[data-episode-stream-filter-index]");
      if (episodeStreamFilter && this.episodePanelVisible) {
        await this.activateEpisodeStreamFocus();
        return true;
      }

      const episodeStreamNode = target.closest?.("[data-episode-stream-index]");
      if (episodeStreamNode && this.episodePanelVisible) {
        await this.activateEpisodeStreamFocus();
        return true;
      }

      const episodeSeasonNode = target.closest?.("[data-episode-season-index]");
      if (episodeSeasonNode && this.episodePanelVisible) {
        this.episodePanelFocusZone = "episodes";
        this.renderEpisodePanel();
        return true;
      }

      const episodeNode = target.closest?.("[data-episode-index]");
      if (episodeNode && this.episodePanelVisible) {
        await this.playEpisodeFromPanel();
        return true;
      }

      return false;
    },
    switchPlaybackEngine() {
      const targetEngine =
        typeof PlayerController.getAlternativePlaybackEngine === "function"
          ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
          : null;
      if (!targetEngine || !this.activePlaybackUrl) {
        this.showAspectToast(t("player_engine_switch_unavailable", {}, "No alternate player engine"));
        return;
      }
      this.showAspectToast(t("player_engine_switching_title", {}, "Switching player"));
      void this.playStreamByUrl(this.activePlaybackUrl, {
        preservePlaybackState: true,
        resetSilentAudioState: false,
        forceEngine: targetEngine
      });
    },
    hasBackDismissableOverlay() {
      return Boolean(
        this.postPlaySynopsisVisible ||
        this.postPlayManualDialogVisible ||
        this.stillWatchingPromptVisible ||
        this.seekOverlayVisible ||
        this.seekPreviewSeconds != null ||
        (!this.controlsVisible && this.isNextEpisodeCardVisible()) ||
        this.partyPanelVisible ||
        this.sourcesPanelVisible ||
        this.subtitleTimingDialogVisible ||
        this.subtitleDelayOverlayVisible ||
        this.subtitleDialogVisible ||
        this.audioDialogVisible ||
        this.speedDialogVisible ||
        this.episodePanelVisible ||
        this.moreActionsVisible ||
        this.pauseOverlayVisible ||
        this.pauseOverlayTimer
      );
    },
    consumeBackRequest() {
      if (this.isStartupErrorVisible()) {
        if (this.navigateBackToStreamScreen()) {
          return true;
        }
        Router.back();
        return true;
      }

      const postPlayState = this.getPostPlayState();
      if (postPlayState.isTrailerPlaying) {
        this.postPlayRecommendationController?.onTrailerEnded?.();
        return true;
      }
      if (this.postPlayManualDialogVisible) {
        this.invokePostPlayAction("manualCancel");
        return true;
      }
      if (this.postPlaySynopsisVisible) {
        this.invokePostPlayAction("synopsisClose");
        return true;
      }
      if (postPlayState.isVisible && postPlayState.canReturnToPlayer && !this.postPlayPlaybackEnded) {
        return this.returnToPlayerFromPostPlay();
      }
      if (postPlayState.isVisible || postPlayState.isLoadingRecommendation) {
        this.postPlayNaturalEndPending = false;
        this.postPlayPlaybackEnded = false;
        this.postPlayRecommendationController?.stop?.();
        return this.navigateBackToStreamScreen();
      }

      if (this.stillWatchingPromptVisible) {
        return this.onDismissStillWatchingPrompt();
      }

      if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
        this.cancelSeekPreview({ commit: false });
        return true;
      }

      if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
        this.dismissNextEpisodeCard({ revealControls: true, armExitOnNextBack: true });
        return true;
      }

      if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed) {
        this.skipIntervalDismissed = true;
        this.skipIntroAutoHidden = false;
        this.stopSkipIntroCountdownAnimation();
        this.renderSkipIntroButton();
        return true;
      }

      if (this.partyPanelVisible) {
        this.dismissPartyPanel();
        return true;
      }

      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
        return true;
      }

      if (this.subtitleTimingDialogVisible) {
        this.dismissSubtitleTimingDialog();
        return true;
      }

      if (this.subtitleDelayOverlayVisible) {
        this.hideSubtitleDelayOverlay();
        return true;
      }

      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
        return true;
      }

      if (this.audioDialogVisible) {
        this.closeAudioDialog();
        return true;
      }

      if (this.speedDialogVisible) {
        this.closeSpeedDialog();
        return true;
      }

      if (this.episodePanelVisible) {
        if (this.episodePanelMode === "streams") {
          this.closeEpisodeStreamsView();
        } else {
          this.hideEpisodePanel();
        }
        return true;
      }

      if (this.moreActionsVisible) {
        this.moreActionsVisible = false;
        this.renderControlButtons();
        this.focusFirstControl();
        return true;
      }

      if (this.pauseOverlayVisible || this.pauseOverlayTimer) {
        this.dismissPauseOverlay({ revealControls: false, focus: false });
      }

      if (this.loadingVisible && !this.hasPresentedPlaybackFrame) {
        return this.navigateBackToStreamScreen();
      }

      // Match Android TV: when the on screen controls are showing, Back hides
      // them and keeps the video playing. The player only leaves on a Back press
      // once the controls are already hidden.
      if (this.controlsVisible && !this.nextEpisodeBackExitArmed) {
        this.setControlsVisible(false, { focus: false });
        return true;
      }

      this.nextEpisodeBackExitArmed = false;
      return this.navigateBackToStreamScreen();
    }
  };
}
