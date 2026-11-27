import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source.replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "").replace(/^export /gm, "");

async function load(file, factory, internals, globals = {}) {
  const source = stripModule(await readFile(new URL(file, import.meta.url), "utf8"));
  const context = vm.createContext({ internals, ...globals });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = ${factory}();`, context);
  return context.api;
}

test("FolderDetail owns its pointer mouseup/mouseout handlers instead of inheriting Home's", async () => {
  const { FolderDetailScreen } = await import("../collection/folderDetailScreen.js");
  for (const key of ["boundHomeMouseUpHandler", "boundHomeMouseOutHandler"]) {
    assert.ok(Object.hasOwn(FolderDetailScreen, key), `${key} must be reset on FolderDetailScreen`);
    assert.equal(FolderDetailScreen[key], null);
  }
});

test("hold dialogs skip Enter suppression for pointer holds and keep it for keyboard holds", async () => {
  const dialogs = [];
  class NuvioDialog {
    constructor(options) {
      this.options = options;
      dialogs.push(this);
    }
    mount() {
      return this;
    }
  }
  const methods = await load(
    "./homeScreenMethods-07-mount-continue-watching-dialog.js",
    "createHomeScreenMethods07",
    {
      NuvioDialog,
      t: (_key, _params, fallback) => fallback
    },
    { document: { body: {} } }
  );
  const screen = Object.assign(Object.create(methods), {
    lockHomeHoldFocus() {},
    destroyHomeHoldDialog() {},
    scheduleHoldMenuScrollRestore() {},
    getContinueWatchingMenuItem: () => ({ title: "cw" }),
    getContinueWatchingMenuOptions: () => [],
    getPosterHoldMenuItem: () => ({ id: "tt1", name: "p" }),
    getPosterHoldMenuOptions: () => []
  });
  for (const [mount, menuKey] of [
    ["mountContinueWatchingDialog", "continueWatchingMenu"],
    ["mountPosterHoldDialog", "posterHoldMenu"]
  ]) {
    for (const fromPointer of [false, true]) {
      screen[menuKey] = { fromPointer };
      screen[mount]();
      assert.equal(
        dialogs.at(-1).options.suppressEnterUntilKeyUp,
        !fromPointer,
        `${mount} fromPointer=${fromPointer}`
      );
      assert.equal(screen.suppressHoldMenuEnterUntilKeyUp, !fromPointer);
    }
  }
});

test("pointer hold timer threads fromPointer into openHoldMenuForNode", async () => {
  const timers = [];
  let activeScreen = null;
  const methods = await load(
    "./homeScreenMethods-08-open-hold-menu-for-node.js",
    "createHomeScreenMethods08",
    {
      Router: {
        getCurrent: () => "home",
        getCurrentScreen: () => activeScreen
      },
      CW_HOLD_DELAY_MS: 650
    },
    { setTimeout: (fn) => timers.push(fn), clearTimeout() {} }
  );
  const node = { dataset: { itemId: "tt1", videoId: "", season: "", episode: "" } };
  const calls = [];
  const screen = Object.assign(Object.create(methods), {
    container: { querySelector: () => node },
    isHomeHoldTarget: () => true,
    isPosterHoldTarget: () => false,
    getContinueWatchingItemFromNode: () => ({ contentId: "tt1", videoId: "" }),
    openHoldMenuForNode: (n, fromPointer) => calls.push(fromPointer)
  });
  activeScreen = screen;
  screen.startPendingContinueWatchingHold(node, true);
  timers.pop()();
  screen.startPendingContinueWatchingHold(node);
  timers.pop()();
  assert.deepEqual(calls, [true, false]);
});

test("FolderDetail follow-layout holds forward the pointer source and the pressed card", async () => {
  const timers = [];
  const opened = [];
  const pressed = { dataset: { itemId: "tt1", itemType: "movie" } };
  const other = { dataset: { itemId: "tt2", itemType: "movie" } };
  let activeScreen = null;
  const methods = await load(
    "./homeScreenMethods-08-open-hold-menu-for-node.js",
    "createHomeScreenMethods08",
    {
      Router: {
        getCurrent: () => "folderDetail",
        getCurrentScreen: () => activeScreen
      },
      CW_HOLD_DELAY_MS: 650
    },
    { setTimeout: (fn) => timers.push(fn), clearTimeout() {} }
  );
  const screen = Object.assign(Object.create(methods), {
    useHomeFollowLayout: true,
    container: { querySelector: () => other },
    isHomeHoldTarget: () => true,
    isPosterHoldTarget: () => true,
    getPosterItemFromNode: () => ({ id: "tt1", type: "movie" }),
    cancelPendingContinueWatchingEnter() {},
    cancelPendingContinueWatchingHold() {
      this.pendingContinueWatchingHoldTarget = null;
      this.pendingContinueWatchingHoldTimer = null;
    },
    hasPendingContinueWatchingHold: (node) => node === pressed,
    openHoldMenuForNode: (node, fromPointer) => opened.push([node, fromPointer])
  });
  activeScreen = screen;

  // Pointer: the pressed card is used even when hover focus sits elsewhere.
  screen.startPendingContinueWatchingHold(pressed, true);
  timers.pop()();
  assert.deepEqual(opened, [[pressed, true]]);

  // Keyboard: a hold whose card lost focus stays inert, as before.
  screen.startPendingContinueWatchingHold(pressed);
  timers.pop()();
  assert.deepEqual(opened, [[pressed, true]]);
});
