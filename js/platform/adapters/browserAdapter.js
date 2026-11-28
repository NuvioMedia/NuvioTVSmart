import { isBackEvent, normalizeKeyEvent } from "../sharedKeys.js";
import { installTitanRemote, isTitanOsUserAgent } from "../titanRemote.js";

export const browserAdapter = {
  name: "browser",

  init() {
    if (isTitanOsUserAgent(globalThis.navigator?.userAgent)) {
      installTitanRemote();
    }
  },

  exitApp() {
    try {
      globalThis.close?.();
    } catch (_) {
      // Browsers commonly block window.close(); ignore that.
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [461, 10009, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [461, 10009, 27, 8]);
  },

  getDeviceLabel() {
    return "Web Browser";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: false
    };
  },

  prepareVideoElement() {}
};
