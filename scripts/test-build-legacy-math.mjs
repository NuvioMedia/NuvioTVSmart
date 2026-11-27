import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("toLegacyLengthValue resolves 3+ level nested clamp/min/max math expressions via balanced paren matching", async () => {
  const buildPath = new URL("./build.mjs", import.meta.url);
  const source = await readFile(buildPath, "utf8");

  let toLegacyLengthValue;
  if (/\bexport\s*\{[^}]*\btoLegacyLengthValue\b/.test(source)) {
    ({ toLegacyLengthValue } = await import(buildPath.href));
  } else {
    const start = source.indexOf("function splitFunctionArgs");
    const end = source.indexOf("function legacyDeclarationFallbackPlugin");
    const legacyViewportMatch = source.match(/const legacyViewport\s*=\s*\{[\s\S]*?\};/);
    assert.ok(start >= 0 && end > start);
    const ctx = vm.createContext({ Math, Number, String });
    ctx.globalThis = ctx;
    vm.runInContext(
      `${legacyViewportMatch ? legacyViewportMatch[0] : "const legacyViewport = { width: 1920, height: 1080, remPx: 16 };"}
      ${source.slice(start, end)}
      globalThis.toLegacyLengthValue = toLegacyLengthValue;`,
      ctx
    );
    toLegacyLengthValue = ctx.toLegacyLengthValue;
  }

  // 3 nested parenthesis levels inside clamp() break the 1-level regex fallback in 63125970.
  const nestedExpr = "clamp(12px, min(4vw, var(--gap, calc(20px + 4px))), 48px)";
  const resolved = toLegacyLengthValue(nestedExpr);
  assert.equal(
    /\b(clamp|min|max)\(/.test(resolved),
    false,
    `unexpected raw math fn in: ${resolved}`
  );
  assert.equal(resolved, "48px");
});
