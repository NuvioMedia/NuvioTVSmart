import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// homeScreenMethods-24 reaches the whole app through homeScreenContext, so the
// methods are evaluated against stubs the way the other home tests do it. The
// point is to drive the real hydration and eviction code, not a copy of it.
const source = await readFile(
  new URL("./homeScreenMethods-24-schedule-home-lazy-image-hydration.js", import.meta.url),
  "utf8"
);

const ROW_SELECTOR = ".home-row, .home-modern-row, .home-grid-section, .home-row-continue";
const LIFECYCLE_SELECTOR =
  ".home-main .content-poster, .home-main .home-poster-landscape-logo, .home-main .home-continue-bg";

function buildHome({ rescale = null, tv = true, route = "home" } = {}) {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => callback(),
    internals: {
      MODERN_HOME_CONSTANTS: { smartTvLazyHydrationDebounceMs: 0, verticalScrollSettlePollMs: 0 },
      CW_DAYS_CAP: 30,
      HOME_LAZY_IMAGE_LIFECYCLE_SELECTOR: LIFECYCLE_SELECTOR,
      HOME_LAZY_IMAGE_ROW_SELECTOR: ROW_SELECTOR,
      HOME_LAZY_IMAGE_EVICT_MARGIN_PX: 1600,
      HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS: 180,
      HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME: 2,
      Router: { getCurrent: () => route },
      getTvRuntimePerformanceProfile: () => ({ isTvRuntime: tv }),
      isSeriesTypeForContinueWatching: () => false,
      isCompletedForContinueWatching: () => false,
      episodeKey: () => "",
      episodeSortKey: () => 0,
      buildNextUpSeedFromWatchedItem: () => null
    },
    rescaleHomeArtwork: rescale?.rescale || (() => Promise.resolve(null)),
    releaseHomeArtwork: rescale?.release || (() => {}),
    shouldRescaleHomeArtwork: rescale?.enabled || (() => false),
    getHomeArtworkPixelRatio: () => 1,
    getHomeArtworkObjectFit: rescale?.fit || (() => "cover"),
    isRescalableArtworkFit: (fit) => fit === "cover" || fit === "fill"
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
    source
      .replace(/^import [\s\S]*?";$/m, "")
      .replace(/^import [^;]+;$/gm, "")
      .replace(/^export /gm, "") + "\nglobalThis.api = createHomeScreenMethods24();",
    context
  );
  return context;
}

function makeRow(context, { top }) {
  const row = new context.HTMLElement();
  row.isConnected = true;
  row.top = top;
  row.getBoundingClientRect = () => ({
    top: row.top,
    bottom: row.top + 338,
    left: 0,
    right: 1920,
    width: 1920,
    height: 338
  });
  row.closest = (selector) => (selector === ROW_SELECTOR ? row : null);
  return row;
}

function makeImage(context, { row, src, left = 0 }) {
  const image = new context.HTMLImageElement();
  const attributes = new Map();
  image.isConnected = true;
  image.dataset = { src };
  image.loading = "";
  image.classList = { contains: (name) => name === "content-poster" };
  image.closest = (selector) => (selector === ROW_SELECTOR ? row : null);
  image.getBoundingClientRect = () => ({
    top: row.top,
    bottom: row.top + 338,
    left,
    right: left + 220,
    width: 220,
    height: 338
  });
  image.getAttribute = (name) => (attributes.has(name) ? attributes.get(name) : null);
  image.removeAttribute = (name) => {
    attributes.delete(name);
    if (name === "data-src") {
      delete image.dataset.src;
    }
  };
  Object.defineProperty(image, "src", {
    get: () => attributes.get("src") || "",
    set: (value) => attributes.set("src", value)
  });
  return image;
}

function makeScreen(context, { rows, images }) {
  const container = {
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 1080,
      left: 0,
      right: 1920,
      width: 1920,
      height: 1080
    }),
    querySelector: () => null,
    querySelectorAll: (selector) => {
      // Narrowing the query to [data-src] is the defect this file guards, so
      // make the fake refuse it rather than quietly answer.
      assert.equal(
        selector,
        LIFECYCLE_SELECTOR,
        "home artwork must be indexed in every lifecycle state"
      );
      return images.slice();
    }
  };
  return Object.assign(Object.create(context.api), {
    container,
    rows,
    homeLazyImageHydrationIndex: null,
    lastHomeLazyImageHydrationAnchorRow: null,
    isPerformanceConstrained: () => false,
    isLegacyTvRuntime: () => false,
    getCurrentFocusedNode: () => null
  });
}

test("eviction still finds artwork after a later hydration pass", () => {
  const context = buildHome();
  const near = makeRow(context, { top: 100 });
  const images = [makeImage(context, { row: near, src: "https://art/a.jpg" })];
  const screen = makeScreen(context, { rows: [near], images });

  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  assert.equal(images[0].src, "https://art/a.jpg", "first pass loads the poster");
  assert.equal(images[0].dataset.src, undefined, "a loaded poster no longer carries data-src");

  // The pass that used to break eviction: the index is walked again while the
  // poster is loaded, which is when the filter dropped it for good.
  screen.hydrateHomeLazyImages(null, { forceFullScan: true });

  near.top = 9000;
  const released = screen.evictDistantHomeLazyImages(null);
  assert.equal(released, 1, "a loaded poster far from the viewport must be released");
  assert.equal(images[0].getAttribute("src"), null);
  assert.equal(
    images[0].dataset.src,
    "https://art/a.jpg",
    "the original url goes back into data-src"
  );
});

test("classic home hydrates only near the screen when its main container spans every row", () => {
  const context = buildHome();
  const near = makeRow(context, { top: 100 });
  const distant = makeRow(context, { top: 9000 });
  const images = [
    makeImage(context, { row: near, src: "https://art/near.jpg" }),
    makeImage(context, { row: distant, src: "https://art/far.jpg" })
  ];
  const screen = makeScreen(context, { rows: [near, distant], images });
  screen.container.getBoundingClientRect = () => ({ top: 0, bottom: 25000, left: 0, right: 1920 });
  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  assert.equal(images[0].src, "https://art/near.jpg");
  assert.equal(images[1].src, "");
  assert.equal(images[1].dataset.src, "https://art/far.jpg");
});

test("browser and folder detail do not evict images through the Home lifecycle", () => {
  for (const options of [{ tv: false }, { route: "folderDetail" }]) {
    const context = buildHome(options);
    const row = makeRow(context, { top: 9000 });
    const image = makeImage(context, { row, src: "https://art/a.jpg" });
    image.src = image.dataset.src;
    delete image.dataset.src;
    const screen = makeScreen(context, { rows: [row], images: [image] });
    screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
    assert.equal(image.src, "https://art/a.jpg");
  }
});

test("a released and rehydrated poster rejects the earlier request even when the URL is unchanged", async () => {
  const resolvers = [];
  const released = [];
  const context = buildHome({
    rescale: {
      enabled: () => true,
      rescale: () => new Promise((resolve) => resolvers.push(resolve)),
      release: (url) => released.push(url)
    }
  });
  const row = makeRow(context, { top: 100 });
  const image = makeImage(context, { row, src: "https://art/a.jpg" });
  const screen = makeScreen(context, { rows: [row], images: [image] });
  screen.assignHomeLazyImageSource(image, image.dataset.src);
  screen.releaseHomeLazyImage(image);
  screen.assignHomeLazyImageSource(image, image.dataset.src);
  resolvers[0]("blob:old");
  await Promise.resolve();
  assert.equal(image.src, "");
  assert.deepEqual(released, ["", "blob:old"]);
  resolvers[1]("blob:new");
  await Promise.resolve();
  assert.equal(image.src, "blob:new");
});

test("rebuilding the index keeps artwork that has already loaded", () => {
  const context = buildHome();
  const row = makeRow(context, { top: 100 });
  const images = [makeImage(context, { row, src: "https://art/b.jpg" })];
  const screen = makeScreen(context, { rows: [row], images });

  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  // A new catalog mounting forces a rebuild while earlier rows are loaded.
  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });

  row.top = 9000;
  assert.equal(screen.evictDistantHomeLazyImages(null), 1);
});

test("a poster closer than the evict margin is left alone", () => {
  const context = buildHome();
  const row = makeRow(context, { top: 100 });
  const images = [makeImage(context, { row, src: "https://art/c.jpg" })];
  const screen = makeScreen(context, { rows: [row], images });

  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  row.top = 1080 + 1500;
  assert.equal(screen.evictDistantHomeLazyImages(null), 0, "1500px is inside the 1600px margin");
  assert.equal(images[0].src, "https://art/c.jpg");
});

test("teardown hands every rescaled poster back to its original url", () => {
  const released = [];
  const context = buildHome({
    rescale: {
      enabled: () => true,
      rescale: () => Promise.resolve("blob:rescaled-1"),
      release: (url) => released.push(url)
    }
  });
  const row = makeRow(context, { top: 100 });
  const images = [makeImage(context, { row, src: "https://art/d.jpg" })];
  const screen = makeScreen(context, { rows: [row], images });

  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  return Promise.resolve().then(() => {
    assert.equal(images[0].src, "blob:rescaled-1");
    // Cleanup drops the index before the rescaler is reset, so the sweep has
    // to work off the document.
    screen.homeLazyImageHydrationIndex = null;
    assert.equal(screen.releaseAllHomeLazyImages(), 1);
    assert.deepEqual(
      released,
      ["blob:rescaled-1"],
      "the blob url is handed back, not revoked underneath the card"
    );
    assert.equal(images[0].dataset.src, "https://art/d.jpg");
    assert.equal(images[0].getAttribute("src"), null);
  });
});

test("a poster the stylesheet does not crop or stretch is never rescaled", () => {
  const asked = [];
  const context = buildHome({
    rescale: {
      enabled: () => true,
      fit: () => "contain",
      rescale: (url, options) => {
        asked.push({ url, ...options });
        return Promise.resolve("blob:should-not-happen");
      }
    }
  });
  const row = makeRow(context, { top: 100 });
  const images = [makeImage(context, { row, src: "https://art/e.png" })];
  const screen = makeScreen(context, { rows: [row], images });

  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  assert.deepEqual(asked, [], "object-fit: contain must load untouched");
  assert.equal(images[0].src, "https://art/e.png");
});

test("the stylesheet's own object-fit reaches the rescaler", () => {
  const asked = [];
  const context = buildHome({
    rescale: {
      enabled: () => true,
      fit: () => "fill",
      rescale: (url, options) => {
        asked.push({ url, ...options });
        return Promise.resolve(null);
      }
    }
  });
  const row = makeRow(context, { top: 100 });
  const images = [makeImage(context, { row, src: "https://art/f.jpg" })];
  const screen = makeScreen(context, { rows: [row], images });

  screen.hydrateHomeLazyImages(null, { forceFullScan: true, refreshIndex: true });
  assert.equal(asked.length, 1);
  assert.equal(
    asked[0].fit,
    "fill",
    "a collection poster stretches, so it must not be asked for a crop"
  );
  assert.equal(asked[0].width, 220);
  assert.equal(asked[0].height, 338);
});
