/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods02() {
  const { Router, ScreenUtils, hasMdbListRatings } = internals;

  return {
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("detail");
      ScreenUtils.show(this.container);
      this.stopTrailerPlayback({
        keepDom: false,
        restartAutoplay: false,
        restoreFocus: false
      });
      this.params = params;
      this.isBackNavigation = Boolean(navigationContext?.isBackNavigation);
      this.pendingEpisodeSelection = null;
      this.pendingMovieSelection = null;
      this.episodeHoldMenu = null;
      this.seasonHoldMenu = null;
      this.heroPlayMenu = null;
      this.libraryListMenu = null;
      this.detailHoldDialog = null;
      this.posterOptionsController = null;
      this.posterOptionsFocusRestore = null;
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;
      this.pendingHeroHoldTarget = null;
      this.pendingHeroHoldTimer = null;
      this.streamChooserFocus = null;
      this.streamChooserLoadToken = 0;
      this.isLoadingDetail = true;
      this.detailLoadToken = (this.detailLoadToken || 0) + 1;
      this.libraryMembershipMutationToken = 0;
      this.libraryTogglePending = false;
      this.seriesInsightTab = "cast";
      this.movieInsightTab = "cast";
      this.selectedRatingSeason = 0;
      this.selectedSeason = 0;
      this.hasManualSeasonSelection = false;
      this.collectionItems = [];
      this.collectionName = "";
      this.commentsItems = [];
      this.commentsPage = 0;
      this.commentsPageCount = 0;
      this.commentsError = "";
      this.commentsLoading = false;
      this.commentsLoadingMore = false;
      this.commentsMode = "title";
      this.commentsEpisodeTarget = null;
      this.selectedCommentIndex = -1;
      this.trailerSource = null;
      this.trailerSourceResolutionKey = "";
      this.trailerSourceResolutionPromise = null;
      this.trailerSourceResolutionResult = null;
      this.isTrailerPlaying = false;
      this.trailerPlaybackMode = null;
      this.trailerVisualReady = false;
      this.trailerHasAutoplayed = false;
      this.trailerMuted = false;
      this.trailerSubtitlesEnabled = false;
      this.trailerMediaListeners = [];
      this.trailerUiRefs = null;
      this.trailerProgressTimer = null;
      this.trailerControlsTimer = null;
      this.trailerProxyLoadingTimer = null;
      this.trailerFirstFramePollTimer = null;
      this.trailerFallbackRevealTimer = null;
      this.trailerControlsVisible = true;
      this.trailerProxyState = null;
      this.trailerProxyMessageHandler = null;
      this.trailerYoutubeFallbackActive = false;
      this.trailerDomGeneration = 0;
      this.trailerFocusRestore = null;
      this.episodeProgressMap = new Map();
      this.resumeProgress = null;
      this.resumeContentIds = [];
      this.episodeFocusIndexBySeason = {};
      this.episodeVirtualWindow = null;
      this.episodeVirtualMetrics = null;
      this.episodeTrackScrollHandler = null;
      this.episodeTrackScrollNode = null;
      this.episodeVirtualSyncRaf = null;
      this.lastEpisodeHorizontalKeyRepeatAt = 0;
      this.episodeMarqueeTitle = null;
      this.episodeThumbnailPrefetchCache = new Set();
      this.selectedSeasonEpisodeState = null;
      this.railFocusIndexByKey = {};
      this._railWindows = {};
      this.watchedEpisodeKeys = new Set();
      this.autoOpenedContinueWatchingStream = false;
      this.playOnLoadTriggered = false;
      this.restoredContentScrollTop = 0;
      this.restoredTrackScrollLeftByKey = {};
      this.bindTrailerProxyMessaging();

      // Route snapshots preserve focus and scroll when navigating Back. A fresh
      // entry from Home must reload metadata instead of reviving a stale detail
      // snapshot captured before playback/background enrichment completed.
      const restoredRouteState = navigationContext?.isBackNavigation ? navigationContext?.restoredState || null : null;
      if (this.hydrateFromRouteState(restoredRouteState, params)) {
        this.isLoadingDetail = false;
        this.render(this.meta, this.pendingFocusRestore);
        const refreshToken = this.detailLoadToken;
        void this.refreshLibraryMembership(refreshToken);
        void this.refreshEpisodePlaybackState()
          .then(() => {
            if (refreshToken !== this.detailLoadToken || !this.container) {
              return;
            }
            this.updateRenderedDetailSections(this.meta, this.pendingFocusRestore || null);
          })
          .catch((error) => {
            console.warn("Detail playback state refresh failed", error);
          });
        if (!hasMdbListRatings(this.meta?.mdbListRatings)) {
          void this.loadMdbListRatings(this.meta, refreshToken);
        }
        this.maybeAutoOpenContinueWatchingStream();
        return;
      }

      this.container.innerHTML = `
          <div class="detail-loading-shell" aria-label="Loading detail">
            <div class="detail-loading-top">
              <div class="detail-loading-block detail-loading-poster"></div>
            </div>
            <div class="detail-loading-meta">
              <div class="detail-loading-block detail-loading-pill"></div>
              <div class="detail-loading-block detail-loading-pill short"></div>
            </div>
            <div class="detail-loading-copy">
              <div class="detail-loading-block detail-loading-line"></div>
              <div class="detail-loading-block detail-loading-line wide"></div>
              <div class="detail-loading-block detail-loading-line mid"></div>
            </div>
            <div class="detail-loading-tags">
              <div class="detail-loading-block detail-loading-tag"></div>
              <div class="detail-loading-block detail-loading-tag"></div>
              <div class="detail-loading-block detail-loading-tag"></div>
              <div class="detail-loading-block detail-loading-tag"></div>
            </div>
            <div class="detail-loading-tags">
              <div class="detail-loading-block detail-loading-chip"></div>
              <div class="detail-loading-block detail-loading-chip"></div>
            </div>
          </div>
        `;

      // Android composes Detail immediately and lets the ViewModel load metadata
      // independently. The loading shell is already visible, so do not hold
      // route completion or Back/D-pad handling on canonicalization or metadata
      // requests.
      const loadToken = this.detailLoadToken;
      void this.loadDetail().catch((error) => {
        if (loadToken !== this.detailLoadToken || Router.getCurrent() !== "detail" || !this.container) {
          return;
        }
        console.warn("Detail background load failed", error);
        this.renderError("Unable to load detail.");
      });
    }
  };
}
