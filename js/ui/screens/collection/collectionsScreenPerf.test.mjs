import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  beginReorder,
  cancelReorder,
  confirmReorder,
  createReorderSession,
  isReordering,
  moveReorderBy
} from "../../components/reorderSession.js";

const screenSource = (await readFile(new URL("./collectionsScreen.js", import.meta.url), "utf8"))
  .replace(/^import [\s\S]*?";\r?\n/gm, "")
  .replace(/^export const CollectionsScreen =/m, "const CollectionsScreen =");

const buildScreenFactory = new Function(
  "Router",
  "ScreenUtils",
  "CollectionsStore",
  "NuvioDialog",
  "beginReorder",
  "cancelReorder",
  "confirmReorder",
  "createReorderSession",
  "isReordering",
  "moveReorderBy",
  "I18n",
  "document",
  `${screenSource}\nreturn CollectionsScreen;`
);

function createMockClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    contains: (name) => set.has(name)
  };
}

function parseButtonsFromMarkup(html) {
  const buttons = [];
  const regex = /<button\b([^>]*)>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const classMatch = attrs.match(/class="([^"]*)"/);
    const classes = classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [];
    const dataset = {};
    const dataRegex = /data-([a-z0-9-]+)="([^"]*)"/g;
    let dm;
    while ((dm = dataRegex.exec(attrs)) !== null) {
      const camel = dm[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      dataset[camel] = dm[2];
    }
    const listeners = new Map();
    const button = {
      dataset,
      classList: createMockClassList(classes),
      scrollIntoViewCalls: [],
      focusCalls: 0,
      focus() {
        this.focusCalls += 1;
      },
      scrollIntoView(opts) {
        this.scrollIntoViewCalls.push(opts);
        if (typeof this._onScrollIntoView === "function") {
          this._onScrollIntoView(opts);
        }
      },
      closest(selector) {
        if (
          selector === ".collections-focusable" &&
          this.classList.contains("collections-focusable")
        ) {
          return this;
        }
        return null;
      },
      addEventListener(type, fn) {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      click() {
        for (const fn of listeners.get("click") || []) {
          fn({ target: this });
        }
      }
    };
    buttons.push(button);
  }
  return buttons;
}

function createHarness(initialCollections) {
  let stored = JSON.parse(JSON.stringify(initialCollections));
  const storeCalls = { get: 0, replace: 0 };
  const containerListeners = new Map();
  let containerAddListenerCalls = 0;
  let containerRemoveListenerCalls = 0;
  let scrollTopObservedDuringScrollIntoView = [];
  let mainEl = null;
  let buttons = [];
  let htmlValue = "";

  const container = {
    get innerHTML() {
      return htmlValue;
    },
    set innerHTML(nextHtml) {
      htmlValue = String(nextHtml || "");
      mainEl = htmlValue.includes("collections-main") ? { scrollTop: 0 } : null;
      buttons = parseButtonsFromMarkup(htmlValue);
      buttons.forEach((btn) => {
        btn._onScrollIntoView = () => {
          scrollTopObservedDuringScrollIntoView.push(mainEl ? mainEl.scrollTop : null);
        };
      });
    },
    querySelector(selector) {
      if (selector === ".collections-main") {
        return mainEl;
      }
      if (selector === ".collections-focusable.focused") {
        return (
          buttons.find(
            (b) => b.classList.contains("collections-focusable") && b.classList.contains("focused")
          ) || null
        );
      }
      if (selector === ".collections-focusable") {
        return buttons.find((b) => b.classList.contains("collections-focusable")) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".collections-focusable.focused") {
        return buttons.filter(
          (b) => b.classList.contains("collections-focusable") && b.classList.contains("focused")
        );
      }
      if (selector === ".collections-focusable") {
        return buttons.filter((b) => b.classList.contains("collections-focusable"));
      }
      return [];
    },
    contains(node) {
      return buttons.includes(node);
    },
    addEventListener(type, fn) {
      containerAddListenerCalls += 1;
      const list = containerListeners.get(type) || [];
      list.push(fn);
      containerListeners.set(type, list);
    },
    removeEventListener(type, fn) {
      containerRemoveListenerCalls += 1;
      const list = (containerListeners.get(type) || []).filter((entry) => entry !== fn);
      containerListeners.set(type, list);
    },
    dispatchClick(target) {
      for (const fn of containerListeners.get("click") || []) {
        fn({ target });
      }
      target.click();
    }
  };

  const CollectionsStore = {
    get() {
      storeCalls.get += 1;
      return JSON.parse(JSON.stringify(stored));
    },
    replace(next) {
      storeCalls.replace += 1;
      stored = JSON.parse(JSON.stringify(next));
      return JSON.parse(JSON.stringify(stored));
    },
    removeCollection(id) {
      stored = stored.filter((c) => c.id !== id);
    }
  };

  const ScreenUtils = {
    show() {},
    hide() {},
    handleDpadNavigation(event, root, selector = ".collections-focusable") {
      const code = Number(event?.keyCode || 0);
      if (code !== 38 && code !== 40) {
        return false;
      }
      const list = root.querySelectorAll(selector);
      const current = root.querySelector(`${selector}.focused`);
      const index = Math.max(0, list.indexOf(current));
      const next = list[Math.max(0, Math.min(list.length - 1, index + (code === 40 ? 1 : -1)))];
      if (!next) {
        return false;
      }
      event?.preventDefault?.();
      current?.classList.remove("focused");
      next.classList.add("focused");
      return true;
    }
  };

  const screen = buildScreenFactory(
    { async navigate() {} },
    ScreenUtils,
    CollectionsStore,
    class NuvioDialog {},
    beginReorder,
    cancelReorder,
    confirmReorder,
    createReorderSession,
    isReordering,
    moveReorderBy,
    { t: (_k, _p, opts) => opts?.fallback || "" },
    {
      body: {},
      getElementById(id) {
        return id === "collections" ? container : null;
      }
    }
  );

  return {
    screen,
    container,
    storeCalls,
    getStored: () => stored,
    getMain: () => mainEl,
    getButtons: () => buttons,
    getScrollTopObserved: () => scrollTopObservedDuringScrollIntoView,
    resetScrollObserved: () => {
      scrollTopObservedDuringScrollIntoView = [];
    },
    getContainerListenerCounts: () => ({
      add: containerAddListenerCalls,
      remove: containerRemoveListenerCalls
    })
  };
}

const SAMPLE_COLLECTIONS = [
  { id: "c1", title: "Discover", pinToTop: true, folders: [{ id: "f1" }] },
  { id: "c2", title: "Streaming", pinToTop: true, folders: [{ id: "f2" }] },
  { id: "c3", title: "Genres", pinToTop: false, folders: [{ id: "f3" }] }
];

test("moveCollection reorders in-memory without persisting until finishReorder", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();
  h.storeCalls.get = 0;
  h.storeCalls.replace = 0;

  h.screen.startReorder("c1");
  h.screen.moveCollection(1);
  h.screen.moveCollection(1);

  assert.deepEqual(
    h.screen.collections.map((c) => c.id),
    ["c2", "c3", "c1"],
    "UI list reflects live reordered items"
  );
  assert.equal(h.storeCalls.replace, 0, "intermediate moves must not write to CollectionsStore");
  assert.deepEqual(
    h.getStored().map((c) => c.id),
    ["c1", "c2", "c3"],
    "persisted store stays untouched until reorder is confirmed"
  );

  h.screen.finishReorder();
  assert.equal(h.storeCalls.replace, 1, "confirming reorder persists once");
  assert.deepEqual(
    h.getStored().map((c) => c.id),
    ["c2", "c3", "c1"]
  );
  assert.equal(h.screen.focusKey, "collection:c1:reorder");
  h.screen.cleanup();
});

test("canceling reorder reverts list without calling CollectionsStore.replace", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();
  h.storeCalls.replace = 0;

  h.screen.startReorder("c1");
  h.screen.moveCollection(1);
  assert.equal(h.storeCalls.replace, 0);

  assert.equal(h.screen.consumeBackRequest(), true);
  assert.equal(h.storeCalls.replace, 0, "canceling reorder must not trigger a store write");
  assert.deepEqual(
    h.screen.collections.map((c) => c.id),
    ["c1", "c2", "c3"]
  );
  assert.equal(h.screen.focusKey, "collection:c1:reorder");
  h.screen.cleanup();
});

test("render preserves .collections-main scrollTop before applyFocus runs", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();

  h.getMain().scrollTop = 340;
  h.resetScrollObserved();

  h.screen.startReorder("c2");
  assert.equal(h.getMain().scrollTop, 340, "startReorder render must preserve scrollTop");
  assert.deepEqual(
    h.getScrollTopObserved(),
    [340],
    "scrollTop must be restored before scrollIntoView"
  );

  h.resetScrollObserved();
  h.screen.moveCollection(1);
  assert.equal(h.getMain().scrollTop, 340, "moveCollection render must preserve scrollTop");
  assert.deepEqual(h.getScrollTopObserved(), [340]);
  h.screen.cleanup();
});

test("delegated click listener is bound once across renders and removed on cleanup", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();
  h.screen.startReorder("c1");
  h.screen.moveCollection(1);
  h.screen.finishReorder();

  assert.equal(
    h.getContainerListenerCounts().add,
    1,
    "click listener should be delegated once per mount"
  );

  const c2ReorderBtn = h
    .getButtons()
    .find((btn) => btn.dataset.focusKey === "collection:c2:reorder");
  assert.ok(c2ReorderBtn);
  h.container.dispatchClick(c2ReorderBtn);
  assert.equal(h.screen.reorderSession?.movingKey, "c2");

  h.screen.cleanup();
  assert.equal(
    h.getContainerListenerCounts().remove,
    1,
    "cleanup must remove delegated click listener"
  );
});

test("confirming a move that did not change the order does not persist", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();
  h.storeCalls.replace = 0;

  h.screen.startReorder("c1");
  h.screen.finishReorder();

  assert.equal(h.storeCalls.replace, 0, "an unchanged order must not trigger a store write");
  h.screen.cleanup();
});

test("confirming keeps collections added to the store while the move was open", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();

  h.screen.startReorder("c1");
  h.screen.moveCollection(1);
  h.getStored().push({ id: "c4", title: "Synced", pinToTop: false, folders: [] });
  h.screen.finishReorder();

  assert.deepEqual(
    h.getStored().map((c) => c.id),
    ["c2", "c1", "c3", "c4"],
    "the session order is applied without dropping collections synced in meanwhile"
  );
  h.screen.cleanup();
});

test("focusing the topmost control or reordering a collection to index 0 snaps .collections-main scrollTop to 0", async () => {
  const h = createHarness(SAMPLE_COLLECTIONS);
  await h.screen.mount();

  // Navigate down to row 0 edit button, simulate scrolled container, then press Up back to "+ New Collection"
  await h.screen.onKeyDown({ keyCode: 40, preventDefault() {} });
  assert.notEqual(h.screen.focusKey, "new");
  h.getMain().scrollTop = 340;
  h.resetScrollObserved();

  await h.screen.onKeyDown({ keyCode: 38, preventDefault() {} });
  assert.equal(h.screen.focusKey, "new");
  assert.equal(
    h.getMain().scrollTop,
    0,
    "returning focus to + New Collection must snap .collections-main scrollTop to 0"
  );

  // During active reorder, moving a collection up into slot 0 must also reveal the page header
  h.getMain().scrollTop = 340;
  h.screen.startReorder("c2");
  assert.equal(h.getMain().scrollTop, 340, "reordering non-top slot preserves scrollTop");

  h.screen.moveCollection(-1);
  assert.equal(h.screen.collections[0].id, "c2");
  assert.equal(
    h.getMain().scrollTop,
    0,
    "moving a collection into slot 0 during reorder must snap .collections-main scrollTop to 0"
  );
  h.screen.cleanup();
});
