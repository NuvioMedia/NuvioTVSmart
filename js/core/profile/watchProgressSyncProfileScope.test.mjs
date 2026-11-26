import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_ENV__ = {
  NUVIO_SUPABASE_URL: "https://primary.supabase.co",
  NUVIO_SUPABASE_ANON_KEY: "anon-key"
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
  setItem: (k, v) => storage.set(String(k), String(v)),
  removeItem: (k) => storage.delete(String(k))
};

const { AuthState } = await import("../auth/authState.js");
const { AuthManager } = await import("../auth/authManager.js");
const { SessionStore } = await import("../storage/sessionStore.js");
const { ProfileManager } = await import("./profileManager.js");
const { TraktAuthStore } = await import("../../data/local/traktAuthStore.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { watchProgressRepository } =
  await import("../../data/repository/watchProgressRepository.js");
const { watchedItemsRepository } = await import("../../data/repository/watchedItemsRepository.js");
const { WatchProgressSyncService } = await import("./watchProgressSyncService.js");
const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");

test("sync gating, push locks, and watched-items pushes use the synced profileId", async () => {
  const originalRpc = SupabaseApi.rpc;
  const originalProgressGetAll = watchProgressRepository.getAll;
  const originalWatchedGetAll = watchedItemsRepository.getAll;
  const originalState = AuthManager.state;
  const rpcCalls = [];
  try {
    AuthManager.setState(AuthState.AUTHENTICATED);
    SessionStore.accessToken = "jwt-test-token";
    await ProfileManager.replaceProfiles([
      { id: "1", name: "Profile 1" },
      { id: "2", name: "Profile 2" }
    ]);
    await ProfileManager.setActiveProfile("1");

    // Profile 1 uses Trakt; profile 2 has no provider connected and must sync via Supabase.
    TraktAuthStore.saveToken(
      {
        access_token: "t1",
        refresh_token: "r1",
        created_at: Math.floor(Date.now() / 1000),
        expires_in: 3600
      },
      "1"
    );
    TraktAuthStore.clearAuth("2");

    SupabaseApi.rpc = async (fn, body) => {
      rpcCalls.push({ fn, body });
      return [];
    };

    const pulled2 = await WatchProgressSyncService.pull(2);
    assert.deepEqual(pulled2, []);
    assert.equal(WatchProgressSyncService.getLastPullStatus(), "ok");
    assert.equal(
      rpcCalls.some(
        (call) => call.fn === "sync_pull_watch_progress" && Number(call.body.p_profile_id) === 2
      ),
      true
    );

    // Profile 1 still skips Supabase pull because Trakt is connected for profile 1.
    rpcCalls.length = 0;
    await WatchProgressSyncService.pull(1);
    assert.equal(WatchProgressSyncService.getLastPullStatus(), "skipped");
    assert.deepEqual(rpcCalls, []);

    watchedItemsRepository.getAll = async (limit, profileId) => [
      { contentId: `watched-${profileId}`, contentType: "movie", watchedAt: Date.now() }
    ];
    rpcCalls.length = 0;
    await WatchedItemsSyncService.pull(2);
    assert.equal(WatchedItemsSyncService.getLastPullStatus(), "ok");
    assert.equal(
      rpcCalls.some(
        (call) => call.fn === "sync_pull_watched_items" && Number(call.body.p_profile_id) === 2
      ),
      true
    );

    // In-flight pushes are tracked per profile: push(2) must run its own push
    // instead of joining the push already in flight for profile 1.
    watchProgressRepository.getAll = async (profileId) => [
      {
        contentId: `progress-${profileId}`,
        contentType: "movie",
        positionMs: 120000,
        durationMs: 600000,
        updatedAt: Date.now()
      }
    ];
    rpcCalls.length = 0;
    const [pushed1, pushed2] = await Promise.all([
      WatchProgressSyncService.push(1),
      WatchProgressSyncService.push(2)
    ]);
    assert.equal(pushed1, true);
    assert.equal(pushed2, true);
    assert.deepEqual(
      rpcCalls
        .filter((call) => call.fn === "sync_push_watch_progress")
        .map((call) => Number(call.body.p_profile_id))
        .sort(),
      [1, 2]
    );

    // Watched-items pushes follow the synced profile's provider, not the active one.
    rpcCalls.length = 0;
    assert.equal(await WatchedItemsSyncService.push(1), true);
    assert.equal(await WatchedItemsSyncService.push(2), true);
    assert.deepEqual(
      rpcCalls
        .filter((call) => call.fn === "sync_push_watched_items")
        .map((call) => Number(call.body.p_profile_id)),
      [2]
    );
  } finally {
    SupabaseApi.rpc = originalRpc;
    watchProgressRepository.getAll = originalProgressGetAll;
    watchedItemsRepository.getAll = originalWatchedGetAll;
    AuthManager.setState(originalState);
    TraktAuthStore.clearAuth("1");
    TraktAuthStore.clearAuth("2");
  }
});
