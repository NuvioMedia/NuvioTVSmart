/* eslint-disable no-unused-vars */
import * as internals from "./discoverScreen.js";

export function createDiscoverScreenMethods04() {
  const {
    MODERN_HOME_CONSTANTS,
    focusWithoutAutoScroll,
    setLegacySidebarExpanded,
    groupNodesByOffsetTop,
    setContainerScrollTop,
    scrollNodeIntoContainerView
  } = internals;

  return {
    restoreFocusedCard({ scrollMode = "center" } = {}) {
      this.restoreScrollState();
      const target =
        (this.lastFocusedKey
          ? this.container?.querySelector(
              `.seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`
            )
          : null) ||
        (this.lastFocusedDiscoverItemId
          ? this.container?.querySelector(
              `.seeall-card.focusable[data-item-id="${String(this.lastFocusedDiscoverItemId).replace(/["\\]/g, "\\$&")}"]`
            )
          : null) ||
        this.container?.querySelector(".seeall-card.focusable") ||
        (this.lastFocusedAction
          ? this.container?.querySelector(
              `.discover-filter.focusable[data-action="${String(this.lastFocusedAction).replace(/["\\]/g, "\\$&")}"]`
            )
          : null) ||
        this.container?.querySelector(".discover-filter.focusable") ||
        null;
      if (!target) {
        return;
      }
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      if (target.classList.contains("discover-filter")) {
        focusWithoutAutoScroll(target);
        this.scrollContentToTop();
        return;
      }
      focusWithoutAutoScroll(target);
      this.rememberRowFocus(target);
      if (scrollMode !== "none") {
        scrollNodeIntoContainerView(target, this.getContentScroller(), {
          center: scrollMode === "center",
          padding: 20
        });
      }
      this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
    },
    syncOpenPickerScroll() {
      const menu = this.container?.querySelector(".library-picker.open .library-picker-menu");
      const option = menu?.querySelector(".library-picker-option.focused");
      if (menu && option) {
        option.scrollIntoView({ block: "nearest" });
      }
    },
    buildNavigationModel() {
      const cards = Array.from(this.container?.querySelectorAll(".discover-grid .seeall-card.focusable") || []);
      const rows = groupNodesByOffsetTop(cards);
      rows.forEach((rowNodes, rowIndex) => {
        rowNodes.forEach((node, colIndex) => {
          node.dataset.navRow = String(rowIndex);
          node.dataset.navCol = String(colIndex);
        });
      });
      this.navModel = { rows };
    },
    rememberRowFocus(node) {
      if (!node?.dataset) return;
      const row = Number(node.dataset.navRow || -1);
      const col = Number(node.dataset.navCol || 0);
      if (row < 0) return;
      this.rowFocusedIndexByRow = {
        ...(this.rowFocusedIndexByRow || {}),
        [row]: Math.max(0, col)
      };
    },
    resolvePreferredNodeForRow(rowNodes = [], preferredCol = undefined) {
      if (!Array.isArray(rowNodes) || !rowNodes.length) {
        return null;
      }
      const rowIndex = Number(rowNodes[0]?.dataset?.navRow || -1);
      const storedIndex = rowIndex >= 0 ? Number(this.rowFocusedIndexByRow?.[rowIndex]) : Number.NaN;
      const currentCol = Number(preferredCol);
      // Android TV keeps vertical D-pad movement in the current grid column.
      // A row's remembered index is only a fallback for callers without a current column.
      const preferredIndex = Number.isFinite(currentCol) ? currentCol : Number.isFinite(storedIndex) ? storedIndex : 0;
      return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
    },
    focusNode(target) {
      if (!target) return false;
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) {
          node.classList.remove("focused");
        }
      });
      target.classList.add("focused");
      this.focusZone = "content";
      this.lastFocusedAction = String(target.dataset.action || this.lastFocusedAction || "openDetail");
      this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
      if (target.dataset.itemId) {
        this.lastFocusedDiscoverItemId = String(target.dataset.itemId || "");
      }
      this.rememberRowFocus(target);
      focusWithoutAutoScroll(target);
      const scroller = this.getContentScroller();
      const isFirstRow = Number(target.dataset.navRow || 0) === 0;
      const shouldLoadMore = this.shouldAutoLoadMore(target.dataset.itemIndex);
      // Instant scroll on per-keypress focus (smooth scrollTo jittered on held repeats).
      const nextScrollTop = isFirstRow
        ? setContainerScrollTop(scroller, 0, "auto")
        : scrollNodeIntoContainerView(target, scroller, {
            center: false,
            padding: 20,
            behavior: "auto"
          });
      if (Number.isFinite(nextScrollTop)) {
        this.savedScrollTop = nextScrollTop;
      }
      if (shouldLoadMore) {
        this.loadNextPage({ preserveViewport: true });
      }
      if (this.maybeExpandRenderedItems(target.dataset.itemIndex)) {
        this.updateRenderedDiscoverResults();
      }
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, false);
      }
      return true;
    },
    endDiscoverVerticalFastScroll({ land = true } = {}) {
      const state = this.discoverVerticalFastScrollState || null;
      if (state?.raf) {
        cancelAnimationFrame(state.raf);
      }
      if (this.discoverVerticalFastScrollEndTimer) {
        clearTimeout(this.discoverVerticalFastScrollEndTimer);
        this.discoverVerticalFastScrollEndTimer = null;
      }
      this.discoverVerticalFastScrollState = null;
      if (land && state?.direction) {
        this.landDiscoverVerticalFastScroll(state.direction, state.startColumn);
      }
    },
    canDiscoverVerticalFastScroll(scroller, direction) {
      if (!scroller || !direction) {
        return false;
      }
      const maxScrollTop = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0));
      const scrollTop = Number(scroller.scrollTop || 0);
      return direction > 0 ? scrollTop < maxScrollTop - 1 : scrollTop > 1;
    },
    startDiscoverVerticalFastScroll(direction) {
      const scroller = this.getContentScroller();
      const current = this.container?.querySelector(".discover-grid .seeall-card.focused") || null;
      if (!scroller || !direction || !current) {
        return false;
      }
      if (!this.canDiscoverVerticalFastScroll(scroller, direction)) {
        this.endDiscoverVerticalFastScroll({ land: true });
        return true;
      }

      const existing = this.discoverVerticalFastScrollState;
      if (existing?.raf && existing.direction === direction) {
        this.armDiscoverVerticalFastScrollEndTimer();
        return true;
      }

      this.endDiscoverVerticalFastScroll({ land: true });
      const state = {
        scroller,
        direction,
        startColumn: Number(current.dataset.navCol || 0),
        raf: null,
        lastTime: performance.now()
      };
      const tick = (now) => {
        if (this.discoverVerticalFastScrollState !== state) {
          return;
        }
        if (!scroller.isConnected) {
          this.endDiscoverVerticalFastScroll({ land: false });
          return;
        }
        const dtMs = Math.min(MODERN_HOME_CONSTANTS.verticalFastScrollMaxFrameMs, Math.max(0, now - state.lastTime));
        state.lastTime = now;
        const maxScrollTop = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0));
        const currentTop = Number(scroller.scrollTop || 0);
        const delta = state.direction * MODERN_HOME_CONSTANTS.verticalFastScrollVelocityPxPerSec * (dtMs / 1000);
        const nextTop = Math.max(0, Math.min(maxScrollTop, currentTop + delta));
        scroller.scrollTop = nextTop;
        this.savedScrollTop = nextTop;
        if (Math.abs(nextTop - currentTop) <= 0.1 || nextTop <= 0 || nextTop >= maxScrollTop) {
          this.endDiscoverVerticalFastScroll({ land: true });
          return;
        }
        state.raf = requestAnimationFrame(tick);
      };

      this.discoverVerticalFastScrollState = state;
      state.raf = requestAnimationFrame(tick);
      this.armDiscoverVerticalFastScrollEndTimer();
      return true;
    },
    armDiscoverVerticalFastScrollEndTimer() {
      if (this.discoverVerticalFastScrollEndTimer) {
        clearTimeout(this.discoverVerticalFastScrollEndTimer);
      }
      this.discoverVerticalFastScrollEndTimer = setTimeout(() => {
        this.discoverVerticalFastScrollEndTimer = null;
        this.endDiscoverVerticalFastScroll({ land: true });
      }, MODERN_HOME_CONSTANTS.verticalFastScrollEndTimeoutMs);
    },
    landDiscoverVerticalFastScroll(direction, startColumn) {
      const scroller = this.getContentScroller();
      if (!scroller) {
        return;
      }
      const scrollerRect = scroller.getBoundingClientRect();
      const visibleCards = Array.from(this.container?.querySelectorAll(".discover-grid .seeall-card.focusable") || [])
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const overlap = Math.min(rect.bottom, scrollerRect.bottom) - Math.max(rect.top, scrollerRect.top);
          return overlap > 0 ? node : null;
        })
        .filter(Boolean);
      if (!visibleCards.length) {
        return;
      }
      const sameColumn = visibleCards.filter((node) => Number(node.dataset.navCol || -1) === Number(startColumn));
      const candidates = sameColumn.length ? sameColumn : visibleCards;
      const target = direction > 0 ? candidates[candidates.length - 1] : candidates[0];
      if (target) {
        this.focusNode(target);
      }
    },
    getContentScroller() {
      return this.container?.querySelector(".discover-main") || null;
    },
    scrollContentToTop() {
      const scroller = this.getContentScroller();
      if (scroller) {
        this.savedScrollTop = setContainerScrollTop(scroller, 0, "auto");
      }
    },
    handleGridDpad(event) {
      const code = Number(event?.keyCode || 0);
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : code === 39 ? "right" : null;
      if (!direction) {
        return false;
      }

      const nav = this.navModel;
      const current = this.container?.querySelector(".discover-grid .seeall-card.focused") || null;
      if (!nav?.rows?.length || !current) {
        return false;
      }

      event?.preventDefault?.();
      const row = Number(current.dataset.navRow || 0);
      const col = Number(current.dataset.navCol || 0);
      const rowNodes = nav.rows[row] || [];

      if (direction === "left") {
        return this.focusNode(rowNodes[col - 1] || current) || true;
      }
      if (direction === "right") {
        return this.focusNode(rowNodes[col + 1] || current) || true;
      }

      const delta = direction === "up" ? -1 : 1;
      const targetRowNodes = nav.rows[row + delta] || null;
      if (!targetRowNodes?.length) {
        return true;
      }
      return this.focusNode(this.resolvePreferredNodeForRow(targetRowNodes, col)) || true;
    },
    focusFirstContentCard() {
      const target =
        (this.lastFocusedKey
          ? this.container?.querySelector(
              `.discover-grid .seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`
            )
          : null) ||
        this.container?.querySelector(".discover-grid .seeall-card.focusable") ||
        null;
      return this.focusNode(target);
    }
  };
}
