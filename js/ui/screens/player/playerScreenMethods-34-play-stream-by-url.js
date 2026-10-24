/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods34() {
  const {
    PlayerController,
    shouldAllowNativePlaybackDuringStartupAudioGate,
    isExpiredStreamUrl,
    Environment,
    WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS,
    claimEngineFsPlayback
  } = internals;

  return {
    async playStreamByUrl(
      streamUrl,
      {
        preservePanel = false,
        resetSilentAudioState = true,
        preservePlaybackState = false,
        preservePendingRestore = false,
        preserveStartupRecoveryState = false,
        preservePlaybackRecoveryState = false,
        preserveTizenAvPlayConnectionRetryState = false,
        forceEngine = null,
        sourceCandidate: explicitSourceCandidate = null,
        mountToken = null
      } = {}
    ) {
      if (!this.isActiveMountToken(mountToken)) {
        return;
      }
      const webOsAddonSubtitleRestoreRequestId = Number(this.webOsAddonSubtitleRestoreRequestId || 0) + 1;
      this.webOsAddonSubtitleRestoreRequestId = webOsAddonSubtitleRestoreRequestId;
      this.pendingWebOsAddonSubtitleRestore = null;
      if (!preserveTizenAvPlayConnectionRetryState) {
        if (this.tizenAvPlayConnectionRetryTimer) {
          clearTimeout(this.tizenAvPlayConnectionRetryTimer);
        }
        if (this.tizenAvPlayConnectionRetryBudgetResetTimer) {
          clearTimeout(this.tizenAvPlayConnectionRetryBudgetResetTimer);
        }
        this.tizenAvPlayConnectionRetryTimer = null;
        this.tizenAvPlayConnectionRetryBudgetResetTimer = null;
        this.tizenAvPlayConnectionRetryAttempts = 0;
      }
      if (this.isExternalFrameMode()) {
        return;
      }
      if (!streamUrl) {
        return;
      }

      const normalizedStreamUrl = String(streamUrl || "").trim();
      const previousSourceCandidate = this.getCurrentStreamCandidate();
      const sourceCandidate =
        explicitSourceCandidate || this.getStreamCandidateByUrl(normalizedStreamUrl) || this.getCurrentStreamCandidate();
      const preserveWebOsTrackSelections = this.shouldPreserveWebOsTrackSelections(
        previousSourceCandidate,
        sourceCandidate,
        normalizedStreamUrl,
        forceEngine
      );
      if (isExpiredStreamUrl(normalizedStreamUrl)) {
        this.showExpiredStreamError(normalizedStreamUrl, {
          sourceCandidate,
          reason: "stream-url-expired"
        });
        return;
      }
      const selectedAddonSubtitleId = String(this.selectedAddonSubtitleId || "").trim();
      if (preserveWebOsTrackSelections && selectedAddonSubtitleId) {
        this.subtitleSelectionToken = Number(this.subtitleSelectionToken || 0) + 1;
        this.pendingWebOsAddonSubtitleRestore = {
          requestId: webOsAddonSubtitleRestoreRequestId,
          subtitleId: selectedAddonSubtitleId,
          subtitleSelectionToken: Number(this.subtitleSelectionToken || 0),
          playbackUrl: normalizedStreamUrl,
          mountToken,
          previousControllerPlayRequestToken: Number(PlayerController.playRequestToken || 0),
          previousNativeMediaIdLookupToken: Number(PlayerController.nativeMediaIdLookupToken || 0),
          previousSubtitleLoadToken: Number(this.subtitleLoadToken || 0),
          nativeMetadataReady: false,
          expectedControllerPlayRequestToken: 0
        };
      }

      const selectedIndex = this.streamCandidates.findIndex((entry) => entry.url === normalizedStreamUrl);
      if (selectedIndex >= 0) {
        this.currentStreamIndex = selectedIndex;
      }
      const sourceContext = this.getPlaybackSourceContext(sourceCandidate);
      if (sourceContext) {
        this.activePlaybackSourceContext = sourceContext;
      }
      const nextEngineFsState = this.getEngineFsStateForStream(sourceCandidate);
      const prioritizeWebOsRemoteMkvPlayback =
        Environment.isWebOS() && !nextEngineFsState && this.isCurrentSourceLikelyMkv(streamUrl, sourceCandidate);
      const allowNativePlaybackDuringStartupAudioGate = shouldAllowNativePlaybackDuringStartupAudioGate({
        isHlsPlayback: this.isCurrentSourceLikelyHls(streamUrl, sourceCandidate),
        isPrioritizedWebOsRemoteMkvPlayback: prioritizeWebOsRemoteMkvPlayback
      });
      const sameEngineFsState = this.isSameEngineFsState(this.currentEngineFsStream, nextEngineFsState);
      if (this.currentEngineFsStream && !this.isSameEngineFsState(this.currentEngineFsStream, nextEngineFsState)) {
        const removePreviousTorrent =
          !nextEngineFsState ||
          String(this.currentEngineFsStream.infoHash || "").toLowerCase() !== String(nextEngineFsState.infoHash || "").toLowerCase();
        await this.releaseCurrentEngineFsStream("source-change", {
          removeTorrent: removePreviousTorrent
        });
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
      }
      if (!sameEngineFsState) {
        if (this.engineFsStartupRetryTimer) {
          clearTimeout(this.engineFsStartupRetryTimer);
          this.engineFsStartupRetryTimer = null;
        }
        this.engineFsStartupErrorRetries = 0;
        this.lastEngineFsStartupErrorStats = null;
      }

      const preservePresentedPlaybackFrame = Boolean(preservePlaybackRecoveryState && this.hasPresentedPlaybackFrame);
      if (!preservePresentedPlaybackFrame) {
        this.resetPlaybackEngineValidation();
      }
      if (!preservePlaybackRecoveryState) {
        this.playbackRecoveryActive = false;
        this.playbackRecoveryAttempts = 0;
      }
      this.playbackRecoveryActive = preservePresentedPlaybackFrame;
      this.hasPresentedPlaybackFrame = preservePresentedPlaybackFrame;
      this.webOsNativeStartupLoadingExtended = false;
      if (!preserveStartupRecoveryState) {
        this.webOsNativeReadyStartupRetries = 0;
      }
      this.startupPlaybackBaselineSeconds = null;
      this.startupPlaybackHasAdvanced = false;
      this.bufferingActive = false;
      this.bufferingSpinnerBaselineSeconds = null;
      this.clearStartupError();
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      this.clearBufferingSpinnerTimer();
      if (nextEngineFsState) {
        this.releaseStartupAudioGate({ resume: false });
      } else {
        this.enableStartupAudioGate({
          allowNativePlayback: allowNativePlaybackDuringStartupAudioGate,
          maxWaitMs: prioritizeWebOsRemoteMkvPlayback ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS : 0
        });
      }
      this.cancelSeekPreview({ commit: false });
      if (preservePlaybackState) {
        const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
        const video = PlayerController.video;
        const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
        const hasExistingResumeRestore = Boolean(
          this.pendingPlaybackRestore &&
          (Number(this.pendingPlaybackRestore.timeSeconds || 0) > 1 || Number(this.pendingPlaybackRestore.progressPercent || 0) > 0)
        );
        const hasUsefulCurrentPosition = Number.isFinite(restoreTimeSeconds) && restoreTimeSeconds > 1;
        if (!(hasExistingResumeRestore && !hasUsefulCurrentPosition)) {
          this.pendingPlaybackRestore = {
            timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
            paused: Boolean(this.paused || (!usingAvPlay && video?.paused)),
            attempts: 0,
            lastAttemptAt: 0
          };
        }
      } else if (!(preservePendingRestore && this.pendingPlaybackRestore)) {
        this.pendingPlaybackRestore = null;
      }
      this.markPlaybackProgress();
      this.clearPlaybackStallGuard();
      this.clearSubtitleCueStyleBindings();
      this.clearEmbeddedSubtitleCueRefreshTimers();
      if (resetSilentAudioState) {
        this.silentAudioFallbackAttempts.clear();
        this.silentAudioFallbackCount = 0;
      }

      if (!preservePanel) {
        this.closeSourcesPanel();
      }

      this.clearSubtitleDelayOverlayTimer();
      this.subtitleDialogVisible = false;
      this.subtitleDelayOverlayVisible = false;
      this.subtitleTimingDialogVisible = false;
      this.resetSubtitleAutoSyncState();
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      if (!preserveWebOsTrackSelections) {
        this.selectedAddonSubtitleId = null;
        this.selectedSubtitleTrackIndex = -1;
        this.selectedEmbeddedSubtitleTrackIndex = -1;
        this.selectedManifestSubtitleTrackId = null;
        this.startupSubtitlePreferenceApplied = false;
        this.startupSubtitlePreferenceApplying = false;
        this.startupAudioPreferenceApplied = false;
        this.startupAudioPreferenceApplying = false;
        this.startupAudioFallbackApplied = false;
        this.startupAudioTrackSetSignature = "";
        this.builtInSubtitleCount = 0;
        this.embeddedSubtitleTracks = [];
        this.embeddedAudioTracks = [];
        this.selectedEmbeddedAudioTrackIndex = -1;
        PlayerController.clearWebOsTrackSelections?.();
      }
      this.clearStartupAudioPreferenceRetry();
      if (!preserveWebOsTrackSelections && typeof PlayerController.cancelWebOsAudioTrackSelection === "function") {
        PlayerController.cancelWebOsAudioTrackSelection();
      }
      this.pendingWebOsAudioSelection = null;
      this.failedAutomaticAudioFallbackEntryId = "";
      this.startupTrackPreferenceReady = false;
      this.clearBitmapSubtitleOverlay({ dispose: true });
      this.destroyAssSubtitleRenderer();
      this.clearSubtitleCueStyleBindings();
      this.clearMountedExternalSubtitleTracks();
      this.trackDiscoveryInProgress = true;
      this.clearTrackDiscoveryTimer();
      this.trackDiscoveryStartedAt = 0;
      this.trackDiscoveryDeadline = 0;
      this.activePlaybackUrl = streamUrl;
      this.applySubtitlePresentationSettings?.();
      this.currentEngineFsStream = nextEngineFsState || null;
      if (this.currentEngineFsStream) {
        this.engineFsPlaybackToken = claimEngineFsPlayback(this.currentEngineFsStream);
        this.startEngineFsKeepAlive(this.currentEngineFsStream);
      } else {
        this.engineFsPlaybackToken = "";
        this.stopEngineFsKeepAlive();
      }
      this.embeddedTrackRequestPromise = null;
      this.embeddedTrackRequestUrl = "";
      if (!preserveWebOsTrackSelections) {
        this.lastEmbeddedTrackProbeUrl = "";
      }
      this.lastEmbeddedTrackRetryAt = 0;
      this.lastTrackWarmupAt = Date.now();
      const playbackContext = {
        ...this.buildPlaybackContext(sourceCandidate),
        forceEngine,
        preserveTrackSelections: preserveWebOsTrackSelections
      };
      const startPlayback = (url, context, options) => {
        const playbackPromise = this.startPlayerControllerPlayback(url, context, options);
        const pendingRestore = this.pendingWebOsAddonSubtitleRestore;
        const controllerPlayRequestToken = Number(PlayerController.playRequestToken || 0);
        if (
          pendingRestore?.requestId === webOsAddonSubtitleRestoreRequestId &&
          controllerPlayRequestToken > pendingRestore.previousControllerPlayRequestToken
        ) {
          pendingRestore.expectedControllerPlayRequestToken = controllerPlayRequestToken;
        }
        return playbackPromise;
      };
      if (prioritizeWebOsRemoteMkvPlayback) {
        // Claim the remote media request before the companion service probes the
        // same URL. Some providers rate-limit simultaneous Range requests.
        await startPlayback(this.activePlaybackUrl, playbackContext, {
          mountToken,
          sourceCandidate
        });
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
      }
      this.loadSubtitles();
      this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
      this.startTrackDiscoveryWindow({
        durationMs: prioritizeWebOsRemoteMkvPlayback ? WEBOS_REMOTE_MKV_AUDIO_GATE_MAX_WAIT_MS : 7000
      });
      if (this.currentEngineFsStream || prioritizeWebOsRemoteMkvPlayback) {
        this.initialEmbeddedTrackBootstrapPromise = null;
      } else {
        const embeddedSubtitleWarmupPromise = this.loadEmbeddedSubtitleTracks();
        this.initialEmbeddedTrackBootstrapPromise = embeddedSubtitleWarmupPromise;
        embeddedSubtitleWarmupPromise.finally(() => {
          if (this.initialEmbeddedTrackBootstrapPromise === embeddedSubtitleWarmupPromise) {
            this.initialEmbeddedTrackBootstrapPromise = null;
          }
        });
        await this.waitForInitialEmbeddedTrackBootstrap();
        if (!this.isActiveMountToken(mountToken)) {
          return;
        }
      }
      this.updateModalBackdrop();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      if (!prioritizeWebOsRemoteMkvPlayback) {
        startPlayback(this.activePlaybackUrl, playbackContext, {
          mountToken,
          sourceCandidate
        });
      }
      this.paused = false;
      this.refreshTrackDialogs();
      this.updateUiTick();
      this.setControlsVisible(true, { focus: false });
      this.schedulePlaybackStallGuard();
    }
  };
}
