import { Platform } from "../index.js";
import { TizenCapabilities } from "./tizenCapabilities.js";
import {
  getTizenServiceStartMethods,
  getWrtServiceClass,
  startWithWrtServiceClass
} from "./tizenWrtService.js";

const LOCAL_BASE_URLS = ["http://127.0.0.1:2711", "http://localhost:2711"];
const START_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 2500;
const SERVICE_START_CALL_TIMEOUT_MS = 4000;
const TIZEN_DEFAULT_OPERATION = "http://tizen.org/appcontrol/operation/default";
const PLUGIN_SERVICE_NAME = "nuvio-plugin-network";
const PLUGIN_PROTOCOL_VERSION = 1;
const STARTUP_DIAGNOSTIC_EVENTS = new Set([
  "ensure begin",
  "launcher attempts selected",
  "launcher attempt begin",
  "launcher acknowledged",
  "launcher attempt failed",
  "startup sequence failed",
  "application-control start call",
  "application launch call",
  "wrt startService call",
  "wrt Service.start call",
  "startService acknowledged",
  "startService failed",
  "health wait success",
  "health wait failed",
  "ensure failed",
  "service request begin",
  "service request success",
  "service request failed"
]);
const EXPECTED_STARTUP_EVENTS = new Set([
  "ensure existing service unavailable",
  "wrt service API unavailable",
  "launcher attempt failed"
]);
const lastStartupDiagnostic = new Map();
let startPromise = null;
// Last healthy probe. Probing /health before every plugin fetch doubled the
// connections to the service and, under load, timed out and relaunched it.
let cachedReachable = null;
let reachableBaseUrls = [];
let probePromise = null;
// Chromium opens at most 6 connections per host (127.0.0.1 and localhost count
// apart). Plugin fetches hold one for seconds, so cap them at 5 per host and
// leave one free for /health and /cancel, which otherwise queued and failed.
const FETCH_SLOTS_PER_BASE_URL = 5;
const activeFetches = new Map();
let fetchWaiters = [];

function leastBusyBaseUrl(fallback) {
  const urls = reachableBaseUrls.length ? reachableBaseUrls : [fallback];
  return urls.reduce((best, url) =>
    (activeFetches.get(url) || 0) < (activeFetches.get(best) || 0) ? url : best
  );
}

async function acquireFetchSlot(fallback, signal) {
  for (;;) {
    if (signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
    const baseUrl = leastBusyBaseUrl(fallback);
    const active = activeFetches.get(baseUrl) || 0;
    if (active < FETCH_SLOTS_PER_BASE_URL) {
      activeFetches.set(baseUrl, active + 1);
      return baseUrl;
    }
    await new Promise((resolve) => {
      fetchWaiters.push(resolve);
      signal?.addEventListener?.("abort", resolve, { once: true });
    });
  }
}

function releaseFetchSlot(baseUrl) {
  activeFetches.set(baseUrl, Math.max(0, (activeFetches.get(baseUrl) || 0) - 1));
  const waiters = fetchWaiters;
  fetchWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function diagnosticError(error) {
  const details = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error")
  };
  if (error?.code) details.code = String(error.code);
  if (error?.stack) details.stack = String(error.stack).slice(0, 1600);
  return details;
}

function diagnostic(event, details) {
  if (!Platform.isTizen()) return;
  try {
    const eventName = String(event || "").toLowerCase();
    const isFailure =
      /failed|error|threw|unavailable|incompatible|timeout|invalid|exception|fatal|crash/.test(
        eventName
      );
    const isWarning = /warn|warning|rejected|unsupported|degraded|stopped/.test(eventName);
    if (!STARTUP_DIAGNOSTIC_EVENTS.has(event) && !isFailure && !isWarning) return;
    let serializedDetails = "{}";
    try {
      serializedDetails = JSON.stringify(details || {});
    } catch (_) {
      serializedDetails = '{"serialization":"failed"}';
    }
    if (lastStartupDiagnostic.get(event) === serializedDetails) return;
    lastStartupDiagnostic.set(event, serializedDetails);
    // A miss in the fallback chain is expected: only the final startup
    // failure should reach the Console as an error.
    const logger =
      isFailure && !EXPECTED_STARTUP_EVENTS.has(event)
        ? console.error
        : isWarning
          ? console.warn
          : console.log;
    if (typeof logger !== "function") return;
    logger.call(console, `[Nuvio Tizen PluginService] ${event} ${serializedDetails}`);
  } catch (_) {
    // Diagnostics must never affect service startup or health probing.
  }
}

function resultSummary(value) {
  if (value === undefined) return { resultType: "undefined" };
  if (value === null) return { resultType: "null" };
  if (typeof value !== "object") return { resultType: typeof value };
  let keys = [];
  try {
    keys = Object.keys(value).slice(0, 16);
  } catch (_) {
    keys = [];
  }
  return { resultType: "object", resultKeys: keys };
}

function diagnosticUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    // Query strings can contain credentials or plugin configuration.
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, 768);
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].slice(0, 768);
  }
}

function serviceRequestDetails(method, baseUrl, timeoutMs, payload, hasSignal) {
  return {
    method,
    baseUrl,
    timeoutMs,
    hasSignal: Boolean(hasSignal),
    requestId: String(payload?.requestId || "").slice(0, 128),
    url: diagnosticUrl(payload?.url)
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getServiceId() {
  const configured = String(globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ || "").trim();
  if (configured) {
    return configured;
  }
  try {
    const appInfo = globalThis.tizen?.application?.getCurrentApplication?.()?.appInfo;
    const packageId = String(appInfo?.packageId || "").trim();

    if (packageId) {
      return `${packageId}.PluginService`;
    }

    const appId = String(appInfo?.id || "").trim();
    return appId ? `${appId}.PluginService` : "";
  } catch (_) {
    return "";
  }
}

function callbackCall(fn, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const success = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const failure = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const result = fn(...args, success, failure);
      if (!settled && result !== undefined) success(result);
    } catch (error) {
      failure(error);
    }
  });
}

async function startWithApplicationControl(serviceId) {
  const application = globalThis.tizen?.application;
  const ApplicationControl = globalThis.tizen?.ApplicationControl;
  if (typeof application?.launchAppControl !== "function") {
    diagnostic("application-control API unavailable", {
      serviceId,
      launchAppControl: typeof application?.launchAppControl,
      applicationControl: typeof ApplicationControl
    });
    throw new Error("Tizen application control API unavailable");
  }
  if (typeof ApplicationControl !== "function") {
    diagnostic("application-control constructor unavailable", { serviceId });
    throw new Error("Tizen ApplicationControl API unavailable");
  }
  diagnostic("application-control start call", {
    serviceId,
    operation: TIZEN_DEFAULT_OPERATION
  });
  const control = new ApplicationControl(TIZEN_DEFAULT_OPERATION);
  return callbackCall(application.launchAppControl.bind(application), [control, serviceId]);
}

async function startWithApplication(serviceId) {
  const application = globalThis.tizen?.application;
  if (typeof application?.launch !== "function") {
    diagnostic("application launch API unavailable", {
      serviceId,
      launch: typeof application?.launch
    });
    throw new Error("Tizen application launch API unavailable");
  }
  diagnostic("application launch call", { serviceId });
  return callbackCall(application.launch.bind(application), [serviceId]);
}

async function startWithWrtService(serviceId) {
  const service = globalThis.__NUVIO_TIZEN_WRT_SERVICE__;
  if (!service || typeof service.startService !== "function") {
    const Service = getWrtServiceClass(service);
    if (Service) {
      diagnostic("wrt Service.start call", { serviceId });
      return startWithWrtServiceClass(Service, serviceId);
    }
    diagnostic("wrt service API unavailable", { serviceId });
    throw new Error("Tizen wrt:service startService API unavailable");
  }
  diagnostic("wrt startService call", { serviceId });
  return service.startService.call(service, serviceId);
}

function getStartAttempts(
  serviceId,
  webServiceSupported,
  tizenMajorVersion = 0,
  tizenMinorVersion = 0
) {
  const starters = {
    "wrt-service": () => startWithWrtService(serviceId),
    "tizen-application-control-default": () => startWithApplicationControl(serviceId),
    "tizen-application-launch": () => startWithApplication(serviceId)
  };
  // The same order as EngineFS: the health probe after each attempt decides,
  // so an acknowledged call that did not start the service falls through.
  const attempts = getTizenServiceStartMethods({
    webServiceSupported,
    tizenMajorVersion,
    tizenMinorVersion,
    hasServiceClass: Boolean(getWrtServiceClass())
  }).map((method) => ({ method, start: starters[method] }));
  diagnostic("launcher attempts selected", {
    serviceId,
    webServiceSupported,
    methods: attempts.map((attempt) => attempt.method)
  });
  return attempts;
}

async function requestServiceStart(
  serviceId,
  webServiceSupported = null,
  tizenMajorVersion = 0,
  tizenMinorVersion = 0
) {
  const errors = [];
  const attempts = getStartAttempts(
    serviceId,
    webServiceSupported,
    tizenMajorVersion,
    tizenMinorVersion
  );
  diagnostic("startup sequence begin", {
    serviceId,
    webServiceSupported,
    methods: attempts.map((attempt) => attempt.method)
  });

  for (const attempt of attempts) {
    diagnostic("launcher attempt begin", { serviceId, method: attempt.method });
    try {
      const startResult = await withTimeout(
        attempt.start(),
        SERVICE_START_CALL_TIMEOUT_MS,
        `${attempt.method} service start call timed out`
      );
      diagnostic("launcher acknowledged", {
        serviceId,
        method: attempt.method,
        ...resultSummary(startResult)
      });
      const reachable = await waitForBaseUrl(START_TIMEOUT_MS);
      return { method: attempt.method, reachable };
    } catch (error) {
      const message = `${serviceId} ${attempt.method} start failed: ${String(
        error?.message || error
      )}`;
      errors.push(message);
      diagnostic("launcher attempt failed", {
        serviceId,
        method: attempt.method,
        error: diagnosticError(error)
      });
    }
  }

  diagnostic("startup sequence failed", { serviceId, errors });
  throw new Error(errors.join("; ") || `${serviceId} service start failed`);
}

function createAbortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

// Tizen 5.0 runs Chromium 63, which has no AbortController, so a stalled local
// service request could never be cancelled. The guard below rejects on timeout
// or caller abort regardless, and covers the response body read as well.
async function requestPluginService(url, fetchOptions, timeoutMs, signal = null) {
  if (signal?.aborted) throw createAbortError();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let rejectAborted = null;
  const aborted = new Promise((_, reject) => (rejectAborted = reject));
  const abort = () => {
    controller?.abort();
    rejectAborted(createAbortError());
  };
  signal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const request = (async () => {
    const response = await fetch(url, { ...fetchOptions, signal: controller?.signal });
    return { response, payload: await response.json().catch(() => ({})) };
  })();
  // Without AbortController the abandoned request keeps running: its late
  // rejection must not surface as an unhandled rejection.
  request.catch(() => {});
  try {
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
}

async function requestJson(url, options = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const { response, payload } = await requestPluginService(
    url,
    { ...options, cache: "no-store" },
    timeoutMs
  );
  if (!response.ok) throw new Error(`Tizen plugin service HTTP ${response.status}`);
  return payload;
}

async function probe(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  const payload = await requestJson(`${baseUrl}/health`, {}, timeoutMs);
  if (
    payload?.returnValue !== true ||
    payload?.service !== PLUGIN_SERVICE_NAME ||
    Number(payload?.protocolVersion || 0) !== PLUGIN_PROTOCOL_VERSION
  ) {
    throw new Error("Tizen plugin service health is incompatible");
  }
  return { baseUrl, payload };
}

async function findBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
  const results = await Promise.all(
    LOCAL_BASE_URLS.map(async (baseUrl) => {
      try {
        return { baseUrl, result: await probe(baseUrl, timeoutMs) };
      } catch (error) {
        return { baseUrl, error };
      }
    })
  );
  diagnostic("health probe round", {
    timeoutMs,
    probes: results.map((entry) => ({
      baseUrl: entry.baseUrl,
      status: entry.result ? "reachable" : "failed",
      error: entry.error ? String(entry.error?.message || entry.error) : ""
    }))
  });
  const reachable = results.find((entry) => entry.result);
  if (reachable) {
    cachedReachable = reachable.result;
    reachableBaseUrls = results.filter((entry) => entry.result).map((entry) => entry.baseUrl);
    return reachable.result;
  }

  const details = results
    .map((entry) => `${entry.baseUrl}: ${String(entry.error?.message || entry.error || "failed")}`)
    .join("; ");
  throw new Error(details || "No Tizen plugin service responded");
}

async function waitForBaseUrl(timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  diagnostic("health wait begin", { timeoutMs });
  while (Date.now() - startedAt < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    try {
      const reachable = await findBaseUrl(Math.min(1200, remaining));
      diagnostic("health wait success", {
        elapsedMs: Date.now() - startedAt,
        baseUrl: reachable.baseUrl
      });
      return reachable;
    } catch (error) {
      lastError = error;
      const delay = Math.min(350, timeoutMs - (Date.now() - startedAt));
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  diagnostic("health wait failed", {
    elapsedMs: Date.now() - startedAt,
    error: diagnosticError(lastError || new Error("health wait timeout"))
  });
  throw lastError || new Error("Timed out waiting for the Tizen plugin service");
}

export const TizenPluginService = {
  // The lifecycle watchdog must be able to verify an already-running service
  // without launching it on a single transient probe failure. Startup remains
  // the responsibility of ensureStarted(), used by the bootstrap barrier and
  // by the confirmed recovery path.
  async probe() {
    if (!TizenCapabilities.canUsePlugins()) {
      return {
        returnValue: false,
        status: "unsupported",
        detail: "Tizen plugin support starts at Tizen 5.0"
      };
    }
    const reachable = await findBaseUrl();
    return {
      returnValue: true,
      status: "success",
      ...reachable,
      ...(reachable.payload || {})
    };
  },

  async ensureStarted() {
    if (!Platform.isTizen()) {
      diagnostic("ensure skipped", { reason: "not running on Tizen" });
      return { status: "unsupported", detail: "Not running on Tizen" };
    }
    if (globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ === false) {
      diagnostic("ensure skipped", { reason: "plugin service not packaged" });
      return { status: "unsupported", detail: "Plugin service is not packaged" };
    }
    const capabilities = TizenCapabilities.get();
    if (!capabilities.tizenPluginVersionSupported) {
      diagnostic("ensure skipped", {
        reason: "Tizen plugin support starts at Tizen 5.0",
        tizenVersion: capabilities.tizenVersion || "",
        tizenMajorVersion: capabilities.tizenMajorVersion || 0
      });
      return { status: "unsupported", detail: "Tizen plugin support starts at Tizen 5.0" };
    }
    if (cachedReachable) return { status: "success", ...cachedReachable, started: false };
    const serviceId = getServiceId();
    diagnostic("ensure begin", {
      serviceId,
      localBaseUrls: LOCAL_BASE_URLS,
      capabilities: {
        isTizen: capabilities.isTizen,
        tizenVersion: capabilities.tizenVersion || "",
        tizenMajorVersion: capabilities.tizenMajorVersion || 0,
        chromiumMajorVersion: capabilities.chromiumMajorVersion || 0,
        hasWebAssembly: capabilities.hasWebAssembly,
        webServiceSupported: capabilities.webServiceSupported,
        engineFsServicePackaged: capabilities.engineFsServicePackaged,
        pluginServicePackaged: globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ !== false
      }
    });
    if (!capabilities.isTizen || !capabilities.hasWebAssembly) {
      diagnostic("ensure skipped", {
        reason: "Tizen WebAssembly unavailable",
        isTizen: capabilities.isTizen,
        hasWebAssembly: capabilities.hasWebAssembly
      });
      return { status: "unsupported", detail: "Tizen WebAssembly is unavailable" };
    }
    try {
      // Concurrent first requests share one probe.
      if (!probePromise) probePromise = findBaseUrl().finally(() => (probePromise = null));
      const reachable = await probePromise;
      diagnostic("ensure found existing service", { baseUrl: reachable.baseUrl });
      return { status: "success", ...reachable, started: false };
    } catch (error) {
      // Start below.
      diagnostic("ensure existing service unavailable", { error: diagnosticError(error) });
    }
    if (!startPromise) {
      startPromise = (async () => {
        diagnostic("explicit startup requested", { serviceId });
        try {
          if (!serviceId) {
            throw new Error("Tizen plugin service id is unavailable");
          }
          const startResult = await requestServiceStart(
            serviceId,
            capabilities.webServiceSupported,
            capabilities.tizenMajorVersion || 0,
            capabilities.tizenMinorVersion || 0
          );
          const reachable = startResult.reachable;
          diagnostic("explicit startup success", {
            serviceId,
            method: startResult.method,
            baseUrl: reachable.baseUrl
          });
          return {
            ...reachable,
            serviceId,
            method: startResult.method,
            startMethod: startResult.method
          };
        } catch (error) {
          diagnostic("explicit startup failed", { error: diagnosticError(error) });
          throw new Error(`${serviceId}: ${String(error?.message || error)}`);
        }
      })().finally(() => {
        startPromise = null;
      });
    }
    try {
      const result = await startPromise;
      diagnostic("ensure success", {
        serviceId: result.serviceId,
        method: result.method,
        baseUrl: result.baseUrl,
        started: true
      });
      return { status: "success", ...result, started: true };
    } catch (error) {
      const detail = String(error?.message || error);
      const runtime =
        `tizen=${capabilities.tizenVersion || "unknown"}, ` +
        `chromium=${capabilities.chromiumMajorVersion || "unknown"}, ` +
        `web.service=${String(capabilities.webServiceSupported ?? "unknown")}`;
      const diagnosticDetail = `${detail} [${runtime}]`;
      diagnostic("ensure failed", { error: diagnosticError(error), runtime });
      return { status: "error", detail: diagnosticDetail };
    }
  },

  async health() {
    diagnostic("health API requested", {});
    cachedReachable = null; // an explicit health check always probes the service
    const started = await this.ensureStarted();
    if (started.status !== "success") {
      diagnostic("health API unavailable", { detail: started.detail || "" });
      return { returnValue: false, ...started };
    }
    const result = { returnValue: true, ...started, ...(started.payload || {}) };
    diagnostic("health API result", {
      baseUrl: started.baseUrl,
      returnValue: result.returnValue,
      service: result.service,
      protocolVersion: result.protocolVersion
    });
    return result;
  },

  async capabilities() {
    diagnostic("capabilities API requested", {});
    const started = await this.ensureStarted();
    if (started.status !== "success") {
      diagnostic("capabilities API unavailable", { detail: started.detail || "" });
      return { returnValue: false, ...started };
    }
    return requestJson(`${started.baseUrl}/capabilities`, {}, PROBE_TIMEOUT_MS);
  },

  async diagnostics() {
    diagnostic("diagnostics API requested", {});
    const started = await this.ensureStarted();
    if (started.status !== "success") {
      diagnostic("diagnostics API unavailable", { detail: started.detail || "" });
      return { returnValue: false, ...started };
    }
    return requestJson(`${started.baseUrl}/diagnostics`, {}, PROBE_TIMEOUT_MS);
  },

  async request(method, payload = {}, { timeoutMs = 30000, signal } = {}) {
    const started = await this.ensureStarted();
    if (started.status !== "success")
      throw new Error(started.detail || "Tizen plugin service unavailable");
    const holdsSlot = method === "fetch";
    // A fetch whose scraper was aborted while waiting must not take a slot.
    const baseUrl = holdsSlot
      ? await acquireFetchSlot(started.baseUrl, signal)
      : leastBusyBaseUrl(started.baseUrl);
    const requestDetails = serviceRequestDetails(method, baseUrl, timeoutMs, payload, signal);
    diagnostic("service request begin", requestDetails);
    try {
      const { response, payload: result } = await requestPluginService(
        `${baseUrl}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store"
        },
        timeoutMs,
        signal
      );
      if (!response.ok || result.returnValue === false)
        throw new Error(result.errorText || `Tizen plugin service HTTP ${response.status}`);
      diagnostic("service request success", {
        ...requestDetails,
        httpStatus: response.status,
        returnValue: result.returnValue
      });
      return result;
    } catch (error) {
      // Connection refused: the service died, so the next request probes and restarts it.
      if (error?.name === "TypeError" && !signal?.aborted) {
        cachedReachable = null;
        reachableBaseUrls = [];
      }
      diagnostic("service request failed", {
        ...requestDetails,
        error: diagnosticError(error)
      });
      throw error;
    } finally {
      if (holdsSlot) releaseFetchSlot(baseUrl);
    }
  },

  fetch(payload, options) {
    return this.request("fetch", payload, options);
  },

  cancel(payload) {
    return this.request("cancel", payload, { timeoutMs: 2000 }).catch(() => false);
  },

  clearCache() {
    return this.request("cache/clear", {}, { timeoutMs: 5000 });
  }
};
