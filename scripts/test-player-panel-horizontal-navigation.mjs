import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
const { createPlayerScreenMethods62 } = await import("../js/ui/screens/player/playerScreenMethods-62-render-audio-control-item.js");
const { createPlayerScreenMethods64 } = await import("../js/ui/screens/player/playerScreenMethods-64-move-sources-focus.js");
const { createPlayerScreenMethods65 } = await import("../js/ui/screens/player/playerScreenMethods-65-render-parental-guide-overlay.js");
const { createPlayerScreenMethods66 } = await import("../js/ui/screens/player/playerScreenMethods-66-get-filtered-episode-panel-streams.js");

const methods = {
  ...createPlayerScreenMethods62(),
  ...createPlayerScreenMethods64(),
  ...createPlayerScreenMethods65(),
  ...createPlayerScreenMethods66()
};
const key = (keyCode) => ({ keyCode });

// Sources panel: Left/Right in the list switch the addon filter and focus its chip, like Android.
const sources = Object.assign(Object.create(methods), {
  streamCandidates: [
    { url: "a1", addonName: "A" },
    { url: "b1", addonName: "B" }
  ],
  sourceFilter: "all",
  sourcesFocus: { zone: "list", index: 1 },
  sourcesPanelVisible: true,
  renders: 0
});
sources.getOrderedStreamCandidates = function () { return this.streamCandidates; };
sources.renderSourcesPanel = function () { this.renders += 1; };
sources.moveSourcesFocus("right");
assert.equal(sources.sourceFilter, "A");
assert.deepEqual(sources.sourcesFocus, { zone: "filter", index: 1 });
assert.equal(sources.renders, 1);
sources.sourcesFocus = { zone: "list", index: 0 };
sources.moveSourcesFocus("right");
sources.sourcesFocus = { zone: "list", index: 0 };
sources.moveSourcesFocus("right");
assert.equal(sources.sourceFilter, "B", "the last filter is a boundary");
sources.sourcesFocus = { zone: "list", index: 0 };
sources.moveSourcesFocus("left");
assert.equal(sources.sourceFilter, "A");
sources.sourceFilter = "all";
sources.sourcesFocus = { zone: "list", index: 0 };
sources.moveSourcesFocus("left");
assert.equal(sources.sourceFilter, "all", "All is a boundary");
assert.deepEqual(sources.sourcesFocus, { zone: "list", index: 0 });

// Episode panel: Left/Right on an episode switch season and focus the playing episode.
const episodes = [
  { id: "s1e1", season: 1, episode: 1 },
  { id: "s1e2", season: 1, episode: 2 },
  { id: "s2e1", season: 2, episode: 1 },
  { id: "s2e2", season: 2, episode: 2 }
];
const panel = Object.assign(Object.create(methods), {
  episodes,
  params: { videoId: "s1e2", season: 1, episode: 2 },
  episodePanelVisible: true,
  episodePanelMode: "episodes",
  episodePanelFocusZone: "episodes",
  episodePanelIndex: 1,
  episodePanelSeason: 1,
  episodePanelSeasonIndex: 0,
  episodePanelStreamVideoId: ""
});
panel.renderEpisodePanel = () => {};
panel.handleEpisodePanelKey(key(39));
assert.equal(panel.episodePanelSeason, 2);
assert.equal(panel.episodePanelIndex, 2);
assert.equal(panel.episodePanelFocusZone, "episodes");
panel.handleEpisodePanelKey(key(39));
assert.equal(panel.episodePanelSeason, 2, "the last season is a boundary");
panel.handleEpisodePanelKey(key(37));
assert.equal(panel.episodePanelSeason, 1);
assert.equal(panel.episodePanelIndex, 1, "returning to the playing season focuses the playing episode");
panel.handleEpisodePanelKey(key(37));
assert.equal(panel.episodePanelFocusZone, "seasons", "Left on the first season moves to the tabs");
panel.handleEpisodePanelKey(key(39));
assert.equal(panel.episodePanelSeason, 2);
assert.equal(panel.episodePanelFocusZone, "seasons", "tab row keeps focus while browsing seasons");

// Episode streams view: Left/Right in the list switch the addon filter.
Object.assign(panel, {
  episodePanelMode: "streams",
  episodePanelStreams: [{ addonName: "A" }, { addonName: "B" }],
  episodePanelStreamFilter: "all",
  episodePanelStreamFocus: { zone: "streams", index: 0 },
  updateEpisodeStreamFocus() {}
});
panel.handleEpisodePanelKey(key(39));
assert.equal(panel.episodePanelStreamFilter, "A");
assert.deepEqual(panel.episodePanelStreamFocus, { zone: "filters", index: 1 });

console.log("player panel horizontal navigation ok");
