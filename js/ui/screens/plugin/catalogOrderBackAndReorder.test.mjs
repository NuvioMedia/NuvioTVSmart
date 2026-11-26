import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import * as cheerio from "cheerio";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;
const storage = new Map();

function resetStorage() {
  storage.clear();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => Array.from(storage.keys())[index] ?? null,
    getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
    clear: () => storage.clear()
  };
}

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this._classes = new Set();
    this.listeners = new Map();
    this.parentElement = null;
    this.focused = false;
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    this.clientHeight = 800;
  }

  get classList() {
    return {
      add: (...names) => names.forEach((n) => this._classes.add(n)),
      remove: (...names) => names.forEach((n) => this._classes.delete(n)),
      contains: (name) => this._classes.has(name),
      toggle: (name, force) => {
        const next = force == null ? !this._classes.has(name) : Boolean(force);
        if (next) this._classes.add(name);
        else this._classes.delete(name);
        return next;
      }
    };
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  focus() {
    this.focused = true;
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 80, left: 0, right: 400, width: 400, height: 80 };
  }

  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (selector.startsWith(".") && cursor.classList.contains(selector.slice(1))) {
        return cursor;
      }
      cursor = cursor.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const parts = selector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const out = [];
    const matchesSimple = (node, sel) => {
      const tokens = sel.match(/(\.[a-zA-Z0-9_-]+|\[[^\]]+\])/g) || [];
      if (!tokens.length) return false;
      return tokens.every((tok) => {
        if (tok.startsWith(".")) return node.classList.contains(tok.slice(1));
        const m = tok.match(/^\[data-([a-z-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/i);
        if (!m) return false;
        const camel = m[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        if (!(camel in node.dataset)) return false;
        return m[2] == null ? true : node.dataset[camel] === m[2];
      });
    };
    const walk = (nodes) => {
      for (const node of nodes) {
        if (parts.some((sel) => matchesSimple(node, sel))) out.push(node);
        if (node.children?.length) walk(node.children);
      }
    };
    walk(this.children);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(target) {
    if (target === this) return true;
    const walk = (nodes) => nodes.some((n) => n === target || (n.children && walk(n.children)));
    return walk(this.children);
  }
}

function buildTree(html, rootParent) {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
  const convert = (el, parent) => {
    const node = new FakeElement(el.tagName || el.name || "div");
    node.parentElement = parent;
    const attribs = el.attribs || {};
    String(attribs.class || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((cls) => node.classList.add(cls));
    Object.entries(attribs).forEach(([k, v]) => {
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        node.dataset[camel] = v;
      }
    });
    node.children = $(el)
      .children()
      .toArray()
      .map((child) => convert(child, node));
    return node;
  };
  return convert($("root")[0], rootParent);
}

class FakeContainer extends FakeElement {
  constructor() {
    super("section");
    this._html = "";
  }

  set innerHTML(html) {
    this._html = String(html || "");
    const root = buildTree(this._html, this);
    this.children = root.children;
    this.children.forEach((child) => {
      child.parentElement = this;
    });
  }

  get innerHTML() {
    return this._html;
  }
}

function flushMacrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let container;

function setupDom() {
  container = new FakeContainer();
  globalThis.HTMLElement = FakeElement;
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node" },
      configurable: true
    });
  }
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: "" },
    matchMedia: () => ({ matches: false, addEventListener: () => {} })
  };
  globalThis.document = {
    body: { classList: { contains: () => false, add() {}, remove() {} } },
    documentElement: { style: {}, classList: { contains: () => false, add() {}, remove() {} } },
    getElementById: (id) => (id === "catalogOrder" ? container : null),
    addEventListener: () => {},
    removeEventListener: () => {},
    contains: (node) => node === container || container.contains(node)
  };
}

resetStorage();
setupDom();

const { Router } = await import("../../navigation/routerState.js");
const { FocusEngine } = await import("../../navigation/focusEngine.js");
const { addonRepository } = await import("../../../data/repository/addonRepository.js");
const { HomeCatalogStore } = await import("../../../data/local/homeCatalogStore.js");
const { CollectionsStore } = await import("../../../data/local/collectionsStore.js");
const { ExperienceModeStore } = await import("../../../data/local/experienceModeStore.js");
const { I18n } = await import("../../../i18n/index.js");
const { isReordering } = await import("../../components/reorderSession.js");
const { CatalogOrderScreen } = await import("./catalogOrderScreen.js");

const originalRouterGetCurrent = Router.getCurrent;
const originalRouterGetCurrentScreen = Router.getCurrentScreen;
const originalRouterBack = Router.back;
const originalRouterSuppress = Router.suppressNextPopstate;
const originalRouterConsumeGuard = Router.consumeRouteReturnBackGuard;
const originalGetInstalledAddons = addonRepository.getInstalledAddons;
const originalCollectionsGet = CollectionsStore.get;
const originalIsEssential = ExperienceModeStore.isEssential;
const originalI18nT = I18n.t;

let currentRoute = "catalogOrder";
let backCalls = 0;

function sampleAddons() {
  return [
    {
      id: "org.a",
      baseUrl: "https://a.example/manifest.json",
      displayName: "Addon A",
      catalogs: [{ id: "cat1", apiType: "movie", name: "Movies A" }]
    },
    {
      id: "org.b",
      baseUrl: "https://b.example/manifest.json",
      displayName: "Addon B",
      catalogs: [{ id: "cat2", apiType: "series", name: "Series B" }]
    }
  ];
}

function sampleCollections() {
  return [{ id: "pinned", title: "Pinned Collection", pinToTop: true, folders: [] }];
}

function makeKeyEvent(keyCode, extra = {}) {
  return {
    keyCode,
    which: keyCode,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...extra
  };
}

beforeEach(() => {
  resetStorage();
  setupDom();
  currentRoute = "catalogOrder";
  backCalls = 0;
  FocusEngine.lastBackHandledAt = 0;
  FocusEngine.resetActiveKeys();
  I18n.t = (_key, _params, options) => options?.fallback || _key;
  ExperienceModeStore.isEssential = () => false;
  Router.getCurrent = () => currentRoute;
  Router.getCurrentScreen = () => (currentRoute === "catalogOrder" ? CatalogOrderScreen : null);
  Router.back = async () => {
    backCalls += 1;
  };
  Router.suppressNextPopstate = () => {};
  Router.consumeRouteReturnBackGuard = () => false;
  addonRepository.getInstalledAddons = async () => sampleAddons();
  CollectionsStore.get = () => sampleCollections();
  HomeCatalogStore.setOrder([]);
  CatalogOrderScreen.focusRow = 0;
  CatalogOrderScreen.focusCol = 0;
  CatalogOrderScreen.reorderSession = null;
});

after(() => {
  CatalogOrderScreen.cleanup();
  Router.getCurrent = originalRouterGetCurrent;
  Router.getCurrentScreen = originalRouterGetCurrentScreen;
  Router.back = originalRouterBack;
  Router.suppressNextPopstate = originalRouterSuppress;
  Router.consumeRouteReturnBackGuard = originalRouterConsumeGuard;
  addonRepository.getInstalledAddons = originalGetInstalledAddons;
  CollectionsStore.get = originalCollectionsGet;
  ExperienceModeStore.isEssential = originalIsEssential;
  I18n.t = originalI18nT;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.HTMLElement = originalHTMLElement;
  globalThis.localStorage = originalLocalStorage;
  if (originalNavigator !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true
    });
  }
});

test("idle Back returns synchronous false from consumeBackRequest so FocusEngine navigates back", async () => {
  await CatalogOrderScreen.mount();
  await flushMacrotasks();
  try {
    const consumed = CatalogOrderScreen.consumeBackRequest();
    assert.equal(
      consumed,
      false,
      "consumeBackRequest must return synchronous boolean false when idle"
    );

    FocusEngine.handleBack(makeKeyEvent(10009, { key: "Escape" }));
    assert.equal(backCalls, 1, "FocusEngine.handleBack must call Router.back() when idle");
  } finally {
    CatalogOrderScreen.cleanup();
  }
});

test("startReorder enters active reorder mode, locks non-moving rows in rowColumns, and moves/confirms cleanly", async () => {
  await CatalogOrderScreen.mount();
  await flushMacrotasks();
  try {
    assert.deepEqual(
      CatalogOrderScreen.model.items.map((item) => item.key),
      ["collection_pinned", "org.a_movie_cat1", "org.b_series_cat2"]
    );

    CatalogOrderScreen.focusRow = 1;
    CatalogOrderScreen.focusCol = 1;
    CatalogOrderScreen.startReorder("org.a_movie_cat1");
    await flushMacrotasks();

    assert.equal(
      isReordering(CatalogOrderScreen.reorderSession),
      true,
      "beginReorder must activate session"
    );
    assert.equal(CatalogOrderScreen.reorderSession.movingKey, "org.a_movie_cat1");
    assert.equal(
      CatalogOrderScreen.focusCol,
      0,
      "startReorder must normalize focusCol to reorder column 0"
    );
    assert.deepEqual(
      CatalogOrderScreen.getRows(),
      [1],
      "locked non-moving rows must not register focusable columns during active reorder"
    );

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(40));
    assert.deepEqual(
      CatalogOrderScreen.model.items.map((item) => item.key),
      ["collection_pinned", "org.b_series_cat2", "org.a_movie_cat1"]
    );
    assert.equal(CatalogOrderScreen.focusRow, 2);

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(38));
    await CatalogOrderScreen.onKeyDown(makeKeyEvent(38));
    assert.deepEqual(
      CatalogOrderScreen.model.items.map((item) => item.key),
      ["collection_pinned", "org.a_movie_cat1", "org.b_series_cat2"],
      "unpinned catalog cannot cross pinned top collection"
    );
    assert.equal(CatalogOrderScreen.focusRow, 1);

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(13));
    assert.equal(CatalogOrderScreen.reorderSession, null);
    assert.deepEqual(
      CatalogOrderScreen.getRows(),
      [0, 1, 2],
      "all rows unlock after confirming reorder"
    );
  } finally {
    CatalogOrderScreen.cleanup();
  }
});

test("Back during active reorder cancels synchronously, restores catalog order, and restores focus to original row", async () => {
  await CatalogOrderScreen.mount();
  await flushMacrotasks();
  try {
    CatalogOrderScreen.startReorder("org.a_movie_cat1");
    await flushMacrotasks();
    await CatalogOrderScreen.onKeyDown(makeKeyEvent(40));
    assert.equal(CatalogOrderScreen.focusRow, 2);
    assert.deepEqual(HomeCatalogStore.get().order, [
      "collection_pinned",
      "org.b_series_cat2",
      "org.a_movie_cat1"
    ]);

    const consumed = CatalogOrderScreen.consumeBackRequest();
    assert.equal(
      consumed,
      true,
      "consumeBackRequest must return synchronous true while reordering"
    );
    await flushMacrotasks();

    assert.equal(backCalls, 0, "canceling reorder must not navigate back");
    assert.equal(CatalogOrderScreen.reorderSession, null);
    assert.deepEqual(HomeCatalogStore.get().order, [
      "collection_pinned",
      "org.a_movie_cat1",
      "org.b_series_cat2"
    ]);
    assert.equal(
      CatalogOrderScreen.focusRow,
      1,
      "focusRow must return to the cancelled item's restored row index"
    );
    assert.equal(CatalogOrderScreen.focusCol, 0);
    const focused = container.querySelector(".catalog-order-focusable.focused");
    assert.equal(focused?.dataset?.key, "org.a_movie_cat1");
    assert.equal(focused?.dataset?.row, "1");
    assert.equal(focused?.dataset?.col, "0");
  } finally {
    CatalogOrderScreen.cleanup();
  }
});

test("startReorder refuses pinned items without leaving a stale reorderSession", async () => {
  await CatalogOrderScreen.mount();
  await flushMacrotasks();
  try {
    CatalogOrderScreen.startReorder("collection_pinned");
    assert.equal(CatalogOrderScreen.reorderSession, null);
    assert.equal(
      container.querySelector(".catalog-order-pinned-notice")?.classList.contains("hidden"),
      false
    );
  } finally {
    CatalogOrderScreen.cleanup();
  }
});

test("repeated Enter keydown events do not start or immediately finish reorder mode", async () => {
  await CatalogOrderScreen.mount();
  await flushMacrotasks();
  try {
    CatalogOrderScreen.focusRow = 1;
    CatalogOrderScreen.focusCol = 0;
    CatalogOrderScreen.applyFocus();

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(13, { repeat: true }));
    assert.equal(
      CatalogOrderScreen.reorderSession,
      null,
      "held Enter repeat while idle must not start reorder mode"
    );

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(13, { repeat: false }));
    await flushMacrotasks();
    assert.equal(
      CatalogOrderScreen.reorderSession?.movingKey,
      "org.a_movie_cat1",
      "initial Enter must activate reorder mode"
    );

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(13, { repeat: true }));
    assert.equal(
      CatalogOrderScreen.reorderSession?.movingKey,
      "org.a_movie_cat1",
      "held Enter repeat during reorder must not immediately confirm and exit move mode"
    );
  } finally {
    CatalogOrderScreen.cleanup();
  }
});

test("returning focus to Row 0 resets .catalog-order-main scrollTop to 0 so header and subtitle are unclipped", async () => {
  await CatalogOrderScreen.mount();
  await flushMacrotasks();
  try {
    const scroller = container.querySelector(".catalog-order-main");
    assert.ok(scroller);
    scroller.getBoundingClientRect = () => ({
      top: 0,
      bottom: 800,
      left: 0,
      right: 1920,
      width: 1920,
      height: 800
    });
    const firstCard = container.querySelector(".catalog-order-card");
    assert.ok(firstCard);
    firstCard.getBoundingClientRect = () => ({
      top: 208 - scroller.scrollTop,
      bottom: 320 - scroller.scrollTop,
      left: 96,
      right: 1824,
      width: 1728,
      height: 112
    });

    CatalogOrderScreen.focusRow = 1;
    CatalogOrderScreen.applyFocus();
    scroller.scrollTop = 360;

    await CatalogOrderScreen.onKeyDown(makeKeyEvent(38));
    assert.equal(CatalogOrderScreen.focusRow, 0);
    assert.equal(
      scroller.scrollTop,
      0,
      "focusing Row 0 must snap .catalog-order-main scrollTop to 0 instead of stopping at anchorTop - pad (152px)"
    );
  } finally {
    CatalogOrderScreen.cleanup();
  }
});
