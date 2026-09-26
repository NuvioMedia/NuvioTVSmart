import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods19() {
  const { getLegacySidebarSelectedNode, getModernSidebarSelectedNode, getDirectionFromKeyCode } = internals;

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
      if (this.isMainNode(current) && !this.isNodeWithinMainViewport(current) && !this.shouldSuspendModernViewportFocusSync()) {
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
        this.boundHomeMouseDownHandler = () => {
          this.markUserInteractionSinceHomePaint();
        };
      }
      if (!this.boundHomeMouseOverHandler) {
        this.boundHomeMouseOverHandler = (event) => {
          const target = event?.target?.closest?.(".home-main .home-content-card.focusable");
          if (!target || !this.container?.contains(target) || target.classList.contains("focused")) {
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
        this.boundHomeEventContainer.removeEventListener("mouseover", this.boundHomeMouseOverHandler);
        this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
      }
      this.container.addEventListener("focusin", this.boundHomeFocusInHandler);
      this.container.addEventListener("click", this.boundHomeClickHandler);
      this.container.addEventListener("mousedown", this.boundHomeMouseDownHandler);
      this.container.addEventListener("mouseover", this.boundHomeMouseOverHandler);
      this.container.addEventListener("wheel", this.boundHomeWheelHandler, { passive: false });
      this.boundHomeEventContainer = this.container;
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
        this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler);
      }
      this.boundHomeViewport = viewport || null;
      if (!viewport) {
        return;
      }
      if (!this.boundHomeViewportScrollHandler) {
        this.boundHomeViewportScrollHandler = () => {
          if (this.homeViewportScrollFrame) {
            return;
          }
          this.homeViewportScrollFrame = requestAnimationFrame(() => {
            this.homeViewportScrollFrame = 0;
            if (this.shouldSuspendModernViewportFocusSync()) {
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
      viewport.addEventListener("scroll", this.boundHomeViewportScrollHandler, { passive: true });
    }
  };
}
