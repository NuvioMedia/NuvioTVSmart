// Decides how many plugin workers may run at once from what the TV can hold.
// It never touches results, timeouts or sizes (those follow Android); it only
// decides how many providers run side by side, the rest wait in the queue.

const MIB = 1024 * 1024;
// Measured: a fresh QuickJS instance starts with 16 MiB of WASM memory, grows
// with the provider and never shrinks.
export const QUICKJS_BASE_WASM_BYTES = 16 * MIB;
// Worker thread plus the QuickJS glue script each worker parses.
const WORKER_OVERHEAD_BYTES = 8 * MIB;
// shortcut: share of device RAM and the fallbacks below are starting points,
// the crash and heap signals correct them; retune once TVs report real usage.
const DEVICE_RAM_SHARE = 0.12;
const CONSTRAINED_BUDGET_BYTES = 96 * MIB;
const DEFAULT_BUDGET_BYTES = 240 * MIB;
const MIN_SCALE = 0.25;
const SCALE_RECOVERY_STEP = 0.05;
const MAIN_HEAP_PRESSURE_RATIO = 0.8;
const STORAGE_KEY = "nuvio.pluginRuntime.resources";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readState(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeState(storage, state) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

export function createPluginResourceGovernor({
  deviceMemoryGb = 0,
  constrained = false,
  storage = null,
  readMainHeap = () => null
} = {}) {
  const budgetBytes =
    deviceMemoryGb > 0
      ? deviceMemoryGb * 1024 * MIB * DEVICE_RAM_SHARE
      : constrained
        ? CONSTRAINED_BUDGET_BYTES
        : DEFAULT_BUDGET_BYTES;
  const saved = readState(storage);
  let scale = clamp(Number(saved.scale) || 1, MIN_SCALE, 1);
  // The app died while providers were running last time: assume memory ran out.
  if (saved.running) scale = Math.max(MIN_SCALE, scale / 2);
  let workerWasmBytes = QUICKJS_BASE_WASM_BYTES;
  let running = 0;
  writeState(storage, { scale, running: false });

  function mainHeapUnderPressure() {
    const heap = readMainHeap();
    const used = Number(heap?.usedJSHeapSize || 0);
    const limit = Number(heap?.jsHeapSizeLimit || 0);
    return limit > 0 && used / limit > MAIN_HEAP_PRESSURE_RATIO;
  }

  return {
    allowedConcurrency(max) {
      const ceiling = Math.max(1, Number(max) || 1);
      if (mainHeapUnderPressure()) return 1;
      const perWorker = workerWasmBytes + WORKER_OVERHEAD_BYTES;
      return clamp(Math.floor((budgetBytes * scale) / perWorker), 1, ceiling);
    },

    // Reported by a worker after each provider: the size its WASM memory reached.
    observeWorker(wasmBytes) {
      const bytes = Number(wasmBytes) || 0;
      if (bytes > 0) {
        workerWasmBytes = Math.max(QUICKJS_BASE_WASM_BYTES, workerWasmBytes * 0.7 + bytes * 0.3);
      }
      scale = Math.min(1, scale + SCALE_RECOVERY_STEP);
    },

    // A worker crashed or could not start: the TV is short on memory.
    reportPressure() {
      scale = Math.max(MIN_SCALE, scale / 2);
      writeState(storage, { scale, running: running > 0 });
    },

    workerStarted() {
      running += 1;
      if (running === 1) writeState(storage, { scale, running: true });
    },

    workerEnded() {
      running = Math.max(0, running - 1);
      if (running === 0) writeState(storage, { scale, running: false });
    },

    snapshot() {
      return { budgetBytes, scale, workerWasmBytes, running };
    }
  };
}
