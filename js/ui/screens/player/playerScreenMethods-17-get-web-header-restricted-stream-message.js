/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods17() {
  const { PlayerController, Environment, t, cleanPlaybackDiagnosticValue, pushPlaybackDiagnosticLine, extractPlaybackHttpStatus } =
    internals;

  return {
    resolvePlaybackHttpStatus(detail = "") {
      const fromDetail = extractPlaybackHttpStatus(detail);
      if (fromDetail) {
        return fromDetail;
      }
      // Recovered HLS errors remain cached; only use a terminated HLS failure.
      const diagnostic = PlayerController.getLastHlsErrorDiagnostic?.();
      if (PlayerController.playbackEngine !== "hls.js" || PlayerController.hlsInstance || !diagnostic?.fatal) {
        return 0;
      }
      return extractPlaybackHttpStatus(PlayerController.getLastHlsErrorDetail?.());
    },
    getWebHeaderRestrictedStreamMessage(streamCandidate = this.getCurrentStreamCandidate()) {
      const candidate = streamCandidate || {};
      const raw = candidate?.raw || {};
      const rawBehaviorHints = raw?.behaviorHints || {};
      const candidateBehaviorHints = candidate?.behaviorHints || {};
      const requestHeaders = rawBehaviorHints?.proxyHeaders?.request || candidateBehaviorHints?.proxyHeaders?.request;
      const notWebReadyValue = rawBehaviorHints?.notWebReady ?? candidateBehaviorHints?.notWebReady;
      const notWebReady =
        notWebReadyValue === true ||
        String(notWebReadyValue || "")
          .trim()
          .toLowerCase() === "true";
      const hasRequiredHeaders =
        requestHeaders &&
        typeof requestHeaders === "object" &&
        Object.entries(requestHeaders).some(([name, value]) => String(name || "").trim() && String(value ?? "").trim());
      if (!notWebReady || !hasRequiredHeaders) {
        return "";
      }
      return t(
        "player_error_web_headers_unsupported",
        {},
        "This source is not compatible with this device's player because it requires special request headers. Try a different source or contact the add-on provider."
      );
    },
    getPlaybackErrorDetailLines({
      mediaErrorCode = 0,
      detail = "",
      error = null,
      eventDetail = null,
      streamCandidate = null,
      playbackUrl = "",
      reason = "",
      resolverStatus = "",
      resolverDetail = ""
    } = {}) {
      const lines = [];
      const video = PlayerController.video || null;
      const candidate =
        streamCandidate || this.getStreamCandidateByUrl(playbackUrl || this.activePlaybackUrl) || this.getCurrentStreamCandidate();
      const raw = candidate?.raw || {};
      const requestHeaders = raw?.behaviorHints?.proxyHeaders?.request || candidate?.behaviorHints?.proxyHeaders?.request || null;
      const headerNames =
        requestHeaders && typeof requestHeaders === "object" ? Object.keys(requestHeaders).filter(Boolean).join(", ") : "";
      const engineFs = candidate?.engineFs || raw?.engineFs || this.currentEngineFsStream || null;
      const mediaError = video?.error || null;
      const eventErrorDetail = this.getPlaybackEventErrorDetail(eventDetail);
      const avplaySnapshot = eventDetail?.avplaySnapshot || PlayerController.getAvPlayDiagnosticSnapshot?.() || null;
      const avplayErrorDiagnostic = eventDetail?.avplayErrorDetail || PlayerController.getLastAvPlayErrorDiagnostic?.() || null;
      const rememberedHlsError =
        typeof PlayerController.getLastHlsErrorDetail === "function" ? PlayerController.getLastHlsErrorDetail() : "";
      const httpStatus = extractPlaybackHttpStatus(
        [detail, eventErrorDetail, rememberedHlsError, error?.message, error?.name, error?.errorText, error?.status]
          .filter(Boolean)
          .join(" ")
      );
      const runtimeDetail = detail || eventErrorDetail || error?.message || error?.name || error?.errorText || error?.status || "";
      const sourceLabel = [candidate?.addonName, candidate?.name || candidate?.title || candidate?.description, candidate?.id]
        .filter(Boolean)
        .join(" / ");
      const sourceType = [candidate?.mimeType, raw?.mimeType, candidate?.sourceType, raw?.sourceType, raw?.type].find(Boolean);
      const activeUrl =
        playbackUrl || this.activePlaybackUrl || candidate?.url || candidate?.externalUrl || raw?.url || raw?.externalUrl || "";

      pushPlaybackDiagnosticLine(lines, "Platform", Environment.isWebOS() ? "webOS" : Environment.isTizen() ? "Tizen" : "browser");
      pushPlaybackDiagnosticLine(lines, "Reason", reason);
      pushPlaybackDiagnosticLine(lines, "Media code", this.getPlaybackErrorCodeLabel(mediaErrorCode));
      pushPlaybackDiagnosticLine(lines, "HTTP status", httpStatus);
      pushPlaybackDiagnosticLine(lines, "Runtime error", runtimeDetail);
      pushPlaybackDiagnosticLine(lines, "HLS error", eventDetail?.hlsErrorDetails || eventDetail?.hlsErrorType || rememberedHlsError, 420);
      pushPlaybackDiagnosticLine(lines, "DASH error", eventDetail?.dashError);
      pushPlaybackDiagnosticLine(lines, "AVPlay error", eventDetail?.avplayError);
      pushPlaybackDiagnosticLine(
        lines,
        "AVPlay error detail",
        avplayErrorDiagnostic && typeof avplayErrorDiagnostic === "object" ? JSON.stringify(avplayErrorDiagnostic) : avplayErrorDiagnostic,
        600
      );
      pushPlaybackDiagnosticLine(lines, "AVPlay state", avplaySnapshot?.state);
      pushPlaybackDiagnosticLine(lines, "AVPlay current time ms", avplaySnapshot?.currentTimeMs);
      pushPlaybackDiagnosticLine(lines, "AVPlay duration ms", avplaySnapshot?.durationMs);
      pushPlaybackDiagnosticLine(
        lines,
        "AVPlay buffering",
        avplaySnapshot?.buffering == null ? "" : String(Boolean(avplaySnapshot.buffering))
      );
      pushPlaybackDiagnosticLine(lines, "AVPlay buffering duration ms", avplaySnapshot?.bufferingDurationMs);
      pushPlaybackDiagnosticLine(
        lines,
        "AVPlay buffering progress",
        avplaySnapshot?.bufferingProgress == null ? "" : `${avplaySnapshot.bufferingProgress}%`
      );
      pushPlaybackDiagnosticLine(lines, "AVPlay current bandwidth", avplaySnapshot?.currentBandwidth);
      pushPlaybackDiagnosticLine(lines, "AVPlay available bitrate", avplaySnapshot?.availableBitrate);
      pushPlaybackDiagnosticLine(
        lines,
        "AVPlay audio tracks",
        avplaySnapshot?.audioTracks?.length ? JSON.stringify(avplaySnapshot.audioTracks) : "",
        900
      );
      pushPlaybackDiagnosticLine(
        lines,
        "AVPlay current streams",
        avplaySnapshot?.currentStreams?.length ? JSON.stringify(avplaySnapshot.currentStreams) : "",
        1200
      );
      pushPlaybackDiagnosticLine(lines, "HTML media error", mediaError?.message || mediaError?.code);
      pushPlaybackDiagnosticLine(lines, "Video readyState", video?.readyState);
      pushPlaybackDiagnosticLine(lines, "Video networkState", video?.networkState);
      pushPlaybackDiagnosticLine(lines, "Current src", video?.currentSrc || video?.src, 420);
      pushPlaybackDiagnosticLine(lines, "Playback engine", PlayerController.playbackEngine || "unknown");
      pushPlaybackDiagnosticLine(lines, "Source", sourceLabel);
      pushPlaybackDiagnosticLine(lines, "Source type", sourceType);
      pushPlaybackDiagnosticLine(lines, "URL", activeUrl, 420);
      pushPlaybackDiagnosticLine(lines, "Proxy header names", headerNames);
      pushPlaybackDiagnosticLine(lines, "Resolver status", resolverStatus);
      pushPlaybackDiagnosticLine(lines, "Resolver detail", resolverDetail);
      if (engineFs) {
        pushPlaybackDiagnosticLine(lines, "EngineFS infoHash", engineFs.infoHash);
        pushPlaybackDiagnosticLine(lines, "EngineFS fileIdx", engineFs.fileIdx);
        pushPlaybackDiagnosticLine(lines, "EngineFS base", engineFs.baseUrlKind);
        pushPlaybackDiagnosticLine(lines, "EngineFS playbackUrl", engineFs.playbackUrl || engineFs.url, 420);
        pushPlaybackDiagnosticLine(lines, "EngineFS publicUrl", engineFs.publicPlaybackUrl, 420);
      }
      return lines;
    },
    formatPlaybackErrorForSources(message = "", options = {}) {
      const baseMessage = String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
      const detailLines = this.getPlaybackErrorDetailLines(options);
      return detailLines.length ? `${baseMessage}\n\nDetails\n${detailLines.join("\n")}` : baseMessage;
    },
    showStartupError(
      message = "",
      {
        mediaErrorCode = 0,
        detail = "",
        error = null,
        eventDetail = null,
        streamCandidate = null,
        playbackUrl = "",
        reason = "",
        resolverStatus = "",
        resolverDetail = "",
        details = null
      } = {}
    ) {
      this.startupErrorMessage = String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
      this.startupErrorMediaCode = Number(mediaErrorCode || 0);
      this.startupErrorDetails = Array.isArray(details)
        ? details.map((line) => cleanPlaybackDiagnosticValue(line)).filter(Boolean)
        : this.getPlaybackErrorDetailLines({
            mediaErrorCode,
            detail,
            error,
            eventDetail,
            streamCandidate,
            playbackUrl,
            reason,
            resolverStatus,
            resolverDetail
          });
      this.lastPlaybackErrorAt = 0;
      this.loadingVisible = false;
      this.bufferingActive = false;
      this.loadingProgress = null;
      this.loadingTorrentStatus = "";
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      this.clearPlaybackStallGuard();
      this.clearBufferingSpinnerTimer();
      this.releaseStartupAudioGate({ resume: false });
      this.sourcesLoading = false;
      this.sourcesError = "";
      this.sourcesPanelVisible = false;
      this.clearSubtitleDelayOverlayTimer();
      this.subtitleDialogVisible = false;
      this.subtitleDelayOverlayVisible = false;
      this.subtitleTimingDialogVisible = false;
      this.resetSubtitleAutoSyncState();
      this.resetAutomaticSubtitleSyncState({ resetStartupKey: true });
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.episodePanelVisible = false;
      this.moreActionsVisible = false;
      this.seekOverlayVisible = false;
      this.seekPreviewSeconds = null;
      this.pauseOverlayVisible = false;
      this.updateLoadingVisibility();
      this.renderControlButtons();
      this.renderSourcesPanel();
      this.renderSubtitleDialog();
      this.renderSubtitleDelayOverlay();
      this.renderSubtitleTimingDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderEpisodePanel();
      this.renderPauseOverlay();
      this.renderStartupErrorOverlay();
      this.focusStartupErrorButton();
    }
  };
}
