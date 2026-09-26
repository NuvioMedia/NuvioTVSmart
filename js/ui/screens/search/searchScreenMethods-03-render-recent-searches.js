/* eslint-disable no-unused-vars */
import * as internals from "./searchScreen.js";

export function createSearchScreenMethods03() {
  const {
    ScreenUtils,
    contentTextDirection,
    bindRootSidebarEvents,
    getRootSidebarNodes,
    getRootSidebarSelectedNode,
    renderRootSidebar,
    PosterOptionsDialogController,
    posterItemFromNode,
    POSTER_HOLD_DELAY_MS,
    escapeHtml,
    t,
    escapeSelectorValue
  } = internals;

  return {
    renderRecentSearches() {
      const recentSearches = Array.isArray(this.recentSearches) ? this.recentSearches : [];
      if (!recentSearches.length || String(this.query || "").trim()) {
        return "";
      }
      const clearLabel = t("search_recent_clear", {}, "Clear history");
      const title = t("search_recent_title", {}, "Recent searches");
      const closeLabel = t("action_close", {}, "Close");
      return `
          <section class="search-recent-section" aria-label="${escapeHtml(title)}">
            <div class="search-recent-header">
              <h3 class="search-recent-title">${escapeHtml(title)}</h3>
              <button class="search-recent-clear focusable" type="button" data-action="clearSearchHistory">
                ${escapeHtml(clearLabel)}
              </button>
            </div>
            <div class="search-recent-list">
              ${recentSearches
                .map((query) => {
                  const rowKey = `recent:${query}`;
                  return `
                    <div class="search-recent-item">
                      <button
                        class="search-recent-query focusable"
                        type="button"
                        data-action="runRecentSearch"
                        data-query="${escapeHtml(query)}"
                        data-row-key="${escapeHtml(rowKey)}"
                        dir="${contentTextDirection(query)}"
                      >${escapeHtml(query)}</button>
                      <button
                        class="search-recent-remove focusable"
                        type="button"
                        data-action="removeRecentSearch"
                        data-query="${escapeHtml(query)}"
                        data-row-key="${escapeHtml(rowKey)}"
                        aria-label="${escapeHtml(`${closeLabel} ${query}`)}"
                      ><span class="material-icons" aria-hidden="true">close</span></button>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </section>
        `;
    },
    render() {
      this.cancelScheduledRender();
      const queryText = this.query || "";
      this.container.innerHTML = `
          <div class="home-shell search-screen-shell${ScreenUtils.routeEnterClass(this, this.searchRouteEnterPending, " search-route-enter")}">
            ${renderRootSidebar({
              selectedRoute: "search",
              profile: this.sidebarProfile,
              layout: this.layoutPrefs,
              expanded: Boolean(this.sidebarExpanded),
              pillIconOnly: Boolean(this.pillIconOnly)
            })}
            <main class="home-main search-content">
              <section class="search-header${this.layoutPrefs?.discoverLocation === "in_search" ? "" : " no-discover"}${this.voiceSearchSupported ? "" : " no-voice"}">
                ${
                  this.layoutPrefs?.discoverLocation === "in_search"
                    ? `
                  <button class="search-discover-btn focusable" data-action="openDiscover">
                    <span class="search-action-icon material-icons" aria-hidden="true">explore</span>
                  </button>
                `
                    : ""
                }
                ${
                  this.voiceSearchSupported
                    ? `<button
                  class="search-voice-btn focusable${this.voiceSearchActive ? " listening" : ""}"
                  data-action="openVoice"
                  aria-label="Voice search"
                >
                  <span class="search-action-icon material-icons" aria-hidden="true">mic</span>
                </button>`
                    : ""
                }
                <input
                  id="searchInput"
                  class="search-input-field focusable"
                  type="text"
                  data-action="searchInput"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  placeholder="${escapeHtml(t("search_placeholder", {}, "Search movies & series"))}"
                  value="${escapeHtml(queryText)}"
                />
              </section>
              ${this.renderRows()}
            </main>
          </div>
        `;
      this.searchRouteEnterPending = false;

      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      bindRootSidebarEvents(this.container, {
        currentRoute: "search",
        onSelectedAction: () => this.closeSidebarToContent(),
        onExpandSidebar: () => this.openSidebar()
      });
      this.bindSearchInputEvents();
      this.bindActionEvents();
      const input = this.container.querySelector("#searchInput");
      input?.blur?.();
      this.restoreScrollState();
      const shouldFocusResults = Boolean(this.pendingAutoFocusResults && this.navModel?.rows?.[0]?.[0]);
      if (this.focusZone === "sidebar") {
        this.focusSidebarNode();
      } else {
        this.restoreContentFocus(shouldFocusResults);
      }
      this.pendingAutoFocusResults = false;
    },
    isPosterHoldTarget(node) {
      return (
        node instanceof HTMLElement && node.classList.contains("search-result-card") && String(node.dataset.action || "") === "openDetail"
      );
    },
    cancelPendingPosterHold() {
      if (this.pendingPosterHoldTimer) {
        clearTimeout(this.pendingPosterHoldTimer);
        this.pendingPosterHoldTimer = null;
      }
      this.pendingPosterHoldTarget = null;
    },
    hasPendingPosterHold(node) {
      return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
    },
    startPendingPosterHold(node) {
      this.cancelPendingPosterHold();
      if (!this.isPosterHoldTarget(node)) {
        return;
      }
      this.pendingPosterHoldTarget = node;
      this.pendingPosterHoldTimer = setTimeout(() => {
        this.pendingPosterHoldTimer = null;
        const target = this.pendingPosterHoldTarget;
        this.pendingPosterHoldTarget = null;
        if (target?.isConnected && target.classList.contains("focused")) {
          void this.openPosterOptionsMenu(target);
        }
      }, POSTER_HOLD_DELAY_MS);
    },
    completePendingPosterHold(node, event = null) {
      if (!this.pendingPosterHoldTarget) {
        return false;
      }
      const target = this.pendingPosterHoldTarget;
      const hadTimer = Boolean(this.pendingPosterHoldTimer);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
      this.cancelPendingPosterHold();
      if (hadTimer && target === node) {
        if (heldLongEnough) {
          void this.openPosterOptionsMenu(target);
        } else {
          this.openDetailFromNode(target);
        }
      }
      return true;
    },
    async openPosterOptionsMenu(node) {
      const item = posterItemFromNode(node);
      if (!item?.id) {
        return false;
      }
      this.captureLiveViewState();
      this.pendingPosterOptionsFocusId = String(item.id || "");
      if (!this.posterOptionsController) {
        this.posterOptionsController = new PosterOptionsDialogController({
          onDetails: (target) => {
            this.openDetailFromNode({
              dataset: {
                itemId: target.id,
                itemType: target.type || "movie",
                itemTitle: target.title || "Untitled",
                posterSrc: target.poster || "",
                backdropSrc: target.background || "",
                addonBaseUrl: target.addonBaseUrl || "",
                addonId: target.addonId || "",
                addonName: target.addonName || "",
                catalogType: target.catalogType || target.type || "movie"
              }
            });
          },
          onDismiss: () => {
            const itemId = this.pendingPosterOptionsFocusId;
            this.pendingPosterOptionsFocusId = "";
            const target = itemId
              ? this.container?.querySelector(`.search-result-card.focusable[data-item-id="${escapeSelectorValue(itemId)}"]`)
              : null;
            if (target) {
              this.focusNode(this.container?.querySelector(".focusable.focused"), target);
            }
          },
          onChanged: () => {
            void this.refreshWatchedTitleIds().then(() => this.render());
          }
        });
      }
      this.suppressHoldMenuEnterUntilKeyUp = true;
      return this.posterOptionsController.open(item);
    },
    closePosterOptionsMenu() {
      if (!this.posterOptionsController?.dialog) {
        return false;
      }
      this.posterOptionsController.destroy();
      return true;
    },
    buildNavigationModel() {
      const header = [
        this.container?.querySelector(".search-discover-btn.focusable"),
        this.container?.querySelector(".search-voice-btn.focusable"),
        this.container?.querySelector("#searchInput.focusable")
      ].filter(Boolean);
      const resultRows = Array.from(this.container?.querySelectorAll(".search-results-row .search-results-track") || [])
        .map((track) => Array.from(track.querySelectorAll(".search-result-card.focusable")))
        .filter((row) => row.length > 0);
      const recentRows = Array.from(this.container?.querySelectorAll(".search-recent-item") || [])
        .map((row) => Array.from(row.querySelectorAll(".focusable")))
        .filter((row) => row.length > 0);
      const rows = [...resultRows, ...recentRows];
      const recentClear = this.container?.querySelector(".search-recent-clear.focusable") || null;

      header.forEach((node, index) => {
        node.dataset.navZone = "header";
        node.dataset.navCol = String(index);
      });

      rows.forEach((rowNodes, rowIndex) => {
        const rowKey = String(rowNodes[0]?.dataset?.rowKey || "");
        rowNodes.forEach((node, colIndex) => {
          node.dataset.navZone = "results";
          node.dataset.navRow = String(rowIndex);
          node.dataset.navCol = String(colIndex);
          if (rowKey) {
            node.dataset.rowKey = rowKey;
          }
        });
      });

      if (recentClear) {
        recentClear.dataset.navZone = "recent-clear";
        recentClear.dataset.navCol = "0";
      }

      this.navModel = { header, rows, recentClear };
      if (!this.lastContentFocus) {
        const fallback = this.getDefaultHeaderFocusTarget() || rows[0]?.[0] || null;
        if (fallback) {
          this.rememberContentFocus(fallback);
        }
      }
    },
    getDefaultHeaderFocusTarget() {
      return (
        this.container?.querySelector("#searchInput.focusable") ||
        this.container?.querySelector(".search-discover-btn.focusable") ||
        this.container?.querySelector(".search-voice-btn.focusable") ||
        null
      );
    },
    restoreScrollState() {
      const content = this.container?.querySelector(".search-content");
      if (content) {
        content.scrollTop = Number(this.contentScrollTop || 0);
      }
      Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
        const rowKey = String(rowNode.dataset.rowKey || "");
        const track = rowNode.querySelector(".search-results-track");
        if (rowKey && track) {
          track.scrollLeft = Number(this.rowScrollLeftByKey?.[rowKey] || 0);
        }
      });
    },
    rememberContentFocus(node) {
      if (!node) {
        return;
      }
      const rowKey = String(node.dataset.rowKey || "");
      if (String(node.dataset.navZone || "") === "results" && rowKey) {
        this.rowFocusedIndexByKey = {
          ...(this.rowFocusedIndexByKey || {}),
          [rowKey]: Math.max(0, Number(node.dataset.navCol || 0))
        };
      }
      this.lastContentFocus = {
        zone: String(node.dataset.navZone || ""),
        row: Number(node.dataset.navRow || 0),
        col: Number(node.dataset.navCol || 0),
        action: String(node.dataset.action || ""),
        rowKey
      };
    },
    resolvePreferredResultsNode(rowNodes = [], _fallbackCol = 0) {
      if (!Array.isArray(rowNodes) || !rowNodes.length) {
        return null;
      }
      const rowKey = String(rowNodes[0]?.dataset?.rowKey || "");
      const storedIndex = rowKey ? Number(this.rowFocusedIndexByKey?.[rowKey]) : Number.NaN;
      const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
      return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
    },
    focusSidebarNode(preferredNode = null) {
      const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      const target = preferredNode || getRootSidebarSelectedNode(this.container, this.layoutPrefs) || nodes[0] || null;
      if (!target) {
        return false;
      }
      this.sidebarFocusIndex = Math.max(0, nodes.indexOf(target));
      this.focusNode(this.container?.querySelector(".focusable.focused") || null, target);
      return true;
    }
  };
}
