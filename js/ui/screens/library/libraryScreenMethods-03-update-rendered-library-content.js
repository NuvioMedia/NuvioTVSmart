/* eslint-disable no-unused-vars */
import * as internals from "./libraryScreen.js";
import { calculateAdaptivePosterGridMetrics } from "./libraryPosterGridLayout.js";

const LIBRARY_POSTER_GRID_COLUMN_GAP = 24;
const LIBRARY_POSTER_GRID_ROW_GAP = 32;

export function createLibraryScreenMethods03() {
  const {
    ScreenUtils,
    LIBRARY_PRIVACY_OPTIONS,
    LIBRARY_VIEW_MODE,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    bindRootSidebarEvents,
    escapeHtml,
    t,
    bookmarkOutlineSvg,
    selectorValue
  } = internals;

  return {
    applyNoCssGridPosterLayout() {
      const grid = this.container?.querySelector(".library-poster-grid");
      if (!(grid instanceof HTMLElement) || !document.documentElement.classList.contains("no-css-grid")) {
        return;
      }

      const cards = Array.from(grid.children).filter((node) => node.classList.contains("library-grid-card"));
      if (!cards.length) {
        return;
      }

      const posterWidthValue = getComputedStyle(grid).getPropertyValue("--library-poster-width");
      const parsedPosterWidth = Number.parseFloat(posterWidthValue);
      const minPosterWidth = Number.isFinite(parsedPosterWidth) && parsedPosterWidth > 0 ? parsedPosterWidth : 252;
      const css = globalThis.CSS;
      const supportsGridTemplate =
        typeof css?.supports === "function" &&
        css.supports("display", "grid") &&
        css.supports("grid-template-columns", `repeat(auto-fill, minmax(${minPosterWidth}px, 1fr))`);
      if (supportsGridTemplate) {
        return;
      }

      const layout = calculateAdaptivePosterGridMetrics(grid.getBoundingClientRect().width, minPosterWidth, LIBRARY_POSTER_GRID_COLUMN_GAP);
      if (!layout) {
        return;
      }

      grid.classList.add("library-poster-grid-flex-fallback");
      const lastRow = Math.floor((cards.length - 1) / layout.columns);
      cards.forEach((card, index) => {
        const row = Math.floor(index / layout.columns);
        const column = index % layout.columns;
        const cardsInRow = Math.min(layout.columns, cards.length - row * layout.columns);
        const width = `${layout.cardWidth}px`;

        card.style.flex = `0 0 ${width}`;
        card.style.width = width;
        card.style.maxWidth = width;
        card.style.marginRight = column < cardsInRow - 1 ? `${LIBRARY_POSTER_GRID_COLUMN_GAP}px` : "0";
        card.style.marginBottom = row < lastRow ? `${LIBRARY_POSTER_GRID_ROW_GAP}px` : "0";
      });
    },
    updateRenderedLibraryContent(state, { preservePickerRow = true, preserveFocus = null } = {}) {
      const contentMount = this.container?.querySelector("#libraryContentAreaMount");
      // The loading shell has no content to refresh or restore focus into.
      // Let the full render consume the latest controller state first.
      if (!(contentMount instanceof HTMLElement)) {
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

      const cloudResultsMount = this.container.querySelector("#libraryCloudResultsMount");
      const cloudActionsMount = this.container.querySelector("#libraryCloudActionsMount");
      if (state.viewMode === LIBRARY_VIEW_MODE.CLOUD && cloudResultsMount instanceof HTMLElement) {
        if (cloudActionsMount instanceof HTMLElement) {
          cloudActionsMount.innerHTML = this.renderCloudActionButtons(state);
        }
        cloudResultsMount.outerHTML = `
            <div id="libraryCloudResultsMount">
              ${this.renderCloudLibraryContent(state)}
              ${state.transientMessage ? `<div class="library-toast">${escapeHtml(state.transientMessage)}</div>` : ""}
            </div>
          `;
      } else {
        contentMount.outerHTML = this.renderLibraryContentArea(state);
      }

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

      if (preserveFocus && this.container.contains(preserveFocus)) {
        this.setFocusedNode(preserveFocus);
        return;
      }

      if (this.pendingPickerRestore) {
        const target = this.container.querySelector(`.library-picker-anchor[data-picker="${selectorValue(this.pendingPickerRestore)}"]`);
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
            <div class="library-grid library-poster-grid">
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
        this.container?.querySelectorAll(`.library-picker.open .library-picker-option.focusable[data-picker="${selectorValue(picker)}"]`) ||
          []
      );
      if (!options.length) {
        return false;
      }
      const focusIndex = Math.max(0, Math.min(options.length - 1, Number(state.pickerFocusIndex || 0)));
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
    renderCloudFilePickerDialog(state) {
      const item = state.cloudFilePickerItem;
      if (!item) return "";
      const files = this.controller.playableFilesForCloudItem(item);
      return `
          <div class="library-overlay">
            <section class="library-dialog library-cloud-file-dialog">
              <h3 class="library-dialog-title">${escapeHtml(t("cloud_library_file_picker_title", {}, "Choose a file to play"))}</h3>
              <p class="library-dialog-subtitle">${escapeHtml(item.name)}</p>
              <div class="library-cloud-file-list">
                ${files
                  .map((file) => {
                    const key = `${item.stableKey}:${file.stableKey}`;
                    const resolving = state.resolvingCloudFileKey === key;
                    return `
                      <button class="library-cloud-file-button focusable"
                              data-action="playCloudFile"
                              data-cloud-item-key="${escapeHtml(item.stableKey)}"
                              data-cloud-file-key="${escapeHtml(file.stableKey)}"
                              ${resolving ? "disabled" : ""}>
                        <span>${escapeHtml(file.name)}</span>
                        <small>${escapeHtml(
                          resolving ? t("cloud_library_opening", {}, "Opening…") : this.formatCloudSize(file.sizeBytes)
                        )}</small>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          </div>
        `;
    }
  };
}
