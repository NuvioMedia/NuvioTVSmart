/* eslint-disable no-unused-vars */
import * as internals from "./discoverScreen.js";

export function createDiscoverScreenMethods06() {
  const {
    Router,
    ScreenUtils,
    Platform,
    activateLegacySidebarAction,
    getRootSidebarNodes,
    isRootSidebarNode,
    isSelectedSidebarAction,
    setModernSidebarPillIconOnly,
    allowDpadRepeat,
    resetDpadRepeat,
    isUpKey,
    isDownKey,
    isLeftKey,
    isRightKey,
    isEnterKey
  } = internals;

  return {
    bindCardEvents() {
      this.container?.querySelectorAll(".seeall-card.focusable").forEach((node) => {
        if (node.__boundDiscoverCardHandlers) return;
        node.__boundDiscoverCardHandlers = true;
        node.addEventListener("focus", () => {
          this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
          this.lastFocusedDiscoverItemId = String(node.dataset.itemId || this.lastFocusedDiscoverItemId || "");
          this.savedScrollTop = this.container?.querySelector(".discover-main")?.scrollTop || 0;
          this.scheduleDiscoverPosterHydration();
        });
        node.addEventListener("mouseenter", () => {
          this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
          this.lastFocusedDiscoverItemId = String(node.dataset.itemId || this.lastFocusedDiscoverItemId || "");
        });
      });
    },
    bindShellEvents() {
      const scroller = this.getContentScroller();
      if (!scroller || scroller.__discoverScrollBound) {
        return;
      }
      scroller.__discoverScrollBound = true;
      scroller.addEventListener(
        "scroll",
        () => {
          this.savedScrollTop = Number(scroller.scrollTop || 0);
          this.scheduleDiscoverPosterHydration();
          if (this.shouldAutoLoadMoreFromScroll(scroller)) {
            if (this.maybeExpandRenderedItems(this.renderedItemsLimit - 1)) {
              this.updateRenderedDiscoverResults();
            }
          }
          if (this.shouldAutoLoadMoreFromScroll(scroller)) {
            this.loadNextPage({ preserveViewport: true });
          }
        },
        { passive: true }
      );
    },
    bindPointerEvents() {
      if (!this.container || this.container.__discoverPointerBound) return;
      this.container.__discoverPointerBound = true;

      this.container.addEventListener("click", (event) => {
        const isKeyboardClick = Number(event?.detail || 0) === 0;
        const optionNode = event.target?.closest?.(".library-picker-option");
        if (optionNode && this.openPicker) {
          if (isKeyboardClick) {
            return;
          }
          const optionIndex = Number(optionNode.dataset.optionIndex || -1);
          if (optionIndex >= 0) {
            this.pickerOptionIndex = optionIndex;
            this.selectCurrentPickerOption();
            return;
          }
        }

        const filterNode = event.target?.closest?.(".discover-filter");
        if (filterNode) {
          if (isKeyboardClick) {
            return;
          }
          const action = String(filterNode.dataset.action || "");
          this.focusFilter(action);
          if (action === "discoverFilterType") this.openPickerMenu("type");
          if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
          if (action === "discoverFilterGenre") this.openPickerMenu("genre");
          return;
        }

        const cardNode = event.target?.closest?.(".discover-card");
        if (cardNode) {
          this.openDetailFromNode(cardNode);
        }
      });
    },
    async onKeyDown(event) {
      if (Platform.isBackEvent(event)) {
        event?.preventDefault?.();
        if (this.closePosterOptionsMenu()) {
          Router.suppressNextPopstate?.();
          return;
        }
        if (this.openPicker) {
          this.closePickerMenu();
          Router.suppressNextPopstate?.();
          return;
        }
        if (this.isSidebarRootRoute()) {
          if (this.focusZone === "sidebar") {
            Platform.exitApp();
          } else {
            await this.openSidebar();
          }
          return;
        }
        await Router.back();
        return;
      }

      const current = this.container.querySelector(".focusable.focused");
      const code = Number(event?.keyCode || 0);
      if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        return;
      }
      const currentAction = String(current?.dataset?.action || "");
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        if (isDownKey(event)) {
          this.pillIconOnly = true;
          setModernSidebarPillIconOnly(this.container, true);
        } else if (isUpKey(event)) {
          this.pillIconOnly = false;
          setModernSidebarPillIconOnly(this.container, false);
        }
      }

      if (this.focusZone === "sidebar") {
        const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
        if (isUpKey(event) || isDownKey(event) || isRightKey(event)) {
          event?.preventDefault?.();
        }
        if (isUpKey(event) || isDownKey(event)) {
          const focusedIndex = Math.max(0, nodes.indexOf(current));
          const nextIndex = Math.max(0, Math.min(nodes.length - 1, focusedIndex + (isUpKey(event) ? -1 : 1)));
          this.focusSidebarNode(nodes[nextIndex] || current);
          return;
        }
        if (isRightKey(event)) {
          await this.closeSidebarToContent();
          return;
        }
        if (isEnterKey(event) && current && isRootSidebarNode(current)) {
          event?.preventDefault?.();
          const action = String(current.dataset.action || "");
          activateLegacySidebarAction(action, "discover");
          if (isSelectedSidebarAction(action, "discover")) {
            await this.closeSidebarToContent();
          }
          return;
        }
      }

      const focusedFilterKind = this.getKindFromFilterAction(currentAction);
      if (isEnterKey(event) && focusedFilterKind) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.openPickerMenu(focusedFilterKind);
        return;
      }

      if (code === 13 && this.isPosterHoldTarget(current)) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingPosterHold(current)) {
          this.startPendingPosterHold(current);
        }
        return;
      }
      if (isUpKey(event) || isDownKey(event) || isLeftKey(event) || isRightKey(event)) {
        event?.preventDefault?.();
      }

      const activeFastScroll = this.discoverVerticalFastScrollState || null;
      const requestedFastScrollDirection = isDownKey(event) ? 1 : isUpKey(event) ? -1 : 0;
      if (
        activeFastScroll &&
        (isLeftKey(event) ||
          isRightKey(event) ||
          (!event?.repeat && requestedFastScrollDirection !== 0 && requestedFastScrollDirection !== activeFastScroll.direction))
      ) {
        this.endDiscoverVerticalFastScroll({ land: true });
      }

      if (
        currentAction === "openDetail" &&
        event?.repeat &&
        requestedFastScrollDirection !== 0 &&
        this.startDiscoverVerticalFastScroll(requestedFastScrollDirection)
      ) {
        return;
      }

      if (
        currentAction === "openDetail" &&
        (isLeftKey(event) || isRightKey(event)) &&
        !allowDpadRepeat(this, event, { horizontalMs: 80, verticalMs: 112 })
      ) {
        return;
      }

      if (this.openPicker) {
        if (isUpKey(event)) {
          this.movePickerIndex(-1);
          return;
        }
        if (isDownKey(event)) {
          this.movePickerIndex(1);
          return;
        }
        if (isEnterKey(event)) {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
          this.selectCurrentPickerOption();
          return;
        }
        if (isLeftKey(event) || isRightKey(event)) {
          const movingRight = isRightKey(event);
          this.openPicker = null;
          this.moveFilterFocus(movingRight ? 1 : -1);
          this.closePickerMenuInDom(this.lastFocusedAction);
          return;
        }
        return;
      }

      if (currentAction === "openDetail" && current?.dataset?.itemId) {
        this.lastFocusedKey = String(current.dataset.focusKey || this.lastFocusedKey || "");
        this.lastFocusedDiscoverItemId = String(current.dataset.itemId || "");
      }

      if (focusedFilterKind) {
        if (isLeftKey(event)) {
          if (currentAction === "discoverFilterType") {
            await this.openSidebar();
            return;
          }
          this.moveFilterFocus(-1);
          return;
        }
        if (isRightKey(event)) {
          this.moveFilterFocus(1);
          return;
        }
        if (isDownKey(event)) {
          this.focusFirstContentCard();
          return;
        }
      }

      if (currentAction === "openDetail") {
        if (isLeftKey(event) && Number(current.dataset.navCol || 0) === 0) {
          event?.preventDefault?.();
          await this.openSidebar();
          return;
        }
        if (isUpKey(event) && Number(current.dataset.navRow || 0) === 0) {
          event?.preventDefault?.();
          this.focusNearestFilterFromCard(current);
          return;
        }
        if (this.handleGridDpad(event)) {
          return;
        }
      }

      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }

      if (!isEnterKey(event)) return;
      if (!current) return;
      const action = String(current.dataset.action || "");
      this.lastFocusedAction = action;

      if (action === "discoverFilterType") this.openPickerMenu("type");
      if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
      if (action === "discoverFilterGenre") this.openPickerMenu("genre");
      if (action === "openDetail") {
        this.openDetailFromNode(current);
      }
    },
    onKeyUp(event) {
      const keyCode = Number(event?.keyCode || 0);
      if ([37, 38, 39, 40].includes(keyCode)) {
        resetDpadRepeat(this);
      }
      if (keyCode === 38 || keyCode === 40) {
        const releasedDirection = keyCode === 40 ? 1 : -1;
        if (this.discoverVerticalFastScrollState?.direction === releasedDirection) {
          this.endDiscoverVerticalFastScroll({ land: true });
        }
      }
      if (this.suppressHoldMenuEnterUntilKeyUp) {
        this.suppressHoldMenuEnterUntilKeyUp = false;
        if (Number(event?.keyCode || 0) === 13) {
          event?.preventDefault?.();
          return;
        }
      }
      if (keyCode !== 13) {
        return;
      }
      const current = this.container?.querySelector(".discover-card.seeall-card.focusable.focused[data-action='openDetail']") || null;
      if (this.completePendingPosterHold(current, event)) {
        event?.preventDefault?.();
      }
    },
    consumeBackRequest() {
      if (this.closePosterOptionsMenu()) {
        return true;
      }
      if (this.openPicker) {
        this.closePickerMenu();
        return true;
      }
      return false;
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      resetDpadRepeat(this);
      this.endDiscoverVerticalFastScroll({ land: false });
      this.cancelScheduledRender();
      if (this.discoverPosterHydrationRaf) {
        cancelAnimationFrame(this.discoverPosterHydrationRaf);
        this.discoverPosterHydrationRaf = 0;
      }
      this.clearClosingPicker();
      this.lastRenderedOpenPicker = null;
      this.cancelPendingPosterHold();
      this.posterOptionsMenu = null;
      this.posterOptionsController?.destroy?.({ restoreFocus: false });
      this.posterOptionsController = null;
      this.pendingPosterOptionsFocusKey = "";
      this.suppressHoldMenuEnterUntilKeyUp = false;
      ScreenUtils.hide(this.container);
    }
  };
}
