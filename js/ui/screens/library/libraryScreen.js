import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { Environment } from "../../../platform/environment.js";
import { Platform } from "../../../platform/index.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { I18n } from "../../../i18n/index.js";
import { LibraryController, LIBRARY_PRIVACY_OPTIONS } from "./libraryController.js";
import { renderContentFilterPicker } from "../../components/filterPicker.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../components/posterOptionsMenu.js";
import { isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  focusWithoutAutoScroll,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

const POSTER_HOLD_DELAY_MS = 650;
const PICKER_MENU_EXIT_MS = 160;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function bookmarkOutlineSvg() {
  return `
    <svg viewBox="0 0 80 80" class="library-empty-icon" aria-hidden="true" focusable="false">
      <path d="M25 15h30c3.3 0 6 2.7 6 6v40L40 51 19 61V21c0-3.3 2.7-6 6-6z"
            fill="none"
            stroke="currentColor"
            stroke-width="5.5"
            stroke-linecap="round"
            stroke-linejoin="round" />
    </svg>
  `;
}

function isTextField(node) {
  const tagName = String(node?.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function selectorValue(value) {
  const raw = String(value || "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function scrollIntoNearestView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }
  try {
    node.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest"
    });
  } catch (_) {
    node.scrollIntoView();
  }
}

function findNearestNodeByCenterX(referenceNode, nodes = []) {
  if (!referenceNode || !nodes.length) {
    return nodes[0] || null;
  }
  const referenceRect = referenceNode.getBoundingClientRect();
  const referenceCenter = referenceRect.left + referenceRect.width / 2;
  let bestNode = nodes[0] || null;
  let bestDistance = Number.POSITIVE_INFINITY;
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const distance = Math.abs(center - referenceCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = node;
    }
  });
  return bestNode;
}

function groupNodesByRow(nodes = [], tolerance = 28) {
  const rows = [];
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const top = rect.top;
    const existingRow = rows.find((row) => Math.abs(row.top - top) <= tolerance);
    if (existingRow) {
      existingRow.nodes.push(node);
      return;
    }
    rows.push({
      top,
      nodes: [node]
    });
  });
  rows.sort((left, right) => left.top - right.top);
  rows.forEach((row) => {
    row.nodes.sort(
      (left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left
    );
  });
  return rows;
}

function filterStructureSignature(state = {}) {
  return [
    state.sourceMode === "trakt" ? "trakt" : "local",
    Array.isArray(state.availableGenres) && state.availableGenres.length ? "genre" : "no-genre",
    Array.isArray(state.availableYears) && state.availableYears.length ? "year" : "no-year"
  ].join("|");
}

export const LibraryScreen = {
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
    const controller = new LibraryController((state, change) =>
      this.handleControllerChange(state, change)
    );
    this.controller = controller;
    this.libraryRouteEnterPending = true;
    this.sidebarProfile = await getSidebarProfileState();
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.focusZone = "content";
    this.lastMainFocus = null;
    this.lastActionsRowAction = "openManageLists";
    this.pendingActionRestore = null;
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
    await controller.init();
    if (this.controller !== controller || Router.getCurrent() !== "library") {
      return;
    }
    controller.closePicker();
  },

  bindEvents() {
    if (!this.container || this.container.__libraryEventsBound) {
      return;
    }
    this.container.__libraryEventsBound = true;

    this.container.addEventListener("click", async (event) => {
      const target = event.target?.closest?.(
        ".focusable, .library-dialog-input, .library-dialog-textarea"
      );
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
      if (
        target.matches(
          ".library-dialog-input[data-editor-field], .library-dialog-textarea[data-editor-field]"
        )
      ) {
        this.controller.updateEditorField(String(target.dataset.editorField || ""), target.value, {
          silent: true
        });
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
      scrollIntoNearestView(target);
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
      picker === "list"
        ? state.selectedListKey
        : picker === "type"
          ? state.selectedTypeKey
          : picker === "genre"
            ? state.selectedGenre || "__all__"
            : picker === "year"
              ? state.selectedYear || "__all__"
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
  },

  renderPickerGroups(state) {
    const primaryPickerMarkup = [
      state.sourceMode === "trakt"
        ? this.renderPicker(
            "list",
            t("library_filter_list", {}, "List"),
            this.controller.getSelectedListLabel(),
            this.controller.getPickerOptions("list"),
            "library-picker-flex"
          )
        : "",
      this.renderPicker(
        "type",
        t("library_filter_type", {}, "Type"),
        this.controller.getSelectedTypeLabel(),
        this.controller.getPickerOptions("type"),
        "library-picker-flex"
      ),
      this.renderPicker(
        "sort",
        t("library_filter_sort", {}, "Sort"),
        this.controller.getSelectedSortLabel(),
        this.controller.getPickerOptions("sort"),
        "library-picker-flex"
      )
    ]
      .filter(Boolean)
      .join("");

    const secondaryPickerMarkup = [
      state.availableGenres.length
        ? this.renderPicker(
            "genre",
            t("library_filter_genre", {}, "Genre"),
            this.controller.getSelectedGenreLabel(),
            this.controller.getPickerOptions("genre"),
            "library-picker-flex"
          )
        : "",
      state.availableYears.length
        ? this.renderPicker(
            "year",
            t("library_filter_year", {}, "Year"),
            this.controller.getSelectedYearLabel(),
            this.controller.getPickerOptions("year"),
            "library-picker-flex"
          )
        : ""
    ]
      .filter(Boolean)
      .join("");

    return `
      <section class="library-picker-groups" id="libraryPickerGroupsMount">
        <div class="library-picker-row">
          ${primaryPickerMarkup}
        </div>
        ${secondaryPickerMarkup ? `<div class="library-picker-row">${secondaryPickerMarkup}</div>` : ""}
      </section>
    `;
  },

  renderLibraryContentArea(state) {
    return `
      <div id="libraryContentAreaMount">
        ${this.renderActions(state)}
        ${state.visibleItems.length ? this.renderGrid(state.visibleItems) : this.renderEmptyState()}
        ${state.transientMessage ? `<div class="library-toast">${escapeHtml(state.transientMessage)}</div>` : ""}
      </div>
    `;
  },

  syncRenderedPickerValues() {
    const valueByPicker = {
      list: this.controller.getSelectedListLabel(),
      type: this.controller.getSelectedTypeLabel(),
      sort: this.controller.getSelectedSortLabel(),
      genre: this.controller.getSelectedGenreLabel(),
      year: this.controller.getSelectedYearLabel()
    };
    Object.entries(valueByPicker).forEach(([picker, value]) => {
      const node = this.container?.querySelector(
        `.library-picker-anchor[data-picker="${selectorValue(picker)}"] .library-picker-value`
      );
      if (node instanceof HTMLElement) {
        node.textContent = value;
      }
    });
  },

  closePickerMenuInDom(picker = "") {
    if (!this.container) {
      return;
    }
    this.lastRenderedExpandedPicker = null;
    this.clearClosingPicker();
    Array.from(this.container.querySelectorAll(".library-picker-groups .library-picker")).forEach(
      (node) => {
        node.classList.remove("open", "closing");
        const menu = node.querySelector(".library-picker-menu");
        if (menu) {
          menu.remove();
        }
      }
    );
    Array.from(
      this.container.querySelectorAll(".library-picker-groups .library-picker-anchor")
    ).forEach((node) => {
      node.setAttribute("aria-expanded", "false");
    });
    this.syncRenderedPickerValues(this.controller.getState());
    const target = picker
      ? this.container.querySelector(
          `.library-picker-anchor[data-picker="${selectorValue(picker)}"]`
        )
      : null;
    if (target instanceof HTMLElement) {
      this.container.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) {
          node.classList.remove("focused");
        }
      });
      this.setFocusedNode(target);
    }
  },

  updateRenderedLibraryContent(state, { preservePickerRow = true } = {}) {
    if (!this.container || !this.container.querySelector(".library-shell")) {
      this.requestRender();
      return;
    }

    const sourceNode = this.container.querySelector("#libraryPageSource");
    if (sourceNode instanceof HTMLElement) {
      sourceNode.textContent = this.controller.getSourceLabel();
    }

    const pickerMount = this.container.querySelector("#libraryPickerGroupsMount");
    if (pickerMount instanceof HTMLElement) {
      if (preservePickerRow) {
        this.syncRenderedPickerValues(state);
      } else {
        pickerMount.outerHTML = this.renderPickerGroups(state);
      }
    }

    const contentMount = this.container.querySelector("#libraryContentAreaMount");
    if (contentMount instanceof HTMLElement) {
      contentMount.outerHTML = this.renderLibraryContentArea(state);
    }

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

    if (this.pendingPickerRestore) {
      const target = this.container.querySelector(
        `.library-picker-anchor[data-picker="${selectorValue(this.pendingPickerRestore)}"]`
      );
      if (target instanceof HTMLElement) {
        this.setFocusedNode(target);
        this.pendingPickerRestore = null;
        return;
      }
    }

    this.restoreFocus();
  },

  renderGrid(items) {
    const state = this.controller.getState();
    return `
      <section class="library-grid-wrap">
        <div class="library-grid">
          ${items
            .map((item) => {
              const focusKey = `${item.type}:${item.id}`;
              const isWatched = isTitleItemWatched(item, state.watchedTitleIds);
              return `
              <article class="library-grid-card focusable"
                       data-action="openDetail"
                       data-item-id="${escapeHtml(item.id)}"
                       data-item-type="${escapeHtml(item.type || "movie")}"
                       data-item-title="${escapeHtml(item.name || item.id || "Untitled")}"
                       data-poster-src="${escapeHtml(item.poster || "")}"
                       data-backdrop-src="${escapeHtml(item.background || "")}"
                       data-addon-base-url="${escapeHtml(item.addonBaseUrl || "")}"
                       data-focus-key="${escapeHtml(focusKey)}">
                <div class="library-grid-poster${item.poster ? "" : " placeholder"}"${item.poster ? ` style="background-image:url('${escapeHtml(item.poster)}')"` : ""}>
                  ${isWatched ? renderTitleWatchedBadge({ className: "library-watched-badge", iconClassName: "library-watched-badge-svg" }) : ""}
                </div>
                <div class="library-grid-title">${escapeHtml(item.name || item.id || "Untitled")}</div>
              </article>
            `;
            })
            .join("")}
        </div>
      </section>
    `;
  },

  renderEmptyState() {
    return `
      <section class="library-empty-state">
        ${bookmarkOutlineSvg()}
        <h3 class="library-empty-title">${escapeHtml(this.controller.getEmptyStateTitle())}</h3>
        <p class="library-empty-subtitle">${escapeHtml(this.controller.getEmptyStateSubtitle())}</p>
      </section>
    `;
  },

  applyOpenPickerOptionFocus() {
    const state = this.controller.getState();
    const picker = state.expandedPicker;
    if (!picker) {
      return false;
    }
    const options = Array.from(
      this.container?.querySelectorAll(
        `.library-picker.open .library-picker-option.focusable[data-picker="${selectorValue(picker)}"]`
      ) || []
    );
    if (!options.length) {
      return false;
    }
    const focusIndex = Math.max(
      0,
      Math.min(options.length - 1, Number(state.pickerFocusIndex || 0))
    );
    options.forEach((node, index) => {
      const focused = index === focusIndex;
      node.classList.toggle("focused", focused);
      node.classList.toggle("library-picker-option-target", focused);
    });
    const target = options[focusIndex] || options[0] || null;
    if (!target) {
      return false;
    }
    this.setFocusedNode(target);
    return true;
  },

  renderActions(state) {
    if (state.sourceMode !== "trakt") {
      return "";
    }
    return `
      <section class="library-actions-row">
        <button class="library-action-button focusable library-primary${state.showManageDialog ? " background-focused" : ""}"
                data-action="openManageLists"
                ${state.pendingOperation || state.isSyncing ? "disabled" : ""}>
          ${escapeHtml(t("library_manage_lists", {}, "Manage Lists"))}
        </button>
        <button class="library-action-button focusable library-primary"
                data-action="refreshLibrary"
                ${state.pendingOperation || state.isSyncing ? "disabled" : ""}>
          ${escapeHtml(state.isSyncing ? t("library_syncing_btn", {}, "Syncing") : t("library_sync_btn", {}, "Sync"))}
        </button>
      </section>
    `;
  },

  renderManageListsDialog(state) {
    if (!state.showManageDialog || state.listEditorState || state.showDeleteConfirm) {
      return "";
    }
    const personalTabs = state.listTabs.filter((item) => item.type === "personal");
    return `
      <div class="library-overlay">
        <section class="library-dialog library-manage-dialog">
          <div class="library-manage-stack">
            <h3 class="library-dialog-title library-manage-title">${escapeHtml(t("library_manage_trakt_lists", {}, "Manage Trakt Lists"))}</h3>
            ${state.errorMessage ? `<p class="library-dialog-error library-manage-error">${escapeHtml(state.errorMessage)}</p>` : ""}
            <div class="library-manage-list${personalTabs.length ? " has-items" : ""}">
              ${
                personalTabs.length
                  ? personalTabs
                      .map(
                        (tab) => `
                    <button class="library-manage-list-button focusable${tab.key === state.manageSelectedListKey ? " selected" : ""}"
                            data-action="selectManageList"
                            data-list-key="${escapeHtml(tab.key)}"
                            ${state.pendingOperation ? "disabled" : ""}>
                      <span class="library-manage-list-label">${escapeHtml(tab.title)}</span>
                    </button>
                  `
                      )
                      .join("")
                  : `<div class="library-manage-empty">${escapeHtml(t("library_no_lists", {}, "No personal lists yet."))}</div>`
              }
            </div>
            <div class="library-manage-actions-row">
              <button class="library-action-button focusable" data-action="createList" ${state.pendingOperation ? "disabled" : ""}>${escapeHtml(t("library_list_create", {}, "Create"))}</button>
              <button class="library-action-button focusable" data-action="editList" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>${escapeHtml(t("library_list_edit", {}, "Edit"))}</button>
              <button class="library-action-button focusable" data-action="moveListUp" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>${escapeHtml(t("library_list_move_up", {}, "Move Up"))}</button>
              <button class="library-action-button focusable" data-action="moveListDown" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>${escapeHtml(t("library_list_move_down", {}, "Move Down"))}</button>
            </div>
            <div class="library-manage-actions-row">
              <button class="library-action-button focusable danger" data-action="deleteList" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>${escapeHtml(t("library_list_delete", {}, "Delete"))}</button>
              <button class="library-action-button focusable" data-action="closeManageLists" ${state.pendingOperation ? "disabled" : ""}>${escapeHtml(t("library_list_close", {}, "Close"))}</button>
            </div>
          </div>
        </section>
      </div>
    `;
  },

  renderListEditorDialog(state) {
    if (!state.listEditorState) {
      return "";
    }
    const editor = state.listEditorState;
    return `
      <div class="library-overlay">
        <section class="library-dialog library-list-editor">
          <h3 class="library-dialog-title">${escapeHtml(editor.mode === "create" ? t("library_list_create_dialog_title", {}, "Create List") : t("library_list_edit_dialog_title", {}, "Edit List"))}</h3>
          <label class="library-dialog-field library-outlined-field">
            <input class="library-dialog-input focusable"
                   data-editor-field="name"
                   aria-label="${escapeHtml(t("library_list_name_label", {}, "Name"))}"
                   placeholder=" "
                   value="${escapeHtml(editor.name)}"
                   ${state.pendingOperation ? "disabled" : ""} />
            <span class="library-dialog-field-label">${escapeHtml(t("library_list_name_label", {}, "Name"))}</span>
          </label>
          <label class="library-dialog-field library-outlined-field">
            <textarea class="library-dialog-textarea focusable"
                      data-editor-field="description"
                      aria-label="${escapeHtml(t("library_list_description_label", {}, "Description"))}"
                      placeholder=" "
                      ${state.pendingOperation ? "disabled" : ""}>${escapeHtml(editor.description)}</textarea>
            <span class="library-dialog-field-label">${escapeHtml(t("library_list_description_label", {}, "Description"))}</span>
          </label>
          <div class="library-dialog-field library-privacy-field">
            <span class="library-privacy-label">${escapeHtml(t("library_list_privacy", {}, "Privacy"))}</span>
            <div class="library-privacy-row">
              ${LIBRARY_PRIVACY_OPTIONS.map(
                (privacy) => `
                <button class="library-privacy-button focusable${privacy === editor.privacy ? " selected" : ""}"
                        data-action="selectPrivacy"
                        data-privacy="${privacy}"
                        ${state.pendingOperation ? "disabled" : ""}>
                  ${escapeHtml(privacy.charAt(0).toUpperCase() + privacy.slice(1))}
                </button>
              `
              ).join("")}
            </div>
          </div>
          <div class="library-dialog-actions library-editor-actions">
            <button class="library-action-button focusable"
                    data-action="saveListEditor"
                    ${state.pendingOperation ? "disabled" : ""}>
              ${escapeHtml(state.pendingOperation ? t("action_saving", {}, "Saving…") : t("action_save", {}, "Save"))}
            </button>
          </div>
        </section>
      </div>
    `;
  },

  renderDeleteDialog(state) {
    if (!state.showDeleteConfirm) {
      return "";
    }
    return `
      <div class="library-overlay">
        <section class="library-dialog library-delete-dialog">
          <h3 class="library-dialog-title">${escapeHtml(t("library_delete_title", {}, "Delete this list?"))}</h3>
          <p class="library-dialog-subtitle">${escapeHtml(t("library_delete_subtitle", {}, "This removes the list and all list items from Trakt."))}</p>
          <div class="library-dialog-actions library-delete-actions">
            <button class="library-action-button focusable danger"
                    data-action="confirmDeleteList"
                    ${state.pendingOperation ? "disabled" : ""}>
              ${escapeHtml(t("library_list_delete", {}, "Delete"))}
            </button>
          </div>
        </section>
      </div>
    `;
  },

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
    if (state.isLoading || state.isSyncing) {
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

            ${this.renderPickerGroups(state)}

            ${this.renderLibraryContentArea(state)}
          </section>
        </main>
        ${this.renderManageListsDialog(state)}
        ${this.renderListEditorDialog(state)}
        ${this.renderDeleteDialog(state)}
      </div>
    `;
    this.libraryRouteEnterPending = false;

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
      const current =
        this.container?.querySelector(
          ".library-grid-card.focusable.focused[data-action='openDetail']"
        ) || null;
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
    return (
      this.container?.querySelector(".library-picker-row .library-picker-anchor.focusable") ||
      this.resolveLastMainFocus() ||
      null
    );
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
      !state.expandedPicker;
    if (sidebarActive) {
      const sidebarNode =
        getRootSidebarSelectedNode(this.container, this.layoutPrefs) ||
        getRootSidebarNodes(this.container, this.layoutPrefs)[0] ||
        null;
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
    } else if (state.expandedPicker) {
      selector = `.library-picker.open .library-picker-option[data-option-index="${Number(state.pickerFocusIndex || 0)}"]`;
    } else if (this.pendingPickerRestore) {
      selector = `.library-picker-anchor[data-picker="${selectorValue(this.pendingPickerRestore)}"]`;
    } else if (this.lastMainFocus?.matches?.(".library-picker-anchor")) {
      selector = this.getMainFocusSelector(this.lastMainFocus);
    } else if (state.lastFocusedPosterKey) {
      selector = `.library-grid-card[data-focus-key="${selectorValue(state.lastFocusedPosterKey)}"]`;
    } else {
      selector = null;
    }

    const actionRestoreTarget = this.pendingActionRestore
      ? this.container?.querySelector(
          `.focusable[data-action="${selectorValue(this.pendingActionRestore)}"]`
        )
      : null;
    const target =
      (selector ? this.container?.querySelector(selector) : null) ||
      actionRestoreTarget ||
      (this.focusZone === "sidebar"
        ? getRootSidebarSelectedNode(this.container, this.layoutPrefs)
        : null) ||
      (this.focusZone === "content" ? this.resolveLastMainFocus() : null) ||
      this.container?.querySelector(".library-primary.focusable") ||
      getRootSidebarSelectedNode(this.container, this.layoutPrefs) ||
      this.container?.querySelector(".focusable");
    if (!target) {
      return;
    }
    this.setFocusedNode(target);
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
      Array.from(this.container?.querySelectorAll(scopeSelector) || []).find((node) =>
        node.classList?.contains("focused")
      ) ||
      this.container?.querySelector(".focusable.focused") ||
      null
    );
  },

  resolvePreferredActionsRowNode() {
    const buttons = Array.from(
      this.container?.querySelectorAll(".library-actions-row .focusable") || []
    );
    if (!buttons.length) {
      return null;
    }
    return (
      buttons.find(
        (node) => String(node.dataset.action || "") === this.lastActionsRowAction && !node.disabled
      ) ||
      buttons.find((node) => !node.disabled) ||
      buttons[0] ||
      null
    );
  },

  resolvePreferredPickerRowNode(referenceNode = null) {
    const anchors = Array.from(
      this.container?.querySelectorAll(".library-picker-row .library-picker-anchor.focusable") || []
    );
    if (!anchors.length) {
      return null;
    }
    const remembered =
      this.lastMainFocus && this.lastMainFocus.closest?.(".library-picker-row")
        ? this.resolveLastMainFocus()
        : null;
    return remembered || findNearestNodeByCenterX(referenceNode, anchors) || anchors[0] || null;
  },

  resolveRelativePickerRowNode(current, direction) {
    if (
      !current ||
      !current.matches?.(".library-picker-anchor.focusable") ||
      !current.closest?.(".library-picker-row")
    ) {
      return null;
    }
    const anchors = Array.from(
      this.container?.querySelectorAll(".library-picker-row .library-picker-anchor.focusable") || []
    );
    if (!anchors.length) {
      return null;
    }
    const rows = groupNodesByRow(anchors);
    const rowIndex = rows.findIndex((row) => row.nodes.includes(current));
    if (rowIndex < 0) {
      return null;
    }
    const targetRow =
      direction === "up" ? rows[rowIndex - 1] : direction === "down" ? rows[rowIndex + 1] : null;
    if (!targetRow?.nodes?.length) {
      return null;
    }
    return findNearestNodeByCenterX(current, targetRow.nodes) || targetRow.nodes[0] || null;
  },

  resolvePreferredGridNode(referenceNode = null) {
    const cards = Array.from(
      this.container?.querySelectorAll(".library-grid-card.focusable") || []
    );
    if (!cards.length) {
      return null;
    }
    const remembered =
      this.lastMainFocus && this.lastMainFocus.closest?.(".library-grid")
        ? this.resolveLastMainFocus()
        : null;
    return remembered || findNearestNodeByCenterX(referenceNode, cards) || cards[0] || null;
  },

  buildGridRows() {
    const cards = Array.from(
      this.container?.querySelectorAll(".library-grid-card.focusable") || []
    );
    this.gridRows = cards.length ? groupNodesByRow(cards) : [];
  },

  resolveRelativeGridNode(current, direction) {
    if (!current || !current.matches?.(".library-grid-card.focusable")) {
      return null;
    }
    const rows = this.gridRows || [];
    if (!rows.length) {
      return null;
    }
    const currentRect = current.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const rowIndex = rows.findIndex((row) => row.nodes.includes(current));
    if (rowIndex < 0) {
      return null;
    }
    const currentRow = rows[rowIndex];
    const columnIndex = Math.max(0, currentRow.nodes.indexOf(current));

    if (direction === "left") {
      return currentRow.nodes[columnIndex - 1] || current;
    }
    if (direction === "right") {
      return currentRow.nodes[columnIndex + 1] || current;
    }
    if (direction === "up") {
      const previousRow = rows[rowIndex - 1];
      return previousRow ? findNearestNodeByCenterX(current, previousRow.nodes) : current;
    }
    if (direction === "down") {
      const nextRow = rows[rowIndex + 1];
      if (!nextRow) {
        return current;
      }
      let bestNode = nextRow.nodes[0] || null;
      let bestDistance = Number.POSITIVE_INFINITY;
      nextRow.nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const distance = Math.abs(centerX - currentCenterX);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNode = node;
        }
      });
      return bestNode;
    }
    return null;
  },

  isTopGridRowNode(node) {
    if (!node?.matches?.(".library-grid-card.focusable")) {
      return false;
    }
    return Boolean(this.gridRows?.[0]?.nodes?.includes(node));
  },

  handleActionsRowNavigation(event, current) {
    if (!current || !current.closest?.(".library-actions-row")) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    if (code === 37 || code === 39) {
      const buttons = Array.from(
        this.container?.querySelectorAll(".library-actions-row .focusable") || []
      ).filter((node) => !node.disabled);
      if (!buttons.length) {
        return false;
      }
      const currentIndex = Math.max(0, buttons.indexOf(current));
      const nextIndex = Math.max(
        0,
        Math.min(buttons.length - 1, currentIndex + (code === 37 ? -1 : 1))
      );
      event?.preventDefault?.();
      this.setFocusedNode(buttons[nextIndex] || current);
      return true;
    }
    if (code === 38) {
      const target = this.resolvePreferredPickerRowNode(current);
      if (!target) {
        return false;
      }
      event?.preventDefault?.();
      this.setFocusedNode(target);
      return true;
    }
    if (code === 40) {
      const target = this.resolvePreferredGridNode(current);
      if (!target) {
        return false;
      }
      event?.preventDefault?.();
      this.setFocusedNode(target);
      return true;
    }
    return false;
  },

  handleContentRowMemoryNavigation(event, current) {
    const state = this.controller.state;
    if (state.sourceMode !== "trakt" || state.expandedPicker || !current) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const isTopGridRow = this.isTopGridRowNode(current);
    const fromPickerRow =
      code === 40 &&
      current.matches?.(".library-picker-anchor.focusable") &&
      Boolean(current.closest?.(".library-picker-row"));
    const fromGrid =
      code === 38 &&
      current.matches?.(".library-grid-card.focusable") &&
      Boolean(current.closest?.(".library-grid")) &&
      isTopGridRow;
    const fromActionsRow = current.closest?.(".library-actions-row") || null;
    if (fromActionsRow) {
      return this.handleActionsRowNavigation(event, current);
    }
    if (!fromPickerRow && !fromGrid) {
      return false;
    }
    const target = this.resolvePreferredActionsRowNode();
    if (!target) {
      return false;
    }
    event?.preventDefault?.();
    this.setFocusedNode(target);
    return true;
  },

  handleFilterRowHorizontalNavigation(event, current) {
    if (
      !current ||
      !current.matches?.(".library-picker-anchor.focusable") ||
      !current.closest?.(".library-picker-row")
    ) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const delta = code === 37 ? -1 : code === 39 ? 1 : 0;
    if (!delta) {
      return false;
    }
    const anchors = Array.from(
      this.container?.querySelectorAll(".library-picker-row .library-picker-anchor.focusable") || []
    );
    if (!anchors.length) {
      return false;
    }
    const currentIndex = Math.max(0, anchors.indexOf(current));
    const nextIndex = Math.max(0, Math.min(anchors.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) {
      event?.preventDefault?.();
      return true;
    }
    const target = anchors[nextIndex] || null;
    if (!target) {
      return false;
    }
    event?.preventDefault?.();
    this.setFocusedNode(target);
    return true;
  },

  handleFilterRowVerticalNavigation(event, current) {
    if (
      !current ||
      !current.matches?.(".library-picker-anchor.focusable") ||
      !current.closest?.(".library-picker-row")
    ) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const direction = code === 38 ? "up" : code === 40 ? "down" : "";
    if (!direction) {
      return false;
    }
    const target = this.resolveRelativePickerRowNode(current, direction);
    if (!target || target === current) {
      return false;
    }
    event?.preventDefault?.();
    this.setFocusedNode(target);
    return true;
  },

  handleGridNavigation(event, current) {
    if (
      !current ||
      !current.matches?.(".library-grid-card.focusable") ||
      !current.closest?.(".library-grid")
    ) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 37 ? "left" : code === 39 ? "right" : code === 38 ? "up" : code === 40 ? "down" : "";
    if (!direction) {
      return false;
    }
    if (direction === "up") {
      const target = this.resolveRelativeGridNode(current, direction);
      if (target && target !== current) {
        event?.preventDefault?.();
        this.setFocusedNode(target);
        return true;
      }
      const pickerTarget = this.resolvePreferredPickerRowNode(current);
      if (!pickerTarget || pickerTarget === current) {
        return false;
      }
      event?.preventDefault?.();
      this.setFocusedNode(pickerTarget);
      return true;
    }
    const target = this.resolveRelativeGridNode(current, direction);
    if (!target) {
      return false;
    }
    event?.preventDefault?.();
    this.setFocusedNode(target);
    return true;
  },

  handleSidebarVerticalNavigation(event, current) {
    if (!current || !this.isSidebarNode(current)) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const delta = code === 38 ? -1 : code === 40 ? 1 : 0;
    if (!delta) {
      return false;
    }
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    if (!nodes.length) {
      return false;
    }
    const currentIndex = Math.max(0, nodes.indexOf(current));
    const nextIndex = Math.max(0, Math.min(nodes.length - 1, currentIndex + delta));
    event?.preventDefault?.();
    this.setFocusedNode(nodes[nextIndex] || current);
    return true;
  },

  resolvePreferredPrivacyNode() {
    const options = Array.from(
      this.container?.querySelectorAll(".library-list-editor .library-privacy-button.focusable") ||
        []
    );
    if (!options.length) {
      return null;
    }
    return (
      options.find(
        (node) => String(node.dataset.privacy || "") === this.lastPrivacyFocus && !node.disabled
      ) ||
      options.find((node) => node.classList.contains("selected") && !node.disabled) ||
      options.find((node) => !node.disabled) ||
      options[0] ||
      null
    );
  },

  handlePrivacyMemoryNavigation(event, current) {
    const state = this.controller.getState();
    if (!state.listEditorState || !current) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    if ((code === 37 || code === 39) && current.matches?.(".library-privacy-button.focusable")) {
      const options = Array.from(
        this.container?.querySelectorAll(
          ".library-list-editor .library-privacy-button.focusable"
        ) || []
      ).filter((node) => !node.disabled);
      const currentIndex = options.indexOf(current);
      if (currentIndex < 0) {
        return false;
      }
      const delta = code === 37 ? -1 : 1;
      const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
      const target = options[nextIndex] || current;
      event?.preventDefault?.();
      this.setFocusedNode(target);
      return true;
    }
    const fromDescription =
      code === 40 &&
      current.matches?.(".library-dialog-textarea.focusable[data-editor-field='description']");
    const fromActions =
      code === 38 &&
      current.matches?.(
        ".library-list-editor .library-action-button.focusable[data-action='saveListEditor'], .library-list-editor .library-action-button.focusable[data-action='cancelListEditor']"
      );
    if (!fromDescription && !fromActions) {
      return false;
    }
    const target = this.resolvePreferredPrivacyNode();
    if (!target) {
      return false;
    }
    event?.preventDefault?.();
    this.setFocusedNode(target);
    return true;
  },

  handleManageDialogNavigation(event, current) {
    if (
      !this.controller.getState().showManageDialog ||
      !current?.closest?.(".library-manage-dialog")
    ) {
      return false;
    }
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 37 ? "left" : code === 39 ? "right" : code === 38 ? "up" : code === 40 ? "down" : "";
    if (!direction) {
      return false;
    }

    const listButtons = Array.from(
      this.container?.querySelectorAll(".library-manage-list-button.focusable") || []
    ).filter((node) => !node.disabled);
    const actionRows = Array.from(
      this.container?.querySelectorAll(".library-manage-actions-row") || []
    );
    const rowButtons = actionRows.map((row) =>
      Array.from(row.querySelectorAll(".library-action-button.focusable")).filter(
        (node) => !node.disabled
      )
    );
    const firstRow = rowButtons[0] || [];
    const secondRow = rowButtons[1] || [];
    const nearestInRow = (row) => findNearestNodeByCenterX(current, row) || row[0] || null;
    let target = null;

    if (current.matches?.(".library-manage-list-button")) {
      const index = listButtons.indexOf(current);
      if (direction === "up") {
        target = listButtons[index - 1] || current;
      } else if (direction === "down") {
        target = listButtons[index + 1] || firstRow[0] || current;
      } else if (direction === "left" || direction === "right") {
        target = current;
      }
    } else if (current.closest?.(".library-manage-actions-row") === actionRows[0]) {
      const index = firstRow.indexOf(current);
      if (direction === "left") {
        target = firstRow[index - 1] || current;
      } else if (direction === "right") {
        target = firstRow[index + 1] || current;
      } else if (direction === "up") {
        target = listButtons[listButtons.length - 1] || current;
      } else if (direction === "down") {
        target = nearestInRow(secondRow) || current;
      }
    } else if (current.closest?.(".library-manage-actions-row") === actionRows[1]) {
      const index = secondRow.indexOf(current);
      if (direction === "left") {
        target = secondRow[index - 1] || current;
      } else if (direction === "right") {
        target = secondRow[index + 1] || current;
      } else if (direction === "up") {
        target = nearestInRow(firstRow) || current;
      } else if (direction === "down") {
        target = current;
      }
    }

    if (!target) {
      return false;
    }
    event?.preventDefault?.();
    this.setFocusedNode(target);
    return true;
  },

  isSidebarNode(node) {
    return isRootSidebarNode(node);
  },

  async focusSidebarNode(preferredNode = null) {
    this.focusZone = "sidebar";
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    }
    const target =
      preferredNode ||
      getRootSidebarSelectedNode(this.container, this.layoutPrefs) ||
      getRootSidebarNodes(this.container, this.layoutPrefs)[0] ||
      null;
    if (!target) {
      return false;
    }
    this.setFocusedNode(target);
    return true;
  },

  async focusMainNode(preferredNode = null, { preferEntryPoint = false } = {}) {
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    }
    if (this.pendingHydrationState) {
      const pendingHydrationState = this.pendingHydrationState;
      this.pendingHydrationState = null;
      this.updateRenderedLibraryContent(pendingHydrationState, {
        preservePickerRow: false
      });
    }
    const target =
      preferredNode ||
      (preferEntryPoint ? this.resolveMainEntryFocus() : null) ||
      this.resolveLastMainFocus() ||
      null;
    if (!target) {
      return false;
    }
    this.setFocusedNode(target);
    return true;
  },

  shouldTransferToSidebar(node) {
    if (!node || this.isSidebarNode(node)) {
      return false;
    }
    const main = this.container?.querySelector(".home-main");
    if (!main || !main.contains(node)) {
      return false;
    }
    const nodeRect = node.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return nodeRect.left - mainRect.left <= 140;
  },

  closeTopOverlay() {
    const state = this.controller.getState();
    if (state.listEditorState) {
      this.controller.closeEditor();
      return true;
    }
    if (state.showDeleteConfirm) {
      this.controller.closeDeleteConfirm();
      return true;
    }
    if (state.showManageDialog) {
      this.lastActionsRowAction = "openManageLists";
      this.pendingActionRestore = "openManageLists";
      this.controller.closeManageLists();
      return true;
    }
    if (this.closePosterOptionsMenu()) {
      return true;
    }
    if (state.expandedPicker) {
      this.pendingPickerRestore = state.expandedPicker;
      this.controller.closePicker();
      return true;
    }
    return false;
  },

  consumeBackRequest() {
    return this.closeTopOverlay();
  },

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
          this.container
            ?.querySelector(".home-main")
            ?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
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
      const selected = state.listTabs.find(
        (item) => item.key === state.manageSelectedListKey && item.type === "personal"
      );
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
      state.listEditorState ||
      state.showDeleteConfirm ||
      state.showManageDialog ||
      state.expandedPicker;

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
    const current =
      this.container?.querySelector(
        ".library-grid-card.focusable.focused[data-action='openDetail']"
      ) || null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  cleanup() {
    this.cancelScheduledRender();
    this.clearClosingPicker();
    this.lastRenderedExpandedPicker = null;
    this.cancelPendingPosterHold();
    this.posterOptionsMenu = null;
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.pendingPosterOptionsFocusKey = "";
    this.suppressHoldMenuEnterUntilKeyUp = false;
    this.gridRows = [];
    this.pendingHydrationState = null;
    this.controller?.dispose?.();
    this.controller = null;
    ScreenUtils.hide(this.container);
  }
};
