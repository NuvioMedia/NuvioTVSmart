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

const { renderImdbBadge } = await import("./metaDetailsScreenHelpers-04-detect-quality.js");
const { createMetaDetailsScreenMethods07 } =
  await import("./metaDetailsScreenMethods-07-merge-stream-items.js");
const { createMetaDetailsScreenMethods08 } =
  await import("./metaDetailsScreenMethods-08-render-external-ratings-row.js");

const XSS = "<script>alert(1)</script>";

function createContainer() {
  return { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
}

test("renderImdbBadge escapes HTML metacharacters", () => {
  const badgeHtml = renderImdbBadge(`8.4${XSS}`);
  assert.equal(badgeHtml.includes("<script>"), false);
});

test("renderMovieLayout closes #detailCompanySectionsMount and attribute-escapes backdrop style URL", () => {
  const methods = createMetaDetailsScreenMethods08();
  const container = createContainer();
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

test("renderSeriesLayout attribute-escapes backdrop style URL", () => {
  const methods = createMetaDetailsScreenMethods07();
  const container = createContainer();
  const ctx = {
    container,
    params: {},
    episodes: [],
    selectedSeason: 1,
    pendingFocusRestore: true,
    renderSeriesHeroMarkup: () => '<div class="hero">Hero</div>',
    renderSeriesInsightSection: () => "",
    renderStandaloneCommentsSection: () => "",
    renderCompanySections: () => "",
    renderSeasonButtons: () => "",
    renderEpisodeCards: () => "",
    getSelectedSeasonEpisodes: () => [],
    getRememberedEpisodeIndex: () => 0,
    getTrailerShellStateClasses: () => "",
    scheduleEpisodeVirtualizationSync: () => {},
    bindDetailChrome: () => {}
  };

  methods.renderSeriesLayout.call(ctx, {
    id: "tt2",
    type: "series",
    name: "Sample Series",
    background: 'https://img.example/bg.jpg");background:url(javascript:1)<script>'
  });

  const html = container.innerHTML;
  assert.equal(
    html.includes("<script>"),
    false,
    "backdrop style attribute must escape HTML metacharacters"
  );
  assert.equal(html.includes('bg.jpg")'), false, "backdrop style attribute must escape quotes");
});
