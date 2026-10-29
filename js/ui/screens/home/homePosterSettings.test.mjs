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

test("landscape artwork keeps its own branding while backdrop fallbacks retain overlays", async () => {
  const context = vm.createContext({
    Router: { getCurrent: () => "home" },
    getTvRuntimePerformanceProfile: () => ({ isTvRuntime: false }),
    isCollectionFolderItem: () => false,
    customPosterForItem: (item) => item,
    normalizeCatalogItem: (item) => item,
    firstNonEmpty: (...values) => values.find(Boolean) || "",
    buildPosterSubtitle: () => "2026",
    normalizeTmdbBackdropUrl: (value) => value,
    normalizeTmdbPosterUrl: (value) => value,
    isTitleItemWatched: () => false,
    escapeHtml: String,
    escapeAttribute: String,
    buildLazyImageAttributes: (src) => `src="${src}"`
  });
  const source = await readFile(
    new URL("./homeScreenHelpers-15-create-poster-card-markup.js", import.meta.url),
    "utf8"
  );
  vm.runInContext(
    source
      .slice(source.indexOf("export function createPosterCardMarkup"))
      .replace(/^export /gm, ""),
    context
  );
  for (const logo of ["", "logo.png"]) {
    for (const expanded of [false, true]) {
      for (const landscape of [false, true]) {
        const render = (landscapePoster, row = {}) =>
          context.createPosterCardMarkup(
            {
              id: "tt1",
              name: "Title",
              poster: "poster.png",
              background: "backdrop.png",
              landscapePoster,
              logo
            },
            0,
            0,
            "movie",
            { homeCatalogKey: "test", ...row },
            true,
            "modern",
            expanded,
            landscape
          );
        const supplied = render("landscape.png");
        assert.ok(supplied.includes("has-landscape-artwork"));
        assert.ok(!supplied.includes('class="home-poster-landscape-copy"'));
        assert.ok(
          supplied.includes('class="home-poster-expanded-brand"'),
          "keep branding available over trailers"
        );
        const fallback = render("");
        assert.ok(!fallback.includes("has-landscape-artwork"));
        assert.equal(fallback.includes('class="home-poster-landscape-copy"'), landscape);
        assert.ok(
          !render("landscape.png", { suppressPosterText: true }).includes(
            'class="home-poster-landscape-copy"'
          )
        );
        assert.ok(supplied.includes('aria-label="Title"'));
      }
    }
  }
});

test("landscape artwork stays unobscured until the card trailer is revealed", async () => {
  const { load } = await import("cheerio");
  const { default: postcss } = await import("postcss");
  const rules = [];
  for (const file of ["components-14.css", "components-17.css"]) {
    const css = await readFile(new URL(`../../../../css/${file}`, import.meta.url), "utf8");
    postcss.parse(css).walkRules((rule) => {
      rule.walkDecls("display", (decl) => {
        for (const selector of rule.selectors) {
          if (
            /\.home-poster-expanded-(gradient|brand)(?![\w-])/.test(selector) &&
            !selector.includes("::")
          ) {
            rules.push({ selector, value: decl.value });
          }
        }
      });
    });
  }
  for (const artwork of [false, true]) {
    for (const expanded of [false, true]) {
      for (const trailer of [false, true]) {
        const $ = load(
          `<div class="home-screen-shell home-layout-modern"><article class="home-poster-card is-landscape ${artwork ? "has-landscape-artwork" : ""} ${expanded ? "is-expanded" : ""} ${trailer ? "is-trailer-active" : ""}"><div class="home-poster-expanded-gradient"></div><div class="home-poster-expanded-brand"></div></article></div>`
        );
        for (const part of ["gradient", "brand"]) {
          const element = $(`.home-poster-expanded-${part}`);
          let display;
          let specificity = -1;
          for (const rule of rules) {
            // These display selectors use classes only; :not contributes its argument's class.
            const weight = (rule.selector.match(/\./g) || []).length;
            if (element.is(rule.selector) && weight >= specificity) {
              display = rule.value;
              specificity = weight;
            }
          }
          assert.equal(
            display,
            artwork && !trailer ? "none" : part === "gradient" || expanded ? "block" : "none",
            `${part}: artwork=${artwork}, expanded=${expanded}, trailer=${trailer}`
          );
        }
      }
    }
  }
});
