/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods73() {
  const { PlayerController, streamRepository, TrackingScrobbleService, ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS } = internals;

  return {
    cleanup() {
      try {
        this.cancelSourceLoad();
        streamRepository.setLocalPluginSearchPaused(true);
        this.playerRouteActive = false;
        this.playbackRecoveryActive = false;
        this.playbackRecoveryAttempts = 0;
        this.playerMountToken = Number(this.playerMountToken || 0) + 1;
        if (this.tizenAvPlayConnectionRetryTimer) {
          clearTimeout(this.tizenAvPlayConnectionRetryTimer);
          this.tizenAvPlayConnectionRetryTimer = null;
        }
        this.cancelTizenAvPlayConnectionRetryBudgetReset();
        this.tizenAvPlayConnectionRetryAttempts = 0;
        this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
        this.nextEpisodeLaunching = false;
        this.resetNextEpisodeLaunchPresentation();
        this.nextEpisodeAutoplayAttemptedKey = "";
        this.resetStillWatchingPromptState({ render: false });
        this.consecutiveAutoPlayCount = 0;
        this.postPlayNaturalEndPending = false;
        this.postPlayPlaybackEnded = false;
        this.postPlayNaturalCompletionPrepared = false;
        this.postPlayPendingSelect = false;
        this.postPlayPendingSelectAction = "";
        this.clearPostPlayFocusTimer();
        this.clearPostPlayLongPressTimer();
        this.clearPostPlaySynopsisScrollAnimation();
        this.postPlayLongPressTriggered = false;
        this.cancelPostPlayNativeSurfaceAnimation();
        this.postPlayNativeSurfaceStateKey = "";
        this.postPlayNativeSurfaceRect = null;
        if (this.postPlayDescriptionMeasureFrame) {
          cancelAnimationFrame(this.postPlayDescriptionMeasureFrame);
          this.postPlayDescriptionMeasureFrame = null;
        }
        this.stopPostPlayTrailer();
        this.clearPostPlaySummaryTransition();
        this.postPlayRecommendationController?.stop?.();
        this.unbindVideoEvents();
        if (this.endedHandler && PlayerController.video) {
          PlayerController.video.removeEventListener("ended", this.endedHandler);
          this.endedHandler = null;
        }
        TrackingScrobbleService.cancel();
        this.unbindPlayerExitCleanup();
        this.releaseCurrentEngineFsStreamBestEffort("player-cleanup", {
          removeTorrent: true,
          deferRemoveMs: ENGINEFS_NAVIGATION_CLEANUP_GRACE_MS
        });
        this.cancelSeekPreview({ commit: false });
        this.dismissPauseOverlay();
        this.clearSubtitleDelayOverlayTimer();
        this.subtitleDelayOverlayVisible = false;
        this.subtitleTimingDialogVisible = false;
        this.resetSubtitleAutoSyncState();
        this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
        this.nextEpisodeTransitionMeta = null;
        this.streamCandidatesByVideoId?.clear?.();
        this.streamCandidatesLoadPromises?.clear?.();
        this.hlsManifestSubtitlePromotionUrls?.clear?.();
        this.failedPlaybackUrls?.clear?.();
        this.failedPlaybackStreamIds?.clear?.();
        this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0) + 1;
        this.subtitleLoadToken = (this.subtitleLoadToken || 0) + 1;
        this.subtitleSelectionToken = Number(this.subtitleSelectionToken || 0) + 1;
        this.manifestLoadToken = (this.manifestLoadToken || 0) + 1;
        this.manifestLoadAbortController?.abort?.();
        this.manifestLoadAbortController = null;
        this.trackDiscoveryToken = (this.trackDiscoveryToken || 0) + 1;
        this.clearStartupAudioPreferenceRetry();
        this.trackDiscoveryInProgress = false;
        this.trackDiscoveryStartedAt = 0;
        this.trackDiscoveryDeadline = 0;
        this.subtitleLoading = false;
        this.manifestLoading = false;
        this.clearWebOsEmbeddedTextSubtitleOverlay({ dispose: true });
        this.clearHtmlSubtitleOverlay();
        this.destroyAssSubtitleRenderer();
        this.clearBitmapSubtitleOverlay({ dispose: true });
        if (this.releaseImageProxyReadyListener) {
          this.releaseImageProxyReadyListener();
          this.releaseImageProxyReadyListener = null;
        }
        this.webOsClockSettingsSubscription?.cancel?.();
        this.webOsClockSettingsSubscription = null;
        this.webOsClockLocaleInfo = null;
        if (this.sourceLogoRenderTimer) {
          clearTimeout(this.sourceLogoRenderTimer);
          this.sourceLogoRenderTimer = null;
        }
        this.cancelScheduledSourcesPanelRender();
        this.renderedSourcesMarkup = null;
        this.clearTrackDiscoveryTimer();
        this.stopLoadingLogoFillAnimation();
        this.resetPlaybackEngineValidation();
        this.clearPlaybackStallGuard();
        this.bufferingActive = false;
        this.clearBufferingSpinnerTimer();
        // The loading-completion poll self-reschedules; without this it
        // survives the route change and janks the next menu on Tizen.
        if (this.loadingCompletionTimer) {
          clearTimeout(this.loadingCompletionTimer);
          this.loadingCompletionTimer = null;
        }
        this.loadingCompletionToken = Number(this.loadingCompletionToken || 0) + 1;
        if (this.engineFsStartupRetryTimer) {
          clearTimeout(this.engineFsStartupRetryTimer);
          this.engineFsStartupRetryTimer = null;
        }

        this.clearSubtitleCueStyleBindings();
        this.clearEmbeddedSubtitleCueRefreshTimers();
        this.clearMountedExternalSubtitleTracks();

        this.clearControlsAutoHide();
        this.skipIntroAutoHidden = false;
        this.skipIntroCountdownProgress = 0;
        this.skipIntroCountdownLastTickAt = 0;
        this.skipIntroCountdownStartAt = 0;
        this.skipIntroSuppressedKey = "";
        this.skipIntroSuppressedUntil = 0;
        this.stopSkipIntroCountdownAnimation();
        if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.skipIntroFocusFrame);
        }
        this.skipIntroFocusFrame = null;

        if (this.tickTimer) {
          clearInterval(this.tickTimer);
          this.tickTimer = null;
        }

        this.stopSkipIntervalCheckTimer();

        if (this.aspectToastTimer) {
          clearTimeout(this.aspectToastTimer);
          this.aspectToastTimer = null;
        }

        if (this.parentalGuideTimer) {
          clearTimeout(this.parentalGuideTimer);
          this.parentalGuideTimer = null;
        }
        if (this.parentalGuideExitTimer) {
          clearTimeout(this.parentalGuideExitTimer);
          this.parentalGuideExitTimer = null;
        }
        this.parentalGuideExiting = false;
        this.stopParentalGuideLineAnimation({ reset: true });

        if (this.subtitleSelectionTimer) {
          clearTimeout(this.subtitleSelectionTimer);
          this.subtitleSelectionTimer = null;
        }
        if (this.subtitleDialogScrollTimer) {
          clearTimeout(this.subtitleDialogScrollTimer);
          this.subtitleDialogScrollTimer = null;
        }
        if (this.subtitleOptionVirtualMeasureTimer) {
          clearTimeout(this.subtitleOptionVirtualMeasureTimer);
          this.subtitleOptionVirtualMeasureTimer = null;
        }

        this.clearMediaSessionHandlers();

        this.releaseStartupAudioGate({ resume: false });
      } catch (error) {
        try {
          console.warn("Player cleanup error suppressed to keep navigation working", error);
        } catch (_) {}
      } finally {
        // Always stop playback and hide the player surface, even if the teardown
        // above threw, so the user is never left stuck in the player with the
        // video still playing (seen on Samsung Tizen when the EngineFS release
        // throws during cleanup and aborts the route navigation).
        try {
          PlayerController.stop();
        } catch (_) {}
        try {
          if (this.container) {
            this.container.style.display = "none";
            this.container.querySelector("#playerUiRoot")?.remove();
            this.container.querySelector("#episodeSidePanel")?.remove();
          }
        } catch (_) {}
        this.uiRefs = null;
        this.lastUiTickState = null;
      }
    }
  };
}
