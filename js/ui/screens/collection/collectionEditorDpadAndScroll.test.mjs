import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ScreenUtils } from "../../navigation/screen.js";
import * as editorModel from "../../../core/collections/collectionEditorModel.js";
import {
  beginReorder,
  cancelReorder,
  confirmReorder,
  createReorderSession,
  isReordering,
  moveReorderBy
} from "../../components/reorderSession.js";

const editorSource = (
  await readFile(new URL("./collectionEditorScreen.js", import.meta.url), "utf8")
)
  .replace(/^import [\s\S]*?";\r?\n/gm, "")
  .replace(/^export const CollectionEditorScreen =/m, "const CollectionEditorScreen =");

const MODEL_KEYS = [
  "COLLECTION_TILE_SHAPES",
  "COLLECTION_VIEW_MODES",
  "TMDB_PRESETS",
  "TMDB_SORT_OPTIONS",
  "TRAKT_SORTS",
  "TRAKT_SORT_HOWS",
  "addSourceToFolder",
  "addSourcesToFolder",
  "buildAddonCatalogSource",
  "buildTmdbCollectionSource",
  "buildTraktListSource",
  "buildTmdbSourcesFromState",
  "buildTraktSourcesFromState",
  "canSaveCollectionDraft",
  "createEmptyCollectionDraft",
  "createEmptyFolderDraft",
  "createTmdbSourceState",
  "createTraktSourceState",
  "emptyTmdbFilters",
  "moveSourceInFolder",
  "nextInList",
  "normalizeTmdbDraftFilters",
  "parseNumericSourceId",
  "removeSourceFromFolder",
  "replaceSourceInFolder",
  "sourceIdentity",
  "tmdbModeUsesFilters",
  "tmdbModeUsesMediaControls",
  "tmdbSortOptionsForMode",
  "titleWithMediaSuffix",
  "toggleCatalogSource"
];

const buildEditorFactory = new Function(
  "Router",
  "ScreenUtils",
  "CollectionsStore",
  "CollectionPosterShape",
  "addonRepository",
  "NuvioDialog",
  "beginReorder",
  "cancelReorder",
  "confirmReorder",
  "createReorderSession",
  "isReordering",
  "moveReorderBy",
  "I18n",
  "collectionSourceResolver",
  "document",
  ...MODEL_KEYS,
  `${editorSource}\nreturn CollectionEditorScreen;`
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
  let rowIndex = 0;
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
    const top = rowIndex * 100;
    rowIndex += 1;
    const button = {
      dataset,
      classList: createMockClassList(classes),
      scrollIntoViewCalls: [],
      focus() {},
      getBoundingClientRect() {
        return { left: 96, top, width: 1400, height: 80, right: 1496, bottom: top + 80 };
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
      addEventListener() {}
    };
    buttons.push(button);
  }
  return buttons;
}

function createEditorHarness(existingCollections = []) {
  const storeCalls = { get: 0, replace: 0 };
  let mainEl = null;
  let buttons = [];
  let htmlValue = "";
  let scrollTopObservedDuringScrollIntoView = [];
  const containerListeners = new Map();

  const container = {
    style: { display: "none" },
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
      const list = containerListeners.get(type) || [];
      list.push(fn);
      containerListeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = (containerListeners.get(type) || []).filter((entry) => entry !== fn);
      containerListeners.set(type, list);
    }
  };

  const CollectionsStore = {
    generateId: () => "generated-id",
    get() {
      storeCalls.get += 1;
      return JSON.parse(JSON.stringify(existingCollections));
    },
    replace() {
      storeCalls.replace += 1;
    }
  };

  const doc = {
    body: { classList: createMockClassList() },
    getElementById(id) {
      return id === "collectionEditor" ? container : null;
    }
  };

  const screen = buildEditorFactory(
    { async back() {} },
    ScreenUtils,
    CollectionsStore,
    { POSTER: "POSTER", LANDSCAPE: "LANDSCAPE", SQUARE: "SQUARE" },
    { getInstalledAddons: async () => [] },
    class NuvioDialog {},
    beginReorder,
    cancelReorder,
    confirmReorder,
    createReorderSession,
    isReordering,
    moveReorderBy,
    { t: (_k, _p, opts) => opts?.fallback || "" },
    {},
    doc,
    ...MODEL_KEYS.map((key) => editorModel[key])
  );

  return {
    screen,
    container,
    storeCalls,
    getMain: () => mainEl,
    getButtons: () => buttons,
    getHtml: () => htmlValue,
    getScrollTopObserved: () => scrollTopObservedDuringScrollIntoView,
    resetScrollObserved: () => {
      scrollTopObservedDuringScrollIntoView = [];
    }
  };
}

const SAMPLE_COLLECTION = {
  id: "col-1",
  title: "Discover",
  backdropImageUrl: null,
  pinToTop: true,
  focusGlowEnabled: true,
  viewMode: "FOLLOW_LAYOUT",
  showAllTab: true,
  folders: [
    {
      id: "f-1",
      title: "Recommended",
      coverImageUrl: "https://example.com/cover.jpg",
      heroBackdropUrl: "https://example.com/backdrop.jpg",
      titleLogoUrl: "https://example.com/logo.png",
      tileShape: "LANDSCAPE",
      hideTitle: false,
      sources: []
    },
    {
      id: "f-2",
      title: "Popular",
      tileShape: "LANDSCAPE",
      hideTitle: false,
      sources: []
    }
  ]
};

test("D-pad navigation calls preventDefault, updates focusKey, and scrolls focused item into view", async () => {
  const h = createEditorHarness([SAMPLE_COLLECTION]);
  await h.screen.mount({ collectionId: "col-1" });
  assert.equal(h.screen.focusKey, "title");

  let prevented = false;
  await h.screen.onKeyDown({
    keyCode: 40,
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(
    prevented,
    true,
    "arrow key must call preventDefault to stop native scroll conflict"
  );
  assert.equal(h.screen.focusKey, "backdropImageUrl", "focusKey must track the newly focused row");
  const focused = h.container.querySelector(".collections-focusable.focused");
  assert.equal(focused?.dataset?.focusKey, "backdropImageUrl");
  assert.deepEqual(focused?.scrollIntoViewCalls, [{ block: "nearest" }]);

  // Subsequent re-render (e.g. toggling a field) must stay on the navigated focusKey.
  h.screen.toggleField("pinToTop");
  assert.equal(h.screen.focusKey, "backdropImageUrl");
  assert.equal(
    h.container.querySelector(".collections-focusable.focused")?.dataset?.focusKey,
    "backdropImageUrl"
  );
  h.screen.cleanup();
});

test("same-view render preserves .collections-main scrollTop while view switch resets it to 0", async () => {
  const h = createEditorHarness([SAMPLE_COLLECTION]);
  await h.screen.mount({ collectionId: "col-1" });

  // Focus a non-top control before scrolling down and toggling a field
  await h.screen.onKeyDown({ keyCode: 40, preventDefault() {} });
  assert.equal(h.screen.focusKey, "backdropImageUrl");

  h.getMain().scrollTop = 410;
  h.resetScrollObserved();

  h.screen.toggleField("pinToTop");
  assert.equal(h.getMain().scrollTop, 410, "same-view render must preserve scrollTop");
  assert.deepEqual(
    h.getScrollTopObserved(),
    [410],
    "scrollTop must be restored before scrollIntoView"
  );

  h.getMain().scrollTop = 410;
  h.resetScrollObserved();
  h.screen.openFolderEditor(0);
  assert.equal(
    h.getMain().scrollTop,
    0,
    "switching to folder view must not inherit main view scrollTop"
  );
  h.screen.cleanup();
});

test("returning focus to the topmost control snaps .collections-main scrollTop to 0 across views", async () => {
  const h = createEditorHarness([SAMPLE_COLLECTION]);
  await h.screen.mount({ collectionId: "col-1" });

  // Main editor view: Down -> scroll -> Up back to "title"
  await h.screen.onKeyDown({ keyCode: 40, preventDefault() {} });
  assert.equal(h.screen.focusKey, "backdropImageUrl");
  h.getMain().scrollTop = 360;
  await h.screen.onKeyDown({ keyCode: 38, preventDefault() {} });
  assert.equal(h.screen.focusKey, "title");
  assert.equal(
    h.getMain().scrollTop,
    0,
    "returning to title in main view must snap .collections-main scrollTop to 0"
  );

  // Folder editor view: Down -> scroll -> Up back to "folderTitle"
  h.screen.openFolderEditor(0);
  const firstFolderKey = h.screen.focusKey;
  await h.screen.onKeyDown({ keyCode: 40, preventDefault() {} });
  assert.notEqual(h.screen.focusKey, firstFolderKey);
  h.getMain().scrollTop = 280;
  await h.screen.onKeyDown({ keyCode: 38, preventDefault() {} });
  assert.equal(h.screen.focusKey, firstFolderKey);
  assert.equal(
    h.getMain().scrollTop,
    0,
    "returning to first control in folder view must snap .collections-main scrollTop to 0"
  );

  // Picker view (emoji picker): navigate away -> scroll -> applyFocus back to first control
  h.screen.openEmojiPicker();
  const firstPickerKey = h.screen.focusKey;
  await h.screen.onKeyDown({ keyCode: 40, preventDefault() {} });
  assert.notEqual(h.screen.focusKey, firstPickerKey);
  h.getMain().scrollTop = 220;
  await h.screen.onKeyDown({ keyCode: 38, preventDefault() {} });
  assert.equal(h.screen.focusKey, firstPickerKey);
  assert.equal(
    h.getMain().scrollTop,
    0,
    "returning to first control in picker view must snap .collections-main scrollTop to 0"
  );
  h.screen.cleanup();
});

test("renderMainEditor caches isNew from mount instead of cloning CollectionsStore on every render", async () => {
  const h = createEditorHarness([SAMPLE_COLLECTION]);
  await h.screen.mount({ collectionId: "col-1" });
  h.storeCalls.get = 0;

  h.screen.render();
  h.screen.render();
  h.screen.render();

  assert.equal(
    h.storeCalls.get,
    0,
    "repeated main editor renders must not call CollectionsStore.get()"
  );
  h.screen.cleanup();
});

test("folder editor preview images use async decoding", async () => {
  const h = createEditorHarness([SAMPLE_COLLECTION]);
  await h.screen.mount({ collectionId: "col-1" });
  h.screen.openFolderEditor(0);

  const imgTags = h.getHtml().match(/<img\b[^>]*collections-preview[^>]*>/g) || [];
  assert.equal(imgTags.length, 3, "expected cover, backdrop, and logo preview images");
  for (const tag of imgTags) {
    assert.match(
      tag,
      /\bdecoding="async"/,
      `preview image should specify decoding="async": ${tag}`
    );
  }
  h.screen.cleanup();
});
