import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods23() {
  const {
    ScreenUtils,
    renderModernHomeLayout,
    bindRootSidebarEvents,
    renderRootSidebar,
    HOME_GRID_DEFAULT_ROW_COUNT,
    HOME_GRID_SAFE_MAX_COLUMNS,
    HOME_MAX_ITEMS_PER_ROW_CLASSIC,
    HOME_PERF_DEBUG,
    escapeAttribute,
    escapeHtml,
    formatCatalogRowTitle,
    homePerfNow,
    logHomePerf,
    renderHeroBackdropImage,
    buildModernHomeSizingStyle,
    renderHomeLoadingState,
    shouldEnrichModernHero,
    isCollectionFolderItem,
    normalizeCollectionFolderItem,
    partitionContinueWatchingRows,
    normalizeCatalogItem,
    buildModernHeroPresentation,
    renderHeroMarkup,
    resolveContinueWatchingBlurNextUp,
    renderContinueWatchingSection,
    renderLegacyCatalogRowsMarkup,
    createSeeAllCardMarkup,
    getHomeGridRowCount,
    normalizeHomeGridCatalogSections,
    shouldDeferHomeRowImages,
    createPosterCardMarkup
  } = internals;

  return {
    render() {
      const renderStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
      this.cancelScheduledRender();
      this.cancelModernCameraFollow({ stopAnimations: true });
      this.teardownModernTrackScrollPagination();
      this.teardownContinueWatchingProgressiveRendering();
      this.invalidateNavigationModel();
      const backFocusState = this.isRestoringFocusFromBack ? this.pendingBackFocusState || this.readStoredReturnFocusState() || null : null;
      const liveFocusState = this.captureCurrentFocusState();
      const savedFocusState = this.savedFocusStates?.[this.layoutMode] || null;
      const rawRetainedFocusState = backFocusState || liveFocusState || savedFocusState || null;
      const retainedFocusState = rawRetainedFocusState;
      this.cancelFocusedPosterFlow();
      this.expandedPosterNode = null;
      const backFocusHero = backFocusState ? this.getHeroSourceFromFocusState(backFocusState) : null;
      const shouldHoldHeroForContinueWatching =
        this.layoutMode === "modern" &&
        this.layoutPrefs?.continueWatchingEnabled !== false &&
        Boolean(this.continueWatchingLoading) &&
        !this.continueWatchingDisplay?.length &&
        !this.heroItem;
      let heroItem = null;
      if (!shouldHoldHeroForContinueWatching) {
        const rawHeroItem = backFocusHero || this.heroItem || this.heroCandidates?.[this.heroIndex] || this.pickHeroItem(this.rows);
        heroItem = isCollectionFolderItem(rawHeroItem)
          ? normalizeCollectionFolderItem(rawHeroItem)
          : normalizeCatalogItem(rawHeroItem, "movie");
        if (backFocusHero) {
          this.heroItem = heroItem;
        }
      }
      if (this.layoutMode === "modern" && shouldEnrichModernHero(heroItem)) {
        heroItem = { ...heroItem, heroMetaEnriching: true };
        this.heroItem = heroItem;
      }
      const showHeroSection = Boolean(this.layoutPrefs?.heroSectionEnabled) && Boolean(heroItem);
      const modernLandscapePostersEnabled = this.layoutMode === "modern" && Boolean(this.layoutPrefs?.modernLandscapePostersEnabled);
      const modernLandscapeLayoutClass = modernLandscapePostersEnabled ? " home-modern-landscape-posters" : "";
      const modernHeroFullScreenBackdropClass =
        this.layoutMode === "modern" && Boolean(this.layoutPrefs?.modernHeroFullScreenBackdropEnabled)
          ? " home-modern-fullscreen-backdrop"
          : "";
      const modernSidebarLayoutClass = this.layoutPrefs?.modernSidebar ? " home-modern-sidebar-enabled" : "";
      const depthClass = this.layoutPrefs?.cardDepthEnabled
        ? ` home-card-depth${this.layoutPrefs.cardDepthPostersEnabled !== false ? " depth-posters" : ""}${this.layoutPrefs.cardDepthContinueWatchingEnabled !== false ? " depth-continue-watching" : ""}`
        : "";
      const classicGradientClass =
        this.layoutMode === "classic" && this.layoutPrefs?.classicFocusGradientEnabled ? " home-classic-focus-gradient" : "";
      const layoutClass = `home-layout-${this.layoutMode}${modernLandscapeLayoutClass}${modernHeroFullScreenBackdropClass}${modernSidebarLayoutClass}${depthClass}${classicGradientClass}`;
      const sizingStyle = [
        this.layoutMode === "modern" ? buildModernHomeSizingStyle(this.layoutPrefs) : "",
        `--card-depth-edge:${Number(this.layoutPrefs?.cardDepthEdgeStrength ?? 28) / 100}`,
        `--card-depth-sheen:${Number(this.layoutPrefs?.cardDepthSheenStrength ?? 10) / 100}`,
        `--card-depth-coverage:${Number(this.layoutPrefs?.cardDepthEdgeCoverage ?? 0)}%`
      ]
        .filter(Boolean)
        .join(";");
      const showPosterLabels = this.layoutPrefs?.posterLabelsEnabled !== false;
      const showCatalogAddonName = this.layoutPrefs?.catalogAddonNameEnabled !== false;
      const showCatalogTypeSuffix = this.layoutPrefs?.catalogTypeSuffixEnabled !== false;
      const pendingPosterFocusState = this.pendingPosterHoldFocus?.rowKey
        ? {
            rowKey: String(this.pendingPosterHoldFocus.rowKey),
            itemIndex: Number(this.pendingPosterHoldFocus.index || 0)
          }
        : null;
      const focusState =
        pendingPosterFocusState ||
        (!this.homeHoldFocusLocked && retainedFocusState && retainedFocusState.focusKind === "item" ? retainedFocusState : null);
      const continueWatchingEnabled = this.layoutPrefs?.continueWatchingEnabled !== false;
      const continueWatchingRows = continueWatchingEnabled
        ? partitionContinueWatchingRows(this.continueWatchingDisplay || [], this.layoutPrefs?.continueWatchingSortMode)
        : { main: [], upcoming: [] };
      this.continueWatchingRenderedItems = [...continueWatchingRows.main, ...continueWatchingRows.upcoming];
      const splitUpcomingEnabled = String(this.layoutPrefs?.continueWatchingSortMode || "") === "split_upcoming";
      const continueWatchingFocusIndex =
        String(focusState?.rowKey || "") === "continue_watching"
          ? Math.max(0, Number(focusState?.itemIndex || 0))
          : String(focusState?.rowKey || "") === "upcoming_section"
            ? continueWatchingRows.main.length + Math.max(0, Number(focusState?.itemIndex || 0))
            : -1;
      const continueWatchingRenderLimit = !continueWatchingEnabled
        ? 0
        : splitUpcomingEnabled
          ? continueWatchingRows.main.length
          : Math.min(
              Number(this.continueWatchingDisplay?.length || 0),
              Math.max(this.getContinueWatchingRenderBatchSize(), continueWatchingFocusIndex >= 0 ? continueWatchingFocusIndex + 1 : 0)
            );
      const focusedPosterFlowConfig = this.getFocusedPosterFlowConfig(this.layoutPrefs || {});
      const expandFocusedPoster =
        this.layoutMode === "modern" &&
        Boolean(focusedPosterFlowConfig.shouldExpand) &&
        Number(this.layoutPrefs?.focusedPosterBackdropExpandDelaySeconds ?? 3) <= 0 &&
        Boolean(focusState);
      const rowItemLimit = this.getRowItemLimit();
      const classicCatalogRowItemLimit =
        this.layoutMode === "classic" && !this.isPerformanceConstrained() && !this.isLegacyTvRuntime()
          ? HOME_MAX_ITEMS_PER_ROW_CLASSIC
          : rowItemLimit;
      const loadingRowItemCount = this.getLoadingRowItemCount();
      const continueWatchingLoadingCount = continueWatchingEnabled
        ? Math.min(
            Math.max(Number(this.continueWatching?.length || 0), Number(this.nextUpProgressCandidates?.length || 0)),
            loadingRowItemCount
          )
        : 0;
      const effectiveContinueWatchingLoadingCount =
        continueWatchingEnabled && this.continueWatchingLoading && continueWatchingLoadingCount === 0
          ? loadingRowItemCount
          : continueWatchingLoadingCount;
      const homeGridRowCount = this.layoutMode === "grid" ? getHomeGridRowCount(this.layoutPrefs) : HOME_GRID_DEFAULT_ROW_COUNT;
      const gridMaxDisplayItems =
        this.layoutMode === "grid" && !this.isPerformanceConstrained() && !this.isLegacyTvRuntime()
          ? HOME_GRID_SAFE_MAX_COLUMNS * homeGridRowCount
          : rowItemLimit;
      this.teardownGridStickyHeader();

      let mainContentMarkup = "";
      let modernLayoutPayload = null;

      if (this.isInitialHomeLoading) {
        mainContentMarkup = renderHomeLoadingState();
        this.catalogSeeAllMap = new Map();
      } else if (this.layoutMode === "modern") {
        modernLayoutPayload = renderModernHomeLayout({
          rows: this.rows,
          heroItem,
          heroCandidates: this.heroCandidates,
          continueWatchingItems: continueWatchingRows.main,
          upcomingItems: continueWatchingRows.upcoming,
          continueWatchingLoading: continueWatchingEnabled && Boolean(this.continueWatchingLoading),
          continueWatchingLoadingCount: effectiveContinueWatchingLoadingCount,
          continueWatchingRenderLimit,
          useEpisodeThumbnailsInCw: this.layoutPrefs?.useEpisodeThumbnailsInCw !== false,
          blurContinueWatchingNextUp: resolveContinueWatchingBlurNextUp(this.layoutPrefs),
          continueWatchingCardStyle: this.layoutPrefs?.continueWatchingCardStyle || "card",
          rowItemLimit,
          showHeroSection,
          showPosterLabels,
          showCatalogTypeSuffix,
          preferLandscapePosters: modernLandscapePostersEnabled,
          focusedRowKey: focusState?.rowKey || "",
          focusedItemIndex: Number.isFinite(focusState?.itemIndex) ? focusState.itemIndex : -1,
          expandFocusedPoster,
          buildModernHeroPresentation,
          renderHeroBackdropImage,
          renderContinueWatchingSection,
          createPosterCardMarkup,
          createSeeAllCardMarkup,
          formatCatalogRowTitle,
          shouldDeferRowImages: shouldDeferHomeRowImages,
          watchedTitleIds: this.watchedTitleIds,
          escapeHtml,
          escapeAttribute
        });
        this.catalogSeeAllMap = modernLayoutPayload.catalogSeeAllMap;
        mainContentMarkup = modernLayoutPayload.markup;
      } else {
        const continueHtml = continueWatchingEnabled
          ? renderContinueWatchingSection(continueWatchingRows.main, {
              rowKey: "continue_watching",
              loading: Boolean(this.continueWatchingLoading),
              loadingCount: effectiveContinueWatchingLoadingCount,
              itemLimit: continueWatchingRenderLimit,
              useEpisodeThumbnails: this.layoutPrefs?.useEpisodeThumbnailsInCw !== false,
              blurNextUp: resolveContinueWatchingBlurNextUp(this.layoutPrefs),
              cardStyle: this.layoutPrefs?.continueWatchingCardStyle || "card"
            })
          : "";
        const upcomingHtml = continueWatchingEnabled
          ? renderContinueWatchingSection(continueWatchingRows.upcoming, {
              rowKey: "upcoming_section",
              titleKey: "upcoming_section_title",
              title: "Upcoming",
              startIndex: continueWatchingRows.main.length,
              itemLimit: continueWatchingRows.upcoming.length,
              useEpisodeThumbnails: this.layoutPrefs?.useEpisodeThumbnailsInCw !== false,
              blurNextUp: resolveContinueWatchingBlurNextUp(this.layoutPrefs),
              cardStyle: this.layoutPrefs?.continueWatchingCardStyle || "card"
            })
          : "";
        const legacyRowsPayload = renderLegacyCatalogRowsMarkup(this.rows, {
          layoutMode: this.layoutMode,
          showPosterLabels,
          showCatalogAddonName,
          showCatalogTypeSuffix,
          focusedRowKey: focusState?.rowKey || "",
          focusedItemIndex: Number.isFinite(focusState?.itemIndex) ? focusState.itemIndex : -1,
          expandFocusedPoster: false,
          rowItemLimit: classicCatalogRowItemLimit,
          gridMaxDisplayItems,
          watchedTitleIds: this.watchedTitleIds
        });
        this.catalogSeeAllMap = legacyRowsPayload.catalogSeeAllMap;
        mainContentMarkup = `
            ${showHeroSection ? renderHeroMarkup(this.layoutMode, heroItem, this.heroCandidates) : ""}
            ${continueHtml}
            ${upcomingHtml}
            ${this.layoutMode === "grid" ? '<div class="home-grid-sticky" id="homeGridSticky"></div>' : ""}
            <section class="home-catalogs${this.layoutMode === "grid" ? " home-grid-catalogs" : ""}" id="homeCatalogRows">${legacyRowsPayload.markup}</section>
          `;
      }

      const routeEnterClass = (() => {
        if (!this.homeRouteEnterPending) return "";
        // Tizen fast path: skip the 240-350ms full-screen slide/fade while
        // posters + hero artwork mount. The compositor on Chromium 56-76
        // drops frames when animation and image decode overlap.
        try {
          if (typeof this.isPerformanceConstrained === "function" && this.isPerformanceConstrained()) return "";
          if (typeof this.isLegacyTvRuntime === "function" && this.isLegacyTvRuntime()) return "";
        } catch (_) {}
        const body = globalThis?.document?.body?.classList || null;
        const root = globalThis?.document?.documentElement?.classList || null;
        if (body?.contains("performance-constrained") || root?.contains("performance-constrained")) return "";
        if (body?.contains("legacy-tizen") || root?.contains("legacy-tizen")) return "";
        return this.pendingCollectionRouteReturnAnimation ? " nuvio-route-slide-enter" : " home-route-content-enter";
      })();
      this.pendingCollectionRouteReturnAnimation = false;
      // On Back, only keep the sidebar expanded if the restored focus actually
      // belonged to the sidebar.
      if (this.isRestoringFocusFromBack && retainedFocusState?.focusKind !== "sidebar") {
        this.sidebarExpanded = false;
      }
      const sidebarFocusLocked = Boolean(this.sidebarExpanded && retainedFocusState?.focusKind === "sidebar");

      const nextMarkup = `
          <div class="home-shell home-screen-shell ${layoutClass}"${sizingStyle ? ` style="${escapeAttribute(sizingStyle)}"` : ""}>
            ${renderRootSidebar({
              selectedRoute: "home",
              profile: this.sidebarProfile,
              layout: this.layoutPrefs,
              expanded: Boolean(this.sidebarExpanded),
              pillIconOnly: Boolean(this.pillIconOnly)
            })}

            <main class="home-main home-screen-main">
              <div class="home-route-content${routeEnterClass}">
                ${mainContentMarkup}
              </div>
            </main>
          </div>
          ${this.renderActiveHoldMenu()}
        `;

      // Returning to Home re-renders several times as cached rows, the background
      // refresh and the catalog rows each land. When a pass produces markup the
      // DOM already holds, writing it back costs a full parse, layout and paint of
      // every card for no visible change - and it destroys the live nodes, which
      // is what forces focus and scroll to be re-derived afterwards.
      //
      // Keep the last generated markup itself: exact equality is required because
      // addon/catalog text is part of this string and fixed-width hashes can
      // collide, which could otherwise preserve stale DOM.
      const shellMounted = Boolean(this.container.querySelector(".home-shell"));
      const markupUnchanged = shellMounted && this.renderedMarkup === nextMarkup;

      if (!markupUnchanged) {
        this.container.innerHTML = nextMarkup;
        this.renderedMarkup = nextMarkup;
      }

      if (this.layoutMode === "grid") {
        normalizeHomeGridCatalogSections(this.container, {
          maxDisplayItems: gridMaxDisplayItems,
          rowCount: homeGridRowCount
        });
      }

      if (modernLandscapePostersEnabled) {
        this.applyCachedModernLandscapePosterMetrics(this.container.querySelector(".home-screen-shell.home-modern-landscape-posters"));
      } else if (this.layoutMode === "modern") {
        this.applyCachedModernPortraitPosterMetrics(
          this.container.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)")
        );
      }
      bindRootSidebarEvents(this.container, {
        currentRoute: "home",
        onSelectedAction: () => this.closeSidebarToContent(),
        onExpandSidebar: () => this.openSidebar()
      });
      this.scheduleModernSidebarPillAutoCollapse();

      this.buildNavigationModel();
      this.bindHomeViewportEvents();
      this.setupContinueWatchingProgressiveRendering();
      if (this.layoutMode === "modern") {
        this.setupModernTrackScrollPagination();
      }
      const canAttemptRestore = Boolean(retainedFocusState);
      let restoredFocus = false;
      if (sidebarFocusLocked) {
        restoredFocus = this.restoreSidebarFocusState(retainedFocusState?.focusKind === "sidebar" ? retainedFocusState : null);
      }
      if (!sidebarFocusLocked && !this.homeHoldFocusLocked && !backFocusState && this.pendingPosterHoldFocus) {
        const pending = this.pendingPosterHoldFocus;
        const target = this.resolvePosterHoldRestoreTarget(pending);
        this.pendingPosterHoldFocus = null;
        if (target) {
          restoredFocus = true;
          this.setFocusedNode(target);
          this.lastMainFocus = target;
          this.rememberMainRowFocus(target);
          this.ensureTrackHorizontalVisibility(target);
          this.ensureMainVerticalVisibility(target);
        }
      }
      if (!restoredFocus && !sidebarFocusLocked && !this.homeHoldFocusLocked && this.isRestoringFocusFromBack && backFocusState) {
        restoredFocus = this.restoreFocusState(backFocusState);
        if (restoredFocus) {
          this.isRestoringFocusFromBack = false;
        }
      }
      if (
        !restoredFocus &&
        !sidebarFocusLocked &&
        !this.homeHoldFocusLocked &&
        !backFocusState &&
        Number.isFinite(this.pendingContinueWatchingFocusIndex)
      ) {
        const pendingRowKey = String(this.pendingContinueWatchingFocusRowKey || "continue_watching");
        const cards = this.getNavigationRowNodes(pendingRowKey);
        const target =
          cards[Math.max(0, Math.min(cards.length - 1, Number(this.pendingContinueWatchingFocusIndex || 0)))] ||
          cards[cards.length - 1] ||
          null;
        this.pendingContinueWatchingFocusIndex = null;
        this.pendingContinueWatchingFocusRowKey = null;
        if (target) {
          restoredFocus = true;
          this.setFocusedNode(target);
          this.lastMainFocus = target;
          this.rememberMainRowFocus(target);
          this.ensureTrackHorizontalVisibility(target);
          this.ensureMainVerticalVisibility(target);
        } else {
          ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
          const current = this.container.querySelector(".home-main .focusable.focused");
          if (current && this.isMainNode(current)) {
            this.lastMainFocus = current;
            this.scheduleModernHeroUpdate(current);
            this.scheduleFocusedPosterFlow(current);
          }
        }
      } else if (
        !sidebarFocusLocked &&
        !backFocusState &&
        !this.isRestoringFocusFromBack &&
        this.forceInitialContinueWatchingFocus &&
        this.layoutMode === "modern"
      ) {
        this.forceInitialContinueWatchingFocus = false;
        restoredFocus = this.focusInitialContinueWatchingCard();
        this.hasAppliedInitialContinueWatchingFocus = restoredFocus;
      } else if (!sidebarFocusLocked && canAttemptRestore && !this.homeHoldFocusLocked) {
        restoredFocus = this.restoreFocusState(retainedFocusState);
        if (restoredFocus) {
          this.isRestoringFocusFromBack = false;
        }
      }
      if (
        !restoredFocus &&
        !sidebarFocusLocked &&
        !this.homeHoldFocusLocked &&
        !backFocusState &&
        !this.isRestoringFocusFromBack &&
        shouldHoldHeroForContinueWatching &&
        this.layoutMode === "modern"
      ) {
        const currentFocusedNode = this.getCurrentFocusedNode();
        if (currentFocusedNode?.isConnected) {
          currentFocusedNode.classList.remove("focused");
        }
        this.setCurrentFocusedNode(null);
        this.lastMainFocus = null;
        this.hasAppliedInitialContinueWatchingFocus = this.focusInitialContinueWatchingCard();
      } else if (!restoredFocus && !sidebarFocusLocked && !this.homeHoldFocusLocked && !backFocusState) {
        ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
        const current = this.container.querySelector(".home-main .focusable.focused");
        if (current && this.isMainNode(current)) {
          this.lastMainFocus = current;
          this.scheduleModernHeroUpdate(current);
          this.scheduleFocusedPosterFlow(current);
        }
        this.isRestoringFocusFromBack = false;
      }
      if (!this.container?.querySelector(".home-poster-card.focused")) {
        this.clearFocusedPosterFlowState();
      }
      this.syncFocusedCollectionCardState();
      if (!this.layoutPrefs?.modernSidebar && !this.isSidebarFocusActive()) {
        this.setSidebarExpanded(false);
      }
      if (this.layoutMode === "grid") {
        this.setupGridStickyHeader(showHeroSection);
      }
      this.startHeroRotation();
      if (this.layoutMode === "modern" && heroItem && shouldEnrichModernHero(heroItem)) {
        void this.enrichCurrentHeroAsync(heroItem);
      }
      this.homeRouteEnterPending = false;
      this.renderedLayoutMode = this.layoutMode;
      this.ensureHomeTruncationObservers();
      this.scheduleHomeTruncationUpdate();
      this.scheduleHomeLazyImageHydration(null, { refreshIndex: true });
      this.scheduleReturnFocusRestore();
      const mountedRows = Number(this.navModel?.rows?.length || 0);
      const mountedCards = Number((this.navModel?.rows || []).reduce((total, rowNodes) => total + rowNodes.length, 0));
      logHomePerf("render", {
        ms: Number((homePerfNow() - renderStart).toFixed(2)),
        domWrite: !markupUnchanged,
        layoutMode: this.layoutMode,
        rows: Number(this.rows?.length || 0),
        mountedRows,
        mountedCards,
        continueWatching: Number(this.continueWatchingDisplay?.length || 0),
        focusables: Number(mountedCards + (this.navModel?.sidebar?.length || 0))
      });
    }
  };
}
