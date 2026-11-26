import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;
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

function setupDom() {
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
    body: { classList: { contains: () => false, add() {}, remove() {} } },
    documentElement: { style: {}, classList: { contains: () => false, add() {}, remove() {} } },
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    contains: () => true
  };
}

resetStorage();
setupDom();

const { CollectionEditorScreen } = await import("./collectionEditorScreen.js");

const originalRender = CollectionEditorScreen.render;
let renderCalls = 0;

beforeEach(() => {
  resetStorage();
  setupDom();
  renderCalls = 0;
  CollectionEditorScreen.render = () => {
    renderCalls += 1;
  };
  CollectionEditorScreen.unsavedDialog = null;
  CollectionEditorScreen.deleteDialog = null;
  CollectionEditorScreen.textDialog = null;
  CollectionEditorScreen.reorderSession = null;
  CollectionEditorScreen.reorderTarget = "";
  CollectionEditorScreen.reorderOriginalFolders = null;
  CollectionEditorScreen.reorderOriginalSources = null;
  CollectionEditorScreen.reorderSourceKeys = null;
  CollectionEditorScreen.focusKey = "";
  CollectionEditorScreen.view = "folder";
  CollectionEditorScreen.draft = {
    id: "col-1",
    title: "My Collection",
    folders: [
      { id: "f1", title: "One", sources: [] },
      { id: "f2", title: "Two", sources: [] },
      { id: "f3", title: "Three", sources: [] }
    ]
  };
  CollectionEditorScreen.editingFolder = {
    id: "f1",
    title: "One",
    sources: [
      { provider: "addon", addonId: "a", type: "movie", catalogId: "1", title: "Alpha" },
      { provider: "addon", addonId: "b", type: "movie", catalogId: "2", title: "Beta" },
      { provider: "addon", addonId: "c", type: "movie", catalogId: "3", title: "Gamma" }
    ]
  };
});

after(() => {
  CollectionEditorScreen.render = originalRender;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.localStorage = originalLocalStorage;
  if (originalNavigator !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true
    });
  }
});

test("multi-step source reorder preserves source identity and updates focusKey to current index on move and confirm", () => {
  CollectionEditorScreen.startSourceReorder(0);
  assert.equal(CollectionEditorScreen.focusKey, "source:0:reorder");

  CollectionEditorScreen.moveSourceReorder(1);
  assert.deepEqual(
    CollectionEditorScreen.editingFolder.sources.map((source) => source.title),
    ["Beta", "Alpha", "Gamma"]
  );
  assert.equal(
    CollectionEditorScreen.focusKey,
    "source:1:reorder",
    "focusKey must follow moved source to index 1"
  );

  CollectionEditorScreen.moveSourceReorder(1);
  assert.deepEqual(
    CollectionEditorScreen.editingFolder.sources.map((source) => source.title),
    ["Beta", "Gamma", "Alpha"],
    "second move must use stable source keys instead of scrambling current array positions"
  );
  assert.equal(
    CollectionEditorScreen.focusKey,
    "source:2:reorder",
    "focusKey must follow moved source to index 2"
  );

  CollectionEditorScreen.finishSourceReorder();
  assert.equal(CollectionEditorScreen.reorderSession, null);
  assert.equal(CollectionEditorScreen.reorderSourceKeys, null);
  assert.deepEqual(
    CollectionEditorScreen.editingFolder.sources.map((source) => source.title),
    ["Beta", "Gamma", "Alpha"]
  );
  assert.equal(
    CollectionEditorScreen.focusKey,
    "source:2:reorder",
    "confirming reorder must keep focus on the moved source's final index"
  );
  assert.ok(renderCalls >= 4);
});

test("canceling source reorder via consumeBackRequest reverts order and restores focus to original source reorder button", () => {
  CollectionEditorScreen.startSourceReorder(1);
  CollectionEditorScreen.moveSourceReorder(1);
  assert.deepEqual(
    CollectionEditorScreen.editingFolder.sources.map((source) => source.title),
    ["Alpha", "Gamma", "Beta"]
  );

  const consumed = CollectionEditorScreen.consumeBackRequest();
  assert.equal(consumed, true);
  assert.equal(CollectionEditorScreen.reorderSession, null);
  assert.deepEqual(
    CollectionEditorScreen.editingFolder.sources.map((source) => source.title),
    ["Alpha", "Beta", "Gamma"]
  );
  assert.equal(
    CollectionEditorScreen.focusKey,
    "source:1:reorder",
    "canceling source reorder must restore focus to source:1:reorder instead of nonexistent addSource"
  );
});

test("canceling folder reorder via consumeBackRequest reverts folder order and restores focus to cancelled folder", () => {
  CollectionEditorScreen.view = "main";
  CollectionEditorScreen.startFolderReorder(1);
  CollectionEditorScreen.moveFolderReorder(1);
  assert.deepEqual(
    CollectionEditorScreen.draft.folders.map((folder) => folder.id),
    ["f1", "f3", "f2"]
  );

  const consumed = CollectionEditorScreen.consumeBackRequest();
  assert.equal(consumed, true);
  assert.equal(CollectionEditorScreen.reorderSession, null);
  assert.deepEqual(
    CollectionEditorScreen.draft.folders.map((folder) => folder.id),
    ["f1", "f2", "f3"]
  );
  assert.equal(
    CollectionEditorScreen.focusKey,
    "folder:f2:reorder",
    "canceling folder reorder must restore focus to the cancelled folder's reorder button"
  );
});
