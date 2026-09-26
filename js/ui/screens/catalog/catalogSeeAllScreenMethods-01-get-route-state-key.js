/* eslint-disable no-unused-vars */
import * as internals from "./catalogSeeAllScreen.js";

export function createCatalogSeeAllScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    catalogRepository,
    watchedItemsRepository,
    watchedTitleStateRepository,
    LayoutPreferences,
    filterReleasedItems,
    mergeCatalogPage,
    focusWithoutAutoScroll,
    buildWatchedTitleIdSet,
    isTitleItemWatched,
    renderTitleWatchedBadge,
    groupNodesByOffsetTop,
    setContainerScrollTop,
    scrollNodeIntoContainerView
  } = internals;
  const CATALOG_ITEM_WINDOW_SIZE = 48;
  const CATALOG_ITEM_WINDOW_AHEAD = 8;

  return {
    getRouteStateKey(params = {}) {
      const addonBaseUrl = String(params?.addonBaseUrl || "").trim();
      const catalogId = String(params?.catalogId || "").trim();
      const type = String(params?.type || "movie").trim() || "movie";
      if (!addonBaseUrl || !catalogId) {
        return null;
      }
      const normalizedArgs = Object.entries(params?.extraArgs && typeof params.extraArgs === "object" ? params.extraArgs : {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join("&");
      return `catalogSeeAll:${addonBaseUrl}:${catalogId}:${type}${normalizedArgs ? `:${normalizedArgs}` : ""}`;
    },
    captureRouteState() {
      this.captureViewState();
      return {
        params: this.params ? { ...this.params } : {},
        items: Array.isArray(this.items) ? [...this.items] : [],
        renderedItemsLimit: Number(this.renderedItemsLimit || CATALOG_ITEM_WINDOW_SIZE),
        nextSkip: Number(this.nextSkip || 0),
        hasMore: Boolean(this.hasMore),
        lastFocusedKey: this.lastFocusedKey ? String(this.lastFocusedKey) : null,
        savedScrollTop: Number(this.savedScrollTop || 0)
      };
    },
    hydrateFromRouteState(restoredState = null, params = {}) {
      const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
      if (!snapshot?.params) {
        return false;
      }
      const currentKey = this.getRouteStateKey(params);
      const snapshotKey = this.getRouteStateKey(snapshot.params);
      if (!currentKey || !snapshotKey || currentKey !== snapshotKey) {
        return false;
      }
      this.params = params || {};
      const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
      this.items = this.layoutPrefs?.hideUnreleasedContent ? filterReleasedItems(snapshotItems) : [...snapshotItems];
      const restoredItemsLimit = Number(snapshot.renderedItemsLimit);
      this.renderedItemsLimit = Number.isFinite(restoredItemsLimit)
        ? Math.max(CATALOG_ITEM_WINDOW_SIZE, restoredItemsLimit)
        : CATALOG_ITEM_WINDOW_SIZE;
      this.nextSkip = Number(snapshot.nextSkip || 0);
      this.hasMore = params?.supportsSkip !== false && Boolean(snapshot.hasMore);
      this.lastFocusedKey = snapshot.lastFocusedKey ? String(snapshot.lastFocusedKey) : null;
      this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
      this.pendingRestoreFocus = true;
      this.preserveViewportOnNextRender = false;
      return true;
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
    updateRenderedWatchedBadges() {
      const cards = this.container?.querySelectorAll(".seeall-card.focusable") || [];
      cards.forEach((card) => {
        const itemIndex = Number(card.dataset?.itemIndex);
        const item = Number.isInteger(itemIndex) ? this.items?.[itemIndex] : null;
        const posterWrap = card.querySelector(".seeall-card-poster-wrap");
        if (!item || !posterWrap) {
          return;
        }
        const watched = isTitleItemWatched(item, this.watchedTitleIds);
        const badge = posterWrap.querySelector(".title-watched-badge");
        if (watched && !badge) {
          posterWrap.insertAdjacentHTML("beforeend", renderTitleWatchedBadge());
        } else if (!watched && badge) {
          badge.remove();
        }
      });
    },
    async mount(params = {}, navigationContext = {}) {
      this.container = document.getElementById("catalogSeeAll");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.layoutPrefs = LayoutPreferences.get();
      const initialItems = Array.isArray(params?.initialItems) ? params.initialItems : [];
      const supportsSkip = params?.supportsSkip !== false;
      const rawSkipStep = Number(params?.skipStep);
      const skipStep = Number.isFinite(rawSkipStep) && rawSkipStep > 0 ? Math.trunc(rawSkipStep) : 100;
      const hasExplicitInitialHasMore = typeof params?.initialHasMore === "boolean";
      const initialHasMore = hasExplicitInitialHasMore ? params.initialHasMore : true;
      this.items = this.layoutPrefs?.hideUnreleasedContent ? filterReleasedItems(initialItems) : [...initialItems];
      this.renderedItemsLimit = CATALOG_ITEM_WINDOW_SIZE;
      const initialNextSkip = Number(params?.initialNextSkip);
      this.nextSkip =
        supportsSkip && initialHasMore && Number.isFinite(initialNextSkip) && initialNextSkip > 0
          ? Math.trunc(initialNextSkip)
          : supportsSkip && initialHasMore && this.items.length
            ? skipStep
            : 0;
      this.loading = false;
      this.hasMore = supportsSkip && initialHasMore;
      this.lastFocusedKey = this.items[0]?.id ? `item:${this.items[0].id}` : null;
      this.pendingRestoreFocus = false;
      this.preserveViewportOnNextRender = false;
      this.savedScrollTop = 0;
      this.loadToken = (this.loadToken || 0) + 1;
      this.posterOptionsController = null;
      this.posterOptionsFocusKey = "";
      this.pendingPosterHoldTarget = null;
      this.pendingPosterHoldTimer = null;

      if (navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
        this.loading = false;
        this.render();
        return;
      }

      const routeLoadToken = this.loadToken;
      const watchedTitleIdsPromise = this.refreshWatchedTitleIds();

      // Android composes the catalog grid while the watched-state flow and the
      // first catalog page are still loading. Keep the existing initial items
      // (when supplied by Home/Search) interactive and fetch the rest after the
      // route has completed.
      this.loading = !this.items.length;
      this.render();
      void (async () => {
        await watchedTitleIdsPromise;
        if (routeLoadToken !== this.loadToken || Router.getCurrent() !== "catalogSeeAll") {
          return;
        }
        if (!this.items.length) {
          this.loading = false;
          await this.loadNextPage();
          return;
        }
        // Watched badges are cosmetic. Do not replace a grid that the user has
        // already focused while the local watched snapshot was being read.
        if (!this.container?.querySelector(".seeall-card.focusable.focused")) {
          this.render();
        } else {
          this.updateRenderedWatchedBadges();
        }
      })().catch((error) => {
        if (routeLoadToken === this.loadToken && Router.getCurrent() === "catalogSeeAll") {
          this.loading = false;
          this.hasMore = false;
          this.render();
          console.warn("Catalog See All background load failed", error);
        }
      });
    },
    async loadNextPage({ preserveViewport = false } = {}) {
      if (this.loading || !this.hasMore) {
        return;
      }
      const descriptor = this.params || {};
      if (!descriptor.addonBaseUrl || !descriptor.catalogId || !descriptor.type) {
        this.hasMore = false;
        this.render();
        return;
      }
      this.loading = true;
      this.captureViewState();
      this.pendingRestoreFocus = true;
      this.preserveViewportOnNextRender = Boolean(preserveViewport);
      if (!preserveViewport) {
        this.render();
      }
      const token = this.loadToken;
      const skip = Math.max(0, Number(this.nextSkip || 0));
      const result = await catalogRepository.getCatalog({
        addonBaseUrl: descriptor.addonBaseUrl,
        addonId: descriptor.addonId,
        addonName: descriptor.addonName,
        catalogId: descriptor.catalogId,
        catalogName: descriptor.catalogName,
        type: descriptor.type,
        skip,
        skipStep: descriptor.skipStep,
        extraArgs: descriptor.extraArgs && typeof descriptor.extraArgs === "object" ? descriptor.extraArgs : {},
        supportsSkip: descriptor.supportsSkip !== false
      });
      if (token !== this.loadToken) {
        return;
      }
      if (result.status !== "success") {
        this.loading = false;
        this.hasMore = false;
        this.preserveViewportOnNextRender = false;
        this.render();
        return;
      }
      const rawIncoming = Array.isArray(result?.data?.items) ? result.data.items : [];
      const incoming = this.layoutPrefs?.hideUnreleasedContent ? filterReleasedItems(rawIncoming) : rawIncoming;
      const merged = mergeCatalogPage(this.items, incoming, skip, rawIncoming.length, result?.data?.nextSkip, result?.data?.hasMore);
      const addedCount = merged.addedCount;
      this.items = merged.items;
      this.nextSkip = merged.nextSkip;
      this.hasMore = merged.hasMore;
      this.loading = false;
      this.pendingRestoreFocus = true;
      this.preserveViewportOnNextRender = Boolean(preserveViewport && addedCount > 0);
      void this.refreshWatchedTitleIds(this.items).then(() => {
        if (token === this.loadToken && Router.getCurrent() === "catalogSeeAll") {
          // Watched state is cosmetic. Updating only the badge avoids rebuilding
          // the whole grid, which would otherwise drop the focused card and
          // restore the viewport at the top while the page is still settling.
          this.updateRenderedWatchedBadges();
        }
      });
      this.render();
    },
    captureViewState() {
      const shell = this.container?.querySelector(".seeall-shell");
      if (shell) {
        this.savedScrollTop = shell.scrollTop;
      }
      const focused = this.container?.querySelector(".seeall-card.focused");
      if (focused?.dataset?.focusKey) {
        this.lastFocusedKey = focused.dataset.focusKey;
      }
    },
    shouldAutoLoadMore(index) {
      if (this.loading || !this.hasMore) {
        return false;
      }
      const remaining = this.items.length - 1 - Number(index || 0);
      return remaining <= 10;
    },
    maybeExpandRenderedItems(index) {
      if (!this.hasMore || !ScreenUtils.shouldSkipRouteEnter(this)) {
        return false;
      }
      const allItems = Array.isArray(this.items) ? this.items : [];
      const rawLimit = Number(this.renderedItemsLimit);
      const currentLimit = Number.isFinite(rawLimit) ? Math.max(CATALOG_ITEM_WINDOW_SIZE, rawLimit) : CATALOG_ITEM_WINDOW_SIZE;
      const focusedIndex = Number(index);
      if (allItems.length <= currentLimit || !Number.isFinite(focusedIndex) || focusedIndex < currentLimit - CATALOG_ITEM_WINDOW_AHEAD) {
        return false;
      }
      const nextLimit = Math.min(allItems.length, currentLimit + CATALOG_ITEM_WINDOW_SIZE);
      if (nextLimit <= currentLimit) {
        return false;
      }
      this.renderedItemsLimit = nextLimit;
      this.pendingRestoreFocus = true;
      this.preserveViewportOnNextRender = true;
      return true;
    },
    shouldAutoLoadMoreFromScroll(shell) {
      if (!(shell instanceof HTMLElement) || this.loading || !this.hasMore) {
        return false;
      }
      const remaining = shell.scrollHeight - (shell.scrollTop + shell.clientHeight);
      return remaining <= 640;
    },
    buildNavigationModel() {
      const cards = Array.from(this.container?.querySelectorAll(".seeall-card.focusable") || []);
      const rows = groupNodesByOffsetTop(cards);
      rows.forEach((rowNodes, rowIndex) => {
        rowNodes.forEach((node, colIndex) => {
          node.dataset.navRow = String(rowIndex);
          node.dataset.navCol = String(colIndex);
        });
      });
      this.navModel = { rows };
    },
    rememberRowFocus(node) {
      if (!node?.dataset) {
        return;
      }
      const row = Number(node.dataset.navRow || -1);
      const col = Number(node.dataset.navCol || 0);
      if (row < 0) {
        return;
      }
      this.rowFocusedIndexByRow = {
        ...(this.rowFocusedIndexByRow || {}),
        [row]: Math.max(0, col)
      };
    },
    resolvePreferredNodeForRow(rowNodes = []) {
      if (!Array.isArray(rowNodes) || !rowNodes.length) {
        return null;
      }
      const rowIndex = Number(rowNodes[0]?.dataset?.navRow || -1);
      const storedIndex = rowIndex >= 0 ? Number(this.rowFocusedIndexByRow?.[rowIndex]) : Number.NaN;
      const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
      return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
    },
    focusNode(target) {
      if (!target) {
        return false;
      }
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) {
          node.classList.remove("focused");
        }
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
      this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
      this.rememberRowFocus(target);
      const shell = this.container?.querySelector(".seeall-shell") || null;
      const isFirstRow = Number(target.dataset.navRow || 0) === 0;
      const shouldLoadMore = this.shouldAutoLoadMore(target.dataset.itemIndex);
      // Instant scroll on per-keypress focus: a smooth scrollTo restarts its easing
      // on every held-down repeat, so the view jittered and only caught up on release.
      const nextScrollTop = isFirstRow
        ? setContainerScrollTop(shell, 0, "auto")
        : scrollNodeIntoContainerView(target, shell, {
            center: false,
            padding: 20,
            behavior: "auto"
          });
      if (Number.isFinite(nextScrollTop)) {
        this.savedScrollTop = nextScrollTop;
      }
      if (shouldLoadMore) {
        this.loadNextPage({ preserveViewport: true });
      }
      if (this.maybeExpandRenderedItems(target.dataset.itemIndex)) {
        this.render();
      }
      return true;
    }
  };
}
