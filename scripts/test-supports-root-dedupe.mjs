// postcss-global-data injects base.css :root into every CSS file, so the shared
// modern-math fallback must be emitted once in the bundle instead of per file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dist/css/bundle.css emits the shared @supports :root fallback once", async () => {
  const bundleCss = await readFile(path.join(rootDir, "dist", "css", "bundle.css"), "utf8");
  const rootGuards = bundleCss.match(/@supports[^{]*\{:root\{--tv-safe-gutter/g) || [];
  assert.equal(rootGuards.length, 1, "duplicate @supports :root fallbacks increase bundle size");
  assert.match(bundleCss, /--tv-safe-gutter:clamp\(28px,3vw,56px\)/);
});
