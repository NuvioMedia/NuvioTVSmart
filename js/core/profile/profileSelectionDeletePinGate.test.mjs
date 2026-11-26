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
    this.focused = false;
    this.isConnected = true;
    this.offsetWidth = 100;
  }

  get className() {
    return Array.from(this._classes).join(" ");
  }

  set className(value) {
    this._classes = new Set(
      String(value || "")
        .split(/\s+/)
        .filter(Boolean)
    );
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

  get firstChild() {
    return this.children[0] || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camel] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, ref) {
    child.parentElement = this;
    child.parentNode = this;
    const idx = this.children.indexOf(ref);
    if (idx === -1) this.children.push(child);
    else this.children.splice(idx, 0, child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
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
    this.focused = true;
    globalThis.document.activeElement = this;
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let container;
let body;

function setupDom() {
  container = new FakeContainer();
  body = new FakeElement("body");
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
    body,
    activeElement: null,
    documentElement: { style: {}, classList: { contains: () => false, add() {}, remove() {} } },
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => (id === "profileSelection" ? container : null),
    querySelector: (selector) => body.querySelector(selector) || container.querySelector(selector),
    querySelectorAll: (selector) => [
      ...body.querySelectorAll(selector),
      ...container.querySelectorAll(selector)
    ],
    addEventListener: () => {},
    removeEventListener: () => {},
    contains: (node) => node === container || container.contains(node) || body.contains(node)
  };
}

resetStorage();
setupDom();

const { ProfileManager } = await import("./profileManager.js");
const { ProfileSyncService } = await import("./profileSyncService.js");
const { ProfileSettingsCopyService } = await import("./profileSettingsCopyService.js");
const { MemberAccessRepository } =
  await import("../../data/remote/supabase/memberAccessRepository.js");
const { ProfileBackgroundRepository } =
  await import("../../data/remote/supabase/profileBackgroundRepository.js");
const { I18n } = await import("../../i18n/index.js");
const { ProfileSelectionScreen, Router } = await import("./profileSelectionScreen.js");

const originalGetProfiles = ProfileManager.getProfiles;
const originalGetActiveProfileId = ProfileManager.getActiveProfileId;
const originalVerifyProfilePin = ProfileSyncService.verifyProfilePin;
const originalCopyProfileSettings = ProfileSettingsCopyService.copyProfileSettings;
const originalMemberGetCurrent = MemberAccessRepository.getCurrentAccess;
const originalMemberSubscribe = MemberAccessRepository.subscribe;
const originalBgSubscribe = ProfileBackgroundRepository.subscribe;
const originalI18nT = I18n.t;

function sampleProfiles() {
  return [
    { id: "1", name: "Main", isPrimary: true, avatarColorHex: "#1E88E5" },
    { id: "2", name: "Kids", isPrimary: false, avatarColorHex: "#E53935" }
  ];
}

function clickDialogButton(dialog, key) {
  const button = dialog?._buttonEls?.find((el) => el.dataset.key === key);
  assert.ok(button, `expected dialog button with key "${key}"`);
  button.dispatchEvent("click");
}

async function mountScreen(profilePinEnabled = { 1: true, 2: true }) {
  await ProfileSelectionScreen.mount({
    mode: "management",
    skipInitialProfileSync: true,
    profilePinEnabled
  });
}

beforeEach(() => {
  resetStorage();
  setupDom();
  Router.getCurrent = () => "profileSelection";
  I18n.t = (_key, _params, fallback) =>
    typeof fallback === "string" ? fallback : fallback?.fallback || _key;
  ProfileManager.getProfiles = async () => sampleProfiles();
  ProfileManager.getActiveProfileId = () => "1";
  ProfileSyncService.verifyProfilePin = async (_profileId, pin) => ({
    unlocked: pin === "1234",
    retryAfterSeconds: 0
  });
  ProfileSettingsCopyService.copyProfileSettings = async () => true;
  MemberAccessRepository.getCurrentAccess = () => ({ entitlements: [] });
  MemberAccessRepository.subscribe = () => () => {};
  ProfileBackgroundRepository.subscribe = () => () => {};
});

after(async () => {
  ProfileSelectionScreen.cleanup();
  await waitMs(220);
  ProfileManager.getProfiles = originalGetProfiles;
  ProfileManager.getActiveProfileId = originalGetActiveProfileId;
  ProfileSyncService.verifyProfilePin = originalVerifyProfilePin;
  ProfileSettingsCopyService.copyProfileSettings = originalCopyProfileSettings;
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

test("Profile Options gates Delete behind verify-delete PIN for locked profiles", async () => {
  await mountScreen({ 1: false, 2: true });
  try {
    const kids = ProfileSelectionScreen.getProfileById("2");

    await ProfileSelectionScreen.openOptionsDialog(kids);
    clickDialogButton(ProfileSelectionScreen._optionsDialog, "delete");

    assert.equal(
      ProfileSelectionScreen._deleteDialog,
      null,
      "Delete must not open before PIN verification"
    );
    assert.equal(ProfileSelectionScreen.pinOverlayState?.type, "verify-delete");
    assert.equal(ProfileSelectionScreen.pinOverlayState?.profileId, "2");
    assert.match(
      container.querySelector(".profile-pin-heading")?.textContent || "",
      /Enter current PIN to delete Kids\./
    );

    await ProfileSelectionScreen.submitCompletedPin("0000");
    assert.equal(ProfileSelectionScreen._deleteDialog, null, "wrong PIN must keep Delete blocked");
    assert.ok(ProfileSelectionScreen.pinOverlayError, "wrong PIN must show an error");

    await ProfileSelectionScreen.submitCompletedPin("1234");
    await waitMs(300);
    assert.ok(
      ProfileSelectionScreen._deleteDialog,
      "Delete confirmation opens after PIN verification"
    );
    assert.equal(ProfileSelectionScreen.deleteProfileId, "2");

    ProfileSelectionScreen.consumeBackRequest();
    await waitMs(300);
    assert.equal(
      ProfileSelectionScreen._deleteDialog,
      null,
      "canceling the confirmation aborts Delete"
    );
    assert.equal(
      ProfileSelectionScreen.pinOverlayState,
      null,
      "PIN overlay must not be left mounted"
    );
  } finally {
    ProfileSelectionScreen.cleanup();
  }
});

test("Delete on an unlocked profile opens the confirmation dialog without a PIN prompt", async () => {
  await mountScreen({ 1: false, 2: false });
  try {
    const kids = ProfileSelectionScreen.getProfileById("2");
    await ProfileSelectionScreen.openOptionsDialog(kids);
    clickDialogButton(ProfileSelectionScreen._optionsDialog, "delete");

    assert.equal(ProfileSelectionScreen.pinOverlayState, null);
    assert.ok(ProfileSelectionScreen._deleteDialog);
    assert.equal(ProfileSelectionScreen.deleteProfileId, "2");
  } finally {
    ProfileSelectionScreen.cleanup();
  }
});

test("dismissing Profile Options opened by a long press does not swallow the next Enter", async () => {
  await ProfileSelectionScreen.mount({
    mode: "selection",
    skipInitialProfileSync: true,
    profilePinEnabled: { 1: false, 2: true }
  });
  try {
    const card =
      container.querySelector(".profile-card.focused") ||
      container.querySelector("[data-profile-id='1']");
    assert.ok(card, "expected a focused profile card");
    card.classList.add("focused");

    assert.equal(ProfileSelectionScreen.startPendingProfileHold(card), true);
    await waitMs(700);
    assert.ok(ProfileSelectionScreen._optionsDialog, "hold must open Profile Options");
    assert.equal(
      ProfileSelectionScreen.pendingProfileHoldTarget,
      null,
      "the opening hold must be cleared so its release cannot activate the profile"
    );

    await ProfileSelectionScreen.onKeyUp({
      keyCode: 13,
      keyDownDurationMs: 0,
      preventDefault() {}
    });
    ProfileSelectionScreen._optionsDialog._dismiss();
    await waitMs(250);
    assert.equal(ProfileSelectionScreen._optionsDialog, null);

    await ProfileSelectionScreen.onKeyDown({
      keyCode: 13,
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(
      ProfileSelectionScreen.pendingProfileHoldTarget?.profileId,
      "1",
      "next Enter after dismissing Profile Options must not be swallowed"
    );
    ProfileSelectionScreen.cancelPendingProfileHold();
  } finally {
    ProfileSelectionScreen.cleanup();
  }
});

test("cleanup closes copy-settings dialogs and blocks result dialog after unmount during async copy", async () => {
  const copyGate = deferred();
  ProfileSettingsCopyService.copyProfileSettings = () => copyGate.promise;

  await mountScreen({ 1: false, 2: false });
  try {
    const main = ProfileSelectionScreen.getProfileById("1");
    const kids = ProfileSelectionScreen.getProfileById("2");

    ProfileSelectionScreen.openProfileCopySourceDialog(kids);
    assert.ok(ProfileSelectionScreen._copySettingsDialog);
    ProfileSelectionScreen._destroyDialogs();
    assert.equal(ProfileSelectionScreen._copySettingsDialog, null);

    const pendingCopy = ProfileSelectionScreen.applyProfileCopy(main, kids, false);
    ProfileSelectionScreen.cleanup();
    copyGate.resolve(true);
    await pendingCopy;

    assert.equal(
      ProfileSelectionScreen._copySettingsDialog,
      null,
      "unmounted screen must not mount a completion dialog after copy resolves"
    );
  } finally {
    copyGate.resolve(true);
    ProfileSelectionScreen.cleanup();
  }
});
