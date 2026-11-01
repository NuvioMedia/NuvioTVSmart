import { trackingErrorMessage } from "../../components/trackingErrorMessage.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods15() {
  const {
    watchProgressRepository,
    watchedItemsRepository,
    libraryRepository,
    LibrarySourceMode,
    detailWatchedEnrichmentService,
    watchedSeriesReconciliationService,
    TraktSettingsStore,
    TraktAuthService,
    isWatchProgressInProgress,
    SIMKL_DESTRUCTIVE_REMOVAL_MESSAGE,
    t,
    getDetailAllProgressPromise,
    hasCompletedSimklMovieProgress,
    hasInProgressSimklMovieProgress,
    isSeriesDetailMeta,
    buildDetailContentReference,
    isDetailTitleWatched,
    resolveMetaImdbId,
    resolveMetaTmdbId,
    resolveMetaTraktId,
    escapeHtml,
    resolveTrailerItems
  } = internals;

  return {
    async refreshEpisodePlaybackState() {
      detailWatchedEnrichmentService.invalidateCache(this.params?.itemId);
      const [progress, allProgressItems, allWatchedItems, watchedItem] = await Promise.all([
        watchProgressRepository.getResumeByContentIds(this.resumeContentIds?.length ? this.resumeContentIds : [this.params?.itemId]),
        getDetailAllProgressPromise(),
        watchedItemsRepository.getAll(),
        watchedItemsRepository.isWatched(this.params?.itemId)
      ]);
      const projectedTitleWatched = await isDetailTitleWatched(this.params?.itemId, this.params?.itemType, this.meta, allWatchedItems);
      this.resumeProgress = progress && isWatchProgressInProgress(progress) ? progress : null;
      const detailContentReference = buildDetailContentReference(this.params?.itemId, this.meta, this.params);
      this.isMarkedWatched = Boolean(
        projectedTitleWatched ||
        (watchedItem && !hasInProgressSimklMovieProgress(allProgressItems, detailContentReference)) ||
        hasCompletedSimklMovieProgress(allProgressItems, detailContentReference) ||
        (progress && Number(progress.durationMs || 0) > 0 && Number(progress.positionMs || 0) >= Number(progress.durationMs || 0))
      );
      const progressItemsForDetail = this.resumeProgress ? [this.resumeProgress, ...allProgressItems] : allProgressItems;
      this.buildEpisodeState(progressItemsForDetail, allWatchedItems, this.enrichedWatchedState);
      this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(this.resumeProgress || progress);
    },
    async setEpisodeWatchedState(episode, watched) {
      const profileId = ProfileManager.getActiveProfileId();
      const token = this.detailLoadToken;
      const current = () => ProfileManager.getActiveProfileId() === profileId && this.detailLoadToken === token;
      if (!episode?.id) {
        return false;
      }
      const providerIds = {
        imdbId: resolveMetaImdbId(this.meta, this.params),
        tmdbId: resolveMetaTmdbId(this.meta, this.params),
        traktId: resolveMetaTraktId(this.meta, this.params)
      };
      if (watched) {
        if (
          (await watchedItemsRepository.mark({
            contentId: this.params?.itemId,
            ...providerIds,
            contentType: "series",
            title: this.meta?.name || this.params?.fallbackTitle || episode.title || "Untitled",
            season: episode.season,
            episode: episode.episode,
            videoId: episode.id,
            released: episode.released,
            watchedAt: Date.now()
          })) === false ||
          !current()
        )
          return false;
        await watchProgressRepository.saveProgress({
          contentId: this.params?.itemId,
          ...providerIds,
          contentType: "series",
          videoId: episode.id,
          season: episode.season,
          episode: episode.episode,
          positionMs: 100,
          durationMs: 100,
          updatedAt: Date.now()
        });
      } else {
        if (
          (await watchedItemsRepository.unmark(this.params?.itemId, {
            ...providerIds,
            contentType: "series",
            season: episode.season,
            episode: episode.episode,
            videoId: episode.id
          })) === false ||
          !current()
        )
          return false;
        await watchProgressRepository.removeProgress(this.params?.itemId, episode.id);
      }
      if (!current()) return false;
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
        await watchedSeriesReconciliationService.reconcile(this.params?.itemId, this.params?.itemType || this.meta?.type || "series", {
          meta: this.meta,
          completedEpisode: watched
            ? {
                season: episode.season,
                episode: episode.episode
              }
            : null
        });
      }
      if (!current()) return false;
      await this.refreshEpisodePlaybackState();
      if (!current()) return false;
      this.episodeHoldMenu = null;
      this.syncEpisodePlaybackDom([episode]);
      return true;
    },
    async activateEpisodeHoldMenuOption() {
      const episode = this.getEpisodeHoldMenuEpisode();
      const options = this.getEpisodeHoldMenuOptions();
      const option = options[Math.max(0, Math.min(options.length - 1, Number(this.episodeHoldMenu?.optionIndex || 0)))];
      if (!episode || !option) {
        return false;
      }
      if (option.action === "play") {
        this.closeEpisodeHoldMenu({ restoreFocus: false });
        return this.startEpisodeFromHoldMenu(episode);
      }
      if (option.action === "playFromBeginning") {
        this.closeEpisodeHoldMenu({ restoreFocus: false });
        return this.startEpisodeFromHoldMenu(episode, { startOver: true });
      }
      if (option.action === "playManually") {
        this.closeEpisodeHoldMenu({ restoreFocus: false });
        return this.startEpisodeFromHoldMenu(episode, { manualSelection: true });
      }
      if (option.action === "toggleWatched") {
        this.closeEpisodeHoldMenu({ restoreFocus: false });
        return this.setEpisodeWatchedState(episode, !this.isEpisodeMarkedWatched(episode));
      }
      if (option.action === "markSeasonWatched" || option.action === "markSeasonUnwatched") {
        this.closeEpisodeHoldMenu({ restoreFocus: false });
        return this.setSeasonWatchedState(episode.season, option.action === "markSeasonWatched");
      }
      if (option.action === "markPreviousWatched") {
        this.closeEpisodeHoldMenu({ restoreFocus: false });
        return this.markPreviousEpisodesWatched(episode);
      }
      return false;
    },
    async activateSeasonHoldMenuOption() {
      const season = this.getSeasonHoldMenuSeason();
      const options = this.getSeasonHoldMenuOptions();
      const option = options[Math.max(0, Math.min(options.length - 1, Number(this.seasonHoldMenu?.optionIndex || 0)))];
      if (season == null || !option) {
        return false;
      }
      if (option.action === "markPreviousSeasonsWatched") {
        this.closeSeasonHoldMenu({ restoreFocus: false });
        return this.markPreviousSeasonsWatched(season);
      }
      if (option.action === "markSeasonWatched" || option.action === "markSeasonUnwatched") {
        this.closeSeasonHoldMenu({ restoreFocus: false });
        return this.setSeasonWatchedState(season, option.action === "markSeasonWatched");
      }
      return false;
    },
    async activateHeroOptionsMenu(actionOverride = "") {
      if (this.heroPlayMenu) {
        this.closeHeroMenus({ restoreFocus: false });
        await this.playDefaultFromHero({
          startOver: actionOverride === "playFromBeginning",
          manualSelection: actionOverride === "playManually"
        });
        return true;
      }
      if (!this.libraryListMenu) {
        return false;
      }
      const action = String(actionOverride || "");
      if (action.startsWith("toggleLibraryList:")) {
        const key = action.slice("toggleLibraryList:".length);
        const nextSelected = !this.libraryListMenu.membership?.[key];
        this.libraryListMenu.membership =
          this.libraryListMenu.sourceMode === LibrarySourceMode.SIMKL
            ? Object.fromEntries(this.libraryListMenu.tabs.map((tab) => [tab.key, nextSelected && tab.key === key]))
            : { ...(this.libraryListMenu.membership || {}), [key]: nextSelected };
        this.libraryListMenu.destructiveRemovalRequired = false;
        if (this.libraryListMenu.sourceMode === LibrarySourceMode.SIMKL) {
          this.mountLibraryListDialog();
        } else {
          this.detailHoldDialog?.setButtonSelected?.(action, Boolean(this.libraryListMenu.membership[key]));
        }
        return true;
      }
      if (action === "saveLibraryLists" || action === "confirmDestructiveSimklRemoval") {
        this.libraryMembershipMutationToken = (this.libraryMembershipMutationToken || 0) + 1;
        try {
          await libraryRepository.applyMembershipChanges(
            this.libraryListMenu.item,
            {
              desiredMembership: this.libraryListMenu.membership || {}
            },
            {
              destructiveRemovalConfirmed: action === "confirmDestructiveSimklRemoval",
              sourceMode: this.libraryListMenu.sourceMode
            }
          );
          this.isSavedInLibrary = Object.values(this.libraryListMenu.membership || {}).some(Boolean);
          this.closeHeroMenus({ restoreFocus: false });
          this.syncDetailActionButtons();
        } catch (error) {
          console.warn("Failed to update library lists", error);
          this.libraryListMenu.destructiveRemovalRequired = error?.code === "SIMKL_DESTRUCTIVE_REMOVAL_REQUIRED";
          this.libraryListMenu.error = this.libraryListMenu.destructiveRemovalRequired
            ? SIMKL_DESTRUCTIVE_REMOVAL_MESSAGE
            : trackingErrorMessage(error, null) || t("detail_lists_save_failed", {}, "Could not save list changes.");
          this.mountLibraryListDialog();
        }
        return true;
      }
      return false;
    },
    renderCastCards() {
      if (!Array.isArray(this.castItems) || !this.castItems.length) {
        return "";
      }
      return this.castItems
        .map(
          (person) => `
          <div class="card focusable">
            <div style="font-weight:700;">${person.name}</div>
            <div style="opacity:0.8;">Cast</div>
          </div>
        `
        )
        .join("");
    },
    shouldRenderCommentsSection() {
      return Boolean(
        TraktSettingsStore.get().showMetaComments && TraktAuthService.isAuthenticated() && this.supportsTraktComments(this.meta)
      );
    },
    renderStandaloneCommentsSection() {
      if (!this.shouldRenderCommentsSection()) {
        return "";
      }
      return this.renderCommentsSection();
    },
    renderTrailerRail(trailerItems = resolveTrailerItems(this.meta), kind = "series") {
      const items = Array.isArray(trailerItems) ? trailerItems : [];
      if (!items.length) {
        return `<div class="series-insight-empty">${escapeHtml(t("detail.noTrailers", {}, "No trailers available."))}</div>`;
      }
      const cards = items
        .map((trailer, index) => {
          const ytId = String(trailer.ytId || "").trim();
          const title = trailer.name || trailer.type || t("detail_tab_trailer", {}, "Trailer");
          const subtitle = [trailer.type, trailer.lang ? String(trailer.lang).toUpperCase() : ""].filter(Boolean).join(" • ");
          return `
            <article class="detail-morelike-card detail-trailer-card focusable"
                     data-action="openSharedTrailer"
                     data-trailer-index="${index}"
                     data-trailer-yt-id="${escapeHtml(ytId)}">
              <div class="detail-morelike-poster-wrap">
                <img class="detail-morelike-poster-image" src="https://img.youtube.com/vi/${escapeHtml(ytId)}/hqdefault.jpg" alt="" loading="lazy" decoding="async" />
                <span class="detail-trailer-play-badge"><img src="assets/icons/trailer_play_button.svg" alt="" aria-hidden="true" /></span>
              </div>
              <div class="detail-morelike-name">${escapeHtml(title)}</div>
              ${subtitle ? `<div class="detail-morelike-type">${escapeHtml(subtitle)}</div>` : ""}
            </article>
          `;
        })
        .join("");
      return `<div class="detail-morelike-track detail-trailer-track" data-scroll-key="trailer:${escapeHtml(kind)}">${cards}</div>`;
    }
  };
}
