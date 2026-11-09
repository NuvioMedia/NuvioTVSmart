import * as internals from "./homeScreenContext.js";
import { registerHomeDomNodes } from "./homeDomUpdate.js";

export function createHomeScreenMethods28() {
  const {
    Router,
    LayoutPreferences,
    Platform,
    activateLegacySidebarAction,
    setModernSidebarPillIconOnly,
    CW_RENDER_LOAD_AHEAD_ITEMS,
    HOME_LAYOUT_SEQUENCE,
    shouldAppendContinueWatchingItems,
    isDirectionalKeyCode,
    getDirectionFromKeyCode,
    resolveContinueWatchingBlurNextUp,
    renderContinueWatchingCard
  } = internals;

  return {
    onKeyDown(event) {
      const currentFocusedNode = this.getCurrentFocusedNode() || this.container?.querySelector(".focusable") || null;
      const code = Number(event?.keyCode || 0);
      if (code === 13 || isDirectionalKeyCode(code)) {
        this.markUserInteractionSinceHomePaint();
      }
      if (this._homeHoldDialog) {
        return true;
      }
      if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
        event.preventDefault?.();
        return;
      }
      const isEnterHoldTarget = code === 13 && this.isHomeHoldTarget(currentFocusedNode);
      if (!isEnterHoldTarget) {
        this.cancelPendingContinueWatchingEnter();
        this.cancelPendingContinueWatchingHold();
      }
      if (this.continueWatchingMenu || this.posterHoldMenu) {
        return;
      }
      if (Platform.isBackEvent(event)) {
        event.preventDefault?.();
        this.consumeBackRequest();
        return;
      }
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        if (code === 40) {
          this.pillIconOnly = true;
          this.cancelModernSidebarPillAutoCollapse();
          setModernSidebarPillIconOnly(this.container, true);
        } else if (code === 38) {
          const wasIconOnly = Boolean(this.pillIconOnly);
          this.pillIconOnly = false;
          setModernSidebarPillIconOnly(this.container, false);
          this.scheduleModernSidebarPillAutoCollapse({ restart: wasIconOnly });
        }
      }
      const directionalNavigation = this.layoutMode === "modern" && isDirectionalKeyCode(code);
      let navigationBefore = null;
      if (directionalNavigation) {
        this.cancelFocusedPosterFlow();
        navigationBefore = {
          node: this.getCurrentFocusedNode(),
          heroIndex: this.heroIndex,
          sidebarExpanded: Boolean(this.sidebarExpanded),
          verticalFastScroll: Boolean(this.modernVerticalFastScrollState)
        };
      }
      const handledNavigation = this.handleHomeDpad(event);
      // A key at the edge of a row or list moves nothing. Pausing the trailer
      // there would hide it with no focus change to restore it.
      if (
        directionalNavigation &&
        handledNavigation &&
        navigationBefore &&
        (this.getCurrentFocusedNode() !== navigationBefore.node ||
          this.heroIndex !== navigationBefore.heroIndex ||
          Boolean(this.sidebarExpanded) !== navigationBefore.sidebarExpanded ||
          Boolean(this.modernVerticalFastScrollState) !== navigationBefore.verticalFastScroll)
      ) {
        this.pauseActiveTrailerLayersForNavigation();
      }
      if (handledNavigation) {
        return;
      }
      const isHomeHoldTarget = this.isHomeHoldTarget(currentFocusedNode);
      if (code === 13 && isHomeHoldTarget) {
        event.preventDefault?.();
        if (!event?.repeat && !this.hasPendingContinueWatchingHold(currentFocusedNode)) {
          this.startPendingContinueWatchingHold(currentFocusedNode);
        }
        return;
      }
      if (code === 76) {
        this.persistCurrentFocusState();
        const currentIndex = HOME_LAYOUT_SEQUENCE.indexOf(this.layoutMode);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % HOME_LAYOUT_SEQUENCE.length : 0;
        this.layoutMode = HOME_LAYOUT_SEQUENCE[nextIndex];
        LayoutPreferences.set({ homeLayout: this.layoutMode });
        this.heroItem = this.pickInitialHero();
        this.render();
        return;
      }
      if (code !== 13) {
        return;
      }

      const current = this.getCurrentFocusedNode();
      if (!current) {
        return;
      }
      const action = current.dataset.action;
      if (String(current.dataset.navZone || "") === "sidebar") {
        activateLegacySidebarAction(action, "home");
        return;
      }
      if (action === "openDetail" || action === "openCollectionFolder") this.openDetailFromNode(current);
      if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(current);
      if (action === "resumeProgress") {
        this.scheduleContinueWatchingEnter(current);
      }
    },
    onKeyUp(event) {
      if (this._homeHoldDialog) {
        return true;
      }
      const keyCode = Number(event?.keyCode || 0);
      const direction = getDirectionFromKeyCode(keyCode);
      if (direction && this.lastDirectionalKeyAtByDirection) {
        delete this.lastDirectionalKeyAtByDirection[direction];
      }
      if ((direction === "up" || direction === "down") && this.modernVerticalFastScrollState) {
        const releasedDirection = direction === "down" ? 1 : -1;
        if (this.modernVerticalFastScrollState.direction === releasedDirection) {
          this.endModernVerticalFastScroll({ land: true });
        }
      }
      if ((keyCode === 37 || keyCode === 39) && this.layoutMode === "modern") {
        const current = this.getCurrentFocusedNode();
        if (this.shouldUseImmediateHorizontalScrollForNode(current)) {
          this.scheduleModernHeroUpdate(current);
          this.scheduleFocusedPosterFlow(current);
        }
      }
      if (this.suppressHoldMenuEnterUntilKeyUp) {
        this.suppressHoldMenuEnterUntilKeyUp = false;
        if (keyCode === 13) {
          event?.preventDefault?.();
          return;
        }
      }
      if (keyCode !== 13) {
        return;
      }
      const current = this.getCurrentFocusedNode();
      if (this.completePendingContinueWatchingHold(current, event)) {
        event.preventDefault?.();
      }
    },
    consumeBackRequest() {
      if (this._homeHoldDialog) {
        this._homeHoldDialog.destroy();
        if (this.continueWatchingMenu) {
          this.dismissContinueWatchingMenu();
        } else if (this.posterHoldMenu || this.posterListPicker) {
          if (this.posterListPicker) {
            this.posterListPicker = null;
          }
          this.dismissPosterHoldMenu();
        } else {
          this._homeHoldDialog = null;
          this.unlockHomeHoldFocus();
        }
        return true;
      }
      if (this.continueWatchingMenu) {
        this.closeContinueWatchingMenu();
        return true;
      }
      if (this.posterHoldMenu) {
        this.closePosterHoldMenu();
        return true;
      }
      // NuvioDialog clears the Home hold state before its exit animation removes
      // the modal marker. Consume a paired Tizen Back event instead of opening
      // Home's sidebar as a second action.
      if (globalThis?.document?.body?.classList?.contains("nuvio-modal-open")) {
        return true;
      }
      if (this.layoutMode === "modern") {
        this.cancelFocusedPosterFlow();
        this.collapseFocusedPoster();
      }
      const sidebarFocused = Boolean(
        this.container?.querySelector(".modern-sidebar-panel .focusable.focused") ||
        this.container?.querySelector(".home-sidebar .focusable.focused")
      );
      if (sidebarFocused || this.sidebarExpanded) {
        if (this.sidebarOpenedByBack) {
          this.sidebarOpenedByBack = false;
          Platform.exitApp();
          return true;
        }
        this.closeSidebarToContent();
        return true;
      }
      this.openSidebar({ openedByBack: true });
      return true;
    },
    appendContinueWatchingBatch() {
      if (String(this.layoutPrefs?.continueWatchingSortMode || "") === "split_upcoming") {
        return false;
      }
      const track = this.container?.querySelector(".home-track-continue");
      const items = Array.isArray(this.continueWatchingDisplay) ? this.continueWatchingDisplay : [];
      if (!track?.isConnected || !items.length) {
        return false;
      }

      const mountedCards = Array.from(track.querySelectorAll(".home-continue-card:not(.home-continue-card-loading)"));
      const startIndex = mountedCards.length;
      if (startIndex >= items.length) {
        return false;
      }

      const batchSize = this.getContinueWatchingRenderBatchSize();
      const nextItems = items.slice(startIndex, startIndex + batchSize);
      const rowKey = "continue_watching";
      const cardOptions = {
        useEpisodeThumbnails: this.layoutPrefs?.useEpisodeThumbnailsInCw !== false,
        blurNextUp: resolveContinueWatchingBlurNextUp(this.layoutPrefs),
        cardStyle: this.layoutPrefs?.continueWatchingCardStyle || "card",
        rowKey,
        // One preference read per appended batch, not one per card.
        posterSettings: LayoutPreferences.get()
      };
      const markup = nextItems.map((item, index) => renderContinueWatchingCard(item, startIndex + index, cardOptions)).join("");
      if (!markup) {
        return false;
      }

      const fragment = document.createRange().createContextualFragment(markup);
      const appendedCards = Array.from(fragment.querySelectorAll(".home-content-card.focusable"));
      registerHomeDomNodes(appendedCards);
      const navigationRowIndex = (this.navModel?.rows || []).findIndex((rowNodes) => rowNodes[0]?.closest?.(".home-track") === track);
      appendedCards.forEach((card, index) => {
        card.dataset.navZone = "main";
        card.dataset.navRow = String(Math.max(0, navigationRowIndex));
        card.dataset.navCol = String(startIndex + index);
        card.dataset.navRowKey = rowKey;
      });
      track.appendChild(fragment);

      if (navigationRowIndex >= 0 && this.navModel?.rows?.[navigationRowIndex]) {
        this.navModel.rows[navigationRowIndex].push(...appendedCards);
        this.navModel.rowNodesByRowKey?.set?.(rowKey, this.navModel.rows[navigationRowIndex]);
      } else {
        this.invalidateNavigationModel();
        this.buildNavigationModel();
      }
      this.scheduleHomeLazyImageHydration(null, { refreshIndex: true });
      return true;
    },
    ensureContinueWatchingRenderAhead(target, { force = false } = {}) {
      if (String(this.layoutPrefs?.continueWatchingSortMode || "") === "split_upcoming") {
        return false;
      }
      if (!target?.matches?.(".home-continue-card.focusable")) {
        return false;
      }
      const track = target.closest(".home-track-continue");
      if (!track) {
        return false;
      }
      const mountedCount = track.querySelectorAll(".home-continue-card:not(.home-continue-card-loading)").length;
      const focusedIndex = Math.max(0, Number(target.dataset.cwIndex || 0));
      if (
        !shouldAppendContinueWatchingItems({
          focusedIndex,
          mountedCount,
          totalCount: Number(this.continueWatchingDisplay?.length || 0),
          loadAheadItems: CW_RENDER_LOAD_AHEAD_ITEMS,
          force
        })
      ) {
        return false;
      }
      return this.appendContinueWatchingBatch();
    },
    setupContinueWatchingProgressiveRendering() {
      this.teardownContinueWatchingProgressiveRendering();
      if (String(this.layoutPrefs?.continueWatchingSortMode || "") === "split_upcoming") {
        return;
      }
      const track = this.container?.querySelector(".home-track-continue");
      if (!track) {
        return;
      }

      let timer = 0;
      const handler = () => {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(
          () => {
            timer = 0;
            if (!track.isConnected || Router.getCurrent() !== "home") {
              return;
            }
            const firstCard = track.querySelector(".home-continue-card:not(.home-continue-card-loading)");
            const stride = Math.max(1, Number(firstCard?.offsetWidth || 0) + 24);
            const distanceFromEnd = Number(track.scrollWidth || 0) - (Number(track.scrollLeft || 0) + Number(track.clientWidth || 0));
            if (distanceFromEnd <= stride * CW_RENDER_LOAD_AHEAD_ITEMS) {
              this.appendContinueWatchingBatch();
            }
          },
          this.isPerformanceConstrained() ? 160 : 80
        );
      };
      this.continueWatchingProgressiveTrack = track;
      this.continueWatchingProgressiveHandler = handler;
      this.continueWatchingProgressiveCancel = () => {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
      };
      track.addEventListener("scroll", handler, { passive: true });
    },
    teardownContinueWatchingProgressiveRendering() {
      if (this.continueWatchingProgressiveTrack && this.continueWatchingProgressiveHandler) {
        this.continueWatchingProgressiveTrack.removeEventListener("scroll", this.continueWatchingProgressiveHandler);
      }
      this.continueWatchingProgressiveCancel?.();
      this.continueWatchingProgressiveTrack = null;
      this.continueWatchingProgressiveHandler = null;
      this.continueWatchingProgressiveCancel = null;
    },
    scheduleModernTrackPaginationForFocus(target) {
      if (this.layoutMode !== "modern" || !target?.matches?.(".home-poster-card.focusable")) {
        return;
      }
      const itemIndex = Number(target.dataset.navCol || -1);
      if (itemIndex < 0) {
        return;
      }
      const track = target.closest(".home-track");
      this._trackScrollHandlers?.get?.(track)?.requestAhead?.({
        focusedIndex: itemIndex,
        focusedNode: target
      });
    }
  };
}
