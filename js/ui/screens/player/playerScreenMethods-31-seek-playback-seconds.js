import { syncHtmlSubtitleClearance } from "./subtitleOverlayClearance.js";
/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods31() {
  const { PlayerController, PlayerSettingsStore, t, escapeHtml, formatNextEpisodeAirDate } = internals;

  return {
    seekPlaybackSeconds(seconds, { preserveSkipIntroSuppression = false } = {}) {
      if (this.isLivePlayback()) return false;
      const currentSeconds = Number(this.getPlaybackCurrentSeconds());
      const targetSeconds = Number(seconds);
      if (Number.isFinite(currentSeconds) && Number.isFinite(targetSeconds) && targetSeconds < currentSeconds - 0.5) {
        this.resetNextEpisodeCardAfterBackwardSeek(targetSeconds);
      }
      if (!preserveSkipIntroSuppression) {
        this.clearSkipIntroSeekSuppression();
      }
      // Mark user-initiated seeks so the player can stay responsive while it settles.
      this.seekLoadingBaselineSeconds = this.getPlaybackCurrentSeconds();
      this.seekLoadingTargetSeconds = Number(seconds || 0);
      this.seekLoadingSettled = false;
      this.seekLoadingVisualComplete = false;
      this.seekLoadingProgressSeconds = null;
      this.seekLoadingProgressAt = 0;
      this.seekLoadingStartedAt = Date.now();
      this.seekLoading = true;
      this.updateLoadingVisibility();
      this.prepareBitmapSubtitleForSeek(this.seekLoadingTargetSeconds);
      this.prepareWebOsEmbeddedTextSubtitleForSeek(this.seekLoadingTargetSeconds);
      if (typeof PlayerController.seekToSeconds === "function") {
        const didSeek = Boolean(
          PlayerController.seekToSeconds(seconds, {
            exact: Boolean(this.isPartySynced?.()),
            paused: this.getPlaybackControlPaused?.() ?? Boolean(this.paused)
          })
        );
        if (!didSeek) {
          this.clearSeekLoading();
        } else {
          this.startSeekLoadingWatchdog();
        }
        return didSeek;
      }
      const video = PlayerController.video;
      if (!video) {
        this.clearSeekLoading();
        return false;
      }
      video.currentTime = Number(seconds || 0);
      return true;
    },
    finalizePendingPlaybackRestore(restore = this.pendingPlaybackRestore) {
      if (!restore || this.pendingPlaybackRestore !== restore) {
        return;
      }
      this.pendingPlaybackRestore = null;
      const currentSeconds = this.getPlaybackCurrentSeconds();
      this.startupPlaybackBaselineSeconds = Number.isFinite(currentSeconds) ? currentSeconds : null;
      this.startupPlaybackHasAdvanced = false;
      if (restore.paused) {
        PlayerController.pause();
        this.paused = true;
        return;
      }
      this.paused = false;
    },
    attemptPendingPlaybackRestore({ force = false } = {}) {
      const restore = this.pendingPlaybackRestore;
      if (!restore) {
        return;
      }

      const durationSeconds = this.getPlaybackDurationSeconds();
      let requestedSeconds = Number(restore.timeSeconds || 0);
      if ((!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) && Number(restore.progressPercent || 0) > 0) {
        const seededDuration = Number(restore.durationSeconds || 0);
        const effectiveDuration =
          Number.isFinite(durationSeconds) && durationSeconds > 0
            ? durationSeconds
            : Number.isFinite(seededDuration) && seededDuration > 0
              ? seededDuration
              : 0;
        if (effectiveDuration > 0) {
          requestedSeconds = (effectiveDuration * Math.max(0, Math.min(100, Number(restore.progressPercent || 0)))) / 100;
          restore.timeSeconds = requestedSeconds;
        }
      }
      if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) {
        restore.attempts = Number(restore.attempts || 0) + 1;
        if (restore.attempts >= 8) {
          this.finalizePendingPlaybackRestore(restore);
        }
        return;
      }

      const targetSeconds =
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.max(0, Math.min(requestedSeconds, Math.max(0, durationSeconds - 3)))
          : requestedSeconds;
      const currentSeconds = this.getPlaybackCurrentSeconds();
      const toleranceSeconds = Math.max(1.5, Math.min(8, targetSeconds * 0.03));

      if (Number.isFinite(currentSeconds) && currentSeconds >= Math.max(0, targetSeconds - toleranceSeconds)) {
        this.finalizePendingPlaybackRestore(restore);
        return;
      }

      const now = Date.now();
      if (!force && now - Number(restore.lastAttemptAt || 0) < 700) {
        return;
      }

      restore.timeSeconds = targetSeconds;
      restore.lastAttemptAt = now;
      restore.attempts = Number(restore.attempts || 0) + 1;

      const didSeek = this.seekPlaybackSeconds(targetSeconds);
      if (!didSeek && restore.attempts >= 8) {
        this.finalizePendingPlaybackRestore(restore);
      }
    },
    updateLoadingVisibility() {
      if (this.isBufferingForPauseOverlay()) this.dismissPauseOverlay();
      if (!this.loadingVisible && !this.isStartupErrorVisible() && !this.isExternalFrameMode()) {
        if (this.isStartupGateReleaseReady()) this.releaseStartupAudioGate();
        // Post-first-frame buffering can hide loading before the completion timer runs.
        if (PlayerController.startupPresentationAudioMuted && this.isStartupLogoDismissReady()) {
          PlayerController.setStartupPresentationAudioMuted(false);
        }
      }
      const overlay = this.uiRefs?.loadingOverlay;
      const bufferingSpinner = this.uiRefs?.bufferingSpinner;
      if (!overlay) {
        if (!this.loadingVisible) {
          if (this.isStartupGateReleaseReady()) {
            this.releaseStartupAudioGate();
          }
          this.clearBufferingSpinnerTimer();
        }
        this.renderSkipIntroButton();
        return;
      }
      if (this.isStartupErrorVisible()) {
        overlay.classList.add("hidden");
        bufferingSpinner?.classList.add("hidden");
        this.clearBufferingSpinnerTimer();
        this.renderSkipIntroButton();
        return;
      }
      const showStartupOverlay = this.isStartupLoadingVisible() && PlayerSettingsStore.get().loadingOverlayEnabled !== false;
      const showBufferingSpinner = this.isBufferingSpinnerVisible();
      const preserveProgressFocus = Boolean(
        showStartupOverlay &&
        this.controlsVisible &&
        this.stickyProgressFocus &&
        this.controlFocusZone === "progress" &&
        this.hasPresentedPlaybackFrame
      );
      const preserveHiddenSeekOverlay = Boolean(showStartupOverlay && !this.controlsVisible && this.isSeekOverlaySuppressingControls());
      overlay.classList.toggle("hidden", !showStartupOverlay);
      overlay.classList.remove("seek-only", "logo-only");
      bufferingSpinner?.classList.toggle("hidden", !showBufferingSpinner);
      if (!showStartupOverlay && this.loadingProgress != null) {
        this.loadingProgress = 1;
        this.setLoadingLogoFillTarget(1);
      }
      if (!showStartupOverlay && this.loadingTorrentStatus) {
        this.loadingTorrentStatus = "";
        this.syncLoadingOverlayStatus();
      }
      if (!this.loadingVisible && !this.seekLoading && !this.bufferingActive) {
        this.clearBufferingSpinnerTimer();
      }
      if (showStartupOverlay) {
        this.dismissPauseOverlay();
        if (!preserveProgressFocus && !preserveHiddenSeekOverlay && (this.seekOverlayVisible || this.seekPreviewSeconds != null)) {
          this.cancelSeekPreview({ commit: false });
        }
        if (!preserveProgressFocus && this.controlFocusZone === "progress") {
          this.stickyProgressFocus = false;
          this.autoHideControlsAfterSeek = false;
          this.controlFocusZone = "buttons";
        }
        this.renderControlButtons();
        if (preserveProgressFocus) {
          this.scheduleProgressBarRefocus();
        }
        if (preserveHiddenSeekOverlay) {
          this.renderSeekOverlay();
        }
      } else if (!showBufferingSpinner) {
        if (!this.loadingVisible && !this.bufferingActive) {
          this.clearBufferingSpinnerTimer();
        }
        if (this.isStartupGateReleaseReady()) {
          this.releaseStartupAudioGate();
        }
        // The stall guard and a resume seek can hide the startup overlay without
        // presentStartedPlayback(); lift its presentation mute there as well, or
        // playback continues silently.
        if (!this.loadingVisible && this.hasPresentedPlaybackFrame && !this.startupAudioGateActive) {
          PlayerController.setStartupPresentationAudioMuted?.(false);
        }
        if (this.paused) {
          this.schedulePauseOverlay();
        }
      }
      // Keep the Skip overlay in sync with loading/buffering transitions before
      // the D-pad focus graph is evaluated. Android removes the composable from
      // the focus graph as soon as it is no longer actually visible.
      this.renderSkipIntroButton();
      this.renderNextEpisodeCard();
    },
    renderNextEpisodeCard() {
      const card = this.uiRefs?.nextEpisodeCard;
      if (!card) {
        return;
      }

      this.ensureNextEpisodeStreamsPrefetch();
      const nextEpisode = this.resolveNextEpisodeInfo();
      const hidden = !this.isNextEpisodeCardVisible();

      card.classList.toggle("hidden", hidden);
      if (hidden) syncHtmlSubtitleClearance(this);
      if (hidden) {
        card.innerHTML = "";
        this.nextEpisodeCardRenderedKey = "";
        if (this.controlFocusZone === "nextEpisode") {
          this.controlFocusZone = this.controlsVisible && this.isSeekBarAvailable() ? "progress" : "buttons";
        }
        return;
      }

      // Android keeps the next-episode action as the default hidden-controls
      // focus target. Reconcile that state from the live focus zone on every
      // render so an older webOS DOM/focus transition cannot leave the card
      // visually selected while the player root still owns navigation.
      if (!this.controlsVisible && this.controlFocusZone !== "skipIntro" && this.controlFocusZone !== "nextEpisode") {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "nextEpisode";
        this.resetControlsAutoHide();
      }

      const titleLine = [nextEpisode.episodeLabel, nextEpisode.episodeTitle].filter(Boolean).join(" • ");
      const statusText = nextEpisode.hasAired ? t("next_episode_play", {}, "Play") : t("next_episode_unaired", {}, "Unaired");
      const airDateText = nextEpisode.hasAired ? "" : formatNextEpisodeAirDate(nextEpisode.released);
      const progressText = this.nextEpisodeCardSearching
        ? t("next_episode_finding_source", {}, "Finding source…")
        : this.nextEpisodeCardSourceName && this.nextEpisodeCardCountdownSec != null
          ? t(
              "next_episode_playing_via",
              [this.nextEpisodeCardSourceName, this.nextEpisodeCardCountdownSec],
              `Playing via ${this.nextEpisodeCardSourceName} in ${this.nextEpisodeCardCountdownSec}s`
            )
          : airDateText;
      const thumb = this.episodes.find((entry) => String(entry?.id || "") === String(nextEpisode.videoId || ""))?.thumbnail || "";

      const renderKey = JSON.stringify([
        nextEpisode.videoId,
        titleLine,
        statusText,
        progressText,
        thumb,
        Boolean(nextEpisode.hasAired),
        Boolean(this.controlsVisible)
      ]);
      if (this.nextEpisodeCardRenderedKey !== renderKey || !card.querySelector(".player-next-episode-card-inner")) {
        card.innerHTML = `
            <div class="player-next-episode-card-inner focusable${nextEpisode.hasAired ? " is-playable" : ""}${!this.controlsVisible && this.controlFocusZone === "nextEpisode" ? " is-selected" : ""}" tabindex="-1" role="button" data-player-pointer-action="nextEpisode">
              <div class="player-next-episode-thumb-wrap">
                ${thumb ? `<img class="player-next-episode-thumb" src="${escapeHtml(thumb)}" alt="" aria-hidden="true" />` : `<div class="player-next-episode-thumb player-next-episode-thumb-fallback"></div>`}
                <div class="player-next-episode-thumb-shade"></div>
              </div>
              <div class="player-next-episode-copy">
                <div class="player-next-episode-kicker">${escapeHtml(t("next_episode_label", {}, "Next episode"))}</div>
                <div class="player-next-episode-title">${escapeHtml(titleLine || t("next_episode_label", {}, "Next episode"))}</div>
                ${progressText ? `<div class="player-next-episode-status">${escapeHtml(progressText)}</div>` : ""}
              </div>
              <div class="player-next-episode-pill${nextEpisode.hasAired ? " is-playable" : ""}">
                <span class="player-next-episode-pill-icon">&#9654;</span>
                <span class="player-next-episode-pill-text">${escapeHtml(statusText)}</span>
              </div>
            </div>
          `;
        this.nextEpisodeCardRenderedKey = renderKey;
      }
      this.syncNextEpisodeCardFocusState();
      syncHtmlSubtitleClearance(this);
    }
  };
}
