import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods02() {
  const { MODERN_HOME_CONSTANTS, findHomeFocusIdentityMatch, MODERN_CAMERA_PAN_EASING } = internals;

  return {
    restoreModernFocusState(focusState) {
      if (this.homeHoldFocusLocked || !focusState || this.layoutMode !== "modern") {
        return false;
      }

      const viewport = this.getHomeViewport();
      if (!viewport) {
        return false;
      }

      Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
        const track = this.getNavigationTrackNodes().find((node) => String(node.dataset.trackRowKey || "") === String(rowKey || ""));
        if (track) {
          track.scrollLeft = Number(scrollLeft || 0);
        }
      });

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));

      const targetNodes = this.getNavigationRowNodes(focusState.rowKey);
      if (this.isRestoringFocusFromBack && focusState.rowKey && !targetNodes.length) {
        return false;
      }
      const fallback = this.isRestoringFocusFromBack
        ? null
        : this.container.querySelector(".home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable");
      const target =
        findHomeFocusIdentityMatch(targetNodes, focusState.itemIdentity) || targetNodes[focusState.itemIndex] || targetNodes[0] || fallback;
      if (!target) {
        return false;
      }

      this.setFocusedNode(target);
      this.syncFocusedCollectionCardState();
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      if (!this.isRestoringFocusFromBack) {
        this.ensureMainVerticalVisibility(target, "down");
      }
      this.scheduleModernHeroUpdate(target, {
        immediate: Boolean(this.isRestoringFocusFromBack)
      });
      this.scheduleFocusedPosterFlow(target);
      return true;
    },
    restoreLegacyFocusState(focusState) {
      if (this.homeHoldFocusLocked || !focusState || !["classic", "grid"].includes(this.layoutMode)) {
        return false;
      }

      const main = this.container?.querySelector(".home-main");
      if (!main) {
        return false;
      }

      Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
        const track = this.getNavigationTrackNodes().find((node) => String(node.dataset.trackRowKey || "") === String(rowKey || ""));
        if (track) {
          track.scrollLeft = Number(scrollLeft || 0);
        }
      });

      const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
      main.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));

      let target = null;
      if (focusState.focusKind === "hero") {
        target = this.container.querySelector(".home-hero-card.focusable");
      } else if (focusState.rowKey) {
        const rowNodes = this.getNavigationRowNodes(focusState.rowKey);
        target = findHomeFocusIdentityMatch(rowNodes, focusState.itemIdentity) || rowNodes[focusState.itemIndex] || rowNodes[0] || null;
      }

      if (this.isRestoringFocusFromBack && focusState.rowKey) {
        const targetExists = this.getNavigationRowNodes(focusState.rowKey).length > 0;
        if (!targetExists && focusState.focusKind !== "hero") {
          return false;
        }
      }
      const fallback = this.isRestoringFocusFromBack ? null : this.container.querySelector(this.getInitialFocusSelector());
      target = target || fallback;
      if (!target) {
        return false;
      }

      this.setFocusedNode(target);
      this.syncFocusedCollectionCardState();
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      if (!this.isRestoringFocusFromBack && target.closest(".home-track, .home-grid-track")) {
        this.ensureTrackHorizontalVisibility(target);
      }
      if (!this.isRestoringFocusFromBack) {
        this.ensureMainVerticalVisibility(target);
      }
      return true;
    },
    focusInitialContinueWatchingCard() {
      if (this.homeHoldFocusLocked) {
        return false;
      }
      const target = this.getNavigationRowNodes("continue_watching")[0] || null;
      if (!target) {
        return false;
      }
      this.setFocusedNode(target);
      this.syncFocusedCollectionCardState();
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      this.ensureTrackHorizontalVisibility(target);
      this.ensureMainVerticalVisibility(target);
      this.scheduleModernHeroUpdate(target);
      this.scheduleFocusedPosterFlow(target);
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
      const key = axis === "y" ? "y" : "x";
      if (this.shouldUseImmediateFocusScroll()) {
        // Camera-follow callers must honor the same immediate policy as focus moves.
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
      const effectiveDuration = Math.max(0, Number(duration || 0));
      const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
      const springState = springMap.get(container);
      if (springState?.[key]?.raf) {
        cancelAnimationFrame(springState[key].raf);
        springState[key] = null;
        springMap.set(container, springState);
      }
      if (prefersReducedMotion || effectiveDuration <= 0) {
        container[property] = nextValue;
        return;
      }

      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const easing = typeof options?.easing === "function" ? options.easing : easeOutCubic;
      const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
      const existing = map.get(container) || {};
      if (existing[key]) {
        cancelAnimationFrame(existing[key]);
      }

      const startTime = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - startTime) / effectiveDuration);
        container[property] = Math.round(startValue + (nextValue - startValue) * easing(progress));
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
      const key = axis === "y" ? "y" : "x";
      if (this.shouldUseImmediateFocusScroll()) {
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

        // Reading scroll position after writing it can flush layout. It only
        // affects settling once velocity is low enough; keep that check first.
        if (
          Math.abs(state.velocity) <= state.velocityEpsilon &&
          Math.abs(Number(state.target || 0) - Number(container[property] || 0)) <= state.precision
        ) {
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
    getModernCameraPanEasing() {
      return MODERN_CAMERA_PAN_EASING;
    },
    shouldUseDelayedModernCameraFollow(target, _direction = null) {
      return false;
    },
    cancelModernCameraFollow({ stopAnimations = false } = {}) {
      if (this.modernCameraFollowTimer) {
        clearTimeout(this.modernCameraFollowTimer);
        this.modernCameraFollowTimer = null;
      }
      const state = this.modernCameraFollowState || null;
      if (stopAnimations) {
        const horizontalContainers = [state?.horizontal?.container, this.modernCameraFollowLastHorizontalContainer];
        const verticalContainers = [state?.vertical?.container, this.modernCameraFollowLastVerticalContainer];
        horizontalContainers.forEach((container) => {
          if (container) {
            this.cancelScrollAnimation(container, "x");
          }
        });
        verticalContainers.forEach((container) => {
          if (container) {
            this.cancelScrollAnimation(container, "y");
          }
        });
      }
      this.modernCameraFollowState = null;
      this.modernCameraFollowLastHorizontalContainer = null;
      this.modernCameraFollowLastVerticalContainer = null;
    }
  };
}
