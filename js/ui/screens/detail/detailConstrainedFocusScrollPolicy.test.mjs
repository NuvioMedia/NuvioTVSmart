import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const detail17Source = await readFile(
  new URL("./metaDetailsScreenMethods-17-capture-detail-focus.js", import.meta.url),
  "utf8"
);

const strip = (src) => src.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

function createDetailScreen({ constrained = false, legacy = false } = {}) {
  const frames = new Map();
  let nextFrame = 0;
  const context = vm.createContext({
    document: {},
    performance: { now: () => 100 },
    requestAnimationFrame: (cb) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    matchMedia: () => ({ matches: false }),
    internals: {
      PlayerSettingsStore: { get: () => ({}) },
      getTvRuntimePerformanceProfile: () => ({
        isTvRuntime: true,
        platform: "tizen",
        isLegacyTvRuntime: legacy,
        isPerformanceConstrained: constrained
      }),
      DETAIL_SCROLL_STIFFNESS: 220,
      DETAIL_SCROLL_DAMPING_RATIO: 1,
      DETAIL_SCROLL_MAX_FRAME_SECONDS: 0.034,
      escapeSelectorValue: String,
      detailTrailerCaptionOptions: () => ({})
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${strip(detail17Source)}\nglobalThis.api = createMetaDetailsScreenMethods17();`,
    context
  );
  const screen = Object.assign(Object.create(context.api), {
    isPerformanceConstrained: () => constrained,
    isLegacyTvRuntime: () => legacy
  });
  return { screen, frames, context };
}

test("Detail animateScroll and animateSpringScroll snap immediately on constrained modern TV runtimes and cancel active springs", () => {
  const { screen, frames, context } = createDetailScreen({ constrained: true, legacy: false });
  const container = {
    isConnected: true,
    scrollTop: 0,
    scrollLeft: 40,
    scrollHeight: 1600,
    clientHeight: 400,
    scrollWidth: 1000,
    clientWidth: 400
  };
  const ySpringRaf = context.requestAnimationFrame(() => {});
  const xSpringRaf = context.requestAnimationFrame(() => {});
  screen.springScrollAnimations = new WeakMap([
    [container, { y: { raf: ySpringRaf }, x: { raf: xSpringRaf } }]
  ]);

  assert.equal(screen.shouldUseImmediateFocusScroll(), true);
  screen.animateScroll(container, "y", 520, 150);
  assert.equal(container.scrollTop, 520, "constrained modern Detail scroll must snap immediately");
  assert.equal(frames.has(ySpringRaf), false, "existing y spring rAF must be cancelled");
  assert.equal(frames.has(xSpringRaf), true, "unrelated x spring must remain untouched");

  screen.animateSpringScroll(container, "x", 300);
  assert.equal(container.scrollLeft, 300, "animateSpringScroll must also snap when constrained");
  assert.equal(frames.size, 0, "constrained modern TV must schedule 0 scroll rAF frames");
});

test("Detail animateSpringScroll skips scheduling a rAF tick when already within 1px of target on unconstrained runtimes", () => {
  const detail = createDetailScreen({ constrained: false, legacy: false });
  assert.equal(detail.screen.shouldUseImmediateFocusScroll(), false);
  const container = {
    isConnected: true,
    scrollTop: 200.4,
    scrollLeft: 0,
    scrollHeight: 1600,
    clientHeight: 400,
    scrollWidth: 1000,
    clientWidth: 400
  };
  detail.screen.animateSpringScroll(container, "y", 200);
  assert.equal(container.scrollTop, 200);
  assert.equal(detail.frames.size, 0, "Detail no-op <=1px spring must not schedule a rAF");

  // Non-trivial distance still animates smoothly on unconstrained TV runtimes.
  detail.screen.animateScroll(container, "y", 600, 150);
  assert.equal(detail.frames.size, 1, "unconstrained Detail scroll still animates via rAF");
});
