import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const {
  applyCachedContinueWatchingEnrichment: apply,
  saveContinueWatchingEnrichment: save,
  writeContinueWatchingDisplaySnapshot: write,
  readContinueWatchingDisplaySnapshot: read
} = await import("../js/ui/screens/home/homeScreenHelpers-10-get-cached-continue-watching-enrichment.js");
const { continueWatchingRating } = await import("../js/ui/screens/home/continueWatchingRating.js");
const cached = {
  contentId: "tt123",
  contentType: "series",
  season: 1,
  episode: 2,
  videoId: "old-video",
  title: "Series",
  episodeTitle: "Old title",
  episodeDescription: "Old description",
  episodeThumbnail: "old-thumb",
  thumbnail: "old-thumb",
  poster: "poster",
  episodeImdbRating: 7,
  imdbRating: 6,
  genres: ["Old"],
  language: "en",
  releaseInfo: "2020"
};
save(cached);
const fresh = {
  ...cached,
  videoId: "fresh-video",
  episodeTitle: "Fresh title",
  episodeDescription: "Fresh description",
  episodeThumbnail: "fresh-thumb",
  thumbnail: "fresh-thumb",
  episodeImdbRating: 9,
  imdbRating: 8,
  genres: ["Fresh"],
  language: "it",
  releaseInfo: "2026",
  positionMs: 10,
  durationMs: 100,
  updatedAt: 123
};
const result = apply(fresh);
for (const key of Object.keys(fresh)) assert.deepEqual(result[key], fresh[key], key);
const incomplete = {
  contentId: "tt123",
  contentType: "series",
  season: 1,
  episode: 2,
  videoId: ""
};
const fallback = apply(incomplete);
for (const key of [
  "videoId",
  "episodeTitle",
  "episodeDescription",
  "episodeThumbnail",
  "episodeImdbRating",
  "language"
])
  assert.equal(fallback[key], cached[key], key);
assert.equal(
  apply({ ...incomplete, episodeTitle: "" }).episodeTitle,
  "",
  "explicit blank title is preserved"
);
assert.equal(
  apply({ ...incomplete, episode: 3 }).episodeTitle,
  undefined,
  "no cross-episode cache reuse"
);
write("fixture", [result]);
const snapshot = read("fixture")[0];
assert.equal(snapshot.episodeTitle, "Fresh title");
assert.equal(continueWatchingRating(snapshot, "SHOW_ALL"), "9.0");
assert.equal(continueWatchingRating(snapshot, "HIDE_UNWATCHED_EPISODES"), null);
assert.equal(continueWatchingRating(snapshot, "HIDE_ALL"), null);
assert.equal(
  continueWatchingRating({ ...snapshot, isNextUp: true }, "HIDE_UNWATCHED_EPISODES"),
  null
);
const cache = JSON.parse(localStorage.getItem("homeContinueWatchingEnrichmentCache"));
delete cache["series:tt123:1:2"].episodeImdbRating;
localStorage.setItem("homeContinueWatchingEnrichmentCache", JSON.stringify(cache));
assert(
  !Object.hasOwn(apply(incomplete), "episodeImdbRating"),
  "missing ratings remain eligible for enrichment"
);
console.log(
  "Continue Watching fresh metadata, fallback, episode identity, snapshots and rating visibility passed"
);
