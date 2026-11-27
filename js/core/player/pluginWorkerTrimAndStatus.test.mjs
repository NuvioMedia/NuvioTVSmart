import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("pluginWorker polyfills String.prototype.trimStart/trimEnd when absent", async () => {
  const source = await readFile(new URL("./pluginWorker.js", import.meta.url), "utf8");
  const start = source.indexOf("function pluginPolyfill()");
  const end = source.indexOf("async function resolveGuestPromise(");
  assert.ok(start >= 0 && end > start, "expected pluginPolyfill in pluginWorker.js");

  const hostCtx = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)}\nthis.polyfillCode = pluginPolyfill();`, hostCtx);

  const guestCtx = vm.createContext({
    URL: class {},
    URLSearchParams: class {},
    __native_fetch: () => {},
    __native_cancel: () => {},
    __native_log: () => {},
    __parse_url: () => "{}",
    __cheerio_load: () => "",
    __cheerio_select: () => "[]",
    __cheerio_find: () => "[]",
    __cheerio_text: () => "",
    __cheerio_html: () => "",
    __cheerio_innerHtml: () => "",
    __cheerio_attr: () => "",
    __cheerio_next: () => "",
    __cheerio_prev: () => "",
    __cheerio_parent: () => "",
    __cheerio_children: () => "[]",
    __cheerio_filter: () => "[]",
    __cheerio_eq: () => "[]",
    __get_scraper_id: () => "test-scraper",
    __get_scraper_settings: () => "{}",
    __get_tmdb_api_key: () => ""
  });
  vm.runInContext(
    `delete String.prototype.trimStart;
     delete String.prototype.trimLeft;
     delete String.prototype.trimEnd;
     delete String.prototype.trimRight;
     ${hostCtx.polyfillCode}`,
    guestCtx
  );

  const trimmed = vm.runInContext(
    `JSON.stringify({
      start: "  hello  ".trimStart(),
      left: "  hello  ".trimLeft(),
      end: "  hello  ".trimEnd(),
      right: "  hello  ".trimRight()
    })`,
    guestCtx
  );
  assert.deepEqual(JSON.parse(trimmed), {
    start: "hello  ",
    left: "hello  ",
    end: "  hello",
    right: "  hello"
  });
});

test("PluginManager.ensureRuntime restores runtime.lastStatus to 'ready' on cached resolution", async () => {
  const source = await readFile(new URL("./pluginManager.js", import.meta.url), "utf8");
  const start = source.indexOf("async ensureRuntime() {");
  const end = source.indexOf("listRepositories() {", start);
  assert.ok(start >= 0 && end > start, "expected ensureRuntime in pluginManager.js");

  const state = { runtime: { lastStatus: "" } };
  const ctx = vm.createContext({
    Promise,
    Error,
    runtimeReadyPromise: null,
    getPluginCapabilitySnapshot: () => ({ candidate: true, platform: "tizen" }),
    quotaFor: () => ({ memoryLimitBytes: 1024, maxConcurrent: 1 }),
    PluginServiceClient: { ensureReady: async () => true },
    PluginRuntime: { selfTest: async () => true },
    markRuntime: (status) => {
      state.runtime.lastStatus = status;
    },
    currentState: () => state,
    logPluginDiagnostic: () => {},
    diagnosticError: (e) => String(e)
  });
  ctx.globalThis = ctx;
  vm.runInContext(`globalThis.obj = { ${source.slice(start, end)} };`, ctx);

  await ctx.obj.ensureRuntime();
  assert.equal(state.runtime.lastStatus, "ready");

  // Simulate status drifting while cached runtimeReadyPromise still resolves true.
  state.runtime.lastStatus = "error";
  await ctx.obj.ensureRuntime();
  assert.equal(
    state.runtime.lastStatus,
    "ready",
    "ensureRuntime must restore lastStatus='ready' on cached ready promise resolution"
  );
});
