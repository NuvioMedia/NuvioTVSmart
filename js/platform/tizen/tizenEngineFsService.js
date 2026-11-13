import { Platform } from "../index.js";
import { TizenCapabilities } from "./tizenCapabilities.js";
import { getWrtServiceClass, startWithWrtServiceClass } from "./tizenWrtService.js";

const LOCAL_BASE_URLS = ["http://127.0.0.1:2710", "http://localhost:2710"];

const START_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 2500;
const SERVICE_START_CALL_TIMEOUT_MS = 4000;
const TIZEN_DEFAULT_OPERATION = "http://tizen.org/appcontrol/operation/default";
// Subtitle extraction is optional and falls back to native AVPlay when the
// service cannot start, so it may attempt the legacy path on TVs that report
// web.service=false. Generic callers keep the capability gate.
const PURPOSES_ALLOWING_LEGACY_SERVICE = new Set(["p2p", "playback-proxy", "subtitle"]);

let startPromise = null;

function diagnosticError(error) {
  const details = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error")
  };
  if (error?.code) details.code = String(error.code);
  if (error?.stack) details.stack = String(error.stack).slice(0, 1600);
  return details;
}

function diagnostic() {
  // Diagnostic console output is intentionally disabled in normal builds.
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function getServiceId() {
  const configured = String(globalThis.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ || "").trim();
  if (configured) {
    return configured;
  }
  try {
    const appInfo = globalThis.tizen?.application?.getCurrentApplication?.()?.appInfo;
    const packageId = String(appInfo?.packageId || "").trim();

    if (packageId) {
      return `${packageId}.EngineFsService`;
    }

    const appId = String(appInfo?.id || "").trim();
    return appId ? `${appId}.EngineFsService` : "";
  } catch (_) {
    return "";
  }
}

function invokeCallbackApi(fn, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onSuccess = (value) => {
      settled = true;
      resolve(value);
    };
    const onFailure = (error) => {
      settled = true;
      reject(error);
    };
    try {
      const result = fn(...args, onSuccess, onFailure);
      if (!settled && typeof result !== "undefined") {
        resolve(result);
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function startViaApplicationControl(serviceId, operation = TIZEN_DEFAULT_OPERATION) {
  const application = globalThis.tizen?.application;
  const ApplicationControl = globalThis.tizen?.ApplicationControl;
  if (!application || typeof application.launchAppControl !== "function") {
    diagnostic("application-control API unavailable", {
      serviceId,
      launchAppControl: typeof application?.launchAppControl,
      applicationControl: typeof ApplicationControl
    });
    throw new Error("tizen.application.launchAppControl unavailable");
  }
  if (typeof ApplicationControl !== "function") {
    diagnostic("application-control constructor unavailable", { serviceId });
    throw new Error("tizen.ApplicationControl unavailable");
  }

  diagnostic("application-control start call", { serviceId, operation });
  const appControl = new ApplicationControl(operation);
  return invokeCallbackApi(application.launchAppControl.bind(application), [appControl, serviceId]);
}

async function startViaWrtService(serviceId) {
  // The packaged index.html imports wrt:service in a module and exposes it
  // here; the runtime itself does not define a global wrt object. Accept both
  // the named namespace and a default export from the bridge.
  const wrtBridge = globalThis.__NUVIO_TIZEN_WRT_SERVICE__;
  const wrtService =
    (wrtBridge && typeof wrtBridge.startService === "function" ? wrtBridge : wrtBridge?.default) ||
    globalThis.wrt?.service ||
    globalThis.webapis?.wrt?.service ||
    globalThis.webapis?.service;
  if (!wrtService) {
    const Service = getWrtServiceClass(wrtBridge);
    if (Service) {
      diagnostic("wrt Service.start call", { serviceId });
      return startWithWrtServiceClass(Service, serviceId);
    }
    diagnostic("wrt service API unavailable", { serviceId });
    throw new Error("wrt service API unavailable");
  }
  if (typeof wrtService.startService === "function") {
    try {
      diagnostic("wrt startService call", { serviceId, argumentType: "string" });
      return await invokeCallbackApi(wrtService.startService.bind(wrtService), [serviceId]);
    } catch (firstError) {
      diagnostic("wrt startService string variant failed", {
        serviceId,
        error: diagnosticError(firstError),
        retryArgumentType: "object"
      });
      return invokeCallbackApi(wrtService.startService.bind(wrtService), [{ id: serviceId }]).catch(
        () => {
          throw firstError;
        }
      );
    }
  }
  if (typeof wrtService.start === "function") {
    diagnostic("wrt start alias call", { serviceId });
    return invokeCallbackApi(wrtService.start.bind(wrtService), [serviceId]);
  }
  diagnostic("wrt service start API unavailable", { serviceId });
  throw new Error("wrt service start API unavailable");
}

async function startViaTizenApplication(serviceId) {
  const application = globalThis.tizen?.application;
  if (!application || typeof application.launch !== "function") {
    diagnostic("application launch API unavailable", {
      serviceId,
      launch: typeof application?.launch
    });
    throw new Error("tizen.application.launch unavailable");
  }
  diagnostic("application launch call", { serviceId });
  return invokeCallbackApi(application.launch.bind(application), [serviceId]);
}

async function requestServiceStart(serviceId) {
  const errors = [];
  // Tizen 9/10 accept launch calls for a service id without starting it; only
  // the wrt:service Service class starts it there.
  const legacyServiceFirst =
    TizenCapabilities.get().webServiceSupported === false || Boolean(getWrtServiceClass());
  const officialAttempts = [
    {
      method: "tizen-application-control-default",
      start: () => startViaApplicationControl(serviceId, TIZEN_DEFAULT_OPERATION)
    },
    {
      method: "tizen-application-launch",
      start: () => startViaTizenApplication(serviceId)
    },
    {
      method: "wrt-service-legacy",
      start: () => startViaWrtService(serviceId)
    }
  ];
  // Samsung warns that application-control launches can disturb the
  // foreground app when web.service is reported as unavailable. Preserve the
  // legacy path that worked on older firmware first and only use the official
  // application-control path when the capability is true or unknown.
  const attempts = legacyServiceFirst
    ? officialAttempts.slice(2).concat(officialAttempts.slice(1, 2))
    : officialAttempts;
  diagnostic("launcher attempts selected", {
    serviceId,
    webServiceSupported: TizenCapabilities.get().webServiceSupported,
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
        resultType: startResult === undefined ? "undefined" : typeof startResult
      });
      return { method: attempt.method };
    } catch (error) {
      diagnostic("launcher attempt failed", {
        serviceId,
        method: attempt.method,
        error: diagnosticError(error)
      });
      errors.push(`${attempt.method}: ${error?.message || error}`);
    }
  }
  diagnostic("launcher sequence failed", { serviceId, errors });
  throw new Error(errors.join("; "));
}

async function probeBaseUrl(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  const response = await withTimeout(
    fetch(`${baseUrl}/settings`, {
      method: "GET",
      cache: "no-cache"
    }),
    timeoutMs,
    `Tizen local EngineFS settings probe timed out for ${baseUrl}`
  );
  if (!response.ok) {
    throw new Error(`Tizen local EngineFS settings failed with HTTP ${response.status}`);
  }
  let json = null;
  try {
    json = await response.clone().json();
  } catch (_) {
    json = null;
  }
  return { baseUrl, settings: json };
}

async function findReachableLocalBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
  let lastError = null;
  const probes = [];
  for (const baseUrl of LOCAL_BASE_URLS) {
    try {
      const result = await probeBaseUrl(baseUrl, timeoutMs);
      probes.push({ baseUrl, status: "reachable" });
      diagnostic("settings probe round", { timeoutMs, probes });
      return result;
    } catch (error) {
      lastError = error;
      probes.push({
        baseUrl,
        status: "failed",
        error: String(error?.message || error)
      });
    }
  }
  diagnostic("settings probe round", { timeoutMs, probes });
  throw lastError || new Error("No local Tizen EngineFS base URL responded");
}

async function waitForLocalBaseUrl(timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  diagnostic("settings wait begin", { timeoutMs });
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const reachable = await findReachableLocalBaseUrl(1200);
      diagnostic("settings wait success", {
        elapsedMs: Date.now() - startedAt,
        baseUrl: reachable.baseUrl
      });
      return reachable;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }
  diagnostic("settings wait failed", {
    elapsedMs: Date.now() - startedAt,
    error: diagnosticError(lastError || new Error("settings wait timeout"))
  });
  throw lastError || new Error("Timed out waiting for local Tizen EngineFS service");
}

export const TizenEngineFsService = {
  getLocalBaseUrls() {
    return [...LOCAL_BASE_URLS];
  },

  async probeBaseUrl(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
    return probeBaseUrl(baseUrl, timeoutMs);
  },

  async findReachableLocalBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
    return findReachableLocalBaseUrl(timeoutMs);
  },

  async ensureStarted({ purpose = "generic" } = {}) {
    if (!Platform.isTizen()) {
      diagnostic("ensure skipped", { reason: "not running on Tizen", purpose });
      return { status: "unsupported", detail: "Not running on Tizen" };
    }
    const capabilities = TizenCapabilities.get();
    diagnostic("ensure begin", {
      purpose,
      serviceId: getServiceId(),
      localBaseUrls: LOCAL_BASE_URLS,
      capabilities: {
        isTizen: capabilities.isTizen,
        tizenVersion: capabilities.tizenVersion || "",
        tizenMajorVersion: capabilities.tizenMajorVersion || 0,
        chromiumMajorVersion: capabilities.chromiumMajorVersion || 0,
        webServiceSupported: capabilities.webServiceSupported,
        engineFsServicePackaged: capabilities.engineFsServicePackaged,
        supportsP2p: capabilities.supportsP2p
      }
    });
    // Samsung firmware may report web.service=false even when a packaged
    // EngineFS service can still be started through the legacy service API.
    // Only callers with an explicit local-service contract may use that path;
    // generic and subtitle callers retain the capability gate.
    if (
      !capabilities.engineFsServicePackaged ||
      (!PURPOSES_ALLOWING_LEGACY_SERVICE.has(purpose) && !capabilities.supportsWebService)
    ) {
      diagnostic("ensure skipped", {
        reason: !capabilities.engineFsServicePackaged
          ? "Tizen EngineFS service is not packaged"
          : "Tizen web service support is unavailable on this TV",
        purpose
      });
      return {
        status: "unsupported",
        detail: !capabilities.engineFsServicePackaged
          ? "Tizen EngineFS service is not packaged"
          : "Tizen web service support is unavailable on this TV"
      };
    }
    if (purpose === "p2p" && !capabilities.supportsP2p) {
      diagnostic("ensure skipped", { reason: "P2P unsupported", purpose });
      return {
        status: "unsupported",
        detail: "Tizen P2P streaming is not supported on this TV"
      };
    }
    try {
      const existing = await findReachableLocalBaseUrl();
      diagnostic("ensure found existing service", {
        purpose,
        baseUrl: existing.baseUrl,
        started: false
      });
      return { status: "success", ...existing, started: false };
    } catch (error) {
      // Continue with explicit service startup.
      diagnostic("ensure existing service unavailable", {
        purpose,
        error: diagnosticError(error)
      });
    }

    if (!startPromise) {
      startPromise = (async () => {
        const serviceId = getServiceId();
        if (!serviceId) {
          throw new Error("Tizen EngineFS service id is unavailable");
        }
        diagnostic("service start requested", { serviceId });
        const startResult = await requestServiceStart(serviceId);
        diagnostic("explicit startup acknowledged", {
          purpose,
          serviceId,
          method: startResult.method
        });
        const reachable = await waitForLocalBaseUrl();
        diagnostic("explicit startup health success", {
          purpose,
          serviceId,
          method: startResult.method,
          baseUrl: reachable.baseUrl
        });
        return {
          ...reachable,
          serviceId,
          startMethod: startResult.method
        };
      })().finally(() => {
        startPromise = null;
      });
    }

    try {
      const result = await startPromise;
      diagnostic("ensure success", {
        purpose,
        serviceId: result.serviceId,
        method: result.startMethod,
        baseUrl: result.baseUrl,
        started: true
      });
      return { status: "success", ...result, started: true };
    } catch (error) {
      diagnostic("ensure failed", { purpose, error: diagnosticError(error) });
      return {
        status: "error",
        detail: error?.message || String(error || "Tizen EngineFS service startup failed")
      };
    }
  }
};
