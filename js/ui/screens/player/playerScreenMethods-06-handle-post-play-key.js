/* eslint-disable no-unused-vars */
import { normalizeClearKeys } from "../../../core/streams/clearKeys.js";
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods06() {
  const {
    PlayerController,
    Environment,
    Router,
    StreamPreferencesStore,
    buildStreamResumeIdentity,
    isSelectKeyCode,
    normalizeItemType,
    directPlaybackUrl,
    streamMergeKey
  } = internals;

  return {
    handlePostPlayKey(event) {
      const keyCode = Number(event?.keyCode || 0);
      const mount = this.uiRefs?.postPlay;
      if (!this.isPostPlayVisible()) {
        return false;
      }
      const modalOpen = this.postPlayManualDialogVisible || this.postPlaySynopsisVisible;
      if (modalOpen) {
        if (this.postPlaySynopsisVisible) {
          if (keyCode === 38) {
            return this.scrollPostPlaySynopsis(-1);
          }
          if (keyCode === 40) {
            return this.scrollPostPlaySynopsis(1);
          }
          // SynopsisOverlay has a single focusable scrolling surface. Select
          // and horizontal navigation do not dismiss it; Back is handled by
          // consumeBackRequest(), exactly like Android's Dialog.
          return true;
        }
        if (keyCode === 37 || keyCode === 39) {
          return true;
        }
        if (isSelectKeyCode(keyCode)) {
          this.invokePostPlayAction("manualPlay");
          return true;
        }
        return false;
      }
      if (this.getPostPlayState().isChangingRecommendation) {
        return true;
      }
      if (keyCode === 18 || keyCode === 82) {
        if (this.getPostPlayState().recommendation?.contentType === "movie" && this.isPostPlayManualPlayOptionEnabled()) {
          this.openPostPlayManualDialog();
        }
        return true;
      }
      if (keyCode === 37 || keyCode === 39) {
        const state = this.getPostPlayState();
        const sequence = ["primary"];
        if (!state.isTrailerPlaying && (state.recommendation?.trailerYtId || state.recommendation?.trailerVideoUrl)) {
          sequence.push("trailer");
        }
        if (state.recommendationCount > 1) {
          sequence.push("previous", "next");
        }
        const availableSequence = sequence.filter((action) =>
          mount?.querySelector?.(`[data-player-post-play-action="${action}"]:not([disabled])`)
        );
        if (!availableSequence.length) {
          return true;
        }
        const current = availableSequence.includes(this.postPlayFocusedAction) ? availableSequence.indexOf(this.postPlayFocusedAction) : 0;
        const nextIndex = Math.max(0, Math.min(availableSequence.length - 1, current + (keyCode === 39 ? 1 : -1)));
        this.focusPostPlayAction(availableSequence[nextIndex]);
        return true;
      }
      if (keyCode === 38) {
        const state = this.getPostPlayState();
        // Android's player window is the topmost focus target. Its Up key
        // must not route back down into the recommendation summary.
        if (this.postPlayFocusedAction === "playerWindow" || (this.postPlayFocusedAction === "primary" && state.isTrailerPlaying)) {
          return true;
        }
        if (this.postPlayFocusedAction === "synopsis") {
          if (state.canReturnToPlayer) this.focusPostPlayAction("playerWindow");
        } else if (this.postPlayDescriptionTruncated) {
          this.focusPostPlayAction("synopsis");
        } else if (state.canReturnToPlayer) {
          this.focusPostPlayAction("playerWindow");
        }
        return true;
      }
      if (keyCode === 40) {
        this.focusPostPlayAction("primary");
        return true;
      }
      if (isSelectKeyCode(keyCode)) {
        this.invokePostPlayAction(this.postPlayFocusedAction || "primary");
        return true;
      }
      return false;
    },
    navigateToPostPlayRecommendation(recommendation = {}, { openDetails = false, manualSelection = false } = {}) {
      if (!recommendation?.id) {
        return false;
      }
      this.stopPostPlayTrailer();
      this.postPlayRecommendationController?.stop?.();
      this.postPlayPlaybackEnded = false;
      this.postPlayNaturalEndPending = false;
      this.postPlayNaturalCompletionPrepared = false;
      const itemType = recommendation.contentType === "series" ? "series" : "movie";
      const detailParams = {
        itemId: recommendation.id,
        itemType,
        fallbackTitle: recommendation.title || recommendation.name || recommendation.id,
        fallbackPoster: recommendation.poster || "",
        fallbackBackground: recommendation.backdrop || recommendation.background || recommendation.poster || "",
        addonBaseUrl: recommendation.sourceAddonBaseUrl || "",
        imdbId: recommendation.imdbId || null,
        tmdbId: recommendation.tmdbId || null,
        traktId: recommendation.traktId || null,
        contentLanguage: recommendation.contentLanguage || this.contentLanguage || "",
        returnHomeOnBack: Boolean(this.params?.returnHomeOnBack || this.params?.returnToHomeOnBack),
        returnToHomeOnBack: Boolean(this.params?.returnHomeOnBack || this.params?.returnToHomeOnBack),
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        playOnLoad: !openDetails,
        manualSelection: Boolean(manualSelection),
        heroBackdropUrl: recommendation.backdrop || recommendation.background || ""
      };
      this.releaseCurrentEngineFsStreamBestEffort("post-play-recommendation", {
        removeTorrent: true
      });
      void Router.navigateFromPostPlayRecommendation("detail", detailParams);
      return true;
    },
    returnToPlayerFromPostPlay() {
      const state = this.getPostPlayState();
      if (!state.canReturnToPlayer) {
        return false;
      }
      const playbackEnded = Boolean(this.postPlayPlaybackEnded);
      if (!playbackEnded) {
        this.postPlayNaturalEndPending = false;
        this.postPlayPlaybackEnded = false;
        this.postPlayNaturalCompletionPrepared = false;
      }
      this.postPlayPendingSelect = false;
      this.postPlayPendingSelectAction = "";
      this.clearPostPlayLongPressTimer();
      this.postPlayLongPressTriggered = false;
      this.postPlayManualDialogVisible = false;
      this.postPlaySynopsisVisible = false;
      this.clearPostPlaySynopsisScrollAnimation();
      this.postPlayRenderedSignature = "";
      const returnedToPlayer = this.postPlayRecommendationController?.returnToPlayer?.();
      if (playbackEnded) {
        // Android keeps playbackEnded set after the post-play surface is
        // dismissed; its player effect then performs the natural completion
        // teardown and navigation. Do not resume an AVPlay stream that has
        // already emitted onstreamcompleted and been stopped.
        return returnedToPlayer !== false;
      }
      this.paused = false;
      try {
        PlayerController.resume();
      } catch (_) {}
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(false, { focus: false });
      this.updateUiTick();
      return true;
    },
    isExternalFrameMode() {
      return Boolean(this.externalFrameUrl);
    },
    isActiveMountToken(mountToken = null) {
      if (!this.playerRouteActive) {
        return false;
      }
      if (mountToken !== null && Number(mountToken) !== Number(this.playerMountToken || 0)) {
        return false;
      }
      return Boolean(this.container);
    },
    resolvePlaybackMediaSourceType(streamCandidate = this.getCurrentStreamCandidate()) {
      const normalizeSourceType =
        typeof PlayerController.normalizePlaybackSourceType === "function"
          ? PlayerController.normalizePlaybackSourceType.bind(PlayerController)
          : (value) => (String(value || "").includes("/") ? String(value || "").trim() : null);

      const declaredTypes = [
        streamCandidate?.raw?.mimeType,
        streamCandidate?.mimeType,
        streamCandidate?.sampleMimeType,
        streamCandidate?.engineFs?.mimeType,
        streamCandidate?.raw?.engineFs?.mimeType,
        streamCandidate?.sourceType,
        streamCandidate?.raw?.sourceType,
        streamCandidate?.raw?.type
      ];
      for (const value of declaredTypes) {
        const normalized = normalizeSourceType(value);
        if (normalized) {
          return normalized;
        }
      }

      const filenameHints = [
        streamCandidate?.behaviorHints?.filename,
        streamCandidate?.raw?.behaviorHints?.filename,
        streamCandidate?.raw?.filename
      ];
      for (const value of filenameHints) {
        const guessed =
          typeof PlayerController.guessMediaMimeType === "function" ? PlayerController.guessMediaMimeType(String(value || "")) : null;
        if (guessed) {
          return guessed;
        }
      }
      return null;
    },
    buildPlaybackContext(streamCandidate = this.getCurrentStreamCandidate()) {
      const requestHeaders = this.getCurrentStreamRequestHeaders(streamCandidate);
      const mediaSourceType = this.resolvePlaybackMediaSourceType(streamCandidate);
      return {
        clearKeys: normalizeClearKeys(
          streamCandidate?.behaviorHints?.clearKeys || streamCandidate?.raw?.behaviorHints?.clearKeys || streamCandidate?.clearKeys || null
        ),
        itemId: this.params.itemId || null,
        itemType: normalizeItemType(this.params.itemType || "movie"),
        imdbId: this.params.imdbId || this.params.imdb_id || null,
        tmdbId: this.params.tmdbId || this.params.tmdb_id || null,
        traktId: this.params.traktId || this.params.trakt_id || null,
        videoId: this.params.videoId || null,
        season: this.params.season == null ? null : Number(this.params.season),
        episode: this.params.episode == null ? null : Number(this.params.episode),
        title: this.params.playerTitle || this.params.itemTitle || null,
        poster: this.params.poster || null,
        background: this.params.playerBackdropUrl || this.params.backdrop || this.params.poster || null,
        logo: this.params.playerLogoUrl || this.params.logo || null,
        episodeTitle: this.params.episodeTitle || this.params.playerSubtitle || null,
        cloudSessionToken: this.params.cloudSessionToken || null,
        requestHeaders,
        mediaSourceType,
        streamIdentity: streamCandidate ? buildStreamResumeIdentity(streamCandidate) || streamMergeKey(streamCandidate) || null : null
      };
    },
    shouldPreserveWebOsTrackSelections(previousSourceCandidate, nextSourceCandidate, playbackUrl, forceEngine = null) {
      if (!Environment.isWebOS() || !PlayerController.playbackSessionActive) {
        return false;
      }
      const playbackEngine = String(PlayerController.playbackEngine || "");
      const sameForcedEngine = Boolean(forceEngine && playbackEngine && String(forceEngine) === playbackEngine);
      const hasSelectedAddonSubtitle = Boolean(this.selectedAddonSubtitleId);
      if (hasSelectedAddonSubtitle && !sameForcedEngine) {
        return false;
      }
      if (
        !PlayerController.webOsAudioSelectionExplicit &&
        !PlayerController.webOsSubtitleSelectionExplicit &&
        !(hasSelectedAddonSubtitle && sameForcedEngine)
      ) {
        return false;
      }
      if (forceEngine && playbackEngine && String(forceEngine) !== playbackEngine) {
        return false;
      }
      // The caller re-applies an addon subtitle after a same-engine, same-source
      // reopen. Other subtitle types still have separate lifecycles.
      if (
        this.selectedManifestSubtitleTrackId ||
        this.externalTrackNodes.length > 0 ||
        this.bitmapSubtitleTrack ||
        this.webOsEmbeddedTextSubtitleUsingAss
      ) {
        return false;
      }

      const previousIdentity = previousSourceCandidate
        ? buildStreamResumeIdentity(previousSourceCandidate) || streamMergeKey(previousSourceCandidate) || ""
        : "";
      const nextIdentity = nextSourceCandidate
        ? buildStreamResumeIdentity(nextSourceCandidate) || streamMergeKey(nextSourceCandidate) || ""
        : "";
      if (previousIdentity && nextIdentity) {
        return previousIdentity === nextIdentity;
      }

      const previousUrl = String(
        this.activePlaybackUrl || previousSourceCandidate?.url || previousSourceCandidate?.externalUrl || ""
      ).trim();
      const nextUrl = String(playbackUrl || nextSourceCandidate?.url || nextSourceCandidate?.externalUrl || "").trim();
      return Boolean(previousUrl && nextUrl && directPlaybackUrl(previousUrl) === directPlaybackUrl(nextUrl));
    },
    rememberSelectedStreamPreference(streamCandidate) {
      const prefContentId = String(this.params?.itemId || "").trim();
      const prefVideoId = String(this.params?.videoId || this.params?.itemId || "").trim();
      if (!streamCandidate?.id || !prefContentId || streamCandidate.partyShared || streamCandidate.raw?.partyShared) {
        return;
      }
      StreamPreferencesStore.set(prefContentId, prefVideoId, streamCandidate.id, {
        bingeGroup: streamCandidate?.behaviorHints?.bingeGroup || streamCandidate?.raw?.behaviorHints?.bingeGroup || "",
        filename: streamCandidate?.behaviorHints?.filename || streamCandidate?.raw?.behaviorHints?.filename || null,
        infoHash: streamCandidate?.infoHash || streamCandidate?.raw?.infoHash || null,
        resumeIdentity: buildStreamResumeIdentity(streamCandidate)
      });
    }
  };
}
