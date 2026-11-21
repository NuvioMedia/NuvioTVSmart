import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const strip = (source) => source.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

const source02 = strip(
  await readFile(
    new URL("./homeScreenMethods-02-restore-modern-focus-state.js", import.meta.url),
    "utf8"
  )
);
const source30 = strip(
  await readFile(new URL("./homeScreenMethods-30-cleanup.js", import.meta.url), "utf8")
);

function buildScrollHarness() {
  let nextRaf = 1;
  let now = 0;
  const scheduledRafs = new Map();
  const cancelledRafs = [];
  const context = vm.createContext({
    internals: {
      MODERN_HOME_CONSTANTS: {
        springScrollStiffness: 220,
        springScrollDampingRatio: 1
      },
      findHomeFocusIdentityMatch: () => null,
      MODERN_CAMERA_PAN_EASING: (t) => t
    },
    isModernTvProfile: () => true,
    getTvRuntimePerformanceProfile: () => ({ isPerformanceConstrained: false }),
    performance: { now: () => now },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => {
      const id = nextRaf++;
      scheduledRafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => {
      cancelledRafs.push(id);
      scheduledRafs.delete(id);
    },
    WeakMap,
    Set,
    Math,
    Number,
    Array,
    Object,
    String,
    Boolean
  });
  context.globalThis = context;
  vm.runInContext(`${source02}\nglobalThis.api = createHomeScreenMethods02();`, context);

  const screen = Object.assign(Object.create(context.api), {
    shouldUseImmediateFocusScroll: () => false
  });

  const stepFrame = (deltaMs = 16) => {
    now += deltaMs;
    const batch = Array.from(scheduledRafs.entries());
    scheduledRafs.clear();
    batch.forEach(([, cb]) => cb(now));
  };

  return { screen, scheduledRafs, cancelledRafs, stepFrame };
}

// Real scroll containers clamp their offset to the live scroll range and report
// an offset of 0 once hidden, so the stub must do the same.
function createScrollContainer(classes = new Set()) {
  const container = {
    isConnected: true,
    clientWidth: 1920,
    clientHeight: 1080,
    scrollHeight: 3000,
    scrollWidth: 1920,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    }
  };
  let scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (value) => {
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      scrollTop = Math.max(0, Math.min(max, Number(value) || 0));
    }
  });
  return container;
}

test("animateSpringScroll stops when preserved container becomes hidden (display: none)", () => {
  const { screen, scheduledRafs, stepFrame } = buildScrollHarness();
  const classes = new Set();
  const container = createScrollContainer(classes);

  screen.animateSpringScroll(container, "y", 800);
  assert.equal(scheduledRafs.size, 1);

  // Advance one visible frame: keeps animating.
  stepFrame(16);
  assert.equal(scheduledRafs.size, 1);
  assert.ok(container.scrollTop > 0);

  // Hide container (as .home-dom-preserved display:none does): scrollTop/clientHeight report 0.
  container.clientWidth = 0;
  container.clientHeight = 0;
  container.scrollHeight = 0;
  container.scrollTop = 0;

  // The spring must settle on the live (empty) scroll range instead of
  // scheduling frames forever against an unreachable target.
  let frames = 0;
  while (scheduledRafs.size && frames < 240) {
    stepFrame(16);
    frames += 1;
  }
  assert.equal(scheduledRafs.size, 0, "hidden spring scroll must stop scheduling rAF frames");
  assert.ok(frames < 240, "hidden spring scroll must settle, not spin forever");
  assert.equal(classes.has("is-camera-scrolling"), false);
});

test("animateSpringScroll stops on the frame after the container is detached", () => {
  const { screen, scheduledRafs, stepFrame } = buildScrollHarness();
  const classes = new Set();
  const container = createScrollContainer(classes);

  screen.animateSpringScroll(container, "y", 800);
  stepFrame(16);
  assert.equal(scheduledRafs.size, 1);

  container.isConnected = false;
  stepFrame(16);
  assert.equal(scheduledRafs.size, 0, "a detached container must not keep a scroll loop alive");
  assert.equal(classes.has("is-camera-scrolling"), false);
});

test("animateScroll early return cancels any prior running rAF and cancelAllScrollAnimations clears tracked containers", () => {
  const { screen, scheduledRafs, cancelledRafs } = buildScrollHarness();
  const container = {
    isConnected: true,
    clientWidth: 1920,
    clientHeight: 1080,
    scrollHeight: 3000,
    scrollWidth: 1920,
    scrollTop: 0,
    classList: { add() {}, remove() {} }
  };

  screen.animateScroll(container, "y", 500, 300);
  assert.equal(scheduledRafs.size, 1);
  const firstRafId = Array.from(scheduledRafs.keys())[0];

  // Now move within <= 1px of current position: must cancel active rAF.
  screen.animateScroll(container, "y", 1, 300);
  assert.ok(cancelledRafs.includes(firstRafId));
  assert.equal(scheduledRafs.size, 0);

  // Start springs on several containers (viewport + rows), then invoke
  // cancelAllScrollAnimations (as cleanup() does): all of them must stop.
  const containers = [0, 1, 2].map(() => createScrollContainer());
  containers.forEach((target) => screen.animateSpringScroll(target, "x", 700));
  assert.equal(scheduledRafs.size, 3);
  screen.cancelAllScrollAnimations();
  assert.equal(scheduledRafs.size, 0);
});

test("cleanup clears continueWatchingReleaseTimer + active scroll animations, and resetForSignOut clears idle hero logo cache", () => {
  let resetLogoCalls = 0;
  let resetRescalerCalls = 0;
  let cancelAllScrollCalls = 0;
  const cancelledRafs = [];
  const stub = () => {};
  const context = vm.createContext({
    internals: {
      ScreenUtils: { hide: stub },
      Platform: { isTizen: () => false, isWebOS: () => false }
    },
    resetHomeArtworkRescaler: () => {
      resetRescalerCalls += 1;
    },
    resetHeroLogoRescaleCache: () => {
      resetLogoCalls += 1;
    },
    setTimeout,
    clearTimeout,
    cancelAnimationFrame: (id) => {
      cancelledRafs.push(id);
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source30}\nglobalThis.api = createHomeScreenMethods30();`, context);

  let timerFired = false;
  const screen = Object.assign(Object.create(context.api), {
    container: {
      childNodes: [],
      classList: { add: stub, remove: stub },
      style: { removeProperty: stub }
    },
    rows: [],
    hasLoadedOnce: true,
    continueWatchingReleaseTimer: setTimeout(() => {
      timerFired = true;
    }, 50),
    _mainVertRaf: 11,
    _mainClassicVertRaf: 12,
    _trackHorizRaf: 13,
    cancelAllScrollAnimations() {
      cancelAllScrollCalls += 1;
    },
    cancelModernSidebarPillAutoCollapse: stub,
    cancelPendingContinueWatchingEnter: stub,
    cancelPendingContinueWatchingHold: stub,
    destroyHomeHoldDialog: stub,
    unlockHomeHoldFocus: stub,
    persistCurrentFocusState: stub,
    cancelInitialHomeLoadTimeout: stub,
    cancelScheduledRender: stub,
    cancelModernCameraFollow: stub,
    endModernVerticalFastScroll: stub,
    stopHeroRotation: stub,
    cancelPendingHeroFocus: stub,
    cancelFocusedPosterFlow: stub,
    clearFocusedPosterFlowState: stub,
    collapseFocusedPoster: stub,
    clearHomeTrailerLayers: stub,
    teardownGridStickyHeader: stub,
    teardownModernTrackScrollPagination: stub,
    teardownContinueWatchingProgressiveRendering: stub,
    releaseAllHomeLazyImages: stub
  });

  screen.cleanup();
  assert.equal(screen.continueWatchingReleaseTimer, null);
  assert.equal(cancelAllScrollCalls, 1);
  assert.equal(timerFired, false);
  assert.deepEqual(
    cancelledRafs.sort((a, b) => a - b),
    [11, 12, 13]
  );
  assert.equal(screen._mainVertRaf, null);
  assert.equal(screen._mainClassicVertRaf, null);
  assert.equal(screen._trackHorizRaf, null);

  screen.continueWatchingReleaseTimer = setTimeout(() => {
    timerFired = true;
  }, 50);
  screen.boundHomeEventContainer = null;
  screen.homeRowWindow = null;
  screen.homeLazyImageHydrationRaf = 0;
  screen.homeDomPreserved = false;
  screen.hasLoadedOnce = false;
  screen.resetForSignOut();
  assert.equal(screen.continueWatchingReleaseTimer, null);
  assert.equal(resetRescalerCalls >= 1, true);
  assert.equal(resetLogoCalls >= 1, true);
});
