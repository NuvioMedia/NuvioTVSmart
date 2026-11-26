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

test("CollectionEditor .collections-form spans full .collections-main width without 1400px cap", async () => {
  const editorSource = await readFile(
    path.join(rootDir, "js", "ui", "screens", "collection", "collectionEditorScreen.js"),
    "utf8"
  );
  assert.match(
    editorSource,
    /<section class="collections-form">/,
    "CollectionEditorScreen renders its form sections inside .collections-form"
  );

  const sheets = await loadOrderedComponentCss();
  const mainDecls = collectCascadedDecls(sheets, [".collections-main"]);
  const listDecls = collectCascadedDecls(sheets, [".collections-list"]);
  const formDecls = collectCascadedDecls(sheets, [".collections-form"]);

  assert.equal(
    mainDecls.get("padding"),
    "48px 96px 128px",
    ".collections-main provides symmetric 96px horizontal gutters"
  );
  assert.equal(
    listDecls.get("max-width"),
    undefined,
    ".collections-list spans the full .collections-main width"
  );
  assert.equal(
    formDecls.get("max-width"),
    undefined,
    ".collections-form must not cap width (e.g. 1400px), which leaves empty space on the right on 1920px TVs"
  );
  assert.equal(formDecls.get("display"), "flex");
  assert.equal(formDecls.get("flex-direction"), "column");
});

test("built dist/css/bundle.css omits max-width cap on .collections-form", async () => {
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
  const formDecls = collectCascadedDecls([{ file: "bundle.css", root }], [".collections-form"]);
  assert.equal(
    formDecls.get("max-width"),
    undefined,
    "built bundle.css .collections-form must not have a max-width cap"
  );
});
