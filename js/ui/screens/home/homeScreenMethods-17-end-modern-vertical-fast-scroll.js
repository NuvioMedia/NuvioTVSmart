import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods17() {
  const { MODERN_HOME_CONSTANTS } = internals;

  return {
    endModernVerticalFastScroll({ land = true } = {}) {
      const state = this.modernVerticalFastScrollState || null;
      if (state?.raf) {
        cancelAnimationFrame(state.raf);
      }
      if (this.modernVerticalFastScrollEndTimer) {
        clearTimeout(this.modernVerticalFastScrollEndTimer);
        this.modernVerticalFastScrollEndTimer = null;
      }
      this.modernVerticalFastScrollState = null;
      if (land && state?.direction) {
        this.landModernVerticalFastScroll(state.direction);
        this.scheduleHomeLazyImageHydration();
      }
    },
    canModernFastScroll(main, direction) {
      if (!main) {
        return false;
      }
      const maxScrollTop = Math.max(0, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
      const scrollTop = Number(main.scrollTop || 0);
      if (direction > 0) {
        return scrollTop < maxScrollTop - 1;
      }
      return scrollTop > 1;
    },
    startModernVerticalFastScroll(direction) {
      const main = this.container?.querySelector(".home-modern-rows-viewport");
      if (this.layoutMode !== "modern" || !main || !direction || this.shouldUseImmediateCameraScroll()) {
        // Constrained TV runtimes cannot sustain a frame-by-frame scrollTop write
        // over the fully mounted Home DOM. Let the existing throttled focus path
        // handle repeated D-pad input with immediate focus scrolling instead.
        return false;
      }
      this.cancelModernCameraFollow({ stopAnimations: true });
      if (this._mainVertRaf) {
        cancelAnimationFrame(this._mainVertRaf);
        this._mainVertRaf = null;
      }
      this.cancelScrollAnimation(main, "y");
      if (!this.canModernFastScroll(main, direction)) {
        this.endModernVerticalFastScroll({ land: true });
        return true;
      }

      const existing = this.modernVerticalFastScrollState;
      if (existing?.raf && existing.direction === direction) {
        this.armModernVerticalFastScrollEndTimer();
        return true;
      }
      this.endModernVerticalFastScroll({ land: false });
      if (this.homeViewportFocusSyncTimer) {
        clearTimeout(this.homeViewportFocusSyncTimer);
        this.homeViewportFocusSyncTimer = null;
      }
      if (this.homeLazyImageHydrationRaf) {
        cancelAnimationFrame(this.homeLazyImageHydrationRaf);
        this.homeLazyImageHydrationRaf = 0;
      }

      const state = {
        container: main,
        direction,
        raf: null,
        lastTime: performance.now()
      };
      const tick = (now) => {
        if (this.modernVerticalFastScrollState !== state || !main.isConnected) {
          return;
        }
        const dtMs = Math.min(MODERN_HOME_CONSTANTS.verticalFastScrollMaxFrameMs, Math.max(0, now - state.lastTime));
        state.lastTime = now;
        const maxScrollTop = Math.max(0, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
        const current = Number(main.scrollTop || 0);
        const delta = direction * MODERN_HOME_CONSTANTS.verticalFastScrollVelocityPxPerSec * (dtMs / 1000);
        const next = Math.max(0, Math.min(maxScrollTop, current + delta));
        main.scrollTop = next;
        if (Math.abs(next - current) <= 0.1 || next <= 0 || next >= maxScrollTop) {
          this.endModernVerticalFastScroll({ land: true });
          return;
        }
        state.raf = requestAnimationFrame(tick);
      };
      this.modernVerticalFastScrollState = state;
      state.raf = requestAnimationFrame(tick);
      this.armModernVerticalFastScrollEndTimer();
      return true;
    },
    armModernVerticalFastScrollEndTimer() {
      if (this.modernVerticalFastScrollEndTimer) {
        clearTimeout(this.modernVerticalFastScrollEndTimer);
      }
      this.modernVerticalFastScrollEndTimer = setTimeout(() => {
        this.modernVerticalFastScrollEndTimer = null;
        this.endModernVerticalFastScroll({ land: true });
      }, MODERN_HOME_CONSTANTS.verticalFastScrollEndTimeoutMs);
    },
    landModernVerticalFastScroll(direction) {
      const main = this.container?.querySelector(".home-modern-rows-viewport");
      if (!main || !this.navModel?.rows?.length) {
        return;
      }
      const mainRect = main.getBoundingClientRect();
      const visibleRows = this.navModel.rows
        .map((rowNodes) => {
          const anchor = this.getMainFocusAnchor(rowNodes[0]);
          if (!anchor) {
            return null;
          }
          const rect = anchor.getBoundingClientRect();
          const overlap = Math.min(rect.bottom, mainRect.bottom) - Math.max(rect.top, mainRect.top);
          if (overlap <= 0) {
            return null;
          }
          const edgeDistance = direction > 0 ? Math.abs(rect.top - mainRect.top) : Math.abs(rect.bottom - mainRect.bottom);
          return { rowNodes, overlap, edgeDistance };
        })
        .filter(Boolean)
        .sort((left, right) => {
          if (right.overlap !== left.overlap) {
            return right.overlap - left.overlap;
          }
          return left.edgeDistance - right.edgeDistance;
        });
      const target = this.resolveBestVisibleNodeForRow(visibleRows[0]?.rowNodes || []);
      const current = this.container?.querySelector(".home-main .focusable.focused") || null;
      if (target && current !== target) {
        this.focusNode(current, target, direction > 0 ? "down" : "up", { repeat: true });
      } else if (target) {
        this.syncMainFocusToViewport({ suppressFlows: false });
      }
    },
    ensureMainVerticalVisibility(target, direction = null, current = null, layoutAdjustment = 0) {
      if (this.layoutMode === "modern") {
        if (this._mainVertRaf) {
          cancelAnimationFrame(this._mainVertRaf);
        }
        const _target = target;
        const _direction = direction;
        const _current = current;
        const _adj = layoutAdjustment;
        this._mainVertRaf = requestAnimationFrame(() => {
          this._mainVertRaf = null;
          if (!_target.isConnected) {
            return;
          }
          const next = this.getModernMainAlignedScrollTarget(_target, _direction, _current, _adj);
          if (!next?.container) {
            return;
          }
          const delta = Math.abs(Number(next.container.scrollTop || 0) - Number(next.value || 0));
          if (delta <= 1) {
            return;
          }
          if (this.shouldUseImmediateCameraScroll()) {
            this.cancelScrollAnimation(next.container, "y");
            next.container.scrollTop = Math.round(Number(next.value || 0));
            return;
          }
          this.modernCameraFollowLastVerticalContainer = next.container;
          this.animateSpringScroll(next.container, "y", next.value);
        });
        return;
      }

      if ((direction === "up" || direction === "down") && this.isPerformanceConstrained()) {
        if (this._mainClassicVertRaf) {
          cancelAnimationFrame(this._mainClassicVertRaf);
        }
        const _target = target;
        const _direction = direction;
        const _current = current;
        const _adj = layoutAdjustment;
        this._mainClassicVertRaf = requestAnimationFrame(() => {
          this._mainClassicVertRaf = null;
          if (!_target?.isConnected) {
            return;
          }
          this.applyClassicMainVerticalVisibility(_target, _direction, _current, _adj);
        });
        return;
      }

      this.applyClassicMainVerticalVisibility(target, direction, current, layoutAdjustment);
    },
    applyClassicMainVerticalVisibility(target, direction = null, current = null, layoutAdjustment = 0) {
      void direction;
      void current;
      const main =
        this.layoutMode === "modern"
          ? this.container?.querySelector(".home-modern-rows-viewport")
          : this.container?.querySelector(".home-main");
      if (!main || !target || !this.container?.contains(target)) {
        return;
      }
      const anchor = this.getMainFocusAnchor(target);
      const mainRect = main.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const inset = this.getRowFocusInset();
      const visibleTop = mainRect.top + inset;
      const visibleBottom = mainRect.bottom - 24;
      const anchorTop = anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
      const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);

      if (anchorRect.top < visibleTop) {
        this.animateScroll(main, "y", anchorTop - inset, this.getScrollDuration(150));
        return;
      }

      if (anchorRect.bottom > visibleBottom) {
        const targetScrollTop = anchorBottom - main.clientHeight + 24;
        this.animateScroll(main, "y", targetScrollTop, this.getScrollDuration(150));
      }
    },
    ensureTrackHorizontalVisibility(target, direction = null, layoutAdjustment = 0) {
      if (this.layoutMode === "modern") {
        if (this._trackHorizRaf) {
          cancelAnimationFrame(this._trackHorizRaf);
          this._trackHorizRaf = null;
        }
        if (this.shouldUseImmediateHorizontalScrollForNode(target) || this.shouldUseImmediateCameraScroll()) {
          const next = this.getModernTrackAlignedScrollTarget(target, layoutAdjustment);
          if (next?.container) {
            this.cancelScrollAnimation(next.container, "x");
            if (Math.abs(Number(next.container.scrollLeft || 0) - Number(next.value || 0)) > 1) {
              next.container.scrollLeft = Math.round(Number(next.value || 0));
            }
          }
          return;
        }
        const _target = target;
        const _adj = layoutAdjustment;
        this._trackHorizRaf = requestAnimationFrame(() => {
          this._trackHorizRaf = null;
          if (!_target.isConnected) {
            return;
          }
          const next = this.getModernTrackAlignedScrollTarget(_target, _adj);
          if (!next?.container) {
            return;
          }
          if (Math.abs(Number(next.container.scrollLeft || 0) - Number(next.value || 0)) <= 1) {
            return;
          }
          if (this.shouldUseImmediateHorizontalScrollForNode(_target)) {
            this.cancelScrollAnimation(next.container, "x");
            next.container.scrollLeft = Math.round(Number(next.value || 0));
            return;
          }
          this.modernCameraFollowLastHorizontalContainer = next.container;
          this.animateSpringScroll(next.container, "x", next.value);
        });
        return;
      }

      const track = target?.closest?.(".home-track, .home-grid-track");
      if (!track) {
        return;
      }
      const metrics = this.getTrackViewportMetrics(track);
      const targetLeft = target.offsetLeft;
      const targetRight = targetLeft + target.offsetWidth;
      const visibleLeft = metrics.visibleLeft;
      const visibleRight = metrics.visibleRight;

      if (targetLeft < visibleLeft) {
        if (this.shouldUseImmediateHorizontalScrollForNode(target)) {
          this.cancelScrollAnimation(track, "x");
          track.scrollLeft = Math.max(0, Math.round(targetLeft - metrics.leftPadding));
          return;
        }
        this.animateScroll(track, "x", targetLeft - metrics.leftPadding, this.getScrollDuration(160));
        return;
      }
      if (targetRight > visibleRight) {
        if (this.shouldUseImmediateHorizontalScrollForNode(target)) {
          this.cancelScrollAnimation(track, "x");
          const maxScrollLeft = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
          track.scrollLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(targetRight - track.clientWidth + metrics.safeRightPadding)));
          return;
        }
        this.animateScroll(track, "x", targetRight - track.clientWidth + metrics.safeRightPadding, this.getScrollDuration(160));
        return;
      }
      if (this.layoutMode !== "modern" && !direction) {
        const targetCenter = targetLeft + target.offsetWidth / 2;
        const centeredLeft = targetCenter - track.clientWidth / 2;
        if (this.shouldUseImmediateHorizontalScrollForNode(target)) {
          this.cancelScrollAnimation(track, "x");
          const maxScrollLeft = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
          track.scrollLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(centeredLeft)));
          return;
        }
        this.animateScroll(track, "x", centeredLeft, this.getScrollDuration(160));
      }
    }
  };
}
