import { MediaServerRepository } from "../../../data/mediaserver/mediaServerRepository.js";
/* eslint-disable no-unused-vars */
import * as internals from "./libraryScreen.js";

export function createLibraryScreenMethods02() {
  const { LIBRARY_VIEW_MODE, LibrarySourceMode, renderLoadingIndicator, escapeHtml, t, bookmarkOutlineSvg, selectorValue } = internals;

  return {
    renderPickerGroups(state) {
      if (state.viewMode === LIBRARY_VIEW_MODE.SERVERS) return `<section id="libraryPickerGroupsMount"></section>`;
      if (state.viewMode === LIBRARY_VIEW_MODE.CLOUD) {
        const providerLabel =
          state.availableCloudProviders.find((option) => option.key === state.selectedCloudProviderId)?.label ||
          t("cloud_library_provider_all", {}, "All");
        const typeLabel =
          state.availableCloudTypes.find((option) => option.key === state.selectedCloudType)?.label ||
          t("cloud_library_type_all", {}, "All");
        return `
            <section class="library-picker-groups" id="libraryPickerGroupsMount">
              <div class="library-picker-row">
                ${this.renderPicker(
                  "cloud_provider",
                  t("cloud_library_select_provider", {}, "Select provider"),
                  providerLabel,
                  this.controller.getPickerOptions("cloud_provider"),
                  "library-picker-flex"
                )}
                ${this.renderPicker(
                  "cloud_type",
                  t("cloud_library_select_type", {}, "Select type"),
                  typeLabel,
                  this.controller.getPickerOptions("cloud_type"),
                  "library-picker-flex"
                )}
              </div>
            </section>
          `;
      }
      const primaryPickerMarkup = [
        state.sourceMode !== LibrarySourceMode.LOCAL
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
          : "",
        this.renderPicker(
          "watched",
          t("library_filter_watched", {}, "Watched"),
          this.controller.getSelectedWatchedLabel(),
          this.controller.getPickerOptions("watched"),
          "library-picker-flex"
        ),
        `<button class="library-view-mode-button focusable${state.selectedWatchedFilter === "unwatched" ? " selected" : ""}" data-action="toggleHideWatched" aria-pressed="${state.selectedWatchedFilter === "unwatched"}">${escapeHtml(t("library_filter_hide_watched", {}, "Hide watched"))}</button>`
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
      if (state.viewMode === LIBRARY_VIEW_MODE.SERVERS) {
        const rows = MediaServerRepository.connections()
          .filter((connection) => connection.enabled)
          .map((connection) => {
            const libraries = connection.libraries.filter((library) => library.selected);
            if (!libraries.length) return "";
            return `<section class="library-grid-wrap"><h3>${escapeHtml(connection.name)}</h3><div class="library-view-mode-row">${libraries.map((library) => `<button class="library-view-mode-button focusable" data-action="openServerLibrary" data-connection-id="${escapeHtml(connection.id)}" data-library-id="${escapeHtml(library.id)}">${escapeHtml(library.name)}</button>`).join("")}</div></section>`;
          })
          .filter(Boolean)
          .join("");
        return `<div id="libraryContentAreaMount">${rows || `<section class="library-empty-state"><h3>${escapeHtml(t("library_servers_empty_title", {}, "No media servers"))}</h3><p>${escapeHtml(t("library_servers_empty_message", {}, "Connect a server in Settings."))}</p></section>`}</div>`;
      }
      if (state.viewMode === LIBRARY_VIEW_MODE.CLOUD) {
        return `
            <div id="libraryContentAreaMount">
              ${this.renderCloudActions(state)}
              <div id="libraryCloudResultsMount">
                ${this.renderCloudLibraryContent(state)}
                ${state.transientMessage ? `<div class="library-toast">${escapeHtml(state.transientMessage)}</div>` : ""}
              </div>
            </div>
          `;
      }
      return `
          <div id="libraryContentAreaMount">
            ${this.renderActions(state)}
            ${state.visibleItems.length ? this.renderGrid(state.visibleItems) : this.renderEmptyState()}
            ${state.transientMessage ? `<div class="library-toast">${escapeHtml(state.transientMessage)}</div>` : ""}
          </div>
        `;
    },
    renderViewModeTabs(state) {
      return `
          <div class="library-view-mode-row">
            <button class="library-view-mode-button focusable${state.viewMode === LIBRARY_VIEW_MODE.SERVERS ? " selected" : ""}" data-action="selectLibraryViewMode" data-view-mode="servers">${escapeHtml(t("library_source_servers", {}, "Servers"))}</button>
            <button class="library-view-mode-button focusable${state.viewMode === LIBRARY_VIEW_MODE.SAVED ? " selected" : ""}"
                    data-action="selectLibraryViewMode" data-view-mode="saved">
              ${escapeHtml(t("library_source_saved", {}, "Saved"))}
            </button>
            <button class="library-view-mode-button focusable${state.viewMode === LIBRARY_VIEW_MODE.CLOUD ? " selected" : ""}"
                    data-action="selectLibraryViewMode" data-view-mode="cloud">
              ${escapeHtml(t("library_source_cloud", {}, "Cloud"))}
            </button>
          </div>
        `;
    },
    renderCloudActions(state) {
      return `
          <section class="library-cloud-toolbar">
            <label class="library-cloud-search-shell">
              <span>${escapeHtml(t("cloud_library_search_label", {}, "Search cloud library"))}</span>
              <input class="library-cloud-search-input focusable"
                     data-cloud-search="true"
                     type="text"
                     value="${escapeHtml(state.cloudSearchQuery || "")}"
                     placeholder="${escapeHtml(t("cloud_library_search_placeholder", {}, "Search files"))}" />
            </label>
            <div id="libraryCloudActionsMount">
              ${this.renderCloudActionButtons(state)}
            </div>
          </section>
        `;
    },
    renderCloudActionButtons(state) {
      return `
          ${
            state.cloudSearchQuery
              ? `<button class="library-action-button focusable"
                         data-action="clearCloudSearch">
                   ${escapeHtml(t("cloud_library_search_clear", {}, "Clear search"))}
                 </button>`
              : ""
          }
          <button class="library-action-button focusable library-primary"
                  data-action="refreshCloudLibrary"
                  ${state.cloudLibrary.isRefreshing ? "disabled" : ""}>
            ${escapeHtml(t("cloud_library_refresh", {}, "Refresh cloud library"))}
          </button>
        `;
    },
    formatCloudSize(sizeBytes) {
      const bytes = Number(sizeBytes || 0);
      if (!(bytes > 0)) return "";
      if (bytes >= 1000000000) return `${(bytes / 1000000000).toFixed(1)} GB`;
      return `${Math.round(bytes / 1000000)} MB`;
    },
    cloudTypeLabel(type) {
      const labels = {
        Torrent: ["cloud_library_type_torrents", "Torrents"],
        Usenet: ["cloud_library_type_usenet", "Usenet"],
        WebDownload: ["cloud_library_type_web", "Web"],
        File: ["cloud_library_type_files", "Files"]
      };
      const [key, fallback] = labels[type] || ["cloud_library_type_files", String(type || "")];
      return t(key, {}, fallback);
    },
    renderCloudLibraryContent(state) {
      if (state.cloudLibrary.isRefreshing && !state.visibleCloudItems.length) {
        return `<section class="library-empty-state">${renderLoadingIndicator({ size: "medium" })}<p class="library-empty-subtitle">${escapeHtml(t("library_syncing_library", {}, "Loading library"))}</p></section>`;
      }
      let emptyTitle = "";
      let emptySubtitle = "";
      if (!state.cloudLibrary.isEnabled) {
        emptyTitle = t("cloud_library_disabled_title", {}, "Cloud library is off");
        emptySubtitle = t("cloud_library_disabled_message", {}, "Turn on Cloud library in Connected Services settings.");
      } else if (!(state.cloudLibrary.providers || []).length) {
        emptyTitle = t("cloud_library_connect_title", {}, "No cloud account connected");
        emptySubtitle = t("cloud_library_connect_message", {}, "Connect an account in Settings to browse cloud files.");
      } else if (!state.visibleCloudItems.length) {
        emptyTitle = t("cloud_library_empty_title", {}, "Nothing here yet");
        emptySubtitle = t("cloud_library_empty_message", {}, "No playable cloud files match the current filters.");
      }
      if (emptyTitle) {
        return `<section class="library-empty-state">${bookmarkOutlineSvg()}<h3 class="library-empty-title">${escapeHtml(emptyTitle)}</h3><p class="library-empty-subtitle">${escapeHtml(emptySubtitle)}</p></section>`;
      }
      return `
          <section class="library-grid-wrap library-cloud-grid-wrap">
            <div class="library-grid library-cloud-grid">
              ${state.visibleCloudItems
                .map((item) => {
                  const playableFiles = this.controller.playableFilesForCloudItem(item);
                  const fileLabel =
                    playableFiles.length === 0
                      ? t("cloud_library_no_playable_files", {}, "No playable files")
                      : playableFiles.length === 1
                        ? t("cloud_library_one_playable_file", {}, "1 playable file")
                        : t("cloud_library_playable_file_count", { count: playableFiles.length }, `${playableFiles.length} playable files`);
                  const metadata = [
                    item.providerName,
                    this.cloudTypeLabel(item.type),
                    item.status || t("cloud_library_status_ready", {}, "Ready to play"),
                    this.formatCloudSize(item.sizeBytes)
                  ]
                    .filter(Boolean)
                    .join(" • ");
                  const resolving = String(state.resolvingCloudFileKey || "").startsWith(item.stableKey);
                  return `
                    <article class="library-grid-card library-cloud-card focusable"
                             data-action="openCloudItem"
                             data-cloud-item-key="${escapeHtml(item.stableKey)}"
                             data-focus-key="cloud:${escapeHtml(item.stableKey)}">
                      <div class="library-cloud-card-copy">
                        <h3>${escapeHtml(item.name)}</h3>
                        <p>${escapeHtml(metadata)}</p>
                      </div>
                      <div class="library-cloud-card-status${playableFiles.length ? " playable" : ""}">
                        ${escapeHtml(resolving ? t("cloud_library_opening", {}, "Opening…") : fileLabel)}
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
        `;
    },
    syncRenderedPickerValues() {
      const valueByPicker = {
        list: this.controller.getSelectedListLabel(),
        type: this.controller.getSelectedTypeLabel(),
        sort: this.controller.getSelectedSortLabel(),
        genre: this.controller.getSelectedGenreLabel(),
        year: this.controller.getSelectedYearLabel(),
        watched: this.controller.getSelectedWatchedLabel(),
        cloud_provider:
          this.controller.state.availableCloudProviders.find((option) => option.key === this.controller.state.selectedCloudProviderId)
            ?.label || t("cloud_library_provider_all", {}, "All"),
        cloud_type:
          this.controller.state.availableCloudTypes.find((option) => option.key === this.controller.state.selectedCloudType)?.label ||
          t("cloud_library_type_all", {}, "All")
      };
      Object.entries(valueByPicker).forEach(([picker, value]) => {
        const node = this.container?.querySelector(`.library-picker-anchor[data-picker="${selectorValue(picker)}"] .library-picker-value`);
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
      Array.from(this.container.querySelectorAll(".library-picker-groups .library-picker")).forEach((node) => {
        node.classList.remove("open", "closing");
        const menu = node.querySelector(".library-picker-menu");
        if (menu) {
          menu.remove();
        }
      });
      Array.from(this.container.querySelectorAll(".library-picker-groups .library-picker-anchor")).forEach((node) => {
        node.setAttribute("aria-expanded", "false");
      });
      this.syncRenderedPickerValues(this.controller.getState());
      const target = picker ? this.container.querySelector(`.library-picker-anchor[data-picker="${selectorValue(picker)}"]`) : null;
      if (target instanceof HTMLElement) {
        this.container.querySelectorAll(".focusable.focused").forEach((node) => {
          if (node !== target) {
            node.classList.remove("focused");
          }
        });
        this.setFocusedNode(target);
      }
    }
  };
}
