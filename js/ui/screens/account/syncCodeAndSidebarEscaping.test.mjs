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
    this.value = "";
    this.focused = false;
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
      if (k === "value") node.value = v;
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

let accountContainer;

function setupDom() {
  accountContainer = new FakeContainer();
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#f5f5f5" });
  globalThis.window = {
    openCalls: [],
    open: (url, target) => globalThis.window.openCalls.push({ url, target })
  };
  globalThis.document = {
    body: { classList: { contains: () => false } },
    documentElement: { classList: { contains: () => false } },
    getElementById: (id) => (id === "account" ? accountContainer : null),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

resetStorage();
setupDom();

const { I18n } = await import("../../../i18n/index.js");
const originalI18nT = I18n.t;
I18n.t = (key, params = {}) =>
  key === "auth.syncCode.currentCode" ? `Current: ${params?.value || ""}` : String(key);

const { SyncCodeScreen } = await import("./syncCodeScreen.js");
const { renderLegacySidebar, renderModernSidebar } =
  await import("../../components/sidebarNavigationHelpers-02-get-sidebar-avatar-catalog.js");

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

test("SyncCodeScreen escapes current code XSS, scopes D-pad to text dialog, and resets textDialog on cleanup", async () => {
  const payload = `<img src=x onerror=alert(1)>`;
  globalThis.localStorage.setItem("manualSyncCode", JSON.stringify(payload));

  await SyncCodeScreen.mount();
  const $ = cheerio.load(accountContainer.innerHTML);
  assert.equal($("img[onerror]").length, 0, "HTML payload must be escaped in sync code display");
  assert.ok($(".auth-simple-subtitle").text().includes(payload));

  SyncCodeScreen.textDialog = true;
  SyncCodeScreen.render();
  const dialogNode = accountContainer.querySelector(".settings-dialog");
  assert.ok(dialogNode);
  const dialogFocusables = accountContainer.querySelectorAll(".settings-dialog .focusable");
  assert.equal(dialogFocusables.length, 3);
  dialogFocusables.forEach((node, index) => {
    assert.equal(node.dataset.index, String(index));
  });

  accountContainer.querySelectorAll(".focusable").forEach((n, idx) => {
    n.getBoundingClientRect = () => ({ left: 100, width: 200, top: idx * 50, height: 40 });
  });
  dialogFocusables[0].getBoundingClientRect = () => ({
    left: 100,
    width: 200,
    top: 300,
    height: 40
  });
  dialogFocusables[1].getBoundingClientRect = () => ({
    left: 100,
    width: 200,
    top: 380,
    height: 40
  });
  dialogFocusables[2].getBoundingClientRect = () => ({
    left: 100,
    width: 200,
    top: 440,
    height: 40
  });

  // Pressing ArrowUp from dialog input (topmost inside dialog) must NOT jump to background hero buttons.
  SyncCodeScreen.onKeyDown({ keyCode: 38, preventDefault() {} });
  assert.equal(dialogFocusables[0].classList.contains("focused"), true);
  assert.equal(accountContainer.querySelectorAll(".auth-simple-card.focused").length, 0);

  SyncCodeScreen.cleanup();
  assert.equal(SyncCodeScreen.textDialog, false);
});

test("renderLegacySidebar and renderModernSidebar escape profile XSS payloads and sanitize CSS colors", () => {
  const maliciousProfile = {
    showProfileSelector: true,
    activeProfileName: `<script>xss()</script>" onclick="bad()`,
    activeProfileInitial: `"><img src=x onerror=1>`,
    activeProfileColorHex: `red;background:url(javascript:alert(1))`,
    activeProfileAvatarUrl: `https://cdn.example/a.png" onload="evil()`
  };

  for (const renderFn of [renderLegacySidebar, renderModernSidebar]) {
    const html = renderFn({ selectedRoute: `home" onmouseover="x()`, profile: maliciousProfile });
    const $ = cheerio.load(html);
    assert.equal($("script").length, 0);
    assert.equal($("img[onerror], img[onload]").length, 0);
    const avatarStyle =
      $(".home-profile-avatar, .modern-sidebar-profile-avatar").attr("style") || "";
    assert.ok(
      !avatarStyle.includes("javascript:"),
      `Injected URL leaked into style: ${avatarStyle}`
    );
    assert.equal($("[data-selected-route]").attr("data-selected-route"), `home" onmouseover="x()`);
    assert.equal(
      $(".home-profile-name, .modern-sidebar-profile-name").text(),
      maliciousProfile.activeProfileName
    );
  }
});
