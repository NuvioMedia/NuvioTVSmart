import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const dpadSource = await readFile(
  new URL("./homeScreenMethods-19-handle-home-dpad.js", import.meta.url),
  "utf8"
);
const hydrationSource = await readFile(
  new URL("./homeScreenMethods-24-schedule-home-lazy-image-hydration.js", import.meta.url),
  "utf8"
);

const ROW_SELECTOR = ".home-row, .home-modern-row, .home-grid-section, .home-row-continue";
const LIFECYCLE_SELECTOR =
  ".home-main .content-poster, .home-main .home-poster-landscape-logo, .home-main .home-continue-bg";

const stripImportsAndExports = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

function buildCombinedHarness({ constants = {}, useManualRaf = false } = {}) {
  const rafQueue = [];
  const nextRaf = (cb) => {
    if (useManualRaf) {
      rafQueue.push(cb);
      return rafQueue.length;
    }
    return setTimeout(cb, 0);
  };
  const cancelRaf = (id) => {
    if (useManualRaf) {
      if (id > 0 && id <= rafQueue.length) rafQueue[id - 1] = null;
      return;
    }
    clearTimeout(id);
  };

  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: nextRaf,
    cancelAnimationFrame: cancelRaf,
    internals: {
      MODERN_HOME_CONSTANTS: {
        smartTvLazyHydrationDebounceMs: 10,
        verticalScrollSettlePollMs: 10,
        ...constants
      },
      CW_DAYS_CAP: 30,
      CW_HOLD_DELAY_MS: 650,
      HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR: LIFECYCLE_SELECTOR,
      HOME_LAZY_IMAGE_ROW_SELECTOR: ROW_SELECTOR,
      HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS: 180,
      HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME: 2,
      Router: { getCurrent: () => "home" },
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      isSeriesTypeForContinueWatching: () => false,
      isCompletedForContinueWatching: () => false,
      episodeKey: () => "",
      episodeSortKey: () => 0,
      buildNextUpSeedFromWatchedItem: () => null,
      getLegacySidebarSelectedNode: () => null,
      getModernSidebarSelectedNode: () => null,
      getDirectionFromKeyCode: () => null
    },
    rescaleHomeArtwork: () => Promise.resolve(null),
    releaseHomeArtwork: () => {},
    shouldRescaleHomeArtwork: () => false,
    getTvArtworkPixelRatio: () => 1,
    getHomeArtworkObjectFit: () => "cover",
    isRescalableArtworkFit: (fit) => fit === "cover" || fit === "fill",
    getArtworkEvictIdleMs: () => 0,
    getArtworkEvictMarginPx: () => 1600,
    getDeviceMemoryGb: () => 2
  });
  context.globalThis = context;
  context.innerWidth = 1920;
  context.innerHeight = 1080;
  context.document = { documentElement: { clientWidth: 1920, clientHeight: 1080 } };
  class HTMLElement {}
  class HTMLImageElement extends HTMLElement {}
  context.HTMLElement = HTMLElement;
  context.HTMLImageElement = HTMLImageElement;

  vm.runInContext(
    stripImportsAndExports(dpadSource) + "\nglobalThis.dpadApi = createHomeScreenMethods19();",
    context
  );
  vm.runInContext(
    stripImportsAndExports(hydrationSource) +
      "\nglobalThis.hydrationApi = createHomeScreenMethods24();",
    context
  );
  return {
    context,
    flushRafs() {
      while (rafQueue.length) {
        const cb = rafQueue.shift();
        if (typeof cb === "function") cb();
      }
    }
  };
}

function makeTrackFixture(context) {
  const row = new context.HTMLElement();
  row.isConnected = true;
  row.getBoundingClientRect = () => ({
    top: 400,
    bottom: 720,
    left: 0,
    right: 1920,
    width: 1920,
    height: 320
  });
  row.closest = (selector) =>
    selector.includes(".home-modern-row") || selector === ROW_SELECTOR ? row : null;

  const track = new context.HTMLElement();
  track.isConnected = true;
  track.matches = (selector) => selector === ".home-track, .home-grid-track";

  const makeCardImage = (src, left) => {
    const img = new context.HTMLImageElement();
    const attrs = new Map();
    img.isConnected = true;
    img.dataset = { src };
    img.loading = "";
    img.classList = { contains: (name) => name === "content-poster" };
    img.closest = (selector) => (selector === ROW_SELECTOR ? row : null);
    img.getBoundingClientRect = () => ({
      top: 400,
      bottom: 720,
      left: img.left,
      right: img.left + 220,
      width: 220,
      height: 320
    });
    img.left = left;
    img.getAttribute = (n) => (attrs.has(n) ? attrs.get(n) : null);
    img.removeAttribute = (n) => {
      attrs.delete(n);
      if (n === "data-src") delete img.dataset.src;
    };
    Object.defineProperty(img, "src", {
      get: () => attrs.get("src") || "",
      set: (v) => attrs.set("src", v)
    });
    return img;
  };

  const firstImg = makeCardImage("https://art/visible.jpg", 120);
  const incomingImg = makeCardImage("https://art/incoming.jpg", 2900);
  const anchor = new context.HTMLElement();
  anchor.isConnected = true;
  anchor.offsetWidth = 220;
  anchor.closest = (selector) => {
    if (selector === ROW_SELECTOR) return row;
    if (selector === ".home-track, .home-grid-track") return track;
    return null;
  };
  anchor.querySelector = () => null;

  track.querySelector = (selector) => {
    if (selector === ".focusable.focused" || selector === ".focusable") return anchor;
    return null;
  };

  return { row, track, anchor, firstImg, incomingImg };
}

test("modern .home-track scroll defers hydration while animating and forwards viewportChanged after settle", async () => {
  const { context } = buildCombinedHarness();
  const { row, track, anchor, firstImg, incomingImg } = makeTrackFixture(context);
  const listeners = new Map();
  let viewportRectReads = 0;

  const viewport = {
    isConnected: true,
    getBoundingClientRect: () => {
      viewportRectReads += 1;
      return { top: 0, bottom: 1080, left: 0, right: 1920, width: 1920, height: 1080 };
    },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name)
  };
  const container = {
    contains: (node) => node === anchor || node === row || node === track || node === viewport,
    querySelector: (selector) => (selector === ".home-modern-rows-viewport" ? viewport : null),
    querySelectorAll: () => [firstImg, incomingImg]
  };

  let horizontalAnimating = true;
  let hydrationRuns = 0;
  const screen = Object.assign(
    Object.create(Object.assign({}, context.dpadApi, context.hydrationApi)),
    {
      container,
      layoutMode: "modern",
      boundHomeViewport: null,
      boundHomeViewportScrollHandler: null,
      getHomeViewport: () => viewport,
      isPerformanceConstrained: () => false,
      isLegacyTvRuntime: () => false,
      isSidebarFocusActive: () => false,
      shouldUseImmediateFocusScroll: () => false,
      isModernHydrationScrollActive: () => horizontalAnimating,
      isScrollAnimationActive: (target, axis) =>
        target === track && axis === "x" && horizontalAnimating,
      getCurrentFocusedNode: () => anchor
    }
  );
  const origHydrate = screen.hydrateHomeLazyImages.bind(screen);
  screen.hydrateHomeLazyImages = (...args) => {
    hydrationRuns += 1;
    return origHydrate(...args);
  };

  // Initial pass hydrates visible poster on the focused row.
  screen.hydrateHomeLazyImages(anchor, { forceFullScan: true, refreshIndex: true });
  assert.equal(firstImg.src, "https://art/visible.jpg");
  assert.equal(incomingImg.src, "");
  assert.equal(hydrationRuns, 1);

  screen.bindHomeViewportEvents();
  const onScroll = listeners.get("scroll");
  assert.equal(typeof onScroll, "function");

  // Card scrolls into view while the horizontal spring animation is still active.
  incomingImg.left = 1500;
  const readsBeforeMidScroll = viewportRectReads;
  onScroll({ target: track });
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(hydrationRuns, 1, "mid-animation track scroll must defer hydration until settle");
  assert.equal(
    viewportRectReads,
    readsBeforeMidScroll,
    "must not read viewport geometry during mid-animation scroll"
  );
  assert.equal(
    incomingImg.src,
    "",
    "incoming card must stay queued until horizontal scroll settles"
  );

  // Once animation ends, settle timer forwards viewportChanged: true so same-row incoming poster hydrates.
  horizontalAnimating = false;
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(hydrationRuns, 2, "must hydrate once after horizontal scroll settles");
  assert.equal(
    incomingImg.src,
    "https://art/incoming.jpg",
    "same-row newly visible poster must hydrate via viewportChanged"
  );
});

test("non-animated track scroll events hydrate immediately without waiting for settle", async () => {
  const { context } = buildCombinedHarness();
  const { track, anchor, firstImg, incomingImg } = makeTrackFixture(context);
  const listeners = new Map();
  let hydrationRuns = 0;

  const viewport = {
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 1080,
      left: 0,
      right: 1920,
      width: 1920,
      height: 1080
    }),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: () => {}
  };
  const screen = Object.assign(
    Object.create(Object.assign({}, context.dpadApi, context.hydrationApi)),
    {
      container: {
        querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null),
        querySelectorAll: () => [firstImg, incomingImg]
      },
      layoutMode: "modern",
      getHomeViewport: () => viewport,
      isPerformanceConstrained: () => true,
      isLegacyTvRuntime: () => false,
      isSidebarFocusActive: () => false,
      shouldUseImmediateFocusScroll: () => true,
      isModernHydrationScrollActive: () => false,
      isScrollAnimationActive: () => false,
      getCurrentFocusedNode: () => anchor
    }
  );
  const origHydrate = screen.hydrateHomeLazyImages.bind(screen);
  screen.hydrateHomeLazyImages = (...args) => {
    hydrationRuns += 1;
    return origHydrate(...args);
  };

  screen.hydrateHomeLazyImages(anchor, { forceFullScan: true, refreshIndex: true });
  incomingImg.left = 1400;
  screen.bindHomeViewportEvents();
  listeners.get("scroll")({ target: track });
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(hydrationRuns, 2);
  assert.equal(incomingImg.src, "https://art/incoming.jpg");
});

test("deferred scheduleHomeLazyImageHydration coalesces refreshIndex and viewportChanged across calls", async () => {
  const { context } = buildCombinedHarness();
  const { row, anchor, firstImg } = makeTrackFixture(context);
  let indexBuilds = 0;
  let hydrationRuns = 0;
  let animating = true;

  const viewport = {
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 1080,
      left: 0,
      right: 1920,
      width: 1920,
      height: 1080
    })
  };
  const screen = Object.assign(Object.create(context.hydrationApi), {
    container: {
      querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null),
      querySelectorAll: () => [firstImg]
    },
    homeLazyImageHydrationIndex: [{ row, images: [firstImg] }],
    lastHomeLazyImageHydrationAnchorRow: row,
    layoutMode: "modern",
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    isSidebarFocusActive: () => false,
    shouldUseImmediateFocusScroll: () => false,
    isModernHydrationScrollActive: () => animating,
    isScrollAnimationActive: () => animating,
    getCurrentFocusedNode: () => anchor
  });
  const origBuild = screen.buildHomeLazyImageHydrationIndex.bind(screen);
  screen.buildHomeLazyImageHydrationIndex = (...args) => {
    indexBuilds += 1;
    return origBuild(...args);
  };
  const origHydrate = screen.hydrateHomeLazyImages.bind(screen);
  screen.hydrateHomeLazyImages = (...args) => {
    hydrationRuns += 1;
    return origHydrate(...args);
  };

  delete firstImg.dataset.src;
  firstImg.src = "https://art/visible.jpg";

  // 1st deferred call sets viewportChanged: true (no refreshIndex); 2nd sets viewportChanged: false.
  screen.scheduleHomeLazyImageHydration(anchor, {
    deferUntilVerticalSettle: true,
    refreshIndex: false,
    viewportChanged: true
  });
  screen.scheduleHomeLazyImageHydration(anchor, {
    deferUntilVerticalSettle: true,
    refreshIndex: false,
    viewportChanged: false
  });

  animating = false;
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(
    hydrationRuns,
    1,
    "coalesced viewportChanged must bypass same-row early return after settle"
  );
  assert.equal(indexBuilds, 0);

  // Subsequent deferred pair: 1st sets refreshIndex: true, 2nd sets refreshIndex: false.
  animating = true;
  screen.scheduleHomeLazyImageHydration(anchor, {
    deferUntilVerticalSettle: true,
    refreshIndex: true,
    viewportChanged: false
  });
  screen.scheduleHomeLazyImageHydration(anchor, {
    deferUntilVerticalSettle: true,
    refreshIndex: false,
    viewportChanged: false
  });
  animating = false;
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(hydrationRuns, 2);
  assert.equal(indexBuilds, 1, "coalesced refreshIndex must rebuild the index after settle");
});

test("hydrateHomeLazyImages skips layout reads on no-op passes and skips eviction on horizontal-only passes", () => {
  const { context } = buildCombinedHarness();
  const { row, anchor, firstImg } = makeTrackFixture(context);
  delete firstImg.dataset.src;
  firstImg.src = "https://art/visible.jpg";

  let viewportRectReads = 0;
  let offsetWidthReads = 0;
  let evictionCalls = 0;

  Object.defineProperty(anchor, "offsetWidth", {
    get() {
      offsetWidthReads += 1;
      return 220;
    }
  });
  const viewport = {
    getBoundingClientRect: () => {
      viewportRectReads += 1;
      return { top: 0, bottom: 1080, left: 0, right: 1920, width: 1920, height: 1080 };
    }
  };
  const screen = Object.assign(Object.create(context.hydrationApi), {
    container: {
      querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null),
      querySelectorAll: () => [firstImg]
    },
    homeLazyImageHydrationIndex: [{ row, images: [firstImg] }],
    lastHomeLazyImageHydrationAnchorRow: row,
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    isSidebarFocusActive: () => false,
    scheduleHomeLazyImageEviction: () => {
      evictionCalls += 1;
    }
  });

  // Same-row horizontal pass with zero pending [data-src] images: 0 layout reads and 0 evictions.
  screen.hydrateHomeLazyImages(anchor, { viewportChanged: true });
  assert.equal(
    viewportRectReads,
    0,
    "must skip viewport.getBoundingClientRect when candidate rows have no pending images"
  );
  assert.equal(
    offsetWidthReads,
    0,
    "must skip anchorNode.offsetWidth when candidate rows have no pending images"
  );
  assert.equal(
    evictionCalls,
    0,
    "horizontal-only same-row hydration must not trigger vertical eviction sweep"
  );

  // Full scan with zero pending [data-src] images: still skips viewport rect read, but still runs eviction.
  screen.hydrateHomeLazyImages(anchor, { forceFullScan: true });
  assert.equal(
    viewportRectReads,
    0,
    "full scan with zero pending images still skips viewport.getBoundingClientRect"
  );
  assert.equal(evictionCalls, 1, "full scan still runs scheduleHomeLazyImageEviction");
});

test("scheduleHomeLazyImageHydration avoids eager anchor querySelector and hydrateHomeLazyImages breaks early on right-hand offscreen .home-track cards", () => {
  const { context } = buildCombinedHarness({ useManualRaf: true });
  const viewport = {
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 1080,
      left: 0,
      right: 1920,
      width: 1920,
      height: 1080
    })
  };

  let anchorQueryCalls = 0;
  const rowA = new context.HTMLElement();
  rowA.isConnected = true;
  rowA.getBoundingClientRect = () => ({ top: 400, bottom: 720, left: 0, right: 1920 });
  rowA.querySelector = (sel) => (sel === ".home-track" ? {} : null);

  const rowB = new context.HTMLElement();
  rowB.isConnected = true;

  const anchor = new context.HTMLElement();
  anchor.isConnected = true;
  anchor.offsetWidth = 220;
  anchor.closest = (sel) => (sel === ROW_SELECTOR ? rowA : null);
  anchor.querySelector = () => {
    anchorQueryCalls += 1;
    return null;
  };

  const makeLazyCard = (src, left, top = 400) => {
    const img = new context.HTMLImageElement();
    const attrs = new Map();
    img.isConnected = true;
    img.dataset = { src };
    img.loading = "";
    img.rectReads = 0;
    img.classList = { contains: (name) => name === "content-poster" };
    img.closest = (sel) => (sel === ROW_SELECTOR ? rowA : null);
    img.getBoundingClientRect = () => {
      img.rectReads += 1;
      return { top, bottom: top + 320, left, right: left + 220, width: 220, height: 320 };
    };
    img.getAttribute = (n) => (attrs.has(n) ? attrs.get(n) : null);
    img.removeAttribute = (n) => {
      attrs.delete(n);
      if (n === "data-src") delete img.dataset.src;
    };
    Object.defineProperty(img, "src", {
      get: () => attrs.get("src") || "",
      set: (v) => attrs.set("src", v)
    });
    return img;
  };

  // Horizontal .home-track: 1 on-screen card + 1 offscreen-right cutoff card (past 770px focused lookahead) + 3 further-right cards.
  const visible = makeLazyCard("https://art/0.jpg", 120);
  const cutoff = makeLazyCard("https://art/1.jpg", 2800);
  const tail1 = makeLazyCard("https://art/2.jpg", 3100);
  const tail2 = makeLazyCard("https://art/3.jpg", 3400);
  const tail3 = makeLazyCard("https://art/4.jpg", 3700);

  const screen = Object.assign(Object.create(context.hydrationApi), {
    container: {
      querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null),
      querySelectorAll: () => [visible, cutoff, tail1, tail2, tail3]
    },
    homeLazyImageHydrationIndex: [{ row: rowA, images: [visible, cutoff, tail1, tail2, tail3] }],
    lastHomeLazyImageHydrationAnchorRow: rowB,
    layoutMode: "modern",
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    isSidebarFocusActive: () => false,
    shouldUseImmediateFocusScroll: () => false,
    isModernHydrationScrollActive: () => false,
    isScrollAnimationActive: () => false
  });

  // Moving onto rowA (different from last anchor rowB): must not touch anchor.querySelector.
  screen.scheduleHomeLazyImageHydration(anchor, { deferUntilVerticalSettle: true });
  assert.equal(
    anchorQueryCalls,
    0,
    "cross-row / deferred scheduling must not call anchorNode.querySelector"
  );
  if (screen.homeLazyImageHydrationSettleTimer) {
    clearTimeout(screen.homeLazyImageHydrationSettleTimer);
    screen.homeLazyImageHydrationSettleTimer = null;
  }

  screen.hydrateHomeLazyImages(anchor, { forceFullScan: true });
  assert.equal(visible.src, "https://art/0.jpg");
  assert.equal(visible.rectReads, 1);
  assert.equal(cutoff.rectReads, 1, "first offscreen-right card is measured to detect cutoff");
  assert.equal(
    tail1.rectReads,
    0,
    "subsequent .home-track cards beyond right cutoff must not be measured"
  );
  assert.equal(tail2.rectReads, 0);
  assert.equal(tail3.rectReads, 0);

  // Wrapped .home-grid-track row must continue measuring wrapped lines below an offscreen-right card.
  const gridRow = new context.HTMLElement();
  gridRow.isConnected = true;
  gridRow.getBoundingClientRect = () => ({ top: 100, bottom: 900, left: 0, right: 1920 });
  gridRow.querySelector = (sel) => (sel === ".home-grid-track" ? {} : null);

  const g0 = makeLazyCard("https://art/g0.jpg", 120, 120);
  const g1OffscreenRight = makeLazyCard("https://art/g1.jpg", 2500, 120);
  const g2WrappedNextLine = makeLazyCard("https://art/g2.jpg", 120, 500);
  screen.homeLazyImageHydrationIndex = [
    { row: gridRow, images: [g0, g1OffscreenRight, g2WrappedNextLine] }
  ];
  screen.lastHomeLazyImageHydrationAnchorRow = null;
  screen.hydrateHomeLazyImages(null, { forceFullScan: true });
  assert.equal(g0.src, "https://art/g0.jpg");
  assert.equal(g1OffscreenRight.src, "");
  assert.equal(g2WrappedNextLine.rectReads, 1, ".home-grid-track must keep measuring wrapped rows");
  assert.equal(g2WrappedNextLine.src, "https://art/g2.jpg");
});

test("bounded TV hydration and viewport scroll handler defer past 375ms post-input frame-pace window", async () => {
  const { context } = buildCombinedHarness();
  const { row, anchor, firstImg } = makeTrackFixture(context);
  const listeners = new Map();
  let viewportRectReads = 0;
  let hydrationTimes = [];

  const viewport = {
    isConnected: true,
    getBoundingClientRect: () => {
      viewportRectReads += 1;
      return { top: 0, bottom: 1080, left: 0, right: 1920, width: 1920, height: 1080 };
    },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: () => {}
  };

  const screen = Object.assign(
    Object.create(Object.assign({}, context.dpadApi, context.hydrationApi)),
    {
      container: {
        contains: (node) => node === anchor || node === row || node === viewport,
        querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null),
        querySelectorAll: () => [firstImg]
      },
      layoutMode: "modern",
      boundHomeViewport: null,
      boundHomeViewportScrollHandler: null,
      lastHomeInputAt: Date.now(),
      getHomeViewport: () => viewport,
      isPerformanceConstrained: () => false,
      isLegacyTvRuntime: () => false,
      isSidebarFocusActive: () => false,
      shouldUseImmediateFocusScroll: () => false,
      shouldSuspendModernViewportFocusSync: () => false,
      isModernHydrationScrollActive: () => false,
      isScrollAnimationActive: () => false,
      isMainNode: () => true,
      isNodeWithinMainViewport: () => {
        viewportRectReads += 1;
        return true;
      },
      getCurrentFocusedNode: () => anchor
    }
  );
  const origHydrate = screen.hydrateHomeLazyImages.bind(screen);
  screen.hydrateHomeLazyImages = (...args) => {
    hydrationTimes.push(Date.now());
    return origHydrate(...args);
  };

  // 1. Viewport scroll event inside <230ms post-input must defer settle hydration and skip premature viewport check.
  const startAt = Date.now();
  screen.bindHomeViewportEvents();
  listeners.get("scroll")({ target: viewport });
  await new Promise((r) => setTimeout(r, 105));
  assert.equal(viewportRectReads, 0, "must skip isNodeWithinMainViewport inside 230ms window");
  assert.equal(hydrationTimes.length, 0, "must not hydrate inside 230ms post-input window");

  await new Promise((r) => setTimeout(r, 175));
  assert.equal(hydrationTimes.length, 1, "must hydrate once 230ms pace window clears");
  assert.ok(
    hydrationTimes[0] - startAt >= 220,
    `viewport settle hydration ran too early (${hydrationTimes[0] - startAt}ms)`
  );

  // 2. Direct deferred scheduleHomeLazyImageHydration also waits >= 230ms after lastHomeInputAt.
  hydrationTimes = [];
  const secondStart = Date.now();
  screen.lastHomeInputAt = secondStart;
  screen.scheduleHomeLazyImageHydration(anchor, {
    deferUntilVerticalSettle: true,
    viewportChanged: true
  });
  await new Promise((r) => setTimeout(r, 115));
  assert.equal(hydrationTimes.length, 0, "retryAfterVerticalSettle must wait past 230ms");
  await new Promise((r) => setTimeout(r, 165));
  assert.equal(hydrationTimes.length, 1);
  assert.ok(
    hydrationTimes[0] - secondStart >= 220,
    `retryAfterVerticalSettle ran too early (${hydrationTimes[0] - secondStart}ms)`
  );
  if (screen.homeLazyImageQuietPrefetchTimer) {
    clearTimeout(screen.homeLazyImageQuietPrefetchTimer);
    screen.homeLazyImageQuietPrefetchTimer = null;
  }
});

test("bounded TV hydration prefetches next-row edge + 2+ horizontal cards ahead and far neighbor rows after 1450ms quiet", async () => {
  const { context } = buildCombinedHarness();
  const viewport = {
    isConnected: true,
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 1080,
      left: 0,
      right: 1920,
      width: 1920,
      height: 1080
    })
  };

  const makeRowWithCard = (top, src, left = 120) => {
    const r = new context.HTMLElement();
    r.isConnected = true;
    r.getBoundingClientRect = () => ({ top, bottom: top + 320, left: 0, right: 1920 });
    r.querySelector = () => ({});
    const img = new context.HTMLImageElement();
    const attrs = new Map();
    img.isConnected = true;
    img.dataset = { src };
    img.loading = "";
    img.classList = { contains: (n) => n === "content-poster" };
    img.closest = (sel) => (sel === ROW_SELECTOR ? r : null);
    img.getBoundingClientRect = () => ({
      top,
      bottom: top + 320,
      left,
      right: left + 220,
      width: 220,
      height: 320
    });
    img.getAttribute = (n) => (attrs.has(n) ? attrs.get(n) : null);
    img.removeAttribute = (n) => {
      attrs.delete(n);
      if (n === "data-src") delete img.dataset.src;
    };
    Object.defineProperty(img, "src", {
      get: () => attrs.get("src") || "",
      set: (v) => attrs.set("src", v)
    });
    return { row: r, img };
  };

  const visible = makeRowWithCard(400, "https://art/visible-row.jpg", 120);
  // Horizontal lookahead on focused row: left=2320 is 400px past right=1920, inside Math.max(540, 248*2.2=546).
  const lookaheadCard = makeRowWithCard(400, "https://art/lookahead-card.jpg", 2320);
  lookaheadCard.img.closest = (sel) => (sel === ROW_SELECTOR ? visible.row : null);
  // top=1200 is 120px below 1080: inside 180px ahead-row prefetch margin during stepping!
  const nextRow = makeRowWithCard(1200, "https://art/next-row.jpg");
  // top=1500 is 420px below 1080: outside 180px stepping margin, inside normal 540px margin.
  const farNeighbor = makeRowWithCard(1500, "https://art/far-neighbor-row.jpg");
  const sibling3 = {
    querySelector: (sel) => (sel.includes("data-src") ? lookaheadCard.img : null),
    nextElementSibling: null,
    previousElementSibling: null
  };
  const anchor = new context.HTMLElement();
  anchor.isConnected = true;
  anchor.offsetWidth = 248;
  anchor.closest = (sel) => (sel === ROW_SELECTOR ? visible.row : null);
  anchor.querySelector = () => null;
  anchor.nextElementSibling = {
    querySelector: () => null,
    nextElementSibling: { querySelector: () => null, nextElementSibling: sibling3 }
  };

  const screen = Object.assign(Object.create(context.hydrationApi), {
    container: {
      querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null),
      querySelectorAll: () => [visible.img, lookaheadCard.img, nextRow.img, farNeighbor.img]
    },
    homeLazyImageHydrationIndex: [
      { row: visible.row, images: [visible.img, lookaheadCard.img] },
      { row: nextRow.row, images: [nextRow.img] },
      { row: farNeighbor.row, images: [farNeighbor.img] }
    ],
    lastHomeLazyImageHydrationAnchorRow: visible.row,
    lastHomeInputAt: Date.now(),
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    isSidebarFocusActive: () => false,
    getCurrentFocusedNode: () => anchor
  });

  // Same-row sibling lookahead must bypass early-return guard when an upcoming sibling still has data-src.
  screen.scheduleHomeLazyImageHydration(anchor);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(
    visible.img.src,
    "https://art/visible-row.jpg",
    "visible card must hydrate immediately"
  );
  assert.equal(
    lookaheadCard.img.src,
    "https://art/lookahead-card.jpg",
    "horizontal sibling lookahead + 546px focusedRowMargin must prefetch 2+ cards ahead"
  );

  // Full vertical scan (cross-row / initial) prefetches next-row edge (180px) and defers far neighbor until 1450ms quiet.
  screen.lastHomeLazyImageHydrationAnchorRow = null;
  screen.hydrateHomeLazyImages(anchor, { forceFullScan: true });
  assert.equal(
    nextRow.img.src,
    "https://art/next-row.jpg",
    "next-row edge (120px below fold) must prefetch immediately under 180px vertical stepping margin"
  );
  assert.equal(
    farNeighbor.img.src,
    "",
    "420px-offscreen far row must stay deferred under 180px active stepping margin"
  );
  assert.ok(
    screen.homeLazyImageQuietPrefetchTimer,
    "must arm 1450ms quiet neighbor prefetch timer"
  );

  // Wait for 1450ms quiet prefetch to fire with includeNeighborRows: true (540px margin).
  await new Promise((r) => setTimeout(r, 1550));
  assert.equal(
    farNeighbor.img.src,
    "https://art/far-neighbor-row.jpg",
    "far neighbor row must hydrate once 1450ms quiet prefetch completes"
  );
  if (screen.homeLazyImageQuietPrefetchTimer) {
    clearTimeout(screen.homeLazyImageQuietPrefetchTimer);
    screen.homeLazyImageQuietPrefetchTimer = null;
  }
});

test("boundHomeViewportScrollHandler avoids rAF/timer churn mid-spring and passes focused node on settle", async () => {
  let rafCount = 0;
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => {
      rafCount += 1;
      return setTimeout(cb, 0);
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
    internals: {
      MODERN_HOME_CONSTANTS: {
        smartTvLazyHydrationDebounceMs: 10,
        verticalScrollSettlePollMs: 15
      },
      Router: { getCurrent: () => "home" },
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      getLegacySidebarSelectedNode: () => null,
      getModernSidebarSelectedNode: () => null,
      getDirectionFromKeyCode: () => null
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${stripImportsAndExports(dpadSource)}\nglobalThis.dpadApi = createHomeScreenMethods19();`,
    context
  );

  const listeners = new Map();
  const viewport = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: () => {}
  };
  const focusedNode = { id: "focused-card" };
  const scheduled = [];
  let hydrationActive = true;
  const screen = Object.assign(Object.create(context.dpadApi), {
    container: {
      querySelector: (sel) => (sel === ".home-modern-rows-viewport" ? viewport : null)
    },
    layoutMode: "modern",
    lastHomeInputAt: Date.now(),
    getHomeViewport: () => viewport,
    shouldUseBoundedHomeImageHydration: () => true,
    isLegacyTvRuntime: () => false,
    isModernHydrationScrollActive: () => hydrationActive,
    shouldSuspendModernViewportFocusSync: () => false,
    getCurrentFocusedNode: () => focusedNode,
    scheduleHomeLazyImageHydration: (anchor, opts) => scheduled.push({ anchor, opts })
  });

  screen.bindHomeViewportEvents();
  const scrollHandler = listeners.get("scroll");
  assert.equal(typeof scrollHandler, "function");

  // Emit 5 scroll events during active D-pad pace window + scroll animation.
  for (let i = 0; i < 5; i += 1) {
    scrollHandler({ target: viewport });
  }
  assert.equal(rafCount, 0, "scroll events during pace/scroll window must not schedule rAF");
  const initialSettleTimer = screen.homeViewportSettleHydrationTimer;
  assert.ok(initialSettleTimer, "first scroll event must arm settle hydration timer");

  // Extra scroll event inside pace window must keep the existing timer rather than resetting it.
  scrollHandler({ target: viewport });
  assert.equal(
    screen.homeViewportSettleHydrationTimer,
    initialSettleTimer,
    "mid-spring scroll events must not clear/reset pending settle timer"
  );

  // Let pace window & scroll animation finish; settle timer passes focused node to hydration.
  hydrationActive = false;
  await new Promise((r) => setTimeout(r, 430));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].anchor, focusedNode);
  assert.equal(scheduled[0].opts?.viewportChanged, true);
});
