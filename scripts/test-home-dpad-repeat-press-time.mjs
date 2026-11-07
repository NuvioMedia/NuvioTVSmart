import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

// The Home repeat gate must measure the spacing between presses from the key
// event's own timestamp. A busy main thread can hand two queued keydowns to the
// handler within a millisecond of each other; measured by handler time they
// looked like one fast repeat and the second press was dropped (#1250).

function directionFor(keyCode) {
  return { 37: "left", 38: "up", 39: "right", 40: "down" }[Number(keyCode)] || null;
}

function setup({ nowMs = 5000 } = {}) {
  const clock = { now: nowMs };
  const context = vm.createContext({
    internals: {
      getLegacySidebarSelectedNode: () => null,
      getModernSidebarSelectedNode: () => null,
      getDirectionFromKeyCode: directionFor,
      MODERN_HOME_CONSTANTS: {},
      Router: { getCurrent: () => "home" }
    },
    Date: { now: () => clock.now },
    Number,
    Math,
    Boolean,
    String
  });
  const source = readFileSync(
    new URL("../js/ui/screens/home/homeScreenMethods-19-handle-home-dpad.js", import.meta.url),
    "utf8"
  )
    .replace(/^import .*;\r?\n/m, "")
    .replace("export function", "function");
  const methods = vm.runInContext(`${source}\ncreateHomeScreenMethods19()`, context);

  const nodes = [0, 1, 2, 3, 4].map((index) => ({
    classList: { contains: () => false },
    dataset: { navRow: "0", navCol: String(index) }
  }));
  const moves = [];
  let current = nodes[0];
  const screen = Object.assign({}, methods, {
    navModel: { rows: [nodes], sidebar: [] },
    layoutMode: "modern",
    modernVerticalFastScrollState: null,
    container: { querySelector: () => null },
    getCurrentFocusedNode: () => current,
    isMainNode: () => true,
    isNodeWithinMainViewport: () => true,
    shouldSuspendModernViewportFocusSync: () => false,
    isSidebarNode: () => false,
    getDirectionalRepeatThrottleMs: () => 80,
    getNodeRowKey: () => "",
    ensureContinueWatchingRenderAhead() {},
    focusNode(from, target) {
      if (!target) {
        return false;
      }
      moves.push(target);
      current = target;
      return true;
    }
  });
  const press = ({ repeat = true, timeStamp = 0 } = {}) =>
    screen.handleHomeDpad({ keyCode: 39, repeat, timeStamp, preventDefault() {} });
  return { screen, moves, press, clock };
}

test("repeat presses spaced by their own timestamps are not dropped when handled back to back", () => {
  const { moves, press, clock } = setup({ nowMs: 5000 });
  // Both events reach the handler at the same wall-clock instant.
  assert.equal(press({ timeStamp: 1000 }), true);
  clock.now = 5001;
  assert.equal(press({ timeStamp: 1150 }), true);
  assert.equal(moves.length, 2);
});

test("repeat presses closer than the gate are still throttled by press time", () => {
  const { moves, press, clock } = setup({ nowMs: 5000 });
  press({ timeStamp: 1000 });
  clock.now = 5500;
  assert.equal(press({ timeStamp: 1030 }), true);
  assert.equal(moves.length, 1);
});

test("events without a timestamp fall back to the handler clock", () => {
  const { moves, press, clock } = setup({ nowMs: 5000 });
  press({ timeStamp: 0 });
  clock.now = 5020;
  press({ timeStamp: 0 });
  assert.equal(moves.length, 1);
  clock.now = 5200;
  press({ timeStamp: 0 });
  assert.equal(moves.length, 2);
});

test("first presses are never gated", () => {
  const { moves, press } = setup({ nowMs: 5000 });
  press({ repeat: false, timeStamp: 1000 });
  press({ repeat: false, timeStamp: 1001 });
  press({ repeat: false, timeStamp: 1002 });
  assert.equal(moves.length, 3);
});
