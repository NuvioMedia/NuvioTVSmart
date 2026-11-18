import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

let isTvRuntime = false;
let route = "home";

const context = vm.createContext({
  buildModernRowKey: () => "collection:test",
  buildPosterSubtitle: () => "",
  escapeHtml: String,
  escapeAttribute: String,
  buildLazyImageAttributes: (src, { defer = false } = {}) =>
    defer ? `data-src="${src}"` : `src="${src}"`,
  getTvRuntimePerformanceProfile: () => ({ isTvRuntime }),
  Router: { getCurrent: () => route },
  internals: {}
});

async function loadFrom(file, start, end) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const from = source.indexOf(start);
  assert.ok(from >= 0);
  const to = end ? source.indexOf(end, from) : source.length;
  assert.ok(to > from);
  vm.runInContext(source.slice(from, to).replace(/^export /gm, ""), context);
}

await loadFrom(
  "./homeUtils.js",
  "export function firstNonEmpty",
  "export function uniqueNonEmptyValues"
);
await loadFrom(
  "./homeScreenHelpers-04-animate-hero-logo-swap.js",
  "export function normalizeCollectionPosterShape"
);
await loadFrom(
  "./homeScreenHelpers-05-normalize-collection-folder-item.js",
  "export function normalizeCollectionFolderItem"
);
await loadFrom(
  "./homeScreenHelpers-15-create-poster-card-markup.js",
  "export function createPosterCardMarkup"
);
await loadFrom(
  "./homeScreenMethods-11-enrich-current-hero-async.js",
  "export function createHomeScreenMethods11"
);

const gif = "https://example.invalid/focus.gif";
const cover = "https://example.invalid/cover.jpg";
const backdrop = "https://example.invalid/backdrop.jpg";
const collection = { id: "test", title: "Collection", backdropImageUrl: backdrop };
const folder = { id: "folder", title: "Folder", focusGifUrl: gif, coverImageUrl: cover };

test("collection poster uses the Android cover/backdrop order regardless of the GIF toggle", () => {
  for (const focusGifEnabled of [false, true, undefined]) {
    for (const [coverImageUrl, backdropImageUrl, expected] of [
      [cover, backdrop, cover],
      ["", backdrop, backdrop],
      ["", "", ""]
    ]) {
      const item = context.normalizeCollectionFolderItem(
        { ...folder, coverImageUrl, focusGifEnabled },
        { ...collection, backdropImageUrl }
      );
      assert.equal(item.poster, expected);
      assert.equal(item.focusGifUrl, gif, "keep configured GIF for later re-enabling");
      assert.equal(item.focusGifEnabled, focusGifEnabled !== false);
      assert.equal(item.background, coverImageUrl || backdropImageUrl);
    }
  }
});

test("all Home layouts and tile shapes leave disabled GIFs unloaded and preserve focus overlays", () => {
  const row = { rowKind: "collection", collectionId: collection.id, collection };
  for (const layout of ["classic", "modern", "grid"]) {
    for (const tileShape of ["POSTER", "SQUARE", "LANDSCAPE"]) {
      for (const focusGifEnabled of [false, true, undefined]) {
        const markup = context.createPosterCardMarkup(
          { ...folder, tileShape, focusGifEnabled },
          0,
          0,
          "collection_folder",
          row,
          true,
          layout
        );
        assert.ok(markup.includes(`class="content-poster" src="${cover}"`));
        for (const image of markup.match(/<img\b[^>]*>/g) || []) {
          assert.ok(!image.includes(` src="${gif}"`), "no eagerly loaded GIF image");
        }
        assert.equal(markup.includes('class="home-poster-focus-gif"'), focusGifEnabled !== false);
        if (focusGifEnabled !== false) {
          assert.ok(markup.includes(`class="home-poster-focus-gif" data-src="${gif}"`));
        }
      }
    }
  }
});

test("focused GIF loads immediately, unloads on blur and reloads on refocus", () => {
  class Image {
    dataset = { src: gif };
    attributes = new Map();
    getAttribute(key) {
      return this.attributes.get(key);
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    removeAttribute(key) {
      this.attributes.delete(key);
    }
  }
  context.HTMLImageElement = Image;
  const image = new Image();
  const classes = new Set();
  const node = {
    querySelector: () => image,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }
  };
  const { hydrateCollectionFocusGif } = context.createHomeScreenMethods11();
  hydrateCollectionFocusGif(node, true);
  assert.equal(image.getAttribute("src"), gif);
  assert.ok(classes.has("is-focus-gif-active"));
  hydrateCollectionFocusGif(node, false);
  assert.equal(image.getAttribute("src"), undefined);
  assert.ok(!classes.has("is-focus-gif-active"));
  hydrateCollectionFocusGif(node, true);
  assert.equal(image.getAttribute("src"), gif);
});

test("smart TV posters are handed to the lazy hydration pass instead of loading on mount", () => {
  const row = { rowKind: "collection", collectionId: collection.id, collection };
  const item = context.normalizeCollectionFolderItem({ ...folder }, { ...collection });
  const render = () =>
    context.createPosterCardMarkup(item, 0, 0, "collection", row, true, "classic", false, false);

  isTvRuntime = false;
  const browser = render();
  assert.match(
    browser,
    /<img class="content-poster" src="/,
    "other runtimes keep loading posters on mount"
  );

  isTvRuntime = true;
  const tv = render();
  assert.match(tv, /<img class="content-poster" data-src="/, "a TV poster waits for hydration");
  assert.doesNotMatch(tv, /<img class="content-poster" src="/);
  route = "folderDetail";
  assert.match(
    render(),
    /<img class="content-poster" src="/,
    "folder detail has its own loading lifecycle"
  );
  route = "home";
  isTvRuntime = false;
});

async function buildCollectionDwellHarness({ layoutMode = "modern", routeName = "home" } = {}) {
  let now = 0;
  let nextTimerId = 1;
  let nextRafId = 1;
  const timers = new Map();
  const rafCallbacks = new Map();
  let verticalScrolling = false;

  class ClassList {
    constructor(initial = []) {
      this.set = new Set(initial);
    }
    add(...names) {
      names.forEach((name) => this.set.add(name));
    }
    remove(...names) {
      names.forEach((name) => this.set.delete(name));
    }
    contains(name) {
      return this.set.has(name);
    }
    toggle(name, force) {
      const next = force === undefined ? !this.set.has(name) : Boolean(force);
      if (next) {
        this.set.add(name);
      } else {
        this.set.delete(name);
      }
      return next;
    }
  }

  class HTMLElement {}
  class HTMLImageElement extends HTMLElement {
    constructor(srcValue) {
      super();
      this.dataset = { src: srcValue };
      this.attributes = new Map();
    }
    getAttribute(key) {
      return this.attributes.get(key);
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    removeAttribute(key) {
      this.attributes.delete(key);
    }
  }

  const noop = () => {};
  const harnessContext = vm.createContext({
    console,
    HTMLElement,
    HTMLImageElement,
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, {
        id,
        callback,
        runAt: now + Math.max(0, Number(delay || 0))
      });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
    performance: { now: () => now },
    internals: {
      HOME_PERF_DEBUG: false,
      homePerfNow: () => now,
      logHomePerf: noop,
      groupNodesByOffsetTop: (nodes) => [nodes],
      Router: { getCurrent: () => routeName },
      MODERN_HOME_CONSTANTS: {
        collectionFocusGifDwellMs: 140,
        verticalScrollSettlePollMs: 60,
        verticalFastScrollVelocityPxPerSec: 6400,
        verticalFastScrollEndTimeoutMs: 160,
        verticalFastScrollMaxFrameMs: 48
      },
      getLegacySidebarSelectedNode: () => null,
      getModernSidebarSelectedNode: () => null,
      getDirectionFromKeyCode: () => null,
      setModernSidebarExpanded: noop,
      setModernSidebarPillIconOnly: noop,
      MODERN_SIDEBAR_PILL_AUTO_COLLAPSE_MS: 4000,
      applyTrailerAudioPreferences: (src) => src,
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: true }),
      firstNonEmpty: (...values) => values.find(Boolean) || "",
      normalizeCollectionFolderItem: (item) => item,
      buildHeroIdentity: () => "",
      buildModernHeroPresentation: () => ({}),
      preloadImageSource: async () => false,
      parseRuntimeMinutes: () => 0,
      withTimeout: (promise) => promise,
      fetchModernHeroTmdbEnrichment: async () => null,
      shouldPreserveHomeRuntimeText: () => false,
      resolveImdbRating: () => null,
      TmdbSettingsStore: { get: () => ({}) },
      metaRepository: {},
      mdbListRepository: {}
    }
  });
  harnessContext.globalThis = harnessContext;

  const files = [
    [
      "./homeScreenMethods-11-enrich-current-hero-async.js",
      "export function createHomeScreenMethods11"
    ],
    [
      "./homeScreenMethods-14-activate-focused-poster-flow.js",
      "export function createHomeScreenMethods14"
    ],
    [
      "./homeScreenMethods-15-schedule-focused-poster-flow.js",
      "export function createHomeScreenMethods15"
    ],
    [
      "./homeScreenMethods-17-end-modern-vertical-fast-scroll.js",
      "export function createHomeScreenMethods17"
    ],
    ["./homeScreenMethods-18-focus-node.js", "export function createHomeScreenMethods18"],
    ["./homeScreenMethods-19-handle-home-dpad.js", "export function createHomeScreenMethods19"]
  ];
  for (const [file, start] of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const from = source.indexOf(start);
    assert.ok(from >= 0, `Missing ${start} in ${file}`);
    vm.runInContext(source.slice(from).replace(/^export /gm, ""), harnessContext);
  }

  const methods = Object.assign(
    {},
    harnessContext.createHomeScreenMethods11(),
    harnessContext.createHomeScreenMethods14(),
    harnessContext.createHomeScreenMethods15(),
    harnessContext.createHomeScreenMethods17(),
    harnessContext.createHomeScreenMethods18(),
    harnessContext.createHomeScreenMethods19()
  );

  const cards = [];
  const listeners = new Map();
  const container = {
    contains: (node) => cards.includes(node),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  function makeCollectionCard(index) {
    const gifUrl = `https://example.invalid/focus-${index}.gif`;
    const gifImage = new HTMLImageElement(gifUrl);
    const card = new HTMLElement();
    card.isConnected = true;
    card.classList = new ClassList([
      "home-content-card",
      "home-poster-card",
      "home-collection-card",
      "focusable"
    ]);
    card.dataset = {
      navZone: "main",
      navRow: "0",
      navCol: String(index),
      navRowKey: "collection:test",
      itemId: `collection:test:folder-${index}`,
      itemType: "collection_folder",
      collectionId: "test",
      folderId: `folder-${index}`
    };
    card.gifImage = gifImage;
    card.gifUrl = gifUrl;
    card.getBoundingClientRect = () => ({ top: index * 320, bottom: index * 320 + 260 });
    card.querySelector = (selector) => (selector === ".home-poster-focus-gif" ? gifImage : null);
    card.closest = (selector) => {
      if (selector.includes(".home-sidebar") || selector.includes(".modern-sidebar-panel")) {
        return null;
      }
      if (selector === ".focusable" || selector.includes(".home-main")) {
        return card;
      }
      return null;
    };
    cards.push(card);
    return card;
  }

  let currentFocus = null;
  const screen = Object.assign(Object.create(methods), {
    container,
    layoutMode,
    layoutPrefs: {},
    currentFocusedNode: null,
    getCurrentFocusedNode() {
      return currentFocus;
    },
    setCurrentFocusedNode(node) {
      currentFocus = node;
      this.currentFocusedNode = node;
    },
    isSidebarNode: (node) => String(node?.dataset?.navZone || "") === "sidebar",
    isMainNode: (node) => String(node?.dataset?.navZone || "") === "main",
    refreshPendingHomeTrailerCleanup: noop,
    getExpandedPosterScrollAdjustments: () => ({ horizontal: 0, vertical: 0 }),
    shouldUseImmediateFocusScroll: () => false,
    collapseFocusedPoster: noop,
    focusWithoutAutoScroll: noop,
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    scheduleHomeLazyImageHydration: noop,
    setSidebarExpanded: noop,
    shouldDeferContinueWatchingFocusEffects: () => false,
    scheduleModernCameraFollow: () => false,
    ensureTrackHorizontalVisibility: noop,
    ensureMainVerticalVisibility: noop,
    scheduleModernTrackPaginationForFocus: noop,
    ensureContinueWatchingRenderAhead: noop,
    cancelPendingHeroFocus: noop,
    scheduleModernHeroUpdate: noop,
    rememberMainRowFocus: noop,
    shouldPreserveCollectionHeroMedia: () => false,
    isModernVerticalScrollActive: () => verticalScrolling,
    getMainFocusAnchor: (node) => node,
    cancelModernCameraFollow: noop,
    getFocusedPosterFlowConfig: () => ({
      shouldExpand: false,
      shouldPreviewTrailer: false,
      trailerTarget: "hero_media"
    }),
    cancelScrollAnimation: noop,
    resolveBestVisibleNodeForRow: (rowNodes) => rowNodes[0] || null,
    syncMainFocusToViewport: () => currentFocus
  });

  return {
    screen,
    container,
    listeners,
    makeCollectionCard,
    setVerticalScrolling(value) {
      verticalScrolling = Boolean(value);
    },
    advanceTime(ms) {
      now += ms;
      const frames = Array.from(rafCallbacks.entries());
      rafCallbacks.clear();
      for (const [, callback] of frames) {
        callback(now);
      }
      while (true) {
        const nextDue = Array.from(timers.values())
          .filter((entry) => entry.runAt <= now)
          .sort((left, right) => left.runAt - right.runAt || left.id - right.id)[0];
        if (!nextDue) {
          break;
        }
        timers.delete(nextDue.id);
        nextDue.callback();
      }
    }
  };
}

test("rapid Left/Right focusNode moves skip intermediate collection GIF hydration and honor 140ms dwell across all Home layouts", async () => {
  for (const layoutMode of ["modern", "classic", "grid"]) {
    const harness = await buildCollectionDwellHarness({ layoutMode });
    const tileA = harness.makeCollectionCard(0);
    const tileB = harness.makeCollectionCard(1);
    const tileC = harness.makeCollectionCard(2);
    const tileD = harness.makeCollectionCard(3);

    tileA.classList.add("focused");
    harness.screen.setCurrentFocusedNode(tileA);
    harness.screen.syncFocusedCollectionCardState({ immediate: true });
    assert.equal(
      tileA.gifImage.getAttribute("src"),
      tileA.gifUrl,
      `${layoutMode}: settled initial focus hydrates immediately`
    );

    // Rapid Left/Right passes across B and C under 140ms must blur A at once and never set src on B or C.
    assert.equal(harness.screen.focusNode(tileA, tileB, "right"), true);
    assert.equal(
      tileA.gifImage.getAttribute("src"),
      undefined,
      `${layoutMode}: blur stops A GIF immediately`
    );
    assert.equal(
      tileB.gifImage.getAttribute("src"),
      undefined,
      `${layoutMode}: B must wait for 140ms dwell`
    );

    harness.advanceTime(60);
    assert.equal(tileB.gifImage.getAttribute("src"), undefined);

    assert.equal(harness.screen.focusNode(tileB, tileC, "right"), true);
    harness.advanceTime(90);
    assert.equal(
      tileB.gifImage.getAttribute("src"),
      undefined,
      `${layoutMode}: skipped intermediate B stays unhydrated`
    );
    assert.equal(
      tileC.gifImage.getAttribute("src"),
      undefined,
      `${layoutMode}: C must not hydrate at 90ms`
    );

    assert.equal(harness.screen.focusNode(tileC, tileD, "left"), true);
    harness.advanceTime(139);
    assert.equal(
      tileC.gifImage.getAttribute("src"),
      undefined,
      `${layoutMode}: skipped intermediate C stays unhydrated`
    );
    assert.equal(
      tileD.gifImage.getAttribute("src"),
      undefined,
      `${layoutMode}: D must wait full 140ms dwell`
    );

    harness.advanceTime(1);
    assert.equal(
      tileD.gifImage.getAttribute("src"),
      tileD.gifUrl,
      `${layoutMode}: D hydrates after 140ms dwell`
    );
    assert.ok(tileD.classList.contains("is-focus-gif-active"));
  }
});

test("scheduleFocusedPosterFlow and focusin syncFocusedCollectionCardState honor 140ms dwell while fast scroll cancels active/pending GIFs", async () => {
  const harness = await buildCollectionDwellHarness({ layoutMode: "modern" });
  const tileA = harness.makeCollectionCard(0);
  const tileB = harness.makeCollectionCard(1);
  const tileC = harness.makeCollectionCard(2);

  // scheduleFocusedPosterFlow directly on a focused collection card must not hydrate synchronously.
  tileA.classList.add("focused");
  harness.screen.setCurrentFocusedNode(tileA);
  harness.screen.scheduleFocusedPosterFlow(tileA);
  assert.equal(
    tileA.gifImage.getAttribute("src"),
    undefined,
    "scheduleFocusedPosterFlow must not bypass dwell"
  );

  harness.advanceTime(140);
  assert.equal(tileA.gifImage.getAttribute("src"), tileA.gifUrl);

  // Delegated focusin during scrolling/navigation must also honor 140ms dwell.
  harness.screen.ensureDelegatedEventsBound();
  const onFocusIn = harness.listeners.get("focusin");
  assert.equal(typeof onFocusIn, "function");

  tileA.classList.remove("focused");
  tileB.classList.add("focused");
  harness.screen.setCurrentFocusedNode(tileB);
  onFocusIn({ target: tileB });
  assert.equal(
    tileA.gifImage.getAttribute("src"),
    undefined,
    "previous collection GIF blurs immediately on focusin"
  );
  assert.equal(
    tileB.gifImage.getAttribute("src"),
    undefined,
    "focusin must not hydrate synchronously"
  );

  // Starting vertical fast-scroll cancels pending dwell and suppresses hydration while scrolling.
  harness.screen.navModel = { rows: [[tileA], [tileB], [tileC]] };
  harness.container.querySelector = (selector) =>
    selector === ".home-modern-rows-viewport"
      ? {
          isConnected: true,
          scrollTop: 0,
          scrollHeight: 2000,
          clientHeight: 1080,
          getBoundingClientRect: () => ({ top: 0, bottom: 1080 })
        }
      : null;
  assert.equal(harness.screen.startModernVerticalFastScroll(1), true);
  harness.advanceTime(200);
  assert.equal(
    tileB.gifImage.getAttribute("src"),
    undefined,
    "fast-scroll suppresses pending GIF hydration"
  );

  // Landing on C after fast-scroll ends must still dwell 140ms before hydrating C.
  harness.screen.endModernVerticalFastScroll({ land: false });
  assert.equal(harness.screen.focusNode(tileB, tileC, "down"), true);
  assert.equal(tileC.gifImage.getAttribute("src"), undefined);
  harness.advanceTime(140);
  assert.equal(tileC.gifImage.getAttribute("src"), tileC.gifUrl);
});

test("vertical navigation waits for modern vertical scroll settle and non-collection moves cancel pending GIF dwell", async () => {
  const harness = await buildCollectionDwellHarness({ layoutMode: "modern" });
  const tileA = harness.makeCollectionCard(0);
  const tileB = harness.makeCollectionCard(1);
  const regularPoster = new harness.screen.container.constructor();
  regularPoster.isConnected = true;
  regularPoster.classList = tileA.classList.constructor
    ? new tileA.classList.constructor(["home-content-card", "home-poster-card", "focusable"])
    : { add() {}, remove() {}, contains: (n) => n === "focusable" || n === "focused" };
  regularPoster.dataset = {
    navZone: "main",
    navRow: "1",
    navCol: "0",
    itemType: "movie",
    itemId: "tt1"
  };
  regularPoster.querySelector = () => null;
  harness.screen.container.contains = (node) =>
    node === tileA || node === tileB || node === regularPoster;

  tileA.classList.add("focused");
  harness.screen.setCurrentFocusedNode(tileA);
  harness.setVerticalScrolling(true);
  assert.equal(harness.screen.focusNode(tileA, tileB, "down"), true);

  harness.advanceTime(140);
  assert.equal(
    tileB.gifImage.getAttribute("src"),
    undefined,
    "modern vertical move waits for vertical scroll settle"
  );

  harness.setVerticalScrolling(false);
  harness.advanceTime(60);
  assert.equal(tileB.gifImage.getAttribute("src"), tileB.gifUrl, "hydrates once settled");

  // Moving from tileB to tileA and immediately to a regular poster cancels pending dwell.
  assert.equal(harness.screen.focusNode(tileB, tileA, "up"), true);
  assert.equal(tileB.gifImage.getAttribute("src"), undefined);
  harness.advanceTime(50);
  assert.equal(harness.screen.focusNode(tileA, regularPoster, "down"), true);
  harness.advanceTime(200);
  assert.equal(
    tileA.gifImage.getAttribute("src"),
    undefined,
    "pending GIF dwell cancelled on non-collection focus"
  );
});
