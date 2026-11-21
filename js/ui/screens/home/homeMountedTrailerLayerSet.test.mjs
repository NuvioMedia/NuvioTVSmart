import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

const [methods12Source, methods13Source] = await Promise.all(
  [
    "./homeScreenMethods-12-sync-collection-hero-media.js",
    "./homeScreenMethods-13-mount-trailer-layer.js"
  ].map(async (relPath) => strip(await readFile(new URL(relPath, import.meta.url), "utf8")))
);

test("trailer layer tracking avoids full-DOM querySelectorAll scans across navigation and cleanup", () => {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    cancelIdleCallback: () => {},
    getTrailerCleanupDelayMs: () => 5000,
    window: {
      addEventListener() {},
      removeEventListener() {}
    },
    document: {
      activeElement: null,
      createElement: () => {
        const classes = new Set();
        return {
          className: "",
          dataset: {},
          style: {},
          classList: {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            contains: (n) => classes.has(n)
          },
          setAttribute() {},
          removeAttribute() {},
          addEventListener() {},
          contentWindow: { postMessage() {} }
        };
      }
    },
    internals: {
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      firstNonEmpty: (...values) => values.find((v) => v) || "",
      isCollectionFolderItem: () => false,
      normalizeCollectionFolderItem: (item) => item
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${methods12Source}\n${methods13Source}\nglobalThis.api = Object.assign(createHomeScreenMethods12(), createHomeScreenMethods13());`,
    context
  );

  let qsaCalls = 0;
  const screen = Object.assign(Object.create(context.api), {
    homeTrailerLayerCleanupTimers: new WeakMap(),
    homeTrailerLayerHideTimers: new WeakMap(),
    shouldUseImmediateFocusScroll: () => true,
    container: {
      getElementsByTagName: () => [],
      querySelectorAll: () => {
        qsaCalls += 1;
        return [];
      }
    }
  });

  // No trailers mounted yet: O(1) HTMLCollection check skips querySelectorAll completely.
  screen.pauseActiveTrailerLayersForNavigation();
  screen.refreshPendingHomeTrailerCleanup();
  screen.clearHomeTrailerLayers();
  assert.equal(qsaCalls, 0);

  // Mount a trailer layer and exercise navigation/cleanup/clear via mountedHomeTrailerLayers.
  const classes = new Set(["is-active"]);
  let mountedFrame = null;
  const trailerContainer = {
    isConnected: true,
    children: [],
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n)
    },
    appendChild(child) {
      mountedFrame = child;
      this.children.push(child);
    },
    querySelector: (sel) => (sel.includes("iframe") ? mountedFrame : null),
    get firstElementChild() {
      return mountedFrame;
    },
    set innerHTML(v) {
      if (v === "") {
        mountedFrame = null;
        this.children.length = 0;
      }
    }
  };

  screen.mountTrailerLayer(trailerContainer, {
    kind: "youtube",
    embedUrl: "https://www.youtube.com/embed/test123"
  });
  assert.equal(screen.mountedHomeTrailerLayers.has(trailerContainer), true);

  mountedFrame.dataset.trailerRevealed = "true";
  trailerContainer.classList.add("is-active");
  screen.pauseActiveTrailerLayersForNavigation();
  assert.equal(trailerContainer.classList.contains("is-active"), false);

  screen.refreshPendingHomeTrailerCleanup();
  assert.equal(screen.homeTrailerLayerCleanupTimers.has(trailerContainer), true);

  screen.clearHomeTrailerLayers();
  assert.equal(screen.mountedHomeTrailerLayers.size, 0);
  assert.equal(screen.homeTrailerLayerCleanupTimers.has(trailerContainer), false);
  assert.equal(qsaCalls, 0, "must never fall back to querySelectorAll when tracking trailers");
});
