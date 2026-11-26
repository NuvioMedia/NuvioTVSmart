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

test("homeScreenMethods-08 hold and enter timers use Router.getCurrentScreen() === this so FolderDetailScreen works", async () => {
  let activeScreen = null;
  const scheduled = [];
  const context = vm.createContext({
    internals: {
      Router: {
        getCurrent: () => "folderDetail",
        getCurrentScreen: () => activeScreen
      },
      CW_HOLD_DELAY_MS: 20,
      CW_ENTER_DELAY_MS: 20,
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

  const focusedNode = { dataset: { itemId: "tt123" } };
  let holdOpenedFor = null;
  const screen = Object.assign(Object.create(context.api), {
    container: {
      querySelector: () => focusedNode
    },
    isHomeHoldTarget: () => true,
    isPosterHoldTarget: () => true,
    getPosterItemFromNode: () => ({ id: "tt123", type: "movie", name: "Example" }),
    hasPendingContinueWatchingHold: () => true,
    openHoldMenuForNode(node) {
      holdOpenedFor = node;
    }
  });
  activeScreen = screen;

  assert.equal(screen.startPendingContinueWatchingHold(focusedNode), true);
  assert.equal(scheduled.length, 1);
  scheduled[0]();

  assert.equal(
    holdOpenedFor,
    focusedNode,
    "poster hold menu must open when Router.getCurrentScreen() matches the delegating FolderDetailScreen"
  );
});
