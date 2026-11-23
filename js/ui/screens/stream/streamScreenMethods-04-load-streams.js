/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods04() {
  const {
    streamRepository,
    PluginManager,
    PLUGIN_REPOSITORY_TYPES,
    isExecutableScraper,
    pluginSupportsType,
    StreamBadgeSettingsStore,
    normalizeAddonLogoUrl,
    preloadAddonLogoImages,
    rememberAddonLogoLookup,
    resolveAddonLogo,
    clamp,
    normalizeType,
    streamMergeKey,
    flattenStreams,
    mergeStreamItems,
    ensureAddonLogoImageProxyReady,
    preloadMatchedStreamBadgeImages,
    sortStreamsByAddonOrder,
    TizenStreamingServerResolver,
    DirectDebridResolver
  } = internals;

  return {
    async loadStreams({ preserveResults = false, forceRefresh = false } = {}) {
      this.streamLoadAbortController?.abort?.();
      const loadAbortController = typeof AbortController === "function" ? new AbortController() : null;
      this.streamLoadAbortController = loadAbortController;
      // Every load supersedes the previous collector, including runtimes without AbortController.
      this.loadToken = (this.loadToken || 0) + 1;
      const token = this.loadToken;
      const itemType = normalizeType(this.params?.itemType);
      const videoId = String(this.params?.videoId || this.params?.itemId || "");
      const preserveExistingResults = Boolean(preserveResults && this.streams.length);

      this.loading = preserveExistingResults ? false : true;
      this.streamSearchCompleted = false;
      this.error = "";
      if (this.errorChipTimer) {
        clearTimeout(this.errorChipTimer);
        this.errorChipTimer = null;
      }
      if (!preserveExistingResults) {
        this.streams = [];
        this.addonFilter = "all";
        this.focusState = { zone: "filter", index: 1 };
        this.streamUserMovedFocus = false;
        this.streamInitialResultFocusAssigned = false;
        this.listScrollTop = 0;
        this.addonLogoLookup = {};
      }

      if (!preserveExistingResults) {
        this.sourceChips = [];
      }
      if (!this.hasRenderedStreamRouteShell) {
        this.requestRender();
      }
      const pendingChunkTasks = new Set();
      const badgeSettings = StreamBadgeSettingsStore.snapshot();
      const showAddonLogo = badgeSettings.showAddonLogo === true;
      if (showAddonLogo) {
        await ensureAddonLogoImageProxyReady();
        if (token !== this.loadToken) {
          return;
        }
      }

      const upsertSourceChip = (addon, status = "loading") => {
        const name = String(addon?.displayName || addon?.name || "").trim();
        if (!name) {
          return;
        }
        const orderIndex = Number(addon?.orderIndex);
        const nextChip = {
          name,
          logo: normalizeAddonLogoUrl(addon.logo),
          status,
          orderIndex: Number.isFinite(orderIndex) ? orderIndex : Number.MAX_SAFE_INTEGER
        };
        const existingIndex = this.sourceChips.findIndex((chip) => chip.name === name);
        if (existingIndex >= 0) {
          this.sourceChips[existingIndex] = { ...this.sourceChips[existingIndex], ...nextChip };
        } else {
          this.sourceChips.push(nextChip);
        }
        rememberAddonLogoLookup(this.addonLogoLookup, name, addon.logo || nextChip.logo);
        this.sourceChips = this.sourceChips.slice().sort((left, right) => Number(left.orderIndex || 0) - Number(right.orderIndex || 0));
      };

      if (PluginManager.pluginsEnabled) {
        const repositoriesById = new Map(PluginManager.listRepositories().map((repository) => [repository.id, repository]));
        const pluginNames = PluginManager.listScrapers()
          .filter((scraper) => {
            const repository = repositoriesById.get(scraper?.repositoryId);
            return (
              scraper?.type === PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
              isExecutableScraper(scraper, repository) &&
              pluginSupportsType(scraper.supportedTypes, itemType)
            );
          })
          .map((scraper) => {
            const repository = repositoriesById.get(scraper.repositoryId);
            return PluginManager.groupStreamsByRepository
              ? String(repository?.name || scraper.name || "").trim()
              : String(scraper.name || "").trim();
          })
          .filter(Boolean)
          .filter((name, index, names) => names.indexOf(name) === index);
        pluginNames.forEach((name) => {
          upsertSourceChip({ name, orderIndex: Number.MAX_SAFE_INTEGER }, "loading");
        });
      }

      const markSuccessfulSources = (names = []) => {
        if (!Array.isArray(names) || !names.length) {
          return;
        }
        const entries = names
          .map((entry) => {
            if (entry && typeof entry === "object") {
              return {
                name: String(entry.name || entry.addonName || "").trim(),
                logo: normalizeAddonLogoUrl(entry.logo || entry.addonLogo),
                orderIndex: Number(entry.orderIndex ?? entry.addonOrderIndex)
              };
            }
            const name = String(entry || "").trim();
            const existingStream = this.streams.find((stream) => stream.addonName === name);
            return {
              name,
              logo: resolveAddonLogo(name, this.addonLogoLookup),
              orderIndex: Number(existingStream?.addonOrderIndex)
            };
          })
          .filter((entry) => entry.name);
        const successSet = new Set(entries.map((entry) => entry.name));
        const known = new Set(this.sourceChips.map((chip) => chip.name));
        this.sourceChips = this.sourceChips.map((chip) => (successSet.has(chip.name) ? { ...chip, status: "success" } : chip));
        entries.forEach((entry) => {
          if (!known.has(entry.name)) {
            const orderIndex = Number.isFinite(entry.orderIndex) ? entry.orderIndex : Number.MAX_SAFE_INTEGER;
            this.sourceChips.push({
              name: entry.name,
              logo: entry.logo || resolveAddonLogo(entry.name, this.addonLogoLookup),
              status: "success",
              orderIndex
            });
          }
        });
        this.sourceChips = this.sourceChips
          .slice()
          .sort((left, right) => Number(left.orderIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.orderIndex ?? Number.MAX_SAFE_INTEGER));
      };

      const displayChunkGroups = async (groups = []) => {
        if (token !== this.loadToken) {
          return;
        }
        const chunkStreams = mergeStreamItems([], this.applyAddonLogos(flattenStreams({ status: "success", data: groups })));
        if (!chunkStreams.length) {
          return;
        }
        // Android publishes the completed source group before badge/logo work.
        // Keep those image warmups off the critical path so a slow image or
        // proxy cannot delay the first usable stream card on Tizen.
        void Promise.all([
          preloadMatchedStreamBadgeImages(chunkStreams, badgeSettings),
          ...(showAddonLogo ? [preloadAddonLogoImages(chunkStreams, this.addonLogoLookup)] : [])
        ]).catch((error) => {
          console.warn("Stream badge/logo warmup failed", error);
        });
        this.streams = mergeStreamItems(this.streams, chunkStreams);
        if (this.p2pWarmUpToken !== token) {
          // The player resolves torrents through debrid first; only those debrid
          // cannot resolve use P2P, so only those start the service early.
          const resolveContext = {
            season: this.params?.season == null ? null : Number(this.params.season),
            episode: this.params?.episode == null ? null : Number(this.params.episode)
          };
          const p2pOnlyStreams = chunkStreams.filter((stream) => !DirectDebridResolver.canResolveStream(stream, resolveContext));
          if (TizenStreamingServerResolver.warmUpForStreams(p2pOnlyStreams)) {
            this.p2pWarmUpToken = token;
          }
        }
        markSuccessfulSources(
          groups.map((group) => ({
            name: group?.addonName || "",
            logo: group?.addonLogo || "",
            orderIndex: group?.addonOrderIndex
          }))
        );
        this.streams = sortStreamsByAddonOrder(this.streams, this.sourceChips);
        this.scheduleDebridPreparation();
        if (!preserveExistingResults && this.streams.length && !this.streamUserMovedFocus && !this.streamInitialResultFocusAssigned) {
          this.streamInitialResultFocusAssigned = true;
          this.focusState = { zone: "card", row: 0, action: "play" };
        }
        const firstVisibleChunk = this.loading;
        if (firstVisibleChunk) {
          // Android's stream state leaves the loading phase as soon as the first
          // successful source arrives. The producer continues below in the
          // background for slower addons and local JS scrapers.
          this.loading = false;
        }
        this.requestRender({ delayMs: firstVisibleChunk ? 0 : 120 });
        this.maybeAutoResumeStream();
        // Keep Android's timeout semantics: instant/bounded auto-play may select
        // from the streams available when its wait window expires. The list
        // itself is already source-ordered by sortStreamsByAddonOrder().
        this.maybeAutoPlayStream();
      };

      const queueChunkGroups = (groups = []) => {
        const task = displayChunkGroups(groups)
          .catch((error) => {
            console.warn("Stream chunk prerender failed", error);
          })
          .finally(() => {
            pendingChunkTasks.delete(task);
          });
        pendingChunkTasks.add(task);
        return task;
      };

      const options = {
        itemId: String(this.params?.itemId || ""),
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null,
        forceRefresh: Boolean(forceRefresh),
        signal: loadAbortController?.signal || null,
        onAddon: (addon) => {
          if (token !== this.loadToken) {
            return;
          }
          upsertSourceChip(addon, "loading");
          this.requestRender({ delayMs: 120 });
        },
        onChunk: (chunkResult) => {
          if (token !== this.loadToken || chunkResult?.status !== "success") {
            return;
          }
          const groups = Array.isArray(chunkResult.data) ? chunkResult.data : [];
          queueChunkGroups(groups);
        }
      };

      try {
        const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, videoId, options);
        if (token !== this.loadToken) {
          return;
        }
        const loadedStreams = mergeStreamItems([], this.applyAddonLogos(flattenStreams(streamResult)));
        await Promise.allSettled(Array.from(pendingChunkTasks));
        if (token !== this.loadToken) {
          return;
        }
        const existingKeys = new Set(this.streams.map((stream) => streamMergeKey(stream)).filter(Boolean));
        const missingStreams = loadedStreams.filter((stream) => {
          const key = streamMergeKey(stream);
          return key && !existingKeys.has(key);
        });
        if (missingStreams.length) {
          void Promise.all([
            preloadMatchedStreamBadgeImages(missingStreams, badgeSettings),
            ...(showAddonLogo ? [preloadAddonLogoImages(missingStreams, this.addonLogoLookup)] : [])
          ]).catch((error) => {
            console.warn("Stream badge/logo warmup failed", error);
          });
          this.streams = mergeStreamItems(this.streams, missingStreams);
        }
        markSuccessfulSources(this.streams.map((stream) => stream.addonName));
        this.streams = sortStreamsByAddonOrder(this.streams, this.sourceChips);
        this.scheduleDebridPreparation();
        if (this.streams.length && showAddonLogo) {
          void preloadAddonLogoImages(this.streams, this.addonLogoLookup).catch((error) => {
            console.warn("Stream addon logo warmup failed", error);
          });
        }
        this.streamSearchCompleted = true;
        this.sourceChips = this.sourceChips.map((chip) => (chip.status === "loading" ? { ...chip, status: "error" } : chip));
        this.loading = false;
        if (!preserveExistingResults && this.streams.length && !this.streamUserMovedFocus && !this.streamInitialResultFocusAssigned) {
          this.streamInitialResultFocusAssigned = true;
          this.focusState = { zone: "card", row: 0, action: "play" };
        }
        if (this.streams.length && !preserveExistingResults && this.focusState?.zone === "card") {
          const visibleStreams = this.getFilteredStreams();
          const maxCardIndex = Math.max(0, visibleStreams.length - 1);
          let initialIndex = clamp(Number(this.focusState?.row ?? this.focusState?.index ?? 0), 0, maxCardIndex);
          const preferred = String(this.params?.preferredStreamId || "").trim();
          if (preferred) {
            const prefIdx = visibleStreams.findIndex((s) => String(s?.id || "") === preferred);
            if (prefIdx >= 0) {
              initialIndex = prefIdx;
            }
          }
          const rowIndex = clamp(initialIndex, 0, this.streams.length - 1);
          this.focusState = {
            zone: "card",
            index: clamp(initialIndex, 0, maxCardIndex),
            row: rowIndex,
            action: String(this.focusState?.action || "play")
          };
        } else if (!this.streams.length) {
          this.focusState = { zone: "filter", index: 1 };
        }
        this.requestRender();
        this.scheduleErrorChipCleanup();
        this.maybeAutoResumeStream({ allLoaded: true });
        this.maybeAutoPlayStream({ allLoaded: true });
      } catch (error) {
        if (token !== this.loadToken) {
          return;
        }
        this.streamSearchCompleted = true;
        this.loading = false;
        this.autoResumeUiActive = false;
        this.error = error?.message || "Failed to load streams.";
        this.sourceChips = this.sourceChips.map((chip) => (chip.status === "loading" ? { ...chip, status: "error" } : chip));
        this.requestRender();
        this.scheduleErrorChipCleanup();
      } finally {
        if (this.streamLoadAbortController === loadAbortController) {
          this.streamLoadAbortController = null;
        }
      }
    }
  };
}
