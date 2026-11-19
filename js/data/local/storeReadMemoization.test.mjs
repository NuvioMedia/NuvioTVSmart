// Raw-string read memo for the large local lists.
//
// Home, Detail and Library read the watched and saved lists repeatedly while
// rendering. Repeated reads of an unchanged stored string must not reparse or
// re-sort them, while writes through the store or straight into localStorage
// must still be visible on the next read.
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
let getItemCalls = 0;
globalThis.localStorage = {
  getItem(key) {
    getItemCalls += 1;
    return storage.has(String(key)) ? storage.get(String(key)) : null;
  },
  setItem(key, value) {
    storage.set(String(key), String(value));
  },
  removeItem(key) {
    storage.delete(String(key));
  },
  key(index) {
    return Array.from(storage.keys())[index] ?? null;
  },
  get length() {
    return storage.size;
  }
};

const realParse = JSON.parse;
let parseCalls = 0;
JSON.parse = function countedParse(...args) {
  parseCalls += 1;
  return realParse.apply(this, args);
};

const { WatchedItemsStore } = await import("./watchedItemsStore.js");
const { SavedLibraryStore } = await import("./savedLibraryStore.js");
const { SimklSyncService } = await import("../repository/simklSyncService.js");

const resetCounters = () => {
  getItemCalls = 0;
  parseCalls = 0;
};

test("watched list reads of unchanged storage skip parse and sort", () => {
  storage.clear();
  storage.set(
    "watchedItems",
    JSON.stringify([
      { contentId: "tt1", title: "One", watchedAt: 1000 },
      { contentId: "tt2", title: "Two", watchedAt: 2000 }
    ])
  );

  const first = WatchedItemsStore.listAll();
  assert.deepEqual(
    first.map((item) => item.contentId),
    ["tt2", "tt1"]
  );
  resetCounters();

  for (let index = 0; index < 25; index += 1) {
    const items = WatchedItemsStore.listForProfile("1");
    assert.deepEqual(
      items.map((item) => item.contentId),
      ["tt2", "tt1"]
    );
  }
  assert.equal(parseCalls, 0, "unchanged reads must not reparse the stored list");
  assert.ok(getItemCalls >= 25, "each read must still observe the stored string");
});

test("watched list observes external writes and its own writes", () => {
  storage.clear();
  storage.set("watchedItems", JSON.stringify([{ contentId: "tt1", watchedAt: 1000 }]));
  assert.deepEqual(
    WatchedItemsStore.listAll().map((item) => item.contentId),
    ["tt1"]
  );

  // Cloud sync and profile cleanup write straight into localStorage.
  storage.set(
    "watchedItems",
    JSON.stringify([
      { contentId: "tt1", watchedAt: 1000 },
      { contentId: "tt2", watchedAt: 3000 }
    ])
  );
  assert.deepEqual(
    WatchedItemsStore.listAll().map((item) => item.contentId),
    ["tt2", "tt1"]
  );

  WatchedItemsStore.upsert({ contentId: "tt3", title: "Three", watchedAt: 4000 }, "1");
  assert.deepEqual(
    WatchedItemsStore.listAll().map((item) => item.contentId),
    ["tt3", "tt2", "tt1"]
  );

  WatchedItemsStore.remove("tt2", "1");
  assert.deepEqual(
    WatchedItemsStore.listAll().map((item) => item.contentId),
    ["tt3", "tt1"]
  );
});

test("saved library list reads of unchanged storage skip parse and sort", () => {
  storage.clear();
  storage.set(
    "savedLibraryItems",
    JSON.stringify([
      { contentId: "tmdb:1", contentType: "movie", title: "One", updatedAt: 1000 },
      { contentId: "tmdb:2", contentType: "movie", title: "Two", updatedAt: 2000 }
    ])
  );

  assert.deepEqual(
    SavedLibraryStore.listAll().map((item) => item.contentId),
    ["tmdb:2", "tmdb:1"]
  );
  resetCounters();

  for (let index = 0; index < 25; index += 1) {
    assert.deepEqual(
      SavedLibraryStore.listForProfile("1").map((item) => item.contentId),
      ["tmdb:2", "tmdb:1"]
    );
  }
  assert.equal(parseCalls, 0, "unchanged reads must not reparse the stored list");

  storage.set(
    "savedLibraryItems",
    JSON.stringify([{ contentId: "tmdb:3", contentType: "movie", title: "Three", updatedAt: 3000 }])
  );
  assert.deepEqual(
    SavedLibraryStore.listAll().map((item) => item.contentId),
    ["tmdb:3"]
  );

  SavedLibraryStore.upsert({ contentId: "tmdb:4", title: "Four", updatedAt: 4000 }, "1");
  assert.deepEqual(
    SavedLibraryStore.listAll().map((item) => item.contentId),
    ["tmdb:4", "tmdb:3"]
  );
});

test("corrupt stored lists fall back to an empty list", () => {
  storage.clear();
  storage.set("watchedItems", "{not json");
  storage.set("savedLibraryItems", "{not json");
  assert.deepEqual(WatchedItemsStore.listAll(), []);
  assert.deepEqual(SavedLibraryStore.listAll(), []);
});

test("simkl snapshot reads of unchanged storage skip parse", () => {
  storage.clear();
  storage.set(
    "simklSyncState",
    JSON.stringify({
      version: 1,
      profiles: {
        1: {
          schemaVersion: 3,
          initialized: true,
          lastSyncedAt: 1000,
          entries: [{ movie: { title: "One", ids: { simkl: 1 } } }],
          playback: []
        }
      }
    })
  );

  const first = SimklSyncService.getSnapshot("1");
  assert.equal(first.entries.length, 1);
  resetCounters();

  for (let index = 0; index < 25; index += 1) {
    const snapshot = SimklSyncService.getSnapshot("1");
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.lastSyncedAt, 1000);
  }
  assert.equal(parseCalls, 0, "unchanged reads must not reparse the envelope");

  // Writes must invalidate: clearing the profile is persisted immediately.
  SimklSyncService.clearCurrentProfile();
  const cleared = SimklSyncService.getSnapshot("1");
  assert.equal(cleared.initialized, false);
  assert.deepEqual(cleared.entries, []);

  // External writes must be picked up as well.
  storage.set(
    "simklSyncState",
    JSON.stringify({
      version: 1,
      profiles: {
        1: { schemaVersion: 3, initialized: true, lastSyncedAt: 2000, entries: [], playback: [] }
      }
    })
  );
  assert.equal(SimklSyncService.getSnapshot("1").lastSyncedAt, 2000);
});
