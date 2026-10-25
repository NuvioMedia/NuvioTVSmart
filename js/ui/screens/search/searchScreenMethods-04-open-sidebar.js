/* eslint-disable no-unused-vars */
import * as internals from "./searchScreen.js";

export function createSearchScreenMethods04() {
  const {
    MODERN_HOME_CONSTANTS,
    focusWithoutAutoScroll,
    getRootSidebarNodes,
    getRootSidebarSelectedNode,
    isRootSidebarNode,
    isPerformanceConstrainedRuntime,
    getTvRuntimePerformanceProfile,
    setModernSidebarExpanded,
    setLegacySidebarExpanded,
    escapeSelectorValue
  } = internals;

  return {
    async openSidebar() {
      this.captureLiveViewState();
      const selected = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
      this.focusZone = "sidebar";
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        this.sidebarExpanded = true;
        setModernSidebarExpanded(this.container, true);
      }
      const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      return this.focusSidebarNode(selected || nodes[0] || null);
    },
    async closeSidebarToContent() {
      this.captureLiveViewState();
      this.focusZone = "content";
      if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
        this.sidebarExpanded = false;
        setModernSidebarExpanded(this.container, false);
      }
      return this.restoreContentFocus(false) || true;
    },
    restoreContentFocus(preferResults = false) {
      let target = null;
      if (preferResults) {
        target = this.container?.querySelector(".search-results-row .search-result-card.focusable") || null;
      }
      if (!target && !preferResults && this.mode !== "search") {
        target = this.getDefaultHeaderFocusTarget();
      }
      if (!target && this.restoredFocusedDescriptor?.rowKey && this.restoredFocusedDescriptor?.itemId) {
        target =
          this.container?.querySelector(
            `.search-result-card.focusable[data-row-key="${escapeSelectorValue(this.restoredFocusedDescriptor.rowKey)}"][data-item-id="${escapeSelectorValue(this.restoredFocusedDescriptor.itemId)}"]`
          ) || null;
      }
      if (!target && this.restoredFocusedDescriptor?.rowKey && this.restoredFocusedDescriptor?.action === "openCatalogSeeAll") {
        target =
          this.container?.querySelector(
            `.search-result-card.focusable.search-seeall-card[data-row-key="${escapeSelectorValue(this.restoredFocusedDescriptor.rowKey)}"]`
          ) || null;
      }
      if (!target && this.lastContentFocus) {
        if (this.lastContentFocus.zone === "results") {
          if (this.lastContentFocus.rowKey) {
            const rowNodes = Array.from(
              this.container?.querySelectorAll(`.focusable[data-row-key="${escapeSelectorValue(this.lastContentFocus.rowKey)}"]`) || []
            );
            target = this.resolvePreferredResultsNode(rowNodes, this.lastContentFocus.col);
          }
          if (!target) {
            target =
              this.container?.querySelector(
                `.search-result-card.focusable[data-nav-row="${this.lastContentFocus.row}"][data-nav-col="${this.lastContentFocus.col}"]`
              ) || null;
          }
        } else if (this.lastContentFocus.zone === "header") {
          target = this.container?.querySelector(`.focusable[data-nav-zone="header"][data-nav-col="${this.lastContentFocus.col}"]`) || null;
        }
      }
      if (!target) {
        target = this.getDefaultHeaderFocusTarget() || this.container?.querySelector(".search-result-card.focusable") || null;
      }
      if (!target) {
        return false;
      }
      this.focusNode(this.container?.querySelector(".focusable.focused") || null, target);
      this.restoredFocusedDescriptor = null;
      return true;
    },
    focusNode(current, target) {
      if (!target) return false;
      if (current && current !== target) {
        current.classList.remove("focused");
      }
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
      const zone = String(target.dataset.navZone || "");
      const currentZone = String(current?.dataset?.navZone || "");
      const sidebarFocused = isRootSidebarNode(target);
      this.focusZone = sidebarFocused ? "sidebar" : "content";
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, sidebarFocused);
      }
      if (!sidebarFocused) {
        this.rememberContentFocus(target);
      }
      if (zone === "header" && currentZone === "results") {
        this.ensureHeaderVisible();
      }
      if (zone === "results") {
        this.ensureResultsRowVisible(target);
        this.ensureResultCardVisible(current, target);
      }
      this.captureLiveViewState();
      return true;
    },
    cancelScrollAnimation(container, axis = "x") {
      const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
      const state = map.get(container);
      const key = axis === "y" ? "y" : "x";
      if (state?.[key]) {
        cancelAnimationFrame(state[key]);
        state[key] = null;
      }
      const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
      const springState = springMap.get(container);
      if (springState?.[key]?.raf) {
        cancelAnimationFrame(springState[key].raf);
        springState[key] = null;
        springMap.set(container, springState);
      }
    },
    shouldUseImmediateFocusScroll() {
      // Same policy as Home (see shouldUseImmediateFocusScroll in
      // homeScreenMethods-03): focus-driven scroll moves snap instead of tweening
      // on runtimes where a per-frame scrollLeft/scrollTop write costs the
      // compositor a repaint of the whole poster grid. webOS qualifies on every
      // generation, not just the ones flagged performance-constrained.
      return (
        isPerformanceConstrainedRuntime() || getTvRuntimePerformanceProfile().platform === "webos"
      );
    },
    animateScroll(container, axis, targetValue, duration = 150, options = {}) {
      if (!container) {
        return;
      }
      if (options?.mode === "spring") {
        this.animateSpringScroll(container, axis, targetValue, options?.spring || {});
        return;
      }
      const property = axis === "y" ? "scrollTop" : "scrollLeft";
      const max =
        axis === "y"
          ? Math.max(0, container.scrollHeight - container.clientHeight)
          : Math.max(0, container.scrollWidth - container.clientWidth);
      const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
      if (this.shouldUseImmediateFocusScroll()) {
        this.cancelScrollAnimation(container, axis);
        container[property] = nextValue;
        return;
      }
      const startValue = Number(container[property] || 0);
      if (Math.abs(startValue - nextValue) <= 1) {
        container[property] = nextValue;
        return;
      }

      const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        container[property] = nextValue;
        return;
      }

      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
      const key = axis === "y" ? "y" : "x";
      const existing = map.get(container) || {};
      if (existing[key]) {
        cancelAnimationFrame(existing[key]);
      }

      const startTime = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - startTime) / duration);
        container[property] = Math.round(startValue + (nextValue - startValue) * easeOutCubic(progress));
        if (progress < 1) {
          existing[key] = requestAnimationFrame(tick);
          map.set(container, existing);
        } else {
          existing[key] = null;
          map.set(container, existing);
        }
      };

      existing[key] = requestAnimationFrame(tick);
      map.set(container, existing);
    },
    animateSpringScroll(container, axis, targetValue, options = {}) {
      if (!container) {
        return;
      }
      const property = axis === "y" ? "scrollTop" : "scrollLeft";
      const max =
        axis === "y"
          ? Math.max(0, container.scrollHeight - container.clientHeight)
          : Math.max(0, container.scrollWidth - container.clientWidth);
      const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
      if (this.shouldUseImmediateFocusScroll()) {
        // The spring camera is the per-frame scroll writer on this screen, so
        // snapped runtimes land it on the target instead of integrating it.
        this.cancelScrollAnimation(container, axis);
        container[property] = nextValue;
        return;
      }
      const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        container[property] = nextValue;
        return;
      }

      const tweenMap = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
      const tweenState = tweenMap.get(container);
      const key = axis === "y" ? "y" : "x";
      if (tweenState?.[key]) {
        cancelAnimationFrame(tweenState[key]);
        tweenState[key] = null;
        tweenMap.set(container, tweenState);
      }

      const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
      const existing = springMap.get(container) || {};
      const active = existing[key];
      if (active) {
        active.target = nextValue;
        active.stiffness = Number(options?.stiffness ?? active.stiffness ?? MODERN_HOME_CONSTANTS.springScrollStiffness);
        active.dampingRatio = Number(options?.dampingRatio ?? active.dampingRatio ?? MODERN_HOME_CONSTANTS.springScrollDampingRatio);
        active.precision = Number(options?.precision ?? active.precision ?? 0.5);
        active.velocityEpsilon = Number(options?.velocityEpsilon ?? active.velocityEpsilon ?? 0.5);
        active.damping = 2 * active.dampingRatio * Math.sqrt(active.stiffness);
        springMap.set(container, existing);
        return;
      }

      const stiffness = Number(options?.stiffness ?? MODERN_HOME_CONSTANTS.springScrollStiffness);
      const dampingRatio = Number(options?.dampingRatio ?? MODERN_HOME_CONSTANTS.springScrollDampingRatio);
      const state = {
        target: nextValue,
        position: Number(container[property] || 0),
        velocity: 0,
        raf: null,
        lastTime: performance.now(),
        stiffness,
        dampingRatio,
        damping: 2 * dampingRatio * Math.sqrt(stiffness),
        precision: Number(options?.precision ?? 0.5),
        velocityEpsilon: Number(options?.velocityEpsilon ?? 0.5)
      };

      const tick = (now) => {
        const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - state.lastTime) / 1000));
        state.lastTime = now;
        const displacement = state.position - Number(state.target || 0);
        const acceleration = -state.stiffness * displacement - state.damping * state.velocity;
        state.velocity += acceleration * deltaSeconds;
        state.position += state.velocity * deltaSeconds;
        container[property] = state.position;

        const remaining = Number(state.target || 0) - Number(container[property] || 0);
        if (Math.abs(remaining) <= state.precision && Math.abs(state.velocity) <= state.velocityEpsilon) {
          container[property] = state.target;
          existing[key] = null;
          springMap.set(container, existing);
          return;
        }

        state.raf = requestAnimationFrame(tick);
        existing[key] = state;
        springMap.set(container, existing);
      };

      state.raf = requestAnimationFrame(tick);
      existing[key] = state;
      springMap.set(container, existing);
    },
    ensureResultsRowVisible(target) {
      const content = this.container?.querySelector(".search-content");
      const row = target?.closest?.(".search-results-row, .search-recent-item");
      if (!content || !row) {
        return;
      }

      const contentRect = content.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const topInset = 18;
      const bottomInset = 28;
      const rowTop = rowRect.top - contentRect.top + content.scrollTop;
      const rowBottom = rowRect.bottom - contentRect.top + content.scrollTop;
      const visibleTop = contentRect.top + topInset;
      const visibleBottom = contentRect.bottom - bottomInset;

      if (rowRect.top < visibleTop) {
        this.animateScroll(content, "y", rowTop - topInset, MODERN_HOME_CONSTANTS.cameraFollowDurationYMs, { mode: "spring" });
        return;
      }

      if (rowRect.bottom > visibleBottom) {
        this.animateScroll(content, "y", rowBottom - content.clientHeight + bottomInset, MODERN_HOME_CONSTANTS.cameraFollowDurationYMs, {
          mode: "spring"
        });
      }
    },
    ensureResultCardVisible(current, target) {
      const track = target?.closest?.(".search-results-track");
      if (!track || !target) {
        return;
      }

      const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(track) : null;
      const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
      const trackRect = track.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetLeft = targetRect.left - trackRect.left + Number(track.scrollLeft || 0);
      const maxScrollLeft = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
      this.animateScroll(
        track,
        "x",
        Math.max(0, Math.min(maxScrollLeft, targetLeft - leftPad)),
        MODERN_HOME_CONSTANTS.cameraFollowDurationXMs,
        { mode: "spring" }
      );
    }
  };
}
