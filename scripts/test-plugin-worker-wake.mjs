import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

function createWorkerSandbox({ onMessage, onSetTimeout } = {}) {
  const realSetTimeout = setTimeout;
  const sandbox = {
    console,
    WebAssembly,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    setTimeout: (fn, ms, ...args) => {
      onSetTimeout?.(Number(ms));
      return realSetTimeout(fn, ms, ...args);
    },
    clearTimeout,
    atob,
    btoa,
    postMessage: (msg) => onMessage?.(msg)
  };
  return { sandbox, realSetTimeout };
}

test("pluginWorker settles async fetch without setTimeout(0) busy polling", async () => {
  const workerSource = await readFile(
    new URL("../js/core/player/pluginWorker.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(workerSource, /setTimeout\s*\(\s*resolve\s*,\s*0\s*\)/);

  const [builtWorkerSource, quickJsSource] = await Promise.all([
    readFile(new URL("../dist/assets/runtime/plugin-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/assets/libs/quickjs-emscripten.global.js", import.meta.url), "utf8")
  ]);

  const posted = [];
  const timeoutDelays = [];
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });

  const { sandbox, realSetTimeout } = createWorkerSandbox({
    onSetTimeout: (ms) => timeoutDelays.push(ms),
    onMessage: (msg) => {
      posted.push(msg);
      if (msg.type === "fetch") {
        realSetTimeout(() => {
          sandbox.onmessage({
            data: {
              type: "fetchResult",
              requestId: msg.requestId,
              payload: {
                ok: true,
                status: 200,
                statusText: "OK",
                url: "https://example.test/api",
                headers: {},
                body: JSON.stringify([{ name: "Test", url: "https://example.test/video.mp4" }])
              }
            }
          });
        }, 15);
      } else if (msg.type === "result" || msg.type === "error") {
        finish(msg);
      }
    }
  });

  const context = vm.createContext(sandbox);
  vm.runInContext("self = this", context);
  sandbox.importScripts = () => vm.runInContext(quickJsSource, context);
  vm.runInContext(builtWorkerSource, context);

  sandbox.onmessage({
    data: {
      type: "execute",
      filename: "async-fetch-test.js",
      code: "module.exports.getStreams = async function(){ var r = await fetch('https://example.test/api'); return await r.json(); };",
      timeoutMs: 5000
    }
  });

  const result = await done;
  assert.equal(result.type, "result");
  assert.equal(Array.from(result.results).length, 1);
  assert.equal(result.results[0].name, "Test");
  assert.equal(
    timeoutDelays.some((ms) => Number.isFinite(ms) && ms <= 10),
    false,
    `expected no short polling timers, saw: ${timeoutDelays.join(", ")}`
  );
  assert.ok(
    posted.some((m) => m.type === "fetch"),
    "expected worker to issue async fetch"
  );
});

test("pluginWorker rejects a never-settling promise with Plugin promise timed out", async () => {
  const [builtWorkerSource, quickJsSource] = await Promise.all([
    readFile(new URL("../dist/assets/runtime/plugin-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/assets/libs/quickjs-emscripten.global.js", import.meta.url), "utf8")
  ]);

  const logs = [];
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });

  const { sandbox } = createWorkerSandbox({
    onMessage: (msg) => {
      if (msg.type === "pluginLog") {
        logs.push(msg);
      } else if (msg.type === "result" || msg.type === "error") {
        finish(msg);
      }
    }
  });

  const context = vm.createContext(sandbox);
  vm.runInContext("self = this", context);
  sandbox.importScripts = () => vm.runInContext(quickJsSource, context);
  vm.runInContext(builtWorkerSource, context);

  sandbox.onmessage({
    data: {
      type: "execute",
      filename: "timeout-test.js",
      code: "module.exports.getStreams = function(){ return new Promise(function(){}); };",
      timeoutMs: 80
    }
  });

  const result = await done;
  assert.equal(result.type, "result");
  assert.deepEqual(Array.from(result.results), []);
  assert.ok(
    logs.some(
      (entry) =>
        entry.level === "error" && String(entry.message || "").includes("Plugin promise timed out")
    ),
    `expected timeout log message, saw: ${JSON.stringify(logs)}`
  );
});
