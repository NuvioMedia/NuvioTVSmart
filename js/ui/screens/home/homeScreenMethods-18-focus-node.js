import * as internals from "./homeScreenContext.js";
import {
  createHomeRowWindow,
  isHomeRowWindowSupported,
  supportsHomeGridRowWindow,
  HOME_LEGACY_ROW_WINDOW_SELECTOR,
  HOME_ROW_WINDOW_SELECTOR
} from "./homeRowWindow.js";
import { chunkHomeGridCards } from "./homeScreenHelpers-14-get-home-grid-column-count.js";

// Bounded TV runtimes decode the overlay after the focus frame instead of inside it.
const MODERN_TV_COLLECTION_GIF_SETTLE_DELAY_MS = 380;

export function createHomeScreenMethods18() {
  const { HOME_PERF_DEBUG, homePerfNow, logHomePerf, groupNodesByOffsetTop } = internals;

  return {
    focusNode(current, target, direction = null, inputMeta = null) {
      if (this.homeHoldFocusLocked) {
        return false;
      }
      if (!current || !target || current === target) {
        return false;
      }
      this.refreshPendingHomeTrailerCleanup();
      this.homeRowWindow?.ensureReady(target);
      const focusStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
      const scrollAdjustments = this.getExpandedPosterScrollAdjustments(current, target, direction);
      const shouldInstantCollapseExpandedPoster =
        this.layoutMode === "modern" && (direction === "left" || direction === "right" || this.shouldUseImmediateFocusScroll());
      if (this.layoutMode === "modern" && this.expandedPosterNode && this.expandedPosterNode !== target) {
        this.collapseFocusedPoster(this.expandedPosterNode, {
          instant: shouldInstantCollapseExpandedPoster
        });
      }
      current.classList.remove("focused");
      target.classList.add("focused");
      this.focusWithoutAutoScroll(target, { suppressDelegatedFocus: true });
      this.setCurrentFocusedNode(target);
      const deferHomeArtworkUntilSettle =
        direction === "up" ||
        direction === "down" ||
        (this.layoutMode === "modern" &&
          !this.isPerformanceConstrained() &&
          !this.isLegacyTvRuntime() &&
          (direction === "left" || direction === "right"));
      this.scheduleHomeLazyImageHydration(target, {
        deferUntilVerticalSettle: deferHomeArtworkUntilSettle,
        focusedRowOnly: this.isLegacyTvRuntime()
      });
      if (this.collectionFocusGifTimer) {
        clearTimeout(this.collectionFocusGifTimer);
        this.collectionFocusGifTimer = null;
      }
      if (this.collectionFocusGifRaf && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.collectionFocusGifRaf);
        this.collectionFocusGifRaf = 0;
      }
      const isCollectionTarget = this.isCollectionFolderNode(target);
      if (isCollectionTarget) {
        const hydrateFocusedCollection = () => {
          this.collectionFocusGifTimer = null;
          this.collectionFocusGifRaf = 0;
          if (
            this.homeDomPreserved ||
            !target.isConnected ||
            !target.classList?.contains?.("focused") ||
            (typeof this.getCurrentFocusedNode === "function" && this.getCurrentFocusedNode() !== target)
          ) {
            return;
          }
          this.hydrateCollectionFocusGif(target, true);
        };
        const shouldDeferCollectionGif =
          deferHomeArtworkUntilSettle && (this.isPerformanceConstrained?.() || this.shouldUseBoundedHomeImageHydration?.());
        if (shouldDeferCollectionGif) {
          this.collectionFocusGifTimer = setTimeout(hydrateFocusedCollection, MODERN_TV_COLLECTION_GIF_SETTLE_DELAY_MS);
        } else if (typeof requestAnimationFrame === "function") {
          this.collectionFocusGifRaf = requestAnimationFrame(hydrateFocusedCollection);
        } else {
          hydrateFocusedCollection();
        }
      }
      this.setSidebarExpanded(this.isSidebarNode(target));
      if (this.isMainNode(target)) {
        this.lastMainFocus = target;
        this.rememberMainRowFocus(target);
        const shouldDeferFocusEffects = this.shouldDeferContinueWatchingFocusEffects(target, direction, inputMeta);
        const usingDelayedCameraFollow = this.scheduleModernCameraFollow(target, direction, current, scrollAdjustments, inputMeta);
        const currentMainAnchor =
          this.layoutMode === "modern" && (direction === "left" || direction === "right") && typeof this.getMainFocusAnchor === "function"
            ? this.getMainFocusAnchor(current)
            : null;
        const targetMainAnchor = currentMainAnchor ? this.getMainFocusAnchor(target) : null;
        const sameModernRowAnchor = Boolean(currentMainAnchor && targetMainAnchor && currentMainAnchor === targetMainAnchor);
        const isVerticalMove = direction === "up" || direction === "down";
        const targetNavCol = Number(target?.dataset?.navCol || 0);
        const targetNavRowNodes = this.navModel?.rows?.[Number(target?.dataset?.navRow || 0)] || null;
        const isVerticalAtTrackOrigin =
          this.layoutMode === "modern" &&
          isVerticalMove &&
          !scrollAdjustments.horizontal &&
          targetNavCol === 0 &&
          Number(target?.closest?.(".home-track")?.scrollLeft || 0) <= 1;
        // A row with a single mounted card cannot be paginated by moving right,
        // so only skip the redundant origin fetch when another card exists.
        const canSkipOriginPagination =
          this.layoutMode === "modern" && isVerticalMove && targetNavCol === 0 && Number(targetNavRowNodes?.length || 0) > 1;
        if (!usingDelayedCameraFollow) {
          if (!isVerticalAtTrackOrigin) {
            this.ensureTrackHorizontalVisibility(target, direction, scrollAdjustments.horizontal);
          }
          if (!shouldDeferFocusEffects && !sameModernRowAnchor) {
            this.ensureMainVerticalVisibility(target, direction, current, scrollAdjustments.vertical);
          }
        }
        if (!canSkipOriginPagination) {
          this.scheduleModernTrackPaginationForFocus(target);
        }
        this.ensureContinueWatchingRenderAhead(target);
        if (shouldDeferFocusEffects) {
          this.cancelPendingHeroFocus();
          this.cancelFocusedPosterFlow();
          this.scheduleDeferredContinueWatchingFocusEffects(target);
        } else {
          this.scheduleModernHeroUpdate(target, {
            deferUntilVerticalSettle: deferHomeArtworkUntilSettle
          });
          if (isCollectionTarget) {
            this.cancelFocusedPosterFlow?.();
            this.clearFocusedPosterFlowState?.();
          } else {
            this.scheduleFocusedPosterFlow(target, {
              deferUntilVerticalSettle: deferHomeArtworkUntilSettle
            });
          }
        }
      } else {
        this.cancelModernCameraFollow({ stopAnimations: true });
        this.cancelPendingHeroFocus();
        this.cancelFocusedPosterFlow();
        this.clearFocusedPosterFlowState();
        this.collapseFocusedPoster();
      }
      logHomePerf("focusNode", {
        ms: Number((homePerfNow() - focusStart).toFixed(2)),
        direction: direction || "",
        layoutMode: this.layoutMode,
        main: Boolean(this.isMainNode(target)),
        sidebar: Boolean(this.isSidebarNode(target))
      });
      return true;
    },
    buildNavigationModel() {
      const sidebar = this.layoutPrefs?.modernSidebar
        ? Array.from(this.container?.querySelectorAll(".modern-sidebar-panel .focusable") || [])
        : Array.from(this.container?.querySelectorAll(".home-sidebar .focusable") || []);
      const rows = [];
      const tracks = [];
      const rowSectionByKey = new Map();
      const rowNodesByRowKey = new Map();
      const domVersion = Number(this.navigationDomVersion || 0);

      if (this.layoutMode === "modern") {
        const continueTracks = Array.from(this.container?.querySelectorAll(".home-row-continue .home-track") || []);
        continueTracks.forEach((continueTrack) => {
          const continueNodes = Array.from(continueTrack.querySelectorAll(".home-content-card.focusable"));
          if (continueNodes.length) {
            const section = continueTrack.closest(".home-row-continue") || null;
            const rowKey = String(section?.dataset?.rowKey || "");
            rows.push(continueNodes);
            tracks.push(continueTrack);
            if (rowKey) {
              rowSectionByKey.set(rowKey, section);
              rowNodesByRowKey.set(rowKey, continueNodes);
            }
          }
        });
        const rowSections = Array.from(this.container?.querySelectorAll(".home-modern-row") || []);
        rowSections.forEach((section) => {
          const track = section.querySelector(".home-track");
          if (!track) {
            return;
          }
          const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
          if (!cards.length) {
            return;
          }
          const rowKey = String(section.dataset.rowKey || "");
          rows.push(cards);
          tracks.push(track);
          if (rowKey) {
            rowSectionByKey.set(rowKey, section);
            rowNodesByRowKey.set(rowKey, cards);
          }
        });
      } else {
        const hero = this.container?.querySelector(".home-hero-card.focusable");
        if (hero) {
          rows.push([hero]);
        }

        const trackSections = Array.from(this.container?.querySelectorAll(".home-main .home-row") || []);
        trackSections.forEach((section) => {
          const track = section.querySelector(".home-track");
          if (!track) {
            return;
          }
          const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
          if (cards.length) {
            rows.push(cards);
            tracks.push(track);
            const rowKey = String(section.dataset.rowKey || "");
            if (rowKey) {
              rowSectionByKey.set(rowKey, section);
              rowNodesByRowKey.set(rowKey, cards);
            }
          }
        });
      }

      if (this.layoutMode === "grid") {
        const gridTracks = Array.from(this.container?.querySelectorAll(".home-grid-track") || []);
        gridTracks.forEach((track) => {
          const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
          // A parked section has no geometry to read; its rows follow from the
          // column count measured on the sections in layout.
          const gridRows = this.homeGridColumnCount ? chunkHomeGridCards(cards, this.homeGridColumnCount) : groupNodesByOffsetTop(cards);
          gridRows.forEach((rowNodes) => {
            if (rowNodes.length) {
              rows.push(rowNodes);
            }
          });
        });
      }

      sidebar.forEach((node, index) => {
        const nextIndex = String(index);
        if (node.dataset.navZone !== "sidebar") {
          node.dataset.navZone = "sidebar";
        }
        if (node.dataset.navIndex !== nextIndex) {
          node.dataset.navIndex = nextIndex;
        }
      });

      rows.forEach((rowNodes, rowIndex) => {
        const rowKey = this.getNodeRowKey(rowNodes[0]);
        const nextRowIndex = String(rowIndex);
        rowNodes.forEach((node, colIndex) => {
          const nextColIndex = String(colIndex);
          if (node.dataset.navZone !== "main") {
            node.dataset.navZone = "main";
          }
          if (node.dataset.navRow !== nextRowIndex) {
            node.dataset.navRow = nextRowIndex;
          }
          if (node.dataset.navCol !== nextColIndex) {
            node.dataset.navCol = nextColIndex;
          }
          if (rowKey && node.dataset.navRowKey !== rowKey) {
            node.dataset.navRowKey = rowKey;
          }
        });
      });

      this.navModel = {
        domVersion,
        sidebar,
        rows,
        tracks,
        rowSectionByKey,
        rowNodesByRowKey
      };
      if (!this.lastMainFocus || !this.container?.contains(this.lastMainFocus) || !this.isMainNode(this.lastMainFocus)) {
        this.lastMainFocus = rows[0]?.[0] || null;
      }
      this.syncHomeRowWindow();
    },
    prepareHomeRowsForRestore(state = null) {
      // Coming back to a kept Home DOM: the window was dropped in cleanup.
      this.syncHomeRowWindow();
      const rowKeys = Object.entries(state?.trackStates || {})
        .filter(([, scrollLeft]) => Number(scrollLeft) > 0)
        .map(([rowKey]) => rowKey);
      this.homeRowWindow?.ensureRowKeysReady([...rowKeys, state?.rowKey]);
    },
    syncHomeRowWindow() {
      const modern = this.layoutMode === "modern";
      const legacy =
        this.layoutMode === "classic" || (this.layoutMode === "grid" && supportsHomeGridRowWindow() && this.homeGridColumnCount);
      const root = modern
        ? this.container?.querySelector(".home-modern-rows-viewport")
        : legacy
          ? this.container?.querySelector(".home-main")
          : null;
      if (!root || !isHomeRowWindowSupported()) {
        if (!modern && !legacy && this.homeRowWindow) {
          // Grid fell back to geometric grouping: no row may stay parked.
          this.homeRowWindow.unparkAll();
          this.homeRowWindow.destroy();
          this.homeRowWindow = null;
          this.homeRowWindowRoot = null;
        }
        return;
      }
      const selector = modern ? HOME_ROW_WINDOW_SELECTOR : HOME_LEGACY_ROW_WINDOW_SELECTOR;
      if (this.homeRowWindowRoot !== root) {
        this.homeRowWindow?.destroy();
        this.homeRowWindow = createHomeRowWindow({ root, selector });
        this.homeRowWindowRoot = root;
      }
      this.homeRowWindow.observe(Array.from(root.querySelectorAll(selector)));
    }
  };
}
