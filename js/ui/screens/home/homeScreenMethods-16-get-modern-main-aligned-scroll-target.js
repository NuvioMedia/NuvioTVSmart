import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods16() {
  const { Router, MODERN_HOME_CONSTANTS, HOME_PERF_DEBUG, homePerfNow, logHomePerf } = internals;

  return {
    getModernMainAlignedScrollTarget(target, direction = null, current = null, layoutAdjustment = 0) {
      const main = this.container?.querySelector(".home-modern-rows-viewport");
      if (!main || !target || !this.container?.contains(target)) {
        return null;
      }
      const anchor = this.getMainFocusAnchor(target);
      const mainRect = main.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const inset = this.getRowFocusInset();
      const visibleTop = mainRect.top + inset;
      const visibleBottom = mainRect.bottom - 24;
      const anchorTop = anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
      const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
      const targetTop = targetRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
      const adjustedTop = mainRect.top + anchorTop - main.scrollTop;
      const adjustedBottom = mainRect.top + anchorBottom - main.scrollTop;
      const currentAnchor = this.getMainFocusAnchor(current);
      const sameAnchor = Boolean(currentAnchor && currentAnchor === anchor);
      const isHorizontalMove = direction === "left" || direction === "right";
      const isVerticalMove = direction === "up" || direction === "down";
      const isEnteringMainFromSidebar = direction === "right" && current && !this.isMainNode(current);

      if (isHorizontalMove && sameAnchor) {
        return null;
      }

      let nextValue = null;
      if (isVerticalMove || isEnteringMainFromSidebar) {
        nextValue = targetTop - inset;
        // Android TV brings the whole row into view, title included. Aligning
        // only the card left the row head above the viewport edge: with the
        // 28px title gap the title lost its top 19px.
        const rowHead = target.closest?.(".home-row")?.querySelector?.(".home-row-head");
        if (rowHead) {
          const headTop = rowHead.getBoundingClientRect().top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
          nextValue = Math.min(nextValue, headTop - 8);
        }
      } else if (adjustedTop < visibleTop) {
        nextValue = anchorTop - inset;
      } else if (adjustedBottom > visibleBottom) {
        nextValue = anchorBottom - main.clientHeight + 24;
      } else {
        nextValue = anchorTop - Math.max(0, (main.clientHeight - anchor.offsetHeight) / 2);
      }

      const maxScrollTop = Math.max(0, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
      return {
        container: main,
        value: Math.max(0, Math.min(maxScrollTop, nextValue))
      };
    },
    getModernMainSafetyScrollTarget(target, layoutAdjustment = 0) {
      const main = this.container?.querySelector(".home-modern-rows-viewport");
      if (!main || !target || !this.container?.contains(target)) {
        return null;
      }
      const anchor = this.getMainFocusAnchor(target);
      const mainRect = main.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const inset = this.getRowFocusInset();
      const visibleTop = mainRect.top + inset;
      const visibleBottom = mainRect.bottom - 24;
      const anchorTop = anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
      const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
      const adjustedTop = mainRect.top + anchorTop - main.scrollTop;
      const adjustedBottom = mainRect.top + anchorBottom - main.scrollTop;
      const minVisible = Math.max(32, Math.min(72, Math.round(Number(anchor.offsetHeight || 0) * 0.22)));
      let nextValue = null;
      if (adjustedBottom <= visibleTop + minVisible) {
        nextValue = anchorBottom - inset - minVisible;
      } else if (adjustedTop >= visibleBottom - minVisible) {
        nextValue = anchorTop - main.clientHeight + 24 + minVisible;
      }
      if (!Number.isFinite(nextValue)) {
        return null;
      }
      const maxScrollTop = Math.max(0, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
      return {
        container: main,
        value: Math.max(0, Math.min(maxScrollTop, nextValue))
      };
    },
    applyModernCameraFollowTargets(horizontal = null, vertical = null) {
      if (horizontal?.container?.isConnected) {
        if (Math.abs(Number(horizontal.container.scrollLeft || 0) - Number(horizontal.value || 0)) > 1) {
          this.animateScroll(horizontal.container, "x", horizontal.value, MODERN_HOME_CONSTANTS.cameraFollowDurationXMs, {
            mode: "spring"
          });
        }
        this.modernCameraFollowLastHorizontalContainer = horizontal.container;
      }
      if (vertical?.container?.isConnected) {
        if (Math.abs(Number(vertical.container.scrollTop || 0) - Number(vertical.value || 0)) > 1) {
          this.animateScroll(vertical.container, "y", vertical.value, MODERN_HOME_CONSTANTS.cameraFollowDurationYMs, { mode: "spring" });
        }
        this.modernCameraFollowLastVerticalContainer = vertical.container;
      }
    },
    flushModernCameraFollow() {
      const state = this.modernCameraFollowState || null;
      this.modernCameraFollowTimer = null;
      this.modernCameraFollowState = null;
      if (!state || Router.getCurrent() !== "home" || this.layoutMode !== "modern") {
        return;
      }
      if (state.deferred) {
        const horizontal = this.getModernTrackAlignedScrollTarget(state.target, state.horizontalAdjustment);
        const vertical = this.getModernMainAlignedScrollTarget(state.target, state.direction, state.current, state.verticalAdjustment);
        const hasHorizontal = Boolean(
          horizontal?.container && Math.abs(Number(horizontal.container.scrollLeft || 0) - Number(horizontal.value || 0)) > 1
        );
        const hasVertical = Boolean(
          vertical?.container && Math.abs(Number(vertical.container.scrollTop || 0) - Number(vertical.value || 0)) > 1
        );
        this.modernCameraFollowLastHorizontalContainer = horizontal?.container || this.modernCameraFollowLastHorizontalContainer;
        this.modernCameraFollowLastVerticalContainer = vertical?.container || this.modernCameraFollowLastVerticalContainer;
        this.applyModernCameraFollowTargets(hasHorizontal ? horizontal : null, hasVertical ? vertical : null);
      } else {
        this.applyModernCameraFollowTargets(state.horizontal, state.vertical);
      }
    },
    scheduleModernCameraFollow(target, direction = null, current = null, layoutAdjustment = {}, inputMeta = {}) {
      if (!this.shouldUseDelayedModernCameraFollow(target, direction)) {
        return false;
      }
      this.cancelModernCameraFollow({ stopAnimations: true });
      const isVerticalMove = direction === "up" || direction === "down";
      const shouldFollowVerticalHoldImmediately = isVerticalMove && Boolean(inputMeta?.repeat);
      const horizontalAdjustment = Number(layoutAdjustment?.horizontal || 0);
      const verticalAdjustment = Number(layoutAdjustment?.vertical || 0);

      if (shouldFollowVerticalHoldImmediately) {
        const horizontal = this.getModernTrackAlignedScrollTarget(target, horizontalAdjustment);
        const vertical = this.getModernMainAlignedScrollTarget(target, direction, current, verticalAdjustment);
        this.applyModernCameraFollowTargets(horizontal, vertical);
        return true;
      }

      this.modernCameraFollowState = {
        deferred: true,
        target,
        direction,
        current,
        horizontalAdjustment,
        verticalAdjustment
      };
      this.modernCameraFollowTimer = setTimeout(() => {
        this.flushModernCameraFollow();
      }, MODERN_HOME_CONSTANTS.cameraFollowDelayMs);
      return true;
    },
    isNodeWithinMainViewport(node) {
      const main = this.getHomeViewport();
      if (!main || !node || !this.container?.contains(node)) {
        return false;
      }
      const anchor = this.getMainFocusAnchor(node);
      const mainRect = main.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const inset = this.getRowFocusInset();
      const visibleTop = mainRect.top + inset;
      const visibleBottom = mainRect.bottom - 24;
      return anchorRect.bottom > visibleTop && anchorRect.top < visibleBottom;
    },
    resolveBestVisibleNodeForRow(rowNodes = []) {
      if (!Array.isArray(rowNodes) || !rowNodes.length) {
        return null;
      }
      const preferred = this.resolvePreferredNodeForRow(rowNodes);
      const track = rowNodes[0]?.closest?.(".home-track, .home-grid-track");
      if (!track) {
        return preferred || rowNodes[0] || null;
      }
      const metrics = this.getTrackViewportMetrics(track);
      const visibleNodes = rowNodes
        .map((node) => {
          const left = Number(node.offsetLeft || 0);
          const right = left + Number(node.offsetWidth || 0);
          return {
            node,
            overlap: Math.min(right, metrics.visibleRight) - Math.max(left, metrics.visibleLeft),
            distance: Math.abs((left + right) / 2 - metrics.visibleCenter)
          };
        })
        .filter((entry) => entry.overlap > 0)
        .sort((left, right) => {
          if (right.overlap !== left.overlap) {
            return right.overlap - left.overlap;
          }
          return left.distance - right.distance;
        });
      if (preferred && visibleNodes.some((entry) => entry.node === preferred)) {
        return preferred;
      }
      return visibleNodes[0]?.node || preferred || rowNodes[0] || null;
    },
    syncMainFocusToViewport({ suppressFlows = false } = {}) {
      if (!this.container || !this.navModel?.rows?.length) {
        return null;
      }
      const current = this.getCurrentFocusedNode();
      if (current?.closest?.(".home-sidebar, .modern-sidebar-panel")) {
        return current;
      }
      if (this.isSidebarFocusActive()) {
        return this.container.querySelector(".home-sidebar .focusable.focused, .modern-sidebar-panel .focusable.focused");
      }
      const currentMain =
        current && this.isMainNode(current) ? current : this.container.querySelector(".home-main .focusable.focused") || null;
      if (currentMain && this.isMainNode(currentMain) && this.isNodeWithinMainViewport(currentMain)) {
        return currentMain;
      }
      const main = this.getHomeViewport();
      if (!main) {
        return currentMain || null;
      }
      const mainRect = main.getBoundingClientRect();
      const inset = this.getRowFocusInset();
      const visibleTop = mainRect.top + inset;
      const visibleBottom = mainRect.bottom - 24;
      const visibleCenter = visibleTop + Math.max(0, (visibleBottom - visibleTop) / 2);
      const bestRow = this.navModel.rows
        .map((rowNodes) => {
          const anchor = this.getMainFocusAnchor(rowNodes[0]);
          if (!anchor) {
            return null;
          }
          const rect = anchor.getBoundingClientRect();
          const overlap = Math.min(rect.bottom, visibleBottom) - Math.max(rect.top, visibleTop);
          if (overlap <= 0) {
            return null;
          }
          return {
            rowNodes,
            overlap,
            distance: Math.abs((rect.top + rect.bottom) / 2 - visibleCenter)
          };
        })
        .filter(Boolean)
        .sort((left, right) => {
          if (right.overlap !== left.overlap) {
            return right.overlap - left.overlap;
          }
          return left.distance - right.distance;
        })[0];
      const target = this.resolveBestVisibleNodeForRow(bestRow?.rowNodes || []);
      if (!(target instanceof HTMLElement)) {
        return currentMain || null;
      }
      if (currentMain !== target) {
        const syncStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
        if (currentMain && currentMain.isConnected) {
          currentMain.classList.remove("focused");
        }
        this.setFocusedNode(target, { suppressDelegatedFocus: true });
        logHomePerf("syncMainFocusToViewport", {
          ms: Number((homePerfNow() - syncStart).toFixed(2)),
          rowKey: String(this.getNodeRowKey(target) || ""),
          itemIndex: Number(target.dataset?.navCol || 0)
        });
      }
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      if (!suppressFlows) {
        this.scheduleModernHeroUpdate(target);
        this.scheduleFocusedPosterFlow(target);
      }
      return target;
    },
    scheduleHomeViewportFocusSync() {
      // If the sidebar is active, a home refresh must not promote a card into focus.
      if (this.isSidebarFocusActive()) {
        return;
      }
      if (this.homeViewportFocusSyncTimer) {
        clearTimeout(this.homeViewportFocusSyncTimer);
      }
      this.homeViewportFocusSyncTimer = setTimeout(() => {
        this.homeViewportFocusSyncTimer = null;
        if (Router.getCurrent() !== "home") {
          return;
        }
        this.syncMainFocusToViewport({ suppressFlows: true });
      }, 120);
    }
  };
}
