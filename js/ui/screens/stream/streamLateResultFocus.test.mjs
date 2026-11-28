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

const { createStreamScreenMethods01 } =
  await import("./streamScreenMethods-01-cancel-scheduled-render.js");
const { createStreamScreenMethods09 } = await import("./streamScreenMethods-09-render.js");

const stream = (name) => ({
  name,
  title: name,
  url: `https://streams.test/${name}.mkv`,
  addonName: name
});

function createScreen(focusState) {
  const screen = {
    ...createStreamScreenMethods01(),
    ...createStreamScreenMethods09(),
    container: { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] },
    params: {},
    streams: [],
    sourceChips: [],
    focusState,
    listScrollTop: 0,
    streamUserMovedFocus: true,
    streamVirtualFocusReset: false,
    streamVirtualized: false,
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
    getBackdropUrl: () => "",
    buildSourceChipMarkup: () => "",
    getFilteredStreams() {
      return this.streams;
    },
    hasPendingSourceLoads: () => false,
    shouldUseStreamVirtualization: () => false,
    areAddonLogosReady: () => true,
    renderStreamCard: (item, index) =>
      `<div class="stream-route-card-row" data-stream-row="${index}">${item.name}</div>`,
    renderStableStreamLoadingRow: () => "",
    renderStableStreamEmptyState: () => "",
    applyAddonFilterDomState() {},
    renderContinueWatchingResumeOverlay: () => "",
    renderAutoPlayOverlay: () => "",
    restoreScrollPosition() {},
    hydrateVisibleStreamBadges() {},
    bindAddonLogoFallbacks() {},
    applyFocus() {},
    bindListScrollState() {}
  };
  return screen;
}

function renderWith(screen, streams) {
  screen.streams = streams;
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    screen.render();
  } finally {
    console.warn = previousWarn;
  }
}

test("eager Stream list keeps the focused source when a late result sorts above it", () => {
  const [a, b, c] = ["A", "B", "C"].map(stream);
  const screen = createScreen({ zone: "card", row: 0, action: "play" });
  renderWith(screen, [a, b]);
  screen.focusState = { ...screen.focusState, row: 1, index: 1 };

  renderWith(screen, [c, a, b]);

  assert.equal(screen.focusState.zone, "card");
  assert.equal(screen.focusState.row, 2, "focus must follow source B to its new row");
});

test("eager Stream list keeps the first result rule before the user moves focus", () => {
  const [a, b, c] = ["A", "B", "C"].map(stream);
  const screen = createScreen({ zone: "card", row: 0, action: "play" });
  screen.streamUserMovedFocus = false;
  renderWith(screen, [a, b]);

  renderWith(screen, [c, a, b]);

  assert.equal(
    screen.focusState.row,
    0,
    "an earlier source still replaces the initial first result"
  );
});

test("eager Stream list leaves filter focus alone when late results arrive", () => {
  const [a, b, c] = ["A", "B", "C"].map(stream);
  const screen = createScreen({ zone: "card", row: 1, action: "play" });
  renderWith(screen, [a, b]);
  screen.focusState = { zone: "filter", index: 1 };

  renderWith(screen, [c, a, b]);

  assert.deepEqual(screen.focusState, { zone: "filter", index: 1 });
});
