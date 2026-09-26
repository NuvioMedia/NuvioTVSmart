import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods15() {
  const {
    Router,
    MODERN_HOME_CONSTANTS,
    getLegacySidebarSelectedNode,
    getModernSidebarSelectedNode,
    setModernSidebarExpanded,
    setModernSidebarPillIconOnly,
    parseCssPx,
    MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS
  } = internals;

  return {
    scheduleFocusedPosterFlow(node, { deferUntilVerticalSettle = false } = {}) {
      if (this.layoutMode !== "modern") {
        return;
      }
      this.cancelFocusedPosterFlow();
      if (this.isCollectionFolderNode(node)) {
        this.clearFocusedPosterFlowState();
        this.collapseFocusedPoster(this.expandedPosterNode, {
          instant: true,
          preserveHeroMedia: this.shouldPreserveCollectionHeroMedia(node)
        });
        this.hydrateCollectionFocusGif(node, true);
        return;
      }
      const prefs = this.layoutPrefs || {};
      const { shouldExpand, shouldPreviewTrailer, trailerTarget } = this.getFocusedPosterFlowConfig(prefs);
      const shouldRun = Boolean(shouldExpand || shouldPreviewTrailer);
      if (!shouldRun) {
        this.clearFocusedPosterFlowState();
        this.collapseFocusedPoster();
        return;
      }
      if (!this.isModernPosterNode(node)) {
        this.clearFocusedPosterFlowState();
        this.collapseFocusedPoster();
        return;
      }
      if (this.expandedPosterNode && this.expandedPosterNode !== node) {
        this.collapseFocusedPoster(this.expandedPosterNode);
      }
      const flowKey = this.getFocusedPosterFlowKey(node);
      if (this.focusedPosterFlowState?.key && this.focusedPosterFlowState.key !== flowKey) {
        this.collapseFocusedPoster();
      }
      const defaultDelayMs = Math.max(0, Number(prefs.focusedPosterBackdropExpandDelaySeconds ?? 3)) * 1000;
      const existingState = this.focusedPosterFlowState;
      const canReuseExistingState = Boolean(flowKey && existingState?.key === flowKey);
      const now = Date.now();
      const delayMs = canReuseExistingState
        ? Math.max(0, Number(existingState.activated ? 0 : (existingState.activateAt || now) - now))
        : defaultDelayMs;
      const flowToken = Number(this.focusedPosterFlowToken || 0) + 1;
      this.focusedPosterFlowToken = flowToken;
      this.focusedPosterFlowState = {
        key: flowKey,
        activateAt: now + delayMs,
        activated: Boolean(canReuseExistingState && existingState.activated),
        token: flowToken
      };
      if (shouldPreviewTrailer) {
        const prefetchTrailer = () => {
          this.focusedPosterTrailerPrefetchTimer = null;
          if (
            Number(this.focusedPosterFlowToken || 0) !== flowToken ||
            this.getCurrentFocusedNode() !== node ||
            !node?.isConnected ||
            !node.classList.contains("focused")
          ) {
            return;
          }
          this.prefetchFocusedPosterTrailer(node);
        };
        const waitForVerticalSettleThenPrefetch = () => {
          this.focusedPosterTrailerPrefetchTimer = null;
          if (deferUntilVerticalSettle && this.isModernVerticalScrollActive()) {
            this.focusedPosterTrailerPrefetchTimer = setTimeout(
              waitForVerticalSettleThenPrefetch,
              MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs
            );
            return;
          }
          this.focusedPosterTrailerPrefetchTimer = setTimeout(prefetchTrailer, 150);
        };
        this.focusedPosterTrailerPrefetchTimer = setTimeout(
          deferUntilVerticalSettle ? waitForVerticalSettleThenPrefetch : prefetchTrailer,
          deferUntilVerticalSettle ? MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs : 150
        );
      }
      if (
        canReuseExistingState &&
        existingState.activated &&
        this.restorePersistentHeroTrailer(node, {
          shouldExpand,
          shouldPreviewTrailer,
          trailerTarget,
          flowKey
        })
      ) {
        return;
      }
      this.focusedPosterTimer = setTimeout(() => {
        if (this.focusedPosterFlowState?.key === flowKey && this.focusedPosterFlowState?.token === flowToken) {
          this.focusedPosterFlowState = {
            key: flowKey,
            activateAt: Date.now(),
            activated: true,
            token: flowToken
          };
        }
        if (Number(this.focusedPosterFlowToken || 0) !== flowToken) {
          return;
        }
        if (this.getCurrentFocusedNode() !== node || !node?.isConnected || !node.classList.contains("focused")) {
          return;
        }
        this.promotePosterCardAssets(node, { includeNeighbors: this.isPerformanceConstrained() });
        this.activateFocusedPosterFlow(node, flowToken).catch((error) => {
          console.warn("Focused poster flow failed", error);
        });
      }, delayMs);
    },
    resetFocusedPosterFlow(node) {
      if (this.layoutMode !== "modern") {
        return;
      }
      this.cancelFocusedPosterFlow();
      this.clearFocusedPosterFlowState();
      if (this.isModernPosterNode(node)) {
        this.collapseFocusedPoster(node, {
          preserveHeroMedia: this.shouldPreserveCollectionHeroMedia(node)
        });
        this.scheduleFocusedPosterFlow(node);
        return;
      }
      this.collapseFocusedPoster();
    },
    cancelModernSidebarPillAutoCollapse() {
      if (!this.modernSidebarPillAutoCollapseTimer) {
        return;
      }
      clearTimeout(this.modernSidebarPillAutoCollapseTimer);
      this.modernSidebarPillAutoCollapseTimer = null;
    },
    scheduleModernSidebarPillAutoCollapse({ restart = false } = {}) {
      const shouldSchedule = Boolean(
        this.layoutPrefs?.modernSidebar && !this.sidebarExpanded && !this.pillIconOnly && Router.getCurrent() === "home"
      );
      if (!shouldSchedule) {
        this.cancelModernSidebarPillAutoCollapse();
        return;
      }
      if (this.modernSidebarPillAutoCollapseTimer && !restart) {
        return;
      }
      this.cancelModernSidebarPillAutoCollapse();
      this.modernSidebarPillAutoCollapseTimer = setTimeout(() => {
        this.modernSidebarPillAutoCollapseTimer = null;
        const shell = this.container?.querySelector(".modern-sidebar-shell");
        if (
          Router.getCurrent() !== "home" ||
          !this.layoutPrefs?.modernSidebar ||
          this.sidebarExpanded ||
          !shell ||
          shell.classList.contains("keep-pill-expanded")
        ) {
          return;
        }
        this.pillIconOnly = true;
        setModernSidebarPillIconOnly(this.container, true);
      }, MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS);
    },
    openSidebar({ openedByBack = false } = {}) {
      this.sidebarOpenedByBack = Boolean(openedByBack);
      if (this.layoutPrefs?.modernSidebar) {
        this.cancelModernSidebarPillAutoCollapse();
        if (this.sidebarExpanded) {
          return true;
        }
        this.sidebarExpanded = true;
        setModernSidebarExpanded(this.container, true);
        const target = getModernSidebarSelectedNode(this.container);
        const current = this.getCurrentFocusedNode() || null;
        return this.focusNode(current, target) || true;
      }
      const target = getLegacySidebarSelectedNode(this.container);
      if (target) {
        this.setFocusedNode(target);
        this.setSidebarExpanded(true);
        return true;
      }
      return false;
    },
    closeSidebarToContent() {
      this.sidebarOpenedByBack = false;
      if (this.layoutPrefs?.modernSidebar) {
        if (!this.sidebarExpanded) {
          return false;
        }
        const target =
          this.lastMainFocus && this.isMainNode(this.lastMainFocus) ? this.lastMainFocus : this.navModel?.rows?.[0]?.[0] || null;
        this.sidebarExpanded = false;
        setModernSidebarExpanded(this.container, false);
        this.scheduleModernSidebarPillAutoCollapse({ restart: true });
        const current = this.getCurrentFocusedNode() || null;
        return this.focusNode(current, target, "right") || true;
      }
      const current = this.getCurrentFocusedNode() || this.container?.querySelector(".home-sidebar .focusable.focused") || null;
      const target = this.lastMainFocus && this.isMainNode(this.lastMainFocus) ? this.lastMainFocus : this.navModel?.rows?.[0]?.[0] || null;
      return this.focusNode(current, target, "right") || true;
    },
    onSidebarReselect() {
      const viewport = this.getHomeViewport();
      if (viewport) {
        viewport.scrollTop = 0;
      }
      this.lastMainFocus = null;
      this.closeSidebarToContent();
    },
    getMainFocusAnchor(node) {
      if (!node) {
        return null;
      }
      return node.closest(".home-row, .home-grid-section") || node.closest(".home-hero") || node;
    },
    getTrackViewportMetrics(track) {
      let leftPadding = this.getTrackEdgePadding();
      let rightPadding = leftPadding;
      const cachedLeft = Number.parseFloat(track?.dataset?.trackPadLeft || "");
      const cachedRight = Number.parseFloat(track?.dataset?.trackPadRight || "");
      if (Number.isFinite(cachedLeft) && cachedLeft >= 0) {
        leftPadding = cachedLeft;
      }
      if (Number.isFinite(cachedRight) && cachedRight >= 0) {
        rightPadding = cachedRight;
      }
      if ((!Number.isFinite(cachedLeft) || !Number.isFinite(cachedRight)) && typeof window !== "undefined" && window.getComputedStyle) {
        const computed = window.getComputedStyle(track);
        const paddingLeft = Number.parseFloat(computed?.paddingLeft || "");
        const paddingRight = Number.parseFloat(computed?.paddingRight || "");
        if (Number.isFinite(paddingLeft) && paddingLeft >= 0) {
          leftPadding = paddingLeft;
          track.dataset.trackPadLeft = String(paddingLeft);
        }
        if (Number.isFinite(paddingRight) && paddingRight >= 0) {
          rightPadding = paddingRight;
          track.dataset.trackPadRight = String(paddingRight);
        }
      }
      const safeRightPadding = Math.min(rightPadding, Math.max(24, leftPadding));
      const visibleLeft = track.scrollLeft + leftPadding;
      const visibleRight = track.scrollLeft + track.clientWidth - safeRightPadding;
      return {
        leftPadding,
        safeRightPadding,
        visibleLeft,
        visibleRight,
        visibleCenter: visibleLeft + Math.max(0, (visibleRight - visibleLeft) / 2)
      };
    },
    getExpandedPosterScrollAdjustments(current, target, direction = null) {
      const expanded = this.layoutMode === "modern" ? this.expandedPosterNode : null;
      if (!expanded || expanded !== current || expanded === target || !expanded.classList.contains("is-expanded")) {
        return { horizontal: 0, vertical: 0 };
      }
      const targetShell = this.container?.querySelector(".home-screen-shell");
      if (!(targetShell instanceof HTMLElement)) {
        return { horizontal: 0, vertical: 0 };
      }
      const shellStyles = getComputedStyle(targetShell);
      const expandedFrame = expanded.querySelector(".home-poster-frame");
      const isLandscape = expanded.classList.contains("is-landscape");
      const collapsedHeight = isLandscape
        ? parseCssPx(shellStyles.getPropertyValue("--home-landscape-poster-height"), expandedFrame?.offsetHeight || 0)
        : parseCssPx(shellStyles.getPropertyValue("--home-modern-portrait-poster-height"), expandedFrame?.offsetHeight || 0);

      const vertical = direction === "down" && isLandscape ? Math.max(0, Number(expandedFrame?.offsetHeight || 0) - collapsedHeight) : 0;

      return { horizontal: 0, vertical };
    },
    getModernVerticalScrollOffset(main) {
      return Math.max(10, Math.min(18, Math.round(Number(main?.clientHeight || 0) * 0.025)));
    },
    getModernTrackAlignedScrollTarget(target, layoutAdjustment = 0) {
      const track = target?.closest?.(".home-track, .home-grid-track");
      if (!track) {
        return null;
      }
      // Tizen fast path: getComputedStyle forces a full style recalc on every
      // D-pad press. Cache the padding on the track (same pattern as
      // getTrackViewportMetrics); tracks are rebuilt on render so the cache
      // cannot go stale within a DOM generation.
      let leftPad = Number.parseFloat(track?.dataset?.trackPadAlignLeft || "");
      if (!Number.isFinite(leftPad) || leftPad < 0) {
        const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(track) : null;
        leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
        track.dataset.trackPadAlignLeft = String(leftPad);
      }
      const trackRect = track.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetLeft = targetRect.left - trackRect.left + Number(track.scrollLeft || 0) - Number(layoutAdjustment || 0);
      const maxScrollLeft = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
      return {
        container: track,
        value: Math.max(0, Math.min(maxScrollLeft, targetLeft - leftPad))
      };
    }
  };
}
