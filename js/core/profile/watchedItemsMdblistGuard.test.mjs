import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const originalLocalStorage = globalThis.localStorage;
const storage = new Map();

function resetMemoryStorage() {
  storage.clear();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => Array.from(storage.keys())[index] ?? null,
    getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
    clear: () => storage.clear()
  };
}

resetMemoryStorage();

const { LocalStore } = await import("../storage/localStore.js");
const { AuthManager } = await import("../auth/authManager.js");
const { AuthState } = await import("../auth/authState.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../../data/local/traktSettingsStore.js");
const { cancelProfileSettingsCloudSync } = await import("../../data/local/profileScopedStore.js");
const { watchedItemsRepository } = await import("../../data/repository/watchedItemsRepository.js");
const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");

const originalRpc = SupabaseApi.rpc;
const originalGetAll = watchedItemsRepository.getAll;
const originalReplaceAll = watchedItemsRepository.replaceAll;

beforeEach(() => {
  cancelProfileSettingsCloudSync("1");
  resetMemoryStorage();
  AuthManager.setState(AuthState.AUTHENTICATED);
  SupabaseApi.rpc = originalRpc;
  watchedItemsRepository.getAll = originalGetAll;
  watchedItemsRepository.replaceAll = originalReplaceAll;
});

after(() => {
  cancelProfileSettingsCloudSync("1");
  SupabaseApi.rpc = originalRpc;
  watchedItemsRepository.getAll = originalGetAll;
  watchedItemsRepository.replaceAll = originalReplaceAll;
  globalThis.localStorage = originalLocalStorage;
});

test("skips Supabase pull, push, and delete when MDBList is connected and selected", async () => {
  LocalStore.set("mdbListAccounts", {
    1: {
      generation: "g1",
      user: { id: 7 },
      tokens: { refreshToken: "rt-mdblist" }
    }
  });
  TraktSettingsStore.setWatchProgressSource(WatchProgressSource.MDBLIST);

  const rpcCalls = [];
  let repoReadCount = 0;
  SupabaseApi.rpc = async (fn, body) => {
    rpcCalls.push({ fn, body });
    return [];
  };
  watchedItemsRepository.getAll = async () => {
    repoReadCount += 1;
    return [{ contentId: "tt12345", contentType: "movie", title: "Movie", watchedAt: 1000 }];
  };

  const pulled = await WatchedItemsSyncService.pull("1");
  const pushed = await WatchedItemsSyncService.push("1");
  const deleted = await WatchedItemsSyncService.deleteItems(
    [{ contentId: "tt12345", contentType: "movie" }],
    "1"
  );

  assert.deepEqual(pulled, []);
  assert.equal(WatchedItemsSyncService.getLastPullStatus(), "skipped");
  assert.equal(pushed, true);
  assert.equal(deleted, true);
  assert.deepEqual(rpcCalls, []);
  assert.equal(repoReadCount, 0);
});

test("falls back to Supabase sync when MDBList source is selected without a connected account", async () => {
  TraktSettingsStore.setWatchProgressSource(WatchProgressSource.MDBLIST);

  const rpcCalls = [];
  let replacedItems = null;
  SupabaseApi.rpc = async (fn, body) => {
    rpcCalls.push({ fn, body });
    if (fn === "sync_pull_watched_items") {
      return [];
    }
    return true;
  };
  watchedItemsRepository.getAll = async () => [
    { contentId: "tt999", contentType: "movie", title: "Local Film", watchedAt: 5000 }
  ];
  watchedItemsRepository.replaceAll = async (items) => {
    replacedItems = items;
  };

  await WatchedItemsSyncService.pull("1");
  const pushed = await WatchedItemsSyncService.push("1");
  const deleted = await WatchedItemsSyncService.deleteItems(
    [{ contentId: "tt999", contentType: "movie" }],
    "1"
  );

  assert.equal(WatchedItemsSyncService.getLastPullStatus(), "ok");
  assert.equal(pushed, true);
  assert.equal(deleted, true);
  assert.equal(replacedItems, null);
  assert.deepEqual(
    rpcCalls.map((call) => call.fn),
    ["sync_pull_watched_items", "sync_push_watched_items", "sync_delete_watched_items"]
  );
});
