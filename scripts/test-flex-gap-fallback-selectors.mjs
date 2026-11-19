import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dist/css/bundle.css emits compound html.no-flex-gap.no-css-grid selectors instead of descendant html", async () => {
  const bundleCss = await readFile(path.join(rootDir, "dist", "css", "bundle.css"), "utf8");
  assert.doesNotMatch(
    bundleCss,
    /html\.no-flex-gap\s+html\b/,
    "flexGapFallbackPlugin must not nest html inside html.no-flex-gap"
  );
  assert.match(
    bundleCss,
    /html\.no-flex-gap\.no-css-grid\b/,
    "combined no-css-grid + no-flex-gap fallbacks must use compound html selectors"
  );
});
