import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("renderFatalError escapes HTML metacharacters before rendering error pre block", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  const start = source.indexOf("function formatErrorMessage(error)");
  const end = source.indexOf("function isLowEndDevice()");
  assert.ok(
    start >= 0 && end > start,
    "expected formatErrorMessage and renderFatalError in app.js"
  );

  const body = { innerHTML: "" };
  const ctx = vm.createContext({
    document: { body },
    NuvioBootGuard: null,
    String
  });
  ctx.globalThis = ctx;
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.renderFatalError = renderFatalError;`,
    ctx
  );

  ctx.renderFatalError(new Error('<img src=x onerror="alert(1)"> & fail'));
  assert.equal(
    body.innerHTML.includes('<img src=x onerror="alert(1)">'),
    false,
    "renderFatalError must escape HTML metacharacters in error message"
  );
  assert.match(body.innerHTML, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(body.innerHTML, /&amp; fail/);
});
