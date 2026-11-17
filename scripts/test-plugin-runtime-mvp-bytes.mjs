// On engines without wasm BigInt integration (Chrome < 85) the page loads the
// lowered QuickJS build once and hands it to each new worker exactly once;
// a reused worker keeps the module it compiled.
import assert from "node:assert/strict";

const nativeBigInt = globalThis.BigInt;
let xhrLoads = 0;
globalThis.XMLHttpRequest = class {
  open(method, url) {
    assert.match(url, /assets\/libs\/quickjs-mvp\.wasm$/);
  }
  send() {
    xhrLoads += 1;
    this.status = 0;
    this.response = new ArrayBuffer(8);
    setTimeout(() => this.onload(), 0);
  }
};
const sent = [];
globalThis.Worker = class {
  postMessage(message) {
    if (message.type !== "execute") return;
    sent.push({ worker: this, quickJSWasm: message.quickJSWasm });
    setTimeout(
      () => this.onmessage({ data: { type: "result", results: [], wasmMemoryBytes: 1 } }),
      0
    );
  }
  terminate() {}
};
globalThis.__NUVIO_PLUGIN_WORKER_URL__ = "file:///assets/runtime/plugin-worker.js";

const { PluginRuntime } = await import("../js/core/player/pluginRuntime.js");
const run = () =>
  PluginRuntime.executePlugin({
    code: "module.exports.getStreams = function(){ return []; };",
    skipService: true
  });

delete globalThis.BigInt;
try {
  await run();
  await run();
  await Promise.all([run(), run()]);
} finally {
  globalThis.BigInt = nativeBigInt;
}

assert.equal(xhrLoads, 1, "the MVP build is read once per page");
const seen = new Set();
for (const { worker, quickJSWasm } of sent) {
  if (seen.has(worker)) assert.equal(quickJSWasm, null, "a reused worker gets no bytes");
  else assert.ok(quickJSWasm instanceof ArrayBuffer, "a new worker gets the MVP bytes");
  seen.add(worker);
}
assert.ok(seen.size < sent.length, "the pool reused a worker");
assert.ok(seen.size > 1, "a parallel run created a second worker");
PluginRuntime.cancelAll();
console.log("Plugin runtime sends the MVP QuickJS build once per worker");
