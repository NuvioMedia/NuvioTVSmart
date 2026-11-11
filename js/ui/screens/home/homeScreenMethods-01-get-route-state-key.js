import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods01() {
  const {
    Router,
    getLegacySidebarNodes,
    getLegacySidebarSelectedNode,
    getModernSidebarNodes,
    getModernSidebarSelectedNode,
    HOME_RETURN_FOCUS_STATE_KEY,
    findHomeFocusIdentityMatch,
    getHomeFocusIdentity
  } = internals;

  return {
    getRouteStateKey() {
      return "home";
    },
    captureRouteState() {
      return this.captureCurrentContentFocusState() || this.captureCurrentFocusState();
    },
    captureCurrentFocusState() {
      const layoutMode = String(this.renderedLayoutMode || this.layoutMode || "").toLowerCase();
      if (!this.container || !layoutMode) {
        return null;
      }
      let focused = this.getCurrentFocusedNode() || this.container.querySelector(".focusable.focused") || this.lastMainFocus || null;
      if (focused && !focused.isConnected) {
        return null;
      }
      if (focused?.closest?.(".home-sidebar, .modern-sidebar-panel")) {
        return {
          layoutMode,
          focusKind: "sidebar",
          sidebarExpanded: Boolean(this.sidebarExpanded),
          sidebarIndex: Number(focused?.dataset?.navIndex || 0),
          sidebarAction: String(focused?.dataset?.action || "")
        };
      }
      const viewport =
        layoutMode === "modern" ? this.container.querySelector(".home-modern-rows-viewport") : this.container.querySelector(".home-main");
      if (!viewport) {
        return null;
      }

      focused = this.container.querySelector(".home-main .focusable.focused") || this.lastMainFocus || null;
      if (!focused) {
        return null;
      }
      const trackStates = Object.fromEntries(
        this.getNavigationTrackNodes()
          .map((track) => [String(track.dataset.trackRowKey || ""), track.scrollLeft])
          .filter(([key]) => key)
      );
      const section = focused?.closest?.("[data-row-key]") || null;
      const rowKey = String(section?.dataset?.rowKey || "");
      let itemIndex = -1;

      if (focused) {
        const track = focused.closest(".home-track, .home-grid-track");
        if (track) {
          itemIndex = Array.from(track.querySelectorAll(".home-content-card.focusable")).indexOf(focused);
        }
      }

      const focusKind = focused?.classList?.contains("home-hero-card")
        ? "hero"
        : focused?.dataset?.action === "resumeProgress"
          ? "continue"
          : focused?.dataset?.action === "openCatalogSeeAll"
            ? "seeAll"
            : "item";

      return {
        layoutMode,
        mainScrollTop: viewport.scrollTop,
        rowKey,
        itemIndex,
        itemIdentity: getHomeFocusIdentity(focused),
        focusKind,
        trackStates
      };
    },
    captureCurrentContentFocusState() {
      const focused = this.container?.querySelector(".home-main .focusable.focused") || this.lastMainFocus || null;
      if (!focused || !focused.isConnected || !this.isMainNode(focused)) {
        return null;
      }
      return this.captureFocusStateForNode(focused);
    },
    persistCurrentFocusState() {
      const currentState = this.captureCurrentFocusState();
      if (!currentState?.layoutMode) {
        return;
      }
      this.savedFocusStates = {
        ...(this.savedFocusStates || {}),
        [currentState.layoutMode]: currentState
      };
    },
    captureFocusStateForNode(node) {
      const layoutMode = String(this.renderedLayoutMode || this.layoutMode || "").toLowerCase();
      if (!this.container || !layoutMode || !(node instanceof HTMLElement) || !this.container.contains(node)) {
        return null;
      }
      const viewport =
        layoutMode === "modern" ? this.container.querySelector(".home-modern-rows-viewport") : this.container.querySelector(".home-main");
      if (!viewport) {
        return null;
      }

      const trackStates = Object.fromEntries(
        this.getNavigationTrackNodes()
          .map((track) => [String(track.dataset.trackRowKey || ""), track.scrollLeft])
          .filter(([key]) => key)
      );
      const section = node.closest("[data-row-key]") || null;
      const track = node.closest(".home-track, .home-grid-track");
      const itemIndex = track ? Array.from(track.querySelectorAll(".home-content-card.focusable")).indexOf(node) : -1;
      const focusKind = node.classList.contains("home-hero-card")
        ? "hero"
        : node.dataset?.action === "resumeProgress"
          ? "continue"
          : node.dataset?.action === "openCatalogSeeAll"
            ? "seeAll"
            : "item";

      return {
        layoutMode,
        mainScrollTop: viewport.scrollTop,
        rowKey: String(section?.dataset?.rowKey || ""),
        itemIndex,
        itemIdentity: getHomeFocusIdentity(node),
        focusKind,
        trackStates
      };
    },
    rememberReturnFocusForNode(node) {
      const state = this.captureFocusStateForNode(node);
      if (!state?.layoutMode) {
        this.persistCurrentFocusState();
        return;
      }
      this.savedFocusStates = {
        ...(this.savedFocusStates || {}),
        [state.layoutMode]: state
      };
      this.pendingBackFocusState = state;
      try {
        globalThis.sessionStorage?.setItem?.(HOME_RETURN_FOCUS_STATE_KEY, JSON.stringify(state));
      } catch (_) {}
    },
    rememberContinueWatchingReturnFocus(index = null, rowKey = "") {
      const currentCard = this.getCurrentFocusedNode()?.closest?.(".home-continue-card") || null;
      const targetRowKey = String(rowKey || this.getNodeRowKey(currentCard) || "continue_watching").trim() || "continue_watching";
      const cards = this.getNavigationRowNodes(targetRowKey);
      const preferredIndex = Number(index);
      const target = Number.isFinite(preferredIndex) ? cards[Math.max(0, Math.min(cards.length - 1, preferredIndex))] || null : currentCard;
      if (target instanceof HTMLElement) {
        this.rememberReturnFocusForNode(target);
        return;
      }
      this.persistCurrentFocusState();
    },
    readStoredReturnFocusState() {
      try {
        const navigationEntry = globalThis.performance?.getEntriesByType?.("navigation")?.[0] || null;
        if (navigationEntry?.type === "reload") {
          globalThis.sessionStorage?.removeItem?.(HOME_RETURN_FOCUS_STATE_KEY);
          return null;
        }
        const raw = globalThis.sessionStorage?.getItem?.(HOME_RETURN_FOCUS_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed?.layoutMode ? parsed : null;
      } catch (_) {
        return null;
      }
    },
    clearStoredReturnFocusState() {
      this.pendingBackFocusState = null;
      this.homeReturnFocusRestoreToken = Number(this.homeReturnFocusRestoreToken || 0) + 1;
      try {
        globalThis.sessionStorage?.removeItem?.(HOME_RETURN_FOCUS_STATE_KEY);
      } catch (_) {}
    },
    applyReturnFocusStateNow(focusState) {
      if (!focusState?.layoutMode || focusState.layoutMode !== this.layoutMode || !this.container) {
        return false;
      }
      const viewport = this.getHomeViewport();
      if (!viewport) {
        return false;
      }

      this.prepareHomeRowsForRestore(focusState);
      Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
        const track = this.getNavigationTrackNodes().find((node) => String(node.dataset.trackRowKey || "") === String(rowKey || ""));
        if (track) {
          track.scrollLeft = Number(scrollLeft || 0);
        }
      });

      const nodes = this.getNavigationRowNodes(focusState.rowKey);
      const target = findHomeFocusIdentityMatch(nodes, focusState.itemIdentity) || nodes[focusState.itemIndex] || nodes[0] || null;
      if (!target) {
        return false;
      }

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));
      this.setFocusedNode(target, { suppressDelegatedFocus: true });
      viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      this.syncFocusedCollectionCardState();
      this.scheduleModernHeroUpdate(target, { immediate: true });
      this.scheduleFocusedPosterFlow(target);
      return true;
    },
    scheduleReturnFocusRestore() {
      const focusState = this.pendingBackFocusState || (this.isRestoringFocusFromBack ? this.readStoredReturnFocusState() : null);
      if (!focusState?.layoutMode) {
        return;
      }
      const restoreToken = (this.homeReturnFocusRestoreToken = Number(this.homeReturnFocusRestoreToken || 0) + 1);
      let completed = false;
      const restore = () => {
        if (
          completed ||
          restoreToken !== this.homeReturnFocusRestoreToken ||
          this.hasUserInteractedSinceHomePaint ||
          Router.getCurrent() !== "home"
        ) {
          return;
        }
        if (this.applyReturnFocusStateNow(focusState)) {
          completed = true;
          this.clearStoredReturnFocusState();
        }
      };
      requestAnimationFrame(() => {
        restore();
        setTimeout(restore, 180);
      });
    },
    restoreFocusState(state = null) {
      if (this.homeHoldFocusLocked) {
        return false;
      }
      const focusState = state?.layoutMode === this.layoutMode ? state : this.savedFocusStates?.[this.layoutMode] || null;
      // The restored card and the saved row offsets need real boxes.
      this.prepareHomeRowsForRestore(focusState);
      if (!focusState) {
        return false;
      }

      if (this.layoutMode === "modern") {
        if (focusState.focusKind === "sidebar") {
          return this.restoreSidebarFocusState(focusState);
        }
        return this.restoreModernFocusState(focusState);
      }

      if (focusState.focusKind === "sidebar") {
        return this.restoreSidebarFocusState(focusState);
      }
      return this.restoreLegacyFocusState(focusState);
    },
    restoreSidebarFocusState(focusState) {
      if (this.homeHoldFocusLocked || !focusState || !this.container) {
        return false;
      }

      const nodes = this.layoutPrefs?.modernSidebar ? getModernSidebarNodes(this.container) : getLegacySidebarNodes(this.container);
      if (!nodes.length) {
        return false;
      }

      let target = this.layoutPrefs?.modernSidebar
        ? getModernSidebarSelectedNode(this.container)
        : getLegacySidebarSelectedNode(this.container);

      if (!target && focusState.sidebarAction) {
        target = nodes.find((node) => String(node.dataset?.action || "") === String(focusState.sidebarAction || "")) || null;
      }

      const preferredIndex = Number(focusState.sidebarIndex);
      target =
        target ||
        (Number.isFinite(preferredIndex) ? nodes[Math.max(0, Math.min(nodes.length - 1, preferredIndex))] || null : null) ||
        nodes[0] ||
        null;
      if (!target) {
        return false;
      }

      this.setSidebarExpanded(true);
      this.setFocusedNode(target);
      return true;
    }
  };
}
