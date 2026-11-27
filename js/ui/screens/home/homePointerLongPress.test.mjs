import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripModule = (source) =>
  source
    .replace(/^import [\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export /gm, "");

async function load(file, factory, internals, globals) {
  const source = stripModule(await readFile(new URL(file, import.meta.url), "utf8"));
  const context = vm.createContext({ internals, ...globals });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = ${factory}();`, context);
  return context.api;
}

test("pointer press held past CW_HOLD_DELAY_MS opens the hold menu and swallows the click", async () => {
  const HOLD_MS = 650;
  let now = 1000;
  const timers = [];
  const globals = {
    Date: { now: () => now },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {}
  };
  let activeScreen = null;
  const holdMethods = await load(
    "./homeScreenMethods-08-open-hold-menu-for-node.js",
    "createHomeScreenMethods08",
    {
      Router: {
        getCurrent: () => "home",
        getCurrentScreen: () => activeScreen
      },
      CW_HOLD_DELAY_MS: HOLD_MS
    },
    globals
  );
  const dpadMethods = await load(
    "./homeScreenMethods-19-handle-home-dpad.js",
    "createHomeScreenMethods19",
    {
      CW_HOLD_DELAY_MS: HOLD_MS
    },
    globals
  );

  const card = {
    dataset: { itemId: "tt1", videoId: "v1", season: "1", episode: "2" },
    matches: (sel) => sel === ".home-continue-card.focusable",
    closest() {
      return card;
    }
  };
  let focusedCard = card;
  const handlers = {};
  const container = {
    contains: () => true,
    addEventListener: (name, fn) => (handlers[name] = fn),
    removeEventListener() {},
    querySelector: () => focusedCard
  };
  const opened = [];
  const selected = [];
  const screen = Object.assign(Object.create({ ...holdMethods, ...dpadMethods }), {
    container,
    markUserInteractionSinceHomePaint() {},
    isHomeHoldTarget: () => true,
    isPosterHoldTarget: () => false,
    getContinueWatchingItemFromNode: () => ({
      contentId: "tt1",
      videoId: "v1",
      season: 1,
      episode: 2
    }),
    openContinueWatchingMenu: (node) => opened.push(node),
    openContinueWatchingFromNode: (node) => selected.push(node)
  });
  activeScreen = screen;
  screen.ensureDelegatedEventsBound();

  const down = { button: 0, target: card, timeStamp: 5000 };
  const click = (node = card) =>
    handlers.click({ target: node, preventDefault() {}, stopPropagation() {} });
  {
    // Short press: no menu, click runs the normal action.
    handlers.mousedown(down);
    now += 100;
    handlers.mouseup?.({ target: card, timeStamp: 5100 });
    click({
      ...card,
      dataset: { action: "resumeProgress" },
      closest: () => ({ ...card, dataset: { action: "resumeProgress" } })
    });
    assert.equal(opened.length, 0);
    assert.equal(selected.length, 1);

    // Long press: timer fires -> menu opens; release + click must not run the action.
    timers.length = 0;
    handlers.mousedown(down);
    now += 700;
    timers.pop()();
    handlers.mouseup?.({ target: card, timeStamp: 5700 });
    click({
      ...card,
      dataset: { action: "resumeProgress" },
      closest: () => ({ ...card, dataset: { action: "resumeProgress" } })
    });
    assert.equal(opened.length, 1);
    assert.equal(selected.length, 1);

    // The press after a hold is a normal click again.
    handlers.mousedown({ button: 0, target: card }); // no timestamps: Date.now fallback
    now += 50;
    handlers.mouseup?.({ target: card });
    click({
      ...card,
      dataset: { action: "resumeProgress" },
      closest: () => ({ ...card, dataset: { action: "resumeProgress" } })
    });
    assert.equal(selected.length, 2);

    // Busy main thread: tap lasted 100 ms by event time, but mouseup is processed after 650 ms of wall clock.
    let cancelled = 0;
    handlers.mousedown({ ...down, timeStamp: 1000 });
    screen.cancelPendingContinueWatchingHold = () => cancelled++;
    now += 800;
    handlers.mouseup?.({ target: card, timeStamp: 1100 });
    assert.equal(cancelled, 1);
    click({
      ...card,
      dataset: { action: "resumeProgress" },
      closest: () => ({ ...card, dataset: { action: "resumeProgress" } })
    });
    assert.equal(selected.length, 3);
    assert.equal(opened.length, 1);
  }
});

test("pointer hold opens the menu for the pressed card even when focus moved off it", async () => {
  let now = 1000;
  const timers = [];
  const globals = {
    Date: { now: () => now },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {}
  };
  let activeScreen = null;
  const holdMethods = await load(
    "./homeScreenMethods-08-open-hold-menu-for-node.js",
    "createHomeScreenMethods08",
    {
      Router: {
        getCurrent: () => "home",
        getCurrentScreen: () => activeScreen
      },
      CW_HOLD_DELAY_MS: 650
    },
    globals
  );
  const mk = (id) => ({ dataset: { itemId: id, videoId: "", season: "", episode: "" } });
  const pressed = mk("tt1");
  const other = mk("tt2");
  let focused = other;
  const opened = [];
  const screen = Object.assign(Object.create(holdMethods), {
    container: { querySelector: () => focused },
    isHomeHoldTarget: () => true,
    isPosterHoldTarget: () => false,
    getContinueWatchingItemFromNode: (n) => ({ contentId: n.dataset.itemId, videoId: "" }),
    openHoldMenuForNode: (n) => opened.push(n)
  });
  activeScreen = screen;

  // Keyboard path: focus moved off the pressed card, timer does nothing.
  screen.startPendingContinueWatchingHold(pressed);
  timers.pop()();
  assert.equal(opened.length, 0);

  // Pointer path: menu opens for the pressed card at the threshold.
  screen.startPendingContinueWatchingHold(pressed, true);
  timers.pop()();
  assert.deepEqual(opened, [pressed]);
});
