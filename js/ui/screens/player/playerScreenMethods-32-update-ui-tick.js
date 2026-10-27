import { syncPlayerPlaybackBadges } from "./playerPlaybackBadges.js";
import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
import { MediaServerScrobbleService } from "../../../data/mediaserver/mediaServerScrobbleService.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods32() {
  const {
    renderPlayerImageBadgeChip,
    getTrackLanguageLabel,
    PlayerController,
    deltaMsForKeyRepeat,
    calculateRemainingPlaybackMilliseconds,
    t,
    formatTime,
    formatClock,
    formatEndsAt,
    clamp
  } = internals;

  return {
    updateUiTick() {
      if (this.playerRouteActive) MediaServerScrobbleService.update(this.buildScrobbleContext());
      if (this.isExternalFrameMode()) {
        return;
      }
      syncPlayerPlaybackBadges(this, PlayerController, renderPlayerImageBadgeChip, getTrackLanguageLabel);
      const isLivePlayback = this.isLivePlayback();
      const watchedMs = this.liveWatchClock.update(
        isLivePlayback,
        PlayerController.isPlaying && !this.paused && !this.isBufferingForPauseOverlay()
      );
      this.uiRefs?.progressShell?.classList.toggle("hidden", isLivePlayback);
      if (isLivePlayback && this.seekPreviewSeconds != null) this.cancelSeekPreview();
      if (isLivePlayback && this.controlFocusZone === "progress") this.focusFirstControl();
      this.ensureNextEpisodeStreamsPrefetch();
      this.shouldShowNextEpisodeCard();
      void this.refreshLoadingOverlayProgress();
      const current = this.getPlaybackCurrentSeconds();
      this.updateActiveSkipInterval(current);
      this.updateSkipIntroCountdown(Date.now());
      const displayCurrent = this.getPlaybackDisplayCurrentSeconds();
      const duration = this.getPlaybackDisplayDurationSeconds();
      this.evaluatePostPlayRecommendation();
      const effectiveProgressSeconds =
        this.controlsVisible && this.controlFocusZone === "progress" && this.seekPreviewSeconds != null
          ? Number(this.seekPreviewSeconds)
          : displayCurrent;
      const progress = duration > 0 ? clamp(effectiveProgressSeconds / duration, 0, 1) : 0;
      const uiRefs = this.uiRefs || {};
      const uiState = this.lastUiTickState || (this.lastUiTickState = {});
      const progressBuffered = uiRefs.progressBuffered;
      if (progressBuffered) {
        const bufferedSeconds = this.getPlaybackBufferedSeconds();
        const bufferedVisible = Number.isFinite(bufferedSeconds) && duration > 0 && bufferedSeconds > current + 0.25;
        const bufferedProgress = bufferedVisible ? clamp(bufferedSeconds / duration, 0, 1) : 0;
        const nextBufferedWidth = `${Math.round(bufferedProgress * 10000) / 100}%`;
        if (uiState.bufferedWidth !== nextBufferedWidth) {
          progressBuffered.style.width = nextBufferedWidth;
          uiState.bufferedWidth = nextBufferedWidth;
        }
        if (uiState.bufferedVisible !== bufferedVisible) {
          progressBuffered.classList.toggle("is-visible", bufferedVisible);
          uiState.bufferedVisible = bufferedVisible;
        }
      }
      const progressFill = uiRefs.progressFill;
      if (progressFill) {
        const nextWidth = `${Math.round(progress * 10000) / 100}%`;
        if (uiState.progressWidth !== nextWidth) {
          progressFill.style.width = nextWidth;
          uiState.progressWidth = nextWidth;
        }
      }
      this.syncSkipIntroButtonProgress();
      this.renderSkipIntroButton();
      this.syncPlayerOverlayLayoutState();
      this.renderBitmapSubtitleAtCurrentTime();
      this.maybeAutoplayNextEpisode();

      const clock = uiRefs.clock;
      if (clock) {
        const now = new Date();
        const nextClockMinuteKey = `${now.getHours()}:${now.getMinutes()}`;
        if (uiState.clockMinuteKey !== nextClockMinuteKey) {
          const nextClockText = formatClock(now, this.webOsClockLocaleInfo);
          clock.textContent = nextClockText;
          uiState.clockText = nextClockText;
          uiState.clockMinuteKey = nextClockMinuteKey;
        }
      }

      const endsAt = uiRefs.endsAt;
      if (endsAt) {
        const playbackSpeed = this.getPlaybackSpeed();
        // Keep this clock based on the full media duration. Outro intervals are
        // handled independently by skip/autoplay, as they are on Android TV.
        const remainingMs = isLivePlayback ? null : calculateRemainingPlaybackMilliseconds(displayCurrent, duration, playbackSpeed);
        const nextEndsAtMinuteBucket = remainingMs == null ? -1 : Math.floor((Date.now() + remainingMs) / 60000);
        endsAt.classList.toggle("hidden", isLivePlayback);
        if (uiState.endsAtMinuteBucket !== nextEndsAtMinuteBucket) {
          const nextEndsAtText = isLivePlayback
            ? ""
            : t("player_ends_at", [formatEndsAt(displayCurrent, duration, this.webOsClockLocaleInfo, playbackSpeed)], "Ends at %1$s");
          endsAt.textContent = nextEndsAtText;
          uiState.endsAtText = nextEndsAtText;
          uiState.endsAtMinuteBucket = nextEndsAtMinuteBucket;
        }
      }

      if (this.pauseOverlayVisible) {
        const overlayClock = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-clock");
        if (overlayClock && overlayClock.textContent !== uiState.clockText) {
          overlayClock.textContent = uiState.clockText || "--:--";
        }
        const overlayEndsAt = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-ends-at");
        if (overlayEndsAt && overlayEndsAt.textContent !== uiState.endsAtText) {
          overlayEndsAt.textContent = uiState.endsAtText || t("player_ends_at", ["--:--"], "Ends at %1$s");
        }
      }

      const timeLabel = uiRefs.timeLabel;
      if (timeLabel) {
        const nextTimeLabel = isLivePlayback
          ? t("player_live_watched", [formatTime(watchedMs / 1000)], "LIVE  %1$s")
          : `${formatTime(effectiveProgressSeconds)} / ${formatTime(duration)}`;
        if (uiState.timeLabelText !== nextTimeLabel) {
          timeLabel.textContent = nextTimeLabel;
          if (!isLivePlayback && uiRefs.progressShell) {
            uiRefs.progressShell.setAttribute("aria-valuemax", String(Math.max(0, duration)));
            uiRefs.progressShell.setAttribute("aria-valuenow", String(clamp(effectiveProgressSeconds, 0, Math.max(0, duration))));
            uiRefs.progressShell.setAttribute("aria-valuetext", nextTimeLabel);
          }
          uiState.timeLabelText = nextTimeLabel;
        }
      }

      this.syncPauseOverlayState();
      this.renderNextEpisodeCard();
      syncHtmlSubtitleClearance(this);

      if (this.seekOverlayVisible && this.seekPreviewSeconds == null) {
        this.renderSeekOverlay();
      }
    },
    renderSeekOverlay() {
      const overlay = this.uiRefs?.seekOverlay;
      const directionNode = this.uiRefs?.seekDirection;
      const previewNode = this.uiRefs?.seekPreview;
      const fillNode = this.uiRefs?.seekFill;
      if (!overlay || !directionNode || !previewNode || !fillNode) {
        return;
      }

      const duration = this.getPlaybackDisplayDurationSeconds();
      const currentPreview = this.seekPreviewSeconds != null ? Number(this.seekPreviewSeconds) : this.getPlaybackDisplayCurrentSeconds();

      const shouldShowOverlay = this.seekOverlayVisible && !this.controlsVisible && !this.isLivePlayback();
      overlay.classList.toggle("hidden", !shouldShowOverlay);
      const uiState = this.lastUiTickState || (this.lastUiTickState = {});
      const nextPreviewText = `${formatTime(currentPreview)} / ${formatTime(duration)}`;
      const nextDirectionText = this.seekPreviewDirection < 0 ? "<<" : this.seekPreviewDirection > 0 ? ">>" : "";
      if (uiState.seekPreviewText !== nextPreviewText) {
        previewNode.textContent = nextPreviewText;
        uiState.seekPreviewText = nextPreviewText;
      }
      if (uiState.seekDirectionText !== nextDirectionText) {
        directionNode.textContent = nextDirectionText;
        uiState.seekDirectionText = nextDirectionText;
      }

      syncHtmlSubtitleClearance(this);
      const percent = duration > 0 ? clamp(currentPreview / duration, 0, 1) : 0;
      const nextSeekWidth = `${Math.round(percent * 10000) / 100}%`;
      if (uiState.seekWidth !== nextSeekWidth) {
        fillNode.style.width = nextSeekWidth;
        uiState.seekWidth = nextSeekWidth;
      }
    },
    beginSeekPreview(direction, isRepeat = false, commitOnRelease = false) {
      if (!this.isSeekBarAvailable()) {
        return;
      }
      const currentTime = this.getPlaybackCurrentSeconds();
      if (Number.isNaN(currentTime)) {
        return;
      }

      if (direction !== this.seekPreviewDirection || !isRepeat) {
        this.seekRepeatCount = 0;
      }
      this.seekPreviewDirection = direction;
      this.seekRepeatCount += 1;

      const deltaSeconds = deltaMsForKeyRepeat(this.seekRepeatCount - 1, direction > 0) / 1000;
      const duration = this.getPlaybackDurationSeconds();
      const base = this.seekPreviewSeconds == null ? currentTime : Number(this.seekPreviewSeconds);
      let next = base + deltaSeconds;
      if (duration > 0) {
        next = clamp(next, 0, duration);
      } else {
        next = Math.max(0, next);
      }

      this.seekPreviewSeconds = next;
      this.seekOverlayVisible = !this.controlsVisible;
      this.renderSeekOverlay();

      if (this.seekOverlayTimer) {
        clearTimeout(this.seekOverlayTimer);
        this.seekOverlayTimer = null;
      }

      if (commitOnRelease) {
        clearTimeout(this.seekCommitTimer);
        this.seekCommitTimer = null;
      } else {
        this.scheduleSeekPreviewCommit();
      }
    },
    scheduleSeekPreviewCommit() {
      if (this.seekCommitTimer) {
        clearTimeout(this.seekCommitTimer);
      }
      this.seekCommitTimer = setTimeout(() => {
        this.commitSeekPreview();
      }, 1000);
    },
    commitSeekPreview() {
      if (this.isLivePlayback()) {
        this.cancelSeekPreview();
        return;
      }
      if (!PlayerController.video) {
        this.cancelSeekPreview({ commit: false });
        return;
      }

      // AVPlay cannot accept a second seek until the previous one settles.
      // Keep the preview target instead of dropping a released-key command.
      if (this.seekPreviewSeconds != null && PlayerController.avplaySeekInFlight) {
        clearTimeout(this.seekCommitTimer);
        this.seekCommitTimer = setTimeout(() => this.commitSeekPreview(), 100);
        return;
      }

      if (this.seekPreviewSeconds != null) {
        const requestedMs = Math.round(Number(this.seekPreviewSeconds) * 1000);
        const targetMs = this.partyUserSeekTarget ? this.partyUserSeekTarget(requestedMs) : requestedMs;
        if (targetMs != null) {
          this.suppressControlsForHiddenSeek();
          this.seekPlaybackSeconds(targetMs / 1000);
          this.publishPartyPlayback?.({ positionMs: targetMs });
        }
      }

      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
        this.scheduleProgressBarRefocus();
      }

      this.seekPreviewSeconds = null;
      this.seekRepeatCount = 0;
      if (this.seekCommitTimer) {
        clearTimeout(this.seekCommitTimer);
        this.seekCommitTimer = null;
      }

      this.seekOverlayVisible = !this.controlsVisible;
      this.renderSeekOverlay();

      if (this.seekOverlayTimer) {
        clearTimeout(this.seekOverlayTimer);
      }
      this.seekOverlayTimer = setTimeout(() => {
        this.seekOverlayVisible = false;
        this.seekPreviewDirection = 0;
        this.renderSeekOverlay();
        if (this.autoHideControlsAfterSeek && this.controlsVisible) {
          this.autoHideControlsAfterSeek = false;
          this.stickyProgressFocus = false;
          this.setControlsVisible(false);
          return;
        }
        if (this.stickyProgressFocus && this.controlsVisible) {
          this.focusProgressBar();
          this.scheduleProgressBarRefocus();
        }
        this.resetControlsAutoHide();
      }, 700);
    },
    cancelSeekPreview({ commit = false } = {}) {
      if (commit) {
        this.commitSeekPreview();
        return;
      }

      if (this.seekCommitTimer) {
        clearTimeout(this.seekCommitTimer);
        this.seekCommitTimer = null;
      }
      if (this.seekOverlayTimer) {
        clearTimeout(this.seekOverlayTimer);
        this.seekOverlayTimer = null;
      }

      this.seekPreviewSeconds = null;
      this.seekPreviewDirection = 0;
      this.seekRepeatCount = 0;
      this.seekOverlayVisible = false;
      this.autoHideControlsAfterSeek = false;
      this.seekOverlaySuppressControlsUntil = 0;
      this.renderSeekOverlay();
    },
    togglePause({ focusControls = true } = {}) {
      const preserveProgressFocus = this.controlFocusZone === "progress";
      if (this.isExternalFrameMode()) {
        return;
      }
      if (this.isPartyControlLocked?.()) {
        this.toggleOwnPlayback();
        this.renderControlButtons();
        return;
      }
      const wasPaused = this.getPlaybackControlPaused();
      this.togglePauseLocally({ focusControls, preserveProgressFocus });
      this.publishPartyPlayback?.({ paused: !wasPaused });
    },
    togglePauseLocally({ focusControls = true, preserveProgressFocus = false } = {}) {
      if (this.getPlaybackControlPaused()) {
        this.dismissPauseOverlay();
        PlayerController.resume();
        this.paused = false;
        this.updateMediaSessionPlaybackState();
        this.setControlsVisible(true, { focus: false });
        if (preserveProgressFocus) {
          this.controlFocusZone = "progress";
        }
        this.renderControlButtons();
        return;
      }

      PlayerController.pause();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      if (!focusControls && !preserveProgressFocus) {
        this.controlFocusZone = "";
      }
      this.setControlsVisible(true, { focus: focusControls && !preserveProgressFocus });
      if (preserveProgressFocus) {
        this.controlFocusZone = "progress";
      }
      this.renderControlButtons();
      this.schedulePauseOverlay();
    }
  };
}
