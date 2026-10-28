/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods30() {
  const {
    PlayerController,
    TrackingScrobbleService,
    canReleasePlayingNativeStartupAudioGate,
    Environment,
    STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS,
    BUFFERING_SPINNER_STALL_MS,
    PLAYER_SPEEDS
  } = internals;
  // Seek watchdog for Tizen AVPlay: re-checks a pending seek on a fixed cadence,
  // retries the native seek once if playback has not resumed, and always gives
  // the controls back instead of leaving the spinner up indefinitely.
  const SEEK_LOADING_WATCHDOG_INTERVAL_MS = 4000;
  const SEEK_LOADING_WATCHDOG_RETRY_AFTER_MS = 12000;
  const SEEK_LOADING_WATCHDOG_GIVE_UP_MS = 40000;

  return {
    scheduleBufferingSpinnerRefresh(delayMs = BUFFERING_SPINNER_STALL_MS) {
      this.clearBufferingSpinnerTimer();
      if (
        (!this.loadingVisible && !this.bufferingActive) ||
        !this.hasPresentedPlaybackFrame ||
        this.isExternalFrameMode() ||
        this.isStartupErrorVisible()
      ) {
        return;
      }
      this.bufferingSpinnerTimer = setTimeout(
        () => {
          this.bufferingSpinnerTimer = null;
          if (
            (!this.loadingVisible && !this.bufferingActive) ||
            !this.hasPresentedPlaybackFrame ||
            this.isExternalFrameMode() ||
            this.isStartupErrorVisible()
          ) {
            return;
          }
          this.updateLoadingVisibility();
        },
        Math.max(0, Number(delayMs || 0))
      );
    },
    enableStartupAudioGate({ allowNativePlayback = false, maxWaitMs = 0 } = {}) {
      this.startupAudioGateActive = true;
      this.startupAudioGateAllowsNativePlayback = Boolean(allowNativePlayback);
      const boundedWaitMs = Math.max(0, Number(maxWaitMs || 0));
      this.startupAudioGateDeadline = boundedWaitMs > 0 ? Date.now() + boundedWaitMs : 0;
      PlayerController.setStartupAudioGate?.(true, {
        pauseNativePlayback: !allowNativePlayback
      });
    },
    releaseStartupAudioGate({ resume = true } = {}) {
      if (!this.startupAudioGateActive) {
        return;
      }
      this.startupAudioGateActive = false;
      this.startupAudioGateAllowsNativePlayback = false;
      this.startupAudioGateDeadline = 0;
      // Once playback leaves the startup gate, later webOS track-list churn must
      // not reopen automatic language matching. A Luna selectTrack request during
      // normal playback can interrupt the native decoder on some LG TVs.
      this.startupAudioFallbackApplied = false;
      this.startupAudioTrackSetSignature = "";
      PlayerController.setStartupAudioGate?.(false, { resume });
    },
    isPlaybackStartupSettled() {
      if (!this.hasPresentedPlaybackFrame || this.pendingPlaybackRestore || this.startupAudioGateActive) {
        return false;
      }
      return true;
    },
    hasStartupPlaybackAdvanced(currentSeconds = this.getPlaybackCurrentSeconds()) {
      if (this.startupPlaybackHasAdvanced) {
        return true;
      }
      if (this.pendingPlaybackRestore) {
        this.startupPlaybackBaselineSeconds = null;
        return false;
      }
      const current = Number(currentSeconds);
      if (!Number.isFinite(current) || current < 0) {
        return false;
      }
      const baseline = Number(this.startupPlaybackBaselineSeconds);
      if (!Number.isFinite(baseline)) {
        this.startupPlaybackBaselineSeconds = current;
        return false;
      }
      if (current < baseline - 0.25) {
        this.startupPlaybackBaselineSeconds = current;
        return false;
      }
      if (current - baseline >= STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS) {
        this.startupPlaybackHasAdvanced = true;
        return true;
      }
      return false;
    },
    markPlaybackPresentedAfterAdvance(currentSeconds = this.getPlaybackCurrentSeconds()) {
      if (this.hasPresentedPlaybackFrame) {
        return true;
      }
      if (!this.hasStartupPlaybackAdvanced(currentSeconds)) {
        return false;
      }
      this.hasPresentedPlaybackFrame = true;
      // engineFs defers the playing handler until its first verified frame.
      if (this.currentEngineFsStream && TrackingScrobbleService.isEnabled()) TrackingScrobbleService.start(this.buildScrobbleContext());
      this.beginPlaybackEngineValidation();
      this.warmBitmapSubtitleSharedResources();
      if (!this.startupTrackPreferenceReady) {
        // Some P2P / engineFs startups expose tracks before the first real frame
        // is presented. Re-run the startup track pass once playback is actually live.
        this.startupTrackPreferenceReady = true;
        this.refreshTrackDialogs();
      }
      this.setLoadingLogoFillTarget(1, { immediate: true });
      if (this.isStartupGateReleaseReady()) {
        this.releaseStartupAudioGate();
      }
      this.clearPlaybackStallGuard();
      return true;
    },
    isStartupLogoDismissReady() {
      return Boolean(
        this.hasPresentedPlaybackFrame && this.startupPlaybackHasAdvanced && !this.pendingPlaybackRestore && !this.startupAudioGateActive
      );
    },
    presentStartedPlayback() {
      const overlay = this.uiRefs?.loadingOverlay;
      overlay?.classList.add("playback-ready");
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      PlayerController.setStartupPresentationAudioMuted?.(false);
      setTimeout(() => overlay?.classList.remove("playback-ready"), 250);
      this.updateUiTick();
      setTimeout(() => this.maybeShowParentalGuideOverlay(), 80);
    },
    isStartupGateReleaseReady() {
      if (!this.startupAudioGateActive) {
        return false;
      }
      const readyState =
        typeof PlayerController.getPlaybackReadyState === "function"
          ? Number(PlayerController.getPlaybackReadyState() || 0)
          : Number(PlayerController.video?.readyState || 0);
      const gateDeadlineExpired =
        Number(this.startupAudioGateDeadline || 0) > 0 && Date.now() >= Number(this.startupAudioGateDeadline || 0);
      if (
        canReleasePlayingNativeStartupAudioGate({
          allowNativePlayback: this.startupAudioGateAllowsNativePlayback,
          hasPresentedPlaybackFrame: this.hasPresentedPlaybackFrame,
          pendingAudioSelection: Boolean(this.pendingWebOsAudioSelection),
          readyState
        })
      ) {
        if (!this.startupAudioPreferenceApplied) {
          // A native frame can arrive before webOS publishes audio languages.
          // Keep the bounded startup match alive until discovery settles or the
          // gate deadline expires; fallback would otherwise latch the default.
          if (
            Environment.isWebOS() &&
            Number(this.startupAudioGateDeadline || 0) > 0 &&
            !gateDeadlineExpired &&
            this.isAudioPreferenceDiscoveryPending()
          ) {
            return false;
          }
          this.applyStartupAudioFallback();
        }
        return Boolean(this.startupAudioPreferenceApplied) && !this.pendingWebOsAudioSelection;
      }
      if (gateDeadlineExpired && !this.pendingWebOsAudioSelection) {
        if (!this.startupAudioPreferenceApplied) {
          this.applyStartupAudioFallback();
        }
        return Boolean(this.startupAudioPreferenceApplied) && Number.isFinite(readyState) && readyState >= 2;
      }
      if (this.pendingPlaybackRestore) {
        return false;
      }
      const audioPreferenceSettled =
        !this.pendingWebOsAudioSelection &&
        (Boolean(this.startupAudioPreferenceApplied) ||
          (!Environment.isWebOS() && !this.startupAudioPreferenceApplying && !this.hasAudioTracksAvailable()));
      return audioPreferenceSettled && Number.isFinite(readyState) && readyState >= 3;
    },
    scheduleLoadingCompletionCheck(delayMs = 250, { force = false } = {}) {
      this.clearLoadingCompletionTimer();
      if (!this.loadingVisible || this.isExternalFrameMode()) {
        return;
      }
      this.loadingCompletionTimer = setTimeout(
        () => {
          this.loadingCompletionTimer = null;
          if (!this.loadingVisible || this.isExternalFrameMode()) {
            return;
          }
          if (this.isStartupGateReleaseReady()) {
            this.releaseStartupAudioGate();
            this.scheduleLoadingCompletionCheck(120, { force: true });
            return;
          }
          const fillProgress = Number(this.loadingLogoFillProgress || 0);
          if (fillProgress >= 1 && !this.isPlaybackStartupSettled()) {
            this.markPlaybackPresentedAfterAdvance();
            if (this.isStartupLogoDismissReady()) {
              this.presentStartedPlayback();
              return;
            }
            this.updateUiTick();
            this.scheduleLoadingCompletionCheck(180, { force: true });
            return;
          }
          if (!force && !this.isPlaybackStartupSettled()) {
            this.scheduleLoadingCompletionCheck(250);
            return;
          }
          if (this.loadingProgress != null && fillProgress < 1) {
            this.loadingProgress = 1;
            this.setLoadingLogoFillTarget(1);
            this.scheduleLoadingCompletionCheck(180, { force: true });
            return;
          }
          if (!this.markPlaybackPresentedAfterAdvance()) {
            this.scheduleLoadingCompletionCheck(120, { force: true });
            return;
          }
          const currentFillProgress = Number(this.loadingLogoFillProgress || 0);
          const currentFillTarget = Number(this.loadingLogoFillTarget || 0);
          if (currentFillTarget >= 1 && currentFillProgress < 0.995) {
            this.scheduleLoadingCompletionCheck(120, { force: true });
            return;
          }
          this.presentStartedPlayback();
        },
        Math.max(0, Number(delayMs || 0))
      );
    },
    clearControlsAutoHide() {
      if (this.controlsHideTimer) {
        clearTimeout(this.controlsHideTimer);
        this.controlsHideTimer = null;
      }
    },
    resetControlsAutoHide() {
      this.clearControlsAutoHide();
      if (!this.controlsVisible || this.paused || this.isDialogOpen() || this.seekOverlayVisible) {
        return;
      }
      this.controlsHideTimer = setTimeout(() => {
        this.setControlsVisible(false);
      }, 4200);
    },
    getPlaybackCurrentSeconds() {
      if (typeof PlayerController.getCurrentTimeSeconds === "function") {
        return Number(PlayerController.getCurrentTimeSeconds() || 0);
      }
      return Number(PlayerController.video?.currentTime || 0);
    },
    getPlaybackDisplayCurrentSeconds() {
      const current = this.getPlaybackCurrentSeconds();
      const conversion = PlayerController.webOsDtsAudioState;
      if (conversion?.cancelReload && conversion.reloadPresentation?.position > 0) {
        return conversion.reloadPresentation.position;
      }
      const requested = Number(this.pendingPlaybackRestore?.timeSeconds || 0);
      if (requested > 0 && current < requested - 0.75) return requested;
      return current;
    },
    getPlaybackDisplayDurationSeconds() {
      const duration = this.getPlaybackDurationSeconds();
      if (duration > 0 && Number.isFinite(duration)) return duration;
      return Number(PlayerController.webOsDtsAudioState?.reloadPresentation?.duration || this.pendingPlaybackRestore?.durationSeconds || 0);
    },
    getPlaybackDurationSeconds() {
      if (typeof PlayerController.getDurationSeconds === "function") {
        return Number(PlayerController.getDurationSeconds() || 0);
      }
      return Number(PlayerController.video?.duration || 0);
    },
    getPlaybackBufferedSeconds() {
      if (typeof PlayerController.getBufferedTimeSeconds !== "function") {
        return null;
      }
      const bufferedSeconds = PlayerController.getBufferedTimeSeconds();
      return bufferedSeconds == null ? null : Number(bufferedSeconds);
    },
    getPlaybackSpeed() {
      if (typeof PlayerController.getPlaybackRate === "function") {
        return Number(PlayerController.getPlaybackRate() || 1);
      }
      return Number(PlayerController.video?.playbackRate || 1);
    },
    getPlaybackSpeedOptions() {
      if (typeof PlayerController.getSupportedPlaybackRates === "function") {
        const speeds = PlayerController.getSupportedPlaybackRates();
        if (Array.isArray(speeds) && speeds.length) {
          return speeds;
        }
      }
      return PLAYER_SPEEDS;
    },
    hasKnownPlaybackDuration() {
      const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
      return Number.isFinite(durationSeconds) && durationSeconds > 0;
    },
    isPlaybackFrameReady() {
      const readyState =
        typeof PlayerController.getPlaybackReadyState === "function"
          ? Number(PlayerController.getPlaybackReadyState() || 0)
          : Number(PlayerController.video?.readyState || 0);
      return Number.isFinite(readyState) && readyState >= 2;
    },
    clearSeekLoading({ hideBuffering = false } = {}) {
      if (!this.seekLoading && this.seekLoadingBaselineSeconds == null && this.seekLoadingTargetSeconds == null) {
        return false;
      }
      this.seekLoading = false;
      this.bufferingActive = false;
      this.seekLoadingBaselineSeconds = null;
      this.seekLoadingTargetSeconds = null;
      this.seekLoadingSettled = false;
      this.seekLoadingProgressSeconds = null;
      this.seekLoadingProgressAt = 0;
      this.stopSeekLoadingWatchdog();
      if (hideBuffering && this.hasPresentedPlaybackFrame) {
        this.loadingVisible = false;
      }
      this.clearBufferingSpinnerTimer();
      this.updateLoadingVisibility();
      return true;
    },
    isTizenAvPlaySeekActive() {
      return Boolean(Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay());
    },
    hasSeekLoadingSettled() {
      if (this.seekLoadingSettled) {
        return true;
      }
      // AVPlay only emits "seeked" for successful seeks. A failed native seek
      // still ends the native operation, so treat any seek that completed after
      // this UI seek started as settled instead of waiting forever.
      if (!this.isTizenAvPlaySeekActive() || PlayerController.avplaySeekInFlight) {
        return false;
      }
      const settledAt = Number(PlayerController.avplaySeekSettledAt || 0);
      const startedAt = Number(this.seekLoadingStartedAt || 0);
      return settledAt > 0 && startedAt > 0 && settledAt >= startedAt;
    },
    completeSeekLoadingIfReady() {
      if (!this.seekLoading || this.pendingPlaybackRestore || this.isStartupLoadingVisible()) {
        return false;
      }
      if (
        !this.hasSeekLoadingSettled() ||
        PlayerController.avplaySeekInFlight ||
        PlayerController.video?.seeking ||
        !this.isPlaybackFrameReady()
      ) {
        return false;
      }
      const current = Number(this.getPlaybackCurrentSeconds());
      if (!Number.isFinite(current)) return false;
      const paused = this.getPlaybackControlPaused();
      const ended = PlayerController.isPlaybackEnded?.() || PlayerController.video?.ended;
      if (!paused && !ended) {
        const now = Date.now();
        const previous = this.seekLoadingProgressSeconds;
        const previousAt = Number(this.seekLoadingProgressAt || 0);
        this.seekLoadingProgressSeconds = current;
        this.seekLoadingProgressAt = now;
        if (previous == null || previousAt <= 0) return false;
        // The seek itself changes currentTime; only subsequent forward clock
        // movement proves that playback has resumed at the new position.
        // Compare the movement with the wall-clock time between samples rather
        // than a fixed one-second window: Tizen AVPlay reports time from a
        // 1000 ms tick and on some firmware in whole-second steps, so a fixed
        // "< 1 s" bound rejected every normal sample and the spinner never
        // cleared after a seek.
        const advancedSeconds = current - previous;
        const elapsedSeconds = Math.max(0, (now - previousAt) / 1000);
        const maxPlausibleAdvanceSeconds = Math.max(1.5, elapsedSeconds * 3 + 0.5);
        if (advancedSeconds <= 0.01 || advancedSeconds > maxPlausibleAdvanceSeconds) return false;
      }
      return this.clearSeekLoading({ hideBuffering: true });
    },
    startSeekLoadingWatchdog() {
      this.stopSeekLoadingWatchdog();
      if (!this.isTizenAvPlaySeekActive()) {
        return;
      }
      this.seekLoadingWatchdogChecks = 0;
      this.seekLoadingWatchdogLastSeconds = null;
      this.seekLoadingWatchdogRetried = false;
      this.seekLoadingWatchdogTimer = setTimeout(() => this.runSeekLoadingWatchdog(), SEEK_LOADING_WATCHDOG_INTERVAL_MS);
    },
    stopSeekLoadingWatchdog() {
      if (this.seekLoadingWatchdogTimer) {
        clearTimeout(this.seekLoadingWatchdogTimer);
        this.seekLoadingWatchdogTimer = null;
      }
    },
    getSeekLoadingWatchdogSnapshot() {
      const current = Number(this.getPlaybackCurrentSeconds());
      return {
        checks: Number(this.seekLoadingWatchdogChecks || 0),
        elapsedMs: Math.max(0, Date.now() - Number(this.seekLoadingStartedAt || Date.now())),
        targetSeconds: Number(this.seekLoadingTargetSeconds),
        currentSeconds: Number.isFinite(current) ? Math.round(current * 100) / 100 : null,
        settled: this.hasSeekLoadingSettled(),
        inFlight: Boolean(PlayerController.avplaySeekInFlight),
        frameReady: this.isPlaybackFrameReady(),
        paused: Boolean(this.getPlaybackControlPaused()),
        state: typeof PlayerController.getAvPlayState === "function" ? PlayerController.getAvPlayState() : "",
        lastSeek: PlayerController.avplayLastSeekOutcome ? { ...PlayerController.avplayLastSeekOutcome } : null,
        retried: Boolean(this.seekLoadingWatchdogRetried)
      };
    },
    runSeekLoadingWatchdog() {
      this.seekLoadingWatchdogTimer = null;
      if (!this.seekLoading || !this.isTizenAvPlaySeekActive()) {
        return;
      }
      this.seekLoadingWatchdogChecks = Number(this.seekLoadingWatchdogChecks || 0) + 1;
      const snapshot = this.getSeekLoadingWatchdogSnapshot();
      const previousSeconds = this.seekLoadingWatchdogLastSeconds;
      this.seekLoadingWatchdogLastSeconds = snapshot.currentSeconds;
      const advanced =
        Number.isFinite(previousSeconds) && Number.isFinite(snapshot.currentSeconds) && snapshot.currentSeconds > previousSeconds + 0.25;
      if (globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ === true) {
        console.info("Tizen AVPlay seek watchdog check", { ...snapshot, advanced });
      }
      const reschedule = () => {
        this.seekLoadingWatchdogTimer = setTimeout(() => this.runSeekLoadingWatchdog(), SEEK_LOADING_WATCHDOG_INTERVAL_MS);
      };

      // The native seek owns its own timeout; only intervene after it returns.
      if (snapshot.inFlight) {
        if (snapshot.elapsedMs < SEEK_LOADING_WATCHDOG_GIVE_UP_MS) {
          reschedule();
        }
        return;
      }

      if (snapshot.settled && (advanced || snapshot.paused)) {
        if (globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ === true) {
          console.info("Tizen AVPlay seek watchdog cleared the seek spinner", { ...snapshot, advanced });
        }
        this.clearSeekLoading({ hideBuffering: true });
        return;
      }

      if (snapshot.elapsedMs >= SEEK_LOADING_WATCHDOG_GIVE_UP_MS) {
        // Never leave the spinner up indefinitely: hand the controls back so
        // the user can retry, pick another source or leave the player.
        console.warn("Tizen AVPlay seek did not resume playback; clearing the seek spinner", snapshot);
        this.clearSeekLoading({ hideBuffering: true });
        return;
      }

      if (
        snapshot.settled &&
        !advanced &&
        !this.seekLoadingWatchdogRetried &&
        snapshot.elapsedMs >= SEEK_LOADING_WATCHDOG_RETRY_AFTER_MS &&
        Number.isFinite(snapshot.targetSeconds) &&
        typeof PlayerController.seekToSeconds === "function"
      ) {
        this.seekLoadingWatchdogRetried = true;
        console.warn("Tizen AVPlay seek stalled after settling; retrying the seek once", snapshot);
        PlayerController.seekToSeconds(snapshot.targetSeconds);
      }
      reschedule();
    },
    isEngineFsStartupReady() {
      if (!this.currentEngineFsStream) {
        return true;
      }
      const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
      return this.isPlaybackFrameReady() || (this.hasKnownPlaybackDuration() && Number.isFinite(currentSeconds) && currentSeconds > 0.2);
    },
    clearSkipIntroSeekSuppression() {
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
    }
  };
}
