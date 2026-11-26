/* eslint-disable no-unused-vars */
import * as internals from "./libraryScreen.js";

export function createLibraryScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    LayoutPreferences,
    LibraryController,
    LIBRARY_VIEW_MODE,
    renderContentFilterPicker,
    bindRootSidebarEvents,
    getSidebarProfileState,
    focusWithoutAutoScroll,
    renderRootSidebar,
    setLegacySidebarExpanded,
    renderLoadingIndicator,
    PICKER_MENU_EXIT_MS,
    escapeHtml,
    t,
    scrollIntoNearestView,
    scrollFocusedIntoContainer,
    filterStructureSignature
  } = internals;

  return {
    clearClosingPicker() {
      if (this.closingPickerTimer) {
        clearTimeout(this.closingPickerTimer);
        this.closingPickerTimer = null;
      }
      this.closingPicker = null;
    },
    startClosingPicker(picker) {
      const pickerKey = String(picker || "");
      if (!pickerKey) {
        this.clearClosingPicker();
        return;
      }
      if (this.closingPicker === pickerKey && this.closingPickerTimer) {
        clearTimeout(this.closingPickerTimer);
      }
      this.closingPicker = pickerKey;
      this.closingPickerTimer = setTimeout(() => {
        this.closingPickerTimer = null;
        if (this.closingPicker === pickerKey) {
          this.closingPicker = null;
          this.requestRender();
        }
      }, PICKER_MENU_EXIT_MS);
    },
    cancelScheduledRender() {
      if (this.renderFrame) {
        cancelAnimationFrame(this.renderFrame);
        this.renderFrame = null;
      }
    },
    requestRender() {
      if (!this.container || Router.getCurrent() !== "library") {
        return;
      }
      if (this.renderFrame) {
        return;
      }
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        if (!this.container || Router.getCurrent() !== "library") {
          return;
        }
        this.render();
      });
    },
    handleControllerChange(state = null, change = null) {
      const nextState = state || this.controller?.getState?.() || null;
      const canRefreshLibraryContent =
        nextState &&
        !nextState.isLoading &&
        !nextState.isSyncing &&
        !nextState.showManageDialog &&
        !nextState.listEditorState &&
        !nextState.showDeleteConfirm;

      if (
        change?.reason === "cloudSearch" &&
        nextState?.viewMode === LIBRARY_VIEW_MODE.CLOUD &&
        !nextState.showManageDialog &&
        !nextState.listEditorState &&
        !nextState.showDeleteConfirm &&
        !nextState.cloudFilePickerItem
      ) {
        const searchInput = this.container?.querySelector(".library-cloud-search-input[data-cloud-search]");
        const preserveSearchFocus =
          searchInput && (globalThis.document?.activeElement === searchInput || searchInput.classList.contains("focused"))
            ? searchInput
            : null;
        this.updateRenderedLibraryContent(nextState, {
          preservePickerRow: true,
          preserveFocus: preserveSearchFocus
        });
        return;
      }

      if (change?.reason === "metadataHydration" && canRefreshLibraryContent) {
        if (this.focusZone === "sidebar") {
          this.pendingHydrationState = nextState;
          return;
        }
        this.pendingHydrationState = null;
        this.updateRenderedLibraryContent(nextState, { preservePickerRow: false });
        return;
      }

      this.pendingHydrationState = null;
      const partialRefresh = this.partialContentRefresh;
      if (partialRefresh && canRefreshLibraryContent) {
        this.partialContentRefresh = null;
        this.updateRenderedLibraryContent(nextState, {
          preservePickerRow: partialRefresh.structureSignature === filterStructureSignature(nextState)
        });
        return;
      }
      this.partialContentRefresh = null;
      this.requestRender();
    },
    async mount() {
      this.container = document.getElementById("library");
      ScreenUtils.show(this.container);
      const sidebarProfilePromise = getSidebarProfileState().catch((error) => {
        console.warn("Library sidebar profile failed to load", error);
        return null;
      });
      const controller = new LibraryController((state, change) => this.handleControllerChange(state, change));
      this.controller = controller;
      this.libraryRouteEnterPending = true;
      try {
        this.sidebarProfile = await getSidebarProfileState({ cacheOnly: true });
      } catch (error) {
        console.warn("Library cached sidebar profile failed to load", error);
        this.sidebarProfile = null;
      }
      this.layoutPrefs = LayoutPreferences.get();
      this.sidebarExpanded = false;
      this.pillIconOnly = false;
      this.focusZone = "content";
      this.lastMainFocus = null;
      this.lastActionsRowAction = "openManageLists";
      this.pendingActionRestore = null;
      this.pendingCloudSearchFocus = false;
      this.pendingPickerRestore = null;
      this.closingPicker = null;
      this.closingPickerTimer = null;
      this.lastRenderedExpandedPicker = null;
      this.posterOptionsMenu = null;
      this.posterOptionsController = null;
      this.pendingPosterOptionsFocusKey = "";
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;
      this.gridRows = [];
      this.lastPrivacyFocus = "private";
      this.partialContentRefresh = null;
      this.pendingHydrationState = null;

      this.render();
      this.bindEvents();

      // Android composes the Library surface before repository and watched-state
      // IO completes. The controller keeps its generation guards, so it can
      // hydrate and repaint without holding route completion or D-pad input.
      void controller
        .init()
        .then(() => {
          if (this.controller === controller && Router.getCurrent() === "library") {
            controller.closePicker();
          }
        })
        .catch((error) => {
          if (this.controller === controller && Router.getCurrent() === "library") {
            console.warn("Library initial load failed", error);
          }
        });
      void sidebarProfilePromise.then((profile) => {
        if (profile && this.controller === controller && Router.getCurrent() === "library") {
          // Profile/avatar data is cosmetic. Keep the current library DOM and
          // focused item stable; a later render will consume the refreshed value.
          this.sidebarProfile = profile;
        }
      });
    },
    bindEvents() {
      if (!this.container || this.container.__libraryEventsBound) {
        return;
      }
      this.container.__libraryEventsBound = true;

      this.container.addEventListener("click", async (event) => {
        const target = event.target?.closest?.(".focusable, .library-dialog-input, .library-dialog-textarea");
        if (!target || !this.container.contains(target)) {
          return;
        }
        if (this.isSidebarNode(target)) {
          return;
        }
        if (target.classList.contains("focusable")) {
          this.setFocusedNode(target);
        }
        await this.activateNode(target);
      });

      this.container.addEventListener("input", (event) => {
        const target = event.target;
        if (!target) {
          return;
        }
        if (target.matches(".library-dialog-input[data-editor-field], .library-dialog-textarea[data-editor-field]")) {
          this.controller.updateEditorField(String(target.dataset.editorField || ""), target.value, {
            silent: true
          });
        } else if (target.matches(".library-cloud-search-input[data-cloud-search]")) {
          this.controller.setCloudSearchQuery(target.value, { reason: "cloudSearch" });
        }
      });
    },
    setFocusedNode(target) {
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) {
          node.classList.remove("focused");
        }
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
      const sidebarFocused = this.isSidebarNode(target);
      this.focusZone = sidebarFocused ? "sidebar" : "content";
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, sidebarFocused);
      }
      if (!sidebarFocused) {
        this.lastMainFocus = target;
        const main = this.container?.querySelector(".library-main");
        if (main && main.contains(target) && !target.closest?.(".library-picker-menu")) {
          const topRow = main.querySelector(".library-view-mode-row");
          const isTopRow = topRow ? topRow.contains(target) : target === main.querySelector(".focusable");
          scrollFocusedIntoContainer(main, target, { pad: 56, isTopRow });
        } else {
          scrollIntoNearestView(target);
        }
        if (target.closest?.(".library-actions-row") && target.dataset.action) {
          this.lastActionsRowAction = String(target.dataset.action);
        }
        if (target.closest?.(".library-privacy-row") && target.dataset.privacy) {
          this.lastPrivacyFocus = String(target.dataset.privacy);
        }
      }
      if (target.dataset.focusKey) {
        this.controller.setFocusedPosterKey(target.dataset.focusKey);
      }
    },
    isModalFocusLocked() {
      return Boolean(this.posterOptionsController?.dialog);
    },
    renderLoading() {
      this.container.innerHTML = `
          <div class="home-shell library-shell${this.libraryRouteEnterPending ? " library-route-enter" : ""}">
            ${this.renderSidebar()}
            <main class="home-main library-main">
              <section class="library-loading-state">
                ${renderLoadingIndicator({ className: "library-loading-spinner" })}
                <div class="library-loading-label">${escapeHtml(t("library_syncing_library", {}, "Loading library"))}</div>
              </section>
            </main>
          </div>
        `;
      this.libraryRouteEnterPending = false;
      bindRootSidebarEvents(this.container, {
        currentRoute: "library",
        onSelectedAction: () => this.focusMainNode(),
        onExpandSidebar: () => this.focusSidebarNode()
      });
    },
    renderSidebar() {
      return renderRootSidebar({
        selectedRoute: "library",
        profile: this.sidebarProfile,
        layout: this.layoutPrefs,
        expanded: Boolean(this.sidebarExpanded),
        pillIconOnly: Boolean(this.pillIconOnly)
      });
    },
    renderPicker(picker, title, value, options, widthClass = "") {
      const state = this.controller.getState();
      const isOpen = state.expandedPicker === picker;
      const isClosing = this.closingPicker === picker;
      const currentValue =
        picker === "cloud_provider"
          ? state.selectedCloudProviderId || "__all__"
          : picker === "cloud_type"
            ? state.selectedCloudType || "__all__"
            : picker === "list"
              ? state.selectedListKey
              : picker === "type"
                ? state.selectedTypeKey
                : picker === "genre"
                  ? state.selectedGenre || "__all__"
                  : picker === "year"
                    ? state.selectedYear || "__all__"
                    : picker === "watched"
                      ? state.selectedWatchedFilter
                      : state.selectedSortKey;
      const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === currentValue)
      );
      return renderContentFilterPicker({
        variant: "library",
        picker,
        title,
        value,
        options: isOpen || isClosing ? options : [],
        open: isOpen,
        closing: isClosing,
        focusIndex: Number(state.pickerFocusIndex || 0),
        selectedIndex,
        widthClass,
        targetOptionClass: "library-picker-option-target",
        optionFocusable: isOpen
      });
    }
  };
}
