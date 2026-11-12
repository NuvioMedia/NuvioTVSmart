import * as internals from "./homeScreenContext.js";
import { createHomeRowWindow, isHomeRowWindowSupported, HOME_ROW_WINDOW_SELECTOR } from "./homeRowWindow.js";

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
      if (this.isCollectionFolderNode(current)) {
        this.hydrateCollectionFocusGif(current, false);
      }
      if (this.isCollectionFolderNode(target)) {
        this.hydrateCollectionFocusGif(target, true);
      }
      this.setSidebarExpanded(this.isSidebarNode(target));
      if (this.isMainNode(target)) {
        this.lastMainFocus = target;
        this.rememberMainRowFocus(target);
        const shouldDeferFocusEffects = this.shouldDeferContinueWatchingFocusEffects(target, direction, inputMeta);
        const usingDelayedCameraFollow = this.scheduleModernCameraFollow(target, direction, current, scrollAdjustments, inputMeta);
        if (!usingDelayedCameraFollow) {
          this.ensureTrackHorizontalVisibility(target, direction, scrollAdjustments.horizontal);
          if (!shouldDeferFocusEffects) {
            this.ensureMainVerticalVisibility(target, direction, current, scrollAdjustments.vertical);
          }
        }
        this.scheduleModernTrackPaginationForFocus(target);
        this.ensureContinueWatchingRenderAhead(target);
        if (shouldDeferFocusEffects) {
          this.cancelPendingHeroFocus();
          this.cancelFocusedPosterFlow();
          this.scheduleDeferredContinueWatchingFocusEffects(target);
        } else {
          this.scheduleModernHeroUpdate(target, {
            deferUntilVerticalSettle: direction === "up" || direction === "down"
          });
          this.scheduleFocusedPosterFlow(target, {
            deferUntilVerticalSettle: direction === "up" || direction === "down"
          });
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
          groupNodesByOffsetTop(cards).forEach((rowNodes) => {
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
      const root = this.layoutMode === "modern" ? this.container?.querySelector(".home-modern-rows-viewport") : null;
      if (!root || !isHomeRowWindowSupported()) {
        return;
      }
      if (this.homeRowWindowRoot !== root) {
        this.homeRowWindow?.destroy();
        this.homeRowWindow = createHomeRowWindow({ root });
        this.homeRowWindowRoot = root;
      }
      this.homeRowWindow.observe(Array.from(root.querySelectorAll(HOME_ROW_WINDOW_SELECTOR)));
    }
  };
}
