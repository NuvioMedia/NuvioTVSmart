/* eslint-disable no-unused-vars */
import * as internals from "./discoverScreen.js";

export function createDiscoverScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    addonRepository,
    watchedItemsRepository,
    watchedTitleStateRepository,
    LayoutPreferences,
    buildWatchedTitleIdSet,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    getSidebarProfileState,
    renderLoadingIndicator,
    catalogSkipStep,
    catalogSupportsExtra,
    PICKER_MENU_EXIT_MS,
    formatAddonTypeLabel,
    escapeHtml,
    t,
    extractReleaseYear
  } = internals;

  return {
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
      if (!this.container || Router.getCurrent() !== "discover") {
        return;
      }
      if (this.renderFrame) {
        return;
      }
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        if (!this.container || Router.getCurrent() !== "discover") {
          return;
        }
        this.render();
      });
    },
    async refreshWatchedTitleIds(items = this.items) {
      const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
      const projectedItems = await watchedTitleStateRepository
        .getTitleWatchedItems(Array.isArray(items) ? items : [], {
          baseWatchedItems: watchedItems,
          limit: 5000
        })
        .catch(() => watchedItems);
      this.watchedTitleIds = buildWatchedTitleIdSet(projectedItems);
    },
    getRouteStateKey() {
      return "discover";
    },
    captureRouteState() {
      this.captureViewState();
      return {
        selectedType: String(this.selectedType || "movie"),
        catalogs: Array.isArray(this.catalogs) ? [...this.catalogs] : [],
        selectedCatalogKey: String(this.selectedCatalogKey || ""),
        selectedGenre: String(this.selectedGenre || "Default"),
        items: Array.isArray(this.items) ? [...this.items] : [],
        nextSkip: Number(this.nextSkip || 0),
        hasMore: Boolean(this.hasMore),
        lastFocusedAction: String(this.lastFocusedAction || "discoverFilterType"),
        lastFocusedKey: this.lastFocusedKey ? String(this.lastFocusedKey) : null,
        lastFocusedDiscoverItemId: this.lastFocusedDiscoverItemId ? String(this.lastFocusedDiscoverItemId) : "",
        savedScrollTop: Number(this.savedScrollTop || 0),
        rowFocusedIndexByRow:
          this.rowFocusedIndexByRow && typeof this.rowFocusedIndexByRow === "object" ? { ...this.rowFocusedIndexByRow } : {},
        focusZone: String(this.focusZone || "content"),
        sidebarExpanded: Boolean(this.sidebarExpanded),
        sidebarFocusIndex: Number(this.sidebarFocusIndex || 0),
        pillIconOnly: Boolean(this.pillIconOnly)
      };
    },
    hydrateFromRouteState(restoredState = null) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      if (!snapshot) {
        return false;
      }
      this.selectedType = String(snapshot.selectedType || "movie");
      this.catalogs = Array.isArray(snapshot.catalogs) ? [...snapshot.catalogs] : [];
      this.selectedCatalogKey = String(snapshot.selectedCatalogKey || "");
      this.selectedGenre = String(snapshot.selectedGenre || "Default");
      this.items = Array.isArray(snapshot.items) ? [...snapshot.items] : [];
      this.nextSkip = Number(snapshot.nextSkip || 0);
      this.hasMore = Boolean(snapshot.hasMore);
      this.lastFocusedAction = String(snapshot.lastFocusedAction || "discoverFilterType");
      this.lastFocusedKey = snapshot.lastFocusedKey ? String(snapshot.lastFocusedKey) : null;
      this.lastFocusedDiscoverItemId = String(snapshot.lastFocusedDiscoverItemId || "");
      this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
      this.rowFocusedIndexByRow =
        snapshot.rowFocusedIndexByRow && typeof snapshot.rowFocusedIndexByRow === "object" ? { ...snapshot.rowFocusedIndexByRow } : {};
      this.focusZone = String(snapshot.focusZone || "content");
      this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && snapshot.sidebarExpanded);
      this.sidebarFocusIndex = Number(snapshot.sidebarFocusIndex || 0);
      this.pillIconOnly = Boolean(snapshot.pillIconOnly);
      this.loading = false;
      this.updateCatalogOptions();
      this.pendingRestoreFocus = true;
      this.preserveViewportOnNextRender = false;
      return true;
    },
    async mount(_params = {}, navigationContext = {}) {
      this.container = document.getElementById("discover");
      ScreenUtils.show(this.container);
      this.layoutPrefs = LayoutPreferences.get();
      const sidebarProfilePromise = getSidebarProfileState().catch((err) => {
        console.warn("Discover sidebar profile failed to load", err);
        return null;
      });
      try {
        this.sidebarProfile = await getSidebarProfileState({ cacheOnly: true });
      } catch (err) {
        console.warn("Discover cached sidebar profile failed to load", err);
        this.sidebarProfile = null;
      }
      this.sidebarExpanded = false;
      this.focusZone = "content";
      this.sidebarFocusIndex = 0;
      this.pillIconOnly = false;
      this.discoverRouteEnterPending = true;
      this.suppressInitialLoadingRenders = true;
      this.loadToken = (this.loadToken || 0) + 1;

      this.typeOptions = [];
      this.selectedType = "movie";
      this.catalogs = [];
      this.catalogOptions = [];
      this.selectedCatalogKey = "";
      this.genreOptions = ["Default"];
      this.selectedGenre = "Default";
      this.items = [];
      this.loading = true;

      this.openPicker = null;
      this.closingPicker = null;
      this.closingPickerTimer = null;
      this.lastRenderedOpenPicker = null;
      this.posterOptionsMenu = null;
      this.posterOptionsController = null;
      this.pendingPosterOptionsFocusKey = "";
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;
      this.pickerOptionIndex = 0;
      this.lastFocusedAction = "discoverFilterType";
      this.lastFocusedKey = null;
      this.savedScrollTop = 0;
      this.rowFocusedIndexByRow = {};
      this.pendingRestoreFocus = false;
      this.preserveViewportOnNextRender = false;
      this.discoverVerticalFastScrollState = null;
      this.discoverVerticalFastScrollEndTimer = null;
      this.nextSkip = 0;
      this.hasMore = true;
      const routeLoadToken = this.loadToken;
      const hasRestoredRouteState = Boolean(
        navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null)
      );

      // Android composes the Discover surface before watched-state and catalog
      // IO completes. Keep the Smart TV filters/focus surface responsive while
      // the initial content request continues asynchronously.
      this.render();

      void sidebarProfilePromise.then((profile) => {
        if (!profile || routeLoadToken !== this.loadToken || Router.getCurrent() !== "discover") {
          return;
        }
        // This is cosmetic state; defer repainting so a late avatar response
        // cannot replace the user's active picker or focused card.
        this.sidebarProfile = profile;
      });

      void (async () => {
        try {
          await this.refreshWatchedTitleIds();
          if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "discover") {
            return;
          }
          if (hasRestoredRouteState) {
            this.suppressInitialLoadingRenders = false;
            this.requestRender();
            return;
          }
          await this.loadCatalogsAndContent();
        } catch (err) {
          if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "discover") {
            return;
          }
          console.error("discoverScreen: Failed to load content", err);
          this.loading = false;
          this.items = [];
          this.suppressInitialLoadingRenders = false;
          this.requestRender();
        } finally {
          this.suppressInitialLoadingRenders = false;
        }
      })();
    },
    async loadCatalogsAndContent() {
      const token = this.loadToken;
      const addons = await addonRepository.getInstalledAddons();
      if (token !== this.loadToken) return;

      this.catalogs = [];
      addons.forEach((addon) => {
        addon.catalogs.forEach((catalog) => {
          // Only skip catalogs that REQUIRE a search query (truly search-only).
          // Catalogs that merely support optional search are still browsable and
          // belong in Discover (e.g. some addons declare an optional search extra).
          const isSearchOnly = (catalog.extra || []).some(
            (extra) =>
              String(extra?.name || "")
                .trim()
                .toLowerCase() === "search" && Boolean(extra?.isRequired)
          );
          if (isSearchOnly) return;
          const type = String(catalog.apiType || "").trim();
          if (!type) return;
          this.catalogs.push({
            key: `${addon.baseUrl}::${type}::${catalog.id}`,
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName || addon.name,
            catalogId: catalog.id,
            catalogName: catalog.name || catalog.id,
            type,
            extra: Array.isArray(catalog.extra) ? catalog.extra : [],
            supportsSkip: catalogSupportsExtra(catalog, "skip"),
            skipStep: catalogSkipStep(catalog)
          });
        });
      });

      this.updateCatalogOptions();
      await this.reloadItems();
    },
    updateCatalogOptions() {
      const dynamicTypes = [...new Set(this.catalogs.map((entry) => entry.type).filter(Boolean))];
      this.typeOptions = dynamicTypes.length ? dynamicTypes : ["movie", "series"];

      if (!this.typeOptions.includes(this.selectedType)) {
        this.selectedType = this.typeOptions[0] || "movie";
      }

      const forType = this.catalogs.filter((entry) => entry.type === this.selectedType);
      this.catalogOptions = forType;
      if (!forType.some((entry) => entry.key === this.selectedCatalogKey)) {
        this.selectedCatalogKey = forType[0]?.key || "";
      }
      this.updateGenreOptions();
    },
    updateGenreOptions() {
      const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
      const genreExtra = (selectedCatalog?.extra || []).find(
        (extra) =>
          String(extra?.name || "")
            .trim()
            .toLowerCase() === "genre"
      );
      const genres = Array.isArray(genreExtra?.options) ? genreExtra.options.filter(Boolean) : [];
      this.genreOptions = ["Default", ...genres];
      if (!this.genreOptions.includes(this.selectedGenre)) {
        this.selectedGenre = "Default";
      }
    },
    getSelectedCatalog() {
      return this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    },
    getDiscoverContextLabel(selectedCatalog = null) {
      return selectedCatalog
        ? `${selectedCatalog.addonName || "Addon"} • ${formatAddonTypeLabel(selectedCatalog.type)}`
        : "Choose a catalog to start browsing";
    },
    renderDiscoverCards(selectedCatalog = null) {
      // Tizen fast path: paged catalogs accumulate hundreds of items across
      // loads and every mount re-parses them all. Cap the initial render on
      // constrained runtimes while more pages remain; the existing
      // focus/scroll auto-load (shouldAutoLoadMore) appends the rest on
      // demand with stable original indices. Finite sets render fully.
      const allItems = Array.isArray(this.items) ? this.items : [];
      const renderItems = allItems.length > 40 && this.hasMore && ScreenUtils.shouldSkipRouteEnter(this) ? allItems.slice(0, 40) : allItems;
      return renderItems.length
        ? renderItems
            .map(
              (item, index) => `
                  <article class="discover-card seeall-card focusable"
                            data-action="openDetail"
                            data-item-id="${item.id || ""}"
                            data-item-type="${item.type || selectedCatalog?.type || "movie"}"
                            data-item-title="${item.name || "Untitled"}"
                            data-poster-src="${escapeHtml(item.poster || "")}"
                            data-backdrop-src="${escapeHtml(item.background || item.backdrop || "")}"
                            data-addon-base-url="${escapeHtml(selectedCatalog?.addonBaseUrl || item.addonBaseUrl || "")}"
                            data-addon-id="${escapeHtml(selectedCatalog?.addonId || item.addonId || "")}"
                            data-addon-name="${escapeHtml(selectedCatalog?.addonName || item.addonName || "")}"
                            data-catalog-type="${escapeHtml(selectedCatalog?.type || item.catalogType || "")}"
                            data-focus-key="item:${item.id || index}"
                            data-item-index="${index}">
                     <div class="seeall-card-poster-wrap">
                       ${
                         item.poster
                           ? `<img class="seeall-card-poster-image" data-src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" loading="lazy" decoding="async" />`
                           : `<div class="seeall-card-poster placeholder"></div>`
                       }
                       ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
                     </div>
                     ${
                       this.layoutPrefs?.posterLabelsEnabled !== false
                         ? `
                       <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
                       <div class="seeall-card-year">${escapeHtml(extractReleaseYear(item))}</div>
                     `
                         : ""
                     }
                   </article>
                 `
            )
            .join("")
        : `<div class="seeall-empty">${escapeHtml(t("catalog_see_all_empty_title", {}, "No items available"))}</div>`;
    },
    renderDiscoverLoadingMarkup() {
      return this.loading
        ? `
            <div class="seeall-loading">
              ${renderLoadingIndicator()}
              <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
            </div>
          `
        : "";
    }
  };
}
