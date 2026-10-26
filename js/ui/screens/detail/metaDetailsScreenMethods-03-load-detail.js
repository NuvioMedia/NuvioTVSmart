/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods03() {
  const {
    metaRepository,
    mdbListRepository,
    metaWithRouteExternalIds,
    watchProgressRepository,
    savedLibraryRepository,
    watchedItemsRepository,
    detailWatchedEnrichmentService,
    TmdbService,
    TmdbMetadataService,
    LayoutPreferences,
    TmdbSettingsStore,
    isWatchProgressInProgress,
    normalizeEpisodes,
    isSimklProgressSourceSelected,
    getDetailAllProgressPromise,
    hasCompletedSimklMovieProgress,
    hasInProgressSimklMovieProgress,
    buildResumeContentIds,
    isSeriesDetailMeta,
    buildDetailContentReference,
    isDetailTitleWatched,
    extractCast,
    withTimeout,
    addonRatingsBySeason,
    mergeSeasonRatings,
    resolveTrailerSource
  } = internals;

  return {
    async loadDetail() {
      const token = this.detailLoadToken;
      this.detailEnrichmentComplete = false;
      let { itemId, itemType = "movie", fallbackTitle = "Untitled" } = this.params || {};
      if (!itemId) {
        this.renderError("Item id mancante.");
        return;
      }

      const sourceItemId = itemId;
      const sourceAddonBaseUrl = String(this.params?.addonBaseUrl || "").trim();
      // Match Android's MetaPreview.apiType semantics: the type declared by the
      // individual meta wins, while the catalog type is only a fallback. An
      // aggregator may expose a `channel` catalog whose entries are `tv`; using
      // the row type here makes the original TV addon miss both meta and streams.
      const sourceItemType = String(itemType || this.params?.catalogType).trim() || "movie";
      const canonicalItemId = await this.resolveCanonicalDetailItemId(itemId, itemType);
      if (token !== this.detailLoadToken) {
        return;
      }
      if (canonicalItemId && canonicalItemId !== itemId) {
        this.params = {
          ...(this.params || {}),
          itemId: canonicalItemId,
          originalItemId: this.params?.originalItemId || itemId
        };
        itemId = canonicalItemId;
      }

      const loadMeta = async () => {
        const globalResultPromise = metaRepository.getMetaFromAllAddons(itemType, itemId);
        if (sourceAddonBaseUrl && LayoutPreferences.get().preferExternalMetaAddonDetail !== false) {
          const sourceResult = await withTimeout(metaRepository.getMeta(sourceAddonBaseUrl, sourceItemType, sourceItemId), 1800, {
            status: "error",
            message: "timeout"
          });
          if (sourceResult.status === "success") {
            const sourceMeta = sourceResult.data || {};
            if (!sourceMeta.background) {
              const ownerResult = await withTimeout(globalResultPromise, 2200, {
                status: "error",
                message: "timeout"
              });
              if (ownerResult.status === "success") {
                const ownerMeta = ownerResult.data || {};
                return {
                  status: "success",
                  data: {
                    ...ownerMeta,
                    ...sourceMeta,
                    id: sourceMeta.id || ownerMeta.id || sourceItemId,
                    type: sourceMeta.type || ownerMeta.type || sourceItemType,
                    poster: sourceMeta.poster || ownerMeta.poster || null,
                    background: sourceMeta.background || ownerMeta.background || null,
                    logo: sourceMeta.logo || ownerMeta.logo || null,
                    description: sourceMeta.description || ownerMeta.description || "",
                    genres: Array.isArray(sourceMeta.genres) && sourceMeta.genres.length ? sourceMeta.genres : ownerMeta.genres || [],
                    videos: Array.isArray(sourceMeta.videos) && sourceMeta.videos.length ? sourceMeta.videos : ownerMeta.videos || []
                  }
                };
              }
            }
            return sourceResult;
          }
        }
        return globalResultPromise;
      };
      const metaPromise = withTimeout(loadMeta(), 4500, {
        status: "error",
        message: "timeout"
      });
      const ratingsPromise = metaPromise
        .then((result) => {
          if (token !== this.detailLoadToken || result.status !== "success") return null;
          return mdbListRepository.getRatingsForMeta(metaWithRouteExternalIds(result.data, this.params), itemId, itemType);
        })
        .catch(() => null);
      const seriesRatingsPromise = metaPromise
        .then((result) => {
          if (token !== this.detailLoadToken || result.status !== "success") return null;
          const episodes = normalizeEpisodes(result.data?.videos || [], result.data?.type || itemType);
          if (!episodes.length || !isSeriesDetailMeta(result.data, episodes)) return null;
          return withTimeout(this.fetchSeriesRatingsBySeason(result.data, episodes), 5000, {});
        })
        .catch(() => null);
      const isSavedPromise = savedLibraryRepository.isSaved(itemId);
      const progressPromise = watchProgressRepository.getResumeByContentId(itemId);
      const watchedItemPromise = watchedItemsRepository.isWatched(itemId);
      const allProgressPromise = getDetailAllProgressPromise();
      const allWatchedPromise = watchedItemsRepository.getAll();

      const [metaResult, isSaved, initialProgress, watchedItem, allProgressItems, allWatchedItems] = await Promise.all([
        metaPromise,
        isSavedPromise,
        progressPromise,
        watchedItemPromise,
        allProgressPromise,
        allWatchedPromise
      ]);
      const meta =
        metaResult.status === "success"
          ? metaResult.data
          : {
              id: itemId,
              type: itemType,
              name: fallbackTitle,
              poster: this.params?.fallbackPoster || null,
              background: this.params?.fallbackBackground || null,
              description: ""
            };
      if (token !== this.detailLoadToken) {
        return;
      }
      const projectedTitleWatched = await isDetailTitleWatched(itemId, itemType, meta, allWatchedItems);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.resumeContentIds = buildResumeContentIds(meta, this.params);
      let progress = initialProgress;
      if (!progress && this.resumeContentIds.length > 1) {
        progress = await watchProgressRepository.getResumeByContentIds(this.resumeContentIds).catch((error) => {
          console.warn("Detail resume lookup failed", error);
          return null;
        });
        if (token !== this.detailLoadToken) {
          return;
        }
      }
      this.resumeProgress = progress && isWatchProgressInProgress(progress) ? progress : null;
      this.isSavedInLibrary = isSaved;
      const detailContentReference = buildDetailContentReference(itemId, meta, this.params);
      this.isMarkedWatched = Boolean(
        projectedTitleWatched ||
        (watchedItem && !hasInProgressSimklMovieProgress(allProgressItems, detailContentReference)) ||
        hasCompletedSimklMovieProgress(allProgressItems, detailContentReference) ||
        (progress && Number(progress.durationMs || 0) > 0 && Number(progress.positionMs || 0) >= Number(progress.durationMs || 0))
      );

      // Fast first paint with base metadata.
      this.meta = meta;
      this.episodes = normalizeEpisodes(meta?.videos || [], meta?.type || itemType);
      this.castItems = extractCast(meta);
      const progressItemsForDetail = this.resumeProgress ? [this.resumeProgress, ...allProgressItems] : allProgressItems;
      this.buildEpisodeState(progressItemsForDetail, allWatchedItems);
      this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(this.resumeProgress || progress);
      this.selectedSeason = this.resolveInitialSelectedSeason(this.resumeProgress || progress, progressItemsForDetail);
      this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
      this.moreLikeThisItems = [];
      this.moreLikeThisSource = null;
      this.collectionItems = [];
      this.collectionName = "";
      this.streamItems = [];
      this.trailerSource = resolveTrailerSource(meta);
      if (isSeriesDetailMeta(meta, this.episodes)) {
        this.seriesRatingsBySeason = {};
      } else {
        this.seriesRatingsBySeason = {};
      }
      this.render(meta);
      this.isLoadingDetail = false;
      void this.refreshLibraryMembership(token);
      this.maybeAutoOpenContinueWatchingStream();
      this.maybePlayOnLoad(token);
      void this.refreshTrailerSource(meta, token);
      void this.loadTraktComments({ force: true });

      this.loadDetailEnrichments(meta, token, ratingsPromise, seriesRatingsPromise);
    },
    loadDetailEnrichments(meta, token, ratingsPromise = null, seriesRatingsPromise = Promise.resolve(null)) {
      if (token !== this.detailLoadToken) return;
      this.detailEnrichmentComplete = false;
      // Match Android TV: recommendations are an independent detail-page job.
      // Starting them from the base meta keeps slower artwork/credits enrichment
      // (and its optional cast fallback) from delaying or starving this section.
      void withTimeout(this.fetchMoreLikeThis(meta), 5000, [])
        .then((items) => {
          if (token !== this.detailLoadToken) {
            return;
          }
          this.moreLikeThisItems = Array.isArray(items) ? items : [];
          this.updateRenderedDetailSections(this.meta || meta);
        })
        .catch((error) => {
          console.warn("More like this background load failed", error);
        });

      // Background enrichments: do not block initial screen rendering.
      (async () => {
        const enrichedMeta = await this.enrichMeta(meta);
        if (token !== this.detailLoadToken) {
          return;
        }

        // Metadata can arrive after a watched-state edit on the visible page.
        const [currentProgressItems, currentWatchedItems] = await Promise.all([
          getDetailAllProgressPromise(),
          watchedItemsRepository.getAll()
        ]);
        if (token !== this.detailLoadToken) {
          return;
        }
        const currentProgressItemsForDetail = this.resumeProgress ? [this.resumeProgress, ...currentProgressItems] : currentProgressItems;
        this.meta = enrichedMeta || meta;
        this.episodes = normalizeEpisodes(this.meta?.videos || [], this.meta?.type || this.params?.itemType);
        this.castItems = extractCast(this.meta);
        this.buildEpisodeState(currentProgressItemsForDetail, currentWatchedItems, this.enrichedWatchedState);
        this.trailerSource = resolveTrailerSource(this.meta);
        if (!this.castItems.length) {
          const fallbackCast = await withTimeout(this.fetchTmdbCastFallback(this.meta), 3200, []);
          if (token !== this.detailLoadToken) {
            return;
          }
          if (Array.isArray(fallbackCast) && fallbackCast.length) {
            this.castItems = fallbackCast;
          }
        }
        if (!this.isBackNavigation)
          this.selectedSeason = this.resolveInitialSelectedSeason(this.resumeProgress, currentProgressItemsForDetail);
        this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
        this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(this.resumeProgress);
        this.updateRenderedDetailSections(this.meta);
        void this.loadMdbListRatings(this.meta, token, ratingsPromise);
        void this.refreshTrailerSource(this.meta, token);
        void this.loadTraktComments({ force: true });

        const tasks = [];
        const simklProgressSourceSelected = isSimklProgressSourceSelected();
        if (isSeriesDetailMeta(this.meta, this.episodes)) {
          tasks.push(seriesRatingsPromise.then((ratings) => ratings || withTimeout(this.fetchSeriesRatingsBySeason(this.meta), 5000, {})));
          const traktId = this.meta?.ids?.trakt;
          if (traktId && !simklProgressSourceSelected) {
            tasks.push(
              withTimeout(
                detailWatchedEnrichmentService.enrichSeriesWatchedState(this.episodes, this.params?.itemId, traktId),
                4500,
                new Map()
              )
            );
          }
        } else {
          tasks.push(withTimeout(this.fetchMovieCollection(this.meta), 5000, { items: [], name: "" }));
          const movieTraktId = this.meta?.ids?.trakt;
          if (movieTraktId && !simklProgressSourceSelected) {
            tasks.push(withTimeout(detailWatchedEnrichmentService.enrichMovieWatchedState(this.params?.itemId, movieTraktId), 4500, null));
          }
        }
        const results = await Promise.all(tasks);
        if (token !== this.detailLoadToken) {
          return;
        }
        if (isSeriesDetailMeta(this.meta, this.episodes)) {
          this.seriesRatingsBySeason = mergeSeasonRatings(addonRatingsBySeason(this.episodes), results[0] || {});
          if (this.meta?.ids?.trakt && results[1] instanceof Map) {
            const [latestProgressItems, latestWatchedItems] = await Promise.all([
              getDetailAllProgressPromise(),
              watchedItemsRepository.getAll()
            ]);
            if (token !== this.detailLoadToken) {
              return;
            }
            this.enrichedWatchedState = results[1];
            this.buildEpisodeState(latestProgressItems, latestWatchedItems, this.enrichedWatchedState);
            this.updateRenderedDetailSections(this.meta);
          }
        } else {
          this.collectionItems = Array.isArray(results[0]?.items) ? results[0].items : [];
          this.collectionName = results[0]?.name || "";
          if (this.meta?.ids?.trakt && results[1]) {
            this.enrichedMovieState = results[1];
            this.isMarkedWatched = Boolean(this.enrichedMovieState?.isWatched);
            this.updateRenderedDetailSections(this.meta);
          }
        }
        this.detailEnrichmentComplete = true;
        this.updateRenderedDetailSections(this.meta);
      })().catch((error) => {
        console.warn("Detail background enrichment failed", error);
      });
    },
    async resolveCanonicalDetailItemId(itemId, itemType = "movie") {
      const rawItemId = String(itemId || "").trim();
      if (!/^tmdb:/i.test(rawItemId)) {
        return rawItemId;
      }
      try {
        const tmdbId = await TmdbService.ensureTmdbId(rawItemId, itemType);
        if (!tmdbId) {
          return rawItemId;
        }
        const enrichment = await TmdbMetadataService.fetchEnrichment({
          tmdbId,
          contentType: itemType,
          language: TmdbSettingsStore.get().language
        });
        const imdbId = String(enrichment?.imdbId || "").trim();
        return imdbId || rawItemId;
      } catch (error) {
        console.warn("Detail TMDB canonical id resolve failed", error);
        return rawItemId;
      }
    }
  };
}
