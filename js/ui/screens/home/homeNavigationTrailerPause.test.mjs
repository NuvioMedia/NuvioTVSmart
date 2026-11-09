import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// homeScreenMethods-28 reaches the whole app through homeScreenContext, so the
// real key handler is evaluated against stubs. This guards the rule that a
// directional key only pauses a playing trailer when it actually moves focus.
const source = (
  await readFile(new URL("./homeScreenMethods-28-on-key-down.js", import.meta.url), "utf8")
)
  .replace(/^import [\s\S]*?";$/m, "")
  .replace(/^import [^;]+;$/gm, "")
  .replace(/^export /gm, "");

function buildScreen() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    registerHomeDomNodes: () => {},
    internals: {
      Router: {},
      LayoutPreferences: { get: () => ({}) },
      Platform: { isBackEvent: () => false },
      isDirectionalKeyCode: (code) => [37, 38, 39, 40].includes(Number(code)),
      getDirectionFromKeyCode: () => null,
      CW_RENDER_LOAD_AHEAD_ITEMS: 0,
      HOME_LAYOUT_SEQUENCE: ["modern", "classic", "grid"]
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source}\nglobalThis.api = createHomeScreenMethods28();`, context);

  return Object.assign(Object.create(context.api), {
    layoutMode: "modern",
    heroIndex: 0,
    sidebarExpanded: false,
    modernVerticalFastScrollState: null,
    _homeHoldDialog: false,
    suppressHoldMenuEnterUntilKeyUp: false,
    continueWatchingMenu: null,
    posterHoldMenu: null,
    layoutPrefs: {},
    focusedNode: { id: "first" },
    pauseCalls: 0,
    behavior: null,
    container: null,
    getCurrentFocusedNode() {
      return this.focusedNode;
    },
    markUserInteractionSinceHomePaint() {},
    cancelPendingContinueWatchingEnter() {},
    cancelPendingContinueWatchingHold() {},
    isHomeHoldTarget() {
      return false;
    },
    cancelFocusedPosterFlow() {},
    pauseActiveTrailerLayersForNavigation() {
      this.pauseCalls += 1;
    },
    handleHomeDpad() {
      this.behavior?.(this);
      return true;
    }
  });
}

function pressKey(screen, keyCode) {
  return screen.onKeyDown({ keyCode, preventDefault() {} });
}

test("a directional key that moves nothing does not pause the trailer", () => {
  const screen = buildScreen();
  screen.behavior = null;

  pressKey(screen, 39);

  assert.equal(screen.pauseCalls, 0);
});

test("a directional key that moves focus pauses the trailer", () => {
  const screen = buildScreen();
  screen.behavior = (self) => {
    self.focusedNode = { id: "second" };
  };

  pressKey(screen, 39);

  assert.equal(screen.pauseCalls, 1);
});

test("a key that only rotates the hero still pauses the trailer", () => {
  const screen = buildScreen();
  screen.behavior = (self) => {
    self.heroIndex = 1;
  };

  pressKey(screen, 39);

  assert.equal(screen.pauseCalls, 1);
});

test("a key that starts fast scrolling counts as movement", () => {
  const screen = buildScreen();
  screen.behavior = (self) => {
    self.modernVerticalFastScrollState = { direction: 1 };
  };

  pressKey(screen, 40);

  assert.equal(screen.pauseCalls, 1);
});
