import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

const moduleSource = stripModule(
  await readFile(
    new URL("./homeScreenMethods-08-open-hold-menu-for-node.js", import.meta.url),
    "utf8"
  )
);

const HOLD_DELAY_MS = 20;

function createHarness() {
  const state = {
    activeScreen: null,
    holdOpenedFor: null,
    selectedItem: null,
    focusRememberedFor: null
  };
  const scheduled = [];
  const context = vm.createContext({
    internals: {
      Router: {
        getCurrent: () => "folderDetail",
        getCurrentScreen: () => state.activeScreen
      },
      CW_HOLD_DELAY_MS: HOLD_DELAY_MS,
      CW_ENTER_DELAY_MS: HOLD_DELAY_MS,
      normalizeContinueWatchingItem: (item) => item,
      continueWatchingClickOpensDetails: () => false,
      isCloudContinueWatchingItem: () => false
    },
    setTimeout: (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    clearTimeout: () => {}
  });
  context.globalThis = context;
  vm.runInContext(`${moduleSource}\nglobalThis.api = createHomeScreenMethods08();`, context);

  const focusedNode = { dataset: { itemId: "tt1", itemType: "movie", videoId: "v1" } };
  const screen = Object.assign(Object.create(context.api), {
    container: {
      querySelector: () => focusedNode
    },
    isHomeHoldTarget: () => true,
    isPosterHoldTarget: () => true,
    getPosterItemFromNode: () => ({ id: "tt1", type: "movie", name: "Example" }),
    getContinueWatchingItemFromNode: () => ({ contentId: "tt1", videoId: "v1" }),
    hasPendingContinueWatchingHold: () => true,
    openHoldMenuForNode(node) {
      state.holdOpenedFor = node;
    },
    rememberReturnFocusForNode(node) {
      state.focusRememberedFor = node;
    },
    openContinueWatchingSelection(item) {
      state.selectedItem = item;
    }
  });
  state.activeScreen = screen;
  return { state, screen, scheduled, focusedNode };
}

test("hold and enter timers accept the active FolderDetail screen", () => {
  const { state, screen, scheduled, focusedNode } = createHarness();

  assert.equal(screen.startPendingContinueWatchingHold(focusedNode), true);
  scheduled.at(-1)();
  assert.equal(
    state.holdOpenedFor,
    focusedNode,
    "poster hold menu must open when Router.getCurrentScreen() matches the delegating FolderDetailScreen"
  );

  assert.equal(screen.scheduleContinueWatchingEnter(focusedNode), true);
  scheduled.at(-1)();
  assert.equal(state.selectedItem?.contentId, "tt1");
  assert.equal(state.focusRememberedFor, focusedNode);
});

test("hold and enter timers stop once another screen becomes active", () => {
  const { state, screen, scheduled, focusedNode } = createHarness();

  assert.equal(screen.startPendingContinueWatchingHold(focusedNode), true);
  state.activeScreen = {};
  scheduled.at(-1)();
  assert.equal(state.holdOpenedFor, null);

  state.activeScreen = screen;
  assert.equal(screen.scheduleContinueWatchingEnter(focusedNode), true);
  state.activeScreen = {};
  scheduled.at(-1)();
  assert.equal(state.selectedItem, null);
});
