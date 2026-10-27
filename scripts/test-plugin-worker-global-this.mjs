import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workerSource = await readFile(
  new URL("../dist/assets/runtime/plugin-worker.js", import.meta.url),
  "utf8"
);
const quickJsSource = await readFile(
  new URL("../dist/assets/libs/quickjs-emscripten.global.js", import.meta.url),
  "utf8"
);

for (const legacy of [false, true]) {
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const sandbox = {
    console,
    WebAssembly,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    atob,
    btoa,
    postMessage: finish
  };
  const context = vm.createContext(sandbox);
  vm.runInContext("self = this", context);
  const nativeGlobal = vm.runInContext("globalThis", context);
  if (legacy) vm.runInContext("delete this.globalThis", context);
  sandbox.importScripts = (path) => {
    assert.equal(path, "../libs/quickjs-emscripten.global.js");
    vm.runInContext(quickJsSource, context);
  };
  vm.runInContext(workerSource, context);
  sandbox.onmessage({
    data: {
      type: "execute",
      filename: "runtime-self-test.js",
      code: "module.exports.getStreams = function(){ return []; };",
      timeoutMs: 5000
    }
  });
  let timer;
  try {
    const message = await Promise.race([
      result,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Worker self-test timed out")), 10000);
      })
    ]);
    assert.equal(message.type, "result", message.error);
    assert.deepEqual(Array.from(message.results), []);
    assert.equal(vm.runInContext("globalThis === self", context), true);
    if (!legacy) assert.equal(vm.runInContext("globalThis", context), nativeGlobal);
  } finally {
    clearTimeout(timer);
  }
}
console.log("Plugin Worker self-test passed with native and missing globalThis");
