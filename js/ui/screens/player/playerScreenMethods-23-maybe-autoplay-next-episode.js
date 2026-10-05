/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods23() {
  const {
    PlayerController,
    streamRepository,
    addonRepository,
    PlayerSettingsStore,
    selectAutoPlayStream,
    orderStreamsByAddonOrder,
    DebridStreamPresentation,
    shouldEnterStillWatchingPrompt,
    shouldShowNextEpisodeCardRule,
    NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS,
    normalizeItemType,
    isSeriesItemType,
    flattenStreamGroups,
    mergeStreamItems
  } = internals;

  return {
    maybeAutoplayNextEpisode() {
      const isAvPlayPlayback = typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay();
      const isVideoPaused = !isAvPlayPlayback && Boolean(PlayerController.video?.paused);
      if (this.nextEpisodeLaunching || this.paused || isVideoPaused || !this.hasPresentedPlaybackFrame) {
        return false;
      }

      const nextEpisode = this.resolveNextEpisodeInfo();
      if (!nextEpisode || !isSeriesItemType(this.params?.itemType || "movie")) {
        this.nextEpisodeAutoplayAttemptedKey = "";
        return false;
      }

      const settings = PlayerSettingsStore.get();
      if (!settings.autoplayNextEpisode || !nextEpisode.hasAired) {
        this.nextEpisodeAutoplayAttemptedKey = "";
        return false;
      }
      const effectiveSkipIntervals = settings.skipIntroEnabled ? this.skipIntervals : [];

      const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
      const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
        return false;
      }
      if (!this.isNaturalPlaybackCompletionEligible(durationSeconds)) {
        this.nextEpisodeAutoplayAttemptedKey = "";
        return false;
      }

      if (
        !shouldShowNextEpisodeCardRule({
          positionSeconds: currentSeconds,
          durationSeconds,
          skipIntervals: effectiveSkipIntervals,
          thresholdMode: settings.nextEpisodeThresholdMode,
          thresholdPercent: settings.nextEpisodeThresholdPercent,
          thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
        })
      ) {
        this.nextEpisodeAutoplayAttemptedKey = "";
        return false;
      }

      const attemptKey = [String(nextEpisode.videoId || ""), String(nextEpisode.season ?? ""), String(nextEpisode.episode ?? "")].join(":");
      if (this.nextEpisodeAutoplayAttemptedKey === attemptKey) {
        return false;
      }

      if (
        shouldEnterStillWatchingPrompt({
          stillWatchingEnabled: settings.stillWatchingEnabled,
          autoPlayNextEpisodeEnabled: settings.autoplayNextEpisode,
          nextEpisodeHasAired: nextEpisode.hasAired,
          consecutiveAutoPlayCount: this.consecutiveAutoPlayCount,
          threshold: settings.stillWatchingEpisodeThreshold
        })
      ) {
        this.nextEpisodeAutoplayAttemptedKey = "";
        this.enterStillWatchingPromptMode();
        return true;
      }

      this.nextEpisodeAutoplayAttemptedKey = attemptKey;
      void this.playNextEpisode({ userInitiated: false });
      return true;
    },
    async getPlayableStreamsForVideo(videoId, itemType, options = {}) {
      const normalizedVideoId = String(videoId || "").trim();
      const normalizedType = normalizeItemType(itemType || this.params?.itemType || "movie");
      if (!normalizedVideoId) {
        return [];
      }
      const forceRefresh = options.forceRefresh === true;
      const cacheKey = this.getStreamCacheKey(normalizedVideoId, normalizedType, options.season, options.episode);
      const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
      if (!forceRefresh && cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        const cachedStreams = orderStreamsByAddonOrder(Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [], [], {
          isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
        });
        options.onChunk?.(cachedStreams);
        return cachedStreams;
      }
      const loadPromises = this.streamCandidatesLoadPromises || (this.streamCandidatesLoadPromises = new Map());
      if (forceRefresh) {
        loadPromises.delete(cacheKey);
      }
      // Progressive callers must subscribe to the repository session, including
      // an already running next-episode prefetch, rather than await its final result.
      if (!forceRefresh && !options.onChunk && loadPromises.has(cacheKey)) {
        const loaded = await loadPromises.get(cacheKey);
        const loadedStreams = orderStreamsByAddonOrder(Array.isArray(loaded) ? loaded.map((stream) => ({ ...stream })) : [], [], {
          isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
        });
        options.onChunk?.(loadedStreams);
        return loadedStreams;
      }

      let partialItems = [];
      const loadPromise = streamRepository
        .getStreamsFromAllAddons(normalizedType, normalizedVideoId, {
          itemId: String(this.params?.itemId || ""),
          season: options.season ?? null,
          episode: options.episode ?? null,
          forceRefresh,
          onChunk: (chunkResult) => {
            const chunkItems = flattenStreamGroups(chunkResult);
            if (!chunkItems.length) {
              return;
            }
            partialItems = mergeStreamItems(partialItems, chunkItems);
            options.onChunk?.(
              orderStreamsByAddonOrder(partialItems, [], {
                isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
              }).map((stream) => ({ ...stream }))
            );
          }
        })
        .then((streamResult) => {
          const streamItems = orderStreamsByAddonOrder(
            mergeStreamItems(partialItems, streamResult?.status === "success" ? flattenStreamGroups(streamResult) : []),
            [],
            { isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream) }
          );
          if (streamItems.length) {
            cache.set(
              cacheKey,
              streamItems.map((stream) => ({ ...stream }))
            );
          } else {
            // Android's repository cache does not retain failed/empty-only
            // sessions. Do not let an empty UI snapshot suppress the next
            // provider search or make the source panel look permanently empty.
            cache.delete(cacheKey);
          }
          return streamItems;
        })
        .finally(() => {
          if (loadPromises.get(cacheKey) === loadPromise) {
            loadPromises.delete(cacheKey);
          }
        });
      loadPromises.set(cacheKey, loadPromise);

      const streamItems = await loadPromise;
      return streamItems;
    },
    getCurrentStreamBingeGroup() {
      const currentStream = this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
      return String(currentStream?.behaviorHints?.bingeGroup || currentStream?.raw?.behaviorHints?.bingeGroup || "").trim();
    },
    async selectNextEpisodeStreamByAutoPlayPolicy(streamItems = [], settings = PlayerSettingsStore.get(), options = {}) {
      if (!Array.isArray(streamItems) || !streamItems.length) {
        return null;
      }

      const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
      const preferBingeGroup = Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode);
      const shouldAutoSelectInManualMode = mode === "MANUAL" && (Boolean(settings.autoplayNextEpisode) || preferBingeGroup);
      const preferredBingeGroup = preferBingeGroup ? this.getCurrentStreamBingeGroup() : "";
      const bingeGroupOnlyManualMode = shouldAutoSelectInManualMode && preferBingeGroup;
      if (bingeGroupOnlyManualMode && !preferredBingeGroup) {
        return null;
      }
      const installedAddonNames =
        options.installedAddonNames instanceof Set
          ? options.installedAddonNames
          : new Set(
              ((await addonRepository.getInstalledAddons().catch(() => [])) || [])
                .map((addon) => String(addon?.displayName || addon?.name || "").trim())
                .filter(Boolean)
            );
      return selectAutoPlayStream(streamItems, {
        mode: shouldAutoSelectInManualMode ? "FIRST_STREAM" : mode,
        source: shouldAutoSelectInManualMode ? "ALL_SOURCES" : String(settings.streamAutoPlaySource || "ALL_SOURCES"),
        regexPattern: shouldAutoSelectInManualMode ? "" : String(settings.streamAutoPlayRegex || ""),
        installedAddonNames,
        selectedAddons: shouldAutoSelectInManualMode ? [] : settings.streamAutoPlaySelectedAddons,
        selectedPlugins: shouldAutoSelectInManualMode ? [] : settings.streamAutoPlaySelectedPlugins,
        preferredBingeGroup,
        preferBingeGroupInSelection: preferBingeGroup,
        bingeGroupOnly: Boolean(options.bingeGroupOnly || bingeGroupOnlyManualMode)
      });
    },
    async resolveNextEpisodeStreamByAutoPlayPolicy(nextEpisode, itemType, settings) {
      streamRepository.setLocalPluginSearchPaused(false);
      const installedAddonNames = new Set(
        ((await addonRepository.getInstalledAddons().catch(() => [])) || [])
          .map((addon) => String(addon?.displayName || addon?.name || "").trim())
          .filter(Boolean)
      );
      let latestStreams = [];
      let timeoutElapsed = Number(settings.streamAutoPlayTimeoutSeconds || 0) === 0;
      const hasPreferredBingeGroup = Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode && this.getCurrentStreamBingeGroup());
      let settled = false;
      let resolveSelection;
      let selectionTimer = null;
      let hardTimeout = null;

      const selection = new Promise((resolve) => {
        resolveSelection = resolve;
      });
      const finish = (selectedStream, error = null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(selectionTimer);
        clearTimeout(hardTimeout);
        resolveSelection({
          selectedStream: selectedStream || null,
          streamItems: latestStreams,
          error
        });
      };
      const trySelect = async (bingeGroupOnly) => {
        const selected = await this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, {
          bingeGroupOnly,
          installedAddonNames
        });
        if (selected) {
          finish(selected);
        }
        return selected;
      };
      const onChunk = (streams) => {
        latestStreams = Array.isArray(streams) ? streams : latestStreams;
        void (async () => {
          if (hasPreferredBingeGroup && (await trySelect(true))) {
            return;
          }
          if (timeoutElapsed) {
            finish(
              await this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, {
                installedAddonNames
              })
            );
          }
        })();
      };

      const timeoutSeconds = Math.max(0, Math.trunc(Number(settings.streamAutoPlayTimeoutSeconds || 0)));
      if (timeoutSeconds > 0 && timeoutSeconds !== 2147483647) {
        selectionTimer = setTimeout(() => {
          timeoutElapsed = true;
          if (latestStreams.length) {
            void this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, {
              installedAddonNames
            }).then((selected) => finish(selected));
          }
        }, timeoutSeconds * 1000);
      }
      hardTimeout = setTimeout(
        () => finish(null, new Error("Next episode stream selection timed out")),
        NEXT_EPISODE_SOURCE_RESOLVE_TIMEOUT_MS
      );

      void this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType, {
        season: nextEpisode.season,
        episode: nextEpisode.episode,
        onChunk
      })
        .then(async (streams) => {
          latestStreams = Array.isArray(streams) ? streams : latestStreams;
          finish(
            await this.selectNextEpisodeStreamByAutoPlayPolicy(latestStreams, settings, {
              installedAddonNames
            })
          );
        })
        .catch((error) => finish(null, error));

      return selection;
    }
  };
}
