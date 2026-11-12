import { nextShuffleVisit } from "../../../core/player/episodeShuffle.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods20() {
  const {
    Router,
    ScreenUtils,
    watchProgressRepository,
    watchedTitleStateRepository,
    LayoutPreferences,
    CollectionsStore,
    ProfileManager,
    Platform,
    buildWatchedTitleIdSet,
    getSidebarProfileState,
    setModernSidebarPillIconOnly,
    setModernSidebarExpanded,
    setLegacySidebarExpanded,
    HOME_PERF_DEBUG,
    homePerfNow,
    logHomePerf,
    getHomeCatalogRowKeys,
    getRenderedHomeCatalogRowKeys,
    sameStringArray,
    readContinueWatchingDisplaySnapshot
  } = internals;

  return {
    async mount(params = {}, navigationContext = {}) {
      this.shuffleVisit = nextShuffleVisit();
      const mountStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
      const isBackNavigation = Boolean(navigationContext?.isBackNavigation);
      this.container = document.getElementById("home");
      this.hasUserInteractedSinceHomePaint = false;
      const restoredRouteFocusState =
        navigationContext?.isBackNavigation && navigationContext?.restoredState?.layoutMode ? navigationContext.restoredState : null;
      const storedReturnFocusState = navigationContext?.isBackNavigation
        ? this.pendingBackFocusState || this.readStoredReturnFocusState()
        : null;
      const returnFocusState = restoredRouteFocusState || storedReturnFocusState;
      ScreenUtils.show(this.container);
      this.ensureDelegatedEventsBound();
      this.ensureAddonManifestSubscriptions();
      this.sidebarExpanded = false;
      this.sidebarOpenedByBack = false;
      this.pillIconOnly = Boolean(navigationContext?.isBackNavigation && returnFocusState?.focusKind !== "sidebar");
      this.cancelModernSidebarPillAutoCollapse();
      this.homeRouteEnterPending = !(navigationContext?.isBackNavigation || returnFocusState?.layoutMode);
      this.destroyHomeHoldDialog();
      this.unlockHomeHoldFocus();
      this.continueWatchingMenu = null;
      this.posterHoldMenu = null;
      this.posterListPicker = null;
      this.pendingContinueWatchingFocusIndex = null;
      this.pendingContinueWatchingFocusRowKey = null;
      this.suppressHoldMenuEnterUntilKeyUp = false;
      this.cancelPendingContinueWatchingEnter();
      this.forceInitialContinueWatchingFocus = false;
      this.continueWatchingLoading = false;
      // Preserved/route-resumed Home already has a settled CW surface. The cold
      // path below replaces this with the snapshot-aware initial state.
      this.continueWatchingInitialResolved = true;
      if (returnFocusState?.layoutMode) {
        this.pendingBackFocusState = returnFocusState;
      } else if (!navigationContext?.isBackNavigation) {
        this.clearStoredReturnFocusState();
      }
      this.isRestoringFocusFromBack = Boolean(navigationContext?.isBackNavigation || returnFocusState?.layoutMode);
      this.suppressInitialContinueWatchingFocus = Boolean(navigationContext?.isBackNavigation || returnFocusState?.layoutMode);
      if (navigationContext?.restoredState?.layoutMode) {
        this.savedFocusStates = {
          ...(this.savedFocusStates || {}),
          [navigationContext.restoredState.layoutMode]: navigationContext.restoredState
        };
      }
      if (returnFocusState?.layoutMode) {
        this.savedFocusStates = {
          ...(this.savedFocusStates || {}),
          [returnFocusState.layoutMode]: returnFocusState
        };
      }
      const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
      const profileChanged = activeProfileId !== String(this.loadedProfileId || "");
      const watchProgressSourceChanged =
        watchProgressRepository.getContinueWatchingSourceKey() !== String(this.loadedWatchProgressSourceKey || "");
      const forceReload = Boolean(params?.forceReload && !isBackNavigation);
      if (profileChanged || watchProgressSourceChanged || forceReload) {
        this.hasLoadedOnce = false;
        this.hasAppliedInitialContinueWatchingFocus = false;
        this.sidebarProfile = null;
        this.savedFocusStates = {};
      }
      if (returnFocusState?.layoutMode) {
        this.savedFocusStates = {
          ...(this.savedFocusStates || {}),
          [returnFocusState.layoutMode]: returnFocusState
        };
      }

      const previousRoute = String(navigationContext?.previousRoute || "");
      const isHomeRouteReturn = Boolean(navigationContext?.isBackNavigation || (previousRoute && previousRoute !== "home"));
      let shouldRepaintPreservedHome = false;
      if (isHomeRouteReturn && this.hasLoadedOnce && Array.isArray(this.rows) && this.rows.length) {
        const renderedCatalogRowKeys = getRenderedHomeCatalogRowKeys(this.container);
        this.collections = CollectionsStore.get();
        this.rows = this.sortAndFilterRows(this.rows, this.collections);
        shouldRepaintPreservedHome = Boolean(
          this.homeDomPreserved && !sameStringArray(renderedCatalogRowKeys, getHomeCatalogRowKeys(this.rows))
        );
      }
      const canResumePreservedTvHome = Boolean(
        (Platform.isTizen() || Platform.isWebOS()) &&
        isHomeRouteReturn &&
        this.homeDomPreserved &&
        this.hasLoadedOnce &&
        Array.isArray(this.rows) &&
        this.rows.length &&
        this.container?.childNodes?.length &&
        String(this.renderedLayoutMode || "") === String(this.layoutMode || "")
      );
      if (canResumePreservedTvHome) {
        this.homeDomPreserved = false;
        this.container.classList.remove("home-dom-preserved");
        this.container.style.removeProperty("position");
        this.container.style.removeProperty("top");
        this.container.style.removeProperty("right");
        this.container.style.removeProperty("bottom");
        this.container.style.removeProperty("left");
        this.container.style.removeProperty("visibility");
        this.container.style.removeProperty("pointer-events");
        // The preserved DOM still has the menu that opened the route expanded;
        // Android lands on Home with the drawer closed, so apply that state too.
        if (this.layoutPrefs?.modernSidebar) {
          setModernSidebarExpanded(this.container, false);
        } else {
          setLegacySidebarExpanded(this.container, false);
        }
        setModernSidebarPillIconOnly(this.container, this.pillIconOnly);
        this.scheduleModernSidebarPillAutoCollapse();
        this.homeLoadToken = (this.homeLoadToken || 0) + 1;
        if (shouldRepaintPreservedHome) {
          // The TV DOM was kept alive while the order screen was open. Repaint
          // only when its visible catalog sequence no longer matches the local
          // preference; unchanged returns keep the low-cost preserved path.
          this.render();
        }
        this.bindHomeViewportEvents();
        this.setupContinueWatchingProgressiveRendering();
        if (this.layoutMode === "modern") {
          this.setupModernTrackScrollPagination();
        }
        const restoredFocus = this.restoreFocusState(returnFocusState);
        if (restoredFocus) {
          this.isRestoringFocusFromBack = false;
          this.clearStoredReturnFocusState();
        } else {
          ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
        }
        this.syncFocusedCollectionCardState();
        if (this.layoutMode === "grid") {
          this.setupGridStickyHeader(Boolean(this.layoutPrefs?.heroSectionEnabled) && Boolean(this.heroItem));
        }
        this.startHeroRotation();
        this.homeRouteEnterPending = false;
        this.pendingCollectionRouteReturnAnimation = false;
        this.ensureHomeTruncationObservers();
        this.scheduleHomeTruncationUpdate();
        this.scheduleHomeLazyImageHydration();
        this.scheduleReturnFocusRestore();
        this.ensureStartupSyncSubscription();
        this.refreshHomeAfterRouteReturn({
          preserveReturnState: true,
          reason: "route-resume"
        }).catch((error) => {
          console.warn("Home background refresh failed", error);
        });
        logHomePerf("mount", {
          ms: Number((homePerfNow() - mountStart).toFixed(2)),
          route: "home",
          background: true,
          layoutMode: String(this.layoutMode || ""),
          mode: "resume"
        });
        return;
      }
      this.homeDomPreserved = false;
      this.container.classList.remove("home-dom-preserved");
      this.container.style.removeProperty("position");
      this.container.style.removeProperty("top");
      this.container.style.removeProperty("right");
      this.container.style.removeProperty("bottom");
      this.container.style.removeProperty("left");
      this.container.style.removeProperty("visibility");
      this.container.style.removeProperty("pointer-events");

      if (this.hasLoadedOnce && Array.isArray(this.rows) && this.rows.length) {
        this.homeLoadToken = (this.homeLoadToken || 0) + 1;
        this.render();
        this.ensureStartupSyncSubscription();
        this.refreshHomeAfterRouteReturn({
          preserveReturnState: Boolean(navigationContext?.isBackNavigation || returnFocusState?.layoutMode),
          reason: "route-return"
        }).catch((error) => {
          console.warn("Home background refresh failed", error);
        });
        logHomePerf("mount", {
          ms: Number((homePerfNow() - mountStart).toFixed(2)),
          route: "home",
          background: true,
          layoutMode: String(this.layoutMode || ""),
          mode: "refresh"
        });
        return;
      }

      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.hasAppliedInitialContinueWatchingFocus = false;
      this.isInitialHomeLoading = true;
      this.ensureStartupSyncSubscription();
      this.layoutPrefs = LayoutPreferences.get();
      this.renderedSyncSensitiveSignature = this.buildSyncSensitiveHomeSignature();
      this.layoutMode = String(this.layoutPrefs.homeLayout || "classic").toLowerCase();
      this.rows = [];
      this.watchedItems = [];
      this.watchedTitleIds = new Set();
      this.continueWatchingDisplay = readContinueWatchingDisplaySnapshot(watchProgressRepository.getContinueWatchingSourceKey());
      this.continueWatchingHydratedFromSnapshot = Boolean(this.continueWatchingDisplay.length);
      const continueWatchingEnabled = this.layoutPrefs?.continueWatchingEnabled !== false;
      this.continueWatchingInitialResolved = !continueWatchingEnabled || this.continueWatchingHydratedFromSnapshot;
      // Keep a focusable CW row in the first Home paint while the cold source is
      // being resolved. This mirrors Android's stable initial presentation and
      // prevents catalog cards from becoming the accidental focus anchor.
      this.continueWatchingLoading = continueWatchingEnabled && !this.continueWatchingInitialResolved;
      this.heroCandidates = [];
      this.heroItem = this.pickInitialHero();
      // Paint from local profile/member/avatar state first. Remote membership and
      // avatar refresh is already started by loadData after this first render.
      this.sidebarProfile = await getSidebarProfileState({ cacheOnly: true }).catch(() => null);
      this.render();

      // Android composes Home before catalog/progress IO completes. The local
      // snapshot above is the first paint; keep the route and remote navigation
      // responsive while the existing progressive loader fills the rows.
      const loadToken = this.homeLoadToken;
      this.scheduleInitialHomeLoadTimeout(loadToken);
      void this.loadData({ background: false })
        .then(() => {
          if (loadToken !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          if (this.homeBackgroundRefreshPending) {
            void this.requestHomeBackgroundRefresh({
              preserveReturnState: true,
              reason: this.homeBackgroundRefreshReason || "post-initial-load"
            }).catch((error) => {
              console.warn("Home deferred background refresh failed", error);
            });
          }
          logHomePerf("mount", {
            ms: Number((homePerfNow() - mountStart).toFixed(2)),
            route: "home",
            background: false,
            layoutMode: String(this.layoutMode || "")
          });
        })
        .catch((error) => {
          if (loadToken !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          this.releaseInitialHomeLoading({ force: true });
          console.error("Home background load failed", error);
          this.requestBackgroundRender();
        });
    },
    async refreshWatchedTitleState({ token = this.homeLoadToken } = {}) {
      const requestId = Number(this.watchedTitleProjectionRequestId || 0) + 1;
      this.watchedTitleProjectionRequestId = requestId;
      const baseWatchedItems = this.watchedItems;
      const catalogItems = (this.rows || []).flatMap((row) => (Array.isArray(row?.result?.data?.items) ? row.result.data.items : []));
      if (!catalogItems.length || !Array.isArray(this.watchedItems)) {
        return;
      }
      const projectedItems = await watchedTitleStateRepository
        .getTitleWatchedItems(catalogItems, {
          baseWatchedItems,
          limit: 2000
        })
        .catch((error) => {
          console.warn("Home watched title projection failed", error);
          return baseWatchedItems;
        });
      if (
        token !== this.homeLoadToken ||
        requestId !== this.watchedTitleProjectionRequestId ||
        this.watchedItems !== baseWatchedItems ||
        Router.getCurrent() !== "home"
      ) {
        return;
      }
      this.watchedItems = Array.isArray(projectedItems) ? projectedItems : baseWatchedItems;
      this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
      // Every Home return re-projects watched titles; re-rendering all rows for an unchanged set only repeats identical markup.
      const rendered = this.renderedWatchedTitleIds;
      const unchanged =
        rendered instanceof Set && rendered.size === this.watchedTitleIds.size && [...rendered].every((id) => this.watchedTitleIds.has(id));
      if (unchanged) {
        // Same titles: keep the rendered set, whose identity the row markup cache checks.
        this.watchedTitleIds = rendered;
      } else {
        this.requestBackgroundRender();
      }
    }
  };
}
