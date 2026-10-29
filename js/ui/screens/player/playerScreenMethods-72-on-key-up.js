/* eslint-disable no-unused-vars */
import { canResolveMediaServerStream } from "../../../data/mediaserver/mediaServerRepository.js";
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods72() {
  const {
    PlayerController,
    PlayerSettingsStore,
    hasReleaseToken,
    Environment,
    Router,
    DirectDebridResolver,
    TrackingScrobbleService,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    shouldEnterStillWatchingPrompt,
    isSelectKeyCode,
    POST_PLAY_LONG_PRESS_DELAY_MS,
    streamDirectPlaybackUrl
  } = internals;

  return {
    onKeyUp(event) {
      const keyCode = Number(event?.keyCode || 0);
      if (keyCode === 37 || keyCode === 39) {
        // Match Android TV: preview while holding a direction, seek on release.
        if (
          this.seekPreviewSeconds != null &&
          (!this.controlsVisible || this.controlFocusZone === "progress") &&
          !this.isExternalFrameMode() &&
          !this.isStartupErrorVisible() &&
          !this.isPostPlayVisible() &&
          !this.isDialogOpen() &&
          !this.pauseOverlayVisible
        ) {
          event?.preventDefault?.();
          this.commitSeekPreview();
        }
        return;
      }
      if (!isSelectKeyCode(keyCode) || !this.isPostPlayVisible()) {
        return;
      }
      const pendingAction = this.postPlayPendingSelectAction || this.postPlayFocusedAction || "primary";
      const wasLongPress = this.postPlayLongPressTriggered || Number(event?.keyDownDurationMs || 0) >= POST_PLAY_LONG_PRESS_DELAY_MS;
      this.clearPostPlayLongPressTimer();
      this.postPlayPendingSelect = false;
      this.postPlayPendingSelectAction = "";
      event?.preventDefault?.();
      if (
        wasLongPress &&
        this.getPostPlayState().recommendation?.contentType === "movie" &&
        pendingAction === "primary" &&
        this.isPostPlayManualPlayOptionEnabled()
      ) {
        if (!this.postPlayLongPressTriggered) {
          this.openPostPlayManualDialog();
        }
        this.postPlayLongPressTriggered = false;
        return;
      }
      if (!wasLongPress) {
        this.invokePostPlayAction(pendingAction);
      }
      this.postPlayLongPressTriggered = false;
    },
    selectBestStreamCandidate(streams = []) {
      if (!Array.isArray(streams) || !streams.length) {
        return null;
      }

      const hasCapabilityProbe = Boolean(PlayerController?.video);
      const isWebOsRuntime = Environment.isWebOS();
      const capabilities =
        hasCapabilityProbe && typeof PlayerController.getPlaybackCapabilities === "function"
          ? PlayerController.getPlaybackCapabilities()
          : null;
      const supports = (key, fallback = true) => {
        if (!capabilities) {
          return fallback;
        }
        return Boolean(capabilities[key]);
      };

      const resolveContext = {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      };

      const scored = streams
        .filter((stream) =>
          Boolean(
            stream?.url ||
            stream?.externalUrl ||
            canResolveMediaServerStream(stream) ||
            DirectDebridResolver.canResolveStream(stream, resolveContext) ||
            WebOsEngineFsResolver.canResolveStream(stream) ||
            TizenStreamingServerResolver.canResolveStream(stream)
          )
        )
        .map((stream) => {
          const presentation = stream.streamPresentation || stream.raw?.streamPresentation || {};
          const text = [
            stream.title,
            stream.label,
            stream.name,
            stream.description,
            stream.behaviorHints?.filename,
            stream.raw?.behaviorHints?.filename,
            stream.raw?.filename,
            presentation.resolution,
            presentation.quality,
            presentation.encode,
            ...(Array.isArray(presentation.visualTags) ? presentation.visualTags : []),
            ...(Array.isArray(presentation.audioTags) ? presentation.audioTags : []),
            ...(Array.isArray(presentation.audioChannels) ? presentation.audioChannels : []),
            stream.url,
            stream.externalUrl,
            stream.infoHash
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          let score = 0;

          if (text.includes("2160") || text.includes("4k")) score += 60;
          else if (text.includes("1080")) score += 40;
          else if (text.includes("720")) score += 20;
          else if (text.includes("480")) score += 10;

          if (text.includes("web")) score += 8;
          if (text.includes("bluray")) score += 8;
          if (hasReleaseToken(text, "cam")) score -= 70;
          if (hasReleaseToken(text, "ts")) score -= 40;

          if (text.includes("hevc") || text.includes("h265") || text.includes("x265")) {
            score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 12 : -90;
          }
          if (text.includes("av1")) {
            score += supports("mp4Av1", true) ? 10 : -80;
          }
          if (text.includes("vp9")) {
            score += supports("webmVp9", true) ? 8 : -50;
          }
          if (text.includes(".mkv") || text.includes("matroska")) {
            score += supports("mkvH264", true) ? 8 : -120;
            if (isWebOsRuntime && !supports("mkvH264", false)) score -= 220;
          }
          if (text.includes(".webm")) {
            score += supports("webmVp9", true) ? 6 : -45;
          }

          if (hasReleaseToken(text, "hdr") || hasReleaseToken(text, "hdr10") || hasReleaseToken(text, "hlg")) {
            score += supports("hdrLikely", true) ? 16 : -35;
          }
          if (text.includes("dolby vision") || hasReleaseToken(text, "dv") || hasReleaseToken(text, "dovi")) {
            score += supports("dolbyVision", true) ? 18 : -45;
          }
          if (text.includes("atmos") || text.includes("eac3") || text.includes("ec-3")) {
            score += supports("atmosLikely", true) || supports("audioEac3", true) ? 14 : -30;
          }
          if (/\b(aac|mp4a)\b/.test(text)) {
            score += 16;
          }
          if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
            score += 10;
          }
          if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
            score += isWebOsRuntime ? -70 : -18;
          }
          if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
            score += isWebOsRuntime ? -85 : -40;
          }
          if (/\b(stereo|2\.0|2ch)\b/.test(text)) {
            score += isWebOsRuntime ? 10 : 4;
          }

          if (
            !stream.url &&
            !stream.externalUrl &&
            (WebOsEngineFsResolver.canResolveStream(stream) || TizenStreamingServerResolver.canResolveStream(stream))
          ) {
            score += 4;
          }
          if (!stream.url && !stream.externalUrl && DirectDebridResolver.canResolveStream(stream, resolveContext)) {
            score += 2;
          }

          return { stream, score };
        })
        .sort((left, right) => right.score - left.score);

      return scored[0]?.stream || null;
    },
    selectBestStreamUrl(streams = []) {
      const candidate = this.selectBestStreamCandidate(streams);
      return streamDirectPlaybackUrl(candidate) || null;
    },
    selectBestStreamCandidateForAddon(streams = [], addonName = "") {
      const normalizedAddonName = String(addonName || "").trim();
      if (!normalizedAddonName || !Array.isArray(streams) || !streams.length) {
        return null;
      }

      const addonStreams = streams.filter((stream) => String(stream?.addonName || "").trim() === normalizedAddonName);
      if (!addonStreams.length) {
        return null;
      }

      return this.selectBestStreamCandidate(addonStreams);
    },
    selectBestStreamUrlForAddon(streams = [], addonName = "") {
      const candidate = this.selectBestStreamCandidateForAddon(streams, addonName);
      return streamDirectPlaybackUrl(candidate) || null;
    },
    async handlePlaybackEnded() {
      const naturalCompletion = this.isNaturalPlaybackCompletionEligible();
      if (!naturalCompletion) {
        this.postPlayPlaybackEnded = false;
        return this.finishNaturalPlaybackEnded();
      }

      // The Android player commits the watched state at the real media end, then
      // lets the post-play controller decide whether navigation/autoplay must be
      // held while recommendations are resolved.
      if (!this.postPlayNaturalCompletionPrepared) {
        if (TrackingScrobbleService.isEnabled()) {
          TrackingScrobbleService.stop(this.buildScrobbleContext());
        }
        this.clearPlaybackStallGuard();
        this.releaseStartupAudioGate({ resume: false });
        this.postPlayNaturalCompletionPrepared = true;
      }
      this.postPlayPlaybackEnded = true;
      const postPlayState = this.evaluatePostPlayRecommendation({ playbackEnded: true });
      if (postPlayState.blocksNaturalCompletion) {
        this.postPlayNaturalEndPending = true;
        this.loadingVisible = false;
        this.bufferingActive = false;
        this.paused = true;
        this.dismissPauseOverlay();
        this.updateLoadingVisibility();
        this.updateMediaSessionPlaybackState();
        this.setControlsVisible(false, { focus: false });
        this.renderControlButtons();
        this.renderNextEpisodeCard();
        return;
      }
      return this.finishNaturalPlaybackEnded();
    },
    async finishNaturalPlaybackEnded() {
      const naturalCompletion = this.isNaturalPlaybackCompletionEligible();
      if (!naturalCompletion) {
        // Match Android: an error/placeholder end is not a completion, so it
        // must not stop scrobbling, mark watched, navigate away, or auto-play.
        TrackingScrobbleService.cancel();
        this.nextEpisodeAutoplayAttemptedKey = "";
        this.nextEpisodeCardTriggered = false;
        this.resetStillWatchingPromptState({ render: false });
        if (this.nextEpisodeLaunching) {
          this.cancelNextEpisodeLaunch();
        }
        this.clearPlaybackStallGuard();
        this.releaseStartupAudioGate({ resume: false });
        this.loadingVisible = false;
        this.paused = true;
        this.dismissPauseOverlay();
        this.updateLoadingVisibility();
        this.updateMediaSessionPlaybackState();
        this.setControlsVisible(true, { focus: false });
        this.renderControlButtons();
        this.renderNextEpisodeCard();
        this.updateUiTick();
        return;
      }

      if (!this.postPlayNaturalCompletionPrepared) {
        // Direct callers and environments without the native ended event still
        // get the same one-time completion commit.
        if (TrackingScrobbleService.isEnabled()) {
          TrackingScrobbleService.stop(this.buildScrobbleContext());
        }
        this.postPlayNaturalCompletionPrepared = true;
      }
      this.clearPlaybackStallGuard();
      this.releaseStartupAudioGate({ resume: false });
      const settings = PlayerSettingsStore.get();
      const autoplayEnabled = Boolean(settings.autoplayNextEpisode);
      const canAutoplayNext = autoplayEnabled && this.hasPlaybackReachedNaturalEnd();
      if (canAutoplayNext) {
        const nextEpisode = this.resolveNextEpisodeInfo();
        if (
          shouldEnterStillWatchingPrompt({
            stillWatchingEnabled: settings.stillWatchingEnabled,
            autoPlayNextEpisodeEnabled: settings.autoplayNextEpisode,
            nextEpisodeHasAired: nextEpisode?.hasAired,
            consecutiveAutoPlayCount: this.consecutiveAutoPlayCount,
            threshold: settings.stillWatchingEpisodeThreshold
          })
        ) {
          this.enterStillWatchingPromptMode();
          return;
        }
        const nextEpisodeHandled = await this.playNextEpisode({ userInitiated: false });
        if (nextEpisodeHandled || this.nextEpisodeLaunching || Router.getCurrent() !== "player") {
          return;
        }
      }

      const detailParams = this.buildDetailRouteParamsFromPlayer();
      if (
        this.params?.itemId &&
        Router.popToExistingRoute?.("detail", detailParams, {
          allowSingleIntermediateRoute: true
        })
      ) {
        this.releaseCurrentEngineFsStreamBestEffort("playback-ended", { removeTorrent: true });
        return;
      }

      if (this.params?.itemId) {
        // Android navigates to the matching Detail destination for movies too
        // when the existing history entry cannot be restored. Keep the
        // history pop above as the preferred path, then use the same direct
        // Detail fallback for any content with a stable item id.
        this.releaseCurrentEngineFsStreamBestEffort("playback-ended", { removeTorrent: true });
        void Router.navigate("detail", detailParams, {
          skipStackPush: true,
          replaceHistory: true
        });
        return;
      }

      this.loadingVisible = false;
      this.bufferingActive = false;
      this.paused = true;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.renderControlButtons();
      this.renderNextEpisodeCard();
      this.updateUiTick();
    }
  };
}
