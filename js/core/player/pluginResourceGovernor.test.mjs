import test from "node:test";
import assert from "node:assert/strict";
import { createPluginResourceGovernor, QUICKJS_BASE_WASM_BYTES } from "./pluginResourceGovernor.js";

const MIB = 1024 * 1024;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    raw: data
  };
}

test("concurrency follows the TV memory and never exceeds the Android ceiling", () => {
  const small = createPluginResourceGovernor({ deviceMemoryGb: 1 });
  const large = createPluginResourceGovernor({ deviceMemoryGb: 8 });
  assert.equal(small.allowedConcurrency(10), 5);
  assert.equal(large.allowedConcurrency(10), 10);
  assert.equal(createPluginResourceGovernor({ constrained: true }).allowedConcurrency(10), 4);
  assert.equal(createPluginResourceGovernor({ deviceMemoryGb: 0.25 }).allowedConcurrency(10), 1);
});

test("heavier providers lower the slot count, crashes halve it, successes recover it", () => {
  const governor = createPluginResourceGovernor({ deviceMemoryGb: 2 });
  const start = governor.allowedConcurrency(10);
  for (let i = 0; i < 10; i += 1) governor.observeWorker(64 * MIB);
  assert.ok(governor.allowedConcurrency(10) < start);
  const beforeCrash = governor.allowedConcurrency(10);
  governor.reportPressure();
  assert.ok(governor.allowedConcurrency(10) < beforeCrash);
  for (let i = 0; i < 20; i += 1) governor.observeWorker(QUICKJS_BASE_WASM_BYTES);
  assert.ok(governor.allowedConcurrency(10) >= beforeCrash);
});

test("an app that died while providers ran starts the next session at half", () => {
  const storage = memoryStorage();
  const first = createPluginResourceGovernor({ deviceMemoryGb: 4, storage });
  first.workerStarted();
  const resumed = createPluginResourceGovernor({ deviceMemoryGb: 4, storage });
  assert.equal(resumed.snapshot().scale, 0.5);
  resumed.workerStarted();
  resumed.workerEnded();
  assert.equal(createPluginResourceGovernor({ deviceMemoryGb: 4, storage }).snapshot().scale, 0.5);
});

test("main heap pressure runs one provider at a time", () => {
  const governor = createPluginResourceGovernor({
    deviceMemoryGb: 4,
    readMainHeap: () => ({ usedJSHeapSize: 90, jsHeapSizeLimit: 100 })
  });
  assert.equal(governor.allowedConcurrency(10), 1);
});
