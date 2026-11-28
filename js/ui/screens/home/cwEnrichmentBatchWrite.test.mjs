import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const CACHE_KEY = "homeContinueWatchingEnrichmentCache";

function installLocalStorage() {
  const storage = new Map();
  const counters = { setCalls: 0 };
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      counters.setCalls += 1;
      storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key)
  };
  return {
    storage,
    counters,
    restore() {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previousLocalStorage;
      }
    }
  };
}

function buildItem(index) {
  return {
    contentId: `tt${1000 + index}`,
    contentType: "movie",
    title: `Movie ${index}`,
    poster: `https://img/poster-${index}.jpg`,
    backdrop: `https://img/backdrop-${index}.jpg`
  };
}

test("a Continue Watching enrichment batch writes the cache once", async () => {
  const localStorage = installLocalStorage();
  try {
    const { saveContinueWatchingEnrichments, getCachedContinueWatchingEnrichment } =
      await import("./homeScreenHelpers-10-get-cached-continue-watching-enrichment.js");
    const items = Array.from({ length: 5 }, (_, index) => buildItem(index));

    saveContinueWatchingEnrichments(items);
    assert.equal(localStorage.counters.setCalls, 1, "one pass must serialize the cache map once");
    assert.equal(Object.keys(JSON.parse(localStorage.storage.get(CACHE_KEY))).length, 5);
    assert.equal(getCachedContinueWatchingEnrichment(items[4])?.title, "Movie 4");

    // Unchanged entries stay inside the write-dedupe window: no extra write.
    saveContinueWatchingEnrichments(items);
    assert.equal(localStorage.counters.setCalls, 1);

    // Items that cannot be cached are skipped without a write.
    saveContinueWatchingEnrichments([
      { contentId: "tt-no-artwork", contentType: "movie", title: "Raw title" }
    ]);
    assert.equal(localStorage.counters.setCalls, 1);

    // A changed entry reuses the same single write path.
    saveContinueWatchingEnrichments([
      { ...items[0], backdrop: "https://img/backdrop-updated.jpg" }
    ]);
    assert.equal(localStorage.counters.setCalls, 2);
  } finally {
    localStorage.restore();
  }
});

const strip = (source) =>
  source
    .replace(/^import [\s\S]*?";$/gm, "")
    .replace(/^import [^;]+;$/gm, "")
    .replace(/^export /gm, "");

const enrichSource = strip(
  await readFile(
    new URL("./homeScreenMethods-27-enrich-continue-watching.js", import.meta.url),
    "utf8"
  )
);

function createEnrichContext(savedBatches) {
  const context = vm.createContext({
    internals: {
      Router: {},
      mapWithConcurrency: async (items, _limit, worker) =>
        Promise.all(items.map((item) => worker(item))),
      TmdbService: {},
      TmdbMetadataService: {},
      TmdbSettingsStore: {},
      TMDB_API_KEY: "",
      CW_MAX_ENRICHMENT_CONCURRENCY: 4,
      CW_MAX_VISIBLE_ITEMS: 300,
      firstNonEmpty: (...values) => values.find((value) => value != null && value !== ""),
      prettyId: (value) => String(value || ""),
      resolveImdbRating: () => null,
      parseRuntimeMinutes: () => 0,
      isCollectionFolderItem: () => false,
      normalizeCollectionFolderItem: (item) => item,
      normalizeHomeRowItem: (row, item) => item,
      withTimeout: async (promise) => promise,
      isSeriesTypeForContinueWatching: () => false,
      findEpisodeEntry: () => null,
      sortContinueWatchingItemsForDisplay: (items) => items,
      normalizeCatalogItem: (item) => item,
      isCloudContinueWatchingItem: () => false,
      needsContinueWatchingMetadataRefresh: () => false,
      applyCachedContinueWatchingEnrichment: (item) => item,
      saveContinueWatchingEnrichments: (items) => savedBatches.push(items)
    },
    resolveContinueWatchingSeriesContentId: (contentId) => contentId,
    resolveContinueWatchingEpisodeRating: async () => null,
    isServerContentId: () => false,
    dedupeContinueWatchingInProgress: (items) => items
  });
  context.globalThis = context;
  vm.runInContext(`${enrichSource}\nglobalThis.api = createHomeScreenMethods27();`, context);
  return context.api;
}

function createScreen(api, items) {
  return Object.assign(Object.create(api), {
    layoutPrefs: {},
    async enrichContinueWatchingMetaWithTmdb(meta) {
      return meta;
    },
    async buildNextUpItems() {
      return [];
    },
    items
  });
}

test("enrichContinueWatching persists the whole pass in a single batched save", async () => {
  const savedBatches = [];
  const api = createEnrichContext(savedBatches);
  const items = [0, 1, 2].map((index) => ({
    ...buildItem(index),
    enrichedMeta: { id: `tt${1000 + index}`, type: "movie", name: `Movie ${index}` }
  }));

  const result = await api.enrichContinueWatching.call(createScreen(api), items, {
    forceRefreshMetadata: true,
    allProgress: [],
    watchedItems: [],
    nextUpProgressCandidates: []
  });

  assert.equal(result.length, 3);
  assert.equal(savedBatches.length, 1);
  assert.equal(savedBatches[0].length, 3);
});

test("a superseded enrichment pass neither enriches nor persists entries", async () => {
  const savedBatches = [];
  const api = createEnrichContext(savedBatches);
  const items = [0, 1, 2].map((index) => ({
    ...buildItem(index),
    enrichedMeta: { id: `tt${1000 + index}`, type: "movie", name: `Movie ${index}` }
  }));
  let current = true;
  const screen = createScreen(api);
  screen.enrichContinueWatchingMetaWithTmdb = async (meta) => {
    // The Home load token changes while the pass is running.
    current = false;
    return meta;
  };

  await api.enrichContinueWatching.call(screen, items, {
    forceRefreshMetadata: true,
    allProgress: [],
    watchedItems: [],
    nextUpProgressCandidates: [],
    shouldContinue: () => current
  });

  assert.deepEqual(savedBatches, []);
});
