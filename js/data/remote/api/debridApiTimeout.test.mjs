import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

test("debridApi enforces request timeout on hanging fetch", async () => {
  const source = stripModule(await readFile(new URL("./debridApi.js", import.meta.url), "utf8"));
  const context = vm.createContext({
    AbortController: undefined,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    fetchViaWebOsDebridAuthProxy: async () => null,
    fetch: () => new Promise(() => {})
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.requestJson = requestJson;\nglobalThis.requestDebridAuthJson = requestDebridAuthJson;`,
    context
  );

  const r1 = await context.requestJson("https://api.torbox.app/", "v1/test", { timeoutMs: 25 });
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 0);
  assert.equal(r1.error?.name, "AbortError");

  const r2 = await context.requestDebridAuthJson("https://api.torbox.app/", "v1/auth", {
    timeoutMs: 25
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.error?.name, "AbortError");
});
