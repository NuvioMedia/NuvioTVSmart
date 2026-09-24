import { Platform } from "./index.js";
import { TizenCapabilities } from "./tizen/tizenCapabilities.js";
import { TizenPluginService } from "./tizen/tizenPluginService.js";
import { WebOsPluginService } from "./webos/webosPluginService.js";
import {
  normalizePluginHeaders,
  validatePluginFetchRequest
} from "../core/player/pluginSecurity.js";
import {
  diagnosticError,
  emitPluginDiagnosticEvent,
  emitPluginServiceDiagnostics
} from "../core/diagnostics/pluginDiagnostics.js";

let cachedHealth = null;
let cachedHealthAt = 0;
const HEALTH_TTL_MS = 30000;
const SERVICE_WATCHDOG_INTERVAL_MS = 10000;
const WATCHDOG_FAILURE_THRESHOLD = 2;
const WATCHDOG_RECOVERY_BACKOFF_INITIAL_MS = 30000;
const WATCHDOG_RECOVERY_BACKOFF_MAX_MS = 120000;
let lifecycleMonitorTimer = null;
let lifecycleMonitorStartPromise = null;
let lifecycleMonitorProbePromise = null;
let lifecycleMonitorGeneration = 0;
let lifecycleLastFailure = "";
let lifecycleConsecutiveFailures = 0;
let lifecycleRecoveryNotBefore = 0;
let lifecycleRecoveryBackoffMs = WATCHDOG_RECOVERY_BACKOFF_INITIAL_MS;
let lastHealthDiagnostic = "";
export const PLUGIN_PROTOCOL_VERSION = 1;

function serviceForPlatform() {
  if (Platform.isTizen()) return TizenPluginService;
  if (Platform.isWebOS()) return WebOsPluginService;
  return null;
}

const TIZEN_PLUGIN_UNSUPPORTED_DETAIL = "Tizen plugin support starts at Tizen 6.0";

function areTizenPluginsSupported() {
  return !Platform.isTizen() || TizenCapabilities.canUsePlugins();
}

function unsupportedTizenPluginResult() {
  return {
    returnValue: false,
    status: "unsupported",
    pluginUnsupported: true,
    detail: TIZEN_PLUGIN_UNSUPPORTED_DETAIL
  };
}

function reportLifecycleFailure(error) {
  const detail = String(error?.message || error || "PluginService is unavailable");
  if (detail === lifecycleLastFailure) {
    return;
  }
  lifecycleLastFailure = detail;
  console.warn("[Nuvio PluginService] lifecycle watchdog recovery failed", detail);
}

function reportHealthFailure(error) {
  const detail = String(error?.message || error || "PluginService health check failed");
  if (detail === lastHealthDiagnostic) return;
  lastHealthDiagnostic = detail;
  emitPluginDiagnosticEvent(
    "plugin service health check failed",
    { error: diagnosticError(error) },
    { prefix: "[Nuvio PluginService]", level: "error" }
  );
}

function assertCompatibleHealth(health) {
  if (health.returnValue !== true)
    throw new Error(health.detail || "Plugin network service is not ready");
  if (
    Number(health.protocolVersion || 0) !== PLUGIN_PROTOCOL_VERSION ||
    Number(health.serviceVersion || 0) < 1 ||
    typeof health.runtimeVersion !== "string" ||
    typeof health.quickjsVersion !== "string" ||
    health.workerSupport !== true ||
    Number(health.maxConcurrency || 0) < 1 ||
    typeof health.memoryTier !== "string" ||
    health.jsPluginCapability !== true ||
    health.networkBoundary !== true
  ) {
    throw new Error("Plugin service protocol or JavaScript capability is incompatible");
  }
  return health;
}

function resetLifecycleRecoveryState() {
  lifecycleConsecutiveFailures = 0;
  lifecycleRecoveryNotBefore = 0;
  lifecycleRecoveryBackoffMs = WATCHDOG_RECOVERY_BACKOFF_INITIAL_MS;
  lifecycleLastFailure = "";
}

function healthFailureDetail(error) {
  return String(error?.message || error || "PluginService health check failed");
}

function pluginRequestDetails(request = {}) {
  return {
    requestId: String(request.requestId || "").slice(0, 128),
    executionId: String(request.executionId || "").slice(0, 128),
    profileId: String(request.profileId || "").slice(0, 64),
    repositoryId: String(request.repositoryId || "").slice(0, 128),
    scraperId: String(request.scraperId || "").slice(0, 128),
    method: String(request.method || "GET").toUpperCase(),
    url: String(request.url || "")
  };
}

async function probeReadyWithoutStarting() {
  const service = serviceForPlatform();
  if (Platform.isTizen() && typeof service?.probe === "function") {
    try {
      const payload = await service.probe();
      const health = { returnValue: payload?.returnValue !== false, status: "success", ...payload };
      const ready = assertCompatibleHealth(health);
      cachedHealth = ready;
      cachedHealthAt = Date.now();
      return ready;
    } catch (error) {
      cachedHealth = {
        returnValue: false,
        status: "error",
        detail: healthFailureDetail(error)
      };
      cachedHealthAt = Date.now();
      throw error;
    }
  }

  // Keep this helper safe if it is ever used by another TV adapter without a
  // probe-only API. The Tizen implementation above is the important path:
  // its watchdog check never starts the service on the first transient miss.
  return PluginServiceClient.ensureReady({ force: true });
}

async function runLifecycleCheck(generation) {
  try {
    const health = await probeReadyWithoutStarting();
    if (generation !== lifecycleMonitorGeneration) {
      return { status: "stopped", health };
    }
    resetLifecycleRecoveryState();
    return { status: "running", health, recovered: false };
  } catch (probeError) {
    if (generation !== lifecycleMonitorGeneration) {
      return { status: "stopped", detail: healthFailureDetail(probeError) };
    }

    lifecycleConsecutiveFailures += 1;
    if (lifecycleConsecutiveFailures < WATCHDOG_FAILURE_THRESHOLD) {
      return {
        status: "degraded",
        failures: lifecycleConsecutiveFailures,
        detail: healthFailureDetail(probeError)
      };
    }

    const now = Date.now();
    if (now < lifecycleRecoveryNotBefore) {
      return {
        status: "backoff",
        failures: lifecycleConsecutiveFailures,
        retryInMs: lifecycleRecoveryNotBefore - now,
        detail: healthFailureDetail(probeError)
      };
    }

    if (generation !== lifecycleMonitorGeneration) {
      return { status: "stopped", detail: healthFailureDetail(probeError) };
    }

    const backoff = lifecycleRecoveryBackoffMs;
    lifecycleRecoveryNotBefore = now + backoff;
    lifecycleRecoveryBackoffMs = Math.min(
      WATCHDOG_RECOVERY_BACKOFF_MAX_MS,
      Math.max(WATCHDOG_RECOVERY_BACKOFF_INITIAL_MS, backoff * 2)
    );

    try {
      // Only the confirmed consecutive-failure path is allowed to ask Tizen
      // to launch the service after the initial optional probe has failed.
      const health = await PluginServiceClient.ensureReady({ force: true });
      if (generation !== lifecycleMonitorGeneration) {
        return { status: "stopped", health };
      }
      resetLifecycleRecoveryState();
      return { status: "running", health, recovered: true };
    } catch (recoveryError) {
      reportLifecycleFailure(recoveryError);
      return {
        status: "degraded",
        failures: lifecycleConsecutiveFailures,
        recoveryAttempted: true,
        detail: healthFailureDetail(recoveryError)
      };
    }
  }
}

function normalizeResponse(payload, requestedUrl = "") {
  const status = Number(payload?.status || payload?.statusCode || 0);
  return {
    returnValue: payload?.returnValue !== false,
    // Android's OkHttp contract is successful only for 2xx responses. Do not
    // turn redirects or service errors into a successful plugin response.
    ok: status >= 200 && status < 300,
    status,
    statusText: String(payload?.statusText || ""),
    url: String(payload?.url || requestedUrl),
    body: typeof payload?.body === "string" ? payload.body : "",
    ...(typeof payload?.bodyBase64 === "string" ? { bodyBase64: payload.bodyBase64 } : {}),
    headers: payload?.headers && typeof payload.headers === "object" ? payload.headers : {},
    truncated: payload?.truncated === true
  };
}

function androidFetchFailure(request = {}, error) {
  return {
    returnValue: true,
    ok: false,
    status: 0,
    statusText: String(error?.message || error || "Fetch failed"),
    url: String(request.url || ""),
    body: "",
    headers: {},
    truncated: false
  };
}

async function directBrowserFetch(request) {
  const validation = validatePluginFetchRequest(request, {
    maxBodyBytes: Number(request.maxBodyBytes || 1024 * 1024)
  });
  if (!validation.ok) throw new Error(validation.reason);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abort = () => controller?.abort();
  request.signal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(abort, Number(request.timeoutMs || 30000));
  try {
    const requestBody =
      validation.bodyKind === "base64"
        ? Uint8Array.from(atob(validation.bodyBase64), (char) => char.charCodeAt(0))
        : validation.bodyKind === "text"
          ? validation.body
          : new Uint8Array(0);
    const methodHasBody =
      ["POST", "PUT", "PATCH"].includes(validation.method) ||
      (validation.method === "DELETE" && validation.bodyKind !== "none");
    const response = await fetch(validation.url, {
      method: validation.method,
      headers: normalizePluginHeaders(validation.headers),
      body: methodHasBody ? requestBody : undefined,
      signal: controller?.signal || request.signal
    });
    const binaryResponse =
      request.responseEncoding === "base64" ? await response.clone().arrayBuffer() : null;
    const body = await response.text();
    let bodyBase64;
    if (binaryResponse) {
      const bytes = new Uint8Array(binaryResponse);
      const chunks = [];
      for (let index = 0; index < bytes.length; index += 8192) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(index, index + 8192)));
      }
      bodyBase64 = btoa(chunks.join(""));
    }
    return normalizeResponse(
      {
        returnValue: true,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        body,
        ...(bodyBase64 !== undefined ? { bodyBase64 } : {}),
        headers: {}
      },
      validation.url
    );
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener?.("abort", abort);
  }
}

export const PluginServiceClient = {
  getService() {
    return serviceForPlatform();
  },

  async health({ force = false } = {}) {
    const now = Date.now();
    if (!areTizenPluginsSupported()) {
      cachedHealth = unsupportedTizenPluginResult();
      cachedHealthAt = now;
      return cachedHealth;
    }
    if (!force && cachedHealth && now - cachedHealthAt < HEALTH_TTL_MS) return cachedHealth;
    const service = serviceForPlatform();
    if (!service) {
      cachedHealth = {
        returnValue: globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ === true,
        status:
          globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ === true ? "browser" : "unsupported",
        detail: "No packaged TV plugin service"
      };
      cachedHealthAt = now;
      return cachedHealth;
    }
    try {
      const payload = await service.health();
      cachedHealth = { returnValue: payload?.returnValue !== false, status: "success", ...payload };
      if (cachedHealth.returnValue !== true) {
        reportHealthFailure(new Error(cachedHealth.detail || "PluginService health check failed"));
      } else {
        lastHealthDiagnostic = "";
      }
    } catch (error) {
      reportHealthFailure(error);
      cachedHealth = {
        returnValue: false,
        status: "error",
        detail: String(error?.message || error)
      };
    }
    cachedHealthAt = Date.now();
    return cachedHealth;
  },

  async ensureReady({ force = false } = {}) {
    if (!areTizenPluginsSupported()) {
      return unsupportedTizenPluginResult();
    }
    const health = await this.health({ force });
    return assertCompatibleHealth(health);
  },

  startLifecycleMonitor() {
    if (!Platform.isTizen() || !areTizenPluginsSupported()) {
      return Promise.resolve({ status: "skipped" });
    }
    if (lifecycleMonitorStartPromise) {
      return lifecycleMonitorStartPromise;
    }
    if (lifecycleMonitorTimer) {
      return Promise.resolve({ status: "running" });
    }
    if (!lifecycleMonitorStartPromise) {
      resetLifecycleRecoveryState();
      const generation = lifecycleMonitorGeneration;
      const runWatchdog = () => {
        if (generation !== lifecycleMonitorGeneration || lifecycleMonitorProbePromise) {
          return;
        }
        lifecycleMonitorProbePromise = runLifecycleCheck(generation).finally(() => {
          lifecycleMonitorProbePromise = null;
        });
      };
      // Start supervising before the first health check. If a cold TV boot
      // misses the initial startup window, later ticks must still retry while
      // the UI continues booting independently.
      lifecycleMonitorTimer = setInterval(runWatchdog, SERVICE_WATCHDOG_INTERVAL_MS);
      lifecycleMonitorStartPromise = (async () => {
        // The platform start call is only an acknowledgement. The initial
        // health check is intentionally asynchronous for the optional service;
        // callers may await this promise when they explicitly need readiness.
        const health = await this.ensureReady({ force: true });
        if (generation !== lifecycleMonitorGeneration) {
          return { status: "stopped", health };
        }
        resetLifecycleRecoveryState();
        return { status: "running", health };
      })().finally(() => {
        lifecycleMonitorStartPromise = null;
      });
    }
    return lifecycleMonitorStartPromise;
  },

  checkLifecycleNow() {
    if (!Platform.isTizen() || !areTizenPluginsSupported()) {
      return Promise.resolve({ status: "skipped" });
    }
    if (!lifecycleMonitorProbePromise) {
      const generation = lifecycleMonitorGeneration;
      lifecycleMonitorProbePromise = runLifecycleCheck(generation).finally(() => {
        lifecycleMonitorProbePromise = null;
      });
    }
    return lifecycleMonitorProbePromise;
  },

  stopLifecycleMonitor() {
    lifecycleMonitorGeneration += 1;
    resetLifecycleRecoveryState();
    if (lifecycleMonitorTimer) {
      clearInterval(lifecycleMonitorTimer);
      lifecycleMonitorTimer = null;
    }
  },

  async fetch(request = {}) {
    const androidContract = request.androidResponseContract === true;
    const requestDetails = pluginRequestDetails(request);
    try {
      if (!areTizenPluginsSupported()) {
        throw new Error(TIZEN_PLUGIN_UNSUPPORTED_DETAIL);
      }
      if (Platform.isBrowser()) {
        if (globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ !== true)
          throw new Error("Plugin execution is TV-only");
        const result = await directBrowserFetch(request);
        if (!result.ok || result.truncated || result.returnValue === false) {
          emitPluginDiagnosticEvent(
            result.truncated ? "provider response truncated" : "provider response failed",
            {
              ...requestDetails,
              status: result.status,
              statusText: result.statusText,
              responseUrl: result.url,
              truncated: result.truncated
            },
            {
              prefix: "[Nuvio PluginService]",
              level: result.status >= 500 || result.status === 0 ? "error" : "warn"
            }
          );
        }
        return result;
      }
      const validation = validatePluginFetchRequest(request, {
        maxBodyBytes: Number(request.maxBodyBytes || 1024 * 1024)
      });
      if (!validation.ok) throw new Error(validation.reason);
      const service = serviceForPlatform();
      if (!service) throw new Error("Plugin network service unavailable");
      const result = await service.fetch(
        {
          requestId: String(request.requestId || `${Date.now()}-${Math.random()}`),
          url: validation.url,
          method: validation.method,
          headers: validation.headers,
          bodyKind: validation.bodyKind,
          body: validation.body,
          ...(validation.bodyBase64 !== undefined ? { bodyBase64: validation.bodyBase64 } : {}),
          ...(request.responseEncoding === "base64" ? { responseEncoding: "base64" } : {}),
          maxBodyBytes: Number(request.maxBodyBytes || 1024 * 1024),
          maxResponseBytes: Number(request.maxResponseBytes || request.maxBodyBytes || 1024 * 1024),
          executionId: String(request.executionId || ""),
          profileId: String(request.profileId || ""),
          repositoryId: String(request.repositoryId || ""),
          scraperId: String(request.scraperId || ""),
          deadline: Number(request.deadline || 0) || undefined
        },
        {
          timeoutMs: Number(request.timeoutMs || 30000),
          signal: request.signal
        }
      );
      const normalized = normalizeResponse(result, validation.url);
      if (!normalized.ok || normalized.truncated || normalized.returnValue === false) {
        emitPluginDiagnosticEvent(
          normalized.truncated ? "provider response truncated" : "provider response failed",
          {
            ...requestDetails,
            url: validation.url,
            status: normalized.status,
            statusText: normalized.statusText,
            responseUrl: normalized.url,
            truncated: normalized.truncated
          },
          {
            prefix: "[Nuvio PluginService]",
            level: normalized.status >= 500 || normalized.status === 0 ? "error" : "warn"
          }
        );
      }
      return normalized;
    } catch (error) {
      emitPluginDiagnosticEvent(
        "plugin service fetch failed",
        { ...requestDetails, error: diagnosticError(error) },
        { prefix: "[Nuvio PluginService]", level: "error" }
      );
      // Android's native fetch resolves transport failures as a normal
      // response with status 0. Keep management/API calls throwing, and apply
      // that contract only to the explicit request emitted by PluginRuntime.
      if (androidContract) return androidFetchFailure(request, error);
      throw error;
    }
  },

  capabilities() {
    if (!areTizenPluginsSupported()) return unsupportedTizenPluginResult();
    const service = serviceForPlatform();
    if (!service?.capabilities) return this.health({ force: true });
    return service.capabilities();
  },

  async diagnostics() {
    if (!areTizenPluginsSupported()) return unsupportedTizenPluginResult();
    const service = serviceForPlatform();
    if (!service?.diagnostics)
      return Promise.resolve({ returnValue: false, detail: "Diagnostics unavailable" });
    try {
      const result = await service.diagnostics();
      emitPluginServiceDiagnostics(result);
      return result;
    } catch (error) {
      emitPluginDiagnosticEvent(
        "plugin service diagnostics request failed",
        { error: diagnosticError(error) },
        { prefix: "[Nuvio PluginService]", level: "error" }
      );
      throw error;
    }
  },

  cancel(requestId) {
    if (!areTizenPluginsSupported()) return Promise.resolve(false);
    const service = serviceForPlatform();
    if (!service || !requestId) return Promise.resolve(false);
    return service.cancel({ requestId: String(requestId) });
  },

  clearCache() {
    if (!areTizenPluginsSupported()) return Promise.resolve(false);
    const service = serviceForPlatform();
    return service ? service.clearCache() : Promise.resolve(false);
  },

  resetHealthCache() {
    cachedHealth = null;
    cachedHealthAt = 0;
    lastHealthDiagnostic = "";
  }
};
