import * as internals from "./homeScreenContext.js";
import { registerHomeDomNodes } from "./homeDomUpdate.js";

export function createHomeScreenMethods29() {
  const {
    Router,
    LayoutPreferences,
    catalogRepository,
    buildModernRowKey,
    MODERN_HOME_CONSTANTS,
    HOME_MAX_ITEMS_PER_ROW_DEFAULT,
    createPosterCardMarkup
  } = internals;

  return {
    setupModernTrackScrollPagination() {
      this.teardownModernTrackScrollPagination();
      if (this.layoutMode !== "modern" || !this.container) {
        return;
      }
      const tracks = Array.from(this.container.querySelectorAll(".home-modern-row .home-track"));
      if (!tracks.length) {
        return;
      }
      this._trackScrollHandlers = this._trackScrollHandlers || new Map();
      tracks.forEach((track) => {
        const rowKey = String(track.dataset.trackRowKey || "");
        if (!rowKey || this._trackScrollHandlers.has(track)) {
          return;
        }
        let duplicatePageRetryCount = 0;
        const scheduleLiveTrackCatchUp = (delayMs = 0) => {
          setTimeout(
            () => {
              if (Router.getCurrent() !== "home") {
                return;
              }
              const liveTrack = this.getNavigationRowSection(rowKey)?.querySelector?.(".home-track") || null;
              this._trackScrollHandlers?.get?.(liveTrack)?.requestAhead?.();
            },
            Math.max(0, Number(delayMs || 0))
          );
        };
        const runPagination = ({ assumeNearEnd = false } = {}) => {
          if (this._trackPaginationInFlight?.has(rowKey)) {
            return;
          }
          const cards = track.querySelectorAll(".home-content-card:not(.home-poster-card-loading)");
          const totalVisible = cards.length;
          if (!totalVisible) {
            return;
          }
          if (!assumeNearEnd) {
            // Estimate card width from first real card or fallback to CSS variable
            const firstCard = cards[0];
            const cardWidth = firstCard ? firstCard.offsetWidth : 212;
            const gapApprox = 24; // --home-poster-gap
            const nearEndThreshold = (cardWidth + gapApprox) * 4;
            const distanceFromEnd = track.scrollWidth - (track.scrollLeft + track.clientWidth);
            if (distanceFromEnd > nearEndThreshold) {
              return;
            }
          }
          // Find row data with hasMore
          const rowData = (this.rows || []).find((row) => buildModernRowKey(row) === rowKey);
          const rowResult = rowData?.result;
          if (!rowResult || rowResult.status !== "success") {
            return;
          }
          const rowPayload = rowResult.data;
          const currentItems = Array.isArray(rowPayload.items) ? rowPayload.items : [];
          const rowIndex = (this.rows || []).indexOf(rowData);
          const layoutPrefs = this.layoutPrefs || {};
          const showPosterLabels = Boolean(layoutPrefs.showPosterLabels !== false);
          const preferLandscape = Boolean(layoutPrefs.modernLandscapePostersEnabled);
          const chunkSize = Math.max(1, Number(this.getRowItemLimit?.() || HOME_MAX_ITEMS_PER_ROW_DEFAULT));
          const appendItemsToTrack = (itemsToAppend = [], startIndex = 0) => {
            if (!itemsToAppend.length || !track.isConnected || this._trackScrollHandlers?.get(track) !== handler) {
              return false;
            }
            // Read the poster preferences once per appended chunk, not per card.
            const posterSettings = LayoutPreferences.get();
            const newMarkup = itemsToAppend
              .map((item, i) =>
                createPosterCardMarkup(
                  item,
                  rowIndex,
                  startIndex + i,
                  rowData.type || "movie",
                  rowData,
                  showPosterLabels,
                  "modern",
                  false,
                  preferLandscape,
                  true,
                  this.watchedTitleIds,
                  posterSettings
                )
              )
              .join("");
            if (!newMarkup) {
              return false;
            }
            const frag = document.createRange().createContextualFragment(newMarkup);
            const appendedCards = Array.from(frag.querySelectorAll(".home-content-card.focusable"));
            registerHomeDomNodes(appendedCards);
            const navigationRowIndex = (this.navModel?.rows || []).findIndex((rowNodes) => rowNodes[0]?.closest?.(".home-track") === track);
            appendedCards.forEach((card, index) => {
              card.dataset.navZone = "main";
              card.dataset.navRow = String(Math.max(0, navigationRowIndex));
              card.dataset.navCol = String(startIndex + index);
              card.dataset.navRowKey = rowKey;
            });
            track.appendChild(frag);
            if (navigationRowIndex >= 0 && this.navModel?.rows?.[navigationRowIndex]) {
              this.navModel.rows[navigationRowIndex].push(...appendedCards);
              this.navModel.rowNodesByRowKey?.set?.(rowKey, this.navModel.rows[navigationRowIndex]);
            } else {
              this.invalidateNavigationModel();
              this.buildNavigationModel();
            }
            this.scheduleHomeLazyImageHydration(null, { refreshIndex: true });
            return true;
          };
          if (totalVisible < currentItems.length) {
            this._trackPaginationInFlight = this._trackPaginationInFlight || new Set();
            this._trackPaginationInFlight.add(rowKey);
            appendItemsToTrack(currentItems.slice(totalVisible, totalVisible + chunkSize), totalVisible);
            this._trackPaginationInFlight.delete(rowKey);
            return;
          }
          const supportsSkip = rowData.supportsSkip !== false && rowPayload?.supportsSkip !== false;
          if (!supportsSkip || !rowPayload?.hasMore) {
            return;
          }
          const storedNextSkip = Number(rowPayload.nextSkip);
          const skip =
            Number.isFinite(storedNextSkip) && storedNextSkip > currentItems.length ? Math.trunc(storedNextSkip) : currentItems.length;
          this._trackPaginationInFlight = this._trackPaginationInFlight || new Set();
          this._trackPaginationInFlight.add(rowKey);
          const token = this.homeLoadToken;
          let shouldRequestAnotherPage = false;
          catalogRepository
            .getCatalog({
              addonBaseUrl: rowData.addonBaseUrl || "",
              addonId: rowData.addonId || "",
              addonName: rowData.addonName || "",
              catalogId: rowData.catalogId || "",
              catalogName: rowData.catalogName || "",
              type: rowData.type || "movie",
              skip,
              skipStep: rowData.skipStep,
              supportsSkip: rowData.supportsSkip !== false
            })
            .then((result) => {
              if (token !== this.homeLoadToken || result?.status !== "success") {
                return;
              }
              const liveRowData = (this.rows || []).find((candidate) => buildModernRowKey(candidate) === rowKey) || rowData;
              const liveRowPayload = liveRowData?.result?.data || rowPayload;
              const latestItems = Array.isArray(liveRowPayload?.items) ? liveRowPayload.items : currentItems;
              const incomingItems = Array.isArray(result.data?.items) ? result.data.items : [];
              const seenIds = new Set(latestItems.map((item) => String(item?.id || "").trim()).filter(Boolean));
              const newItems = incomingItems.filter((item) => {
                const itemId = String(item?.id || "").trim();
                if (!itemId) {
                  return true;
                }
                if (seenIds.has(itemId)) {
                  return false;
                }
                seenIds.add(itemId);
                return true;
              });
              if (!incomingItems.length) {
                // Mark hasMore=false so we stop trying
                if (liveRowPayload) {
                  liveRowPayload.hasMore = false;
                }
                duplicatePageRetryCount = 0;
                return;
              }
              const reportedNextSkip = Number(result.data?.nextSkip);
              const nextSkip =
                Number.isFinite(reportedNextSkip) && reportedNextSkip > skip ? Math.trunc(reportedNextSkip) : skip + incomingItems.length;
              const startIndex = latestItems.length;
              // Update in-memory row data
              if (liveRowPayload) {
                liveRowPayload.items = [...latestItems, ...newItems];
                liveRowPayload.supportsSkip = result.data?.supportsSkip !== false;
                liveRowPayload.hasMore = liveRowPayload.supportsSkip && (result.data?.hasMore ?? newItems.length > 0);
                liveRowPayload.currentPage = result.data?.currentPage ?? liveRowPayload.currentPage;
                liveRowPayload.nextSkip = nextSkip;
              }
              const didAppend = appendItemsToTrack(newItems.slice(0, chunkSize), startIndex);
              if (didAppend) {
                duplicatePageRetryCount = 0;
              } else if (liveRowPayload?.hasMore) {
                duplicatePageRetryCount += 1;
                shouldRequestAnotherPage = duplicatePageRetryCount <= 2;
              }
              return didAppend;
            })
            .catch((err) => {
              console.warn("Home track pagination failed for", rowKey, err);
            })
            .finally(() => {
              if (token === this.homeLoadToken) {
                this._trackPaginationInFlight?.delete(rowKey);
                // A refresh can now keep the track mounted while replacing its
                // handler. Let the current handler append from its live count.
                if (!track.isConnected || this._trackScrollHandlers?.get(track) !== handler) {
                  scheduleLiveTrackCatchUp();
                } else if (shouldRequestAnotherPage) {
                  scheduleLiveTrackCatchUp(MODERN_HOME_CONSTANTS.trackPaginationPrefetchDelayMs);
                }
              }
            });
        };
        let scrollTimer = 0;
        let prefetchTimer = 0;
        let pendingPrefetchContext = null;
        let measuredTrackWidth = 0;
        let visibleCardCount = 1;
        const runWhenIdle = () => {
          scrollTimer = 0;
          if (!track.isConnected || Router.getCurrent() !== "home") {
            return;
          }
          if (
            this.modernVerticalFastScrollState ||
            this.isScrollAnimationActive(track, "x") ||
            this.isScrollAnimationActive(this.modernCameraFollowLastVerticalContainer, "y")
          ) {
            scrollTimer = setTimeout(runWhenIdle, 32);
            return;
          }
          runPagination();
        };
        const handler = () => {
          if (scrollTimer) {
            clearTimeout(scrollTimer);
          }
          scrollTimer = setTimeout(runWhenIdle, MODERN_HOME_CONSTANTS.trackPaginationIdleMs);
        };
        handler.requestAhead = (context = null) => {
          if (context?.focusedNode?.isConnected && Number(context?.focusedIndex) >= 0) {
            pendingPrefetchContext = context;
          }
          if (prefetchTimer) {
            return;
          }
          const waitsForDwell = Boolean(context?.focusedNode && this.isPerformanceConstrained?.());
          prefetchTimer = setTimeout(
            () => {
              prefetchTimer = 0;
              if (!track.isConnected || Router.getCurrent() !== "home") {
                pendingPrefetchContext = null;
                return;
              }
              if (waitsForDwell && this.getCurrentFocusedNode()?.closest?.(".home-track") !== track) {
                pendingPrefetchContext = null;
                return;
              }
              const requestContext = pendingPrefetchContext;
              pendingPrefetchContext = null;
              if (requestContext?.focusedNode?.isConnected) {
                const cards = track.querySelectorAll(".home-content-card:not(.home-poster-card-loading)");
                const mountedCount = cards.length;
                const trackWidth = Number(track.clientWidth || 0);
                if (trackWidth !== measuredTrackWidth) {
                  const cardWidth = Number(requestContext.focusedNode.offsetWidth || 0);
                  const styles = globalThis.getComputedStyle?.(track);
                  const gap = Number.parseFloat(styles?.columnGap || styles?.gap || "0") || 0;
                  const stride = Math.max(1, cardWidth + gap);
                  visibleCardCount = Math.max(1, Math.ceil(trackWidth / stride));
                  measuredTrackWidth = trackWidth;
                }
                const projectedLastVisible = Number(requestContext.focusedIndex) + visibleCardCount - 1;
                const loadAheadStart = Math.max(0, mountedCount - MODERN_HOME_CONSTANTS.trackPaginationLoadAheadItems);
                if (projectedLastVisible < loadAheadStart) {
                  return;
                }
              }
              runPagination({ assumeNearEnd: true });
            },
            waitsForDwell
              ? MODERN_HOME_CONSTANTS.trackPaginationPrefetchDwellConstrainedMs
              : MODERN_HOME_CONSTANTS.trackPaginationPrefetchDelayMs
          );
        };
        handler.cancelPending = () => {
          if (scrollTimer) {
            clearTimeout(scrollTimer);
            scrollTimer = 0;
          }
          if (prefetchTimer) {
            clearTimeout(prefetchTimer);
            prefetchTimer = 0;
          }
          pendingPrefetchContext = null;
        };
        this._trackScrollHandlers.set(track, handler);
        track.addEventListener("scroll", handler, { passive: true });
      });
    },
    teardownModernTrackScrollPagination() {
      if (!this._trackScrollHandlers) {
        return;
      }
      this._trackScrollHandlers.forEach((handler, track) => {
        track.removeEventListener("scroll", handler);
        handler.cancelPending?.();
      });
      this._trackScrollHandlers.clear();
    }
  };
}
