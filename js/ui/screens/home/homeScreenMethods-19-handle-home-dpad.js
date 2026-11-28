import * as internals from "./homeScreenContext.js";

// A hover transition caused by a real pointer move is dispatched in the same
// turn as its mousemove, so this only has to cover that pair.
const HOME_POINTER_HOVER_GRACE_MS = 250;

export function createHomeScreenMethods19() {
  const HOME_BOUNDED_HYDRATION_PACE_QUIET_MS = 230;
  const {
    getLegacySidebarSelectedNode,
    getModernSidebarSelectedNode,
    getDirectionFromKeyCode,
    MODERN_HOME_CONSTANTS,
    Router,
    CW_HOLD_DELAY_MS
  } = internals;

  // Hold time must come from input event timestamps (performance clock), not from when a busy main
  // thread got to the event; fall back to Date.now() for both ends if either stamp is missing.
  const eventTime = (event) => {
    const t = Number(event?.timeStamp);
    return Number.isFinite(t) && t > 0 ? t : 0;
  };
  const pointerHeldMs = (screen, event) => {
    const down = screen.pointerHoldDownStamp;
    const up = eventTime(event);
    return down && up ? up - down : Date.now() - screen.pointerHoldStartedAt;
  };

  return {
    handleHomeDpad(event) {
      const keyCode = Number(event?.keyCode || 0);
      const direction = getDirectionFromKeyCode(keyCode);
      if (!direction) {
        return false;
      }

      const nav = this.navModel;
      if (!nav) {
        return false;
      }

      const activeFastScroll = this.modernVerticalFastScrollState || null;
      const requestedFastScrollDirection = direction === "down" ? 1 : direction === "up" ? -1 : 0;
      if (
        activeFastScroll &&
        (direction === "left" || direction === "right" || (!event?.repeat && requestedFastScrollDirection !== activeFastScroll.direction))
      ) {
        this.endModernVerticalFastScroll({ land: true });
      }

      let current = this.getCurrentFocusedNode() || this.container?.querySelector(".focusable") || null;
      if (!current) {
        return false;
      }
      if (this.isMainNode(current) && !this.shouldSuspendModernViewportFocusSync() && !this.isNodeWithinMainViewport(current)) {
        current = this.syncMainFocusToViewport({ suppressFlows: true }) || current;
      }
      const isSidebar = this.isSidebarNode(current);

      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
      // Tizen fast path: background catalog/CW batches must not trigger a
      // full re-render while D-pad input is settling (see
      // shouldDeferHomeRenderForInput). One timestamp covers first presses
      // and repeats on every layout.
      this.lastHomeInputAt = Date.now();

      const inputMeta = {
        repeat: Boolean(event?.repeat)
      };

      if (
        inputMeta.repeat &&
        this.layoutMode === "modern" &&
        !isSidebar &&
        (direction === "up" || direction === "down") &&
        this.startModernVerticalFastScroll(direction === "down" ? 1 : -1)
      ) {
        return true;
      }

      if (inputMeta.repeat) {
        const now = Date.now();
        const repeatThrottleMs = this.getDirectionalRepeatThrottleMs(direction);
        const repeatTimes = this.lastDirectionalKeyAtByDirection || (this.lastDirectionalKeyAtByDirection = {});
        const lastDirectionalKeyAt = Number(repeatTimes[direction] || 0);
        if (lastDirectionalKeyAt > 0 && now - lastDirectionalKeyAt < repeatThrottleMs) {
          return true;
        }
        repeatTimes[direction] = now;
      }

      if (!isSidebar && current.classList.contains("home-hero-card") && (direction === "left" || direction === "right")) {
        if (this.heroCandidates?.length > 1) {
          this.rotateHero(direction === "right" ? 1 : -1);
        }
        return true;
      }

      if (isSidebar) {
        const sidebarIndex = Number(current.dataset.navIndex || 0);
        if (direction === "up") {
          const target = nav.sidebar[Math.max(0, sidebarIndex - 1)] || current;
          return this.focusNode(current, target, direction, inputMeta) || true;
        }
        if (direction === "down") {
          const target = nav.sidebar[Math.min(nav.sidebar.length - 1, sidebarIndex + 1)] || current;
          return this.focusNode(current, target, direction, inputMeta) || true;
        }
        if (direction === "right") {
          return this.closeSidebarToContent() || true;
        }
        return true;
      }

      const row = Number(current.dataset.navRow || 0);
      const col = Number(current.dataset.navCol || 0);
      const rowNodes = nav.rows[row] || [];

      if (direction === "left") {
        const targetInRow = rowNodes[col - 1] || null;
        if (this.focusNode(current, targetInRow, direction, inputMeta)) {
          return true;
        }
        const sidebarFallback =
          getLegacySidebarSelectedNode(this.container) || getModernSidebarSelectedNode(this.container) || nav.sidebar[0] || null;
        if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
          this.lastMainFocus = current;
          return this.openSidebar();
        }
        return this.focusNode(current, sidebarFallback, direction, inputMeta) || true;
      }

      if (direction === "right") {
        if (this.getNodeRowKey(current) === "continue_watching") {
          this.ensureContinueWatchingRenderAhead(current, { force: !rowNodes[col + 1] });
        }
        const target = rowNodes[col + 1] || null;
        return this.focusNode(current, target, direction, inputMeta) || true;
      }

      if (direction === "up" || direction === "down") {
        const delta = direction === "up" ? -1 : 1;
        const targetRow = row + delta;
        const targetRowNodes = nav.rows[targetRow] || null;
        if (!targetRowNodes || !targetRowNodes.length) {
          return true;
        }
        const target = this.resolvePreferredNodeForRow(targetRowNodes, col);
        return this.focusNode(current, target, direction, inputMeta) || true;
      }

      return false;
    },
    ensureDelegatedEventsBound() {
      if (!this.container) {
        return;
      }
      if (!this.boundHomeFocusInHandler) {
        this.boundHomeFocusInHandler = (event) => {
          const target = event?.target?.closest?.(".focusable");
          if (!target || !this.container?.contains(target)) {
            return;
          }
          if (this.pendingDelegatedFocusTarget) {
            const isSuppressedProgrammaticFocus = this.pendingDelegatedFocusTarget === target;
            this.pendingDelegatedFocusTarget = null;
            if (isSuppressedProgrammaticFocus) {
              return;
            }
          }
          if (target.closest(".home-sidebar .focusable, .modern-sidebar-panel .focusable")) {
            this.setSidebarExpanded(true);
            return;
          }
          if (!target.closest(".home-main .focusable")) {
            return;
          }
          if (this.isMainNode(target)) {
            this.lastMainFocus = target;
          }
          this.syncFocusedCollectionCardState();
          this.scheduleModernHeroUpdate(target);
          this.scheduleFocusedPosterFlow(target);
        };
      }
      if (!this.boundHomeClickHandler) {
        this.boundHomeClickHandler = (event) => {
          if (this.pointerHoldSwallowClick) {
            this.pointerHoldSwallowClick = false;
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
          }
          const target = event?.target?.closest?.(".home-main .focusable");
          if (!target || !this.container?.contains(target)) {
            return;
          }
          this.markUserInteractionSinceHomePaint();
          const action = String(target.dataset.action || "");
          if (action === "openDetail" || action === "openCollectionFolder") {
            this.openDetailFromNode(target);
            return;
          }
          if (action === "openCatalogSeeAll") {
            this.openCatalogSeeAllFromNode(target);
            return;
          }
          if (action === "resumeProgress") {
            this.openContinueWatchingFromNode(target);
          }
        };
      }
      if (!this.boundHomeMouseDownHandler) {
        this.boundHomeMouseDownHandler = (event) => {
          this.markUserInteractionSinceHomePaint();
          // Magic Remote pointer sends no key events, so mirror the Enter hold here.
          this.pointerHoldSwallowClick = false;
          this.pointerHoldStartedAt = 0;
          this.pointerHoldDownStamp = 0;
          const card = event?.button === 0 ? event.target?.closest?.(".home-main .focusable") : null;
          if (card && this.container?.contains(card) && this.startPendingContinueWatchingHold(card, true)) {
            this.pointerHoldStartedAt = Date.now();
            this.pointerHoldDownStamp = eventTime(event);
          }
        };
      }
      if (!this.boundHomeMouseUpHandler) {
        this.boundHomeMouseUpHandler = (event) => {
          if (!this.pointerHoldStartedAt) {
            return;
          }
          this.pointerHoldSwallowClick = pointerHeldMs(this, event) >= CW_HOLD_DELAY_MS;
          this.pointerHoldStartedAt = 0;
          if (!this.pointerHoldSwallowClick) {
            this.cancelPendingContinueWatchingHold();
          }
        };
      }
      if (!this.boundHomeMouseOutHandler) {
        this.boundHomeMouseOutHandler = (event) => {
          const card = event?.target?.closest?.(".home-main .focusable");
          if (!this.pointerHoldStartedAt || !card || card.contains(event.relatedTarget)) {
            return;
          }
          if (pointerHeldMs(this, event) < CW_HOLD_DELAY_MS) {
            this.pointerHoldStartedAt = 0;
            this.cancelPendingContinueWatchingHold();
          }
        };
      }
      if (!this.boundHomeMouseMoveHandler) {
        this.boundHomeMouseMoveHandler = () => {
          this.lastHomePointerMoveAt = Date.now();
        };
      }
      if (!this.boundHomeMouseOverHandler) {
        this.boundHomeMouseOverHandler = (event) => {
          const target = event?.target?.closest?.(".home-main .home-content-card.focusable");
          if (!target || !this.container?.contains(target) || target.classList.contains("focused")) {
            return;
          }
          // Row scrolling and card expansion shift content under a resting Magic
          // Remote pointer and fire mouseover with no pointer movement. Taking
          // focus there would shift the row again and feed the loop, so a hover
          // only counts when the pointer actually moved.
          if (Date.now() - Number(this.lastHomePointerMoveAt || 0) > HOME_POINTER_HOVER_GRACE_MS) {
            return;
          }
          // Match Android TV: while the expanded sidebar owns navigation, pointer
          // hover must not transfer focus to content behind it.
          if (this.sidebarExpanded || this.isSidebarFocusActive()) {
            return;
          }
          this.markUserInteractionSinceHomePaint();
          this.setFocusedNode(target, { suppressDelegatedFocus: true });
          if (this.isMainNode(target)) {
            this.lastMainFocus = target;
            this.revealPointerHoveredRow(target);
          }
          this.syncFocusedCollectionCardState();
          this.scheduleModernHeroUpdate(target);
          this.scheduleFocusedPosterFlow(target);
        };
      }
      if (!this.boundHomeWheelHandler) {
        this.boundHomeWheelHandler = (event) => {
          const main = this.getHomeViewport();
          const target = event?.target;
          if (!(target instanceof HTMLElement) || !main?.contains(target)) {
            return;
          }
          this.markUserInteractionSinceHomePaint();
          // LG Magic Remote wheel events scroll the hovered element natively.
          // Consume them while the sidebar owns navigation so the background
          // remains fixed, matching Android TV's blocked content input.
          if (this.sidebarExpanded || this.isSidebarFocusActive()) {
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
          }
          this.cancelPendingHeroFocus();
          this.cancelFocusedPosterFlow();
          this.scheduleHomeViewportFocusSync();
        };
      }
      if (this.boundHomeEventContainer === this.container) {
        return;
      }
      if (this.boundHomeEventContainer) {
        this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
        this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
        this.boundHomeEventContainer.removeEventListener("mousedown", this.boundHomeMouseDownHandler);
        this.boundHomeEventContainer.removeEventListener("mouseup", this.boundHomeMouseUpHandler);
        this.boundHomeEventContainer.removeEventListener("mouseout", this.boundHomeMouseOutHandler);
        this.boundHomeEventContainer.removeEventListener("mousemove", this.boundHomeMouseMoveHandler);
        this.boundHomeEventContainer.removeEventListener("pointermove", this.boundHomeMouseMoveHandler);
        this.boundHomeEventContainer.removeEventListener("mouseover", this.boundHomeMouseOverHandler);
        this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
      }
      this.container.addEventListener("focusin", this.boundHomeFocusInHandler);
      this.container.addEventListener("click", this.boundHomeClickHandler);
      this.container.addEventListener("mousedown", this.boundHomeMouseDownHandler);
      this.container.addEventListener("mouseup", this.boundHomeMouseUpHandler);
      this.container.addEventListener("mouseout", this.boundHomeMouseOutHandler);
      this.container.addEventListener("mousemove", this.boundHomeMouseMoveHandler, { passive: true });
      this.container.addEventListener("pointermove", this.boundHomeMouseMoveHandler, { passive: true });
      this.container.addEventListener("mouseover", this.boundHomeMouseOverHandler);
      this.container.addEventListener("wheel", this.boundHomeWheelHandler, { passive: false });
      this.boundHomeEventContainer = this.container;
    },
    revealPointerHoveredRow(target) {
      const viewport = this.getHomeViewport();
      const anchor = viewport ? this.getMainFocusAnchor(target) : null;
      if (!anchor) {
        return;
      }
      // Android brings the focused row into view whatever moved the focus.
      // Reveal only the clipped part of the row, never re-center it.
      const overflow = anchor.getBoundingClientRect().bottom - (viewport.getBoundingClientRect().bottom - 24);
      if (overflow <= 0) {
        return;
      }
      this.animateScroll(viewport, "y", Number(viewport.scrollTop || 0) + overflow, this.getScrollDuration(150));
    },
    bindHomeViewportEvents() {
      const viewport = this.getHomeViewport();
      if (this.boundHomeViewport === viewport) {
        return;
      }
      if (this.homeViewportScrollFrame) {
        cancelAnimationFrame(this.homeViewportScrollFrame);
        this.homeViewportScrollFrame = 0;
      }
      if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
        this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler, true);
      }
      this.boundHomeViewport = viewport || null;
      if (!viewport) {
        return;
      }
      if (!this.boundHomeViewportScrollHandler) {
        this.boundHomeViewportScrollHandler = (event) => {
          if (event.target !== this.boundHomeViewport) {
            // Scroll does not bubble. Capture row scrolling so bounded image
            // prefetch follows the visible window, independently of focus.
            const track = event.target;
            if (track?.matches?.(".home-track, .home-grid-track") && this.shouldUseBoundedHomeImageHydration()) {
              const anchor = track.querySelector(".focusable.focused") || track.querySelector(".focusable");
              if (anchor) {
                const deferTrackHydration = Boolean(
                  this.layoutMode === "modern" && (this.isScrollAnimationActive?.(track, "x") || this.isModernHydrationScrollActive?.())
                );
                this.scheduleHomeLazyImageHydration(anchor, {
                  viewportChanged: true,
                  deferUntilVerticalSettle: deferTrackHydration,
                  focusedRowOnly: this.isLegacyTvRuntime()
                });
              }
            }
            return;
          }
          const lastInputAt = Number(this.lastHomeInputAt || 0);
          const withinPaceWindow = Boolean(
            this.shouldUseBoundedHomeImageHydration?.() &&
            lastInputAt > 0 &&
            Date.now() - lastInputAt < HOME_BOUNDED_HYDRATION_PACE_QUIET_MS
          );
          if (withinPaceWindow || Boolean(this.isModernHydrationScrollActive?.())) {
            // Skip per-frame rAF & timer resets mid-spring during active input;
            // schedule once per quiet cycle so post-settle rows still hydrate.
            if (withinPaceWindow && this.homeViewportSettleHydrationTimer) {
              return;
            }
            this.scheduleHomeViewportSettleHydration();
            return;
          }
          if (this.homeViewportScrollFrame) {
            return;
          }
          this.homeViewportScrollFrame = requestAnimationFrame(() => {
            this.homeViewportScrollFrame = 0;
            const frameLastInputAt = Number(this.lastHomeInputAt || 0);
            const frameWithinPaceWindow = Boolean(
              this.shouldUseBoundedHomeImageHydration?.() &&
              frameLastInputAt > 0 &&
              Date.now() - frameLastInputAt < HOME_BOUNDED_HYDRATION_PACE_QUIET_MS
            );
            if (this.shouldSuspendModernViewportFocusSync() || frameWithinPaceWindow) {
              // The camera tween's last scroll event lands while it is still
              // active (or inside the frame-pace window); without a retry the
              // rows it revealed never hydrate.
              this.scheduleHomeViewportSettleHydration();
              return;
            }
            this.scheduleHomeLazyImageHydration(null, {
              deferUntilVerticalSettle: this.shouldUseImmediateFocusScroll()
            });
            // Keep the sidebar sticky across rerenders and layout-driven scroll events.
            if (this.isSidebarFocusActive()) {
              return;
            }
            const current = this.container?.querySelector(".home-main .focusable.focused") || null;
            if (current && this.isMainNode(current) && this.isNodeWithinMainViewport(current)) {
              return;
            }
            this.scheduleHomeViewportFocusSync();
          });
        };
      }
      viewport.addEventListener("scroll", this.boundHomeViewportScrollHandler, { passive: true, capture: true });
    },
    scheduleHomeViewportSettleHydration() {
      if (this.homeViewportSettleHydrationTimer) {
        clearTimeout(this.homeViewportSettleHydrationTimer);
      }
      const lastInputAt = Number(this.lastHomeInputAt || 0);
      const paceQuietRemainingMs =
        this.shouldUseBoundedHomeImageHydration?.() && lastInputAt > 0
          ? Math.max(0, HOME_BOUNDED_HYDRATION_PACE_QUIET_MS - (Date.now() - lastInputAt))
          : 0;
      const delayMs = Math.max(MODERN_HOME_CONSTANTS.verticalScrollSettlePollMs, paceQuietRemainingMs);
      this.homeViewportSettleHydrationTimer = setTimeout(() => {
        this.homeViewportSettleHydrationTimer = null;
        if (!this.container || Router.getCurrent() !== "home") {
          return;
        }
        const retryLastInputAt = Number(this.lastHomeInputAt || 0);
        const retryPaceRemainingMs =
          this.shouldUseBoundedHomeImageHydration?.() && retryLastInputAt > 0
            ? HOME_BOUNDED_HYDRATION_PACE_QUIET_MS - (Date.now() - retryLastInputAt)
            : 0;
        if (this.shouldSuspendModernViewportFocusSync() || retryPaceRemainingMs > 0) {
          this.scheduleHomeViewportSettleHydration();
          return;
        }
        this.scheduleHomeLazyImageHydration(this.getCurrentFocusedNode?.() || null, { viewportChanged: true });
      }, delayMs);
    }
  };
}
