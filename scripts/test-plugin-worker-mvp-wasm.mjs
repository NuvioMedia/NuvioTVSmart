// The lowered QuickJS build serves engines without wasm BigInt integration
// (Chrome < 85: Tizen 5.0-6.0, webOS 5/6). Its imports must not take i64, local
// Date methods must match the host, and a reused worker must keep that build.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (file) => readFile(new URL(`../dist/assets/${file}`, import.meta.url));
const [workerSource, quickJsSource, mvpWasm] = await Promise.all([
  read("runtime/plugin-worker.js").then(String),
  read("libs/quickjs-emscripten.global.js").then(String),
  read("libs/quickjs-mvp.wasm")
]);

const { default: binaryen } = await import("binaryen");
const module = binaryen.readBinary(mvpWasm);
for (let i = 0; i < module.getNumFunctions(); i++) {
  const info = binaryen.getFunctionInfo(module.getFunctionByIndex(i));
  if (!info.module) continue;
  assert.ok(
    !binaryen.expandType(info.params).includes(binaryen.i64) && info.results !== binaryen.i64,
    `import ${info.module}.${info.base} still passes i64`
  );
}
module.dispose();

const DATE_PROBE = `[
  new Date(2024, 6, 15, 20, 30).getHours(),
  new Date(2024, 6, 15, 20, 30).getTimezoneOffset(),
  new Date(2024, 0, 15, 20, 30).getTimezoneOffset(),
  new Date(1794950000000).getHours(),
  String(new Date(1794950000000)).slice(0, 33),
  new Date("2024-01-01T10:00:00").getHours()
].join("|")`;
const expected = new Function(`return ${DATE_PROBE}`)();

const messages = [];
let notify = () => {};
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
  postMessage: (message) => {
    messages.push(message);
    notify();
  }
};
const context = vm.createContext(sandbox);
vm.runInContext("self = this; delete this.BigInt64Array; delete this.BigUint64Array;", context);
sandbox.importScripts = () => {
  vm.runInContext(quickJsSource, context);
  // Once the page has sent the MVP bytes, the stock build must never load.
  context.QJS = {
    ...context.QJS,
    getQuickJS: () => {
      throw new Error("stock QuickJS build loaded");
    }
  };
};
vm.runInContext(workerSource, context);

async function execute(quickJSWasm) {
  const count = messages.length;
  const done = new Promise((resolve) => {
    notify = () => messages.length > count && resolve(messages[messages.length - 1]);
  });
  sandbox.onmessage({
    data: {
      type: "execute",
      filename: "date-probe.js",
      code: `module.exports.getStreams = function(){ return [{ name: "d", title: ${DATE_PROBE}, url: "http://x/" }]; };`,
      quickJSWasm,
      timeoutMs: 10000
    }
  });
  let timer;
  try {
    return await Promise.race([
      done,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("MVP worker timed out")), 15000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const bytes = mvpWasm.buffer.slice(mvpWasm.byteOffset, mvpWasm.byteOffset + mvpWasm.byteLength);
for (const quickJSWasm of [bytes, null]) {
  const message = await execute(quickJSWasm);
  assert.equal(message.type, "result", message.error);
  assert.equal(message.results[0].title, expected);
}
console.log("Plugin Worker MVP WASM keeps local Date methods without BigInt");
