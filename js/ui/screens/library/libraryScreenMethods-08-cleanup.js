/* eslint-disable no-unused-vars */
import * as internals from "./libraryScreen.js";

export function createLibraryScreenMethods08() {
  const { ScreenUtils, resetDpadRepeat } = internals;

  return {
    cleanup() {
      resetDpadRepeat(this);
      this.cancelScheduledRender();
      this.clearClosingPicker();
      this.lastRenderedExpandedPicker = null;
      this.cancelPendingPosterHold();
      if (this._libraryTouchHoldTimer) {
        clearTimeout(this._libraryTouchHoldTimer);
        this._libraryTouchHoldTimer = null;
      }
      this.posterOptionsMenu = null;
      this.posterOptionsController?.destroy?.({ restoreFocus: false });
      this.posterOptionsController = null;
      this.pendingPosterOptionsFocusKey = "";
      this.suppressHoldMenuEnterUntilKeyUp = false;
      this.gridRows = [];
      this.pendingHydrationState = null;
      this.controller?.dispose?.();
      this.controller = null;
      ScreenUtils.hide(this.container);
    }
  };
}
