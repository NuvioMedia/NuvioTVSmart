import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Ensure clean browser/TV globals before importing modules.
const storage = new Map();
storage.set(
  "layoutPreferences",
  JSON.stringify({
    __profileScoped: true,
    version: 1,
    profiles: {
      1: {
        cardDepthEnabled: true,
        cardDepthEdgeStrength: 40,
        cardDepthSheenStrength: 15,
        cardDepthEdgeCoverage: 25
      }
    }
  })
);
globalThis.localStorage = {
  getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
  setItem: (k, v) => storage.set(String(k), String(v)),
  removeItem: (k) => storage.delete(String(k))
};

let rootSetPropCalls = 0;
let rootSetPropNames = [];
function createRootElement() {
  const props = {};
  const dataset = {};
  return {
    dataset,
    style: {
      getPropertyValue: (name) => props[name] || "",
      setProperty: (name, value) => {
        rootSetPropCalls += 1;
        rootSetPropNames.push(name);
        props[name] = String(value);
      }
    }
  };
}

let currentRoot = createRootElement();
globalThis.document = {
  get documentElement() {
    return currentRoot;
  }
};

const { LayoutPreferences } = await import("./layoutPreferences.js");
const { createHomeScreenMethods05 } =
  await import("../../ui/screens/home/homeScreenMethods-05-apply-hero-to-dom.js");

test("LayoutPreferences.get memoizes :root card-depth styles across unchanged reads and updates on change or new root", () => {
  rootSetPropCalls = 0;
  rootSetPropNames = [];

  LayoutPreferences.get();
  assert.equal(rootSetPropCalls, 6, "initial read sets the 6 card-depth CSS variables once");

  rootSetPropCalls = 0;
  for (let i = 0; i < 20; i += 1) {
    LayoutPreferences.get();
  }
  assert.equal(
    rootSetPropCalls,
    0,
    "repeated unchanged LayoutPreferences.get() calls must perform 0 root.style.setProperty writes"
  );

  // Updating a card-depth field updates the affected properties immediately.
  LayoutPreferences.set({ cardDepthEdgeStrength: 60 }, { silentSync: true });
  assert.ok(rootSetPropCalls > 0, "changing cardDepthEdgeStrength must update root CSS vars");

  rootSetPropCalls = 0;
  LayoutPreferences.get();
  assert.equal(rootSetPropCalls, 0, "subsequent read after set() must remain memoized");

  // Replacing document.documentElement invalidates memo cleanly.
  currentRoot = createRootElement();
  LayoutPreferences.get();
  assert.equal(rootSetPropCalls, 6, "replacing documentElement must reapply card-depth CSS vars");
});

test("HomeScreen applyHeroToDom reuses this.layoutPrefs without extra LayoutPreferences.get() calls", async () => {
  const source05 = await readFile(
    new URL("../../ui/screens/home/homeScreenMethods-05-apply-hero-to-dom.js", import.meta.url),
    "utf8"
  );
  const source11 = await readFile(
    new URL(
      "../../ui/screens/home/homeScreenHelpers-11-build-hero-display-model.js",
      import.meta.url
    ),
    "utf8"
  );
  const sourceMdb = await readFile(
    new URL("../../ui/screens/home/homeMdbListRatings.js", import.meta.url),
    "utf8"
  );
  assert.ok(
    source05.includes("this.layoutPrefs"),
    "applyHeroToDom should thread this.layoutPrefs into hero display builder"
  );
  assert.ok(
    source11.includes("layoutPrefs = null"),
    "hero display model builders must accept pre-read layoutPrefs"
  );
  assert.ok(
    sourceMdb.includes("layoutPrefs = null"),
    "hero MDBList ratings helper must accept pre-read layoutPrefs"
  );

  // Drive live buildModernHeroPresentation with Continue Watching hero when layoutPrefs is passed:
  // count localStorage.getItem calls for "layoutPreferences".
  let layoutGetItemCalls = 0;
  const origGetItem = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = (key) => {
    if (key === "layoutPreferences") layoutGetItemCalls += 1;
    return origGetItem(key);
  };
  try {
    const { buildModernHeroPresentation } =
      await import("../../ui/screens/home/homeScreenHelpers-11-build-hero-display-model.js");
    const prefs = LayoutPreferences.get();
    layoutGetItemCalls = 0;

    const presentation = buildModernHeroPresentation(
      {
        id: "tt999",
        type: "series",
        name: "Test Show",
        heroSource: "continueWatching",
        contentId: "tt999",
        videoId: "tt999:1:1",
        episodeImdbRating: 8.1,
        mdbListRatings: { imdb: 8.1 }
      },
      prefs
    );
    assert.ok(presentation && presentation.title === "Test Show");
    assert.equal(
      layoutGetItemCalls,
      0,
      "passing layoutPrefs into buildModernHeroPresentation must perform 0 layoutPreferences storage reads"
    );
    assert.equal(typeof createHomeScreenMethods05, "function");
  } finally {
    globalThis.localStorage.getItem = origGetItem;
  }
});

test("applyHeroDescriptionAutoScroll defers rAF by 1500ms during active TV navigation and cancels on re-entry or unmount", async () => {
  const vm = await import("node:vm");
  const raw05 = (
    await readFile(
      new URL("../../ui/screens/home/homeScreenMethods-05-apply-hero-to-dom.js", import.meta.url),
      "utf8"
    )
  )
    .replace(/^import [\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, "");

  const applyCalls = [];
  const stopCalls = [];
  let scrollerOptions = null;
  const rafQueue = [];
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    ensureHeroMdbListRatings: () => {},
    registerHomeDomNodes: () => {},
    createHeroDescriptionAutoScroller: (opts) => {
      scrollerOptions = opts;
      return {
        apply: (node, enabled) => applyCalls.push({ node, enabled }),
        stop: () => stopCalls.push(Date.now())
      };
    },
    internals: {
      ScreenUtils: { hide: () => {} }
    }
  });
  vm.runInContext(`${raw05}\nglobalThis.methods = createHomeScreenMethods05();`, context);

  let hydrationScrollActive = false;
  const descNode = { isConnected: true };
  const screen = Object.assign(Object.create(context.methods), {
    container: {
      querySelector: (sel) => (sel === ".home-hero-card .home-hero-description" ? descNode : null)
    },
    layoutPrefs: { heroDescriptionAutoScrollEnabled: true },
    lastHomeInputAt: Date.now(),
    shouldUseBoundedHomeImageHydration: () => true,
    isLegacyTvRuntime: () => false,
    isModernHydrationScrollActive: () => hydrationScrollActive
  });

  // Initial call stops any active scroller and schedules 1500ms timer instead of immediate rAF.
  screen.applyHeroDescriptionAutoScroll();
  assert.equal(stopCalls.length, 1, "must stop active auto-scroller before deferring TV re-entry");
  assert.equal(rafQueue.length, 0, "must not schedule rAF before 1500ms TV settle delay");
  assert.ok(screen.heroDescriptionAutoScrollDelayTimer);
  assert.equal(
    scrollerOptions.isPaused(),
    true,
    "auto-scroller isPaused() must pause during <1600ms home input window"
  );

  // Rapid re-entry stops again, cancels the previous timer, and resets the 1500ms wait.
  const firstTimer = screen.heroDescriptionAutoScrollDelayTimer;
  screen.applyHeroDescriptionAutoScroll();
  assert.equal(stopCalls.length, 2);
  assert.notEqual(screen.heroDescriptionAutoScrollDelayTimer, firstTimer);

  // Unmount (container cleared) before 1500ms fires makes timer a clean no-op.
  screen.container = null;
  await new Promise((r) => setTimeout(r, 1550));
  assert.equal(rafQueue.length, 0, "unmounted screen must not schedule auto-scroll rAF");

  // Re-mount with active input: after 1500ms, rAF runs and calls apply().
  screen.container = {
    querySelector: (sel) => (sel === ".home-hero-card .home-hero-description" ? descNode : null)
  };
  screen.lastHomeInputAt = Date.now();
  screen.applyHeroDescriptionAutoScroll();
  await new Promise((r) => setTimeout(r, 1550));
  assert.equal(rafQueue.length, 1, "must schedule auto-scroll rAF once 1500ms delay completes");
  rafQueue.shift()();
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].node, descNode);

  // Once input ages >= 1600ms and hydration scroll is inactive, isPaused() clears;
  // active modern hydration scroll pauses again.
  screen.lastHomeInputAt = Date.now() - 1700;
  assert.equal(scrollerOptions.isPaused(), false, "isPaused() must clear after 1600ms rest");
  hydrationScrollActive = true;
  assert.equal(
    scrollerOptions.isPaused(),
    true,
    "isPaused() must pause while modern hydration scroll is active"
  );
});
