import * as internals from "./homeScreenContext.js";
import { startHomeContinueWatchingLoad } from "./homeContinueWatchingLoad.js";

function catalogItemIdentity(item = {}) {
  const id = String(item?.id || item?.videoId || item?.contentId || "").trim();
  if (!id) {
    return "";
  }
  const type = String(item?.apiType || item?.type || "")
    .trim()
    .toLowerCase();
  return `${type}:${id}`;
}

function mergeHomeCatalogRefreshRow(currentRow, freshRow, { rowHasFocus = false, layoutMode = "" } = {}) {
  const currentItems = Array.isArray(currentRow?.result?.data?.items) ? currentRow.result.data.items : [];
  const freshItems = Array.isArray(freshRow?.result?.data?.items) ? freshRow.result.data.items : [];
  if (!freshItems.length) {
    return currentRow;
  }
  if (!currentItems.length) {
    return rowHasFocus ? currentRow : freshRow;
  }

  const currentIds = currentItems.map(catalogItemIdentity);
  const freshIds = freshItems.map(catalogItemIdentity);
  const identitiesAreStable = currentIds.every(Boolean) && freshIds.every(Boolean);
  if (identitiesAreStable && freshIds.length <= currentIds.length && freshIds.every((identity, index) => identity === currentIds[index])) {
    // Keep pagination and the rendered card objects when page one still has
    // the same head. Android applies the same rule to refreshed catalog rows.
    return currentRow;
  }

  let addedCount = 0;
  if (identitiesAreStable) {
    const currentIdSet = new Set(currentIds);
    while (addedCount < freshIds.length && !currentIdSet.has(freshIds[addedCount])) {
      addedCount += 1;
    }
  }
  const remainingFreshIds = freshIds.slice(addedCount);
  const isPurePrepend = Boolean(
    identitiesAreStable &&
    addedCount > 0 &&
    remainingFreshIds.length > 0 &&
    remainingFreshIds.length <= currentIds.length &&
    remainingFreshIds.every((identity, index) => identity === currentIds[index])
  );

  if (rowHasFocus && (!isPurePrepend || layoutMode !== "modern")) {
    // Replacing a focused classic/grid row can remove the card under the focus
    // ring. Preserve that row until the next catalog refresh opportunity.
    return currentRow;
  }

  if (!isPurePrepend) {
    return freshRow;
  }

  const currentData = currentRow.result?.data || {};
  const freshData = freshRow.result?.data || {};
  const nextSkip = Number(currentData.nextSkip || 0);
  const mergedData = {
    ...freshData,
    ...currentData,
    items: [...freshItems.slice(0, addedCount), ...currentItems],
    nextSkip: currentData.supportsSkip !== false && nextSkip > 0 ? nextSkip + addedCount : currentData.nextSkip
  };
  return {
    ...currentRow,
    ...freshRow,
    result: {
      ...freshRow.result,
      ...currentRow.result,
      data: mergedData
    }
  };
}

export function createHomeScreenMethods04() {
  const {
    Router,
    addonRepository,
    CollectionsStore,
    ProfileManager,
    StartupSyncService,
    ProfileSettingsSyncService,
    watchProgressRepository,
    watchedItemsRepository,
    LayoutPreferences,
    getContinueWatchingNextUpSeedOptions,
    buildCatalogOrderKey,
    catalogShouldShowOnHome,
    catalogSkipStep,
    catalogSupportsExtra,
    MODERN_HOME_CONSTANTS,
    CW_MAX_VISIBLE_ITEMS,
    HERO_ROTATE_FIRST_DELAY_MS,
    HERO_ROTATE_INTERVAL_MS,
    HOME_CATALOG_REFRESH_TTL_MS,
    HOME_STABLE_GATE_TIMEOUT_MS,
    logHomePerf,
    homePerfNow,
    preloadHeroAssets,
    buildHeroIdentity,
    I18n
  } = internals;

  return {
    getHeroFocusDelay({ rapid = false } = {}) {
      if (this.isLegacyTvRuntime()) {
        return rapid ? 260 : 150;
      }
      return rapid ? MODERN_HOME_CONSTANTS.heroRapidSettleMs : MODERN_HOME_CONSTANTS.heroFocusDelayMs;
    },
    cancelScheduledRender() {
      if (this.homeRenderTimer) {
        clearTimeout(this.homeRenderTimer);
        this.homeRenderTimer = null;
      }
      if (this.homeRenderFrame) {
        cancelAnimationFrame(this.homeRenderFrame);
        this.homeRenderFrame = null;
      }
    },
    cancelInitialHomeLoadTimeout() {
      if (this.initialHomeLoadTimeout) {
        clearTimeout(this.initialHomeLoadTimeout);
        this.initialHomeLoadTimeout = null;
      }
    },
    releaseInitialHomeLoading() {
      this.isInitialHomeLoading = false;
      this.cancelInitialHomeLoadTimeout();
    },
    scheduleInitialHomeLoadTimeout(loadToken) {
      this.cancelInitialHomeLoadTimeout();
      this.initialHomeLoadTimeout = setTimeout(() => {
        this.initialHomeLoadTimeout = null;
        if (loadToken !== this.homeLoadToken || Router.getCurrent() !== "home" || !this.isInitialHomeLoading) {
          return;
        }
        // Match Android's stable Home gate: a slow or incomplete startup must
        // reveal the available surface instead of keeping a full-screen loader
        // indefinitely. The catalog requests continue in the background.
        this.releaseInitialHomeLoading();
        this.requestBackgroundRender();
      }, HOME_STABLE_GATE_TIMEOUT_MS);
    },
    invalidateNavigationModel() {
      this.navigationDomVersion = Number(this.navigationDomVersion || 0) + 1;
      this.navModel = null;
    },
    requestRender(options = {}) {
      if (!this.container || Router.getCurrent() !== "home") {
        return;
      }
      const delayMs = Math.max(0, Number(options?.delayMs || 0));
      if (delayMs > 0) {
        if (this.homeRenderTimer) {
          clearTimeout(this.homeRenderTimer);
          this.homeRenderTimer = null;
        }
        if (this.homeRenderFrame) {
          return;
        }
        this.homeRenderTimer = setTimeout(() => {
          this.homeRenderTimer = null;
          this.requestRender();
        }, delayMs);
        return;
      }
      if (this.homeRenderTimer) {
        clearTimeout(this.homeRenderTimer);
        this.homeRenderTimer = null;
      }
      if (this.homeRenderFrame) {
        return;
      }
      this.homeRenderFrame = requestAnimationFrame(() => {
        this.homeRenderFrame = null;
        if (!this.container || Router.getCurrent() !== "home") {
          return;
        }
        if (this.shouldDeferHomeRenderForInput()) {
          this.requestRender({
            delayMs: MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs
          });
          return;
        }
        this.render();
      });
    },
    requestBackgroundRender() {
      this.requestRender({ delayMs: this.getBackgroundRenderDelay() });
    },
    shouldDeferHomeRenderForInput() {
      if (this.layoutMode === "modern" && this.hasUserInteractedSinceHomePaint && this.shouldSuspendModernViewportFocusSync()) {
        return true;
      }
      // Tizen fast path: on constrained/legacy runtimes a full innerHTML
      // render mid-navigation steals frames and invalidates the nav model.
      // Defer background renders until 800ms after the last D-pad press on
      // every layout, not just modern.
      try {
        const constrained =
          (typeof this.isPerformanceConstrained === "function" && this.isPerformanceConstrained()) ||
          (typeof this.isLegacyTvRuntime === "function" && this.isLegacyTvRuntime()) ||
          globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
          globalThis?.document?.documentElement?.classList?.contains("legacy-tizen");
        if (constrained && Date.now() - Number(this.lastHomeInputAt || 0) < 800) {
          return true;
        }
      } catch (_) {}
      return false;
    },
    maybeStartPendingHomeBackgroundRefresh() {
      if (this.homeBackgroundRefreshPending) {
        if (this.isInitialHomeLoading || !this.continueWatchingInitialResolved) {
          return false;
        }
        void this.requestHomeBackgroundRefresh({
          preserveReturnState: Boolean(this.homeBackgroundRefreshPreserveReturnState),
          reason: this.homeBackgroundRefreshReason || "post-initial-load"
        }).catch((error) => {
          console.warn("Home deferred background refresh failed", error);
        });
        return true;
      }
      if (!this.homeContinueWatchingSyncRefreshPending || this.isInitialHomeLoading || !this.continueWatchingInitialResolved) {
        return false;
      }
      this.homeContinueWatchingSyncRefreshPending = false;
      void this.refreshHomeContinueWatchingAfterSync().catch((error) => {
        console.warn("Home Continue Watching sync refresh failed", error);
      });
      return true;
    },
    refreshHomeContinueWatchingAfterSync() {
      if (Router.getCurrent() !== "home" || this.homeBackgroundRefreshPending || this.homeBackgroundRefreshPromise) {
        return Promise.resolve(false);
      }
      if (!this.hasLoadedOnce || this.isInitialHomeLoading || !this.continueWatchingInitialResolved) {
        this.homeContinueWatchingSyncRefreshPending = true;
        return Promise.resolve(false);
      }
      if (this.homeContinueWatchingSyncRefreshPromise) {
        this.homeContinueWatchingSyncRefreshPending = true;
        return this.homeContinueWatchingSyncRefreshPromise;
      }

      const token = this.homeLoadToken;
      const continueWatchingSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
      const continueWatchingSource = watchProgressRepository.getContinueWatchingSource();
      const progressErrors = { all: null, recent: null };
      const refreshGeneration = Number(this.homeContinueWatchingSyncRefreshGeneration || 0) + 1;
      this.homeContinueWatchingSyncRefreshGeneration = refreshGeneration;
      let refreshPromise = null;
      refreshPromise = Promise.resolve()
        .then(() =>
          startHomeContinueWatchingLoad.call(this, {
            token,
            refreshGeneration,
            watchedItemsPromise: watchedItemsRepository.getAll(2000).catch(() => []),
            progressAllPromise: watchProgressRepository.getAllForContinueWatching().catch((error) => {
              progressErrors.all = error;
              return [];
            }),
            recentProgressPromise: watchProgressRepository.getRecent(CW_MAX_VISIBLE_ITEMS, { enrichMetadata: false }).catch((error) => {
              progressErrors.recent = error;
              return [];
            }),
            progressErrors,
            continueWatchingSourceKey,
            continueWatchingSource,
            startupSyncPendingAtLoad: false,
            startupSyncPullPromiseAtLoad: null,
            nextUpSeedOptions: getContinueWatchingNextUpSeedOptions(),
            prefs: LayoutPreferences.get(),
            background: true,
            preserveHomeReturnState: true,
            suppressContinueWatchingLoading: true,
            hasExistingContinueWatchingDisplay: Boolean(this.continueWatchingDisplay?.length)
          })
        )
        .finally(() => {
          if (this.homeContinueWatchingSyncRefreshPromise === refreshPromise) {
            this.homeContinueWatchingSyncRefreshPromise = null;
          }
          if (this.homeContinueWatchingSyncRefreshPending && Router.getCurrent() === "home") {
            this.maybeStartPendingHomeBackgroundRefresh();
          }
        });
      this.homeContinueWatchingSyncRefreshPromise = refreshPromise;
      logHomePerf("continueWatchingSyncRefresh", {
        source: String(continueWatchingSource || ""),
        profileId: String(ProfileManager.getActiveProfileId() || "")
      });
      return refreshPromise;
    },
    async refreshHomeCatalogsIfStale({ reason = "catalogs-stale" } = {}) {
      if (
        Router.getCurrent() !== "home" ||
        !this.hasLoadedOnce ||
        this.isInitialHomeLoading ||
        !this.continueWatchingInitialResolved ||
        this.homeBackgroundRefreshPending ||
        this.homeBackgroundRefreshPromise
      ) {
        return false;
      }
      if (this.homeCatalogRefreshPromise) {
        return this.homeCatalogRefreshPromise;
      }

      const now = Date.now();
      const lastRefreshAtMs = Number(this.lastHomeCatalogRefreshAtMs || 0);
      if (lastRefreshAtMs > 0 && now >= lastRefreshAtMs && now - lastRefreshAtMs < HOME_CATALOG_REFRESH_TTL_MS) {
        logHomePerf("catalogRefreshSkipped", {
          reason: "catalogs-fresh",
          ageMs: now - lastRefreshAtMs
        });
        return false;
      }

      const token = this.homeLoadToken;
      const profileId = String(ProfileManager.getActiveProfileId() || "");
      const loadedRows = (this.rows || []).filter(
        (row) => row?.rowKind !== "collection" && row?.result?.status === "success" && row?.homeCatalogKey
      );
      if (!loadedRows.length) {
        return false;
      }

      const refreshStart = homePerfNow();
      const refreshPromise = (async () => {
        const addons = await addonRepository.getInstalledAddons({ cacheOnly: true });
        if (
          token !== this.homeLoadToken ||
          Router.getCurrent() !== "home" ||
          this.homeBackgroundRefreshPending ||
          profileId !== String(ProfileManager.getActiveProfileId() || "")
        ) {
          return false;
        }

        const loadedRowsByKey = new Map(loadedRows.map((row) => [String(row.homeCatalogKey), row]));
        const descriptors = [];
        const seenDescriptors = new Set();
        const matchedLoadedRowKeys = new Set();
        (Array.isArray(addons) ? addons : []).forEach((addon) => {
          (Array.isArray(addon?.catalogs) ? addon.catalogs : [])
            .filter((catalog) => catalogShouldShowOnHome(catalog))
            .forEach((catalog) => {
              const homeCatalogKey = buildCatalogOrderKey(addon.id, catalog.apiType, catalog.id);
              const loadedRow = loadedRowsByKey.get(String(homeCatalogKey));
              if (
                !loadedRow ||
                String(loadedRow.addonBaseUrl || "") !== String(addon.baseUrl || "") ||
                String(loadedRow.addonId || "") !== String(addon.id || "")
              ) {
                return;
              }
              matchedLoadedRowKeys.add(String(homeCatalogKey));
              const descriptor = {
                addonBaseUrl: addon.baseUrl,
                addonId: addon.id,
                addonName: addon.displayName,
                catalogId: catalog.id,
                catalogName: catalog.name,
                type: catalog.apiType,
                supportsSkip: catalogSupportsExtra(catalog, "skip"),
                skipStep: catalogSkipStep(catalog)
              };
              const descriptorKey = JSON.stringify([descriptor.addonBaseUrl, descriptor.addonId, descriptor.catalogId, descriptor.type]);
              if (!seenDescriptors.has(descriptorKey)) {
                seenDescriptors.add(descriptorKey);
                descriptors.push(descriptor);
              }
            });
        });

        if (Array.from(loadedRowsByKey.keys()).some((key) => !matchedLoadedRowKeys.has(key))) {
          logHomePerf("catalogRefreshFallback", {
            reason: "loaded-catalog-missing-from-cache",
            loaded: loadedRowsByKey.size,
            matched: matchedLoadedRowKeys.size
          });
          return this.requestHomeBackgroundRefresh({
            preserveReturnState: true,
            reason: "catalog-refresh-manifest-mismatch"
          });
        }
        if (!descriptors.length) {
          return false;
        }
        this.lastHomeCatalogRefreshAtMs = Date.now();
        const refreshedRows = await this.fetchCatalogRows(descriptors, {
          batchSize: this.getDeferredCatalogBatchSize()
        });
        if (
          token !== this.homeLoadToken ||
          Router.getCurrent() !== "home" ||
          this.homeBackgroundRefreshPending ||
          profileId !== String(ProfileManager.getActiveProfileId() || "")
        ) {
          return false;
        }

        const freshRowsByKey = new Map(refreshedRows.map((row) => [String(row.homeCatalogKey), row]));
        const focusedRowKey = String(this.captureCurrentFocusState()?.rowKey || "");
        let changedRowCount = 0;
        const nextRows = (this.rows || []).map((row) => {
          const freshRow = freshRowsByKey.get(String(row?.homeCatalogKey || ""));
          if (!freshRow || row?.rowKind === "collection") {
            return row;
          }
          const mergedRow = mergeHomeCatalogRefreshRow(row, freshRow, {
            rowHasFocus: String(row.homeCatalogKey) === focusedRowKey,
            layoutMode: String(this.layoutMode || "")
          });
          if (mergedRow !== row) {
            changedRowCount += 1;
          }
          return mergedRow;
        });

        if (changedRowCount) {
          this.collections = CollectionsStore.get();
          this.rows = this.sortAndFilterRows(nextRows, this.collections);
          this.render();
        }
        logHomePerf("catalogRefresh", {
          reason,
          requested: descriptors.length,
          returned: refreshedRows.length,
          changedRows: changedRowCount,
          ms: Number((homePerfNow() - refreshStart).toFixed(2))
        });
        return changedRowCount > 0;
      })().finally(() => {
        if (this.homeCatalogRefreshPromise === refreshPromise) {
          this.homeCatalogRefreshPromise = null;
        }
      });
      this.homeCatalogRefreshPromise = refreshPromise;
      return refreshPromise;
    },
    ensureStartupSyncSubscription() {
      if (this.unsubscribeStartupSyncPullCompleted) {
        return;
      }
      this.unsubscribeStartupSyncPullCompleted = StartupSyncService.subscribeToPullCompleted(
        ({ profileId, changedHomeInputs, source } = {}) => {
          if (Router.getCurrent() !== "home") {
            return;
          }
          const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
          if (profileId && String(profileId) !== activeProfileId) {
            return;
          }
          if (source === "watch-state") {
            void this.refreshHomeContinueWatchingAfterSync().catch((error) => {
              console.warn("Home Continue Watching post-sync refresh failed", error);
            });
            return;
          }
          const renderedSignature = this.renderedSyncSensitiveSignature;
          if (changedHomeInputs === false && renderedSignature && this.buildSyncSensitiveHomeSignature() === renderedSignature) {
            logHomePerf("backgroundRefreshSkipped", { reason: "startup-sync" });
            void this.refreshHomeCatalogsIfStale({ reason: "startup-sync" }).catch((error) => {
              console.warn("Home stale-catalog refresh failed", error);
            });
            return;
          }
          void this.requestHomeBackgroundRefresh({
            preserveReturnState: true,
            reason: "startup-sync"
          }).catch((error) => {
            console.warn("Home post-sync refresh failed", error);
          });
        }
      );
    },
    buildSyncSensitiveHomeSignature() {
      try {
        const profileSettingsSignature = ProfileSettingsSyncService.getHomeInputSignature?.(ProfileManager.getActiveProfileId());
        if (!profileSettingsSignature) {
          return "";
        }
        return JSON.stringify([
          LayoutPreferences.get() || {},
          String(watchProgressRepository.getContinueWatchingSourceKey() || ""),
          String(I18n.getLocale() || ""),
          profileSettingsSignature
        ]);
      } catch (_) {
        return "";
      }
    },
    ensureAddonManifestSubscriptions() {
      if (!this.unsubscribeAddonManifestChanges) {
        this.unsubscribeAddonManifestChanges = addonRepository.onManifestCacheChanged(() => {
          if (Router.getCurrent() !== "home") {
            return;
          }
          void this.requestHomeBackgroundRefresh({
            preserveReturnState: true,
            reason: "manifest-cache"
          }).catch((error) => {
            console.warn("Home post-manifest refresh failed", error);
          });
        });
      }
      if (!this.unsubscribeInstalledAddonChanges) {
        this.unsubscribeInstalledAddonChanges = addonRepository.onInstalledAddonsChanged(() => {
          if (Router.getCurrent() !== "home") {
            return;
          }
          void this.requestHomeBackgroundRefresh({
            preserveReturnState: true,
            reason: "addon-state"
          }).catch((error) => {
            console.warn("Home addon-state refresh failed", error);
          });
        });
      }
    },
    requestHomeBackgroundRefresh({ preserveReturnState = true, reason = "background" } = {}) {
      this.homeBackgroundRefreshPending = true;
      this.homeBackgroundRefreshPreserveReturnState = Boolean(this.homeBackgroundRefreshPreserveReturnState || preserveReturnState);
      this.homeBackgroundRefreshReason = String(reason || "background");

      if (this.isInitialHomeLoading) {
        return Promise.resolve(false);
      }
      // A cold Home load must finish its first Continue Watching cycle before a
      // startup/manifest refresh can invalidate the load token. Otherwise the
      // catalog paints and claims focus, then the first CW result arrives through
      // a background load that is intentionally not allowed to steal focus.
      if (!this.continueWatchingInitialResolved && reason !== "startup-sync") {
        return Promise.resolve(false);
      }
      if (this.homeBackgroundRefreshPromise) {
        return this.homeBackgroundRefreshPromise;
      }

      // A post-sync refresh can begin while the initial catalog/CW load still
      // has child promises in flight. Invalidate that older load before the new
      // refresh captures its token, otherwise a slow stale response can win
      // after the freshly synchronized data has been rendered.
      this.homeContinueWatchingSyncRefreshPending = false;
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;

      let refreshPromise = null;
      refreshPromise = (async () => {
        let didRefresh = false;
        while (this.homeBackgroundRefreshPending && Router.getCurrent() === "home") {
          const shouldPreserveReturnState = Boolean(this.homeBackgroundRefreshPreserveReturnState);
          const refreshReason = this.homeBackgroundRefreshReason;
          this.homeBackgroundRefreshPending = false;
          this.homeBackgroundRefreshPreserveReturnState = false;
          this.homeBackgroundRefreshReason = "";
          await this.loadData({
            background: true,
            preserveReturnState: shouldPreserveReturnState,
            refreshManifests: refreshReason !== "manifest-cache"
          });
          didRefresh = true;
          logHomePerf("backgroundRefresh", {
            reason: refreshReason,
            preserveReturnState: shouldPreserveReturnState
          });
        }
        return didRefresh;
      })().finally(() => {
        if (this.homeBackgroundRefreshPromise === refreshPromise) {
          this.homeBackgroundRefreshPromise = null;
        }
      });
      this.homeBackgroundRefreshPromise = refreshPromise;
      return refreshPromise;
    },
    stopHeroRotation() {
      if (this.heroRotateTimer) {
        clearInterval(this.heroRotateTimer);
        this.heroRotateTimer = null;
      }
      if (this.heroRotateTimeout) {
        clearTimeout(this.heroRotateTimeout);
        this.heroRotateTimeout = null;
      }
    },
    cancelPendingHeroFocus() {
      if (this.heroFocusDelayTimer) {
        clearTimeout(this.heroFocusDelayTimer);
        this.heroFocusDelayTimer = null;
      }
      if (this.heroBackdropPreloadTimer) {
        clearTimeout(this.heroBackdropPreloadTimer);
        this.heroBackdropPreloadTimer = null;
      }
      if (this.deferredContinueWatchingFocusTimer) {
        clearTimeout(this.deferredContinueWatchingFocusTimer);
        this.deferredContinueWatchingFocusTimer = null;
      }
      this.container?.querySelector(".home-modern-hero-card")?.classList.remove("is-hero-focus-pending");
      this.heroFocusToken = Number(this.heroFocusToken || 0) + 1;
    },
    startHeroRotation() {
      this.stopHeroRotation();
      if (this.layoutMode === "modern" || this.isPerformanceConstrained()) {
        return;
      }
      if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
        return;
      }
      this.heroRotateTimeout = setTimeout(() => {
        if (!this.container?.querySelector(".home-hero-card.focusable.focused")) {
          this.rotateHero(1);
        }
        this.heroRotateTimer = setInterval(() => {
          if (!this.container?.querySelector(".home-hero-card.focusable.focused")) {
            this.rotateHero(1);
          }
        }, HERO_ROTATE_INTERVAL_MS);
      }, HERO_ROTATE_FIRST_DELAY_MS);
    },
    rotateHero(step = 1) {
      if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
        return;
      }
      const total = this.heroCandidates.length;
      this.heroIndex = (Number(this.heroIndex || 0) + step + total) % total;
      this.heroItem = this.heroCandidates[this.heroIndex];
      if (this.layoutMode === "modern") {
        this.applyHeroToDom();
        return;
      }

      // Android's legacy/grid HeroCarousel keeps the current scene alive while
      // the next slide is prepared. Coalesce repeated D-pad navigation so a
      // slow TV never commits an intermediate poster/logo from a held button.
      const sceneToken = (this.pendingHeroSceneToken = Number(this.pendingHeroSceneToken || 0) + 1);
      const pendingHero = this.heroItem;
      const pendingHeroIdentity = buildHeroIdentity(pendingHero);
      void preloadHeroAssets(pendingHero, this.layoutMode).then(() => {
        if (Number(this.pendingHeroSceneToken || 0) !== sceneToken || buildHeroIdentity(this.heroItem) !== pendingHeroIdentity) {
          return;
        }
        this.applyHeroToDom();
      });
    }
  };
}
