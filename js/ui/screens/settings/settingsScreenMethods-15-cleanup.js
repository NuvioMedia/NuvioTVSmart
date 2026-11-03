import { stopMdbListAuthorization } from "./settingsMdbListAccount.js";
/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods15() {
  const { ScreenUtils } = internals;

  return {
    cleanup() {
      stopMdbListAuthorization.call(this);
      this.closeCustomPosterPhoneConfig?.();
      this.closeCustomPosterPhoneConfig = null;
      this.mediaServerDraft = null;
      this.mediaServersView = null;
      this.mediaServerError = null;
      this.stopTrackingWork?.();
      this.isMounted = false;
      this.settingsMountToken = (this.settingsMountToken || 0) + 1;
      this.memberAccessUnsubscribe?.();
      this.memberAccessUnsubscribe = null;
      this.persistUiState();
      this.stopTraktPolling?.();
      this.stopDebridDeviceAuth();
      if (this.container && this.handleWheelBound) {
        this.container.removeEventListener("wheel", this.handleWheelBound);
      }
      if (this.container && this.handleClickBound) {
        this.container.removeEventListener("click", this.handleClickBound);
      }
      const navSlot = this.container?.querySelector?.("[data-settings-nav]");
      if (navSlot && this.handleRailScrollBound) {
        navSlot.removeEventListener("scroll", this.handleRailScrollBound);
      }
      if (navSlot?.settingsScrollAnimationFrame) {
        cancelAnimationFrame(navSlot.settingsScrollAnimationFrame);
        navSlot.settingsScrollAnimationFrame = null;
      }
      if (navSlot?.settingsScrollAnimationFrameX) {
        cancelAnimationFrame(navSlot.settingsScrollAnimationFrameX);
        navSlot.settingsScrollAnimationFrameX = null;
      }
      this.handleWheelBound = null;
      this.handleClickBound = null;
      this.handleRailScrollBound = null;
      this.railScrollNode = null;
      this.activeSection = null;
      this.focusZone = "nav";
      this.sidebarFocusIndex = 0;
      this.navIndex = -1;
      this.contentFocusKey = null;
      this.appearanceThemeFocusKey = null;
      this.integrationView = "hub";
      this.expandedSections = {};
      this.optionDialog = null;
      this.textDialog = null;
      this.dialogFocusIndex = 0;
      this.sidebarExpanded = false;
      this.pillIconOnly = false;
      this.suppressNextContentFocusScroll = false;
      this.renderedSectionId = null;
      ScreenUtils.hide(this.container);
    }
  };
}
