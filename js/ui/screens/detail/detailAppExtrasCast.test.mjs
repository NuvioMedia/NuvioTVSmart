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

const [{ metaRepository }, { extractCast }] = await Promise.all([
  import("../../../data/repository/metaRepository.js"),
  import("./metaDetailsScreenHelpers-03-meta-with-route-external-ids.js")
]);

// AIOMetadata puts the people list only in app_extras.cast (no top-level cast).
const aiometadataMeta = {
  id: "tt6751668",
  type: "movie",
  name: "Parasite",
  director: ["Bong Joon Ho"],
  app_extras: {
    cast: [
      {
        name: "Song Kang-ho",
        character: "Kim Ki-taek",
        photo: "https://image.tmdb.org/t/p/w276_and_h350_face/kBM9UTPYXUA2RNk210DXhztLFns.jpg",
        tmdbId: 20738
      },
      { name: "Lee Sun-kyun", character: "Park Dong-ik", photo: "", tmdbId: 115290 }
    ]
  }
};

test("app_extras.cast becomes castMembers and fills the detail cast rail", () => {
  const meta = metaRepository.mapMeta(aiometadataMeta);
  assert.deepEqual(meta.castMembers, [
    {
      name: "Song Kang-ho",
      character: "Kim Ki-taek",
      photo: "https://image.tmdb.org/t/p/w276_and_h350_face/kBM9UTPYXUA2RNk210DXhztLFns.jpg",
      tmdbId: 20738
    },
    { name: "Lee Sun-kyun", character: "Park Dong-ik", photo: "", tmdbId: 115290 }
  ]);
  const cast = extractCast(meta);
  assert.equal(cast.length, 2);
  assert.deepEqual(cast[0], {
    name: "Song Kang-ho",
    character: "Kim Ki-taek",
    photo: "https://image.tmdb.org/t/p/w276_and_h350_face/kBM9UTPYXUA2RNk210DXhztLFns.jpg",
    tmdbId: 20738
  });
  assert.equal(cast[1].tmdbId, 115290);
});

test("appExtras camelCase and nameless entries keep the same behaviour", () => {
  const meta = metaRepository.mapMeta({
    id: "tt1",
    type: "movie",
    name: "Test",
    appExtras: {
      cast: [
        { name: " ", character: "Cameo" },
        { name: "Ana", character: null }
      ]
    }
  });
  assert.deepEqual(meta.castMembers, [{ name: "Ana", character: "", photo: "", tmdbId: null }]);
});

test("top-level cast arrays keep working when there is no app_extras cast", () => {
  const meta = metaRepository.mapMeta({
    id: "tt2",
    type: "movie",
    name: "Test",
    cast: ["Cho Yeo-jeong", "Park So-dam"]
  });
  assert.deepEqual(
    extractCast(meta).map((entry) => entry.name),
    ["Cho Yeo-jeong", "Park So-dam"]
  );
});

test("a meta without cast data stays empty", () => {
  const meta = metaRepository.mapMeta({ id: "tt0000001", type: "movie", name: "Unknown" });
  assert.deepEqual(meta.castMembers, []);
  assert.deepEqual(extractCast(meta), []);
});
