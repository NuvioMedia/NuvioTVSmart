import assert from "node:assert/strict";
import test from "node:test";

const storageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => (storageMap.has(String(key)) ? storageMap.get(String(key)) : null),
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: (key) => storageMap.delete(String(key)),
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  }
};

globalThis.HTMLElement = class HTMLElement {};
globalThis.document = {
  documentElement: {
    dir: "ltr",
    lang: "en",
    dataset: {},
    style: { setProperty: () => {} },
    classList: { add() {}, remove() {}, contains: () => false, toggle: () => false }
  },
  body: {
    classList: { add() {}, remove() {}, contains: () => false, toggle: () => false }
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  navigator: { language: "en-US", languages: ["en-US"] }
};

const { createCatalogSeeAllScreenMethods01 } =
  await import("./catalogSeeAllScreenMethods-01-get-route-state-key.js");
const { createCatalogSeeAllScreenMethods02 } =
  await import("./catalogSeeAllScreenMethods-02-handle-grid-dpad.js");
const { createHomeScreenMethods05 } =
  await import("../home/homeScreenMethods-05-apply-hero-to-dom.js");

function card(row, col, rowKey = "catalog-a") {
  return {
    dataset: { navRow: String(row), navCol: String(col), navRowKey: rowKey },
    id: `${rowKey}:${row}:${col}`
  };
}

function gridRows(rowCount, columns, rowKey) {
  return Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columns }, (__, col) => card(row, col, rowKey))
  );
}

test("See All Down keeps the current column even when the target row remembers another one", () => {
  const methods = {
    ...createCatalogSeeAllScreenMethods01(),
    ...createCatalogSeeAllScreenMethods02()
  };
  const rows = gridRows(3, 6);
  const current = rows[0][5];
  let focused = null;
  const screen = {
    ...methods,
    navModel: { rows },
    rowFocusedIndexByRow: { 0: 5, 1: 1 },
    container: {
      querySelector: (selector) => (selector === ".seeall-card.focused" ? current : null)
    },
    focusNode(target) {
      focused = target;
      return true;
    }
  };

  assert.equal(screen.handleGridDpad({ keyCode: 40, preventDefault() {} }), true);
  assert.equal(focused, rows[1][5]);
});

test("See All clamps the column on a shorter last row", () => {
  const methods = createCatalogSeeAllScreenMethods01();
  const lastRow = [card(2, 0), card(2, 1)];
  assert.equal(
    methods.resolvePreferredNodeForRow.call({ rowFocusedIndexByRow: {} }, lastRow, 5),
    lastRow[1]
  );
});

test("See All still uses the remembered column when no current column is given", () => {
  const methods = createCatalogSeeAllScreenMethods01();
  const row = gridRows(2, 6)[1];
  assert.equal(
    methods.resolvePreferredNodeForRow.call({ rowFocusedIndexByRow: { 1: 3 } }, row),
    row[3]
  );
});

test("Home Grid layout keeps the current column when moving into another catalog", () => {
  const methods = createHomeScreenMethods05();
  const nextCatalogRow = gridRows(1, 6, "catalog-b")[0];
  const screen = {
    ...methods,
    layoutMode: "grid",
    lastFocusedItemIndexByRowKey: { "catalog-b": 1 }
  };
  assert.equal(screen.resolvePreferredNodeForRow(nextCatalogRow, 5), nextCatalogRow[5]);
});

test("Home Classic rows keep restoring the last focused item of the row", () => {
  const methods = createHomeScreenMethods05();
  const nextRow = gridRows(1, 10, "catalog-b")[0];
  const screen = {
    ...methods,
    layoutMode: "classic",
    lastFocusedItemIndexByRowKey: { "catalog-b": 7 }
  };
  assert.equal(screen.resolvePreferredNodeForRow(nextRow, 2), nextRow[7]);
});
