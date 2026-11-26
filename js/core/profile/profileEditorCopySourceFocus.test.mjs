import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import * as cheerio from "cheerio";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;
const originalGetComputedStyle = globalThis.getComputedStyle;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
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
    this.attributes = new Map();
    this._classes = new Set();
    this.listeners = new Map();
    this.parentElement = null;
    this.parentNode = null;
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.isConnected = true;
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

  dispatchEvent(type, event = {}) {
    const payload = { target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of this.listeners.get(type) || []) {
      fn(payload);
    }
  }

  focus() {
    globalThis.document.activeElement = this;
    this.dispatchEvent("focus");
  }

  scrollIntoView() {}

  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (cursor.matches(selector)) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }

  matches(selector) {
    const parts = selector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.some((sel) => {
      const tokens = sel.match(/(\.[a-zA-Z0-9_-]+|\[[^\]]+\])/g) || [];
      if (!tokens.length) return false;
      return tokens.every((tok) => {
        if (tok.startsWith(".")) return this.classList.contains(tok.slice(1));
        const m = tok.match(/^\[data-([a-z-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/i);
        if (!m) return false;
        const camel = m[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        if (!(camel in this.dataset)) return false;
        return m[2] == null ? true : this.dataset[camel] === m[2];
      });
    });
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.matches(selector)) out.push(node);
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
    node.parentNode = parent;
    node.textContent = $(el).text();
    const attribs = el.attribs || {};
    String(attribs.class || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((cls) => node.classList.add(cls));
    Object.entries(attribs).forEach(([k, v]) => {
      node.attributes.set(k, v);
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
      child.parentNode = this;
    });
  }

  get innerHTML() {
    return this._html;
  }
}

let container;

function setupDom() {
  container = new FakeContainer();
  globalThis.HTMLElement = FakeElement;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#111111" });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
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
    activeElement: null,
    documentElement: { style: {}, classList: { contains: () => false, add() {}, remove() {} } },
    getElementById: (id) => (id === "profileSelection" ? container : null),
    addEventListener: () => {},
    removeEventListener: () => {},
    contains: (node) => node === container || container.contains(node)
  };
}

resetStorage();
setupDom();

const { ProfileManager } = await import("./profileManager.js");
const { MemberAccessRepository } =
  await import("../../data/remote/supabase/memberAccessRepository.js");
const { ProfileBackgroundRepository } =
  await import("../../data/remote/supabase/profileBackgroundRepository.js");
const { I18n } = await import("../../i18n/index.js");
const { ProfileSelectionScreen } = await import("./profileSelectionScreen.js");

const originalGetProfiles = ProfileManager.getProfiles;
const originalGetActiveProfileId = ProfileManager.getActiveProfileId;
const originalMemberGetCurrent = MemberAccessRepository.getCurrentAccess;
const originalMemberSubscribe = MemberAccessRepository.subscribe;
const originalBgSubscribe = ProfileBackgroundRepository.subscribe;
const originalI18nT = I18n.t;

function makeKeyEvent(keyCode) {
  return {
    keyCode,
    which: keyCode,
    preventDefault() {},
    stopPropagation() {}
  };
}

beforeEach(() => {
  resetStorage();
  setupDom();
  I18n.t = (_key, _params, fallback) =>
    typeof fallback === "string" ? fallback : fallback?.fallback || _key;
  ProfileManager.getProfiles = async () => [
    { id: "1", name: "Main", isPrimary: true, avatarColorHex: "#1E88E5" }
  ];
  ProfileManager.getActiveProfileId = () => "1";
  MemberAccessRepository.getCurrentAccess = () => ({ entitlements: [] });
  MemberAccessRepository.subscribe = () => () => {};
  ProfileBackgroundRepository.subscribe = () => () => {};
});

after(() => {
  ProfileSelectionScreen.cleanup();
  ProfileManager.getProfiles = originalGetProfiles;
  ProfileManager.getActiveProfileId = originalGetActiveProfileId;
  MemberAccessRepository.getCurrentAccess = originalMemberGetCurrent;
  MemberAccessRepository.subscribe = originalMemberSubscribe;
  ProfileBackgroundRepository.subscribe = originalBgSubscribe;
  I18n.t = originalI18nT;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  globalThis.getComputedStyle = originalGetComputedStyle;
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

test("Create Profile D-pad Down/Up traverses editor:copy-source between name input and cancel button", async () => {
  await ProfileSelectionScreen.mount({
    mode: "management",
    skipInitialProfileSync: true,
    profilePinEnabled: {}
  });
  try {
    ProfileSelectionScreen.openCreateEditor();
    assert.equal(ProfileSelectionScreen.focusKey, "editor:name");
    assert.ok(
      container.querySelector("[data-focus-key='editor:copy-source']"),
      "create editor must render the copy-source button when existing profiles exist"
    );

    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(40));
    assert.equal(
      ProfileSelectionScreen.focusKey,
      "editor:copy-source",
      "Down from name input must focus Copy settings from button instead of skipping to Cancel"
    );

    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(40));
    assert.equal(
      ProfileSelectionScreen.focusKey,
      "editor:cancel",
      "Down from Copy settings from button must move to Cancel"
    );

    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(38));
    assert.equal(
      ProfileSelectionScreen.focusKey,
      "editor:copy-source",
      "Up from Cancel must return to Copy settings from button"
    );

    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(38));
    assert.equal(
      ProfileSelectionScreen.focusKey,
      "editor:name",
      "Up from Copy settings from button must return to name input"
    );
  } finally {
    ProfileSelectionScreen.cleanup();
  }
});

test("D-pad Left and Right from editor:copy-source navigate back to name input and over to picker pane", async () => {
  await ProfileSelectionScreen.mount({
    mode: "management",
    skipInitialProfileSync: true,
    profilePinEnabled: {}
  });
  try {
    ProfileSelectionScreen.openCreateEditor();
    const copySourceButton = container.querySelector("[data-focus-key='editor:copy-source']");
    assert.ok(copySourceButton);

    copySourceButton.focus();
    assert.equal(ProfileSelectionScreen.focusKey, "editor:copy-source");
    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(37));
    assert.equal(
      ProfileSelectionScreen.focusKey,
      "editor:name",
      "Left from copy-source must move to name input"
    );

    copySourceButton.focus();
    assert.equal(ProfileSelectionScreen.focusKey, "editor:copy-source");
    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(39));
    assert.equal(
      ProfileSelectionScreen.focusKey,
      "editor:category:all",
      "Right from copy-source must move to preferred picker control instead of trapping focus"
    );
  } finally {
    ProfileSelectionScreen.cleanup();
  }
});

test("Edit Profile editor without copy-source button still moves directly between name input and cancel", async () => {
  await ProfileSelectionScreen.mount({
    mode: "management",
    skipInitialProfileSync: true,
    profilePinEnabled: {}
  });
  try {
    ProfileSelectionScreen.openEditEditor(ProfileSelectionScreen.getProfileById("1"));
    assert.equal(container.querySelector("[data-focus-key='editor:copy-source']"), null);
    assert.equal(ProfileSelectionScreen.focusKey, "editor:name");

    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(40));
    assert.equal(ProfileSelectionScreen.focusKey, "editor:cancel");

    await ProfileSelectionScreen.onKeyDown(makeKeyEvent(38));
    assert.equal(ProfileSelectionScreen.focusKey, "editor:name");
  } finally {
    ProfileSelectionScreen.cleanup();
  }
});
