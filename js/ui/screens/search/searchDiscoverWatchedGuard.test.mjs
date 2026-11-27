import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const [discoverSource, searchSource] = await Promise.all([
  readFile(new URL("./discoverScreenMethods-03-open-picker-menu.js", import.meta.url), "utf8"),
  readFile(new URL("./searchScreenMethods-03-render-recent-searches.js", import.meta.url), "utf8")
]);

test("DiscoverScreen and SearchScreen PosterOptions onChanged callbacks bail out when unmounted or inactive", async () => {
  let discoverRenderCalls = 0;
  let searchRenderCalls = 0;
  let currentRoute = "discover";
  let currentScreen = null;
  let capturedDiscoverOnChanged = null;
  let capturedSearchOnChanged = null;

  class MockControllerDiscover {
    constructor(opts) {
      capturedDiscoverOnChanged = opts.onChanged;
    }
    open() {
      return true;
    }
  }
  class MockControllerSearch {
    constructor(opts) {
      capturedSearchOnChanged = opts.onChanged;
    }
    open() {
      return true;
    }
  }

  const discoverCtx = vm.createContext({
    internals: {
      Router: {
        getCurrent: () => currentRoute,
        getCurrentScreen: () => currentScreen
      },
      PosterOptionsDialogController: MockControllerDiscover,
      posterItemFromNode: (n) => n._item,
      focusWithoutAutoScroll: () => {},
      setLegacySidebarExpanded: () => {},
      POSTER_HOLD_DELAY_MS: 400,
      actionForPickerKind: () => "",
      setContainerScrollTop: () => {}
    }
  });
  discoverCtx.globalThis = discoverCtx;
  vm.runInContext(
    `${stripModule(discoverSource)}\nglobalThis.api = createDiscoverScreenMethods03();`,
    discoverCtx
  );

  const searchCtx = vm.createContext({
    internals: {
      Router: {
        getCurrent: () => currentRoute,
        getCurrentScreen: () => currentScreen
      },
      ScreenUtils: {},
      contentTextDirection: () => "ltr",
      bindRootSidebarEvents: () => {},
      getRootSidebarNodes: () => [],
      getRootSidebarSelectedNode: () => null,
      renderRootSidebar: () => {},
      PosterOptionsDialogController: MockControllerSearch,
      posterItemFromNode: (n) => n._item,
      POSTER_HOLD_DELAY_MS: 400,
      escapeHtml: (v) => String(v || ""),
      t: (k) => k,
      escapeSelectorValue: (v) => String(v || "")
    }
  });
  searchCtx.globalThis = searchCtx;
  vm.runInContext(
    `${stripModule(searchSource)}\nglobalThis.api = createSearchScreenMethods03();`,
    searchCtx
  );

  const discoverScreen = Object.assign(Object.create(discoverCtx.api), {
    container: { querySelector: () => null },
    items: [{ id: "tt1", type: "movie", name: "Movie" }],
    catalogs: [],
    captureViewState() {},
    refreshWatchedTitleIds: async () => {
      // Simulate navigating away / unmounting while refresh resolves.
      discoverScreen.container = null;
      currentRoute = "home";
    },
    updateRenderedWatchedBadges: () => false,
    requestRender() {
      discoverRenderCalls += 1;
    }
  });
  await discoverScreen.openPosterOptionsMenu({
    dataset: { itemId: "tt1" },
    _item: discoverScreen.items[0]
  });
  await capturedDiscoverOnChanged();
  await Promise.resolve();
  assert.equal(discoverRenderCalls, 0, "DiscoverScreen must not call requestRender after unmount");

  const searchScreen = Object.assign(Object.create(searchCtx.api), {
    container: { querySelector: () => null },
    discoverSections: [],
    results: [{ id: "tt2", type: "movie", name: "Movie 2" }],
    captureLiveViewState() {},
    refreshWatchedTitleIds: async () => {
      searchScreen.container = null;
      currentScreen = null;
    },
    render() {
      searchRenderCalls += 1;
    }
  });
  currentScreen = searchScreen;
  await searchScreen.openPosterOptionsMenu({
    dataset: { itemId: "tt2" },
    _item: searchScreen.results[0]
  });
  await capturedSearchOnChanged();
  await Promise.resolve();
  assert.equal(searchRenderCalls, 0, "SearchScreen must not call render after unmount");
});
