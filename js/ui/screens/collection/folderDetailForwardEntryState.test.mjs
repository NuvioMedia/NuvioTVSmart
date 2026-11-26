import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const methods01Source = (
  await readFile(
    new URL("./folderDetailScreenMethods-01-get-route-state-key.js", import.meta.url),
    "utf8"
  )
)
  .replace(/^import \* as internals from .*;$/m, "")
  .replace("export function ", "function ");

const buildMethods01 = new Function(
  "internals",
  "document",
  "setTimeout",
  "clearTimeout",
  `${methods01Source}\nreturn createFolderDetailScreenMethods01();`
);

function createFolderDetailHarness() {
  const container = { innerHTML: "" };
  const loadedTabCalls = [];
  let renderCount = 0;

  const collection = {
    id: "c1",
    title: "Discover",
    viewMode: "FOLLOW_LAYOUT",
    showAllTab: false,
    folders: [
      {
        id: "f1",
        title: "Recommended",
        sources: [
          { provider: "addon", addonId: "a1", type: "movie", catalogId: "top-picks" },
          { provider: "addon", addonId: "a1", type: "movie", catalogId: "comedy-sequel" }
        ]
      }
    ]
  };

  const doc = {
    getElementById(id) {
      return id === "folderDetail" ? container : null;
    }
  };

  const api = buildMethods01(
    {
      Router: { getCurrent: () => "folderDetail" },
      ScreenUtils: { show() {} },
      addonRepository: { getInstalledAddons: async () => [] },
      watchedItemsRepository: { getAll: async () => [] },
      watchedTitleStateRepository: {
        getTitleWatchedItems: async (_items, { baseWatchedItems = [] } = {}) => baseWatchedItems
      },
      CollectionsStore: { get: () => [collection] },
      LayoutPreferences: { get: () => ({ homeLayout: "modern" }) },
      HomeScreen: { ensureDelegatedEventsBound() {} },
      escapeHtml: (value) => String(value ?? ""),
      normalizeCollectionFolderItem: (folder) => ({
        id: `folder:${folder.collectionId}:${folder.id}`,
        type: "collection",
        name: folder.title,
        heroSource: "collection"
      }),
      buildWatchedTitleIdSet: () => new Set(),
      renderLoadingIndicator: () => "",
      FOLDER_SOURCE_RENDER_BATCH_MS: 10,
      buildFolderHeroSeed: (folder) => ({ id: `seed:${folder.id}`, name: folder.title }),
      buildFallbackStreamingSources: () => [],
      roundRobinMerge: (lists) => lists.flat(),
      buildAddonTabLabel: (source) => String(source.catalogId || "Catalog"),
      buildTmdbTabLabel: () => "TMDB",
      buildTraktTabLabel: () => "Trakt",
      buildFolderSourceKey: (_source, index) => `source_${index}`
    },
    doc,
    setTimeout,
    clearTimeout
  );

  const screen = Object.assign(Object.create(api), {
    render() {
      renderCount += 1;
    },
    async loadTab(index, options) {
      loadedTabCalls.push({ index, options });
      if (this.tabs[index]) {
        this.tabs[index] = {
          ...this.tabs[index],
          items: [{ id: `fresh-${index}`, type: "movie", name: `Fresh ${index}` }],
          loading: false
        };
      }
    }
  });

  return {
    screen,
    loadedTabCalls,
    get renderCount() {
      return renderCount;
    }
  };
}

function createStaleSnapshot({ reloadSecondTab = false } = {}) {
  return {
    params: { collectionId: "c1", folderId: "f1" },
    selectedTabIndex: 1,
    lastFocusedKey: "row:1:item:tt6334354",
    focusedItemId: "tt6334354",
    focusedItemType: "movie",
    focusedRowKey: "source_1",
    savedScrollTop: 420,
    trackScrollStates: { source_1: 120 },
    tabs: [
      {
        key: "source_0",
        items: [{ id: "tt1000001", type: "movie", name: "Protector" }],
        hasMore: false,
        page: 1,
        restoreNeedsReload: false
      },
      {
        key: "source_1",
        items: [{ id: "tt6334354", type: "movie", name: "The Suicide Squad" }],
        hasMore: false,
        page: 1,
        restoreNeedsReload: reloadSecondTab
      }
    ],
    heroItem: { id: "tt6334354", type: "movie", name: "The Suicide Squad" },
    followLayoutFocusState: {
      layoutMode: "modern",
      mainScrollTop: 420,
      rowKey: "source_1",
      itemIndex: 0,
      itemIdentity: "movie:tt6334354",
      focusKind: "item",
      trackStates: { source_1: 120 }
    }
  };
}

async function flushMountWork() {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("forward re-entry ignores stale RouteStateStore snapshot and reloads folder cleanly", async () => {
  const { screen, loadedTabCalls } = createFolderDetailHarness();
  const staleSnapshot = createStaleSnapshot();

  await screen.mount(
    { collectionId: "c1", folderId: "f1" },
    { isBackNavigation: false, previousRoute: "home", restoredState: staleSnapshot }
  );
  await flushMountWork();

  assert.equal(
    screen.heroItem?.id,
    "folder:c1:f1",
    "forward mount must keep the folder hero instead of stale heroItem"
  );
  assert.equal(
    screen.restoredFocusedItem,
    null,
    "forward mount must not restore a stale focused item"
  );
  assert.equal(
    screen.restoredFollowLayoutFocusState,
    null,
    "forward mount must not restore stale follow-layout scroll state"
  );
  assert.equal(screen.savedScrollTop, 0);
  assert.equal(screen.selectedTabIndex, 0);
  assert.equal(screen.lastFocusedKey, "tab:0");
  assert.deepEqual(
    loadedTabCalls.map((call) => call.index),
    [0, 1],
    "forward mount must load all folder source tabs fresh"
  );
});

test("forward mount without explicit isBackNavigation flag also ignores stale restoredState", async () => {
  const { screen, loadedTabCalls } = createFolderDetailHarness();
  const staleSnapshot = createStaleSnapshot();

  await screen.mount({ collectionId: "c1", folderId: "f1" }, { restoredState: staleSnapshot });
  await flushMountWork();

  assert.equal(screen.heroItem?.id, "folder:c1:f1");
  assert.equal(screen.restoredFocusedItem, null);
  assert.equal(screen.restoredFollowLayoutFocusState, null);
  assert.deepEqual(
    loadedTabCalls.map((call) => call.index),
    [0, 1]
  );
});

test("Back navigation still hydrates saved folder hero, focus, scroll state, and cached tabs", async () => {
  const { screen, loadedTabCalls } = createFolderDetailHarness();
  const snapshot = createStaleSnapshot();

  await screen.mount(
    { collectionId: "c1", folderId: "f1" },
    { isBackNavigation: true, previousRoute: "detail", restoredState: snapshot }
  );
  await flushMountWork();

  assert.equal(screen.heroItem?.id, "tt6334354");
  assert.deepEqual(screen.restoredFocusedItem, {
    itemId: "tt6334354",
    itemType: "movie",
    rowKey: "source_1"
  });
  assert.deepEqual(screen.restoredFollowLayoutFocusState, snapshot.followLayoutFocusState);
  assert.equal(screen.savedScrollTop, 420);
  assert.equal(screen.selectedTabIndex, 1);
  assert.equal(screen.lastFocusedKey, "row:1:item:tt6334354");
  assert.deepEqual(
    loadedTabCalls,
    [],
    "already-loaded tabs should not be refetched on Back return"
  );
  assert.equal(screen.tabs[1].items[0].id, "tt6334354");
});

test("Back navigation reloads only tabs marked restoreNeedsReload while keeping hydrated state", async () => {
  const { screen, loadedTabCalls } = createFolderDetailHarness();
  const snapshot = createStaleSnapshot({ reloadSecondTab: true });

  await screen.mount(
    { collectionId: "c1", folderId: "f1" },
    { isBackNavigation: true, previousRoute: "detail", restoredState: snapshot }
  );
  await flushMountWork();

  assert.equal(screen.heroItem?.id, "tt6334354");
  assert.deepEqual(
    loadedTabCalls.map((call) => call.index),
    [1]
  );
});
