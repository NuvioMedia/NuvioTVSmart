import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  HOME_TV_PERFORMANCE_POLICY,
  getTrailerCleanupDelayMs
} from "../../../platform/tvPerformancePolicy.js";

const source = (
  await Promise.all(
    [
      "./homeScreenMethods-12-sync-collection-hero-media.js",
      "./homeScreenMethods-13-mount-trailer-layer.js"
    ].map((file) => readFile(new URL(file, import.meta.url), "utf8"))
  )
)
  .map((moduleSource) =>
    moduleSource
      .replace(/^import [\s\S]*?";$/m, "")
      .replace(/^import [^;]+;$/gm, "")
      .replace(/^export /gm, "")
  )
  .join("\n");

function makeHarness(profile) {
  let nextTimerId = 1;
  const timers = new Map();
  const clearCalls = [];

  const context = vm.createContext({
    console,
    WeakMap,
    Set,
    Map,
    document: {
      createElement: () => ({
        dataset: {},
        style: {},
        classList: { add() {}, remove() {}, contains: () => false },
        setAttribute() {},
        addEventListener() {},
        remove() {},
        removeAttribute() {}
      })
    },
    window: {
      addEventListener() {},
      removeEventListener() {}
    },
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      clearCalls.push(id);
      timers.delete(id);
    },
    getTrailerCleanupDelayMs,
    internals: {
      getTvRuntimePerformanceProfile: () => profile,
      firstNonEmpty: (...values) => values.find((v) => v) || "",
      isCollectionFolderItem: () => false,
      normalizeCollectionFolderItem: (item) => item
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source}\nglobalThis.api = Object.assign(createHomeScreenMethods12(), createHomeScreenMethods13());`,
    context
  );
  const screen = Object.assign(Object.create(context.api), {
    homeTrailerLayerCleanupTimers: new WeakMap(),
    homeTrailerLayerHideTimers: new WeakMap(),
    mountedHomeTrailerLayers: new Set()
  });
  return { screen, timers, clearCalls };
}

function makeLayer({
  hasIframe = true,
  active = true,
  embedUrl = "https://www.youtube.com/embed/abc"
} = {}) {
  const classes = new Set(active ? ["is-active"] : []);
  const posted = [];
  const iframe = hasIframe
    ? {
        dataset: { trailerSrc: embedUrl, trailerRevealed: "true" },
        isConnected: true,
        contentWindow: { postMessage: (msg) => posted.push(msg) },
        remove() {},
        removeAttribute() {}
      }
    : null;
  let inner = hasIframe ? "<iframe/>" : "";
  return {
    isConnected: true,
    posted,
    get firstElementChild() {
      return iframe;
    },
    set innerHTML(val) {
      inner = val;
    },
    get innerHTML() {
      return inner;
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c)
    },
    querySelector: (sel) => (hasIframe && sel.includes("iframe") ? iframe : null)
  };
}

test("getTrailerCleanupDelayMs uses 450 ms on modern Tizen and preserves webOS/generic/legacy delays", () => {
  const modernTizen = {
    isTvRuntime: true,
    isPerformanceConstrained: false,
    isLegacyTvRuntime: false,
    platform: "tizen"
  };
  const modernWebos = {
    isTvRuntime: true,
    isPerformanceConstrained: false,
    isLegacyTvRuntime: false,
    platform: "webos"
  };
  assert.equal(getTrailerCleanupDelayMs(modernTizen), 450);
  assert.equal(
    getTrailerCleanupDelayMs(modernTizen),
    HOME_TV_PERFORMANCE_POLICY.modernTizenTrailerCleanupDelayMs
  );
  assert.equal(getTrailerCleanupDelayMs(modernWebos), 2400);
  assert.equal(
    getTrailerCleanupDelayMs({
      isTvRuntime: true,
      isPerformanceConstrained: false,
      isLegacyTvRuntime: false
    }),
    2400
  );
  assert.equal(
    getTrailerCleanupDelayMs({
      isTvRuntime: true,
      isPerformanceConstrained: true,
      isLegacyTvRuntime: false,
      platform: "tizen"
    }),
    80
  );
});

test("repeated scheduleTrailerLayerCleanup calls do not clear or re-arm an active cleanup timer", () => {
  const { screen, timers, clearCalls } = makeHarness({
    isTvRuntime: true,
    isPerformanceConstrained: false,
    isLegacyTvRuntime: false,
    platform: "tizen"
  });
  const layer = makeLayer({ hasIframe: true, active: true });
  const clearedLayers = [];
  screen.clearTrailerLayer = (target) => clearedLayers.push(target);

  screen.scheduleTrailerLayerCleanup(layer);
  const cleanupTimers = Array.from(timers.entries()).filter(([, t]) => t.ms === 450);
  assert.equal(cleanupTimers.length, 1);
  const [firstTimerId, firstTimer] = cleanupTimers[0];

  // Subsequent D-pad presses call collapseFocusedPoster() -> scheduleTrailerLayerCleanup(layer).
  screen.scheduleTrailerLayerCleanup(layer);
  screen.scheduleTrailerLayerCleanup(layer);

  assert.equal(
    clearCalls.includes(firstTimerId),
    false,
    "later D-pad focus moves must not clear or extend the pending trailer cleanup timer"
  );
  assert.equal(Array.from(timers.values()).filter((t) => t.ms === 450).length, 1);

  firstTimer.fn();
  assert.deepEqual(clearedLayers, [layer]);
});

test("scheduleTrailerLayerCleanup ignores empty inactive layers", () => {
  const { screen, timers } = makeHarness({
    isTvRuntime: true,
    isPerformanceConstrained: false,
    isLegacyTvRuntime: false,
    platform: "tizen"
  });
  const emptyLayer = makeLayer({ hasIframe: false, active: false });

  screen.scheduleTrailerLayerCleanup(emptyLayer);

  assert.equal(timers.size, 0, "empty inactive trailer layers must not schedule cleanup timers");
});

test("mountTrailerLayer reusing the same embedUrl still cancels pending cleanup", () => {
  const embedUrl = "https://www.youtube.com/embed/reuse";
  const { screen, timers, clearCalls } = makeHarness({
    isTvRuntime: true,
    isPerformanceConstrained: false,
    isLegacyTvRuntime: false,
    platform: "tizen"
  });
  const layer = makeLayer({ hasIframe: true, active: true, embedUrl });

  screen.scheduleTrailerLayerCleanup(layer);
  const [cleanupTimerId] = Array.from(timers.entries()).find(([, t]) => t.ms === 450);

  screen.mountTrailerLayer(layer, { kind: "youtube", embedUrl });

  assert.equal(clearCalls.includes(cleanupTimerId), true);
  assert.equal(layer.classList.contains("is-active"), true);
});
