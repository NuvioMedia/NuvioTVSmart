/* eslint-disable no-unused-vars */
import * as internals from "./folderDetailScreen.js";

export function createFolderDetailScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    addonRepository,
    watchedItemsRepository,
    watchedTitleStateRepository,
    CollectionsStore,
    LayoutPreferences,
    HomeScreen,
    escapeHtml,
    normalizeCollectionFolderItem,
    buildWatchedTitleIdSet,
    renderLoadingIndicator,
    FOLDER_SOURCE_RENDER_BATCH_MS,
    buildFolderHeroSeed,
    buildFallbackStreamingSources,
    roundRobinMerge,
    buildAddonTabLabel,
    buildTmdbTabLabel,
    buildTraktTabLabel,
    buildFolderSourceKey,
    I18n
  } = internals;

  return {
    getRouteStateKey(params = {}) {
      const collectionId = String(params?.collectionId || "").trim();
      const folderId = String(params?.folderId || "").trim();
      if (!collectionId || !folderId) {
        return null;
      }
      return `folderDetail:${collectionId}:${folderId}`;
    },
    cancelScheduledRender() {
      if (this.folderDetailRenderTimer) {
        clearTimeout(this.folderDetailRenderTimer);
        this.folderDetailRenderTimer = null;
      }
    },
    scheduleRender() {
      if (this.folderDetailRenderTimer || !this.container || Router.getCurrent() !== "folderDetail") {
        return;
      }
      this.folderDetailRenderTimer = setTimeout(() => {
        this.folderDetailRenderTimer = null;
        if (!this.container || Router.getCurrent() !== "folderDetail") {
          return;
        }
        this.render();
      }, FOLDER_SOURCE_RENDER_BATCH_MS);
    },
    captureRouteState() {
      const shell = this.container?.querySelector(".seeall-shell");
      const active =
        document.activeElement instanceof HTMLElement && this.container?.contains(document.activeElement) ? document.activeElement : null;
      const focused =
        (active?.classList?.contains("focusable") ? active : null) || this.container?.querySelector(".focusable.focused") || active;
      const focusedSection = focused?.closest?.("[data-row-key]") || null;
      const trackScrollStates = Object.fromEntries(
        Array.from(this.container?.querySelectorAll(".folder-row-track[data-row-key]") || [])
          .map((track) => [String(track.dataset.rowKey || ""), Number(track.scrollLeft || 0)])
          .filter(([key]) => key)
      );
      return {
        params: this.params ? { ...this.params } : {},
        selectedTabIndex: Number(this.selectedTabIndex || 0),
        lastFocusedKey: String(this.lastFocusedKey || ""),
        focusedItemId: String(focused?.dataset?.itemId || ""),
        focusedItemType: String(focused?.dataset?.itemType || ""),
        focusedRowKey: String(focusedSection?.dataset?.rowKey || focused?.closest?.("[data-track-row-key]")?.dataset?.trackRowKey || ""),
        savedScrollTop: Number(shell?.scrollTop ?? this.savedScrollTop ?? 0),
        trackScrollStates,
        tabs: Array.isArray(this.tabs)
          ? this.tabs.map((tab) => ({
              ...tab,
              restoreNeedsReload: Boolean(tab.loading),
              loading: false
            }))
          : [],
        heroItem: this.heroItem ? { ...this.heroItem } : null,
        followLayoutFocusState: this.useHomeFollowLayout ? HomeScreen.captureCurrentContentFocusState.call(this) : null
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      if (!snapshot?.params || this.getRouteStateKey(snapshot.params) !== this.getRouteStateKey(params)) {
        return false;
      }
      this.selectedTabIndex = Math.max(0, Number(snapshot.selectedTabIndex || 0));
      this.lastFocusedKey = String(snapshot.lastFocusedKey || "tab:0");
      this.restoredFocusedItem = snapshot.focusedItemId
        ? {
            itemId: String(snapshot.focusedItemId),
            itemType: String(snapshot.focusedItemType || ""),
            rowKey: String(snapshot.focusedRowKey || "")
          }
        : null;
      this.savedScrollTop = Math.max(0, Number(snapshot.savedScrollTop || 0));
      this.restoredTrackScrollStates = snapshot.trackScrollStates || {};
      this.restoredFollowLayoutFocusState = snapshot.followLayoutFocusState || null;
      if (snapshot.heroItem?.id) {
        this.heroItem = { ...snapshot.heroItem };
      }

      const restoredTabs = new Map(
        (Array.isArray(snapshot.tabs) ? snapshot.tabs : []).filter((tab) => tab?.key).map((tab) => [String(tab.key), tab])
      );
      this.tabs = this.tabs.map((tab) => {
        const restored = restoredTabs.get(String(tab.key || ""));
        return restored
          ? {
              ...tab,
              items: Array.isArray(restored.items) ? [...restored.items] : [],
              hasMore: Boolean(restored.hasMore),
              page: Math.max(1, Number(restored.page || 1)),
              nextSkip: Number.isFinite(Number(restored.nextSkip))
                ? Math.max(0, Math.trunc(Number(restored.nextSkip)))
                : Math.max(0, (Math.max(1, Number(restored.page || 1)) - 1) * Number(restored.skipStep || tab.skipStep || 100)),
              skipStep: Number(restored.skipStep || tab.skipStep || 100),
              loading: false,
              error: String(restored.error || ""),
              restoreNeedsReload: Boolean(restored.restoreNeedsReload)
            }
          : tab;
      });
      this.sourceTabs = this.tabs.filter((tab) => !tab.isAllTab);
      this.selectedTabIndex = Math.min(this.selectedTabIndex, Math.max(0, this.tabs.length - 1));
      return true;
    },
    async refreshWatchedTitleIds(items = null, baseWatchedItems = null) {
      const watchedItems = Array.isArray(baseWatchedItems) ? baseWatchedItems : await watchedItemsRepository.getAll(5000).catch(() => []);
      const folderItems = Array.isArray(items) ? items : (this.tabs || []).flatMap((tab) => (Array.isArray(tab?.items) ? tab.items : []));
      const projectedItems = await watchedTitleStateRepository
        .getTitleWatchedItems(folderItems, {
          baseWatchedItems: watchedItems,
          limit: 5000
        })
        .catch(() => watchedItems);
      this.watchedTitleIds = buildWatchedTitleIdSet(projectedItems);
    },
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("folderDetail");
      this.cancelScheduledRender();
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.layoutPrefs = LayoutPreferences.get();
      this.collection = CollectionsStore.get().find((entry) => String(entry?.id || "") === String(this.params.collectionId || "")) || null;
      this.folder = this.collection?.folders?.find((entry) => String(entry?.id || "") === String(this.params.folderId || "")) || null;
      this.selectedTabIndex = 0;
      this.lastFocusedKey = "tab:0";
      this.savedScrollTop = 0;
      this.restoredTrackScrollStates = {};
      this.restoredFollowLayoutFocusState = null;
      this.restoredFocusedItem = null;
      this.isRestoringFocusFromBack = false;
      this.homeHoldFocusLocked = false;
      this.lastMainFocus = null;
      this.navModel = { rows: [] };
      this.tabs = [];
      this.sourceTabs = [];
      this._trackPaginationInFlight = new Set();
      this.folderLoadToken = (this.folderLoadToken || 0) + 1;
      const folderLoadToken = this.folderLoadToken;
      const preferredHomeLayout = String(this.layoutPrefs?.homeLayout || "classic").toLowerCase();
      this.viewMode = String(this.collection?.viewMode || "TABBED_GRID").toUpperCase();
      this.useHomeFollowLayout = this.viewMode === "FOLLOW_LAYOUT" || preferredHomeLayout === "modern";
      this.folderRouteEnterPending = true;
      this.heroItem = null;

      if (!this.collection || !this.folder) {
        this.container.innerHTML = `<div class="seeall-shell"><div class="seeall-empty">${escapeHtml(I18n.t("folder_detail_not_found", {}, { fallback: "Folder not found" }))}</div></div>`;
        return;
      }

      this.heroItem =
        normalizeCollectionFolderItem(
          {
            ...(this.folder || {}),
            collectionId: this.collection.id,
            collectionTitle: this.collection.title
          },
          this.collection
        ) || buildFolderHeroSeed(this.folder);
      if (this.useHomeFollowLayout) {
        this.layoutMode = "modern";
        this.layoutPrefs = {
          ...this.layoutPrefs,
          homeLayout: "modern",
          heroSectionEnabled: true
        };
        this.continueWatchingDisplay = [];
        this.continueWatchingLoading = false;
        this.heroCandidates = [this.heroItem].filter(Boolean);
        this.heroIndex = 0;
        this.rows = [];
        HomeScreen.ensureDelegatedEventsBound.call(this);
      }

      this.renderLoading();

      // Android exposes the folder destination while its ViewModel resolves
      // addon metadata, watched state, and source tabs in viewModelScope. Keep
      // the same route-first ordering here; the existing tab loader remains the
      // single source of truth for source results and pagination.
      void (async () => {
        const [addons, watchedItems] = await Promise.all([
          addonRepository.getInstalledAddons().catch(() => []),
          watchedItemsRepository.getAll(5000).catch(() => [])
        ]);
        if (folderLoadToken !== this.folderLoadToken || Router.getCurrent() !== "folderDetail") {
          return;
        }
        this.watchedTitleIds = buildWatchedTitleIdSet(watchedItems);
        const folderSources =
          Array.isArray(this.folder.sources) && this.folder.sources.length
            ? this.folder.sources
            : buildFallbackStreamingSources(this.folder);
        const sourceTabs = folderSources.map((source, index) => ({
          key: buildFolderSourceKey(source, index),
          label:
            source.provider === "tmdb"
              ? buildTmdbTabLabel(source)
              : source.provider === "trakt"
                ? buildTraktTabLabel(source)
                : buildAddonTabLabel(source, addons),
          source,
          items: [],
          hasMore: false,
          page: 1,
          nextSkip: 0,
          skipStep: 100,
          loading: false,
          error: ""
        }));
        this.sourceTabs = sourceTabs;
        this.tabs =
          this.collection.showAllTab !== false && sourceTabs.length > 1
            ? [
                {
                  key: "all",
                  label: "All",
                  isAllTab: true,
                  items: [],
                  hasMore: false,
                  page: 1,
                  nextSkip: 0,
                  skipStep: 100,
                  loading: true,
                  error: ""
                },
                ...sourceTabs
              ]
            : sourceTabs;

        const restored =
          Boolean(navigationContext?.isBackNavigation) && this.hydrateFromRouteState(navigationContext?.restoredState, this.params);
        const sourceOffset = this.tabs[0]?.isAllTab ? 1 : 0;
        const tabsToLoad = restored
          ? this.tabs
              .map((tab, index) => ({ tab, index }))
              .filter(({ tab }) => !tab.isAllTab && tab.restoreNeedsReload)
              .map(({ index }) => index)
          : sourceTabs.map((_, index) => index + sourceOffset);
        tabsToLoad.forEach((index) => {
          const tab = this.tabs[index];
          if (tab && !tab.isAllTab) {
            this.tabs[index] = { ...tab, loading: true, error: "" };
          }
        });
        this.sourceTabs = this.tabs.filter((tab) => !tab.isAllTab);
        this.rebuildAllTab();
        this.render();
        await Promise.all(tabsToLoad.map((index) => this.loadTab(index, { background: true, loadToken: folderLoadToken })));
        if (folderLoadToken === this.folderLoadToken && Router.getCurrent() === "folderDetail") {
          await this.refreshWatchedTitleIds(null, watchedItems);
          if (tabsToLoad.length) {
            this.render();
          }
        }
      })().catch((error) => {
        if (folderLoadToken === this.folderLoadToken && Router.getCurrent() === "folderDetail") {
          console.warn("Folder detail background load failed", error);
          this.tabs = [];
          this.sourceTabs = [];
          this.render();
        }
      });
    },
    renderLoading() {
      this.container.innerHTML = `
          <div class="seeall-shell folder-detail-shell">
            <header class="seeall-header folder-detail-header">
              <div class="folder-detail-eyebrow">${escapeHtml(this.collection?.title || "Collection")}</div>
              <h2 class="seeall-title">${escapeHtml(this.folder?.title || "Folder")}</h2>
            </header>
            <div class="seeall-loading">
              ${renderLoadingIndicator()}
              <span>${escapeHtml(I18n.t("common.loading", {}, { fallback: "Loading..." }))}</span>
            </div>
          </div>
        `;
    },
    rebuildAllTab() {
      if (!this.tabs[0]?.isAllTab) {
        return;
      }
      const sourceTabs = this.tabs.slice(1);
      this.tabs[0] = {
        ...this.tabs[0],
        items: roundRobinMerge(sourceTabs.map((tab) => tab.items || [])),
        hasMore: sourceTabs.some((tab) => tab.hasMore),
        loading: sourceTabs.some((tab) => tab.loading),
        error: ""
      };
    }
  };
}
