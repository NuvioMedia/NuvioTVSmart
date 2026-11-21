import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function makeInternalsProxy(overrides = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      return () => ({});
    }
  });
}

const moduleSource = stripModule(
  await readFile(
    new URL("./homeScreenMethods-07-mount-continue-watching-dialog.js", import.meta.url),
    "utf8"
  )
);

function createHarness({ getListTabs, isSaved } = {}) {
  const router = { currentRoute: "home", currentScreen: null };
  const context = vm.createContext({
    getPosterListPickerOptions: () => [],
    trackingErrorMessage: () => "",
    internals: null
  });
  context.globalThis = context;
  context.internals = makeInternalsProxy({
    Router: { getCurrent: () => router.currentRoute, getCurrentScreen: () => router.currentScreen },
    LibrarySourceMode: { LOCAL: "local", SIMKL: "simkl" },
    supportsMembershipFor: () => true,
    isTitleItemWatched: () => false,
    normalizeCatalogItem: (item) => item,
    t: (_key, _params, fallback) => fallback || "",
    savedLibraryRepository: { isSaved: isSaved || (async () => false) },
    watchedItemsRepository: { isWatched: async () => false },
    libraryRepository: {
      getListTabs: getListTabs || (async () => [{ key: "local", title: "Library" }]),
      getMembershipSnapshot: async () => ({ listMembership: {} }),
      getSourceMode: async () => "local"
    }
  });
  vm.runInContext(`${moduleSource}\nglobalThis.api = createHomeScreenMethods07();`, context);

  const counts = { hold: 0, picker: 0 };
  const screen = Object.assign(Object.create(context.api), {
    homeLoadToken: 1,
    container: {},
    cancelPendingContinueWatchingEnter() {},
    cancelPendingContinueWatchingHold() {},
    captureHoldMenuScrollState: () => null,
    getPosterItemFromNode: () => ({ id: "tt1", type: "movie", name: "Movie" }),
    getNodeRowKey: () => "row-1",
    mountPosterHoldDialog() {
      counts.hold += 1;
      return true;
    },
    mountPosterListPickerDialog() {
      counts.picker += 1;
      return true;
    }
  });
  router.currentScreen = screen;
  return { screen, router, counts };
}

test("mounts the poster hold and list picker dialogs on the active screen", async () => {
  const { screen, counts } = createHarness();

  assert.equal(await screen.openPosterListPicker({ id: "tt1", type: "movie" }), true);
  assert.equal(await screen.openPosterHoldMenu({ dataset: { itemId: "tt1" } }), true);
  assert.deepEqual(counts, { hold: 1, picker: 1 });
});

test("drops the list picker when homeLoadToken changes while tabs load", async () => {
  const tabs = deferred();
  const { screen, counts } = createHarness({ getListTabs: () => tabs.promise });

  const pending = screen.openPosterListPicker({ id: "tt1", type: "movie" });
  screen.homeLoadToken += 1;
  tabs.resolve([{ key: "local", title: "Library" }]);

  assert.equal(await pending, false);
  assert.equal(counts.picker, 0);
});

test("drops the superseded list picker request", async () => {
  const tabRequests = [];
  const { screen, counts } = createHarness({
    getListTabs: () => {
      const request = deferred();
      tabRequests.push(request);
      return request.promise;
    }
  });

  const first = screen.openPosterListPicker({ id: "tt1", type: "movie" });
  const second = screen.openPosterListPicker({ id: "tt1", type: "movie" });

  tabRequests[1].resolve([{ key: "local", title: "Library" }]);
  assert.equal(await second, true);
  tabRequests[0].resolve([{ key: "local", title: "Library" }]);
  assert.equal(await first, false);
  assert.equal(counts.picker, 1);
});

test("drops the poster hold menu when the route leaves the screen", async () => {
  const saved = deferred();
  const { screen, router, counts } = createHarness({ isSaved: () => saved.promise });

  const pending = screen.openPosterHoldMenu({ dataset: { itemId: "tt1" } });
  router.currentRoute = "detail";
  router.currentScreen = { container: {} };
  saved.resolve(false);

  assert.equal(await pending, false);
  assert.equal(counts.hold, 0);
});

test("keeps the hold menu working on FolderDetail, which inherits the same methods", async () => {
  const { screen, router, counts } = createHarness();
  const folderScreen = Object.assign(Object.create(screen), { container: {} });
  router.currentRoute = "folderDetail";
  router.currentScreen = folderScreen;

  assert.equal(await folderScreen.openPosterHoldMenu({ dataset: { itemId: "tt1" } }), true);
  assert.equal(await folderScreen.openPosterListPicker({ id: "tt1", type: "movie" }), true);
  assert.deepEqual(counts, { hold: 1, picker: 1 });
});

test("drops the poster hold menu when closePosterHoldMenu runs while it loads", async () => {
  const saved = deferred();
  const { screen, counts } = createHarness({ isSaved: () => saved.promise });

  const pending = screen.openPosterHoldMenu({ dataset: { itemId: "tt1" } });
  screen.closePosterHoldMenu();
  saved.resolve(false);

  assert.equal(await pending, false);
  assert.equal(counts.hold, 0);
});
