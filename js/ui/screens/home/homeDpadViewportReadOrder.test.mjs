import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

const dpadSource = strip(
  await readFile(new URL("./homeScreenMethods-19-handle-home-dpad.js", import.meta.url), "utf8")
);

test("handleHomeDpad checks shouldSuspendModernViewportFocusSync before measuring isNodeWithinMainViewport", () => {
  const context = vm.createContext({
    internals: {
      getLegacySidebarSelectedNode: () => null,
      getModernSidebarSelectedNode: () => null,
      getDirectionFromKeyCode: () => "right",
      MODERN_HOME_CONSTANTS: {},
      Router: {}
    }
  });
  context.globalThis = context;
  vm.runInContext(`${dpadSource}\nglobalThis.api = createHomeScreenMethods19();`, context);

  let viewportChecks = 0;
  let suspended = true;
  let syncCalls = 0;
  const focused = { id: "card-1", dataset: { navIndex: "0" } };

  const screen = Object.assign(Object.create(context.api), {
    navModel: {},
    layoutMode: "classic",
    modernVerticalFastScrollState: null,
    getCurrentFocusedNode: () => focused,
    isMainNode: () => true,
    isSidebarNode: () => true,
    closeSidebarToContent: () => true,
    shouldSuspendModernViewportFocusSync: () => suspended,
    isNodeWithinMainViewport: () => {
      viewportChecks += 1;
      return false;
    },
    syncMainFocusToViewport: () => {
      syncCalls += 1;
      return focused;
    },
    resolveSidebarFallbackNode: () => focused,
    isValidFocusNode: () => false
  });

  screen.handleHomeDpad({ keyCode: 39, preventDefault() {} });
  assert.equal(viewportChecks, 0, "must skip viewport layout read when sync is suspended");
  assert.equal(syncCalls, 0);

  suspended = false;
  screen.handleHomeDpad({ keyCode: 39, preventDefault() {} });
  assert.equal(viewportChecks, 1, "still measures viewport when sync is active");
  assert.equal(syncCalls, 1);
});
