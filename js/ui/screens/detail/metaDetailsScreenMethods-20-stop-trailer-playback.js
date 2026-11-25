/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods20() {
  const { ScreenUtils, localizedGenreLabel, contentTextDirection, renderLoadingIndicator, detectQuality, renderStreamAddonIcon } =
    internals;

  return {
    stopTrailerPlayback({ keepDom = false, restartAutoplay = true, restoreFocus = true, immediateClear = false } = {}) {
      if (this.trailerAutoplayTimer) {
        clearTimeout(this.trailerAutoplayTimer);
        this.trailerAutoplayTimer = null;
      }
      const layer = this.container?.querySelector(".detail-trailer-layer") || null;
      const wasVisualReady = Boolean(this.trailerVisualReady);
      const cleanupGeneration = Number(this.trailerDomGeneration || 0) + 1;
      this.trailerDomGeneration = cleanupGeneration;
      const hardStopLayerMedia = () => {
        if (!layer) {
          return;
        }
        const activeFrame = layer.querySelector("iframe");
        if (activeFrame) {
          try {
            activeFrame.src = "about:blank";
          } catch (_) {}
          try {
            activeFrame.removeAttribute("src");
          } catch (_) {}
        }
        const activeVideo = layer.querySelector("video");
        if (activeVideo) {
          try {
            activeVideo.pause?.();
          } catch (_) {}
          try {
            activeVideo.removeAttribute("src");
            activeVideo.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
            activeVideo.load?.();
          } catch (_) {}
        }
      };
      if (this.trailerSource?.kind === "youtube") {
        this.postTrailerProxyCommand("pause");
      } else {
        try {
          this.trailerUiRefs?.video?.pause?.();
        } catch (_) {}
      }
      if (immediateClear) {
        hardStopLayerMedia();
      }
      this.stopTrailerProgressTimer();
      this.stopTrailerControlsTimer();
      this.stopTrailerProxyLoadingTimer();
      this.detachTrailerMediaListeners();
      this.destroyYoutubeTrailerPlayer();
      const previousMode = this.trailerPlaybackMode;
      const focusRestore = this.trailerFocusRestore;
      this.isTrailerPlaying = false;
      this.trailerPlaybackMode = null;
      this.trailerVisualReady = false;
      this.trailerSubtitlesEnabled = false;
      this.trailerPendingSeekSeconds = 0;
      this.trailerFocusRestore = null;
      const clearLayer = () => {
        if (!layer || Number(this.trailerDomGeneration || 0) !== cleanupGeneration || this.isTrailerPlaying) {
          return;
        }
        if (layer) {
          hardStopLayerMedia();
          layer.innerHTML = "";
        }
      };
      this.trailerUiRefs = null;
      this.trailerControlsVisible = true;
      const shell = this.container?.querySelector(".series-detail-shell");
      if (shell) {
        shell.classList.remove("detail-trailer-active", "detail-trailer-autoplay", "detail-trailer-manual", "detail-trailer-ready");
      }
      if (!keepDom) {
        if (wasVisualReady) {
          setTimeout(clearLayer, 620);
        } else {
          clearLayer();
        }
      }
      if (restoreFocus && previousMode === "manual") {
        const restore = () => {
          this.focusDetailDescriptor(
            focusRestore || {
              selector: '.series-detail-actions [data-action="playDefault"]'
            }
          );
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(restore);
        } else {
          setTimeout(restore, 0);
        }
      }
      if (restartAutoplay) {
        this.restartTrailerAutoplayTimer();
      }
    },
    stopTrailerPlaybackForNavigation() {
      this.stopTrailerPlayback({
        keepDom: false,
        restartAutoplay: false,
        restoreFocus: false,
        immediateClear: true
      });
    },
    async openEpisodeStreamChooser(videoId, options = {}) {
      if (!videoId || !this.meta) {
        return;
      }
      this.stopTrailerPlaybackForNavigation();
      const shuffleResume = this.shuffleResumeProgress?.videoId === videoId ? this.shuffleResumeProgress : null;
      const episode =
        this.episodes.find((entry) => entry.id === videoId) ||
        (shuffleResume
          ? { id: videoId, season: shuffleResume.season, episode: shuffleResume.episode, title: shuffleResume.episodeTitle || "" }
          : null);
      if (!episode) {
        return;
      }
      const progress = shuffleResume || this.getEpisodeMenuProgress(episode);
      this.navigateToStreamScreenForEpisode(episode, {
        ...this.getResumeParamsForProgress(progress, {
          ...options,
          useActiveFallback: false
        }),
        ...(options.manualSelection ? { manualSelection: true } : {})
      });
    },
    async openMovieStreamChooser(options = {}) {
      this.stopTrailerPlaybackForNavigation();
      this.navigateToStreamScreenForMovie({
        ...this.getResumeParamsForProgress(this.getActiveResumeProgress(), options),
        ...(options.manualSelection ? { manualSelection: true } : {})
      });
    },
    getActivePendingSelection() {
      return this.pendingEpisodeSelection || this.pendingMovieSelection || null;
    },
    getFilteredEpisodeStreams() {
      const pending = this.getActivePendingSelection();
      if (!pending || !pending.streams.length) {
        return [];
      }
      if (pending.addonFilter === "all") {
        return pending.streams;
      }
      return pending.streams.filter((stream) => stream.addonName === pending.addonFilter);
    },
    renderEpisodeStreamChooser() {
      const mount = this.container.querySelector("#episodeStreamChooserMount");
      if (!mount) {
        return;
      }
      const pending = this.pendingEpisodeSelection;
      if (!pending) {
        mount.innerHTML = "";
        return;
      }

      const addons = Array.from(new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean)));
      const filtered = this.getFilteredEpisodeStreams();
      const filterTabs = [
        `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
        ...addons.map(
          (addon) => `
            <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
              ${addon}
            </button>
          `
        )
      ].join("");

      const streamCards = filtered.length
        ? filtered
            .map(
              (stream) => `
              <article class="series-stream-card focusable"
                       data-action="playEpisodeStream"
                       data-stream-id="${stream.id}">
                <div class="series-stream-title" dir="${contentTextDirection(stream.label || "Stream")}">${stream.label || "Stream"}</div>
                <div class="series-stream-desc" dir="${contentTextDirection(stream.description || "")}">${stream.description || ""}</div>
                <div class="series-stream-meta">
                  ${renderStreamAddonIcon(stream.addonName)}
                  <span dir="${contentTextDirection(`${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}`)}">${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
                </div>
                <div class="series-stream-tags">
                  <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
                  <span class="series-stream-tag">${
                    String(stream.sourceType || "")
                      .toLowerCase()
                      .includes("torrent")
                      ? "Torrent"
                      : "Stream"
                  }</span>
                </div>
              </article>
            `
            )
            .join("")
        : pending.loading
          ? `
              <div class="series-stream-empty series-stream-loading">
                ${renderLoadingIndicator()}
                <span>Loading streams...</span>
              </div>
            `
          : `<div class="series-stream-empty">No streams found for this filter.</div>`;

      mount.innerHTML = `
          <div class="series-stream-overlay">
            <div class="series-stream-overlay-backdrop"></div>
            <div class="series-stream-panel">
              <div class="series-stream-left">
                ${this.meta?.logo ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${this.meta?.name || "Series"}</div>`}
                <div class="series-stream-episode">${pending.episode ? `S${pending.episode.season} E${pending.episode.episode}` : ""}</div>
                <div class="series-stream-episode-title">${pending.episode?.title || ""}</div>
              </div>
              <div class="series-stream-right">
                <div class="series-stream-filters">${filterTabs}</div>
                <div class="series-stream-list">${streamCards}</div>
              </div>
            </div>
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      this.applyStreamChooserFocus();
    },
    renderMovieStreamChooser() {
      const mount = this.container.querySelector("#movieStreamChooserMount");
      if (!mount) {
        return;
      }
      const pending = this.pendingMovieSelection;
      if (!pending) {
        mount.innerHTML = "";
        return;
      }

      const addons = Array.from(new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean)));
      const filtered = this.getFilteredEpisodeStreams();
      const filterTabs = [
        `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
        ...addons.map(
          (addon) => `
            <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
              ${addon}
            </button>
          `
        )
      ].join("");

      const streamCards = filtered.length
        ? filtered
            .map(
              (stream) => `
              <article class="series-stream-card focusable"
                       data-action="playPendingStream"
                       data-stream-id="${stream.id}">
                <div class="series-stream-title" dir="${contentTextDirection(stream.label || "Stream")}">${stream.label || "Stream"}</div>
                <div class="series-stream-desc" dir="${contentTextDirection(stream.description || "")}">${stream.description || ""}</div>
                <div class="series-stream-meta">
                  ${renderStreamAddonIcon(stream.addonName)}
                  <span dir="${contentTextDirection(`${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}`)}">${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
                </div>
                <div class="series-stream-tags">
                  <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
                  <span class="series-stream-tag">${
                    String(stream.sourceType || "")
                      .toLowerCase()
                      .includes("torrent")
                      ? "Torrent"
                      : "Stream"
                  }</span>
                </div>
              </article>
            `
            )
            .join("")
        : pending.loading
          ? `
              <div class="series-stream-empty series-stream-loading">
                ${renderLoadingIndicator()}
                <span>Loading streams...</span>
              </div>
            `
          : `<div class="series-stream-empty">No streams found for this filter.</div>`;

      mount.innerHTML = `
          <div class="series-stream-overlay">
            <div class="series-stream-overlay-backdrop"></div>
            <div class="series-stream-panel">
              <div class="series-stream-left">
                ${this.meta?.logo ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${this.meta?.name || "Movie"}</div>`}
                <div class="series-stream-episode">${this.meta?.name || ""}</div>
                <div class="series-stream-episode-title">${Array.isArray(this.meta?.genres) ? this.meta.genres.slice(0, 3).map(localizedGenreLabel).join(" • ") : ""}</div>
              </div>
              <div class="series-stream-right">
                <div class="series-stream-filters">${filterTabs}</div>
                <div class="series-stream-list">${streamCards}</div>
              </div>
            </div>
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      this.applyStreamChooserFocus();
    },
    closeEpisodeStreamChooser() {
      this.streamChooserLoadToken = (this.streamChooserLoadToken || 0) + 1;
      this.pendingEpisodeSelection = null;
      this.pendingMovieSelection = null;
      this.streamChooserFocus = null;
      this.render(this.meta);
    }
  };
}
