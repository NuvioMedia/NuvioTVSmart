import { Platform } from "../../platform/index.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";
import { requestWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";

const REQUEST_TIMEOUT_MS = 4000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return "";
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

async function resolveBaseUrl() {
  if (Platform.isTizen()) {
    const result = await TizenEngineFsService.ensureStarted({ purpose: "p2p" });
    return result?.status === "success" ? normalizeBaseUrl(result.baseUrl) : "";
  }
  if (Platform.isWebOS()) {
    const { payload } = await withTimeout(
      requestWebOsCompanionService({
        method: "status",
        parameters: {},
        timeoutMs: REQUEST_TIMEOUT_MS
      }),
      REQUEST_TIMEOUT_MS,
      "webOS companion status timed out"
    );
    const url = normalizeBaseUrl(payload?.url);
    try {
      return url && LOCAL_HOSTS.has(new URL(url).hostname) ? url : "";
    } catch (_) {
      return "";
    }
  }
  return "";
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await withTimeout(
    fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-cache"
    }),
    REQUEST_TIMEOUT_MS,
    `EngineFS ${path} timed out`
  );
  if (!response.ok) {
    throw new Error(`EngineFS ${path} failed with HTTP ${response.status}`);
  }
  return response.json();
}

export function formatByteSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export const P2pCacheService = {
  /**
   * Reads the live EngineFS cache state. The webOS runtime ships with caching
   * disabled, so the UI keeps its cache rows disabled on that platform.
   */
  supportsCacheControls() {
    return Platform.isTizen();
  },

  async getState() {
    if (!this.supportsCacheControls()) {
      return { supported: false, available: false };
    }
    let baseUrl = "";
    try {
      baseUrl = await resolveBaseUrl();
      if (!baseUrl) {
        return { supported: true, available: false };
      }
      const [settings, usage] = await Promise.all([
        requestJson(baseUrl, "/settings"),
        requestJson(baseUrl, "/nuvio-cache/status")
      ]);
      const cacheSizeBytes = Number(settings?.values?.cacheSize);
      return {
        supported: true,
        available: true,
        baseUrl,
        cacheSizeBytes: Number.isFinite(cacheSizeBytes) && cacheSizeBytes > 0 ? cacheSizeBytes : 0,
        usedBytes: Math.max(0, Number(usage?.usedBytes) || 0),
        activeBytes: Math.max(0, Number(usage?.activeBytes) || 0)
      };
    } catch (error) {
      return {
        supported: true,
        available: false,
        baseUrl,
        error: error?.message || String(error || "EngineFS unavailable")
      };
    }
  },

  async setCacheSize(bytes) {
    const baseUrl = await resolveBaseUrl();
    if (!baseUrl) {
      return false;
    }
    await requestJson(baseUrl, "/settings", {
      method: "POST",
      body: { cacheSize: Math.max(0, Number(bytes) || 0) }
    });
    return true;
  },

  async clearCache() {
    const baseUrl = await resolveBaseUrl();
    if (!baseUrl) {
      return { cleared: false, reclaimedBytes: 0 };
    }
    const result = await requestJson(baseUrl, "/nuvio-cache/clear");
    return {
      cleared: Boolean(result?.cleared),
      reclaimedBytes: Math.max(0, Number(result?.reclaimedBytes) || 0)
    };
  }
};
