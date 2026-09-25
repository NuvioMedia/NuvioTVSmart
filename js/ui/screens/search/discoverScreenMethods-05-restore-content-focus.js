/* eslint-disable no-unused-vars */
import * as internals from "./discoverScreen.js";

export function createDiscoverScreenMethods05() {
  const {
    ScreenUtils,
    LayoutPreferences,
    renderContentFilterPicker,
    bindRootSidebarEvents,
    focusWithoutAutoScroll,
    getRootSidebarNodes,
    getRootSidebarSelectedNode,
    renderRootSidebar,
    setModernSidebarExpanded,
    setLegacySidebarExpanded,
    DISCOVER_POSTER_PREFETCH_MARGIN_PX,
    formatAddonTypeLabel,
    escapeHtml,
    scrollNodeIntoContainerView
  } = internals;

  return {
    restoreContentFocus({ scrollMode = "center" } = {}) {
      if (this.openPicker && this.applyOpenPickerOptionFocus()) {
        return true;
      }
      const selector =
        this.lastFocusedAction && this.lastFocusedAction !== "openDetail" ? `.focusable[data-action="${this.lastFocusedAction}"]` : "";
      const filterTarget = this.isFilterAction(this.lastFocusedAction) && selector ? this.container?.querySelector(selector) : null;
      const posterTarget = this.lastFocusedKey
        ? this.container?.querySelector(`.seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`)
        : null;
      const target =
        filterTarget ||
        posterTarget ||
        (selector ? this.container?.querySelector(selector) : null) ||
        (this.lastFocusedDiscoverItemId
          ? this.container?.querySelector(
              `.seeall-card.focusable[data-item-id="${String(this.lastFocusedDiscoverItemId).replace(/["\\]/g, "\\$&")}"]`
            )
          : null) ||
        this.container?.querySelector(".discover-filter.focusable") ||
        this.container?.querySelector(".seeall-card.focusable") ||
        null;
      if (!target) {
        return false;
      }
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      this.focusZone = "content";
      if (target.classList.contains("discover-filter")) {
        focusWithoutAutoScroll(target);
        this.scrollContentToTop();
      } else {
        focusWithoutAutoScroll(target);
        this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
        if (scrollMode !== "none") {
          scrollNodeIntoContainerView(target, this.getContentScroller(), {
            center: scrollMode === "center",
            padding: 20
          });
        }
      }
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, false);
      }
      return true;
    },
    async closeSidebarToContent() {
      this.focusZone = "content";
      if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
        this.sidebarExpanded = false;
        setModernSidebarExpanded(this.container, false);
      } else if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, false);
      }
      return this.restoreContentFocus() || true;
    },
    isSidebarRootRoute() {
      return String(this.layoutPrefs?.discoverLocation || "in_search") === "in_sidebar";
    },
    focusSidebarNode(preferredNode = null) {
      const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      const target = preferredNode || getRootSidebarSelectedNode(this.container, this.layoutPrefs) || nodes[0] || null;
      if (!target) return false;
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
      this.focusZone = "sidebar";
      this.sidebarFocusIndex = Math.max(0, nodes.indexOf(target));
      return true;
    },
    async openSidebar() {
      if (!this.isSidebarRootRoute()) return false;
      this.captureViewState();
      this.focusZone = "sidebar";
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        this.sidebarExpanded = true;
        setModernSidebarExpanded(this.container, true);
      } else if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, true);
      }
      return this.focusSidebarNode();
    },
    getKindFromFilterAction(action) {
      if (action === "discoverFilterType") return "type";
      if (action === "discoverFilterCatalog") return "catalog";
      if (action === "discoverFilterGenre") return "genre";
      return null;
    },
    renderFilterPicker(kind, title, value) {
      const isOpen = this.openPicker === kind;
      const isClosing = this.closingPicker === kind;
      const options = isOpen || isClosing ? this.getPickerOptions(kind) : [];
      const currentValue = this.getCurrentPickerValue(kind);
      const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === currentValue)
      );
      const anchorAction = kind === "type" ? "discoverFilterType" : kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre";
      return renderContentFilterPicker({
        variant: "discover",
        picker: kind,
        title,
        value,
        options,
        open: isOpen,
        closing: isClosing,
        focusIndex: this.pickerOptionIndex,
        selectedIndex,
        widthClass: "library-picker-flex",
        anchorAction,
        optionFocusable: isOpen
      });
    },
    renderPickerRowMarkup() {
      const selectedCatalog = this.getSelectedCatalog();
      return [
        this.renderFilterPicker("type", "Type", formatAddonTypeLabel(this.selectedType)),
        this.renderFilterPicker("catalog", "Catalog", selectedCatalog?.catalogName || "Select"),
        this.renderFilterPicker("genre", "Genre", this.selectedGenre || "Default")
      ].join("");
    },
    renderPickerMarkup(kind) {
      if (kind === "type") {
        return this.renderFilterPicker("type", "Type", formatAddonTypeLabel(this.selectedType));
      }
      if (kind === "catalog") {
        return this.renderFilterPicker("catalog", "Catalog", this.getSelectedCatalog()?.catalogName || "Select");
      }
      if (kind === "genre") {
        return this.renderFilterPicker("genre", "Genre", this.selectedGenre || "Default");
      }
      return "";
    },
    updateRenderedPickerRow() {
      const pickerRow = this.container?.querySelector("#discoverPickerRow");
      if (!(pickerRow instanceof HTMLElement)) {
        return false;
      }

      const pickerKind = this.openPicker;
      const currentPicker = pickerKind
        ? pickerRow.querySelector(`.library-picker-anchor[data-picker="${pickerKind}"]`)?.closest(".library-picker")
        : null;
      if (!(currentPicker instanceof HTMLElement)) {
        return false;
      }

      const previousPicker = pickerRow.querySelector(".library-picker.open");
      if (previousPicker && previousPicker !== currentPicker) {
        // Pointer activation can switch pickers without going through the D-pad
        // close path. Remove the old menu before replacing only the new picker.
        this.closePickerMenuInDom(this.lastFocusedAction);
      }

      if (currentPicker.classList.contains("open") && this.lastRenderedOpenPicker === pickerKind) {
        this.applyOpenPickerOptionFocus();
        this.syncOpenPickerScroll();
        return true;
      }

      currentPicker.outerHTML = this.renderPickerMarkup(pickerKind);
      const renderedPicker = pickerRow.querySelector(`.library-picker-anchor[data-picker="${pickerKind}"]`)?.closest(".library-picker");
      this.lastRenderedOpenPicker = this.openPicker || null;
      // Only the active picker was replaced. Keep the poster grid and the other
      // picker nodes alive, and avoid scanning every card on constrained Tizen.
      if (renderedPicker instanceof HTMLElement) {
        ScreenUtils.indexFocusables(renderedPicker);
      }
      this.restoreContentFocus({ scrollMode: "none" });
      this.syncOpenPickerScroll();
      return true;
    },
    render() {
      this.cancelScheduledRender();
      this.layoutPrefs = LayoutPreferences.get();
      const showRootSidebar = this.isSidebarRootRoute();
      const openPicker = this.openPicker || null;
      if (this.lastRenderedOpenPicker && this.lastRenderedOpenPicker !== openPicker) {
        this.startClosingPicker(this.lastRenderedOpenPicker);
      }
      if (openPicker && this.closingPicker === openPicker) {
        this.clearClosingPicker();
      }
      this.lastRenderedOpenPicker = openPicker;
      const currentFocused = this.container?.querySelector(".focusable.focused");
      const currentFocusedAction = String(currentFocused?.dataset?.action || "");
      if (currentFocusedAction === "openDetail" || this.isFilterAction(currentFocusedAction)) {
        this.lastFocusedAction = currentFocusedAction;
      }

      const selectedCatalog = this.getSelectedCatalog();
      const contextLabel = this.getDiscoverContextLabel(selectedCatalog);
      const cards = this.renderDiscoverCards(selectedCatalog);

      const enterClass = this.discoverRouteEnterPending && !ScreenUtils.shouldSkipRouteEnter(this) ? " nuvio-route-slide-enter" : "";
      this.discoverRouteEnterPending = false;

      this.container.innerHTML = `
          <div class="home-shell search-screen-shell discover-shell${showRootSidebar ? " discover-root-route" : ""}">
            ${
              showRootSidebar
                ? renderRootSidebar({
                    selectedRoute: "discover",
                    profile: this.sidebarProfile,
                    layout: this.layoutPrefs,
                    expanded: Boolean(this.sidebarExpanded),
                    pillIconOnly: Boolean(this.pillIconOnly)
                  })
                : ""
            }
            <main class="home-main discover-main${enterClass}">
              <div class="seeall-shell discover-seeall-shell">
                <header class="seeall-header discover-header">
                  <h2 class="seeall-title">Discover</h2>
                  <div class="seeall-subtitle" id="discoverContextLabel">${escapeHtml(contextLabel)}</div>
                </header>
                <section class="library-picker-row discover-picker-row" id="discoverPickerRow">
                  ${this.renderPickerRowMarkup()}
                </section>
                <section class="seeall-grid discover-grid" id="discoverGridMount">
                  ${cards}
                </section>
                <div id="discoverLoadingMount">${this.renderDiscoverLoadingMarkup()}</div>
              </div>
            </main>
          </div>
        `;

      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      if (showRootSidebar) {
        bindRootSidebarEvents(this.container, {
          currentRoute: "discover",
          onSelectedAction: () => this.closeSidebarToContent(),
          onExpandSidebar: () => this.openSidebar()
        });
      }
      this.bindCardEvents();
      this.bindShellEvents();
      this.bindPointerEvents();
      this.scheduleDiscoverPosterHydration();
      if (this.pendingRestoreFocus) {
        const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
        this.pendingRestoreFocus = false;
        this.preserveViewportOnNextRender = false;
        if (showRootSidebar && this.focusZone === "sidebar") {
          this.focusSidebarNode();
        } else {
          this.restoreFocusedCard({ scrollMode });
        }
        this.syncOpenPickerScroll();
        return;
      }
      this.restoreScrollState();
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.preserveViewportOnNextRender = false;
      if (showRootSidebar && this.focusZone === "sidebar") {
        this.focusSidebarNode();
      } else {
        this.restoreContentFocus({ scrollMode });
      }
      this.syncOpenPickerScroll();
    },
    scheduleDiscoverPosterHydration() {
      if (!this.container || this.discoverPosterHydrationRaf) {
        return;
      }
      if (typeof requestAnimationFrame !== "function") {
        this.hydrateDiscoverPosterImages();
        return;
      }
      this.discoverPosterHydrationRaf = requestAnimationFrame(() => {
        this.discoverPosterHydrationRaf = 0;
        this.hydrateDiscoverPosterImages();
      });
    },
    hydrateDiscoverPosterImages() {
      const scroller = this.getContentScroller();
      if (!scroller) {
        return;
      }
      const viewport = scroller.getBoundingClientRect();
      const margin = DISCOVER_POSTER_PREFETCH_MARGIN_PX;
      this.container?.querySelectorAll(".seeall-card-poster-image[data-src]").forEach((image) => {
        if (!(image instanceof HTMLImageElement) || !image.isConnected) {
          return;
        }
        const rect = image.getBoundingClientRect();
        const isNearViewport =
          rect.bottom >= viewport.top - margin &&
          rect.top <= viewport.bottom + margin &&
          rect.right >= viewport.left - margin &&
          rect.left <= viewport.right + margin;
        if (!isNearViewport) {
          return;
        }
        const src = String(image.dataset.src || "").trim();
        if (!src) {
          image.removeAttribute("data-src");
          return;
        }
        // The app owns the visible-image decision. Do not delegate it to native
        // lazy loading, which can delay posters inside the TV scroll container.
        image.loading = "eager";
        image.removeAttribute("data-src");
        image.src = src;
      });
    }
  };
}
