const TIZEN_PLATFORM_VERSION_CAPABILITY = "http://tizen.org/feature/platform.version";
const TIZEN_WEB_SERVICE_CAPABILITY = "http://tizen.org/feature/web.service";
const TIZEN_P2P_MIN_MAJOR_VERSION = 5;
const TIZEN_P2P_MIN_CHROMIUM_VERSION = 63;
const TIZEN_PLUGIN_MIN_MAJOR_VERSION = 6;

let cachedCapabilities = null;

function normalizedText(value) {
  return String(value ?? "").trim();
}

function readCapability(runtime, name) {
  const systemInfo = runtime?.tizen?.systeminfo;
  const getter = systemInfo?.getCapability;
  if (typeof getter !== "function") {
    return { known: false, value: null };
  }
  try {
    return { known: true, value: getter.call(systemInfo, name) };
  } catch (_) {
    return { known: false, value: null };
  }
}

function normalizeBooleanCapability(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = normalizedText(value).toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return Boolean(value);
}

function parseMajorVersion(value) {
  const match = normalizedText(value).match(/^(\d+)(?:\.\d+)?/);
  if (!match) {
    return 0;
  }
  const major = Number(match[1]);
  return Number.isFinite(major) && major > 0 ? major : 0;
}

function readTizenVersion(runtime) {
  const capability = readCapability(runtime, TIZEN_PLATFORM_VERSION_CAPABILITY);
  const userAgent = normalizedText(runtime?.navigator?.userAgent);
  const candidates = [
    capability.value,
    runtime?.__NUVIO_TIZEN_VERSION__,
    (userAgent.match(/Tizen[\s/]([0-9]+(?:\.[0-9]+)*)/i) || [])[1]
  ];
  const version =
    candidates.map(normalizedText).find((candidate) => parseMajorVersion(candidate) > 0) || "";
  return {
    version,
    major: parseMajorVersion(version),
    known: parseMajorVersion(version) > 0
  };
}

function readChromiumMajorVersion(runtime) {
  const userAgent = normalizedText(runtime?.navigator?.userAgent);
  const match = userAgent.match(/(?:Chrome|Chromium)\/(\d{2,3})/i);
  if (!match) {
    return 0;
  }
  const major = Number(match[1]);
  return Number.isFinite(major) && major > 0 ? major : 0;
}

function isTizenRuntime(runtime) {
  const override = normalizedText(runtime?.__NUVIO_PLATFORM__).toLowerCase();
  if (override) {
    return override === "tizen";
  }

  const search = normalizedText(runtime?.location?.search).toLowerCase();
  if (search.includes("wrapper=tizen")) {
    return true;
  }

  const userAgent = normalizedText(runtime?.navigator?.userAgent).toLowerCase();
  const webapis = runtime?.webapis || {};
  return Boolean(
    runtime?.tizen ||
    runtime?.avplay ||
    webapis.avplay ||
    webapis.avPlay ||
    webapis.productinfo ||
    userAgent.includes("tizen")
  );
}

function supportsP2pByVersion({ tizenMajorVersion, chromiumMajorVersion }) {
  if (tizenMajorVersion > 0) {
    return tizenMajorVersion >= TIZEN_P2P_MIN_MAJOR_VERSION;
  }
  if (chromiumMajorVersion > 0) {
    return chromiumMajorVersion >= TIZEN_P2P_MIN_CHROMIUM_VERSION;
  }
  // An unidentified Tizen runtime fails closed for P2P. Direct playback and
  // the generic EngineFS proxy remain available when the service is present.
  return false;
}

export function getTizenCapabilities(runtime = globalThis) {
  if (runtime === globalThis && cachedCapabilities) {
    return cachedCapabilities;
  }

  const isTizen = isTizenRuntime(runtime);
  const tizenVersion = readTizenVersion(runtime);
  const chromiumMajorVersion = readChromiumMajorVersion(runtime);
  const webServiceCapability = readCapability(runtime, TIZEN_WEB_SERVICE_CAPABILITY);
  const webServiceSupported =
    webServiceCapability.known && webServiceCapability.value != null
      ? normalizeBooleanCapability(webServiceCapability.value)
      : null;
  const engineFsServicePackaged = runtime?.__NUVIO_TIZEN_ENGINEFS_SERVICE_ENABLED__ !== false;
  // Samsung exposes web.service as an optional capability. Some supported
  // TVs/firmwares report false even though the packaged service can still be
  // started through wrt:service. Callers with an explicit local-service
  // contract (P2P, playback proxy, subtitles) bypass this flag and let the
  // real probe decide; generic callers keep the capability gate. Version and
  // package gates stay authoritative so Tizen 4 and service-less packages
  // remain unsupported.
  const supportsWebService = isTizen && engineFsServicePackaged && webServiceSupported !== false;
  const p2pVersionSupported =
    isTizen &&
    supportsP2pByVersion({
      tizenMajorVersion: tizenVersion.major,
      chromiumMajorVersion
    });
  const supportsP2p = isTizen && engineFsServicePackaged && p2pVersionSupported;
  // The Tizen plugin runtime is intentionally disabled on older firmware.
  // Keep this independent from EngineFS: P2P/media proxy support remains
  // available on Tizen 5.x even though executable plugins are not.
  const tizenPluginVersionSupported =
    !isTizen || tizenVersion.major >= TIZEN_PLUGIN_MIN_MAJOR_VERSION;

  const capabilities = Object.freeze({
    isTizen,
    tizenVersion: tizenVersion.version,
    tizenMajorVersion: tizenVersion.major,
    tizenVersionKnown: tizenVersion.known,
    chromiumMajorVersion,
    hasIntersectionObserver: typeof runtime?.IntersectionObserver === "function",
    hasResizeObserver: typeof runtime?.ResizeObserver === "function",
    hasWebAssembly: typeof runtime?.WebAssembly === "object",
    engineFsServicePackaged,
    webServiceSupported,
    supportsWebService,
    p2pVersionSupported,
    supportsP2p,
    tizenPluginVersionSupported,
    supportsTizenAvPlayDashAudioSwitching:
      isTizen &&
      supportsP2pByVersion({
        tizenMajorVersion: tizenVersion.major,
        chromiumMajorVersion
      }),
    advancedSubtitleStylingLimited: isTizen && typeof runtime?.ResizeObserver !== "function"
  });

  if (runtime === globalThis) {
    cachedCapabilities = capabilities;
  }
  return capabilities;
}

export function resetTizenCapabilitiesCache() {
  cachedCapabilities = null;
}

export const TizenCapabilities = {
  get(runtime = globalThis) {
    return getTizenCapabilities(runtime);
  },

  isTizen(runtime = globalThis) {
    return getTizenCapabilities(runtime).isTizen;
  },

  supportsWebService(runtime = globalThis) {
    return getTizenCapabilities(runtime).supportsWebService;
  },

  canUseP2p(runtime = globalThis) {
    return getTizenCapabilities(runtime).supportsP2p;
  },

  canUsePlugins(runtime = globalThis) {
    const capabilities = getTizenCapabilities(runtime);
    return !capabilities.isTizen || capabilities.tizenPluginVersionSupported;
  },

  isP2pUnsupported(runtime = globalThis) {
    const capabilities = getTizenCapabilities(runtime);
    return capabilities.isTizen && !capabilities.supportsP2p;
  },

  isDashAudioSwitchingUnsupported({
    dashManifest = false,
    usingAvPlay = false,
    runtime = globalThis
  } = {}) {
    const capabilities = getTizenCapabilities(runtime);
    return Boolean(
      capabilities.isTizen &&
      dashManifest &&
      usingAvPlay &&
      !capabilities.supportsTizenAvPlayDashAudioSwitching
    );
  },

  isAdvancedSubtitleStylingLimited(runtime = globalThis) {
    return getTizenCapabilities(runtime).advancedSubtitleStylingLimited;
  }
};

export const TIZEN_CAPABILITY_NAMES = Object.freeze({
  platformVersion: TIZEN_PLATFORM_VERSION_CAPABILITY,
  webService: TIZEN_WEB_SERVICE_CAPABILITY
});
