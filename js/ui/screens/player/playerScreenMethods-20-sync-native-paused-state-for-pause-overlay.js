/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods20() {
  const {
    PlayerController,
    hasEpisodeAiredRule,
    resolvePlaybackSourceName,
    MAX_PAUSE_OVERLAY_CAST,
    t,
    escapeHtml,
    escapeAttribute,
    episodeThumbnailUrl
  } = internals;

  return {
    isBufferingForPauseOverlay() {
      const video = PlayerController.video;
      const readyState =
        typeof PlayerController.getPlaybackReadyState === "function"
          ? Number(PlayerController.getPlaybackReadyState() || 0)
          : Number(video?.readyState || 0);
      return Boolean(
        this.loadingVisible ||
        this.bufferingActive ||
        this.seekLoading ||
        this.pendingPlaybackRestore ||
        this.startupAudioGateActive ||
        video?.seeking ||
        readyState < 3 ||
        PlayerController.isWebOsDtsAudioBuffering?.() ||
        PlayerController.webOsDtsAudioState?.cancelReload
      );
    },
    syncNativePausedStateForPauseOverlay() {
      if (
        this.isExternalFrameMode() ||
        this.isBufferingForPauseOverlay() ||
        this.startupAudioGateActive ||
        (typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay())
      ) {
        return false;
      }

      const video = PlayerController.video;
      if (!video?.paused) {
        return false;
      }

      const readyState =
        typeof PlayerController.getPlaybackReadyState === "function"
          ? Number(PlayerController.getPlaybackReadyState() || 0)
          : Number(video.readyState || 0);
      if (readyState < 3) {
        return false;
      }

      const ended = typeof PlayerController.isPlaybackEnded === "function" ? PlayerController.isPlaybackEnded() : Boolean(video.ended);
      if (ended) {
        return false;
      }

      const wasPaused = Boolean(this.paused);
      if (!wasPaused) {
        this.clearPlaybackStallGuard();
        this.paused = true;
        this.updateMediaSessionPlaybackState();
        this.setControlsVisible(true, { focus: false });
        this.renderControlButtons();
      }

      if (this.canShowPauseOverlay() && !this.pauseOverlayVisible && !this.pauseOverlayTimer) {
        this.schedulePauseOverlay();
        return true;
      }

      return !wasPaused;
    },
    dismissPauseOverlay({ revealControls = false, focus = false } = {}) {
      this.clearPauseOverlayTimer();
      if (!this.pauseOverlayVisible && !revealControls) {
        return;
      }
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      if (revealControls && !this.loadingVisible) {
        this.setControlsVisible(true, { focus });
      }
    },
    schedulePauseOverlay() {
      this.clearPauseOverlayTimer();
      if (!this.canShowPauseOverlay()) {
        this.pauseOverlayVisible = false;
        this.renderPauseOverlay();
        return;
      }
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      this.pauseOverlayTimer = setTimeout(() => {
        this.pauseOverlayTimer = null;
        if (!this.canShowPauseOverlay()) {
          return;
        }
        this.pauseOverlayVisible = true;
        this.renderPauseOverlay();
      }, this.pauseOverlayDelayMs);
    },
    syncPauseOverlayState() {
      if (this.syncNativePausedStateForPauseOverlay()) {
        return;
      }
      if (this.pauseOverlayVisible && !this.canShowPauseOverlay()) {
        this.dismissPauseOverlay();
        return;
      }
      if (!this.pauseOverlayVisible && this.pauseOverlayTimer && !this.canShowPauseOverlay()) {
        this.clearPauseOverlayTimer();
      }
    },
    renderPauseOverlay() {
      const overlay = this.uiRefs?.pauseOverlay;
      const controlsOverlay = this.uiRefs?.controlsOverlay;
      if (!overlay) {
        return;
      }
      const hidden = !this.pauseOverlayVisible || this.isBufferingForPauseOverlay();
      overlay.classList.toggle("hidden", hidden);
      overlay.classList.toggle("is-still-watching", Boolean(this.stillWatchingPromptVisible));
      controlsOverlay?.classList.toggle("pause-overlay-active", !hidden);
      if (hidden) {
        return;
      }

      const clockText = String(this.lastUiTickState?.clockText || this.uiRefs?.clock?.textContent || "--:--").trim() || "--:--";
      if (this.stillWatchingPromptVisible) {
        const nextEpisode = this.resolveNextEpisodeInfo();
        const titleLine = [nextEpisode?.episodeLabel, nextEpisode?.episodeTitle].filter(Boolean).join(" • ");
        const episode = this.episodes.find((entry) => String(entry?.id || "") === String(nextEpisode?.videoId || ""));
        const thumbnail = episodeThumbnailUrl(episode);
        overlay.innerHTML = `
            <div class="player-pause-overlay-content player-still-watching-content">
              ${thumbnail ? `<img class="player-still-watching-thumb" src="${escapeAttribute(thumbnail)}" alt="" aria-hidden="true" />` : ""}
              <div class="player-still-watching-copy">
                <div class="player-still-watching-kicker">${escapeHtml(t("still_watching_title", {}, "Are you still watching?"))}</div>
                <div class="player-still-watching-title">${escapeHtml(titleLine || t("next_episode_label", {}, "Next episode"))}</div>
                <div class="player-still-watching-status">${escapeHtml(t("still_watching_countdown", [this.stillWatchingPromptCountdownSec], "Stopping in %1$s"))}</div>
              </div>
              <div class="player-still-watching-actions">
                <button class="player-still-watching-btn focusable${this.stillWatchingPromptFocus === "continue" ? " focused" : ""}" type="button" tabindex="-1" data-player-pointer-action="stillWatchingContinue"><span class="player-still-watching-btn-icon" aria-hidden="true">&#9654;</span><span>${escapeHtml(t("still_watching_continue", {}, "Play"))}</span></button>
                <button class="player-still-watching-btn focusable is-secondary${this.stillWatchingPromptFocus === "exit" ? " focused" : ""}" type="button" tabindex="-1" data-player-pointer-action="stillWatchingExit"><span class="player-still-watching-btn-icon" aria-hidden="true">&#10005;</span><span>${escapeHtml(t("still_watching_exit", {}, "Exit"))}</span></button>
              </div>
            </div>
          `;
        if (this.stillWatchingPromptFocusArmed) {
          this.stillWatchingPromptFocusArmed = false;
          setTimeout(() => {
            const focusTarget = overlay.querySelector("[data-player-pointer-action='stillWatchingContinue']");
            focusTarget?.focus?.();
          }, 0);
        }
        return;
      }

      const meta = this.pauseOverlayMeta || this.buildPauseOverlayMeta();
      const castItems = Array.isArray(meta.cast) ? meta.cast.slice(0, MAX_PAUSE_OVERLAY_CAST) : [];
      overlay.innerHTML = `
          ${!this.isLivePlayback() ? `<div class="player-pause-overlay-top"><div class="player-pause-overlay-clock">${escapeHtml(clockText)}</div></div>` : ""}
          <div class="player-pause-overlay-shade"></div>
          <div class="player-pause-overlay-content">
            <div class="player-pause-kicker">${escapeHtml(t("pause_you_are_watching", {}, "You're watching"))}</div>
            ${meta.logoUrl ? `<img class="player-pause-logo" src="${escapeAttribute(meta.logoUrl)}" alt="${escapeAttribute(meta.title)}" />` : `<div class="player-pause-title">${escapeHtml(meta.title)}</div>`}
            ${meta.releaseYear || meta.episodeCode ? `<div class="player-pause-meta-line">${escapeHtml([meta.releaseYear, meta.episodeCode].filter(Boolean).join(" • "))}</div>` : ""}
            ${meta.episodeTitle ? `<div class="player-pause-episode-title">${escapeHtml(meta.episodeTitle)}</div>` : ""}
            ${meta.description ? `<div class="player-pause-description">${escapeHtml(meta.description)}</div>` : ""}
            ${
              castItems.length
                ? `
              <div class="player-pause-cast-section">
                <div class="player-pause-cast-label">${escapeHtml(t("pause_cast_label", {}, "Cast"))}</div>
                <div class="player-pause-cast-row">
                  ${castItems
                    .map(
                      (member) => `
                    <div class="player-pause-cast-chip">
                      <span>${escapeHtml(member.name || "")}</span>
                    </div>
                  `
                    )
                    .join("")}
                </div>
              </div>
            `
                : ""
            }
          </div>
        `;
    },
    clearStillWatchingPromptTimer() {
      if (this.stillWatchingPromptTimer) {
        clearInterval(this.stillWatchingPromptTimer);
        this.stillWatchingPromptTimer = null;
      }
    },
    resetStillWatchingPromptState({ render = true } = {}) {
      this.clearStillWatchingPromptTimer();
      this.stillWatchingPromptVisible = false;
      this.stillWatchingPromptCountdownSec = 0;
      this.stillWatchingPromptFocusArmed = false;
      this.stillWatchingPromptFocus = "continue";
      if (render) {
        this.renderPauseOverlay();
      }
    },
    enterStillWatchingPromptMode() {
      if (this.stillWatchingPromptVisible || this.nextEpisodeLaunching) {
        return;
      }
      const nextEpisode = this.resolveNextEpisodeInfo();
      if (!nextEpisode?.hasAired) {
        return;
      }

      this.clearStillWatchingPromptTimer();
      this.stillWatchingPromptVisible = true;
      this.stillWatchingPromptCountdownSec = 60;
      this.stillWatchingPromptFocusArmed = true;
      this.stillWatchingPromptFocus = "continue";
      PlayerController.pause();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(false, { focus: false });
      this.pauseOverlayVisible = true;
      this.renderPauseOverlay();

      this.stillWatchingPromptTimer = setInterval(() => {
        if (!this.stillWatchingPromptVisible) {
          this.clearStillWatchingPromptTimer();
          return;
        }
        const nextCountdown = Number(this.stillWatchingPromptCountdownSec || 0) - 1;
        if (nextCountdown <= 0) {
          this.onDismissStillWatchingPrompt();
          return;
        }
        this.stillWatchingPromptCountdownSec = nextCountdown;
        this.renderPauseOverlay();
      }, 1000);
    },
    async onStillWatchingContinue() {
      if (!this.stillWatchingPromptVisible) {
        return false;
      }
      this.resetStillWatchingPromptState({ render: false });
      this.consecutiveAutoPlayCount = 0;
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      await this.playNextEpisode({ userInitiated: true });
      return true;
    },
    onDismissStillWatchingPrompt() {
      if (!this.stillWatchingPromptVisible) {
        return false;
      }
      this.resetStillWatchingPromptState({ render: false });
      this.consecutiveAutoPlayCount = 0;
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      return this.navigateBackToStreamScreen({ forceDetail: true });
    },
    getDisplayEpisodeTitle() {
      const rawEpisodeTitle = String(
        this.params?.playerEpisodeTitle || this.params?.episodeTitle || this.params?.playerSubtitle || ""
      ).trim();
      if (!rawEpisodeTitle) {
        return "";
      }
      const season = this.params?.season == null ? null : Number(this.params.season);
      const episode = this.params?.episode == null ? null : Number(this.params.episode);
      if (season == null || episode == null) {
        return rawEpisodeTitle;
      }
      return rawEpisodeTitle.replace(new RegExp(`^S0*${season}E0*${episode}\\s*[-\\u2022:]?\\s*`, "i"), "").trim();
    },
    getPlayerHeaderData() {
      const title = String(this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled").trim() || "Untitled";
      const season = this.params?.season == null ? null : Number(this.params.season);
      const episode = this.params?.episode == null ? null : Number(this.params.episode);
      const hasEpisodeContext =
        this.params?.season != null && Number.isFinite(season) && season >= 0 && Number.isFinite(episode) && episode > 0;
      const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
      const episodeTitle = this.getDisplayEpisodeTitle();
      const subtitle = hasEpisodeContext ? [episodeCode, episodeTitle].filter(Boolean).join(" • ") : "";
      const meta = String(this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || "").trim();
      return { title, subtitle, meta };
    },
    getCurrentStreamDisplayName() {
      if (!this.paused) return "";
      return resolvePlaybackSourceName(this.getCurrentStreamCandidate());
    },
    hasEpisodeAired(released) {
      return hasEpisodeAiredRule(released);
    }
  };
}
