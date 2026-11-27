/* eslint-disable no-unused-vars */
import * as internals from "./folderDetailScreen.js";

export function createFolderDetailScreenMethods05() {
  const { Router, ScreenUtils, HomeScreen, isBackEvent } = internals;

  return {
    async onKeyDown(event) {
      if (isBackEvent(event)) {
        event?.preventDefault?.();
        if (this.consumeBackRequest()) {
          return;
        }
        Router.back();
        return;
      }
      if (this.useHomeFollowLayout) {
        HomeScreen.onKeyDown.call(this, event);
        return;
      }
      const current = this.container?.querySelector(".focusable.focused") || null;
      if (!current) {
        return;
      }
      const code = Number(event?.keyCode || 0);
      if (code === 13) {
        event?.preventDefault?.();
        const action = String(current.dataset.action || "");
        if (action === "selectTab") {
          this.selectedTabIndex = Math.max(0, Number(current.dataset.tabIndex || 0));
          this.lastFocusedKey = `tab:${this.selectedTabIndex}`;
          this.savedScrollTop = 0;
          this.render();
          return;
        }
        if (action === "openDetail") {
          this.lastFocusedKey = String(current.dataset.focusKey || this.lastFocusedKey || "");
          Router.navigate("detail", {
            itemId: current.dataset.itemId || "",
            itemType: current.dataset.itemType || current.dataset.catalogType || "movie",
            fallbackTitle: current.dataset.itemTitle || "Untitled",
            fallbackPoster: current.dataset.posterSrc || "",
            fallbackBackground: current.dataset.backdropSrc || "",
            addonBaseUrl: current.dataset.addonBaseUrl || "",
            addonId: current.dataset.addonId || "",
            addonName: current.dataset.addonName || "",
            catalogType: current.dataset.catalogType || current.dataset.itemType || "movie"
          });
        }
        return;
      }
      const direction = code === 37 ? -1 : code === 39 ? 1 : 0;
      if (direction !== 0 && current.matches(".folder-detail-tab.focusable")) {
        event?.preventDefault?.();
        const tabs = Array.from(this.container?.querySelectorAll(".folder-detail-tab.focusable") || []);
        const currentIndex = tabs.indexOf(current);
        this.focusNode(tabs[Math.max(0, Math.min(tabs.length - 1, currentIndex + direction))] || current);
        return;
      }
      if (code === 38 || code === 40 || code === 37 || code === 39) {
        event?.preventDefault?.();
        const row = Number(current.dataset.navRow || 0);
        const col = Number(current.dataset.navCol || 0);
        if (code === 37 || code === 39) {
          const rowNodes = this.navModel.rows[row] || [];
          this.focusNode(rowNodes[Math.max(0, Math.min(rowNodes.length - 1, col + (code === 39 ? 1 : -1)))] || current);
          return;
        }
        const nextRowNodes = this.navModel.rows[row + (code === 40 ? 1 : -1)] || null;
        if (nextRowNodes?.length) {
          this.focusNode(nextRowNodes[Math.max(0, Math.min(nextRowNodes.length - 1, col))] || nextRowNodes[0]);
        } else if (code !== 40 || this.viewMode !== "TABBED_GRID") {
          return;
        }
        // Prefetch only within two rows of the loaded grid's end. A Down press
        // near the top must not fetch every source and rebuild the entire grid.
        // Keep the last row eligible so a failed page can be retried with Down.
        if (
          this.viewMode === "TABBED_GRID" &&
          code === 40 &&
          row + 1 >= this.navModel.rows.length - 2 &&
          this.getSelectedTab()?.hasMore &&
          current.closest(".seeall-grid")
        ) {
          const selectedTabIndex = this.selectedTabIndex;
          if (this.tabs[selectedTabIndex]?.isAllTab) {
            await Promise.all(
              this.tabs.slice(1).map((tab, index) => {
                if (tab.hasMore && !tab.loading) {
                  return this.loadTab(index + 1, { append: true });
                }
                return Promise.resolve();
              })
            );
          } else if (this.tabs[selectedTabIndex]?.hasMore && !this.tabs[selectedTabIndex]?.loading) {
            await this.loadTab(selectedTabIndex, { append: true });
          }
        } else if (this.viewMode !== "TABBED_GRID" && code === 40) {
          const currentTrack = current.closest(".folder-row-track");
          const currentRowIndex = Array.from(this.container?.querySelectorAll(".folder-row-track") || []).indexOf(currentTrack);
          const rowsForView = this.tabs.filter((tab) => !tab.isAllTab);
          const currentRow = rowsForView[currentRowIndex] || null;
          if (currentRow?.hasMore && !currentRow.loading) {
            await this.loadTab(currentRowIndex, { append: true });
          }
        }
      }
    },
    onKeyUp(event) {
      if (this.useHomeFollowLayout) {
        HomeScreen.onKeyUp.call(this, event);
      }
    },
    prepareHomeReturnAnimation() {
      HomeScreen.pendingCollectionRouteReturnAnimation = true;
    },
    consumeBackRequest() {
      if (this.useHomeFollowLayout) {
        if (this._homeHoldDialog) {
          this._homeHoldDialog.destroy();
          if (this.continueWatchingMenu) {
            HomeScreen.dismissContinueWatchingMenu.call(this);
          } else if (this.posterHoldMenu || this.posterListPicker) {
            if (this.posterListPicker) {
              this.posterListPicker = null;
            }
            HomeScreen.dismissPosterHoldMenu.call(this);
          } else {
            this._homeHoldDialog = null;
            HomeScreen.unlockHomeHoldFocus.call(this);
          }
          this.suppressHoldMenuEnterUntilKeyUp = false;
          return true;
        }
        if (this.continueWatchingMenu) {
          HomeScreen.closeContinueWatchingMenu.call(this);
          this.suppressHoldMenuEnterUntilKeyUp = false;
          return true;
        }
        if (this.posterHoldMenu) {
          HomeScreen.closePosterHoldMenu.call(this);
          this.suppressHoldMenuEnterUntilKeyUp = false;
          return true;
        }
        if (this.posterListPicker) {
          this.posterListPicker = null;
          HomeScreen.unlockHomeHoldFocus.call(this);
          this.suppressHoldMenuEnterUntilKeyUp = false;
          return true;
        }
      }
      this.prepareHomeReturnAnimation();
      return false;
    },
    cleanup() {
      this.folderLoadToken = (this.folderLoadToken || 0) + 1;
      this._trackPaginationInFlight?.clear?.();
      this.cancelScheduledRender();
      if (this.useHomeFollowLayout) {
        this.homeRowWindow?.destroy?.();
        this.homeRowWindow = null;
        this.homeRowWindowRoot = null;
        HomeScreen.cancelPendingContinueWatchingEnter?.call(this);
        HomeScreen.cancelPendingContinueWatchingHold?.call(this);
        this.suppressHoldMenuEnterUntilKeyUp = false;
        this.pointerHoldStartedAt = 0;
        this.pointerHoldDownStamp = 0;
        this.pointerHoldSwallowClick = false;
        HomeScreen.destroyHomeHoldDialog?.call(this);
        HomeScreen.unlockHomeHoldFocus?.call(this);
        this.continueWatchingMenu = null;
        this.posterHoldMenu = null;
        this.posterListPicker = null;
        this.sidebarExpanded = false;
        HomeScreen.cancelModernCameraFollow?.call(this, { stopAnimations: true });
        HomeScreen.cancelAllScrollAnimations?.call(this);
        if (this._mainVertRaf) {
          globalThis.cancelAnimationFrame?.(this._mainVertRaf);
          this._mainVertRaf = null;
        }
        if (this._mainClassicVertRaf) {
          globalThis.cancelAnimationFrame?.(this._mainClassicVertRaf);
          this._mainClassicVertRaf = null;
        }
        if (this._trackHorizRaf) {
          globalThis.cancelAnimationFrame?.(this._trackHorizRaf);
          this._trackHorizRaf = null;
        }
        HomeScreen.endModernVerticalFastScroll?.call(this, { land: false });
        HomeScreen.stopHeroRotation?.call(this);
        HomeScreen.cancelPendingHeroFocus?.call(this);
        HomeScreen.cancelFocusedPosterFlow?.call(this);
        HomeScreen.clearFocusedPosterFlowState?.call(this);
        HomeScreen.collapseFocusedPoster?.call(this);
        HomeScreen.clearHomeTrailerLayers?.call(this);
        HomeScreen.teardownModernTrackScrollPagination?.call(this);
        if (this.homeViewportFocusSyncTimer) {
          clearTimeout(this.homeViewportFocusSyncTimer);
          this.homeViewportFocusSyncTimer = null;
        }
        if (this.homeViewportScrollFrame) {
          globalThis.cancelAnimationFrame?.(this.homeViewportScrollFrame);
          this.homeViewportScrollFrame = 0;
        }
        if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
          this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler, true);
        }
        this.boundHomeViewport = null;
        if (this.boundHomeEventContainer) {
          if (this.boundHomeFocusInHandler) {
            this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
          }
          if (this.boundHomeClickHandler) {
            this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
          }
          if (this.boundHomeMouseDownHandler) {
            this.boundHomeEventContainer.removeEventListener("mousedown", this.boundHomeMouseDownHandler);
          }
          if (this.boundHomeMouseUpHandler) {
            this.boundHomeEventContainer.removeEventListener("mouseup", this.boundHomeMouseUpHandler);
          }
          if (this.boundHomeMouseOutHandler) {
            this.boundHomeEventContainer.removeEventListener("mouseout", this.boundHomeMouseOutHandler);
          }
          if (this.boundHomeMouseOverHandler) {
            this.boundHomeEventContainer.removeEventListener("mouseover", this.boundHomeMouseOverHandler);
          }
          if (this.boundHomeWheelHandler) {
            this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
          }
          this.boundHomeEventContainer = null;
        }
      }
      ScreenUtils.hide(this.container);
    }
  };
}
