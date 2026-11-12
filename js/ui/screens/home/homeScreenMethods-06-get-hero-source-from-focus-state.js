import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods06() {
  const {
    watchedItemsShareIdentity,
    LibrarySourceMode,
    buildModernRowKey,
    t,
    normalizeHomeRowItem,
    isPosterWatchedType,
    partitionContinueWatchingRows,
    normalizeContinueWatchingItem,
    isCloudContinueWatchingItem
  } = internals;

  return {
    getHeroSourceFromFocusState(focusState) {
      if (!focusState?.layoutMode) {
        return null;
      }
      if (focusState.focusKind === "hero") {
        return this.heroItem || this.heroCandidates?.[0] || null;
      }
      if (String(focusState.rowKey || "") === "continue_watching" || String(focusState.rowKey || "") === "upcoming_section") {
        const index = Math.max(0, Number(focusState.itemIndex || 0));
        const rows = partitionContinueWatchingRows(this.continueWatchingDisplay || [], this.layoutPrefs?.continueWatchingSortMode);
        const rowItems = String(focusState.rowKey || "") === "upcoming_section" ? rows.upcoming : rows.main;
        return normalizeContinueWatchingItem(rowItems[index] || null);
      }
      const row =
        (this.rows || []).find((entry) => {
          return String(entry?.homeCatalogKey || buildModernRowKey(entry)) === String(focusState.rowKey || "");
        }) || null;
      const item = row?.result?.data?.items?.[Math.max(0, Number(focusState.itemIndex || 0))] || null;
      return normalizeHomeRowItem(row, item);
    },
    getContinueWatchingItemFromNode(node) {
      const index = Number(node?.dataset?.cwIndex ?? -1);
      if (!Number.isFinite(index) || index < 0) {
        return null;
      }
      return normalizeContinueWatchingItem(
        this.continueWatchingRenderedItems?.[index] || this.continueWatchingDisplay?.[index] || this.continueWatching?.[index] || null
      );
    },
    getContinueWatchingMenuItem() {
      const menu = this.continueWatchingMenu;
      if (!menu) {
        return null;
      }
      return normalizeContinueWatchingItem(
        this.continueWatchingDisplay?.find((item) => {
          return (
            String(item?.contentId || "") === String(menu.contentId || "") && String(item?.videoId || "") === String(menu.videoId || "")
          );
        }) ||
          menu.item ||
          null
      );
    },
    isContinueWatchingItemWatched(item) {
      const contentId = String(item?.contentId || "");
      if (!contentId) {
        return false;
      }
      return Boolean((this.watchedItems || []).some((entry) => watchedItemsShareIdentity(entry, item)));
    },
    getContinueWatchingMenuOptions() {
      const item = this.getContinueWatchingMenuItem();
      if (!item) {
        return [];
      }
      const isCloud = isCloudContinueWatchingItem(item);
      const options = [];
      if (!isCloud) {
        options.push({
          action: "details",
          label: t("cw_action_go_to_details", {}, "Go to details")
        });
      }
      if (!isCloud && this.showContinueWatchingManualPlayOption) {
        options.push({ action: "playManually", label: t("play_manually", {}, "Play manually") });
      }
      if (!item.isNextUp) {
        options.push({
          action: "startOver",
          label: t("cw_action_start_from_beginning", {}, "Start from beginning")
        });
      }
      // Android only offers this once the next episode has aired.
      if (!isCloud && (!item.isNextUp || item.hasAired !== false)) {
        options.push({
          action: "markWatched",
          label: t("hero_mark_watched", {}, "Mark as watched")
        });
      }
      options.push({ action: "remove", label: t("cw_action_remove", {}, "Remove") });
      return options;
    },
    renderContinueWatchingMenu() {
      return "";
    },
    getPosterHoldMenuItem() {
      return this.posterHoldMenu?.item || null;
    },
    getPosterHoldMenuOptions() {
      const item = this.getPosterHoldMenuItem();
      if (!item?.id) {
        return [];
      }
      const librarySourceMode = this.posterHoldMenu?.librarySourceMode;
      const isRemoteLibrary = librarySourceMode !== LibrarySourceMode.LOCAL;
      const options = [
        { action: "details", label: t("cw_action_go_to_details", {}, "Go to details") },
        {
          action: isRemoteLibrary ? "manageLists" : "toggleLibrary",
          label: isRemoteLibrary
            ? librarySourceMode === LibrarySourceMode.SIMKL
              ? "Manage Simkl Status"
              : t("library_manage_lists", {}, "Manage Lists")
            : this.posterHoldMenu?.isSaved
              ? t("hero_remove_from_library", {}, "Remove from library")
              : t("hero_add_to_library", {}, "Add to library")
        }
      ];
      if (isPosterWatchedType(item.type)) {
        options.push({
          action: "toggleWatched",
          label: this.posterHoldMenu?.isWatched
            ? t("hero_mark_unwatched", {}, "Mark as unwatched")
            : t("hero_mark_watched", {}, "Mark as watched")
        });
      }
      return options;
    },
    renderPosterHoldMenu() {
      return "";
    },
    renderActiveHoldMenu() {
      return "";
    },
    destroyHomeHoldDialog({ afterExit = null } = {}) {
      const dialog = this._homeHoldDialog;
      this._homeHoldDialog = null;
      if (dialog) {
        dialog.destroy({ afterExit });
      } else if (typeof afterExit === "function") {
        afterExit();
      }
    },
    dismissContinueWatchingMenu() {
      this._homeHoldDialog = null;
      if (this.continueWatchingMenu) {
        this.pendingContinueWatchingFocusIndex = Math.max(0, Number(this.continueWatchingMenu.index || 0));
        this.pendingContinueWatchingFocusRowKey = String(this.continueWatchingMenu.rowKey || "continue_watching");
      }
      this.continueWatchingMenu = null;
      this.restoreContinueWatchingMenuFocus();
      this.holdMenuScrollState = null;
    },
    dismissPosterHoldMenu() {
      this._homeHoldDialog = null;
      if (this.posterHoldMenu) {
        this.pendingPosterHoldFocus = {
          rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
          index: Number(this.posterHoldMenu.index || 0),
          rowKey: String(this.posterHoldMenu.rowKey || ""),
          itemId: String(this.posterHoldMenu.item?.id || "")
        };
      }
      this.posterHoldMenu = null;
      this.restorePosterHoldMenuFocus();
      this.holdMenuScrollState = null;
    },
    lockHomeHoldFocus() {
      this.homeHoldFocusLocked = true;
      const current = this.getCurrentFocusedNode();
      if (current?.isConnected) {
        current.classList.remove("focused");
      }
      if (document.activeElement instanceof HTMLElement && this.container?.contains(document.activeElement)) {
        try {
          document.activeElement.blur();
        } catch (_) {}
      }
      this.setCurrentFocusedNode(null);
    },
    unlockHomeHoldFocus() {
      this.homeHoldFocusLocked = false;
    },
    captureHoldMenuScrollState() {
      const viewport = this.getHomeViewport();
      if (!viewport) {
        return null;
      }
      const trackStates = Object.fromEntries(
        Array.from(this.container?.querySelectorAll("[data-track-row-key]") || [])
          .map((track) => [String(track.dataset.trackRowKey || ""), Number(track.scrollLeft || 0)])
          .filter(([key]) => key)
      );
      return {
        mainScrollTop: Number(viewport.scrollTop || 0),
        trackStates
      };
    },
    restoreHoldMenuScrollState() {
      const state = this.holdMenuScrollState;
      const viewport = this.getHomeViewport();
      if (!state || !viewport) {
        return false;
      }
      this.prepareHomeRowsForRestore(state);
      Object.entries(state.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
        const track = this.container?.querySelector(`[data-track-row-key="${rowKey}"]`);
        if (track) {
          track.scrollLeft = Number(scrollLeft || 0);
        }
      });
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(state.mainScrollTop || 0)));
      return true;
    },
    scheduleHoldMenuScrollRestore() {
      this.restoreHoldMenuScrollState();
      requestAnimationFrame(() => requestAnimationFrame(() => this.restoreHoldMenuScrollState()));
    },
    restoreContinueWatchingMenuFocus() {
      this.unlockHomeHoldFocus();
      const rowKey = String(this.pendingContinueWatchingFocusRowKey || "continue_watching");
      const cards = this.getNavigationRowNodes(rowKey);
      const target =
        cards[Math.max(0, Math.min(cards.length - 1, Number(this.pendingContinueWatchingFocusIndex || 0)))] ||
        cards[cards.length - 1] ||
        null;
      this.pendingContinueWatchingFocusIndex = null;
      this.pendingContinueWatchingFocusRowKey = null;
      if (!target) {
        return;
      }
      this.setFocusedNode(target);
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      if (!this.restoreHoldMenuScrollState()) {
        this.ensureTrackHorizontalVisibility(target);
        this.ensureMainVerticalVisibility(target);
      }
    },
    resolvePosterHoldRestoreTarget(pending) {
      if (!pending) {
        return null;
      }
      const rowKey = String(pending.rowKey || "");
      const itemId = String(pending.itemId || "");
      const rowSection = rowKey
        ? Array.from(this.container?.querySelectorAll("[data-row-key]") || []).find(
            (node) => String(node.dataset.rowKey || "") === rowKey
          ) || null
        : null;
      if (rowSection) {
        const rowCards = Array.from(rowSection.querySelectorAll(".home-poster-card.focusable"));
        const byRowIdentity = itemId ? rowCards.find((card) => String(card.dataset.itemId || "") === itemId) || null : null;
        if (byRowIdentity) {
          return byRowIdentity;
        }
        const byRowIndex = rowCards.find((card) => Number(card.dataset.itemIndex || 0) === Number(pending.index || 0)) || null;
        if (byRowIndex) {
          return byRowIndex;
        }
      }
      const byPosition =
        this.container?.querySelector(
          `.home-poster-card.focusable[data-row-index="${Number(pending.rowIndex || 0)}"][data-item-index="${Number(pending.index || 0)}"]`
        ) || null;
      if (byPosition) {
        return byPosition;
      }
      if (!itemId) {
        return null;
      }
      const cards = this.container?.querySelectorAll(".home-poster-card.focusable[data-item-id]") || [];
      for (let index = 0; index < cards.length; index += 1) {
        if (String(cards[index].dataset.itemId || "") === itemId) {
          return cards[index];
        }
      }
      return null;
    },
    restorePosterHoldMenuFocus() {
      this.unlockHomeHoldFocus();
      const pending = this.pendingPosterHoldFocus;
      this.pendingPosterHoldFocus = null;
      if (!pending) {
        return;
      }
      const target = this.resolvePosterHoldRestoreTarget(pending);
      if (!target) {
        return;
      }
      this.setFocusedNode(target);
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      if (!this.restoreHoldMenuScrollState()) {
        this.ensureTrackHorizontalVisibility(target);
        this.ensureMainVerticalVisibility(target);
      }
    }
  };
}
