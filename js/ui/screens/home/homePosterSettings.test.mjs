import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("poster settings are read once per layout, stay fresh, and preserve card markup", async () => {
  let reads = 0;
  let pattern = "https://posters.example/a/{imdb_id}";
  const context = vm.createContext({
    LayoutPreferences: {
      get() {
        reads++;
        return { customPosterUrlPattern: pattern, customPosterEnabledScreens: ["home"] };
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
    escapeHtml: String,
    escapeAttribute: String,
    buildLazyImageAttributes: (src, { defer = false } = {}) =>
      defer ? `data-src="${src}"` : `src="${src}"`,
    getTvRuntimePerformanceProfile: () => ({ isTvRuntime: false })
  });
  const poster = await readFile(
    new URL("../../../core/poster/customPoster.js", import.meta.url),
    "utf8"
  );
  const cards = await readFile(
    new URL("./homeScreenHelpers-15-create-poster-card-markup.js", import.meta.url),
    "utf8"
  );
  const layout = await readFile(new URL("./modernHomeLayout.js", import.meta.url), "utf8");
  vm.runInContext(
    [
      poster.slice(poster.indexOf("const prepared =")).replace(/^export /gm, ""),
      cards
        .slice(cards.indexOf("export function createPosterCardMarkup"))
        .replace(/^export /gm, ""),
      layout.replace(/^import [^;]+;/gm, "").replace(/^export /gm, "")
    ].join("\n"),
    context
  );
  const api = vm.runInContext("({renderModernHomeLayout, createPosterCardMarkup})", context);
  const options = {
    rows: [
      {
        type: "movie",
        catalogId: "test",
        result: {
          data: {
            items: Array.from({ length: 20 }, (_, index) => ({
              id: `tt${index}`,
              type: "movie",
              name: `Title ${index}`,
              poster: "original"
            }))
          }
        }
      }
    ],
    rowItemLimit: 20,
    createPosterCardMarkup: api.createPosterCardMarkup,
    renderContinueWatchingSection: () => "",
    formatCatalogRowTitle: () => "Test",
    escapeHtml: String,
    escapeAttribute: String
  };
  const next = api.renderModernHomeLayout(options).markup;
  assert.equal(reads, 1);
  const previous = api.renderModernHomeLayout({
    ...options,
    createPosterCardMarkup: (...args) => api.createPosterCardMarkup(...args.slice(0, 11))
  }).markup;
  assert.equal(reads, 22, "legacy card callers must retain their default settings lookup");
  assert.equal(next, previous, "batching settings must not change generated HTML");
  pattern = "https://posters.example/b/{imdb_id}";
  const refreshed = api.renderModernHomeLayout(options).markup;
  assert.equal(reads, 23);
  assert.ok(refreshed.includes("https://posters.example/b/tt0"));
  assert.ok(
    !refreshed.includes("https://posters.example/a/"),
    "a later render must read current profile settings"
  );
});
