/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods11() {
  const {
    ScreenUtils,
    LayoutPreferences,
    EPISODE_VIRTUALIZATION_THRESHOLD,
    isSeriesDetailMeta,
    renderWatchedBadgeGlyph,
    escapeSelectorValue
  } = internals;

  return {
    syncRenderedEpisodeTrack() {
      const track = this.getEpisodeTrackElement();
      if (!(track instanceof HTMLElement)) {
        return false;
      }
      const episodes = this.getSelectedSeasonEpisodes();
      const season = Number(this.selectedSeason || 0);
      if (track.dataset.scrollKey !== `episodes:${this.selectedSeason ?? 1}` || !episodes.length) {
        return false;
      }
      const currentWindow =
        this.episodeVirtualWindow?.season === season
          ? this.episodeVirtualWindow
          : this.getEpisodeVirtualWindowState(episodes, this.getRememberedEpisodeIndex(episodes));
      if (!currentWindow) {
        return false;
      }
      const visibleEpisodes = currentWindow.virtualized ? episodes.slice(currentWindow.start, currentWindow.end + 1) : episodes;
      const cards = Array.from(track.querySelectorAll(".series-episode-card.focusable"));
      if (cards.length !== visibleEpisodes.length) {
        return false;
      }
      for (const [offset, episode] of visibleEpisodes.entries()) {
        const card = cards[offset];
        const absoluteIndex = currentWindow.virtualized ? currentWindow.start + offset : offset;
        if (
          String(card?.dataset?.videoId || "") !== String(episode?.id || "") ||
          Number(card?.dataset?.episodeIndex || -1) !== absoluteIndex ||
          !this.syncEpisodeCardDom(card, episode, absoluteIndex)
        ) {
          return false;
        }
      }
      const spacers = Array.from(track.querySelectorAll(".series-episode-track-spacer"));
      if (currentWindow.virtualized && spacers.length === 2) {
        spacers[0].style.flexBasis = `${Math.max(0, currentWindow.leftSpacer)}px`;
        spacers[1].style.flexBasis = `${Math.max(0, currentWindow.rightSpacer)}px`;
        const windowNode = track.querySelector(".series-episode-track-window");
        if (windowNode instanceof HTMLElement) {
          windowNode.style.setProperty("--episode-track-gap", `${currentWindow.gap}px`);
        }
      }
      track.classList.toggle("is-virtualized", currentWindow.virtualized);
      this.episodeVirtualWindow = currentWindow;
      return true;
    },
    refreshEpisodeTrack(focusRestoreOverride = null, preferredIndex = null) {
      if (!this.container || !isSeriesDetailMeta(this.meta, this.episodes)) {
        return false;
      }
      const episodeMount = this.container.querySelector("#detailEpisodeTrackMount");
      if (!episodeMount) {
        return false;
      }
      const focusRestore = focusRestoreOverride || this.captureDetailFocus();
      this.captureRenderedChromeState();
      episodeMount.innerHTML = `<div class="series-episode-track${this.getSelectedSeasonEpisodes().length > EPISODE_VIRTUALIZATION_THRESHOLD ? " is-virtualized" : ""}" data-scroll-key="episodes:${this.selectedSeason ?? 1}">${this.renderEpisodeCards(preferredIndex)}</div>`;
      ScreenUtils.indexFocusables(this.container);
      this.pendingFocusRestore = focusRestore;
      this.bindDetailChrome();
      return true;
    },
    scheduleEpisodeVirtualizationSync(preferredIndex = null) {
      if (this.episodeVirtualSyncRaf) {
        cancelAnimationFrame(this.episodeVirtualSyncRaf);
      }
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
      this.episodeVirtualSyncRaf = raf(() => {
        this.episodeVirtualSyncRaf = null;
        this.syncEpisodeVirtualization(preferredIndex);
      });
    },
    syncEpisodeVirtualization(preferredIndex = null) {
      if (!this.container || !isSeriesDetailMeta(this.meta, this.episodes)) {
        return false;
      }
      const episodes = this.getSelectedSeasonEpisodes();
      if (episodes.length <= EPISODE_VIRTUALIZATION_THRESHOLD) {
        return false;
      }
      const track = this.getEpisodeTrackElement();
      if (!track) {
        return false;
      }
      const currentFocus = this.getFocusedEpisodeCard();
      const currentFocusIndex = this.getEpisodeAbsoluteIndex(currentFocus);
      const focusIndex = Number.isFinite(preferredIndex)
        ? preferredIndex
        : currentFocusIndex >= 0
          ? currentFocusIndex
          : this.getRememberedEpisodeIndex(episodes);
      const currentWindow = this.episodeVirtualWindow;
      // Keep the rendered window stable while the focused card is still mounted.
      // Rebuilding the whole rail for every repeat event makes large episode lists
      // stall on TV runtimes under sustained fast navigation.
      if (
        currentWindow?.virtualized &&
        currentWindow.season === Number(this.selectedSeason || 0) &&
        focusIndex >= currentWindow.start &&
        focusIndex <= currentWindow.end
      ) {
        return false;
      }
      const nextWindow = this.getEpisodeVirtualWindowState(episodes, focusIndex);
      if (!nextWindow) {
        return false;
      }
      if (
        currentWindow &&
        currentWindow.season === nextWindow.season &&
        currentWindow.start === nextWindow.start &&
        currentWindow.end === nextWindow.end &&
        currentWindow.virtualized === nextWindow.virtualized
      ) {
        return false;
      }
      this.episodeVirtualWindow = nextWindow;
      this.refreshEpisodeTrack({ episodeIndex: focusIndex, preserveVerticalScroll: true }, focusIndex);
      return true;
    },
    focusEpisodeByIndex(index, options = {}) {
      const episodes = this.getSelectedSeasonEpisodes();
      if (!episodes.length) {
        return false;
      }
      const targetIndex = Math.max(0, Math.min(episodes.length - 1, Number(index || 0)));
      const focusRestore = {
        episodeIndex: targetIndex,
        preserveVerticalScroll: Boolean(options?.preserveVerticalScroll)
      };
      if (this.syncEpisodeVirtualization(targetIndex)) {
        const target = this.container?.querySelector(`.series-episode-card[data-episode-index="${targetIndex}"]`) || null;
        if (target instanceof HTMLElement) {
          return this.focusInList([target], 0, {
            animated: options?.animated !== false,
            preserveVerticalScroll: Boolean(options?.preserveVerticalScroll)
          });
        }
        this.pendingFocusRestore = focusRestore;
        return true;
      }
      const target = this.container?.querySelector(`.series-episode-card[data-episode-index="${targetIndex}"]`) || null;
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      return this.focusInList([target], 0, {
        animated: options?.animated !== false,
        preserveVerticalScroll: Boolean(options?.preserveVerticalScroll)
      });
    },
    focusEpisodeByVideoId(videoId, options = {}) {
      const index = this.getEpisodeIndexByVideoId(videoId);
      if (index < 0) {
        return false;
      }
      return this.focusEpisodeByIndex(index, options);
    },
    syncSeriesHeroPlayButtonLabel() {
      const labelNode = this.container?.querySelector?.(".series-detail-actions [data-action='playDefault'] span:last-child");
      if (labelNode instanceof HTMLElement) {
        labelNode.textContent = this.getSeriesHeroPlayLabel();
      }
    },
    syncEpisodeCardWatchedDom(episode) {
      const videoId = String(episode?.id || "").trim();
      if (!videoId || !this.container) {
        return;
      }
      const card = this.container.querySelector(`.series-episode-card[data-video-id="${escapeSelectorValue(videoId)}"]`);
      if (!(card instanceof HTMLElement)) {
        return;
      }
      const thumb = card.querySelector(".series-episode-thumb");
      const image = card.querySelector(".series-episode-image");
      const copy = card.querySelector(".series-episode-copy");
      if (!(thumb instanceof HTMLElement) || !(image instanceof HTMLElement) || !(copy instanceof HTMLElement)) {
        return;
      }

      const progress = this.episodeProgressMap.get(`${Number(episode.season || 0)}:${Number(episode.episode || 0)}`) || null;
      const position = Number(progress?.positionMs || 0);
      const duration = Number(progress?.durationMs || 0);
      const progressRatio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
      const isWatched = this.isEpisodeMarkedWatched(episode);

      card.classList.toggle("watched", isWatched);
      image.classList.toggle("is-blurred", Boolean(LayoutPreferences.get().blurUnwatchedEpisodes) && !isWatched);

      let statusNode = thumb.querySelector(".series-episode-status");
      if (isWatched) {
        if (!(statusNode instanceof HTMLElement)) {
          statusNode = document.createElement("div");
          thumb.appendChild(statusNode);
        }
        statusNode.className = "series-episode-status complete";
        statusNode.innerHTML = renderWatchedBadgeGlyph();
      } else if (progressRatio < 0.02 && episode.available !== false) {
        if (!(statusNode instanceof HTMLElement)) {
          statusNode = document.createElement("div");
          thumb.appendChild(statusNode);
        }
        statusNode.className = "series-episode-status idle";
        statusNode.innerHTML = "";
      } else if (statusNode instanceof HTMLElement) {
        statusNode.remove();
      }

      let progressNode = thumb.querySelector(".series-episode-progress");
      if (progressRatio > 0.02 && progressRatio < 0.98) {
        if (!(progressNode instanceof HTMLElement)) {
          progressNode = document.createElement("div");
          progressNode.className = "series-episode-progress";
          thumb.appendChild(progressNode);
        }
        progressNode.innerHTML = `<span style="width:${Math.round(progressRatio * 100)}%"></span>`;
      } else if (progressNode instanceof HTMLElement) {
        progressNode.remove();
      }
    },
    syncEpisodePlaybackDom(episodes = []) {
      if (!isSeriesDetailMeta(this.meta, this.episodes) || !this.container) {
        this.updateRenderedDetailSections(this.meta);
        return;
      }
      this.syncSeriesHeroPlayButtonLabel();
      (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
        this.syncEpisodeCardWatchedDom(episode);
      });
      if (
        Array.isArray(episodes) &&
        episodes.length > 0 &&
        LayoutPreferences.get().detailImdbRatingsVisibility === "HIDE_UNWATCHED_EPISODES"
      ) {
        this.updateRenderedDetailSections(this.meta);
      }
    },
    getEpisodeByVideoId(videoId) {
      const wanted = String(videoId || "").trim();
      if (!wanted) {
        return null;
      }
      return this.episodes.find((episode) => String(episode?.id || "") === wanted) || null;
    },
    getEpisodeFocusDescriptor(videoId) {
      const value = String(videoId || "").trim();
      if (!value) {
        return null;
      }
      const episodeIndex = this.getEpisodeIndexByVideoId(value);
      return {
        episodeVideoId: value,
        episodeIndex: episodeIndex >= 0 ? episodeIndex : null,
        selector: `.series-episode-card[data-video-id="${escapeSelectorValue(value)}"]`
      };
    },
    getEpisodeMenuProgress(episode) {
      if (!episode) {
        return null;
      }
      return this.episodeProgressMap.get(`${Number(episode.season || 0)}:${Number(episode.episode || 0)}`) || null;
    },
    isEpisodeMarkedWatched(episode) {
      if (!episode) {
        return false;
      }
      const key = `${Number(episode.season || 0)}:${Number(episode.episode || 0)}`;
      if (this.enrichedWatchedState?.has(key)) {
        return Boolean(this.enrichedWatchedState.get(key)?.isWatched);
      }
      return this.watchedEpisodeKeys.has(key);
    },
    getEpisodeHoldMenuEpisode() {
      return this.getEpisodeByVideoId(this.episodeHoldMenu?.videoId) || this.episodeHoldMenu?.episode || null;
    }
  };
}
