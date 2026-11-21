import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const { mergeProgressItems } = await import("./watchProgressSyncService.js");
const { mergeWatchedItems } = await import("./watchedItemsSyncService.js");
const { isDeviceLocalWatchId } = await import("./syncLocalIds.js");

test("media-server ids are device-local", () => {
  assert.equal(isDeviceLocalWatchId("server:conn-1:70312"), true);
  assert.equal(isDeviceLocalWatchId("tt1234"), false);
  assert.equal(isDeviceLocalWatchId("tmdb:278"), false);
});

test("a cloud pull keeps local media-server progress that the snapshot cannot contain", () => {
  const serverProgress = {
    contentId: "server:conn-1:70312",
    contentType: "series",
    season: 5,
    episode: 24,
    positionMs: 675000,
    durationMs: 1437000,
    updatedAt: 100
  };
  const merged = mergeProgressItems([serverProgress], [], [serverProgress], []);
  assert.deepEqual(
    merged.map((item) => [item.contentId, item.season, item.episode]),
    [["server:conn-1:70312", 5, 24]]
  );
});

test("a cloud pull keeps local media-server watched state and still merges catalog items", () => {
  const serverWatched = {
    contentId: "server:conn-1:70312",
    contentType: "series",
    season: 5,
    episode: 23,
    watchedAt: 100
  };
  const catalogWatched = { contentId: "tt1234", contentType: "movie", watchedAt: 50 };
  const remoteCatalogWatched = { contentId: "tt1234", contentType: "movie", watchedAt: 60 };

  const merged = mergeWatchedItems([serverWatched, catalogWatched], [remoteCatalogWatched], 200);
  const byId = new Map(merged.map((item) => [item.contentId, item]));
  assert.equal(byId.get("server:conn-1:70312").episode, 23);
  assert.equal(byId.get("tt1234").watchedAt, 60);
  assert.equal(merged.length, 2);
});

test("a pending delete still removes local media-server progress", () => {
  const serverProgress = {
    contentId: "server:conn-1:70312",
    contentType: "series",
    season: 5,
    episode: 24,
    updatedAt: 100
  };
  assert.deepEqual(mergeProgressItems([serverProgress], [], [], ["server:conn-1:70312_s5e24"]), []);
});
