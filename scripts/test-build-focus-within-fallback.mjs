import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dist/css/bundle.css emits :focus-within fallback rules for legacy Chromium TVs", async () => {
  const bundleCss = await readFile(path.join(rootDir, "dist", "css", "bundle.css"), "utf8");
  const rules = bundleCss.split("}");
  const skipIntroFallback = rules.find(
    (entry) =>
      entry.includes(".player-skip-intro-btn.focused") &&
      !entry.includes(":focus-within") &&
      entry.includes("background:")
  );
  assert.ok(
    skipIntroFallback,
    "expected standalone .player-skip-intro-btn.focused rule without :focus-within"
  );

  const libraryInputFallback = rules.find(
    (entry) =>
      entry.includes(".library-dialog-input.focused+.library-dialog-field-label") &&
      !entry.includes(":focus-within") &&
      entry.includes("color:")
  );
  assert.ok(
    libraryInputFallback,
    "expected standalone .library-dialog-input.focused label rule without :focus-within"
  );
});
