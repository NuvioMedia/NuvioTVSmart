import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = path.join(rootDir, "css");

async function loadOrderedComponentCss() {
  const files = (await readdir(cssDir))
    .filter((file) => /^components-\d+\.css$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const roots = [];
  for (const file of files) {
    const raw = await readFile(path.join(cssDir, file), "utf8");
    roots.push({ file, root: postcss.parse(raw, { from: file }) });
  }
  return roots;
}

function normalizeSelector(selector) {
  return selector
    .replace(/\[dir=["']rtl["']\]/gi, "[dir=rtl]")
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectCascadedDecls(parsedSheets, matchingSelectors) {
  const matched = new Set(matchingSelectors.map(normalizeSelector));
  const decls = new Map();
  for (const { root } of parsedSheets) {
    root.walkRules((rule) => {
      if (rule.parent?.type === "atrule") {
        return;
      }
      const selectors = (rule.selectors || []).map(normalizeSelector);
      if (!selectors.some((sel) => matched.has(sel))) {
        return;
      }
      rule.walkDecls((decl) => {
        decls.set(decl.prop.toLowerCase(), decl.value.trim());
      });
    });
  }
  return decls;
}

function parsePx(value) {
  const match = String(value || "").match(/^(-?\d+(?:\.\d+)?)px$/i);
  return match ? Number(match[1]) : null;
}

test("MDBList reorder button overrides settings-action-row full width and min-height", async () => {
  const markupSource = await readFile(
    path.join(rootDir, "js", "ui", "screens", "settings", "settingsIntegrationDetailMdblist.js"),
    "utf8"
  );
  assert.match(
    markupSource,
    /class="settings-action-row settings-mdb-order-reorder/,
    "reorder button shares the settings-action-row base class"
  );

  const sheets = await loadOrderedComponentCss();
  const baseDecls = collectCascadedDecls(sheets, [".settings-action-row"]);
  assert.equal(baseDecls.get("width"), "100%", "base settings-action-row fills full width");
  assert.equal(
    baseDecls.get("min-height"),
    "124px",
    "base settings-action-row min-height is 124px"
  );

  // Resolve the effective cascade for `.settings-mdb-order-row > .settings-mdb-order-reorder`
  // which inherits from `.settings-action-row`.
  const reorderDecls = collectCascadedDecls(sheets, [
    ".settings-action-row",
    ".settings-mdb-order-row > .settings-mdb-order-reorder"
  ]);

  assert.equal(
    reorderDecls.get("flex"),
    "0 0 auto",
    "reorder button stays content-sized and non-shrinking"
  );
  assert.equal(
    reorderDecls.get("width"),
    "auto",
    "reorder button must override settings-action-row width: 100% so flex: 0 0 auto does not crush toggle labels or overflow the card"
  );

  const heightPx = parsePx(reorderDecls.get("height"));
  const minHeightPx = parsePx(reorderDecls.get("min-height"));
  assert.equal(heightPx, 80, "reorder button declares 80px height");
  assert.ok(
    minHeightPx !== null && minHeightPx <= heightPx,
    `reorder button min-height (${reorderDecls.get("min-height")}) must not exceed height (${reorderDecls.get("height")})`
  );
  assert.equal(
    reorderDecls.get("white-space"),
    "nowrap",
    "reorder button label must stay single-line in active move mode"
  );

  const toggleDecls = collectCascadedDecls(sheets, [
    ".settings-action-row",
    ".settings-toggle-row",
    ".settings-mdb-order-row > .settings-toggle-row"
  ]);
  assert.equal(toggleDecls.get("flex"), "1 1 auto");
  assert.equal(toggleDecls.get("min-width"), "0");
});

test("MDBList reorder button preserves legacy no-flex-gap RTL spacing for move-mode Done label", async () => {
  const sheets = await loadOrderedComponentCss();
  const rtlDoneDecls = collectCascadedDecls(sheets, [
    '[dir="rtl"].no-flex-gap .settings-mdb-order-row > .settings-mdb-order-reorder > * + *',
    '[dir="rtl"] .no-flex-gap .settings-mdb-order-row > .settings-mdb-order-reorder > * + *'
  ]);

  assert.equal(
    rtlDoneDecls.get("margin-left"),
    "0",
    "RTL legacy no-flex-gap must clear LTR margin-left inside the reorder button"
  );
  assert.equal(
    rtlDoneDecls.get("margin-right"),
    "10px",
    "RTL legacy no-flex-gap must mirror gap: 10px via margin-right inside the reorder button"
  );
});

test("built dist/css/bundle.css keeps MDBList reorder overrides and valid no-flex-gap fallback", async () => {
  let bundleCss;
  try {
    bundleCss = await readFile(path.join(rootDir, "dist", "css", "bundle.css"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const root = postcss.parse(bundleCss, { from: "dist/css/bundle.css" });
  const reorderDecls = collectCascadedDecls(
    [{ file: "bundle.css", root }],
    [".settings-action-row", ".settings-mdb-order-row > .settings-mdb-order-reorder"]
  );

  assert.equal(reorderDecls.get("width"), "auto");
  assert.equal(parsePx(reorderDecls.get("min-height")), 80);
  assert.equal(parsePx(reorderDecls.get("height")), 80);

  const legacyGapDecls = collectCascadedDecls(
    [{ file: "bundle.css", root }],
    ["html.no-flex-gap .settings-mdb-order-row > .settings-mdb-order-reorder > * + *"]
  );
  assert.equal(legacyGapDecls.get("margin-left"), "10px");
});
