import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";

const originalLocalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;
const originalGetComputedStyle = globalThis.getComputedStyle;

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    }
  };
}

class MockClassList {
  constructor(initial = []) {
    this._set = new Set(initial);
  }
  add(...names) {
    names.forEach((n) => this._set.add(n));
  }
  remove(...names) {
    names.forEach((n) => this._set.delete(n));
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this._set.has(name)) {
        this._set.delete(name);
        return false;
      }
      this._set.add(name);
      return true;
    }
    if (force) this._set.add(name);
    else this._set.delete(name);
    return Boolean(force);
  }
  contains(name) {
    return this._set.has(name);
  }
}

class MockElement {
  constructor({ tagName = "DIV", classes = [], dataset = {}, rect = null } = {}) {
    this.tagName = tagName;
    this.classList = new MockClassList(classes);
    this.dataset = { ...dataset };
    this.style = {};
    this.parentElement = null;
    this.children = [];
    this.disabled = false;
    this.scrollTop = 0;
    this.clientHeight = 0;
    this.scrollHeight = 0;
    this.scrollIntoViewCalls = [];
    this._rect = rect || { top: 0, left: 0, width: 200, height: 60, right: 200, bottom: 60 };
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  matches(selector) {
    const parts = String(selector || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.some((part) => {
      if (part.startsWith(".")) {
        const classes = part.slice(1).split(".");
        return classes.every((cls) => this.classList.contains(cls));
      }
      return this.tagName.toLowerCase() === part.toLowerCase();
    });
  }
  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  getBoundingClientRect() {
    return { ...this._rect };
  }
  focus() {}
  scrollIntoView(opts) {
    this.scrollIntoViewCalls.push(opts);
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

globalThis.localStorage = createStorage();
globalThis.HTMLElement = MockElement;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#f5f5f5" });
globalThis.window = {
  open() {},
  addEventListener() {},
  removeEventListener() {}
};
globalThis.document = {
  body: new MockElement({ tagName: "BODY" }),
  documentElement: new MockElement({ tagName: "HTML" }),
  activeElement: null,
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {}
};

const [
  { scrollFocusedIntoContainer },
  { PluginScreen },
  { PluginsScreen },
  { LicensesAttributionsScreen },
  { LibraryScreen },
  { PartyScreen }
] = await Promise.all([
  import("./scrollFocusedIntoContainer.js"),
  import("../screens/plugin/pluginScreen.js"),
  import("../screens/plugin/pluginsScreen.js"),
  import("../screens/settings/licensesAttributionsScreen.js"),
  import("../screens/library/libraryScreen.js"),
  import("../screens/party/partyScreen.js")
]);

beforeEach(() => {
  globalThis.localStorage = createStorage();
});

after(() => {
  globalThis.localStorage = originalLocalStorage;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.HTMLElement = originalHTMLElement;
  globalThis.getComputedStyle = originalGetComputedStyle;
});

test("scrollFocusedIntoContainer snaps to 0 for top row and scrolls padded bounds for lower rows", () => {
  const container = new MockElement({ rect: { top: 0, bottom: 500, left: 0, right: 1000 } });
  container.clientHeight = 500;
  container.scrollHeight = 1200;
  container.scrollTop = 340;

  const topRow = new MockElement({ rect: { top: 60, bottom: 140 } });
  scrollFocusedIntoContainer(container, topRow, { pad: 56, isTopRow: true });
  assert.equal(container.scrollTop, 0, "top row must reset scrollTop to 0");

  const belowRow = new MockElement({ rect: { top: 470, bottom: 560 } });
  scrollFocusedIntoContainer(container, belowRow, { pad: 56, isTopRow: false });
  assert.equal(container.scrollTop, 116, "lower row must scroll down with bottom pad");

  container.scrollTop = 300;
  const aboveRow = new MockElement({ rect: { top: 20, bottom: 100 } });
  scrollFocusedIntoContainer(container, aboveRow, { pad: 56, isTopRow: false });
  assert.equal(container.scrollTop, 264, "intermediate row near top must scroll up by pad delta");

  // Lightweight mock DOM without scrollHeight/clientHeight (e.g. LicensesAttributionsScreen test)
  const simpleScroller = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 500 })
  };
  const simpleRow = { getBoundingClientRect: () => ({ top: 520, bottom: 600 }) };
  scrollFocusedIntoContainer(simpleScroller, simpleRow, { pad: 8, isTopRow: false });
  assert.equal(simpleScroller.scrollTop, 108);
});

test("PluginScreen.ensureMainVisibility snaps .addons-main to 0 when returning to row 0", () => {
  const prevContainer = PluginScreen.container;
  const prevRowColumns = PluginScreen.rowColumns;
  try {
    const root = new MockElement();
    const main = new MockElement({
      classes: ["addons-main"],
      rect: { top: 0, bottom: 1080, left: 0, right: 1920 }
    });
    main.clientHeight = 1080;
    main.scrollHeight = 1480;
    main.scrollTop = 260;

    const row0 = new MockElement({
      classes: ["addons-large-row", "addons-focusable"],
      dataset: { row: "0", col: "0" },
      rect: { top: 90, bottom: 210 }
    });
    const row2 = new MockElement({
      classes: ["addons-large-row", "addons-focusable"],
      dataset: { row: "2", col: "0" },
      rect: { top: 1050, bottom: 1170 }
    });
    main.appendChild(row0);
    main.appendChild(row2);
    root.appendChild(main);

    PluginScreen.container = root;
    PluginScreen.rowColumns = new Map([
      [0, [0]],
      [1, [0]],
      [2, [0]]
    ]);

    PluginScreen.ensureMainVisibility(row0);
    assert.equal(main.scrollTop, 0, "focusing row 0 must snap .addons-main back to 0");

    PluginScreen.ensureMainVisibility(row2);
    assert.equal(main.scrollTop, 146, "focusing lower row must scroll down with 56px pad");
  } finally {
    PluginScreen.container = prevContainer;
    PluginScreen.rowColumns = prevRowColumns;
  }
});

test("PluginsScreen.ensureMainVisibility snaps .plugins-main to 0 for first card in editable and readOnly modes", () => {
  const prevContainer = PluginsScreen.container;
  try {
    const root = new MockElement();
    const main = new MockElement({
      classes: ["plugins-main"],
      rect: { top: 0, bottom: 1080, left: 0, right: 1920 }
    });
    main.clientHeight = 1080;
    main.scrollHeight = 1800;
    main.scrollTop = 240;

    const addCard = new MockElement({
      classes: ["plugins-settings-card"],
      rect: { top: 70, bottom: 220 }
    });
    const addInput = new MockElement({
      tagName: "INPUT",
      classes: ["plugins-focusable"],
      dataset: { focusKey: "add:input" },
      rect: { top: 130, bottom: 190 }
    });
    const addSubmit = new MockElement({
      tagName: "BUTTON",
      classes: ["plugins-focusable"],
      dataset: { focusKey: "add:submit" },
      rect: { top: 130, bottom: 190 }
    });
    addCard.appendChild(addInput);
    addCard.appendChild(addSubmit);

    const toggleCard = new MockElement({
      classes: ["plugins-settings-card", "plugins-focusable"],
      dataset: { focusKey: "global:enabled" },
      rect: { top: 260, bottom: 380 }
    });
    main.appendChild(addCard);
    main.appendChild(toggleCard);
    root.appendChild(main);

    PluginsScreen.container = root;
    PluginsScreen.ensureMainVisibility(addSubmit);
    assert.equal(
      main.scrollTop,
      0,
      "focusing any control in the topmost settings card must snap .plugins-main to 0"
    );

    // Confirm readOnly layout where global:enabled is the topmost focusable card
    const roRoot = new MockElement();
    const roMain = new MockElement({
      classes: ["plugins-main"],
      rect: { top: 0, bottom: 1080, left: 0, right: 1920 }
    });
    roMain.clientHeight = 1080;
    roMain.scrollHeight = 1600;
    roMain.scrollTop = 220;
    const roToggle = new MockElement({
      classes: ["plugins-settings-card", "plugins-focusable"],
      dataset: { focusKey: "global:enabled" },
      rect: { top: 80, bottom: 200 }
    });
    roMain.appendChild(roToggle);
    roRoot.appendChild(roMain);
    PluginsScreen.container = roRoot;

    PluginsScreen.ensureMainVisibility(roToggle);
    assert.equal(
      roMain.scrollTop,
      0,
      "focusing topmost card in readOnly mode must snap .plugins-main to 0"
    );
  } finally {
    PluginsScreen.container = prevContainer;
  }
});

test("LicensesAttributionsScreen.revealFocused snaps .licenses-screen to 0 on row 0 while preserving row 1 scroll", () => {
  const prevContainer = LicensesAttributionsScreen.container;
  try {
    const root = new MockElement();
    const scroller = new MockElement({
      classes: ["licenses-screen"],
      rect: { top: 0, bottom: 500, left: 0, right: 1000 }
    });
    scroller.scrollTop = 260;

    const row0 = new MockElement({
      tagName: "BUTTON",
      classes: ["license-row", "focusable", "focused"],
      dataset: { index: "0" },
      rect: { top: 40, bottom: 120 }
    });
    const row1 = new MockElement({
      tagName: "BUTTON",
      classes: ["license-row", "focusable"],
      dataset: { index: "1" },
      rect: { top: 520, bottom: 600 }
    });
    scroller.appendChild(row0);
    scroller.appendChild(row1);
    root.appendChild(scroller);

    LicensesAttributionsScreen.container = root;
    LicensesAttributionsScreen.revealFocused();
    assert.equal(scroller.scrollTop, 0, "returning focus to row 0 must snap .licenses-screen to 0");

    row0.classList.remove("focused");
    row1.classList.add("focused");
    LicensesAttributionsScreen.revealFocused();
    assert.equal(scroller.scrollTop, 108, "lower rows keep 8px viewport reveal margin");
  } finally {
    LicensesAttributionsScreen.container = prevContainer;
  }
});

test("LibraryScreen.setFocusedNode snaps .library-main to 0 on view-mode tabs and preserves modal scrollIntoView", () => {
  const prevContainer = LibraryScreen.container;
  const prevLayoutPrefs = LibraryScreen.layoutPrefs;
  const prevController = LibraryScreen.controller;
  const prevIsSidebar = LibraryScreen.isSidebarNode;
  try {
    const root = new MockElement();
    const main = new MockElement({
      classes: ["home-main", "library-main"],
      rect: { top: 0, bottom: 1080, left: 0, right: 1920 }
    });
    main.clientHeight = 1080;
    main.scrollHeight = 2000;
    main.scrollTop = 380;

    const tabRow = new MockElement({ classes: ["library-view-mode-row"] });
    const tabSaved = new MockElement({
      tagName: "BUTTON",
      classes: ["library-view-mode-button", "focusable"],
      rect: { top: 80, bottom: 140 }
    });
    tabRow.appendChild(tabSaved);

    const posterCard = new MockElement({
      tagName: "ARTICLE",
      classes: ["library-grid-card", "focusable"],
      dataset: { focusKey: "movie:tt1" },
      rect: { top: 1040, bottom: 1260 }
    });

    const pickerMenu = new MockElement({ classes: ["library-picker-menu"] });
    const pickerOption = new MockElement({
      tagName: "BUTTON",
      classes: ["library-picker-option", "focusable"],
      rect: { top: 300, bottom: 360 }
    });
    pickerMenu.appendChild(pickerOption);

    const dialogBtn = new MockElement({
      tagName: "BUTTON",
      classes: ["library-manage-list-button", "focusable"],
      rect: { top: 400, bottom: 460 }
    });

    main.appendChild(tabRow);
    main.appendChild(posterCard);
    main.appendChild(pickerMenu);
    root.appendChild(main);
    root.appendChild(dialogBtn);

    LibraryScreen.container = root;
    LibraryScreen.layoutPrefs = { modernSidebar: true };
    LibraryScreen.controller = { setFocusedPosterKey() {} };
    LibraryScreen.isSidebarNode = () => false;

    LibraryScreen.setFocusedNode(tabSaved);
    assert.equal(main.scrollTop, 0, "focusing a top view-mode tab must snap .library-main to 0");

    LibraryScreen.setFocusedNode(posterCard);
    assert.equal(
      main.scrollTop,
      236,
      "focusing a lower poster card must scroll .library-main down"
    );

    const beforeModalScroll = main.scrollTop;
    LibraryScreen.setFocusedNode(pickerOption);
    assert.equal(
      main.scrollTop,
      beforeModalScroll,
      "picker dropdown option must not move .library-main"
    );
    assert.equal(pickerOption.scrollIntoViewCalls.length, 1);

    LibraryScreen.setFocusedNode(dialogBtn);
    assert.equal(
      main.scrollTop,
      beforeModalScroll,
      "modal dialog focus must not move .library-main"
    );
    assert.equal(dialogBtn.scrollIntoViewCalls.length, 1);
  } finally {
    LibraryScreen.container = prevContainer;
    LibraryScreen.layoutPrefs = prevLayoutPrefs;
    LibraryScreen.controller = prevController;
    LibraryScreen.isSidebarNode = prevIsSidebar;
  }
});

test("PartyScreen snaps .party-overview-right to 0 when focus returns to top action via Up or restoreFocus", () => {
  const prevContainer = PartyScreen.container;
  const prevMode = PartyScreen.mode;
  try {
    const root = new MockElement();
    const scroller = new MockElement({
      classes: ["party-overview-right"],
      rect: { top: 0, bottom: 700, left: 800, right: 1800 }
    });
    scroller.clientHeight = 700;
    scroller.scrollHeight = 1300;
    scroller.scrollTop = 290;

    const watchBtn = new MockElement({
      tagName: "BUTTON",
      classes: ["settings-action-row", "party-action-row", "focusable"],
      dataset: { focusKey: "action:watch", partyAction: "watch" },
      rect: { top: 40, bottom: 140, width: 800, height: 100 }
    });
    const leaveBtn = new MockElement({
      tagName: "BUTTON",
      classes: ["settings-action-row", "party-action-row", "focusable", "focused"],
      dataset: { focusKey: "action:leave", partyAction: "leave" },
      rect: { top: 160, bottom: 260, width: 800, height: 100 }
    });
    scroller.appendChild(watchBtn);
    scroller.appendChild(leaveBtn);
    root.appendChild(scroller);

    PartyScreen.container = root;
    PartyScreen.mode = () => "party";

    // ArrowUp from leave -> watch via moveListFocus
    PartyScreen.onKeyDown({ keyCode: 38, preventDefault() {} });
    assert.equal(watchBtn.classList.contains("focused"), true);
    assert.equal(
      scroller.scrollTop,
      0,
      "pressing Up back to first party action must snap .party-overview-right to 0"
    );

    // Also verify restoreFocus resets scrollTop when re-rendering on watch
    scroller.scrollTop = 210;
    PartyScreen.restoreFocus("action:watch");
    assert.equal(
      scroller.scrollTop,
      0,
      "restoreFocus on first party action must snap .party-overview-right to 0"
    );
  } finally {
    PartyScreen.container = prevContainer;
    PartyScreen.mode = prevMode;
  }
});

test("addons-main-centered avoids unsafe align-items: center top overflow on scrollable hero", async () => {
  const css = await readFile(new URL("../../../css/components-27.css", import.meta.url), "utf8");
  const mainBlock = css.match(/\.addons-main-centered\s*\{([^}]*)\}/);
  const panelBlock = css.match(/\.addons-panel-centered\s*\{([^}]*)\}/);
  assert.ok(mainBlock, "expected .addons-main-centered rule in css/components-27.css");
  assert.ok(panelBlock, "expected .addons-panel-centered rule in css/components-27.css");
  assert.doesNotMatch(
    mainBlock[1],
    /align-items\s*:\s*center\b/,
    ".addons-main-centered must not use align-items: center (pushes top heading into unreachable negative scroll overflow)"
  );
  assert.match(
    panelBlock[1],
    /margin\s*:\s*auto\b/,
    ".addons-panel-centered should use margin: auto for safe flex centering without top clipping"
  );
});
