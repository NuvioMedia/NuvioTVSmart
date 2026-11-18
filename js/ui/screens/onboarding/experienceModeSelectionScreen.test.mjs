import test from "node:test";
import assert from "node:assert/strict";

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }
  add(...names) {
    names.forEach((name) => this.tokens.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.tokens.delete(name));
  }
  contains(name) {
    return this.tokens.has(name);
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.tokens.has(name)) {
        this.tokens.delete(name);
        return false;
      }
      this.tokens.add(name);
      return true;
    }
    if (force) {
      this.tokens.add(name);
      return true;
    }
    this.tokens.delete(name);
    return false;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.id = "";
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.parentNode = null;
    this.tabIndex = -1;
    this.listeners = new Map();
    this._innerHTML = "";
  }

  set innerHTML(html) {
    this._innerHTML = String(html || "");
    this.children = [];
    const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    let match;
    while ((match = buttonRegex.exec(this._innerHTML)) !== null) {
      const attrs = match[1] || "";
      const button = new FakeElement("button", this.ownerDocument);
      button.parentNode = this;
      const classMatch = attrs.match(/\bclass="([^"]*)"/i);
      if (classMatch) {
        classMatch[1]
          .split(/\s+/)
          .filter(Boolean)
          .forEach((token) => button.classList.add(token));
      }
      const attrRegex = /\bdata-([a-z0-9-]+)="([^"]*)"/gi;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        const camel = attrMatch[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        button.dataset[camel] = attrMatch[2];
        button.attributes[`data-${attrMatch[1]}`] = attrMatch[2];
      }
      this.children.push(button);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  get childNodes() {
    return this.children;
  }

  replaceChildren() {
    this.children = [];
    this._innerHTML = "";
  }

  addEventListener(type, listener, capture = false) {
    const key = `${type}:${Boolean(capture)}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(listener);
  }

  removeEventListener(type, listener, capture = false) {
    const key = `${type}:${Boolean(capture)}`;
    const list = this.listeners.get(key);
    if (!list) return;
    this.listeners.set(
      key,
      list.filter((entry) => entry !== listener)
    );
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child.contains(target));
  }

  closest(selector) {
    const parts = selector
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    let node = this;
    while (node) {
      const matches = parts.some((part) => {
        const attrMatch = part.match(/^\[data-([a-z0-9-]+)\]$/i);
        if (attrMatch) {
          const camel = attrMatch[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          return node.dataset?.[camel] !== undefined;
        }
        if (part.startsWith(".")) {
          return node.classList?.contains(part.slice(1));
        }
        return false;
      });
      if (matches) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const classes = (selector.match(/\.[a-zA-Z0-9_-]+/g) || []).map((token) => token.slice(1));
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (classes.every((token) => child.classList.contains(token))) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  click() {
    const clickListeners = this.ownerDocument.containers.flatMap((container) =>
      container.contains(this) ? container.listeners.get("click:false") || [] : []
    );
    const event = { target: this };
    for (const listener of clickListeners) {
      listener(event);
    }
  }
}

function createDomEnvironment() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.HTMLElement = FakeElement;

  const containers = {};
  const docListeners = { capture: new Map(), bubble: new Map() };
  const doc = {
    activeElement: null,
    containers: [],
    documentElement: new FakeElement("html", null),
    body: new FakeElement("body", null),
    getElementById(id) {
      return containers[id] || null;
    },
    contains(target) {
      if (!target) return false;
      return this.containers.some((container) => container.contains(target));
    },
    addEventListener(type, listener, capture = false) {
      const bucket = capture ? docListeners.capture : docListeners.bubble;
      if (!bucket.has(type)) {
        bucket.set(type, []);
      }
      bucket.get(type).push(listener);
    },
    removeEventListener(type, listener, capture = false) {
      const bucket = capture ? docListeners.capture : docListeners.bubble;
      const list = bucket.get(type);
      if (!list) return;
      bucket.set(
        type,
        list.filter((entry) => entry !== listener)
      );
    },
    listenerCount(type) {
      return (
        (docListeners.capture.get(type)?.length || 0) + (docListeners.bubble.get(type)?.length || 0)
      );
    },
    dispatchKeyDown(eventInit) {
      let stoppedImmediate = false;
      let stoppedPropagation = false;
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          stoppedPropagation = true;
        },
        stopImmediatePropagation() {
          stoppedImmediate = true;
          stoppedPropagation = true;
        },
        ...eventInit
      };
      for (const listener of [...(docListeners.capture.get("keydown") || [])]) {
        if (stoppedImmediate) break;
        listener(event);
      }
      if (!stoppedPropagation) {
        for (const listener of [...(docListeners.bubble.get("keydown") || [])]) {
          if (stoppedImmediate) break;
          listener(event);
        }
      }
      return event;
    }
  };
  doc.documentElement.ownerDocument = doc;
  doc.body.ownerDocument = doc;

  for (const id of ["experienceModeSelection", "essentialAddonSetup"]) {
    const el = new FakeElement("div", doc);
    el.id = id;
    el.style.display = "none";
    containers[id] = el;
    doc.containers.push(el);
  }

  globalThis.document = doc;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    location: { href: "", search: "" },
    matchMedia: () => ({ matches: false, addEventListener: () => {} })
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0" },
    configurable: true
  });

  return { doc, containers, docListeners, storage };
}

const env = createDomEnvironment();

const { FocusEngine } = await import("../../navigation/focusEngine.js");
const { Router } = await import("../../navigation/routerState.js");
const { ExperienceModeSelectionScreen } = await import("./experienceModeSelectionScreen.js");
const { EssentialAddonSetupScreen } = await import("./essentialAddonSetupScreen.js");
const { ProfileManager } = await import("../../../core/profile/profileManager.js");
const { ProfileSettingsSyncService } =
  await import("../../../core/profile/profileSettingsSyncService.js");
const { addonRepository } = await import("../../../data/repository/addonRepository.js");
const { LayoutPreferences } = await import("../../../data/local/layoutPreferences.js");
const { ExperienceModeStore } = await import("../../../data/local/experienceModeStore.js");

ProfileManager.getActiveProfileId = () => "1";
ProfileSettingsSyncService.push = async () => {};
addonRepository.getInstalledAddons = async () => [];

FocusEngine.init();

test("Enter on Advanced stays on layout step, ArrowRight focuses Grid without skipping, and Back returns to mode", async () => {
  const navigations = [];
  let backCalls = 0;
  Router.current = "experienceModeSelection";
  Router.getCurrentScreen = () => ExperienceModeSelectionScreen;
  Router.navigate = async (route, params, options) => {
    navigations.push({ route, params, options });
  };
  Router.back = () => {
    backCalls += 1;
  };
  Router.suppressNextPopstate = () => {};
  Router.consumeRouteReturnBackGuard = () => false;

  const container = env.containers.experienceModeSelection;
  await ExperienceModeSelectionScreen.mount();

  assert.equal(ExperienceModeSelectionScreen.step, "mode");
  assert.equal(env.doc.listenerCount("keydown"), 1, "only FocusEngine should listen for keydown");

  // Move from Essential (0) to Advanced (1).
  env.doc.dispatchKeyDown({
    key: "ArrowRight",
    keyCode: 39,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.querySelector(".focusable.focused")?.dataset.mode, "ADVANCED");

  // Press Enter on Advanced: must stop on layout step with Modern focused, NOT click Modern immediately.
  env.doc.dispatchKeyDown({
    key: "Enter",
    keyCode: 13,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ExperienceModeSelectionScreen.step, "layout");
  assert.equal(navigations.length, 0);
  assert.equal(container.querySelector(".focusable.focused")?.dataset.layout, "modern");

  // Single ArrowRight in layout step must move from modern (0) to grid (1), NOT skip to classic (2).
  env.doc.dispatchKeyDown({
    key: "ArrowRight",
    keyCode: 39,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.querySelector(".focusable.focused")?.dataset.layout, "grid");

  // Next ArrowRight moves to classic (2); ArrowLeft moves back to grid (1).
  env.doc.dispatchKeyDown({
    key: "ArrowRight",
    keyCode: 39,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.querySelector(".focusable.focused")?.dataset.layout, "classic");

  env.doc.dispatchKeyDown({
    key: "ArrowLeft",
    keyCode: 37,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.querySelector(".focusable.focused")?.dataset.layout, "grid");

  // Back is owned by FocusEngine: like Android TV (mode screen popped from the stack), it leaves onboarding.
  FocusEngine.lastBackHandledAt = 0;
  env.doc.dispatchKeyDown({
    key: "Escape",
    keyCode: 27,
    target: container.querySelector(".focusable.focused")
  });
  FocusEngine.activeBackKeyIdentities.clear();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backCalls, 1);
  assert.equal(ExperienceModeSelectionScreen.step, "layout");

  ExperienceModeSelectionScreen.cleanup();
  await ExperienceModeSelectionScreen.mount();

  // Re-enter layout step, select Grid, verify layout preference saved & navigates to home once.
  env.doc.dispatchKeyDown({
    key: "ArrowRight",
    keyCode: 39,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  env.doc.dispatchKeyDown({
    key: "Enter",
    keyCode: 13,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  env.doc.dispatchKeyDown({
    key: "ArrowRight",
    keyCode: 39,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  env.doc.dispatchKeyDown({
    key: "Enter",
    keyCode: 13,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(LayoutPreferences.getForProfile("1").homeLayout, "grid");
  assert.equal(ExperienceModeStore.getForProfile("1").mode, "ADVANCED");
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].route, "home");

  ExperienceModeSelectionScreen.cleanup();
  assert.equal(env.doc.listenerCount("keydown"), 1);
});

test("EssentialAddonSetupScreen avoids duplicate keydown dispatch on ArrowRight and Enter", async () => {
  const navigations = [];
  Router.current = "essentialAddonSetup";
  Router.getCurrentScreen = () => EssentialAddonSetupScreen;
  Router.navigate = async (route, params, options) => {
    navigations.push({ route, params, options });
  };

  const container = env.containers.essentialAddonSetup;
  await EssentialAddonSetupScreen.mount();
  assert.equal(env.doc.listenerCount("keydown"), 1, "only FocusEngine should listen for keydown");
  assert.equal(container.querySelector(".focusable.focused")?.dataset.action, "addons");

  env.doc.dispatchKeyDown({
    key: "ArrowRight",
    keyCode: 39,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.querySelector(".focusable.focused")?.dataset.action, "skip");

  env.doc.dispatchKeyDown({
    key: "Enter",
    keyCode: 13,
    target: container.querySelector(".focusable.focused")
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(navigations.length, 1, "Enter must trigger navigation exactly once");
  assert.equal(navigations[0].route, "home");

  EssentialAddonSetupScreen.cleanup();
  assert.equal(env.doc.listenerCount("keydown"), 1);
});
