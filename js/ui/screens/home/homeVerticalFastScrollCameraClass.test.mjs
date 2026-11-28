import assert from "node:assert/strict";
import test from "node:test";
import { createHomeScreenMethods17 } from "./homeScreenMethods-17-end-modern-vertical-fast-scroll.js";

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (cls) => set.add(cls),
    remove: (cls) => set.delete(cls),
    contains: (cls) => set.has(cls)
  };
}

test("startModernVerticalFastScroll marks .is-camera-scrolling and endModernVerticalFastScroll clears it and defers landing hydration", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  let nextRafId = 1;
  globalThis.requestAnimationFrame = () => {
    nextRafId += 1;
    return nextRafId;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const main = {
      isConnected: true,
      scrollHeight: 2000,
      clientHeight: 600,
      scrollTop: 100,
      classList: createClassList()
    };
    const focusedNode = { dataset: { itemId: "focus-1" } };
    const hydrationCalls = [];
    const landCalls = [];

    const screen = {
      ...createHomeScreenMethods17(),
      layoutMode: "modern",
      container: {
        querySelector: (selector) => (selector === ".home-modern-rows-viewport" ? main : null)
      },
      shouldUseImmediateFocusScroll: () => false,
      cancelModernCameraFollow: () => {},
      cancelScrollAnimation: () => {},
      getCurrentFocusedNode: () => focusedNode,
      landModernVerticalFastScroll: (direction) => landCalls.push(direction),
      scheduleHomeLazyImageHydration: (node, opts) => hydrationCalls.push({ node, opts })
    };

    assert.equal(screen.startModernVerticalFastScroll(1), true);
    assert.equal(main.classList.contains("is-camera-scrolling"), true);

    screen.endModernVerticalFastScroll({ land: false });
    assert.equal(main.classList.contains("is-camera-scrolling"), false);
    assert.equal(hydrationCalls.length, 0);

    assert.equal(screen.startModernVerticalFastScroll(1), true);
    assert.equal(main.classList.contains("is-camera-scrolling"), true);

    screen.endModernVerticalFastScroll({ land: true });
    assert.equal(main.classList.contains("is-camera-scrolling"), false);
    assert.deepEqual(landCalls, [1]);
    assert.deepEqual(hydrationCalls, [
      { node: focusedNode, opts: { deferUntilVerticalSettle: true } }
    ]);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  }
});

test("landModernVerticalFastScroll skips .home-row-parked rows without measuring bounding boxes", () => {
  const methods = createHomeScreenMethods17();
  let parkedRectCalls = 0;
  let visibleRectCalls = 0;

  const makeRowAnchor = (parked, top, bottom) => {
    const section = {
      classList: createClassList(
        parked ? ["home-modern-row", "home-row-parked"] : ["home-modern-row"]
      )
    };
    return {
      closest: () => section,
      getBoundingClientRect: () => {
        if (parked) {
          parkedRectCalls += 1;
        } else {
          visibleRectCalls += 1;
        }
        return { top, bottom };
      }
    };
  };

  const parkedAnchor = makeRowAnchor(true, 0, 300);
  const visibleAnchor = makeRowAnchor(false, 120, 420);
  const focusCalls = [];

  const screen = {
    container: {
      querySelector: (selector) => {
        if (selector === ".home-modern-rows-viewport") {
          return { getBoundingClientRect: () => ({ top: 100, bottom: 800 }) };
        }
        if (selector === ".home-main .focusable.focused") {
          return null;
        }
        return null;
      }
    },
    navModel: {
      rows: [[parkedAnchor], [visibleAnchor]]
    },
    getMainFocusAnchor: (node) => node,
    resolveBestVisibleNodeForRow: (rowNodes) => rowNodes[0] || null,
    focusNode: (current, target, direction, inputMeta) =>
      focusCalls.push({ current, target, direction, inputMeta }),
    syncMainFocusToViewport: () => {},
    ...methods
  };

  screen.landModernVerticalFastScroll(1);
  assert.equal(parkedRectCalls, 0);
  assert.equal(visibleRectCalls, 1);
  assert.deepEqual(focusCalls, [
    { current: null, target: visibleAnchor, direction: "down", inputMeta: { repeat: true } }
  ]);
});
