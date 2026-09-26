import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods03() {
  const {
    Router,
    Platform,
    getTvRuntimePerformanceProfile,
    isFastHorizontalNavigationEnabled,
    MODERN_HOME_CONSTANTS,
    CW_RENDER_BATCH_ITEMS_CONSTRAINED,
    CW_RENDER_BATCH_ITEMS_DEFAULT,
    CW_RENDER_BATCH_ITEMS_LEGACY_TV,
    HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS,
    HOME_BACKGROUND_RENDER_DELAY_MS,
    HOME_INITIAL_CATALOG_LOAD,
    HOME_LOADING_ROW_ITEMS_CONSTRAINED,
    HOME_LOADING_ROW_ITEMS_DEFAULT,
    HOME_LOADING_ROW_ITEMS_LEGACY_TV,
    HOME_MAX_ITEMS_PER_ROW_CONSTRAINED,
    HOME_MAX_ITEMS_PER_ROW_DEFAULT,
    HOME_MAX_ITEMS_PER_ROW_LEGACY_TV,
    parseCssPx
  } = internals;

  return {
    isScrollAnimationActive(container, axis = "x") {
      if (!container) {
        return false;
      }
      const map = this.scrollAnimations || null;
      const state = map?.get?.(container) || null;
      const key = axis === "y" ? "y" : "x";
      const springMap = this.springScrollAnimations || null;
      const springState = springMap?.get?.(container) || null;
      return Boolean(state?.[key] || springState?.[key]?.raf);
    },
    shouldSuspendModernViewportFocusSync() {
      if (this.layoutMode !== "modern") {
        return false;
      }
      if (this.modernCameraFollowTimer) {
        return true;
      }
      if (this.modernVerticalFastScrollState) {
        return true;
      }
      return (
        this.isScrollAnimationActive(this.modernCameraFollowLastVerticalContainer, "y") ||
        this.isScrollAnimationActive(this.modernCameraFollowLastHorizontalContainer, "x")
      );
    },
    isModernVerticalScrollActive() {
      if (this.layoutMode !== "modern") {
        return false;
      }
      if (this.modernVerticalFastScrollState || this._mainVertRaf) {
        return true;
      }
      return this.isScrollAnimationActive(this.modernCameraFollowLastVerticalContainer, "y");
    },
    isSidebarFocusActive() {
      return Boolean(this.container?.querySelector(".home-sidebar .focusable.focused, .modern-sidebar-panel .focusable.focused"));
    },
    getRowFocusInset() {
      if (this.layoutMode === "modern") {
        return MODERN_HOME_CONSTANTS.rowFocusInset;
      }
      if (this.layoutMode === "grid") {
        return 24;
      }
      return 32;
    },
    getTrackEdgePadding() {
      if (this.layoutMode === "modern") {
        return MODERN_HOME_CONSTANTS.trackEdgePadding;
      }
      if (this.layoutMode === "grid") {
        return 24;
      }
      return 48;
    },
    getCachedModernLandscapePosterMetrics(shell = null) {
      if (this.cachedModernLandscapePosterMetrics) {
        return this.cachedModernLandscapePosterMetrics;
      }
      const targetShell =
        shell instanceof HTMLElement ? shell : this.container?.querySelector(".home-screen-shell.home-modern-landscape-posters");
      if (!(targetShell instanceof HTMLElement)) {
        return null;
      }
      const shellStyles = getComputedStyle(targetShell);
      const posterWidth = parseCssPx(shellStyles.getPropertyValue("--home-landscape-poster-width"), 418);
      const posterHeight = parseCssPx(shellStyles.getPropertyValue("--home-landscape-poster-height"), Math.round(posterWidth / 1.77));
      this.cachedModernLandscapePosterMetrics = {
        width: posterWidth,
        height: posterHeight
      };
      return this.cachedModernLandscapePosterMetrics;
    },
    applyCachedModernLandscapePosterMetrics(shell = null) {
      const targetShell =
        shell instanceof HTMLElement ? shell : this.container?.querySelector(".home-screen-shell.home-modern-landscape-posters");
      if (!(targetShell instanceof HTMLElement)) {
        return;
      }
      const metrics = this.getCachedModernLandscapePosterMetrics(targetShell);
      if (!metrics) {
        return;
      }
      targetShell.style.setProperty("--home-landscape-poster-width", `${metrics.width}px`);
      targetShell.style.setProperty("--home-landscape-poster-height", `${metrics.height}px`);
    },
    getCachedModernPortraitPosterMetrics(shell = null) {
      if (this.cachedModernPortraitPosterMetrics) {
        return this.cachedModernPortraitPosterMetrics;
      }
      const targetShell =
        shell instanceof HTMLElement
          ? shell
          : this.container?.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)");
      if (!(targetShell instanceof HTMLElement)) {
        return null;
      }
      const shellStyles = getComputedStyle(targetShell);
      const posterWidth = parseCssPx(shellStyles.getPropertyValue("--home-modern-portrait-poster-width"), 228);
      const posterHeight = parseCssPx(shellStyles.getPropertyValue("--home-modern-portrait-poster-height"), Math.round(posterWidth * 1.5));
      this.cachedModernPortraitPosterMetrics = {
        width: posterWidth,
        height: posterHeight,
        expandedWidth: Math.round(posterHeight * (16 / 9))
      };
      return this.cachedModernPortraitPosterMetrics;
    },
    applyCachedModernPortraitPosterMetrics(shell = null) {
      const targetShell =
        shell instanceof HTMLElement
          ? shell
          : this.container?.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)");
      if (!(targetShell instanceof HTMLElement)) {
        return;
      }
      const metrics = this.getCachedModernPortraitPosterMetrics(targetShell);
      if (!metrics) {
        return;
      }
      targetShell.style.setProperty("--home-modern-portrait-poster-width", `${metrics.width}px`);
      targetShell.style.setProperty("--home-modern-portrait-poster-height", `${metrics.height}px`);
      targetShell.style.setProperty("--home-modern-portrait-expanded-width", `${metrics.expandedWidth}px`);
    },
    getHomeViewport() {
      return this.layoutMode === "modern"
        ? this.container?.querySelector(".home-modern-rows-viewport")
        : this.container?.querySelector(".home-main");
    },
    isLegacyTvRuntime() {
      return Boolean(getTvRuntimePerformanceProfile().isLegacyTvRuntime);
    },
    shouldSuppressAutomaticTrailerPlayback() {
      return this.isLegacyTvRuntime() && !Platform.isTizen();
    },
    getFocusedPosterTrailerDelayMs(trailerTarget = "hero_media") {
      const normalizedTrailerTarget = String(trailerTarget || "hero_media").toLowerCase();
      if (Platform.isTizen() && this.isPerformanceConstrained()) {
        // Hero-media playback is rendered outside the expanding card, so it
        // does not need the post-expansion settle time. Keep it for the
        // expanded-card target, where the trailer shares the card transition.
        return normalizedTrailerTarget === "expanded_card" ? 1600 : 0;
      }
      // The configured focused-poster delay already settles focus before this
      // flow starts. Android begins resolving its preview during that dwell, so
      // adding another delay after expansion only makes webOS visibly later.
      if (Platform.isWebOS()) {
        return 0;
      }
      if (this.isPerformanceConstrained()) {
        return 1400;
      }
      return 0;
    },
    isPerformanceConstrained() {
      return Boolean(
        getTvRuntimePerformanceProfile().isPerformanceConstrained ||
        globalThis.document?.body?.classList?.contains("performance-constrained")
      );
    },
    shouldUseImmediateFocusScroll() {
      return (
        this.isPerformanceConstrained() ||
        globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
        globalThis?.document?.documentElement?.classList?.contains("legacy-tizen")
      );
    },
    hasCollectionHomeRows() {
      return Array.isArray(this.collections) && this.collections.length > 0;
    },
    getRowItemLimit() {
      if (this.isLegacyTvRuntime()) {
        return HOME_MAX_ITEMS_PER_ROW_LEGACY_TV;
      }
      if (this.isPerformanceConstrained() && this.hasCollectionHomeRows()) {
        return this.collections.length > 2 ? HOME_MAX_ITEMS_PER_ROW_LEGACY_TV : HOME_MAX_ITEMS_PER_ROW_CONSTRAINED;
      }
      return this.isPerformanceConstrained() ? HOME_MAX_ITEMS_PER_ROW_CONSTRAINED : HOME_MAX_ITEMS_PER_ROW_DEFAULT;
    },
    getContinueWatchingRenderBatchSize() {
      if (this.isLegacyTvRuntime()) {
        return CW_RENDER_BATCH_ITEMS_LEGACY_TV;
      }
      if (this.isPerformanceConstrained()) {
        return CW_RENDER_BATCH_ITEMS_CONSTRAINED;
      }
      return CW_RENDER_BATCH_ITEMS_DEFAULT;
    },
    getLoadingRowItemCount() {
      if (this.isLegacyTvRuntime()) {
        return HOME_LOADING_ROW_ITEMS_LEGACY_TV;
      }
      if (this.isPerformanceConstrained() && this.hasCollectionHomeRows()) {
        return HOME_LOADING_ROW_ITEMS_LEGACY_TV;
      }
      return this.isPerformanceConstrained() ? HOME_LOADING_ROW_ITEMS_CONSTRAINED : HOME_LOADING_ROW_ITEMS_DEFAULT;
    },
    getInitialCatalogLoadCount() {
      if (this.isPerformanceConstrained()) {
        if (this.isLegacyTvRuntime()) {
          return 4;
        }
        return 5;
      }
      if (Platform.isWebOS() && this.hasCollectionHomeRows()) {
        return 4;
      }
      // Modern TV generations still need a bounded first batch. A large
      // account can expose many catalog rows; resolving all descriptors
      // together creates one large burst of Home DOM work.
      if (Platform.isWebOS() || Platform.isTizen()) {
        return Math.min(HOME_INITIAL_CATALOG_LOAD, 6);
      }
      return HOME_INITIAL_CATALOG_LOAD;
    },
    getDeferredCatalogBatchSize() {
      if (this.isPerformanceConstrained()) {
        return this.isLegacyTvRuntime() ? 2 : 4;
      }
      if (Platform.isWebOS() && this.hasCollectionHomeRows()) {
        return 4;
      }
      if (Platform.isWebOS() || Platform.isTizen()) {
        return 8;
      }
      return 0;
    },
    getScrollDuration(base) {
      const baseline = Number.isFinite(base) ? base : 150;
      if (this.isLegacyTvRuntime()) {
        return 0;
      }
      if (this.isPerformanceConstrained()) {
        return Math.min(baseline, 90);
      }
      return baseline + 40;
    },
    shouldUseImmediateHorizontalScrollForNode(node) {
      return Boolean(node?.matches?.(".home-continue-card.focusable") && this.isPerformanceConstrained());
    },
    shouldDeferContinueWatchingFocusEffects(node, direction = null, inputMeta = null) {
      void inputMeta;
      return Boolean((direction === "left" || direction === "right") && this.shouldUseImmediateHorizontalScrollForNode(node));
    },
    scheduleDeferredContinueWatchingFocusEffects(node) {
      if (this.deferredContinueWatchingFocusTimer) {
        clearTimeout(this.deferredContinueWatchingFocusTimer);
        this.deferredContinueWatchingFocusTimer = null;
      }
      const target = node instanceof HTMLElement ? node : null;
      if (!target) {
        return;
      }
      this.deferredContinueWatchingFocusTimer = setTimeout(
        () => {
          this.deferredContinueWatchingFocusTimer = null;
          if (Router.getCurrent() !== "home" || !target.isConnected || this.getCurrentFocusedNode() !== target) {
            return;
          }
          this.scheduleModernHeroUpdate(target);
        },
        this.isLegacyTvRuntime() ? 260 : 220
      );
    },
    getBackgroundRenderDelay() {
      if (this.isLegacyTvRuntime()) {
        const collectionCount = Array.isArray(this.collections) ? this.collections.length : 0;
        return collectionCount > 2 ? HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS + 140 : HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS;
      }
      if (this.isPerformanceConstrained()) {
        return HOME_BACKGROUND_RENDER_DELAY_MS;
      }
      return 0;
    },
    shouldProgressivelyRenderDeferredRows() {
      // Publish each deferred batch as soon as it resolves. Collections are part
      // of the visible Home order too; waiting for every catalog request makes
      // the rows below the first batch appear to be missing on webOS.
      return !this.isPerformanceConstrained();
    },
    getDirectionalRepeatThrottleMs(direction = null) {
      // Tizen fast path: the 48ms fast-horizontal gate passes nearly every
      // native hold-repeat (~50-100ms) and queues another full focus workload
      // before the previous press finished layout. Keep it for fast hardware.
      const legacyTizenTv =
        globalThis?.document?.body?.classList?.contains("legacy-tizen") ||
        globalThis?.document?.documentElement?.classList?.contains("legacy-tizen");
      if (
        (direction === "left" || direction === "right") &&
        isFastHorizontalNavigationEnabled() &&
        !this.isPerformanceConstrained() &&
        !this.isLegacyTvRuntime() &&
        !legacyTizenTv
      ) {
        // Match Android TV's fast-horizontal D-pad gate while preserving
        // the existing vertical and constrained-runtime throttles.
        return 48;
      }
      if (!Platform.isBrowser()) {
        return direction === "up" || direction === "down"
          ? MODERN_HOME_CONSTANTS.verticalKeyRepeatThrottleMs
          : MODERN_HOME_CONSTANTS.keyRepeatThrottleMs;
      }
      if (this.isLegacyTvRuntime()) {
        return Math.max(MODERN_HOME_CONSTANTS.keyRepeatThrottleMs, 120);
      }
      if (this.isPerformanceConstrained()) {
        return Math.max(MODERN_HOME_CONSTANTS.keyRepeatThrottleMs, 100);
      }
      return MODERN_HOME_CONSTANTS.keyRepeatThrottleMs;
    }
  };
}
