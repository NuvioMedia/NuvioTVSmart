/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerVideoEventHandlers(video, isTizenAvPlayPlayback) {
  const { PlayerController, isExpiredStreamUrl, isTerminalHlsHttpStatus, logEngineFsDebug, claimEngineFsPlayback } = internals;
  const onWebOsAudioTrackSelectionChanged = (event) => {
    const detail = event?.detail || {};
    const status = String(detail?.status || "");
    const existingPending = this.pendingWebOsAudioSelection;
    const samePendingSelection =
      existingPending &&
      existingPending.selectionKind === detail.selectionKind &&
      Number(existingPending.selectedTrackIndex) === Number(detail.selectedTrackIndex);

    if (status === "pending") {
      this.pendingWebOsAudioSelection = {
        ...detail,
        entryId: samePendingSelection ? existingPending.entryId : "",
        automaticFallback: samePendingSelection ? Boolean(existingPending.automaticFallback) : false,
        rememberSelection: samePendingSelection ? Boolean(existingPending.rememberSelection) : false,
        trackPreference: samePendingSelection ? existingPending.trackPreference : null
      };
      this.invalidateTrackDialogCaches();
      this.renderAudioDialog();
      return;
    }

    if (status === "confirmed") {
      const shouldReapplyStartupSubtitlePreference = !this.startupAudioPreferenceApplied;
      if (detail.selectionKind === "embedded") {
        this.selectedEmbeddedAudioTrackIndex = Number(detail.selectedTrackIndex);
        this.selectedAudioTrackIndex = Number(detail.selectedTrackIndex);
      } else {
        this.selectedEmbeddedAudioTrackIndex = -1;
        this.selectedAudioTrackIndex = Number(detail.targetTrackIndex);
      }
      this.pendingWebOsAudioSelection = null;
      this.failedAutomaticAudioFallbackEntryId = "";
      if (samePendingSelection && existingPending.rememberSelection) {
        this.rememberAudioTrackSelection(existingPending.trackPreference);
      }
      if (shouldReapplyStartupSubtitlePreference) {
        this.startupSubtitlePreferenceApplied = false;
      }
      if (this.startupAudioGateActive && existingPending?.automaticFallback) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioPreferenceApplied = true;
      }
      this.refreshTrackDialogs();
      if (this.startupAudioGateActive && this.startupAudioPreferenceApplied) {
        this.scheduleLoadingCompletionCheck(0, { force: true });
      }
      return;
    }

    if (status === "failed") {
      if (samePendingSelection) {
        if (existingPending.automaticFallback) {
          this.failedAutomaticAudioFallbackEntryId = existingPending.entryId || "";
        }
        if (this.startupAudioGateActive) {
          // A failed preferred selection also settles startup on the native default.
          this.clearStartupAudioPreferenceRetry();
          this.startupAudioPreferenceApplied = true;
        }
      }
      this.pendingWebOsAudioSelection = null;
      console.warn("webOS audio track selection failed", detail?.error || detail);
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderAudioDialog();
      if (this.startupAudioGateActive && this.startupAudioPreferenceApplied) {
        this.scheduleLoadingCompletionCheck(0, { force: true });
      }
    }
  };

  const onAvPlaySubtitleChange = (event) => {
    this.renderAvPlaySubtitleChange(event?.detail || {});
  };

  const onError = async (event) => {
    if (this.isStartupErrorVisible()) {
      return;
    }
    this.seekLoading = false;
    this.bufferingActive = false;
    this.seekLoadingBaselineSeconds = null;
    this.seekLoadingTargetSeconds = null;
    const now = Date.now();
    if (now - Number(this.lastPlaybackErrorAt || 0) < 120) {
      return;
    }
    this.lastPlaybackErrorAt = now;

    const detailErrorCode = Number(event?.detail?.mediaErrorCode || 0);
    const controllerErrorCode =
      typeof PlayerController.getLastPlaybackErrorCode === "function" ? Number(PlayerController.getLastPlaybackErrorCode() || 0) : 0;
    const mediaErrorCode = detailErrorCode || Number(video?.error?.code || 0) || controllerErrorCode;
    const eventDetail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const playbackErrorDetail = this.getPlaybackEventErrorDetail(eventDetail);
    const terminalHlsHttpFailure = isTerminalHlsHttpStatus(eventDetail.hlsResponseCode);
    const avplayError = String(eventDetail?.avplayError || "").toLowerCase();
    const normalizedPlaybackErrorDetail = String(playbackErrorDetail || "").toLowerCase();
    const currentSourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
    const serverPlayback = currentSourceCandidate?.serverPlayback || currentSourceCandidate?.raw?.serverPlayback;
    if (serverPlayback?.fallbackRequested && this.tryServerPlaybackFallback?.(currentSourceCandidate)) return;
    const expiredPlaybackUrl = isExpiredStreamUrl(this.activePlaybackUrl);
    const currentEngineFsState = this.currentEngineFsStream || null;
    const publicEngineFsUrl = String(currentEngineFsState?.publicPlaybackUrl || "").trim();
    const isLocalEngineFsNetworkFailure =
      currentEngineFsState?.baseUrlKind === "local-service" &&
      publicEngineFsUrl &&
      publicEngineFsUrl !== this.activePlaybackUrl &&
      (mediaErrorCode === 2 ||
        avplayError.includes("connection refused") ||
        normalizedPlaybackErrorDetail.includes("network") ||
        normalizedPlaybackErrorDetail.includes("failed"));
    if (expiredPlaybackUrl) {
      this.showExpiredStreamError(this.activePlaybackUrl, {
        sourceCandidate: currentSourceCandidate,
        reason: "stream-url-expired-during-playback"
      });
      return;
    }
    if (!this.hasPresentedPlaybackFrame && isLocalEngineFsNetworkFailure) {
      const sourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
      const engineFs = {
        ...(sourceCandidate?.engineFs || currentEngineFsState),
        playbackUrl: publicEngineFsUrl,
        publicPlaybackUrl: publicEngineFsUrl,
        baseUrlKind: "public-fallback"
      };
      if (sourceCandidate) {
        Object.assign(sourceCandidate, {
          url: publicEngineFsUrl,
          externalUrl: null,
          engineFs,
          raw: {
            ...(sourceCandidate.raw || {}),
            engineFs
          }
        });
        this.streamCandidates = this.streamCandidates.map((entry) =>
          entry.id === sourceCandidate.id ? { ...entry, ...sourceCandidate } : entry
        );
      }
      this.lastPlaybackErrorAt = 0;
      this.loadingVisible = true;
      this.paused = false;
      this.sourcesError = null;
      this.currentEngineFsStream = engineFs;
      this.engineFsPlaybackToken = claimEngineFsPlayback(this.currentEngineFsStream);
      this.updateLoadingVisibility();
      console.warn("EngineFS local playback failed; switching to public playback URL", {
        fromBaseUrlKind: currentEngineFsState.baseUrlKind,
        playbackUrl: publicEngineFsUrl,
        mediaErrorCode,
        avplayError
      });
      void this.playStreamByUrl(publicEngineFsUrl, {
        preservePanel: true,
        resetSilentAudioState: false,
        preservePendingRestore: Boolean(this.pendingPlaybackRestore),
        sourceCandidate: sourceCandidate || {
          url: publicEngineFsUrl,
          engineFs
        }
      });
      return;
    }

    if (!this.hasPresentedPlaybackFrame && (mediaErrorCode === 2 || mediaErrorCode === 3 || mediaErrorCode === 4)) {
      if (currentEngineFsState) {
        const stats = await this.fetchCurrentEngineFsStats({ timeoutMs: 2500 });
        if (this.shouldRetryEngineFsStartupError(stats)) {
          this.scheduleEngineFsStartupRetry({ mediaErrorCode, stats });
          return;
        }
      }

      const isActiveTizenAvPlayStartupError =
        !currentEngineFsState &&
        isTizenAvPlayPlayback() &&
        !this.hasPresentedPlaybackFrame &&
        (mediaErrorCode === 2 || mediaErrorCode === 3 || mediaErrorCode === 4);
      if (isActiveTizenAvPlayStartupError) {
        // AVPlay's listener can report an error while the same native session
        // is still able to finish prepare/play. Keep Android's loading-until-
        // playback policy and let the existing startup watchdog decide whether
        // the session is genuinely stuck.
        this.loadingVisible = true;
        this.updateLoadingVisibility();
        if (!this.playbackStallTimer) {
          this.schedulePlaybackStallGuard();
        }
        console.warn("Tizen AVPlay startup error deferred while native session is active", {
          url: this.activePlaybackUrl,
          mediaErrorCode,
          avplayError
        });
        return;
      }

      this.markPlaybackSourceFailed(this.activePlaybackUrl);
      const targetEngine =
        !terminalHlsHttpFailure && typeof PlayerController.getAlternativePlaybackEngine === "function"
          ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
          : null;
      if (targetEngine) {
        this.lastPlaybackErrorAt = 0;
        this.loadingVisible = true;
        this.paused = false;
        this.sourcesError = null;
        this.updateLoadingVisibility();
        console.warn("Playback failed during startup; switching player engine", {
          url: this.activePlaybackUrl,
          mediaErrorCode,
          from: PlayerController.playbackEngine,
          to: targetEngine
        });
        void this.playStreamByUrl(this.activePlaybackUrl, {
          preservePanel: true,
          resetSilentAudioState: false,
          preservePendingRestore: Boolean(this.pendingPlaybackRestore),
          forceEngine: targetEngine
        });
        return;
      }
      this.markPlaybackSourceFailed(this.activePlaybackUrl);
      const startupErrorMessage = this.getStartupErrorMessage(mediaErrorCode, playbackErrorDetail, currentSourceCandidate);
      this.clearPlaybackStallGuard();
      this.releaseStartupAudioGate({ resume: false });
      if (this.tryServerPlaybackFallback?.(currentSourceCandidate)) return;
      this.showStartupError(startupErrorMessage, {
        mediaErrorCode,
        detail: playbackErrorDetail,
        eventDetail,
        streamCandidate: currentSourceCandidate,
        playbackUrl: this.activePlaybackUrl,
        reason: "startup-media-error"
      });
      console.warn("Playback failed during startup", {
        url: this.activePlaybackUrl,
        mediaErrorCode,
        avplayError
      });
      return;
    }

    const isTizenAvPlayConnectionFailure =
      isTizenAvPlayPlayback() &&
      !currentEngineFsState &&
      !terminalHlsHttpFailure &&
      mediaErrorCode === 2 &&
      avplayError === "player_error_connection_failed";
    if (this.hasPresentedPlaybackFrame && isTizenAvPlayConnectionFailure && this.scheduleTizenAvPlayConnectionErrorRetry?.()) {
      return;
    }

    if (this.tryServerPlaybackFallback?.(currentSourceCandidate)) return;
    this.markPlaybackSourceFailed(this.activePlaybackUrl);

    this.clearPlaybackStallGuard();
    this.releaseStartupAudioGate({ resume: false });
    this.loadingVisible = false;
    this.bufferingActive = false;
    this.paused = true;
    this.dismissPauseOverlay();
    this.updateLoadingVisibility();
    this.setControlsVisible(true, { focus: false });
    this.sourcesError = this.formatPlaybackErrorForSources(
      `${this.mediaErrorMessage(mediaErrorCode, playbackErrorDetail, currentSourceCandidate)}. Choose another source manually.`,
      {
        mediaErrorCode,
        detail: playbackErrorDetail,
        eventDetail,
        streamCandidate: currentSourceCandidate,
        playbackUrl: this.activePlaybackUrl,
        reason: "media-error"
      }
    );
    if (this.currentEngineFsStream) {
      logEngineFsDebug("EngineFS playback failed; keeping torrent alive until player exit or source change", {
        reason: "playback-error",
        infoHash: this.currentEngineFsStream.infoHash,
        fileIdx: this.currentEngineFsStream.fileIdx
      });
    }
    // Keep source switching user-initiated after an in-playback failure. Opening
    // the panel here steals focus from the player (notably on webOS) and differs
    // from Android TV, where fatal playback errors do not open Sources.
    this.renderSourcesPanel();

    console.warn("Playback failed", {
      url: this.activePlaybackUrl,
      mediaErrorCode
    });
  };

  return { onWebOsAudioTrackSelectionChanged, onAvPlaySubtitleChange, onError };
}
