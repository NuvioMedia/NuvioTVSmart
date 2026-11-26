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

test("FolderDetailScreen.restoreFocus escapes quotes and backslashes in lastFocusedKey selector", () => {
  const methods = createFolderDetailScreenMethods02();
  const targetNode = {
    dataset: { focusKey: 'item:tt"123\\45' },
    classList: { add() {}, remove() {} }
  };
  let focusedNode = null;
  const seenSelectors = [];

  const ctx = {
    useHomeFollowLayout: false,
    lastFocusedKey: 'item:tt"123\\45',
    savedScrollTop: 0,
    restoredTrackScrollStates: {},
    findRestoredFocusedItem: () => null,
    focusNode: (node) => {
      focusedNode = node;
    },
    container: {
      querySelector(selector) {
        seenSelectors.push(selector);
        if (selector.startsWith(".focusable[data-focus-key=")) {
          const inner = selector.slice('.focusable[data-focus-key="'.length, -2);
          // Match DOM querySelector parsing: unescaped quotes break attribute literal parsing.
          for (let i = 0; i < inner.length; i += 1) {
            if (inner[i] === '"') {
              const prev = i > 0 ? inner[i - 1] : "";
              if (prev !== "\\") {
                throw new SyntaxError(`Invalid CSS selector: ${selector}`);
              }
            }
          }
          if (inner === 'item:tt\\"123\\\\45') {
            return targetNode;
          }
        }
        return null;
      },
      querySelectorAll: () => []
    }
  };

  methods.restoreFocus.call(ctx);
  assert.equal(
    focusedNode,
    targetNode,
    "restoreFocus must escape quotes and backslashes and focus the matched node"
  );
  assert.ok(seenSelectors.some((s) => s.includes('\\"') && s.includes("\\\\")));
});
