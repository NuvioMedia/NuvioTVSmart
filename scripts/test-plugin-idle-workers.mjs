// A warm plugin worker keeps a compiled QuickJS runtime (16 MiB of WASM that
// never shrinks). Playback releases those idle workers before the TV allocates
// its video buffer, but a provider that is still running must not be cut off.
import assert from "node:assert/strict";

Object.defineProperty(globalThis, "navigator", {
  value: { hardwareConcurrency: 4, deviceMemory: 2 },
  configurable: true
});

const created = [];
const answeredExecutions = new Set();
class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = false;
    created.push(this);
  }
  postMessage(message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.Worker = FakeWorker;
globalThis.__NUVIO_PLUGIN_WORKER_URL__ = "file:///assets/runtime/plugin-worker.js";

const { PluginRuntime } = await import("../js/core/player/pluginRuntime.js");

// The newest provider nobody has answered yet: a reused worker can still be
// running the previous one while a fresh worker gets the new request.
function pendingExecution() {
  for (let index = created.length - 1; index >= 0; index -= 1) {
    const worker = created[index];
    if (worker.terminated) continue;
    for (let posted = worker.posted.length - 1; posted >= 0; posted -= 1) {
      const message = worker.posted[posted];
      if (message.type === "execute" && !answeredExecutions.has(message.executionId)) {
        return { worker, message };
      }
    }
  }
  return null;
}

function answer({ worker, message }, results) {
  answeredExecutions.add(message.executionId);
  worker.onmessage({
    data: { type: "result", results, wasmMemoryBytes: 16 * 1024 * 1024 }
  });
}

async function start() {
  const promise = PluginRuntime.executePlugin({
    code: "module.exports.getStreams = function(){ return []; };",
    skipService: true
  });
  // let executePlugin acquire the worker and post the provider
  await new Promise((resolve) => setTimeout(resolve, 0));
  const execution = pendingExecution();
  assert.ok(execution, "a worker must receive the provider");
  return { promise, ...execution };
}

const first = await start();
answer(first, [{ url: "a" }]);
assert.deepEqual(await first.promise, [{ url: "a" }]);
assert.equal(first.worker.terminated, false, "a clean run keeps its worker warm");
const warm = first.worker;

// Leave one provider running while a second worker finishes and goes idle.
const running = await start();
assert.equal(running.worker, warm, "the idle worker takes the next provider");
const spare = await start();
assert.notEqual(spare.worker, warm, "a running provider forces a second worker");
answer(spare, []);
await spare.promise;

PluginRuntime.dropIdleWorkers();
assert.equal(spare.worker.terminated, true, "the idle worker is released");
assert.equal(warm.terminated, false, "the running provider is not interrupted");

answer(running, [{ url: "b" }]);
assert.deepEqual(await running.promise, [{ url: "b" }]);
assert.equal(warm.terminated, false, "a finished provider becomes warm again");

PluginRuntime.dropIdleWorkers();
assert.equal(warm.terminated, true, "playback can release the last warm worker");

console.log("Playback suspends idle plugin workers without interrupting a provider");
