import * as internals from "./homeScreenContext.js";
import { stabilizeImmediateContinueWatchingItems } from "./continueWatchingStability.js";

export function startHomeContinueWatchingLoad(context) {
  const {
    Router,
    watchProgressRepository,
    watchedItemsRepository,
    StartupSyncService,
    WatchProgressSource,
    buildWatchedTitleIdSet,
    CW_MAX_NEXT_UP_LOOKUPS,
    shouldApplyLateContinueWatchingFocus,
    shouldProtectContinueWatchingDisplay,
    CW_MAX_VISIBLE_ITEMS,
    buildVisibleContinueWatchingItems,
    buildCompleteContinueWatchingDisplay,
    buildContinueWatchingSignature,
    buildHeroIdentity,
    sortContinueWatchingItemsForDisplay,
    ContinueWatchingPreferences
  } = internals;
  const {
    token,
    refreshGeneration = null,
    watchedItemsPromise,
    progressAllPromise,
    recentProgressPromise,
    progressErrors,
    continueWatchingSourceKey,
    continueWatchingSource,
    startupSyncPendingAtLoad,
    startupSyncPullPromiseAtLoad,
    nextUpSeedOptions,
    prefs,
    background,
    preserveHomeReturnState,
    suppressContinueWatchingLoading,
    hasExistingContinueWatchingDisplay
  } = context;
  const loadGeneration = (this.homeContinueWatchingLoadGeneration || 0) + 1;
  this.homeContinueWatchingLoadGeneration = loadGeneration;
  const isCurrentHomeContinueWatchingLoad = () =>
    token === this.homeLoadToken &&
    loadGeneration === this.homeContinueWatchingLoadGeneration &&
    watchProgressRepository.getContinueWatchingSourceKey() === continueWatchingSourceKey &&
    (refreshGeneration == null || refreshGeneration === this.homeContinueWatchingSyncRefreshGeneration) &&
    Router.getCurrent() === "home";
  {
    return (async () => {
      const [allProgress, continueWatching] = await Promise.all([progressAllPromise, recentProgressPromise]);
      if (!isCurrentHomeContinueWatchingLoad()) {
        return;
      }
      if (watchProgressRepository.getContinueWatchingSourceKey() !== continueWatchingSourceKey) {
        return;
      }
      const sourceLoadState = watchProgressRepository.getContinueWatchingRemoteProgressState();
      const startupSyncStillPending =
        continueWatchingSource === WatchProgressSource.NUVIO_SYNC && StartupSyncService.isCurrentProfilePullPending();
      const startupSyncPullPromise =
        continueWatchingSource === WatchProgressSource.NUVIO_SYNC
          ? startupSyncPullPromiseAtLoad || StartupSyncService.getCurrentProfilePullPromise()
          : null;
      const startupSyncCompletedDuringLoad = startupSyncPendingAtLoad && !startupSyncStillPending;
      const startupSyncPending =
        continueWatchingSource === WatchProgressSource.NUVIO_SYNC && (startupSyncPendingAtLoad || startupSyncStillPending);
      const hasLoadedRemoteProgress = Boolean(
        !progressErrors.all &&
        !progressErrors.recent &&
        !startupSyncPending &&
        sourceLoadState?.sourceKey === continueWatchingSourceKey &&
        sourceLoadState.loaded === true
      );
      this.allProgress = Array.isArray(allProgress) ? allProgress : [];
      this.continueWatching = Array.isArray(continueWatching) ? continueWatching : [];
      this.watchedItems = await watchedItemsPromise;
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      void this.refreshWatchedTitleState({ token });
      if (!isCurrentHomeContinueWatchingLoad()) {
        return;
      }
      this.nextUpProgressCandidates = this.selectNextUpProgressCandidates(this.allProgress, this.continueWatching, this.watchedItems, {
        ...nextUpSeedOptions,
        nextUpFromFurthestEpisode: prefs.nextUpFromFurthestEpisode
      }).slice(0, CW_MAX_NEXT_UP_LOOKUPS);
      const shouldShowLoading = Boolean((this.continueWatching?.length || 0) + (this.nextUpProgressCandidates?.length || 0));
      const initialContinueWatchingPending = !this.continueWatchingInitialResolved;
      // Publish usable local progress while the cold pull runs, like Android.
      // Only an empty local result needs to wait for the authoritative pull.
      const shouldWaitForStartupSync = Boolean(
        initialContinueWatchingPending &&
        !shouldShowLoading &&
        (startupSyncPullPromise || startupSyncCompletedDuringLoad) &&
        !progressErrors.all &&
        !progressErrors.recent
      );
      const previousDisplaySignature = buildContinueWatchingSignature(this.continueWatchingDisplay);
      const previousHeroIdentity = buildHeroIdentity(this.heroItem);
      const previousLoadingState = Boolean(this.continueWatchingLoading);
      if (startupSyncPullPromise || startupSyncCompletedDuringLoad) {
        const refreshAfterStartupPull = () => {
          if (!isCurrentHomeContinueWatchingLoad()) {
            return;
          }
          const renderedSignature = this.renderedSyncSensitiveSignature;
          if (
            this.isInitialHomeLoading ||
            (StartupSyncService.getLastPullChangedHomeInputs?.() === false &&
              renderedSignature &&
              this.buildSyncSensitiveHomeSignature?.() === renderedSignature)
          ) {
            // The initial progress reads ran while the profile pull was in
            // flight. Re-read just Continue Watching while the initial gate is
            // active, or after a no-op pull, without rebuilding catalogs.
            const retryProgressErrors = { all: null, recent: null };
            startHomeContinueWatchingLoad.call(this, {
              ...context,
              watchedItemsPromise: watchedItemsRepository.getAll(2000).catch(() => []),
              progressAllPromise: watchProgressRepository.getAllForContinueWatching().catch((error) => {
                retryProgressErrors.all = error;
                return [];
              }),
              recentProgressPromise: watchProgressRepository.getRecent(CW_MAX_VISIBLE_ITEMS, { enrichMetadata: false }).catch((error) => {
                retryProgressErrors.recent = error;
                return [];
              }),
              progressErrors: retryProgressErrors,
              startupSyncPendingAtLoad: false,
              startupSyncPullPromiseAtLoad: null
            });
            return;
          }
          void this.requestHomeBackgroundRefresh({
            preserveReturnState: true,
            reason: "startup-sync"
          }).catch((error) => {
            console.warn("Home refresh after startup sync completion failed", error);
          });
        };
        if (startupSyncPullPromise) {
          void Promise.resolve(startupSyncPullPromise).then(refreshAfterStartupPull, refreshAfterStartupPull);
        } else if (startupSyncCompletedDuringLoad) {
          refreshAfterStartupPull();
        }
      }
      if (shouldWaitForStartupSync) {
        this.continueWatchingLoading = true;
        if (!previousLoadingState) {
          this.requestBackgroundRender();
        }
        return;
      }
      if (!suppressContinueWatchingLoading) {
        // Publish the raw in-progress state immediately. Metadata and Next Up are enriched
        // asynchronously below, matching Android's initial render and avoiding a CW skeleton
        // when the local progress already contains a title or artwork.
        // Android keeps series fields and the cards awaiting their next-up from the row on
        // screen, so titles do not flip to the raw progress ones and series do not drop out.
        this.continueWatchingDisplay = buildVisibleContinueWatchingItems(
          sortContinueWatchingItemsForDisplay(
            stabilizeImmediateContinueWatchingItems({
              rawItems: this.continueWatching,
              shownItems: this.continueWatchingDisplay,
              seededContentIds: new Set(
                (this.nextUpProgressCandidates || []).map((entry) => String(entry?.contentId || "").trim()).filter(Boolean)
              ),
              dismissedKeys: new Set(ContinueWatchingPreferences.getDismissedNextUpKeys())
            }),
            this.layoutPrefs?.continueWatchingSortMode
          ).slice(0, CW_MAX_VISIBLE_ITEMS),
          {
            requireArtwork: false
          }
        );
        this.continueWatchingLoading = Boolean(shouldShowLoading && !this.continueWatchingDisplay.length);
        if (this.continueWatchingDisplay.length) {
          this.persistContinueWatchingSnapshot();
        }
        const immediateDisplaySignature = buildContinueWatchingSignature(this.continueWatchingDisplay);
        if (
          this.layoutMode === "modern" &&
          this.layoutPrefs?.continueWatchingEnabled !== false &&
          this.continueWatchingDisplay.length &&
          shouldApplyLateContinueWatchingFocus({
            background,
            initialContinueWatchingPending,
            hasUserInteracted: this.hasUserInteractedSinceHomePaint,
            suppressInitialFocus: this.suppressInitialContinueWatchingFocus,
            hasAppliedInitialFocus: this.hasAppliedInitialContinueWatchingFocus
          })
        ) {
          this.forceInitialContinueWatchingFocus = true;
        }
        if (previousLoadingState !== this.continueWatchingLoading || previousDisplaySignature !== immediateDisplaySignature) {
          this.requestBackgroundRender();
        }
      }

      if (!shouldWaitForStartupSync && (!shouldShowLoading || this.continueWatchingDisplay?.length)) {
        this.continueWatchingInitialResolved = true;
      }
      if (this.isInitialHomeLoading && this.hasLoadedOnce && this.continueWatchingInitialResolved) {
        this.releaseInitialHomeLoading();
        if (!this.heroItem && !this.hasUserInteractedSinceHomePaint) {
          this.heroItem = this.pickInitialHero();
        }
        this.requestBackgroundRender();
      }

      if (!shouldShowLoading) {
        if (suppressContinueWatchingLoading && (progressErrors.all || progressErrors.recent)) {
          this.continueWatchingLoading = false;
          this.maybeStartPendingHomeBackgroundRefresh();
          return;
        }
        if (
          shouldProtectContinueWatchingDisplay({
            existingCount: hasExistingContinueWatchingDisplay ? this.continueWatchingDisplay.length : 0,
            nextCount: 0,
            hasLoadedRemoteProgress
          })
        ) {
          this.continueWatchingLoading = false;
          this.maybeStartPendingHomeBackgroundRefresh();
          return;
        }
        if (!this.continueWatchingInitialResolved) {
          // The local snapshot is empty while startup sync is still
          // authoritative. Keep the CW placeholder (and its focus anchor)
          // until the sync completion refresh can publish the real row.
          this.continueWatchingLoading = true;
          if (!previousLoadingState) {
            this.requestBackgroundRender();
          }
          return;
        }
        this.continueWatchingLoading = false;
        this.continueWatchingDisplay = [];
        this.clearContinueWatchingSnapshot();
        if (previousLoadingState || previousDisplaySignature) {
          this.requestBackgroundRender();
        }
        this.maybeStartPendingHomeBackgroundRefresh();
        return;
      }

      try {
        const enriched = await this.enrichContinueWatching(this.continueWatching, {
          allProgress: this.allProgress,
          watchedItems: this.watchedItems,
          nextUpProgressCandidates: this.nextUpProgressCandidates
        });
        if (!isCurrentHomeContinueWatchingLoad()) {
          return;
        }
        const nextDisplayStrict = buildVisibleContinueWatchingItems(enriched, {
          requireArtwork: true
        });
        const nextDisplayFallback = buildCompleteContinueWatchingDisplay(enriched);
        const nextDisplayLoose = buildVisibleContinueWatchingItems(enriched, {
          requireArtwork: false
        });
        const nextDisplay =
          nextDisplayStrict.length === nextDisplayFallback.length
            ? nextDisplayStrict
            : nextDisplayLoose.length >= nextDisplayFallback.length
              ? nextDisplayLoose
              : nextDisplayFallback;
        if (
          shouldProtectContinueWatchingDisplay({
            existingCount: hasExistingContinueWatchingDisplay ? this.continueWatchingDisplay.length : 0,
            nextCount: nextDisplay.length,
            hasLoadedRemoteProgress
          })
        ) {
          this.continueWatchingLoading = false;
          return;
        }
        this.continueWatchingDisplay = nextDisplay;
        this.scheduleContinueWatchingReleaseRefresh?.();
        this.continueWatchingInitialResolved = true;
        if (this.hasLoadedOnce) {
          this.releaseInitialHomeLoading();
        }
        this.continueWatchingLoading = false;
        if (nextDisplay.length) {
          this.persistContinueWatchingSnapshot();
        } else {
          this.clearContinueWatchingSnapshot();
        }
        if (this.layoutMode === "modern" && this.layoutPrefs?.continueWatchingEnabled !== false && this.continueWatchingDisplay.length) {
          if (!preserveHomeReturnState && !this.suppressInitialContinueWatchingFocus && !this.hasUserInteractedSinceHomePaint) {
            this.heroItem = this.pickInitialHero();
          }
          if (
            shouldApplyLateContinueWatchingFocus({
              background,
              initialContinueWatchingPending,
              hasUserInteracted: this.hasUserInteractedSinceHomePaint,
              suppressInitialFocus: this.suppressInitialContinueWatchingFocus,
              hasAppliedInitialFocus: this.hasAppliedInitialContinueWatchingFocus
            })
          ) {
            this.forceInitialContinueWatchingFocus = true;
          }
        }
        const nextDisplaySignature = buildContinueWatchingSignature(this.continueWatchingDisplay);
        const nextHeroIdentity = buildHeroIdentity(this.heroItem);
        if (
          previousLoadingState !== this.continueWatchingLoading ||
          previousDisplaySignature !== nextDisplaySignature ||
          (!preserveHomeReturnState && previousHeroIdentity !== nextHeroIdentity)
        ) {
          this.requestBackgroundRender();
        }
        this.maybeStartPendingHomeBackgroundRefresh();
      } catch (error) {
        console.warn("Continue watching async enrichment failed", error);
        this.continueWatchingInitialResolved = true;
        if (this.hasLoadedOnce) {
          this.releaseInitialHomeLoading();
        }
        this.continueWatchingLoading = false;
        if (!suppressContinueWatchingLoading && previousLoadingState) {
          this.requestBackgroundRender();
        }
        this.maybeStartPendingHomeBackgroundRefresh();
      }
    })().catch((error) => {
      console.warn("Continue watching load failed", error);
      if (!isCurrentHomeContinueWatchingLoad()) {
        return;
      }
      this.continueWatchingInitialResolved = true;
      this.continueWatchingLoading = false;
      if (this.hasLoadedOnce) {
        this.releaseInitialHomeLoading();
      }
      if (!suppressContinueWatchingLoading) {
        this.requestBackgroundRender();
      }
      this.maybeStartPendingHomeBackgroundRefresh();
    });
  }
}
