import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};

const { TmdbSettingsStore: tmdb } = await import("../js/data/local/tmdbSettingsStore.js");
const { LayoutPreferences: layout } = await import("../js/data/local/layoutPreferences.js");

assert.equal(
  tmdb.getForProfile("1").useSeasonPosters,
  false,
  "TMDB season posters stay off until enabled"
);
assert.equal(
  layout.getForProfile("1").detailSeasonPostersEnabled,
  false,
  "poster season tabs stay off by default"
);

tmdb.setForProfile("1", { useSeasonPosters: true }, { silentSync: true });
assert.equal(tmdb.getForProfile("1").useSeasonPosters, true);
tmdb.setForProfile("1", { useSeasonPosters: "yes" }, { silentSync: true });
assert.equal(
  tmdb.getForProfile("1").useSeasonPosters,
  false,
  "only a real boolean enables the setting"
);

layout.setForProfile("1", { detailSeasonPostersEnabled: true }, { silentSync: true });
assert.equal(layout.getForProfile("1").detailSeasonPostersEnabled, true);

console.log("test-season-posters: ok");
