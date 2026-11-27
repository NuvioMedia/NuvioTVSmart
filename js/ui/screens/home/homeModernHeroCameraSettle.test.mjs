import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const stripImportsAndExports = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

const [source04, source10, source14, source18, policySource] = await Promise.all([
  readFile(new URL("./homeScreenMethods-04-get-hero-focus-delay.js", import.meta.url), "utf8").then(
    stripImportsAndExports
  ),
  readFile(
    new URL("./homeScreenMethods-10-schedule-modern-hero-update.js", import.meta.url),
    "utf8"
  ).then(stripImportsAndExports),
  readFile(
    new URL("./homeScreenMethods-14-activate-focused-poster-flow.js", import.meta.url),
    "utf8"
  ).then(stripImportsAndExports),
  readFile(new URL("./homeScreenMethods-18-focus-node.js", import.meta.url), "utf8").then(
    stripImportsAndExports
  ),
  readFile(new URL("../../../platform/tvPerformancePolicy.js", import.meta.url), "utf8").then(
    stripImportsAndExports
  )
]);

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  const rafs = new Map();
  return {
    timers,
    rafs,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { id, callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextId++;
      rafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    flushTimers() {
      const entries = Array.from(timers.values());
      timers.clear();
      entries.forEach((entry) => entry.callback());
    },
    flushRafs() {
      const entries = Array.from(rafs.values());
      rafs.clear();
      entries.forEach((callback) => callback());
    }
  };
}

function createHeroHarness({
  profile = { isTvRuntime: true, isPerformanceConstrained: false, isLegacyTvRuntime: false },
  heroDelayMs = 120,
  hydrationScrollActive = false,
  verticalScrollActive = false,
  trackHorizontalScrollActive = false,
  lastHomeInputAt = 0,
  initialNow = 10000
} = {}) {
  const scheduler = createFakeTimers();
  const calls = {
    preloads: [],
    applies: [],
    enriches: []
  };
  let scrollHydrationActive = hydrationScrollActive;
  let scrollVerticalActive = verticalScrollActive;
  let trackScrollActive = trackHorizontalScrollActive;
  let nowMs = initialNow;

  const context = vm.createContext({
    console,
    Date: { now: () => nowMs },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    internals: {
      MODERN_HOME_CONSTANTS: {
        heroFocusDelayMs: heroDelayMs,
        heroRapidNavThresholdMs: 130,
        heroRapidSettleMs: heroDelayMs,
        verticalScrollSettlePollMs: 60
      },
      shouldEnrichModernHero: (hero) => Boolean(hero?.needsEnrich),
      preloadHeroAssets: (hero) => {
        calls.preloads.push(hero.id);
        return Promise.resolve();
      },
      buildHeroIdentity: (hero) => (hero ? `${hero.type || "movie"}:${hero.id || ""}` : "")
    },
    getTvRuntimePerformanceProfile: () => profile
  });
  context.globalThis = context;
  vm.runInContext(
    `${policySource}\n${source04}\n${source10}\nglobalThis.api = { ...createHomeScreenMethods04(), ...createHomeScreenMethods10() };`,
    context
  );

  const heroNode = { classList: { add() {}, remove() {} } };
  const trackNode = { id: "track-1" };
  const card = {
    isConnected: true,
    closest: (selector) => (selector === ".home-track, .home-grid-track" ? trackNode : null),
    hero: { id: "tt100", type: "movie", name: "Next Hero", needsEnrich: true },
    classList: { contains: (name) => name === "focused" }
  };

  const screen = Object.assign(Object.create(context.api), {
    layoutMode: "modern",
    lastHomeInputAt,
    heroCandidates: [card.hero],
    heroItem: { id: "tt001", type: "movie", name: "Prev Hero" },
    container: {
      querySelector: (selector) => (selector === ".home-modern-hero-card" ? heroNode : null)
    },
    isLegacyTvRuntime: () => Boolean(profile.isLegacyTvRuntime),
    isModernVerticalScrollActive: () => scrollVerticalActive,
    isModernHydrationScrollActive: () => scrollHydrationActive,
    isScrollAnimationActive: (container, axis) =>
      container === trackNode && axis === "x" && trackScrollActive,
    getCurrentFocusedNode: () => card,
    getNodeHeroSource: (node) => node?.hero || null,
    syncCollectionHeroMedia() {},
    applyHeroToDom() {
      calls.applies.push({
        id: this.heroItem?.id,
        enriching: this.heroItem?.heroMetaEnriching
      });
    },
    enrichCurrentHeroAsync(hero, focusToken, options) {
      calls.enriches.push({ id: hero.id, focusToken, options });
      return Promise.resolve();
    }
  });

  return {
    screen,
    card,
    calls,
    scheduler,
    advanceNow(deltaMs) {
      nowMs += deltaMs;
    },
    setHydrationScrollActive(next) {
      scrollHydrationActive = next;
    },
    setVerticalScrollActive(next) {
      scrollVerticalActive = next;
    },
    setTrackHorizontalScrollActive(next) {
      trackScrollActive = next;
    }
  };
}

test("full modern TV mode defers hero commit and preload until horizontal camera scroll settles", () => {
  const harness = createHeroHarness({
    profile: { isTvRuntime: true, isPerformanceConstrained: false, isLegacyTvRuntime: false },
    hydrationScrollActive: true,
    verticalScrollActive: false
  });

  harness.screen.scheduleModernHeroUpdate(harness.card, { deferUntilVerticalSettle: false });
  // Initial delay timer + preload timer fire while horizontal spring scroll is active.
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.equal(harness.calls.preloads.length, 0, "preload waits for horizontal camera settle");
  assert.equal(
    harness.calls.applies.length,
    0,
    "applyHeroToDom waits for horizontal camera settle"
  );
  assert.equal(harness.calls.enriches.length, 0, "enrichment waits for camera settle");

  // Still polling on next tick while scroll remains active.
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.equal(harness.calls.applies.length, 0);

  // Camera scroll settles -> preload + hero commit proceed on the next poll + rAF.
  harness.setHydrationScrollActive(false);
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.deepEqual(harness.calls.preloads, ["tt100", "tt100"]);
  assert.deepEqual(harness.calls.applies, [{ id: "tt100", enriching: false }]);
  assert.equal(
    harness.calls.enriches.length,
    0,
    "full TV mode schedules enrichment after a short post-commit settle delay"
  );
  assert.ok(harness.screen.heroEnrichDwellTimer, "post-commit heroEnrichDwellTimer is armed");
  const enrichTimer = Array.from(harness.scheduler.timers.values()).find(
    (entry) => entry.id === harness.screen.heroEnrichDwellTimer
  );
  assert.equal(enrichTimer?.delay, 500, "TV post-commit enrichment dwell clears 900ms key cadence");

  harness.scheduler.flushTimers();
  assert.equal(harness.calls.enriches.length, 1);
  assert.equal(harness.calls.enriches[0].id, "tt100");
});

test("cancelling pending hero focus on TV aborts post-commit enrichment dwell", () => {
  const harness = createHeroHarness({
    profile: { isTvRuntime: true, isPerformanceConstrained: false, isLegacyTvRuntime: false },
    hydrationScrollActive: false
  });

  harness.screen.scheduleModernHeroUpdate(harness.card);
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.equal(harness.calls.applies.length, 1);
  assert.equal(harness.calls.enriches.length, 0);
  assert.ok(harness.screen.heroEnrichDwellTimer);

  harness.screen.cancelPendingHeroFocus();
  assert.equal(harness.screen.heroEnrichDwellTimer, null);
  harness.scheduler.flushTimers();
  assert.equal(harness.calls.enriches.length, 0, "cancelled focus never fires enrichment fetches");
});

test("non-TV horizontal scheduleModernHeroUpdate keeps immediate commit and enrichment timing", () => {
  const harness = createHeroHarness({
    profile: { isTvRuntime: false, isPerformanceConstrained: false, isLegacyTvRuntime: false },
    hydrationScrollActive: true,
    verticalScrollActive: false
  });

  harness.screen.scheduleModernHeroUpdate(harness.card, { deferUntilVerticalSettle: false });
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.deepEqual(harness.calls.applies, [{ id: "tt100", enriching: true }]);
  assert.equal(harness.calls.enriches.length, 1, "non-TV enrichment fires immediately on commit");
  assert.equal(harness.screen.heroEnrichDwellTimer || null, null);
});

test("constrained TV keeps heroMetaEnriching false and waits constrained dwell before enrichment", () => {
  const harness = createHeroHarness({
    profile: { isTvRuntime: true, isPerformanceConstrained: true, isLegacyTvRuntime: false },
    hydrationScrollActive: false
  });

  harness.screen.scheduleModernHeroUpdate(harness.card);
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.deepEqual(harness.calls.applies, [{ id: "tt100", enriching: false }]);
  assert.equal(harness.calls.enriches.length, 0);
  const enrichTimer = Array.from(harness.scheduler.timers.values()).find(
    (entry) => entry.id === harness.screen.heroEnrichDwellTimer
  );
  assert.equal(enrichTimer?.delay, 500);
});

test("modern hero description bounds skip legacy-tizen, defer during scroll, and memoize unchanged copy", () => {
  const scheduler = createFakeTimers();
  class HTMLElement {}
  let computedStyleReads = 0;
  let rectReads = 0;
  let scrollActive = true;
  let legacyTizen = true;
  const resizeListeners = [];

  const context = vm.createContext({
    HTMLElement,
    WeakMap,
    innerWidth: 1920,
    innerHeight: 1080,
    document: {
      body: { classList: { contains: (name) => name === "legacy-tizen" && legacyTizen } },
      documentElement: { classList: { contains: () => false } }
    },
    window: {
      addEventListener: (event, handler) => {
        if (event === "resize") resizeListeners.push(handler);
      }
    },
    getComputedStyle: (node) => {
      computedStyleReads += 1;
      return (
        node.computedStyle || {
          lineHeight: "28px",
          fontSize: "20px",
          rowGap: "10px",
          display: "block"
        }
      );
    },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    registerHomeDomNodes: () => {},
    getTrailerMountGraceMs: () => 0,
    internals: {
      MODERN_HOME_CONSTANTS: { verticalScrollSettlePollMs: 60 },
      applyTrailerAudioPreferences: (v) => v,
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true, isPerformanceConstrained: false })
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source14}\nglobalThis.api = createHomeScreenMethods14();`, context);

  const titleSibling = new HTMLElement();
  titleSibling.className = "home-hero-brand";
  titleSibling.textContent = "Movie Title";
  titleSibling.getBoundingClientRect = () => {
    rectReads += 1;
    return { height: 60 };
  };

  const description = new HTMLElement();
  description.className = "home-hero-description";
  description.textContent = "A long synopsis";
  description.style = { maxHeight: "", webkitLineClamp: "" };
  description.classList = { contains: () => false };

  const copy = new HTMLElement();
  copy.className = "home-modern-hero-copy";
  copy.clientWidth = 800;
  copy.clientHeight = 200;
  copy.children = [titleSibling, description];
  description.closest = (selector) => (selector === ".home-modern-hero-copy" ? copy : null);

  const heroNode = new HTMLElement();
  heroNode.classList = { contains: (name) => name === "home-hero-card" };
  heroNode.querySelector = (selector) =>
    selector === ".home-hero-description" ? description : null;

  const container = new HTMLElement();
  container.classList = { contains: () => false };
  container.querySelectorAll = (selector) => (selector === ".home-hero-card" ? [heroNode] : []);

  const screen = Object.assign(Object.create(context.api), {
    container,
    layoutMode: "modern",
    isPerformanceConstrained: () => false,
    isModernHydrationScrollActive: () => scrollActive
  });

  // 1. .legacy-tizen skips JS truncation bounds entirely (CSS line-clamp owns it).
  screen.scheduleHomeTruncationUpdate();
  assert.equal(scheduler.rafs.size, 0, "legacy-tizen must not schedule rAF bounds measurement");
  assert.equal(scheduler.timers.size, 0);
  screen.applyModernHeroDescriptionBounds(container);
  assert.equal(computedStyleReads, 0);
  assert.equal(rectReads, 0);

  // 2. Non-legacy-tizen defers measurement while hydration scroll is active.
  legacyTizen = false;
  screen.scheduleHomeTruncationUpdate();
  assert.equal(scheduler.rafs.size, 0, "must defer rAF while camera scroll is active");
  assert.equal(scheduler.timers.size, 1, "settle poll timer armed during scroll");

  scheduler.flushTimers();
  assert.equal(scheduler.rafs.size, 0, "continues waiting while scroll stays active");

  scrollActive = false;
  scheduler.flushTimers();
  assert.equal(scheduler.rafs.size, 1, "schedules rAF once camera scroll settles");
  scheduler.flushRafs();
  assert.ok(computedStyleReads > 0);
  assert.ok(rectReads > 0);
  assert.equal(description.style.webkitLineClamp, "4");

  // 3. Second call with unchanged copy dimensions & text skips layout/style reads.
  const prevComputedReads = computedStyleReads;
  const prevRectReads = rectReads;
  screen.scheduleHomeTruncationUpdate();
  scheduler.flushRafs();
  assert.equal(computedStyleReads, prevComputedReads, "unchanged hero copy skips getComputedStyle");
  assert.equal(rectReads, prevRectReads, "unchanged hero copy skips getBoundingClientRect");

  // 4. Changing description text invalidates memoization and re-measures.
  description.textContent = "A different synopsis";
  screen.scheduleHomeTruncationUpdate();
  scheduler.flushRafs();
  assert.ok(computedStyleReads > prevComputedReads);
  assert.ok(rectReads > prevRectReads);

  // 5. Resize observer invalidates memoization even with identical text/dimensions.
  const readsAfterTextChange = computedStyleReads;
  screen.ensureHomeTruncationObservers();
  assert.equal(resizeListeners.length, 1);
  resizeListeners[0]();
  scheduler.flushRafs();
  assert.ok(computedStyleReads > readsAfterTextChange, "resize invalidates bounds memoization");
});

test("focusNode skips redundant vertical visibility check on same-row horizontal moves and aligns camera settle flags", () => {
  const context = vm.createContext({
    internals: {
      HOME_PERF_DEBUG: false,
      homePerfNow: () => 0,
      logHomePerf: () => {},
      groupNodesByOffsetTop: () => []
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source18}\nglobalThis.api = createHomeScreenMethods18();`, context);

  const rowSection = { id: "row-1" };
  const makeCard = (id, anchor) => {
    const classes = new Set();
    return {
      id,
      anchor,
      dataset: { navZone: "main" },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      }
    };
  };
  const cardA = makeCard("a", rowSection);
  const cardB = makeCard("b", rowSection);
  const cardOtherRow = makeCard("c", { id: "row-2" });
  const sidebarNode = {
    id: "side",
    anchor: null,
    dataset: { navZone: "sidebar" },
    classList: { add() {}, remove() {}, contains: () => false }
  };
  sidebarNode.anchor = sidebarNode;

  let constrained = false;
  let legacyTv = false;
  const calls = {
    vertical: [],
    horizontal: [],
    heroUpdates: [],
    posterFlows: []
  };

  const screen = Object.assign(Object.create(context.api), {
    layoutMode: "modern",
    refreshPendingHomeTrailerCleanup() {},
    getExpandedPosterScrollAdjustments: () => ({ horizontal: 0, vertical: 0 }),
    focusWithoutAutoScroll() {},
    setCurrentFocusedNode() {},
    isPerformanceConstrained: () => constrained,
    isLegacyTvRuntime: () => legacyTv,
    shouldUseImmediateFocusScroll: () => constrained,
    scheduleHomeLazyImageHydration() {},
    isCollectionFolderNode: () => false,
    setSidebarExpanded() {},
    isSidebarNode: (node) => node?.dataset?.navZone === "sidebar",
    isMainNode: (node) => node?.dataset?.navZone === "main",
    rememberMainRowFocus() {},
    shouldDeferContinueWatchingFocusEffects: () => false,
    scheduleModernCameraFollow: () => false,
    getMainFocusAnchor: (node) => node?.anchor || null,
    ensureTrackHorizontalVisibility(target, direction) {
      calls.horizontal.push({ id: target.id, direction });
    },
    ensureMainVerticalVisibility(target, direction) {
      calls.vertical.push({ id: target.id, direction });
    },
    scheduleModernTrackPaginationForFocus() {},
    ensureContinueWatchingRenderAhead() {},
    scheduleModernHeroUpdate(target, options) {
      calls.heroUpdates.push({ id: target.id, options });
    },
    scheduleFocusedPosterFlow(target, options) {
      calls.posterFlows.push({ id: target.id, options });
    }
  });

  // Same-row horizontal move in full modern mode skips vertical visibility & defers hero/poster flow.
  screen.focusNode(cardA, cardB, "right");
  assert.equal(calls.horizontal.length, 1);
  assert.equal(
    calls.vertical.length,
    0,
    "same-row horizontal move skips ensureMainVerticalVisibility"
  );
  assert.equal(calls.heroUpdates.at(-1).id, "b");
  assert.equal(calls.heroUpdates.at(-1).options.deferUntilVerticalSettle, true);
  assert.equal(calls.posterFlows.at(-1).id, "b");
  assert.equal(calls.posterFlows.at(-1).options.deferUntilVerticalSettle, true);

  // Entering main from sidebar still aligns vertical visibility.
  screen.focusNode(sidebarNode, cardA, "right");
  assert.equal(
    calls.vertical.length,
    1,
    "sidebar -> main entry keeps ensureMainVerticalVisibility"
  );

  // Vertical move keeps ensureMainVerticalVisibility and deferUntilVerticalSettle: true.
  screen.focusNode(cardA, cardOtherRow, "down");
  assert.equal(calls.vertical.length, 2);
  assert.equal(calls.heroUpdates.at(-1).id, "c");
  assert.equal(calls.heroUpdates.at(-1).options.deferUntilVerticalSettle, true);

  // Constrained TV horizontal move keeps deferUntilVerticalSettle: false.
  constrained = true;
  screen.focusNode(cardA, cardB, "right");
  assert.equal(calls.heroUpdates.at(-1).id, "b");
  assert.equal(calls.heroUpdates.at(-1).options.deferUntilVerticalSettle, false);
  assert.equal(calls.posterFlows.at(-1).id, "b");
  assert.equal(calls.posterFlows.at(-1).options.deferUntilVerticalSettle, false);
});

test("TV browsing cadence stretches hero delay, pushes preloadDelay past 370ms, and honors track scroll + input quiet", () => {
  const harness = createHeroHarness({
    profile: { isTvRuntime: true, isPerformanceConstrained: false, isLegacyTvRuntime: false },
    heroDelayMs: 450,
    hydrationScrollActive: false,
    trackHorizontalScrollActive: true,
    lastHomeInputAt: 10000,
    initialNow: 10000
  });

  // First key: keeps 450ms focus delay and schedules preload at 370ms (outside 350ms frame-pace window).
  harness.screen.scheduleModernHeroUpdate(harness.card);
  const firstPreloadTimer = Array.from(harness.scheduler.timers.values()).find(
    (entry) => entry.id === harness.screen.heroBackdropPreloadTimer
  );
  const firstCommitTimer = Array.from(harness.scheduler.timers.values()).find(
    (entry) => entry.id === harness.screen.heroFocusDelayTimer
  );
  assert.equal(firstPreloadTimer?.delay, 370);
  assert.equal(firstCommitTimer?.delay, 450);

  // Follow-up browsing key within 1400ms uses 520ms delay and 440ms preloadDelay (440 > 370ms quiet, 520 + 400ms fade < 1000ms).
  harness.advanceNow(900);
  harness.screen.lastHomeInputAt = 10900;
  harness.screen.scheduleModernHeroUpdate(harness.card);
  const browsePreloadTimer = Array.from(harness.scheduler.timers.values()).find(
    (entry) => entry.id === harness.screen.heroBackdropPreloadTimer
  );
  const browseCommitTimer = Array.from(harness.scheduler.timers.values()).find(
    (entry) => entry.id === harness.screen.heroFocusDelayTimer
  );
  assert.equal(browsePreloadTimer?.delay, 440);
  assert.equal(browseCommitTimer?.delay, 520);

  // Even after input quiet passes, active horizontal track scroll keeps hero preload/commit deferred.
  harness.advanceNow(400);
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.equal(harness.calls.preloads.length, 0);
  assert.equal(harness.calls.applies.length, 0);

  harness.setTrackHorizontalScrollActive(false);
  harness.scheduler.flushTimers();
  harness.scheduler.flushRafs();
  assert.deepEqual(harness.calls.preloads, ["tt100", "tt100"]);
  assert.deepEqual(harness.calls.applies, [{ id: "tt100", enriching: false }]);
});

test("focusNode defers collection GIF hydration into 380ms timer on bounded TV and rAF on desktop", () => {
  const scheduler = createFakeTimers();
  const context = vm.createContext({
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    internals: {
      HOME_PERF_DEBUG: false,
      homePerfNow: () => 0,
      logHomePerf: () => {},
      groupNodesByOffsetTop: () => []
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source18}\nglobalThis.api = createHomeScreenMethods18();`, context);

  const rowSection = { id: "row-collection" };
  const makeCard = (id, collectionFolder = false) => {
    const classes = new Set();
    return {
      id,
      anchor: rowSection,
      collectionFolder,
      isConnected: true,
      dataset: { navZone: "main" },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      }
    };
  };
  const regularCard = makeCard("regular", false);
  const collectionCardA = makeCard("col-a", true);
  const collectionCardB = makeCard("col-b", true);
  let activeFocus = regularCard;
  let boundedTv = true;
  const gifHydrations = [];
  let posterFlowCalls = 0;

  const screen = Object.assign(Object.create(context.api), {
    layoutMode: "modern",
    refreshPendingHomeTrailerCleanup() {},
    getExpandedPosterScrollAdjustments: () => ({ horizontal: 0, vertical: 0 }),
    focusWithoutAutoScroll() {},
    getCurrentFocusedNode: () => activeFocus,
    setCurrentFocusedNode(node) {
      activeFocus = node;
    },
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    shouldUseImmediateFocusScroll: () => false,
    shouldUseBoundedHomeImageHydration: () => boundedTv,
    scheduleHomeLazyImageHydration() {},
    isCollectionFolderNode: (node) => Boolean(node?.collectionFolder),
    hydrateCollectionFocusGif(node, active) {
      gifHydrations.push({ id: node.id, active });
    },
    setSidebarExpanded() {},
    isSidebarNode: () => false,
    isMainNode: () => true,
    rememberMainRowFocus() {},
    shouldDeferContinueWatchingFocusEffects: () => false,
    scheduleModernCameraFollow: () => false,
    getMainFocusAnchor: (node) => node?.anchor || null,
    ensureTrackHorizontalVisibility() {},
    ensureMainVerticalVisibility() {},
    scheduleModernTrackPaginationForFocus() {},
    ensureContinueWatchingRenderAhead() {},
    scheduleModernHeroUpdate() {},
    cancelFocusedPosterFlow() {},
    clearFocusedPosterFlowState() {},
    scheduleFocusedPosterFlow() {
      posterFlowCalls += 1;
    }
  });

  // Bounded TV defers collection GIF hydration into a 380ms timer (outside 350ms frame-pace window).
  screen.focusNode(regularCard, collectionCardA, "right");
  assert.equal(gifHydrations.length, 0, "must not hydrate collection GIF synchronously in keydown");
  assert.equal(
    posterFlowCalls,
    0,
    "must not re-enter sync scheduleFocusedPosterFlow for collection targets"
  );
  assert.equal(scheduler.rafs.size, 0);
  assert.equal(scheduler.timers.size, 1);
  assert.equal(Array.from(scheduler.timers.values())[0].delay, 380);

  // Rapid move before 380ms timer fires cancels collectionCardA's pending hydration.
  screen.focusNode(collectionCardA, collectionCardB, "right");
  assert.equal(gifHydrations.length, 0);
  assert.equal(scheduler.timers.size, 1);

  scheduler.flushTimers();
  assert.equal(gifHydrations.length, 1);
  assert.equal(gifHydrations[0].id, "col-b");
  assert.equal(gifHydrations[0].active, true);

  // Desktop / non-bounded mode falls back to rAF deferral (still 0 sync reads on keydown).
  boundedTv = false;
  screen.focusNode(collectionCardB, collectionCardA, "left");
  assert.equal(scheduler.rafs.size, 1);
  scheduler.flushRafs();
  assert.equal(gifHydrations.length, 2);
  assert.equal(gifHydrations[1].id, "col-a");
});

test("focusNode skips track horizontal alignment and pagination at col 0 on vertical moves when scrollLeft <= 1", () => {
  const context = vm.createContext({
    internals: {
      HOME_PERF_DEBUG: false,
      homePerfNow: () => 0,
      logHomePerf: () => {},
      groupNodesByOffsetTop: () => []
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source18}\nglobalThis.api = createHomeScreenMethods18();`, context);

  const trackAtOrigin = { scrollLeft: 0 };
  const scrolledTrack = { scrollLeft: 120 };
  const makeCard = (id, navCol, track, anchor) => {
    const classes = new Set();
    return {
      id,
      anchor,
      dataset: { navZone: "main", navCol: String(navCol) },
      closest: (selector) => (selector === ".home-track" ? track : null),
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      }
    };
  };

  const row1 = { id: "r1" };
  const row2 = { id: "r2" };
  const r1c0 = makeCard("r1c0", 0, trackAtOrigin, row1);
  const r2c0 = makeCard("r2c0", 0, trackAtOrigin, row2);
  const r2c2 = makeCard("r2c2", 2, trackAtOrigin, row2);
  const r1c0Scrolled = makeCard("r1c0s", 0, scrolledTrack, row1);

  let horizCalls = 0;
  let paginationCalls = 0;
  const screen = Object.assign(Object.create(context.api), {
    layoutMode: "modern",
    refreshPendingHomeTrailerCleanup() {},
    getExpandedPosterScrollAdjustments: () => ({ horizontal: 0, vertical: 0 }),
    focusWithoutAutoScroll() {},
    setCurrentFocusedNode() {},
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    shouldUseImmediateFocusScroll: () => false,
    scheduleHomeLazyImageHydration() {},
    isCollectionFolderNode: () => false,
    setSidebarExpanded() {},
    isSidebarNode: () => false,
    isMainNode: () => true,
    rememberMainRowFocus() {},
    shouldDeferContinueWatchingFocusEffects: () => false,
    scheduleModernCameraFollow: () => false,
    getMainFocusAnchor: (node) => node?.anchor || null,
    ensureTrackHorizontalVisibility() {
      horizCalls += 1;
    },
    ensureMainVerticalVisibility() {},
    scheduleModernTrackPaginationForFocus() {
      paginationCalls += 1;
    },
    ensureContinueWatchingRenderAhead() {},
    scheduleModernHeroUpdate() {},
    scheduleFocusedPosterFlow() {}
  });

  // 1. Vertical move to navCol=0 with scrollLeft<=1 skips both horizontal align & pagination.
  screen.focusNode(r1c0, r2c0, "down");
  assert.equal(horizCalls, 0);
  assert.equal(paginationCalls, 0);

  // 2. Vertical move to navCol>0 keeps both horizontal align & pagination.
  screen.focusNode(r1c0, r2c2, "down");
  assert.equal(horizCalls, 1);
  assert.equal(paginationCalls, 1);

  // 3. Vertical move to navCol=0 when track.scrollLeft > 1 still aligns horizontally.
  screen.focusNode(r2c0, r1c0Scrolled, "up");
  assert.equal(horizCalls, 2);
  assert.equal(paginationCalls, 1);

  // 4. Horizontal move back to navCol=0 keeps both horizontal align & pagination.
  screen.focusNode(r2c2, r2c0, "left");
  assert.equal(horizCalls, 3);
  assert.equal(paginationCalls, 2);
});
