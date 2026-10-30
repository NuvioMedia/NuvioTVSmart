/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods38() {
  const {
    PlayerController,
    isRecoverableHlsFragmentTimeout,
    isExpiredStreamUrl,
    isTerminalHlsHttpStatus,
    Environment,
    WEBOS_NATIVE_STARTUP_LOADING_EXTENSION_MS,
    WEBOS_HLS_PLAYBACK_RECOVERY_MAX_ATTEMPTS,
    logEngineFsDebug,
    t
  } = internals;

  return {
    schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {}) {
      this.clearPlaybackStallGuard();
      if (this.isExternalFrameMode() || !this.activePlaybackUrl) {
        return;
      }
      const startup = !this.hasPresentedPlaybackFrame;
      const timeoutMs =
        Number.isFinite(Number(timeoutOverrideMs)) && Number(timeoutOverrideMs) > 0
          ? Number(timeoutOverrideMs)
          : this.getPlaybackStallTimeoutMs({ startup });
      this.playbackStallTimer = setTimeout(async () => {
        this.playbackStallTimer = null;
        if (this.isExternalFrameMode() || !this.loadingVisible || !this.activePlaybackUrl) {
          return;
        }

        const readyState =
          typeof PlayerController.getPlaybackReadyState === "function"
            ? Number(PlayerController.getPlaybackReadyState() || 0)
            : Number(PlayerController.video?.readyState || 0);
        if (startup) {
          if (this.markPlaybackPresentedAfterAdvance()) {
            this.loadingVisible = false;
            this.updateLoadingVisibility();
            this.updateUiTick();
            return;
          }
          if (!Environment.isWebOS() && (readyState >= 3 || (this.currentEngineFsStream && this.isEngineFsStartupReady()))) {
            this.schedulePlaybackStallGuard({ timeoutMs: 1000 });
            return;
          }
        }
        if (readyState >= 3 && !startup) {
          this.loadingVisible = false;
          this.updateLoadingVisibility();
          this.updateUiTick();
          return;
        }

        if (startup && this.currentEngineFsStream) {
          const stats = await this.fetchCurrentEngineFsStats();
          if (!stats && Environment.isWebOS() && this.scheduleEngineFsStartupRetry({ mediaErrorCode: 0, stats: null })) {
            return;
          }
          if (this.shouldDeferEngineFsStartupStall(stats)) {
            this.engineFsStallExtensions = Number(this.engineFsStallExtensions || 0) + 1;
            logEngineFsDebug("EngineFS startup still buffering; extending stall guard", {
              playbackUrl: this.activePlaybackUrl,
              extension: this.engineFsStallExtensions,
              stats: this.lastEngineFsStallStats
            });
            this.schedulePlaybackStallGuard({ timeoutMs: 12000 });
            return;
          }
        }

        const startupMediaErrorCode = Number(PlayerController.getLastPlaybackErrorCode?.() || 0);
        const networkState = Number(PlayerController.video?.networkState ?? 0);
        const startupHlsError =
          startup && typeof PlayerController.getLastHlsErrorDetail === "function" ? PlayerController.getLastHlsErrorDetail() : "";
        const lastHlsErrorDiagnostic =
          typeof PlayerController.getLastHlsErrorDiagnostic === "function" ? PlayerController.getLastHlsErrorDiagnostic() : null;
        const terminalHlsHttpStatus = Number(lastHlsErrorDiagnostic?.responseCode || 0);
        const terminalHlsHttpFailure = isTerminalHlsHttpStatus(terminalHlsHttpStatus);
        const terminalHlsErrorDetail = terminalHlsHttpFailure ? "HTTP " + terminalHlsHttpStatus : "";
        if (isExpiredStreamUrl(this.activePlaybackUrl)) {
          this.showExpiredStreamError(this.activePlaybackUrl, {
            sourceCandidate: this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate(),
            reason: "stream-url-expired-during-stall"
          });
          return;
        }
        if (startup) {
          console.warn("[Nuvio playback] startup stall", {
            engine: String(PlayerController.playbackEngine || "unknown"),
            readyState,
            networkState,
            mediaErrorCode: startupMediaErrorCode || null,
            hlsError: startupHlsError || null
          });
        }
        if (
          startup &&
          Environment.isWebOS() &&
          !this.currentEngineFsStream &&
          String(PlayerController.playbackEngine || "") === "native-file" &&
          startupMediaErrorCode === 0 &&
          readyState === 0 &&
          networkState === 2 &&
          !this.webOsNativeStartupLoadingExtended
        ) {
          this.webOsNativeStartupLoadingExtended = true;
          console.info("webOS native playback is still loading; extending the startup stall guard", {
            url: this.activePlaybackUrl,
            timeoutMs: WEBOS_NATIVE_STARTUP_LOADING_EXTENSION_MS
          });
          this.schedulePlaybackStallGuard({
            timeoutMs: WEBOS_NATIVE_STARTUP_LOADING_EXTENSION_MS
          });
          return;
        }

        const currentPlaybackEngine = String(PlayerController.playbackEngine || "");
        const playbackEngineValidated = !startup && this.isPlaybackEngineValidated();
        let skipAutomaticPlaybackRecovery = false;

        if (playbackEngineValidated) {
          if (this.recoverValidatedPlaybackOnStall()) {
            return;
          }
          // The current engine has already proven that it can play this source.
          // Do not switch engines after a later rebuffer; let the existing error
          // presentation handle a failed same-engine recovery.
          skipAutomaticPlaybackRecovery = true;
        }

        const recoverableHlsPlaybackStall =
          !startup &&
          !playbackEngineValidated &&
          Environment.isWebOS() &&
          currentPlaybackEngine === "hls.js" &&
          isRecoverableHlsFragmentTimeout(lastHlsErrorDiagnostic);
        const sameEngineHlsRecoveryPending =
          !startup &&
          !playbackEngineValidated &&
          Environment.isWebOS() &&
          currentPlaybackEngine === "hls.js" &&
          (recoverableHlsPlaybackStall || this.playbackRecoveryActive);
        // Match Android's post-first-frame rebuffer behavior: keep the current
        // playback engine for a transient network timeout and bound the retry.
        if (sameEngineHlsRecoveryPending) {
          if (Number(this.playbackRecoveryAttempts || 0) < WEBOS_HLS_PLAYBACK_RECOVERY_MAX_ATTEMPTS) {
            const stalledPlaybackUrl = this.activePlaybackUrl;
            const sourceCandidate = this.getStreamCandidateByUrl(stalledPlaybackUrl) || this.getCurrentStreamCandidate();
            const recoveryAttempt = Number(this.playbackRecoveryAttempts || 0) + 1;
            this.playbackRecoveryAttempts = recoveryAttempt;
            this.playbackRecoveryActive = true;
            console.warn("webOS HLS playback stalled; retrying the current hls.js engine", {
              url: stalledPlaybackUrl,
              engine: currentPlaybackEngine,
              attempt: recoveryAttempt,
              limit: WEBOS_HLS_PLAYBACK_RECOVERY_MAX_ATTEMPTS,
              hlsError: lastHlsErrorDiagnostic?.details || null
            });
            this.resetPlaybackEngineValidation();
            void this.playStreamByUrl(stalledPlaybackUrl, {
              preservePanel: true,
              preservePlaybackState: true,
              resetSilentAudioState: false,
              preservePlaybackRecoveryState: true,
              forceEngine: "hls.js",
              sourceCandidate
            });
            return;
          }
          this.playbackRecoveryActive = false;
          skipAutomaticPlaybackRecovery = true;
        }

        const targetEngine =
          !playbackEngineValidated && !terminalHlsHttpFailure && typeof PlayerController.getAlternativePlaybackEngine === "function"
            ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
            : null;
        if (targetEngine && !skipAutomaticPlaybackRecovery) {
          console.warn("Playback stalled; switching player engine", {
            url: this.activePlaybackUrl,
            from: PlayerController.playbackEngine,
            to: targetEngine
          });
          void this.playStreamByUrl(this.activePlaybackUrl, {
            preservePlaybackState: true,
            resetSilentAudioState: false,
            forceEngine: targetEngine
          });
          return;
        }

        if (
          startup &&
          Environment.isWebOS() &&
          !this.currentEngineFsStream &&
          String(PlayerController.playbackEngine || "") === "native-file" &&
          startupMediaErrorCode === 0 &&
          !startupHlsError &&
          readyState >= 3 &&
          networkState === 2 &&
          Number(this.webOsNativeReadyStartupRetries || 0) < 1
        ) {
          this.webOsNativeReadyStartupRetries = Number(this.webOsNativeReadyStartupRetries || 0) + 1;
          const stalledPlaybackUrl = this.activePlaybackUrl;
          const sourceCandidate = this.getStreamCandidateByUrl(stalledPlaybackUrl) || this.getCurrentStreamCandidate();
          console.warn("webOS native playback is ready but has not started; retrying the current source once", {
            engine: PlayerController.playbackEngine,
            readyState,
            networkState
          });
          void this.playStreamByUrl(stalledPlaybackUrl, {
            preservePanel: true,
            preservePlaybackState: true,
            resetSilentAudioState: false,
            preserveStartupRecoveryState: true,
            sourceCandidate
          });
          return;
        }

        if (this.tryServerPlaybackFallback?.()) return;
        this.releaseStartupAudioGate({ resume: false });
        if (startup) {
          this.markPlaybackSourceFailed(this.activePlaybackUrl);
          const mediaErrorCode = startupMediaErrorCode;
          const sourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
          const startupErrorMessage = this.getStartupErrorMessage(mediaErrorCode, terminalHlsErrorDetail, sourceCandidate);
          this.showStartupError(startupErrorMessage, {
            mediaErrorCode,
            detail: terminalHlsErrorDetail,
            streamCandidate: sourceCandidate,
            playbackUrl: this.activePlaybackUrl,
            reason: "startup-stall"
          });
          if (this.currentEngineFsStream) {
            logEngineFsDebug("EngineFS playback stalled during startup; keeping torrent alive until player exit or source change", {
              reason: "playback-stall",
              infoHash: this.currentEngineFsStream.infoHash,
              fileIdx: this.currentEngineFsStream.fileIdx
            });
          }
          return;
        }

        if (Environment.isWebOS() && !skipAutomaticPlaybackRecovery) {
          const stalledPlaybackUrl = this.activePlaybackUrl;
          const sourceCandidate = this.getStreamCandidateByUrl(stalledPlaybackUrl) || this.getCurrentStreamCandidate();
          console.warn("Playback stalled on webOS; restarting the current source", {
            url: stalledPlaybackUrl,
            engine: PlayerController.playbackEngine
          });
          void this.playStreamByUrl(stalledPlaybackUrl, {
            preservePlaybackState: true,
            resetSilentAudioState: false,
            sourceCandidate
          });
          return;
        }

        this.loadingVisible = false;
        this.paused = true;
        this.dismissPauseOverlay();
        this.updateLoadingVisibility();
        this.updateMediaSessionPlaybackState();
        this.setControlsVisible(true, { focus: false });
        {
          const sourceCandidate = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
          const mediaErrorCode = Number(PlayerController.getLastPlaybackErrorCode?.() || 0);
          this.sourcesError = this.formatPlaybackErrorForSources(
            `${this.mediaErrorMessage(mediaErrorCode, terminalHlsErrorDetail, sourceCandidate)}. Choose another source manually.`,
            {
              mediaErrorCode,
              detail: terminalHlsErrorDetail,
              streamCandidate: sourceCandidate,
              playbackUrl: this.activePlaybackUrl,
              reason: "playback-stall"
            }
          );
        }
        if (this.currentEngineFsStream) {
          logEngineFsDebug("EngineFS playback stalled; keeping torrent alive until player exit or source change", {
            reason: "playback-stall",
            infoHash: this.currentEngineFsStream.infoHash,
            fileIdx: this.currentEngineFsStream.fileIdx
          });
        }
        if (this.currentEngineFsStream) {
          this.renderSourcesPanel();
        } else if (this.streamCandidates.length > 1) {
          this.openSourcesPanel();
        } else {
          this.renderSourcesPanel();
        }
        this.updateUiTick();
      }, timeoutMs);
    },
    getSubtitleTabs() {
      return [
        { id: "builtIn", label: t("subtitle_tab_builtin", {}, "Built-in") },
        { id: "addons", label: t("subtitle_tab_addons", {}, "Addons") },
        { id: "style", label: t("subtitle_tab_style", {}, "Style") },
        { id: "delay", label: t("subtitle_tab_delay", {}, "Delay") }
      ];
    }
  };
}
