/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods21() {
  const {
    Router,
    ScreenUtils,
    resolveMovieStreamIdentity,
    StreamPreferencesStore,
    resolvePlayableDetailType,
    resolveMetaImdbId,
    resolveMetaTmdbId,
    resolveMetaTraktId,
    resolveMetaOriginalLanguage
  } = internals;

  return {
    consumeBackRequest() {
      if (this.commentOverlayDialog) {
        this.closeCommentOverlay();
        return true;
      }
      if (this.synopsisDialog) {
        this.synopsisDialog.destroy();
        this.synopsisDialog = null;
        this.focusDetailDescriptor({ selector: ".series-detail-description" });
        return true;
      }
      if (this.shuffleDialog) {
        this.shuffleDialog.destroy();
        this.shuffleDialog = null;
        this.focusDetailDescriptor({ selector: '[data-action="shuffleEpisodes"]' });
        return true;
      }
      if (this.seasonHoldMenu) {
        this.closeSeasonHoldMenu();
        return true;
      }
      if (this.episodeHoldMenu) {
        this.closeEpisodeHoldMenu();
        return true;
      }
      if (this.posterOptionsController?.dialog) {
        this.closePosterOptionsMenu();
        return true;
      }
      if (this.heroPlayMenu || this.libraryListMenu) {
        this.closeHeroMenus();
        return true;
      }
      if (this.isTrailerPlaying) {
        this.stopTrailerPlayback();
        return true;
      }
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        this.closeEpisodeStreamChooser();
        return true;
      }
      if (this.navigateBackFromDetail()) {
        return true;
      }
      if (this.isLoadingDetail) {
        void Router.backFromPendingNavigation();
        return true;
      }
      return false;
    },
    playEpisodeFromSelectedStream(streamId) {
      const pending = this.pendingEpisodeSelection;
      if (!pending) {
        return;
      }
      const selectedStream = pending.streams.find((stream) => stream.id === streamId) || this.getFilteredEpisodeStreams()[0];
      if (!selectedStream?.url) {
        return;
      }
      const nextEpisode = this.getNextEpisodeAfter(pending.episode);
      const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
      const imdbId = resolveMetaImdbId(this.meta, this.params);
      const tmdbId = resolveMetaTmdbId(this.meta, this.params);
      const traktId = resolveMetaTraktId(this.meta, this.params);
      const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
      const resumeParams = this.getResumeParamsForProgress(this.getEpisodeMenuProgress(pending.episode), { useActiveFallback: false });
      this.stopTrailerPlaybackForNavigation();
      Router.navigate("player", {
        streamUrl: selectedStream.url,
        itemId: this.params?.itemId,
        itemType,
        imdbId,
        tmdbId,
        traktId,
        contentLanguage,
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        returnToStreamOnBack: false,
        videoId: pending.videoId,
        season: pending.episode?.season ?? null,
        episode: pending.episode?.episode ?? null,
        episodeLabel: pending.episode ? `S${pending.episode.season}E${pending.episode.episode}` : null,
        playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        playerReleaseYear: String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
        playerSubtitle: pending.episode
          ? `S${pending.episode.season}E${pending.episode.episode} - ${pending.episode.title || ""}`.replace(/\s+-\s*$/, "")
          : "",
        playerEpisodeTitle: pending.episode?.title || "",
        playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
        playerLogoUrl: this.meta?.logo || null,
        parentalWarnings: this.meta?.parentalWarnings || null,
        parentalGuide: this.meta?.parentalGuide || null,
        episodes: this.episodes || [],
        streamCandidates: pending.streams || [],
        preferredStreamId: selectedStream.id || null,
        playbackSourceContext: selectedStream.streamOrigin || {
          addonId: selectedStream.addonId || "",
          addonBaseUrl: selectedStream.addonBaseUrl || "",
          addonName: selectedStream.addonName || "",
          addonOrderIndex: Number.isFinite(Number(selectedStream.addonOrderIndex)) ? Number(selectedStream.addonOrderIndex) : null,
          sourceProviderId: selectedStream.sourceProviderId || "",
          sourceIds: Array.isArray(selectedStream.sources) ? selectedStream.sources : [],
          selectedStreamId: selectedStream.id || ""
        },
        fromDetailRoute: true,
        ...resumeParams,
        nextEpisodeVideoId: nextEpisode?.id || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
        nextEpisodeSeason: nextEpisode?.season ?? null,
        nextEpisodeEpisode: nextEpisode?.episode ?? null,
        nextEpisodeTitle: nextEpisode?.title || "",
        nextEpisodeReleased: nextEpisode?.released || ""
      });
    },
    navigateToStreamScreenForEpisode(episode, extraParams = {}) {
      if (!episode?.id) {
        return;
      }
      const nextEpisode = this.getNextEpisodeAfter(episode);
      const streamBackdrop = this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
      const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
      const imdbId = resolveMetaImdbId(this.meta, this.params);
      const tmdbId = resolveMetaTmdbId(this.meta, this.params);
      const traktId = resolveMetaTraktId(this.meta, this.params);
      const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
      const releaseYear = String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
      const resumeVideoId = String(this.params?.resumeVideoId || "").trim();
      const isContinueWatchingTarget = Boolean(
        this.params?.fromContinueWatching &&
        (resumeVideoId
          ? resumeVideoId === String(episode.id || "")
          : Number(this.params?.resumeSeason || 0) === Number(episode.season || 0) &&
            Number(this.params?.resumeEpisode || 0) === Number(episode.episode || 0))
      );
      this.stopTrailerPlaybackForNavigation();
      Router.navigate(
        "stream",
        {
          itemId: this.params?.itemId || null,
          itemType,
          imdbId,
          tmdbId,
          traktId,
          contentLanguage,
          originalItemId: this.params?.originalItemId || null,
          returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
          returnToDetail: true,
          fromDetailRoute: true,
          itemTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
          year: releaseYear,
          backdrop: streamBackdrop,
          poster: this.meta?.poster || null,
          logo: this.meta?.logo || null,
          runtime: episode.runtimeMinutes || null,
          parentalWarnings: this.meta?.parentalWarnings || null,
          parentalGuide: this.meta?.parentalGuide || null,
          videoId: episode.id,
          preferredStreamId: StreamPreferencesStore.get(this.params?.itemId, episode.id) || null,
          season: episode.season,
          episode: episode.episode,
          episodeTitle: episode.title || "",
          episodes: this.episodes || [],
          nextEpisodeVideoId: nextEpisode?.id || null,
          nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
          nextEpisodeSeason: nextEpisode?.season ?? null,
          nextEpisodeEpisode: nextEpisode?.episode ?? null,
          nextEpisodeTitle: nextEpisode?.title || "",
          nextEpisodeReleased: nextEpisode?.released || "",
          continueWatchingBackHome: isContinueWatchingTarget,
          resumeStreamIdentity: isContinueWatchingTarget ? this.params?.resumeStreamIdentity || null : null,
          ...extraParams
        },
        this.getStreamNavigationOptions()
      );
    },
    navigateToStreamScreenForMovie(extraParams = {}) {
      const releaseYear = String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
      const streamBackdrop = this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
      const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
      const { itemId, videoId } = resolveMovieStreamIdentity(this.meta, this.params);
      const imdbId = resolveMetaImdbId(this.meta, this.params);
      const tmdbId = resolveMetaTmdbId(this.meta, this.params);
      const traktId = resolveMetaTraktId(this.meta, this.params);
      const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
      this.stopTrailerPlaybackForNavigation();
      Router.navigate(
        "stream",
        {
          itemId,
          itemType,
          imdbId,
          tmdbId,
          traktId,
          contentLanguage,
          originalItemId: this.params?.originalItemId || null,
          returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
          returnToDetail: true,
          fromDetailRoute: true,
          itemTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
          itemSubtitle: "",
          genres: Array.isArray(this.meta?.genres) ? this.meta.genres.join(" • ") : "",
          year: releaseYear,
          backdrop: streamBackdrop,
          poster: this.meta?.poster || null,
          logo: this.meta?.logo || null,
          parentalWarnings: this.meta?.parentalWarnings || null,
          parentalGuide: this.meta?.parentalGuide || null,
          videoId,
          preferredStreamId: StreamPreferencesStore.get(itemId, videoId) || null,
          episodes: [],
          ...extraParams
        },
        this.getStreamNavigationOptions()
      );
    },
    playMovieFromSelectedStream(streamId) {
      const pending = this.pendingMovieSelection;
      if (!pending) {
        return;
      }
      const selectedStream = pending.streams.find((stream) => stream.id === streamId) || this.getFilteredEpisodeStreams()[0];
      if (!selectedStream?.url) {
        return;
      }
      const imdbId = resolveMetaImdbId(this.meta, this.params);
      const tmdbId = resolveMetaTmdbId(this.meta, this.params);
      const traktId = resolveMetaTraktId(this.meta, this.params);
      const contentLanguage = resolveMetaOriginalLanguage(this.meta, this.params);
      const resumeParams = this.getResumeParamsForProgress(this.getActiveResumeProgress());
      this.stopTrailerPlaybackForNavigation();
      Router.navigate("player", {
        streamUrl: selectedStream.url,
        itemId: this.params?.itemId,
        itemType: this.params?.itemType || "movie",
        imdbId,
        tmdbId,
        traktId,
        contentLanguage,
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        returnToStreamOnBack: false,
        season: null,
        episode: null,
        playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        playerSubtitle: "",
        playerReleaseYear: String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
        playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
        playerLogoUrl: this.meta?.logo || null,
        parentalWarnings: this.meta?.parentalWarnings || null,
        parentalGuide: this.meta?.parentalGuide || null,
        episodes: [],
        streamCandidates: pending.streams || [],
        preferredStreamId: selectedStream.id || null,
        playbackSourceContext: selectedStream.streamOrigin || {
          addonId: selectedStream.addonId || "",
          addonBaseUrl: selectedStream.addonBaseUrl || "",
          addonName: selectedStream.addonName || "",
          addonOrderIndex: Number.isFinite(Number(selectedStream.addonOrderIndex)) ? Number(selectedStream.addonOrderIndex) : null,
          sourceProviderId: selectedStream.sourceProviderId || "",
          sourceIds: Array.isArray(selectedStream.sources) ? selectedStream.sources : [],
          selectedStreamId: selectedStream.id || ""
        },
        fromDetailRoute: true,
        ...resumeParams
      });
    },
    renderError(message) {
      this.isLoadingDetail = false;
      this.container.innerHTML = `
          <div class="row">
            <h2>Detail</h2>
            <p>${message}</p>
            <div class="card focusable" data-action="goBack">Back</div>
          </div>
        `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    getDetailContentScroller() {
      return this.container?.querySelector(".series-detail-content") || null;
    },
    getDetailFocusGroup(node) {
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      return (
        node.closest(
          ".series-detail-actions, .series-season-row, .series-episode-track, .series-insight-tabs, .detail-comments-modes, .detail-comments-track, .movie-cast-track, .series-cast-track, .series-rating-seasons, .series-episode-ratings-grid, .detail-morelike-track, .detail-company-track"
        ) || node
      );
    }
  };
}
