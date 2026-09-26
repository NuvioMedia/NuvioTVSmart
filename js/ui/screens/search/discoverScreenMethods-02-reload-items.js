/* eslint-disable no-unused-vars */
import * as internals from "./discoverScreen.js";

export function createDiscoverScreenMethods02() {
  const { Router, ScreenUtils, catalogRepository, focusWithoutAutoScroll, formatAddonTypeLabel } = internals;

  return {
    async reloadItems({ suppressLoadingRender = false, preserveExistingItems = false, partialRender = false } = {}) {
      const selectedCatalog = this.getSelectedCatalog();
      this.captureViewState();
      this.nextSkip = 0;
      this.hasMore = true;
      this.renderedItemsLimit = 40;
      this.loading = true;
      this.lastFocusedKey = null;
      this.lastFocusedDiscoverItemId = "";
      this.pendingRestoreFocus = false;
      this.savedScrollTop = 0;
      if (!preserveExistingItems) {
        this.items = [];
      }
      if (!suppressLoadingRender && !this.suppressInitialLoadingRenders) {
        this.requestRender();
      }
      if (!selectedCatalog) {
        this.loading = false;
        this.hasMore = false;
        this.suppressInitialLoadingRenders = false;
        if (partialRender) {
          this.updateRenderedDiscoverResults();
        } else {
          this.requestRender();
        }
        return;
      }

      this.loading = false;
      await this.loadNextPage({
        restoreFocusToGrid: false,
        suppressLoadingRender,
        replaceExistingItems: preserveExistingItems,
        partialRender
      });
    },
    async loadNextPage({
      restoreFocusToGrid = true,
      preserveViewport = false,
      suppressLoadingRender = false,
      replaceExistingItems = false,
      partialRender = false
    } = {}) {
      if (this.loading || !this.hasMore) {
        return;
      }

      const token = this.loadToken;
      const selectedCatalog = this.getSelectedCatalog();
      if (!selectedCatalog) {
        this.hasMore = false;
        if (partialRender) {
          this.updateRenderedDiscoverResults();
        } else {
          this.requestRender();
        }
        return;
      }

      this.loading = true;
      this.captureViewState();
      this.pendingRestoreFocus = Boolean(restoreFocusToGrid);
      this.preserveViewportOnNextRender = Boolean(preserveViewport);
      if (!suppressLoadingRender && !preserveViewport && !this.suppressInitialLoadingRenders) {
        this.requestRender();
      }

      const extraArgs = {};
      if (this.selectedGenre && this.selectedGenre !== "Default") {
        extraArgs.genre = this.selectedGenre;
      }

      const skip = Math.max(0, Number(this.nextSkip || 0));
      const result = await catalogRepository.getCatalog({
        addonBaseUrl: selectedCatalog.addonBaseUrl,
        addonId: selectedCatalog.addonId,
        addonName: selectedCatalog.addonName,
        catalogId: selectedCatalog.catalogId,
        catalogName: selectedCatalog.catalogName,
        type: selectedCatalog.type,
        skip,
        skipStep: selectedCatalog.skipStep,
        extraArgs,
        supportsSkip: selectedCatalog.supportsSkip !== false
      });

      if (token !== this.loadToken) return;
      if (result.status !== "success") {
        this.loading = false;
        this.hasMore = false;
        this.preserveViewportOnNextRender = false;
        this.suppressInitialLoadingRenders = false;
        if (partialRender) {
          this.updateRenderedDiscoverResults();
        } else {
          this.requestRender();
        }
        return;
      }

      const incoming = Array.isArray(result?.data?.items) ? result.data.items : [];
      let addedCount = 0;
      if (replaceExistingItems) {
        this.items = [];
      } else if (!this.items.length) {
        this.items = [];
      }
      const reportedNextSkip = Number(result?.data?.nextSkip);
      if (incoming.length || (selectedCatalog.supportsSkip !== false && result?.data?.hasMore)) {
        const seen = new Set(this.items.map((item) => item.id));
        incoming.forEach((item) => {
          if (!item?.id || seen.has(item.id)) {
            return;
          }
          seen.add(item.id);
          this.items.push(item);
          addedCount += 1;
        });
        this.nextSkip =
          Number.isFinite(reportedNextSkip) && reportedNextSkip > skip
            ? Math.trunc(reportedNextSkip)
            : skip + (incoming.length || selectedCatalog.skipStep || 100);
      }
      this.hasMore = selectedCatalog.supportsSkip !== false && Boolean(result?.data?.hasMore);
      this.loading = false;
      if (!this.lastFocusedKey && this.items[0]?.id) {
        this.lastFocusedKey = `item:${this.items[0].id}`;
        this.lastFocusedDiscoverItemId = String(this.items[0].id);
      }
      this.pendingRestoreFocus = Boolean(restoreFocusToGrid);
      this.preserveViewportOnNextRender = Boolean(preserveViewport && addedCount > 0);
      this.suppressInitialLoadingRenders = false;
      void this.refreshWatchedTitleIds(this.items).then(() => {
        if (token === this.loadToken && Router.getCurrent() === "discover") {
          this.requestRender();
        }
      });
      if (partialRender) {
        this.updateRenderedDiscoverResults();
      } else {
        this.requestRender();
      }
    },
    shouldAutoLoadMore(index) {
      if (this.loading || !this.hasMore) {
        return false;
      }
      const remaining = this.items.length - 1 - Number(index || 0);
      return remaining <= 10;
    },
    shouldAutoLoadMoreFromScroll(scroller) {
      if (!(scroller instanceof HTMLElement) || this.loading || !this.hasMore) {
        return false;
      }
      const remaining = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
      return remaining <= 640;
    },
    getPickerOptions(kind) {
      if (kind === "type") {
        return this.typeOptions.map((value) => ({
          value,
          label: formatAddonTypeLabel(value)
        }));
      }
      if (kind === "catalog") {
        return this.catalogOptions.map((entry) => ({
          value: entry.key,
          label: entry.catalogName || "Select"
        }));
      }
      if (kind === "genre") {
        return this.genreOptions.map((value) => ({
          value,
          label: value
        }));
      }
      return [];
    },
    getCurrentPickerValue(kind) {
      if (kind === "type") return this.selectedType;
      if (kind === "catalog") return this.selectedCatalogKey;
      if (kind === "genre") return this.selectedGenre || "Default";
      return "";
    },
    setPickerValue(kind, value) {
      if (kind === "type") {
        if (!value || value === this.selectedType) return;
        this.selectedType = value;
        this.updateCatalogOptions();
        this.reloadItems({
          suppressLoadingRender: true,
          preserveExistingItems: true,
          partialRender: true
        });
        return;
      }
      if (kind === "catalog") {
        if (!value || value === this.selectedCatalogKey) return;
        this.selectedCatalogKey = value;
        this.updateGenreOptions();
        this.reloadItems({
          suppressLoadingRender: true,
          preserveExistingItems: true,
          partialRender: true
        });
        return;
      }
      if (kind === "genre") {
        const safeValue = value || "Default";
        if (safeValue === this.selectedGenre) return;
        this.selectedGenre = safeValue;
        this.reloadItems({
          suppressLoadingRender: true,
          preserveExistingItems: true,
          partialRender: true
        });
      }
    },
    syncRenderedFilterValues() {
      const valueByKind = {
        type: formatAddonTypeLabel(this.selectedType),
        catalog: this.getSelectedCatalog()?.catalogName || "Select",
        genre: this.selectedGenre || "Default"
      };
      Object.entries(valueByKind).forEach(([kind, value]) => {
        const node = this.container?.querySelector(`.library-picker-anchor[data-picker="${kind}"] .library-picker-value`);
        if (node instanceof HTMLElement) {
          node.textContent = value;
        }
      });
    },
    closePickerMenuInDom(focusAction = "") {
      if (!this.container) {
        return;
      }
      this.lastRenderedOpenPicker = null;
      this.clearClosingPicker();
      Array.from(this.container.querySelectorAll(".discover-picker-row .library-picker")).forEach((node) => {
        node.classList.remove("open", "closing");
        const menu = node.querySelector(".library-picker-menu");
        if (menu) {
          menu.remove();
        }
      });
      Array.from(this.container.querySelectorAll(".discover-picker-row .library-picker-anchor")).forEach((node) => {
        node.setAttribute("aria-expanded", "false");
      });
      this.syncRenderedFilterValues();
      const target = focusAction ? this.container.querySelector(`.discover-filter[data-action="${focusAction}"]`) : null;
      if (target instanceof HTMLElement) {
        this.container.querySelectorAll(".focusable.focused").forEach((node) => {
          if (node !== target) {
            node.classList.remove("focused");
          }
        });
        target.classList.add("focused");
        focusWithoutAutoScroll(target);
      }
    },
    updateRenderedDiscoverResults() {
      if (!this.container || !this.container.querySelector(".discover-shell")) {
        this.requestRender();
        return;
      }
      const selectedCatalog = this.getSelectedCatalog();
      const subtitleNode = this.container.querySelector("#discoverContextLabel");
      if (subtitleNode instanceof HTMLElement) {
        subtitleNode.textContent = this.getDiscoverContextLabel(selectedCatalog);
      }
      const gridNode = this.container.querySelector("#discoverGridMount");
      if (gridNode instanceof HTMLElement) {
        gridNode.innerHTML = this.renderDiscoverCards(selectedCatalog);
      }
      const loadingNode = this.container.querySelector("#discoverLoadingMount");
      if (loadingNode instanceof HTMLElement) {
        loadingNode.innerHTML = this.renderDiscoverLoadingMarkup();
      }

      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      this.bindCardEvents();
      this.scheduleDiscoverPosterHydration();

      if (this.isSidebarRootRoute() && this.focusZone === "sidebar") {
        this.focusSidebarNode();
        return;
      }

      const focusedFilter = this.container.querySelector(".discover-filter.focused");
      if (focusedFilter instanceof HTMLElement) {
        focusWithoutAutoScroll(focusedFilter);
        this.scrollContentToTop();
        return;
      }

      if (this.pendingRestoreFocus) {
        const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
        this.pendingRestoreFocus = false;
        this.preserveViewportOnNextRender = false;
        this.restoreFocusedCard({ scrollMode });
        this.syncOpenPickerScroll();
        return;
      }
      this.restoreScrollState();
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.preserveViewportOnNextRender = false;
      this.restoreContentFocus({ scrollMode });
      this.syncOpenPickerScroll();
    }
  };
}
