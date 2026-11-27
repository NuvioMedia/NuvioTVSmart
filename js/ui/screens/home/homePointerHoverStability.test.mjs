import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

const load = async (file, factory, globals = {}) => {
  const source = strip(await readFile(new URL(file, import.meta.url), "utf8"));
  const context = vm.createContext({ internals: {}, ...globals });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = ${factory}();`, context);
  return context.api;
};

const makeCard = (name) => {
  const card = {
    name,
    classList: { contains: () => false },
    closest: (selector) => (selector === ".home-main .home-content-card.focusable" ? card : null)
  };
  return card;
};

test("pointer hover only takes focus when the pointer actually moved", async () => {
  let now = 1000;
  const methods = await load(
    "./homeScreenMethods-19-handle-home-dpad.js",
    "createHomeScreenMethods19",
    {
      Date: { now: () => now }
    }
  );
  const handlers = {};
  const container = {
    contains: () => true,
    addEventListener: (name, handler) => {
      handlers[name] = handler;
    },
    removeEventListener() {}
  };
  const focused = [];
  const screen = Object.assign(Object.create(methods), {
    container,
    sidebarExpanded: false,
    isSidebarFocusActive: () => false,
    markUserInteractionSinceHomePaint() {},
    setFocusedNode(node) {
      focused.push(node);
    },
    isMainNode: () => true,
    getHomeViewport: () => null,
    syncFocusedCollectionCardState() {},
    scheduleModernHeroUpdate() {},
    scheduleFocusedPosterFlow() {}
  });
  screen.ensureDelegatedEventsBound();

  const cardA = makeCard("A");
  const cardB = makeCard("B");
  const hover = (card) => handlers.mouseover({ target: card });
  hover(cardA);
  assert.deepEqual(focused, [], "a hover before any pointer move must not take focus");

  now = 1010;
  handlers.mousemove({});
  now = 1020;
  hover(cardA);
  assert.deepEqual(focused, [cardA], "a hover caused by a real pointer move still takes focus");

  now = 3020;
  hover(cardB);
  assert.deepEqual(focused, [cardA], "a layout shift under a resting pointer must not move focus");

  now = 3030;
  handlers.mousemove({});
  now = 3040;
  hover(cardB);
  assert.deepEqual(focused, [cardA, cardB]);
});

test("a hovered row clipped by the bottom edge is revealed with a minimal scroll", async () => {
  const methods = await load(
    "./homeScreenMethods-19-handle-home-dpad.js",
    "createHomeScreenMethods19"
  );
  let anchorBottom = 1100;
  const viewport = { scrollTop: 100, getBoundingClientRect: () => ({ bottom: 900 }) };
  const scrolls = [];
  const screen = Object.assign(Object.create(methods), {
    getHomeViewport: () => viewport,
    getMainFocusAnchor: () => ({ getBoundingClientRect: () => ({ bottom: anchorBottom }) }),
    getScrollDuration: () => 0,
    animateScroll: (_viewport, _axis, value) => scrolls.push(value)
  });

  screen.revealPointerHoveredRow({});
  assert.deepEqual(scrolls, [324], "reveals the clipped row plus the 24px bottom margin");

  anchorBottom = 800;
  screen.revealPointerHoveredRow({});
  assert.deepEqual(scrolls, [324], "a row that is already visible must not scroll");
});

test("expansion reveals only the clipped trailing edge instead of realigning the card", async () => {
  const methods = await load(
    "./homeScreenMethods-13-mount-trailer-layer.js",
    "createHomeScreenMethods13"
  );
  const track = {
    clientWidth: 1600,
    scrollLeft: 100,
    getBoundingClientRect: () => ({ left: 0 })
  };
  const cardAt = (left) => ({
    classList: { contains: (name) => name === "home-poster-card" },
    closest: (selector) => (selector === ".home-track" ? track : null),
    getBoundingClientRect: () => ({ left })
  });
  const scrolls = [];
  const screen = Object.assign(Object.create(methods), {
    container: { querySelector: () => ({}) },
    getCachedModernPortraitPosterMetrics: () => ({ expandedWidth: 400 }),
    getTrackViewportMetrics: () => ({ safeRightPadding: 100 }),
    getScrollDuration: () => 0,
    animateScroll: (_track, _axis, value) => scrolls.push(value)
  });

  screen.revealExpandedPosterTrailingEdge(cardAt(900));
  assert.deepEqual(scrolls, [], "an expanded card that already fits must not move the row");

  screen.revealExpandedPosterTrailingEdge(cardAt(1200));
  assert.deepEqual(scrolls, [230], "only the 100px overshoot plus the 30px margin is scrolled");
});
