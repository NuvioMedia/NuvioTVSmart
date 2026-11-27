import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("ensureRuntime restores a stale runtime status for a cached ready promise", async () => {
  const source = await readFile(new URL("./pluginManager.js", import.meta.url), "utf8");
  const start = source.indexOf("async ensureRuntime() {");
  const end = source.indexOf("listRepositories() {", start);
  assert.ok(start >= 0 && end > start, "expected ensureRuntime in pluginManager.js");

  const state = { runtime: { lastStatus: "", lastError: "", lastCheckedAt: 0 } };
  const ctx = vm.createContext({
    Promise,
    Error,
    runtimeReadyPromise: null,
    getPluginCapabilitySnapshot: () => ({ candidate: true, platform: "tizen" }),
    quotaFor: () => ({ memoryLimitBytes: 1024, maxConcurrent: 1 }),
    PluginServiceClient: { ensureReady: async () => true },
    PluginRuntime: { selfTest: async () => true },
    markRuntime: (status, error = "") => {
      state.runtime = { ...state.runtime, lastStatus: status, lastError: error };
    },
    currentState: () => state,
    logPluginDiagnostic: () => {},
    diagnosticError: (error) => String(error)
  });
  ctx.globalThis = ctx;
  vm.runInContext(`globalThis.manager = { ${source.slice(start, end)} };`, ctx);

  await ctx.manager.ensureRuntime();
  assert.equal(state.runtime.lastStatus, "ready");

  // A different profile starts with the default "unknown" runtime state while
  // the module-level ready promise stays cached.
  state.runtime.lastStatus = "unknown";
  await ctx.manager.ensureRuntime();
  assert.equal(state.runtime.lastStatus, "ready");
});
