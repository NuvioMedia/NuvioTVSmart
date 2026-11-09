import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// The Home screen is the retained back-stack destination on TV: Android keeps
// its Coil memory cache and the composed posters, so returning from a detail
// screen never blanks the visible cards. The cleanup contract is what makes
// that possible here, and it is not covered by the hydration tests.
const source = await readFile(
  new URL("./homeScreenMethods-30-cleanup.js", import.meta.url),
  "utf8"
);

function buildScreen({
  platform = "tizen",
  rows = [{}],
  hasLoadedOnce = true,
  childNodes = 1
} = {}) {
  const calls = { released: 0, reset: 0, hidden: 0, position: "", classes: [] };
  const classList = {
    add(token) {
      calls.classes.push(`add:${token}`);
    },
    remove(token) {
      calls.classes.push(`remove:${token}`);
    }
  };
  const styleStore = new Map();
  const container = {
    childNodes: Array.from({ length: childNodes }),
    classList,
    style: {
      position: "",
      top: "",
      right: "",
      bottom: "",
      left: "",
      visibility: "",
      pointerEvents: "",
      setProperty(name, value) {
        styleStore.set(name, value);
      },
      removeProperty(name) {
        styleStore.delete(name);
      }
    }
  };
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    internals: {
      ScreenUtils: {
        hide() {
          calls.hidden += 1;
        }
      },
      Platform: {
        isTizen: () => platform === "tizen",
        isWebOS: () => platform === "webos"
      }
    },
    resetHomeArtworkRescaler() {
      calls.reset += 1;
    }
  });
  context.globalThis = context;
  vm.runInContext(
    source
      .replace(/^import [\s\S]*?";$/m, "")
      .replace(/^import [^;]+;$/gm, "")
      .replace(/^export /gm, "") + "\nglobalThis.__cleanup = createHomeScreenMethods30();",
    context
  );
  const screen = Object.assign(Object.create(context.__cleanup), {
    container,
    rows,
    hasLoadedOnce,
    homeDomPreserved: false,
    releaseAllHomeLazyImages() {
      calls.released += 1;
      return 0;
    }
  });
  [
    "cancelFocusedPosterFlow",
    "cancelInitialHomeLoadTimeout",
    "cancelModernCameraFollow",
    "cancelModernSidebarPillAutoCollapse",
    "cancelPendingContinueWatchingEnter",
    "cancelPendingContinueWatchingHold",
    "cancelPendingHeroFocus",
    "cancelScheduledRender",
    "clearFocusedPosterFlowState",
    "clearHomeTrailerLayers",
    "collapseFocusedPoster",
    "destroyHomeHoldDialog",
    "endModernVerticalFastScroll",
    "persistCurrentFocusState",
    "stopHeroRotation",
    "teardownContinueWatchingProgressiveRendering",
    "teardownGridStickyHeader",
    "teardownModernTrackScrollPagination",
    "unlockHomeHoldFocus"
  ].forEach((name) => {
    screen[name] = () => {};
  });
  return { screen, calls };
}

test("a retained TV Home keeps its artwork and rescale pool on cleanup", () => {
  const { screen, calls } = buildScreen();
  screen.cleanup();
  assert.equal(screen.homeDomPreserved, true, "the rendered Home is preserved");
  assert.ok(
    calls.classes.includes("add:home-dom-preserved"),
    "the layer is hidden from the compositor"
  );
  assert.equal(calls.released, 0, "the posters still in the retained DOM must not be stripped");
  assert.equal(calls.reset, 0, "the blob urls the retained cards paint must stay valid");
  assert.equal(calls.hidden, 0, "a preserved Home is not emptied");
  assert.equal(screen.homeArtworkReleaseTimer, undefined, "no deferred release is scheduled");
});

test("a discarded Home hands the artwork back before its pool is torn down", () => {
  const { screen, calls } = buildScreen({ rows: [] });
  screen.cleanup();
  assert.equal(screen.homeDomPreserved, false);
  assert.equal(calls.released, 1, "painted urls go back before the pool is reset");
  assert.equal(calls.reset, 1, "workers and blob urls are dropped with the DOM");
  assert.equal(calls.hidden, 1, "the screen is hidden and emptied");
});

test("a browser Home still releases its artwork without the TV retained layer", () => {
  const { screen, calls } = buildScreen({ platform: "browser" });
  screen.cleanup();
  assert.equal(screen.homeDomPreserved, false);
  assert.equal(calls.released, 1);
  assert.equal(calls.reset, 1);
  assert.equal(calls.hidden, 1);
});
