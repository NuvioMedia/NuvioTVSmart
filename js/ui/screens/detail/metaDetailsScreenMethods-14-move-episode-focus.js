/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods14() {
  const {
    Router,
    watchProgressRepository,
    watchedItemsRepository,
    watchedSeriesReconciliationService,
    EPISODE_HOLD_DELAY_MS,
    isSeriesDetailMeta,
    resolveMetaImdbId,
    resolveMetaTmdbId,
    resolveMetaTraktId
  } = internals;

  return {
    moveEpisodeFocus(direction) {
      if (direction !== "left" && direction !== "right") {
        return false;
      }
      const current = this.getFocusedEpisodeCard();
      if (!current) {
        return false;
      }
      const currentIndex = this.getEpisodeAbsoluteIndex(current);
      if (!Number.isFinite(currentIndex) || currentIndex < 0) {
        return false;
      }
      const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
      return this.focusEpisodeByIndex(nextIndex, { preserveVerticalScroll: true });
    },
    cancelPendingEpisodeHold() {
      if (this.pendingEpisodeHoldTimer) {
        clearTimeout(this.pendingEpisodeHoldTimer);
        this.pendingEpisodeHoldTimer = null;
      }
      this.pendingEpisodeHoldTarget = null;
    },
    cancelPendingSeasonHold() {
      if (this.pendingSeasonHoldTimer) {
        clearTimeout(this.pendingSeasonHoldTimer);
        this.pendingSeasonHoldTimer = null;
      }
      this.pendingSeasonHoldTarget = null;
    },
    hasPendingEpisodeHold(node) {
      const pending = this.pendingEpisodeHoldTarget;
      if (!pending || !node) {
        return false;
      }
      return String(node.dataset.videoId || "") === String(pending.videoId || "");
    },
    hasPendingSeasonHold(node) {
      const pending = this.pendingSeasonHoldTarget;
      if (!pending || !node) {
        return false;
      }
      return Number(node.dataset.season || 0) === Number(pending.season || 0);
    },
    startPendingEpisodeHold(node) {
      const videoId = String(node?.dataset?.videoId || "");
      if (!videoId) {
        return false;
      }
      this.cancelPendingEpisodeHold();
      this.pendingEpisodeHoldTarget = {
        videoId,
        holdTriggered: false
      };
      this.pendingEpisodeHoldTimer = setTimeout(() => {
        this.pendingEpisodeHoldTimer = null;
        const pending = this.pendingEpisodeHoldTarget;
        if (!pending || Router.getCurrent() !== "detail") {
          return;
        }
        const current = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
        if (!this.hasPendingEpisodeHold(current)) {
          return;
        }
        pending.holdTriggered = true;
        this.openEpisodeHoldMenu(current);
      }, EPISODE_HOLD_DELAY_MS);
      return true;
    },
    startPendingSeasonHold(node) {
      const season = Number(node?.dataset?.season || 0);
      if (!Number.isFinite(season) || season < 0) {
        return false;
      }
      this.cancelPendingSeasonHold();
      this.pendingSeasonHoldTarget = {
        season,
        holdTriggered: false
      };
      this.pendingSeasonHoldTimer = setTimeout(() => {
        this.pendingSeasonHoldTimer = null;
        const pending = this.pendingSeasonHoldTarget;
        if (!pending || Router.getCurrent() !== "detail") {
          return;
        }
        const current = this.container?.querySelector(".series-season-btn.focusable.focused") || null;
        if (!this.hasPendingSeasonHold(current)) {
          return;
        }
        pending.holdTriggered = true;
        this.openSeasonHoldMenu(current);
      }, EPISODE_HOLD_DELAY_MS);
      return true;
    },
    async completePendingEpisodeHold(node, event = null) {
      const pending = this.pendingEpisodeHoldTarget;
      if (!pending) {
        return false;
      }
      const holdTriggered = Boolean(pending.holdTriggered);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= EPISODE_HOLD_DELAY_MS;
      const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingEpisodeHold(node);
      this.cancelPendingEpisodeHold();
      if (holdTriggered || shouldOpenHoldMenu) {
        if (shouldOpenHoldMenu) {
          this.openEpisodeHoldMenu(node);
        }
        return true;
      }
      if (!this.isEpisodeHoldTarget(node)) {
        return false;
      }
      const selectedEpisode = this.episodes.find((entry) => entry.id === node.dataset.videoId);
      if (!selectedEpisode) {
        return false;
      }
      await this.openEpisodeStreamChooser(selectedEpisode.id);
      return true;
    },
    completePendingSeasonHold(node, event = null) {
      const pending = this.pendingSeasonHoldTarget;
      if (!pending) {
        return false;
      }
      const holdTriggered = Boolean(pending.holdTriggered);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= EPISODE_HOLD_DELAY_MS;
      const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingSeasonHold(node);
      this.cancelPendingSeasonHold();
      if (holdTriggered || shouldOpenHoldMenu) {
        if (shouldOpenHoldMenu) {
          this.openSeasonHoldMenu(node);
        }
        return true;
      }
      if (!this.isSeasonHoldTarget(node)) {
        return false;
      }
      const season = Number(node?.dataset?.season || 0);
      if (!Number.isFinite(season) || season < 0) {
        return false;
      }
      if (season !== this.selectedSeason) {
        this.hasManualSeasonSelection = true;
        this.selectedSeason = season;
        this.render(this.meta);
      }
      return true;
    },
    openEpisodeHoldMenu(node) {
      const episode = this.getEpisodeByVideoId(node?.dataset?.videoId || "");
      if (!episode) {
        return false;
      }
      this.episodeHoldMenu = {
        videoId: String(episode.id || ""),
        optionIndex: 0,
        episode: { ...episode }
      };
      return this.mountEpisodeHoldDialog();
    },
    openSeasonHoldMenu(node) {
      const season = Number(node?.dataset?.season || 0);
      if (!Number.isFinite(season) || season < 0) {
        return false;
      }
      this.seasonHoldMenu = {
        season,
        optionIndex: 0
      };
      return this.mountSeasonHoldDialog();
    },
    closeEpisodeHoldMenu({ restoreFocus = true } = {}) {
      if (!this.episodeHoldMenu) {
        return false;
      }
      const focusRestore = this.getEpisodeFocusDescriptor(this.episodeHoldMenu.videoId);
      this.episodeHoldMenu = null;
      this.destroyDetailHoldDialog();
      if (restoreFocus) {
        this.focusDetailDescriptor(focusRestore);
      }
      return true;
    },
    closeSeasonHoldMenu({ restoreFocus = true } = {}) {
      if (!this.seasonHoldMenu) {
        return false;
      }
      const season = Number(this.seasonHoldMenu.season ?? this.selectedSeason ?? 1);
      this.seasonHoldMenu = null;
      this.destroyDetailHoldDialog();
      if (restoreFocus) {
        this.focusDetailDescriptor({ selector: `.series-season-btn[data-season="${season}"]` });
      }
      return true;
    },
    startEpisodeFromHoldMenu(episode, options = {}) {
      if (!episode?.id) {
        return false;
      }
      const progress = this.getEpisodeMenuProgress(episode);
      this.episodeHoldMenu = null;
      this.navigateToStreamScreenForEpisode(episode, {
        ...this.getResumeParamsForProgress(progress, {
          startOver: Boolean(options.startOver),
          useActiveFallback: false
        }),
        ...(options.manualSelection ? { manualSelection: true } : {})
      });
      return true;
    },
    getSeasonEpisodes(season) {
      const seasonNumber = Number(season || 0);
      return (this.episodes || []).filter((episode) => Number(episode?.season || 0) === seasonNumber);
    },
    isSeasonFullyWatched(season) {
      const episodes = this.getSeasonEpisodes(season);
      return episodes.length > 0 && episodes.every((episode) => this.isEpisodeMarkedWatched(episode));
    },
    getPreviousEpisodes(episode) {
      if (!episode) {
        return [];
      }
      const targetSeason = Number(episode?.season || 0);
      const targetEpisode = Number(episode?.episode || 0);
      return (this.episodes || []).filter((entry) => {
        const entrySeason = Number(entry?.season || 0);
        const entryEpisode = Number(entry?.episode || 0);
        return entrySeason === targetSeason && entryEpisode < targetEpisode;
      });
    },
    async setEpisodesWatchedState(episodes = [], watched = true) {
      const targets = (episodes || []).filter((episode) => episode?.id);
      if (!targets.length) {
        return false;
      }
      const providerIds = {
        imdbId: resolveMetaImdbId(this.meta, this.params),
        tmdbId: resolveMetaTmdbId(this.meta, this.params),
        traktId: resolveMetaTraktId(this.meta, this.params)
      };
      if (watched) {
        const watchedAt = Date.now();
        await watchedItemsRepository.markBatch(
          targets.map((episode) => ({
            contentId: this.params?.itemId,
            ...providerIds,
            contentType: "series",
            title: this.meta?.name || this.params?.fallbackTitle || episode.title || "Untitled",
            season: episode.season,
            episode: episode.episode,
            videoId: episode.id,
            watchedAt
          }))
        );
        await watchProgressRepository.saveProgressBatch(
          targets.map((episode) => ({
            contentId: this.params?.itemId,
            ...providerIds,
            contentType: "series",
            videoId: episode.id,
            season: episode.season,
            episode: episode.episode,
            title: this.meta?.name || this.params?.fallbackTitle || null,
            episodeTitle: episode.title || null,
            positionMs: 100,
            durationMs: 100,
            updatedAt: watchedAt
          }))
        );
      } else {
        for (const episode of targets) {
          await watchedItemsRepository.unmark(this.params?.itemId, {
            ...providerIds,
            contentType: "series",
            season: episode.season,
            episode: episode.episode,
            videoId: episode.id
          });
          await watchProgressRepository.removeProgress(this.params?.itemId, episode.id);
        }
      }
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
        await watchedSeriesReconciliationService.reconcile(this.params?.itemId, this.params?.itemType || this.meta?.type || "series", {
          meta: this.meta
        });
      }
      await this.refreshEpisodePlaybackState();
      return true;
    },
    async setSeasonWatchedState(season, watched) {
      const episodes = this.getSeasonEpisodes(season);
      if (!episodes.length) {
        return false;
      }
      await this.setEpisodesWatchedState(episodes, watched);
      this.episodeHoldMenu = null;
      this.seasonHoldMenu = null;
      this.syncEpisodePlaybackDom(episodes);
      return true;
    },
    async markPreviousEpisodesWatched(episode) {
      const previousEpisodes = this.getPreviousEpisodes(episode).filter((entry) => !this.isEpisodeMarkedWatched(entry));
      if (!previousEpisodes.length) {
        return false;
      }
      await this.setEpisodesWatchedState(previousEpisodes, true);
      this.episodeHoldMenu = null;
      this.syncEpisodePlaybackDom(previousEpisodes);
      return true;
    }
  };
}
