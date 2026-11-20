import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

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

test("HomeScreen async poster dialogs abort on stale homeLoadToken and route changes", async () => {
  const source = stripModule(
    await readFile(
      new URL("./homeScreenMethods-07-mount-continue-watching-dialog.js", import.meta.url),
      "utf8"
    )
  );

  let currentRoute = "home";
  let resolveTabs;
  let resolveSaved;
  const context = vm.createContext({
    getPosterListPickerOptions: () => [],
    trackingErrorMessage: () => "",
    internals: makeInternalsProxy({
      Router: { getCurrent: () => currentRoute },
      LibrarySourceMode: { LOCAL: "local" },
      supportsMembershipFor: () => true,
      isTitleItemWatched: () => false,
      normalizeCatalogItem: (item) => item,
      t: (_k, _p, f) => f || "",
      savedLibraryRepository: {
        isSaved: () =>
          new Promise((resolve) => {
            resolveSaved = resolve;
          })
      },
      watchedItemsRepository: { isWatched: async () => false },
      libraryRepository: {
        getListTabs: () =>
          new Promise((resolve) => {
            resolveTabs = resolve;
          }),
        getMembershipSnapshot: async () => ({ listMembership: {} }),
        getSourceMode: async () => "local"
      }
    })
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createHomeScreenMethods07();`, context);

  let listMounts = 0;
  let holdMounts = 0;

  const screen = Object.assign(Object.create(context.api), {
    homeLoadToken: 1,
    container: {},
    cancelPendingContinueWatchingEnter() {},
    cancelPendingContinueWatchingHold() {},
    captureHoldMenuScrollState: () => null,
    getPosterItemFromNode: () => ({ id: "tt1", type: "movie", name: "Movie" }),
    getNodeRowKey: () => "row-1",
    mountPosterListPickerDialog: () => {
      listMounts += 1;
      return true;
    },
    mountPosterHoldDialog: () => {
      holdMounts += 1;
      return true;
    }
  });

  const listPromise = screen.openPosterListPicker({ id: "tt1", type: "movie" });
  screen.homeLoadToken = 2;
  resolveTabs([{ key: "local", title: "Library" }]);
  assert.equal(await listPromise, false);
  assert.equal(listMounts, 0);

  const holdPromise = screen.openPosterHoldMenu({ dataset: { itemId: "tt1" } });
  currentRoute = "detail";
  resolveSaved(false);
  assert.equal(await holdPromise, false);
  assert.equal(holdMounts, 0);
});
