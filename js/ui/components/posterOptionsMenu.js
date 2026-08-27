import { I18n } from "../../i18n/index.js";
import { savedLibraryRepository } from "../../data/repository/savedLibraryRepository.js";
import { libraryRepository, LibrarySourceMode } from "../../data/repository/libraryRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedSeriesReconciliationService } from "../../data/repository/watchedSeriesReconciliationService.js";
import { tabSupportsContentType } from "../../core/util/libraryMembership.js";
import { NuvioDialog } from "./nuvioDialog.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function isSeriesType(type) {
  const normalized = String(type || "").toLowerCase();
  return ["series", "tv", "anime"].includes(normalized);
}

function isMovieType(type) {
  return String(type || "").toLowerCase() === "movie";
}

export function posterItemFromNode(node, fallbackType = "movie") {
  if (!node?.dataset?.itemId) {
    return null;
  }
  return {
    id: String(node.dataset.itemId || "").trim(),
    type: String(node.dataset.itemType || fallbackType || "movie").trim() || "movie",
    title:
      String(
        node.dataset.itemTitle || node.dataset.title || node.dataset.itemId || "Untitled"
      ).trim() || "Untitled",
    poster: String(node.dataset.posterSrc || node.dataset.poster || "").trim(),
    background: String(node.dataset.backdropSrc || node.dataset.background || "").trim(),
    addonBaseUrl: String(node.dataset.addonBaseUrl || "").trim(),
    addonId: String(node.dataset.addonId || "").trim(),
    addonName: String(node.dataset.addonName || "").trim(),
    catalogType: String(
      node.dataset.catalogType || node.dataset.itemType || fallbackType || "movie"
    ).trim()
  };
}

function toLibraryItem(item = {}) {
  return {
    itemId: item.id,
    itemType: item.type || "movie",
    title: item.title || item.name || item.id || "Untitled",
    poster: item.poster || null,
    background: item.background || item.backdrop || null,
    description: item.description || "",
    releaseInfo: item.releaseInfo || "",
    imdbRating: item.imdbRating == null ? null : Number(item.imdbRating),
    genres: Array.isArray(item.genres) ? item.genres : [],
    addonBaseUrl: item.addonBaseUrl || null
  };
}

function isInMembership(snapshot) {
  return Object.values(snapshot?.listMembership || {}).some(Boolean);
}

export async function createPosterOptionsState(item, options = {}) {
  if (!item?.id) {
    return null;
  }
  const watchedItems = Array.isArray(options.watchedItems)
    ? options.watchedItems
    : await watchedItemsRepository.getAll(2000).catch(() => []);
  const sourceMode = await libraryRepository.getSourceMode().catch(() => LibrarySourceMode.LOCAL);
  const libraryItem = toLibraryItem(item);
  const membershipSnapshot = await libraryRepository
    .getMembershipSnapshot(libraryItem)
    .catch(() => ({ listMembership: {} }));
  return {
    item: {
      ...item,
      id: String(item.id || "").trim(),
      type: String(item.type || "movie").trim() || "movie",
      title: String(item.title || item.name || item.id || "Untitled").trim() || "Untitled"
    },
    sourceMode,
    membership: membershipSnapshot.listMembership || {},
    isSaved:
      isInMembership(membershipSnapshot) ||
      (await savedLibraryRepository.isSaved(item.id).catch(() => false)),
    isWatched: watchedItems.some(
      (entry) => String(entry?.contentId || "") === String(item.id || "")
    ),
    optionIndex: 0,
    focusKey: options.focusKey || "",
    itemIndex: Number.isFinite(Number(options.itemIndex)) ? Number(options.itemIndex) : -1
  };
}

export function getPosterOptions(state, options = {}) {
  const item = state?.item || null;
  if (!item?.id) {
    return [];
  }
  const includeLibrary = options.includeLibrary !== false;
  const includeWatched =
    options.includeWatched !== false && (isMovieType(item.type) || isSeriesType(item.type));
  const actions = [{ action: "details", label: t("cw_action_go_to_details", {}, "Go to details") }];
  if (includeLibrary) {
    actions.push({
      action: "toggleLibrary",
      label:
        state.sourceMode === LibrarySourceMode.TRAKT
          ? t("library_manage_lists", {}, "Manage Lists")
          : state.sourceMode === LibrarySourceMode.SIMKL
            ? "Manage Simkl Status"
            : state.isSaved
              ? t("detail.removeFromLibrary", {}, "Remove from Library")
              : t("detail.addToLibrary", {}, "Add to Library")
    });
  }
  if (includeWatched) {
    actions.push({
      action: "toggleWatched",
      label: state.isWatched
        ? t("hero_mark_unwatched", {}, "Mark as unwatched")
        : t("hero_mark_watched", {}, "Mark as watched")
    });
  }
  return actions;
}

export async function activatePosterOption(state, action, _options = {}) {
  const item = state?.item || null;
  if (!item?.id || !action) {
    return { type: "noop" };
  }
  if (action === "details") {
    return { type: "details", item };
  }
  if (action === "toggleLibrary") {
    if (state.sourceMode !== LibrarySourceMode.LOCAL) {
      return { type: "listPicker", state: await createPosterListPickerState(state) };
    }
    const isSaved = await savedLibraryRepository.toggle({
      contentId: item.id,
      contentType: item.type || "movie",
      title: item.title || item.name || item.id || "Untitled",
      poster: item.poster || null,
      background: item.background || null
    });
    return { type: "updated", state: { ...state, isSaved: Boolean(isSaved) } };
  }
  if (action === "toggleWatched") {
    if (isSeriesType(item.type)) {
      if (state.isWatched) {
        await watchedSeriesReconciliationService.unmarkSeriesWatched(item.id);
      } else {
        await watchedSeriesReconciliationService.markSeriesWatched(item.id, item.type || "series", {
          title: item.title || item.name || item.id || "Untitled"
        });
      }
      return { type: "updated", state: { ...state, isWatched: !state.isWatched } };
    }
    if (state.isWatched) {
      await watchedItemsRepository.unmark(item.id);
      await watchProgressRepository.removeProgress(item.id);
      return { type: "updated", state: { ...state, isWatched: false } };
    }
    await watchedItemsRepository.mark({
      contentId: item.id,
      contentType: item.type || "movie",
      title: item.title || item.name || item.id || "Untitled",
      watchedAt: Date.now()
    });
    await watchProgressRepository.saveProgress({
      contentId: item.id,
      contentType: item.type || "movie",
      videoId: null,
      positionMs: 100,
      durationMs: 100,
      updatedAt: Date.now()
    });
    return { type: "updated", state: { ...state, isWatched: true } };
  }
  return { type: "noop" };
}

export async function createPosterListPickerState(state) {
  const item = state?.item || null;
  if (!item?.id) {
    return null;
  }
  const tabs = await libraryRepository.getListTabs().catch(() => []);
  const resolvedTabs =
    Array.isArray(tabs) && tabs.length
      ? tabs.filter((tab) => tabSupportsContentType(tab, item.type))
      : [{ key: "local", title: t("detail.library", {}, "Library"), type: "local" }];
  const libraryItem = toLibraryItem(item);
  const snapshot = await libraryRepository
    .getMembershipSnapshot(libraryItem)
    .catch(() => ({ listMembership: {} }));
  return {
    item: libraryItem,
    sourceMode: state.sourceMode,
    tabs: resolvedTabs,
    membership: Object.fromEntries(
      resolvedTabs.map((tab) => [tab.key, Boolean(snapshot?.listMembership?.[tab.key])])
    ),
    error: ""
  };
}

export function getPosterListPickerOptions(picker) {
  if (!picker) {
    return [];
  }
  const membership = picker.membership || {};
  const tabs = Array.isArray(picker.tabs) ? picker.tabs : [];
  return [
    ...tabs.map((tab) => ({
      action: `toggleLibraryList:${tab.key}`,
      label: tab.title || tab.key,
      selected: membership[tab.key] === true,
      className: "poster-list-picker-list-button"
    })),
    {
      action: picker.destructiveRemovalRequired
        ? "confirmDestructiveSimklRemoval"
        : "saveLibraryLists",
      label: picker.destructiveRemovalRequired
        ? "Remove status and clear Simkl history"
        : t("action_save", {}, "Save"),
      className: "poster-list-picker-save-button"
    }
  ];
}

export class PosterOptionsDialogController {
  constructor({ onDetails, onDismiss = null, onChanged = null } = {}) {
    this.onDetails = onDetails;
    this.onDismiss = onDismiss;
    this.onChanged = onChanged;
    this.state = null;
    this.listPicker = null;
    this.dialog = null;
  }

  destroy({ restoreFocus = true, afterExit = null } = {}) {
    const dialog = this.dialog;
    this.dialog = null;
    this.state = null;
    this.listPicker = null;
    if (dialog) {
      dialog.destroy({ afterExit });
    } else if (typeof afterExit === "function") {
      afterExit();
    }
    if (restoreFocus) this.onDismiss?.();
  }

  async open(item, options = {}) {
    if (!item?.id) {
      return false;
    }
    this.destroy({ restoreFocus: false });
    this.state = await createPosterOptionsState(item, options);
    return this.mountOptionsDialog();
  }

  mountOptionsDialog() {
    if (!this.state?.item?.id) {
      return false;
    }
    this.dialog?.destroy?.();
    const item = this.state.item;
    const options = getPosterOptions(this.state);
    this.dialog = new NuvioDialog({
      title: item.title || item.name || item.id || "Untitled",
      subtitle: t("home_poster_dialog_subtitle", {}, "Title actions"),
      widthVw: 37.5,
      suppressEnterUntilKeyUp: true,
      buttons: options.map((option) => ({
        label: option.label,
        key: option.action,
        onAction: () => {
          void this.activateOption(option.action);
        }
      })),
      onDismiss: () => {
        this.dialog = null;
        this.state = null;
        this.listPicker = null;
        this.onDismiss?.();
      }
    }).mount(document.body);
    return true;
  }

  async activateOption(action) {
    const result = await activatePosterOption(this.state, action);
    if (result?.type === "details") {
      const item = result.item;
      this.destroy({
        restoreFocus: false,
        afterExit: () => this.onDetails?.(item)
      });
      return true;
    }
    if (result?.type === "listPicker") {
      this.listPicker = result.state;
      return this.mountListPickerDialog();
    }
    if (result?.type === "updated") {
      this.state = result.state;
      this.onChanged?.(result.state);
      this.destroy();
      return true;
    }
    return false;
  }

  mountListPickerDialog() {
    if (!this.listPicker) {
      return false;
    }
    this.dialog?.destroy?.();
    const item = this.listPicker.item || {};
    this.dialog = new NuvioDialog({
      title: item.title || item.name || item.itemId || "Untitled",
      subtitle: t("detail_lists_subtitle", {}, "Choose which lists should include this title"),
      error: this.listPicker.error || null,
      widthVw: 52,
      suppressEnterUntilKeyUp: true,
      buttons: getPosterListPickerOptions(this.listPicker).map((option) => ({
        label: option.label,
        key: option.action,
        selected: option.selected,
        className: option.className,
        onAction: () => {
          void this.activateListPickerOption(option.action);
        }
      })),
      panelClassName: "poster-list-picker-dialog-panel",
      actionsClassName: "poster-list-picker-actions",
      onDismiss: () => {
        this.dialog = null;
        this.state = null;
        this.listPicker = null;
        this.onDismiss?.();
      }
    }).mount(document.body);
    return true;
  }

  async activateListPickerOption(action) {
    if (!this.listPicker) {
      return false;
    }
    const normalizedAction = String(action || "");
    if (normalizedAction.startsWith("toggleLibraryList:")) {
      const key = normalizedAction.slice("toggleLibraryList:".length);
      const nextSelected = !this.listPicker.membership?.[key];
      this.listPicker.membership =
        this.listPicker.sourceMode === LibrarySourceMode.SIMKL
          ? Object.fromEntries(
              this.listPicker.tabs.map((tab) => [tab.key, nextSelected && tab.key === key])
            )
          : { ...(this.listPicker.membership || {}), [key]: nextSelected };
      this.listPicker.destructiveRemovalRequired = false;
      if (this.listPicker.sourceMode === LibrarySourceMode.SIMKL) {
        this.mountListPickerDialog();
      } else {
        this.dialog?.setButtonSelected?.(
          normalizedAction,
          Boolean(this.listPicker.membership[key])
        );
      }
      return true;
    }
    if (
      normalizedAction === "saveLibraryLists" ||
      normalizedAction === "confirmDestructiveSimklRemoval"
    ) {
      try {
        await libraryRepository.applyMembershipChanges(
          this.listPicker.item,
          {
            desiredMembership: this.listPicker.membership || {}
          },
          {
            destructiveRemovalConfirmed: normalizedAction === "confirmDestructiveSimklRemoval"
          }
        );
        this.onChanged?.(this.state);
        this.destroy();
      } catch (error) {
        console.warn("Failed to update library lists", error);
        this.listPicker.destructiveRemovalRequired =
          error?.code === "SIMKL_DESTRUCTIVE_REMOVAL_REQUIRED";
        this.listPicker.error = this.listPicker.destructiveRemovalRequired
          ? "Removing this status will also clear watched history or a rating on Simkl. Confirm only if that is intended."
          : t("detail_lists_save_failed", {}, "Could not save list changes.");
        this.mountListPickerDialog();
      }
      return true;
    }
    return false;
  }
}
