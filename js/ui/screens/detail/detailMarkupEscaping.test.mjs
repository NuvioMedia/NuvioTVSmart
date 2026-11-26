import assert from "node:assert/strict";
import test from "node:test";

const storageMap = new Map();
globalThis.localStorage = {
  getItem: (key) => (storageMap.has(String(key)) ? storageMap.get(String(key)) : null),
  setItem: (key, value) => storageMap.set(String(key), String(value)),
  removeItem: (key) => storageMap.delete(String(key)),
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size;
  }
};

globalThis.HTMLElement = class HTMLElement {};
globalThis.document = {
  documentElement: {
    dir: "ltr",
    lang: "en",
    dataset: {},
    style: { setProperty: () => {} },
    classList: { add() {}, remove() {}, contains: () => false, toggle: () => false }
  },
  body: {
    classList: { add() {}, remove() {}, contains: () => false, toggle: () => false }
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  navigator: { language: "en-US", languages: ["en-US"] }
};

const { renderHeroSection } = await import("./heroSection.js");
const { renderEpisodesSection } = await import("./episodesSection.js");
const { renderImdbBadge } = await import("./metaDetailsScreenHelpers-04-detect-quality.js");
const { createMetaDetailsScreenMethods08 } =
  await import("./metaDetailsScreenMethods-08-render-external-ratings-row.js");

test("detail hero, episodes, and imdb badge helpers escape HTML metacharacters", () => {
  const xss = "<script>alert(1)</script><img src=x onerror=1>";
  const heroHtml = renderHeroSection({ name: `Title ${xss}`, description: `Desc ${xss}` });
  assert.equal(heroHtml.includes("<script>"), false);
  assert.equal(heroHtml.includes("<img src=x"), false);

  const episodesHtml = renderEpisodesSection({
    videos: [{ title: `Ep ${xss}`, released: `2025${xss}` }]
  });
  assert.equal(episodesHtml.includes("<script>"), false);
  assert.equal(episodesHtml.includes("<img src=x"), false);

  const badgeHtml = renderImdbBadge(`8.4<img src=x onerror=1>`);
  assert.equal(badgeHtml.includes("<img src=x"), false);
});

test("renderMovieLayout closes #detailCompanySectionsMount and attribute-escapes backdrop style URL", () => {
  const methods = createMetaDetailsScreenMethods08();
  const container = {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const ctx = {
    container,
    params: {},
    renderMovieHeroMarkup: () => '<div class="hero">Hero</div>',
    renderMovieInsightSection: () => '<div class="insight">Insight</div>',
    renderStandaloneCommentsSection: () => '<div class="comments">Comments</div>',
    renderCompanySections: () => '<div class="companies">Comp</div>',
    getTrailerShellStateClasses: () => "",
    bindDetailChrome: () => {},
    pendingFocusRestore: true
  };

  methods.renderMovieLayout.call(ctx, {
    id: "tt1",
    type: "movie",
    name: "Sample Movie",
    background: 'https://img.example/bg.jpg");background:url(javascript:1)<script>'
  });

  const html = container.innerHTML;
  assert.match(
    html,
    /<div id="detailCompanySectionsMount"><div class="companies">Comp<\/div><\/div>/,
    "#detailCompanySectionsMount must have a matching closing </div>"
  );
  const openDivs = (html.match(/<div\b/g) || []).length;
  const closeDivs = (html.match(/<\/div>/g) || []).length;
  assert.equal(openDivs, closeDivs, "All rendered <div> tags must be balanced");
  assert.equal(
    html.includes("<script>"),
    false,
    "backdrop style attribute must escape HTML metacharacters"
  );
});
