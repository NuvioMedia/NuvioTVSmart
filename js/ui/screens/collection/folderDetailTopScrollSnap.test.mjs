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

const { createFolderDetailScreenMethods02 } =
  await import("./folderDetailScreenMethods-02-load-tab.js");

function makeScreen(shell) {
  return {
    useHomeFollowLayout: false,
    savedScrollTop: Number(shell.scrollTop || 0),
    lastFocusedKey: "",
    heroItem: null,
    container: {
      querySelector: (selector) => (selector === ".seeall-shell" ? shell : null),
      querySelectorAll: () => []
    }
  };
}

function makeNode({
  closestMap = {},
  navRow = undefined,
  offsetTop = 0,
  offsetHeight = 200,
  focusKey = "k"
} = {}) {
  return {
    dataset: { ...(navRow === undefined ? {} : { navRow: String(navRow) }), focusKey },
    offsetTop,
    offsetHeight,
    classList: { add() {}, remove() {} },
    focus() {},
    querySelector: () => null,
    closest: (selector) => closestMap[selector] || null
  };
}

test("FolderDetailScreen.focusNode snaps the shell to the top for the first row and the tabs", () => {
  const methods = createFolderDetailScreenMethods02();

  // ROWS layout: row 0 sits below the 520px hero, so the 100px margin left the
  // header scrolled away. Focusing row 0 must restore the header.
  const shell = { scrollTop: 900, clientHeight: 900 };
  const screen = makeScreen(shell);
  const rowBox = {};
  const firstRowCard = makeNode({
    closestMap: { ".folder-detail-rows": rowBox },
    navRow: 0,
    offsetTop: 620,
    offsetHeight: 372,
    focusKey: "row:0:item:tt1"
  });
  assert.equal(methods.focusNode.call(screen, firstRowCard), true);
  assert.equal(shell.scrollTop, 0);
  assert.equal(screen.savedScrollTop, 0);
});

test("FolderDetailScreen.focusNode snaps the shell to the top when a tab pill gets focus", () => {
  const methods = createFolderDetailScreenMethods02();
  const shell = { scrollTop: 640, clientHeight: 900 };
  const screen = makeScreen(shell);
  const tabEl = {};
  const tab = makeNode({ closestMap: { ".folder-detail-tab": tabEl }, focusKey: "tab:0" });

  assert.equal(methods.focusNode.call(screen, tab), true);
  assert.equal(shell.scrollTop, 0);
  assert.equal(screen.savedScrollTop, 0);
});

test("FolderDetailScreen.focusNode keeps the 100px margin for rows below the first one", () => {
  const methods = createFolderDetailScreenMethods02();
  const shell = { scrollTop: 1200, clientHeight: 900 };
  const screen = makeScreen(shell);
  const rowBox = {};
  const midRowCard = makeNode({
    closestMap: { ".folder-detail-rows": rowBox },
    navRow: 3,
    offsetTop: 900,
    offsetHeight: 220,
    focusKey: "row:3:item:tt9"
  });

  assert.equal(methods.focusNode.call(screen, midRowCard), true);
  assert.equal(shell.scrollTop, 800);
  assert.equal(screen.savedScrollTop, 800);

  // Scroll up to a row whose bottom is above the viewport keeps the same margin.
  shell.scrollTop = 1600;
  screen.savedScrollTop = 1600;
  assert.equal(methods.focusNode.call(screen, midRowCard), true);
  assert.equal(shell.scrollTop, 800);
  assert.equal(screen.savedScrollTop, 800);
});
