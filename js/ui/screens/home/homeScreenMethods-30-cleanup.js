import * as internals from "./homeScreenContext.js";
import { resetHomeArtworkRescaler } from "../../images/tvPosterRescaler.js";

export function createHomeScreenMethods30() {
  const { ScreenUtils, Platform } = internals;

  return {
    cleanup() {
      this.homeRowWindow?.destroy();
      this.homeRowWindow = null;
      this.homeRowWindowRoot = null;
      if (this.homeLazyImageEvictTimer) {
        clearTimeout(this.homeLazyImageEvictTimer);
        this.homeLazyImageEvictTimer = null;
      }
      if (this.homeLazyImageEvictMaxTimer) {
        clearTimeout(this.homeLazyImageEvictMaxTimer);
        this.homeLazyImageEvictMaxTimer = null;
      }
      this.heroMdbListRequest = null;
      if (this.unsubscribeStartupSyncPullCompleted) {
        this.unsubscribeStartupSyncPullCompleted();
        this.unsubscribeStartupSyncPullCompleted = null;
      }
      if (this.unsubscribeAddonManifestChanges) {
        this.unsubscribeAddonManifestChanges();
        this.unsubscribeAddonManifestChanges = null;
      }
      if (this.unsubscribeInstalledAddonChanges) {
        this.unsubscribeInstalledAddonChanges();
        this.unsubscribeInstalledAddonChanges = null;
      }
      this.homeBackgroundRefreshPending = false;
      this.homeBackgroundRefreshPreserveReturnState = false;
      this.homeBackgroundRefreshReason = "";
      this.homeBackgroundRefreshPromise = null;
      this.cancelModernSidebarPillAutoCollapse();
      this.cancelPendingContinueWatchingEnter();
      this.cancelPendingContinueWatchingHold();
      this.suppressHoldMenuEnterUntilKeyUp = false;
      this.destroyHomeHoldDialog();
      this.unlockHomeHoldFocus();
      this.continueWatchingMenu = null;
      this.posterHoldMenu = null;
      this.posterListPicker = null;
      this.persistCurrentFocusState();
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.cancelInitialHomeLoadTimeout();
      this._trackPaginationInFlight?.clear();
      this.cancelScheduledRender();
      this.cancelModernCameraFollow({ stopAnimations: true });
      this.endModernVerticalFastScroll({ land: false });
      this.stopHeroRotation();
      this.heroDescriptionAutoScroller?.stop();
      this.heroDescriptionScrollHolding = false;
      this.cancelPendingHeroFocus();
      this.cancelFocusedPosterFlow();
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
      this.clearHomeTrailerLayers();
      this.teardownGridStickyHeader();
      this.teardownModernTrackScrollPagination();
      this.teardownContinueWatchingProgressiveRendering();
      this.homeReturnFocusRestoreToken = Number(this.homeReturnFocusRestoreToken || 0) + 1;
      if (this.homeViewportFocusSyncTimer) {
        clearTimeout(this.homeViewportFocusSyncTimer);
        this.homeViewportFocusSyncTimer = null;
      }
      if (this.homeViewportScrollFrame) {
        cancelAnimationFrame(this.homeViewportScrollFrame);
        this.homeViewportScrollFrame = 0;
      }
      if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
        this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler, true);
      }
      this.boundHomeViewport = null;
      if (this.homeTruncationFrame) {
        cancelAnimationFrame(this.homeTruncationFrame);
        this.homeTruncationFrame = null;
      }
      if (this.homeLazyImageHydrationRaf) {
        cancelAnimationFrame(this.homeLazyImageHydrationRaf);
        this.homeLazyImageHydrationRaf = 0;
      }
      if (this.homeViewportSettleHydrationTimer) {
        clearTimeout(this.homeViewportSettleHydrationTimer);
        this.homeViewportSettleHydrationTimer = null;
      }
      if (this.homeLazyImageHydrationSettleTimer) {
        clearTimeout(this.homeLazyImageHydrationSettleTimer);
        this.homeLazyImageHydrationSettleTimer = null;
      }
      if (this.homeLazyImageNeighborTimer) {
        clearTimeout(this.homeLazyImageNeighborTimer);
        this.homeLazyImageNeighborTimer = null;
      }
      if (this.homeLazyImageCommitRaf) {
        cancelAnimationFrame(this.homeLazyImageCommitRaf);
        this.homeLazyImageCommitRaf = 0;
      }
      this.homeLazyImageCommitQueue = [];
      this.homeLazyImageCommitOrder = 0;
      this.pendingHomeLazyImageAnchor = null;
      this.pendingHomeLazyImageFocusedRowOnly = false;
      this.pendingHomeLazyImageIncludeNeighborRows = false;
      this.homeLazyImageHydrationNeedsFullScan = false;
      this.homeLazyImageHydrationNeedsIndexRefresh = false;
      this.homeLazyImageHydrationIndex = null;
      this.lastHomeLazyImageHydrationAnchorRow = null;
      this.lastDirectionalKeyAtByDirection = {};
      this.homeTruncationScope = null;
      if (this.boundHomeEventContainer) {
        this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
        this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
        this.boundHomeEventContainer.removeEventListener("mousedown", this.boundHomeMouseDownHandler);
        this.boundHomeEventContainer.removeEventListener("mouseover", this.boundHomeMouseOverHandler);
        this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
        this.boundHomeEventContainer = null;
      }
      this.cachedModernPortraitPosterMetrics = null;
      this.cachedModernLandscapePosterMetrics = null;
      const preserveRenderedTvHome = Boolean(
        (Platform.isTizen() || Platform.isWebOS()) &&
        this.hasLoadedOnce &&
        Array.isArray(this.rows) &&
        this.rows.length &&
        this.container?.childNodes?.length
      );
      if (preserveRenderedTvHome) {
        // Keep the rendered TV Home alive while another screen is shown. Rebuilding
        // a large catalog after display:none forces a full parse/layout/paint on
        // constrained TV browsers, while Android keeps the Home back-stack state.
        // Keep the DOM cached, but remove it from the compositor completely. Some
        // TV runtimes can still present composited descendants after visibility and
        // transform changes, which lets the old Home bleed through a new route.
        //
        // The retained cards keep their artwork, exactly like the Android back
        // stack keeps its Coil memory cache: stripping every src and revoking the
        // blob urls here would force a full re-fetch and decode of every visible
        // poster on the way back, and a single missed re-hydration left those
        // cards permanently blank. The bounded eviction still releases the rows
        // that leave the artwork window, so memory stays where it was.
        this.container.style.position = "absolute";
        this.container.style.top = "0";
        this.container.style.right = "0";
        this.container.style.bottom = "0";
        this.container.style.left = "0";
        // The home-dom-preserved class hides the layer (content-visibility or
        // display:none). Inline visibility/pointer-events are inherited, so
        // toggling them restyled every card on return (~1 s on webOS).
        this.container.classList.add("home-dom-preserved");
        this.homeDomPreserved = true;
      } else {
        // Without a retained DOM the cards are about to be discarded: hand the
        // painted urls back, then drop the workers and every blob they produced.
        this.releaseAllHomeLazyImages();
        resetHomeArtworkRescaler();
        this.homeDomPreserved = false;
        this.container.classList.remove("home-dom-preserved");
        this.container.style.removeProperty("position");
        this.container.style.removeProperty("top");
        this.container.style.removeProperty("right");
        this.container.style.removeProperty("bottom");
        this.container.style.removeProperty("left");
        this.container.style.removeProperty("visibility");
        this.container.style.removeProperty("pointer-events");
        this.renderedMarkup = null;
        ScreenUtils.hide(this.container);
      }
    }
  };
}
