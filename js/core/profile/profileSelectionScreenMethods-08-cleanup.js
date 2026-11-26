export function createProfileSelectionScreenMethods08() {
  return {
    cleanup() {
      this.isMounted = false;
      this.mountToken = null;
      this.memberAccessUnsubscribe?.();
      this.memberAccessUnsubscribe = null;
      this.profileBackgroundUnsubscribe?.();
      this.profileBackgroundUnsubscribe = null;
      this._destroyDialogs();
      this.cancelPendingProfileHold();
      this.focusedNode = null;
      if (this._bgAnimRaf) {
        cancelAnimationFrame(this._bgAnimRaf);
        this._bgAnimRaf = null;
      }
      this._bgCurrentColor = null;
      this._bgScreen = null;
      this._bgTargetColor = null;
      this._bgThemeColors = null;
      if (this.pinActionMessageTimer) {
        clearTimeout(this.pinActionMessageTimer);
        this.pinActionMessageTimer = null;
      }
      if (this.pinTransitionTimer) {
        clearTimeout(this.pinTransitionTimer);
        this.pinTransitionTimer = null;
      }
      this.pinTransitionCallback = null;
      this.suppressedFocusClick = null;
      const container = document.getElementById("profileSelection");
      if (!container) {
        return;
      }
      container.style.display = "none";
      container.innerHTML = "";
    }
  };
}
