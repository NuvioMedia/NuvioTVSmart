import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import * as cheerio from "cheerio";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;
const originalLocalStorage = globalThis.localStorage;
const originalGetComputedStyle = globalThis.getComputedStyle;
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

class FakeHTMLElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this._classes = new Set();
    this.listeners = new Map();
    this.tabIndex = -1;
    this.focused = false;
    this.scrollTop = 0;
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

  get childNodes() {
    return this.children;
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

  click() {
    this.clickCount = (this.clickCount || 0) + 1;
  }

  replaceChildren() {
    this.children = [];
    this._html = "";
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
    const matchesChain = (node, chain) => {
      const segments = chain.split(/\s+/).filter(Boolean);
      if (!segments.length || !matchesSimple(node, segments[segments.length - 1])) return false;
      let cursor = node.parentElement;
      for (let i = segments.length - 2; i >= 0; i -= 1) {
        while (cursor && !matchesSimple(cursor, segments[i])) {
          cursor = cursor.parentElement;
        }
        if (!cursor) return false;
        cursor = cursor.parentElement;
      }
      return true;
    };
    const walk = (nodes) => {
      for (const n of nodes) {
        if (parts.some((sel) => matchesChain(n, sel))) out.push(n);
        if (n.children?.length) walk(n.children);
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

function buildElementTreeFromHtml(html, rootParent = null) {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
  const convert = (el, parent) => {
    const node = new FakeHTMLElement(el.tagName || el.name || "div");
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

class FakeContainer extends FakeHTMLElement {
  constructor() {
    super("section");
    this._html = "";
    this.root = null;
  }

  set innerHTML(html) {
    this._html = String(html || "");
    this.root = buildElementTreeFromHtml(this._html, this);
    this.children = this.root.children;
    this.children.forEach((child) => {
      child.parentElement = this;
    });
  }

  get innerHTML() {
    return this._html;
  }
}

let docListeners = new Map();
let licensesContainer;

function setupDom() {
  docListeners = new Map();
  licensesContainer = new FakeContainer();
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#f5f5f5" });
  globalThis.window = {
    openCalls: [],
    open: (url, target) => globalThis.window.openCalls.push({ url, target })
  };
  globalThis.document = {
    body: { classList: { contains: () => false } },
    documentElement: { classList: { contains: () => false } },
    getElementById: (id) => (id === "licensesAttributions" ? licensesContainer : null),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      docListeners.get(type)?.delete(fn);
    }
  };
}

resetStorage();
setupDom();

const { I18n } = await import("../../../i18n/index.js");
const originalI18nT = I18n.t;
I18n.t = (key) => String(key);

const { LicensesAttributionsScreen } = await import("./licensesAttributionsScreen.js");

beforeEach(() => {
  resetStorage();
  setupDom();
});

after(() => {
  I18n.t = originalI18nT;
  globalThis.getComputedStyle = originalGetComputedStyle;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.HTMLElement = originalHTMLElement;
  globalThis.localStorage = originalLocalStorage;
});

test("LicensesAttributionsScreen assigns monotonic indices across sections and avoids duplicate document keydown binding", async () => {
  await LicensesAttributionsScreen.mount();
  try {
    assert.equal(
      docListeners.get("keydown")?.size || 0,
      0,
      "must not attach duplicate document keydown listener"
    );

    const rows = licensesContainer.querySelectorAll(".focusable");
    assert.ok(rows.length >= 10);
    rows.forEach((row, index) => {
      assert.equal(row.dataset.index, String(index));
    });

    assert.equal(rows[0].classList.contains("focused"), true);
    LicensesAttributionsScreen.onKeyDown({ keyCode: 40, preventDefault() {} });
    assert.equal(rows[1].classList.contains("focused"), true);
    LicensesAttributionsScreen.onKeyDown({ key: "ArrowDown", preventDefault() {} });
    assert.equal(
      rows[2].classList.contains("focused"),
      true,
      "focus must advance past item 1 (tmdb)"
    );
    LicensesAttributionsScreen.onKeyDown({ keyCode: 38, preventDefault() {} });
    assert.equal(rows[1].classList.contains("focused"), true);

    LicensesAttributionsScreen.onKeyDown({ keyCode: 13, preventDefault() {} });
    assert.equal(rows[1].clickCount, 1);
  } finally {
    LicensesAttributionsScreen.cleanup();
  }
});

test("LicensesAttributionsScreen scrolls the focused row into the viewport", async () => {
  await LicensesAttributionsScreen.mount();
  try {
    const rows = licensesContainer.querySelectorAll(".focusable");
    const scroller = licensesContainer.querySelector(".licenses-screen");
    rows[0].getBoundingClientRect = () => ({ top: 0, bottom: 80 });
    rows[1].getBoundingClientRect = () => ({ top: 520, bottom: 600 });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500 });

    LicensesAttributionsScreen.onKeyDown({ keyCode: 40, preventDefault() {} });

    assert.equal(rows[1].classList.contains("focused"), true);
    assert.equal(scroller.scrollTop, 108, "must scroll just enough to show the focused row");
  } finally {
    LicensesAttributionsScreen.cleanup();
  }
});
