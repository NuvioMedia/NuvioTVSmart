import { Platform } from "./index.js";

export const Environment = {
  isWebOS() {
    return Platform.isWebOS();
  },

  isTizen() {
    return Platform.isTizen();
  },

  isBrowser() {
    return Platform.isBrowser();
  },

  isVidaa() {
    return Platform.isVidaa();
  },

  isBackEvent(event) {
    return Platform.isBackEvent(event);
  },

  getDeviceLabel() {
    return Platform.getDeviceLabel();
  }
};
