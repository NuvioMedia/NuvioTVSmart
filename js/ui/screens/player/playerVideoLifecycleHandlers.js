/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerVideoLifecycleHandlers(video, isTizenAvPlayPlayback) {
  const { PlayerController, PlayerSettingsStore, Environment, TrackingScrobbleService } = internals;
  const onWaiting = () => {
    this.seekLoadingVisualComplete = false;
    if (this.isStartupErrorVisible()) {
      return;
    }
    if (this.hasPresentedPlaybackFrame && !this.playbackEngineValidated) {
      this.resetPlaybackEngineValidation();
    } else if (this.postValidationRecoveryValidationActive) {
      this.resetPostValidationRecoveryValidationWindow();
    }
    const currentSeconds = this.getPlaybackCurrentSeconds();
    this.dismissPauseOverlay();
    // Match Android's post-first-frame buffering state: keep the startup
    // overlay closed and preserve the user's current controls visibility.
    if (this.hasPresentedPlaybackFrame && !this.seekLoading && !this.sourcesPanelVisible && !this.isSeekOverlaySuppressingControls()) {
      this.bufferingActive = true;
      this.bufferingSpinnerBaselineSeconds = currentSeconds;
      this.lastPlaybackProgressAt = Date.now();
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.scheduleBufferingSpinnerRefresh();
    } else {
      this.loadingVisible = true;
      this.bufferingActive = false;
      this.updateLoadingVisibility();
      if (!this.sourcesPanelVisible && !this.isSeekOverlaySuppressingControls()) {
        this.setControlsVisible(true, { focus: false });
      }
    }
    this.schedulePlaybackStallGuard();
    this.updateUiTick();
  };

  const onPlaying = () => {
    if (this.isStartupErrorVisible()) {
      if (!Environment.isWebOS()) {
        return;
      }
      console.info("webOS playback recovered after the startup stall guard", {
        url: this.activePlaybackUrl,
        engine: PlayerController.playbackEngine
      });
      this.clearStartupError();
      this.failedPlaybackUrls?.delete?.(String(this.activePlaybackUrl || "").trim());
      const currentStreamId = String(this.getCurrentStreamCandidate()?.id || "").trim();
      if (currentStreamId) {
        this.failedPlaybackStreamIds?.delete?.(currentStreamId);
      }
      this.loadingVisible = true;
    }
    this.playbackRecoveryActive = false;
    this.playbackRecoveryAttempts = 0;
    this.beginPlaybackEngineValidation();
    this.bufferingActive = false;
    this.clearBufferingSpinnerTimer();
    if (this.seekLoading) {
      this.completeSeekLoadingIfReady();
    }
    if (isTizenAvPlayPlayback()) {
      this.lastPlaybackErrorAt = 0;
      this.sourcesError = "";
      if (this.currentEngineFsStream && !this.isEngineFsStartupReady()) {
        this.loadingVisible = true;
        this.updateLoadingVisibility();
        this.updateUiTick();
        this.schedulePlaybackStallGuard({ timeoutMs: 12000 });
        this.scheduleLoadingCompletionCheck(250);
        return;
      }
      // AVPlay returns from this platform-specific branch before the shared
      // browser playback path below. Keep the Android start-scrobble event at
      // the first real playing state on Tizen as well.
      if (TrackingScrobbleService.isEnabled()) {
        TrackingScrobbleService.start(this.buildScrobbleContext());
      }
      this.markPlaybackProgress();
      this.paused = false;
      this.scheduleTizenAvPlayConnectionRetryBudgetReset?.();
      this.seekOverlaySuppressControlsUntil = 0;
      this.startupTrackPreferenceReady = true;
      this.dismissPauseOverlay();
      this.updateMediaSessionPlaybackState();
      this.refreshTrackDialogs();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.attemptPendingPlaybackRestore();
      this.setLoadingLogoFillTarget(1);
      this.markPlaybackPresentedAfterAdvance();
      this.updateLoadingVisibility();
      this.scheduleLoadingCompletionCheck(250);
      this.updateUiTick();
      this.resetControlsAutoHide();
      this.maybeShowParentalGuideOverlay();
      return;
    }
    if (this.currentEngineFsStream && !this.hasPresentedPlaybackFrame) {
      this.lastPlaybackErrorAt = 0;
      this.engineFsStartupErrorRetries = 0;
      this.lastEngineFsStartupErrorStats = null;
      this.sourcesError = "";
      this.paused = false;
      this.updateMediaSessionPlaybackState();
      this.schedulePlaybackStallGuard({ timeoutMs: 12000 });
      this.scheduleLoadingCompletionCheck(250);
      this.updateUiTick();
      return;
    }
    if (this.startupAudioGateActive && !this.startupAudioGateAllowsNativePlayback) {
      this.paused = false;
      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.scheduleLoadingCompletionCheck(250);
      return;
    }
    // Fire-and-forget scrobble start (debounced internally)
    if (TrackingScrobbleService.isEnabled()) {
      TrackingScrobbleService.start(this.buildScrobbleContext());
    }
    this.lastPlaybackErrorAt = 0;
    this.sourcesError = "";
    this.markPlaybackProgress();
    this.paused = false;
    this.seekOverlaySuppressControlsUntil = 0;
    this.startupTrackPreferenceReady = true;
    this.dismissPauseOverlay();
    this.updateMediaSessionPlaybackState();
    this.refreshTrackDialogs();
    this.applyAudioAmplification();
    this.applySubtitlePresentationSettings();
    this.applyAspectMode({ showToast: false });
    this.attemptPendingPlaybackRestore();
    this.setLoadingLogoFillTarget(1);
    this.markPlaybackPresentedAfterAdvance();
    this.updateLoadingVisibility();
    this.updateUiTick();
    this.scheduleLoadingCompletionCheck(900);
    if (this.stickyProgressFocus && this.controlsVisible) {
      this.focusProgressBar();
    }
    this.resetControlsAutoHide();
    this.maybeShowParentalGuideOverlay();
    setTimeout(() => {
      this.attemptSilentAudioRecovery("playing");
    }, 700);
  };

  const onPause = () => {
    if (this.startupAudioGateActive) {
      this.paused = false;
      this.updateMediaSessionPlaybackState();
      return;
    }
    const ended = typeof PlayerController.isPlaybackEnded === "function" ? PlayerController.isPlaybackEnded() : Boolean(video.ended);
    if (ended) {
      return;
    }
    if (PlayerController.isLivePlaybackItemType?.() && PlayerController.isPlaying) {
      return;
    }
    if (this.isBufferingForPauseOverlay()) {
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      return;
    }
    if (this.hasPresentedPlaybackFrame && !this.playbackEngineValidated) {
      this.resetPlaybackEngineValidation();
    } else if (this.postValidationRecoveryValidationActive) {
      this.resetPostValidationRecoveryValidationWindow();
    }
    if (isTizenAvPlayPlayback()) {
      this.cancelTizenAvPlayConnectionRetryBudgetReset?.();
    }
    // Immediate scrobble pause
    if (TrackingScrobbleService.isEnabled()) {
      TrackingScrobbleService.pause(this.buildScrobbleContext());
    }
    this.clearPlaybackStallGuard();
    this.paused = true;
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(true, { focus: false });
    this.updateUiTick();
    this.renderControlButtons();
    this.schedulePauseOverlay();
  };

  const onTimeUpdate = () => {
    if (this.isStartupErrorVisible()) {
      return;
    }
    if (isTizenAvPlayPlayback() && this.loadingVisible && (!this.currentEngineFsStream || this.isEngineFsStartupReady())) {
      this.setLoadingLogoFillTarget(1);
      const playbackPresented = this.markPlaybackPresentedAfterAdvance();
      this.updateLoadingVisibility();
      this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 180);
    }
    if (this.currentEngineFsStream && !this.hasPresentedPlaybackFrame && this.isEngineFsStartupReady()) {
      this.setLoadingLogoFillTarget(1);
      const playbackPresented = this.markPlaybackPresentedAfterAdvance();
      this.updateLoadingVisibility();
      this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 180);
    }
    if (this.loadingVisible && !this.hasPresentedPlaybackFrame) {
      const playbackPresented = this.markPlaybackPresentedAfterAdvance();
      this.updateLoadingVisibility();
      this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 120);
    }
    this.markPlaybackProgress();
    this.attemptPendingPlaybackRestore();
    this.renderWebOsEmbeddedTextSubtitleAtCurrentTime();
    this.refreshWebOsEmbeddedHtmlSubtitleOverlayIfNeeded();
    this.renderHtmlSubtitleOverlayAtCurrentTime();
    this.updateMediaSessionPositionState();
    this.updateUiTick();
  };

  const onProgress = () => {
    this.updateUiTick();
  };

  const onLoadedMetadata = () => {
    if (this.isStartupErrorVisible()) {
      return;
    }
    PlayerController.reapplyWebOsNativeTrackSelections?.();
    this.reapplyPendingWebOsAddonSubtitle?.(true);
    this.attemptPendingPlaybackRestore({ force: true });

    this.startupTrackPreferenceReady = true;
    this.refreshTrackDialogs();
    this.updateUiTick();
    this.markPlaybackProgress();
    this.applyAudioAmplification();
    this.applySubtitlePresentationSettings();
    this.applyAspectMode({ showToast: false });
    this.ensureTrackDataWarmup();
    this.updateMediaSessionPositionState();
    if (this.paused) {
      this.schedulePauseOverlay();
    }
    this.startTrackDiscoveryWindow({ durationMs: 5000, intervalMs: 300 });
    this.scheduleLoadingCompletionCheck(900);
    setTimeout(() => {
      this.attemptSilentAudioRecovery("metadata");
    }, 500);
  };

  const onPlayable = () => {
    if (this.isStartupErrorVisible()) {
      return;
    }
    if (this.bufferingActive && isTizenAvPlayPlayback() && this.hasPresentedPlaybackFrame && this.getPlaybackCurrentSeconds() > 0) {
      this.bufferingActive = false;
      this.clearBufferingSpinnerTimer();
      this.updateLoadingVisibility();
    }
    this.reapplyPendingWebOsAddonSubtitle?.(true);
    this.attemptPendingPlaybackRestore();
    this.completeSeekLoadingIfReady();
    this.startupTrackPreferenceReady = true;
    this.refreshTrackDialogs();
    this.applySubtitlePresentationSettings();
    this.applyAspectMode({ showToast: false });
    this.scheduleLoadingCompletionCheck(120);
    this.updateUiTick();
  };

  const onSeeked = (event) => {
    if (this.isStartupErrorVisible()) {
      return;
    }
    if (this.seekLoading) {
      this.seekLoadingSettled = true;
      this.seekLoadingProgressSeconds = null;
      // The webOS adapter already confirmed real decode progress at the target.
      // Hide only the spinner; Party readiness keeps its existing checks.
      if (Environment.isWebOS() && event?.detail?.exactNativeSeek === true) {
        this.seekLoadingVisualComplete = true;
        this.updateLoadingVisibility();
      }
    }
    if (this.hasPresentedPlaybackFrame && !this.playbackEngineValidated) {
      this.resetPlaybackEngineValidation();
    } else if (this.postValidationRecoveryValidationActive) {
      this.resetPostValidationRecoveryValidationWindow();
    }
    this.attemptPendingPlaybackRestore();
    this.completeSeekLoadingIfReady();
    this.markPlaybackProgress();
    this.renderWebOsEmbeddedTextSubtitleAtCurrentTime();
    this.renderBitmapSubtitleAtCurrentTime({ force: true });
    this.updateMediaSessionPositionState();
    this.updateUiTick();
  };

  const onTrackListChanged = () => {
    this.applyAspectMode({ showToast: false });
    this.refreshTrackDialogs();
    if (this.refreshSubtitleCueStyles()) {
      this.refreshWebOsEmbeddedSubtitleAfterCueMutation();
    }
    const embeddedAudioDiscoveryPending = this.canDiscoverEmbeddedAudioTracks() && this.embeddedAudioTracks.length <= 0;
    if (
      this.trackDiscoveryInProgress &&
      !embeddedAudioDiscoveryPending &&
      this.hasAudioTracksAvailable({ includeImplicit: false }) &&
      this.hasSubtitleTracksAvailable() &&
      !this.isWebOsEngineFsEmbeddedTrackDiscoveryPending()
    ) {
      this.trackDiscoveryInProgress = false;
      this.clearTrackDiscoveryTimer();
      this.refreshTrackDialogs();
    }
  };

  return {
    onWaiting,
    onPlaying,
    onPause,
    onTimeUpdate,
    onProgress,
    onLoadedMetadata,
    onPlayable,
    onSeeked,
    onTrackListChanged
  };
}
