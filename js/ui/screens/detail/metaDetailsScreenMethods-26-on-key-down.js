import { openDetailShuffle } from "./detailEpisodeShuffle.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods26() {
  const {
    Router,
    ScreenUtils,
    watchProgressRepository,
    watchedItemsRepository,
    detailWatchedEnrichmentService,
    watchedSeriesReconciliationService,
    EPISODE_SCROLL_REPEAT_THROTTLE_MS,
    isSeriesDetailMeta,
    resolveMetaImdbId,
    resolveMetaTmdbId,
    resolveMetaTraktId,
    resolveMetaOriginalLanguage,
    isBackEvent,
    getDpadDirection,
    getTrailerSeekStepSeconds,
    getTrailerMediaAction,
    buildYoutubeEmbedUrl
  } = internals;

  return {
    async onKeyDown(event) {
      if (!this.container) {
        return;
      }

      const code = Number(event?.keyCode || 0);
      const pointerActionTarget = event?.pointerActivation ? event?.target?.closest?.("[data-action]") || null : null;
      const currentFocusedNode = pointerActionTarget || this.container.querySelector(".focusable.focused") || null;

      const isEpisodeHoldTarget = this.isEpisodeHoldTarget(currentFocusedNode);
      const isSeasonHoldTarget = this.isSeasonHoldTarget(currentFocusedNode);
      const isPosterHoldTarget = this.isPosterHoldTarget(currentFocusedNode);
      const isHeroHoldTarget = this.isHeroHoldTarget(currentFocusedNode);
      if ((!isEpisodeHoldTarget && !isSeasonHoldTarget) || code !== 13) {
        this.cancelPendingEpisodeHold();
        this.cancelPendingSeasonHold();
      }
      if (!isPosterHoldTarget || code !== 13) {
        this.cancelPendingPosterHold();
      }
      if (!isHeroHoldTarget || code !== 13) {
        this.cancelPendingHeroHold();
      }

      if (isBackEvent(event)) {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (this.consumeBackRequest()) {
          return;
        }
        if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
          this.closeEpisodeStreamChooser();
          return;
        }
        Router.back();
        return;
      }

      if (this.isTrailerPlaying && this.trailerPlaybackMode === "autoplay") {
        this.stopTrailerPlayback({ restartAutoplay: false });
      }

      if (!event?.pointerActivation && this.isTrailerPlaying && this.trailerPlaybackMode === "manual") {
        this.restartTrailerControlsTimer();
        const direction = getDpadDirection(event);
        const mediaAction = getTrailerMediaAction(event);
        if (event.keyCode === 13 || mediaAction === "toggle") {
          event?.preventDefault?.();
          this.toggleActiveTrailerPlayback();
          return;
        }
        if (mediaAction === "play") {
          event?.preventDefault?.();
          this.setActiveTrailerPausedState(false);
          return;
        }
        if (mediaAction === "pause") {
          event?.preventDefault?.();
          this.setActiveTrailerPausedState(true);
          return;
        }
        if (direction === "left") {
          event?.preventDefault?.();
          this.seekTrailerBy(-getTrailerSeekStepSeconds(event));
          return;
        }
        if (direction === "right") {
          event?.preventDefault?.();
          this.seekTrailerBy(getTrailerSeekStepSeconds(event));
          return;
        }
        if (direction === "up" || direction === "down") {
          event?.preventDefault?.();
          if (direction === "down") {
            this.stopTrailerControlsTimer();
            this.setTrailerControlsVisible(false);
          } else {
            this.restartTrailerControlsTimer();
          }
          return;
        }
      } else if (!this.isTrailerPlaying) {
        this.restartTrailerAutoplayTimer();
      }

      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        if (this.handleStreamChooserDpad(event)) {
          return;
        }
        if (getDpadDirection(event)) {
          event?.preventDefault?.();
          return;
        }
      }

      if (code === 13 && isEpisodeHoldTarget && !event?.pointerActivation) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingEpisodeHold(currentFocusedNode)) {
          this.startPendingEpisodeHold(currentFocusedNode);
        }
        return;
      }
      if (code === 13 && isHeroHoldTarget && !event?.pointerActivation) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingHeroHold(currentFocusedNode)) {
          this.startPendingHeroHold(currentFocusedNode);
        }
        return;
      }
      if (code === 13 && isPosterHoldTarget && !event?.pointerActivation) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingPosterHold(currentFocusedNode)) {
          this.startPendingPosterHold(currentFocusedNode);
        }
        return;
      }
      if (code === 13 && isSeasonHoldTarget && !event?.pointerActivation) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingSeasonHold(currentFocusedNode)) {
          this.startPendingSeasonHold(currentFocusedNode);
        }
        return;
      }

      const direction = getDpadDirection(event);
      const isEpisodeDirectionKey = Boolean(direction) && isEpisodeHoldTarget && (direction === "left" || direction === "right");
      if (isEpisodeDirectionKey) {
        event?.preventDefault?.();
        if (event?.repeat) {
          const now = Date.now();
          const elapsedSinceRepeat = now - Number(this.lastEpisodeHorizontalKeyRepeatAt || 0);
          if (elapsedSinceRepeat < EPISODE_SCROLL_REPEAT_THROTTLE_MS) {
            return;
          }
          this.lastEpisodeHorizontalKeyRepeatAt = now;
        }
        if (this.moveEpisodeFocus(direction)) {
          return;
        }
      }

      if (this.handleSeriesDpad(event)) {
        return;
      }

      if (this.handleMovieDpad(event)) {
        return;
      }

      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }

      if (code !== 13) {
        return;
      }

      const current = pointerActionTarget || this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }

      const action = current.dataset.action;
      if (action === "openSynopsis") {
        if (current.classList.contains("focusable")) this.openSynopsis();
        return;
      }
      if (action === "goBack") {
        if (this.navigateBackFromDetail()) {
          return;
        }
        Router.back();
        return;
      }

      if (action === "openSearch") {
        Router.navigate("search", {
          query: this.params?.fallbackTitle || this.params?.itemId || ""
        });
        return;
      }

      if (action === "shuffleEpisodes") {
        openDetailShuffle(this);
        return;
      }
      if (action === "playDefault") {
        await this.playDefaultFromHero();
        return;
      }

      if (action === "playFromBeginning") {
        await this.playDefaultFromHero({ startOver: true });
        return;
      }

      if (action === "toggleTrailer") {
        this.playTrailer({ muted: false, restart: true, initiatedByUser: true });
        return;
      }

      if (action === "selectSeason") {
        const season = Number(current.dataset.season || 1);
        if (season !== this.selectedSeason) {
          this.selectSeason(season);
        }
        return;
      }

      if (action === "setSeriesInsightTab") {
        const tab = String(current.dataset.tab || "cast");
        if (tab !== this.seriesInsightTab) {
          this.seriesInsightTab = ["cast", "ratings", "morelike", "trailer", "collection"].includes(tab) ? tab : "cast";
          this.updateRenderedDetailSections(this.meta);
        }
        return;
      }

      if (action === "setMovieInsightTab") {
        const tab = String(current.dataset.tab || "cast");
        if (tab !== this.movieInsightTab) {
          this.movieInsightTab = ["cast", "morelike", "trailer", "collection"].includes(tab) ? tab : "cast";
          this.updateRenderedDetailSections(this.meta);
        }
        return;
      }

      if (action === "setCommentsMode") {
        const mode = String(current.dataset.commentsMode || "title") === "episode" ? "episode" : "title";
        this.commentsMode = mode;
        if (mode === "episode" && !this.commentsEpisodeTarget) {
          this.commentsEpisodeTarget = this.nextEpisodeToWatch || this.episodes?.[0] || null;
        }
        this.commentsItems = [];
        this.commentsPage = 0;
        this.updateRenderedDetailSections(this.meta);
        void this.loadTraktComments({ force: true });
        return;
      }

      if (action === "retryComments") {
        void this.loadTraktComments({ force: true });
        return;
      }

      if (action === "openSharedTrailer") {
        const ytId = String(current.dataset.trailerYtId || "").trim();
        if (ytId) {
          this.trailerSource = {
            kind: "youtube",
            ytId,
            embedUrl: buildYoutubeEmbedUrl(ytId, { muted: false })
          };
          this.playTrailer({
            muted: false,
            restart: true,
            initiatedByUser: true,
            preserveSource: true
          });
        }
        return;
      }

      if (action === "openComment") {
        this.openCommentOverlay(Number(current.dataset.commentIndex || 0));
        return;
      }

      if (action === "selectRatingSeason") {
        const season = Number(current.dataset.season || this.selectedRatingSeason || 1);
        if (season !== this.selectedRatingSeason) {
          this.selectedRatingSeason = season;
          this.render(this.meta);
        }
        return;
      }

      if (action === "openEpisodeStreams") {
        const selectedEpisode = this.episodes.find((entry) => entry.id === current.dataset.videoId);
        if (selectedEpisode) {
          await this.openEpisodeStreamChooser(selectedEpisode.id);
        }
        return;
      }

      if (action === "setStreamFilter") {
        if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
          const addon = current.dataset.addon || "all";
          if (this.pendingEpisodeSelection) {
            this.pendingEpisodeSelection.addonFilter = addon;
            const addons = Array.from(new Set(this.pendingEpisodeSelection.streams.map((stream) => stream.addonName).filter(Boolean)));
            const order = ["all", ...addons];
            this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
            this.renderEpisodeStreamChooser();
          } else {
            this.pendingMovieSelection.addonFilter = addon;
            const addons = Array.from(new Set(this.pendingMovieSelection.streams.map((stream) => stream.addonName).filter(Boolean)));
            const order = ["all", ...addons];
            this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
            this.renderMovieStreamChooser();
          }
        }
        return;
      }

      if (action === "playEpisodeStream" || action === "playPendingStream") {
        if (this.pendingEpisodeSelection) {
          this.playEpisodeFromSelectedStream(current.dataset.streamId);
        } else if (this.pendingMovieSelection) {
          this.playMovieFromSelectedStream(current.dataset.streamId);
        }
        return;
      }

      if (action === "openCastDetail") {
        Router.navigate("castDetail", {
          castId: current.dataset.castId || "",
          castName: current.dataset.castName || "",
          castRole: current.dataset.castRole || "",
          castPhoto: current.dataset.castPhoto || ""
        });
        return;
      }

      if (action === "openTmdbEntity") {
        this.openTmdbEntityFromNode(current);
        return;
      }

      if (action === "toggleLibrary") {
        await this.toggleLibraryFromHero();
        return;
      }

      if (action === "toggleWatched") {
        const profileId = ProfileManager.getActiveProfileId();
        const token = this.detailLoadToken;
        const current = () => ProfileManager.getActiveProfileId() === profileId && this.detailLoadToken === token;
        const focusRestore = this.captureDetailFocus();
        const isSeries = isSeriesDetailMeta(this.meta, this.episodes);
        if (isSeries) {
          if (this.isMarkedWatched) {
            if (
              (await watchedSeriesReconciliationService.unmarkSeriesWatched(this.params?.itemId, {
                meta: this.meta
              })) === false
            ) {
              if (current()) {
                await this.refreshEpisodePlaybackState();
                if (current()) this.render(this.meta, focusRestore);
              }
              return false;
            }
            if (!current()) return false;
          } else {
            const marked = await watchedSeriesReconciliationService.markSeriesWatched(
              this.params?.itemId,
              this.params?.itemType || this.meta?.type || "series",
              {
                meta: this.meta,
                title: this.meta?.name || this.params?.fallbackTitle || "Untitled"
              }
            );
            if (!marked) {
              if (current()) {
                await this.refreshEpisodePlaybackState();
                if (current()) this.render(this.meta, focusRestore);
              }
              return false;
            }
          }
        } else if (this.isMarkedWatched) {
          const providerIds = {
            imdbId: resolveMetaImdbId(this.meta, this.params),
            tmdbId: resolveMetaTmdbId(this.meta, this.params),
            traktId: resolveMetaTraktId(this.meta, this.params)
          };
          if (
            (await watchedItemsRepository.unmark(this.params?.itemId, {
              ...providerIds,
              contentType: this.params?.itemType || "movie",
              title: this.meta?.name || this.params?.fallbackTitle || "Untitled"
            })) === false ||
            !current()
          )
            return false;
          await watchProgressRepository.removeProgress(this.params?.itemId);
        } else {
          const providerIds = {
            imdbId: resolveMetaImdbId(this.meta, this.params),
            tmdbId: resolveMetaTmdbId(this.meta, this.params),
            traktId: resolveMetaTraktId(this.meta, this.params)
          };
          if (
            (await watchedItemsRepository.mark({
              contentId: this.params?.itemId,
              ...providerIds,
              contentType: this.params?.itemType || "movie",
              title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
              watchedAt: Date.now()
            })) === false ||
            !current()
          )
            return false;
          await watchProgressRepository.saveProgress({
            contentId: this.params?.itemId,
            ...providerIds,
            contentType: this.params?.itemType || "movie",
            videoId: null,
            positionMs: 100,
            durationMs: 100,
            updatedAt: Date.now()
          });
        }
        if (!current()) return false;
        if (!isSeries && this.meta?.ids?.trakt) {
          const enriched = await detailWatchedEnrichmentService.enrichMovieWatchedState(this.params?.itemId, this.meta.ids.trakt);
          this.enrichedMovieState = enriched;
          this.isMarkedWatched = Boolean(enriched?.isWatched);
        }
        if (!current()) return false;
        await this.refreshEpisodePlaybackState();
        if (!current()) return false;
        this.render(this.meta, focusRestore);
        return;
      }

      if (action === "playStream" && current.dataset.streamUrl) {
        const imdbId = resolveMetaImdbId(this.meta, this.params);
        const tmdbId = resolveMetaTmdbId(this.meta, this.params);
        const traktId = resolveMetaTraktId(this.meta, this.params);
        const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
        const resumeParams = this.getResumeParamsForProgress(this.getActiveResumeProgress());
        const selectedStream =
          (this.streamItems || []).find((stream) => String(stream?.url || "") === String(current.dataset.streamUrl || "")) || null;
        this.stopTrailerPlaybackForNavigation();
        Router.navigate("player", {
          streamUrl: current.dataset.streamUrl,
          itemId: this.params?.itemId,
          itemType: this.params?.itemType,
          imdbId,
          tmdbId,
          traktId,
          contentLanguage,
          returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
          returnToStreamOnBack: false,
          season: this.nextEpisodeToWatch?.season ?? null,
          episode: this.nextEpisodeToWatch?.episode ?? null,
          playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
          playerSubtitle: this.params?.itemType === "series" ? this.nextEpisodeToWatch?.title || "" : "",
          playerEpisodeTitle: this.nextEpisodeToWatch?.title || "",
          playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
          playerLogoUrl: this.meta?.logo || null,
          episodes: this.episodes || [],
          streamCandidates: this.streamItems || [],
          preferredStreamId: selectedStream?.id || null,
          playbackSourceContext: selectedStream
            ? selectedStream.streamOrigin || {
                addonId: selectedStream.addonId || "",
                addonBaseUrl: selectedStream.addonBaseUrl || "",
                addonName: selectedStream.addonName || "",
                addonOrderIndex: Number.isFinite(Number(selectedStream.addonOrderIndex)) ? Number(selectedStream.addonOrderIndex) : null,
                sourceProviderId: selectedStream.sourceProviderId || "",
                sourceIds: Array.isArray(selectedStream.sources) ? selectedStream.sources : [],
                selectedStreamId: selectedStream.id || ""
              }
            : null,
          ...resumeParams
        });
        return;
      }

      if (action === "openMoreLikeDetail") {
        this.openMoreLikeDetailFromNode(current);
      }
    }
  };
}
