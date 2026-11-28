import * as internals from "./homeScreenContext.js";
import { isModernTvProfile } from "../../../platform/tvPerformancePolicy.js";
import { getTvRuntimePerformanceProfile } from "../../../platform/tvRuntimePerformance.js";

function markCameraScrollActive(container) {
  if (!container || !isModernTvProfile(getTvRuntimePerformanceProfile())) return;
  container.classList.add("is-camera-scrolling");
}

function clearCameraScrollActive(container) {
  container?.classList?.remove?.("is-camera-scrolling");
}

function getContainerMaxScroll(container, axis) {
  return axis === "y"
    ? Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0))
    : Math.max(0, Number(container.scrollWidth || 0) - Number(container.clientWidth || 0));
}

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
    trackScrollContainer(container) {
      if (!container) {
        return;
      }
      this.activeScrollAnimationContainers ||= new Set();
      this.activeScrollAnimationContainers.add(container);
    },
    untrackScrollContainerIfIdle(container) {
      if (!container || !this.activeScrollAnimationContainers) {
        return;
      }
      const tweenState = this.scrollAnimations?.get?.(container);
      const springState = this.springScrollAnimations?.get?.(container);
      const hasTween = Boolean(tweenState?.x || tweenState?.y);
      const hasSpring = Boolean(springState?.x?.raf || springState?.y?.raf);
      if (!hasTween && !hasSpring) {
        this.activeScrollAnimationContainers.delete(container);
      }
    },
    cancelAllScrollAnimations() {
      const containers = Array.from(this.activeScrollAnimationContainers || []);
      containers.forEach((container) => {
        this.cancelScrollAnimation(container, "x");
        this.cancelScrollAnimation(container, "y");
      });
      this.activeScrollAnimationContainers?.clear?.();
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
      const otherKey = key === "y" ? "x" : "y";
      const stillAnimating = Boolean((state?.[otherKey] && state[otherKey] !== null) || springState?.[otherKey]?.raf);
      if (!stillAnimating) {
        clearCameraScrollActive(container);
        this.activeScrollAnimationContainers?.delete?.(container);
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
      const max = getContainerMaxScroll(container, axis);
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
        this.cancelScrollAnimation(container, axis);
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
        this.cancelScrollAnimation(container, axis);
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
      let lastWrittenPosition = Math.round(startValue);
      const tick = (now) => {
        if (container.isConnected === false) {
          existing[key] = null;
          map.set(container, existing);
          this.untrackScrollContainerIfIdle?.(container);
          clearCameraScrollActive(container);
          return;
        }
        const progress = Math.min(1, (now - startTime) / effectiveDuration);
        const nextRounded = Math.round(startValue + (nextValue - startValue) * easing(progress));
        if (nextRounded !== lastWrittenPosition) {
          container[property] = nextRounded;
          lastWrittenPosition = nextRounded;
        }
        if (progress < 1) {
          existing[key] = requestAnimationFrame(tick);
          map.set(container, existing);
        } else {
          existing[key] = null;
          map.set(container, existing);
          this.untrackScrollContainerIfIdle?.(container);
          clearCameraScrollActive(container);
        }
      };

      markCameraScrollActive(container);
      this.trackScrollContainer?.(container);
      existing[key] = requestAnimationFrame(tick);
      map.set(container, existing);
    },
    animateSpringScroll(container, axis, targetValue, options = {}) {
      if (!container) {
        return;
      }
      const property = axis === "y" ? "scrollTop" : "scrollLeft";
      const max = getContainerMaxScroll(container, axis);
      const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
      const key = axis === "y" ? "y" : "x";
      if (this.shouldUseImmediateFocusScroll()) {
        this.cancelScrollAnimation(container, axis);
        container[property] = nextValue;
        return;
      }
      const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        this.cancelScrollAnimation(container, axis);
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

      const isTvRuntime = Boolean(getTvRuntimePerformanceProfile()?.isTvRuntime);
      const useFastTvSpring = isTvRuntime && options?.stiffness == null;
      const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
      const existing = springMap.get(container) || {};
      const active = existing[key];
      if (active) {
        active.target = nextValue;
        active.stiffness = Number(
          options?.stiffness ?? (useFastTvSpring ? 1100 : (active.stiffness ?? MODERN_HOME_CONSTANTS.springScrollStiffness))
        );
        active.dampingRatio = Number(
          options?.dampingRatio ?? (useFastTvSpring ? 1.0 : (active.dampingRatio ?? MODERN_HOME_CONSTANTS.springScrollDampingRatio))
        );
        active.precision = Number(options?.precision ?? (useFastTvSpring ? 2 : (active.precision ?? 1)));
        active.velocityEpsilon = Number(options?.velocityEpsilon ?? (useFastTvSpring ? 55 : (active.velocityEpsilon ?? 12)));
        active.damping = 2 * active.dampingRatio * Math.sqrt(active.stiffness);
        if (Math.abs(nextValue - active.position) > 1) {
          markCameraScrollActive(container);
        }
        springMap.set(container, existing);
        return;
      }

      const stiffness = Number(options?.stiffness ?? (useFastTvSpring ? 1100 : MODERN_HOME_CONSTANTS.springScrollStiffness));
      const dampingRatio = Number(options?.dampingRatio ?? (useFastTvSpring ? 1.0 : MODERN_HOME_CONSTANTS.springScrollDampingRatio));
      const initialPosition = Number(container[property] || 0);

      const state = {
        target: nextValue,
        position: initialPosition,
        lastWrittenPosition: Math.round(initialPosition),
        velocity: 0,
        raf: null,
        lastTime: performance.now(),
        stiffness,
        dampingRatio,
        damping: 2 * dampingRatio * Math.sqrt(stiffness),
        precision: Number(options?.precision ?? (useFastTvSpring ? 2 : 1)),
        velocityEpsilon: Number(options?.velocityEpsilon ?? (useFastTvSpring ? 55 : 12))
      };

      const tick = (now) => {
        if (container.isConnected === false) {
          existing[key] = null;
          springMap.set(container, existing);
          this.untrackScrollContainerIfIdle?.(container);
          clearCameraScrollActive(container);
          return;
        }
        const deltaSeconds = Math.min(0.034, Math.max(0.001, (now - state.lastTime) / 1000));
        state.lastTime = now;
        const targetPos = Number(state.target || 0);
        // Sub-step integration so high-stiffness TV springs stay critically
        // damped with zero overshoot even on 34 ms frame drops.
        const subSteps = Math.max(1, Math.ceil(deltaSeconds / 0.004));
        const stepSeconds = deltaSeconds / subSteps;
        for (let step = 0; step < subSteps; step += 1) {
          const displacement = state.position - targetPos;
          const acceleration = -state.stiffness * displacement - state.damping * state.velocity;
          state.velocity += acceleration * stepSeconds;
          state.position += state.velocity * stepSeconds;
        }
        const nextRounded = Math.round(state.position);

        // Settle purely in JS math so we never read scrollTop/scrollHeight
        // inside rAF after IntersectionObserver unparks an incoming row.
        if (Math.abs(state.velocity) <= state.velocityEpsilon && Math.abs(targetPos - nextRounded) <= state.precision) {
          if (state.lastWrittenPosition !== targetPos) {
            container[property] = targetPos;
            state.lastWrittenPosition = targetPos;
          }
          existing[key] = null;
          springMap.set(container, existing);
          this.untrackScrollContainerIfIdle?.(container);
          clearCameraScrollActive(container);
          return;
        }

        if (nextRounded !== state.lastWrittenPosition) {
          container[property] = nextRounded;
          state.lastWrittenPosition = nextRounded;
        }

        state.raf = requestAnimationFrame(tick);
        existing[key] = state;
        springMap.set(container, existing);
      };

      if (Math.abs(nextValue - initialPosition) > 1) {
        markCameraScrollActive(container);
      }
      this.trackScrollContainer?.(container);
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
