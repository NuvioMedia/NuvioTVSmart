import { Platform } from "../../platform/index.js";
import { TizenCapabilities } from "../../platform/tizen/tizenCapabilities.js";

export const PLUGIN_QUOTAS = Object.freeze({
  modern: Object.freeze({
    // Keep the JS execution policy aligned with Android's PluginManager:
    // ten network-bound scrapers, up to 150 results, and a 120-second outer
    // scraper budget. The fetch bridge still has Android's 1 MiB body cap and
    // the QuickJS runtime has its own 60-second execution budget per provider.
    maxConcurrent: 10,
    // Android does not impose a separate manifest cap; 5 MiB is the same
    // bounded repository envelope used for Android scraper downloads while
    // retaining a safe finite limit for the Tizen transport.
    maxManifestBytes: 5 * 1024 * 1024,
    maxCodeBytes: 5 * 1024 * 1024,
    maxCacheBytes: 16 * 1024 * 1024,
    maxFetchBytes: 1024 * 1024,
    // Android limits the flattened request to 150, not each provider. Keep
    // the same effective boundary and avoid a stricter per-scraper truncation.
    maxResultsPerScraper: 150,
    maxResults: 150,
    providerTimeoutMs: 60000,
    globalTimeoutMs: 120000,
    maxDocuments: 8,
    maxDomElements: 10000,
    memoryLimitBytes: 64 * 1024 * 1024
  }),
  limited: Object.freeze({
    maxConcurrent: 1,
    maxManifestBytes: 128 * 1024,
    maxCodeBytes: 1024 * 1024,
    maxCacheBytes: 8 * 1024 * 1024,
    maxFetchBytes: 512 * 1024,
    maxResultsPerScraper: 25,
    maxResults: 75,
    providerTimeoutMs: 25000,
    globalTimeoutMs: 45000,
    maxDocuments: 2,
    maxDomElements: 6000,
    memoryLimitBytes: 32 * 1024 * 1024
  })
});

function parseVersion(value) {
  const match = String(value || "").match(/(\d+)(?:\.(\d+))?/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 100 + Number(match[2] || 0);
}

function chromiumVersion() {
  const value = String(globalThis.navigator?.userAgent || "");
  const match = value.match(/(?:Chrome|Chromium)\/(\d{2,3})/i);
  return match ? Number(match[1]) || 0 : 0;
}

function snapshotFields(
  platform,
  quota,
  {
    appSupported = platform !== "browser",
    normalAddonsSupported = appSupported,
    candidate = false,
    executable = false,
    reason = ""
  } = {}
) {
  return {
    platform,
    appSupported,
    normalAddonsSupported,
    candidate,
    executable,
    supportLevel: candidate
      ? quota === PLUGIN_QUOTAS.limited
        ? "limited"
        : "full"
      : "unsupported",
    reason,
    pluginServiceAvailable: false,
    localJsPluginSupported: executable,
    pluginMemoryBudget: Number(quota.memoryLimitBytes || 0),
    pluginMaxConcurrency: Number(quota.maxConcurrent || 0),
    quota
  };
}

export function getPluginCapabilitySnapshot() {
  const platform = Platform.getName();
  const hasWorker = typeof globalThis.Worker === "function";
  const hasWebAssembly = typeof globalThis.WebAssembly === "object";
  if (platform === "browser" && globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ !== true) {
    return snapshotFields(platform, PLUGIN_QUOTAS.limited, {
      appSupported: false,
      normalAddonsSupported: false,
      reason: "Plugin execution is limited to packaged TV runtimes"
    });
  }

  if (!hasWorker || !hasWebAssembly) {
    return snapshotFields(platform, PLUGIN_QUOTAS.limited, {
      appSupported: platform !== "browser",
      normalAddonsSupported: platform !== "browser",
      reason: "Worker and WebAssembly are required"
    });
  }

  if (platform === "tizen") {
    const capabilities = TizenCapabilities.get();
    const tizenVersion = parseVersion(capabilities.tizenVersion);
    const chrome = capabilities.chromiumMajorVersion || chromiumVersion();
    const appSupported = tizenVersion === 0 || tizenVersion >= 400;
    const pluginServicePackaged = globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ !== false;
    if (!capabilities.tizenPluginVersionSupported) {
      return {
        ...snapshotFields(platform, PLUGIN_QUOTAS.limited, {
          appSupported,
          normalAddonsSupported: appSupported,
          reason: "Tizen plugin support starts at Tizen 5.0"
        }),
        tizenVersion: capabilities.tizenVersion,
        chromiumMajorVersion: chrome,
        precheckPassed: false,
        pluginServicePackaged
      };
    }
    if (!pluginServicePackaged) {
      return {
        ...snapshotFields(platform, PLUGIN_QUOTAS.limited, {
          appSupported,
          normalAddonsSupported: appSupported,
          reason: "The packaged Tizen plugin service is missing"
        }),
        tizenVersion: capabilities.tizenVersion,
        chromiumMajorVersion: chrome,
        precheckPassed: false,
        pluginServicePackaged
      };
    }
    return {
      ...snapshotFields(platform, PLUGIN_QUOTAS.modern, {
        appSupported,
        normalAddonsSupported: appSupported,
        candidate: true,
        reason: "Waiting for the packaged plugin service and QuickJS worker handshake"
      }),
      tizenVersion: capabilities.tizenVersion,
      chromiumMajorVersion: chrome,
      precheckPassed: true,
      pluginServicePackaged
    };
  }

  if (platform === "webos") {
    const version = Platform.getWebOsMajorVersion();
    const appSupported = version === 0 || version >= 5;
    const pluginServicePackaged = globalThis.__NUVIO_WEBOS_PLUGIN_SERVICE_ENABLED__ !== false;
    if (version > 0 && version < 5) {
      return {
        ...snapshotFields(platform, PLUGIN_QUOTAS.limited, {
          appSupported: false,
          normalAddonsSupported: false,
          reason: "LG webOS 5.0 is the minimum packaged app version"
        }),
        webOsMajorVersion: version,
        precheckPassed: false,
        pluginServicePackaged
      };
    }
    if (!pluginServicePackaged) {
      return {
        ...snapshotFields(platform, PLUGIN_QUOTAS.limited, {
          appSupported,
          normalAddonsSupported: appSupported,
          reason: "The packaged webOS plugin service is missing"
        }),
        webOsMajorVersion: version,
        precheckPassed: false,
        pluginServicePackaged
      };
    }
    // Same quota as Android on every supported webOS; how many providers run
    // at once adapts to the TV in pluginResourceGovernor.js.
    const quota = PLUGIN_QUOTAS.modern;
    return {
      ...snapshotFields(platform, quota, {
        appSupported,
        normalAddonsSupported: appSupported,
        candidate: true,
        reason: "Waiting for the packaged plugin service and QuickJS worker handshake"
      }),
      webOsMajorVersion: version,
      precheckPassed: true,
      pluginServicePackaged
    };
  }

  return {
    ...snapshotFields(platform, PLUGIN_QUOTAS.modern, {
      appSupported: false,
      normalAddonsSupported: false,
      candidate: true,
      reason: "Waiting for the plugin runtime handshake"
    }),
    precheckPassed: true,
    pluginServicePackaged: true
  };
}
