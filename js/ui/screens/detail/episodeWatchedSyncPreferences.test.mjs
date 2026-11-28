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
  createElement: () => new FakeNode(),
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

const { LayoutPreferences } = await import("../../../data/local/layoutPreferences.js");
const { createMetaDetailsScreenMethods11 } =
  await import("./metaDetailsScreenMethods-11-sync-rendered-episode-track.js");

class FakeNode extends HTMLElement {
  constructor(children = {}) {
    super();
    this.children = children;
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => (force ? this.classes.add(name) : this.classes.delete(name)),
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name)
    };
  }
  querySelector(selector) {
    return this.children[selector] || null;
  }
  appendChild(node) {
    return node;
  }
}

function createEpisodeCard() {
  const image = new FakeNode();
  const card = new FakeNode({
    ".series-episode-thumb": new FakeNode(),
    ".series-episode-image": image,
    ".series-episode-copy": new FakeNode()
  });
  return { card, image };
}

function withPreferenceReads(preferences, run) {
  const originalGet = LayoutPreferences.get;
  let reads = 0;
  LayoutPreferences.get = () => {
    reads += 1;
    return preferences;
  };
  try {
    run();
  } finally {
    LayoutPreferences.get = originalGet;
  }
  return reads;
}

test("syncEpisodePlaybackDom reads layout preferences once per pass", () => {
  const episodes = Array.from({ length: 100 }, (_, index) => ({
    id: `ep${index}`,
    season: 1,
    episode: index + 1
  }));
  const cards = new Map(episodes.map((episode) => [episode.id, createEpisodeCard()]));
  let detailSectionUpdates = 0;
  const screen = {
    ...createMetaDetailsScreenMethods11(),
    meta: { type: "series" },
    episodes,
    episodeProgressMap: new Map(),
    container: {
      querySelector: (selector) =>
        cards.get(/data-video-id="([^"]+)"/.exec(selector)?.[1])?.card || null
    },
    isEpisodeMarkedWatched: (episode) => episode.episode <= 50,
    syncSeriesHeroPlayButtonLabel() {},
    updateRenderedDetailSections() {
      detailSectionUpdates += 1;
    }
  };

  const reads = withPreferenceReads(
    { blurUnwatchedEpisodes: true, detailImdbRatingsVisibility: "HIDE_UNWATCHED_EPISODES" },
    () => screen.syncEpisodePlaybackDom(episodes)
  );

  assert.equal(reads, 1);
  assert.equal(
    detailSectionUpdates,
    1,
    "hidden unwatched ratings still refresh the detail sections"
  );
  assert.equal(
    cards.get("ep0").image.classes.has("is-blurred"),
    false,
    "watched episodes stay sharp"
  );
  assert.equal(
    cards.get("ep99").image.classes.has("is-blurred"),
    true,
    "unwatched episodes are blurred"
  );
});

test("syncEpisodeCardWatchedDom still reads preferences when called for one episode", () => {
  const { card, image } = createEpisodeCard();
  const screen = {
    ...createMetaDetailsScreenMethods11(),
    episodeProgressMap: new Map(),
    container: { querySelector: () => card },
    isEpisodeMarkedWatched: () => false
  };

  const reads = withPreferenceReads({ blurUnwatchedEpisodes: true }, () =>
    screen.syncEpisodeCardWatchedDom({ id: "ep1", season: 1, episode: 1 })
  );

  assert.equal(reads, 1);
  assert.equal(image.classes.has("is-blurred"), true);
});
