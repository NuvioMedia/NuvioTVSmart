import { TMDB_API_KEY } from "../../config.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";
import { PLUGIN_QUOTAS } from "./pluginPolicy.js";
import { createPluginResourceGovernor, QUICKJS_BASE_WASM_BYTES } from "./pluginResourceGovernor.js";
import { getDeviceMemoryGb } from "../../platform/tvPerformancePolicy.js";
import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";
import { PluginStore } from "../../data/local/pluginStore.js";
import {
  diagnosticError,
  emitPluginDiagnostic,
  emitPluginDiagnosticEvent
} from "../diagnostics/pluginDiagnostics.js";

const activeWorkers = new Set();
const activeCancellers = new Map();
let runtimeTestPromise = null;

// Warm workers are reused: each provider still gets its own QuickJS runtime,
// but the QuickJS script and WASM are not loaded and compiled again.
const idleWorkers = [];
const IDLE_WORKER_TTL_MS = 30000;
// WASM memory never shrinks, so a worker a heavy provider grew is dropped.
const RECYCLE_WASM_BYTES = 2 * QUICKJS_BASE_WASM_BYTES;
let governor = null;

function resourceGovernor() {
  if (!governor) {
    let storage = null;
    try {
      storage = globalThis.localStorage || null;
    } catch (_) {}
    governor = createPluginResourceGovernor({
      deviceMemoryGb: getDeviceMemoryGb(),
      constrained: getTvRuntimePerformanceProfile().isPerformanceConstrained === true,
      storage,
      readMainHeap: () => globalThis.performance?.memory || null
    });
  }
  return governor;
}

function terminateWorker(worker) {
  try {
    worker.terminate();
  } catch (_) {}
}

function acquireWorker() {
  const idle = idleWorkers.pop();
  if (idle) {
    clearTimeout(idle.timer);
    return idle.worker;
  }
  return new Worker(workerUrl());
}

function releaseWorker(worker, wasmBytes) {
  worker.onmessage = null;
  worker.onerror = null;
  const keep = resourceGovernor().allowedConcurrency(PLUGIN_QUOTAS.modern.maxConcurrent);
  if (!(wasmBytes > 0) || wasmBytes > RECYCLE_WASM_BYTES || idleWorkers.length >= keep) {
    terminateWorker(worker);
    return;
  }
  const entry = { worker, timer: 0 };
  entry.timer = setTimeout(() => {
    const index = idleWorkers.indexOf(entry);
    if (index >= 0) idleWorkers.splice(index, 1);
    terminateWorker(worker);
  }, IDLE_WORKER_TTL_MS);
  idleWorkers.push(entry);
}

function terminateIdleWorkers() {
  idleWorkers.splice(0).forEach((entry) => {
    clearTimeout(entry.timer);
    terminateWorker(entry.worker);
  });
}

function workerUrl() {
  if (globalThis.__NUVIO_PLUGIN_WORKER_URL__) {
    return String(globalThis.__NUVIO_PLUGIN_WORKER_URL__);
  }
  try {
    return new URL("assets/runtime/plugin-worker.js", document.baseURI || location.href).toString();
  } catch (_) {
    return "assets/runtime/plugin-worker.js";
  }
}

// Exports f(i64). Until wasm BigInt integration (Chrome 85) a JS <-> WASM call
// with an i64 throws, and the stock QuickJS WASM passes time_t to localtime that
// way, breaking local Date methods. Those engines (Tizen 5.0-6.0, webOS 5/6)
// get the lowered MVP build, whose i64 imports take f64. The page loads it
// because Tizen 5.0 workers cannot read file:// (webOS 5 ones can).
const I64_EXPORT_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 1, 126, 0, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 4, 1,
  2, 0, 11
]);

let wasmBigIntSupported = null;

function supportsWasmBigInt() {
  if (wasmBigIntSupported !== null) return wasmBigIntSupported;
  try {
    // Without BigInt (Chrome < 67) this throws a ReferenceError: also "no".
    new WebAssembly.Instance(new WebAssembly.Module(I64_EXPORT_PROBE)).exports.f(BigInt(0));
    wasmBigIntSupported = true;
  } catch (_) {
    wasmBigIntSupported = false;
  }
  return wasmBigIntSupported;
}

let quickJSMvpBytesPromise = null;
// A worker keeps the module it compiled, so it receives the ~500 KB once.
const workersWithQuickJSWasm = new WeakSet();

function loadQuickJSMvpBytes() {
  if (typeof WebAssembly !== "object" || supportsWasmBigInt()) return Promise.resolve(null);
  if (!quickJSMvpBytesPromise) {
    // XHR, not fetch: packaged webOS apps run from file://, which fetch rejects.
    quickJSMvpBytesPromise = new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", new URL("../libs/quickjs-mvp.wasm", workerUrl()).toString());
      xhr.responseType = "arraybuffer";
      xhr.onload = () => {
        // status 0 is a successful file:// load
        if ((xhr.status === 0 || xhr.status === 200) && xhr.response?.byteLength) {
          resolve(xhr.response);
        } else reject(new Error(`QuickJS MVP WASM failed to load (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("QuickJS MVP WASM failed to load"));
      xhr.send();
    }).catch((error) => {
      quickJSMvpBytesPromise = null;
      throw error;
    });
  }
  return quickJSMvpBytesPromise;
}

function byteLength(value) {
  const input = String(value || "");
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(input).byteLength
    : unescape(encodeURIComponent(input)).length;
}

function defaultArgs({ tmdbId, mediaType, season = null, episode = null } = {}) {
  return {
    tmdbId: String(tmdbId || ""),
    mediaType: String(mediaType || ""),
    season: season == null ? null : Number(season),
    episode: episode == null ? null : Number(episode)
  };
}

export const PluginRuntime = {
  listSources() {
    return PluginStore.get().legacySources;
  },

  saveSources(sources) {
    const normalized = Array.isArray(sources) ? sources : [];
    const current = PluginStore.get();
    // Legacy URL-template sources are retained for migration/display only and
    // are not part of Android's remote `plugins` repository payload.
    const next = PluginStore.replace({
      ...current,
      legacySources: normalized,
      syncDirty: current.syncDirty
    });
    return JSON.stringify(current.legacySources) !== JSON.stringify(next.legacySources);
  },

  addSource(source) {
    const current = this.listSources();
    const url = String(source?.urlTemplate || source?.url || "").trim();
    if (!url || current.some((entry) => entry.urlTemplate === url)) return false;
    return this.saveSources([...current, { ...source, urlTemplate: url, enabled: false }]);
  },

  removeSource(sourceId) {
    return this.saveSources(this.listSources().filter((source) => source.id !== sourceId));
  },

  setSourceEnabled(sourceId, enabled) {
    return this.saveSources(
      this.listSources().map((source) =>
        source.id === sourceId ? { ...source, enabled: Boolean(enabled) } : source
      )
    );
  },

  // URL-template sources are retained for migration and display only. They
  // deliberately have no execution path on Web TV.
  execute() {
    return [];
  },

  async selfTest({ quota = PLUGIN_QUOTAS.limited } = {}) {
    if (typeof Worker !== "function") throw new Error("Worker API unavailable");
    if (typeof WebAssembly !== "object") throw new Error("WebAssembly API unavailable");
    if (!runtimeTestPromise) {
      runtimeTestPromise = this.executePlugin({
        code: "module.exports.getStreams = function(){ return []; };",
        filename: "runtime-self-test.js",
        scraperId: "runtime-self-test",
        args: { tmdbId: "", mediaType: "movie", season: null, episode: null },
        quota,
        skipService: true
      }).catch((error) => {
        runtimeTestPromise = null;
        throw error;
      });
    }
    return runtimeTestPromise;
  },

  async executePlugin({
    code,
    filename = "plugin.js",
    scraperId = "plugin",
    profileId = "",
    repositoryId = "",
    settings = {},
    args = {},
    quota = PLUGIN_QUOTAS.limited,
    timeoutMs = quota.providerTimeoutMs || 60000,
    skipService = false,
    signal = null
  } = {}) {
    const runtimeDetails = {
      filename: String(filename || "plugin.js").slice(0, 240),
      scraperId: String(scraperId || "").slice(0, 128),
      repositoryId: String(repositoryId || "").slice(0, 128),
      profileId: String(profileId || "").slice(0, 64)
    };
    if (byteLength(code) > Number(quota.maxCodeBytes || PLUGIN_QUOTAS.limited.maxCodeBytes)) {
      const error = new Error("Plugin code exceeds the platform quota");
      emitPluginDiagnosticEvent(
        "plugin code rejected",
        { ...runtimeDetails, error: diagnosticError(error) },
        { prefix: "[Nuvio PluginRuntime]" }
      );
      throw error;
    }
    if (!skipService) {
      try {
        await PluginServiceClient.ensureReady();
      } catch (error) {
        emitPluginDiagnosticEvent(
          "plugin service readiness failed",
          { ...runtimeDetails, error: diagnosticError(error) },
          { prefix: "[Nuvio PluginRuntime]" }
        );
        throw error;
      }
    }
    if (typeof Worker !== "function") {
      const error = new Error("Worker API unavailable");
      emitPluginDiagnosticEvent(
        "plugin worker unavailable",
        { ...runtimeDetails, error: diagnosticError(error) },
        { prefix: "[Nuvio PluginRuntime]" }
      );
      throw error;
    }

    // bytes, not a compiled Module: Chromium 63 cannot post a WebAssembly.Module
    const quickJSWasm = await loadQuickJSMvpBytes();
    let worker;
    try {
      worker = acquireWorker();
    } catch (error) {
      resourceGovernor().reportPressure();
      emitPluginDiagnosticEvent(
        "plugin worker creation failed",
        { ...runtimeDetails, error: diagnosticError(error) },
        { prefix: "[Nuvio PluginRuntime]" }
      );
      throw error;
    }
    activeWorkers.add(worker);
    resourceGovernor().workerStarted();
    const executionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingRequestIds = new Set();
    let timeoutId = 0;
    let settled = false;
    let abortListener = null;

    // wasmBytes > 0 only on a clean result: that worker can serve the next provider.
    const release = (wasmBytes = 0) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortListener) signal?.removeEventListener?.("abort", abortListener);
      pendingRequestIds.forEach((requestId) => void PluginServiceClient.cancel(requestId));
      pendingRequestIds.clear();
      activeWorkers.delete(worker);
      activeCancellers.delete(worker);
      resourceGovernor().workerEnded();
      if (wasmBytes > 0) releaseWorker(worker, wasmBytes);
      else terminateWorker(worker);
    };

    return new Promise((resolve, reject) => {
      const finish = (error, value, wasmBytes = 0) => {
        if (settled) return;
        settled = true;
        release(error ? 0 : wasmBytes);
        if (error) reject(error);
        else resolve(value);
      };
      activeCancellers.set(worker, () => finish(new Error("Plugin execution cancelled")));
      abortListener = () => finish(new Error("Plugin execution cancelled"));
      if (signal?.aborted) {
        finish(new Error("Plugin execution cancelled"));
        return;
      }
      signal?.addEventListener?.("abort", abortListener, { once: true });
      timeoutId = setTimeout(() => {
        const error = new Error("Plugin execution timed out");
        emitPluginDiagnosticEvent(
          "plugin execution timed out",
          { ...runtimeDetails, timeoutMs, error: diagnosticError(error) },
          { prefix: "[Nuvio PluginRuntime]" }
        );
        finish(error);
      }, timeoutMs);
      worker.onerror = (event) => {
        // An uncaught worker failure on a TV is almost always memory running out.
        resourceGovernor().reportPressure();
        const error = new Error(String(event?.message || "Plugin worker failed"));
        emitPluginDiagnosticEvent(
          "plugin worker failed",
          {
            ...runtimeDetails,
            filename: event?.filename || runtimeDetails.filename,
            lineNumber: event?.lineno || 0,
            columnNumber: event?.colno || 0,
            error: diagnosticError(error)
          },
          { prefix: "[Nuvio PluginRuntime]" }
        );
        finish(error);
      };
      worker.onmessage = (event) => {
        const message = event?.data || {};
        if (message.type === "pluginLog") {
          const level = message.level === "error" ? "error" : "warn";
          emitPluginDiagnostic(
            level,
            `provider ${level === "error" ? "error" : "warning"}`,
            {
              ...runtimeDetails,
              message: String(message.message || "").slice(0, 4000)
            },
            { prefix: "[Nuvio Plugin]" }
          );
          return;
        }
        if (message.type === "fetch") {
          const requestId = String(message.requestId || "");
          pendingRequestIds.add(requestId);
          PluginServiceClient.fetch({
            ...(message.payload || {}),
            requestId,
            executionId,
            profileId: String(profileId || ""),
            repositoryId: String(repositoryId || ""),
            scraperId: String(scraperId || ""),
            deadline: Date.now() + Number(quota.providerTimeoutMs || 30000),
            timeoutMs: Number(quota.providerTimeoutMs || 30000),
            maxBodyBytes: Number(quota.maxFetchBytes || 1024 * 1024),
            maxResponseBytes: Number(quota.maxFetchBytes || 1024 * 1024),
            // The Android runner resolves transport failures as status-0
            // response objects. Management requests keep their normal
            // throwing behavior because they are outside the plugin contract.
            androidResponseContract: true,
            signal
          })
            .then((payload) => {
              pendingRequestIds.delete(requestId);
              if (!settled) worker.postMessage({ type: "fetchResult", requestId, payload });
            })
            .catch((error) => {
              pendingRequestIds.delete(requestId);
              if (!settled)
                worker.postMessage({
                  type: "fetchResult",
                  requestId,
                  error: String(error?.message || error)
                });
            });
          return;
        }
        if (message.type === "cancel") {
          const requestId = String(message.requestId || "");
          if (requestId && pendingRequestIds.has(requestId)) {
            void PluginServiceClient.cancel(requestId);
          }
          return;
        }
        if (message.type === "result") {
          const wasmBytes = Number(message.wasmMemoryBytes) || 0;
          if (wasmBytes > 0) resourceGovernor().observeWorker(wasmBytes);
          finish(null, Array.isArray(message.results) ? message.results : [], wasmBytes);
          return;
        }
        if (message.type === "error") {
          const error = new Error(String(message.error || "Plugin execution failed"));
          emitPluginDiagnosticEvent(
            "plugin execution failed",
            { ...runtimeDetails, error: diagnosticError(error) },
            { prefix: "[Nuvio PluginRuntime]" }
          );
          finish(error);
        }
      };
      try {
        worker.postMessage({
          type: "execute",
          executionId,
          code: String(code || ""),
          filename,
          scraperId,
          settings: settings && typeof settings === "object" ? settings : {},
          profileId: String(profileId || ""),
          repositoryId: String(repositoryId || ""),
          tmdbApiKey: TMDB_API_KEY,
          quickJSWasm: workersWithQuickJSWasm.has(worker) ? null : quickJSWasm,
          args: defaultArgs(args),
          quota,
          timeoutMs,
          deadline: Date.now() + Number(timeoutMs || 60000)
        });
        if (quickJSWasm) workersWithQuickJSWasm.add(worker);
      } catch (error) {
        emitPluginDiagnosticEvent(
          "plugin worker message failed",
          { ...runtimeDetails, error: diagnosticError(error) },
          { prefix: "[Nuvio PluginRuntime]" }
        );
        finish(error);
      }
    });
  },

  cancelAll() {
    [...activeCancellers.values()].forEach((cancel) => {
      try {
        cancel();
      } catch (_) {}
    });
    activeWorkers.forEach((worker) => {
      try {
        worker.terminate();
      } catch (_) {}
    });
    activeCancellers.clear();
    activeWorkers.clear();
    terminateIdleWorkers();
    runtimeTestPromise = null;
  },

  /**
   * Release the warm workers but let running providers finish. Each idle one
   * parks a compiled QuickJS runtime, megabytes of WASM memory that never
   * shrinks, while playback is loading its own buffers.
   */
  dropIdleWorkers() {
    terminateIdleWorkers();
  },

  getActiveWorkerCount() {
    return activeWorkers.size;
  },

  // How many providers may run side by side now; never above the Android ceiling.
  allowedConcurrency(max) {
    return resourceGovernor().allowedConcurrency(max);
  }
};
