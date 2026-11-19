import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { shouldQueueRescale } from "../../images/tvPosterRescaler.js";

let isTvRuntime = false;
let route = "home";
let rescaleEnabled = false;
let rescaleCalls = [];
let releasedUrls = [];
let settleRescale = null;

const context = vm.createContext({
  buildModernRowKey: () => "collection:test",
  buildPosterSubtitle: () => "",
  escapeHtml: String,
  escapeAttribute: String,
  buildLazyImageAttributes: (src, { defer = false } = {}) =>
    defer ? `data-src="${src}"` : `src="${src}"`,
  getTvRuntimePerformanceProfile: () => ({ isTvRuntime }),
  Router: { getCurrent: () => route },
  shouldRescaleHomeArtwork: () => rescaleEnabled,
  shouldQueueRescale,
  rescaleHomeArtwork: (url, options) => {
    rescaleCalls.push({ url, options });
    return new Promise((resolve) => {
      settleRescale = resolve;
    });
  },
  releaseHomeArtwork: (url) => {
    if (String(url).startsWith("blob:")) releasedUrls.push(url);
  },
  getTvArtworkPixelRatio: () => 2,
  internals: {}
});

function resetRescale() {
  rescaleEnabled = false;
  rescaleCalls = [];
  releasedUrls = [];
  settleRescale = null;
}

function focusCard(src, { width = 220, height = 338 } = {}) {
  class Image {
    dataset = { src };
    attributes = new Map();
    isConnected = true;
    getAttribute(key) {
      return this.attributes.get(key);
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    removeAttribute(key) {
      this.attributes.delete(key);
    }
    getBoundingClientRect() {
      return { width, height };
    }
  }
  context.HTMLImageElement = Image;
  const image = new Image();
  const classes = new Set(["focused"]);
  const node = {
    querySelector: () => image,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    }
  };
  return { image, classes, node };
}

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
await loadFrom("./homeScreenMethods-11-enrich-current-hero-async.js", "const focusGifRequests");

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

test("a static focus overlay is painted from a card-sized decode and released on blur", async () => {
  resetRescale();
  rescaleEnabled = true;
  const jpg = "https://example.invalid/focus.jpg";
  const { image, classes, node } = focusCard(jpg);
  const { hydrateCollectionFocusGif } = context.createHomeScreenMethods11();

  hydrateCollectionFocusGif(node, true);
  assert.equal(image.getAttribute("src"), undefined, "the full-size original never paints");
  assert.ok(!classes.has("is-focus-gif-active"), "the fade waits for the bounded decode");
  assert.equal(rescaleCalls.length, 1);
  assert.equal(rescaleCalls[0].url, jpg);
  assert.deepEqual(
    {
      width: rescaleCalls[0].options.width,
      height: rescaleCalls[0].options.height,
      fit: rescaleCalls[0].options.fit,
      priority: rescaleCalls[0].options.priority
    },
    { width: 440, height: 676, fit: "fill", priority: 0 }
  );

  settleRescale("blob:scaled");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(image.getAttribute("src"), "blob:scaled");
  assert.ok(classes.has("is-focus-gif-active"));

  classes.delete("focused");
  hydrateCollectionFocusGif(node, false);
  assert.equal(image.getAttribute("src"), undefined);
  assert.ok(!classes.has("is-focus-gif-active"));
  assert.deepEqual(releasedUrls, ["blob:scaled"]);
});

test("an animated focus overlay paints immediately and never queues a decode", () => {
  resetRescale();
  rescaleEnabled = true;
  const { image, classes, node } = focusCard("https://example.invalid/focus.gif");
  const { hydrateCollectionFocusGif } = context.createHomeScreenMethods11();

  hydrateCollectionFocusGif(node, true);
  assert.equal(image.getAttribute("src"), "https://example.invalid/focus.gif");
  assert.ok(classes.has("is-focus-gif-active"));
  assert.equal(rescaleCalls.length, 0);
});

test("a focus overlay blurred while decoding is released instead of painted", async () => {
  resetRescale();
  rescaleEnabled = true;
  const { image, classes, node } = focusCard("https://example.invalid/late.jpg");
  const { hydrateCollectionFocusGif } = context.createHomeScreenMethods11();

  hydrateCollectionFocusGif(node, true);
  classes.delete("focused");
  hydrateCollectionFocusGif(node, false);
  settleRescale("blob:late");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(image.getAttribute("src"), undefined);
  assert.ok(!classes.has("is-focus-gif-active"));
  assert.deepEqual(releasedUrls, ["blob:late"]);
});

test("a focus overlay that cannot be rescaled still paints the original url", async () => {
  resetRescale();
  rescaleEnabled = true;
  const jpg = "https://example.invalid/plain.jpg";
  const { image, node } = focusCard(jpg);
  const { hydrateCollectionFocusGif } = context.createHomeScreenMethods11();

  hydrateCollectionFocusGif(node, true);
  settleRescale(null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(image.getAttribute("src"), jpg);
  assert.deepEqual(releasedUrls, []);
});

test("repeated hydration of a focused overlay starts a single decode", () => {
  resetRescale();
  rescaleEnabled = true;
  const { node } = focusCard("https://example.invalid/once.jpg");
  const { hydrateCollectionFocusGif } = context.createHomeScreenMethods11();

  hydrateCollectionFocusGif(node, true);
  hydrateCollectionFocusGif(node, true);
  hydrateCollectionFocusGif(node, true);
  assert.equal(rescaleCalls.length, 1);
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
