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
