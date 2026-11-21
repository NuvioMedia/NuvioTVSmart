import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Tizen 5.0 runs Chromium 63: no AbortController, so fetch() cannot be
// cancelled and timeouts must still settle the request.
const source = (
  await readFile(new URL("../js/platform/tizen/tizenPluginService.js", import.meta.url), "utf8")
)
  .replace(/^import [\s\S]*?from "[^"]+";\r?\n/gm, "")
  .replace(/^export /gm, "");

function loadService(fetchImpl) {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController: undefined,
    Platform: { isTizen: () => false },
    TizenCapabilities: {},
    getTizenServiceStartMethods: () => [],
    getWrtServiceClass: () => null,
    startWithWrtServiceClass: async () => ({}),
    tizen: {},
    fetch: fetchImpl
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.TizenPluginService = TizenPluginService;`, context);
  context.TizenPluginService.ensureStarted = async () => ({
    status: "success",
    baseUrl: "http://127.0.0.1:2711"
  });
  return context;
}

const isAbortError = (error) => error && error.name === "AbortError";

test("requestJson and request time out without AbortController", async () => {
  let fetchCalls = 0;
  const context = loadService(() => {
    fetchCalls += 1;
    return new Promise(() => {});
  });

  const startedAt = Date.now();
  await assert.rejects(
    () => context.requestJson("http://127.0.0.1:2711/health", {}, 30),
    isAbortError
  );
  await assert.rejects(
    () => context.TizenPluginService.request("cache/clear", {}, { timeoutMs: 40 }),
    isAbortError
  );
  assert.equal(fetchCalls, 2);
  assert.ok(Date.now() - startedAt < 1000);
});

test("the timeout covers the response body read without AbortController", async () => {
  const context = loadService(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise(() => {})
    })
  );

  await assert.rejects(
    () => context.requestJson("http://127.0.0.1:2711/health", {}, 30),
    isAbortError
  );
});

test("a caller abort rejects the request without AbortController", async () => {
  const context = loadService(() => new Promise(() => {}));
  const listeners = [];
  const signal = {
    aborted: false,
    addEventListener: (name, listener) => listeners.push(listener),
    removeEventListener: () => {}
  };

  const pending = context.TizenPluginService.request(
    "cache/clear",
    {},
    {
      timeoutMs: 5000,
      signal
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  listeners.forEach((listener) => listener());
  await assert.rejects(pending, isAbortError);
});
