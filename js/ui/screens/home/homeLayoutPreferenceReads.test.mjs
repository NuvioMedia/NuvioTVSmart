import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Issue #1250: LayoutPreferences.get() clones the profile store and rewrites
// root CSS variables, so Home render paths must read it once per pass, never
// once per poster card.

const here = (path) => new URL(path, import.meta.url);

function slice(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing "${start}"`);
  const to = end ? source.indexOf(end, from) : -1;
  return source.slice(from, to >= 0 ? to : undefined).replace(/^export /gm, "");
}

function cardStubs(onRead) {
  const prefs = {
    customPosterUrlPattern: "https://posters.example/{imdb_id}",
    customPosterEnabledScreens: ["home", "continue_watching"]
  };
  return {
    LayoutPreferences: {
      get() {
        onRead();
        return { ...prefs };
      }
    },
    Router: { getCurrent: () => "home" },
    isCollectionFolderItem: () => false,
    normalizeCatalogItem: (item) => item,
    firstNonEmpty: (...values) => values.find(Boolean) || "",
    buildPosterSubtitle: () => "",
    normalizeTmdbBackdropUrl: (value) => value,
    normalizeTmdbPosterUrl: (value) => value,
    isTitleItemWatched: () => false,
    renderTitleWatchedBadge: () => "",
    escapeHtml: String,
    escapeAttribute: String,
    buildLazyImageAttributes: (src, { defer = false } = {}) =>
      defer ? `data-src="${src}"` : `src="${src}"`,
    getTvRuntimePerformanceProfile: () => ({ isTvRuntime: false, isPerformanceConstrained: false }),
    buildModernRowKey: (row) => String(row?.catalogId || "row")
  };
}

const items = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `tt${index}`,
    type: "movie",
    name: `Title ${index}`,
    poster: "original"
  }));

async function loadCardSources() {
  const poster = await readFile(here("../../../core/poster/customPoster.js"), "utf8");
  const cards = await readFile(here("./homeScreenHelpers-15-create-poster-card-markup.js"), "utf8");
  return [
    slice(poster, "const prepared ="),
    slice(cards, "export function createPosterCardMarkup")
  ].join("\n");
}

test("a classic row render reads layout preferences once, not once per card", async () => {
  let reads = 0;
  const context = vm.createContext({
    ...cardStubs(() => reads++),
    HOME_MAX_ITEMS_PER_ROW_DEFAULT: 15,
    HOME_GRID_SAFE_MAX_COLUMNS: 6,
    HOME_GRID_DEFAULT_ROW_COUNT: 2,
    buildCatalogLoadingItems: () => [],
    shouldDeferHomeRowImages: () => false,
    createSeeAllCardMarkup: () => "",
    renderRowHeader: () => "",
    formatCatalogRowTitle: () => "Test"
  });
  const rows = await readFile(
    here("./homeScreenHelpers-13-continue-watching-stream-params.js"),
    "utf8"
  );
  vm.runInContext(
    [
      await loadCardSources(),
      slice(
        rows,
        "export function renderLegacyCatalogRowsMarkup",
        "export function createSeeAllCardMarkup"
      )
    ].join("\n"),
    context
  );
  const api = vm.runInContext("({renderLegacyCatalogRowsMarkup, createPosterCardMarkup})", context);
  const row = {
    type: "movie",
    catalogId: "test",
    result: { status: "success", data: { items: items(10) } }
  };
  for (const layoutMode of ["classic", "grid"]) {
    reads = 0;
    const markup = api.renderLegacyCatalogRowsMarkup([row], {
      layoutMode,
      rowItemLimit: 10
    }).markup;
    assert.equal(reads, 1, `${layoutMode}: one preference read per render pass`);
    assert.equal((markup.match(/<article /g) || []).length, 10);
    assert.ok(markup.includes("https://posters.example/tt9"), "custom posters still apply");
    // The same row rendered card-by-card with the legacy 11-argument call must
    // produce byte-identical HTML.
    reads = 0;
    const perCard = row.result.data.items
      .map((item, index) =>
        api.createPosterCardMarkup(
          item,
          0,
          index,
          "movie",
          row,
          true,
          layoutMode,
          false,
          false,
          false,
          null
        )
      )
      .join("");
    assert.equal(reads, 10, "legacy per-card callers keep their fallback read");
    assert.ok(
      markup.includes(perCard),
      `${layoutMode}: batching settings must not change card HTML`
    );
  }
});

test("a modern pagination chunk reads layout preferences once per append", async () => {
  let reads = 0;
  const stubs = cardStubs(() => reads++);
  const appended = [];
  const track = {
    isConnected: true,
    dataset: { trackRowKey: "test" },
    scrollWidth: 1000,
    scrollLeft: 1000,
    clientWidth: 0,
    querySelectorAll: () => Array.from({ length: 10 }, () => ({ offsetWidth: 200 })),
    appendChild() {},
    addEventListener() {},
    removeEventListener() {}
  };
  const context = vm.createContext({
    ...stubs,
    console,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
    document: {
      createRange: () => ({
        createContextualFragment(markup) {
          appended.push(markup);
          return { querySelectorAll: () => [] };
        }
      })
    },
    registerHomeDomNodes() {}
  });
  const pagination = await readFile(
    here("./homeScreenMethods-29-setup-modern-track-scroll-pagination.js"),
    "utf8"
  );
  vm.runInContext(
    [
      await loadCardSources(),
      "const internals = { Router, LayoutPreferences, buildModernRowKey, createPosterCardMarkup, catalogRepository: {}, MODERN_HOME_CONSTANTS: { trackPaginationIdleMs: 0, trackPaginationPrefetchDelayMs: 0, trackPaginationLoadAheadItems: 4 }, HOME_MAX_ITEMS_PER_ROW_DEFAULT: 15 };",
      pagination.replace(/^import [^;]+;/gm, "").replace(/^export /gm, "")
    ].join("\n"),
    context
  );
  const api = vm.runInContext("({createHomeScreenMethods29, createPosterCardMarkup})", context);
  const row = {
    type: "movie",
    catalogId: "test",
    result: { status: "success", data: { items: items(20) } }
  };
  const screen = {
    ...api.createHomeScreenMethods29(),
    layoutMode: "modern",
    container: { querySelectorAll: () => [track] },
    rows: [row],
    layoutPrefs: { showPosterLabels: true, modernLandscapePostersEnabled: false },
    watchedTitleIds: null,
    navModel: { rows: [] },
    getRowItemLimit: () => 10,
    isScrollAnimationActive: () => false,
    invalidateNavigationModel() {},
    buildNavigationModel() {},
    scheduleHomeLazyImageHydration() {}
  };
  screen.setupModernTrackScrollPagination();
  const handler = screen._trackScrollHandlers.get(track);
  assert.ok(handler, "track handler installed");
  reads = 0;
  handler();
  assert.equal(appended.length, 1, "one chunk appended");
  assert.equal(reads, 1, "one preference read per pagination chunk");
  assert.equal((appended[0].match(/<article /g) || []).length, 10);
  reads = 0;
  const perCard = row.result.data.items
    .slice(10)
    .map((item, index) =>
      api.createPosterCardMarkup(
        item,
        0,
        10 + index,
        "movie",
        row,
        true,
        "modern",
        false,
        false,
        true,
        null
      )
    )
    .join("");
  assert.equal(reads, 10);
  assert.equal(appended[0], perCard, "batching settings must not change appended HTML");
});

test("a continue watching section reads layout preferences once for all cards", async () => {
  let reads = 0;
  const context = vm.createContext({
    ...cardStubs(() => reads++),
    t: (_key, _params, fallback) => fallback,
    normalizeContinueWatchingItem: (item) => item,
    continueWatchingUsesEpisodeThumbnails: () => false,
    continueWatchingImageSources: (sources) => [sources.poster],
    isSeriesTypeForContinueWatching: () => false,
    uniqueNonEmptyValues: (values) => values.filter(Boolean),
    encodeHeroBackdropFallbacks: () => "",
    posterFallbackAttributes: () => "",
    buildImageFallbackErrorHandler: () => "",
    getContinueWatchingRenderItems: (list) => list
  });
  const poster = await readFile(here("../../../core/poster/customPoster.js"), "utf8");
  const hero = await readFile(here("./homeScreenHelpers-12-build-hero-indicators.js"), "utf8");
  vm.runInContext(
    [
      slice(poster, "const prepared ="),
      slice(hero, "export function renderContinueWatchingCard")
    ].join("\n"),
    context
  );
  const api = vm.runInContext(
    "({renderContinueWatchingSection, renderContinueWatchingCard})",
    context
  );
  const cwItems = items(10).map((item) => ({ ...item, contentId: item.id, title: item.name }));
  reads = 0;
  const section = api.renderContinueWatchingSection(cwItems, { rowKey: "continue_watching" });
  assert.equal(reads, 1, "one preference read per section render");
  assert.equal((section.match(/<article /g) || []).length, 10);
  assert.ok(section.includes("https://posters.example/tt9"));
  reads = 0;
  const perCard = cwItems
    .map((item, index) =>
      api.renderContinueWatchingCard(item, index, { rowKey: "continue_watching", navIndex: index })
    )
    .join("");
  assert.equal(reads, 10, "a lone card still reads its own settings");
  assert.ok(section.includes(perCard), "batching settings must not change card HTML");
  reads = 0;
  assert.equal(
    api.renderContinueWatchingSection([], { loading: true, loadingCount: 3 }).includes("<article "),
    true
  );
  assert.equal(reads, 0, "a loading-only section never reads preferences");
});
