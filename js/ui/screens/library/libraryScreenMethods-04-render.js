/* eslint-disable no-unused-vars */
import * as internals from "./libraryScreen.js";

export function createLibraryScreenMethods04() {
  const {
    Router,
    ScreenUtils,
    LayoutPreferences,
    PosterOptionsDialogController,
    posterItemFromNode,
    bindRootSidebarEvents,
    getRootSidebarNodes,
    getRootSidebarSelectedNode,
    setLegacySidebarExpanded,
    POSTER_HOLD_DELAY_MS,
    escapeHtml,
    t,
    selectorValue
  } = internals;

  return {
    render() {
      this.cancelScheduledRender();
      this.layoutPrefs = LayoutPreferences.get();
      this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
      const state = this.controller.getState();
      const expandedPicker = state.expandedPicker || null;
      if (this.lastRenderedExpandedPicker && this.lastRenderedExpandedPicker !== expandedPicker) {
        this.startClosingPicker(this.lastRenderedExpandedPicker);
      }
      if (expandedPicker && this.closingPicker === expandedPicker) {
        this.clearClosingPicker();
      }
      this.lastRenderedExpandedPicker = expandedPicker;
      const posterWidth = 252;
      const posterRadius = 24;
      const libraryStyle = `--library-poster-width:${posterWidth}px;--library-poster-height:${Math.round(posterWidth * 1.5)}px;--library-poster-radius:${posterRadius}px;`;
      const hasLibraryItems = Array.isArray(state.allItems) && state.allItems.length > 0;
      if (state.viewMode !== "servers" && (state.isLoading || (state.isSyncing && !hasLibraryItems))) {
        this.renderLoading();
        ScreenUtils.indexFocusables(this.container);
        if (!this.layoutPrefs?.modernSidebar) {
          setLegacySidebarExpanded(this.container, false);
        }
        return;
      }

      this.container.innerHTML = `
          <div class="home-shell library-shell${this.libraryRouteEnterPending ? " library-route-enter" : ""}" style="${escapeHtml(libraryStyle)}">
            ${this.renderSidebar()}
            <main class="home-main library-main">
              <section class="library-page">
                <header class="library-page-header">
                  <h1 class="library-page-title">${escapeHtml(t("library_title", {}, "Library"))}</h1>
                  <div class="library-page-source" id="libraryPageSource">${escapeHtml(this.controller.getSourceLabel())}</div>
                </header>

                ${this.renderViewModeTabs(state)}
                ${this.renderPickerGroups(state)}

                ${this.renderLibraryContentArea(state)}
              </section>
            </main>
            ${this.renderManageListsDialog(state)}
            ${this.renderListEditorDialog(state)}
            ${this.renderDeleteDialog(state)}
            ${this.renderCloudFilePickerDialog(state)}
          </div>
        `;
      this.libraryRouteEnterPending = false;

      this.applyNoCssGridPosterLayout();
      this.buildGridRows();
      ScreenUtils.indexFocusables(this.container);
      bindRootSidebarEvents(this.container, {
        currentRoute: "library",
        onSelectedAction: () => this.focusMainNode(),
        onExpandSidebar: () => this.focusSidebarNode()
      });
      if (this.isModalFocusLocked()) {
        return;
      }
      this.restoreFocus();
    },
    isPosterHoldTarget(node) {
      return Boolean(node?.matches?.(".library-grid-card.focusable[data-action='openDetail']"));
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
        const current = this.container?.querySelector(".library-grid-card.focusable.focused[data-action='openDetail']") || null;
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
      void this.activateNode(node);
      return true;
    },
    async openPosterOptionsMenu(node) {
      const item = posterItemFromNode(node, node?.dataset?.itemType || "movie");
      if (!item?.id) {
        return false;
      }
      if (node.dataset.focusKey) {
        this.controller.setFocusedPosterKey(node.dataset.focusKey);
      }
      this.pendingPosterOptionsFocusKey = node.dataset.focusKey || "";
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
            if (this.pendingPosterOptionsFocusKey) {
              this.controller.setFocusedPosterKey(this.pendingPosterOptionsFocusKey);
            }
            this.pendingPosterOptionsFocusKey = "";
            this.render();
          },
          onChanged: () => {
            void this.controller.reload({ preserveOverlay: true });
          }
        });
      }
      this.suppressHoldMenuEnterUntilKeyUp = true;
      return this.posterOptionsController.open(item, {
        focusKey: node.dataset.focusKey || ""
      });
    },
    closePosterOptionsMenu() {
      if (!this.posterOptionsController?.dialog) {
        return false;
      }
      this.posterOptionsController.destroy();
      return true;
    },
    getMainFocusSelector(node) {
      if (!node) {
        return "";
      }
      if (node.dataset.focusKey) {
        return `.focusable[data-focus-key="${selectorValue(node.dataset.focusKey)}"]`;
      }
      if (node.dataset.action === "togglePicker" && node.dataset.picker) {
        return `.library-picker-anchor[data-picker="${selectorValue(node.dataset.picker)}"]`;
      }
      if (node.dataset.action) {
        return `.focusable[data-action="${selectorValue(node.dataset.action)}"]`;
      }
      return "";
    },
    resolveLastMainFocus() {
      const selector = this.getMainFocusSelector(this.lastMainFocus);
      return (
        (selector ? this.container?.querySelector(selector) : null) ||
        this.container?.querySelector(".library-picker-anchor.focusable") ||
        this.container?.querySelector(".library-grid-card.focusable") ||
        this.container?.querySelector(".home-main .focusable") ||
        null
      );
    },
    resolveMainEntryFocus() {
      return this.container?.querySelector(".library-picker-row .library-picker-anchor.focusable") || this.resolveLastMainFocus() || null;
    },
    restoreFocus() {
      if (this.isModalFocusLocked()) {
        return;
      }
      const state = this.controller.getState();

      // When the sidebar is the active focus zone, keep focus there across
      // re-renders (e.g. a background library sync) instead of snapping back to
      // the last content item, which visually collapses the open sidebar.
      const sidebarActive =
        this.focusZone === "sidebar" &&
        !state.listEditorState &&
        !state.showDeleteConfirm &&
        !state.showManageDialog &&
        !state.cloudFilePickerItem &&
        !state.expandedPicker;
      if (sidebarActive) {
        const sidebarNode =
          getRootSidebarSelectedNode(this.container, this.layoutPrefs) || getRootSidebarNodes(this.container, this.layoutPrefs)[0] || null;
        if (sidebarNode) {
          this.setFocusedNode(sidebarNode);
          return;
        }
      }

      let selector = null;

      if (state.listEditorState) {
        selector = ".library-list-editor .focusable";
      } else if (state.showDeleteConfirm) {
        selector = ".library-delete-dialog .focusable";
      } else if (state.showManageDialog) {
        selector = state.manageSelectedListKey
          ? `.library-manage-list-button[data-list-key="${selectorValue(state.manageSelectedListKey)}"]`
          : ".library-manage-dialog .focusable";
      } else if (state.cloudFilePickerItem) {
        selector = ".library-cloud-file-dialog .focusable";
      } else if (state.expandedPicker) {
        selector = `.library-picker.open .library-picker-option[data-option-index="${Number(state.pickerFocusIndex || 0)}"]`;
      } else if (this.pendingPickerRestore) {
        selector = `.library-picker-anchor[data-picker="${selectorValue(this.pendingPickerRestore)}"]`;
      } else if (this.pendingCloudSearchFocus) {
        selector = ".library-cloud-search-input.focusable";
      } else if (this.lastMainFocus?.matches?.(".library-picker-anchor")) {
        selector = this.getMainFocusSelector(this.lastMainFocus);
      } else if (this.lastMainFocus?.dataset?.action && !this.lastMainFocus.dataset.focusKey) {
        selector = this.getMainFocusSelector(this.lastMainFocus);
      } else if (state.lastFocusedPosterKey) {
        selector = `.library-grid-card[data-focus-key="${selectorValue(state.lastFocusedPosterKey)}"]`;
      } else {
        selector = null;
      }

      const actionRestoreTarget = this.pendingActionRestore
        ? this.container?.querySelector(`.focusable[data-action="${selectorValue(this.pendingActionRestore)}"]`)
        : null;
      const target =
        (selector ? this.container?.querySelector(selector) : null) ||
        actionRestoreTarget ||
        (this.focusZone === "sidebar" ? getRootSidebarSelectedNode(this.container, this.layoutPrefs) : null) ||
        (this.focusZone === "content" ? this.resolveLastMainFocus() : null) ||
        this.container?.querySelector(".library-primary.focusable") ||
        getRootSidebarSelectedNode(this.container, this.layoutPrefs) ||
        this.container?.querySelector(".focusable");
      if (!target) {
        return;
      }
      this.setFocusedNode(target);
      if (this.pendingCloudSearchFocus) {
        this.pendingCloudSearchFocus = false;
      }
      if (this.pendingPickerRestore) {
        this.pendingPickerRestore = null;
      }
      if (this.pendingActionRestore && target === actionRestoreTarget) {
        this.pendingActionRestore = null;
      }
    },
    getFocusScopeSelector() {
      const state = this.controller.getState();
      if (state.listEditorState) {
        return ".library-list-editor .focusable";
      }
      if (state.showDeleteConfirm) {
        return ".library-delete-dialog .focusable";
      }
      if (state.showManageDialog) {
        return ".library-manage-dialog .focusable";
      }
      if (state.cloudFilePickerItem) {
        return ".library-cloud-file-dialog .focusable";
      }
      if (state.expandedPicker) {
        return ".library-picker.open .focusable";
      }
      if (this.focusZone === "sidebar") {
        return ".home-sidebar .focusable, .modern-sidebar-panel .focusable";
      }
      return ".home-main .focusable";
    },
    getScopedFocusedNode() {
      const scopeSelector = String(this.getFocusScopeSelector() || "").trim();
      if (!scopeSelector) {
        return this.container?.querySelector(".focusable.focused") || null;
      }
      return (
        Array.from(this.container?.querySelectorAll(scopeSelector) || []).find((node) => node.classList?.contains("focused")) ||
        this.container?.querySelector(".focusable.focused") ||
        null
      );
    },
    resolvePreferredActionsRowNode() {
      const buttons = Array.from(this.container?.querySelectorAll(".library-actions-row .focusable") || []);
      if (!buttons.length) {
        return null;
      }
      return (
        buttons.find((node) => String(node.dataset.action || "") === this.lastActionsRowAction && !node.disabled) ||
        buttons.find((node) => !node.disabled) ||
        buttons[0] ||
        null
      );
    }
  };
}
