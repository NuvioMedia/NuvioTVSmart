/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { scraperIdFromPluginBingeGroup } from "../../../core/streams/pluginBingeGroup.js";

export function createPlayerScreenMethods22() {
  const {
    PlayerController,
    shouldTreatAsNaturalPlaybackCompletion,
    PlayerSettingsStore,
    Router,
    shouldShowNextEpisodeCardRule,
    normalizeItemType,
    isSeriesItemType
  } = internals;

  return {
    shouldShowNextEpisodeCard() {
      const nextEpisode = this.resolveNextEpisodeInfo();
      if (!nextEpisode) {
        return false;
      }
      if (!this.hasPresentedPlaybackFrame) {
        return false;
      }
      const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
      const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
        return false;
      }
      if (!this.isNaturalPlaybackCompletionEligible(durationSeconds)) {
        return false;
      }
      const shouldShow = this.getNextEpisodeCardThresholdReached(currentSeconds, durationSeconds);
      if (this.nextEpisodeCardTriggered && !this.nextEpisodeLaunching && !shouldShow) {
        this.resetNextEpisodeCardCycle({ render: false });
        return false;
      }
      if (this.nextEpisodeCardTriggered) {
        return true;
      }
      if (shouldShow) {
        this.nextEpisodeCardTriggered = true;
      }
      return shouldShow;
    },
    hasFatalPlaybackError() {
      const controllerErrorCode =
        typeof PlayerController.getLastPlaybackErrorCode === "function" ? Number(PlayerController.getLastPlaybackErrorCode() || 0) : 0;
      const nativeErrorCode = Number(PlayerController.video?.error?.code || 0);
      return (
        this.isStartupErrorVisible() || Boolean(String(this.sourcesError || "").trim()) || controllerErrorCode > 0 || nativeErrorCode > 0
      );
    },
    isNaturalPlaybackCompletionEligible(durationSeconds = this.getPlaybackDurationSeconds()) {
      const duration = Number(durationSeconds);
      if (!Number.isFinite(duration) || duration <= 0) {
        return false;
      }
      return shouldTreatAsNaturalPlaybackCompletion({
        hasRenderedFirstFrame: Boolean(this.hasPresentedPlaybackFrame),
        hasFatalError: this.hasFatalPlaybackError(),
        durationMs: duration * 1000
      });
    },
    getNextEpisodeCardThresholdReached(
      positionSeconds = this.getPlaybackCurrentSeconds(),
      durationSeconds = this.getPlaybackDurationSeconds()
    ) {
      const duration = Number(durationSeconds || 0);
      const position = Number(positionSeconds || 0);
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(position) ||
        position < 0 ||
        !this.isNaturalPlaybackCompletionEligible(duration)
      ) {
        return false;
      }
      const settings = PlayerSettingsStore.get();
      return shouldShowNextEpisodeCardRule({
        positionSeconds: position,
        durationSeconds: duration,
        skipIntervals: settings.skipIntroEnabled ? this.skipIntervals : [],
        thresholdMode: settings.nextEpisodeThresholdMode,
        thresholdPercent: settings.nextEpisodeThresholdPercent,
        thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
      });
    },
    hasPlaybackReachedNaturalEnd() {
      const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
      const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
        return false;
      }
      const remainingSeconds = durationSeconds - currentSeconds;
      const progress = currentSeconds / durationSeconds;
      const reachedEnd = remainingSeconds <= 1 || progress >= 0.999;
      return reachedEnd && this.isNaturalPlaybackCompletionEligible(durationSeconds);
    },
    shouldPrefetchNextEpisodeStreams() {
      const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
      const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
        return false;
      }
      if (!this.isNaturalPlaybackCompletionEligible(durationSeconds)) {
        return false;
      }
      const settings = PlayerSettingsStore.get();
      const leadSeconds = Math.min(30, Math.max(10, Number(settings.streamAutoPlayTimeoutSeconds) || 0));
      return (
        this.getNextEpisodeCardThresholdReached(currentSeconds + leadSeconds, durationSeconds) ||
        durationSeconds - currentSeconds <= leadSeconds
      );
    },
    getStreamCacheKey(videoId, itemType, season = null, episode = null) {
      const normalizedVideoId = String(videoId || "").trim();
      if (!normalizedVideoId) {
        return "";
      }
      return JSON.stringify([
        normalizeItemType(itemType || this.params?.itemType || "movie"),
        normalizedVideoId,
        season == null ? null : Number(season),
        episode == null ? null : Number(episode)
      ]);
    },
    getCachedPlayableStreamsForVideo(videoId, itemType, season = null, episode = null) {
      const cacheKey = this.getStreamCacheKey(videoId, itemType, season, episode);
      const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
      if (!cacheKey || !cache.has(cacheKey)) {
        return null;
      }
      const cached = cache.get(cacheKey);
      return Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [];
    },
    hasCachedPlayableStreamsForNextEpisode(nextEpisode = this.resolveNextEpisodeInfo()) {
      if (!nextEpisode?.videoId || nextEpisode.hasAired === false) {
        return false;
      }
      const cached = this.getCachedPlayableStreamsForVideo(
        nextEpisode.videoId,
        this.params?.itemType || "series",
        nextEpisode.season,
        nextEpisode.episode
      );
      return Array.isArray(cached) && cached.length > 0;
    },
    ensureNextEpisodeStreamsPrefetch({ force = false } = {}) {
      const nextEpisode = this.resolveNextEpisodeInfo();
      const itemType = normalizeItemType(this.params?.itemType || "movie");
      if (!nextEpisode?.videoId || !isSeriesItemType(itemType) || nextEpisode.hasAired === false) {
        return;
      }
      if (!force && !this.shouldPrefetchNextEpisodeStreams()) {
        return;
      }
      const cacheKey = this.getStreamCacheKey(nextEpisode.videoId, itemType, nextEpisode.season, nextEpisode.episode);
      const loadPromises = this.streamCandidatesLoadPromises || (this.streamCandidatesLoadPromises = new Map());
      if (
        this.getCachedPlayableStreamsForVideo(nextEpisode.videoId, itemType, nextEpisode.season, nextEpisode.episode) ||
        loadPromises.has(cacheKey)
      ) {
        return;
      }
      void this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType, {
        season: nextEpisode.season,
        episode: nextEpisode.episode,
        // Match the search the player will run when the episode actually starts.
        priorityBingeGroup: this.getCurrentStreamBingeGroup(),
        preferredPluginOnly: Boolean(scraperIdFromPluginBingeGroup(this.getCurrentStreamBingeGroup()))
      })
        .then(() => this.renderNextEpisodeCard())
        .catch((error) => console.warn("Next episode stream prefetch failed", error));
    },
    dismissNextEpisodeCard({ revealControls = false, armExitOnNextBack = false } = {}) {
      if (this.nextEpisodeLaunching) {
        this.cancelNextEpisodeLaunch();
      }
      this.nextEpisodeCardDismissed = true;
      this.nextEpisodeBackExitArmed = Boolean(armExitOnNextBack);
      if (revealControls) {
        this.setControlsVisible(true, { focus: true });
        return;
      }
      this.renderNextEpisodeCard();
    },
    resetNextEpisodeCardCycle({ render = true } = {}) {
      const hadState =
        this.nextEpisodeCardTriggered ||
        this.nextEpisodeCardDismissed ||
        this.nextEpisodeBackExitArmed ||
        this.controlFocusZone === "nextEpisode";
      if (!hadState) {
        return false;
      }
      this.nextEpisodeCardTriggered = false;
      this.nextEpisodeCardDismissed = false;
      this.nextEpisodeBackExitArmed = false;
      if (this.controlFocusZone === "nextEpisode") {
        this.controlFocusZone = this.controlsVisible && this.isSeekBarAvailable() ? "progress" : "buttons";
      }
      if (render) {
        if (this.nextEpisodeLaunching) {
          this.cancelNextEpisodeLaunch();
        } else {
          this.renderNextEpisodeCard();
        }
      }
      return true;
    },
    resetNextEpisodeCardAfterBackwardSeek(targetSeconds) {
      if (!this.nextEpisodeCardTriggered) {
        return false;
      }
      const currentSeconds = Number(this.getPlaybackCurrentSeconds());
      const target = Number(targetSeconds);
      if (
        !Number.isFinite(currentSeconds) ||
        !Number.isFinite(target) ||
        target >= currentSeconds - 0.5 ||
        this.getNextEpisodeCardThresholdReached(target)
      ) {
        return false;
      }
      return this.resetNextEpisodeCardCycle();
    },
    resetNextEpisodeCardDismissal() {
      if (!this.nextEpisodeCardDismissed && !this.nextEpisodeBackExitArmed) {
        return;
      }
      this.nextEpisodeCardDismissed = false;
      this.nextEpisodeBackExitArmed = false;
      this.renderNextEpisodeCard();
    },
    isNextEpisodeCardVisible() {
      const nextEpisode = this.resolveNextEpisodeInfo();
      return Boolean(
        nextEpisode &&
        this.shouldShowNextEpisodeCard() &&
        !this.nextEpisodeCardDismissed &&
        !this.stillWatchingPromptVisible &&
        !this.loadingVisible &&
        !this.pauseOverlayVisible &&
        !this.subtitleDialogVisible &&
        !this.audioDialogVisible &&
        !this.speedDialogVisible &&
        !this.sourcesPanelVisible &&
        !this.episodePanelVisible &&
        !this.moreActionsVisible &&
        !this.isStartupErrorVisible()
      );
    },
    resetNextEpisodeLaunchPresentation() {
      this.nextEpisodeCardSearching = false;
      this.nextEpisodeCardSourceName = "";
      this.nextEpisodeCardCountdownSec = null;
    },
    cancelNextEpisodeLaunch() {
      this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
      this.nextEpisodeLaunching = false;
      this.nextEpisodeTransitionMeta = null;
      this.resetNextEpisodeLaunchPresentation();
      this.renderNextEpisodeCard();
    },
    isNextEpisodeLaunchActive(token) {
      return this.nextEpisodeLaunching && Number(token) === Number(this.nextEpisodeLaunchToken) && Router.getCurrent() === "player";
    },
    async runNextEpisodeCountdown(token, selectedStream) {
      const sourceName = String(selectedStream?.name || selectedStream?.addonName || "").trim();
      this.nextEpisodeCardSearching = false;
      this.nextEpisodeCardSourceName = sourceName;
      for (let remaining = 3; remaining >= 1; remaining -= 1) {
        if (!this.isNextEpisodeLaunchActive(token)) {
          return false;
        }
        this.nextEpisodeCardCountdownSec = remaining;
        this.renderNextEpisodeCard();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return this.isNextEpisodeLaunchActive(token);
    }
  };
}
