import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
const { PlayerSettingsStore } = await import("../js/data/local/playerSettingsStore.js");
const { createHomeScreenMethods06 } =
  await import("../js/ui/screens/home/homeScreenMethods-06-get-hero-source-from-focus-state.js");

// Android shows "Play manually" in the Continue Watching menu only while
// StreamAutoPlayPolicy.isEffectivelyEnabled is true (#1347).
const methods = createHomeScreenMethods06();
const item = { contentId: "tt1", videoId: "tt1:1:2", type: "series", isNextUp: false };
const screen = { ...methods, watchedItems: [], getContinueWatchingMenuItem: () => item };
const actions = () => screen.getContinueWatchingMenuOptions().map((o) => o.action);

let settings = {
  streamAutoPlayMode: "MANUAL",
  streamReuseLastLinkEnabled: false,
  streamAutoPlayReuseBingeGroup: false
};
PlayerSettingsStore.get = () => settings;
assert.ok(!actions().includes("playManually"));

for (const next of [
  { streamAutoPlayMode: "FIRST_STREAM" },
  { streamReuseLastLinkEnabled: true },
  { streamAutoPlayReuseBingeGroup: true, streamAutoPlayPreferBingeGroupForNextEpisode: true }
]) {
  settings = {
    ...settings,
    streamAutoPlayMode: "MANUAL",
    streamReuseLastLinkEnabled: false,
    streamAutoPlayReuseBingeGroup: false,
    ...next
  };
  assert.deepEqual(actions().slice(0, 2), ["details", "playManually"]);
}
console.log("continue watching play manually: ok");
