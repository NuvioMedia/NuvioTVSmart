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

const { createSearchScreenMethods02 } =
  await import("./searchScreenMethods-02-load-discover-rows.js");
const { createDiscoverScreenMethods01 } =
  await import("./discoverScreenMethods-01-clear-closing-picker.js");
const { createCatalogSeeAllScreenMethods02 } =
  await import("../catalog/catalogSeeAllScreenMethods-02-handle-grid-dpad.js");

test("SearchScreen.renderRows escapes untrusted addon metadata in row headers and cards", () => {
  const methods = createSearchScreenMethods02();
  const payload = '"><img src=x onerror=alert(1)>';
  const ctx = {
    rows: [
      {
        title: `Row <img src=x onerror=1> ${payload}`,
        subtitle: `Sub <b>tag</b> ${payload}`,
        type: `movie${payload}`,
        addonBaseUrl: `https://addon.example${payload}`,
        addonId: `id${payload}`,
        addonName: `name${payload}`,
        catalogId: `cat${payload}`,
        catalogName: `catName${payload}`,
        items: Array.from({ length: 15 }, (_, index) => ({
          id: `tt${index}${payload}`,
          type: `movie${payload}`,
          name: `Movie ${index} <img src=x onerror=2> ${payload}`,
          poster: `https://img.example/${index}.jpg${payload}`,
          released: `2025-01-01${payload}`
        }))
      }
    ],
    watchedTitleIds: new Set()
  };

  const html = methods.renderRows.call(ctx);
  assert.equal(html.includes("<img src=x"), false, "renderRows must escape untrusted HTML tags");
  assert.equal(html.includes("<b>tag</b>"), false, "renderRows must escape row subtitle HTML");
  assert.equal(html.includes('"><img'), false, "renderRows must not allow attribute breakout");
});

test("DiscoverScreen.renderDiscoverCards escapes untrusted addon metadata", () => {
  const methods = createDiscoverScreenMethods01();
  const payload = '"><img src=x onerror=alert(1)>';
  const ctx = {
    items: [
      {
        id: `tt999${payload}`,
        type: `movie${payload}`,
        name: `Bad Title ${payload}`,
        poster: `https://img.example/p.jpg${payload}`,
        released: "2024"
      }
    ],
    watchedTitleIds: new Set(),
    layoutPrefs: { posterLabelsEnabled: true },
    renderedItemsLimit: 48,
    hasMore: false
  };

  const html = methods.renderDiscoverCards.call(ctx, { type: "movie" });
  assert.equal(
    html.includes("<img src=x"),
    false,
    "Discover cards must escape untrusted HTML tags"
  );
  assert.equal(html.includes('"><img'), false, "Discover cards must not allow attribute breakout");
});

test("CatalogSeeAllScreen.render escapes item id, type, and focus-key attributes", () => {
  const methods = createCatalogSeeAllScreenMethods02();
  const payload = '"><img src=x onerror=alert(1)>';
  const fakeContainer = {
    innerHTML: "",
    classList: { add() {}, remove() {}, contains: () => false, toggle: () => false },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const ctx = {
    container: fakeContainer,
    params: { catalogName: "Discover", type: "movie", addonBaseUrl: "https://addon.example" },
    items: [
      {
        id: `tt999${payload}`,
        type: `movie${payload}`,
        name: `Bad Title ${payload}`,
        poster: `https://img.example/p.jpg${payload}`,
        released: "2024"
      }
    ],
    watchedTitleIds: new Set(),
    layoutPrefs: { posterLabelsEnabled: true },
    buildNavigationModel: () => {},
    bindCardEvents: () => {},
    bindShellEvents: () => {}
  };

  methods.render.call(ctx);
  assert.equal(
    fakeContainer.innerHTML.includes("<img src=x"),
    false,
    "CatalogSeeAll render must escape item id, type, and focus-key attributes"
  );
  assert.equal(
    fakeContainer.innerHTML.includes('"><img'),
    false,
    "CatalogSeeAll render must not allow attribute breakout"
  );
});

test("CatalogSeeAllScreen.restoreFocusedCard escapes the stored focus key in its selector", () => {
  const methods = createCatalogSeeAllScreenMethods02();
  const selectors = [];
  const ctx = {
    container: {
      querySelector: (selector) => {
        selectors.push(selector);
        return null;
      },
      querySelectorAll: () => []
    },
    lastFocusedKey: 'item:tt1"><img src=x onerror=alert(1)>'
  };

  methods.restoreFocusedCard.call(ctx);
  const focusSelector = selectors.find((selector) => selector.includes("data-focus-key"));
  assert.ok(focusSelector, "restoreFocusedCard must query the stored focus key");
  assert.equal(focusSelector.includes('\\"'), true, "focus key selectors must escape quotes");
});
