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
globalThis.HTMLImageElement = class HTMLImageElement {};
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

const { createStreamScreenMethods09 } = await import("./streamScreenMethods-09-render.js");

test("Stream keeps addon logo and backdrop payloads inside their intended attributes", () => {
  const logoPayload = 'x" onerror="alert(1)';
  const backdropPayload = 'x"><img src=x onerror=alert(1)><div style="';
  const container = {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const screen = {
    ...createStreamScreenMethods09(),
    container,
    params: { logo: logoPayload, backdrop: backdropPayload },
    focusState: { zone: "card", row: 0 },
    listScrollTop: 0,
    streamUserMovedFocus: false,
    streamVirtualFocusReset: false,
    autoResumeUiActive: false,
    cancelScheduledRender() {},
    getHeaderMeta: () => ({
      isSeries: false,
      title: "Demo",
      subtitle: "",
      episodeLabel: "",
      detailLine: "",
      resumeLabel: ""
    }),
    getBackdropUrl: () => backdropPayload,
    buildSourceChipMarkup: () => "",
    getFilteredStreams: () => [],
    hasPendingSourceLoads: () => false,
    shouldUseStreamVirtualization: () => false,
    renderContinueWatchingResumeOverlay: () => "",
    renderAutoPlayOverlay: () => "",
    restoreScrollPosition() {},
    hydrateVisibleStreamBadges() {},
    bindAddonLogoFallbacks() {},
    applyFocus() {},
    bindListScrollState() {}
  };

  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    screen.render();
  } finally {
    console.warn = previousWarn;
  }

  const $ = cheerio.load(container.innerHTML);
  assert.equal($("img").length, 1, "backdrop must not create an injected image element");
  const logo = $(".stream-route-logo");
  assert.equal(logo.length, 1);
  assert.equal(logo.attr("src"), logoPayload);
  assert.equal(logo.attr("onerror"), undefined);
  assert.equal($(".stream-route-backdrop").length, 1);
});
