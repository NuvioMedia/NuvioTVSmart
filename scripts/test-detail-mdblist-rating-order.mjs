import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  key: (index) => [...store.keys()][index],
  get length() {
    return store.size;
  }
};
globalThis.window = globalThis;
globalThis.navigator = { userAgent: "node" };
globalThis.document = {
  documentElement: { lang: "en" },
  addEventListener() {},
  createElement: () => ({ style: {} }),
  querySelector: () => null
};

const { MdbListSettingsStore } = await import("../js/data/local/mdbListSettingsStore.js");
const { createMetaDetailsScreenMethods08 } =
  await import("../js/ui/screens/detail/metaDetailsScreenMethods-08-render-external-ratings-row.js");

const { renderExternalRatingsRow } = createMetaDetailsScreenMethods08();
const ratings = { trakt: 80, imdb: 7.5, tmdb: 7.2, tomatoes: 90, metacritic: 70, mal: 8.1 };
const providers = (html) => [...html.matchAll(/alt="([a-z]+)"/g)].map((match) => match[1]);

assert.deepEqual(providers(renderExternalRatingsRow({ mdbListRatings: ratings })), [
  "imdb",
  "trakt",
  "tmdb",
  "tomatoes",
  "metacritic",
  "mal"
]);
assert.match(renderExternalRatingsRow({ mdbListRatings: ratings }), /mdblist_mal\.svg/);

MdbListSettingsStore.set({ ratingOrder: ["mal", "tomatoes", "imdb"], showTrakt: false });
assert.deepEqual(providers(renderExternalRatingsRow({ mdbListRatings: ratings })), [
  "mal",
  "tomatoes",
  "imdb",
  "tmdb",
  "metacritic"
]);
assert.equal(renderExternalRatingsRow({}), "");

console.log("detail MDBList rating order parity ok");
