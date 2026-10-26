/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods16() {
  const {
    PlayerSettingsStore,
    TorrentSettingsStore,
    Environment,
    normalizePlaybackDisplayLineBreaks,
    t,
    clamp,
    formatBytes,
    formatBytesPerSecond
  } = internals;

  return {
    refreshLoadingOverlayPresentation() {
      const overlay = this.uiRefs?.loadingOverlay;
      if (!overlay) {
        return;
      }
      const loadingMeta = this.getLoadingOverlayMeta();
      const identity = this.uiRefs?.loadingIdentity;
      const logo = this.uiRefs?.loadingLogo;
      const title = this.uiRefs?.loadingTitle;
      const subtitle = this.uiRefs?.loadingSubtitle;
      if (identity) {
        identity.classList.toggle("has-logo", Boolean(loadingMeta.logoUrl));
      }
      if (logo) {
        if (loadingMeta.logoUrl) {
          if (logo.getAttribute("src") !== loadingMeta.logoUrl) {
            logo.setAttribute("src", loadingMeta.logoUrl);
          }
          logo.setAttribute("alt", loadingMeta.title || "logo");
        } else {
          logo.removeAttribute("src");
        }
      }
      if (title) {
        title.textContent = loadingMeta.title || this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Nuvio";
      }
      if (subtitle) {
        subtitle.textContent = loadingMeta.subtitle || "";
        subtitle.classList.toggle("hidden", !loadingMeta.subtitle);
      }
      const backdrop = overlay.querySelector(".player-loading-backdrop");
      if (backdrop instanceof HTMLElement) {
        backdrop.style.backgroundImage = loadingMeta.backdropUrl ? `url('${loadingMeta.backdropUrl.replace(/'/g, "%27")}')` : "";
      }
      this.syncLoadingOverlayStatus();
      this.syncLoadingOverlayProgress();
    },
    getLoadingOverlayProgress(stats = null) {
      const snapshot = stats ? this.getEngineFsStallSnapshot(stats) : null;
      if (!snapshot) {
        return null;
      }
      const directProgress = Number(snapshot.progress);
      if (Number.isFinite(directProgress) && directProgress > 0) {
        if (directProgress <= 1) {
          return clamp(directProgress, 0, 1);
        }
        if (directProgress <= 100) {
          return clamp(directProgress / 100, 0, 1);
        }
      }
      const downloaded = Number(snapshot.downloaded);
      if (Number.isFinite(downloaded) && downloaded > 0) {
        return clamp(downloaded / (4 * 1024 * 1024), 0, 1);
      }
      return null;
    },
    getLoadingOverlayStatusText(stats = null) {
      if (!this.currentEngineFsStream || TorrentSettingsStore.get().hideTorrentStats) {
        return "";
      }
      const snapshot = stats ? this.getEngineFsStallSnapshot(stats) : null;
      if (!snapshot) {
        return "";
      }
      const peers = Number.isFinite(Number(snapshot.peers)) ? Math.max(0, Math.trunc(Number(snapshot.peers))) : 0;
      const seeds = Number.isFinite(Number(snapshot.seeds)) ? Math.max(0, Math.trunc(Number(snapshot.seeds))) : null;
      const peerInfo = seeds != null ? t("player_torrent_peer_info", [seeds, peers], `${seeds} seeds · ${peers} peers`) : `${peers} peers`;
      const speed = formatBytesPerSecond(snapshot.downloadSpeed);
      if (!this.hasPresentedPlaybackFrame) {
        const buffered = formatBytes(snapshot.downloaded) || "0 B";
        return `${buffered} buffered · ${peerInfo}${speed ? ` · ${speed}` : ""}`;
      }
      return `${peerInfo}${speed ? ` · ${speed}` : ""}`;
    },
    getTorrentOverlayData(stats = null) {
      // These TV runtimes expose P2P/EngineFS stats through the runtime,
      // so the overlay stays shared across WebOS and Tizen.
      const supportsP2pStatsOverlay = Environment.isWebOS() || Environment.isTizen();
      if (
        !supportsP2pStatsOverlay ||
        !this.currentEngineFsStream ||
        TorrentSettingsStore.get().hideTorrentStats ||
        this.isExternalFrameMode() ||
        this.error
      ) {
        return null;
      }
      const snapshot = stats ? this.getEngineFsStallSnapshot(stats) : null;
      if (!snapshot) {
        return null;
      }
      const downloadSpeed = formatBytesPerSecond(snapshot.downloadSpeed);
      const uploadSpeed = formatBytesPerSecond(snapshot.uploadSpeed);
      const peers = Number.isFinite(Number(snapshot.peers)) ? Math.max(0, Math.trunc(Number(snapshot.peers))) : 0;
      const seeds = Number.isFinite(Number(snapshot.seeds)) ? Math.max(0, Math.trunc(Number(snapshot.seeds))) : null;
      const progress = Number(snapshot.progress);
      const progressPercent =
        Number.isFinite(progress) && progress > 0 ? (progress <= 1 ? progress * 100 : progress <= 100 ? progress : null) : null;
      const detailText =
        seeds != null && progressPercent != null
          ? t(
              "player_torrent_stats",
              [peers, seeds, Math.round(progressPercent)],
              `${peers} peers · ${seeds} seeds · ${Math.round(progressPercent)}%`
            )
          : progressPercent != null
            ? t(
                "player_torrent_status",
                [`${peers} peers`, `${Math.round(progressPercent)}%`],
                `${peers} peers · ${Math.round(progressPercent)}%`
              )
            : seeds != null
              ? t("player_torrent_peer_info", [seeds, peers], `${seeds} seeds · ${peers} peers`)
              : `${peers} peers`;
      const speedParts = [];
      if (downloadSpeed) {
        speedParts.push(`↓ ${downloadSpeed}`);
      }
      if (uploadSpeed) {
        speedParts.push(`↑ ${uploadSpeed}`);
      }
      return {
        speedText: speedParts.join(" · "),
        detailText
      };
    },
    syncTorrentOverlay() {
      const overlay = this.uiRefs?.torrentOverlay;
      const speedNode = this.uiRefs?.torrentOverlaySpeed;
      const detailNode = this.uiRefs?.torrentOverlayDetail;
      const data = this.torrentOverlayData;
      const visible = Boolean(data);
      if (overlay) {
        overlay.classList.toggle("hidden", !visible);
        overlay.setAttribute("aria-hidden", visible ? "false" : "true");
      }
      if (speedNode) {
        speedNode.textContent = data?.speedText || "";
        speedNode.classList.toggle("hidden", !data?.speedText);
      }
      if (detailNode) {
        detailNode.textContent = data?.detailText || "";
        detailNode.classList.toggle("hidden", !data?.detailText);
      }
    },
    syncLoadingOverlayStatus() {
      const loadingStatus = this.uiRefs?.loadingStatus;
      const bufferingStatus = this.uiRefs?.bufferingStatus;
      const subtitle = this.uiRefs?.loadingSubtitle;
      const statusText = String(this.loadingTorrentStatus || "").trim();
      const hasStatus = Boolean(statusText) && PlayerSettingsStore.get().showPlayerLoadingStatus !== false;
      const hasSubtitle = Boolean(subtitle?.textContent?.trim());
      if (loadingStatus) {
        loadingStatus.textContent = statusText;
        loadingStatus.classList.toggle("hidden", !hasStatus);
      }
      if (bufferingStatus) {
        bufferingStatus.textContent = statusText;
        bufferingStatus.classList.toggle("hidden", !hasStatus);
      }
      if (subtitle) {
        subtitle.classList.toggle("hidden", !hasSubtitle || hasStatus);
      }
    },
    isStartupErrorVisible() {
      return Boolean(String(this.startupErrorMessage || "").trim());
    },
    clearStartupError() {
      this.startupErrorMessage = "";
      this.startupErrorMediaCode = 0;
      this.startupErrorDetails = [];
      this.renderStartupErrorOverlay();
    },
    getPlaybackErrorCodeLabel(mediaErrorCode = 0) {
      const code = Number(mediaErrorCode || 0);
      if (code === 1) return "1 aborted";
      if (code === 2) return "2 network";
      if (code === 3) return "3 decode";
      if (code === 4) return "4 source not supported";
      return code > 0 ? String(code) : "";
    },
    getPlaybackEventErrorDetail(eventDetail = {}) {
      const detail = eventDetail && typeof eventDetail === "object" ? eventDetail : {};
      const hlsResponseCode = Number(detail.hlsResponseCode || 0);
      const avplayErrorDetail =
        detail.avplayErrorDetail && typeof detail.avplayErrorDetail === "object"
          ? JSON.stringify(detail.avplayErrorDetail)
          : detail.avplayErrorDetail;
      return [
        detail.avplayError,
        avplayErrorDetail,
        detail.hlsErrorType,
        detail.hlsErrorDetails,
        hlsResponseCode >= 400 && hlsResponseCode <= 599 ? `HTTP ${hlsResponseCode}` : "",
        detail.dashError,
        detail.playbackEngine
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
    },
    getHttpPlaybackErrorMessage(statusCode = 0) {
      const status = Number(statusCode || 0);
      if (status < 400 || status > 599) {
        return "";
      }
      const providerHint =
        status === 401 || status === 410
          ? t("player_error_stream_expired", {}, "\n\nThe stream link has expired. Try a different source.")
          : status === 404
            ? t("player_error_stream_removed", {}, "\n\nThe stream link has expired or been removed. Try a different source.")
            : status === 429
              ? t("player_error_stream_rate_limited", {}, "\n\nToo many requests to the stream source. Wait a moment and try again.")
              : status >= 500
                ? t("player_error_stream_unavailable", {}, "\n\nThe stream server is currently unavailable. Try a different source.")
                : t("player_error_stream_blocked", {}, "\n\nThe stream source is blocked or restricted. Try a different source.");
      return `HTTP ${status}${normalizePlaybackDisplayLineBreaks(providerHint)}`;
    },
    showExpiredStreamError(
      playbackUrl = this.activePlaybackUrl,
      { sourceCandidate: explicitSourceCandidate = null, reason = "stream-url-expired" } = {}
    ) {
      const normalizedUrl = String(playbackUrl || "").trim();
      const sourceCandidate = explicitSourceCandidate || this.getStreamCandidateByUrl(normalizedUrl) || this.getCurrentStreamCandidate();
      const message = t("player_error_stream_expired", {}, "The stream link has expired. Try a different source.");
      this.markPlaybackSourceFailed(normalizedUrl, sourceCandidate);
      const currentPlaybackUrl = String(this.activePlaybackUrl || "").trim();
      const hasDifferentActivePlayback = this.hasPresentedPlaybackFrame && normalizedUrl && currentPlaybackUrl !== normalizedUrl;
      if (!hasDifferentActivePlayback) {
        this.clearPlaybackStallGuard();
        this.releaseStartupAudioGate({ resume: false });
      }
      if (!this.hasPresentedPlaybackFrame || !hasDifferentActivePlayback) {
        if (!this.hasPresentedPlaybackFrame) {
          this.showStartupError(message, {
            streamCandidate: sourceCandidate,
            playbackUrl: normalizedUrl,
            reason
          });
        } else {
          this.loadingVisible = false;
          this.bufferingActive = false;
          this.paused = true;
          this.dismissPauseOverlay();
          this.updateLoadingVisibility();
          this.updateMediaSessionPlaybackState();
          this.setControlsVisible(true, { focus: false });
          this.sourcesError = this.formatPlaybackErrorForSources(message, {
            streamCandidate: sourceCandidate,
            playbackUrl: normalizedUrl,
            reason
          });
          this.renderSourcesPanel();
          this.updateUiTick();
        }
      } else {
        // A user can select an already expired source while another source is
        // still playing. Keep the active playback untouched and only report the
        // rejected candidate in the source panel.
        this.sourcesError = this.formatPlaybackErrorForSources(message, {
          streamCandidate: sourceCandidate,
          playbackUrl: normalizedUrl,
          reason
        });
        this.renderSourcesPanel();
      }

      console.warn("Playback source URL has expired; refusing to retry it", {
        url: normalizedUrl,
        reason
      });
    }
  };
}
