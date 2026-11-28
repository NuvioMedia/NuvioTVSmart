import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createHomeRowWindow, HOME_ROW_PARKED_CLASS } from "./homeRowWindow.js";

const strip = (source) => source.replace(/^import [\s\S]*?;$/gm, "").replace(/^export /gm, "");

const source02 = strip(
  await readFile(
    new URL("./homeScreenMethods-02-restore-modern-focus-state.js", import.meta.url),
    "utf8"
  )
);

function buildHarness({ stiffness = 180, dampingRatio = 0.95, isTvRuntime = true } = {}) {
  let nextRaf = 1;
  let now = 0;
  const scheduledRafs = new Map();
  const context = vm.createContext({
    internals: {
      MODERN_HOME_CONSTANTS: {
        springScrollStiffness: stiffness,
        springScrollDampingRatio: dampingRatio
      },
      findHomeFocusIdentityMatch: () => null,
      MODERN_CAMERA_PAN_EASING: (t) => t
    },
    isModernTvProfile: () => isTvRuntime,
    getTvRuntimePerformanceProfile: () => ({
      isTvRuntime,
      isPerformanceConstrained: false,
      isLegacyTvRuntime: false
    }),
    performance: { now: () => now },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => {
      const id = nextRaf++;
      scheduledRafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => {
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

  return { screen, scheduledRafs, stepFrame };
}

function createTrackedContainer({
  scrollWidth = 4000,
  clientWidth = 1920,
  scrollHeight = 4000,
  clientHeight = 560,
  initialClasses = []
} = {}) {
  const classes = new Set(initialClasses);
  const classEvents = [];
  const xWrites = [];
  const yWrites = [];
  let scrollLeft = 0;
  let scrollTop = 0;
  const container = {
    isConnected: true,
    scrollWidth,
    clientWidth,
    scrollHeight,
    clientHeight,
    classList: {
      add: (name) => {
        classes.add(name);
        classEvents.push(["add", name]);
      },
      remove: (name) => {
        classes.delete(name);
        classEvents.push(["remove", name]);
      },
      contains: (name) => classes.has(name)
    }
  };
  Object.defineProperty(container, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value) => {
      const max = Math.max(0, container.scrollWidth - container.clientWidth);
      const next = Math.max(0, Math.min(max, Number(value) || 0));
      xWrites.push(value);
      scrollLeft = next;
    }
  });
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value) => {
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      const next = Math.max(0, Math.min(max, Number(value) || 0));
      yWrites.push(value);
      scrollTop = next;
    }
  });
  return { container, classes, classEvents, xWrites, yWrites };
}

test("TV animateSpringScroll settles a 443px move smoothly in <= 16 frames (~250ms) without reading layout inside tick", () => {
  const { screen, scheduledRafs, stepFrame } = buildHarness({ isTvRuntime: true });
  const { container, xWrites } = createTrackedContainer({ initialClasses: ["home-track"] });
  let layoutReadsDuringTick = 0;
  let scrollLeftReadsDuringTick = 0;
  let ticking = false;
  let inSetter = false;
  const origScrollLeftDesc = Object.getOwnPropertyDescriptor(container, "scrollLeft");
  Object.defineProperty(container, "scrollLeft", {
    configurable: true,
    get: () => {
      if (ticking) scrollLeftReadsDuringTick += 1;
      return origScrollLeftDesc.get();
    },
    set: (value) => {
      inSetter = true;
      try {
        origScrollLeftDesc.set(value);
      } finally {
        inSetter = false;
      }
    }
  });
  Object.defineProperty(container, "scrollWidth", {
    get: () => {
      if (ticking && !inSetter) layoutReadsDuringTick += 1;
      return 4000;
    }
  });

  screen.animateSpringScroll(container, "x", 443);
  assert.equal(scheduledRafs.size, 1);
  assert.equal(xWrites.length, 0);

  let frames = 0;
  ticking = true;
  while (scheduledRafs.size && frames < 60) {
    stepFrame(16.7);
    frames += 1;
  }
  ticking = false;

  assert.equal(scheduledRafs.size, 0, "spring must finish scheduling rAF");
  assert.equal(container.scrollLeft, 443);
  assert.equal(layoutReadsDuringTick, 0, "tick must never read scrollWidth/scrollHeight");
  assert.equal(scrollLeftReadsDuringTick, 0, "tick must never read scrollLeft/scrollTop");
  assert.ok(frames <= 16, `expected <= 16 frames (~250ms) on TV, got ${frames}`);
  assert.ok(xWrites.length > 0 && xWrites.length <= 16, `unexpected write count ${xWrites.length}`);
  for (let i = 0; i < xWrites.length; i += 1) {
    assert.equal(
      Number.isInteger(xWrites[i]),
      true,
      `scrollLeft write #${i} must be integer, got ${xWrites[i]}`
    );
    assert.ok(xWrites[i] >= 0 && xWrites[i] <= 443, `overshoot detected: ${xWrites[i]}`);
    if (i > 0) {
      assert.notEqual(
        xWrites[i],
        xWrites[i - 1],
        `duplicate consecutive scrollLeft write ${xWrites[i]} at index ${i}`
      );
    }
  }

  // Verify sub-stepped TV spring also has zero overshoot under 34ms frame drops.
  const dropHarness = buildHarness({ isTvRuntime: true });
  const dropTarget = createTrackedContainer({ initialClasses: ["home-track"] });
  dropHarness.screen.animateSpringScroll(dropTarget.container, "x", 443);
  let dropFrames = 0;
  while (dropHarness.scheduledRafs.size && dropFrames < 40) {
    dropHarness.stepFrame(34);
    dropFrames += 1;
  }
  assert.equal(dropTarget.container.scrollLeft, 443);
  assert.ok(
    dropTarget.xWrites.every((v) => v >= 0 && v <= 443),
    "no overshoot on 34ms frames"
  );
});

test("non-TV animateSpringScroll writes only changed integer offsets and settles without tail drag", () => {
  const { screen, scheduledRafs, stepFrame } = buildHarness({ isTvRuntime: false });
  const { container, xWrites } = createTrackedContainer({ initialClasses: ["home-track"] });

  screen.animateSpringScroll(container, "x", 224);
  let frames = 0;
  while (scheduledRafs.size && frames < 120) {
    stepFrame(16);
    frames += 1;
  }

  assert.equal(scheduledRafs.size, 0);
  assert.equal(container.scrollLeft, 224);
  assert.ok(frames <= 42, `expected <= 42 frames without tail drag, got ${frames}`);
  assert.ok(xWrites.every((v) => Number.isInteger(v)));
  for (let i = 1; i < xWrites.length; i += 1) {
    assert.notEqual(xWrites[i], xWrites[i - 1]);
  }
});

test("animateSpringScroll preserves camera-scrolling hint on active moves, clears on settle, and skips zero-delta springs", () => {
  const { screen, scheduledRafs, stepFrame } = buildHarness({ isTvRuntime: true });

  const track = createTrackedContainer({ initialClasses: ["home-track"] });
  screen.animateSpringScroll(track.container, "x", 224);
  assert.equal(track.classes.has("is-camera-scrolling"), true);
  while (scheduledRafs.size) stepFrame(16);
  assert.equal(track.classes.has("is-camera-scrolling"), false);

  const zeroViewport = createTrackedContainer({
    scrollHeight: 560,
    clientHeight: 560,
    initialClasses: ["home-modern-rows-viewport"]
  });
  screen.animateSpringScroll(zeroViewport.container, "y", 300);
  assert.equal(scheduledRafs.size, 1, "must still schedule initial rAF for lifecycle parity");
  assert.equal(zeroViewport.classes.has("is-camera-scrolling"), false);
  stepFrame(16);
  assert.equal(scheduledRafs.size, 0);
  assert.equal(zeroViewport.yWrites.length, 0);

  const viewport = createTrackedContainer({ initialClasses: ["home-modern-rows-viewport"] });
  screen.animateSpringScroll(viewport.container, "y", 390);
  assert.equal(viewport.classes.has("is-camera-scrolling"), true);
  while (scheduledRafs.size) stepFrame(16);
  assert.equal(viewport.classes.has("is-camera-scrolling"), false);
  assert.equal(viewport.container.scrollTop, 390);
});

test("animateSpringScroll updates target mid-flight with integer-only writes", () => {
  const { screen, scheduledRafs, stepFrame } = buildHarness({ isTvRuntime: true });
  const { container, xWrites } = createTrackedContainer();

  screen.animateSpringScroll(container, "x", 224);
  for (let i = 0; i < 4; i += 1) stepFrame(16);
  screen.animateSpringScroll(container, "x", 480);

  let frames = 0;
  while (scheduledRafs.size && frames < 120) {
    stepFrame(16);
    frames += 1;
  }

  assert.equal(scheduledRafs.size, 0);
  assert.equal(container.scrollLeft, 480);
  assert.ok(xWrites.every((value) => Number.isInteger(value)));
  for (let i = 1; i < xWrites.length; i += 1) {
    assert.notEqual(xWrites[i], xWrites[i - 1]);
  }
});

test("homeRowWindow keeps 150% rootMargin and prefers entry.boundingClientRect height", () => {
  const observerCalls = [];
  class IntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      observerCalls.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  let domRectReads = 0;
  const classes = new Set();
  const section = {
    isConnected: true,
    offsetHeight: 392,
    style: { height: "" },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    querySelector: () => null,
    getBoundingClientRect: () => {
      domRectReads += 1;
      return { height: 392 };
    }
  };

  const rowWindow = createHomeRowWindow({ root: {}, scope: { IntersectionObserver } });
  rowWindow.observe([section]);
  assert.equal(observerCalls[0].options.rootMargin, "150% 0px");

  observerCalls[0].callback([
    { target: section, isIntersecting: false, boundingClientRect: { height: 392 } }
  ]);
  assert.equal(domRectReads, 0, "must reuse entry.boundingClientRect.height when provided");
  assert.equal(classes.has(HOME_ROW_PARKED_CLASS), true);
  assert.equal(section.style.height, "392px");
});

test("homeRowWindow defers IntersectionObserver parking/unparking during camera scroll while keeping ensureReady synchronous", () => {
  const observerCalls = [];
  class IntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      observerCalls.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const timers = new Map();
  let nextTimer = 1;
  const rootClasses = new Set(["is-camera-scrolling"]);
  const root = { classList: { contains: (name) => rootClasses.has(name) } };
  const makeSection = (initiallyParked = false) => {
    const classes = new Set(initiallyParked ? [HOME_ROW_PARKED_CLASS] : []);
    const node = {
      isConnected: true,
      offsetHeight: 392,
      style: { height: initiallyParked ? "392px" : "" },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      },
      querySelector: () => null,
      previousElementSibling: null,
      nextElementSibling: null
    };
    node.closest = () => node;
    return node;
  };

  const rowA = makeSection(false);
  const rowB = makeSection(true);
  const rowC = makeSection(true);
  const rowWindow = createHomeRowWindow({
    root,
    scope: {
      IntersectionObserver,
      setTimeout: (fn) => {
        const id = nextTimer++;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      }
    }
  });
  rowWindow.observe([rowA, rowB, rowC]);

  observerCalls[0].callback([
    { target: rowA, isIntersecting: false, boundingClientRect: { height: 392 } },
    { target: rowB, isIntersecting: true, boundingClientRect: { height: 392 } },
    { target: rowC, isIntersecting: true, boundingClientRect: { height: 392 } }
  ]);

  assert.equal(
    rowA.classList.contains(HOME_ROW_PARKED_CLASS),
    false,
    "parking deferred mid-scroll"
  );
  assert.equal(
    rowB.classList.contains(HOME_ROW_PARKED_CLASS),
    true,
    "unparking deferred mid-scroll"
  );
  assert.equal(timers.size, 1);

  // ensureReady must still unpark immediately even while camera scroll is active.
  assert.equal(rowWindow.ensureReady(rowC), true);
  assert.equal(rowC.classList.contains(HOME_ROW_PARKED_CLASS), false);
  assert.equal(observerCalls.length, 2, "refresh reconnects observer after manual unpark");

  // Reconnected observer reports mid-scroll -> still deferred until scroll clears.
  observerCalls[1].callback([
    { target: rowA, isIntersecting: false, boundingClientRect: { height: 392 } },
    { target: rowB, isIntersecting: true, boundingClientRect: { height: 392 } },
    { target: rowC, isIntersecting: true, boundingClientRect: { height: 392 } }
  ]);
  assert.equal(rowA.classList.contains(HOME_ROW_PARKED_CLASS), false);
  assert.equal(rowB.classList.contains(HOME_ROW_PARKED_CLASS), true);

  // Camera scroll clears -> queued entries flush on next poll tick.
  rootClasses.delete("is-camera-scrolling");
  const pending = Array.from(timers.values());
  timers.clear();
  pending.forEach((fn) => fn());
  assert.equal(rowA.classList.contains(HOME_ROW_PARKED_CLASS), true);
  assert.equal(rowB.classList.contains(HOME_ROW_PARKED_CLASS), false);
});

test("Home focus CSS preserves classic transitions, adds GPU opacity rings + blur caching, and persists modern track/viewport layers", async () => {
  const [css14, css17, css18] = await Promise.all([
    readFile(new URL("../../../../css/components-14.css", import.meta.url), "utf8"),
    readFile(new URL("../../../../css/components-17.css", import.meta.url), "utf8"),
    readFile(new URL("../../../../css/components-18.css", import.meta.url), "utf8")
  ]);

  const cardRule = css14.match(/\.home-screen-shell \.home-content-card \{[^}]*\}/)?.[0] || "";
  assert.match(cardRule, /contain:\s*layout style;/);
  assert.match(cardRule, /transition:\s*transform 120ms ease-out;/);
  assert.doesNotMatch(cardRule, /border-color\s+120ms/);

  const frameRule14 = css14.match(/\.home-screen-shell \.home-poster-frame \{[^}]*\}/)?.[0] || "";
  assert.match(frameRule14, /border-color 120ms ease/);
  assert.match(frameRule14, /box-shadow 120ms ease/);

  const cwMediaRule = css14.match(/\.home-screen-shell \.home-continue-media \{[^}]*\}/)?.[0] || "";
  assert.match(cwMediaRule, /transition:\s*none;/);

  const cwBlurRule =
    css14.match(
      /\.home-screen-shell \.home-continue-card-blur-next-up \.home-continue-bg \{[^}]*\}/
    )?.[0] || "";
  assert.match(cwBlurRule, /translateZ\(0\) scale\(1\.08\)/);
  assert.match(cwBlurRule, /backface-visibility:\s*hidden;/);

  assert.match(
    css14,
    /body:not\(\.performance-constrained\)[\s\S]*?\.home-continue-card:not\(\.home-continue-card-loading\)::after\s*\{[^}]*will-change:\s*opacity;[\s\S]*?transition:\s*opacity 120ms ease;/
  );
  assert.match(
    css14,
    /\.home-screen-shell\.home-layout-modern:not\(\.depth-continue-watching\)[\s\S]*?\.home-continue-media::before\s*\{\s*content:\s*none;\s*\}/
  );

  const frameRule18 =
    css18.match(/\.home-screen-shell\.home-layout-modern \.home-poster-frame \{[^}]*\}/)?.[0] || "";
  assert.match(frameRule18, /transition:\s*height 180ms ease-out;/);
  assert.doesNotMatch(frameRule18, /border-color|box-shadow|background-color/);

  const unfocusedBeforeRule18 =
    css18.match(
      /body:not\(\.performance-constrained\)[\s\S]*?\.home-collection-card\s+\.home-poster-frame::before\s*\{[^}]*\}/
    )?.[0] || "";
  assert.match(unfocusedBeforeRule18, /opacity:\s*0;/);
  assert.match(unfocusedBeforeRule18, /transition:\s*opacity 120ms ease;/);
  assert.doesNotMatch(unfocusedBeforeRule18, /will-change:|translateZ\(0\)/);

  const focusedBeforeRule18 =
    css18.match(
      /body:not\(\.performance-constrained\)[\s\S]*?\.home-collection-card\.focused\s+\.home-poster-frame::before\s*\{[^}]*\}/
    )?.[0] || "";
  assert.match(focusedBeforeRule18, /opacity:\s*1;/);
  assert.match(focusedBeforeRule18, /transform:\s*translateZ\(0\);/);

  const viewportRule17 =
    css17.match(
      /\.home-screen-shell\.home-layout-modern \.home-modern-rows-viewport \{[^}]*\}/
    )?.[0] || "";
  assert.match(viewportRule17, /will-change:\s*scroll-position;/);
  assert.match(
    css17,
    /\.home-row:not\(\.home-row-parked\)[\s\S]*?\.home-track\s*\{[^}]*will-change:\s*scroll-position;/
  );
  assert.doesNotMatch(css17, /\.is-camera-scrolling/);
});

test("createHomeRowWindow keeps IntersectionObserver mutations deferred across 395ms keydown quiet window and cleans up listener", () => {
  let now = 1000;
  let timerSeq = 0;
  const timers = new Map();
  const observerCalls = [];
  const docListeners = new Map();
  const rootClasses = new Set();

  const makeSection = (key, parked = false) => {
    const classes = new Set(["home-row", ...(parked ? [HOME_ROW_PARKED_CLASS] : [])]);
    return {
      isConnected: true,
      dataset: { rowKey: key },
      style: parked ? { height: "392px" } : { height: "" },
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name)
      },
      querySelector: () => null,
      closest: (selector) => (selector === ".home-row" ? null : null),
      getBoundingClientRect: () => ({ height: 392 })
    };
  };

  const rowA = makeSection("row-a", false);
  const rowB = makeSection("row-b", true);
  rowB.closest = () => rowB;

  const scope = {
    Date: { now: () => now },
    document: {
      addEventListener(type, fn, opts) {
        docListeners.set(type, { fn, opts });
      },
      removeEventListener(type, fn, opts) {
        const entry = docListeners.get(type);
        if (entry && entry.fn === fn && entry.opts?.capture === opts?.capture) {
          docListeners.delete(type);
        }
      }
    },
    setTimeout(fn) {
      const id = ++timerSeq;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    IntersectionObserver: function FakeIntersectionObserver(callback, options) {
      const record = { callback, options, observed: [], disconnected: false };
      observerCalls.push(record);
      return {
        observe: (el) => record.observed.push(el),
        unobserve: () => {},
        disconnect: () => {
          record.disconnected = true;
        }
      };
    }
  };

  const root = {
    classList: { contains: (name) => rootClasses.has(name) }
  };

  const rowWindow = createHomeRowWindow({ root, scope });
  rowWindow.observe([rowA, rowB]);

  const keydownEntry = docListeners.get("keydown");
  assert.ok(keydownEntry, "keydown listener registered on document");
  assert.deepEqual(keydownEntry.opts, { capture: true, passive: true });

  // Vertical key pressed at t=1000, camera scroll ends early at t=1180.
  keydownEntry.fn();
  now = 1180;

  observerCalls[0].callback([
    { target: rowA, isIntersecting: false, boundingClientRect: { height: 392 } },
    { target: rowB, isIntersecting: true, boundingClientRect: { height: 392 } }
  ]);
  assert.equal(
    rowA.classList.contains(HOME_ROW_PARKED_CLASS),
    false,
    "row parking deferred inside 395ms keydown quiet window even without is-camera-scrolling"
  );
  assert.equal(rowB.classList.contains(HOME_ROW_PARKED_CLASS), true);

  // Poll at t=1260 (< 395ms) stays deferred.
  now = 1260;
  Array.from(timers.values()).forEach((fn) => {
    timers.clear();
    fn();
  });
  assert.equal(rowA.classList.contains(HOME_ROW_PARKED_CLASS), false);
  assert.equal(timers.size, 1);

  // ensureReady still unparks synchronously during the keydown quiet window.
  assert.equal(rowWindow.ensureReady(rowB), true);
  assert.equal(rowB.classList.contains(HOME_ROW_PARKED_CLASS), false);

  // Re-trigger observation after refresh inside quiet window, then settle at +400ms.
  observerCalls[1].callback([
    { target: rowA, isIntersecting: false, boundingClientRect: { height: 392 } },
    { target: rowB, isIntersecting: true, boundingClientRect: { height: 392 } }
  ]);
  assert.equal(rowA.classList.contains(HOME_ROW_PARKED_CLASS), false);

  now = 1400;
  Array.from(timers.values()).forEach((fn) => {
    timers.clear();
    fn();
  });
  assert.equal(
    rowA.classList.contains(HOME_ROW_PARKED_CLASS),
    true,
    "deferred entries flush once >= 395ms quiet window elapses"
  );

  // Verify 650ms hard cap flushes even if keydowns continue continuously.
  const rowC = makeSection("row-c", false);
  rowWindow.observe([rowA, rowB, rowC]);
  now = 2000;
  keydownEntry.fn();
  observerCalls[1].callback([
    { target: rowC, isIntersecting: false, boundingClientRect: { height: 392 } }
  ]);
  assert.equal(rowC.classList.contains(HOME_ROW_PARKED_CLASS), false);
  now = 2660;
  keydownEntry.fn();
  Array.from(timers.values()).forEach((fn) => {
    timers.clear();
    fn();
  });
  assert.equal(
    rowC.classList.contains(HOME_ROW_PARKED_CLASS),
    true,
    "650ms max-wait cap flushes despite repeated keydowns"
  );

  rowWindow.destroy();
  assert.equal(docListeners.has("keydown"), false, "destroy removes keydown listener");
});
