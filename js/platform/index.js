import { browserAdapter } from "./adapters/browserAdapter.js";
import { webosAdapter } from "./adapters/webosAdapter.js";
import { tizenAdapter } from "./adapters/tizenAdapter.js";

const ADAPTERS = {
  browser: browserAdapter,
  webos: webosAdapter,
  tizen: tizenAdapter
};

let cachedWebOsMajorVersion = null;

function parseWebOsMajorVersion() {
  const candidates = [
    String(globalThis.PalmSystem?.deviceInfo || ""),
    String(globalThis.webOSSystem?.deviceInfo || ""),
    String(globalThis.navigator?.userAgent || "")
  ].filter(Boolean);

  const patterns = [
    /web0s\.tv[\s/-]?(\d{1,2})/i,
    /webos\.tv[\s/-]?(\d{1,2})/i,
    /web0s[\s/-]?(\d{1,2})/i,
    /webos[\s/-]?(\d{1,2})/i,
    /chromium\/(\d{2,3})/i,
    /chrome\/(\d{2,3})/i
  ];

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (!match) {
        continue;
      }
      const value = Number(match[1] || 0);
      if (!Number.isFinite(value) || value <= 0) {
        continue;
      }
      if (/chrom(e|ium)\//i.test(pattern.source)) {
        if (value <= 53) return 3;
        if (value <= 68) return 4;
        if (value <= 79) return 5;
        if (value <= 87) return 6;
        if (value <= 94) return 22;
        if (value <= 108) return 23;
        if (value <= 120) return 24;
        return 25;
      }
      return value;
    }
  }
  return 0;
}

function detectPlatformName() {
  const override = String(globalThis.__NUVIO_PLATFORM__ || "")
    .trim()
    .toLowerCase();
  if (override && ADAPTERS[override]) {
    return override;
  }
  const searchParams = String(globalThis.location?.search || "").toLowerCase();
  if (searchParams.includes("wrapper=tizen")) {
    return "tizen";
  }
  const userAgent = String(globalThis.navigator?.userAgent || "").toLowerCase();
  if (globalThis.webOS || globalThis.PalmSystem || globalThis.webOSSystem) {
    return "webos";
  }
  if (userAgent.includes("webos") || userAgent.includes("web0s")) {
    return "webos";
  }
  const webapis = globalThis.webapis || {};
  if (
    globalThis.tizen ||
    globalThis.avplay ||
    webapis.avplay ||
    webapis.avPlay ||
    webapis.productinfo ||
    userAgent.includes("tizen")
  ) {
    return "tizen";
  }
  return "browser";
}

function getAdapter() {
  if (!Platform.current) {
    Platform.current = ADAPTERS[detectPlatformName()];
  }
  return Platform.current;
}

export const Platform = {
  current: null,

  init() {
    const adapter = getAdapter();
    adapter.init?.();
    return adapter;
  },

  getName() {
    return getAdapter().name;
  },

  isWebOS() {
    return this.getName() === "webos";
  },

  getWebOsMajorVersion() {
    if (!this.isWebOS()) {
      return 0;
    }
    // PalmSystem.deviceInfo is a native bridge call (~6 ms on a G5) and the
    // firmware cannot change while the app runs.
    if (cachedWebOsMajorVersion === null) {
      cachedWebOsMajorVersion = parseWebOsMajorVersion();
    }
    return cachedWebOsMajorVersion;
  },

  isTizen() {
    return this.getName() === "tizen";
  },

  isBrowser() {
    return this.getName() === "browser";
  },

  exitApp() {
    if (globalThis.document && typeof globalThis.CustomEvent === "function") {
      const beforeExitEvent = new CustomEvent("nuvio:beforeExitApp", {
        cancelable: true
      });
      globalThis.document.dispatchEvent(beforeExitEvent);
      if (beforeExitEvent.defaultPrevented) {
        return false;
      }
    }
    return getAdapter().exitApp();
  },

  isBackEvent(event) {
    return getAdapter().isBackEvent(event);
  },

  normalizeKey(event) {
    return getAdapter().normalizeKey(event);
  },

  getDeviceLabel() {
    return getAdapter().getDeviceLabel();
  },

  getCapabilities() {
    return getAdapter().getCapabilities();
  },

  prepareVideoElement(videoElement) {
    return getAdapter().prepareVideoElement?.(videoElement);
  }
};
