import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// The Home hero enrichment reaches the whole app through homeScreenContext, so
// the method is evaluated against the internals it consumes. This drives the
// real commit/patch flow: the artwork must not wait for the MDBList rating.
const source = await readFile(
  new URL("./homeScreenMethods-11-enrich-current-hero-async.js", import.meta.url),
  "utf8"
);
const methodSource = source.slice(source.indexOf("export function createHomeScreenMethods11"));

const hero = {
  id: "tt1413",
  type: "movie",
  name: "Catalog hero",
  background: "catalog-bg",
  logo: "catalog-logo"
};

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness({ showOnHero = false, deferPreload = false } = {}) {
  const calls = { applies: 0, merges: 0, preloads: 0, preloadResolvers: [] };
  let resolveMeta = null;
  let resolveMdb = null;
  const metaPromise = new Promise((resolve) => {
    resolveMeta = resolve;
  });
  const mdbPromise = new Promise((resolve) => {
    resolveMdb = resolve;
  });
  let focusedHero = hero;
  const context = vm.createContext({
    console,
    setTimeout: (callback, delay, ...args) => {
      const timer = setTimeout(callback, delay, ...args);
      timer.unref?.();
      return timer;
    },
    clearTimeout,
    MdbListSettingsStore: { get: () => ({ showOnHero }) },
    internals: {
      Router: { getCurrent: () => "home" },
      TmdbSettingsStore: {
        get: () => ({ language: "en", useBasicInfo: true, useArtwork: true, useDetails: true })
      },
      metaRepository: { getMetaFromAllAddons: () => metaPromise },
      mdbListRepository: {
        getRatingsForMeta: () => mdbPromise.then((rating) => ({ ratings: { imdb: rating } })),
        getImdbRatingForItem: () => mdbPromise.then((rating) => rating)
      },
      shouldPreserveHomeRuntimeText: () => true,
      firstNonEmpty: (...values) =>
        values.find((value) => value != null && String(value).trim() !== "") || "",
      resolveImdbRating: (meta) => meta?.imdbRating ?? null,
      preloadHeroBackdrop: () => {
        calls.preloads += 1;
        if (!deferPreload) {
          return Promise.resolve();
        }
        return new Promise((resolve) => calls.preloadResolvers.push(resolve));
      },
      preloadHeroLogo: () => {
        calls.preloads += 1;
        if (!deferPreload) {
          return Promise.resolve();
        }
        return new Promise((resolve) => calls.preloadResolvers.push(resolve));
      },
      parseRuntimeMinutes: (value) => Number(value) || 0,
      normalizeCollectionFolderItem: () => null,
      withTimeout: (promise) => promise,
      fetchModernHeroTmdbEnrichment: () => Promise.resolve(null),
      buildHeroIdentity: (value) => `${value?.id || ""}|${value?.type || ""}`,
      buildModernHeroPresentation: (value) => ({
        backdrop: value?.background || "",
        logo: value?.logo || ""
      })
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${methodSource.replace(/^export /gm, "")}\nglobalThis.createMethods = createHomeScreenMethods11;`,
    context
  );

  const screen = {
    ...context.createMethods(),
    heroFocusToken: 3,
    heroEnrichmentToken: 0,
    heroCandidates: [hero],
    heroItem: hero,
    getCurrentFocusedNode: () => focusedHero,
    getNodeHeroSource: () => focusedHero,
    applyHeroToDom() {
      calls.applies += 1;
    },
    mergeHeroIntoCatalogState() {
      calls.merges += 1;
    }
  };
  return {
    screen,
    calls,
    resolveMeta,
    resolveMdb,
    focusHero(nextHero) {
      focusedHero = nextHero;
    },
    releasePreloads() {
      calls.preloadResolvers.splice(0).forEach((resolve) => resolve());
    }
  };
}

const metadataResult = {
  status: "success",
  data: {
    name: "Enriched hero",
    background: "meta-bg",
    logo: "meta-logo",
    imdbRating: 6.9,
    runtimeMinutes: 120
  }
};

test("metadata commits before a slow MDBList rating and the rating is patched without preloading again", async () => {
  const harness = createHarness();
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMeta(metadataResult);
  await flush();

  assert.equal(harness.calls.preloads, 2, "the enriched media is preloaded once");
  assert.equal(harness.calls.applies, 1);
  assert.equal(harness.screen.heroItem.background, "meta-bg");
  assert.equal(harness.screen.heroItem.imdbRating, 6.9);

  harness.resolveMdb(8.4);
  await run;
  await flush();

  assert.equal(
    harness.screen.heroItem.imdbRating,
    8.4,
    "the settled MDBList rating replaces the metadata one"
  );
  assert.equal(harness.screen.heroItem.background, "meta-bg", "the artwork is untouched");
  assert.equal(harness.calls.preloads, 2, "the rating patch does not re-preload the media");
  assert.equal(harness.calls.applies, 2);
  assert.equal(harness.calls.merges, 2);
});

test("a rating that settles before metadata is used by the first commit", async () => {
  const harness = createHarness();
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMdb(8.4);
  await flush();
  assert.equal(harness.calls.applies, 0, "the hero does not paint the catalog data again");

  harness.resolveMeta(metadataResult);
  await run;
  await flush();

  assert.equal(harness.screen.heroItem.imdbRating, 8.4);
  assert.equal(harness.screen.heroItem.background, "meta-bg");
  assert.equal(harness.calls.applies, 1);
  assert.equal(harness.calls.preloads, 2);
});

test("the fallback hero commits before the rating request finishes", async () => {
  const harness = createHarness();
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMeta({ status: "error" });
  await run;
  await flush();

  assert.equal(harness.calls.applies, 1);
  assert.equal(harness.screen.heroItem.heroMetaEnriched, false);
  assert.equal(harness.screen.heroItem.imdbRating, undefined);

  harness.resolveMdb(8.4);
  await flush();

  assert.equal(harness.screen.heroItem.imdbRating, 8.4);
  assert.equal(harness.calls.preloads, 2, "the fallback media is preloaded once");
  assert.equal(harness.calls.applies, 2);
});

test("a rating that settles while media preloads is kept by the finished commit", async () => {
  const harness = createHarness({ deferPreload: true });
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMeta(metadataResult);
  await flush();
  assert.equal(harness.calls.applies, 0, "the commit waits for the media preload");

  harness.resolveMdb(8.4);
  await flush();
  assert.equal(harness.screen.heroItem.imdbRating, 8.4);

  harness.releasePreloads();
  await run;
  await flush();

  assert.equal(
    harness.screen.heroItem.imdbRating,
    8.4,
    "the final commit keeps the settled rating"
  );
  assert.equal(harness.screen.heroItem.background, "meta-bg");
});

test("a rating that settles during the fallback preload still reaches the catalog state", async () => {
  const harness = createHarness({ deferPreload: true });
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMeta({ status: "error" });
  await flush();
  assert.equal(harness.calls.applies, 0);

  harness.resolveMdb(8.4);
  await flush();
  assert.equal(harness.screen.heroItem.imdbRating, 8.4);

  harness.releasePreloads();
  await run;
  await flush();

  assert.equal(harness.screen.heroItem.imdbRating, 8.4);
  assert.equal(harness.calls.merges, 2, "the fallback commit merges the rating it picked up");
});

test("a stale enrichment token ignores the late rating", async () => {
  const harness = createHarness();
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMeta(metadataResult);
  await run;
  await flush();
  assert.equal(harness.calls.applies, 1);

  harness.screen.heroFocusToken = 4;
  harness.resolveMdb(8.4);
  await flush();

  assert.equal(harness.screen.heroItem.imdbRating, 6.9);
  assert.equal(harness.calls.applies, 1);
});

test("a focused hero change ignores the late rating", async () => {
  const harness = createHarness();
  const run = harness.screen.enrichCurrentHeroAsync(hero, 3, { deferCommit: true });

  harness.resolveMeta(metadataResult);
  await run;
  await flush();

  harness.focusHero({ id: "tt9999", type: "movie" });
  harness.resolveMdb(8.4);
  await flush();

  assert.equal(harness.screen.heroItem.imdbRating, 6.9);
  assert.equal(harness.calls.applies, 1);
});
