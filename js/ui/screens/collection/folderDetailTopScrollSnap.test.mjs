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

function makeNode({
  closestMap = {},
  navRow = "-1",
  offsetTop = 0,
  offsetHeight = 200,
  focusKey = "k"
} = {}) {
  return {
    dataset: { navRow: String(navRow), focusKey },
    offsetTop,
    offsetHeight,
    classList: { add() {}, remove() {} },
    focus() {},
    querySelector: () => null,
    closest(selector) {
      return closestMap[selector] || null;
    }
  };
}

test("FolderDetailScreen.focusNode resets shell.scrollTop and savedScrollTop on top row and tab nodes", () => {
  const methods = createFolderDetailScreenMethods02();
  const shell = { scrollTop: 640, clientHeight: 900 };
  const rowContainer = {};
  const tabEl = {};

  const ctxWithTabs = {
    useHomeFollowLayout: false,
    savedScrollTop: 640,
    lastFocusedKey: "",
    heroItem: null,
    applyHeroToDom() {},
    container: {
      querySelector(selector) {
        if (selector === ".seeall-shell") return shell;
        if (selector === ".folder-detail-tab.focusable") return tabEl;
        return null;
      },
      querySelectorAll: () => []
    }
  };

  // Focusing a tab pill while the shell is scrolled down must snap scrollTop back to 0.
  const tabNode = makeNode({
    closestMap: { ".folder-detail-tab": tabEl },
    focusKey: "tab:0"
  });
  assert.equal(methods.focusNode.call(ctxWithTabs, tabNode), true);
  assert.equal(shell.scrollTop, 0);
  assert.equal(ctxWithTabs.savedScrollTop, 0);

  // Focusing row 0 in rows layout without tabs must also snap scrollTop back to 0.
  shell.scrollTop = 480;
  const ctxNoTabs = {
    ...ctxWithTabs,
    savedScrollTop: 480,
    container: {
      querySelector(selector) {
        if (selector === ".seeall-shell") return shell;
        return null;
      },
      querySelectorAll: () => []
    }
  };
  const topRowPoster = makeNode({
    closestMap: { ".folder-detail-rows": rowContainer, ".seeall-grid": rowContainer },
    navRow: "0",
    offsetTop: 320,
    offsetHeight: 220,
    focusKey: "item:top"
  });
  assert.equal(methods.focusNode.call(ctxNoTabs, topRowPoster), true);
  assert.equal(shell.scrollTop, 0);
  assert.equal(ctxNoTabs.savedScrollTop, 0);
});
