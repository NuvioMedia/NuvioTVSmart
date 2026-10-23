/* eslint-disable no-unused-vars */
import * as internals from "./searchScreen.js";

export function createSearchScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    watchedItemsRepository,
    watchedTitleStateRepository,
    LayoutPreferences,
    SearchHistoryStore,
    Platform,
    getSidebarProfileState,
    renderRootSidebar,
    buildWatchedTitleIdSet,
    renderLoadingIndicator,
    escapeHtml,
    t,
    getInputSelectionSnapshot,
    restoreInputSelection,
    buildRowStateKey
  } = internals;

  return {
    getRouteStateKey() {
      return "route:search";
    },
    clearRouteStateOnMount(params = {}) {
      const incomingQuery = String(params.query || "").trim();
      if (!incomingQuery) {
        return false;
      }
      const previousQuery = String(this.query || "").trim();
      return Boolean(previousQuery && previousQuery !== incomingQuery);
    },
    captureRouteState() {
      this.captureLiveViewState();
      const content = this.container?.querySelector(".search-content");
      const rowScrollLeftByKey = {};
      Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
        const rowKey = String(rowNode.dataset.rowKey || "").trim();
        const track = rowNode.querySelector(".search-results-track");
        if (rowKey && track) {
          rowScrollLeftByKey[rowKey] = Number(track.scrollLeft || 0);
        }
      });
      const focused = this.container?.querySelector(".focusable.focused");
      return {
        query: String(this.query || ""),
        mode: String(this.mode || "idle"),
        rows: Array.isArray(this.rows)
          ? this.rows.map((row, index) => ({
              ...row,
              stateKey: row.stateKey || buildRowStateKey(row, index)
            }))
          : [],
        focusZone: String(this.focusZone || "content"),
        lastContentFocus: this.lastContentFocus ? { ...this.lastContentFocus } : null,
        sidebarExpanded: Boolean(this.sidebarExpanded),
        sidebarFocusIndex: Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0,
        pillIconOnly: Boolean(this.pillIconOnly),
        contentScrollTop: Number(content?.scrollTop || 0),
        rowScrollLeftByKey,
        rowFocusedIndexByKey: this.rowFocusedIndexByKey ? { ...this.rowFocusedIndexByKey } : {},
        pendingAutoFocusResults: false,
        voiceSearchSupported: Boolean(this.voiceSearchSupported),
        focusedAction: String(focused?.dataset?.action || ""),
        focusedRowKey: String(focused?.dataset?.rowKey || ""),
        focusedItemId: String(focused?.dataset?.itemId || ""),
        focusedNavZone: String(focused?.dataset?.navZone || ""),
        focusedNavRow: Number(focused?.dataset?.navRow || 0),
        focusedNavCol: Number(focused?.dataset?.navCol || 0)
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const incomingQuery = String(params.query || "").trim();
      const hasExplicitQuery = Boolean(incomingQuery);
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      this.query = hasExplicitQuery ? incomingQuery : String(snapshot?.query || "").trim();
      this.mode = hasExplicitQuery
        ? incomingQuery.length >= 2
          ? "search"
          : "idle"
        : String(snapshot?.mode || (this.query.length >= 2 ? "search" : "idle"));
      this.rows = Array.isArray(snapshot?.rows)
        ? snapshot.rows.map((row, index) => ({
            ...row,
            stateKey: row.stateKey || buildRowStateKey(row, index)
          }))
        : [];
      this.focusZone = String(snapshot?.focusZone || this.focusZone || "content");
      this.lastContentFocus = snapshot?.lastContentFocus ? { ...snapshot.lastContentFocus } : this.lastContentFocus || null;
      this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && snapshot?.sidebarExpanded);
      this.sidebarFocusIndex = Number.isFinite(snapshot?.sidebarFocusIndex) ? snapshot.sidebarFocusIndex : 0;
      this.pillIconOnly = Boolean(snapshot?.pillIconOnly);
      this.contentScrollTop = Number(snapshot?.contentScrollTop || 0);
      this.rowScrollLeftByKey =
        snapshot?.rowScrollLeftByKey && typeof snapshot.rowScrollLeftByKey === "object" ? { ...snapshot.rowScrollLeftByKey } : {};
      this.rowFocusedIndexByKey =
        snapshot?.rowFocusedIndexByKey && typeof snapshot.rowFocusedIndexByKey === "object" ? { ...snapshot.rowFocusedIndexByKey } : {};
      this.pendingAutoFocusResults = false;
      this.restoredFocusedDescriptor = snapshot
        ? {
            action: String(snapshot.focusedAction || ""),
            rowKey: String(snapshot.focusedRowKey || ""),
            itemId: String(snapshot.focusedItemId || ""),
            navZone: String(snapshot.focusedNavZone || ""),
            navRow: Number(snapshot.focusedNavRow || 0),
            navCol: Number(snapshot.focusedNavCol || 0)
          }
        : null;
    },
    cancelScheduledRender() {
      if (this.renderFrame) {
        cancelAnimationFrame(this.renderFrame);
        this.renderFrame = null;
      }
    },
    cancelScheduledInputSearch() {
      if (this.inputSearchTimer) {
        clearTimeout(this.inputSearchTimer);
        this.inputSearchTimer = null;
      }
    },
    requestRender() {
      if (!this.container || Router.getCurrent() !== "search") {
        return;
      }
      if (this.renderFrame) {
        return;
      }
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        if (!this.container || Router.getCurrent() !== "search") {
          return;
        }
        this.render();
      });
    },
    async refreshWatchedTitleIds(items = null) {
      const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
      const catalogItems = Array.isArray(items) ? items : (this.rows || []).flatMap((row) => (Array.isArray(row?.items) ? row.items : []));
      const projectedItems = await watchedTitleStateRepository
        .getTitleWatchedItems(catalogItems, {
          baseWatchedItems: watchedItems,
          limit: 5000
        })
        .catch(() => watchedItems);
      this.watchedTitleIds = buildWatchedTitleIdSet(projectedItems);
    },
    captureLiveViewState() {
      const content = this.container?.querySelector(".search-content");
      if (content) {
        this.contentScrollTop = Number(content.scrollTop || 0);
      }
      const nextRowScroll = {};
      Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
        const rowKey = String(rowNode.dataset.rowKey || "");
        const track = rowNode.querySelector(".search-results-track");
        if (rowKey && track) {
          nextRowScroll[rowKey] = Number(track.scrollLeft || 0);
        }
      });
      if (Object.keys(nextRowScroll).length) {
        this.rowScrollLeftByKey = {
          ...(this.rowScrollLeftByKey || {}),
          ...nextRowScroll
        };
      }
    },
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("search");
      ScreenUtils.show(this.container);
      this.searchRouteEnterPending = true;
      this.activationGuardUntil = Date.now() + 220;
      this.layoutPrefs = LayoutPreferences.get();
      const sidebarProfilePromise = getSidebarProfileState().catch((err) => {
        console.warn("Search sidebar profile failed to load", err);
        return null;
      });
      try {
        this.sidebarProfile = await getSidebarProfileState({ cacheOnly: true });
      } catch (err) {
        console.warn("Search cached sidebar profile failed to load", err);
        this.sidebarProfile = null;
      }
      this.sidebarExpanded = false;
      this.focusZone = "content";
      this.sidebarFocusIndex = 0;
      this.rows = [];
      this.recentSearches = SearchHistoryStore.list();
      this.lastContentFocus = null;
      this.contentScrollTop = 0;
      this.rowScrollLeftByKey = {};
      this.rowFocusedIndexByKey = {};
      this.restoredFocusedDescriptor = null;
      // TV platforms provide voice input through their native keyboard/IME, not
      // through a supported Web Speech API that an in-app button can start.
      this.voiceSearchSupported =
        Platform.isBrowser() &&
        typeof window !== "undefined" &&
        (typeof window.SpeechRecognition === "function" || typeof window.webkitSpeechRecognition === "function");
      this.voiceSearchActive = false;
      this.voiceRecognition = this.voiceRecognition || null;
      this.searchToastTimer = null;
      this.inputSearchTimer = null;
      this.posterOptionsMenu = null;
      this.posterOptionsController = null;
      this.pendingPosterOptionsFocusId = "";
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;
      this.hydrateFromRouteState(navigationContext?.restoredState || null, params);
      if (!navigationContext?.isBackNavigation) {
        this.focusZone = "content";
        this.sidebarExpanded = false;
        this.sidebarFocusIndex = 0;
        this.pillIconOnly = false;
      }
      this.loadToken = (this.loadToken || 0) + 1;
      this.cancelActiveSearchRequests();
      const routeLoadToken = this.loadToken;
      const watchedTitleIdsPromise = this.refreshWatchedTitleIds();
      const hasExplicitQuery = Boolean(String(params.query || "").trim());
      const restoredQuery = String(navigationContext?.restoredState?.query || "").trim();
      const shouldUseRestoredState = Boolean(
        navigationContext?.restoredState && (!hasExplicitQuery || restoredQuery === String(params.query || "").trim())
      );
      // Android composes the search surface before catalog and watched-state IO
      // completes. Paint the Smart TV shell now so the native input and sidebar
      // remain usable while the row request runs in the background.
      this.render();

      void sidebarProfilePromise.then((profile) => {
        if (!profile || routeLoadToken !== this.loadToken || Router.getCurrent() !== "search") {
          return;
        }
        // The profile/avatar is cosmetic. Do not replace the search DOM after
        // the user starts typing; the next render will use the refreshed value.
        this.sidebarProfile = profile;
      });

      void (async () => {
        try {
          await watchedTitleIdsPromise;
          if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "search") {
            return;
          }
          if (shouldUseRestoredState) {
            this.requestRender();
            return;
          }
          await this.reloadRows();
        } catch (err) {
          if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "search") {
            return;
          }
          console.error("searchScreen: Failed to load rows", err);
          this.rows = [];
          this.render();
        }
      })();
    },
    renderLoading() {
      this.container.innerHTML = `
          <div class="home-shell search-screen-shell${this.searchRouteEnterPending ? " search-route-enter" : ""}">
            ${renderRootSidebar({
              selectedRoute: "search",
              profile: this.sidebarProfile,
              layout: this.layoutPrefs,
              expanded: Boolean(this.sidebarExpanded),
              pillIconOnly: Boolean(this.pillIconOnly)
            })}
            <main class="home-main search-content search-loading-shell">
              <div class="search-loading">
                ${renderLoadingIndicator()}
                <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
              </div>
            </main>
          </div>
        `;
      this.searchRouteEnterPending = false;
    },
    async reloadRows() {
      const token = this.loadToken;
      let rows;
      if (this.mode === "search" && this.query.length >= 2) {
        rows = await this.searchRows(this.query, {
          token,
          onFirstResults: (rows) => {
            if (token !== this.loadToken) return;
            this.rows = rows;
            if (this.shouldPatchResultsWithoutReplacingInput()) {
              this.renderResultsOnly();
              return;
            }
            this.requestRender();
          }
        });
      } else if (this.mode === "discover") {
        rows = await this.loadDiscoverRows();
      } else {
        rows = [];
      }
      if (token !== this.loadToken) return;
      this.rows = rows;
      void this.refreshWatchedTitleIds().then(() => {
        if (token === this.loadToken && Router.getCurrent() === "search") {
          if (this.shouldPatchResultsWithoutReplacingInput()) {
            this.renderResultsOnly();
            return;
          }
          this.requestRender();
        }
      });
      if (this.shouldPatchResultsWithoutReplacingInput()) {
        this.renderResultsOnly();
        return;
      }
      this.requestRender();
    },
    shouldPatchResultsWithoutReplacingInput() {
      return this.isSearchInputEditingActive() && !this.pendingAutoFocusResults;
    },
    renderResultsOnly() {
      const content = this.container?.querySelector(".search-content");
      const header = content?.querySelector(".search-header");
      const input = this.container?.querySelector("#searchInput");
      if (!content || !header || !input) {
        this.requestRender();
        return;
      }
      const preserveInputEditing = document.activeElement === input;
      const selectionSnapshot = preserveInputEditing ? null : getInputSelectionSnapshot(input);

      while (header.nextSibling) {
        header.nextSibling.remove();
      }
      content.insertAdjacentHTML("beforeend", this.renderRows());
      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      this.bindActionEvents();
      // Keep the live IME value untouched while only the result siblings are refreshed.
      // `this.query` is normalized for catalog requests and may omit a trailing space
      // that the user has just entered and is still editing.
      // Re-focusing an input that is already being edited can interrupt the TV IME
      // composition even though this results-only update leaves the input in place.
      if (!preserveInputEditing) {
        input.focus?.();
        this.focusNode(this.container?.querySelector(".focusable.focused") || null, input);
        restoreInputSelection(input, selectionSnapshot);
      }
      this.pendingAutoFocusResults = false;
    }
  };
}
