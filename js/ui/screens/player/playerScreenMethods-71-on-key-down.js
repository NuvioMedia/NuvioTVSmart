import { isStreamInfoKey } from "./streamInfoOverlay.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods71() {
  const { Router, isBackEvent, isSelectKeyCode } = internals;

  return {
    async onKeyDown(event) {
      const keyCode = Number(event?.keyCode || 0);
      const isBackKey = isBackEvent(event);
      if (this.isStartupErrorVisible()) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (isBackKey || isSelectKeyCode(keyCode) || keyCode === 66) {
          if (!this.navigateBackToStreamScreen()) {
            Router.back();
          }
        }
        return;
      }
      if (this.streamInfoVisible) {
        event?.preventDefault?.();
        event?.stopImmediatePropagation?.();
        if (!event?.repeat && (isBackKey || isStreamInfoKey(event) || isSelectKeyCode(keyCode))) this.closeStreamInfo();
        else if (keyCode === 38 || keyCode === 40) this.streamInfoOverlay.scrollTop += keyCode === 40 ? 100 : -100;
        return;
      }
      if (isStreamInfoKey(event) && !event?.repeat) {
        event?.preventDefault?.();
        event?.stopImmediatePropagation?.();
        this.showStreamInfo();
        return;
      }
      if (isBackKey) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        this.consumeBackRequest();
        return;
      }
      if (this.isPostPlayVisible()) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        if (isSelectKeyCode(keyCode) && !this.postPlayManualDialogVisible && !this.postPlaySynopsisVisible) {
          if (!event?.repeat) {
            this.postPlayPendingSelect = true;
            this.postPlayPendingSelectAction = this.postPlayFocusedAction || "primary";
            if (this.postPlayPendingSelectAction === "primary") {
              this.schedulePostPlayLongPress();
            }
          } else {
            // Android's LongPressKeyTracker opens the manual-play dialog on the
            // first repeated key-down, before the remote sends key-up.
            this.triggerPostPlayLongPress();
          }
          return;
        }
        this.handlePostPlayKey(event);
        return;
      }
      if (this.partyPanelVisible && this.handlePartyPanelKey(event)) {
        return;
      }
      if (this.nextEpisodeBackExitArmed) {
        this.nextEpisodeBackExitArmed = false;
      }
      if (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || isSelectKeyCode(keyCode)) {
        event?.preventDefault?.();
      }
      const mediaAction = this.resolveMediaAction(event);
      if (this.pauseOverlayVisible) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        if (this.stillWatchingPromptVisible) {
          if (keyCode === 37 || keyCode === 39) {
            this.stillWatchingPromptFocus = this.stillWatchingPromptFocus === "continue" ? "exit" : "continue";
            this.renderPauseOverlay();
            return;
          }
          if (mediaAction === "play" || mediaAction === "toggle" || isSelectKeyCode(keyCode)) {
            if (this.stillWatchingPromptFocus === "exit") {
              this.onDismissStillWatchingPrompt();
            } else {
              await this.onStillWatchingContinue();
            }
            return;
          }
          return;
        }
        if (mediaAction === "play" || mediaAction === "toggle" || isSelectKeyCode(keyCode)) {
          this.dismissPauseOverlay();
          this.togglePause();
          this.renderControlButtons();
          return;
        }
        this.dismissPauseOverlay({ revealControls: true, focus: false });
        if (this.paused) {
          this.schedulePauseOverlay();
        }
        return;
      }
      if (this.paused) {
        this.schedulePauseOverlay();
      }

      if (this.episodePanelVisible && this.handleEpisodePanelKey(event)) {
        return;
      }

      if (mediaAction) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        this.applyMediaAction(mediaAction, event);
        return;
      }

      if (this.sourcesPanelVisible) {
        if (await this.handleSourcesPanelKey(event)) {
          return;
        }
      }

      if (this.subtitleTimingDialogVisible) {
        if (this.handleSubtitleTimingDialogKey(event)) {
          return;
        }
      }

      if (this.subtitleDelayOverlayVisible) {
        if (this.handleSubtitleDelayOverlayKey(event)) {
          return;
        }
      }

      if (this.subtitleDialogVisible) {
        if (this.handleSubtitleDialogKey(event)) {
          return;
        }
      }

      if (this.audioDialogVisible) {
        if (this.handleAudioDialogKey(event)) {
          return;
        }
      }

      if (this.speedDialogVisible) {
        if (this.handleSpeedDialogKey(event)) {
          return;
        }
      }

      if (keyCode === 83) {
        if (this.subtitleDialogVisible) {
          this.closeSubtitleDialog();
        } else {
          this.openSubtitleDialog();
        }
        return;
      }

      if (keyCode === 84) {
        if (this.audioDialogVisible) {
          this.closeAudioDialog();
        } else {
          this.openAudioDialog();
        }
        return;
      }

      if (keyCode === 67) {
        if (this.sourcesPanelVisible) {
          this.closeSourcesPanel();
        } else {
          this.openSourcesPanel();
        }
        return;
      }

      if (keyCode === 69) {
        this.toggleEpisodePanel();
        return;
      }

      if (keyCode === 80) {
        this.togglePause();
        this.renderControlButtons();
        return;
      }

      const skipOverlayFocusable = this.isSkipIntroButtonFocusable();
      const nextOverlayFocusable = this.isNextEpisodeCardFocusable();
      const activeElement = document.activeElement;
      const skipOverlayFocused =
        this.controlFocusZone === "skipIntro" || Boolean(activeElement?.closest?.("[data-player-pointer-action='skipIntro']"));
      const nextOverlayFocused =
        this.controlFocusZone === "nextEpisode" ||
        Boolean(activeElement?.closest?.("[data-player-pointer-action='nextEpisode']")) ||
        (!this.controlsVisible && nextOverlayFocusable && !skipOverlayFocused);
      const overlayButtonsCoexist = skipOverlayFocusable && nextOverlayFocusable;
      if (overlayButtonsCoexist && (keyCode === 37 || keyCode === 39)) {
        if (keyCode === 39 && skipOverlayFocused && this.focusNextEpisodeCard()) {
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          return;
        }
        if (keyCode === 37 && nextOverlayFocused && this.focusSkipIntroButton()) {
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          return;
        }
        if (skipOverlayFocused || nextOverlayFocused) {
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          this.resetControlsAutoHide();
          return;
        }
      }
      if (skipOverlayFocused && skipOverlayFocusable && isSelectKeyCode(keyCode)) {
        if (
          this.activeSkipInterval &&
          !this.skipIntervalDismissed &&
          (!this.skipIntroAutoHidden || this.controlsVisible) &&
          this.skipActiveInterval()
        ) {
          return;
        }
        // A stale rendered target must not leak Select to the next card or the
        // generic player handler while its action state is being reconciled.
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        return;
      }
      if (nextOverlayFocused && nextOverlayFocusable && isSelectKeyCode(keyCode)) {
        await this.playNextEpisode({ userInitiated: true });
        return;
      }

      if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed && !this.skipIntroAutoHidden) {
        if (isSelectKeyCode(keyCode)) {
          if (this.skipActiveInterval()) {
            return;
          }
        }
      }

      if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
        if (isSelectKeyCode(keyCode)) {
          await this.playNextEpisode({ userInitiated: true });
          return;
        }
        if (keyCode === 38 || keyCode === 40) {
          this.setControlsVisible(true, { focus: true });
          return;
        }
      }

      if (!this.controlsVisible) {
        if (keyCode === 37) {
          this.autoHideControlsAfterSeek = false;
          this.beginSeekPreview(-1, Boolean(event?.repeat), true);
          return;
        }
        if (keyCode === 39) {
          this.autoHideControlsAfterSeek = false;
          this.beginSeekPreview(1, Boolean(event?.repeat), true);
          return;
        }
        if (keyCode === 38) {
          this.autoHideControlsAfterSeek = false;
          this.setControlsVisible(true, { focus: true });
          return;
        }
        if (keyCode === 40) {
          this.autoHideControlsAfterSeek = false;
          this.setControlsVisible(true, { focus: true });
          return;
        }
        if (isSelectKeyCode(keyCode)) {
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          this.autoHideControlsAfterSeek = false;
          if (this.seekPreviewSeconds != null) {
            this.cancelSeekPreview({ commit: true });
          } else if (this.seekOverlayVisible) {
            this.cancelSeekPreview({ commit: false });
          }
          this.togglePause({ focusControls: true });
          this.renderControlButtons();
        }
        return;
      }

      if (this.controlFocusZone === "skipIntro") {
        if (isSelectKeyCode(keyCode)) {
          if (this.skipActiveInterval()) {
            return;
          }
        }
        if (keyCode === 40) {
          this.focusProgressBar();
          return;
        }
        if (keyCode === 38 || keyCode === 37 || keyCode === 39) {
          this.resetControlsAutoHide();
          return;
        }
      }

      if (this.controlFocusZone === "progress") {
        if (keyCode === 37) {
          this.beginSeekPreview(-1, Boolean(event?.repeat), true);
          return;
        }
        if (keyCode === 39) {
          this.beginSeekPreview(1, Boolean(event?.repeat), true);
          return;
        }
        if (keyCode === 38) {
          this.stickyProgressFocus = false;
          this.autoHideControlsAfterSeek = false;
          if (this.focusSkipIntroButton()) {
            return;
          }
          this.setControlsVisible(false);
          return;
        }
        if (keyCode === 40) {
          this.stickyProgressFocus = false;
          this.autoHideControlsAfterSeek = false;
          this.controlFocusZone = "buttons";
          this.syncControlFocusDom();
          return;
        }
        if (isSelectKeyCode(keyCode)) {
          this.autoHideControlsAfterSeek = false;
          this.togglePause();
          this.focusProgressBar();
          this.renderControlButtons();
          return;
        }
      }

      if (keyCode === 37) {
        this.moveControlFocus(-1);
        return;
      }
      if (keyCode === 39) {
        this.moveControlFocus(1);
        return;
      }
      if (keyCode === 38) {
        if (this.isLivePlayback()) {
          if (!this.focusSkipIntroButton()) this.setControlsVisible(false);
        } else {
          this.focusProgressBar();
        }
        return;
      }
      if (keyCode === 40) {
        this.setControlsVisible(false);
        return;
      }
      if (isSelectKeyCode(keyCode)) {
        this.performFocusedControl();
        return;
      }

      this.resetControlsAutoHide();
    }
  };
}
