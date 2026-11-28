import assert from "node:assert/strict";
import test from "node:test";
import * as cheerio from "cheerio";

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
const { createMetaDetailsScreenMethods09 } =
  await import("./metaDetailsScreenMethods-09-render-series-insight-section.js");
const { createMetaDetailsScreenMethods16 } =
  await import("./metaDetailsScreenMethods-16-render-comments-section.js");
const { createMetaDetailsScreenMethods20 } =
  await import("./metaDetailsScreenMethods-20-stop-trailer-playback.js");

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

const ADDON_URL_PAYLOAD = 'x" onerror="alert(1)';

test("renderHeroSection keeps an addon logo URL inside the src attribute", () => {
  const methods = createMetaDetailsScreenMethods07();
  const ctx = {
    params: { itemType: "movie" },
    isSavedInLibrary: false,
    isMarkedWatched: false,
    renderExternalRatingsRow: () => "",
    renderResumeIndicator: () => "",
    getActiveResumeProgress: () => null,
    renderRatingButton: () => "",
    renderHeroMetaRows: () => "",
    renderLibraryGlyph: () => "",
    renderWatchedGlyph: () => "",
    renderPlayGlyph: () => "",
    renderTrailerGlyph: () => ""
  };

  const previousWarn = console.warn;
  console.warn = () => {};
  let html;
  try {
    html = methods.renderHeroSection.call(ctx, {
      meta: {
        id: "tt1",
        type: "movie",
        name: "Demo",
        description: "Demo",
        logo: ADDON_URL_PAYLOAD
      },
      playLabel: "Play"
    });
  } finally {
    console.warn = previousWarn;
  }

  const $ = cheerio.load(html);
  const logo = $(".series-detail-logo");
  assert.equal(logo.length, 1);
  assert.equal(logo.attr("src"), ADDON_URL_PAYLOAD);
  assert.equal(logo.attr("onerror"), undefined);
});

test("renderCompanyLogosSection keeps an addon company logo URL inside the src attribute", () => {
  const methods = createMetaDetailsScreenMethods16();
  const html = methods.renderCompanyLogosSection([{ name: "Acme", logo: ADDON_URL_PAYLOAD }]);
  const $ = cheerio.load(html);
  const logo = $(".detail-company-card img");
  assert.equal(logo.length, 1);
  assert.equal(logo.attr("src"), ADDON_URL_PAYLOAD);
  assert.equal(logo.attr("onerror"), undefined);
});

const ADDON_CAST_ID_PAYLOAD = '"><img src=x onerror=alert(1)>';

test("renderSeriesCastTrack keeps an addon cast id inside the data-cast-id attribute", () => {
  const methods = createMetaDetailsScreenMethods09();
  const html = methods.renderSeriesCastTrack.call({
    castItems: [
      { name: "Valid Actor", character: "Lead", tmdbId: 12345, photo: "" },
      { name: "Payload Actor", character: "Villain", tmdbId: ADDON_CAST_ID_PAYLOAD, photo: "" }
    ]
  });

  const $ = cheerio.load(html);
  const cards = $(".movie-cast-card");
  assert.equal(cards.length, 2);
  assert.equal(cards.eq(0).attr("data-cast-id"), "12345", "valid cast ids must be preserved");
  assert.equal(cards.eq(1).attr("data-cast-id"), ADDON_CAST_ID_PAYLOAD);
  assert.equal($("img").length, 0, "cast id payload must not create an img element");
  assert.equal($("[onerror]").length, 0, "cast id payload must not create an onerror handler");
});

test("stream chooser keeps an addon logo URL inside the src attribute", () => {
  const methods = createMetaDetailsScreenMethods20();
  const renderChooser = (
    renderMethod,
    pendingKey,
    pending = { streams: [], addonFilter: "all", loading: false }
  ) => {
    const mount = { innerHTML: "" };
    const ctx = {
      container: { querySelector: () => mount, querySelectorAll: () => [] },
      meta: { name: "Demo", logo: ADDON_URL_PAYLOAD, genres: [] },
      [pendingKey]: pending,
      getFilteredEpisodeStreams: () => [],
      applyStreamChooserFocus() {}
    };
    methods[renderMethod].call(ctx);
    return cheerio.load(mount.innerHTML);
  };

  const movieLogo = renderChooser("renderMovieStreamChooser", "pendingMovieSelection")
    .root()
    .find(".series-stream-logo");
  assert.equal(movieLogo.length, 1);
  assert.equal(movieLogo.attr("src"), ADDON_URL_PAYLOAD);
  assert.equal(movieLogo.attr("onerror"), undefined);

  const episodeLogo = renderChooser("renderEpisodeStreamChooser", "pendingEpisodeSelection", {
    streams: [],
    addonFilter: "all",
    loading: false,
    episode: { season: 1, episode: 1, title: "Pilot" }
  })
    .root()
    .find(".series-stream-logo");
  assert.equal(episodeLogo.length, 1);
  assert.equal(episodeLogo.attr("src"), ADDON_URL_PAYLOAD);
  assert.equal(episodeLogo.attr("onerror"), undefined);
});
