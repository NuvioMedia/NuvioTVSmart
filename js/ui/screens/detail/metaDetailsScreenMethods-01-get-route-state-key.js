import { detailShuffleSettings } from "./detailEpisodeShuffle.js";
/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods01() {
  const {
    resolveTrailerPostMessageTargetOrigin,
    resolveTrailerTrustedProxyOrigin,
    resolveTrailerSource,
    normalizeTrailerProxyStatePayload,
    captureHorizontalScrollMap
  } = internals;

  return {
    getRouteStateKey(params = {}) {
      const itemId = String(params?.itemId || "").trim();
      if (!itemId) {
        return null;
      }
      return `detail:${String(params?.itemType || "movie").trim() || "movie"}:${itemId}`;
    },
    captureRouteState() {
      const content = this.container?.querySelector(".series-detail-content");
      return {
        params: this.params ? { ...this.params } : {},
        meta: this.meta ? { ...this.meta } : null,
        isSavedInLibrary: Boolean(this.isSavedInLibrary),
        isMarkedWatched: Boolean(this.isMarkedWatched),
        episodes: Array.isArray(this.episodes) ? [...this.episodes] : [],
        castItems: Array.isArray(this.castItems) ? [...this.castItems] : [],
        detailEnrichmentComplete: this.detailEnrichmentComplete === true,
        moreLikeThisItems: Array.isArray(this.moreLikeThisItems) ? [...this.moreLikeThisItems] : [],
        moreLikeThisSource: this.moreLikeThisSource || null,
        collectionItems: Array.isArray(this.collectionItems) ? [...this.collectionItems] : [],
        commentsItems: Array.isArray(this.commentsItems) ? [...this.commentsItems] : [],
        collectionName: String(this.collectionName || ""),
        seriesRatingsBySeason: this.seriesRatingsBySeason ? { ...this.seriesRatingsBySeason } : {},
        nextEpisodeToWatch: this.nextEpisodeToWatch ? { ...this.nextEpisodeToWatch } : null,
        trailerSource: this.trailerSource ? { ...this.trailerSource } : null,
        selectedSeason: Number(this.selectedSeason || 0),
        selectedRatingSeason: Number(this.selectedRatingSeason || 0),
        seriesInsightTab: String(this.seriesInsightTab || "cast"),
        movieInsightTab: String(this.movieInsightTab || "cast"),
        commentsPage: Number(this.commentsPage || 0),
        commentsPageCount: Number(this.commentsPageCount || 0),
        episodeFocusIndexBySeason: this.episodeFocusIndexBySeason ? { ...this.episodeFocusIndexBySeason } : {},
        railFocusIndexByKey: this.railFocusIndexByKey ? { ...this.railFocusIndexByKey } : {},
        pendingFocusRestore: this.captureDetailFocus(),
        contentScrollTop: Number(content?.scrollTop || 0),
        trackScrollLeftByKey: captureHorizontalScrollMap(this.container),
        episodeShuffleEnabled: detailShuffleSettings(this).enabled,
        episodeProgressEntries: Array.from(this.episodeProgressMap?.entries?.() || []),
        watchedEpisodeKeys: Array.from(this.watchedEpisodeKeys || [])
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      const restoredItemId = String(snapshot?.params?.itemId || "").trim();
      const nextItemId = String(params?.itemId || "").trim();
      if (!snapshot?.meta || !restoredItemId || restoredItemId !== nextItemId) {
        return false;
      }
      this.params = params || {};
      this.meta = { ...snapshot.meta };
      this.isSavedInLibrary = Boolean(snapshot.isSavedInLibrary);
      this.isMarkedWatched = Boolean(snapshot.isMarkedWatched);
      this.episodes = Array.isArray(snapshot.episodes) ? [...snapshot.episodes] : [];
      this.castItems = Array.isArray(snapshot.castItems) ? [...snapshot.castItems] : [];
      this.detailEnrichmentComplete = snapshot.detailEnrichmentComplete === true;
      this.moreLikeThisItems = Array.isArray(snapshot.moreLikeThisItems) ? [...snapshot.moreLikeThisItems] : [];
      this.moreLikeThisSource = snapshot.moreLikeThisSource || null;
      this.collectionItems = Array.isArray(snapshot.collectionItems) ? [...snapshot.collectionItems] : [];
      this.commentsItems = Array.isArray(snapshot.commentsItems) ? [...snapshot.commentsItems] : [];
      this.collectionName = String(snapshot.collectionName || "");
      this.seriesRatingsBySeason = snapshot.seriesRatingsBySeason ? { ...snapshot.seriesRatingsBySeason } : {};
      this.nextEpisodeToWatch = snapshot.nextEpisodeToWatch ? { ...snapshot.nextEpisodeToWatch } : null;
      this.trailerSource = snapshot.trailerSource ? { ...snapshot.trailerSource } : resolveTrailerSource(this.meta);
      this.selectedSeason = Number(snapshot.selectedSeason ?? this.episodes[0]?.season ?? 1);
      this.selectedRatingSeason = Number(snapshot.selectedRatingSeason || this.selectedSeason || 1);
      this.seriesInsightTab = String(snapshot.seriesInsightTab || "cast");
      this.movieInsightTab = String(snapshot.movieInsightTab || "cast");
      this.commentsPage = Number(snapshot.commentsPage || 0);
      this.commentsPageCount = Number(snapshot.commentsPageCount || 0);
      this.episodeFocusIndexBySeason =
        snapshot.episodeFocusIndexBySeason && typeof snapshot.episodeFocusIndexBySeason === "object"
          ? { ...snapshot.episodeFocusIndexBySeason }
          : {};
      this.railFocusIndexByKey =
        snapshot.railFocusIndexByKey && typeof snapshot.railFocusIndexByKey === "object" ? { ...snapshot.railFocusIndexByKey } : {};
      this.pendingFocusRestore = snapshot.pendingFocusRestore ? { ...snapshot.pendingFocusRestore } : null;
      this.restoredContentScrollTop = Number(snapshot.contentScrollTop || 0);
      this.restoredTrackScrollLeftByKey =
        snapshot.trackScrollLeftByKey && typeof snapshot.trackScrollLeftByKey === "object" ? { ...snapshot.trackScrollLeftByKey } : {};
      this.episodeProgressMap = new Map(Array.isArray(snapshot.episodeProgressEntries) ? snapshot.episodeProgressEntries : []);
      this.watchedEpisodeKeys = new Set(Array.isArray(snapshot.watchedEpisodeKeys) ? snapshot.watchedEpisodeKeys : []);
      return true;
    },
    bindTrailerProxyMessaging() {
      if (this.trailerProxyMessageHandler) {
        window.removeEventListener("message", this.trailerProxyMessageHandler);
      }
      const trustedProxyOrigin = resolveTrailerTrustedProxyOrigin();
      this.trailerProxyMessageHandler = (event) => {
        const frameWindow = this.trailerUiRefs?.frame?.contentWindow;
        const data = event?.data;
        if (!data || typeof data !== "object" || data.source !== "nuvio-youtube-proxy") {
          return;
        }
        const eventOrigin = String(event?.origin || "").trim();
        const sourceMatchesFrame = Boolean(frameWindow && event?.source === frameWindow);
        const originMatchesProxy = Boolean(trustedProxyOrigin && eventOrigin === trustedProxyOrigin);
        if (!sourceMatchesFrame && !originMatchesProxy) {
          return;
        }
        if (data.type === "ready") {
          this.stopTrailerProxyLoadingTimer();
          this.trailerProxyState = {
            currentTime: 0,
            duration: 0,
            paused: false,
            muted: Boolean(this.trailerMuted),
            captionsEnabled: Boolean(this.trailerSubtitlesEnabled),
            loading: true,
            controllable: true
          };
          this.postTrailerProxyCommand("setMuted", {
            muted: Boolean(this.trailerMuted)
          });
          this.postTrailerProxyCommand("setCaptionsEnabled", {
            enabled: Boolean(this.trailerSubtitlesEnabled)
          });
          this.postTrailerProxyCommand("play");
          this.postTrailerProxyCommand("getState");
          this.startTrailerFirstFramePolling();
          if (this.trailerPlaybackMode === "manual") {
            this.updateTrailerOverlay();
          }
          return;
        }
        if (data.type === "ended") {
          const endedId = String(data.videoId || "").trim();
          const activeId = String(this.trailerSource?.ytId || "").trim();
          if (this.isTrailerPlaying && this.trailerSource?.kind === "youtube" && (!endedId || !activeId || endedId === activeId)) {
            this.stopTrailerPlayback();
          }
          return;
        }
        if (data.type === "firstFrame") {
          const frameVideoId = String(data.videoId || "").trim();
          const activeId = String(this.trailerSource?.ytId || "").trim();
          const frameTime = Number(data.currentTime || 0);
          if (frameTime > 0 && (!frameVideoId || !activeId || frameVideoId === activeId)) {
            this.markTrailerVisualReady();
          }
          return;
        }
        if (data.type === "state") {
          const stateVideoId = String(data.videoId || "").trim();
          const activeVideoId = String(this.trailerSource?.ytId || "").trim();
          if (stateVideoId && activeVideoId && stateVideoId !== activeVideoId) {
            return;
          }
          const nextState = normalizeTrailerProxyStatePayload(data, this.trailerMuted, this.trailerSubtitlesEnabled);
          if (nextState.loading === false || Number(nextState.duration || 0) > 0 || Number(nextState.currentTime || 0) > 0) {
            this.stopTrailerProxyLoadingTimer();
          }
          this.trailerProxyState = nextState;
          this.trailerYoutubeFallbackActive = nextState.controllable === false;
          if (this.trailerYoutubeFallbackActive) {
            this.scheduleTrailerFallbackReveal(activeVideoId);
          }
          if (!nextState.loading && Number(nextState.currentTime || 0) > 0) {
            this.markTrailerVisualReady();
          }
          if (nextState.ended) {
            this.stopTrailerPlayback();
            return;
          }
          if (this.trailerPlaybackMode === "manual") {
            this.updateTrailerOverlay();
          }
        }
      };
      window.addEventListener("message", this.trailerProxyMessageHandler);
    },
    postTrailerProxyCommand(command, payload = {}) {
      const frameWindow = this.trailerUiRefs?.frame?.contentWindow;
      if (!frameWindow) {
        return false;
      }
      const src = String(this.trailerUiRefs?.frame?.src || this.trailerSource?.embedUrl || "");
      const targetOrigin = resolveTrailerPostMessageTargetOrigin(src);
      try {
        frameWindow.postMessage(
          {
            source: "nuvio-detail-trailer",
            type: "command",
            command: String(command || ""),
            payload: payload && typeof payload === "object" ? payload : {}
          },
          targetOrigin
        );
        return true;
      } catch (_) {
        return false;
      }
    }
  };
}
