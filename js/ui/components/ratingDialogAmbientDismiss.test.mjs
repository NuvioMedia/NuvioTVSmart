import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
  setItem: (key, value) => storage.set(String(key), String(value)),
  removeItem: (key) => storage.delete(String(key))
};

function createClassList(owner) {
  const set = new Set();
  return {
    add: (...tokens) => {
      tokens.forEach((t) => t && set.add(t));
      owner.className = Array.from(set).join(" ");
    },
    remove: (...tokens) => {
      tokens.forEach((t) => set.delete(t));
      owner.className = Array.from(set).join(" ");
    },
    contains: (token) => set.has(token),
    toggle: (token, force) => {
      const next = force == null ? !set.has(token) : Boolean(force);
      if (next) set.add(token);
      else set.delete(token);
      owner.className = Array.from(set).join(" ");
      return next;
    }
  };
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = { setProperty: () => {} };
    this.attributes = new Map();
    this.listeners = new Map();
    this._className = "";
    this.classList = createClassList(this);
    this.disabled = false;
    this.tabIndex = -1;
    this.textContent = "";
    this.innerHTML = "";
    this.offsetWidth = 10;
    this.focusCalls = 0;
  }
  set className(value) {
    this._className = String(value || "");
  }
  get className() {
    return this._className || "";
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((n) => n !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  focus() {
    this.focusCalls += 1;
    globalThis.document.activeElement = this;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (String(child.className || "").includes(String(selector).replace(/^\./, ""))) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

const docListeners = new Map();
const winListeners = new Map();
const bodyEl = new MockElement("body");
let rafQueue = [];

globalThis.HTMLElement = MockElement;
globalThis.document = {
  body: bodyEl,
  documentElement: new MockElement("html"),
  activeElement: null,
  createElement: (tag) => new MockElement(tag),
  querySelector: (sel) => bodyEl.querySelector(sel),
  querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
  addEventListener: (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, new Set());
    docListeners.get(type).add(fn);
  },
  removeEventListener: (type, fn) => {
    docListeners.get(type)?.delete(fn);
  },
  dispatchEvent: (event) => {
    Array.from(docListeners.get(event.type) || []).forEach((fn) => fn(event));
    return true;
  }
};
globalThis.window = {
  addEventListener: (type, fn) => {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type).add(fn);
  },
  removeEventListener: (type, fn) => {
    winListeners.get(type)?.delete(fn);
  },
  dispatchEvent: (event) => {
    Array.from(winListeners.get(event.type) || []).forEach((fn) => fn(event));
    return true;
  },
  navigator: { language: "en-US", languages: ["en-US"] }
};
globalThis.requestAnimationFrame = (cb) => rafQueue.push(cb);
globalThis.cancelAnimationFrame = () => {};

const { NuvioDialog } = await import("./nuvioDialog.js");
const { openRatingDialog } = await import("./ratingDialog.js");

test("ratingDialog ignores onBack on ambient dismiss while preserving Back dismiss and NuvioDialog destroy frame guard", () => {
  rafQueue = [];
  const detachedTarget = new MockElement("button");
  const destroyedEarly = new NuvioDialog({ title: "Destroyed" }).mount(bodyEl);
  destroyedEarly._focusIndex = () => detachedTarget.focus();
  destroyedEarly.destroy();
  rafQueue.splice(0, rafQueue.length).forEach((cb) => cb());
  assert.equal(detachedTarget.focusCalls, 0);

  let ambientBackCalls = 0;
  const ambientDialog = openRatingDialog({
    media: { id: "tt1234", type: "movie" },
    title: "Test Movie",
    state: { rating: 8, provider: "trakt" },
    onBack: () => {
      ambientBackCalls += 1;
    }
  });
  assert.equal(ambientDialog.isOpen, true);
  globalThis.document.dispatchEvent({ type: "nuvio:ambient-shown" });
  assert.equal(ambientDialog.isOpen, false);
  assert.equal(ambientBackCalls, 0);

  let backCalls = 0;
  const backDialog = openRatingDialog({
    media: { id: "tt1234", type: "movie" },
    title: "Test Movie",
    state: { rating: 8, provider: "trakt" },
    onBack: () => {
      backCalls += 1;
    }
  });
  globalThis.window.dispatchEvent({
    type: "keydown",
    key: "Escape",
    keyCode: 27,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  assert.equal(backDialog.isOpen, false);
  assert.equal(backCalls, 1);
  rafQueue.splice(0, rafQueue.length).forEach((cb) => cb());
});
