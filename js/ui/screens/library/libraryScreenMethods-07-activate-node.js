import { MediaServerRepository } from "../../../data/mediaserver/mediaServerRepository.js";
/* eslint-disable no-unused-vars */
import * as internals from "./libraryScreen.js";

export function createLibraryScreenMethods07() {
  const {
    Router,
    ScreenUtils,
    Environment,
    Platform,
    activateLegacySidebarAction,
    isSelectedSidebarAction,
    setModernSidebarPillIconOnly,
    allowDpadRepeat,
    resetDpadRepeat,
    t,
    isTextField,
    filterStructureSignature
  } = internals;

  return {
    async activateNode(node) {
      if (!node) {
        return;
      }

      const action = String(node.dataset.action || "");
      if (!action) {
        return;
      }

      if (action === "gotoHome") {
        activateLegacySidebarAction(action, "library");
        if (isSelectedSidebarAction(action, "library")) {
          await this.focusMainNode();
        }
        return;
      }
      if (
        action === "gotoSearch" ||
        action === "gotoDiscover" ||
        action === "gotoLibrary" ||
        action === "gotoPlugin" ||
        action === "gotoSettings" ||
        action === "gotoAccount"
      ) {
        activateLegacySidebarAction(action, "library");
        if (isSelectedSidebarAction(action, "library")) {
          await this.focusMainNode();
        }
        return;
      }
      if (action === "togglePicker") {
        const picker = String(node.dataset.picker || "");
        const state = this.controller.getState();
        this.pendingPickerRestore = state.expandedPicker === picker ? picker : null;
        this.controller.togglePicker(picker);
        return;
      }
      if (action === "openServerLibrary") {
        const connection = MediaServerRepository.connection(node.dataset.connectionId);
        const library = connection?.libraries.find((entry) => entry.id === node.dataset.libraryId && entry.selected);
        if (!connection?.enabled || !library) return;
        await Router.navigate("catalogSeeAll", {
          addonBaseUrl: `nuvio-server://${connection.id}`,
          catalogId: `library-${library.id}`,
          type: library.kind,
          catalogName: library.name,
          addonName: connection.name
        });
        return;
      }
      if (action === "selectLibraryViewMode") {
        await this.controller.selectViewMode(String(node.dataset.viewMode || "saved"));
        return;
      }
      if (action === "toggleHideWatched") {
        const selectedWatchedFilter = this.controller.state.selectedWatchedFilter;
        this.controller.selectWatchedFilter(selectedWatchedFilter === "unwatched" ? "all" : "unwatched");
        return;
      }
      if (action === "refreshCloudLibrary") {
        await this.controller.refreshCloudLibrary();
        return;
      }
      if (action === "clearCloudSearch") {
        this.pendingCloudSearchFocus = true;
        this.controller.setCloudSearchQuery("");
        return;
      }
      if (action === "openCloudItem") {
        const item = this.controller.cloudItemByKey(String(node.dataset.cloudItemKey || ""));
        if (!item) return;
        const files = this.controller.playableFilesForCloudItem(item);
        if (!files.length) {
          this.controller.setTransientMessage(t("cloud_library_no_playable_files", {}, "No playable files"));
        } else if (files.length === 1) {
          await this.playCloudFile(item, files[0]);
        } else {
          this.controller.openCloudFilePicker(item);
        }
        return;
      }
      if (action === "playCloudFile") {
        const item = this.controller.cloudItemByKey(String(node.dataset.cloudItemKey || ""));
        const file = item?.files?.find((entry) => entry.stableKey === String(node.dataset.cloudFileKey || ""));
        if (item && file) await this.playCloudFile(item, file);
        return;
      }
      if (action === "selectPickerOption") {
        const picker = String(node.dataset.picker || "");
        const index = Number(node.dataset.optionIndex || 0);
        this.pendingPickerRestore = picker || null;
        this.focusZone = "content";
        this.partialContentRefresh = {
          picker,
          structureSignature: filterStructureSignature(this.controller.getState())
        };
        this.controller.state = {
          ...this.controller.state,
          pickerFocusIndex: index,
          expandedPicker: picker
        };
        this.controller.selectOpenPickerOption();
        this.closePickerMenuInDom(picker);
        if (picker === "sort") {
          requestAnimationFrame(() => {
            this.container?.querySelector(".home-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
          });
        }
        return;
      }
      if (action === "openDetail") {
        const focusKey = String(node.dataset.focusKey || "");
        if (focusKey) {
          this.controller.setFocusedPosterKey(focusKey);
        }
        Router.navigate("detail", {
          itemId: node.dataset.itemId,
          itemType: node.dataset.itemType || "movie",
          fallbackTitle: node.dataset.itemTitle || "Untitled"
        });
        return;
      }
      if (action === "openManageLists") {
        this.lastActionsRowAction = "openManageLists";
        this.controller.openManageLists();
        return;
      }
      if (action === "refreshLibrary") {
        await this.controller.refreshNow();
        return;
      }
      if (action === "selectManageList") {
        this.controller.selectManageList(String(node.dataset.listKey || ""));
        return;
      }
      if (action === "createList") {
        this.lastPrivacyFocus = "private";
        this.controller.startCreateList();
        return;
      }
      if (action === "editList") {
        const state = this.controller.getState();
        const selected = state.listTabs.find((item) => item.key === state.manageSelectedListKey && item.type === "personal");
        this.lastPrivacyFocus = String(selected?.privacy || "private");
        this.controller.startEditList();
        return;
      }
      if (action === "moveListUp") {
        await this.controller.moveSelectedList("up");
        return;
      }
      if (action === "moveListDown") {
        await this.controller.moveSelectedList("down");
        return;
      }
      if (action === "deleteList") {
        this.controller.promptDeleteList();
        return;
      }
      if (action === "closeManageLists") {
        this.lastActionsRowAction = "openManageLists";
        this.pendingActionRestore = "openManageLists";
        this.controller.closeManageLists();
        return;
      }
      if (action === "selectPrivacy") {
        this.controller.updateEditorField("privacy", String(node.dataset.privacy || "private"));
        return;
      }
      if (action === "saveListEditor") {
        await this.controller.submitEditor();
        return;
      }
      if (action === "cancelListEditor") {
        this.controller.closeEditor();
        return;
      }
      if (action === "confirmDeleteList") {
        await this.controller.deleteSelectedList();
        return;
      }
      if (action === "cancelDeleteList") {
        this.controller.closeDeleteConfirm();
      }
    },
    async onKeyDown(event) {
      if (Environment.isBackEvent(event)) {
        event?.preventDefault?.();
        if (this.closeTopOverlay()) {
          return;
        }
        if (this.focusZone === "sidebar") {
          Platform.exitApp();
        } else {
          await this.focusSidebarNode();
        }
        return;
      }

      if (this.isModalFocusLocked()) {
        return;
      }

      const state = this.controller.state;
      const code = Number(event?.keyCode || 0);
      if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
        event?.preventDefault?.();
        return;
      }
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        if (code === 40) {
          this.pillIconOnly = true;
          setModernSidebarPillIconOnly(this.container, true);
        } else if (code === 38) {
          this.pillIconOnly = false;
          setModernSidebarPillIconOnly(this.container, false);
        }
      }
      const activeNode = document.activeElement;
      if (isTextField(activeNode) && ![37, 38, 39, 40].includes(code)) {
        return;
      }

      const current = this.container?.querySelector(".focusable.focused") || activeNode || null;
      const sidebarLocked =
        state.listEditorState || state.showDeleteConfirm || state.showManageDialog || state.cloudFilePickerItem || state.expandedPicker;

      if (!sidebarLocked && code === 13 && this.isPosterHoldTarget(current)) {
        event?.preventDefault?.();
        if (!event?.repeat && !this.hasPendingPosterHold(current)) {
          this.startPendingPosterHold(current);
        }
        return;
      }

      if (!sidebarLocked && code === 37 && current && this.shouldTransferToSidebar(current)) {
        event?.preventDefault?.();
        await this.focusSidebarNode();
        return;
      }

      if (!sidebarLocked && code === 39 && current && this.isSidebarNode(current)) {
        event?.preventDefault?.();
        await this.focusMainNode();
        return;
      }

      if (!sidebarLocked && this.handleSidebarVerticalNavigation(event, current)) {
        return;
      }

      if (!sidebarLocked && this.handleFilterRowHorizontalNavigation(event, current)) {
        return;
      }

      if (!sidebarLocked && this.handleFilterRowVerticalNavigation(event, current)) {
        return;
      }

      if (!sidebarLocked && this.handleContentRowMemoryNavigation(event, current)) {
        return;
      }

      if (
        !sidebarLocked &&
        current?.matches?.(".library-grid-card.focusable") &&
        !allowDpadRepeat(this, event, { horizontalMs: 80, verticalMs: 80 })
      ) {
        return;
      }

      if (!sidebarLocked && this.handleGridNavigation(event, current)) {
        return;
      }

      if (this.handleManageDialogNavigation(event, current)) {
        return;
      }

      if (state.expandedPicker && (code === 38 || code === 40)) {
        event?.preventDefault?.();
        this.controller.movePickerFocus(code === 38 ? "up" : "down", { silent: true });
        this.applyOpenPickerOptionFocus();
        return;
      }

      if (this.handlePrivacyMemoryNavigation(event, current)) {
        return;
      }

      if (ScreenUtils.handleDpadNavigation(event, this.container, this.getFocusScopeSelector())) {
        const current = this.getScopedFocusedNode();
        if (current) {
          this.setFocusedNode(current);
        }
        return;
      }

      if (code !== 13) {
        return;
      }
      const focused = this.getScopedFocusedNode();
      if (!focused) {
        return;
      }
      event?.preventDefault?.();
      await this.activateNode(focused);
    },
    onKeyUp(event) {
      if ([37, 38, 39, 40].includes(Number(event?.keyCode || 0))) {
        resetDpadRepeat(this);
      }
      if (this.suppressHoldMenuEnterUntilKeyUp) {
        this.suppressHoldMenuEnterUntilKeyUp = false;
        if (Number(event?.keyCode || 0) === 13) {
          event?.preventDefault?.();
          return;
        }
      }
      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }
      const current = this.container?.querySelector(".library-grid-card.focusable.focused[data-action='openDetail']") || null;
      if (this.completePendingPosterHold(current, event)) {
        event?.preventDefault?.();
      }
    }
  };
}
