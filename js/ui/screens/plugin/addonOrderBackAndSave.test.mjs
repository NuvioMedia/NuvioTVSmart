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
    this.scrollIntoViewCalls = 0;
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

  scrollIntoView() {
    this.scrollIntoViewCalls += 1;
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    getElementById: (id) => (id === "addonOrder" ? container : null),
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
const { I18n } = await import("../../../i18n/index.js");
const { AddonOrderScreen } = await import("./addonOrderScreen.js");

const originalRouterGetCurrent = Router.getCurrent;
const originalRouterGetCurrentScreen = Router.getCurrentScreen;
const originalRouterBack = Router.back;
const originalRouterSuppress = Router.suppressNextPopstate;
const originalRouterConsumeGuard = Router.consumeRouteReturnBackGuard;
const originalGetInstalledAddons = addonRepository.getInstalledAddons;
const originalGetInstalledAddonUrls = addonRepository.getInstalledAddonUrls;
const originalSetAddonOrder = addonRepository.setAddonOrder;
const originalCanEdit = addonRepository.canEdit;
const originalI18nT = I18n.t;

let currentRoute = "addonOrder";
let backCalls = 0;

function sampleAddons() {
  return [
    { url: "https://a.example", displayName: "Alpha", version: "1.0.0" },
    { url: "https://b.example", displayName: "Beta", version: "1.0.0" },
    { url: "https://c.example", displayName: "Gamma", version: "1.0.0" }
  ];
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
  currentRoute = "addonOrder";
  backCalls = 0;
  FocusEngine.lastBackHandledAt = 0;
  FocusEngine.resetActiveKeys();
  I18n.t = (_key, _params, options) => options?.fallback || _key;
  Router.getCurrent = () => currentRoute;
  Router.getCurrentScreen = () => (currentRoute === "addonOrder" ? AddonOrderScreen : null);
  Router.back = async () => {
    backCalls += 1;
  };
  Router.suppressNextPopstate = () => {};
  Router.consumeRouteReturnBackGuard = () => false;
  addonRepository.getInstalledAddons = async () => sampleAddons();
  addonRepository.getInstalledAddonUrls = () => sampleAddons().map((addon) => addon.url);
  addonRepository.setAddonOrder = async () => {};
  addonRepository.canEdit = () => true;
  AddonOrderScreen.focusIndex = 0;
  AddonOrderScreen.reorderSession = null;
  AddonOrderScreen.isSavingOrder = false;
});

after(() => {
  AddonOrderScreen.cleanup();
  Router.getCurrent = originalRouterGetCurrent;
  Router.getCurrentScreen = originalRouterGetCurrentScreen;
  Router.back = originalRouterBack;
  Router.suppressNextPopstate = originalRouterSuppress;
  Router.consumeRouteReturnBackGuard = originalRouterConsumeGuard;
  addonRepository.getInstalledAddons = originalGetInstalledAddons;
  addonRepository.getInstalledAddonUrls = originalGetInstalledAddonUrls;
  addonRepository.setAddonOrder = originalSetAddonOrder;
  addonRepository.canEdit = originalCanEdit;
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
  await AddonOrderScreen.mount();
  try {
    const consumed = AddonOrderScreen.consumeBackRequest();
    assert.equal(
      consumed,
      false,
      "consumeBackRequest must return synchronous boolean false when idle"
    );

    FocusEngine.handleBack(makeKeyEvent(10009, { key: "Escape" }));
    assert.equal(backCalls, 1, "FocusEngine.handleBack must call Router.back() when idle");
  } finally {
    AddonOrderScreen.cleanup();
  }
});

test("Back during active reorder cancels reorder synchronously, keeps screen open, and restores focus to moved addon", async () => {
  await AddonOrderScreen.mount();
  try {
    await AddonOrderScreen.onKeyDown(makeKeyEvent(13));
    await AddonOrderScreen.onKeyDown(makeKeyEvent(40));
    await AddonOrderScreen.onKeyDown(makeKeyEvent(40));
    assert.deepEqual(
      AddonOrderScreen.addons.map((a) => a.url),
      ["https://b.example", "https://c.example", "https://a.example"]
    );
    assert.equal(AddonOrderScreen.focusIndex, 2);

    const consumed = AddonOrderScreen.consumeBackRequest();
    assert.equal(
      consumed,
      true,
      "consumeBackRequest must return synchronous true while reordering"
    );
    await flushMacrotasks();

    assert.equal(backCalls, 0, "canceling reorder must not navigate away");
    assert.equal(AddonOrderScreen.reorderSession, null);
    assert.deepEqual(
      AddonOrderScreen.addons.map((a) => a.url),
      ["https://a.example", "https://b.example", "https://c.example"]
    );
    assert.equal(
      AddonOrderScreen.focusIndex,
      0,
      "focus must return to the cancelled addon's original row"
    );
    const focused = container.querySelector(".addon-order-focusable.focused");
    assert.equal(focused?.dataset?.url, "https://a.example");
  } finally {
    AddonOrderScreen.cleanup();
  }
});

test("confirming reorder blocks duplicate saves and navigation keys while setAddonOrder is in flight", async () => {
  const saveGate = deferred();
  const savedOrders = [];
  let installed = sampleAddons();
  addonRepository.getInstalledAddons = async () => installed;
  addonRepository.setAddonOrder = async (keys) => {
    savedOrders.push([...keys]);
    installed = keys.map((url) => installed.find((entry) => entry.url === url)).filter(Boolean);
    await saveGate.promise;
  };

  await AddonOrderScreen.mount();
  try {
    await AddonOrderScreen.onKeyDown(makeKeyEvent(13));
    await AddonOrderScreen.onKeyDown(makeKeyEvent(40));

    const firstConfirm = AddonOrderScreen.onKeyDown(makeKeyEvent(13));
    await flushMacrotasks();
    assert.equal(savedOrders.length, 1);
    assert.deepEqual(savedOrders[0], [
      "https://b.example",
      "https://a.example",
      "https://c.example"
    ]);

    const duplicateEnter = AddonOrderScreen.onKeyDown(makeKeyEvent(13));
    const downDuringSave = AddonOrderScreen.onKeyDown(makeKeyEvent(40));
    const duplicateFinish = AddonOrderScreen.finishReorder();
    await flushMacrotasks();

    assert.equal(
      savedOrders.length,
      1,
      "must not issue a second setAddonOrder while save is in flight"
    );
    assert.equal(AddonOrderScreen.focusIndex, 1, "ArrowDown during save must not shift focus");

    saveGate.resolve();
    await Promise.all([firstConfirm, duplicateEnter, downDuringSave, duplicateFinish]);

    assert.equal(AddonOrderScreen.isSavingOrder, false);
    await AddonOrderScreen.onKeyDown(makeKeyEvent(40));
    assert.equal(AddonOrderScreen.focusIndex, 2, "navigation resumes after save completes");
  } finally {
    saveGate.resolve();
    AddonOrderScreen.cleanup();
  }
});

test("cleanup invalidates stale in-flight mount load and in-flight reorder save", async () => {
  const staleLoad = deferred();
  const freshLoad = deferred();
  let loadCount = 0;
  addonRepository.getInstalledAddons = () => {
    loadCount += 1;
    return loadCount === 1 ? staleLoad.promise : freshLoad.promise;
  };

  const firstMount = AddonOrderScreen.mount();
  AddonOrderScreen.cleanup();
  const secondMount = AddonOrderScreen.mount();

  freshLoad.resolve([{ url: "https://fresh.example", displayName: "Fresh", version: "2.0.0" }]);
  await secondMount;

  staleLoad.resolve([{ url: "https://stale.example", displayName: "Stale", version: "1.0.0" }]);
  await firstMount;

  assert.deepEqual(
    AddonOrderScreen.addons.map((a) => a.url),
    ["https://fresh.example"],
    "stale mount load must not overwrite newer mounted addons"
  );
  assert.equal(
    container.querySelector(".addon-order-focusable")?.dataset?.url,
    "https://fresh.example"
  );

  const saveGate = deferred();
  let reloadsAfterSave = 0;
  addonRepository.getInstalledAddons = async () => {
    reloadsAfterSave += 1;
    return sampleAddons();
  };
  addonRepository.setAddonOrder = () => saveGate.promise;

  AddonOrderScreen.addons = sampleAddons();
  await AddonOrderScreen.render();
  await AddonOrderScreen.onKeyDown(makeKeyEvent(13));
  await AddonOrderScreen.onKeyDown(makeKeyEvent(40));

  const pendingSave = AddonOrderScreen.onKeyDown(makeKeyEvent(13));
  await flushMacrotasks();
  AddonOrderScreen.cleanup();
  saveGate.resolve();
  await pendingSave;

  assert.equal(reloadsAfterSave, 0, "unmounted screen must not reload addons after save settles");
  assert.equal(AddonOrderScreen.isSavingOrder, false);
});

test("repeated Enter keydown events do not start or immediately finish reorder mode", async () => {
  const savedOrders = [];
  addonRepository.setAddonOrder = async (keys) => {
    savedOrders.push([...keys]);
  };

  await AddonOrderScreen.mount();
  try {
    await AddonOrderScreen.onKeyDown(makeKeyEvent(13, { repeat: true }));
    assert.equal(
      AddonOrderScreen.reorderSession,
      null,
      "held Enter repeat while idle must not start reorder mode"
    );

    await AddonOrderScreen.onKeyDown(makeKeyEvent(13, { repeat: false }));
    assert.equal(
      AddonOrderScreen.reorderSession?.movingKey,
      "https://a.example",
      "initial Enter must enter active reorder mode"
    );

    await AddonOrderScreen.onKeyDown(makeKeyEvent(13, { repeat: true }));
    assert.equal(
      AddonOrderScreen.reorderSession?.movingKey,
      "https://a.example",
      "held Enter repeat during reorder must not immediately confirm and exit move mode"
    );
    assert.equal(savedOrders.length, 0);
  } finally {
    AddonOrderScreen.cleanup();
  }
});

test("finishReorder preserves disabled or hidden installed addon URLs not shown in visible list", async () => {
  const savedOrders = [];
  addonRepository.getInstalledAddons = async () => sampleAddons();
  addonRepository.getInstalledAddonUrls = () => [
    "https://a.example/manifest.json",
    "https://disabled.example",
    "https://b.example",
    "https://c.example",
    "https://unreachable.example"
  ];
  addonRepository.setAddonOrder = async (keys) => {
    savedOrders.push([...keys]);
  };

  await AddonOrderScreen.mount();
  try {
    await AddonOrderScreen.onKeyDown(makeKeyEvent(13));
    await AddonOrderScreen.onKeyDown(makeKeyEvent(40));
    await AddonOrderScreen.onKeyDown(makeKeyEvent(13));

    assert.equal(savedOrders.length, 1);
    assert.deepEqual(
      savedOrders[0],
      [
        "https://b.example",
        "https://disabled.example",
        "https://a.example",
        "https://c.example",
        "https://unreachable.example"
      ],
      "reordering visible addons must preserve the other installed URLs in their slot"
    );
  } finally {
    AddonOrderScreen.cleanup();
  }
});

test("startReorder is blocked on read-only profiles where addonRepository.canEdit() is false", async () => {
  addonRepository.canEdit = () => false;

  await AddonOrderScreen.mount();
  try {
    await AddonOrderScreen.onKeyDown(makeKeyEvent(13));
    assert.equal(
      AddonOrderScreen.reorderSession,
      null,
      "read-only profile must not enter active reorder mode"
    );
  } finally {
    AddonOrderScreen.cleanup();
  }
});

test("returning focus to Row 0 resets .catalog-order-main scrollTop to 0 so the header is never clipped", async () => {
  await AddonOrderScreen.mount();
  try {
    const scroller = container.querySelector(".catalog-order-main");
    assert.ok(scroller);

    await AddonOrderScreen.onKeyDown(makeKeyEvent(40));
    assert.equal(AddonOrderScreen.focusIndex, 1);
    scroller.scrollTop = 240;

    await AddonOrderScreen.onKeyDown(makeKeyEvent(38));
    assert.equal(AddonOrderScreen.focusIndex, 0);
    assert.equal(
      scroller.scrollTop,
      0,
      "focusing Row 0 must snap .catalog-order-main scrollTop to 0"
    );
    const firstBtn = container.querySelector(".addon-order-focusable.focused");
    assert.equal(
      firstBtn?.scrollIntoViewCalls,
      0,
      "Row 0 must not call scrollIntoView after snapping scroller to 0"
    );
  } finally {
    AddonOrderScreen.cleanup();
  }
});
