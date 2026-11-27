/* eslint-disable no-unused-vars */
import * as internals from "./discoverScreen.js";

export function createDiscoverScreenMethods03() {
  const {
    Router,
    PosterOptionsDialogController,
    posterItemFromNode,
    focusWithoutAutoScroll,
    setLegacySidebarExpanded,
    POSTER_HOLD_DELAY_MS,
    actionForPickerKind,
    setContainerScrollTop
  } = internals;

  return {
    openPickerMenu(kind) {
      const options = this.getPickerOptions(kind);
      if (!options.length) return;
      this.openPicker = kind;
      const currentValue = this.getCurrentPickerValue(kind);
      const currentIndex = Math.max(
        0,
        options.findIndex((option) => option.value === currentValue)
      );
      this.pickerOptionIndex = currentIndex;
      this.lastFocusedAction =
        kind === "type" ? "discoverFilterType" : kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre";
      if (!this.updateRenderedPickerRow()) {
        this.requestRender();
      }
    },
    closePickerMenu() {
      if (!this.openPicker) return;
      const action = actionForPickerKind(this.openPicker);
      this.openPicker = null;
      this.closePickerMenuInDom(action);
    },
    isPosterHoldTarget(node) {
      return Boolean(node?.matches?.(".discover-card.seeall-card.focusable[data-action='openDetail']"));
    },
    cancelPendingPosterHold() {
      if (this.pendingPosterHoldTimer) {
        clearTimeout(this.pendingPosterHoldTimer);
        this.pendingPosterHoldTimer = null;
      }
      this.pendingPosterHoldTarget = null;
    },
    hasPendingPosterHold(node) {
      const pending = this.pendingPosterHoldTarget;
      if (!pending || !node) {
        return false;
      }
      return String(node.dataset.focusKey || "") === String(pending.focusKey || "");
    },
    startPendingPosterHold(node) {
      if (!this.isPosterHoldTarget(node)) {
        return false;
      }
      this.cancelPendingPosterHold();
      this.pendingPosterHoldTarget = {
        focusKey: String(node.dataset.focusKey || "")
      };
      this.pendingPosterHoldTimer = setTimeout(() => {
        this.pendingPosterHoldTimer = null;
        const current = this.container?.querySelector(".discover-card.seeall-card.focusable.focused[data-action='openDetail']") || null;
        if (!this.hasPendingPosterHold(current)) {
          return;
        }
        this.pendingPosterHoldTarget.holdTriggered = true;
        void this.openPosterOptionsMenu(current);
      }, POSTER_HOLD_DELAY_MS);
      return true;
    },
    completePendingPosterHold(node, event = null) {
      const pending = this.pendingPosterHoldTarget;
      if (!pending) {
        return false;
      }
      const holdTriggered = Boolean(pending.holdTriggered);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
      const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingPosterHold(node);
      this.cancelPendingPosterHold();
      if (holdTriggered || shouldOpenHoldMenu) {
        if (shouldOpenHoldMenu) {
          void this.openPosterOptionsMenu(node);
        }
        return true;
      }
      if (!this.isPosterHoldTarget(node)) {
        return false;
      }
      this.openDetailFromNode(node);
      return true;
    },
    async openPosterOptionsMenu(node) {
      const item = posterItemFromNode(node, this.selectedType || "movie");
      if (!item?.id) {
        return false;
      }
      this.captureViewState();
      this.lastFocusedKey = String(node.dataset.focusKey || this.lastFocusedKey || "");
      this.lastFocusedDiscoverItemId = String(node.dataset.itemId || "");
      this.pendingPosterOptionsFocusKey = String(node.dataset.focusKey || "");
      if (!this.posterOptionsController) {
        this.posterOptionsController = new PosterOptionsDialogController({
          onDetails: (target) => {
            Router.navigate("detail", {
              itemId: target.id,
              itemType: target.type || "movie",
              fallbackTitle: target.title || "Untitled",
              fallbackPoster: target.poster || "",
              fallbackBackground: target.background || "",
              addonBaseUrl: target.addonBaseUrl || "",
              addonId: target.addonId || "",
              addonName: target.addonName || "",
              catalogType: target.catalogType || target.type || "movie"
            });
          },
          onDismiss: () => {
            this.lastFocusedKey = this.pendingPosterOptionsFocusKey || this.lastFocusedKey;
            this.pendingPosterOptionsFocusKey = "";
            this.pendingRestoreFocus = true;
            this.preserveViewportOnNextRender = true;
            this.requestRender();
          },
          onChanged: () => {
            void this.refreshWatchedTitleIds().then(() => {
              if (!this.container || Router.getCurrent() !== "discover") {
                return;
              }
              this.requestRender();
            });
          }
        });
      }
      this.suppressHoldMenuEnterUntilKeyUp = true;
      return this.posterOptionsController.open(item, {
        focusKey: node.dataset.focusKey || "",
        itemIndex: Number(node.dataset.itemIndex || -1)
      });
    },
    closePosterOptionsMenu() {
      if (!this.posterOptionsController?.dialog) {
        return false;
      }
      this.posterOptionsController.destroy();
      return true;
    },
    openDetailFromNode(node) {
      if (!node) {
        return false;
      }
      this.savedScrollTop = this.container?.querySelector(".discover-main")?.scrollTop || 0;
      this.lastFocusedKey = String(node.dataset.focusKey || this.lastFocusedKey || "");
      this.lastFocusedDiscoverItemId = String(node.dataset.itemId || "");
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled",
        fallbackPoster: node.dataset.posterSrc || "",
        fallbackBackground: node.dataset.backdropSrc || "",
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogType: node.dataset.catalogType || node.dataset.itemType || "movie"
      });
      return true;
    },
    movePickerIndex(delta) {
      const options = this.getPickerOptions(this.openPicker);
      if (!options.length) return;
      const next = this.pickerOptionIndex + delta;
      this.pickerOptionIndex = Math.min(options.length - 1, Math.max(0, next));
      this.refreshOpenPickerMenuState();
    },
    refreshOpenPickerMenuState() {
      if (!this.openPicker) {
        return;
      }
      const options = Array.from(this.container?.querySelectorAll(".library-picker.open .library-picker-option") || []);
      if (!options.length) {
        this.requestRender();
        return;
      }
      const selectedValue = this.getCurrentPickerValue(this.openPicker);
      const pickerOptions = this.getPickerOptions(this.openPicker);
      options.forEach((node, index) => {
        const option = pickerOptions[index] || null;
        const isFocused = index === this.pickerOptionIndex;
        const isSelected = option?.value === selectedValue;
        node.classList.toggle("focused", isFocused);
        node.classList.toggle("selected", isSelected);
        node.setAttribute("aria-selected", isSelected ? "true" : "false");
      });
      this.syncOpenPickerScroll();
    },
    applyOpenPickerOptionFocus() {
      if (!this.openPicker) {
        return false;
      }
      const options = Array.from(
        this.container?.querySelectorAll(`.library-picker.open .library-picker-option.focusable[data-picker="${this.openPicker}"]`) || []
      );
      if (!options.length) {
        return false;
      }
      const focusIndex = Math.max(0, Math.min(options.length - 1, Number(this.pickerOptionIndex || 0)));
      options.forEach((node, index) => node.classList.toggle("focused", index === focusIndex));
      const target = options[focusIndex] || options[0] || null;
      if (!target) {
        return false;
      }
      this.container.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
      this.syncOpenPickerScroll();
      return true;
    },
    isFilterAction(action) {
      return Boolean(this.getKindFromFilterAction(action));
    },
    selectCurrentPickerOption() {
      if (!this.openPicker) return;
      const kind = this.openPicker;
      const options = this.getPickerOptions(kind);
      const option = options[this.pickerOptionIndex] || null;
      const currentValue = this.getCurrentPickerValue(kind);
      const hasChanged = Boolean(option) && option.value !== currentValue;
      this.lastFocusedAction = actionForPickerKind(kind);
      this.lastFocusedKey = null;
      this.lastFocusedDiscoverItemId = "";
      this.openPicker = null;
      if (!hasChanged) {
        this.closePickerMenuInDom(this.lastFocusedAction);
        return;
      }
      if (option) {
        this.setPickerValue(kind, option.value);
      }
      this.closePickerMenuInDom(this.lastFocusedAction);
    },
    focusFilter(action) {
      const target = this.container?.querySelector(`.discover-filter[data-action="${action}"]`) || null;
      if (!target) return;
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      this.focusZone = "content";
      focusWithoutAutoScroll(target);
      this.scrollContentToTop();
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, false);
      }
      this.lastFocusedAction = action;
    },
    moveFilterFocus(delta) {
      const filters = ["discoverFilterType", "discoverFilterCatalog", "discoverFilterGenre"];
      const currentAction = this.lastFocusedAction || "discoverFilterType";
      const currentIndex = Math.max(0, filters.indexOf(currentAction));
      const nextIndex = Math.min(filters.length - 1, Math.max(0, currentIndex + delta));
      this.focusFilter(filters[nextIndex]);
    },
    focusNearestFilterFromCard(cardNode) {
      const filters = Array.from(this.container?.querySelectorAll(".discover-filter.focusable") || []);
      if (!filters.length || !cardNode) return false;
      const cardRect = cardNode.getBoundingClientRect();
      const cardCenterX = cardRect.left + cardRect.width / 2;
      let target = null;
      let minDx = Number.POSITIVE_INFINITY;
      filters.forEach((filter) => {
        const rect = filter.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const dx = Math.abs(centerX - cardCenterX);
        if (dx < minDx) {
          minDx = dx;
          target = filter;
        }
      });
      if (!target) return false;
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      this.focusZone = "content";
      focusWithoutAutoScroll(target);
      this.scrollContentToTop();
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, false);
      }
      this.lastFocusedAction = String(target.dataset.action || "discoverFilterType");
      return true;
    },
    captureViewState() {
      const main = this.container?.querySelector(".discover-main");
      if (main) {
        this.savedScrollTop = main.scrollTop;
      }
      const focused = this.container?.querySelector(".seeall-card.focused") || this.container?.querySelector(".discover-card.focused");
      if (focused?.dataset?.focusKey) {
        this.lastFocusedKey = String(focused.dataset.focusKey || "");
      }
      if (focused?.dataset?.itemId) {
        this.lastFocusedDiscoverItemId = String(focused.dataset.itemId || "");
      }
    },
    restoreScrollState() {
      const main = this.container?.querySelector(".discover-main");
      if (main) {
        this.savedScrollTop = setContainerScrollTop(main, this.savedScrollTop, "auto");
      }
    }
  };
}
