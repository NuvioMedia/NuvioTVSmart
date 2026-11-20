import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("TizenPluginService enforces request timeout without AbortController on legacy Tizen", async () => {
  const source = (
    await readFile(new URL("../js/platform/tizen/tizenPluginService.js", import.meta.url), "utf8")
  )
    .replace(/^import [\s\S]*?from "[^"]+";\r?\n/gm, "")
    .replace(/^export /gm, "");

  let fetchCalls = 0;
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController: undefined,
    Platform: { isTizen: () => true, getTizenVersion: () => 5 },
    TizenCapabilities: {},
    getTizenServiceStartMethods: () => [],
    getWrtServiceClass: () => null,
    startWithWrtServiceClass: async () => ({}),
    tizen: {},
    webapis: {},
    fetch: () => {
      fetchCalls += 1;
      return new Promise(() => {});
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.TizenPluginService = TizenPluginService;`, context);

  // Test both requestJson() and request() timeout fallbacks without AbortController.
  await assert.rejects(
    () => context.requestJson("http://127.0.0.1:2711/health", {}, 30),
    (err) => err && err.name === "AbortError"
  );
  const svc = context.TizenPluginService;
  svc.ensureStarted = async () => ({ status: "success", baseUrl: "http://127.0.0.1:2711" });
  const startedAt = Date.now();
  await assert.rejects(
    () => svc.request("cache/clear", {}, { timeoutMs: 40 }),
    (err) => err && err.name === "AbortError"
  );
  assert.equal(fetchCalls >= 2, true);
  assert.equal(Date.now() - startedAt < 1000, true);
});
