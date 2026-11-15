import { trackingErrorMessage } from "../../components/trackingErrorMessage.js";
import { getPosterListPickerOptions } from "../../components/posterOptionsMenu.js";
import * as internals from "./homeScreenContext.js";

export function createHomeScreenMethods07() {
  const {
    watchedItemsRepository,
    savedLibraryRepository,
    libraryRepository,
    LibrarySourceMode,
    supportsMembershipFor,
    isTitleItemWatched,
    NuvioDialog,
    t,
    normalizeCatalogItem
  } = internals;

  return {
    mountContinueWatchingDialog() {
      const item = this.getContinueWatchingMenuItem();
      if (!item) {
        return false;
      }
      this.lockHomeHoldFocus();
      this.destroyHomeHoldDialog();
      const options = this.getContinueWatchingMenuOptions();
      this._homeHoldDialog = new NuvioDialog({
        title: item.title || "Untitled",
        subtitle: t("cw_dialog_subtitle", {}, "Choose what you want to do with this item."),
        widthVw: 37.5,
        suppressEnterUntilKeyUp: true,
        buttons: options.map((option, index) => ({
          label: option.label,
          key: option.action,
          onAction: () => {
            this.continueWatchingMenu = {
              ...(this.continueWatchingMenu || {}),
              optionIndex: index
            };
            void this.activateContinueWatchingMenuOption();
          }
        })),
        onDismiss: () => this.dismissContinueWatchingMenu()
      }).mount(document.body);
      this.suppressHoldMenuEnterUntilKeyUp = true;
      this.scheduleHoldMenuScrollRestore();
      return true;
    },
    mountPosterHoldDialog() {
      const item = this.getPosterHoldMenuItem();
      if (!item?.id) {
        return false;
      }
      this.lockHomeHoldFocus();
      this.destroyHomeHoldDialog();
      const options = this.getPosterHoldMenuOptions();
      this._homeHoldDialog = new NuvioDialog({
        title: item.name || "Untitled",
        subtitle: t("home_poster_dialog_subtitle", {}, "Title actions"),
        widthVw: 37.5,
        suppressEnterUntilKeyUp: true,
        buttons: options.map((option, index) => ({
          label: option.label,
          key: option.action,
          onAction: () => {
            this.posterHoldMenu = {
              ...(this.posterHoldMenu || {}),
              optionIndex: index
            };
            void this.activatePosterHoldMenuOption();
          }
        })),
        onDismiss: () => this.dismissPosterHoldMenu()
      }).mount(document.body);
      this.suppressHoldMenuEnterUntilKeyUp = true;
      this.scheduleHoldMenuScrollRestore();
      return true;
    },
    getPosterListPickerOptions() {
      // One builder for Home and the poster options menu, as Android shares one picker.
      return getPosterListPickerOptions(this.posterListPicker);
    },
    mountPosterListPickerDialog() {
      if (!this.posterListPicker) {
        return false;
      }
      this.lockHomeHoldFocus();
      this.destroyHomeHoldDialog();
      const item = this.posterListPicker.item || {};
      this._homeHoldDialog = new NuvioDialog({
        title: item.name || item.title || item.id || "Untitled",
        subtitle: t("detail_lists_subtitle", {}, "Choose which lists should include this title"),
        error: this.posterListPicker.error || null,
        widthVw: 52,
        buttons: this.getPosterListPickerOptions().map((option) => ({
          label: option.label,
          key: option.action,
          selected: option.selected,
          className: option.className,
          checkPlacement: option.checkPlacement,
          onAction: () => {
            void this.activatePosterListPickerOption(option.action);
          }
        })),
        panelClassName: "poster-list-picker-dialog-panel",
        actionsClassName: "poster-list-picker-actions",
        onDismiss: () => {
          this._homeHoldDialog = null;
          this.posterListPicker = null;
          this.restorePosterHoldMenuFocus();
          this.holdMenuScrollState = null;
        }
      }).mount(document.body);
      this.scheduleHoldMenuScrollRestore();
      return true;
    },
    async openPosterListPicker(item) {
      if (!item?.id) {
        return false;
      }
      const tabs = await libraryRepository.getListTabs().catch(() => []);
      const contentType = item.type || "movie";
      const resolvedTabs =
        Array.isArray(tabs) && tabs.length
          ? tabs.filter((tab) => supportsMembershipFor(tab, contentType))
          : [{ key: "local", title: t("detail.library", {}, "Library"), type: "local" }];
      const libraryItem = {
        itemId: item.id,
        imdbId: item.imdbId || item.ids?.imdb || null,
        tmdbId: item.tmdbId || item.ids?.tmdb || null,
        traktId: item.traktId || item.ids?.trakt || null,
        itemType: item.type || "movie",
        title: item.name || item.title || item.id || "Untitled",
        poster: item.poster || null,
        background: item.background || item.backdrop || null,
        description: item.description || "",
        releaseInfo: item.releaseInfo || "",
        imdbRating: item.imdbRating == null ? null : Number(item.imdbRating),
        genres: Array.isArray(item.genres) ? item.genres : []
      };
      const snapshot = await libraryRepository.getMembershipSnapshot(libraryItem).catch(() => ({ listMembership: {} }));
      if (this.posterHoldMenu) {
        this.pendingPosterHoldFocus = {
          rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
          index: Number(this.posterHoldMenu.index || 0),
          rowKey: String(this.posterHoldMenu.rowKey || ""),
          itemId: String(this.posterHoldMenu.item?.id || "")
        };
      }
      this.posterHoldMenu = null;
      this.posterListPicker = {
        item: libraryItem,
        sourceMode: await libraryRepository.getSourceMode().catch(() => LibrarySourceMode.LOCAL),
        tabs: resolvedTabs,
        membership: Object.fromEntries(resolvedTabs.map((tab) => [tab.key, Boolean(snapshot?.listMembership?.[tab.key])])),
        error: ""
      };
      return this.mountPosterListPickerDialog();
    },
    async activatePosterListPickerOption(action) {
      if (!this.posterListPicker) {
        return false;
      }
      const normalizedAction = String(action || "");
      if (normalizedAction.startsWith("toggleLibraryList:")) {
        const key = normalizedAction.slice("toggleLibraryList:".length);
        const nextSelected = !this.posterListPicker.membership?.[key];
        this.posterListPicker.membership =
          this.posterListPicker.sourceMode === LibrarySourceMode.SIMKL
            ? Object.fromEntries(this.posterListPicker.tabs.map((tab) => [tab.key, nextSelected && tab.key === key]))
            : { ...(this.posterListPicker.membership || {}), [key]: nextSelected };
        this.posterListPicker.destructiveRemovalRequired = false;
        if (this.posterListPicker.sourceMode === LibrarySourceMode.SIMKL) {
          this.mountPosterListPickerDialog();
        } else {
          this._homeHoldDialog?.setButtonSelected?.(normalizedAction, Boolean(this.posterListPicker.membership[key]));
        }
        return true;
      }
      if (normalizedAction === "saveLibraryLists" || normalizedAction === "confirmDestructiveSimklRemoval") {
        try {
          await libraryRepository.applyMembershipChanges(
            this.posterListPicker.item,
            {
              desiredMembership: this.posterListPicker.membership || {}
            },
            {
              destructiveRemovalConfirmed: normalizedAction === "confirmDestructiveSimklRemoval"
            }
          );
          this.posterListPicker = null;
          this.destroyHomeHoldDialog();
          this.restorePosterHoldMenuFocus();
          this.holdMenuScrollState = null;
        } catch (error) {
          console.warn("Failed to update library lists", error);
          this.posterListPicker.destructiveRemovalRequired = error?.code === "SIMKL_DESTRUCTIVE_REMOVAL_REQUIRED";
          this.posterListPicker.error = this.posterListPicker.destructiveRemovalRequired
            ? "Removing this status will also clear watched history or a rating on Simkl. Confirm only if that is intended."
            : trackingErrorMessage(error, null) || t("detail_lists_save_failed", {}, "Could not save list changes.");
          this.mountPosterListPickerDialog();
        }
        return true;
      }
      return false;
    },
    getPosterItemFromNode(node) {
      if (!node?.matches?.(".home-poster-card.focusable")) {
        return null;
      }
      if (this.resolveCollectionFolderTargetFromNode(node)) {
        return null;
      }
      return normalizeCatalogItem(
        {
          id: node.dataset.itemId || "",
          type: node.dataset.itemType || "movie",
          name: node.dataset.itemTitle || "Untitled",
          poster: node.dataset.posterSrc || null,
          background: node.dataset.backdropSrc || null,
          backdrop: node.dataset.backdropSrc || null,
          logo: node.dataset.logoSrc || null,
          addonBaseUrl: node.dataset.addonBaseUrl || "",
          addonId: node.dataset.addonId || "",
          addonName: node.dataset.addonName || "",
          catalogType: node.dataset.catalogType || node.dataset.itemType || "movie"
        },
        node.dataset.itemType || "movie"
      );
    },
    async openPosterHoldMenu(node) {
      const item = this.getPosterItemFromNode(node);
      if (!item?.id) {
        return false;
      }
      this.cancelPendingContinueWatchingEnter();
      this.cancelPendingContinueWatchingHold();
      this.continueWatchingMenu = null;
      this.holdMenuScrollState = this.captureHoldMenuScrollState();
      const [isSaved, repositoryWatched] = await Promise.all([
        savedLibraryRepository.isSaved(item.id).catch(() => false),
        watchedItemsRepository.isWatched(item.id).catch(() => false)
      ]);
      const isWatched = isTitleItemWatched(item, this.watchedTitleIds) || Boolean(repositoryWatched);
      const librarySourceMode = await libraryRepository.getSourceMode().catch(() => LibrarySourceMode.LOCAL);
      this.posterHoldMenu = {
        item,
        index: Number(node?.dataset?.itemIndex || 0),
        rowIndex: Number(node?.dataset?.rowIndex || 0),
        rowKey: this.getNodeRowKey(node),
        optionIndex: 0,
        isSaved: Boolean(isSaved),
        isWatched: Boolean(isWatched),
        librarySourceMode
      };
      return this.mountPosterHoldDialog();
    },
    closePosterHoldMenu() {
      if (!this.posterHoldMenu) {
        return false;
      }
      this.pendingPosterHoldFocus = {
        rowIndex: Number(this.posterHoldMenu.rowIndex || 0),
        index: Number(this.posterHoldMenu.index || 0),
        rowKey: String(this.posterHoldMenu.rowKey || ""),
        itemId: String(this.posterHoldMenu.item?.id || "")
      };
      this.posterHoldMenu = null;
      this.destroyHomeHoldDialog();
      this.restorePosterHoldMenuFocus();
      this.holdMenuScrollState = null;
      return true;
    },
    openContinueWatchingMenu(node) {
      const item = this.getContinueWatchingItemFromNode(node);
      if (!item?.contentId) {
        return false;
      }
      this.cancelPendingContinueWatchingEnter();
      this.posterHoldMenu = null;
      this.holdMenuScrollState = this.captureHoldMenuScrollState();
      this.continueWatchingMenu = {
        contentId: item.contentId,
        videoId: item.videoId || "",
        index: Number(node?.dataset?.navCol || 0),
        rowKey: this.getNodeRowKey(node) || "continue_watching",
        optionIndex: 0,
        item
      };
      return this.mountContinueWatchingDialog();
    },
    closeContinueWatchingMenu() {
      if (!this.continueWatchingMenu) {
        return false;
      }
      this.pendingContinueWatchingFocusIndex = Math.max(0, Number(this.continueWatchingMenu.index || 0));
      this.pendingContinueWatchingFocusRowKey = String(this.continueWatchingMenu.rowKey || "continue_watching");
      this.continueWatchingMenu = null;
      this.destroyHomeHoldDialog();
      this.restoreContinueWatchingMenuFocus();
      this.holdMenuScrollState = null;
      return true;
    },
    isPosterHoldTarget(node) {
      return (
        Boolean(node?.matches?.(".home-poster-card.focusable")) &&
        !this.resolveCollectionFolderTargetFromNode(node) &&
        String(node?.dataset?.action || "") === "openDetail"
      );
    },
    isHomeHoldTarget(node) {
      return this.isContinueWatchingHoldTarget(node) || this.isPosterHoldTarget(node);
    }
  };
}
